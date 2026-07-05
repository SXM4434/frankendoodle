// Smart System Phase A — COVERAGE MATH (one math, two renderers).
//
// Pure module: no DOM, no rough.js, no deps. This is the single source of
// truth for "how much ink covers a region" — the SVG renderer
// (`smartHachure/renderRegion.ts`) calls it today, and the M8 screen-space
// hatch shader reads the same 8-band table as uniforms (`bandTableForUniforms`).
//
// Sources (the contract for every equation below):
//   - docs/research/21-research-3d-pipeline-and-style-translation.md §4
//     (Murray-Davies inverse · per-fillStyle inverse equations · 8-band L*)
//   - docs/design/smart-system-build-plan.md Phase A row (06-14)
//   - docs/locked-refs/F3-siblings/F3-shading-calibration-spec.md §4
//     (one primary density knob per technique; secondary knobs dampened)
//
// Phase A scope note: this module is the MATH only. Wiring source darkness →
// coverage → params into the live render is the RECALIBRATION step that Sebs
// eyeballs separately; today `renderRegion.ts` routes its existing calibrated
// treatment values through this math behavior-preservingly (forward → inverse
// round-trip, exact by construction).

// ─── FILL STYLES COVERED BY THE MATH ──────────────────────────────────────

/** Mark grammars whose ink coverage is parameterized by (gap, weight, layers).
 *  'solid' and 'none' are excluded by definition (coverage ≡ 1 / ≡ 0). */
export type CoverageFillStyle =
  | 'hachure'
  | 'cross-hatch'
  | 'dots'
  | 'zigzag'
  | 'dashed'
  | 'zigzag-line';

const COVERAGE_FILL_STYLES: readonly CoverageFillStyle[] = [
  'hachure',
  'cross-hatch',
  'dots',
  'zigzag',
  'dashed',
  'zigzag-line',
];

export function isCoverageFillStyle(s: string): s is CoverageFillStyle {
  return (COVERAGE_FILL_STYLES as readonly string[]).includes(s);
}

// ─── TYPES ────────────────────────────────────────────────────────────────

/** User-slider / calibration bias for the inverse solve (21-research §4
 *  function shape). Exactly ONE of gap/weight acts as the anchored secondary
 *  axis; the solver derives the other from the target coverage. */
export type CoverageBias = {
  /** Anchor the line/dot weight (px) and solve for gap. The default mode. */
  weight?: number;
  /** Anchor the gap (px) and solve for weight instead. Used when the user's
   *  primary knob is spacing and tone must come from line weight. */
  gap?: number;
  /** User fillDensity-style multiplier applied to the anchored weight. */
  density?: number;
  /** Explicit layer count override. When absent, layers come from the
   *  8-band table (the TAM nesting column). */
  layers?: number;
};

/** Density parameters for one region render. `band` is the 8-band index the
 *  target coverage falls in (0 = paper … 7 = black) — the same index the 3D
 *  hatch shader uses to pick a TAM cell. */
export type CoverageParams = {
  gap: number; // px — primary density axis (inter-line / inter-dot spacing)
  weight: number; // px — secondary density axis (line weight / dot diameter)
  layers: number; // overlapping passes (cross-hatch's 2nd direction NOT counted — rough.js internal)
  band: number; // 0..7 — 8-band L* quantization index
};

// ─── MURRAY-DAVIES: SOURCE DARKNESS → TARGET COVERAGE ─────────────────────
//
// 21-research §4 "Source darkness → coverage":
//   coverage = (R_paper − R_target) / (R_paper − R_ink)
// with screen-rendering constants R_paper ≈ 1.0, R_ink ≈ 0.05, and the
// CIELAB cube-root inverse R_target = L³ (L = lightness 0..1).
// Yule-Nielsen n-correction is print-only — skipped per the doc.

export const R_PAPER = 1.0;
export const R_INK = 0.05;

/**
 * Murray-Davies inverse: perceptual darkness (the classifier's `darknessL`
 * signal, 0 = paper · 1 = ink) → fractional ink coverage [0, 1].
 * Monotonic increasing; 0 → 0; 1 → 1 (clamped — raw MD gives 1/0.95).
 */
export function darknessToCoverage(darkness: number): number {
  const d = clamp01(darkness);
  const lightness = 1 - d; // darknessL = 1 − L per signals.ts
  const rTarget = lightness * lightness * lightness; // CIELAB cube-root inverse
  return clamp01((R_PAPER - rTarget) / (R_PAPER - R_INK));
}

