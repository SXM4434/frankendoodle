// Smart Hachure System — learnedProvider (the FIRST trained model wired as a
// ClassifierProvider second-opinion).
//
// WHAT THIS IS (feedback_actual_ml_not_fake): a real trained softmax
// logistic-regression model — weights fit offline by SGD on the golden
// labeled dataset (tools/ml/train-region-classifier.mjs), artifact at
// datasets/smart-layer.model.json — exposed as a ClassifierProvider so it
// slots into the chain exactly like ruleEngineProvider. It is NOT an
// if-statement renamed "model" and NOT an LLM call: inference is a dot product
// + softmax over learned weights.
//
// ⚠ NOT WIRED INTO THE CHAIN YET — and the reason is an honesty gate, not an
// oversight (see the header of classifier.ts is intentionally untouched):
//   The model was trained on three dataset features — darknessL, log1p(area),
//   and fillStyle. But `fillStyle` in the dataset is the RENDERED treatment's
//   fill style, which is DOWNSTREAM of classification — it is not a field on
//   `Signals` and is not known at classify-time. Held-out ablation
//   (tools/ml): WITH fillStyle 65.4% mean acc; WITHOUT it (darkness+area only,
//   the runtime-honest inputs) 59.8% mean. So feeding this provider live
//   Signals means supplying fillStyle='none', which silently drops it to the
//   ~60% regime. The honest fix before wiring is a Signals-only retrain (or
//   adding the real Signals to the dataset). Until then this file is the
//   bolted-in seat + a faithful inference path, callable from tests/tools, but
//   the chain edit in index.ts/classifier.ts is deferred.
//
// To wire AFTER a Signals-only retrain:
//   index.ts:194  providers = opts.providers ?? [ruleEngineProvider, learnedProvider]
//   — order matters: rules first (they carry provenance + cover the confident
//   cases), learnedProvider fills the gap where rules abstain (confidence < 0.7).

import type {
  Signals,
  Classification,
  ClassificationContext,
  ClassifierProvider,
  TonalRole,
} from './types';

// ─── Artifact shape (mirrors datasets/smart-layer.model.json) ─────────────────

export type LearnedModelArtifact = {
  model: string;
  modelType: 'softmax-logistic-regression';
  version: number;
  classes: TonalRole[];
  featureNames: string[];
  fillStyles: string[];
  standardizer: { mean: number[]; std: number[] };
  weights: number[][]; // K × (d+1), last col = bias; applied to STANDARDIZED features
};

// ─── Feature encoding — MUST match tools/ml/lib.mjs::rawFeatures exactly ───────
//
// [ darknessL, log1p(area), fill=none, fill=solid, fill=hachure ]
//
// `fillStyle` is supplied by the caller. From pure Signals it is unknown at
// classify-time (it's a treatment output) → pass null → encoded as all-zero
// one-hot (the standardizer then centers it). Callers that DO know a region's
// rendered fillStyle (offline eval, the training/inference parity test) pass it.

function rawFeaturesFromSignals(s: Signals, fillStyle: string | null, fillStyles: string[]): number[] {
  const darkness = clamp01(s.darknessL);
  const logArea = Math.log1p(Math.max(0, s.area));
  const oneHot = fillStyles.map((f) => (fillStyle === f ? 1 : 0));
  return [darkness, logArea, ...oneHot];
}

function standardize(raw: number[], stdz: { mean: number[]; std: number[] }): number[] {
  return raw.map((v, j) => (v - stdz.mean[j]) / (stdz.std[j] || 1));
}

function softmax(logits: number[]): number[] {
  const m = Math.max(...logits);
  const ex = logits.map((z) => Math.exp(z - m));
  const sum = ex.reduce((a, b) => a + b, 0);
  return ex.map((e) => e / sum);
}

