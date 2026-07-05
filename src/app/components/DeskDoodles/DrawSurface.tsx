import { useEffect, useMemo, useRef, useState } from 'react';
import { getStroke } from 'perfect-freehand';
import { IS } from '../../lib/typography';
import { PILL, CTA } from '../../lib/chromeStyles';
import { SvgStyleTransform } from '../canvas/SvgStyleTransform';
import {
  prepareSvgUpload,
  applyUploadSimplify,
  defaultSimplifyMode,
  type UploadSimplifyMode,
} from '../../lib/svgUpload';
import { simplifyToSketch } from '../../lib/simplifyToSketch';
import type { SvgPart } from '../../lib/svgToParts';
import { imageToSvg, isRasterImageFile } from '../../lib/imageToSvg';
import { COVERAGE_BANDS } from '../../lib/smart/coverage';
import {
  createToneGrid,
  beginToneStroke,
  stampToneCapsule,
  extractToneFills,
  rasterizeToneFills,
  rasterizeFillPatch,
  smoothFillEdges,
  type ToneMaskGrid,
  type ToneFill,
} from '../../lib/toneMask';
import {
  extractPoolRegions,
  pointInLoop,
  poolCenter,
  normalizeStrokePoints,
  rdpPoints,
  strokesKey,
  RDP_EPSILON,
  WORLD_SCALE,
  SOLID_INK_RADIUS,
  SOLID_MAX_GRID_RESOLUTION,
  REGION_EXTRACTOR_VERSION,
  type StrokeInputPoint,
} from '../../lib/geometry3d/strokeTo3d';
import { fillRegionAtMultiScale, DEFAULT_GAP_CLOSE_PX } from '../../lib/fill/regionFill';
import { pushShadeFillEntry, type ShadeFillGesture } from '../../lib/shadeFillLog';
import {
  fitStroke,
  applyCandidate as applyShapeCandidate,
  type ShapeCandidate,
  type ShapeFitResult,
  type SnapAction,
} from '../../lib/draw/shapeFit';
import { generateShape } from '../../lib/draw/shapeLibrary';

// ─── Shape Assist API (Rock F3) ──────────────────────────────────────────────
// SEBS'S LAW: freehand is the DEFAULT. Snap/Straighten are ACTION VERBS the
// host's chrome pills invoke on the LAST stroke ON DEMAND — never on pen-up,
// never auto. DrawSurface owns `strokes`, so it owns the apply; the host owns
// the chip (rendered by the pills, per the toggles-in-chrome rule). This API
// is the seam: the host fits + applies + cycles through it, never reaching into
// stroke state directly. `originalPoints` lets the host restore the drawn
// stroke (chip → Original) without DrawSurface keeping per-stroke undo memory.
export interface ShapeSnapApi {
  /** The stroke Snap/Straighten will target — the SELECTED stroke if the user
   *  tapped an earlier one, else the LAST committed stroke (spec §3 + round-8
   *  "select different part"). Null when none exists. The name stays `lastStroke`
   *  so the host's existing call site is unchanged; "target stroke" is the
   *  precise meaning now. */
  lastStroke: () => { id: string; points: StrokePoint[] } | null;
  /** Fit the TARGET stroke (selected, else last) under the given action — pure,
   *  no mutation. The host decides whether to apply (accept) or surface a
   *  refusal note. */
  fitLast: (action: SnapAction) => { strokeId: string; result: ShapeFitResult } | null;
  /** Replace a stroke's points with a candidate's clean geometry (Apply /
   *  chip cycle). Pass the chip's remembered ORIGINAL points for the candidate
   *  kind 'original' (restore). Stays a stroke — same id, renders in the pen. */
  applyToStroke: (strokeId: string, candidate: ShapeCandidate, originalPoints: StrokePoint[]) => void;
}

// ─── DrawSurface — pointer-event freehand capture + SvgStyleTransform render ──
// Extracted 2026-06-11 from DeskDoodlesCanvas.tsx (mechanical move, zero
// behavior change on /canvas). Hosted by BOTH the /canvas page and the
// DrawPanel popup in the real desk flow (/desk).

export type StrokePoint = [number, number, number]; // x, y, pressure
export type Stroke = { id: string; points: StrokePoint[] };

export type CanvasMode = 'svg' | '3d';
export type InputMode = 'draw' | 'upload-svg' | 'upload-image';

// The draw frame's coordinate space — every stroke is captured in these
// viewBox units (module-scope so the backdrop compose helpers below share
// the exact same space as the component's capture svg).
export const VIEWBOX_W = 800;
export const VIEWBOX_H = 600;

/** Fit a set of stored strokes into the draw frame (CASE-2 redraw bug). Strokes
 *  are captured in raw VIEWBOX_W×VIEWBOX_H space, but a doodle drawn small/offset
 *  (or spanning past the edges) reloads into the redraw canvas tiny/displaced or
 *  cut off — NOT matching the tight-bbox card view. Scale+center the gesture's
 *  bbox to fill the frame (minus pad), preserving aspect. The save path
 *  (strokesToObjectMarkup) re-derives a tight bbox at Done, so this only affects
 *  the editing view, never the persisted markup. Verified visually (small/offset
 *  + edge-spanning fixtures) before wiring. */
export function fitStrokesToFrame(
  strokes: StrokePoint[][],
  frameW = VIEWBOX_W,
  frameH = VIEWBOX_H,
  pad = 40,
): StrokePoint[][] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const [x, y] of s) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const sw = maxX - minX, sh = maxY - minY;
  if (!(sw > 0) && !(sh > 0)) return strokes; // single point / empty — leave as-is
  const availW = frameW - pad * 2, availH = frameH - pad * 2;
  const scale = Math.min(availW / (sw || 1), availH / (sh || 1));
  const offX = pad + (availW - sw * scale) / 2 - minX * scale;
  const offY = pad + (availH - sh * scale) / 2 - minY * scale;
  return strokes.map((s) =>
    s.map(([x, y, p]): StrokePoint => [x * scale + offX, y * scale + offY, p ?? 0.5]),
  );
}

export const STROKE_OPTS = {
  size: 4,
  thinning: 0.5,
  // streamline/smoothing RAISED 0.5→0.78/0.7 (Sebs 2026-06-20: "gets all jaggedy
  // as I draw"). Real trackpad/pen input carries hand+sensor jitter; at 0.5 that
  // jitter passed straight through into a faceted ribbon (measured: 117 sharp
  // turns on noisy input). 0.78 streamline = perfect-freehand's input EMA smooths
  // the jitter out (→ 14 sharp turns, visibly smooth) with only a slight,
  // drawing-app-normal trail behind the cursor. Was NOT my buttery change — the
  // live preview was always under-smoothed; a clean synthetic curve hid it.
  smoothing: 0.7,
  streamline: 0.78,
  easing: (t: number) => t,
  simulatePressure: true,
};

/** Reduced-size stroke opts used ONLY to build the fill-CLIP ink outline (not
 *  the visible ink). The visible ink renders at STROKE_OPTS (size 4); clipping
 *  the tone to a thinner outline lands the grey at ~the ink centerline — clearly
 *  UNDER the visible black band, not touching its outer edge (Sebs caught grey
 *  reading "slightly past the line" on straight edges/corners at zoom). Grey
 *  still reaches under the ink (no sliver — black covers centerline→outer) but
 *  never near the visible outer edge (no past-the-line). getStroke inset, not
 *  erosion, so corners stay sharp. */
export const FILL_CLIP_STROKE_OPTS = { ...STROKE_OPTS, size: STROKE_OPTS.size * 0.7 };

/** Convert raw stroke points to a perfect-freehand polygon d-string.
 *  Used for the FOREGROUND live-stroke and CLEAN-style background render —
 *  produces the variable-width inked-stroke look. */