// ─── 8-BAND L* QUANTIZATION TABLE ─────────────────────────────────────────
//
// 21-research §4 table (Mahy 1994 JND → 6-10 robust levels; Praun's 6-column
// TAM + headroom = 8 bands). Ranges are SOURCE DARKNESS (1 − L*, 0..1 — the
// doc's "Source L* range" column reads as darkness: paper = 0.00).
// `tamLayers` = the TAM nesting depth per 09-LOCKED-MODEL §I-2;
// `tamCell` = horizontal cell index in the packed 8-cell TAM texture
// (21-research §10 shader: `int band = int(floor((1.0 − luma) * 8.0))`).

export type CoverageBand = {
  name: string;
  darknessMin: number; // inclusive
  darknessMax: number; // exclusive (last band inclusive)
  tamLayers: number; // 0..4 — hatch layer nesting depth
  tamCell: number; // 0..7 — TAM texture cell index
};

export const COVERAGE_BANDS: readonly CoverageBand[] = [
  { name: 'paper', darknessMin: 0.0, darknessMax: 0.1, tamLayers: 0, tamCell: 0 },
  { name: 'light', darknessMin: 0.1, darknessMax: 0.3, tamLayers: 1, tamCell: 1 },
  { name: 'mid-light', darknessMin: 0.3, darknessMax: 0.45, tamLayers: 1, tamCell: 2 },
  { name: 'mid', darknessMin: 0.45, darknessMax: 0.55, tamLayers: 2, tamCell: 3 },
  { name: 'mid-dark', darknessMin: 0.55, darknessMax: 0.65, tamLayers: 2, tamCell: 4 },
  { name: 'dark', darknessMin: 0.65, darknessMax: 0.8, tamLayers: 3, tamCell: 5 },
  { name: 'near-black', darknessMin: 0.8, darknessMax: 0.92, tamLayers: 4, tamCell: 6 },
  { name: 'black', darknessMin: 0.92, darknessMax: 1.0, tamLayers: 4, tamCell: 7 },
];

/** Band index (0..7) for a source darkness value. */
export function bandIndexForDarkness(darkness: number): number {
  const d = clamp01(darkness);
  for (let i = COVERAGE_BANDS.length - 1; i >= 0; i--) {
    if (d >= COVERAGE_BANDS[i].darknessMin) return i;
  }
  return 0;
}

// Coverage-space band edges, derived ONCE from the darkness edges through the
// same Murray-Davies inverse — so quantizing by coverage and quantizing by
// darkness agree (one math, never two).
//
// SATURATION NOTE (property of the documented math, not a bug): Murray-Davies
// pins coverage to 1.0 once R_target ≤ R_INK — i.e. darkness ≳ 0.63 at
// R_INK = 0.05 (a fully-inked region can't get darker than the ink itself).
// The top three darkness bands therefore share coverage ≈ 1.0, and
// coverage-space lookup saturates to the 'black' band there. When the caller
// KNOWS source darkness, `bandIndexForDarkness` is authoritative (the M8
// shader quantizes by luma — darkness space). Coverage-space lookup serves
// callers that only hold a coverage target; in the Phase A render path the
// returned `band` is metadata and layers are bias-anchored, so saturation
// has zero behavioral effect.
const COVERAGE_BAND_EDGES: readonly number[] = COVERAGE_BANDS.map((b) =>
  darknessToCoverage(b.darknessMin),
);

/** Band index (0..7) for a target coverage value (saturating — see note). */
export function bandIndexForCoverage(coverage: number): number {
  const a = clamp01(coverage);
  for (let i = COVERAGE_BAND_EDGES.length - 1; i >= 0; i--) {
    if (a >= COVERAGE_BAND_EDGES[i]) return i;
  }
  return 0;
}

/**
 * The 8-band table flattened for shader uniforms (M8 screen-space hatch —
 * 21-research §10): stride 3 per band → [darknessMin, darknessMax, tamLayers].
 * Upload as a `uniform vec3 u_bands[8]` (or flat float array); the fragment
 * shader picks `band = floor((1.0 − luma) * 8.0)` and reads nesting depth
 * from the same numbers the SVG renderer quantizes with.
 */
export function bandTableForUniforms(): Float32Array {
  const flat = new Float32Array(COVERAGE_BANDS.length * 3);
  COVERAGE_BANDS.forEach((b, i) => {
    flat[i * 3] = b.darknessMin;
    flat[i * 3 + 1] = b.darknessMax;
    flat[i * 3 + 2] = b.tamLayers;
  });
  return flat;
}