/** Pure inference: standardized features → {role, probabilities}. Exported for tests. */
export function predictRole(
  artifact: LearnedModelArtifact,
  signals: Signals,
  fillStyle: string | null = null,
): { role: TonalRole; confidence: number; probabilities: Record<string, number> } {
  const raw = rawFeaturesFromSignals(signals, fillStyle, artifact.fillStyles);
  const x = standardize(raw, artifact.standardizer);
  const d = x.length;
  const logits = artifact.weights.map((wc) => {
    let z = wc[d]; // bias
    for (let j = 0; j < d; j++) z += wc[j] * x[j];
    return z;
  });
  const p = softmax(logits);
  let bi = 0;
  for (let i = 1; i < p.length; i++) if (p[i] > p[bi]) bi = i;
  const probabilities: Record<string, number> = {};
  artifact.classes.forEach((c, i) => (probabilities[c] = p[i]));
  return { role: artifact.classes[bi], confidence: p[bi], probabilities };
}

// ─── Provider factory ─────────────────────────────────────────────────────────
//
// Returns a ClassifierProvider bound to a loaded artifact. The provider ABSTAINS
// (returns null → delegate to next provider) when its top-class probability is
// below `minConfidence` — so it behaves as a true second opinion, never forcing
// a low-confidence guess over the conservative paper fallback. confidence is the
// model's softmax probability (a real calibrated-ish number, not a hand weight),
// though the dataset's ECE caveat (reliability.js) means it is not yet
// guaranteed calibrated — Platt scaling on Signals-only predictions is the next
// rung if this is promoted.

