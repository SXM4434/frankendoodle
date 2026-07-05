// Hand-feel rendering primitives — locally implemented rough.js technique.
//
// Extracted from C3UserFlow.tsx for sharing across hand-feel artifacts. B1 Venn
// and D1 wavy-spectrum currently keep their own local implementations; future
// work can migrate them to use these helpers.
//
// Convention (per shihn.ca / rough.js author Pavithra Kodmad):
// 1. Approximate shapes with cubic Bezier segments (kappa = 0.5523 for circles).
// 2. Jitter every anchor + control point by a small deterministic offset.
// 3. Multi-stroke render: layer the same path with different seeds for the
//    "drawn twice with slight variation" feel.
//
// Determinism: every helper uses a seeded LCG (linear congruential generator)
// so the rendered output is stable across page loads — required for the
// screenshot pipeline.
//
// Calibration target (per `gate-a-ion-c3-userflow-register-research.md`):
// sit between B1/D1's calibration (~2.5) and Excalidraw's preset (~3-4),
// not at Excalidraw's preset. Recommended base values:
//   - rectangles: 2.4
//   - ovals: 2.4
//   - diamond: 2.0
//   - straight lines: 1.4
//   - orthogonal paths: 1.6
// The C3 chrome exposes a `wobble` multiplier that scales these bases at
// render time (default 1.0 = current calibration, 0 = clean, 2 = doubly
// wobbly). Excalidraw zone begins at multiplier > ~1.4.

export function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function jitter(rand: () => number, amp: number) {
  return (rand() - 0.5) * 2 * amp;
}

// Optional shape modifiers for Step 3 toggles.
export type ShapeModifiers = {
  /** Endpoint corner treatment. */
  endpointBehavior?: 'clean' | 'protrude' | 'long-overshoot' | 'kink';
  /** Layered stroke pacing — affects multi-stroke layered renders. */
  sketchingStyle?: 'single-pass' | 'loose-overlap' | 'parallel-pass' | 'cross-rotate';
  /** Layer index — used by loose-overlap / parallel-pass to spread layers. */
  layerIndex?: number;
};

const PROTRUDE_AMOUNT = 4;            // px — corner overshoot for 'protrude'
const LONG_OVERSHOOT_AMOUNT = 9;      // px — heavy overshoot for 'long-overshoot'
const KINK_AMOUNT = 5;                // px — kink offset (random angle) for 'kink'
const LOOSE_OVERLAP_AMOUNT = 3;       // px — endpoint nudge per layer (along segment)
const PARALLEL_OFFSET_AMOUNT = 6;     // px — perpendicular offset per layer
                                       //       (was 2.5 — too subtle to read)
const CROSS_HATCH_ANGLE_DEG = 6;      // ° — rotation per layer for 'cross-rotate'

/** Rotate a point around a center by `angleDeg` degrees. Used for cross-hatch
 *  layered renders so each successive layer is angled slightly differently
 *  around the shape's center, producing a literal crisscross outline. */
export function rotatePointsAround(
  points: Array<[number, number]>,
  cx: number,
  cy: number,
  angleDeg: number,
): Array<[number, number]> {
  if (angleDeg === 0) return points;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
}

/** Cross-hatch rotation amount for a given layer index. Layer 0 stays put;
 *  subsequent layers alternate ±CROSS_HATCH_ANGLE_DEG so the pattern is
 *  symmetric around the original orientation. */
export function crossHatchRotationFor(layerIndex: number): number {
  if (layerIndex === 0) return 0;
  // Layer 1 = +6, Layer 2 = -6, Layer 3 = +12, Layer 4 = -12 etc.
  const sign = layerIndex % 2 === 1 ? 1 : -1;
  const magnitude = Math.ceil(layerIndex / 2) * CROSS_HATCH_ANGLE_DEG;
  return sign * magnitude;
}

/** Scale a closed loop of points outward from a center. Used for parallel-pass
 *  on shapes — each subsequent layer renders at a slightly larger scale,
 *  producing concentric "ghost" outlines diverging from the base shape. */
