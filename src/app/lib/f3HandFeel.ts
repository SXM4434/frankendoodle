// F3 hand-feel primitives — Hero-8-Lab layer.
//
// Re-exports the playground's `handFeel.ts` primitives (seeded LCG, jitter,
// ShapeModifiers + 4 endpointBehavior + 4 sketchingStyle, roughRect/Oval/Diamond
// point samplers, HAND_FEEL_BASE calibration, PEN_TIP_PRESETS, penTipPath,
// crossHatchRotationFor, parallelPassScaleFor, parallelPassTranslateFor) and
// adds two helpers needed by SvgStyleTransform for SVG primitives the
// playground doesn't render directly:
//
//   • roughLinePoints — N jittered points along a straight line
//   • roughPolygonPoints — closed loop of jittered points around an
//     arbitrary polygon (endpointBehavior protrudes vertices radially outward
//     from the polygon centroid, matching the rect/diamond pattern)
//
// Everything else (roughRectPoints, roughOvalPoints, roughDiamondPoints,
// penTipPath, etc.) is re-exported unchanged so consumers import only from
// this module.

export {
  seededRandom,
  jitter,
  type ShapeModifiers,
  rotatePointsAround,
  crossHatchRotationFor,
  scalePointsAround,
  parallelPassScaleFor,
  parallelPassTranslateFor,
  offsetLinePerpendicular,
  roughRectPath,
  roughCirclePath,
  roughOvalPath,
  roughDiamondPath,
  roughLinePath,
  roughOrthogonalPath,
  HAND_FEEL_BASE,
  EXCALIDRAW_WARN_THRESHOLD,
  type PenTipPreset,
  PEN_TIP_PRESETS,
  roughDiamondPoints,
  penTipPath as penTipPathBase,
  handFeelArrowChevron,
  sampleLine,
  sampleOrthogonal,
} from './handFeel';

import {
  seededRandom,
  jitter,
  type ShapeModifiers,
  type PenTipPreset,
  penTipPath as penTipPathBase,
} from './handFeel';

// Protrude constants — playground values for radial-push modes (4/9), but kink
// reduced (5 → 2.5) because it applies at random angles per corner — same px
// amount reads as MORE dramatic than radial push (regular vs chaotic visual).
// Sebs 2026-06-04: "each corner should be kinked but not as much as we have it now."
// Playground source for radial: handFeel.ts:51-53.
const PROTRUDE_LOCAL = 4;
const LONG_OVERSHOOT_LOCAL = 9;
const KINK_LOCAL = 2.5;

const LOOSE_OVERLAP_LOCAL = 2;  // playground was 3

// ───────────────────────────────────────────────────────────────────────────
// Playground-native path-builders + Bowing/Curve extensions.
//
// Playground's roughRectPath / roughOvalPath / roughLinePath use 4-corner
// sampling + cubic-Bezier segments with two jittered control points each (at
// 1/3 and 2/3 along segment). That's WHY wobble in playground produces smooth
// continuous wandering instead of kinked corners.
//
// Our rebuild also exposes Bowing + CurveTightness sliders which playground
// doesn't have. We extend playground's logic to also add:
//   - bowing: perpendicular offset on both control points (deliberate bend)
//   - curveDamp: dampens both wobble's jitter AND bowing's offset
//
// These extended variants are exported and used by SvgStyleTransform's
// buildPath callback, so wobble + bowing + curve ALL work together via one
// path-builder per primitive. Cluster Cleanup: this respects the user's
// orthogonality model — wobble = path/motion master, bowing = explicit bend
// on top, curve = tightness dampener on both.
// ───────────────────────────────────────────────────────────────────────────

/** Extended rect path builder — matches playground's roughRectPath wobble math
 *  EXACTLY (4 corners + 4 cubic-Bezier segments, j()*1.4 control-point jitter)
 *  + adds Bowing perpendicular offset on both control points + CurveTightness
 *  dampening. */
