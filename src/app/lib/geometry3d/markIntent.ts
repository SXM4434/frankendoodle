// ─── markIntent — the DRAWN register's intent brain (mark-intent v1) ────────
// Implements docs/design/mark-intent-boundary-spec.md §2-§3, the GEOMETRY-
// REGISTER rules only, under the conversion-semantics RED-TEAM AMENDMENT
// (ratified 2026-06-12): one record, one treatment vocabulary, TWO register
// brains. This module is the drawn brain — stroke-feature/geometry-driven,
// computed from the [x, y, pressure] record. The smartHachure classifier is
// NEVER invoked here (live-confirmed paper@0.9 misfire on drawn strokes —
// filed separately for a golden re-bless ceremony; NOT touched by this rock).
//
// The question closure alone cannot answer: is this mark a THING (structure),
// a TONE (shading-gesture), or a FILL (fill-intent)?
//   - structure        → geometry per the amendment map (closed → solid slab,
//                        open → line-rod, treated-as-closed → solid + chip)
//   - shading-gesture  → ZERO geometry of its own; emits a tone band onto its
//                        containing region (preserve-marks rule — the user's
//                        ink is metadata-tagged, never redrawn)
//   - fill-intent      → the marks' envelope becomes the region: one clean
//                        solid dark patch (band 7), never per-stroke blobs
//
// PURITY CONTRACT (node-runnable like strokeTo3d.ts): no React, no DOM, no
// wall-clock, no randomness. Signals are computed on an ARC-LENGTH-RESAMPLED
// polyline (~4px spacing — the $1-recognizer normalization move) so a
// capStrokes-halved record classifies identically to the live one (spec §2
// honesty constraint). Thresholds are PROVISIONAL per MI-F: calibrated
// against the 10-fixture battery (tools/3d/mark-intent-battery.mjs),
// log-first lock-second.

import {
  CLOSE_GAP_PX,
  DEFAULT_VIEWBOX,
  RDP_EPSILON,
  closureStateOf,
  pointInLoop,
  rdpPoints,
  type ClosureState,
  type StrokeInputPoint,
  type ViewBoxSize,
} from './strokeTo3d.ts';
import { bandIndexForDarkness, paramsToCoverage } from '../smart/coverage.ts';
import type { MarkIntent } from '../smart/conversionMap';

// ─── Calibration constants (provisional — MI-F) ─────────────────────────────

/** Arc-length resample spacing (viewBox px) for all per-stroke signals. */
export const INTENT_RESAMPLE_SPACING_PX = 4;
/** Nominal ink width for ink-area estimates (spec §2 hullCoverage row). */
export const NOMINAL_INK_WIDTH_PX = 3;
/** A direction flip steeper than this counts as a reversal (spec: ~180°
 *  flips, turn > 150° at resample spacing). */
export const REVERSAL_TURN_DEG = 150;
/** R2 calm gates. */
export const CALM_REVERSAL_FREQ = 1.5; // per 100px arcLen
export const CALM_SELF_ISECT = 0.15; // crossings per 100px arcLen
/** A calm stroke that winds more than this is NOT simple structure (keeps the
 *  non-crossing archimedean spiral out of R2 — fixture 4). */
export const CALM_MAX_ABS_TURNSUM = 4 * Math.PI;
/** Scribble energy gates (R4/R5/R6). */
export const SCRIBBLE_REVERSAL_FREQ = 3;
export const SCRIBBLE_SELF_ISECT = 1.0;
/** Containment threshold — "shading needs a container". */
export const CONTAINMENT_MIN = 0.7;
/** Cluster-hull / region-area split between shading patch and region fill. */
export const REGION_COVERAGE_FILL = 0.55;
/** Ink-density floor for the blacked-in read (fill ≳ shading ≳ outline). */
export const HULL_COVERAGE_FILL = 0.6;
/** R9 adversarial guards (lightning / cursive): reversal energy alone NEVER
 *  demotes to tone — containment or hull density must corroborate. */
export const R9_CONTAINMENT_MAX = 0.3;
export const R9_HULL_MAX = 0.35;
export const R9_SELF_ISECT = 0.5;
/** Spiral signature (R6): |turnSum| > 4π with consistent winding AND a
 *  compact envelope — a fill-spiral coils in place (bbox aspect ≈ 1); a
 *  cursive run winds consistently too but TRANSLATES (sprawling bbox).
 *  Fixture 7 is the adversarial guard this aspect gate exists for. */