export function scalePointsAround(
  points: Array<[number, number]>,
  cx: number,
  cy: number,
  scaleFactor: number,
): Array<[number, number]> {
  if (scaleFactor === 1) return points;
  return points.map(([x, y]) => [cx + (x - cx) * scaleFactor, cy + (y - cy) * scaleFactor]);
}

/** Parallel-pass scale factor for a given layer index (closed shapes).
 *  Layer 0 stays put; subsequent layers grow outward by 10% each.
 *
 *  CHANGED 2026-06-07: bumped from 0.06 → 0.10. Previous 6% step was
 *  getting swamped by wobble amplitude (3-6px on typical 60-100px pin
 *  shapes), making concentric ghost outlines read as jittery random
 *  overlap instead of deliberate concentric pattern. 10% step puts the
 *  scaling clearly above wobble amplitude so concentric reads cleanly.
 *  If this overshoots for large shapes, consider per-bbox normalization
 *  (e.g., scale step shrinks for shapes > 200px bbox). */
export function parallelPassScaleFor(layerIndex: number): number {
  return 1 + layerIndex * 0.10;
}

/** Parallel-pass translate offset for a given layer index (used for plain mode
 *  via SVG transform). Layers alternate between diagonal directions with growing
 *  magnitude — visible "drew the same shape twice with my hand off" effect. */
export function parallelPassTranslateFor(layerIndex: number): { dx: number; dy: number } {
  if (layerIndex === 0) return { dx: 0, dy: 0 };
  const magnitude = 5;        // px — visible displacement, not subtle
  // Layer 1: bottom-right, 2: top-left, 3: top-right, 4: bottom-left, etc.
  const patterns = [
    { dx: 0, dy: 0 },
    { dx: magnitude, dy: magnitude },
    { dx: -magnitude, dy: -magnitude },
    { dx: magnitude * 1.5, dy: -magnitude },
    { dx: -magnitude, dy: magnitude * 1.5 },
  ];
  return patterns[Math.min(layerIndex, patterns.length - 1)];
}

/** Offset a polyline perpendicular to its primary direction. Used for
 *  parallel-pass on lines — each subsequent layer offset perpendicular by
 *  layerIndex × PARALLEL_OFFSET_AMOUNT (alternating sides). */
export function offsetLinePerpendicular(
  points: Array<[number, number]>,
  layerIndex: number,
): Array<[number, number]> {
  if (points.length < 2 || layerIndex === 0) return points;
  // Compute primary direction from first to last point.
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular unit vector (rotated 90°).
  const px = -uy;
  const py = ux;
  // Alternating sides: layer 1 = +1, layer 2 = -1, layer 3 = +2, etc.
  const sign = layerIndex % 2 === 1 ? 1 : -1;
  const magnitude = Math.ceil(layerIndex / 2) * PARALLEL_OFFSET_AMOUNT;
  const offset = sign * magnitude;
  return points.map(([x, y]) => [x + px * offset, y + py * offset]);
}

/** Compute the protrude radius for a given endpoint mode. */
function protrudeFor(mode: ShapeModifiers['endpointBehavior']): number {
  if (mode === 'protrude') return PROTRUDE_AMOUNT;
  if (mode === 'long-overshoot') return LONG_OVERSHOOT_AMOUNT;
  if (mode === 'kink') return KINK_AMOUNT;
  return 0;
}

/** Whether the endpoint mode wants a randomized-angle kink instead of pure radial overshoot. */
function isKink(mode: ShapeModifiers['endpointBehavior']): boolean {
  return mode === 'kink';
}