export function strokeToPolygonPath(points: StrokePoint[]): string {
  if (points.length === 0) return '';
  const outline = getStroke(points, STROKE_OPTS);
  if (outline.length === 0) return '';
  return outline.reduce(
    (acc, [x, y], i) => acc + (i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`),
    '',
  ) + ' Z';
}

/** Convert raw stroke points to a stroke-only polyline d-string (no fill).
 *  Used for the BACKGROUND Smart-Hachure-styled render — Smart Hachure's
 *  outline pipeline filters out filled paths, so we feed it a stroke-only
 *  version of the user's gesture instead. Loses variable-width character
 *  but gains style-pipeline transformability (wobble / jaggedness / etc). */
/** Build the stroke-only SVG markup for ONE desk object — the polyline
 *  commit-layer form (fill="none" + stroke) that survives Smart Hachure,
 *  same shape as /canvas's committed layer (its outline pipeline drops
 *  filled paths). The viewBox is the tight bbox of the gesture (+pad) so
 *  normalizeSvgSize at the desk's add boundary scales the DOODLE to
 *  ~180px, not the whole 800×600 draw frame. */
export function strokesToObjectMarkup(strokes: Stroke[], toneFills: ToneFill[] = []): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const [x, y] of stroke.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  // Tone patches join the tight bbox — a brushed region can extend past the
  // ink, and clipping a band statement would silently rewrite it.
  for (const fill of toneFills) {
    for (const [x, y] of fill.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  // 3D-2: no strokes + no tone (e.g. svg-port requested on a pure UPLOAD where
  // the drawn-stroke pool is empty) leaves the bbox at Infinity → viewBox=
  // "Infinity Infinity …" (browser parse error). Emit nothing; callers fall back.
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return '';
  const pad = 6; // breathing room for the 3px stroke + round caps
  const r = (v: number) => (Math.round(v * 100) / 100).toString();
  const vb = `${r(minX - pad)} ${r(minY - pad)} ${r(maxX - minX + pad * 2)} ${r(maxY - minY + pad * 2)}`;
  // Tone UNDER ink: patches first in document order, strokes paint on top.
  const tonePaths = toneFillsMarkup(toneFills);
  const paths = strokes
    .map(
      (stroke) =>
        `<path d="${strokeToPolylinePath(stroke.points)}" fill="none" stroke="var(--dir-text-primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${tonePaths}${paths}</svg>`;
}

/** Size-guard a stroke record (strokes-in-the-record contract): round coords,
 *  then halve point density until the JSON fits the row budget (~45KB). */
export function capStrokes(raw: Stroke[]): StrokePoint[][] {
  let pts: StrokePoint[][] = raw.map((st) =>
    st.points.map(([x, y, pr]) => [
      Math.round(x * 10) / 10,
      Math.round(y * 10) / 10,
      Math.round(pr * 100) / 100,
    ] as StrokePoint),
  );
  while (JSON.stringify(pts).length > 45000) {
    const before = JSON.stringify(pts).length;
    pts = pts.map((st) =>
      st.length > 8 ? st.filter((_, i) => i % 2 === 0 || i === st.length - 1) : st,
    );
    if (JSON.stringify(pts).length >= before) break;
  }
  return pts;
}

export function strokeToPolylinePath(points: StrokePoint[]): string {
  if (points.length === 0) return '';
  return points.reduce(
    (acc, [x, y], i) => acc + (i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`),
    '',
  );
}

/** Squared distance from point p to segment ab (viewBox px²). Used by the
 *  tap-to-select hit test (round-8 stroke selection). */
function distSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/** Nearest stroke to a tapped point within a hit radius (viewBox px) — the
 *  tap-to-select hit test (round-8 "select a different part"). Returns the
 *  stroke id, or null if the tap landed on bare paper. Ties break to the
 *  CLOSEST stroke (min distance), so overlapping strokes pick the one under
 *  the finger. */
export function strokeAtPoint(
  strokes: Stroke[],
  x: number,
  y: number,
  hitRadiusPx: number,
): string | null {
  const hit2 = hitRadiusPx * hitRadiusPx;
  let bestId: string | null = null;
  let bestD = Infinity;
  for (const s of strokes) {
    const pts = s.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = distSqToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (d < bestD) {
        bestD = d;
        bestId = s.id;
      }
    }
    // A single-point stroke: distance to the point.
    if (pts.length === 1) {
      const d = (x - pts[0][0]) ** 2 + (y - pts[0][1]) ** 2;
      if (d < bestD) {
        bestD = d;
        bestId = s.id;
      }
    }
  }
  return bestD <= hit2 ? bestId : null;
}

/** Ray-cast point-in-polygon over a stroke's points treated as a CLOSED ring.
 *  Used for the big interior select target (Sebs 2026-06-15: "I need a bigger
 *  hit target… click anywhere in the shape to select it"). Reliable for closed
 *  shapes (snapped / inserted); open scribbles fall back to outline proximity. */
function pointInStroke(pts: ReadonlyArray<readonly number[]>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    const denom = yj - yi || 1e-9;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / denom + xi) inside = !inside;
  }
  return inside;
}

/** The stroke whose CLOSED area contains (x,y), SMALLEST bbox-area first so a
 *  nested / topmost small shape wins over a big enclosing one. Null if none.
 *  This is the interior half of tap-select — a tap anywhere inside a shape picks
 *  it, not just a tap on the thin outline. */
export function strokeContainingPoint(strokes: Stroke[], x: number, y: number): string | null {
  let bestId: string | null = null;
  let bestArea = Infinity;
  for (const s of strokes) {
    if (s.points.length < 3) continue;
    if (!pointInStroke(s.points, x, y)) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of s.points) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea) { bestArea = area; bestId = s.id; }
  }
  return bestId;
}

/** The TONE PATCH whose filled area contains (x,y) — smallest bbox-area first so a
 *  nested patch wins, and a tap inside a hole doesn't count (Sebs 2026-06-16 "move
 *  shade as well"). Null if the tap is on bare paper / inside a hole. Mirrors
 *  strokeContainingPoint for tone selection. */
function toneFillAtPoint(fills: ToneFill[], x: number, y: number): string | null {
  let bestId: string | null = null;
  let bestArea = Infinity;
  for (const f of fills) {
    if (f.points.length < 3) continue;
    if (!pointInStroke(f.points, x, y)) continue;
    if (f.holes?.some((h) => h.length >= 3 && pointInStroke(h, x, y))) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of f.points) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea) { bestArea = area; bestId = f.id; }
  }
  return bestId;
}

// ─── TONE-FILL BRUSH (the SHADE register — round 7, band-mask rebuild R2) ─────
// The explicit shading input (mark-intent spec §4: "the tone-fill brush is the
// explicit register and ALWAYS beats inference" — D2-F). The user brushes TONE
// in the discrete 8-band ladder (`coverage.ts` COVERAGE_BANDS — one band table,
// every renderer). Storage per conversion-semantics-addendum ch.2.1:
// `render_config.toneFills: Array<{ id, points (brushed outline, viewBox
// coords), band }>` — a SIBLING of strokes, band INDEX not raw alpha, never
// only-baked-into-the-svg (the record keeps the tone editable; the svg is
// always regenerable from strokes + toneFills, same contract as strokes).
//
// SESSION-TIME SOURCE OF TRUTH (shade-brush-behavior-spec §2 — the C1/C2/C3
// fix): a per-cell BAND GRID in lib/toneMask.ts, not this patch list. The
// brush stamps the grid through the ratified marker-model table (§3); pen-lift
// extracts merged per-band island outlines (pool-raster contours, holes as
// evenodd subpaths) into this same record shape — fewer, bigger patches,
// non-self-intersecting by construction. The ToneFill type now lives with the
// grid (re-exported here so every existing importer keeps working).

export type { ToneFill } from '../../lib/toneMask';

/** sRGB transfer function (linear → gamma-encoded channel value 0..1). */
function srgbFromLinear(lin: number): number {
  return lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
}

/** Flat band-grey per COVERAGE_BANDS index — derived from the band table, not
 *  hardcoded, so a re-banding upstream re-derives the greys (one band table).
 *  Inverse of the signals-layer darkness read: smartHachure/signals.ts
 *  computes darknessL = 1 − OKLab L of the fill, and for pure greys OKLab
 *  L ≈ cbrt(linearRGB) (the LMS matrix rows each sum to ~1.0, so greys pass
 *  through unmixed). Solving for the band's darkness MIDPOINT:
 *  lin = (1 − dMid)³ → grey = srgbFromLinear(lin). Round-trip verified:
 *  every hex below re-quantizes to its own band via bandIndexForDarkness.
 *  Index 0 is null — paper is absence, the brush never paints it. */
export const TONE_BAND_HEX: readonly (string | null)[] = COVERAGE_BANDS.map((b, i) => {
  if (i === 0) return null; // paper = erase, never painted
  const dMid = (b.darknessMin + b.darknessMax) / 2;
  const lin = Math.pow(1 - dMid, 3);
  const g = Math.max(0, Math.min(255, Math.round(srgbFromLinear(lin) * 255)));
  const h = g.toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
});

// Brush sweep options — pressure-flat (a tone brush has no thinning; the
// radius slider IS the width), deterministic for the same input points.
const TONE_BRUSH_OPTS = {
  thinning: 0,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: false,
  easing: (t: number) => t,
};

// LIVE-PREVIEW outline resolution cap (the while-pen-down capsule sweep only —
// SB-6: committed patches come from the grid extraction in lib/toneMask,
// capped at TONE_MASK_MAX_PTS=128 there).
const TONE_OUTLINE_MAX_PTS = 64;
// Whole-record budget for render_config.toneFills (sibling of the ~45KB
// strokes budget — tone is the smaller passenger by design).
const TONE_FILLS_JSON_BUDGET = 24000;

/** Sweep a brush centerline into the patch's closed outline polygon —
 *  perfect-freehand with size = 2×radius (the capsule-swept "soft region").
 *  Decimated to ≤ TONE_OUTLINE_MAX_PTS and rounded to 0.1px so the stored
 *  geometry is compact and deterministic. */
export function toneOutline(centerline: [number, number][], radius: number): [number, number][] {
  if (centerline.length === 0) return [];
  const swept = getStroke(
    centerline.map(([x, y]) => [x, y, 0.5]),
    { ...TONE_BRUSH_OPTS, size: Math.max(2, radius * 2) },
  );
  let pts = swept.map(
    ([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number],
  );
  while (pts.length > TONE_OUTLINE_MAX_PTS) {
    pts = pts.filter((_, i) => i % 2 === 0);
  }
  return pts;
}

/** Size-guard the toneFills record (mirror of capStrokes): round coords, then
 *  halve outline density (floor 12 pts — the patch must stay a region) until
 *  the JSON fits the budget. Never drops a patch — band statements are user
 *  data; only their outline resolution softens. Holes ride the same rounding
 *  + decimation (floor 8 — holes are smaller loops by nature); `src`
 *  provenance passes through untouched. */
export function capToneFills(raw: ToneFill[]): ToneFill[] {
  const round2 = (pts: [number, number][]) =>
    pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]);
  let fills: ToneFill[] = raw.map((f) => ({
    id: f.id,
    band: f.band,
    points: round2(f.points),
    ...(f.holes && f.holes.length > 0 ? { holes: f.holes.map(round2) } : {}),
    ...(f.src ? { src: f.src } : {}),
  }));
  while (JSON.stringify(fills).length > TONE_FILLS_JSON_BUDGET) {
    const before = JSON.stringify(fills).length;
    const halve = (pts: [number, number][], floor: number) =>
      pts.length > floor ? pts.filter((_, i) => i % 2 === 0) : pts;
    fills = fills.map((f) => ({
      ...f,
      points: halve(f.points, 12),
      ...(f.holes ? { holes: f.holes.map((hl) => halve(hl, 8)) } : {}),
    }));
    if (JSON.stringify(fills).length >= before) break;
  }
  return fills;
}

/** Closed polygon d-string for one loop. */
function loopD(points: [number, number][]): string {
  return (
    points.reduce(
      (acc, [x, y], i) =>
        acc + (i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`),
      '',
    ) + ' Z'
  );
}

/** Patch d-string: outer outline + hole loops as separate subpaths — paired
 *  with fill-rule="evenodd" everywhere it renders (spec §2: holes mirror the
 *  extractor's outer/hole roles in ONE path). */
function tonePathD(points: [number, number][], holes?: [number, number][][]): string {
  let d = loopD(points);
  if (holes) for (const hl of holes) d += ` ${loopD(hl)}`;
  return d;
}

/** Stable paint order for patches: band ASCENDING (darker paints over
 *  lighter), creation order within a band (Array.sort is stable). Flat per
 *  band — overlap inside one band never compounds, so the render never mints
 *  a band the user didn't brush (addendum ch.2.3 "never average"). */
export function sortedToneFills(toneFills: ToneFill[]): ToneFill[] {
  return [...toneFills].sort((a, b) => a.band - b.band);
}

// ─── REGION FILL — extractor-backed Fill + freehand Lasso (rock F2) ──────────
// docs/design/region-fill-spec.md (D-RF1..D-RF7 ratified): three tools, one
// engine, one output type — everything commits as a ToneFill band patch into
// the SAME band grid the brush stamps (replace-on-refill, eraser carve and
// brush composition all compose for free; never average, never stack).
//
// THE TOPOLOGY CHOICE (spec §2/§6 made concrete): Fill runs the pool-raster
// extractor in INK-ONLY topology — `closedFlags` all false, NO closure-state
// scanline fill. Closure flags are the 3D conversion's MASS semantic (a
// near-closed stroke welds into a slab); the fill semantic is ENCLOSURE, and
// with ink-only rasterization the enclosed paper shows up as the odd-depth
// loops of the containment-parity tree while the ink-stamp radius stays the
// ONLY gap-closer — exactly "the ink radius IS the tolerance". Under closure
// flags the Gap slider would be a lie for single strokes (a 20px-gap circle
// scanline-fills at ANY tolerance) and a donut would collapse to a disc.
//
// Fill targets are the ODD-depth (paper) regions — D-RF4's "a hole is paper
// the user may want toned", generalized: in ink-only topology every enclosed
// paper area IS an odd-parity loop. Even-depth regions are ink bodies; a tap
// on one (tap exactly ON a line, tap on a dropped-tiny-region) is an honest
// miss, never an invisible under-ink patch.

/** Gap-tolerance ladder — multiplier on the extractor's ink-stamp radius
 *  (spec §6: 6 ticks per feedback_more_toggle_options_better; default 1× =
 *  SOLID_INK_RADIUS parity with the 3D conversion). */
export const GAP_LADDER: readonly number[] = [0.5, 0.75, 1, 1.5, 2, 3, 4.5, 6];

/** Nearest ladder index for a stored multiplier (slider round-trip). */
export function gapIdxOf(gap: number): number {
  let best = 2; // 1×
  let bestD = Infinity;
  for (let i = 0; i < GAP_LADDER.length; i++) {
    const d = Math.abs(GAP_LADDER[i] - gap);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** One extractor region mapped into the draw frame (viewBox px) — the
 *  world→viewBox inverse adapter output (spec §2: "the inverse of
 *  normalizeStrokePoints applied to outline — a ~15-line adapter, not a new
 *  extractor"). */
export type FillRegion = {
  /** Closed outline, draw-frame viewBox px (RDP+Chaikin from the extractor). */
  outline: [number, number][];
  /** Containment depth — ink-only topology: even = ink body, odd = paper. */
  depth: number;
  role: 'outer' | 'hole';
  parentIndex: number | null;
  areaWorld: number;
};

/** 2D FILL lane grid resolution — finer than the 3D/solid 200 cap so small
 *  NESTED features (two triangles inside a circle) survive as distinct fill
 *  regions (D1/D2). SAFE because extractFillRegions runs the extractor PER
 *  spatially-disjoint cluster, sizing the grid to ONE shape's bbox — not the
 *  whole-canvas union (the union is what the old global 420 overflowed). */
const FILL_GRID_RESOLUTION = 400;

/** Run the pool-raster extractor over the stroke pool at a gap multiplier and
 *  map the region tree back into viewBox px. Deterministic; cache by
 *  (strokesKey, gapIdx) — per ladder STEP, never per pointermove (spec §6). */
export function extractFillRegions(strokes: Stroke[], gapMult: number): FillRegion[] {
  const raw = strokes.map((s) => s.points).filter((s) => s.length > 0);
  if (raw.length === 0) return [];
  const viewBox = { w: VIEWBOX_W, h: VIEWBOX_H };
  const simplified = raw.map((s) => rdpPoints(s, RDP_EPSILON));

  // MULTI-SHAPE FIX (Sebs: fill "doesn't detect which region with multiple
  // shapes"): extractPoolRegions' grid cell = max(span)/resolution over the bbox
  // it is handed, so feeding ALL strokes sizes ONE grid to the union bbox of
  // every shape on the canvas — two shapes far apart each get only a fraction of
  // the resolution and their enclosures starve. Cluster strokes into spatially-
  // disjoint connected components (union-find on bboxes grown by the ink gap) and
  // extract EACH cluster at full resolution over its own tight bbox, then merge
  // the region trees. Disjoint clusters can never contain one another, so
  // parentIndex stays in-cluster, offset by the running region count. A single
  // shape = one cluster = identical to the old path (zero regression). Nested
  // shapes share a cluster and so its full local resolution.
  const bbs = simplified.map((s) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of s) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    return [minX, minY, maxX, maxY] as [number, number, number, number];
  });
  const gapPx = (SOLID_INK_RADIUS * gapMult) / WORLD_SCALE + 8;
  const parent = simplified.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let i = 0; i < bbs.length; i++) {
    for (let j = i + 1; j < bbs.length; j++) {
      const a = bbs[i], b = bbs[j];
      // bboxes (grown by gapPx) overlap → same shape/cluster.
      if (a[2] + gapPx >= b[0] && b[2] + gapPx >= a[0] && a[3] + gapPx >= b[1] && b[3] + gapPx >= a[1]) {
        parent[find(i)] = find(j);
      }
    }
  }
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < simplified.length; i++) {
    const r = find(i);
    const g = clusters.get(r);
    if (g) g.push(i);
    else clusters.set(r, [i]);
  }

  const out: FillRegion[] = [];
  for (const idxs of clusters.values()) {
    const cs = idxs.map((i) => simplified[i]);
    const center = poolCenter(cs, viewBox);
    const world = cs.map((s) => normalizeStrokePoints(s, viewBox, WORLD_SCALE, center));
    const extraction = extractPoolRegions(world, {
      inkRadius: SOLID_INK_RADIUS * gapMult,
      // INK-ONLY TOPOLOGY: enclosure comes from the stamped ink alone — the gap
      // slider is the only thing that closes gaps.
      closedFlags: world.map(() => false),
      // FILL-CONFORM (2026-06-13): crisp = keep the drawn shape's SHARP corners
      // so a rectangle fills as a rectangle, not a blob.
      crisp: true,
      // Per-cluster bbox sizes the grid to THIS shape, so a FINER grid is safe
      // (the old global 420 broke enclosure because it spanned the whole canvas;
      // per-cluster it doesn't). The finer FILL grid lets small NESTED features —
      // two triangles inside a circle — survive as distinct regions (D1/D2) so a
      // tap fills the region you picked, inner shapes knocked out.
      resolution: FILL_GRID_RESOLUTION,
      maxResolution: FILL_GRID_RESOLUTION,
    });
    // world→viewBox inverse (per this cluster's center): x = wx/s + cx, y = cy − wy/s.
    const toVb = ([wx, wy]: [number, number]): [number, number] => [
      Math.round((wx / WORLD_SCALE + center.x) * 10) / 10,
      Math.round((center.y - wy / WORLD_SCALE) * 10) / 10,
    ];
    const base = out.length;
    for (const r of extraction.regions) {
      out.push({
        outline: r.outline.map(toVb),
        depth: r.depth,
        role: r.role,
        parentIndex: r.parentIndex === null ? null : r.parentIndex + base,
        areaWorld: r.areaWorld,
      });
    }
  }
  return out;
}

/** True if any point of `pts` comes within `margin` px of the patch `outline` —
 *  the precise "this stroke BORDERS the patch" test. Replaces bbox-overlap,
 *  which wrongly kept a LARGE stroke whose bbox merely CONTAINS a small nested
 *  patch (the outer circle around an inner shape): the rasterizer's ink-conform
 *  treats every supplied ink as an enclosing wall, so the big circle's ink made
 *  the fill grow out to the WHOLE outer region instead of the tapped inner shape
 *  (the nested-fill bug). The outline is subsampled (≤120 probes) for speed. */
function strokeBordersOutline(
  pts: readonly (readonly number[])[],
  outline: [number, number][],
  margin: number,
): boolean {
  if (outline.length === 0) return false;
  const m2 = margin * margin;
  const stride = Math.max(1, Math.floor(outline.length / 120));
  for (const [sx, sy] of pts) {
    for (let i = 0; i < outline.length; i += stride) {
      const dx = sx - outline[i][0];
      const dy = sy - outline[i][1];
      if (dx * dx + dy * dy <= m2) return true;
    }
  }
  return false;
}

/** Ink CENTERLINE polylines (raw stroke points, viewBox px) of the strokes
 *  whose bbox plausibly BORDERS a fill region — the clean-edge conform input.
 *
 *  The fill is grown up to the centerline (the raw gesture path the ink is
 *  drawn ON, half the ink width inside the visible OUTER edge): tone-at-
 *  centerline is always covered by the ink-on-top (NO white sliver) and always
 *  half-a-width inside the outer edge (NO bleed past the outline), and the
 *  centerline carries the drawing's true sharp corners.
 *
 *  The region outline sits ~inkRadius·gap px INSIDE the ink centerline, so a
 *  stroke borders the region if its bbox is within that inset of the region's
 *  bbox. Pre-filtering by bbox (not feeding ALL strokes) keeps the rasterizer
 *  window tight and prevents the fill from welding to unrelated far-away ink. */
function strokeCenterlinesNear(
  strokes: Stroke[],
  regionOutline: [number, number][],
  gapMult: number,
): [number, number][][] {
  if (regionOutline.length < 3) return [];
  let rMinX = Infinity;
  let rMinY = Infinity;
  let rMaxX = -Infinity;
  let rMaxY = -Infinity;
  for (const [x, y] of regionOutline) {
    if (x < rMinX) rMinX = x;
    if (x > rMaxX) rMaxX = x;
    if (y < rMinY) rMinY = y;
    if (y > rMaxY) rMaxY = y;
  }
  // The gap inset (viewBox px) the boundary is pushed inward, + ink half-width
  // + a couple of cells of slack so the bbox test never drops bordering ink.
  const margin = (SOLID_INK_RADIUS * gapMult * 3) / WORLD_SCALE + 8;
  const lines: [number, number][][] = [];
  for (const s of strokes) {
    if (s.points.length < 2) continue;
    let sMinX = Infinity;
    let sMinY = Infinity;
    let sMaxX = -Infinity;
    let sMaxY = -Infinity;
    for (const [x, y] of s.points) {
      if (x < sMinX) sMinX = x;
      if (x > sMaxX) sMaxX = x;
      if (y < sMinY) sMinY = y;
      if (y > sMaxY) sMaxY = y;
    }
    // bbox-overlap with the region bbox grown by the inset margin.
    if (
      sMaxX < rMinX - margin ||
      sMinX > rMaxX + margin ||
      sMaxY < rMinY - margin ||
      sMinY > rMaxY + margin
    ) {
      continue;
    }
    // PRECISE border test (nested-fill fix): a stroke whose bbox merely CONTAINS
    // the patch (the outer circle around an inner shape) must NOT be treated as
    // bordering ink — it would make the conform fill the whole outer region.
    if (!strokeBordersOutline(s.points, regionOutline, margin)) continue;
    lines.push(s.points.map(([x, y]) => [x, y] as [number, number]));
  }
  return lines;
}

/** Ink OUTLINE polygons (the EXACT visible perfect-freehand ink boundary,
 *  viewBox px) of the strokes whose bbox plausibly BORDERS a fill region — the
 *  clean-edge conform input (2026-06-13 rebuild).
 *
 *  Why outlines, not centerlines: the live ink is `getStroke(points,
 *  STROKE_OPTS)` — a SMOOTH variable-width ribbon that perfect-freehand
 *  THINS and pulls INWARD at corners/convex bends (thinning + streamline).
 *  Stamping capsules along the centerline could never track that variable
 *  width, so the tone-at-centerline poked PAST the thin ink at corners (the
 *  bleed). Feeding the rasterizer the ACTUAL outline polygons — the same
 *  `getStroke` call the renderer draws — makes the tone conform to the visible
 *  ink EXACTLY: a watertight filled ink mask, true corners, true taper. The
 *  tone then fills up to (and a hair under) that mask's inner edge: no bleed
 *  past the outline, no sliver under it, sharp corners preserved. */
function inkOutlinesNear(
  strokes: Stroke[],
  regionOutline: [number, number][],
  gapMult: number,
): [number, number][][] {
  if (regionOutline.length < 3) return [];
  let rMinX = Infinity;
  let rMinY = Infinity;
  let rMaxX = -Infinity;
  let rMaxY = -Infinity;
  for (const [x, y] of regionOutline) {
    if (x < rMinX) rMinX = x;
    if (x > rMaxX) rMaxX = x;
    if (y < rMinY) rMinY = y;
    if (y > rMaxY) rMaxY = y;
  }
  const margin = (SOLID_INK_RADIUS * gapMult * 3) / WORLD_SCALE + 8;
  const outlines: [number, number][][] = [];
  for (const s of strokes) {
    if (s.points.length < 2) continue;
    let sMinX = Infinity;
    let sMinY = Infinity;
    let sMaxX = -Infinity;
    let sMaxY = -Infinity;
    for (const [x, y] of s.points) {
      if (x < sMinX) sMinX = x;
      if (x > sMaxX) sMaxX = x;
      if (y < sMinY) sMinY = y;
      if (y > sMaxY) sMaxY = y;
    }
    if (
      sMaxX < rMinX - margin ||
      sMinX > rMaxX + margin ||
      sMaxY < rMinY - margin ||
      sMinY > rMaxY + margin
    ) {
      continue;
    }
    // PRECISE border test (nested-fill fix): skip a stroke whose bbox merely
    // CONTAINS the patch (e.g. the outer circle around the tapped inner shape) —
    // handing its ink to the conform would grow the fill out to the outer region.
    if (!strokeBordersOutline(s.points, regionOutline, margin)) continue;
    // The EXACT visible ink boundary — same getStroke call strokeToPolygonPath
    // uses for the live ink polygon (STROKE_OPTS: size 4, thinning/smoothing/
    // streamline 0.5). getStroke returns a closed outline ring (one loop).
    const outline = getStroke(s.points, FILL_CLIP_STROKE_OPTS);
    if (outline.length >= 3) {
      outlines.push(outline.map(([x, y]) => [x, y] as [number, number]));
    }
  }
  return outlines;
}

/** Innermost PAPER region under a point — max containment depth wins, ties
 *  break to the smaller area (D-RF4: innermost wins; donut hole is a
 *  legitimate target). Returns the region index, or -1 (honest miss). */
export function innermostPaperRegionAt(x: number, y: number, regions: FillRegion[]): number {
  let best = -1;
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (r.depth % 2 !== 1) continue; // even = ink body, not a fill target
    if (r.outline.length < 3 || !pointInLoop(x, y, r.outline)) continue;
    if (
      best < 0 ||
      r.depth > regions[best].depth ||
      (r.depth === regions[best].depth && r.areaWorld < regions[best].areaWorld)
    ) {
      best = i;
    }
  }
  return best;
}

/** The even-depth islands sitting directly inside a paper region — the fill
 *  patch subtracts them so e.g. a donut-ring fill keeps the inner circle's
 *  ink AND its enclosed paper as paper (ring fills ring only). */
function fillChildrenOf(regions: FillRegion[], idx: number): [number, number][][] {
  const target = regions[idx];
  const holes: [number, number][][] = [];
  for (let j = 0; j < regions.length; j++) {
    const r = regions[j];
    if (j === idx || r.depth !== target.depth + 1 || r.outline.length < 1) continue;
    const [px, py] = r.outline[0];
    if (pointInLoop(px, py, target.outline)) holes.push(r.outline);
  }
  return holes;
}

/** Bounding-box extents of a point set (px): [width, height]. */
function bboxWHPx(pts: [number, number][]): [number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [maxX - minX, maxY - minY];
}

/** Is a lasso loop degenerate — near-zero AREA (Sebs-ratified: short flicks
 *  AND near-straight drags miss honestly, commit NOTHING)?
 *
 *  The guard keys on BBOX EXTENTS, NOT signed shoelace area — a self-crossing
 *  loop (figure-8 / bowtie) has near-zero NET shoelace area (the lobes' winding
 *  cancels) yet fills a large area under the nonzero-winding rasterizer the
 *  commit uses. A shoelace floor would wrongly reject those legitimate loops
 *  (the L4a/N4 regression). Bbox extents don't cancel:
 *    - SHORT FLICK  → both dims tiny  → reject;
 *    - NEAR-STRAIGHT DRAG → one dim a sliver (min dim ≈ wobble width) → reject;
 *    - REAL LOOP / BOWTIE → both dims span the gesture → accept.
 *  A loop must span ≥ LASSO_MIN_DIM_PX in its SMALLER dimension and clear a
 *  bbox-area floor (a tiny square also misses). */
const LASSO_MIN_DIM_PX = 12;
const LASSO_MIN_BBOX_AREA_PX = 400;
function lassoDegenerate(pts: [number, number][]): boolean {
  if (pts.length < 3) return true;
  const [w, h] = bboxWHPx(pts);
  if (Math.min(w, h) < LASSO_MIN_DIM_PX) return true; // sliver in one axis
  return w * h < LASSO_MIN_BBOX_AREA_PX; // too small overall
}

/** Decimate + round a lasso loop for the record (≤ TONE_OUTLINE_MAX_PTS,
 *  0.1px — the same compaction brushed outlines get). */
function decimateLoop(pts: [number, number][]): [number, number][] {
  let out = pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]);
  while (out.length > TONE_OUTLINE_MAX_PTS) {
    out = out.filter((_, i) => i % 2 === 0);
  }
  return out;
}

/** The Fill commit's outward dilation in px: how far the tone is pushed back
 *  OUT from the extractor boundary (which sits inkRadius·gap px inside the ink
 *  centerline) toward — and at full fill, past — the VISIBLE ink edge.
 *
 *  ROUND-8 (Sebs: "ability to fully fill" + the Gap slider was inert on closed
 *  shapes): the dilation now SCALES with the Gap multiplier, so the Gap slider
 *  is LIVE on a closed shape — low gap leaves a small inset paper ring, high
 *  gap fills flush to the ink edge. Previously the dilation reached the inner
 *  ink edge at every tick (gap only changed the gap-LEAP tolerance), so on an
 *  already-closed shape the slider did nothing visible. Now:
 *    · the extractor boundary is inkRadius·gap px inside the centerline;
 *    · dilation = that whole inset MINUS an inset-ring bias that SHRINKS as
 *      gap rises — at gap 1× the ring is ~1.5px (the original tucked look),
 *      at the top of the ladder the ring is 0 and the tone reaches the
 *      centerline (flush);
 *    · `full` (the explicit Full-fill option) overrides to push a small bias
 *      PAST the centerline so the tone always sits flush under the ink, no
 *      inset, regardless of gap.
 *  Clamped ≥ 0 (never a negative dilation = never pulled further inward). */
// Full-fill bias toward the ink's OUTER edge. Pen footprint is ~4px (half-width
// ~2). bias 0 stops at the centerline → thin white SLIVERS where the wobbly ink
// bows inward ("nope", Sebs). bias +2 reached the outer edge but BLED on the
// thinner/tapered stretches. +1 is the compromise: covers most inward wobble
// (fill tucks under the ink, which is drawn ON TOP) without spilling past on the
// thin stretches. Eyeball-tune with Sebs — variable-width ink means no single
// value is pixel-perfect; the ink-over-tone z-order hides the seam.
const FULL_FILL_EDGE_BIAS = 1;
function fillDilatePx(gapMult: number, full = false): number {
  const toCenterline = (SOLID_INK_RADIUS * gapMult) / WORLD_SCALE;
  if (full) return toCenterline + FULL_FILL_EDGE_BIAS;
  // Inset ring fades from ~1.5px at gap 1× to 0px by gap ~3× (ladder top) —
  // higher gap = flusher fill, making the slider visibly live on closed shapes.
  const insetRing = Math.max(0, 1.5 * (2 - gapMult));
  return Math.max(0, toCenterline - insetRing);
}

/** The honest-miss caption (spec §5.4 — never silent, never flood). */
export const FILL_MISS_NOTE = 'no closed region here — raise Gap, or use Lasso';

/** Markup for the patches as they enter the STYLE PIPELINE: flat solid
 *  band-grey fills, stroke="none" (mapPaletteColor passes 'none' through →
 *  the smartHachure outline pass renders invisibly; only fill MARKS show),
 *  each patch its own region. The pipeline's signals layer reads the grey →
 *  darknessL → the classifier's tonal roles → fillStyle marks at band
 *  density (coverage.ts math) — the I-2 wedge: brushed band 5 and inferred
 *  band 5 are indistinguishable downstream. `data-tone-band` tags the patch
 *  for downstream consumers (3D re-bind, audits) without re-deriving from
 *  the grey. */
function toneFillsMarkup(
  toneFills: ToneFill[],
  mapPt?: (pt: [number, number]) => [number, number],
): string {
  return sortedToneFills(toneFills)
    .map((f) => {
      const hex = TONE_BAND_HEX[f.band];
      if (!hex || f.points.length < 3) return '';
      const pts = mapPt ? f.points.map(mapPt) : f.points;
      const holes = mapPt ? f.holes?.map((hl) => hl.map(mapPt)) : f.holes;
      return `<path d="${tonePathD(pts, holes)}" fill="${hex}" fill-rule="evenodd" stroke="none" data-tone-band="${f.band}"/>`;
    })
    .join('');
}

// ─── UPLOAD BACKDROP (draw-over parity, ROUND 6) ──────────────────────────────
// An uploaded SVG becomes a BACKDROP layer inside the draw frame: it letterboxes
// into the same 800×600 viewBox space the strokes are captured in, so pen
// strokes land visually ON the upload. Done merges both into ONE object — by
// INVERSE-MAPPING the stroke points into the UPLOAD's local coordinate space
// and appending them flat (no <g transform>, no nested <svg>): the style
// pipeline's mark placement doesn't honor ancestor transforms yet (the
// deferred row-9 getCTM flatten, 18-scope-audit), verified live 2026-06-12 —
// a transform-wrapped merge rendered the upload tiny at raw local coords. The
// flat merge is exactly the input shape /canvas uploads already exercise.

export type BackdropFrame = {
  /** Inner markup of the upload's root <svg> (DOMPurify-sanitized upstream —
   *  prepareSvgUpload is the only producer of markup that reaches here). */
  inner: string;
  /** Root <svg> attributes minus sizing (width/height/viewBox/x/y), re-emitted
   *  on merged output so root-level fill/stroke/class context survives. */
  rootAttrs: string;
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
};

/** Normalize an uploaded root <svg> so it FITS the draw frame instead of
 *  overflowing/clipping (round-8, Sebs "uploaded SVG renders oversized/clipped
 *  on /canvas"). Root cause (diagnosed via Playwright box-measure on /canvas):
 *  the old transform set the svg width/height = 100%, but the SvgStyleTransform
 *  cleanRef wrapper has NO definite height, so `height:100%` doesn't resolve —
 *  the browser falls back to the viewBox aspect height at the resolved width
 *  (e.g. a 682×986 rose at 862px wide → 1246px tall inside a 648px frame =
 *  clipped). The fix:
 *    1. Derive a viewBox from width/height when the svg has none (so raw pixel
 *       coords map into a viewport — without this, forced 100% has no mapping).
 *    2. preserveAspectRatio="xMidYMid meet" — letterbox the viewBox into the
 *       viewport (the established fit-into-frame technique), so the whole
 *       drawing is visible, centered, never clipped.
 *    3. position:absolute; inset:0 inline style — the svg sizes against the
 *       nearest positioned ancestor (SvgStyleTransform's position:relative
 *       wrapper, which IS the frame box via its 100%×100% wrapperOverride),
 *       so height:100% finally resolves to the frame height. width/height 100%
 *       belt-and-suspenders for the absolute box.
 *  Desk-object normalization (~180px, normalizeSvgSize) still happens at the
 *  desk-canvas add boundary per the locked auto-resize decision — this is the
 *  in-frame PREVIEW fit only. */
export function fitUploadMarkup(rawMarkup: string): string {
  return rawMarkup.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    let viewBox = '';
    if (!/viewBox=/i.test(attrs)) {
      const w = parseFloat((attrs.match(/\swidth="([\d.]+)/i) || [])[1] ?? '');
      const h = parseFloat((attrs.match(/\sheight="([\d.]+)/i) || [])[1] ?? '');
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        viewBox = ` viewBox="0 0 ${w} ${h}"`;
      }
    }
    const cleaned = attrs
      .replace(/\swidth="[^"]*"/i, '')
      .replace(/\sheight="[^"]*"/i, '')
      .replace(/\spreserveAspectRatio="[^"]*"/i, '')
      // Strip any inline width/height/position in an existing style attr so our
      // sizing wins (sanitized markup may carry a style attr).
      .replace(/\sstyle="[^"]*"/i, '');
    return (
      `<svg${cleaned}${viewBox} width="100%" height="100%"` +
      ` preserveAspectRatio="xMidYMid meet"` +
      ` style="position:absolute;inset:0;width:100%;height:100%">`
    );
  });
}

/** Parse sanitized upload markup into a BackdropFrame. Returns null when the
 *  svg has no usable size info (no viewBox AND no positive width/height) —
 *  the host falls back to a non-draw-over preview honestly. */
export function prepareBackdrop(markup: string): BackdropFrame | null {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;
  const svg = doc.documentElement;
  if (svg.tagName.toLowerCase() !== 'svg') return null;
  let vbX = 0;
  let vbY = 0;
  let vbW = 0;
  let vbH = 0;
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      [vbX, vbY, vbW, vbH] = parts;
    }
  }
  if (!(vbW > 0 && vbH > 0)) {
    // No viewBox — derive from width/height attrs (parseFloat drops "px").
    const w = parseFloat(svg.getAttribute('width') ?? '');
    const h = parseFloat(svg.getAttribute('height') ?? '');
    if (w > 0 && h > 0) {
      vbX = 0;
      vbY = 0;
      vbW = w;
      vbH = h;
    }
  }
  if (!(vbW > 0 && vbH > 0)) return null;
  let inner = '';
  const ser = new XMLSerializer();
  for (const child of Array.from(svg.childNodes)) inner += ser.serializeToString(child);
  let rootAttrs = '';
  for (const attr of Array.from(svg.attributes)) {
    const n = attr.name.toLowerCase();
    if (n === 'width' || n === 'height' || n === 'viewbox' || n === 'x' || n === 'y' || n === 'xmlns') continue;
    rootAttrs += ` ${attr.name}="${attr.value.replace(/"/g, '&quot;')}"`;
  }
  return { inner, rootAttrs, vbX, vbY, vbW, vbH };
}

/** Letterbox mapping of a backdrop into the 800×600 draw frame —
 *  preserveAspectRatio xMidYMid meet, expressed as translate+scale. */
function backdropMapping(f: BackdropFrame): { s: number; ox: number; oy: number } {
  const s = Math.min(VIEWBOX_W / f.vbW, VIEWBOX_H / f.vbH);
  const ox = (VIEWBOX_W - f.vbW * s) / 2 - f.vbX * s;
  const oy = (VIEWBOX_H - f.vbH * s) / 2 - f.vbY * s;
  return { s, ox, oy };
}

const rnd = (v: number) => (Math.round(v * 100) / 100).toString();

/** The backdrop's <g transform> wrap in frame space — shared by the raw
 *  Sketch layer and the merged Done markup so they are pixel-coherent. */
function backdropGroupMarkup(f: BackdropFrame): string {
  const { s, ox, oy } = backdropMapping(f);
  return `<g transform="translate(${rnd(ox)} ${rnd(oy)}) scale(${(Math.round(s * 10000) / 10000).toString()})">${f.inner}</g>`;
}

/** Full-frame display markup for the raw (Sketch-mode) backdrop layer. */
export function backdropDisplayMarkup(f: BackdropFrame): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX_W} ${VIEWBOX_H}" width="100%" height="100%">${backdropGroupMarkup(f)}</svg>`;
}

/** Merge the upload backdrop + drawn-over strokes into ONE svg — FLAT, in the
 *  UPLOAD's local coordinate space: the upload geometry rides untouched and
 *  the stroke points are inverse-mapped through the letterbox (frame→local),
 *  stroke-width scaled to keep the drawn visual weight. No transforms in the
 *  output, so the style pipeline treats it exactly like a plain upload.
 *  `tight: true` (the Done path) sets the viewBox to the union of the
 *  upload's viewBox and the mapped strokes' bbox so the desk's ~180px
 *  normalization scales the DOODLE. `tight: false` (the live Style-mode
 *  layer) sets the viewBox to the inverse-mapped FULL FRAME rect, so the
 *  styled render letterboxes pixel-coherently with the raw layers under it. */
export function composeBackdropAndStrokes(
  f: BackdropFrame,
  strokes: Stroke[],
  opts: { tight?: boolean; toneFills?: ToneFill[] } = {},
): string {
  const { s, ox, oy } = backdropMapping(f);
  const toLocal = ([x, y]: StrokePoint): [number, number] => [(x - ox) / s, (y - oy) / s];
  const toLocal2 = ([x, y]: [number, number]): [number, number] => [(x - ox) / s, (y - oy) / s];
  const toneFills = opts.toneFills ?? [];
  const localWidth = Math.max(0.05, Math.round((3 / s) * 100) / 100);
  // Tone patches ride the same inverse mapping as strokes (frame → upload-
  // local), painting OVER the upload but UNDER the drawn ink — shading the
  // picture, not erasing it. Fills need no width scaling.
  const tonePaths = toneFillsMarkup(toneFills, toLocal2);
  const paths = strokes
    .map((stroke) => {
      const d = stroke.points.reduce((acc, pt, i) => {
        const [lx, ly] = toLocal(pt);
        return acc + (i === 0 ? `M ${lx.toFixed(2)} ${ly.toFixed(2)}` : ` L ${lx.toFixed(2)} ${ly.toFixed(2)}`);
      }, '');
      return `<path d="${d}" fill="none" stroke="var(--dir-text-primary)" stroke-width="${localWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');
  let vb: string;
  if (opts.tight) {
    // Union of the upload's viewBox and the mapped strokes' + tone patches'
    // bbox (+pad).
    let minX = f.vbX;
    let minY = f.vbY;
    let maxX = f.vbX + f.vbW;
    let maxY = f.vbY + f.vbH;
    for (const stroke of strokes) {
      for (const pt of stroke.points) {
        const [lx, ly] = toLocal(pt);
        if (lx < minX) minX = lx;
        if (ly < minY) minY = ly;
        if (lx > maxX) maxX = lx;
        if (ly > maxY) maxY = ly;
      }
    }
    for (const fill of toneFills) {
      for (const pt of fill.points) {
        const [lx, ly] = toLocal2(pt);
        if (lx < minX) minX = lx;
        if (ly < minY) minY = ly;
        if (lx > maxX) maxX = lx;
        if (ly > maxY) maxY = ly;
      }
    }
    const pad = 6 / s;
    vb = `${rnd(minX - pad)} ${rnd(minY - pad)} ${rnd(maxX - minX + pad * 2)} ${rnd(maxY - minY + pad * 2)}`;
  } else {
    // The whole 800×600 frame, expressed in local units — same letterbox as
    // the raw Sketch layers (display parity), explicit 100% sizing for the
    // injected-markup render path.
    vb = `${rnd((0 - ox) / s)} ${rnd((0 - oy) / s)} ${rnd(VIEWBOX_W / s)} ${rnd(VIEWBOX_H / s)}`;
  }
  const sizing = opts.tight ? '' : ' width="100%" height="100%"';
  return `<svg xmlns="http://www.w3.org/2000/svg"${f.rootAttrs} viewBox="${vb}"${sizing}>${f.inner}${tonePaths}${paths}</svg>`;
}

// In-frame action pill — PILL at the smaller in-canvas scale, on paper so the
// buttons read over strokes. Shared by Edit / Clear / Replace.
const FRAME_PILL = {
  ...PILL,
  padding: '6px 12px',
  fontSize: 10,
  background: 'var(--dir-bg)',
};

// CTA mixes PILL's `border` shorthand with a `borderColor` longhand — React
// dev warns when such conflicting styles diff across renders (the Done↔Edit
// button swap reuses the same DOM node, so the diff is live here). Collapse
// to a single shorthand at this call site (chromeStyles is shared, owned
// elsewhere).
const { borderColor: _ctaBorderColor, ...CTA_REST } = CTA;
const CTA_PILL = { ...CTA_REST, border: `1px solid ${String(_ctaBorderColor)}` };

// Shared copy block for the honesty gates (3D mode + image upload) — an
// opaque cover over the live 2D surface so a not-yet-real mode never shows
// dead-looking controls. State underneath stays intact.
const GATE_STYLE = {
  position: 'absolute' as const,
  inset: 0,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  background: 'var(--dir-bg)',
  fontFamily: IS,
  fontSize: 11,
  color: 'var(--dir-text-secondary)',
  letterSpacing: '0.04em',
  textAlign: 'center' as const,
};

export function DrawSurface({
  mode,
  input,
  onStrokesChange,
  hideActions,
  fill,
  styled,
  initialStrokes,
  backdrop,
  shade,
  initialToneFills,
  onToneFillsChange,
  onGapChange,
  onFillNote,
  onSnapApi,
  onUploadedSvgChange,
  onStrokeCommitted,
  onSelectionChange,
  armedShape,
  onShapeInserted,
  eraseStrokes,
  eraseMode = 'object',
  editableParts,
  onSelectPart,
  onEditedParts,
}: {
  mode: CanvasMode;
  input: InputMode;
  /** SHAPE INSERT (UX rework §6): when set to a shapeLibrary kind, a pointer DRAG
   *  defines the shape's bbox and pen-up drops it as a stroke (generateShape +
   *  applyCandidate). null/undefined = freehand (default). Mutually exclusive with
   *  shade/fill/lasso — an armed shape owns the pointer first. */
  armedShape?: string | null;
  /** Fired after an insert commits, so the host can raise the override receipt on
   *  the new shape (insert a star, want a pentagon — same switcher). */
  onShapeInserted?: (stroke: Stroke) => void;
  /** AUTO-DETECT (UX rework, OFFER-only): fired ON PEN-UP for each genuinely
   *  committed ink stroke (NOT taps/shade/fill/lasso/Style). The host runs
   *  fitStroke and OFFERS the best via the override receipt — it never
   *  auto-mutates the stroke (Sebs 2026-06-15). Omit = old draw-only behavior. */
  onStrokeCommitted?: (stroke: Stroke) => void;
  /** Fired when tap-to-select changes the selected stroke (id, or null on a
   *  bare-paper deselect), so the host can re-target / tear down the receipt. */
  onSelectionChange?: (id: string | null) => void;
  /** Optional live mirror of the preview-stroke pool. Lets a host (DrawPanel)
   *  supply its own Done control and build the commit-layer markup itself.
   *  Pass a stable callback (a useState setter) — fired from an effect. */
  onStrokesChange?: (strokes: Stroke[]) => void;
  /** Hide the in-frame Done/Edit/Clear pills when the host supplies its own
   *  commit chrome (DrawPanel's Done/Cancel). /canvas leaves this unset. */
  hideActions?: boolean;
  /** Fill the parent box (popup mini-desk) instead of clamping to 4:3 —
   *  the inner SVG letterboxes via its viewBox either way. */
  fill?: boolean;
  /** DRAW | STYLE mode (Sebs 2026-06-12: "drawing shouldn't stop when pen
   *  lifts, but we can't play with toggles while it's raw — the user needs a
   *  way IN and OUT"). Controlled by the host's Draw|Style pill pair:
   *    · false/undefined (Draw): strokes stay RAW ink; pen-up changes
   *      nothing; keep sketching forever.
   *    · true (Style): drawing pauses (pointer ignored), the strokes render
   *      through the SAME SvgStyleTransform pipeline and re-style LIVE as
   *      the pen controls change. Flip back to keep drawing.
   *  /canvas leaves this unset — its Done/Edit commit flow is unchanged. */
  styled?: boolean;
  /** Preload the canvas with stored strokes (Re-draw: the object's recorded
   *  gesture comes back editable — the record keeps the hand). */
  initialStrokes?: StrokePoint[][];
  /** UPLOAD-AS-BACKDROP (draw-over parity, ROUND 6): the prepared upload
   *  letterboxes into the frame as the bottom layer; pen strokes draw on top.
   *  Sketch mode shows it raw; Style mode renders backdrop + strokes MERGED
   *  through ONE SvgStyleTransform (the same composed markup Done stages, so
   *  the live preview == the published object). Host (DrawPanel) owns the
   *  file pick; /canvas leaves this unset. */
  backdrop?: BackdropFrame | null;
  /** THE SHADE REGISTER (round 7, tone-fill brush · rock F2 region fill):
   *  when `active`, the pointer puts down TONE instead of ink. `tool` picks
   *  HOW (D-RF1 — the register answers "tone goes down", the tool answers
   *  how): 'brush' = the swept-capsule grid brush; 'fill' = extractor-backed
   *  region fill (tap/hover-preview/highlight-drag/gap-scrub); 'lasso' =
   *  freehand loop, auto-closed on release (D-RF7). `erase` flips every tool
   *  into a lifter (band 0 = paper = absence). `gap` = the Fill tool's
   *  gap-tolerance multiplier (GAP_LADDER). Tool state is owned by the
   *  host's chrome; /canvas leaves this unset — zero behavior change. */
  shade?: {
    active: boolean;
    tool: ShadeTool;
    band: number;
    radius: number;
    erase: boolean;
    gap: number;
    /** FULL FILL (round-8, Sebs "ability to fully fill"): when on, the Fill
     *  tool commits flush to the ink EDGE with NO inset gap — the dilation
     *  pushes the tone out under the visible ink so a closed shape reads as
     *  completely toned, edge to edge. Default (off) keeps the boundary tucked
     *  just inside the ink. Optional so hosts that don't forward it keep the
     *  original behavior. NOTE: the Gap ladder ALSO drives flushness (its top
     *  tick reaches the edge) so the Gap slider is live on closed shapes even
     *  when this isn't wired — full-fill is the explicit, always-flush escape
     *  hatch on top of that. */
    fullFill?: boolean;
  } | null;
  /** Fill-tool gap scrub → host slider sync (press-hold-drag walks the
   *  ladder LIVE; the chrome slider follows and the value persists — both
   *  controls, spec D-RF3). Fired once per ladder STEP, never per move. */
  onGapChange?: (gap: number) => void;
  /** Honest-miss channel: one-line notes for the host's caption slot (spec
   *  §5.4 — "no closed region here…"; never silent, never a stray blob). */
  onFillNote?: (note: string) => void;
  /** Preload tone patches (Re-draw: the object's recorded tone comes back
   *  editable, sibling of initialStrokes — addendum ch.2 lifecycle). */
  initialToneFills?: ToneFill[];
  /** Live mirror of the tone-patch pool — same contract as onStrokesChange
   *  (stable callback, fired from an effect). The host stages
   *  render_config.toneFills from this at Done. */
  onToneFillsChange?: (toneFills: ToneFill[]) => void;
  /** SHAPE ASSIST (Rock F3): hand the host an imperative API for the SNAP /
   *  STRAIGHTEN action pills (which live in the host's chrome, not the
   *  canvas). Fired once with a stable api object (the onStrokesChange idiom)
   *  so the host can fit/apply/cycle the last stroke on demand. /canvas leaves
   *  this unset — zero behavior change, freehand stays the only path. */
  onSnapApi?: (api: ShapeSnapApi) => void;
  /** Live mirror of the FITTED uploaded-SVG markup (or null when cleared) so the
   *  host can flatten it into strokes for the 3D engine (the easy svg→3D bridge,
   *  svgToStrokes). Same onStrokesChange idiom — fired from an effect. */
  onUploadedSvgChange?: (markup: string | null) => void;
  /** ERASE register (Sebs 2026-06-16 "eraser for drawing that erases anything"):
   *  when true the pointer ERASES — ink AND tone — instead of drawing. It rides the
   *  same gesture the tone-erase uses (shade.active + band 0). Host sets it when
   *  register==='erase'. The MODE below decides whole-object vs partial. */
  eraseStrokes?: boolean;
  /** ERASE MODE (the GoodNotes two-way toggle): 'object' = touch a stroke/patch and
   *  the WHOLE thing is removed (fast); 'pixel' = drag carves only the part under the
   *  brush. Defaults to 'object'. */
  eraseMode?: 'object' | 'pixel';
  /** LOSSLESS PART EDITOR (2026-06-24): the data-part-id-annotated upload markup +
   *  per-part metadata, so an uploaded/existing drawing's SHAPES become selectable
   *  parts (fills intact) alongside freehand strokes. Absent ⇒ no part layer renders
   *  and every current behaviour is byte-identical (fully gated). */
  editableParts?: { markup: string; parts: SvgPart[]; viewBox: { x: number; y: number; w: number; h: number } } | null;
  /** Fired when the selected PART changes (id, or null on deselect). */
  onSelectPart?: (id: string | null) => void;
  /** Fired with the EDITED parts as a standalone SVG (transforms baked) whenever a
   *  part is moved/restyled/deleted — the host saves this at Done (Slice 2d). */
  onEditedParts?: (svgMarkup: string) => void;
}) {
  // PREVIEW strokes — gestures the user has finished pen-up on but hasn't
  // committed yet. While in this state they render as raw perfect-freehand
  // polygons so the user sees their drawing AS DRAWN, not pre-styled.
  const [strokes, setStrokes] = useState<Stroke[]>(() =>
    (initialStrokes ?? []).map((points, i) => ({ id: `loaded-${i}`, points })),
  );
  // CURRENT stroke — the one being actively dragged.
  const [current, setCurrent] = useState<Stroke | null>(null);
  // SHAPE INSERT (§6): the live drag box while an armed shape is being placed.
  const [insertBox, setInsertBox] = useState<{ start: [number, number]; cur: [number, number] } | null>(null);
  const insertShiftRef = useRef(false); // aspect-lock (Shift) live during the drag
  // MOVE/RESIZE (§6.4 Tier-A + move): the live transform of the SELECTED stroke —
  // drag the body to move, drag a corner handle to resize. Sebs 2026-06-15.
  const [transform, setTransform] = useState<{
    mode: 'move' | 'resize';
    corner: 'nw' | 'ne' | 'sw' | 'se';
    box0: { x: number; y: number; w: number; h: number };
    pts0: StrokePoint[];
    start: [number, number];
  } | null>(null);
  // SELECTED stroke (round-8, Sebs "select different part"): a TAP on an
  // earlier committed stroke (Ink register, no drag) selects it so Snap /
  // Straighten target THAT one instead of the latest. null = no selection →
  // the API falls back to the last stroke (the original behavior). Cleared
  // whenever a new stroke is drawn or the selected stroke disappears.
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  // SELECTED PART (lossless part editor, 2026-06-24): an SVG-shape part of an
  // editable upload/existing drawing — parallels selectedStrokeId for freehand
  // strokes. Only meaningful when editableParts is provided (else always null).
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  // Inner content of the part-editor markup (strip the <svg> wrapper) — rendered
  // inside a nested <svg> that letterboxes the upload viewBox into the draw frame
  // natively (preserveAspectRatio), so parts + the selection box share one space.
  const editablePartsInner = useMemo(
    () => (editableParts ? editableParts.markup.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '') : ''),
    [editableParts],
  );
  // ── PART EDITOR (rebuilt 2026-06-25 on the STROKE editor's model) ────────────
  // EVERYTHING lives in the 800×600 FRAME space (like strokes): the parts render
  // letterboxed into the frame; each part's FRAME BOX is the source of truth; and
  // hit-test / selection / move / resize use eventToSvgPoint + the SAME hitCorner /
  // cornerXY / oppositeCorner helpers as strokes. No nested-svg / getCTM bridge —
  // that mismatch was the whole "box pops off somewhere else" bug.
  const partsLayerRef = useRef<SVGGElement | null>(null); // the <g> holding the parts
  // Letterbox the upload viewBox → 800×600 frame (xMidYMid meet), same as backdrop:
  // a part at upload (px,py) renders at frame (px*s+ox, py*s+oy).
  const partFit = useMemo(() => {
    const vb = editableParts?.viewBox;
    if (!vb || vb.w <= 0 || vb.h <= 0) return { s: 1, ox: 0, oy: 0 };
    const s = Math.min(VIEWBOX_W / vb.w, VIEWBOX_H / vb.h);
    return { s, ox: (VIEWBOX_W - vb.w * s) / 2 - vb.x * s, oy: (VIEWBOX_H - vb.h * s) / 2 - vb.y * s };
  }, [editableParts]);
  const origFrameBox = (part: SvgPart) => ({
    x: part.bbox.x * partFit.s + partFit.ox,
    y: part.bbox.y * partFit.s + partFit.oy,
    w: part.bbox.w * partFit.s,
    h: part.bbox.h * partFit.s,
  });
  // EDITED frame boxes (move/resize) — the source of truth, FRAME space. Absent ⇒
  // the part is at its original letterboxed box.
  const [partBoxes, setPartBoxes] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const frameBoxOf = (part: SvgPart) => partBoxes[part.id] ?? origFrameBox(part);
  // CLICK / SELECTION box, padded so THIN or STRAIGHT parts are grabbable + visibly
  // selectable. A bare `<line>` or a flat smile stroke has a near-zero-width (or
  // -height) bbox → impossible to click on the infinitely-thin line and the dashed
  // box would be invisible. Pad ONLY the thin dimension up to PART_MIN_EXTENT so fat
  // shapes are untouched (precise clicking + smallest-wins preserved). Used for
  // hit-testing and the visible overlay; the MOVE gesture still uses the REAL box so
  // dragging a thin part translates it without fattening it.
  const PART_MIN_EXTENT = 20; // min on-screen extent (frame px) a part's hit/sel box gets
  const displayBoxOf = (part: SvgPart) => {
    const b = frameBoxOf(part);
    const padX = Math.max(0, (PART_MIN_EXTENT - b.w) / 2);
    const padY = Math.max(0, (PART_MIN_EXTENT - b.h) / 2);
    return { x: b.x - padX, y: b.y - padY, w: b.w + 2 * padX, h: b.h + 2 * padY };
  };
  const [deletedParts, setDeletedParts] = useState<Set<string>>(() => new Set());
  // Active move/resize gesture (mirrors the stroke `transform` state).
  const [partXform, setPartXform] = useState<
    { id: string; mode: 'move' | 'resize'; corner: 'nw' | 'ne' | 'sw' | 'se'; box0: { x: number; y: number; w: number; h: number }; start: [number, number] } | null
  >(null);
  // New parts set ⇒ clear all edits/selection.
  useEffect(() => { setPartBoxes({}); setDeletedParts(new Set()); setSelectedPartId(null); }, [editablePartsInner]);
  // Render each part to its current frame box (imperative). The parts sit inside the
  // letterbox <g>, so this transform is in UPLOAD space: map the part's upload bbox
  // `o` to the edited upload box `bu` = inverse-letterbox(frame box). Identity at rest.
  useEffect(() => {
    const layer = partsLayerRef.current;
    if (!layer || !editableParts) return;
    const { s, ox, oy } = partFit;
    for (const part of editableParts.parts) {
      const el = layer.querySelector(`[data-part-id="${part.id}"]`) as SVGGraphicsElement | null;
      if (!el) continue;
      // T0 = the part's ORIGINAL transform (e.g. a baked move from a prior edit). The
      // bbox `o` already reflects it, so my move/resize must COMPOSE on top (Tedit·T0),
      // never replace it — replacing snaps a previously-moved part back to its
      // untransformed spot while the selection box stays at the bbox (the "pops off and
      // appears somewhere else" bug on re-edited doodles). At rest, restore T0 exactly.
      const T0 = part.transform || '';
      if (deletedParts.has(part.id)) { el.setAttribute('display', 'none'); continue; }
      el.removeAttribute('display');
      const o = part.bbox;
      const restore = () => { if (T0) el.setAttribute('transform', T0); else el.removeAttribute('transform'); };
      if (o.w < 1e-3 || o.h < 1e-3 || s <= 0) { restore(); continue; }
      const b = frameBoxOf(part);
      const bu = { x: (b.x - ox) / s, y: (b.y - oy) / s, w: b.w / s, h: b.h / s };
      const sx = bu.w / o.w, sy = bu.h / o.h;
      const tx = bu.x - o.x * sx, ty = bu.y - o.y * sy;
      if (Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4 && Math.abs(tx) < 1e-3 && Math.abs(ty) < 1e-3) restore();
      else el.setAttribute('transform', `translate(${tx} ${ty}) scale(${sx} ${sy})${T0 ? ' ' + T0 : ''}`);
    }
  }, [partBoxes, deletedParts, editableParts, partFit]);
  // Delete / Backspace removes the SELECTED part (mirrors the stroke delete).
  useEffect(() => {
    if (!selectedPartId || !editableParts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      e.preventDefault();
      const id = selectedPartId;
      setDeletedParts((prev) => { const n = new Set(prev); n.add(id); return n; });
      setSelectedPartId(null);
      onSelectPart?.(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selectedPartId, editableParts, onSelectPart]);
  // Edited parts → standalone SVG for the host to save at Done. Saved in UPLOAD
  // coords (elements carry their upload-space edit transforms); viewBox = the upload
  // viewBox expanded for any part moved/scaled out (floor = original ⇒ idempotent,
  // no drift on re-save). Fires once an edit exists (move/resize OR delete).
  useEffect(() => {
    if (!editableParts || !onEditedParts) return;
    if (Object.keys(partBoxes).length === 0 && deletedParts.size === 0) return;
    const layer = partsLayerRef.current;
    if (!layer) return;
    const { s, ox, oy } = partFit;
    const vb = editableParts.viewBox;
    let minX = vb.x, minY = vb.y, maxX = vb.x + vb.w, maxY = vb.y + vb.h;
    for (const part of editableParts.parts) {
      if (deletedParts.has(part.id)) continue;
      const b = frameBoxOf(part);
      const ux = (b.x - ox) / s, uy = (b.y - oy) / s, uw = b.w / s, uh = b.h / s;
      minX = Math.min(minX, ux); minY = Math.min(minY, uy);
      maxX = Math.max(maxX, ux + uw); maxY = Math.max(maxY, uy + uh);
    }
    onEditedParts(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}">${layer.innerHTML}</svg>`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partBoxes, deletedParts]);
  // DELETE the SELECTED stroke (Sebs 2026-06-16 "erase/delete just the selected
  // thing" — the second of the two erase modes, alongside the brush eraser):
  // Delete/Backspace rubs out ONLY the picked stroke. Ignored while a text field
  // is focused (name / why inputs) so typing a caption never nukes a selection.
  useEffect(() => {
    if (!selectedStrokeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      e.preventDefault();
      const id = selectedStrokeId;
      setStrokes((prev) => prev.filter((s) => s.id !== id));
      setSelectedStrokeId(null);
      onSelectionChange?.(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selectedStrokeId, onSelectionChange]);
  // COMMITTED — flip to true when user hits "Done." Only then do the
  // strokes flow through SvgStyleTransform / Smart Hachure. Until then
  // pen-up just adds another stroke to the preview pool. Sebs: "if I stop
  // drawing and lift it shouldn't auto-add the object until I choose to be done."
  const [committed, setCommitted] = useState(false);
  const [uploadedSvg, setUploadedSvg] = useState<{ name: string; markup: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // SVG-UPLOAD SIMPLIFY MODE (Sebs 2026-06-16): how an uploaded .svg enters our
  // register — 'off' (as-is), 'filled' (clean filled line-art), 'line' (centerline
  // single-line). Changing it re-processes the SAME upload (no re-pick) via
  // applyUploadSimplify on rawSvgUpload (the raw prepared markup). .svg-ONLY —
  // traced images default to Clean and don't carry this toggle.
  const [simplifyMode, setSimplifyMode] = useState<UploadSimplifyMode>('filled');
  const [rawSvgUpload, setRawSvgUpload] = useState<string | null>(null);
  // Image trace is a network round-trip (Quiver via our Edge fn, ~2–6s) — busy
  // gates the picker + drives honest "Tracing…" copy so it never looks frozen.
  const [uploadBusy, setUploadBusy] = useState(false);
  // TONE PATCHES — the shade register's pool (sibling of `strokes`). Display/
  // record mirror of the grid below; pen-lift extraction refreshes it whole.
  const [toneFills, setToneFills] = useState<ToneFill[]>(() =>
    (initialToneFills ?? []).map((f, i) => ({ ...f, id: f.id || `loaded-tone-${i}` })),
  );
  // THE BAND GRID — session-time source of truth for the shade register
  // (shade-brush spec §2). Lazily created on first render; Re-draw preloads
  // re-rasterize stored patches at their band (ascending, darker wins —
  // stored patches are already RESOLVED statements, §3 rules apply only at
  // brush time). Lives only as long as this surface — never stored.
  const toneGridRef = useRef<ToneMaskGrid | null>(null);
  if (toneGridRef.current === null) {
    toneGridRef.current = createToneGrid(VIEWBOX_W, VIEWBOX_H);
    if (initialToneFills && initialToneFills.length > 0) {
      rasterizeToneFills(toneGridRef.current, initialToneFills);
    }
  }
  // TONE SELECTION + MOVE (Sebs 2026-06-16 "move shade as well, not just ink") — a
  // tap in ink/select mode picks a tone patch; dragging it translates the patch and
  // on lift the grid is RE-SYNCED from the moved patches (rasterizeToneFills over a
  // cleared grid) so a later re-extraction can't snap it back. toneFillsRef hands the
  // up-handler the latest patches without a stale closure. selectedToneId mirrors
  // selectedStrokeId — one selection model, ink OR tone.
  const [selectedToneId, setSelectedToneId] = useState<string | null>(null);
  // Tone MOVE+RESIZE (model B — register-scoped: tone is arranged in SHADE mode).
  // Mirrors the stroke `transform`: move = translate, resize = scale about the
  // opposite corner. base = the patch at gesture start.
  const [toneTransform, setToneTransform] = useState<{
    id: string;
    mode: 'move' | 'resize';
    corner: 'nw' | 'ne' | 'sw' | 'se';
    box0: { x: number; y: number; w: number; h: number };
    base: ToneFill;
    start: [number, number];
  } | null>(null);
  // Shade-paint tap-vs-drag (model B): a still TAP in Shade = SELECT a patch; a
  // DRAG = paint. Painting is deferred to the first move so a tap never lays tone.
  const shadeGestureRef = useRef<{ start: [number, number]; moved: boolean } | null>(null);
  const toneFillsRef = useRef<ToneFill[]>(toneFills);
  toneFillsRef.current = toneFills;
  // Re-sync the grid to match a GIVEN set of tone patches (after a move/delete) so
  // the next extraction won't resurrect a patch at its old spot. Pass the list
  // explicitly — a ref read would be stale before React's next render.
  const regridTone = (fills: ToneFill[]) => {
    const grid = toneGridRef.current;
    if (!grid) return;
    grid.bands.fill(0);
    grid.src.fill(0);
    grid.gapTolQ.fill(0);
    rasterizeToneFills(grid, fills);
  };
  // The brush centerline being actively dragged (shade register's `current`) —
  // drives the cheap while-pen-down preview overlay (SB-6); the grid carries
  // the truth in parallel.
  const [toneBrush, setToneBrush] = useState<[number, number][] | null>(null);
  // Last stamped centerline point — capsule segments connect consecutive
  // pointer events so fast drags leave no gaps in the grid.
  const lastTonePtRef = useRef<[number, number] | null>(null);
  // Pre-stroke band snapshot — Escape mid-gesture restores it (true gesture
  // CANCEL; a 120KB copy per pen-down is trivially cheap). Without this, a
  // mid-stroke Escape fell through to the host popup's close handler, which
  // saw empty strokes/tone state and silently ATE the in-progress gesture
  // (caught by the rock-F1 break battery). Rock F2: provenance sidecars ride
  // the snapshot too — a cancelled brush-over-fill must restore the fill's
  // src/gapTol, not leave brush provenance on reverted bands.
  const toneSnapshotRef = useRef<{
    bands: Uint8Array;
    src: Uint8Array;
    gapTolQ: Uint8Array;
  } | null>(null);
  // Pointer position while the shade register is active — drives the honest
  // brush-footprint ring (the radius is in viewBox units, so a CSS cursor
  // could not show the true footprint).
  const [hoverPt, setHoverPt] = useState<[number, number] | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── REGION FILL state (rock F2) ────────────────────────────────────────────
  // Extraction cache: (strokesKey, gapIdx) → regions. Per ladder STEP, never
  // per pointermove (spec §6 cost rule); entries for stale stroke pools are
  // simply never hit (key mismatch) and the map is cleared on stroke edits.
  const regionCacheRef = useRef<Map<string, FillRegion[]>>(new Map());
  const strokesSig = strokesKey(strokes.map((s) => s.points));
  // The in-flight fill gesture — ref (handlers + Escape listener read it
  // without stale-closure risk); `fillGestureOn` mirrors "a fill gesture is
  // mid-flight" into state so the Escape listener mounts.
  const fillGesRef = useRef<{
    phase: 'pending' | 'scrub' | 'highlight';
    start: [number, number];
    baseGapIdx: number;
    lastIdx: number;
    timer: number;
  } | null>(null);
  const [fillGestureOn, setFillGestureOn] = useState(false);
  // Hover preview (Fill mode, pen up): the flood patch under the cursor, cached
  // by a quantized seed cell + gap step so the flood doesn't recompute per pixel.
  const [fillHover, setFillHover] = useState<{
    key: string;
    patch: { outline: [number, number][]; holes: [number, number][][] } | null;
  } | null>(null);
  // Live gap scrub (press-hold-drag): current step + the anchor the preview
  // re-resolves under as the ladder walks (watch the leak happen — §6).
  const [scrubState, setScrubState] = useState<{ idx: number; anchor: [number, number] } | null>(
    null,
  );
  // Highlight-drag trail (transient — never recorded as ink, spec §5.3).
  const [highlightPts, setHighlightPts] = useState<[number, number][] | null>(null);
  // Lasso trail (its own outline becomes the patch on release, D-RF7).
  const [lassoPts, setLassoPts] = useState<[number, number][] | null>(null);
  // The previous fill act missed — the next lasso commit is the spec §7
  // extractor-miss label ('lasso-after-miss').
  const lastMissRef = useRef(false);
  // Latest shade prop for the Escape listener (mounted per-gesture, so the
  // closure would otherwise hold a stale band/erase).
  const shadeRef = useRef(shade);
  shadeRef.current = shade;

  /** Regions at a ladder step — cached, deterministic, extraction only on a
   *  cache miss (entering Fill, a new step, or after stroke edits). */
  function regionsFor(gapIdx: number): FillRegion[] {
    const key = `${strokesSig}|${gapIdx}`;
    const cached = regionCacheRef.current.get(key);
    if (cached) return cached;
    if (regionCacheRef.current.size > 18) regionCacheRef.current.clear();
    const regions = extractFillRegions(strokes, GAP_LADDER[gapIdx]);
    regionCacheRef.current.set(key, regions);
    return regions;
  }

  const currentGapIdx = gapIdxOf(shade?.gap ?? 1);

  /** Decision-log every act (spec §7/§8 — the learned ladder's diet). */
  function logShadeFill(
    tool: 'fill' | 'lasso',
    gesture: ShadeFillGesture,
    gapMult: number,
    region: FillRegion | null,
    outcome: 'committed' | 'cancelled' | 'miss' | 'lasso-after-miss',
    regionCount: number,
  ) {
    pushShadeFillEntry({
      entryType: 'shade-fill',
      surface: 'shade-fill',
      tool,
      gesture,
      band: shadeRef.current?.erase ? 0 : shadeRef.current?.band ?? 3,
      erase: !!shadeRef.current?.erase,
      gapTol: gapMult,
      regionDepth: region ? region.depth : null,
      regionAreaWorld: region ? region.areaWorld : null,
      outcome,
      extractorVersion: REGION_EXTRACTOR_VERSION,
      regionCount,
    });
  }

  /** Extract the band grid → tone patches, THEN replace every region-FILL
   *  patch's stair-stepped 2px-grid edge with the smooth perfect-freehand ink
   *  curve (smoothFillEdges — boolean intersection with the live getStroke ink
   *  outlines). THE jagged-edge fix (v3, 2026-06-13): the grid stays the source
   *  of truth + drives region detection, but the EMITTED fill edge is the ink's
   *  own smooth vector, not the grid contour. Idempotent + fail-safe, so it runs
   *  at EVERY re-extraction (fill / lasso / brush / eraser). Lasso + brush
   *  patches pass through untouched. */
  function extractSmoothFills(grid: ToneMaskGrid): ToneFill[] {
    const raw = extractToneFills(grid);
    // Live ink outlines = the EXACT visible perfect-freehand ribbons (the same
    // getStroke the renderer draws) for every committed stroke — the smooth
    // target the fill edge snaps to.
    const inkOutlines: [number, number][][] = [];
    for (const s of strokes) {
      if (s.points.length < 2) continue;
      const outline = getStroke(s.points, FILL_CLIP_STROKE_OPTS);
      if (outline.length >= 3) inkOutlines.push(outline.map(([x, y]) => [x, y] as [number, number]));
    }
    return inkOutlines.length > 0 ? smoothFillEdges(raw, inkOutlines) : raw;
  }

  /** FLOOD-FILL the paper region under a point (the proven bucket-fill model,
   *  KNOWN-SOLUTIONS.md). Picks the seed's spatially-disjoint stroke cluster
   *  first — so the flood grid is sized to ONE shape group (full local
   *  resolution, multi-shape safe) — converts it to world, floods the connected
   *  paper from the seed bounded by the stamped ink, then maps the resulting
   *  loop + holes back to viewBox px. Robust to NESTING: a tap inside a small
   *  inner shape floods ONLY that shape (bounded by its own ink), never the
   *  parent (the old region-tree starved here). Returns the patch, or null
   *  (seed on ink / in the open outside / no cluster under the point). */
  function floodFillAt(
    pt: [number, number],
    gapMult: number,
  ): { outline: [number, number][]; holes: [number, number][][] } | null {
    const raw = strokes.map((s) => s.points).filter((s) => s.length > 0);
    if (raw.length === 0) return null;
    const viewBox = { w: VIEWBOX_W, h: VIEWBOX_H };
    const simplified = raw.map((s) => rdpPoints(s, RDP_EPSILON));
    // bbox per stroke + union-find into spatially-disjoint clusters (same model
    // extractFillRegions uses): grow each bbox by the ink gap so near shapes
    // share a cluster (nested triangles + their circle = ONE cluster, sized
    // tightly so the flood grid keeps full resolution on the small features).
    const bbs = simplified.map((s) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of s) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
      return [minX, minY, maxX, maxY] as [number, number, number, number];
    });
    const gapPx = (SOLID_INK_RADIUS * gapMult) / WORLD_SCALE + 8;
    const parent = simplified.map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    for (let i = 0; i < bbs.length; i++) {
      for (let j = i + 1; j < bbs.length; j++) {
        const a = bbs[i], b = bbs[j];
        if (a[2] + gapPx >= b[0] && b[2] + gapPx >= a[0] && a[3] + gapPx >= b[1] && b[3] + gapPx >= a[1]) {
          parent[find(i)] = find(j);
        }
      }
    }
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < simplified.length; i++) {
      const r = find(i);
      const g = clusters.get(r);
      if (g) g.push(i);
      else clusters.set(r, [i]);
    }
    // Pick the cluster whose grown bbox contains the seed — the shape group the
    // user tapped into. None → tap in open space → honest miss.
    let pick: number[] | null = null;
    for (const idxs of clusters.values()) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const i of idxs) {
        const b = bbs[i];
        if (b[0] < minX) minX = b[0];
        if (b[1] < minY) minY = b[1];
        if (b[2] > maxX) maxX = b[2];
        if (b[3] > maxY) maxY = b[3];
      }
      if (pt[0] >= minX - gapPx && pt[0] <= maxX + gapPx && pt[1] >= minY - gapPx && pt[1] <= maxY + gapPx) {
        pick = idxs;
        break;
      }
    }
    if (!pick) return null;
    const cs = pick.map((i) => simplified[i]);
    const center = poolCenter(cs, viewBox);
    const world = cs.map((s) => normalizeStrokePoints(s, viewBox, WORLD_SCALE, center));
    // Seed → world with the SAME center (a one-point stroke normalized identically).
    const seedWorld = normalizeStrokePoints([[pt[0], pt[1]]], viewBox, WORLD_SCALE, center)[0];
    // PROVEN no-bleed region fill (KNOWN-SOLUTIONS.md §4 Step 1-3): span-flood on
    // a GAP-CLOSED mask (seals freehand sharp-corner pinholes — the no-snap main
    // flow), grow ~g/2, then CLIP to the ORIGINAL ink so the fill TUCKS UNDER the
    // stroke and can NEVER cross to the far side of the line (no bleed past the
    // outline). gapClose scales with the Gap slider. Replaces the old escalation
    // (which fattened walls → inset flood → conform bled). See lib/fill/regionFill.
    // PROVEN region fill (KNOWN-SOLUTIONS.md §4, lib/fill/regionFill) — span-flood
    // on a GAP-CLOSED mask, then CLIP to the VISIBLE ink → fills INNER, OUTER/ring,
    // closed AND freehand-gapped, with NO bleed and NO seed-swallow at the edge
    // (the module nudges a near-ink seed to paper — fixes the ring-tap-misses bug
    // the escalation had). Params are EMPIRICALLY calibrated (regionFill.calib.mjs
    // donut sweep): inkRadius = the VISIBLE perfect-freehand half-width (0.02
    // world), gapClose 0.4 world = the sweet spot (lower → gapped ring misses;
    // higher → over-closes small features). Commit RAW (no conform) — geometry is
    // already no-bleed by construction.
    const worldXY = world.map((s) => s.map((v) => [v.x, v.y] as [number, number]));
    const visInk = STROKE_OPTS.size * 0.5 * WORLD_SCALE; // ≈0.02 world = the visible ink
    // TRAPPED-BALL multi-scale (regionFill.multiscale, KNOWN-SOLUTIONS §1A):
    // descending gap-close ladder + pick the LARGEST bounded flood → a tiny
    // nested shape fills its OWN small region, a wide donut ring fills its FULL
    // extent (no sliver, no spurious artifact), no bleed (clip to visible ink).
    // Fixes both the donut/ring AND the tiny-nested-triangle in one pass.
    // RESOLUTION SCALING (R1 nested-fill, 2026-06-15): the flood grid sizes its
    // cell to the CLUSTER span, so a tiny feature nested in a big shape (a small
    // circle inside a big one, a narrow hole) gets too few cells and starves —
    // it fills the parent or misses. Bump resolution so the SMALLEST member
    // feature still gets ~TARGET_INNER_CELLS cells across, capped for perf. A
    // single shape (or same-size siblings) → ratio≈1 → stays at the 400 floor
    // (zero regression vs the old fixed FILL_GRID_RESOLUTION).
    const TARGET_INNER_CELLS = 48;
    const FILL_MAX_RES = 900;
    let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
    let smallestFeaturePx = Infinity;
    for (const i of pick) {
      const b = bbs[i];
      if (b[0] < cMinX) cMinX = b[0];
      if (b[1] < cMinY) cMinY = b[1];
      if (b[2] > cMaxX) cMaxX = b[2];
      if (b[3] > cMaxY) cMaxY = b[3];
      const feat = Math.max(b[2] - b[0], b[3] - b[1]);
      if (feat > 1 && feat < smallestFeaturePx) smallestFeaturePx = feat;
    }
    const clusterSpanPx = Math.max(cMaxX - cMinX, cMaxY - cMinY);
    if (!Number.isFinite(smallestFeaturePx) || smallestFeaturePx <= 0) {
      smallestFeaturePx = clusterSpanPx || 1;
    }
    const ratio = clusterSpanPx > 0 ? clusterSpanPx / smallestFeaturePx : 1;
    const dynRes = Math.min(
      FILL_MAX_RES,
      Math.max(FILL_GRID_RESOLUTION, Math.ceil(ratio * TARGET_INNER_CELLS)),
    );
    const result = fillRegionAtMultiScale(worldXY, seedWorld.x, seedWorld.y, {
      inkRadius: visInk,
      resolution: dynRes,
      maxResolution: dynRes,
      // Wire the Gap slider through (Sebs 2026-06-19/20): None/Small/Med/Large
      // (gapMult) only ADDS gap-close above the baseline — `max(1, gapMult)` — so
      // dialing Gap UP seals bigger gaps, but LOW settings never drop BELOW the
      // 6px baseline (the regression Sebs hit at 0.5×: a hand-drawn circle leaked
      // because the close fell to 3px → the flood grabbed the bigger region).
      // Default (gapMult=1) = 6px = unchanged; the multiscale still picks the
      // largest BOUNDED flood, so a cleanly-closed shape fills inner-only.
      gapClosePx: DEFAULT_GAP_CLOSE_PX * Math.max(1, gapMult),
    });
    if (!result) return null;
    // world → viewBox px (inverse of normalize, this cluster's center).
    const toVb = ([wx, wy]: [number, number]): [number, number] => [
      Math.round((wx / WORLD_SCALE + center.x) * 10) / 10,
      Math.round((center.y - wy / WORLD_SCALE) * 10) / 10,
    ];
    return { outline: result.outline.map(toVb), holes: result.holes.map((h) => h.map(toVb)) };
  }

  /** Commit a fill patch (outline + holes, viewBox px) into the band grid with
   *  the clean-edge ink conform, then re-extract the tone record. The shared
   *  core of both the flood-fill commit and the region-tree (highlight) path.
   *  REPLACE semantics, src/gapTol provenance; dilation tucks tone under the ink. */
  function applyFillPatch(
    outline: [number, number][],
    holes: [number, number][][],
    gapMult: number,
    gesture: ShadeFillGesture,
    logRegion: FillRegion | null,
    regionCount: number,
    conform = true,
  ) {
    const grid = toneGridRef.current;
    if (!grid) return;
    const band = shadeRef.current?.erase ? 0 : shadeRef.current?.band ?? 3;
    if (conform) {
      // CLEAN EDGE (region-tree / highlight path): grow the tone up to the EXACT
      // perfect-freehand ink outlines of the bordering strokes (no bleed, no
      // sliver, true corners); centerlines are the secondary conform.
      const inkOutlines = inkOutlinesNear(strokes, outline, gapMult);
      const inkCenterlines = strokeCenterlinesNear(strokes, outline, gapMult);
      rasterizeFillPatch(grid, outline, holes, band, 'fill', {
        gapTol: gapMult,
        dilatePx: fillDilatePx(gapMult, !!shadeRef.current?.fullFill),
        inkOutlines: inkOutlines.length > 0 ? inkOutlines : undefined,
        inkCenterlines: inkCenterlines.length > 0 ? inkCenterlines : undefined,
      });
    } else {
      // RAW (flood path): the regionFill module already clipped the geometry to
      // the VISIBLE ink (no bleed by construction) — rasterize as-is, NO dilation
      // or conform (which would grow it past the line).
      rasterizeFillPatch(grid, outline, holes, band, 'fill', { gapTol: gapMult, dilatePx: 0 });
    }
    setToneFills(extractSmoothFills(grid));
    lastMissRef.current = false;
    logShadeFill('fill', gesture, gapMult, logRegion, 'committed', regionCount);
  }

  /** Region-tree commit (highlight-drag majority-vote path): commit the chosen
   *  extractor region + its child islands as holes. */
  function applyFillRegion(
    regions: FillRegion[],
    idx: number,
    gapMult: number,
    gesture: ShadeFillGesture,
  ) {
    applyFillPatch(
      regions[idx].outline,
      fillChildrenOf(regions, idx),
      gapMult,
      gesture,
      regions[idx],
      regions.length,
    );
  }

  /** Tap/scrub-release commit at a point — FLOOD the region the user pointed at
   *  (bounded by ink, robust to nesting); no fillable region = honest miss. */
  function commitFillAt(pt: [number, number], gapIdx: number, gesture: ShadeFillGesture) {
    const gapMult = GAP_LADDER[gapIdx];
    const patch = floodFillAt(pt, gapMult);
    if (!patch || patch.outline.length < 3) {
      lastMissRef.current = true;
      logShadeFill('fill', gesture, gapMult, null, 'miss', 0);
      onFillNote?.(FILL_MISS_NOTE);
      return;
    }
    // conform = true: snap the module's no-bleed region to the EXACT perfect-
    // freehand ink (snug edge, true corners) — the clean-edge work that was
    // already solved. The module outline sits just inside the visible ink, so the
    // conform's proximity (×3 margin) finds the bordering ink and grows the tone
    // snug under it + clips (no bleed, no jaggy raster contour).
    applyFillPatch(patch.outline, patch.holes, gapMult, gesture, null, 1, true);
  }

  /** Highlight-drag release: every point votes for its innermost paper
   *  region; regions with ≥ 0.6 of the votes commit (LazyBrush's rule of
   *  majority, spec §5.3). None over the bar = honest miss. */
  function commitHighlight(pts: [number, number][] | null, gapIdx: number) {
    const regions = regionsFor(gapIdx);
    if (!pts || pts.length < 2) {
      lastMissRef.current = true;
      logShadeFill('fill', 'highlight', GAP_LADDER[gapIdx], null, 'miss', regions.length);
      onFillNote?.(FILL_MISS_NOTE);
      return;
    }
    const votes = new Map<number, number>();
    for (const [x, y] of pts) {
      const hit = innermostPaperRegionAt(x, y, regions);
      if (hit >= 0) votes.set(hit, (votes.get(hit) ?? 0) + 1);
    }
    const winners: number[] = [];
    for (const [idx, n] of votes) {
      if (n / pts.length >= 0.6) winners.push(idx);
    }
    winners.sort((a, b) => a - b); // deterministic commit order
    if (winners.length === 0) {
      lastMissRef.current = true;
      logShadeFill('fill', 'highlight', GAP_LADDER[gapIdx], null, 'miss', regions.length);
      onFillNote?.(FILL_MISS_NOTE);
      return;
    }
    for (const idx of winners) applyFillRegion(regions, idx, GAP_LADDER[gapIdx], 'highlight');
  }

  /** Lasso release: the loop auto-closes and ITS outline is the patch
   *  (D-RF7 — no extractor). Degenerate loops miss honestly. */
  function commitLasso(pts: [number, number][] | null) {
    const grid = toneGridRef.current;
    const gapMult = GAP_LADDER[currentGapIdx];
    if (!grid) return;
    const regionCount = regionsFor(currentGapIdx).length;
    if (!pts || lassoDegenerate(pts)) {
      lastMissRef.current = true;
      logShadeFill('lasso', 'lasso', gapMult, null, 'miss', regionCount);
      onFillNote?.('that lasso is too small — draw a bigger loop');
      return;
    }
    const band = shadeRef.current?.erase ? 0 : shadeRef.current?.band ?? 3;
    rasterizeFillPatch(grid, decimateLoop(pts), [], band, 'lasso', {});
    // extractSmoothFills (not raw extract): lasso patches pass through untouched
    // (smoothFillEdges only refines src:'fill'), and any pre-existing FILL patch
    // keeps its smooth ink edge re-asserted (idempotent) rather than reverting to
    // the grid contour.
    setToneFills(extractSmoothFills(grid));
    const outcome = lastMissRef.current ? 'lasso-after-miss' : 'committed';
    lastMissRef.current = false;
    logShadeFill('lasso', 'lasso', gapMult, null, outcome, regionCount);
  }

  /** Tear down any in-flight fill/lasso gesture (tool switches, Escape,
   *  rapid pill cycling — break-battery items). No commit. */
  function resetFillGesture() {
    const g = fillGesRef.current;
    if (g) window.clearTimeout(g.timer);
    fillGesRef.current = null;
    setFillGestureOn(false);
    setScrubState(null);
    setHighlightPts(null);
    setLassoPts(null);
    setFillHover(null);
  }

  // Mirror the preview pool out to an optional host (DrawPanel).
  useEffect(() => {
    onStrokesChange?.(strokes);
  }, [strokes, onStrokesChange]);

  // Mirror the FITTED uploaded-SVG markup out so the host can flatten it into
  // strokes for the 3D engine (svgToStrokes). Same stable-callback idiom.
  useEffect(() => {
    onUploadedSvgChange?.(uploadedSvg?.markup ?? null);
  }, [uploadedSvg, onUploadedSvgChange]);

  // Mirror the tone pool out too — same stable-callback contract.
  useEffect(() => {
    onToneFillsChange?.(toneFills);
  }, [toneFills, onToneFillsChange]);

  // ── SHAPE ASSIST API (Rock F3) ──────────────────────────────────────────────
  // Latest strokes via ref so the API closure (installed once) never goes
  // stale. Snap/Straighten are EXPLICIT acts the host's pills invoke on the
  // last stroke — never on pen-up. fitLast is PURE (no mutation); applyToStroke
  // does the points-replace (stays a stroke, same id, renders in the pen).
  const strokesRef = useRef<Stroke[]>(strokes);
  strokesRef.current = strokes;
  // Selected stroke id via ref so the install-once API never reads a stale
  // selection (round-8 "select a different part").
  const selectedStrokeIdRef = useRef<string | null>(selectedStrokeId);
  selectedStrokeIdRef.current = selectedStrokeId;
  /** The stroke Snap/Straighten targets: the SELECTED stroke if one is set and
   *  still in the pool, else the LAST stroke (the original behavior). */
  const targetStroke = (): Stroke | null => {
    const pool = strokesRef.current;
    if (pool.length === 0) return null;
    const sel = selectedStrokeIdRef.current;
    if (sel) {
      const found = pool.find((s) => s.id === sel);
      if (found) return found;
    }
    return pool[pool.length - 1];
  };
  const snapApiRef = useRef<ShapeSnapApi | null>(null);
  if (snapApiRef.current === null) {
    snapApiRef.current = {
      lastStroke: () => {
        const t = targetStroke();
        return t ? { id: t.id, points: t.points } : null;
      },
      fitLast: (action) => {
        const t = targetStroke();
        if (!t) return null;
        if (t.points.length < 2) return null;
        const result = fitStroke(t.points as StrokeInputPoint[], action);
        return { strokeId: t.id, result };
      },
      applyToStroke: (strokeId, candidate, originalPoints) => {
        const next =
          candidate.kind === 'original'
            ? originalPoints
            : (applyShapeCandidate(candidate, originalPoints as StrokeInputPoint[]) as StrokePoint[]);
        setStrokes((prev) => prev.map((s) => (s.id === strokeId ? { ...s, points: next } : s)));
      },
    };
  }
  useEffect(() => {
    if (snapApiRef.current) onSnapApi?.(snapApiRef.current);
  }, [onSnapApi]);

  function handleFilePick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so same file can be re-uploaded
    if (!file) return;
    setUploadError(null);

    // RASTER IMAGE (PNG/JPG/WebP) → imageToSvg: validates + traces (Quiver via our
    // Edge fn) + simplifyToSketch + sanitize, all inside the lib. The output is
    // already clean line-art in OUR register, so we only fit it to the canvas box
    // (NO second simplifyToSketch — that's done in imageToSvg). Same contract as a
    // prepared .svg from here on: setUploadedSvg → restyles + 3D-ports identically.
    if (isRasterImageFile(file)) {
      setUploadBusy(true);
      try {
        const traced = await imageToSvg(file);
        if (traced.ok) {
          const markup = fitUploadMarkup(traced.markup);
          setRawSvgUpload(null); // images don't carry the .svg-only Simplify toggle
          setUploadedSvg({ name: file.name, markup });
          setUploadError(null);
        } else {
          setUploadError(traced.error);
        }
      } catch (err) {
        setUploadError(`Image tracing failed: ${(err as Error).message}`);
      } finally {
        setUploadBusy(false);
      }
      return;
    }

    // SVG upload — shared prep: type check + <svg> extraction + DOMPurify sanitize
    // (lib/svgUpload), the SAME sanitizer the desk feed uses. Then apply the chosen
    // SIMPLIFY MODE (off/filled/line) so the user picks how this upload enters our
    // register (Sebs 2026-06-16). Smart default matches the source (filled art →
    // 'filled', stroke-only → 'line'). We keep the RAW prepared markup so
    // changeSimplifyMode can re-process the SAME upload live (no re-pick).
    // applyUploadSimplify degrades safely (input unchanged if unparseable).
    const result = await prepareSvgUpload(file);
    if (result.ok) {
      const mode = defaultSimplifyMode(result.markup);
      setSimplifyMode(mode);
      setRawSvgUpload(result.markup);
      const processed = applyUploadSimplify(result.markup, mode);
      const markup = fitUploadMarkup(processed);
      setUploadedSvg({ name: result.name, markup });
      setUploadError(null);
    } else {
      setUploadError(result.error);
    }
  }

  /** Re-process the CURRENT .svg upload through a new simplify mode without a
   *  re-pick: re-apply applyUploadSimplify to the stored raw markup, re-fit, and
   *  push it through the SAME setUploadedSvg path so the preview updates live.
   *  No-op (just sets the mode) if no .svg is staged. */
  function changeSimplifyMode(m: UploadSimplifyMode) {
    setSimplifyMode(m);
    if (!rawSvgUpload) return;
    const processed = applyUploadSimplify(rawSvgUpload, m);
    const markup = fitUploadMarkup(processed);
    setUploadedSvg((prev) => ({ name: prev?.name ?? 'upload.svg', markup }));
  }

  function clearUpload() {
    setUploadedSvg(null);
    setRawSvgUpload(null);
    setUploadError(null);
  }

  // (Removed the smartHachure param-set + reload — engine defaults ON now;
  // the reload caused the white flash. ?smartHachure=0 opts out.)

  // Accepts a React pointer event OR a raw DOM PointerEvent (the coalesced
  // sub-frame samples from getCoalescedEvents) — only clientX/Y + pressure are
  // read, which both carry.
  function eventToSvgPoint(e: { clientX: number; clientY: number; pressure?: number }): StrokePoint {
    const svg = svgRef.current;
    if (!svg) return [e.clientX, e.clientY, 0.5];
    // Map screen coords into SVG viewBox coords via the inverse screen CTM —
    // otherwise strokes drawn at e.g. (200, 100) land at tiny viewBox
    // coordinates when the canvas is rendered smaller than its 800×600 viewBox.
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      const rect = svg.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top, e.pressure || 0.5];
    }
    const svgPt = pt.matrixTransform(ctm.inverse());
    return [svgPt.x, svgPt.y, e.pressure || 0.5];
  }

  // The shade register owns the pointer when active (and drawing isn't
  // paused) — same gating as ink, different tool in the hand. The register
  // answers "tone goes down"; `tool` answers how (D-RF1).
  const shadeActive = !!shade?.active && !styled && input === 'draw' && mode !== '3d';
  const shadeToolKind: ShadeTool = shade?.tool ?? 'brush';
  const brushActive = shadeActive && shadeToolKind === 'brush';
  const fillActive = shadeActive && shadeToolKind === 'fill';
  const lassoActive = shadeActive && shadeToolKind === 'lasso';

  // Tool/register switches mid-gesture never strand a half-armed scrub or a
  // dangling lasso trail (rapid pill cycling — the break battery); stroke
  // edits invalidate the region cache wholesale.
  useEffect(() => {
    resetFillGesture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shadeToolKind, shade?.erase, shadeActive, strokesSig]);

  // Entering Fill mode (or stroke edits while in it) pre-extracts the current
  // ladder step so the first hover answers instantly (spec §6: run on
  // entering Fill + debounced after stroke edits, NOT per pointermove).
  useEffect(() => {
    if (!fillActive) return;
    const t = window.setTimeout(() => regionsFor(currentGapIdx), 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillActive, strokesSig, currentGapIdx]);

  /** Stamp one brush segment into the band grid — paint goes through the §3
   *  marker table; erase is the band-0 stamp (per-cell partial carve, §4 —
   *  the whole-patch lift this replaces couldn't carve). */
  function stampSegment(to: [number, number]) {
    const grid = toneGridRef.current;
    if (!grid || !shade) return;
    const from = lastTonePtRef.current ?? to;
    stampToneCapsule(grid, from[0], from[1], to[0], to[1], shade.radius, shade.erase ? 0 : shade.band);
    lastTonePtRef.current = to;
  }

  /** Pen-lift: the grid is the truth — extract merged per-band islands
   *  (pool-raster contours + holes) into the patch pool. Deterministic:
   *  same gestures → same grid → byte-identical record. */
  function commitToneStroke() {
    const grid = toneGridRef.current;
    // extractSmoothFills: brush patches pass through (smoothFillEdges only
    // refines src:'fill'); a pre-existing FILL keeps its smooth ink edge.
    if (grid) setToneFills(extractSmoothFills(grid));
    toneGestureRef.current = false;
    setToneBrush(null);
    lastTonePtRef.current = null;
  }

  // Whether a TONE gesture is mid-flight (pen down) — ref, not state, so the
  // Escape-cancel listener below never goes stale across pointermoves.
  const toneGestureRef = useRef(false);

  // TAP-TO-SELECT bookkeeping (round-8): the ink pointer-down's start point +
  // a moved flag. A pen-up that never moved past TAP_SLOP_PX is a TAP, not a
  // stroke — in the Ink register a tap on an earlier committed stroke SELECTS
  // it for Snap/Straighten (it stops being a rejected 1-point micro-stroke and
  // becomes a selection gesture). Refs so the move/up handlers read fresh
  // values without re-render churn.
  const inkDownPtRef = useRef<[number, number] | null>(null);
  const inkMovedRef = useRef(false);

  // ─── BUTTERY LIVE INK (Sebs 2026-06-18: "make drawing smooth + buttery") ─────
  // The in-progress stroke is rendered IMPERATIVELY: points accumulate in a ref
  // and an rAF writes the path `d` straight to the DOM. A pointermove never calls
  // setState, so React stops re-rendering the whole surface — and re-running
  // perfect-freehand on EVERY committed stroke — on every pointer sample (the
  // O(n-strokes)-per-point lag). We commit to React state ONCE on pointer-up.
  // `current` stays a state flag (null vs set) so the live <path> mounts and the
  // tap-vs-drag gates still work; livePointsRef is the point-truth during a drag.
  const livePointsRef = useRef<StrokePoint[] | null>(null);
  const livePathRef = useRef<SVGPathElement | null>(null);
  const liveRafRef = useRef<number | null>(null);
  function flushLivePath() {
    liveRafRef.current = null;
    const el = livePathRef.current;
    const pts = livePointsRef.current;
    if (el && pts && pts.length > 0) el.setAttribute('d', strokeToPolygonPath(pts));
  }
  function endLiveInk() {
    livePointsRef.current = null;
    if (liveRafRef.current !== null) {
      cancelAnimationFrame(liveRafRef.current);
      liveRafRef.current = null;
    }
  }
  const TAP_SLOP_PX = 6;
  const SELECT_HIT_RADIUS_PX = 22; // generous outline grab (Sebs: bigger hit target)
  // SHAPE INSERT (§6.3): below this a drag is a "click" → default-size place.
  const INSERT_MIN_PX = 8;
  const INSERT_DEFAULT_PX = 120;
  // MOVE/RESIZE handles for a selected stroke.
  const HANDLE_HIT_PX = 16; // corner-handle grab radius (viewBox px)
  const HANDLE_SIZE_PX = 10; // visual handle square
  function strokeBBox(points: StrokePoint[]): { x: number; y: number; w: number; h: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  function cornerXY(c: 'nw' | 'ne' | 'sw' | 'se', b: { x: number; y: number; w: number; h: number }) {
    return {
      x: c === 'nw' || c === 'sw' ? b.x : b.x + b.w,
      y: c === 'nw' || c === 'ne' ? b.y : b.y + b.h,
    };
  }
  function oppositeCorner(c: 'nw' | 'ne' | 'sw' | 'se'): 'nw' | 'ne' | 'sw' | 'se' {
    return c === 'nw' ? 'se' : c === 'ne' ? 'sw' : c === 'sw' ? 'ne' : 'nw';
  }
  function hitCorner(b: { x: number; y: number; w: number; h: number }, px: number, py: number): 'nw' | 'ne' | 'sw' | 'se' | null {
    for (const c of ['nw', 'ne', 'sw', 'se'] as const) {
      const p = cornerXY(c, b);
      if (Math.abs(px - p.x) <= HANDLE_HIT_PX && Math.abs(py - p.y) <= HANDLE_HIT_PX) return c;
    }
    return null;
  }
  /** Apply a move (translate) or resize (scale about the opposite corner) to the
   *  transform's start points, returning the new points. */
  function applyTransformTo(
    t: { mode: 'move' | 'resize'; corner: 'nw' | 'ne' | 'sw' | 'se'; box0: { x: number; y: number; w: number; h: number }; pts0: StrokePoint[]; start: [number, number] },
    px: number,
    py: number,
  ): StrokePoint[] {
    if (t.mode === 'move') {
      const dx = px - t.start[0];
      const dy = py - t.start[1];
      return t.pts0.map(([x, y, p]) => [x + dx, y + dy, p] as StrokePoint);
    }
    const O = cornerXY(oppositeCorner(t.corner), t.box0);
    const C0 = cornerXY(t.corner, t.box0);
    let sx = (px - O.x) / ((C0.x - O.x) || 1e-6);
    let sy = (py - O.y) / ((C0.y - O.y) || 1e-6);
    sx = (sx < 0 ? -1 : 1) * Math.max(Math.abs(sx), 0.05);
    sy = (sy < 0 ? -1 : 1) * Math.max(Math.abs(sy), 0.05);
    return t.pts0.map(([x, y, p]) => [O.x + (x - O.x) * sx, O.y + (y - O.y) * sy, p] as StrokePoint);
  }
  /** BBox of a tone patch's outer outline (the move/resize handle frame). */
  function toneBBox(f: ToneFill): { x: number; y: number; w: number; h: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of f.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  /** Apply the active tone transform to one polygon ring (outline or a hole). */
  function applyRingTransform(t: NonNullable<typeof toneTransform>, px: number, py: number, ring: [number, number][]): [number, number][] {
    if (t.mode === 'move') {
      const dx = px - t.start[0];
      const dy = py - t.start[1];
      return ring.map(([x, y]) => [x + dx, y + dy] as [number, number]);
    }
    const O = cornerXY(oppositeCorner(t.corner), t.box0);
    const C0 = cornerXY(t.corner, t.box0);
    let sx = (px - O.x) / ((C0.x - O.x) || 1e-6);
    let sy = (py - O.y) / ((C0.y - O.y) || 1e-6);
    sx = (sx < 0 ? -1 : 1) * Math.max(Math.abs(sx), 0.05);
    sy = (sy < 0 ? -1 : 1) * Math.max(Math.abs(sy), 0.05);
    return ring.map(([x, y]) => [O.x + (x - O.x) * sx, O.y + (y - O.y) * sy] as [number, number]);
  }
  /** The moved/resized version of a tone patch under the active transform. */
  function applyToneTransform(f: ToneFill, t: NonNullable<typeof toneTransform>, px: number, py: number): ToneFill {
    return {
      ...f,
      points: applyRingTransform(t, px, py, f.points),
      holes: f.holes?.map((h) => applyRingTransform(t, px, py, h)),
    };
  }
  /** Normalize the drag corners into a bbox; Shift = aspect-lock 1:1 (square /
   *  circle / regular polygon), keeping the down corner fixed (Figma/Excalidraw). */
  function normalizeInsertBox(start: [number, number], cur: [number, number], shift: boolean) {
    let w = Math.abs(cur[0] - start[0]);
    let h = Math.abs(cur[1] - start[1]);
    let x = Math.min(start[0], cur[0]);
    let y = Math.min(start[1], cur[1]);
    if (shift) {
      const s = Math.max(w, h);
      x = cur[0] >= start[0] ? start[0] : start[0] - s;
      y = cur[1] >= start[1] ? start[1] : start[1] - s;
      w = s;
      h = s;
    }
    return { x, y, w, h };
  }
  /** The outline for an armed shape at a box. Handles the recognizer-core kinds
   *  (rect/square/triangle/circle/ellipse) DIRECTLY — they're not in shapeLibrary
   *  (which only generates the 12 library shapes) — and aliases star→star-5,
   *  arrow→arrow-block, else defers to generateShape. */
  function insertOutlineFor(kind: string, box: { x: number; y: number; w: number; h: number }): [number, number][] | null {
    const { x, y, w, h } = box;
    if (kind === 'rect' || kind === 'square') {
      return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    }
    if (kind === 'triangle') {
      return [[x + w / 2, y], [x + w, y + h], [x, y + h]];
    }
    if (kind === 'circle' || kind === 'ellipse') {
      const out: [number, number][] = [];
      const n = 48, cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
      }
      return out;
    }
    const alias: Record<string, string> = { star: 'star-5', arrow: 'arrow-block' };
    const o = generateShape((alias[kind] ?? kind) as Parameters<typeof generateShape>[0], box);
    return o ? (o as unknown as [number, number][]) : null;
  }
  /** Generate an armed shape at the box and densify+weld it into a stroke (same
   *  applyCandidate path a snap uses, so an insert renders sealed like a snap). */
  function insertStrokeFromBox(kind: string, box: { x: number; y: number; w: number; h: number }): Stroke | null {
    const outline = insertOutlineFor(kind, box);
    if (!outline || outline.length < 3) return null;
    const cand: ShapeCandidate = {
      kind: 'polygon',
      points: outline as unknown as ShapeCandidate['points'],
      normErr: 0,
      score: 1,
      closed: true,
      label: 'insert',
      notes: `library:${kind}`,
    };
    const seed = outline.map(([px, py]) => [px, py, 0.5] as StrokePoint);
    const pts = applyShapeCandidate(cand, seed as unknown as Parameters<typeof applyShapeCandidate>[1]) as unknown as StrokePoint[];
    return { id: `ins-${Date.now()}`, points: pts };
  }

  // ESCAPE = CANCEL THE IN-PROGRESS GESTURE (capture phase, ahead of the host
  // popup's layered-Escape handler — rock-F1 break battery caught the popup
  // closing mid-first-stroke and eating the gesture, because the host's guard
  // sees only COMMITTED strokes/tone). Mid-stroke Escape aborts just the
  // stroke: ink discards the in-progress points; tone restores the pre-stroke
  // grid snapshot (erase included — true cancel). The gesture is the topmost
  // "layer", so stopPropagation keeps every other Escape layer untouched;
  // with the pen up this listener isn't even mounted.
  const gestureActive =
    current !== null || toneBrush !== null || fillGestureOn || lassoPts !== null;
  useEffect(() => {
    if (!gestureActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setCurrent(null);
      if (toneGestureRef.current) {
        const grid = toneGridRef.current;
        const snap = toneSnapshotRef.current;
        if (grid && snap) {
          grid.bands.set(snap.bands);
          grid.src.set(snap.src);
          grid.gapTolQ.set(snap.gapTolQ);
        }
        toneGestureRef.current = false;
        setToneBrush(null);
        lastTonePtRef.current = null;
      }
      // Fill/lasso gesture cancel (rock F2): no commit; a scrub restores the
      // pre-scrub Gap (true cancel — the persisted value is the one the user
      // RELEASED at, never the one they bailed on). Logged as 'cancelled'.
      const g = fillGesRef.current;
      if (g) {
        window.clearTimeout(g.timer);
        if (g.phase === 'scrub') onGapChange?.(GAP_LADDER[g.baseGapIdx]);
        logShadeFill(
          'fill',
          g.phase === 'scrub' ? 'scrub' : g.phase === 'highlight' ? 'highlight' : 'tap',
          GAP_LADDER[g.phase === 'scrub' ? g.lastIdx : g.baseGapIdx],
          null,
          'cancelled',
          regionCacheRef.current.get(`${strokesSig}|${g.lastIdx}`)?.length ?? 0,
        );
        fillGesRef.current = null;
        setFillGestureOn(false);
        setScrubState(null);
        setHighlightPts(null);
      } else if (lassoPts !== null) {
        logShadeFill('lasso', 'lasso', GAP_LADDER[currentGapIdx], null, 'cancelled', 0);
        setLassoPts(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestureActive]);

  /** Whole-object delete at a point (the Erase OBJECT mode): drop the stroke under
   *  the point AND the tone patch under it, then re-sync the grid. */
  const deleteWholeAt = (x: number, y: number) => {
    const sid = strokeAtPoint(strokes, x, y, ERASE_HIT_R) ?? strokeContainingPoint(strokes, x, y);
    const tid = toneFillAtPoint(toneFillsRef.current, x, y);
    if (sid) {
      setStrokes((prev) => prev.filter((s) => s.id !== sid));
      if (selectedStrokeId === sid) { setSelectedStrokeId(null); onSelectionChange?.(null); }
    }
    if (tid) {
      setToneFills((prev) => {
        const next = prev.filter((f) => f.id !== tid);
        regridTone(next); // re-sync the grid from the surviving patches (no stale ref)
        return next;
      });
      if (selectedToneId === tid) setSelectedToneId(null);
    }
  };

  // ERASE — PARTIAL brush eraser (Sebs 2026-06-16 "it only lets me delete the full
  // line… should have both modes"): rubs out only the stroke POINTS under the brush
  // footprint, SPLITTING a stroke into the runs that survive on either side (carve
  // through it, don't nuke the whole line). A stroke fully under the brush vanishes.
  // The WHOLE-object delete is the other mode (✕ / Delete on a selection). Tone is
  // carved by the same gesture's band-0 stamp. Radius matches the visible brush.
  const ERASE_HIT_R = 18;
  const eraseStrokesNear = (x: number, y: number) => {
    const R = shade?.radius ?? ERASE_HIT_R;
    const R2 = R * R;
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const next: Stroke[] = [];
      for (const s of prev) {
        let touched = false;
        const runs: StrokePoint[][] = [];
        let run: StrokePoint[] = [];
        for (const p of s.points) {
          const dx = p[0] - x;
          const dy = p[1] - y;
          if (dx * dx + dy * dy <= R2) {
            touched = true;
            if (run.length >= 2) runs.push(run);
            run = [];
          } else {
            run.push(p);
          }
        }
        if (run.length >= 2) runs.push(run);
        if (!touched) {
          next.push(s);
          continue;
        }
        changed = true;
        // Surviving runs become their own strokes; <2-pt scraps (and a fully
        // brushed stroke → zero runs) are dropped = erased.
        runs.forEach((r, i) => next.push({ ...s, id: `${s.id}~${i}`, points: r }));
      }
      if (!changed) return prev;
      if (selectedStrokeId && !next.some((s) => s.id === selectedStrokeId)) {
        setSelectedStrokeId(null);
        onSelectionChange?.(null);
      }
      return next;
    });
  };

  function handlePointerDown(e: React.PointerEvent) {
    // Style mode pauses drawing — flip back to Draw to keep sketching.
    if (styled) return;
    if (input !== 'draw' || mode === '3d') return;
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    // LOSSLESS PART EDITOR (2026-06-24): a press that lands ON a shape part of an
    // editable upload selects THAT part (the browser hit-tested it natively via the
    // data-part-id element) — parallels stroke tap-select, fills untouched. Gated
    // behind editableParts so this is dormant for normal drawing. Pressing empty
    // space clears the part selection and falls through to draw as usual.
    if (editableParts) {
      // Hit-test entirely in the 800×600 FRAME space (same as strokes): no nested-svg
      // / getCTM bridge — eventToSvgPoint gives frame coords, frameBoxOf gives each
      // part's frame box, and we reuse the stroke hitCorner / cornerXY helpers. A
      // press on a corner handle of the SELECTED part resizes; on a part body selects
      // (or moves it if already selected); on empty space clears + falls through to
      // draw. This is the rebuild — the old nested-space/getCTM mismatch was the whole
      // "box pops off and lands somewhere else" bug (Sebs 2026-06-25).
      const [x, y] = eventToSvgPoint(e);
      // RESIZE — a corner handle of the already-selected part.
      if (selectedPartId) {
        const selPart = editableParts.parts.find((p) => p.id === selectedPartId);
        if (selPart && !deletedParts.has(selPart.id)) {
          // detect on the padded box (so thin-part handles are grabbable); pivot the
          // resize on the padded box too so a thin part has a non-degenerate box0.
          const corner = hitCorner(displayBoxOf(selPart), x, y);
          if (corner) {
            setPartXform({ id: selPart.id, mode: 'resize', corner, box0: displayBoxOf(selPart), start: [x, y] });
            return;
          }
        }
      }
      // SELECT / MOVE — smallest (padded) frame box containing the click wins, so a
      // small part under a big one is still grabbable AND thin/straight parts (a line,
      // a flat smile stroke) get a clickable band instead of an unhittable hairline.
      // Press the already-selected part ⇒ move it (move uses the REAL box, no fatten).
      let hitId: string | null = null;
      let bestArea = Infinity;
      for (const part of editableParts.parts) {
        if (deletedParts.has(part.id)) continue;
        const b = displayBoxOf(part);
        if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
        const area = b.w * b.h;
        if (area < bestArea) { bestArea = area; hitId = part.id; }
      }
      if (hitId) {
        if (hitId === selectedPartId) {
          const sp = editableParts.parts.find((p) => p.id === hitId)!;
          setPartXform({ id: hitId, mode: 'move', corner: 'se', box0: frameBoxOf(sp), start: [x, y] });
        } else {
          setSelectedPartId(hitId);
          onSelectPart?.(hitId);
          setSelectedStrokeId(null);
        }
        return;
      }
      if (selectedPartId) { setSelectedPartId(null); onSelectPart?.(null); }
    }
    if (armedShape) {
      // SHAPE INSERT (§6.2) — an armed shape owns the pointer; drag = bbox.
      const [x, y] = eventToSvgPoint(e);
      insertShiftRef.current = e.shiftKey;
      setInsertBox({ start: [x, y], cur: [x, y] });
      return;
    }
    if (fillActive) {
      // FILL — one pointer-down, three possible gestures (spec §5/§6):
      // release fast+still = TAP; move first = HIGHLIGHT scribble; hold
      // ~350ms still = the Gap SCRUB arms (horizontal drag walks the ladder
      // with a live re-extracted preview; release commits at that step).
      const [x, y] = eventToSvgPoint(e);
      const baseGapIdx = currentGapIdx;
      const timer = window.setTimeout(() => {
        const g = fillGesRef.current;
        if (g && g.phase === 'pending') {
          g.phase = 'scrub';
          setScrubState({ idx: g.baseGapIdx, anchor: g.start });
        }
      }, 350);
      fillGesRef.current = { phase: 'pending', start: [x, y], baseGapIdx, lastIdx: baseGapIdx, timer };
      setFillGestureOn(true);
      setFillHover(null);
      return;
    }
    if (lassoActive) {
      const [x, y] = eventToSvgPoint(e);
      setLassoPts([[x, y]]);
      return;
    }
    if (shadeActive) {
      const [x, y] = eventToSvgPoint(e);
      const beginTone = () => {
        const grid = toneGridRef.current!;
        beginToneStroke(grid); // new stroke — reset the §3 dirty bitset
        toneSnapshotRef.current = { bands: grid.bands.slice(), src: grid.src.slice(), gapTolQ: grid.gapTolQ.slice() };
        toneGestureRef.current = true;
        lastTonePtRef.current = null;
      };
      // ERASE rides the shade gesture but ONLY erases — never selects/moves/paints.
      if (eraseStrokes) {
        beginTone();
        stampSegment([x, y]);
        // OBJECT = remove the whole stroke/patch under the cursor; PIXEL = carve
        // only the brushed part (band-0 stampSegment above carves tone in pixel).
        if (eraseMode === 'object') deleteWholeAt(x, y);
        else eraseStrokesNear(x, y);
        setToneBrush([[x, y]]);
        return;
      }
      // SHADE register (model B) — TONE is ARRANGED here. Move/resize a selected
      // patch; else DEFER (tap on lift = select a patch, drag = paint).
      if (selectedToneId) {
        const sel = toneFills.find((f) => f.id === selectedToneId);
        if (sel) {
          const bb = toneBBox(sel);
          const corner = hitCorner(bb, x, y);
          if (corner) {
            setToneTransform({ id: sel.id, mode: 'resize', corner, box0: bb, base: sel, start: [x, y] });
            return;
          }
          if (pointInStroke(sel.points, x, y) && !sel.holes?.some((h) => h.length >= 3 && pointInStroke(h, x, y))) {
            setToneTransform({ id: sel.id, mode: 'move', corner: 'se', box0: bb, base: sel, start: [x, y] });
            return;
          }
        }
      }
      shadeGestureRef.current = { start: [x, y], moved: false }; // paint begins on first move
      return;
    }
    // MOVE/RESIZE a selected stroke — before a new ink stroke. Grab a corner
    // handle = resize; press on the stroke's own ink = move (Sebs 2026-06-15).
    if (selectedStrokeId) {
      const sel = strokes.find((s) => s.id === selectedStrokeId);
      if (sel) {
        const [px, py] = eventToSvgPoint(e);
        const bb = strokeBBox(sel.points);
        const corner = hitCorner(bb, px, py);
        if (corner) {
          setTransform({ mode: 'resize', corner, box0: bb, pts0: sel.points.slice(), start: [px, py] });
          return;
        }
        // MOVE: press on the selected shape's BODY (inside its closed area) or
        // near its outline → drag moves it. Using the closed-area test (not the
        // whole bbox) means the EMPTY corners of a selected shape's bbox still
        // DRAW — so "draw inside a shape" keeps working: deselect (tap paper) to
        // draw freely, or draw in the bbox margin (Sebs 2026-06-15).
        const onBody = pointInStroke(sel.points, px, py);
        const nearOutline = strokeAtPoint([sel], px, py, SELECT_HIT_RADIUS_PX) === sel.id;
        if (onBody || nearOutline) {
          setTransform({ mode: 'move', corner: 'se', box0: bb, pts0: sel.points.slice(), start: [px, py] });
          return;
        }
      }
    }
    // INK gesture begins — record the start for tap-vs-drag classification.
    const startPt = eventToSvgPoint(e);
    inkDownPtRef.current = [startPt[0], startPt[1]];
    inkMovedRef.current = false;
    livePointsRef.current = [startPt];
    setCurrent({ id: `s-${Date.now()}`, points: [startPt] });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (partXform) {
      // Move / resize the selected part, all in FRAME space, writing its new frame
      // box (the source of truth). Resize mirrors the stroke's applyTransformTo:
      // scale about the OPPOSITE corner with a 0.05 floor, so the grabbed corner
      // tracks the cursor and the opposite stays pinned.
      const [x, y] = eventToSvgPoint(e);
      const t = partXform;
      if (t.mode === 'move') {
        const dx = x - t.start[0], dy = y - t.start[1];
        setPartBoxes((prev) => ({ ...prev, [t.id]: { x: t.box0.x + dx, y: t.box0.y + dy, w: t.box0.w, h: t.box0.h } }));
      } else {
        const O = cornerXY(oppositeCorner(t.corner), t.box0);
        const C0 = cornerXY(t.corner, t.box0);
        let sx = (x - O.x) / ((C0.x - O.x) || 1e-6);
        let sy = (y - O.y) / ((C0.y - O.y) || 1e-6);
        sx = Math.max(Math.abs(sx), 0.05);
        sy = Math.max(Math.abs(sy), 0.05);
        const nw = t.box0.w * sx, nh = t.box0.h * sy;
        const nx = t.corner === 'nw' || t.corner === 'sw' ? O.x - nw : O.x;
        const ny = t.corner === 'nw' || t.corner === 'ne' ? O.y - nh : O.y;
        setPartBoxes((prev) => ({ ...prev, [t.id]: { x: nx, y: ny, w: nw, h: nh } }));
      }
      return;
    }
    if (insertBox) {
      const [x, y] = eventToSvgPoint(e);
      insertShiftRef.current = e.shiftKey; // live aspect-lock toggle
      setInsertBox((b) => (b ? { ...b, cur: [x, y] } : b));
      return;
    }
    if (transform) {
      const [px, py] = eventToSvgPoint(e);
      const newPts = applyTransformTo(transform, px, py);
      setStrokes((prev) => prev.map((s) => (s.id === selectedStrokeId ? { ...s, points: newPts } : s)));
      return;
    }
    if (toneTransform) {
      // Move/resize the selected tone patch live (outline + holes). The grid is
      // re-synced on lift (handlePointerUp) so a re-extraction won't snap it back.
      const [px, py] = eventToSvgPoint(e);
      const t = toneTransform;
      setToneFills((prev) => prev.map((f) => (f.id === t.id ? applyToneTransform(t.base, t, px, py) : f)));
      return;
    }
    if (fillActive) {
      const [x, y] = eventToSvgPoint(e);
      setHoverPt([x, y]);
      const g = fillGesRef.current;
      if (!g) {
        // HOVER PREVIEW (spec §5.1): flood the region under the cursor — the SAME
        // bucket-fill the commit uses, so the dashed preview matches exactly what
        // a tap will fill. Cached by a quantized seed cell (~6px) + gap step so
        // the flood recomputes only when the cursor crosses into a new cell.
        const key = `${currentGapIdx}:${Math.round(x / 6)}:${Math.round(y / 6)}`;
        setFillHover((prev) => {
          if (prev && prev.key === key) return prev;
          const patch = floodFillAt([x, y], GAP_LADDER[currentGapIdx]);
          return { key, patch: patch && patch.outline.length >= 3 ? patch : null };
        });
        return;
      }
      if (g.phase === 'pending') {
        if (Math.hypot(x - g.start[0], y - g.start[1]) > 8) {
          window.clearTimeout(g.timer);
          g.phase = 'highlight';
          setHighlightPts([g.start, [x, y]]);
        }
        return;
      }
      if (g.phase === 'scrub') {
        // Horizontal drag walks the ladder — one step per 56 viewBox px.
        // Re-extraction happens at most once per STEP (regionsFor cache).
        const idx = Math.max(
          0,
          Math.min(GAP_LADDER.length - 1, g.baseGapIdx + Math.round((x - g.start[0]) / 56)),
        );
        if (idx !== g.lastIdx) {
          g.lastIdx = idx;
          setScrubState({ idx, anchor: g.start });
          onGapChange?.(GAP_LADDER[idx]); // the chrome slider follows live
        }
        return;
      }
      // highlight
      setHighlightPts((p) => (p ? [...p, [x, y]] : [[x, y]]));
      return;
    }
    if (lassoActive) {
      const [x, y] = eventToSvgPoint(e);
      setHoverPt([x, y]);
      if (lassoPts) setLassoPts((p) => (p ? [...p, [x, y]] : p));
      return;
    }
    if (shadeActive) {
      const [x, y] = eventToSvgPoint(e);
      setHoverPt([x, y]);
      // ERASE — carve / whole-delete along the drag (the gesture already began).
      if (eraseStrokes) {
        if (toneBrush) {
          stampSegment([x, y]);
          if (eraseMode === 'object') deleteWholeAt(x, y);
          else eraseStrokesNear(x, y);
          setToneBrush((b) => (b ? [...b, [x, y]] : b));
        }
        return;
      }
      // PAINT — deferred from a non-selected press; the first real drag starts it
      // (a still tap selects instead, on lift). Once painting, keep stamping.
      const g = shadeGestureRef.current;
      if (g && !g.moved) {
        if (Math.hypot(x - g.start[0], y - g.start[1]) > TAP_SLOP_PX) {
          g.moved = true;
          const grid = toneGridRef.current!;
          beginToneStroke(grid);
          toneSnapshotRef.current = { bands: grid.bands.slice(), src: grid.src.slice(), gapTolQ: grid.gapTolQ.slice() };
          toneGestureRef.current = true;
          lastTonePtRef.current = null;
          stampSegment(g.start);
          stampSegment([x, y]);
          setToneBrush([g.start, [x, y]]);
        }
        return;
      }
      if (toneBrush) {
        stampSegment([x, y]);
        setToneBrush((b) => (b ? [...b, [x, y]] : b));
      }
      return;
    }
    if (!current || !livePointsRef.current) return;
    // ONE point per pointermove event — EXACTLY the old point density that drew
    // smooth (Sebs 2026-06-20: "gets all jaggedy as I draw"). My earlier buttery
    // pass also pulled getCoalescedEvents (many sub-frame samples per frame), which
    // over-densified the input → perfect-freehand's pressure-from-spacing jittered
    // the width into a faceted ribbon. The ACTUAL lag fix was moving the render off
    // setState onto the imperative rAF below — that we keep; the coalesced sampling
    // we drop, so the live line is byte-for-byte the old smooth stroke, just lag-free.
    const live = livePointsRef.current;
    live.push(eventToSvgPoint(e));
    // Mark the gesture as a real drag once it travels past the tap slop — a
    // pen-up below that never set this is a TAP (select), not a stroke.
    const last = live[live.length - 1];
    const start = inkDownPtRef.current;
    if (start && Math.hypot(last[0] - start[0], last[1] - start[1]) > TAP_SLOP_PX) {
      inkMovedRef.current = true;
    }
    // Paint imperatively on the next frame — NO setState, so nothing else in the
    // tree re-renders mid-stroke (the buttery win). Coalesce to one rAF.
    if (liveRafRef.current === null) liveRafRef.current = requestAnimationFrame(flushLivePath);
  }

  function handlePointerUp() {
    if (partXform) { setPartXform(null); return; }
    if (insertBox && armedShape) {
      // SHAPE INSERT commit (§6.2): tiny drag / click → default-size place.
      const start = insertBox.start;
      const box = normalizeInsertBox(start, insertBox.cur, insertShiftRef.current);
      setInsertBox(null);
      if (box.w < INSERT_MIN_PX || box.h < INSERT_MIN_PX) {
        const d = INSERT_DEFAULT_PX;
        box.x = start[0] - d / 2;
        box.y = start[1] - d / 2;
        box.w = d;
        box.h = d;
      }
      const stroke = insertStrokeFromBox(armedShape, box);
      if (stroke) {
        setStrokes((prev) => [...prev, stroke]);
        // AUTO-SELECT the placed shape so its move/resize handles show at once —
        // place → drag to position / corner to resize, no separate tap-select
        // (Sebs 2026-06-15). onSelectionChange notifies the host (receipt logic).
        setSelectedStrokeId(stroke.id);
        onSelectionChange?.(stroke.id);
        onShapeInserted?.(stroke);
      }
      return;
    }
    if (insertBox) { setInsertBox(null); return; }
    if (transform) { setTransform(null); return; }
    if (toneTransform) { setToneTransform(null); regridTone(toneFillsRef.current); return; }
    if (fillActive && fillGesRef.current) {
      const g = fillGesRef.current;
      window.clearTimeout(g.timer);
      fillGesRef.current = null;
      setFillGestureOn(false);
      if (g.phase === 'highlight') {
        commitHighlight(highlightPts, g.baseGapIdx);
        setHighlightPts(null);
      } else if (g.phase === 'scrub') {
        // Release commits at the scrubbed tolerance; the Gap value persists
        // (Procreate's remembered threshold, spec §6).
        commitFillAt(g.start, g.lastIdx, 'scrub');
        setScrubState(null);
      } else {
        commitFillAt(g.start, g.baseGapIdx, 'tap');
      }
      return;
    }
    if (lassoActive && lassoPts) {
      commitLasso(lassoPts);
      setLassoPts(null);
      return;
    }
    if (toneBrush) {
      commitToneStroke();
      shadeGestureRef.current = null;
      return;
    }
    // SHADE TAP (model B): a Shade press that never moved = a TAP → SELECT the tone
    // patch under it (or deselect on bare paper). Painting needed a drag (handled
    // above via toneBrush). Erase never selects.
    if (shadeActive && !eraseStrokes) {
      const g = shadeGestureRef.current;
      shadeGestureRef.current = null;
      if (g && !g.moved) {
        const id = toneFillAtPoint(toneFills, g.start[0], g.start[1]);
        if (id) {
          // tap ON a patch → SELECT it (to move/resize)
          setSelectedToneId(id);
          setSelectedStrokeId(null);
          onSelectionChange?.(null);
        } else {
          // tap on EMPTY paper → DAB a single tone spot (Sebs 2026-06-16 "i can't
          // just dab one click of shade") — beginToneStroke + one stamp + commit.
          setSelectedToneId(null);
          const grid = toneGridRef.current!;
          beginToneStroke(grid);
          toneSnapshotRef.current = { bands: grid.bands.slice(), src: grid.src.slice(), gapTolQ: grid.gapTolQ.slice() };
          toneGestureRef.current = true;
          lastTonePtRef.current = null;
          stampSegment(g.start);
          commitToneStroke();
        }
      }
      return;
    }
    // TAP-TO-SELECT (round-8, model B): a still Ink tap selects an INK stroke (Ink
    // mode arranges ink only; tone is arranged in Shade). A tap on bare paper
    // deselects. A real drag draws.
    if (current && !inkMovedRef.current) {
      const tap = (livePointsRef.current ?? current.points)[0];
      const hitId =
        strokeAtPoint(strokes, tap[0], tap[1], SELECT_HIT_RADIUS_PX) ??
        strokeContainingPoint(strokes, tap[0], tap[1]);
      // SINGLE-TAP DOT (Sebs 2026-06-19): a tap on BARE paper with nothing
      // selected lays a deliberate pen dot (a 1-point stroke renders as a round
      // mark via perfect-freehand) — a real pen leaves a dot, the Ink register
      // shouldn't be silent. A tap that HITS a stroke still selects; a paper tap
      // while something IS selected still DESELECTS (no surprise dot then).
      if (!hitId && !selectedStrokeId) {
        const dot: Stroke = { id: current.id, points: [[tap[0], tap[1], 0.5]] };
        setStrokes((prev) => [...prev, dot]);
        setSelectedToneId(null);
        setCurrent(null);
        endLiveInk();
        inkDownPtRef.current = null;
        onStrokeCommitted?.(dot);
        return;
      }
      setSelectedStrokeId(hitId);
      setSelectedToneId(null);
      onSelectionChange?.(hitId);
      setCurrent(null);
      endLiveInk();
      inkDownPtRef.current = null;
      return;
    }
    // livePointsRef is the point-truth during a drag (current.points stays the
    // seed point — it isn't grown per-move anymore).
    const livePts = livePointsRef.current ?? current?.points ?? [];
    if (!current || livePts.length < 2) { setCurrent(null); endLiveInk(); return; }
    // A genuine new stroke supersedes any selection (the latest stroke is the
    // implicit target again, matching the pre-round-8 behavior).
    setSelectedStrokeId(null);
    setSelectedToneId(null);
    const committed: Stroke = { id: current.id, points: livePts }; // the live points
    setStrokes((prev) => [...prev, committed]);
    setCurrent(null);
    endLiveInk();
    inkDownPtRef.current = null;
    // AUTO-DETECT (OFFER-only): hand the just-committed stroke to the host so it
    // can fit + OFFER the best shape via the override receipt. Never auto-applies.
    onStrokeCommitted?.(committed);
  }

  function handlePointerLeave() {
    setHoverPt(null);
    setFillHover(null);
    handlePointerUp();
  }

  function clearAll() {
    setStrokes([]);
    setCurrent(null);
    endLiveInk();
    setSelectedStrokeId(null);
    setToneFills([]);
    setToneBrush(null);
    lastTonePtRef.current = null;
    const grid = toneGridRef.current;
    if (grid) {
      grid.bands.fill(0); // the grid IS the tone truth — clear it too
      grid.src.fill(0); // provenance sidecars follow the truth
      grid.gapTolQ.fill(0);
    }
    regionCacheRef.current.clear();
    resetFillGesture();
    setCommitted(false);
  }

  function commitDrawing() {
    if (strokes.length === 0) return;
    setCommitted(true);
  }

  function reopenForEdit() {
    setCommitted(false);
  }

  const allStrokes = current ? [...strokes, current] : strokes;
  const isUpload = input === 'upload-svg';
  const isUploadImage = input === 'upload-image';
  // Both upload modes share one picker + preview chrome; handleFileChange routes
  // by the actual file type, so the only per-mode difference is the accept filter
  // and the empty-state copy.
  const isUploadAny = isUpload || isUploadImage;

  // REGION-FILL preview resolution (render-time, cache-backed — extraction
  // never runs per pointermove, only on a cache miss at a new ladder step).
  // Scrub preview re-resolves the region under the press ANCHOR at the live
  // step — the user watches gaps close/regions merge as they drag (§6).
  let fillPreview: { outline: [number, number][]; holes: [number, number][][] } | null = null;
  if (fillActive) {
    if (scrubState) {
      // Scrub: re-flood under the press anchor at the live gap step (watch the
      // region grow / gaps close as the ladder walks — §6).
      const patch = floodFillAt(scrubState.anchor, GAP_LADDER[scrubState.idx]);
      if (patch && patch.outline.length >= 3) fillPreview = patch;
    } else if (fillHover && fillHover.patch) {
      fillPreview = fillHover.patch;
    }
  }

  return (
    <div
      style={{
        width: '100%',
        ...(fill
          ? { height: '100%' }
          : { maxWidth: 920, maxHeight: '100%', aspectRatio: `${VIEWBOX_W} / ${VIEWBOX_H}` }),
        position: 'relative',
        background: 'var(--dir-bg)',
        border: '1px solid var(--dir-border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {/* Hidden file input — surfaces native file picker on click. The accept
          filter follows the chosen input mode (image vs svg), but handleFileChange
          routes by the actual file type, so a stray drop of the other kind still
          works. */}
      <input
        ref={fileInputRef}
        type="file"
        accept={isUploadImage ? 'image/png,image/jpeg,image/webp' : '.svg,image/svg+xml'}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      {/* UPLOAD-SVG branch — when uploaded, render through SvgStyleTransform
          so the uploaded SVG picks up the active style/modifiers. */}
      {isUploadAny && uploadedSvg && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <SvgStyleTransform
            wrapperOverride={{ display: 'block', width: '100%', height: '100%' }}
          >
            <div
              style={{ width: '100%', height: '100%' }}
              dangerouslySetInnerHTML={{ __html: uploadedSvg.markup }}
            />
          </SvgStyleTransform>
        </div>
      )}
      {/* Layer 0 — UPLOAD BACKDROP, raw (Sketch mode). Letterboxed into the
          same 800×600 frame space the strokes live in, so draw-over lands
          where the eye says it does. Hidden in Style mode — the merged layer
          below renders backdrop + strokes together instead. */}
      {backdrop && !styled && !editableParts && (
        <div
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          aria-hidden
          dangerouslySetInnerHTML={{ __html: backdropDisplayMarkup(backdrop) }}
        />
      )}
      {/* Layer 0t — TONE PATCHES, raw (Sketch mode): flat band-grey UNDER the
          ink strokes (round-7 contract), above any upload backdrop. One <g>
          per band at one opacity — overlap WITHIN a band composites solid-
          then-fades, so it never compounds into a band the user didn't brush
          (flat by construction; post-rebuild the extraction merges per-band
          islands so there's at most a handful of disjoint paths per band);
          bands ascend so darker paints over lighter. Opacity 0.9 (was 0.55 —
          WYSIWYG gap SB-3: the styled pipeline reads the FULL band grey, so
          the raw preview must stop lying ~half a ladder light; exact value is
          a Sebs eyeball). Holes render via evenodd subpaths. Style mode skips
          this layer — the patches ride the styled markup instead.
          CLEAN-EDGE (2026-06-13): when the sketch layer (1b) is active it
          RE-ASSERTS the tone over its paper halos (to kill the interior sliver),
          so this base layer would double-paint and darken it — skip here in that
          case (1b owns the tone then). This layer still carries the tone when
          there are no strokes / after commit. */}
      {!styled && toneFills.length > 0 && !(!committed && strokes.length > 0) && (
        <svg
          viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
          width="100%"
          height="100%"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          aria-hidden
        >
          {COVERAGE_BANDS.map((_, band) => {
            const hex = TONE_BAND_HEX[band];
            if (!hex) return null;
            const fills = toneFills.filter((f) => f.band === band && f.points.length >= 3);
            if (fills.length === 0) return null;
            return (
              <g key={band} opacity={0.9}>
                {fills.map((f) => (
                  <path
                    key={f.id}
                    d={tonePathD(f.points, f.holes)}
                    fill={hex}
                    fillRule="evenodd"
                    stroke="none"
                  />
                ))}
              </g>
            );
          })}
        </svg>
      )}
      {/* Layer 0s — UPLOAD BACKDROP + strokes, MERGED, in Style mode: ONE
          SvgStyleTransform over the SAME composed markup Done stages (full-
          frame viewBox so it letterboxes exactly like the raw layers). The
          live preview IS the published render — upload parity, ROUND 6. */}
      {backdrop && styled && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <SvgStyleTransform
            wrapperOverride={{ display: 'block', width: '100%', height: '100%' }}
          >
            <div
              style={{ width: '100%', height: '100%' }}
              aria-hidden
              dangerouslySetInnerHTML={{
                __html: composeBackdropAndStrokes(backdrop, strokes, {
                  tight: false,
                  toneFills,
                }),
              }}
            />
          </SvgStyleTransform>
        </div>
      )}
      {/* Layer 1a — when COMMITTED (or the host's Style mode is on), strokes
          AND tone patches flow through SvgStyleTransform so they pick up the
          active style and re-render live as the pen controls change. Tone
          patches enter FIRST (under ink) as flat solid band-greys — the
          pipeline's signals layer reads the grey as source darkness and the
          shading machinery converts it to fillStyle marks at band density
          (band → coverage.ts — the I-2 wedge). (With a backdrop the merged
          layer above already carries strokes + tone — skip.) */}
      {(committed || styled) && (strokes.length > 0 || toneFills.length > 0) && !backdrop && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <SvgStyleTransform
            wrapperOverride={{ display: 'block', width: '100%', height: '100%' }}
          >
            <svg
              viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
              width="100%"
              height="100%"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              {sortedToneFills(toneFills).map((f) => {
                const hex = TONE_BAND_HEX[f.band];
                if (!hex || f.points.length < 3) return null;
                return (
                  <path
                    key={f.id}
                    d={tonePathD(f.points, f.holes)}
                    fill={hex}
                    fillRule="evenodd"
                    stroke="none"
                    data-tone-band={f.band}
                  />
                );
              })}
              {strokes.map((stroke) => (
                <path
                  key={stroke.id}
                  d={strokeToPolylinePath(stroke.points)}
                  fill="none"
                  stroke="var(--dir-text-primary)"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </svg>
          </SvgStyleTransform>
        </div>
      )}
      {/* Layer 1b — while NOT committed (and not live-styling), render strokes
          raw as perfect-freehand polygons so user sees what they drew, unstyled.
          INK READS ON TOP OF TONE (Sketch preview, round-8 fix): this layer is
          emitted AFTER Layer 0t so the DOM paint order already puts ink over
          tone — but the ink color (var(--dir-text-primary), near-black) and the
          darkest tone band (band 7, also near-black at 0.9 opacity) are the SAME
          value, so a dark band visually SWALLOWED the ink (the "tone over ink,
          inverted vs styled" report). The styled render never has this problem
          (tone becomes sparse marks, ink stays a distinct stroke on top). The
          fix mirrors that legibility: each ink polygon carries a thin
          paper-colored halo UNDERNEATH it (a slightly-wider paper stroke on the
          same path), so against ANY tone darkness the ink keeps a paper rim and
          reads clearly on top — no z-reorder needed, the order was already
          right. The halo only matters where ink crosses a dark band; on bare
          paper it's invisible (paper on paper). */}
      {!committed && !styled && strokes.length > 0 && (
        <svg
          viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
          width="100%"
          height="100%"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          aria-hidden
        >
          {/* CLEAN-EDGE z-order (2026-06-13): selection accents + paper halos
              FIRST, then the tone fill RE-ASSERTED over them, then the ink
              bodies LAST. The fill now tucks cleanly under the ink (the rasterizer
              conforms it to the ink centerline), so painting it over the halo
              removes the halo's interior paper SLIVER between fill and ink — the
              bug Sebs flagged — while the halo still does its job under the ink
              (and on bare-paper strokes, where there's no fill to re-assert).
              The polygon d-string is computed ONCE per stroke (halo + ink share
              it) — perfect-freehand isn't cheap. */}
          {(() => {
            const inkPaths = strokes.map((stroke) => ({
              id: stroke.id,
              d: strokeToPolygonPath(stroke.points),
              selD: stroke.id === selectedStrokeId ? strokeToPolylinePath(stroke.points) : null,
            }));
            return (
              <>
                {inkPaths.map((s) =>
                  s.selD ? (
                    <path
                      key={`sel-${s.id}`}
                      data-selected-stroke={s.id}
                      d={s.selD}
                      fill="none"
                      stroke="var(--dir-accent)"
                      strokeOpacity={0.5}
                      strokeWidth={10}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null,
                )}
                {inkPaths.map((s) => (
                  <path
                    key={`halo-${s.id}`}
                    d={s.d}
                    fill="none"
                    stroke="var(--dir-bg)"
                    strokeWidth={3}
                    strokeLinejoin="round"
                  />
                ))}
                {/* Tone re-asserted over the halo (kills the interior sliver). */}
                {sortedToneFills(toneFills).map((f) => {
                  const hex = TONE_BAND_HEX[f.band];
                  if (!hex || f.points.length < 3) return null;
                  return (
                    <path
                      key={`tone-${f.id}`}
                      d={tonePathD(f.points, f.holes)}
                      fill={hex}
                      fillRule="evenodd"
                      stroke="none"
                      opacity={0.9}
                    />
                  );
                })}
                {inkPaths.map((s) => (
                  <path key={`ink-${s.id}`} d={s.d} fill="var(--dir-text-primary)" stroke="none" />
                ))}
              </>
            );
          })()}
        </svg>
      )}
      {/* Layer 2: live in-progress stroke / tone brush + pointer capture
          surface. In shade mode the native cursor hides — the in-svg
          footprint ring below is the honest cursor (radius lives in viewBox
          units; a CSS cursor can't show the true brushed size). */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        width="100%"
        height="100%"
        style={{
          position: 'absolute',
          inset: 0,
          // Brush hides the native cursor (the footprint ring is the honest
          // cursor); Fill/Lasso keep the crosshair — their honest cursor is
          // the live region preview / loop trail itself.
          cursor: brushActive ? 'none' : input === 'draw' ? 'crosshair' : 'default',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      >
        {editableParts && !styled && (() => {
          const { s, ox, oy } = partFit;
          const sel = selectedPartId ? editableParts.parts.find((p) => p.id === selectedPartId) : null;
          return (
            <>
              {/* the upload's real shapes (data-part-id on each), LETTERBOXED into the
                  800×600 frame by ONE <g> transform — so the parts and the selection
                  overlay share the same frame space as strokes (the rebuild). The
                  per-part move/resize transforms (set imperatively in UPLOAD space)
                  live on the inner partsLayerRef <g>. DESATURATED: Desk Doodles is
                  monochrome ("value from marks, never hue"). */}
              <g transform={`translate(${ox} ${oy}) scale(${s})`}>
                <g ref={partsLayerRef} data-parts-group style={{ filter: 'grayscale(1)' }} dangerouslySetInnerHTML={{ __html: editablePartsInner }} />
              </g>
              {/* Selection box + corner handles, drawn directly at the part's FRAME box
                  — identical treatment to the stroke move/resize overlay, so it lands
                  exactly on the shape. */}
              {sel && !deletedParts.has(sel.id) && (() => {
                const b = displayBoxOf(sel);
                const hs = HANDLE_SIZE_PX;
                return (
                  <g pointerEvents="none">
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="var(--dir-accent)" strokeDasharray="4 4" strokeWidth={1} />
                    {(['nw', 'ne', 'sw', 'se'] as const).map((c) => {
                      const p = cornerXY(c, b);
                      return (
                        <rect key={c} x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs} rx={2} fill="var(--dir-bg)" stroke="var(--dir-accent)" strokeWidth={1.5} />
                      );
                    })}
                  </g>
                );
              })()}
            </>
          );
        })()}
        {current && (
          <path
            ref={livePathRef}
            // Seed from the live points so any incidental re-render paints the
            // full in-progress stroke; the rAF flush keeps it current per frame.
            d={strokeToPolygonPath(livePointsRef.current ?? current.points)}
            fill="var(--dir-text-primary)"
            fillOpacity={0.9}
            stroke="none"
          />
        )}
        {/* SHAPE INSERT live preview (§6.2): the dashed bbox + the shape it'll
            drop, updated each move so the user sees what they're placing. */}
        {insertBox &&
          armedShape &&
          (() => {
            const box = normalizeInsertBox(insertBox.start, insertBox.cur, insertShiftRef.current);
            const outline = insertOutlineFor(armedShape, box);
            const d =
              outline && outline.length >= 3
                ? `M ${outline.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`
                : '';
            return (
              <g pointerEvents="none">
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  fill="none"
                  stroke="var(--dir-text-secondary)"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
                {d && (
                  <path d={d} fill="var(--dir-text-primary)" fillOpacity={0.12} stroke="var(--dir-text-primary)" strokeOpacity={0.6} strokeWidth={1.5} />
                )}
              </g>
            );
          })()}
        {/* MOVE/RESIZE handles on the selected stroke (ink mode only — fill/shade
            own the pointer otherwise). Dashed bbox + 4 corner squares; drag the
            body to move, a corner to resize. Tracks the live points during drag. */}
        {selectedStrokeId &&
          !insertBox &&
          !fillActive &&
          !lassoActive &&
          !shadeActive &&
          (() => {
            const sel = strokes.find((s) => s.id === selectedStrokeId);
            if (!sel) return null;
            const b = strokeBBox(sel.points);
            if (b.w <= 0.5 && b.h <= 0.5) return null;
            const hs = HANDLE_SIZE_PX;
            // Move/resize selection = bbox + corner handles ONLY (Sebs 2026-06-16:
            // "get rid of the move and resize x — the x should be shown only in
            // erase mode"). Delete lives in the Erase tool, never on the move tool.
            return (
              <g pointerEvents="none">
                <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="var(--dir-accent)" strokeDasharray="4 4" strokeWidth={1} />
                {(['nw', 'ne', 'sw', 'se'] as const).map((c) => {
                  const p = cornerXY(c, b);
                  return (
                    <rect key={c} x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs} rx={2} fill="var(--dir-bg)" stroke="var(--dir-accent)" strokeWidth={1.5} />
                  );
                })}
              </g>
            );
          })()}
        {/* SELECTED TONE PATCH (model B) — shown in SHADE mode (not erase): dashed
            bbox + corner handles to MOVE/RESIZE. Drag inside = move, corner = resize.
            Delete lives in the Erase tool, never here. */}
        {selectedToneId &&
          !insertBox &&
          !fillActive &&
          !lassoActive &&
          shadeActive &&
          !eraseStrokes &&
          (() => {
            const sel = toneFills.find((f) => f.id === selectedToneId);
            if (!sel || sel.points.length < 3) return null;
            const b = toneBBox(sel);
            if (b.w <= 0.5 && b.h <= 0.5) return null;
            const hs = HANDLE_SIZE_PX;
            return (
              <g pointerEvents="none">
                <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="var(--dir-accent)" strokeDasharray="4 4" strokeWidth={1} />
                {(['nw', 'ne', 'sw', 'se'] as const).map((c) => {
                  const p = cornerXY(c, b);
                  return (
                    <rect key={c} x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs} rx={2} fill="var(--dir-bg)" stroke="var(--dir-accent)" strokeWidth={1.5} />
                  );
                })}
              </g>
            );
          })()}
        {/* Live tone sweep — the while-pen-down preview (SB-6: the cheap
            swept capsule; the grid is the truth in parallel and lands at
            pen-lift). Paint previews at the SAME 0.9 the committed raw layer
            uses; erase previews as a dashed accent sweep showing the carve
            footprint (the carve itself lands at pen-lift). */}
        {shadeActive && toneBrush && !shade?.erase && (
          <path
            d={tonePathD(toneOutline(toneBrush, shade?.radius ?? 24))}
            fill={TONE_BAND_HEX[shade?.band ?? 3] ?? '#888888'}
            fillOpacity={0.9}
            stroke="none"
          />
        )}
        {shadeActive && toneBrush && shade?.erase && (
          <path
            d={tonePathD(toneOutline(toneBrush, shade?.radius ?? 24))}
            fill="none"
            stroke="var(--dir-accent)"
            strokeWidth={1.25}
            strokeDasharray="5 4"
          />
        )}
        {/* Brush-footprint ring — paint mode shows the band grey; erase mode
            shows a dashed accent lifter. Brush tool only — Fill/Lasso have
            their own honest cursors below. */}
        {brushActive && hoverPt && (
          <circle
            cx={hoverPt[0]}
            cy={hoverPt[1]}
            r={shade?.radius ?? 24}
            fill={shade?.erase ? 'none' : TONE_BAND_HEX[shade?.band ?? 3] ?? '#888888'}
            fillOpacity={shade?.erase ? 0 : 0.18}
            stroke={shade?.erase ? 'var(--dir-accent)' : 'var(--dir-text-body-soft)'}
            strokeWidth={1.25}
            strokeDasharray={shade?.erase ? '5 4' : undefined}
            pointerEvents="none"
          />
        )}
        {/* FILL preview — the candidate region as a translucent band wash +
            dashed outline (spec §5.1, the honest-cursor idiom): hover shows
            it before any commitment; during a Gap scrub it re-extracts live
            per ladder step. Erase mode previews outline-only (a lifter takes
            tone away — washing it on would lie). Holes render via evenodd so
            a donut-ring preview shows the ring only. */}
        {fillPreview && (
          <path
            data-fill-preview
            d={tonePathD(fillPreview.outline, fillPreview.holes)}
            fill={shade?.erase ? 'none' : TONE_BAND_HEX[shade?.band ?? 3] ?? '#888888'}
            fillOpacity={shade?.erase ? 0 : 0.35}
            fillRule="evenodd"
            stroke={shade?.erase ? 'var(--dir-accent)' : 'var(--dir-text-secondary)'}
            strokeWidth={1.25}
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        )}
        {/* Gap-scrub readout — the live multiplier above the press anchor
            (the Procreate threshold-bar moment, ours says the number). */}
        {scrubState && (
          <g data-gap-scrub pointerEvents="none">
            <text
              x={scrubState.anchor[0]}
              y={Math.max(18, scrubState.anchor[1] - 16)}
              textAnchor="middle"
              style={{
                fontFamily: IS,
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '0.04em',
                fill: 'var(--dir-text-primary)',
              }}
            >
              Gap {GAP_LADDER[scrubState.idx]}×
            </text>
          </g>
        )}
        {/* Highlight-drag trail — transient accent scribble (never recorded
            as ink, spec §5.3); regions it majority-covers commit on release. */}
        {highlightPts && highlightPts.length > 1 && (
          <path
            data-fill-highlight
            d={strokeToPolylinePath(highlightPts.map(([x, y]) => [x, y, 0.5] as StrokePoint))}
            fill="none"
            stroke="var(--dir-accent)"
            strokeOpacity={0.45}
            strokeWidth={12}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        )}
        {/* Lasso trail — the loop-in-progress (D-RF7). Three honest layers so
            auto-close is NEVER a surprise (Sebs-ratified):
              1. WASH — the area that WILL commit (drawn trail + the closing
                 chord, fill-only, Z-closed) so the user sees the captured area;
              2. TRAIL — the actually-drawn path, a SOLID accent line (no Z) —
                 this is the ink the pointer has laid down;
              3. CHORD — a distinct DASHED line from the live pointer back to
                 the START point, plus a start marker: the closing edge the
                 release will snap shut. Visually separate from the solid trail
                 so the user reads exactly where the loop will close.
            Erase mode drops the wash (a lifter takes tone away — washing it on
            would lie); the trail + chord stay so the loop is still legible. */}
        {lassoPts && lassoPts.length > 1 && (
          <g data-lasso pointerEvents="none">
            {!shade?.erase && (
              <path
                data-lasso-wash
                d={`${strokeToPolylinePath(lassoPts.map(([x, y]) => [x, y, 0.5] as StrokePoint))} Z`}
                fill={TONE_BAND_HEX[shade?.band ?? 3] ?? '#888888'}
                fillOpacity={0.18}
                stroke="none"
              />
            )}
            <path
              data-lasso-trail
              d={strokeToPolylinePath(lassoPts.map(([x, y]) => [x, y, 0.5] as StrokePoint))}
              fill="none"
              stroke="var(--dir-accent)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Live closing chord: pointer → start. Dashed + lighter so it
                reads as "this snaps shut on release", distinct from the solid
                drawn trail. */}
            <line
              data-lasso-chord
              x1={lassoPts[lassoPts.length - 1][0]}
              y1={lassoPts[lassoPts.length - 1][1]}
              x2={lassoPts[0][0]}
              y2={lassoPts[0][1]}
              stroke="var(--dir-accent)"
              strokeOpacity={0.55}
              strokeWidth={1.25}
              strokeDasharray="5 4"
            />
            {/* Start marker — the anchor the chord closes onto. */}
            <circle
              data-lasso-start
              cx={lassoPts[0][0]}
              cy={lassoPts[0][1]}
              r={3.5}
              fill="var(--dir-bg)"
              stroke="var(--dir-accent)"
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>
      {/* Empty-state hint — DRAW mode: warm sentence-case invitation (was
          shouty uppercase; warmth pass 2026-06-11). UPLOAD-SVG mode: prompt
          to pick a file. Upload-image is covered by its honesty gate below. */}
      {((input === 'draw' && allStrokes.length === 0 && toneFills.length === 0 && !backdrop) ||
        (isUploadAny && !uploadedSvg)) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: IS,
            fontSize: 13,
            color: 'var(--dir-text-body-soft)',
            gap: 12,
            pointerEvents: isUploadAny ? 'auto' : 'none',
          }}
        >
          {isUploadAny ? (
            <>
              <button
                onClick={handleFilePick}
                disabled={uploadBusy}
                style={{
                  ...PILL,
                  padding: '10px 22px',
                  background: 'var(--dir-bg)',
                  opacity: uploadBusy ? 0.6 : 1,
                  cursor: uploadBusy ? 'wait' : 'pointer',
                  // Heavier primary-ink border is the empty-state affordance —
                  // this is THE action in an otherwise blank frame. Full
                  // shorthand, never borderColor over PILL's shorthand
                  // (React dev warns on shorthand/longhand style conflicts).
                  border: '1px solid var(--dir-text-primary)',
                }}
              >
                {uploadBusy
                  ? 'Tracing your image…'
                  : isUploadImage
                    ? 'Pick a photo (PNG / JPG)'
                    : 'Pick an .svg file'}
              </button>
              {isUploadImage && !uploadBusy && (
                <span style={{ fontSize: 11, textTransform: 'none', opacity: 0.75, maxWidth: 240, textAlign: 'center' }}>
                  Turned into a clean sketch in the Desk Doodles style, then styles + 3D work on it.
                </span>
              )}
              {uploadError && (
                <span style={{ color: 'var(--dir-accent)', fontSize: 11, textTransform: 'none' }}>
                  {uploadError}
                </span>
              )}
            </>
          ) : (
            <>Draw your doodle</>
          )}
        </div>
      )}
      {/* Draw-mode action buttons — Done commits to Smart Hachure, Clear resets,
          Reopen lets user keep drawing after a Done. Hidden when a host panel
          (DrawPanel) supplies its own Done/Cancel chrome. */}
      {!hideActions && !isUpload && strokes.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          {!committed ? (
            <button
              onClick={commitDrawing}
              style={{
                ...CTA_PILL,
                padding: '6px 16px',
                fontSize: 10,
                letterSpacing: '0.06em',
              }}
            >
              Done ({strokes.length})
            </button>
          ) : (
            <button onClick={reopenForEdit} style={FRAME_PILL}>
              Edit
            </button>
          )}
          <button onClick={clearAll} style={FRAME_PILL}>
            Clear
          </button>
        </div>
      )}
      {isUploadAny && uploadedSvg && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontFamily: IS,
              color: 'var(--dir-text-body-soft)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              padding: '4px 10px',
              borderRadius: 999,
              background: 'var(--dir-raised)',
              border: '1px solid var(--dir-border)',
            }}
          >
            {uploadedSvg.name}
          </span>
          {/* SVG SIMPLIFY toggle — .svg uploads only (not traced images, which
              default to Clean). Re-processes the SAME upload live (no re-pick). */}
          {isUpload && rawSvgUpload && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: IS,
                  color: 'var(--dir-text-body-soft)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                Simplify
              </span>
              {(
                [
                  ['off', 'Off'],
                  ['filled', 'Filled'],
                  ['line', 'Line'],
                ] as [UploadSimplifyMode, string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => changeSimplifyMode(m)}
                  aria-pressed={simplifyMode === m}
                  title={
                    m === 'off'
                      ? 'Keep the SVG as-is'
                      : m === 'filled'
                        ? 'Clean filled line-art (keeps fills)'
                        : 'Centerline single-line trace'
                  }
                  style={{
                    ...FRAME_PILL,
                    background: simplifyMode === m ? 'var(--dir-text-primary)' : 'var(--dir-bg)',
                    color: simplifyMode === m ? 'var(--dir-bg)' : 'var(--dir-text-primary)',
                  }}
                >
                  {label}
                </button>
              ))}
            </span>
          )}
          <button onClick={handleFilePick} style={FRAME_PILL}>
            Replace
          </button>
          <button onClick={clearUpload} style={FRAME_PILL}>
            Clear
          </button>
        </div>
      )}
      {/* (Image-upload honesty gate removed 2026-06-16 — image→SVG is live via the
          Quiver Edge trace + simplify-to-sketch; upload-image now uses the shared
          picker/preview chrome above, same as upload-svg.) */}
      {/* 3D HONESTY GATE — opaque placeholder covers the live 2D surface so the
          toggle doesn't lie. Strokes/upload state stay intact underneath; flipping
          back to 2D restores everything. Rendered LAST so it wins over the
          image-upload gate if both apply. */}
      {mode === '3d' && (
        <div style={GATE_STYLE}>
          <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>3D mode is being wired</span>
          <span>Rod &amp; Extrude geometry built from your strokes — landing soon.</span>
        </div>
      )}
    </div>
  );
}