// ─── PER-FILLSTYLE COVERAGE MODELS (forward + inverse) ────────────────────
//
// 21-research §4 "Per-fillStyle inverse equations". Each grammar has a
// closed-form single-layer coverage model a₁(gap, weight); multi-layer
// stacking composes as independent overlap: a_total = 1 − (1 − a₁)^layers.
//
//   hachure      a₁ = w / g                       (Murray-Davies; rough.js scanline)
//   cross-hatch  a₁ = 1 − (1 − w/g)²              (two internal directions stacked)
//   dots         a₁ = π·(w/2)² / g²               (N·π·r²/Area with one dot per g² cell;
//                                                  rough.js dot diameter = fillWeight)
//   zigzag       a₁ = K_ZIGZAG · w / g            (path-length-per-area: zig at ~45°
//                                                  travels √2× a straight scan line)
//   dashed       a₁ = K_DASHED · w / g            (hachure × duty cycle; rough.js
//                                                  default dash length == dash gap → 0.5)
//   zigzag-line  a₁ = K_ZIGZAG · w / g            (scan lines drawn as small zigzags —
//                                                  same √2 path-length multiplier)
//
// K_* are calibration constants (Phase A defaults — the behavior-preserving
// renderRegion round-trip is exact for ANY K, so recalibration can tune them
// later without touching the renderer).

export const K_ZIGZAG = Math.SQRT2;
export const K_DASHED = 0.5;

/** Linear-family coefficient for a₁ = K · w / g styles (null = non-linear). */
function linearK(fillStyle: CoverageFillStyle): number | null {
  switch (fillStyle) {
    case 'hachure':
      return 1;
    case 'zigzag':
    case 'zigzag-line':
      return K_ZIGZAG;
    case 'dashed':
      return K_DASHED;
    default:
      return null; // cross-hatch + dots have their own closed forms
  }
}

/** Single-layer forward model: (gap, weight) → coverage a₁ ∈ [0, 1]. */
function singleLayerCoverage(gap: number, weight: number, fillStyle: CoverageFillStyle): number {
  if (!(gap > 0) || !(weight > 0)) return 0;
  const k = linearK(fillStyle);
  if (k !== null) return clamp01((k * weight) / gap);
  if (fillStyle === 'cross-hatch') {
    const single = clamp01(weight / gap);
    return clamp01(1 - (1 - single) * (1 - single));
  }
  // dots: one dot of diameter `weight` per gap² cell
  const r = weight / 2;
  return clamp01((Math.PI * r * r) / (gap * gap));
}

/** Single-layer inverse: coverage a₁ → gap, anchored on `weight`.
 *  Exact algebraic inverse of `singleLayerCoverage` (load-bearing for the
 *  behavior-preserving renderRegion round-trip). */
function gapForSingleLayerCoverage(
  a1: number,
  weight: number,
  fillStyle: CoverageFillStyle,
): number {
  const k = linearK(fillStyle);
  if (k !== null) return (k * weight) / a1;
  if (fillStyle === 'cross-hatch') {
    // a₁ = 1 − (1 − w/g)²  →  w/g = 1 − √(1 − a₁)
    return weight / (1 - Math.sqrt(1 - a1));
  }
  // dots: a₁ = π·(w/2)²/g²  →  g = (w/2)·√(π/a₁)
  return (weight / 2) * Math.sqrt(Math.PI / a1);
}

/** Single-layer inverse solving the OTHER axis: coverage a₁ → weight,
 *  anchored on `gap`. */
function weightForSingleLayerCoverage(
  a1: number,
  gap: number,
  fillStyle: CoverageFillStyle,
): number {
  const k = linearK(fillStyle);
  if (k !== null) return (a1 * gap) / k;
  if (fillStyle === 'cross-hatch') return gap * (1 - Math.sqrt(1 - a1));
  // dots: w = 2g·√(a₁/π)
  return 2 * gap * Math.sqrt(a1 / Math.PI);
}

// ─── PUBLIC FORWARD MODEL ─────────────────────────────────────────────────

/**
 * Forward model: density params → total fractional ink coverage [0, 1].
 * Multi-layer passes stack as independent overlap (1 − (1−a₁)^L).
 * This is what makes `coverageToParams` verifiable: round-tripping any valid
 * params through forward → inverse reproduces them exactly.
 */
export function paramsToCoverage(
  params: { gap: number; weight: number; layers: number },
  fillStyle: CoverageFillStyle,
): number {
  const layers = Math.max(1, Math.floor(params.layers));
  const a1 = singleLayerCoverage(params.gap, params.weight, fillStyle);
  if (layers === 1) return a1; // exact path — no pow() float noise at L=1
  return clamp01(1 - Math.pow(1 - a1, layers));
}

// ─── PUBLIC INVERSE — THE PHASE A FUNCTION ────────────────────────────────