// Rough rectangle: 4 sides as separate jittered cubic Bezier paths.
export function roughRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  rough: number,
  seed: number,
  mods: ShapeModifiers = {},
): string {
  const r = seededRandom(seed);
  const j = () => jitter(r, rough);
  const protrude = protrudeFor(mods.endpointBehavior);
  const corners = [
    [x + j() - protrude, y + j() - protrude],
    [x + w + j() + protrude, y + j() - protrude],
    [x + w + j() + protrude, y + h + j() + protrude],
    [x + j() - protrude, y + h + j() + protrude],
  ];
  const looseOffset =
    mods.sketchingStyle === 'loose-overlap' && mods.layerIndex
      ? mods.layerIndex * LOOSE_OVERLAP_AMOUNT
      : 0;
  const f = (n: number) => n.toFixed(2);
  const parts: string[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    // Apply loose-overlap: shift endpoints inward along the segment direction.
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const aShift = [a[0] - ux * looseOffset, a[1] - uy * looseOffset];
    const bShift = [b[0] + ux * looseOffset, b[1] + uy * looseOffset];
    const t1 = [aShift[0] + (bShift[0] - aShift[0]) / 3 + j() * 1.4, aShift[1] + (bShift[1] - aShift[1]) / 3 + j() * 1.4];
    const t2 = [aShift[0] + (bShift[0] - aShift[0]) * 2 / 3 + j() * 1.4, aShift[1] + (bShift[1] - aShift[1]) * 2 / 3 + j() * 1.4];
    parts.push(`M ${f(aShift[0])} ${f(aShift[1])}`);
    parts.push(`C ${f(t1[0])} ${f(t1[1])}, ${f(t2[0])} ${f(t2[1])}, ${f(bShift[0])} ${f(bShift[1])}`);
  }
  return parts.join(' ');
}

/** Rough circle: 4 cubic Bezier segments approximating a circle (kappa
 *  = 0.5523 per shihn.ca / rough.js author Pavithra Kodmad), every anchor +
 *  control point jittered. Used by B1 Venn (and any future circle-shape
 *  hand-feel artifact). */
export function roughCirclePath(
  cx: number,
  cy: number,
  r: number,
  roughness: number,
  seed: number,
): string {
  const rand = seededRandom(seed);
  const j = () => (rand() - 0.5) * 2 * roughness;
  const k = 0.5523 * r;
  const right = [cx + r + j(), cy + j()];
  const top = [cx + j(), cy - r + j()];
  const left = [cx - r + j(), cy + j()];
  const bottom = [cx + j(), cy + r + j()];
  const c1a = [cx + r + j(), cy - k + j()];
  const c1b = [cx + k + j(), cy - r + j()];
  const c2a = [cx - k + j(), cy - r + j()];
  const c2b = [cx - r + j(), cy - k + j()];
  const c3a = [cx - r + j(), cy + k + j()];
  const c3b = [cx - k + j(), cy + r + j()];
  const c4a = [cx + k + j(), cy + r + j()];
  const c4b = [cx + r + j(), cy + k + j()];
  const f = (n: number) => n.toFixed(2);
  return [
    `M ${f(right[0])} ${f(right[1])}`,
    `C ${f(c1a[0])} ${f(c1a[1])}, ${f(c1b[0])} ${f(c1b[1])}, ${f(top[0])} ${f(top[1])}`,
    `C ${f(c2a[0])} ${f(c2a[1])}, ${f(c2b[0])} ${f(c2b[1])}, ${f(left[0])} ${f(left[1])}`,
    `C ${f(c3a[0])} ${f(c3a[1])}, ${f(c3b[0])} ${f(c3b[1])}, ${f(bottom[0])} ${f(bottom[1])}`,
    `C ${f(c4a[0])} ${f(c4a[1])}, ${f(c4b[0])} ${f(c4b[1])}, ${f(right[0])} ${f(right[1])}`,
    'Z',
  ].join(' ');
}

