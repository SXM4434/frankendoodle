// Smart Hachure System — public API.
//
// One function: `renderSmartHachure(svgRoot, fullModifiers, opts)`.
// Orchestrates: classify → generate outline via legacy transformElement (with
// fillStyle suppressed) → add fill marks per classification → replace original.
//
// Architecture: signals → classify → select treatment → render
// See `docs/labs/hero/cells/F3-smart-hachure-system/06-architecture-technical-core.md`

import rough from 'roughjs';
import { extractAllSignals, extractSignals, getRenderableChildren } from './signals';
import { classify, ruleEngineProvider } from './classifier';
import { makeLearnedSignalsProvider } from './learnedProvider';
import { SIGNALS_MODEL } from './signalsModel.generated';
import { selectTreatment, STYLE_OWNS_FILL_GRAMMAR, type SmartHachureStyle } from './techniqueMap';
import { renderRegion } from './renderRegion';
import { createOverrideStore, hashSvg } from './overrideStore';
import { transformElement } from '../../components/canvas/SvgStyleTransform';
import type { F3ModifiersState } from '../../state/F3RoughModifiersContext';
import type {
  Classification,
  ClassifierProvider,
  OverrideStoreApi,
  TonalRole,
  Treatment,
} from './types';

// The trained signals-only region classifier, instantiated ONCE (inference is a
// dot product over fixed weights — no per-render setup). minConfidence 0.5 = it
// only voices an opinion it's at least moderately sure of; classify() then does
// the agree/override/keep reconciliation. Parity asserted by tools/ml/parity-check.
const LEARNED_SIGNALS_PROVIDER = makeLearnedSignalsProvider(SIGNALS_MODEL, { minConfidence: 0.5 });

// ─── DECISION LOG (QW-1) ──────────────────────────────────────────────────
//
// In-memory per-region decision trace, pushed by renderSmartHachure. This is
// the calibration + training dataset side channel (24-research-classifier-
// improvements §7.1 QW-1) — write-only from the render path, read by the
// audit harness. Zero behavior change: nothing in the pipeline reads it.

/** G-10 provenance tag — WHICH surface produced a decision-log entry.
 *  Without it, training exports mix canonical record renders with transient
 *  desk-lens sweeps / pen previews → duplicate contradictory labels per
 *  svgHash (docs/design/smart-system-gaps.md §G-10). `null` = host surface
 *  not yet wired — export scripts must treat null as "exclude or triage",
 *  never guess. */
export type DecisionSurface = 'record' | 'desk-lens' | 'pen-preview' | 'sandbox' | 'audit';

const DECISION_SURFACES: ReadonlySet<string> = new Set([
  'record',
  'desk-lens',
  'pen-preview',
  'sandbox',
  'audit',
]);

export type DecisionLogEntry = {
  svgHash: string;
  regionPath: string;
  role: TonalRole;
  confidence: number;
  rawScore: number;
  margin: number;
  firedRules: string[];
  classifiedBy: Classification['classifiedBy'];
  darknessL: number;
  area: number;
  fillStyle: Treatment['fillStyle'];
  /** G-10: which surface this decision was rendered for (null = unwired host). */
  surface: DecisionSurface | null;
};

// FIFO cap — a 681-pattern sweep × handful of regions stays well under this;
// the cap only guards long-lived sessions from unbounded growth.
const DECISION_LOG_MAX = 5000;
const decisionLog: DecisionLogEntry[] = [];

function pushDecisionLogEntry(entry: DecisionLogEntry): void {
  decisionLog.push(entry);
  if (decisionLog.length > DECISION_LOG_MAX) {
    decisionLog.splice(0, decisionLog.length - DECISION_LOG_MAX);
  }
}

/** Snapshot of the in-memory decision log (copy — safe to mutate/serialize). */
export function getDecisionLog(): DecisionLogEntry[] {
  return decisionLog.slice();
}

/** Reset the collector (harness calls this between runs). */
export function clearDecisionLog(): void {
  decisionLog.length = 0;
}