export function roughRectPathExtended(
  x: number, y: number, w: number, h: number,
  rough: number,
  bowing: number,
  curveDamp: number,
  seed: number,
  mods: ShapeModifiers = {},
): string {
  const r = seededRandom(seed);
  // CurveTightness dampens BOTH wobble's jitter scale AND bowing's offset.
  // At curveDamp=0 → full effect. At curveDamp=1 → ~half. At 2 → ~0.
  const tightnessDamp = Math.max(0.05, 1 - curveDamp * 0.45);
  const dampedRough = rough * tightnessDamp;
  const j = () => jitter(r, dampedRough);
  const protrude = protrudeForLocal(mods.endpointBehavior);
  const isKink = mods.endpointBehavior === 'kink';
  // For KINK: each corner gets a RANDOM-angle push (not radial like protrude).
  // The corner moves in an arbitrary direction by KINK_LOCAL amount — produces
  // the "twitchy" / "spasm" character a real kink should have, distinct from
  // protrude's regular outward push. Per playground doc-comment intent that
  // was never implemented in playground itself (handFeel.ts:161-164).
  const kinkOffset = (): [number, number] => {
    if (!isKink) return [0, 0];
    const angle = r() * Math.PI * 2;
    return [Math.cos(angle) * protrude, Math.sin(angle) * protrude];
  };
  // For non-kink modes: radial protrude (corner pushed outward from rect center)
  // For kink: zero radial, then kinkOffset adds the random-angle push below
  const radialProtrude = isKink ? 0 : protrude;
  const k0 = kinkOffset(), k1 = kinkOffset(), k2 = kinkOffset(), k3 = kinkOffset();
  const corners: Array<[number, number]> = [
    [x + j() - radialProtrude + k0[0], y + j() - radialProtrude + k0[1]],
    [x + w + j() + radialProtrude + k1[0], y + j() - radialProtrude + k1[1]],
    [x + w + j() + radialProtrude + k2[0], y + h + j() + radialProtrude + k2[1]],
    [x + j() - radialProtrude + k3[0], y + h + j() + radialProtrude + k3[1]],
  ];
  const looseOffset =
    mods.sketchingStyle === 'loose-overlap' && mods.layerIndex
      ? mods.layerIndex * LOOSE_OVERLAP_LOCAL
      : 0;
  const f = (n: number) => n.toFixed(2);
  const parts: string[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    // Loose-overlap shift along segment direction
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const aShift: [number, number] = [a[0] - ux * looseOffset, a[1] - uy * looseOffset];
    const bShift: [number, number] = [b[0] + ux * looseOffset, b[1] + uy * looseOffset];
    // Bowing perpendicular offset (sign deterministic per-segment, jittered)
    const perpX = -uy;
    const perpY = ux;
    const sign = r() > 0.5 ? 1 : -1;
    // Bowing scale: 0.06 × segment length × bowing × tightnessDamp. Matches our
    // earlier polyline bowing scale (0.08 was for short segments; 0.06 fits
    // playground's longer corner-to-corner segments).
    const bowOff = bowing * tightnessDamp * len * 0.06 * sign;
    // Two control points at 1/3 and 2/3 along segment, BOTH wobble-jittered
    // (matches playground line 202-203 j()*1.4) AND bowing-offset.
    const t1: [number, number] = [
      aShift[0] + (bShift[0] - aShift[0]) / 3 + jitter(r, dampedRough * 1.4) + perpX * bowOff,
      aShift[1] + (bShift[1] - aShift[1]) / 3 + jitter(r, dampedRough * 1.4) + perpY * bowOff,
    ];
    const t2: [number, number] = [
      aShift[0] + (bShift[0] - aShift[0]) * 2 / 3 + jitter(r, dampedRough * 1.4) + perpX * bowOff,
      aShift[1] + (bShift[1] - aShift[1]) * 2 / 3 + jitter(r, dampedRough * 1.4) + perpY * bowOff,
    ];
    parts.push(`M ${f(aShift[0])} ${f(aShift[1])}`);
    parts.push(`C ${f(t1[0])} ${f(t1[1])}, ${f(t2[0])} ${f(t2[1])}, ${f(bShift[0])} ${f(bShift[1])}`);
  }
  return parts.join(' ');
}

/** Extended oval path builder — matches playground's roughOvalPath wobble math
 *  + Bowing/CurveTightness. */