// Rough oval: drawn as a capsule via cubic Bezier, sides jittered.
// Note: protrude/loose-overlap mods are accepted for API symmetry but the
// capsule-cap geometry doesn't have hard corners to overshoot — we apply a
// mild outward radius bump for protrude and accept that loose-overlap is a
// no-op here.
export function roughOvalPath(
  x: number,
  y: number,
  w: number,
  h: number,
  rough: number,
  seed: number,
  mods: ShapeModifiers = {},
): string {
  const r = seededRandom(seed);
  const j = () => jitter(r, rough);
  const f = (n: number) => n.toFixed(2);
  const protrude = protrudeFor(mods.endpointBehavior) * 0.5;
  // Apply protrude as a mild radius bump (push the cap outward slightly).
  x = x - protrude;
  y = y - protrude;
  w = w + protrude * 2;
  h = h + protrude * 2;
  const cy = y + h / 2;
  const rx = h / 2;
  const lx = x + rx;
  const rxe = x + w - rx;
  const k = 0.5523 * rx;
  const tA = [lx + j(), y + j()];
  const tB = [rxe + j(), y + j()];
  const rTc1 = [rxe + k + j(), y + j()];
  const rTc2 = [x + w + j(), cy - k + j()];
  const rR = [x + w + j(), cy + j()];
  const rBc1 = [x + w + j(), cy + k + j()];
  const rBc2 = [rxe + k + j(), y + h + j()];
  const rB = [rxe + j(), y + h + j()];
  const bB = [lx + j(), y + h + j()];
  const lBc1 = [lx - k + j(), y + h + j()];
  const lBc2 = [x + j(), cy + k + j()];
  const lL = [x + j(), cy + j()];
  const lTc1 = [x + j(), cy - k + j()];
  const lTc2 = [lx - k + j(), y + j()];
  return [
    `M ${f(tA[0])} ${f(tA[1])}`,
    `L ${f(tB[0])} ${f(tB[1])}`,
    `C ${f(rTc1[0])} ${f(rTc1[1])}, ${f(rTc2[0])} ${f(rTc2[1])}, ${f(rR[0])} ${f(rR[1])}`,
    `C ${f(rBc1[0])} ${f(rBc1[1])}, ${f(rBc2[0])} ${f(rBc2[1])}, ${f(rB[0])} ${f(rB[1])}`,
    `L ${f(bB[0])} ${f(bB[1])}`,
    `C ${f(lBc1[0])} ${f(lBc1[1])}, ${f(lBc2[0])} ${f(lBc2[1])}, ${f(lL[0])} ${f(lL[1])}`,
    `C ${f(lTc1[0])} ${f(lTc1[1])}, ${f(lTc2[0])} ${f(lTc2[1])}, ${f(tA[0])} ${f(tA[1])}`,
    'Z',
  ].join(' ');
}

// Rough diamond: 4 jittered straight-ish segments through cubic Beziers.
export function roughDiamondPath(
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  rough: number,
  seed: number,
  mods: ShapeModifiers = {},
): string {
  const r = seededRandom(seed);
  const j = () => jitter(r, rough);
  const protrude = protrudeFor(mods.endpointBehavior);
  // For diamond, push each vertex radially outward from the center.
  const points = [
    [cx + j(), cy - hh + j() - protrude],          // top
    [cx + hw + j() + protrude, cy + j()],          // right
    [cx + j(), cy + hh + j() + protrude],          // bottom
    [cx - hw + j() - protrude, cy + j()],          // left
  ];
  const looseOffset =
    mods.sketchingStyle === 'loose-overlap' && mods.layerIndex
      ? mods.layerIndex * LOOSE_OVERLAP_AMOUNT
      : 0;
  const f = (n: number) => n.toFixed(2);
  const parts: string[] = [];
  for (let i = 0; i < 4; i++) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const aShift = [a[0] - ux * looseOffset, a[1] - uy * looseOffset];
    const bShift = [b[0] + ux * looseOffset, b[1] + uy * looseOffset];
    const t1 = [aShift[0] + (bShift[0] - aShift[0]) / 3 + j() * 1.2, aShift[1] + (bShift[1] - aShift[1]) / 3 + j() * 1.2];
    const t2 = [aShift[0] + (bShift[0] - aShift[0]) * 2 / 3 + j() * 1.2, aShift[1] + (bShift[1] - aShift[1]) * 2 / 3 + j() * 1.2];
    parts.push(`M ${f(aShift[0])} ${f(aShift[1])}`);
    parts.push(`C ${f(t1[0])} ${f(t1[1])}, ${f(t2[0])} ${f(t2[1])}, ${f(bShift[0])} ${f(bShift[1])}`);
  }
  return parts.join(' ');
}