// Solve floor. A target coverage of EXACTLY zero is the paper register (no
// marks); any nonzero target — however small — solves at or above this floor
// so marks get sparse, never silently vanish (verifier-flagged latent: dots
// treatments whose forward coverage dipped under the old "< MIN → zero
// params" early-return rendered fillWeight 0 → invisible dots. Mark grammars
// degrade to sparse, they don't disappear — D-3's never-skip law applied to
// density math).
const MIN_COVERAGE = 1e-4;
// Above this, the inverse would push gap → weight (lines merging to solid);
// clamp so outputs stay bounded. The perceptual "lines never merge" cap
// (weight ≤ 0.7 × gap, Agent 5) stays in techniqueMap/renderRegion — render
// policy, not math. 0.999 sits ABOVE the largest SINGLE-LAYER coverage any
// cap-respecting treatment can produce (zigzag at w = 0.7g → a₁ = √2 × 0.7
// ≈ 0.98995). The clamp is applied in PER-LAYER space (after de-stacking) —
// clamping the stacked total would distort the round-trip at layers ≥ 2
// (verifier-flagged latent: zigzag at the 0.7 cap × 2 layers stacks to
// ≈ 0.9999 total; the old total-space clamp pulled it to 0.999 and the
// de-stack then solved a ~2% wrong gap. Per-layer clamping keeps the
// round-trip exact for every cap-respecting treatment at ANY layer count).
const MAX_COVERAGE = 0.999;
// Anchor weight when the caller provides no bias (1 px nominal pen line).
const DEFAULT_WEIGHT_PX = 1;

/**
 * THE Phase A function (21-research §4 "Single function shape"):
 * target ink coverage + mark grammar (+ user bias) → density params.
 *
 *   - `targetCoverage` ∈ [0, 1] — from source darkness via `darknessToCoverage`,
 *     or from an existing calibrated treatment via `paramsToCoverage`.
 *   - Solves the grammar's inverse equation for gap (default) or weight
 *     (when `bias.gap` anchors spacing instead).
 *   - `layers` from `bias.layers` when given, else the 8-band table's TAM
 *     nesting column; the per-layer coverage is de-stacked before the solve
 *     (aL = 1 − (1−a)^(1/L)) so L overlapping passes reproduce the target.
 *
 * Guarantees (asserted in the Phase A verification harness):
 *   - gap is finite, positive, and strictly decreasing as coverage rises
 *     for any fixed anchor + fixed layer count (when layers come from the
 *     band table instead, a layer jump at a band edge legitimately re-widens
 *     gap — each pass gets sparser while TOTAL coverage stays on target);
 *   - weight likewise strictly increasing when gap-anchored;
 *   - exact round-trip: paramsToCoverage(coverageToParams(a, s, bias), s) ≡ a
 *     whenever the de-stacked per-layer coverage lands in
 *     [MIN_COVERAGE, MAX_COVERAGE] — at any layer count (per-layer clamp);
 *   - marks never vanish for a nonzero target: 0 < a < MIN_COVERAGE solves
 *     AT the floor (sparse marks) instead of returning the paper sentinel.
 */
export function coverageToParams(
  targetCoverage: number,
  fillStyle: CoverageFillStyle,
  bias?: CoverageBias,
): CoverageParams {
  const aRaw = clamp01(targetCoverage);
  const band = bandIndexForCoverage(aRaw);

  // Paper register — exactly zero coverage means no marks. (Nonzero-but-tiny
  // targets fall through and solve at the MIN_COVERAGE floor — see note.)
  if (aRaw <= 0) {
    return { gap: 0, weight: 0, layers: 0, band };
  }

  const a = Math.max(aRaw, MIN_COVERAGE);
  const layers = Math.max(1, Math.floor(bias?.layers ?? (COVERAGE_BANDS[band].tamLayers || 1)));
  // De-stack: per-layer coverage that compounds to the target across L passes.
  // MAX clamp happens HERE, in per-layer space — see the MAX_COVERAGE note.
  const aL = Math.min(layers === 1 ? a : 1 - Math.pow(1 - a, 1 / layers), MAX_COVERAGE);
  const density = bias?.density ?? 1;

  if (bias?.gap !== undefined && bias.weight === undefined) {
    // Gap-anchored mode: spacing is the user's primary knob → solve weight.
    const gap = bias.gap;
    const weight = weightForSingleLayerCoverage(aL, gap, fillStyle) * density;
    return { gap, weight, layers, band };
  }

  // Weight-anchored mode (default): solve gap.
  const weight = (bias?.weight ?? DEFAULT_WEIGHT_PX) * density;
  const gap = gapForSingleLayerCoverage(aL, weight, fillStyle);
  return { gap, weight, layers, band };
}

// ─── INTERNAL ─────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