export function roughOvalPathExtended(
  x: number, y: number, w: number, h: number,
  rough: number,
  bowing: number,
  curveDamp: number,
  seed: number,
  mods: ShapeModifiers = {},
): string {
  const r = seededRandom(seed);
  const tightnessDamp = Math.max(0.05, 1 - curveDamp * 0.45);
  const dampedRough = rough * tightnessDamp;
  const j = () => jitter(r, dampedRough);
  const f = (n: number) => n.toFixed(2);
  const isKink = mods.endpointBehavior === 'kink';
  // KINK on oval: random-angle push applied to each anchor point individually
  // (not as a radius bump). For non-kink: radius bump (current behavior).
  const kinkPush = (): [number, number] => {
    if (!isKink) return [0, 0];
    const k = KINK_LOCAL;
    const angle = r() * Math.PI * 2;
    return [Math.cos(angle) * k, Math.sin(angle) * k];
  };
  const protrude = isKink ? 0 : protrudeForLocal(mods.endpointBehavior) * 0.5;
  x = x - protrude;
  y = y - protrude;
  w = w + protrude * 2;
  h = h + protrude * 2;
  const cy = y + h / 2;
  const rx = h / 2;
  const lx = x + rx;
  const rxe = x + w - rx;
  const k = 0.5523 * rx;
  // Each control point gets wobble jitter + bowing offset (radial outward for oval).
  // For oval, "bowing" pushes control points away from the oval center, making
  // the curve bulge outward more dramatically.
  const cxCenter = x + w / 2;
  const cyCenter = y + h / 2;
  const bowMul = bowing * tightnessDamp * 0.08;
  const bowAt = (px: number, py: number): [number, number] => {
    const ddx = px - cxCenter;
    const ddy = py - cyCenter;
    const dlen = Math.max(0.001, Math.hypot(ddx, ddy));
    return [(ddx / dlen) * bowMul * dlen, (ddy / dlen) * bowMul * dlen];
  };
  // Kink: per-anchor random-angle push (twitchy character at each cap point)
  const kA = kinkPush();
  const kB = kinkPush();
  const kR = kinkPush();
  const kBb = kinkPush();
  const kL = kinkPush();
  const tA: [number, number] = [lx + j() + kA[0], y + j() + kA[1]];
  const tB: [number, number] = [rxe + j() + kB[0], y + j() + kB[1]];
  const rTc1_base: [number, number] = [rxe + k + j(), y + j()];
  const rTc1_bow = bowAt(rTc1_base[0], rTc1_base[1]);
  const rTc1: [number, number] = [rTc1_base[0] + rTc1_bow[0], rTc1_base[1] + rTc1_bow[1]];
  const rTc2_base: [number, number] = [x + w + j(), cy - k + j()];
  const rTc2_bow = bowAt(rTc2_base[0], rTc2_base[1]);
  const rTc2: [number, number] = [rTc2_base[0] + rTc2_bow[0], rTc2_base[1] + rTc2_bow[1]];
  const rR: [number, number] = [x + w + j() + kR[0], cy + j() + kR[1]];
  const rBc1_base: [number, number] = [x + w + j(), cy + k + j()];
  const rBc1_bow = bowAt(rBc1_base[0], rBc1_base[1]);
  const rBc1: [number, number] = [rBc1_base[0] + rBc1_bow[0], rBc1_base[1] + rBc1_bow[1]];
  const rBc2_base: [number, number] = [rxe + k + j(), y + h + j()];
  const rBc2_bow = bowAt(rBc2_base[0], rBc2_base[1]);
  const rBc2: [number, number] = [rBc2_base[0] + rBc2_bow[0], rBc2_base[1] + rBc2_bow[1]];
  const rB: [number, number] = [rxe + j(), y + h + j()];
  const bB: [number, number] = [lx + j() + kBb[0], y + h + j() + kBb[1]];
  const lBc1_base: [number, number] = [lx - k + j(), y + h + j()];
  const lBc1_bow = bowAt(lBc1_base[0], lBc1_base[1]);
  const lBc1: [number, number] = [lBc1_base[0] + lBc1_bow[0], lBc1_base[1] + lBc1_bow[1]];
  const lBc2_base: [number, number] = [x + j(), cy + k + j()];
  const lBc2_bow = bowAt(lBc2_base[0], lBc2_base[1]);
  const lBc2: [number, number] = [lBc2_base[0] + lBc2_bow[0], lBc2_base[1] + lBc2_bow[1]];
  const lL: [number, number] = [x + j() + kL[0], cy + j() + kL[1]];
  const lTc1_base: [number, number] = [x + j(), cy - k + j()];
  const lTc1_bow = bowAt(lTc1_base[0], lTc1_base[1]);
  const lTc1: [number, number] = [lTc1_base[0] + lTc1_bow[0], lTc1_base[1] + lTc1_bow[1]];
  const lTc2_base: [number, number] = [lx - k + j(), y + j()];
  const lTc2_bow = bowAt(lTc2_base[0], lTc2_base[1]);
  const lTc2: [number, number] = [lTc2_base[0] + lTc2_bow[0], lTc2_base[1] + lTc2_bow[1]];
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

/** Extended line path builder — single cubic-Bezier from a→b with wobble +
 *  Bowing + CurveTightness. */
export function roughLinePathExtended(
  x1: number, y1: number, x2: number, y2: number,
  rough: number,
  bowing: number,
  curveDamp: number,
  seed: number,
  mods: ShapeModifiers = {},
): string {
  const r = seededRandom(seed);
  const tightnessDamp = Math.max(0.05, 1 - curveDamp * 0.45);
  const dampedRough = rough * tightnessDamp;
  const j = () => jitter(r, dampedRough);
  const f = (n: number) => n.toFixed(2);
  // Endpoint behavior: protrude extends along line direction; kink shifts each
  // endpoint in a random direction (twitchy character at each tip).
  const protrude = protrudeForLocal(mods.endpointBehavior);
  const isKink = mods.endpointBehavior === 'kink';
  const dxL = x2 - x1;
  const dyL = y2 - y1;
  const lenL = Math.max(0.01, Math.hypot(dxL, dyL));
  const uxL = dxL / lenL;
  const uyL = dyL / lenL;
  const kinkPush = (): [number, number] => {
    if (!isKink) return [0, 0];
    const angle = r() * Math.PI * 2;
    return [Math.cos(angle) * protrude, Math.sin(angle) * protrude];
  };
  const radialShift = isKink ? 0 : protrude;
  const kA = kinkPush();
  const kB = kinkPush();
  const a: [number, number] = [x1 + j() - uxL * radialShift + kA[0], y1 + j() - uyL * radialShift + kA[1]];
  const b: [number, number] = [x2 + j() + uxL * radialShift + kB[0], y2 + j() + uyL * radialShift + kB[1]];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.max(1, Math.hypot(dx, dy));
  const perpX = -dy / len;
  const perpY = dx / len;
  const sign = r() > 0.5 ? 1 : -1;
  const bowOff = bowing * tightnessDamp * len * 0.06 * sign;
  const t1: [number, number] = [
    a[0] + dx / 3 + jitter(r, dampedRough * 1.4) + perpX * bowOff,
    a[1] + dy / 3 + jitter(r, dampedRough * 1.4) + perpY * bowOff,
  ];
  const t2: [number, number] = [
    a[0] + 2 * dx / 3 + jitter(r, dampedRough * 1.4) + perpX * bowOff,
    a[1] + 2 * dy / 3 + jitter(r, dampedRough * 1.4) + perpY * bowOff,
  ];
  return `M ${f(a[0])} ${f(a[1])} C ${f(t1[0])} ${f(t1[1])}, ${f(t2[0])} ${f(t2[1])}, ${f(b[0])} ${f(b[1])}`;
}

function protrudeForLocal(mode: ShapeModifiers['endpointBehavior']): number {
  if (mode === 'protrude') return PROTRUDE_LOCAL;
  if (mode === 'long-overshoot') return LONG_OVERSHOOT_LOCAL;
  if (mode === 'kink') return KINK_LOCAL;
  return 0;
}

const LOCAL_SIDE_STEPS = 8;
const LOCAL_OVAL_STEPS_PER_QUADRANT = 6;
const LOCAL_LOOSE_OVERLAP = 2;  // playground was 3

/**
 * Bbox-aware roughRectPoints — replaces the playground re-export. Same
 * algorithm but uses LOCAL protrude constants (~half playground baseline)
 * AND accepts a protrudeScale param for per-shape scaling. Caller passes
 * a scale based on shape size (smaller shapes → smaller scale).
 */
export function roughRectPoints(
  x: number,
  y: number,
  w: number,
  h: number,
  rough: number,
  seed: number,
  mods: ShapeModifiers = {},
  protrudeScale: number = 1.0,
): Array<[number, number]> {
  const r = seededRandom(seed);
  const j = () => jitter(r, rough);
  const protrude = protrudeForLocal(mods.endpointBehavior) * protrudeScale;
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
    for (let s = 0; s < LOCAL_SIDE_STEPS; s++) {
      const t = s / LOCAL_SIDE_STEPS;
      points.push([ax + (bx - ax) * t + j(), ay + (by - ay) * t + j()]);
    }
  }
  points.push([corners[0][0] + j(), corners[0][1] + j()]);
  return points;
}