// ─── G-10 SURFACE TAG (ambient) ───────────────────────────────────────────
//
// Three ways a render acquires its surface tag, strongest first:
//   1. `opts.surface` on the renderSmartHachure call (per-call, exact);
//   2. a `data-dd-surface="…"` attribute on ANY DOM ancestor of the svg being
//      rendered (per-instance — hosts tag their wrapper once and every render
//      inside it, including interleaved popups, tags itself correctly);
//   3. this module-level ambient tag via `setDecisionLogSurface` (coarse —
//      single-surface pages and headless harnesses).
// None present → entries carry `surface: null` (honest "unwired").
//
// HOST WIRING (additive, one line per surface — the G-10 retrofit):
//   DeskPage desk container:   data-dd-surface={deskLensOn ? 'desk-lens' : 'record'}
//   DrawPanel popup wrapper:   data-dd-surface="pen-preview"
//   ObjectSurface (sandbox/edit popup): data-dd-surface="sandbox"
//   /audit page root:          data-dd-surface="audit"

let ambientSurfaceTag: DecisionSurface | null = null;

/** Set the ambient surface tag for subsequent renders (null clears). */
export function setDecisionLogSurface(surface: DecisionSurface | null): void {
  ambientSurfaceTag = surface;
}

/** Current ambient surface tag (harness introspection). */
export function getDecisionLogSurface(): DecisionSurface | null {
  return ambientSurfaceTag;
}

/** Resolve the tag for one render: opts > DOM ancestor attr > ambient > null. */
function resolveDecisionSurface(
  svgRoot: SVGSVGElement,
  optsSurface: DecisionSurface | undefined,
): DecisionSurface | null {
  if (optsSurface !== undefined) return optsSurface;
  // `closest` walks the live ancestor chain; detached roots simply miss.
  const tagged =
    typeof svgRoot.closest === 'function' ? svgRoot.closest('[data-dd-surface]') : null;
  const attr = tagged?.getAttribute('data-dd-surface') ?? null;
  if (attr !== null && DECISION_SURFACES.has(attr)) return attr as DecisionSurface;
  return ambientSurfaceTag;
}