export const SPIRAL_MIN_TURNSUM = 4 * Math.PI;
export const SPIRAL_WINDING_CONSISTENCY = 0.8;
export const SPIRAL_MAX_BBOX_ASPECT = 2.0;
/** Hull-sliver guard: hullCoverage saturates on near-straight strokes (hull
 *  area → 0), so density-based fill rules require a non-degenerate hull. */
export const HULL_SLIVER_MIN_FRACTION = 0.05; // hullArea ≥ 5% of bboxDiag²
/** Dot taps (R1) + stipple clusters (R8). */
export const DOT_MAX_BBOX_DIAG = 8;
export const DOT_MIN_RESAMPLED = 4;
export const DOT_CLUSTER_GAP_PX = 24;
export const DOT_CLUSTER_MIN = 4;
/** Parallel hatching clusters (R7 — StrokeAggregator-style grouping). */
export const PARALLEL_MIN_STROKES = 3;
export const PARALLEL_ANGLE_TOL_DEG = 20;
export const PARALLEL_SPACING_CV_MAX = 0.4;
/** R10: margin below this between the top two intents → ambiguous chip. */
export const AMBIGUITY_MARGIN = 0.15;
/** Default structure prior when no rule fires for a stroke. */
export const BASE_STRUCTURE_PRIOR = 0.35;
/** Region candidates below this area (px²) are noise — same floor as the 2D
 *  tiny-area clamp (18-scope-audit row 13). */
export const REGION_MIN_AREA_PX2 = 40;

// ─── Result shapes ───────────────────────────────────────────────────────────

export interface StrokeFeatures {
  /** Index into the caller's stroke array. */
  index: number;
  pointCount: number;
  resampledCount: number;
  arcLen: number;
  bboxDiag: number;
  closure: ClosureState;
  /** ~180° direction flips per 100px arcLen (resampled polyline). Hairpins
   *  are detected over a 2-segment window too, so a boustrophedon corner that
   *  resamples into two ~90° turns still counts as ONE flip. */
  reversalFreq: number;
  /** Bbox aspect ratio max(w,h)/min(w,h) — the spiral compactness gate. */
  bboxAspect: number;
  /** Proper segment self-crossings per 100px arcLen (RDP ε=3.0 anchors). */
  selfIsectDensity: number;
  hullArea: number;
  /** min(arcLen × inkWidth, hullArea) ÷ hullArea — scribble density. */
  hullCoverage: number;
  /** Signed total turning (radians) — spiral signature axis. */
  turnSum: number;
  absTurnSum: number;
  /** Σθ² — Rubine f11 kinship. */
  sharpness: number;
  dotness: boolean;
  /** Mean of resampled points. */
  center: [number, number];
  /** Max fraction of points inside a candidate region loop (excl. self). */
  containment: number;
  /** Loop id realizing `containment` (null when uncontained). */
  hostLoopId: string | null;
}

export interface RegionLoop {
  id: string;
  /** Stroke indices forming the loop (1 for a closed stroke, 2+ composite). */
  strokeIndices: number[];
  /** ViewBox-space polygon (closure implied). */
  points: Array<[number, number]>;
  closure: ClosureState;
  composite: boolean;
  area: number;
}

export interface IntentCluster {
  id: string;
  kind: 'single' | 'composite-loop' | 'parallel' | 'dot-cluster';
  strokeIndices: number[];
  intent: MarkIntent;
  rawScore: number;
  margin: number;
  ambiguous: boolean;
  firedRules: string[];
  /** Tone band 0-7 for shading-gesture (onto host region) / fill-intent
   *  (always 7). Null for structure. */
  band: number | null;
  /** Containing region for shading-gesture / contained fills. */
  hostLoopId: string | null;
  /** For composite-loop clusters: the loop this cluster produced. */
  loopId: string | null;
}

export interface MarkIntentAnalysis {
  features: StrokeFeatures[];
  loops: RegionLoop[];
  clusters: IntentCluster[];
  /** loop id → max attached shading band — the donut rule's band-0 check
   *  reads this (a shaded inner loop is solid mass, never a hole). */
  loopBands: Record<string, number>;
}

// ─── Geometry helpers (pure, viewBox space) ──────────────────────────────────

type Pt = [number, number];