// Rough straight line: cubic Bezier with two jittered control points.
// Endpoint behaviors apply per layer for sketching styles.
export function roughLinePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rough: number,
  seed: number,
  mods: ShapeModifiers = {},
): string {
  const r = seededRandom(seed);
  const j = () => jitter(r, rough);
  const f = (n: number) => n.toFixed(2);
  const protrude = protrudeFor(mods.endpointBehavior);
  const looseOffset =
    mods.sketchingStyle === 'loose-overlap' && mods.layerIndex
      ? mods.layerIndex * LOOSE_OVERLAP_AMOUNT
      : 0;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const totalShift = protrude + looseOffset;
  const sx1 = x1 - ux * totalShift;
  const sy1 = y1 - uy * totalShift;
  const sx2 = x2 + ux * totalShift;
  const sy2 = y2 + uy * totalShift;
  const t1 = [sx1 + (sx2 - sx1) / 3 + j(), sy1 + (sy2 - sy1) / 3 + j()];
  const t2 = [sx1 + (sx2 - sx1) * 2 / 3 + j(), sy1 + (sy2 - sy1) * 2 / 3 + j()];
  return `M ${f(sx1)} ${f(sy1)} C ${f(t1[0])} ${f(t1[1])}, ${f(t2[0])} ${f(t2[1])}, ${f(sx2)} ${f(sy2)}`;
}

// Rough orthogonal path: each segment of an SVG-style M/V/H sequence redrawn
// as a roughLinePath. Used for orthogonal U-shape loopbacks. Mods apply to each
// segment uniformly (so a "protrude" loopback overshoots at every corner).
export function roughOrthogonalPath(
  segments: Array<[number, number, number, number]>,
  rough: number,
  seed: number,
  mods: ShapeModifiers = {},
): string {
  return segments
    .map((s, i) => roughLinePath(s[0], s[1], s[2], s[3], rough, seed + i * 17, mods))
    .join(' ');
}

// ───────────────────────────────────────────────────────────────────────────
// Per-shape base calibration constants
// ───────────────────────────────────────────────────────────────────────────

/**
 * LOCKED PER-SHAPE BASE CALIBRATION — DO NOT DRIFT.
 *
 * These values are SACRED RATIOS calibrated in the playground. They define the
 * relative jitter amplitude across primitive types so a "wobbly rect" reads
 * proportionally to a "wobbly line" in the same artifact.
 *
 * The master `wobble` slider (F3ModifiersState.wobble, 0-2) multiplies ALL
 * five values together — preserving the rect:oval:diamond:line:orthogonal
 * proportion while scaling overall jitter. Per `09-LOCKED-MODEL.md` I-11.
 *
 * NEVER change individual values in isolation. Changing one shifts the
 * proportion and breaks the playground's calibrated read. If you need to
 * shift global jitter, change `wobble` in state (or its slider range);
 * if you need to change per-shape character, document why and update ALL
 * five values to preserve the ratio mapping.
 */
export const HAND_FEEL_BASE = {
  /** Box-shape edges (rectangles, rounded rects). */
  rect: 2.4,
  /** Oval / capsule edges. */
  oval: 2.4,
  /** Diamond polygon edges. */
  diamond: 2.0,
  /** Single straight forward edges (between nodes). */
  line: 1.4,
  /** Orthogonal multi-segment paths (loopbacks). */
  orthogonal: 1.6,
} as const;

/** Multiplier above which we visually warn — enters Excalidraw signature zone.
 *  Threshold for the master `wobble` slider (per I-11). Chrome shows a warn
 *  styling when `wobble > EXCALIDRAW_WARN_THRESHOLD`. */
export const EXCALIDRAW_WARN_THRESHOLD = 1.4;

// ───────────────────────────────────────────────────────────────────────────
// Pen-tip variation via perfect-freehand
// ───────────────────────────────────────────────────────────────────────────
// Per gate-a-ion-texture-and-pen-tip-research.md §5: 7 named pen-tip presets.
// Each preset maps to a perfect-freehand StrokeOptions config + a stroke-width
// scale. perfect-freehand returns polygon points; we convert to an SVG path
// suitable for fill rendering. Deterministic when simulatePressure=false (we
// supply explicit pressure values seeded by our LCG).