// Harness access from DevTools / playwright — same window-flag idiom as
// `__dd_diag` in SvgStyleTransform.tsx.
if (typeof window !== 'undefined') {
  (
    window as {
      __dd_decisionLog?: {
        get: () => DecisionLogEntry[];
        clear: () => void;
        setSurface: (s: DecisionSurface | null) => void;
      };
    }
  ).__dd_decisionLog = {
    get: getDecisionLog,
    clear: clearDecisionLog,
    setSurface: setDecisionLogSurface,
  };
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────

export type SmartHachureOpts = {
  /** User's SVG style choice (must be a rough-family style). */
  styleChoice: SmartHachureStyle;
  /** Ink color for marks (resolved CSS color string). */
  inkColor: string;
  /** Optional override store — pass in for visitor-canvas multi-instance. */
  overrideStore?: OverrideStoreApi;
  /** Optional provider chain — v1 default: [ruleEngineProvider]. */
  providers?: ClassifierProvider[];
  /** Confidence threshold below which classifier falls through. Default 0.7. */
  confidenceThreshold?: number;
  /** Optional callback fired per region after classification. */
  onClassification?: (
    regionPath: string,
    classification: Classification,
    treatment: Treatment,
  ) => void;
  /** G-10: per-call surface tag for decision-log entries. When absent, the
   *  tag resolves from a `data-dd-surface` DOM ancestor, then the ambient
   *  `setDecisionLogSurface` value, then null. */
  surface?: DecisionSurface;
};

/**
 * Render Smart Hachure onto an SVG.
 *
 * For each renderable top-level child:
 *   1. Extract signals on the clean element
 *   2. Classify into a TonalRole
 *   3. Select a Treatment (which fillStyle + axes)
 *   4. Run legacy `transformElement` with fillStyle suppressed → jittered outlines
 *      (honors all sliders: roughness · bowing · curveDamp · strokeWidth ·
 *       multiStroke · sketchingStyle · endpointBehavior · penTip)
 *   5. Generate Smart Hachure fill marks per classification
 *   6. Replace the original child with [fill marks] + [jittered outlines]
 *
 * MUTATION CONTRACT: in-place. Calling twice doubles. Caller clones first.
 */
export function renderSmartHachure(
  svgRoot: SVGSVGElement,
  fullModifiers: F3ModifiersState,
  opts: SmartHachureOpts,
): void {
  const overrideStore = opts.overrideStore ?? createOverrideStore();
  // "Look at both" (Sebs 2026-06-26): rules + the trained signals model run on
  // every region; classify() reconciles (agree → trusted, in-vocab disagreement
  // → model wins, else rule keeps its nuance).
  // DEFAULT = RULES + MODEL ("look at both"). The M regression that briefly
  // forced opt-in is fixed by the I-2 guard in classify() (a paper/light region
  // can't be overridden to a dark-fill role) AND a FULL AUDIT of all 14 catalog
  // objects the model overrides came back 0-WORSE (1 better=sony, 13 same) —
  // verified safe everywhere it acts, so it rides live again.
  // OFF SWITCH (any of): add `?ml=off` to the URL (easiest — just visit
  //   /audit?ml=off), or `window.__DD_ML_OFF__ = true`, or pass
  //   opts.providers = [ruleEngineProvider]. All render rules-only.
  const mlOff =
    typeof window !== 'undefined' &&
    ((window as unknown as { __DD_ML_OFF__?: boolean }).__DD_ML_OFF__ === true ||
      new URLSearchParams(window.location.search).get('ml') === 'off');
  const providers =
    opts.providers ?? (mlOff ? [ruleEngineProvider] : [ruleEngineProvider, LEARNED_SIGNALS_PROVIDER]);
  const threshold = opts.confidenceThreshold ?? 0.7;
  const svgHash = hashSvg(svgRoot);
  const rc = rough.svg(svgRoot);
  const ownerDoc = svgRoot.ownerDocument!;
  // G-10: resolve the surface tag ONCE per render pass (the svg's ancestry
  // doesn't change mid-pass).
  const surface = resolveDecisionSurface(svgRoot, opts.surface);
  // I-3 bias-within-band: the hachureGap slider rides the darkness-solved
  // gap as a ratio against its default (DEFAULT_MODIFIERS.hachureGap = 4 —
  // same anchor constant techniqueMap's remap uses). Slider at 4 → 1.0.
  const gapBias =
    Number.isFinite(fullModifiers.hachureGap) && fullModifiers.hachureGap > 0
      ? fullModifiers.hachureGap / 4
      : 1;

  // Take a snapshot of original children BEFORE we mutate the tree — every
  // subsequent operation references this fixed list. The DOM walker would
  // otherwise re-iterate over the marks we just inserted.
  const originalChildren = Array.from(getRenderableChildren(svgRoot));

  // The SVG's viewBox is the "parent bbox" for top-level children — without
  // this the classifier's `areaFractionOfParent` calc returns 0 and the
  // outer-frame rule never fires (BUG fixed 2026-06-03).
  const vb = svgRoot.viewBox?.baseVal;
  const rootParentBBox =
    vb && vb.width > 0
      ? { x: vb.x, y: vb.y, w: vb.width, h: vb.height }
      : null;

  // PRE-PASS — extract signals for EVERY child BEFORE we mutate the tree.
  // getBBox() returns {0,0,0,0} on elements that have been removed from the
  // DOM, so if we extracted signals inside the mutation loop, topology
  // checks for child N (containedInZIndex, enclosesSiblingCount) would see
  // already-removed siblings 0..N-1 as zero-sized and miss real containment.
  // That misclassifies every dark-band child as `paper` (the bug behind the
  // "no hachure, just outlines" output 2026-06-03).
  const signalsByIndex = originalChildren.map((child, i) =>
    extractSignals(child, {
      parentBBox: rootParentBBox,
      siblings: originalChildren,
      zIndex: i,
    }),
  );

  // Slim subset of modifiers passed to selectTreatment (techniqueMap signature).
  const treatmentMods = {
    hachureGap: fullModifiers.hachureGap,
    fillDensity: fullModifiers.fillDensity,
    strokeWidth: fullModifiers.strokeWidth,
    hachureAngle: fullModifiers.hachureAngle,
    inkIntensity: fullModifiers.inkIntensity,
    fillOpacity: fullModifiers.fillOpacity,
  };

  // Override-suppressed modifier set for outline jitter — fillStyle='none'
  // turns off legacy hachure render so we don't double-fill.
  const outlineModifiers: F3ModifiersState = {
    ...fullModifiers,
    fillStyle: 'none',
  };

  // SVG-level bbox metric — feeds multi-stroke layer count + wobble clamps.
  //
  // Was min(w,h) originally — caused tall-thin SVGs (criterionSpine +
  // mondoPrintTube, both ~30×90) to hit ceilings at multiStroke=3 and
  // wobble=0.5 even though the long dim has plenty of room. Surfaced via
  // /audit run 2026-06-08 as Bug F.
  //
  // Fix: geometric mean of w + h. For 30×90 → sqrt(2700) ≈ 52, giving
  // layer cap of 5 (vs prior 3) and wobble cap of ~0.87 (vs prior 0.5).
  // Square shapes (most items, w≈h) unchanged. Tall-thin shapes get the
  // benefit of their long dim without losing the small-shape protection.
  //
  // We do NOT pass an SVG-level pivot — each group inside the SVG should
  // rotate/scale around its OWN center. SVG-wide pivot caused cross-hatch
  // chaos (top book rotating opposite of bottom book around a shared far
  // pivot). Each group's case 'g' handler computes its own pivot.
  const svgBBoxMin = rootParentBBox
    ? Math.sqrt(rootParentBBox.w * rootParentBBox.h)
    : undefined;

  let zIdx = 0;
  for (const child of originalChildren) {
    const regionPath = `${child.tagName.toLowerCase()}[${zIdx}]`;
    const signals = signalsByIndex[zIdx];
    zIdx++;

    // Edge-case policy (18-scope-audit): elements carrying mask/filter are
    // PASS-THROUGH — unsafe to compose with hachure marks (mask inverts
    // intent via luminance-as-opacity; filters like feDisplacement break
    // mark geometry). Leave the original element untouched.
    if (child.getAttribute('mask') !== null || child.getAttribute('filter') !== null) {
      continue;
    }

    // 2. classify
    const ctx = {
      svgHash,
      regionPath,
      parentClassification: null,
      confidenceThreshold: threshold,
    };
    const classification = classify(signals, ctx, providers, overrideStore);

    // 3. select treatment
    const baseTreatment = selectTreatment(classification, opts.styleChoice, treatmentMods);
    // NARROW fillStyle override — user's slider swaps which mark grammar
    // shows up on regions the CLASSIFIER chose to fill. Classifier still
    // owns the "fillable or not" call (paper / structural-frame /
    // decorative-accent / line-decoration / label-text ALL stay 'none').
    // Don't lift gap / weight / layerCount / opacity here — classifier's
    // tonal-density per-role choice stays intact. Don't recurse <g> here
    // either. Per memory: `feedback_fillstyle_slider_must_switch_classifier_pick`.
    // Phase B: styles whose chrome has no fillStyle control own their own
    // grammar — the stored modifier there is stale default state, not a
    // user pick (STYLE_OWNS_FILL_GRAMMAR, techniqueMap).
    const userPick = STYLE_OWNS_FILL_GRAMMAR.has(opts.styleChoice)
      ? baseTreatment.fillStyle
      : fullModifiers.fillStyle;
    const classifierWantsFill = baseTreatment.fillStyle !== 'none';
    // Tiny shapes (area < 40 px²) are clamped to solid by techniqueMap
    // (edge-case policy: coverage stats too noisy for marks) — that clamp is
    // a perceptual constraint, NOT a grammar choice, so the user pick does
    // not override it.
    const tinyClamp = signals.area > 0 && signals.area < 40;
    // DARK-BLOB RE-FIX (2026-06-13): a `solid` fill flooded onto a large
    // structure-bearing dark TONAL BODY (one that carries knockout text/panels
    // painted on top — the classifier routes these to dense-tonal) destroys
    // that knockout structure → the solid-black BLOB. The bold-ink preset (and
    // a manual `solid` pick) would otherwise re-flood it here, AFTER
    // techniqueMap already chose a legible cross-hatch. So `solid` is refused
    // for structure-bearing dark bodies — they keep the classifier's own dense
    // hatch grammar (knockout structure stays readable). This is the SAME
    // class of perceptual-constraint exception as tinyClamp (NOT a grammar
    // denial): solid still applies to tiny details, line-decorations, and every
    // non-structure-bearing region; it's only refused where it would erase
    // structure. Per feedback_fillstyle_slider_must_switch_classifier_pick the
    // override stays narrow — we don't touch gap/weight/opacity/layers, we only
    // decline the ONE structure-erasing grammar on the ONE role that needs it.
    const structureBearingDarkBody = classification.role === 'dense-tonal';
    const solidWouldEraseStructure =
      userPick === 'solid' && structureBearingDarkBody;
    const treatment = {
      ...baseTreatment,
      fillStyle: userPick === 'none' || !classifierWantsFill
        ? ('none' as const)
        : tinyClamp || solidWouldEraseStructure
          ? baseTreatment.fillStyle
          : userPick,
    };

    opts.onClassification?.(regionPath, classification, treatment);

    // QW-1: append the decision trace (write-only side channel; the render
    // pipeline never reads the log).
    pushDecisionLogEntry({
      svgHash,
      regionPath,
      role: classification.role,
      confidence: classification.confidence,
      rawScore: classification.rawScore,
      margin: classification.margin,
      firedRules: classification.firedRules,
      classifiedBy: classification.classifiedBy,
      darknessL: signals.darknessL,
      area: signals.area,
      fillStyle: treatment.fillStyle,
      surface,
    });

    // 4. generate jittered outline via legacy transformElement (with hachure off)
    //    DEFENSIVE: legacy renderHandFeelShape can emit a base-fill <path> that
    //    paints the source fill color (e.g. solid STROKE black). This happens
    //    when the source element OR any nested child has fill ≠ none — and we
    //    can't fix it via attribute clearing because <g> groups recursively
    //    process children whose fills we don't see at the top level.
    //    Filter the outline output to strip ANY element with a real fill;
    //    keep only stroke paths (fill=none/null/transparent).
    const seed = hashStringToSeed(regionPath);
    const rawOutlineElements = transformElement(child, rc, outlineModifiers, seed, ownerDoc, undefined, svgBBoxMin);
    // PAPER-KNOCKOUT PRESERVATION (2026-06-13, RC: "white area gets shaded").
    // A non-tonal LIGHT region (role 'paper' = white reservation, or
    // 'structural-frame' = bordered wash) renders NO smart marks (fillStyle
    // 'none'). Its source carries a PAPER/bg fill (e.g. a poster's inner white
    // rectangle, fill=var(--dir-bg)). The generic fill-strip below would drop
    // that fill -> the region goes transparent -> the hachure of the dense-tonal
    // body BENEATH it (lower z) shows THROUGH -> the white area reads shaded
    // (root-caused via poster-diag: framedMoviePoster rect[1] role=paper sits
    // over rect[0] role=dense-tonal). The fix: these regions KEEP their source
    // fill so they render as a white KNOCKOUT on top of the body's marks (paper
    // is processed after the body in z-order, so it lands above). Paper fills are
    // sacred — never stripped (feedback_palette_overrides_ink_not_paper).
    const keepsSourceFill =
      classification.role === 'paper' || classification.role === 'structural-frame';
    const outlineElements = rawOutlineElements.filter((el) => {
      const f = el.getAttribute('fill');
      // Keep stroke-only elements (no fill, fill=none, fill=transparent).
      // Drop anything with a real fill color — those are base fills we don't
      // want when Smart Hachure is providing the fill.
      if (f === null || f === 'none' || f === 'transparent') return true;
      // Special case: text passes through with its source fill (we never
      // hachure text per Agent 1; let it render).
      if (el.tagName.toLowerCase() === 'text') return true;
      // Pen-tip ink (penTip ≠ plain) is a filled polygon by construction —
      // it IS the outline, not a base fill. Dropping it blanked every stroke
      // on any pen-tip change (2026-06-11). transformElement tags it.
      if (el.getAttribute('data-pen-tip-ink') === '1') return true;
      // U5: url() pattern/gradient fills aren't hachurable — keep the source so
      // the pattern/gradient renders (beneath the hand-feel outline) instead of
      // blanking out (resolveUrlFillDarkness maps them to paper → no marks).
      if (/^\s*url\(/i.test(f)) return true;
      // Paper / structural-frame knockouts keep their source fill (see above).
      if (keepsSourceFill) return true;
      return false;
    });

    // 5. generate Smart Hachure fill marks (if any)
    const fillMarks =
      treatment.fillStyle === 'none'
        ? []
        : renderRegion(child, treatment, {
            ownerDoc,
            rc,
            baseSeed: seed + 7919, // separate seed so fill seed doesn't collide with outline
            inkColor: opts.inkColor,
            // Phase A recalibration: the region's source darkness drives the
            // coverage solve (darknessToCoverage + 8-band quantization).
            sourceDarkness: signals.darknessL,
            gapBias,
          });

    // DIAGNOSTIC — stamp role + confidence provenance on the produced
    // elements so classification is inspectable from DevTools alone.
    // (Density receipts — data-smart-gap/weight/layers/band/coverage — are
    // stamped inside renderRegion, where the rendered numbers are resolved.)
    for (const fillEl of fillMarks) {
      fillEl.setAttribute('data-smart-role', classification.role);
      fillEl.setAttribute('data-smart-confidence', classification.confidence.toFixed(2));
      fillEl.setAttribute('data-smart-fill-style', treatment.fillStyle);
    }
    for (const outlineEl of outlineElements) {
      outlineEl.setAttribute('data-smart-source-role', classification.role);
      outlineEl.setAttribute('data-smart-source-darkness', signals.darknessL.toFixed(2));
    }

    // Edge-case policy: marks render clipped to the source's clip-path
    // (copy the attr so generated marks clip identically; clipPath defs
    // survive in <defs> which the walk never touches).
    const clipAttr = child.getAttribute('clip-path');
    if (clipAttr !== null) {
      for (const el of [...fillMarks, ...outlineElements]) {
        el.setAttribute('clip-path', clipAttr);
      }
    }

    // 6. replace original with [fills] + [outline]
    //    paint order: fills first, outline on top (outline = boundary contour)
    const parent = child.parentNode;
    if (!parent) continue;
    for (const fillEl of fillMarks) {
      parent.insertBefore(fillEl, child);
    }
    for (const outlineEl of outlineElements) {
      parent.insertBefore(outlineEl, child);
    }
    parent.removeChild(child);
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────

function hashStringToSeed(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) hash = (hash * 33) ^ s.charCodeAt(i);
  return hash >>> 0;
}

// ─── RE-EXPORTS ───────────────────────────────────────────────────────────

export { createOverrideStore, hashSvg } from './overrideStore';
export { ruleEngineProvider, classify } from './classifier';
export { selectTreatment, getBaseTreatmentForRole, STYLE_OWNS_FILL_GRAMMAR } from './techniqueMap';
export { extractAllSignals, extractSignals, getRenderableChildren } from './signals';
export type {
  Classification,
  ClassifierProvider,
  Override,
  OverrideStoreApi,
  Signals,
  TonalRole,
  Treatment,
} from './types';
export type { SmartHachureStyle, ModifierSubset } from './techniqueMap';