function resamplePolyline(pointsIn: StrokeInputPoint[], spacing: number): Pt[] {
  // DEFENCE IN DEPTH (Infinity-OOM guard, mirrors strokeTo3d.resampleWorldPolyline):
  // a single Infinity coord makes a segment Infinity, and the
  // `while (walked <= segLen)` walk never terminates → OOM. analyzeMarkIntent
  // runs at the very front of convertStrokePool (before any normalization), so
  // this resampler is the FIRST thing a corrupt record would hit — it must
  // defend itself even though convertStrokePool also sanitizes the front door.
  const points = pointsIn.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (points.length === 0) return [];
  const out: Pt[] = [[points[0][0], points[0][1]]];
  if (points.length === 1) return out;
  let prev: Pt = out[0];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const curr: Pt = [points[i][0], points[i][1]];
    const segLen = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    if (!(segLen > 1e-12) || !Number.isFinite(segLen)) continue;
    let walked = spacing - carry;
    while (walked <= segLen) {
      const t = walked / segLen;
      out.push([prev[0] + (curr[0] - prev[0]) * t, prev[1] + (curr[1] - prev[1]) * t]);
      walked += spacing;
    }
    carry = segLen - (walked - spacing);
    prev = curr;
  }
  const last: Pt = [points[points.length - 1][0], points[points.length - 1][1]];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > 1e-9) out.push(last);
  return out;
}

function polylineLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return len;
}