// ─── ToneShadeCluster — the shade register's tool chrome ─────────────────────
// Band picker (the FULL coverage.ts ladder: 7 paint swatches + Erase, which IS
// band 0/paper — absence of tone) + brush-size slider. Controlled component so
// any host owns the state: DrawPanel mounts it beside its Sketch|Style row;
// ObjectSurface's Re-draw mounts the same cluster when it wires tone editing
// (cross-rock contract — pairs with DrawSurface's shade/initialToneFills/
// onToneFillsChange props). Pill idioms per chromeStyles.

/** Which tool the Shade register wields (D-RF1: Fill/Lasso live INSIDE the
 *  register's tool row — the register answers "tone goes down", the tool
 *  answers how). */
export type ShadeTool = 'brush' | 'fill' | 'lasso';

export type ShadeToolState = {
  /** Brush | Fill | Lasso — the register's tool pills. */
  tool: ShadeTool;
  /** COVERAGE_BANDS index 1–7 (paint band) — shared by all three tools. */
  band: number;
  /** Brush radius, draw-frame viewBox px (Brush tool). */
  radius: number;
  /** Erase mode — shared by all three tools: brush carves per-cell; Fill
   *  lifts the tapped region; Lasso lifts its loop (band 0 = paper). */
  erase: boolean;
  /** Fill gap-tolerance multiplier (GAP_LADDER tick, persists per session —
   *  the Procreate remembered-threshold behavior, spec §6). ROUND-8: the Gap
   *  ladder now drives FILL FLUSHNESS too (low = tucked inset, top tick = flush
   *  to the ink edge = "fully fill"), so the slider is live on closed shapes
   *  and the Full-fill pill is just a one-tap jump to the top tick. */
  gap: number;
  /** FULL FILL — its OWN toggle, NOT a jump to max Gap. Fills the tapped shape
   *  solid + flush to its own edges at the CURRENT gap (the canvas reads this in
   *  fillDilatePx's flush branch). Decoupled from the Gap slider so Full fill no
   *  longer slams Gap to 6× and spills into the outer region. */
  fullFill?: boolean;
};