/**
 * Bbox-aware roughOvalPoints — same fork pattern. Protrude is halved internally
 * (oval playground used protrude × 0.5; we apply that on top of our smaller
 * local constants + protrudeScale).
 */
export function roughOvalPoints(
  x: number,
  y: number,
  w: number,
  h: number,
  rough: number,
  seed: number,
  mods: ShapeModifiers = {},
  protrudeScale: number = 1.0,
): Array<[number, number]> {
  const r = seededRandom(seed);
  const j = () => jitter(r, rough);
  const protrude = protrudeForLocal(mods.endpointBehavior) * 0.5 * protrudeScale;
  const px = x - protrude;
  const py = y - protrude;
  const pw = w + protrude * 2;
  const ph = h + protrude * 2;
  const cy = py + ph / 2;
  const rx = ph / 2;
  const lx = px + rx;
  const rxe = px + pw - rx;
  const points: Array<[number, number]> = [];
  for (let s = 0; s < LOCAL_SIDE_STEPS; s++) {
    const t = s / LOCAL_SIDE_STEPS;
    points.push([lx + (rxe - lx) * t + j(), py + j()]);
  }
  for (let s = 0; s <= LOCAL_OVAL_STEPS_PER_QUADRANT * 2; s++) {
    const theta = -Math.PI / 2 + (s / (LOCAL_OVAL_STEPS_PER_QUADRANT * 2)) * Math.PI;
    points.push([rxe + Math.cos(theta) * rx + j(), cy + Math.sin(theta) * rx + j()]);
  }
  for (let s = 0; s < LOCAL_SIDE_STEPS; s++) {
    const t = s / LOCAL_SIDE_STEPS;
    points.push([rxe + (lx - rxe) * t + j(), py + ph + j()]);
  }
  for (let s = 0; s <= LOCAL_OVAL_STEPS_PER_QUADRANT * 2; s++) {
    const theta = Math.PI / 2 + (s / (LOCAL_OVAL_STEPS_PER_QUADRANT * 2)) * Math.PI;
    points.push([lx + Math.cos(theta) * rx + j(), cy + Math.sin(theta) * rx + j()]);
  }
  return points;
}