function bboxDiagOf(pts: Pt[]): number {
  if (pts.length === 0) return 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

function jointBboxDiag(a: Pt[], b: Pt[]): number {
  return bboxDiagOf([...a, ...b]);
}

/** Shoelace area (signed) of a viewBox polygon. */
function polygonArea(pts: Pt[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    area += ax * by - bx * ay;
  }
  return area / 2;
}

/** Convex hull area — Andrew monotone chain (deterministic sort). */
function convexHullArea(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  const sorted = pts.slice().sort((p, q) => (p[0] === q[0] ? p[1] - q[1] : p[0] - q[0]));
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  return Math.abs(polygonArea(hull));
}

/** Proper segment-segment crossing (strict — shared endpoints don't count). */
function segmentsCross(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const d = (p: Pt, q: Pt, r: Pt) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = d(b1, b2, a1);
  const d2 = d(b1, b2, a2);
  const d3 = d(a1, a2, b1);
  const d4 = d(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function selfIntersections(anchors: Pt[]): number {
  let count = 0;
  for (let i = 0; i + 1 < anchors.length; i++) {
    for (let j = i + 2; j + 1 < anchors.length; j++) {
      // Skip adjacent segments (shared endpoint) — j starts at i+2; also skip
      // the first/last pair when the polyline is a near-loop.
      if (i === 0 && j + 2 === anchors.length) continue;
      if (segmentsCross(anchors[i], anchors[i + 1], anchors[j], anchors[j + 1])) count++;
    }
  }
  return count;
}

function containmentFraction(pts: Pt[], loop: Pt[]): number {
  if (pts.length === 0) return 0;
  let inside = 0;
  for (const [x, y] of pts) {
    if (pointInLoop(x, y, loop)) inside++;
  }
  return inside / pts.length;
}

/** Chord angle folded to [0, π) — hatch strokes are calm, chord ≈ principal
 *  axis. */
function chordAngle(pts: Pt[]): number {
  const [x1, y1] = pts[0];
  const [x2, y2] = pts[pts.length - 1];
  const a = Math.atan2(y2 - y1, x2 - x1);
  return ((a % Math.PI) + Math.PI) % Math.PI;
}

function angularDiffMod180(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

// ─── Union-find (composite endpoint graph, spec §2) ─────────────────────────

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r];
    while (this.parent[x] !== r) {
      const next = this.parent[x];
      this.parent[x] = r;
      x = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

// ─── THE analysis ────────────────────────────────────────────────────────────

export function analyzeMarkIntent(
  strokes: StrokeInputPoint[][],
  viewBox: ViewBoxSize = DEFAULT_VIEWBOX,
): MarkIntentAnalysis {
  void viewBox; // signals are scale-relative; viewBox reserved for future gates

  // ── 1. Per-stroke features ──
  const features: StrokeFeatures[] = strokes.map((raw, index) => {
    const resampled = resamplePolyline(raw, INTENT_RESAMPLE_SPACING_PX);
    const anchors = rdpPoints(raw, RDP_EPSILON).map((p): Pt => [p[0], p[1]]);
    const arcLen = polylineLength(resampled);
    const bboxDiag = bboxDiagOf(resampled);
    const per100 = arcLen > 0 ? 100 / arcLen : 0;

    let reversals = 0;
    let turnSum = 0;
    let absTurnSum = 0;
    let sharpness = 0;
    const reversalRad = (REVERSAL_TURN_DEG * Math.PI) / 180;
    const angleBetween = (ax: number, ay: number, bx: number, by: number) =>
      Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by); // [0, π]
    let suppressNextWindowed = false;
    for (let i = 1; i + 1 < resampled.length; i++) {
      const ax = resampled[i][0] - resampled[i - 1][0];
      const ay = resampled[i][1] - resampled[i - 1][1];
      const bx = resampled[i + 1][0] - resampled[i][0];
      const by = resampled[i + 1][1] - resampled[i][1];
      const turn = angleBetween(ax, ay, bx, by);
      // 2-segment window: a hairpin whose corner resamples into two ~90°
      // turns is still ONE ~180° direction flip (fixture 9's boustrophedon).
      let windowed = 0;
      if (i >= 2 && !suppressNextWindowed) {
        const px = resampled[i - 1][0] - resampled[i - 2][0];
        const py = resampled[i - 1][1] - resampled[i - 2][1];
        windowed = angleBetween(px, py, bx, by);
      }
      if (turn > reversalRad || windowed > reversalRad) {
        reversals++;
        suppressNextWindowed = true; // don't double-count the same hairpin
      } else {
        suppressNextWindowed = false;
      }
      const cross = ax * by - ay * bx;
      const signed = Math.sign(cross) * turn;
      turnSum += signed;
      absTurnSum += turn;
      sharpness += turn * turn;
    }

    const hullArea = convexHullArea(resampled);
    const inkArea = Math.min(arcLen * NOMINAL_INK_WIDTH_PX, hullArea);
    const crossings = anchors.length >= 4 ? selfIntersections(anchors) : 0;

    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (const [x, y] of resampled) {
      if (x < bMinX) bMinX = x;
      if (x > bMaxX) bMaxX = x;
      if (y < bMinY) bMinY = y;
      if (y > bMaxY) bMaxY = y;
    }
    const bw = Math.max(bMaxX - bMinX, 1e-6);
    const bh = Math.max(bMaxY - bMinY, 1e-6);
    const bboxAspect = Math.max(bw, bh) / Math.min(bw, bh);

    let cx = 0;
    let cy = 0;
    for (const [x, y] of resampled) {
      cx += x;
      cy += y;
    }
    const n = Math.max(resampled.length, 1);

    return {
      index,
      pointCount: raw.length,
      resampledCount: resampled.length,
      arcLen,
      bboxDiag,
      closure: closureStateOf(anchors),
      reversalFreq: reversals * per100,
      bboxAspect,
      selfIsectDensity: crossings * per100,
      hullArea,
      hullCoverage: hullArea > 0 ? inkArea / hullArea : 0,
      turnSum,
      absTurnSum,
      sharpness,
      dotness: bboxDiag < DOT_MAX_BBOX_DIAG || resampled.length < DOT_MIN_RESAMPLED,
      center: [cx / n, cy / n],
      containment: 0, // filled after region candidates exist
      hostLoopId: null,
    };
  });

  const resampledCache = strokes.map((raw) => resamplePolyline(raw, INTENT_RESAMPLE_SPACING_PX));

  // ── 2. Composite region graph (the two-arc fix, spec §2) ──
  // Strokes are edges; endpoints within max(24px, 8% joint bbox diag) merge
  // into nodes; simple cycles become composite loops. Only OPEN, CALM,
  // non-dot strokes participate (scribbles never compose regions).
  const isCalm = (f: StrokeFeatures) =>
    f.reversalFreq < CALM_REVERSAL_FREQ &&
    f.selfIsectDensity < CALM_SELF_ISECT &&
    f.absTurnSum <= CALM_MAX_ABS_TURNSUM;
  const graphMembers = features
    .filter((f) => f.closure === 'open' && !f.dotness && isCalm(f) && f.resampledCount >= 2)
    .map((f) => f.index);

  const uf = new UnionFind(graphMembers.length * 2); // 2 endpoints per member
  for (let a = 0; a < graphMembers.length; a++) {
    for (let b = a + 1; b < graphMembers.length; b++) {
      const pa = resampledCache[graphMembers[a]];
      const pb = resampledCache[graphMembers[b]];
      const tol = Math.max(CLOSE_GAP_PX, 0.08 * jointBboxDiag(pa, pb));
      const endsA = [pa[0], pa[pa.length - 1]];
      const endsB = [pb[0], pb[pb.length - 1]];
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          const d = Math.hypot(endsA[i][0] - endsB[j][0], endsA[i][1] - endsB[j][1]);
          if (d < tol) uf.union(a * 2 + i, b * 2 + j);
        }
      }
    }
  }

  // Node classes → degree count; a component is a simple cycle iff every node
  // has degree exactly 2 and #edges === #nodes ≥ 2.
  const nodeOf = (memberIdx: number, end: 0 | 1) => uf.find(memberIdx * 2 + end);
  const nodeDegree = new Map<number, number>();
  for (let m = 0; m < graphMembers.length; m++) {
    const n0 = nodeOf(m, 0);
    const n1 = nodeOf(m, 1);
    if (n0 === n1) continue; // self-loop — closure should have caught it; skip
    nodeDegree.set(n0, (nodeDegree.get(n0) ?? 0) + 1);
    nodeDegree.set(n1, (nodeDegree.get(n1) ?? 0) + 1);
  }

  const compositeLoops: Array<{ strokeIndices: number[]; points: Pt[] }> = [];
  const usedInComposite = new Set<number>();
  {
    const visited = new Set<number>(); // member indices
    for (let start = 0; start < graphMembers.length; start++) {
      if (visited.has(start)) continue;
      const n0 = nodeOf(start, 0);
      const n1 = nodeOf(start, 1);
      if (n0 === n1) continue;
      // Walk the cycle: follow edges through degree-2 nodes.
      const memberEdges: Array<{ m: number; reversed: boolean }> = [];
      let ok = true;
      let currNode = n1;
      let currEdge = start;
      memberEdges.push({ m: start, reversed: false });
      visited.add(start);
      let guard = graphMembers.length + 2;
      while (currNode !== n0 && guard-- > 0) {
        if ((nodeDegree.get(currNode) ?? 0) !== 2) {
          ok = false;
          break;
        }
        // Find the OTHER edge at currNode.
        let next = -1;
        let nextReversed = false;
        for (let m = 0; m < graphMembers.length; m++) {
          if (m === currEdge || visited.has(m)) continue;
          if (nodeOf(m, 0) === currNode) {
            next = m;
            nextReversed = false;
            break;
          }
          if (nodeOf(m, 1) === currNode) {
            next = m;
            nextReversed = true;
            break;
          }
        }
        if (next < 0) {
          ok = false;
          break;
        }
        memberEdges.push({ m: next, reversed: nextReversed });
        visited.add(next);
        currNode = nextReversed ? nodeOf(next, 0) : nodeOf(next, 1);
        currEdge = next;
      }
      if (!ok || currNode !== n0 || memberEdges.length < 2) continue;
      if ((nodeDegree.get(n0) ?? 0) !== 2) continue;
      // Compose the loop polygon: concatenate member points in walk order.
      const pts: Pt[] = [];
      for (const { m, reversed } of memberEdges) {
        const src = resampledCache[graphMembers[m]];
        const seq = reversed ? src.slice().reverse() : src;
        for (const p of seq) pts.push(p);
      }
      if (Math.abs(polygonArea(pts)) < REGION_MIN_AREA_PX2) continue;
      const strokeIndices = memberEdges.map(({ m }) => graphMembers[m]);
      compositeLoops.push({ strokeIndices, points: pts });
      for (const si of strokeIndices) usedInComposite.add(si);
    }
  }

  // ── 3. Region candidates: closed/treated-as-closed singles + composites ──
  const loops: RegionLoop[] = [];
  for (const f of features) {
    if (f.closure === 'open' || f.dotness) continue;
    const pts = resampledCache[f.index];
    if (Math.abs(polygonArea(pts)) < REGION_MIN_AREA_PX2) continue;
    loops.push({
      id: `loop-${loops.length}`,
      strokeIndices: [f.index],
      points: pts,
      closure: f.closure,
      composite: false,
      area: Math.abs(polygonArea(pts)),
    });
  }
  for (const comp of compositeLoops) {
    loops.push({
      id: `loop-${loops.length}`,
      strokeIndices: comp.strokeIndices,
      points: comp.points,
      closure: 'closed', // the graph merge IS the closure (R3 — silent)
      composite: true,
      area: Math.abs(polygonArea(comp.points)),
    });
  }

  // ── 4. Containment per stroke (vs loops not containing the stroke itself) ──
  for (const f of features) {
    let best = 0;
    let bestLoop: string | null = null;
    for (const loop of loops) {
      if (loop.strokeIndices.includes(f.index)) continue;
      const frac = containmentFraction(resampledCache[f.index], loop.points);
      // Innermost host: prefer higher containment, then SMALLER area.
      if (
        frac > best ||
        (frac === best &&
          bestLoop !== null &&
          frac > 0 &&
          loop.area < (loops.find((l) => l.id === bestLoop)?.area ?? Infinity))
      ) {
        best = frac;
        bestLoop = loop.id;
      }
    }
    f.containment = best;
    f.hostLoopId = best > 0 ? bestLoop : null;
  }

  const loopById = new Map(loops.map((l) => [l.id, l]));

  // ── 5. Clusters ──
  const clusters: IntentCluster[] = [];
  const clustered = new Set<number>();
  const loopBands: Record<string, number> = {};
  let clusterSeq = 0;

  // 5a. Composite loops → structure clusters (R3 — the two-arc circle).
  for (const loop of loops) {
    if (!loop.composite) continue;
    clusters.push({
      id: `cluster-${clusterSeq++}`,
      kind: 'composite-loop',
      strokeIndices: loop.strokeIndices,
      intent: 'structure',
      rawScore: 0.9,
      margin: 0.9,
      ambiguous: false,
      firedRules: ['R3_composite_loop'],
      band: null,
      hostLoopId: null,
      loopId: loop.id,
    });
    for (const si of loop.strokeIndices) clustered.add(si);
  }

  // 5b. Parallel hatching clusters (R7) — maximal runs of CONSECUTIVE record
  // indices (sequence adjacency is the cheap cluster prior, spec §2), calm,
  // open, contained ≥ 0.7 in the SAME host loop.
  {
    let runStart = -1;
    let runHost: string | null = null;
    const flushRun = (endExclusive: number) => {
      if (runStart < 0 || runHost === null) return;
      const hostId: string = runHost;
      const run: number[] = [];
      for (let i = runStart; i < endExclusive; i++) run.push(i);
      runStart = -1;
      runHost = null;
      if (run.length < PARALLEL_MIN_STROKES) return;
      // Angle coherence (±20° of the run mean, mod 180°).
      const angles = run.map((i) => chordAngle(resampledCache[i]));
      const ref = angles[0];
      const tol = (PARALLEL_ANGLE_TOL_DEG * Math.PI) / 180;
      if (!angles.every((a) => angularDiffMod180(a, ref) <= tol)) return;
      // Spacing regularity: project centers on the normal axis; σ/μ < 0.4.
      const normal = ref + Math.PI / 2;
      const proj = run
        .map((i) => features[i].center[0] * Math.cos(normal) + features[i].center[1] * Math.sin(normal))
        .sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < proj.length; i++) gaps.push(proj[i] - proj[i - 1]);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (!(mean > 0)) return;
      const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) * (g - mean), 0) / gaps.length);
      if (sd / mean >= PARALLEL_SPACING_CV_MAX) return;
      // Cluster STICKS: shading-gesture, ONE band on the container, 0 tubes.
      // Coverage from spacing/width (Praun TAM density math via coverage.ts).
      const host = loopById.get(hostId);
      const coverage = paramsToCoverage(
        { gap: mean, weight: NOMINAL_INK_WIDTH_PX, layers: 1 },
        'hachure',
      );
      const band = bandIndexForDarkness(coverage);
      const id = `cluster-${clusterSeq++}`;
      clusters.push({
        id,
        kind: 'parallel',
        strokeIndices: run,
        intent: 'shading-gesture',
        rawScore: 0.85,
        margin: 0.85 - BASE_STRUCTURE_PRIOR,
        ambiguous: false,
        firedRules: ['R7_parallel_hatch_cluster'],
        band,
        hostLoopId: host?.id ?? null,
        loopId: null,
      });
      if (host) loopBands[host.id] = Math.max(loopBands[host.id] ?? 0, band);
      for (const si of run) clustered.add(si);
    };
    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      const eligible =
        !clustered.has(i) &&
        !f.dotness &&
        f.closure === 'open' &&
        isCalm(f) &&
        f.containment >= CONTAINMENT_MIN &&
        f.hostLoopId !== null;
      if (eligible && runStart >= 0 && f.hostLoopId === runHost) continue; // extend run
      if (eligible) {
        flushRun(i);
        runStart = i;
        runHost = f.hostLoopId;
      } else {
        flushRun(i);
      }
    }
    flushRun(features.length);
  }

  // 5c. Dot clusters (R8 — stipple band, no spheres): dots inside the same
  // host loop, single-linkage chained at < 24px gaps, ≥ 4 → ONE band.
  {
    const dotsByHost = new Map<string, number[]>();
    for (const f of features) {
      if (clustered.has(f.index) || !f.dotness) continue;
      if (f.containment >= CONTAINMENT_MIN && f.hostLoopId) {
        if (!dotsByHost.has(f.hostLoopId)) dotsByHost.set(f.hostLoopId, []);
        dotsByHost.get(f.hostLoopId)!.push(f.index);
      }
    }
    for (const [hostId, dotIdxs] of dotsByHost) {
      if (dotIdxs.length < 2) continue;
      // Single-linkage chains.
      const dotUf = new UnionFind(dotIdxs.length);
      for (let a = 0; a < dotIdxs.length; a++) {
        for (let b = a + 1; b < dotIdxs.length; b++) {
          const ca = features[dotIdxs[a]].center;
          const cb = features[dotIdxs[b]].center;
          if (Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) < DOT_CLUSTER_GAP_PX) dotUf.union(a, b);
        }
      }
      const groups = new Map<number, number[]>();
      dotIdxs.forEach((si, k) => {
        const root = dotUf.find(k);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root)!.push(si);
      });
      for (const group of groups.values()) {
        if (group.length < DOT_CLUSTER_MIN) continue;
        const host = loopById.get(hostId)!;
        // Stipple density: one dot per g² cell, g = √(regionArea / n);
        // dot diameter = mean dot bboxDiag (floored at the nominal ink width).
        const gap = Math.sqrt(host.area / group.length);
        const weight = Math.max(
          group.reduce((a, si) => a + features[si].bboxDiag, 0) / group.length,
          NOMINAL_INK_WIDTH_PX,
        );
        const coverage = paramsToCoverage({ gap, weight, layers: 1 }, 'dots');
        const band = bandIndexForDarkness(coverage);
        clusters.push({
          id: `cluster-${clusterSeq++}`,
          kind: 'dot-cluster',
          strokeIndices: group,
          intent: 'shading-gesture',
          rawScore: 0.85,
          margin: 0.85 - BASE_STRUCTURE_PRIOR,
          ambiguous: false,
          firedRules: ['R8_stipple_dot_cluster'],
          band,
          hostLoopId: hostId,
          loopId: null,
        });
        loopBands[hostId] = Math.max(loopBands[hostId] ?? 0, band);
        for (const si of group) clustered.add(si);
      }
    }
  }

  // 5d. Singles — scored rules, top intent wins (R1/R2/R4/R5/R6/R9 + prior).
  for (const f of features) {
    if (clustered.has(f.index)) continue;
    // DEGENERATE-STROKE GUARD (BUG 3 sibling — empty-publish phantom): a stroke
    // that resampled to ZERO points carries no geometry at all (an empty
    // stroke, or one whose every coord was non-finite and got filtered out by
    // the resampler's Infinity guard). It can't be structure/shading/fill —
    // emitting a cluster makes convertStrokePool build a phantom rod for it on
    // an otherwise-empty publish. A real dot tap has resampledCount ≥ 1 (the
    // bead fixture), so this never drops a legitimate mark. */
    if (f.resampledCount === 0) continue;
    const scores: Record<MarkIntent, { score: number; rules: string[] }> = {
      structure: { score: BASE_STRUCTURE_PRIOR, rules: ['BASE_structure_prior'] },
      'shading-gesture': { score: 0, rules: [] },
      'fill-intent': { score: 0, rules: [] },
    };
    const bump = (intent: MarkIntent, score: number, rule: string) => {
      if (score > scores[intent].score) {
        scores[intent].score = score;
        scores[intent].rules = [rule];
      } else if (score === scores[intent].score) {
        scores[intent].rules.push(rule);
      }
    };

    const scribbleEnergy =
      f.reversalFreq >= SCRIBBLE_REVERSAL_FREQ || f.selfIsectDensity >= SCRIBBLE_SELF_ISECT;
    const contained = f.containment >= CONTAINMENT_MIN && f.hostLoopId !== null;
    const host = f.hostLoopId ? loopById.get(f.hostLoopId) : undefined;
    const regionCoverage = host && host.area > 0 ? f.hullArea / host.area : 0;
    /** Non-degenerate hull — density ratios are meaningless on slivers. */
    const hullSolid = f.hullArea >= HULL_SLIVER_MIN_FRACTION * f.bboxDiag * f.bboxDiag;
    /** Turn-dense: winds far more than any simple outline (a boustrophedon
     *  fill accumulates huge |turn| even when its 100px reversal rate is low
     *  — fixture 9's full-canvas scribble). */
    const turnDense = f.absTurnSum > CALM_MAX_ABS_TURNSUM;
    const spiral =
      Math.abs(f.turnSum) > SPIRAL_MIN_TURNSUM &&
      f.absTurnSum > 0 &&
      Math.abs(f.turnSum) / f.absTurnSum > SPIRAL_WINDING_CONSISTENCY &&
      f.bboxAspect <= SPIRAL_MAX_BBOX_ASPECT;

    // R1 — dot tap: structure bead.
    if (f.dotness) bump('structure', 0.9, 'R1_dot_bead');
    // R2 — calm stroke: structure (the amendment map applies downstream).
    if (isCalm(f)) bump('structure', 0.85, 'R2_calm_structure');
    // R4 — contained scribble, partial patch, NOT dense enough to be fill.
    if (
      scribbleEnergy &&
      contained &&
      regionCoverage < REGION_COVERAGE_FILL &&
      f.hullCoverage < HULL_COVERAGE_FILL
    ) {
      bump('shading-gesture', 0.8, 'R4_contained_scribble_shading');
    }
    // R5 — the blacked-in eye: contained + ink-dense (real hull), or
    // contained scribble covering most of its region.
    if (contained && hullSolid && f.hullCoverage >= HULL_COVERAGE_FILL) {
      bump('fill-intent', 0.85, 'R5_contained_dense_fill');
    }
    if (scribbleEnergy && contained && regionCoverage >= REGION_COVERAGE_FILL) {
      bump('fill-intent', 0.85, 'R5_contained_region_fill');
    }
    // R6 — deliberate spiral-fill / dense uncontained scribble: self-region.
    if (spiral) bump('fill-intent', 0.9, 'R6_spiral_fill');
    if (
      !contained &&
      (scribbleEnergy || turnDense) &&
      hullSolid &&
      f.hullCoverage >= HULL_COVERAGE_FILL
    ) {
      bump('fill-intent', 0.85, 'R6_uncontained_dense_fill');
    }
    // R9 — adversarial guard (lightning / cursive): reversal energy alone
    // never demotes to tone.
    if (
      (f.reversalFreq >= CALM_REVERSAL_FREQ || f.selfIsectDensity >= R9_SELF_ISECT) &&
      f.containment < R9_CONTAINMENT_MAX &&
      f.hullCoverage < R9_HULL_MAX
    ) {
      bump('structure', 0.85, 'R9_energy_without_corroboration');
    }

    const ranked = (Object.keys(scores) as MarkIntent[])
      .map((intent) => ({ intent, ...scores[intent] }))
      .sort((a, b) => b.score - a.score);
    const winner = ranked[0];
    const margin = winner.score - ranked[1].score;
    const ambiguous = margin < AMBIGUITY_MARGIN; // R10

    let band: number | null = null;
    if (winner.intent === 'fill-intent') {
      band = 7; // fill-intent regions enter at band 7 (spec §5)
    } else if (winner.intent === 'shading-gesture' && host) {
      const estCoverage = Math.min((f.arcLen * NOMINAL_INK_WIDTH_PX) / host.area, 1);
      band = bandIndexForDarkness(estCoverage);
      loopBands[host.id] = Math.max(loopBands[host.id] ?? 0, band);
    }

    clusters.push({
      id: `cluster-${clusterSeq++}`,
      kind: 'single',
      strokeIndices: [f.index],
      intent: winner.intent,
      rawScore: winner.score,
      margin,
      ambiguous,
      firedRules: winner.rules,
      band,
      hostLoopId: winner.intent === 'structure' ? null : f.hostLoopId,
      loopId: null,
    });
  }

  return { features, loops, clusters, loopBands };
}