import { getStroke } from 'perfect-freehand';

export type PenTipPreset =
  | 'plain'        // Default — no pen-tip variation; falls back to plain stroke render.
  | 'ballpoint'    // Clean uniform stroke, slight thinning at endpoints.
  | 'fineliner'    // Thinner uniform stroke, hard caps.
  | 'pencil-hb'    // Mild width variation, light grain (via small pressure jitter).
  | 'pencil-2b'    // Stronger width variation, heavier grain.
  | 'felt-tip'     // Thicker uniform stroke, soft caps.
  | 'chisel'       // Strong width variation along stroke (simulated calligraphy).
  | 'charcoal';    // Heavy variable width, edge-jittered grain.

type PenTipParams = {
  /** Base diameter at strokeWidth multiplier 1.0. */
  size: number;
  /** -1 to 1 — how much pressure thins the stroke. Higher = more taper. */
  thinning: number;
  /** 0 to 1 — softens stroke edges. */
  smoothing: number;
  /** Pressure jitter amplitude — adds grain. We seed this manually. */
  pressureJitter: number;
  /** Mean simulated pressure. */
  basePressure: number;
  /** Start cap config (taper + cap or hard). */
  startTaper: number;
  /** End cap config. */
  endTaper: number;
};

export const PEN_TIP_PRESETS: Record<PenTipPreset, PenTipParams> = {
  // 'plain' is sentinel — consumers check for this and skip getStroke entirely.
  plain:       { size: 1,   thinning: 0,    smoothing: 0,    pressureJitter: 0,    basePressure: 0.5, startTaper: 0,  endTaper: 0  },
  ballpoint:   { size: 1.6, thinning: 0.2,  smoothing: 0.3,  pressureJitter: 0,    basePressure: 0.5, startTaper: 4,  endTaper: 4  },
  fineliner:   { size: 1.2, thinning: 0,    smoothing: 0.2,  pressureJitter: 0,    basePressure: 0.5, startTaper: 0,  endTaper: 0  },
  'pencil-hb': { size: 1.8, thinning: 0.4,  smoothing: 0.4,  pressureJitter: 0.1,  basePressure: 0.45, startTaper: 8, endTaper: 12 },
  'pencil-2b': { size: 2.4, thinning: 0.55, smoothing: 0.5,  pressureJitter: 0.2,  basePressure: 0.55, startTaper: 12, endTaper: 18 },
  'felt-tip':  { size: 3.0, thinning: 0.05, smoothing: 0.5,  pressureJitter: 0,    basePressure: 0.7,  startTaper: 6,  endTaper: 6  },
  chisel:      { size: 2.6, thinning: 0.7,  smoothing: 0.4,  pressureJitter: 0,    basePressure: 0.5,  startTaper: 14, endTaper: 14 },
  charcoal:    { size: 3.2, thinning: 0.6,  smoothing: 0.6,  pressureJitter: 0.3,  basePressure: 0.55, startTaper: 16, endTaper: 22 },
};

/** Convert a perfect-freehand polygon (Vec2[]) into a closed SVG fill path. */
function polygonToSvgPath(stroke: number[][]): string {
  if (!stroke.length) return '';
  const f = (n: number) => n.toFixed(2);
  const d = stroke.reduce(
    (acc, [x, y], i) => acc + (i === 0 ? `M ${f(x)} ${f(y)} ` : `L ${f(x)} ${f(y)} `),
    '',
  );
  return d + 'Z';
}

// ───────────────────────────────────────────────────────────────────────────
// Closed-shape samplers — used so pen-tip mode can render boxes/diamonds/ovals
// with the perfect-freehand polygon outline. We sample each side into N points
// (with jitter from the seeded LCG) so the rough.js wobble character is
// preserved AND the pen-tip stroke profile (taper / grain / variable width)
// rides on top.
// ───────────────────────────────────────────────────────────────────────────

const SIDE_STEPS = 8;            // points per side for box-like shapes
const OVAL_STEPS_PER_QUADRANT = 6;