/**
 * Pen-tip path wrapper that auto-scales the pen-tip size for small shapes.
 * Playground pen-tip preset sizes (1.0–3.2) were tuned for 300-500px artifacts.
 * Our hero items are ~80px; without scaling, charcoal/pencil presets look
 * super thick. We cap effective size by clamping based on the smaller bbox
 * dimension.
 */
export function penTipPath(
  points: Array<[number, number]>,
  preset: PenTipPreset,
  sizeMul: number,
  seed: number,
  /** Smaller bbox dimension of the shape being rendered, used to cap pen-tip
   *  size so charcoal etc. don't look ridiculous on tiny items. */
  bboxMin: number = 80,
): string {
  // Scale factor: 1.0 at playground baseline 140px, smaller below that.
  const sizeScale = Math.max(0.3, Math.min(1.0, bboxMin / 140));
  return penTipPathBase(points, preset, sizeMul * sizeScale, seed);
}

// Match playground's per-side step counts so rect/oval/diamond/line/polygon
// look like siblings under the same pen tip.
const SIDE_STEPS = 8;

// (Local protrude constants + protrudeForLocal defined further down — used
// by all shape samplers in this file.)

/**
 * Jittered point sequence along a straight line. Mirrors the playground's
 * pattern for shapes (per-side jittered samples). Endpoint behavior pushes the
 * line ends out along the segment direction; loose-overlap pushes them further
 * (per-layer). Same SIDE_STEPS as rects so the pen-tip width reads as a
 * sibling stroke when other primitives are visible.
 */
