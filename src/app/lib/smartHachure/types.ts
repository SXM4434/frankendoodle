// Smart Hachure System — shared type definitions.
//
// Architecture: signals → classify → select treatment → render
// See `docs/labs/hero/cells/F3-smart-hachure-system/06-architecture-technical-core.md`
// for the full module map + rationale.

// ─── ROLES — 7-tier tonal taxonomy (Agent 3 catalog) ──────────────────────

/**
 * Per-region semantic role assigned by the classifier.
 *
 * The current `fillDarknessFactor`-based code can't distinguish a 1.0 STROKE
 * outer-frame from a 1.0 STROKE inner-band — both look identical to a
 * darkness-only classifier. These 9 roles separate structural intent from
 * tonal intent so each region gets the treatment its role demands.
 */
export type TonalRole =
  | 'paper'              // skip hachure — paper-white reservation
  | 'sparse-tonal'       // light-grey register — sparse marks, gap-dominant
  | 'mid-tonal'          // mid-grey register — parallel hatch tightening
  | 'dense-tonal'        // dark-grey register — cross-hatch, multi-layer
  | 'solid-content'      // near-black register — fine cross-hatch / solid fill
  | 'structural-frame'   // clean outline, no fill technique regardless of darkness
  | 'decorative-accent'  // preserve as-is, scale roughness down
  | 'line-decoration'    // outline-only, no fill family
  | 'label-text';        // pass-through, never hachure

// ─── SIGNALS — what the extractor pulls per element ───────────────────────

/**
 * Structural + stylistic signals extracted from one SVG element.
 * Pure data, no DOM references — so signals can be serialized + cached.
 *
 * Categories per Agent 3:
 *   - Geometric (bbox, area, aspect)
 *   - Topological (z-index, containment, sibling relationships)
 *   - Stylistic (fill/stroke attributes, dasharray, tag)
 */
export type Signals = {
  // Geometric
  bbox: { x: number; y: number; w: number; h: number };
  area: number;
  aspectRatio: number;
  perimeter: number;

  // Topological
  zIndex: number;                              // position in parent.children (paint order)
  parentBBox: { x: number; y: number; w: number; h: number } | null;
  areaFractionOfParent: number;                // area / parentBBox.area, 0 if no parent
  enclosesSiblingCount: number;                // how many siblings fully fit inside this bbox
  containedInZIndex: number | null;            // z-index of containing sibling, null if top-level
  isPartOfStripeCluster: boolean;              // 3+ siblings of equal width + constant stride

  // Stylistic
  fill: string | null;                         // raw fill attribute (null if 'none' / absent)
  stroke: string | null;
  strokeWidthBin: 'hairline' | 'thin' | 'medium' | 'heavy' | 'none';
  hasDasharray: boolean;
  tag: 'rect' | 'circle' | 'ellipse' | 'path' | 'polygon' | 'polyline' | 'line' | 'text' | 'g' | 'other';
  opacity: number;
  fillOpacity: number;

  // Derived perceptual signal (post-OKLab conversion)
  darknessL: number;                           // 1 - OKLab L of fill, 0..1; 0 = paper, 1 = ink
};

// ─── CLASSIFICATION — output of the classifier per region ─────────────────

/**
 * Per-region classification: the role decision + provenance for debugging.
 *
 * Why provenance matters: per the user's wedge (trust + reversibility +
 * authorship), every classification must be inspectable. Without `firedRules`
 * and `signalsSnapshot`, a wrong classification has no audit trail.
 */
export type Classification = {
  role: TonalRole;
  confidence: number;                          // [0, 1] — how sure the classifier is
  rawScore: number;                            // uncapped winning role sum (QW-2 trace; manual=1, fallback=0)
  margin: number;                              // best − second-best raw sums (QW-2 trace; manual=1, fallback=0)
  firedRules: string[];                        // rule IDs that contributed (for inspection)
  classifiedBy: 'rules' | 'cached-llm' | 'decision-tree' | 'manual-override';
  signalsSnapshot: Signals;                    // frozen at classification time, for cache + training data
};

// ─── TREATMENT — what the renderer should DO per region ───────────────────

/**
 * Multi-axis treatment instructions per Agent 1 canon.
 *
 * 5 axes combinable: gap · weight · layers · pressure · opacity.
 * `biasMode` per Option E hybrid bias picking (fillStyle + darkness + size).
 */
export type Treatment = {
  fillStyle:
    | 'hachure'
    | 'cross-hatch'
    | 'dots'
    | 'zigzag'
    | 'dashed'
    | 'zigzag-line'
    | 'solid'
    | 'none';
  gap: number;                                 // px — primary density axis
  weight: number;                              // px — secondary density axis
  angle: number;                               // degrees — hachure scan-line angle (user's hachureAngle modifier; default -41)
  layerCount: number;                          // 1–4 — number of overlapping passes
  pressureEnvelope: number[] | null;           // per-vertex pressure for perfect-freehand, null = uniform
  opacity: number;                             // [0, 1] — ink opacity
  biasMode: 'gap-dominant' | 'layers-dominant' | 'weight-dominant' | 'hybrid';
  // Optional perceptual target. If set, the calibration loop (v2)
  // adjusts the treatment to hit this OKLab L value.
  targetL?: number;
};