/** Closed loop of jittered points around a rectangle. Loops back to start so
 *  perfect-freehand renders a continuous outline. */
export function roughRectPoints(
  x: number,
  y: number,
  w: number,
  h: number,
  rough: number,
  seed: number,
  mods: ShapeModifiers = {},
): Array<[number, number]> {
  const r = seededRandom(seed);
  const j = () => jitter(r, rough);
  const protrude = protrudeFor(mods.endpointBehavior);
  const corners: Array<[number, number]> = [
    [x - protrude, y - protrude],
    [x + w + protrude, y - protrude],
    [x + w + protrude, y + h + protrude],
    [x - protrude, y + h + protrude],
  ];
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    for (let s = 0; s < SIDE_STEPS; s++) {
      const t = s / SIDE_STEPS;
      points.push([ax + (bx - ax) * t + j(), ay + (by - ay) * t + j()]);
    }
  }
  // Close the loop by repeating start (lets perfect-freehand render seamlessly).
  points.push([corners[0][0] + j(), corners[0][1] + j()]);
  return points;
}

/** Closed loop of jittered points around an oval (capsule). */
export function roughOvalPoints(
  x: number,
  y: number,
  w: number,
  h: number,
  rough: number,
  seed: number,
  mods: ShapeModifiers = {},
): Array<[number, number]> {
  const r = seededRandom(seed);
  const j = () => jitter(r, rough);
  const protrude = protrudeFor(mods.endpointBehavior) * 0.5;
  const px = x - protrude;
  const py = y - protrude;
  const pw = w + protrude * 2;
  const ph = h + protrude * 2;
  const cy = py + ph / 2;
  const rx = ph / 2;
  const lx = px + rx;
  const rxe = px + pw - rx;
  const points: Array<[number, number]> = [];
  // Top edge L → R
  for (let s = 0; s < SIDE_STEPS; s++) {
    const t = s / SIDE_STEPS;
    points.push([lx + (rxe - lx) * t + j(), py + j()]);
  }
  // Right cap (semicircle)
  for (let s = 0; s <= OVAL_STEPS_PER_QUADRANT * 2; s++) {
    const theta = -Math.PI / 2 + (s / (OVAL_STEPS_PER_QUADRANT * 2)) * Math.PI;
    points.push([rxe + Math.cos(theta) * rx + j(), cy + Math.sin(theta) * rx + j()]);
  }
  // Bottom edge R → L
  for (let s = 0; s < SIDE_STEPS; s++) {
    const t = s / SIDE_STEPS;
    points.push([rxe + (lx - rxe) * t + j(), py + ph + j()]);
  }
  // Left cap (semicircle)
  for (let s = 0; s <= OVAL_STEPS_PER_QUADRANT * 2; s++) {
    const theta = Math.PI / 2 + (s / (OVAL_STEPS_PER_QUADRANT * 2)) * Math.PI;
    points.push([lx + Math.cos(theta) * rx + j(), cy + Math.sin(theta) * rx + j()]);
  }
  return points;
}

/** Closed loop of jittered points around a diamond. */
export function roughDiamondPoints(
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  rough: number,
  seed: number,
  mods: ShapeModifiers = {},
): Array<[number, number]> {
  const r = seededRandom(seed);
  const j = () => jitter(r, rough);
  const protrude = protrudeFor(mods.endpointBehavior);
  const verts: Array<[number, number]> = [
    [cx, cy - hh - protrude],
    [cx + hw + protrude, cy],
    [cx, cy + hh + protrude],
    [cx - hw - protrude, cy],
  ];
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = verts[i];
    const [bx, by] = verts[(i + 1) % 4];
    for (let s = 0; s < SIDE_STEPS; s++) {
      const t = s / SIDE_STEPS;
      points.push([ax + (bx - ax) * t + j(), ay + (by - ay) * t + j()]);
    }
  }
  points.push([verts[0][0] + j(), verts[0][1] + j()]);
  return points;
}