export function roughLinePoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rough: number,
  seed: number,
  mods: ShapeModifiers = {},
  protrudeScale: number = 1.0,
): Array<[number, number]> {
  const r = seededRandom(seed);
  const j = () => jitter(r, rough);
  const protrude = protrudeForLocal(mods.endpointBehavior) * protrudeScale;
  const looseOffset =
    mods.sketchingStyle === 'loose-overlap' && mods.layerIndex
      ? mods.layerIndex * LOCAL_LOOSE_OVERLAP * protrudeScale
      : 0;
  const totalShift = protrude + looseOffset;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const sx1 = x1 - ux * totalShift;
  const sy1 = y1 - uy * totalShift;
  const sx2 = x2 + ux * totalShift;
  const sy2 = y2 + uy * totalShift;
  const points: Array<[number, number]> = [];
  const steps = SIDE_STEPS;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    points.push([sx1 + (sx2 - sx1) * t + j(), sy1 + (sy2 - sy1) * t + j()]);
  }
  return points;
}

/**
 * Closed loop of jittered points around an arbitrary polygon. Endpoint
 * behavior protrudes each vertex radially outward from the polygon centroid
 * (matches the way rect/diamond push corners outward). Loose-overlap nudges
 * endpoints of each side along the side direction. SIDE_STEPS jittered samples
 * per side; loop closes by repeating the first vertex's jittered position.
 *
 * Accepts >=3 vertices. Returns a closed point loop suitable for
 * perfect-freehand (pen-tip mode) or for rendering as a polyline path.
 */
export function roughPolygonPoints(
  vertices: Array<[number, number]>,
  rough: number,
  seed: number,
  mods: ShapeModifiers = {},
  protrudeScale: number = 1.0,
): Array<[number, number]> {
  if (vertices.length < 3) return vertices.slice();
  const r = seededRandom(seed);
  const j = () => jitter(r, rough);
  const protrude = protrudeForLocal(mods.endpointBehavior) * protrudeScale;
  // Centroid for radial protrude. Simple average works well for the convex /
  // mildly-concave polygons we get from SVG <polygon> in practice.
  let cx = 0;
  let cy = 0;
  for (const [vx, vy] of vertices) {
    cx += vx;
    cy += vy;
  }
  cx /= vertices.length;
  cy /= vertices.length;

  // Protrude each vertex radially outward from the centroid by `protrude`
  // pixels along the (vertex - centroid) direction.
  const protruded: Array<[number, number]> = vertices.map(([vx, vy]) => {
    if (protrude === 0) return [vx, vy];
    const dx = vx - cx;
    const dy = vy - cy;
    const len = Math.max(1, Math.hypot(dx, dy));
    return [vx + (dx / len) * protrude, vy + (dy / len) * protrude];
  });

  const looseOffset =
    mods.sketchingStyle === 'loose-overlap' && mods.layerIndex
      ? mods.layerIndex * LOCAL_LOOSE_OVERLAP * protrudeScale
      : 0;

  const points: Array<[number, number]> = [];
  const n = protruded.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = protruded[i];
    const [bx, by] = protruded[(i + 1) % n];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const aShift: [number, number] = [ax - ux * looseOffset, ay - uy * looseOffset];
    const bShift: [number, number] = [bx + ux * looseOffset, by + uy * looseOffset];
    for (let s = 0; s < SIDE_STEPS; s++) {
      const t = s / SIDE_STEPS;
      points.push([aShift[0] + (bShift[0] - aShift[0]) * t + j(), aShift[1] + (bShift[1] - aShift[1]) * t + j()]);
    }
  }
  // Close the loop by repeating the first vertex's jittered position.
  points.push([protruded[0][0] + j(), protruded[0][1] + j()]);
  return points;
}