export function makeLearnedProvider(
  artifact: LearnedModelArtifact,
  opts: { minConfidence?: number; getFillStyle?: (s: Signals, ctx: ClassificationContext) => string | null } = {},
): ClassifierProvider {
  const minConfidence = opts.minConfidence ?? 0.5;
  return {
    name: `learned:${artifact.model}@v${artifact.version}`,
    classify(signals: Signals, ctx: ClassificationContext): Classification | null {
      const fillStyle = opts.getFillStyle ? opts.getFillStyle(signals, ctx) : null;
      const { role, confidence, probabilities } = predictRole(artifact, signals, fillStyle);
      if (confidence < minConfidence) return null; // abstain — let the chain continue
      const sorted = Object.values(probabilities).sort((a, b) => b - a);
      const margin = sorted.length > 1 ? sorted[0] - sorted[1] : sorted[0];
      return {
        role,
        confidence,
        rawScore: confidence,
        margin,
        firedRules: [this.name],
        classifiedBy: 'decision-tree', // nearest existing enum value for a learned model (no 'softmax-lr' member yet)
        signalsSnapshot: signals,
      };
    },
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ════════════════════════════════════════════════════════════════════════════
// v2 — SIGNALS-ONLY model (the production-wireable one). Loads
// datasets/smart-layer.signals.model.json (32 classify-time features, NO leaky
// fillStyle). The encoder below replicates tools/ml/lib-signals.mjs
// (rawSignalFeatures) AND tools/ml/enrich-dataset.mjs (signalsToFeatures) EXACTLY
// — feature order, clamps, log1p, one-hot vocabularies must match the training
// encoder bit-for-bit or the standardizer + weights read garbage. A parity test
// (tools/ml/parity-check) asserts runtime == offline on golden rows.
// ════════════════════════════════════════════════════════════════════════════

export type LearnedSignalsArtifact = {
  model: string;
  modelType: 'softmax-logistic-regression';
  version: number;
  classes: TonalRole[];
  featureNames: string[];
  standardizer: { mean: number[]; std: number[] };
  weights: number[][]; // K × (32+1), last col = bias; applied to STANDARDIZED features
};

// Fixed vocabularies — MUST match lib-signals.mjs STROKE_BINS / TAGS order.
const STROKE_BINS = ['none', 'hairline', 'thin', 'medium', 'heavy'] as const;
const TAGS = ['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line', 'text', 'g', 'other'] as const;

/** Encode one runtime `Signals` into the 32-feature signals-only vector, in the
 *  exact order of artifact.featureNames. Combines enrich-dataset.signalsToFeatures
 *  (bbox→bboxW/H, parentBBox→hasParent, stroke/fill→hasStroke/hasFill) with
 *  lib-signals.rawSignalFeatures (clamps, log1p, one-hots). fillStyle is NEVER
 *  read here — it's a treatment output, excluded by construction. */
export function encodeSignals32(s: Signals): number[] {
  const num = (v: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const b01 = (v: boolean) => (v ? 1 : 0);
  const hasStroke = s.stroke !== null && s.stroke !== 'none' && s.stroke !== 'transparent';
  const hasFill = s.fill !== null && s.fill !== 'none' && s.fill !== 'transparent';
  const bboxW = s.bbox?.w ?? 0;
  const bboxH = s.bbox?.h ?? 0;
  const strokeOneHot = STROKE_BINS.map((bin) => (s.strokeWidthBin === bin ? 1 : 0));
  const tagOneHot = TAGS.map((t) => (s.tag === t ? 1 : 0));
  return [
    clamp01(num(s.darknessL)),                                   // darknessL
    Math.log1p(Math.max(0, num(s.area))),                        // log1pArea
    Math.max(0, Math.min(10, num(s.aspectRatio))),               // aspectRatioClamped
    Math.log1p(Math.max(0, num(s.perimeter))),                   // log1pPerimeter
    Math.log1p(Math.max(0, bboxW)),                              // log1pBboxW
    Math.log1p(Math.max(0, bboxH)),                              // log1pBboxH
    num(s.zIndex),                                               // zIndex
    clamp01(num(s.areaFractionOfParent)),                        // areaFractionOfParent
    num(s.enclosesSiblingCount),                                 // enclosesSiblingCount
    b01(s.containedInZIndex !== null && s.containedInZIndex !== undefined), // isContained
    b01(!!s.isPartOfStripeCluster),                              // isPartOfStripeCluster
    b01(s.parentBBox !== null),                                  // hasParent
    b01(hasStroke),                                              // hasStroke
    b01(hasFill),                                                // hasFill
    b01(!!s.hasDasharray),                                       // hasDasharray
    clamp01(num(s.opacity)),                                     // opacity
    clamp01(num(s.fillOpacity)),                                 // fillOpacity
    ...strokeOneHot,                                             // strokeBin=* (5)
    ...tagOneHot,                                                // tag=* (10)
  ];
}

/** Pure inference for the signals-only model: Signals → {role, confidence, probs}. */
export function predictRoleSignals(
  artifact: LearnedSignalsArtifact,
  signals: Signals,
): { role: TonalRole; confidence: number; probabilities: Record<string, number> } {
  const x = standardize(encodeSignals32(signals), artifact.standardizer);
  const d = x.length;
  const logits = artifact.weights.map((wc) => {
    let z = wc[d]; // bias (last col)
    for (let j = 0; j < d; j++) z += wc[j] * x[j];
    return z;
  });
  const p = softmax(logits);
  let bi = 0;
  for (let i = 1; i < p.length; i++) if (p[i] > p[bi]) bi = i;
  const probabilities: Record<string, number> = {};
  artifact.classes.forEach((c, i) => (probabilities[c] = p[i]));
  return { role: artifact.classes[bi], confidence: p[bi], probabilities };
}

/** ClassifierProvider bound to the signals-only artifact. Abstains below
 *  `minConfidence` (true second opinion). classifiedBy 'decision-tree' = nearest
 *  existing enum slot for a learned model. */
export function makeLearnedSignalsProvider(
  artifact: LearnedSignalsArtifact,
  opts: { minConfidence?: number } = {},
): ClassifierProvider {
  const minConfidence = opts.minConfidence ?? 0.5;
  return {
    name: `learned-signals:${artifact.model}@v${artifact.version}`,
    classify(signals: Signals): Classification | null {
      const { role, confidence, probabilities } = predictRoleSignals(artifact, signals);
      if (confidence < minConfidence) return null;
      const sorted = Object.values(probabilities).sort((a, b) => b - a);
      const margin = sorted.length > 1 ? sorted[0] - sorted[1] : sorted[0];
      return {
        role,
        confidence,
        rawScore: confidence,
        margin,
        firedRules: [this.name],
        classifiedBy: 'decision-tree',
        signalsSnapshot: signals,
      };
    },
  };
}