/**
 * Sample a polyline-ish point sequence into a perfect-freehand polygon path.
 * Used by line-style consumers (forward edges, orthogonal loopbacks).
 *
 * `points` is an array of [x, y]. We add deterministic pressure values seeded
 * by `seed` so the rendered grain is stable for the screenshot pipeline.
 *
 * Returns an SVG path string suitable for `fill="var(--dir-text-primary)"`
 * (perfect-freehand emits the stroke as a filled polygon outline).
 */
export function penTipPath(
  points: Array<[number, number]>,
  preset: PenTipPreset,
  /** Multiplier on the preset's size (the chrome's strokeWidth slider). */
  sizeMul: number,
  seed: number,
): string {
  if (preset === 'plain' || points.length < 2) return '';
  const params = PEN_TIP_PRESETS[preset];
  const r = seededRandom(seed);
  // Add deterministic pressure per point: base + small jitter for grain.
  const pressured = points.map(([x, y]) => {
    const grain = (r() - 0.5) * 2 * params.pressureJitter;
    const p = Math.max(0, Math.min(1, params.basePressure + grain));
    return [x, y, p];
  });
  const stroke = getStroke(pressured, {
    size: params.size * sizeMul * 2,    // ×2 so the rendered polygon reads as a stroke at the locked weight scale
    thinning: params.thinning,
    smoothing: params.smoothing,
    streamline: 0.4,
    simulatePressure: false,             // we supply pressure explicitly so grain is seeded
    last: true,
    start: { taper: params.startTaper, cap: params.startTaper === 0 },
    end:   { taper: params.endTaper,   cap: params.endTaper === 0 },
  });
  return polygonToSvgPath(stroke);
}

/**
 * Render a hand-feel arrowhead chevron (two short pen-tip strokes forming "<")
 * at a tip point, oriented backward toward `fromX, fromY`. The static SVG
 * marker triangle clashes with hand-drawn lines (its crisp triangle reads as
 * the only non-hand-feel element on the page); this gives the arrowhead the
 * same stroke character as the line it terminates.
 *
 * Returns a single SVG path string with both chevron legs joined.
 */
export function handFeelArrowChevron(
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  preset: PenTipPreset,
  sizeMul: number,
  seed: number,
  legLength: number = 12,
  angleDeg: number = 28,
): string {
  if (preset === 'plain') return '';
  const dx = tipX - fromX;
  const dy = tipY - fromY;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const ang = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  // Leg A (chevron upper-left): from a base point rotated +ang from backward.
  const ax = tipX - (ux * cos - uy * sin) * legLength;
  const ay = tipY - (uy * cos + ux * sin) * legLength;
  // Leg B (chevron lower-left): rotated -ang.
  const bx = tipX - (ux * cos + uy * sin) * legLength;
  const by = tipY - (uy * cos - ux * sin) * legLength;
  const legA = penTipPath(sampleLine(ax, ay, tipX, tipY, 6), preset, sizeMul, seed);
  const legB = penTipPath(sampleLine(bx, by, tipX, tipY, 6), preset, sizeMul, seed + 13);
  return legA + ' ' + legB;
}

/**
 * Sample a straight line into N points for perfect-freehand input.
 * Used as input to `penTipPath` for forward edges + orthogonal segments.
 */
export function sampleLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  steps: number = 12,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
  }
  return points;
}

/**
 * Sample an orthogonal segment chain (M/V/H sequence) into a single contiguous
 * point sequence. Each segment contributes its share of the total step budget.
 */
export function sampleOrthogonal(
  segments: Array<[number, number, number, number]>,
  totalSteps: number = 30,
): Array<[number, number]> {
  if (!segments.length) return [];
  // Distribute steps proportionally by segment length.
  const lengths = segments.map(([x1, y1, x2, y2]) => Math.hypot(x2 - x1, y2 - y1));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const points: Array<[number, number]> = [];
  segments.forEach(([x1, y1, x2, y2], i) => {
    const segSteps = Math.max(2, Math.round((lengths[i] / total) * totalSteps));
    for (let s = 0; s < segSteps; s++) {
      const t = s / segSteps;
      points.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
  });
  // Push final segment endpoint.
  const last = segments[segments.length - 1];
  points.push([last[2], last[3]]);
  return points;
}