/**
 * Render a polyline of [x, y] points as an SVG path string.
 *
 * When `bowing` and `curveDamp` are 0, emits straight L segments (fast path).
 *
 * When `bowing > 0`, each segment between consecutive points becomes a quadratic
 * Bezier (Q) curve with a control point at the segment midpoint offset
 * perpendicular to the segment direction. Offset magnitude = `bowing × segLen × 0.08`
 * with seeded sign so the curve direction is deterministic but varied.
 *
 * `curveDamp > 0` DAMPENS the offset (tighter curves = less bowing visible).
 * At curveDamp = 1, offset is halved. At curveDamp = 2, offset is ~0.
 *
 * This makes the Bowing + Curve sliders affect the polyline output of hand-feel
 * primitives, not just rough.js path elements.
 */
export function pointsToPolylinePath(
  points: Array<[number, number]>,
  closed: boolean,
  bowing: number = 0,
  curveDamp: number = 0,
  seed: number = 0,
  /** Per I-11: wobble's contribution to control-point jitter. Mirrors playground
   *  roughOvalPath/roughRectPath where C command control points are also jittered
   *  by `j()` (line 277 of playground handFeel.ts). That control-point jitter
   *  is WHY playground wobble produces bent wandering lines instead of kinks.
   *  Pass size-clamped `effectiveWobble` here (not raw m.wobble) so small pins
   *  don't shred. Bowing slider remains independent — adds Q-bezier displacement
   *  on top of wobble's jitter. */
  wobble: number = 0,
): string {
  if (points.length === 0) return '';
  const f = (n: number) => n.toFixed(2);

  // Fast path: no curve modifiers, emit straight L segments.
  if (bowing <= 0.01 && curveDamp <= 0.01 && wobble <= 0.01) {
    let d = `M ${f(points[0][0])} ${f(points[0][1])}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${f(points[i][0])} ${f(points[i][1])}`;
    }
    if (closed) d += ' Z';
    return d;
  }

  // Cubic-Bezier path matching playground's roughRectPath pattern (handFeel.ts:202-205):
  // each segment gets TWO control points at 1/3 and 2/3 along segment, BOTH jittered.
  // Two jittered control points per cubic give far more bending freedom than one
  // jittered control point per Q-bezier — playground's "line bends entirely" character
  // comes from this. Bowing adds extra perpendicular displacement to control points.
  const r = seededRandom(seed || 1);
  const tightnessDamp = Math.max(0.1, 1 - curveDamp * 0.45);
  const effectiveBow = bowing * tightnessDamp;
  // Wobble control-point jitter amp. Playground uses `j() * 1.4` where j returns
  // ±ROUGH (= HAND_FEEL_BASE.rect * wobble = 2.4 * wobble). So playground's scale
  // is wobble * 2.4 * 1.4 ≈ 3.4. We match that scale exactly.
  const wobbleJitterAmp = wobble * tightnessDamp * 3.4;
  let d = `M ${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const useCurve = len > 0.5 && (effectiveBow > 0.01 || wobbleJitterAmp > 0.01);
    if (useCurve) {
      const perpX = -dy / len;
      const perpY = dx / len;
      const sign = r() > 0.5 ? 1 : -1;
      // Bowing's perpendicular offset, applied to both control points so the curve
      // bends symmetrically (vs Q-bezier asymmetric bend with one control)
      const bowOffset = effectiveBow * len * 0.06 * sign;
      // Two control points along segment at 1/3 and 2/3, each with independent
      // 2D wobble jitter (mirrors playground line 202-203 exactly).
      const cp1x = x1 + dx / 3 + perpX * bowOffset + jitter(r, wobbleJitterAmp);
      const cp1y = y1 + dy / 3 + perpY * bowOffset + jitter(r, wobbleJitterAmp);
      const cp2x = x1 + 2 * dx / 3 + perpX * bowOffset + jitter(r, wobbleJitterAmp);
      const cp2y = y1 + 2 * dy / 3 + perpY * bowOffset + jitter(r, wobbleJitterAmp);
      d += ` C ${f(cp1x)} ${f(cp1y)}, ${f(cp2x)} ${f(cp2y)}, ${f(x2)} ${f(y2)}`;
    } else {
      d += ` L ${f(x2)} ${f(y2)}`;
    }
  }
  if (closed) d += ' Z';
  return d;
}