export const SHADE_TOOL_DEFAULT: ShadeToolState = {
  tool: 'brush',
  band: 3,
  radius: 26,
  erase: false,
  gap: 1,
  fullFill: false,
};

export function ToneShadeCluster({
  value,
  onChange,
  disabled,
}: {
  value: ShadeToolState;
  onChange: (next: ShadeToolState) => void;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        rowGap: 6,
        flexWrap: 'wrap',
        minWidth: 0,
        opacity: disabled ? 0.45 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      {/* Tool pills — Brush | Fill | Lasso (D-RF1: tools INSIDE the Shade
          register; band swatches + Erase shared by all three). Same pill
          grammar as the Ink|Shade register pills. */}
      <div style={{ display: 'flex', gap: 6 }} role="radiogroup" aria-label="Shade tool">
        {(
          [
            ['brush', 'Brush', 'Brush soft tone regions freehand'],
            ['fill', 'Fill', 'Tap inside a region to fill it — hold & drag sideways to scrub Gap'],
            ['lasso', 'Lasso', 'Draw a loop — it closes on release and becomes the patch'],
          ] as [ShadeTool, string, string][]
        ).map(([tool, label, title]) => (
          <button
            key={tool}
            role="radio"
            aria-checked={value.tool === tool}
            data-shade-tool={tool}
            title={title}
            onClick={() => onChange({ ...value, tool })}
            style={{
              ...PILL,
              padding: '6px 14px',
              flexShrink: 0,
              background: value.tool === tool ? 'var(--dir-text-primary)' : 'var(--dir-bg)',
              color: value.tool === tool ? 'var(--dir-bg)' : 'var(--dir-text-primary)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <span
        aria-hidden
        style={{ width: 1, alignSelf: 'stretch', background: 'var(--dir-border)', flexShrink: 0 }}
      />
      {/* Band swatches — bands 1..7 of the one 8-band table, light → dark. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} role="radiogroup" aria-label="Tone band">
        {COVERAGE_BANDS.map((b, band) => {
          const hex = TONE_BAND_HEX[band];
          if (!hex) return null; // band 0 = paper = the Erase pill
          const selected = !value.erase && value.band === band;
          return (
            <button
              key={band}
              role="radio"
              aria-checked={selected}
              data-tone-swatch={band}
              title={`${b.name} — band ${band} of 7`}
              onClick={() => onChange({ ...value, band, erase: false })}
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                padding: 0,
                background: hex,
                cursor: 'pointer',
                border: '1px solid var(--dir-border)',
                boxShadow: selected
                  ? '0 0 0 2px var(--dir-bg), 0 0 0 4px var(--dir-accent)'
                  : 'none',
                flexShrink: 0,
              }}
            />
          );
        })}
      </div>
      <button
        onClick={() => onChange({ ...value, erase: !value.erase })}
        aria-pressed={value.erase}
        data-tone-erase
        title="Paper (band 0) — brush to carve tone away; lighten = erase, then re-brush lighter"
        style={{
          ...PILL,
          padding: '5px 12px',
          background: value.erase ? 'var(--dir-text-primary)' : 'var(--dir-bg)',
          color: value.erase ? 'var(--dir-bg)' : 'var(--dir-text-primary)',
          flexShrink: 0,
        }}
      >
        Erase
      </button>
      {/* Per-tool slider slot (spec §3: same slot, per-tool relabel) —
          Brush: radius (viewBox px, 29 ticks). Fill: the Gap tolerance
          ladder (6 ticks, multiplier on the extractor's ink-stamp radius).
          Lasso: no slider — the loop IS the patch. */}
      {value.tool === 'brush' && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            fontFamily: IS,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--dir-text-secondary)',
            whiteSpace: 'nowrap',
          }}
          title="Brush radius — soft region size, in canvas units"
        >
          Brush
          <input
            type="range"
            className="dd-range"
            min={8}
            max={64}
            step={2}
            value={value.radius}
            onChange={(e) => onChange({ ...value, radius: Number(e.target.value) })}
            style={{ width: 90 }}
            aria-label="Brush radius"
          />
          <span style={{ color: 'var(--dir-text-body-soft)', fontVariantNumeric: 'tabular-nums' }}>
            {value.radius}px
          </span>
        </label>
      )}
      {value.tool === 'fill' && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            fontFamily: IS,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--dir-text-secondary)',
            whiteSpace: 'nowrap',
          }}
          title="Gap tolerance — how big an ink gap the fill may leap (×0.5–×3 of the ink-stamp radius); press-hold-drag on the canvas scrubs it live"
        >
          Gap
          <input
            type="range"
            className="dd-range"
            min={0}
            max={GAP_LADDER.length - 1}
            step={1}
            value={gapIdxOf(value.gap)}
            onChange={(e) => onChange({ ...value, gap: GAP_LADDER[Number(e.target.value)] })}
            style={{ width: 90 }}
            aria-label="Gap tolerance"
          />
          <span style={{ color: 'var(--dir-text-body-soft)', fontVariantNumeric: 'tabular-nums' }}>
            {value.gap}×
          </span>
        </label>
      )}
      {/* FULL FILL — its OWN toggle (Sebs 2026-06-17), NO LONGER a jump to max
          Gap. Fills the tapped shape SOLID + flush to its own edges at the
          CURRENT gap, so it can't over-spread into the outer/neighbour region
          (the nested "fills everything" bug came from Full fill slamming Gap to
          6×). Gap stays independent. The canvas reads value.fullFill → shade
          → fillDilatePx's flush branch. */}
      {value.tool === 'fill' && (
        <button
          onClick={() => onChange({ ...value, fullFill: !value.fullFill })}
          aria-pressed={!!value.fullFill}
          data-tone-fullfill
          title="Full fill — fill the tapped shape solid, flush to its OWN edges (independent of Gap; tap again for a tucked-in fill)"
          style={{
            ...PILL,
            padding: '5px 12px',
            flexShrink: 0,
            background: value.fullFill ? 'var(--dir-text-primary)' : 'var(--dir-bg)',
            color: value.fullFill ? 'var(--dir-bg)' : 'var(--dir-text-primary)',
          }}
        >
          Full fill
        </button>
      )}
    </div>
  );
}