// ─── OVERRIDE STORE — manual tags persist across sessions ─────────────────

/**
 * Manual tag stored in the override store. Manual always wins over classifier.
 *
 * Storage: localStorage in browser + manual JSON export to repo for git
 * versioning (decision lock 2026-06-03).
 *
 * `signalsSnapshot` captures the signals AT THE TIME OF TAGGING so future
 * decision-tree training has labeled data in the right shape.
 */
export type Override = {
  role: TonalRole;
  setAt: string;                               // ISO 8601 timestamp
  setBy: 'manual' | 'rule-promotion';
  signalsSnapshot: Signals;
  note?: string;                               // optional user comment
};

// ─── CONTEXT — ambient data passed through the pipeline ───────────────────

export type ClassificationContext = {
  /** Unique hash of the source SVG (used as override-store key). */
  svgHash: string;
  /** DOM-path identifier within the SVG (e.g. "rect[0]/g[1]/path[2]"). */
  regionPath: string;
  /** Classification of the containing element, if any. */
  parentClassification: Classification | null;
  /** Below this, classifier falls back to next provider in the chain. */
  confidenceThreshold: number;
};

// ─── PROVIDER CHAIN — pluggable classification (Agent 4 hybrid pattern) ───

/**
 * Each provider returns a classification or null (= "no opinion, delegate").
 *
 * v1 ships ONE provider: rule engine.
 * v2 inserts cached LLM (build-time pre-pass) after rules.
 * v3 inserts decision tree (ml-cart) after LLM.
 *
 * Override store sits OUTSIDE the chain — overrides always win regardless.
 */
export interface ClassifierProvider {
  readonly name: string;
  classify(signals: Signals, ctx: ClassificationContext): Classification | null;
}

// ─── INTERFACE STUBS — future-ready, no-op in v1 ──────────────────────────
//
// These exist so Concepts A/B from `08-vision-roadmap.md` plug in without
// refactor. v1 ships with no-op implementations.

/**
 * Catalog of objects to render. v1 = hardcoded F3 trophy wall pins.
 * Future: visitor uploads, drawings, randomized subsets per page load.
 */
export interface ObjectCollection {
  getObjects(): ReadonlyArray<{ id: string; svgSource: string; subjectId: string }>;
}

/**
 * Per-subject form variants (race-medal + Strava badge + race bib for "running").
 * v1 = existing F3 form-toggle. Future: hero randomization picks form per load.
 */
export interface SubjectFormVariants {
  getForms(subjectId: string): ReadonlyArray<{ formId: string; svgSource: string }>;
  pickActiveForm(subjectId: string, strategy: 'random' | 'first' | 'cycle'): string;
}

/**
 * Per-visitor session state. v1 = single hardcoded session.
 * Future: per-visitor isolated state for visitor canvas (Concept B).
 */
export interface VisitorSession {
  sessionId: string;
  getOverrideStore(): OverrideStoreApi;
  getTreatmentPreferences(): Record<string, Treatment>;
}

/**
 * SVG interaction tier — parallel to 3D rotation tiers.
 * v1 = static only. Future: hover → toggle → fully-interactive.
 */
export type InteractionTier = 'static' | 'hover-reactive' | 'toggle-able' | 'fully-interactive';

/**
 * SVG ↔ 3D representation bridge. v1 = stub (no swap).
 * Future: lighter hero swap + full visitor-canvas swap.
 */
export interface SvgToThreeDBridge {
  hasThreeDVersion(objectId: string): boolean;
  swapTo(objectId: string, target: 'svg' | '3d'): Promise<void>;
}

/**
 * Sync mode — broadcast a treatment choice to all objects.
 * v1 = no-op. Future: visitor canvas edit-mode "apply to all" action.
 */
export interface BroadcastTreatment {
  broadcastToAll(treatment: Treatment): void;
}

/**
 * Disable other interactions when 3D rotation is active.
 * v1 = no-op. Future: rotation tier conflict guard.
 */
export interface RotationConflictGuard {
  isRotationActive(): boolean;
  registerInteraction(name: string, disableWhenRotating: boolean): void;
}

// ─── OVERRIDE STORE API (minimal) ─────────────────────────────────────────

export interface OverrideStoreApi {
  get(svgHash: string, regionPath: string): Override | null;
  set(svgHash: string, regionPath: string, override: Omit<Override, 'setAt' | 'setBy'>): void;
  clear(svgHash: string, regionPath: string): void;
  exportToJson(): string;
  importFromJson(json: string): void;
}
