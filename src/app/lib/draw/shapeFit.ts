// ─── shapeFit — Shape Assist's recognition + snap engine (Rock F3) ───────────
// Implements docs/design/shape-assist-spec.md §2 (the engine). PURE and
// node-runnable like strokeTo3d.ts / geometry3d/markIntent.ts: no React, no
// DOM, no wall-clock, no randomness. The 2D draw pipeline file stays untouched.
//
// SEBS'S LAW (the spec's governing constraint): freehand is the DEFAULT. This
// module is a LIBRARY of pure functions that the SNAP / STRAIGHTEN action pills
// call ON DEMAND on the LAST stroke. It NEVER runs on pen-up, never auto-fires,
// never suggests. A user who never taps the pills never touches this code.
//
// Pipeline (every stage already exists somewhere in our stack — this module
// COMPOSES, it does not invent):
//   1. Resample the stroke arc-length at INTENT_RESAMPLE_SPACING_PX (the
//      $1-recognizer normalization move [Wobbrock '07] — same constant the
//      mark-intent brain uses, so a capStrokes-halved record fits identically).
//   2. Gate with mark-intent features (REUSE the constants, don't redefine):
//      scribble reversal/self-intersection energy → refuse (scribbles are tone
//      intent, not shapes); bboxDiag < dot floor → refuse (dot territory).
//   3. Corners: ShortStraw on the resampled points [Wolin '08], CROSS-CHECKED
//      against rdpPoints ε=3.0 anchors [strokeTo3d.ts] — a corner must appear
//      in both to count. Hybrid: ShortStraw finds corners RDP smears on slow
//      curves; RDP kills ShortStraw's false positives on noise.
//   4. Fit every eligible candidate {line, polyline, polygon, triangle, rect,
//      circle, ellipse} and score by normalized error (÷ bboxDiag).
//   5. Rank by score (error + complexity prior), accept only if best
//      normErr ≤ SNAP_MAX_NORM_ERR. Chip carries every candidate within 2×
//      threshold, ranked, plus 'original' always last.
//   6. Honest no-snap: below threshold for everything → refuse, full candidate
//      table returned for the log. Never force the least-bad fit.
//
// STRAIGHTEN = the same engine, candidate set restricted to {line, polyline,
// polygon}, no template regularization (drawn proportions kept). It almost
// never refuses — only corner count > STRAIGHTEN_MAX_CORNERS (a scribble).
//
// Closure weld (SA-G): snapping a treated-as-closed stroke to a CLOSED
// candidate emits an EXACTLY closed loop — the gap-weld is legitimate because
// snap is an explicit user act (unlike the silent inference the 3-state closure
// chip confesses). Open candidates never weld.

import {
  RDP_EPSILON,
  closureStateOf,
  rdpPoints,
  type ClosureState,
  type StrokeInputPoint,
} from '../geometry3d/strokeTo3d.ts';
import {
  INTENT_RESAMPLE_SPACING_PX,
  DOT_MAX_BBOX_DIAG,
  SCRIBBLE_REVERSAL_FREQ,
  SCRIBBLE_SELF_ISECT,
  REVERSAL_TURN_DEG,
} from '../geometry3d/markIntent.ts';

// ─── Calibration constants (provisional — SA-H, mirror of MI-F) ──────────────

/** Accept a snap only if the best candidate's normalized error (RMS deviation
 *  ÷ bbox diagonal) is at or below this. Was 3.5% (provisional) — far too tight:
 *  hand-drawn shapes routinely run 5–10% deviation, so Snap refused on real
 *  doodles and "kept points open / impossible to get a closed shape" (Sebs
 *  2026-06-13). 10% accepts genuine hand-drawn squares/circles/triangles into a
 *  clean CLOSED form while still rejecting scribbles; the chip still lists every
 *  candidate + 'original' so an over-eager snap is one tap to undo. */
export const SNAP_MAX_NORM_ERR = 0.10;
/** Chip carries every candidate within this multiple of the accept threshold,
 *  ranked. 'original' is always appended last regardless. */
export const CHIP_CANDIDATE_ERR_MULT = 2;
/** Below this bbox diagonal the stroke is a dot/tick — refuse (snap needs a
 *  shape). Mirrors the mark-intent dot floor + spec's 24px line. */
export const SNAP_MIN_BBOX_DIAG = 24;
/** Straighten refuses only above this corner count (that's a scribble, not a
 *  polyline anyone wants crisped). */
export const STRAIGHTEN_MAX_CORNERS = 24;
/** ShortStraw window half-width (chord over points i±W). [Wolin '08] uses 3. */
export const SHORTSTRAW_WINDOW = 3;
/** Straw-length minima below median × this are corner candidates. */
export const SHORTSTRAW_MEDIAN_FACTOR = 0.95;
/** A corner from ShortStraw counts only if an RDP anchor lies within this many
 *  resampled-point indices (the cross-check tolerance). */
export const CORNER_RDP_INDEX_TOL = 2;
/** Ellipse with bbox aspect at or below this cedes its rank to circle (a near-
 *  round stroke reads as a circle first; the chip cycles to ellipse). */
export const CIRCLE_PREFERENCE_ASPECT = 1.15;
/** circle/ellipse geometric corroboration: |turnSum| must be within this of
 *  2π (a closed round form turns once). [PaleoSketch corroboration move]. */
export const ROUND_TURNSUM_TOL = Math.PI * 0.9;
/** Complexity prior added to each candidate's error so the simpler read wins
 *  on ties (PaleoSketch ranking: line < circle < triangle < rect < ellipse <
 *  polygon < polyline). Tiny — only breaks near-ties. */
export const COMPLEXITY_PRIOR = 0.004;
/** Right-angle regularization: a rect candidate requires its 4 corner angles
 *  within this many degrees of 90°, else it loses to the generic polygon. */
export const RECT_ANGLE_TOL_DEG = 22;
/** Square chip variant offered when the rect's side ratio is within this. */
export const SQUARE_ASPECT_TOL = 1.18;
/** Equilateral-triangle chip variant offered when the side CV is below this. */
export const EQUILATERAL_CV_MAX = 0.14;
/** Collinear / turn-angle MERGE: after corner detection, a "corner" whose
 *  interior turn is below this many degrees is a false split on a straight run
 *  (the over-segmentation that made a clean rect read as Polygon (5/6) — bug 1).
 *  We fold it back into the edge. 18° is below a real polygon vertex's turn yet
 *  above hand-jitter on a straight edge. [PaleoSketch DCR / merge-collinear]. */
export const COLLINEAR_MERGE_TURN_DEG = 18;
/** JITTER-SCALE RDP pre-simplification (SA-corner-robustness, 2026-06-13): the
 *  ShortStraw+RDP cross-check runs on the RAW resampled polyline, so on a rough
 *  TOUCHPAD stroke (heavy per-sample wobble) the straw-length median goes noisy
 *  and RDP ε=3.0 manufactures an anchor at every wobble — a clean rough SQUARE
 *  read as 18–23 corners → Polyline, never rect (Sebs's "Snap can't detect, does
 *  it for a square too"). FIX: before corner finding we RDP-simplify the
 *  resampled points with an epsilon that SCALES with the shape so the wobble
 *  collapses but real corners survive. ε = clamp(bboxDiag × RATIO, FLOOR, CAP).
 *  RATIO ≈ 3% of the diagonal sits above touchpad jitter (~1–6px on a 300px
 *  shape) yet well below a real corner's excursion (a square corner deviates
 *  ~size/2 from the edge chord). The FLOOR keeps a crisp small stroke honest;
 *  the CAP stops a huge sloppy stroke from eating its own corners. */
/** Corner-detection epsilon = max(minDim × MINDIM_RATIO, noise × NOISE_MULT),
 *  clamped [FLOOR, CAP]. minDim (the SHORTER bbox side) is the primary scale: an
 *  elongated shape's at-risk corners live on its short edges, so keying off the
 *  short dimension (not the diagonal) is what stopped the 2:1-rect-eaten-corner
 *  regression. The noise term is a secondary floor so an unusually rough stroke on
 *  a small shape still collapses. Both stay well below a real corner's chord
 *  excursion (~½ an edge); the dominant-corner template recovery + min-area-rect
 *  fallback are the safety nets when a sparse rough stroke still over-segments. */
export const CORNER_RDP_MINDIM_RATIO = 0.085;
export const CORNER_RDP_NOISE_MULT = 1.4;
export const CORNER_RDP_NOISE_WINDOW = 5;
export const CORNER_RDP_EPS_FLOOR = 3.0; // == RDP_EPSILON; never below the styled-read anchor ε
export const CORNER_RDP_EPS_CAP = 34.0;
/** FORGIVING SNAP CLOSURE (SA-corner-robustness): closureStateOf() lives in
 *  strokeTo3d and is shared by the (silent, conservative) AUTO conversion path,
 *  so it stays strict — a 27px endpoint gap on a 300px shape reads 'open'. But
 *  SNAP / STRAIGHTEN is an EXPLICIT user act on the LAST stroke (spec §SA-G:
 *  "the gap-weld is legitimate because snap is an explicit user act"), so it can
 *  afford a far more forgiving closure read. We treat a stroke as closed-eligible
 *  for snapping when EITHER the endpoint gap is within this fraction of the bbox
 *  diagonal, OR the path turns ≈ one full loop (|turnSum| near 2π) — the
 *  geometric signature of a shape the user drew as closed but didn't perfectly
 *  meet. This unlocks the rect/triangle/circle templates that the 'open' verdict
 *  was hiding. The honest closure value still rides in diag.closure for the log. */
export const SNAP_CLOSE_GAP_DIAG_RATIO = 0.22;
export const SNAP_CLOSE_TURNSUM_FRAC = 0.6; // |turnSum| ≥ this × 2π (216°) reads as one loop
/** SHAPE-AWARE closure (LOW-1, 2026-06-13): the gap/turnSum gate above is
 *  geometry-uniform, but a CORNERED shape and a ROUNDED shape don't accumulate
 *  closure evidence the same way. A circle drawn 67%-of-the-way still turns
 *  ~1.3π and reads closed; a triangle with one full edge missing (a 33%-open
 *  cornered shape the user clearly meant to close) turns only ~0.7π and its gap
 *  is a whole edge wide — so it stayed an OPEN polyline while the equally-open
 *  circle welded. When the stroke is CORNERED (it has clear sharp direction
 *  changes — PaleoSketch DCR), we (a) widen the close gap ratio and (b) relax
 *  the turnSum loop fraction, because a cornered shape legitimately closes with
 *  fewer turning radians and a larger missing-edge gap. A genuinely-open stroke
 *  (line / open L / arc) has either too few corners or too little total turning
 *  to trip the relaxed gate, so it stays open. */
export const SNAP_CLOSE_CORNERED_GAP_DIAG_RATIO = 0.34;
/** Cornered loop-turn fraction (LOW-1): set so a CORNERED shape that turned most
 *  of a full loop welds even with a whole-edge gap, while an OPEN zigzag/W (whose
 *  turning OSCILLATES in sign and nets out well below a full loop) does NOT. A
 *  triangle drawn 20% open turns ~1.4π (0.7 × 2π); an open zigzag-W nets ~0.88π
 *  (0.44 × 2π). 0.62 × 2π (≈1.24π / 223°) sits cleanly between them, so the
 *  cornered closure is OR-gated (gap OR strong turn) yet a genuinely-open
 *  sign-alternating stroke never welds. */
export const SNAP_CLOSE_CORNERED_TURNSUM_FRAC = 0.62;
/** A "sharp direction change" for the corneredness signal: a resampled-polyline
 *  windowed turn at or above this many degrees is a vertex-grade bend (well above
 *  the per-sample jitter of a smooth curve, at/below a real polygon vertex). The
 *  count of WELL-SPREAD sharp bends is the DCR-style corner evidence that gates
 *  the cornered closure relaxation AND the polygon-beats-circle promotion. */
export const CORNERED_SHARP_TURN_DEG = 42;
export const CORNERED_TURN_WINDOW = 2; // ± resampled samples for the windowed turn
/** Minimum count of well-spread sharp bends for the stroke to read as CORNERED
 *  (a polygon has ≥3; a circle/ellipse has ~0; an arc/line has 0-1). */
export const CORNERED_MIN_SHARP = 3;
/** Closure-relaxation cornered threshold (LOW-1): LOWER than CORNERED_MIN_SHARP
 *  because a cornered shape drawn with one edge missing only shows 2 sharp
 *  corners (a triangle with its base un-drawn, a square with one side open — the
 *  3rd/4th corner sits at the un-met seam). 2 cleanly separates a cornered-but-
 *  open polygon (≥2 corners) from an open L (1) or a line/arc (0), and the
 *  cornered closure gate ALSO requires meaningful turning (gapClosed AND
 *  loopClosed), so an open L/V with only a partial turn never welds. */
export const CLOSURE_CORNERED_MIN_SHARP = 2;
/** ROUND-EVIDENCE polygon-suppression (MED-1, 2026-06-13): an ultra-wobbly
 *  circle (per-sample hand-shake ≳ ⅓ radius) manufactures a dozen+ false corners,
 *  so the generic Polygon(N) hugs the wobble at a tiny RMS and out-ranks the true
 *  Circle — and at worst a min-area Rect does too, leaving Rectangle as the
 *  default and Circle buried/dropped. This mirrors TEMPLATE_OVER_POLYGON but for
 *  the ROUND family: when a circle/ellipse fit is genuinely good (normErr below
 *  the bound) AND the stroke is NOT cornered (few sharp bends — it's wobble, not
 *  vertices), the round read is the one the user wants and is promoted over the
 *  jitter-polygon / jitter-rect. [PaleoSketch NDDE/DCR: low direction-change-ratio
 *  ⇒ curve, not polyline; a wobbly circle is still a curve.] */
export const ROUND_OVER_POLYGON_NORMERR = 0.085;
/** A circle/ellipse candidate with strong round evidence (good fit + not
 *  cornered) is GUARANTEED a chip slot regardless of the 2× cutoff, so the user
 *  can always recover a circle even when a rect also fits (Sebs's non-recoverable
 *  MED-1 case). */
export const ROUND_CHIP_GUARANTEE_NORMERR = 0.12;
/** POLYGON-BEATS-CIRCLE (MED-2, 2026-06-13): a clean regular n-gon (pentagon /
 *  hexagon / 45°-diamond) has a SMALL, fixed vertex count (its polygon fit lands
 *  on exactly N corners) and a markedly better polygon fit than a circle, yet
 *  CIRCLE_PREFERENCE + the complexity prior let circle out-rank it as the default
 *  read. The decisive discriminant (proven on the catalog: a clean n-gon's
 *  polygon fit has 4-8 verts; an ultra-wobbly circle's has 20+) is the polygon
 *  VERTEX COUNT — a low-vertex polygon-family read that fits markedly better than
 *  the circle is a real n-gon and WINS; a high-vertex polygon is jitter (handled
 *  by ROUND-BEATS-POLYGON below). [PaleoSketch NDDE/DCR + vertex-count, the same
 *  philosophy as TEMPLATE_VERTEX_EXCESS_GAIN.] A LOW-vertex (real n-gon) polygon
 *  only needs to beat the circle by this modest factor; a genuine circle's only
 *  polygon fit is HIGH-vertex (excluded from the n-gon test), so a smaller factor
 *  can't promote a polygon over a true circle. 1.25 catches the clean hand-drawn
 *  pentagon/hexagon whose polygon fit (0.012) is only ~1.35× better than its
 *  circle fit (0.016) without false-promoting wobble. A genuine circle's only
 *  polygon fit is HIGH-vertex (excluded from the n-gon test), so even this modest
 *  factor can't promote a polygon over a true circle. */
export const POLYGON_OVER_CIRCLE_ERR_FACTOR = 1.12;
/** A polygon-family read with at most this many vertices is a candidate REGULAR
 *  POLYGON (triangle … octagon — the shapes a user draws as a clean n-gon). More
 *  vertices ⇒ the "polygon" is hugging per-sample wobble on a round stroke (the
 *  MED-1 case), so the round read wins instead. rect=4 and triangle=3 are always
 *  within this; star carries its own (2p) count. */
export const POLYGON_NGON_MAX_VERTS = 8;
/** REGULAR-POLYGON RECOVERY (MED-2 robustness, 2026-06-13): the primary corner
 *  pipeline's noise-adaptive RDP epsilon (CORNER_RDP_MINDIM_RATIO) is tuned to
 *  COLLAPSE rough-square wobble — but on a clean pentagon/hexagon whose vertices
 *  are "soft" (60-72° turns) it occasionally smears one vertex, under-segmenting a
 *  5-gon to 4 corners → a bad polygon fit → circle wins. Lowering that shipped
 *  ratio re-opened the rough-square over-segmentation, so instead we ADD a
 *  dedicated regular-polygon hypothesis: a SECOND, finer-epsilon cyclic corner
 *  pass that recovers the soft vertices, gated hard on REGULARITY (near-equal
 *  edges + consistent same-sign convex turns). It only EVER adds a polygon
 *  candidate when the stroke really is a regular n-gon; it never touches the
 *  primary pipeline or the shipped triangle/rect reads. [PaleoSketch: a regular
 *  polygon's defining feature is equal edges + equal turning.] */
export const NGON_RECOVERY_EPS_FLOOR = 3.0;
export const NGON_RECOVERY_MINDIM_RATIO = 0.045; // finer than the primary 0.085
export const NGON_RECOVERY_MIN_VERTS = 5; // triangle/rect already recovered by the primary pipeline
export const NGON_RECOVERY_MAX_VERTS = 8;
/** Edge-length coefficient-of-variation ceiling for the regular-polygon gate (a
 *  regular n-gon's edges are near-equal; a lumpy blob's vary wildly). */
export const NGON_EDGE_CV_MAX = 0.30;
/** Every vertex of a CONVEX regular polygon turns the SAME sign (no concave
 *  notches) and by a similar amount; require at least this fraction of the
 *  turns to share the dominant sign (rejects a star / lumpy blob). */
export const NGON_CONVEX_FRAC_MIN = 0.85;
/** Regularization PREFERENCE (PaleoSketch interpretation-priority): a rect or
 *  triangle that CLEARS its geometric gate is the higher-value read the user
 *  wants — it should beat the generic polygon even when the regularized fit's
 *  RMS error is marginally higher than the raw drawn-corner polygon's. We let
 *  the template win whenever its normErr ≤ polygon.normErr × this. */
export const TEMPLATE_OVER_POLYGON_ERR_MULT = 2.4;
/** The template-over-polygon accept multiple grows by this per EXTRA polygon
 *  vertex (a Polygon(12) beating a triangle is jitter; a Polygon(4) tying a rect
 *  is not). Gated by SNAP_MAX_NORM_ERR so the template must still be a genuinely
 *  good fit — a real pentagon's dominant-3 triangle has RMS far above 0.10 and is
 *  never promoted. [PaleoSketch interpretation-priority, vertex-count aware.] */
export const TEMPLATE_VERTEX_EXCESS_GAIN = 0.22;
/** Dominant-corner SPREAD: when picking the K vertices of a rough K-gon hypothesis
 *  we require each pick to be at least (loopLen / K) × this fraction of arc from
 *  every prior pick, so two jitter bumps on the SAME edge aren't both chosen (the
 *  fix that lets fitRect's 90° gate see the true square corners on a very-rough
 *  square). 0.5 = half the ideal vertex spacing — generous enough for a lopsided
 *  drawn shape, tight enough to reject same-edge doubles. */
export const DOMINANT_CORNER_SPREAD_FRAC = 0.5;
/** STAR (regular {p/q}) recognition: a star alternates convex/concave vertices.
 *  A clean 5-point star has 10 corners; we accept this many ± the slop below.
 *  [Star-polygon turning-number theory]. */
export const STAR_MIN_POINTS = 5;
export const STAR_MAX_POINTS = 9;
/** Star concavity: the fraction of vertices that must be CONCAVE (turn sign
 *  opposite the loop's overall winding) to read as a star — a real star
 *  alternates, so ~half are concave. Floor a touch below 0.5 for slop. */
export const STAR_MIN_CONCAVE_FRAC = 0.34;
/** STAR radial-swing floor: a real {p/q} star's tip radius is far larger than its
 *  notch radius, so (rMax−rMin)/rMax is large (≈0.5+ for a 5-point star). A rough
 *  convex quad's alternating noise bumps barely swing radially — this floor (0.30)
 *  rejects them so a jittery rectangle never reads as a Star. */
export const STAR_MIN_RADIAL_SWING = 0.3;
/** STAR notch-depth floor: a real star's concave notches sit this fraction of the
 *  bbox diagonal INSIDE the convex hull. A jittery square/circle's "concave"
 *  bumps are shallow (within ~the jitter amplitude of the hull), so 0.12 cleanly
 *  separates a genuine star from heavy noise on a convex shape. */
export const STAR_MIN_NOTCH_DEPTH_FRAC = 0.12;
/** ARROW recognition (geometry-based shaft + V-head decomposition): an arrow is
 *  an OPEN corner-chain whose leading run is one dominant near-straight SHAFT and
 *  whose trailing 1-2 short segments fold back as the head. The total shaft
 *  length must be at least this multiple of the LONGEST single barb segment (so a
 *  zigzag of equal-length segments — no dominant shaft — is rejected). */
export const ARROW_SHAFT_HEAD_RATIO = 1.8;
/** The arrowhead barbs turn back toward the shaft by at least this many degrees
 *  from the shaft direction (a real arrowhead opens 20-70° off the shaft, so the
 *  barb–shaft angle is large). Floor that the head clearly diverges. */
export const ARROW_HEAD_MIN_TURN_DEG = 22;
/** Arrow needs at least this many corners total (shaft endpoints + 1-2 head
 *  vertices) and at most this many (more = it's a polyline, not an arrow). */
export const ARROW_MIN_CORNERS = 4;
export const ARROW_MAX_CORNERS = 6;

// ─── Types ───────────────────────────────────────────────────────────────────

export type FitPoint = [number, number];

export type ShapeKind =
  | 'line'
  | 'polyline'
  | 'polygon'
  | 'triangle'
  | 'rect'
  | 'star'
  | 'arrow'
  | 'circle'
  | 'ellipse'
  | 'original';

/** One fitted candidate: the clean geometry + how well it matched. */
export interface ShapeCandidate {
  kind: ShapeKind;
  /** The clean shape as a point list (closed candidates list their vertices;
   *  the caller closes the loop). 'original' carries the source points. */
  points: FitPoint[];
  /** RMS deviation of the source from the ideal, ÷ bboxDiag (0 = perfect). */
  normErr: number;
  /** score = (1 − normErr) − complexityPrior; higher is better. */
  score: number;
  /** Whether this candidate is a closed loop (circle/ellipse/triangle/rect/
   *  polygon) vs an open path (line/polyline). */
  closed: boolean;
  /** Human chip label ("Circle", "Square", "Original"). */
  label: string;
  /** Geometric-corroboration / regularization notes (for the log). */
  notes?: string;
}

export type SnapAction = 'snap' | 'straighten';

export interface ShapeFitResult {
  action: SnapAction;
  /** Did any candidate clear the threshold? (Straighten's polyline/line almost
   *  always does; a scribble refuses.) */
  accepted: boolean;
  /** Ranked candidates, best first, with 'original' ALWAYS last (so the chip
   *  can cycle back to the drawn stroke — Sebs's drew-a-triangle-but-wants-
   *  something-else case is first-class). Empty source → []. */
  candidates: ShapeCandidate[];
  /** Why a refusal happened (null when accepted). */
  refusedReason: string | null;
  /** Diagnostics for the decision log / battery. */
  diag: {
    closure: ClosureState;
    bboxDiag: number;
    resampledCount: number;
    cornerCount: number;
    reversalFreq: number;
    selfIsectDensity: number;
    turnSum: number;
    bboxAspect: number;
  };
}

// ─── Geometry helpers (pure, viewBox space) ──────────────────────────────────

function xy(p: StrokeInputPoint): FitPoint {
  return [p[0], p[1]];
}

/** Arc-length resample at `spacing` — identical algorithm to markIntent's so a
 *  capped record snaps the same as a live one (spec §2 honesty constraint). */
export function resampleArcLength(points: StrokeInputPoint[], spacing: number): FitPoint[] {
  if (points.length === 0) return [];
  const out: FitPoint[] = [xy(points[0])];
  if (points.length === 1) return out;
  let prev: FitPoint = out[0];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const curr: FitPoint = xy(points[i]);
    const segLen = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    if (segLen <= 1e-12) continue;
    let walked = spacing - carry;
    while (walked <= segLen) {
      const t = walked / segLen;
      out.push([prev[0] + (curr[0] - prev[0]) * t, prev[1] + (curr[1] - prev[1]) * t]);
      walked += spacing;
    }
    carry = segLen - (walked - spacing);
    prev = curr;
  }
  const last: FitPoint = xy(points[points.length - 1]);
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > 1e-9) out.push(last);
  return out;
}

function bboxOf(pts: FitPoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function bboxDiagOf(pts: FitPoint[]): number {
  if (pts.length === 0) return 0;
  const b = bboxOf(pts);
  return Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
}

function polylineLength(pts: FitPoint[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

function dist(a: FitPoint, b: FitPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Perpendicular distance from p to the infinite line through a,b. */
function pointLineDist(p: FitPoint, a: FitPoint, b: FitPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return dist(p, a);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** Distance from p to the SEGMENT a–b (clamped projection). */
function pointSegDist(p: FitPoint, a: FitPoint, b: FitPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** RMS over a per-point residual array, normalized by bboxDiag. */
function normRms(residuals: number[], bboxDiag: number): number {
  if (residuals.length === 0 || bboxDiag < 1e-9) return Infinity;
  const ss = residuals.reduce((a, r) => a + r * r, 0);
  return Math.sqrt(ss / residuals.length) / bboxDiag;
}

// ─── Per-stroke signal block (REUSING markIntent's feature math + constants) ──

interface SnapSignals {
  resampled: FitPoint[];
  anchors: FitPoint[]; // RDP ε=3.0
  bboxDiag: number;
  bboxAspect: number;
  arcLen: number;
  closure: ClosureState;
  /** Forgiving closure read for the EXPLICIT snap/straighten act (NOT the
   *  conservative shared closureStateOf): true when the stroke is closed-
   *  eligible by gap-vs-diag OR one-full-loop turning. Drives both the cyclic
   *  corner scan and the closed-template family. `closure` stays honest for the
   *  log. See SNAP_CLOSE_* constants. */
  snapClosed: boolean;
  reversalFreq: number; // per 100px (markIntent grammar)
  selfIsectDensity: number; // per 100px
  turnSum: number; // signed total turning
  /** Centroid WINDING — the signed angle swept around the point cloud's centroid
   *  as the stroke is traversed. UNLIKE turnSum (per-sample tangent turning), this
   *  is ROBUST to per-sample radial wobble: an ultra-wobbly circle still winds
   *  ≈ ±2π around its center even when its per-sample turnSum is corrupted into
   *  noise. It's the wobble-proof round-corroboration signal (MED-1) — a heavily
   *  shaken circle's turnSum gate was rejecting the circle FIT outright; the
   *  winding gate rescues it. An open stroke winds well under a full turn. */
  windingSum: number;
  /** Count of WELL-SPREAD sharp direction changes on the resampled polyline
   *  (PaleoSketch-DCR-style corner evidence) — measured DIRECTLY here so it can
   *  drive the shape-aware closure BEFORE the full corner pipeline runs. A
   *  polygon has ≥3; a circle/ellipse ~0; a line/arc 0-1. See sharpBendCount. */
  sharpBends: number;
  /** True when sharpBends ≥ CORNERED_MIN_SHARP — the stroke is a cornered
   *  (polygon-intent) shape, not a rounded one. Gates LOW-1 closure relaxation,
   *  MED-1 round-promotion suppression, and MED-2 polygon-over-circle. */
  cornered: boolean;
}

/** Count WELL-SPREAD sharp direction changes (vertex-grade bends) on a polyline.
 *  For each interior sample we take the windowed turn over ±CORNERED_TURN_WINDOW
 *  samples; a turn ≥ CORNERED_SHARP_TURN_DEG is a sharp bend. Consecutive sharp
 *  samples (one real corner smeared over a few samples) collapse to one. This is
 *  the DCR-style discriminant: a polygon racks up N sharp bends, a smooth/wobbly
 *  curve racks up ~0 (its turning is spread thin across every sample, never
 *  concentrated). `cyclic` wraps the window for a closed loop. */
function sharpBendCount(pts: FitPoint[], cyclic: boolean): number {
  const n = pts.length;
  const w = CORNERED_TURN_WINDOW;
  if (n < 2 * w + 1) return 0;
  const lo = cyclic ? 0 : w;
  const hi = cyclic ? n : n - w;
  let count = 0;
  let inRun = false;
  for (let i = lo; i < hi; i++) {
    const turn = interiorTurnDeg(pts, cyclic ? (i % n) : i, w, cyclic);
    if (turn >= CORNERED_SHARP_TURN_DEG) {
      if (!inRun) {
        count++;
        inRun = true;
      }
    } else {
      inRun = false;
    }
  }
  return count;
}

function segmentsCross(a1: FitPoint, a2: FitPoint, b1: FitPoint, b2: FitPoint): boolean {
  const d = (p: FitPoint, q: FitPoint, r: FitPoint) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = d(b1, b2, a1);
  const d2 = d(b1, b2, a2);
  const d3 = d(a1, a2, b1);
  const d4 = d(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function selfIntersections(anchors: FitPoint[]): number {
  let count = 0;
  for (let i = 0; i + 1 < anchors.length; i++) {
    for (let j = i + 2; j + 1 < anchors.length; j++) {
      if (i === 0 && j + 2 === anchors.length) continue;
      if (segmentsCross(anchors[i], anchors[i + 1], anchors[j], anchors[j + 1])) count++;
    }
  }
  return count;
}

function computeSignals(raw: StrokeInputPoint[]): SnapSignals {
  const resampled = resampleArcLength(raw, INTENT_RESAMPLE_SPACING_PX);
  const anchors = rdpPoints(raw, RDP_EPSILON).map(xy);
  const arcLen = polylineLength(resampled);
  const bboxDiag = bboxDiagOf(resampled);
  const b = bboxOf(resampled);
  const bw = Math.max(b.maxX - b.minX, 1e-6);
  const bh = Math.max(b.maxY - b.minY, 1e-6);
  const bboxAspect = Math.max(bw, bh) / Math.min(bw, bh);
  const per100 = arcLen > 0 ? 100 / arcLen : 0;

  const reversalRad = (REVERSAL_TURN_DEG * Math.PI) / 180;
  const angleBetween = (ax: number, ay: number, bx: number, by: number) =>
    Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);
  let reversals = 0;
  let turnSum = 0;
  let suppressNextWindowed = false;
  for (let i = 1; i + 1 < resampled.length; i++) {
    const ax = resampled[i][0] - resampled[i - 1][0];
    const ay = resampled[i][1] - resampled[i - 1][1];
    const bx = resampled[i + 1][0] - resampled[i][0];
    const by = resampled[i + 1][1] - resampled[i][1];
    const turn = angleBetween(ax, ay, bx, by);
    let windowed = 0;
    if (i >= 2 && !suppressNextWindowed) {
      const px = resampled[i - 1][0] - resampled[i - 2][0];
      const py = resampled[i - 1][1] - resampled[i - 2][1];
      windowed = angleBetween(px, py, bx, by);
    }
    if (turn > reversalRad || windowed > reversalRad) {
      reversals++;
      suppressNextWindowed = true;
    } else {
      suppressNextWindowed = false;
    }
    const cross = ax * by - ay * bx;
    turnSum += Math.sign(cross) * turn;
  }

  const crossings = anchors.length >= 4 ? selfIntersections(anchors) : 0;

  // Centroid winding (wobble-robust round signal — MED-1). Angle swept around the
  // resampled cloud's centroid; near ±2π for any closed loop (round OR cornered),
  // well under for an open stroke, and IMMUNE to per-sample radial wobble (which
  // corrupts the per-sample turnSum). Rescues the heavily-shaken-circle round gate.
  let windingSum = 0;
  if (resampled.length >= 3) {
    let mx = 0, my = 0;
    for (const [x, y] of resampled) { mx += x; my += y; }
    mx /= resampled.length; my /= resampled.length;
    let prevAng = Math.atan2(resampled[0][1] - my, resampled[0][0] - mx);
    for (let i = 1; i < resampled.length; i++) {
      const ang = Math.atan2(resampled[i][1] - my, resampled[i][0] - mx);
      let d = ang - prevAng;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      windingSum += d;
      prevAng = ang;
    }
  }

  // CORNEREDNESS (DCR-style) — computed on the drawn (open) path so it's
  // available BEFORE the closure decision below. A polygon-intent stroke has ≥3
  // well-spread sharp bends; a rounded one has ~0. A partially-open polygon may
  // show only 2 (the missing-edge seam hides the last corner) — closure uses the
  // lower CLOSURE_CORNERED_MIN_SHARP, the `cornered` flag stays at the stricter ≥3.
  const sharpBends = sharpBendCount(resampled, false);
  const cornered = sharpBends >= CORNERED_MIN_SHARP;
  const closureCornered = sharpBends >= CLOSURE_CORNERED_MIN_SHARP;

  const closure = closureStateOf(raw);
  // Forgiving snap closure (explicit act): honest 'closed'/'treated-as-closed'
  // always qualify; an 'open' stroke still qualifies when its endpoints land
  // within the close gap ratio of the bbox diagonal OR it turns ≈ one full loop
  // (the rough-square / lifted-pen case that read 'open' on the strict shared
  // threshold). bboxDiag floor guards the divide.
  //
  // SHAPE-AWARE (LOW-1): a CORNERED stroke uses the more forgiving cornered gap
  // ratio + turnSum fraction, because a cornered shape with one edge missing
  // legitimately leaves a whole-edge gap and turns fewer total radians than a
  // rounded shape at the same open fraction. A rounded stroke keeps the original
  // (tighter) ratios — its turning accumulates fast, so it doesn't need the
  // relaxation, and we don't want to weld a genuinely-open arc. The honest
  // closure value still rides in `closure` for the log.
  let snapClosed = closure !== 'open';
  if (!snapClosed && resampled.length >= 3 && bboxDiag > 1e-6) {
    const first = resampled[0];
    const last = resampled[resampled.length - 1];
    const gap = Math.hypot(last[0] - first[0], last[1] - first[1]);
    const gapRatio = closureCornered ? SNAP_CLOSE_CORNERED_GAP_DIAG_RATIO : SNAP_CLOSE_GAP_DIAG_RATIO;
    const turnFrac = closureCornered ? SNAP_CLOSE_CORNERED_TURNSUM_FRAC : SNAP_CLOSE_TURNSUM_FRAC;
    const gapClosed = gap <= bboxDiag * gapRatio;
    const loopClosed = Math.abs(turnSum) >= turnFrac * 2 * Math.PI;
    // OR-gate both families: closure intent is satisfied by EITHER a small-enough
    // endpoint gap OR enough total turning. A cornered shape gets the wider gap
    // ratio + the higher (full-loop-ish) turn fraction — wide enough to weld a
    // triangle with one edge un-met, but the high turn fraction means an OPEN
    // zigzag/W (whose turning oscillates in sign and nets well below a loop) and
    // an open L (tiny net turn, huge gap) never trip it. A rounded shape keeps
    // the original (tighter gap, lower turn — its turning accumulates fast).
    snapClosed = gapClosed || loopClosed;
  }

  return {
    resampled,
    anchors,
    bboxDiag,
    bboxAspect,
    arcLen,
    closure,
    snapClosed,
    reversalFreq: reversals * per100,
    selfIsectDensity: crossings * per100,
    turnSum,
    windingSum,
    sharpBends,
    cornered,
  };
}

/** Estimate the per-sample wobble (noise) of a resampled polyline: the MEDIAN
 *  perpendicular deviation of each interior point from the chord through its ±w
 *  neighbours. On a straight (even if jittery) run this ≈ the jitter amplitude;
 *  a few real corners spike but the median is dominated by edge points, so it's a
 *  robust noise floor. Drives the jitter-scale corner epsilon (it self-adapts to
 *  touchpad roughness instead of guessing from shape size). */
function estimateStrokeNoise(pts: FitPoint[], w: number): number {
  const n = pts.length;
  if (n < 2 * w + 1) return 0;
  const devs: number[] = [];
  for (let i = w; i < n - w; i++) {
    devs.push(pointLineDist(pts[i], pts[i - w], pts[i + w]));
  }
  if (devs.length === 0) return 0;
  devs.sort((a, b) => a - b);
  return devs[Math.floor(devs.length / 2)];
}

// ─── Corner detection: ShortStraw [Wolin '08] cross-checked with RDP ─────────

/** ShortStraw straw-length corner finder, cross-checked against rdpPoints
 *  anchors. Returns INDICES into the resampled polyline. For OPEN strokes the
 *  endpoints (0, n-1) always frame the chain. For CLOSED strokes the straw is
 *  computed CYCLICALLY (the seam often sits ON a corner — the bug that made the
 *  first rect/triangle fit collapse to 2-3 corners), and the endpoints fold
 *  into one corner. RDP contributes corners ShortStraw smears on slow curves;
 *  ShortStraw is gated by RDP corroboration so noise doesn't manufacture
 *  corners. Hybrid per spec §2.3. */
export function detectCorners(sig: SnapSignals): number[] {
  const pts = sig.resampled;
  const n = pts.length;
  if (n < 3) return n === 0 ? [] : [0, n - 1].filter((v, i, a) => a.indexOf(v) === i);
  const closed = sig.snapClosed;

  // JITTER-SCALE RDP: simplify the resampled polyline with a NOISE-scaled epsilon
  // so touchpad wobble collapses to its underlying edges before corner finding.
  // Anchors below come from THIS simplified polyline (snapped to the nearest
  // resampled index), not the raw ε=3.0 RDP, so jitter can't manufacture corners
  // (the rough-square-as-18-corners bug). The straw scan still runs on the full
  // resampled points (its median/threshold logic is jitter-tolerant once the
  // anchor cross-check is clean).
  //
  // Epsilon = max(noise × NOISE_MULT, min(w,h) × MINDIM_RATIO), clamped
  // [FLOOR, CAP]. Noise self-adapts to roughness; the min-dim term is a small
  // size-relative floor. Both stay well below a real corner's chord excursion
  // (~½ an edge), so corners survive even on elongated shapes.
  const eb = bboxOf(pts);
  const minDim = Math.max(1, Math.min(eb.maxX - eb.minX, eb.maxY - eb.minY));
  const noise = estimateStrokeNoise(pts, CORNER_RDP_NOISE_WINDOW);
  const cornerEps = Math.min(
    CORNER_RDP_EPS_CAP,
    Math.max(
      CORNER_RDP_EPS_FLOOR,
      minDim * CORNER_RDP_MINDIM_RATIO,
      noise * CORNER_RDP_NOISE_MULT,
    ),
  );
  // For a closed loop the chord endpoints coincide → rdpPoints' degenerate-chord
  // guard keeps it ≥3 anchors; for open we hand it the polyline as-is.
  const simplified = rdpPoints(pts as unknown as StrokeInputPoint[], cornerEps).map(xy);

  const W = SHORTSTRAW_WINDOW;
  // Straw = chord across ±W. Cyclic for closed loops so the seam corner is
  // seen; clamped (Infinity) at the ends for open strokes (endpoints frame
  // the chain explicitly below).
  const straw: number[] = new Array(n).fill(Infinity);
  if (closed) {
    for (let i = 0; i < n; i++) {
      straw[i] = dist(pts[(i - W + n) % n], pts[(i + W) % n]);
    }
  } else {
    for (let i = W; i < n - W; i++) straw[i] = dist(pts[i - W], pts[i + W]);
  }
  // Median of finite straws.
  const finite = straw.filter((s) => Number.isFinite(s)).sort((a, b) => a - b);
  const median = finite.length ? finite[Math.floor(finite.length / 2)] : 0;
  const threshold = median * SHORTSTRAW_MEDIAN_FACTOR;

  // Local minima below threshold are corner candidates (Wolin's localized
  // search: walk runs of consecutive sub-threshold straws, keep each run's
  // min). For closed loops the scan wraps once around.
  const shortStrawCorners: number[] = [];
  const scanN = closed ? n : n; // both walk [0,n); closed straws are finite everywhere
  let i = 0;
  while (i < scanN) {
    if (Number.isFinite(straw[i]) && straw[i] < threshold) {
      let localMin = i;
      let j = i;
      while (j < scanN && Number.isFinite(straw[j]) && straw[j] < threshold) {
        if (straw[j] < straw[localMin]) localMin = j;
        j++;
      }
      shortStrawCorners.push(localMin);
      i = j;
    } else {
      i++;
    }
  }

  // RDP anchor indices (nearest resampled-point index per JITTER-SCALE-simplified
  // vertex). Using the size-scaled simplification (not raw ε=3.0) is the
  // jitter-robustness fix: a rough edge collapses to its two endpoints, so the
  // cross-check below only corroborates real corners.
  const anchorIdx: number[] = [];
  for (const a of simplified) {
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < n; k++) {
      const d = dist(pts[k], a);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) anchorIdx.push(best);
  }
  // For closed loops, RDP repeats the seam anchor at both 0 and n-1 — fold the
  // n-1 anchor onto 0 so the seam corner is counted once.
  const cyclicIdxClose = (a: number, b: number) => {
    if (!closed) return Math.abs(a - b);
    const d = Math.abs(a - b);
    return Math.min(d, n - d);
  };

  // Cross-check: a ShortStraw corner counts only if an RDP anchor is within
  // CORNER_RDP_INDEX_TOL indices (cyclic for closed loops); kills ShortStraw
  // false positives on noise.
  const corroborated = new Set<number>();
  for (const c of shortStrawCorners) {
    if (anchorIdx.some((a) => cyclicIdxClose(a, c) <= CORNER_RDP_INDEX_TOL)) corroborated.add(c);
  }
  // RDP interior anchors with a genuine turn the straw smeared. For closed
  // loops EVERY anchor is interior (cyclic turn); for open strokes skip the
  // endpoints (they frame the chain).
  for (const a of anchorIdx) {
    if (!closed && (a <= W || a >= n - W)) continue;
    const turn = interiorTurnDeg(pts, a, W, closed);
    if (turn > 30 && ![...corroborated].some((c) => cyclicIdxClose(c, a) <= CORNER_RDP_INDEX_TOL)) {
      corroborated.add(a);
    }
  }

  let corners = [...corroborated].sort((x, y) => x - y);
  // De-dup corners that resample within the window (one true corner), cyclic.
  const merged: number[] = [];
  for (const c of corners) {
    if (merged.length && cyclicIdxClose(c, merged[merged.length - 1]) <= W) continue;
    merged.push(c);
  }
  corners = merged;
  // COLLINEAR / NEAR-STRAIGHT MERGE (bug 1): a "corner" whose interior turn is
  // below COLLINEAR_MERGE_TURN_DEG is a false split on a straight edge — drop it
  // so a clean rect yields exactly 4 corners and a triangle 3 (was reading as
  // Polygon (5/6) when hand-jitter spawned a mid-edge corner). The turn is
  // measured against the ADJACENT corners (the actual edge directions), not a
  // fixed ±W window, so a corner mid-way down a long straight edge is correctly
  // seen as flat. Endpoints of open chains aren't in `corners` yet (added
  // below), so they're never merged. [PaleoSketch merge-collinear / DCR.]
  if (corners.length >= 3) {
    let changed = true;
    while (changed && corners.length >= 3) {
      changed = false;
      // For closed loops every corner has two neighbours (cyclic). For open
      // strokes the true endpoints aren't here yet, so the chain's first/last
      // detected corner only has one interior neighbour — skip those (we can't
      // judge their turn without the framing endpoints, and they're rarely
      // false splits). Walk and drop the flattest sub-threshold corner.
      let flattestIdx = -1;
      let flattestTurn = COLLINEAR_MERGE_TURN_DEG;
      const m = corners.length;
      for (let k = 0; k < m; k++) {
        const isEdgeOpen = !closed && (k === 0 || k === m - 1);
        if (isEdgeOpen) continue;
        const prev = closed ? corners[(k - 1 + m) % m] : corners[k - 1];
        const here = corners[k];
        const next = closed ? corners[(k + 1) % m] : corners[k + 1];
        const turn = cornerTurnDeg(pts, prev, here, next);
        if (turn < flattestTurn) {
          flattestTurn = turn;
          flattestIdx = k;
        }
      }
      if (flattestIdx >= 0) {
        corners.splice(flattestIdx, 1);
        changed = true;
      }
    }
  }
  // Closed: also fold a corner near the seam (index ~0 and ~n) into one.
  if (closed && corners.length >= 2) {
    const lo = corners[0];
    const hi = corners[corners.length - 1];
    if (n - hi + lo <= W) corners.pop();
  }
  // Endpoints frame the chain for OPEN strokes (after merge, so they aren't
  // de-duped away).
  if (!closed) {
    if (corners[0] !== 0) corners.unshift(0);
    if (corners[corners.length - 1] !== n - 1) corners.push(n - 1);
  }
  return corners;
}

/** Turn angle (deg) at corner index `here`, measured from the EDGE arriving
 *  from corner `prev` to the EDGE leaving toward corner `next`. Unlike
 *  interiorTurnDeg this uses the actual neighbouring CORNERS (the real edge
 *  directions), so a corner sitting mid-way along a long straight edge reads as
 *  flat (~0°) — that's what the collinear merge keys on. */
function cornerTurnDeg(pts: FitPoint[], prev: number, here: number, next: number): number {
  const a = pts[prev], b = pts[here], c = pts[next];
  const ax = b[0] - a[0], ay = b[1] - a[1];
  const bx = c[0] - b[0], by = c[1] - b[1];
  const ang = Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);
  return (ang * 180) / Math.PI;
}

function interiorTurnDeg(pts: FitPoint[], i: number, w: number, cyclic = false): number {
  const n = pts.length;
  const a = cyclic ? pts[(i - w + n) % n] : pts[Math.max(0, i - w)];
  const b = pts[i];
  const c = cyclic ? pts[(i + w) % n] : pts[Math.min(n - 1, i + w)];
  const ax = b[0] - a[0], ay = b[1] - a[1];
  const bx = c[0] - b[0], by = c[1] - b[1];
  const ang = Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);
  return (ang * 180) / Math.PI;
}

// ─── Candidate fits ──────────────────────────────────────────────────────────

/** Total-least-squares (PCA) line fit → residuals = perpendicular distance. */
function fitLine(sig: SnapSignals): ShapeCandidate {
  const pts = sig.resampled;
  const a = pts[0];
  const b = pts[pts.length - 1];
  // Endpoints define the line direction; PCA would be marginally tighter but
  // endpoints are what the user's gesture starts/ends at — and what a snapped
  // line should honor. Residual = perpendicular distance to that chord.
  const residuals = pts.map((p) => pointLineDist(p, a, b));
  const normErr = normRms(residuals, sig.bboxDiag);
  return {
    kind: 'line',
    points: [a, b],
    normErr,
    score: 1 - normErr,
    closed: false,
    label: 'Line',
  };
}

/** Corner-chain polyline (Straighten's open fit) — straight segments between
 *  detected corners; residual = each point's distance to its segment. */
function fitPolyline(sig: SnapSignals, corners: number[]): ShapeCandidate {
  const pts = sig.resampled;
  const vertices = corners.map((c) => pts[c]);
  if (vertices.length < 2) return fitLine(sig);
  const residuals: number[] = [];
  for (let s = 0; s + 1 < corners.length; s++) {
    const a = pts[corners[s]];
    const b = pts[corners[s + 1]];
    for (let k = corners[s]; k <= corners[s + 1]; k++) residuals.push(pointSegDist(pts[k], a, b));
  }
  const normErr = normRms(residuals, sig.bboxDiag);
  return {
    kind: 'polyline',
    points: vertices,
    normErr,
    score: 1 - normErr,
    closed: false,
    label: 'Polyline',
  };
}

/** Turn-angle below which a corner is "near-straight" and collapses into its
 *  edge — soft over-segmentation (a hand-drawn 5-gon can yield extra mid-edge
 *  corners). ~15°. [PaleoSketch merge-collinear / DCR]. */
const COLLINEAR_TURN_TOL = 0.26;

/** True SIDE count of a closed corner loop: count only real corners (collapse
 *  near-collinear + duplicate vertices). Fixes Sebs's "5-gon labeled Polygon(8)"
 *  — the label must report the SHAPE's sides, not the raw vertex count. */
export function countTrueSides(loop: FitPoint[]): number {
  const n = loop.length;
  if (n < 3) return n;
  let sides = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n];
    const b = loop[i];
    const c = loop[(i + 1) % n];
    const ux = b[0] - a[0], uy = b[1] - a[1];
    const vx = c[0] - b[0], vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-6 || lv < 1e-6) continue; // duplicate vertex — not a real corner
    const cos = (ux * vx + uy * vy) / (lu * lv);
    const turn = Math.acos(Math.max(-1, Math.min(1, cos))); // 0 = straight
    if (turn > COLLINEAR_TURN_TOL) sides++;
  }
  return Math.max(3, sides);
}

/** Closed corner-chain polygon (Straighten closed) — residual measured to the
 *  closed loop's segments (last vertex → first). */
function fitPolygon(sig: SnapSignals, loopVerts: FitPoint[]): ShapeCandidate | null {
  if (loopVerts.length < 3) return null;
  const pts = sig.resampled;
  const residuals = pts.map((p) => pointToLoopDist(p, loopVerts));
  const normErr = normRms(residuals, sig.bboxDiag);
  return {
    kind: 'polygon',
    points: loopVerts,
    normErr,
    score: 1 - normErr,
    closed: true,
    label: `Polygon (${countTrueSides(loopVerts)})`,
  };
}

function pointToLoopDist(p: FitPoint, loop: FitPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const d = pointSegDist(p, loop[i], loop[(i + 1) % loop.length]);
    if (d < best) best = d;
  }
  return best;
}

/** Triangle: exactly 3 corners. Chip variant: equilateral when sides are
 *  near-equal (the side CV gate). */
function fitTriangle(sig: SnapSignals, loopVerts: FitPoint[]): ShapeCandidate | null {
  if (loopVerts.length !== 3) return null;
  const base = fitPolygon(sig, loopVerts);
  if (!base) return null;
  const sides = [
    dist(loopVerts[0], loopVerts[1]),
    dist(loopVerts[1], loopVerts[2]),
    dist(loopVerts[2], loopVerts[0]),
  ];
  const mean = sides.reduce((a, b) => a + b, 0) / 3;
  const cv = Math.sqrt(sides.reduce((a, s) => a + (s - mean) ** 2, 0) / 3) / Math.max(mean, 1e-6);
  return {
    kind: 'triangle',
    points: loopVerts,
    normErr: base.normErr,
    score: 1 - base.normErr,
    closed: true,
    label: 'Triangle',
    notes: cv <= EQUILATERAL_CV_MAX ? 'equilateral-eligible' : undefined,
  };
}

/** Rect: exactly 4 corners regularized to two perpendicular directions
 *  [Pegasus-style constraint inference, Igarashi '97]. Residual measured to the
 *  regularized axis-fit. Loses to generic polygon when corners aren't square. */
function fitRect(sig: SnapSignals, loopVerts: FitPoint[]): ShapeCandidate | null {
  if (loopVerts.length !== 4) return null;
  // Check corner angles ≈ 90°.
  let maxDev = 0;
  for (let i = 0; i < 4; i++) {
    const prev = loopVerts[(i + 3) % 4];
    const curr = loopVerts[i];
    const next = loopVerts[(i + 1) % 4];
    const ax = prev[0] - curr[0], ay = prev[1] - curr[1];
    const bx = next[0] - curr[0], by = next[1] - curr[1];
    const ang = (Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by) * 180) / Math.PI;
    maxDev = Math.max(maxDev, Math.abs(ang - 90));
  }
  if (maxDev > RECT_ANGLE_TOL_DEG) return null;
  // Regularize: principal axis from a CIRCULAR MEAN over ALL FOUR edge
  // directions mod 90° (was a fragile 2-edge fold that produced a badly tilted
  // axis on ROTATED rects — the diamond that read as Polygon (4), bug 1). Each
  // edge angle is taken mod 90° (a rect's four edges fall into two perpendicular
  // families = one axis mod 90°); to average angles on a circle without
  // wraparound we accumulate the DOUBLED-by-4 angle (period 90° → full 360°),
  // mean the unit vectors, then divide back by 4. [Constraint inference,
  // Igarashi '97; circular statistics.]
  const cx = loopVerts.reduce((a, p) => a + p[0], 0) / 4;
  const cy = loopVerts.reduce((a, p) => a + p[1], 0) / 4;
  let sumSin = 0, sumCos = 0;
  for (let i = 0; i < 4; i++) {
    const a = loopVerts[i];
    const b = loopVerts[(i + 1) % 4];
    const theta = Math.atan2(b[1] - a[1], b[0] - a[0]); // edge direction
    sumSin += Math.sin(4 * theta);
    sumCos += Math.cos(4 * theta);
  }
  const axis = Math.atan2(sumSin, sumCos) / 4; // principal axis mod 90°
  const ux = Math.cos(axis), uy = Math.sin(axis);
  const vx = -uy, vy = ux;
  // Half-extents = MEAN |projection| of the 4 corners onto each axis. For a true
  // rect every corner projects to exactly (±halfU, ±halfV), so the mean recovers
  // the half-extent exactly. (max over-inflated the rect on ROTATED inputs — a
  // 45° diamond's corners each project onto BOTH axes, so max grabbed a diagonal
  // and built a rect larger than the drawn shape — the residual blew up and the
  // template lost to polygon, bug 1.)
  let halfU = 0, halfV = 0;
  for (const p of loopVerts) {
    halfU += Math.abs((p[0] - cx) * ux + (p[1] - cy) * uy);
    halfV += Math.abs((p[0] - cx) * vx + (p[1] - cy) * vy);
  }
  halfU /= 4;
  halfV /= 4;
  const corners: FitPoint[] = [
    [cx + ux * halfU + vx * halfV, cy + uy * halfU + vy * halfV],
    [cx - ux * halfU + vx * halfV, cy - uy * halfU + vy * halfV],
    [cx - ux * halfU - vx * halfV, cy - uy * halfU - vy * halfV],
    [cx + ux * halfU - vx * halfV, cy + uy * halfU - vy * halfV],
  ];
  const residuals = sig.resampled.map((p) => pointToLoopDist(p, corners));
  const normErr = normRms(residuals, sig.bboxDiag);
  const ratio = Math.max(halfU, halfV) / Math.max(Math.min(halfU, halfV), 1e-6);
  return {
    kind: 'rect',
    points: corners,
    normErr,
    score: 1 - normErr,
    closed: true,
    label: 'Rectangle',
    notes: ratio <= SQUARE_ASPECT_TOL ? 'square-eligible' : undefined,
  };
}

/** Andrew's monotone-chain convex hull (CCW, no repeated last point). Pure. */
function convexHull(points: FitPoint[]): FitPoint[] {
  const pts = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (pts.length < 3) return pts;
  const cross = (o: FitPoint, a: FitPoint, b: FitPoint) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: FitPoint[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: FitPoint[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** ROBUST RECT via the MINIMUM-AREA bounding rectangle (rotating calipers on the
 *  convex hull) — independent of the noisy corner picks, so a rough/sparse closed
 *  stroke that over-segments still recovers its rectangle (the rough-wide-rect
 *  that read Star/Polygon because the corner-based fitRect's 4-vertex gate never
 *  fired). The min-area rect of a near-rectangular point cloud IS that rectangle;
 *  the residual-vs-bbox gate downstream rejects it for genuinely non-rect shapes
 *  (a circle's min-area rect has huge RMS). [Toussaint '83 rotating calipers.] */
function fitRectMinArea(sig: SnapSignals): ShapeCandidate | null {
  const pts = sig.resampled;
  if (pts.length < 5) return null;
  const hull = convexHull(pts);
  if (hull.length < 3) return null;
  let best: { area: number; corners: FitPoint[] } | null = null;
  const h = hull.length;
  for (let i = 0; i < h; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % h];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const elen = Math.hypot(ex, ey);
    if (elen < 1e-9) continue;
    const ux = ex / elen, uy = ey / elen; // edge direction
    const vx = -uy, vy = ux; // perpendicular
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const pu = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
      const pv = (p[0] - a[0]) * vx + (p[1] - a[1]) * vy;
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (best === null || area < best.area) {
      const c0: FitPoint = [a[0] + ux * minU + vx * minV, a[1] + uy * minU + vy * minV];
      const c1: FitPoint = [a[0] + ux * maxU + vx * minV, a[1] + uy * maxU + vy * minV];
      const c2: FitPoint = [a[0] + ux * maxU + vx * maxV, a[1] + uy * maxU + vy * maxV];
      const c3: FitPoint = [a[0] + ux * minU + vx * maxV, a[1] + uy * minU + vy * maxV];
      best = { area, corners: [c0, c1, c2, c3] };
    }
  }
  if (!best) return null;
  const corners = best.corners;
  const residuals = pts.map((p) => pointToLoopDist(p, corners));
  const normErr = normRms(residuals, sig.bboxDiag);
  const w = dist(corners[0], corners[1]);
  const hgt = dist(corners[1], corners[2]);
  const ratio = Math.max(w, hgt) / Math.max(Math.min(w, hgt), 1e-6);
  return {
    kind: 'rect',
    points: corners,
    normErr,
    score: 1 - normErr,
    closed: true,
    label: 'Rectangle',
    notes: ratio <= SQUARE_ASPECT_TOL ? 'square-eligible' : undefined,
  };
}

/** STAR — a simple (non-self-intersecting) star OUTLINE is a concave 2p-gon
 *  whose vertices ALTERNATE convex tip / concave notch. That alternation is the
 *  robust discriminant — NOT total turning (a drawn star outline winds just once,
 *  |turnSum| ≈ 2π, same as any simple loop; the self-intersecting {p/q}
 *  turning-number only applies to a pentagram drawn as crossing lines, which our
 *  closure/corner pipeline never yields). We read the closed corner loop:
 *  require 2p corners (p = STAR_MIN_POINTS..STAR_MAX_POINTS), a near-even split
 *  of convex/concave vertices (≥ STAR_MIN_CONCAVE_FRAC concave), and a high
 *  sign-flip count around the loop (true alternation, not a lumpy blob). The
 *  concave vertices are the star's notches; a convex polygon has ZERO, cleanly
 *  separating star from triangle/rect/polygon. Residual = points-to-loop on the
 *  drawn vertices (no template regularization — drawn proportions kept; the
 *  chip's "Star" label is the win). [Star-polygon vertex theory; convex/concave
 *  vertex classification by cross-product sign.] */
function fitStar(sig: SnapSignals, loopVerts: FitPoint[]): ShapeCandidate | null {
  const m = loopVerts.length;
  // A p-point star outline has exactly 2p corners. Accept the even counts in
  // range (and 2p±1 slop in case the seam folds one corner).
  if (m < STAR_MIN_POINTS * 2 - 1 || m > STAR_MAX_POINTS * 2) return null;
  // Winding sign from total turning (the outline loops once — sign is stable).
  const winding = Math.sign(sig.turnSum) || 1;
  let concave = 0;
  let convex = 0;
  let signFlips = 0;
  let prevSign = 0;
  for (let i = 0; i < m; i++) {
    const a = loopVerts[(i - 1 + m) % m];
    const b = loopVerts[i];
    const c = loopVerts[(i + 1) % m];
    const ax = b[0] - a[0], ay = b[1] - a[1];
    const bx = c[0] - b[0], by = c[1] - b[1];
    const cross = ax * by - ay * bx;
    const s = Math.sign(cross);
    // A vertex turning OPPOSITE the overall winding is concave (a star's inner
    // notch); turning WITH the winding is a convex tip.
    if (s !== 0 && s !== winding) concave++;
    else if (s === winding) convex++;
    if (s !== 0) {
      if (prevSign !== 0 && s !== prevSign) signFlips++;
      prevSign = s;
    }
  }
  const concaveFrac = concave / m;
  // A star needs real notches AND real tips, in near-balance, and a high flip
  // count (true alternation). A convex polygon has concave = 0 → rejected here.
  if (concaveFrac < STAR_MIN_CONCAVE_FRAC) return null;
  if (convex < STAR_MIN_POINTS - 1) return null;
  // Alternation: ≥ (2p − 2) sign flips means the tip/notch pattern truly
  // alternates (a 5-point star has 10 vertices → 10 flips around the loop, 9 if
  // the seam doesn't flip). Floor at STAR_MIN_POINTS × 2 − 2.
  if (signFlips < STAR_MIN_POINTS * 2 - 2) return null;
  // RADIAL-SWING gate (SA-corner-robustness): a TRUE star's tips sit far from the
  // centroid and its notches sit near, so the per-vertex radius swings hard; a
  // jittery convex quad (a rough rectangle) has alternating convex/concave bumps
  // from NOISE whose radii barely swing — that's what false-read a rough wide rect
  // as a Star. Require the radial range (max−min)/max to clear a floor so shallow
  // jitter alternation is rejected. [Star vs lumpy-blob discriminator.]
  let rcx = 0, rcy = 0;
  for (const v of loopVerts) { rcx += v[0]; rcy += v[1]; }
  rcx /= m; rcy /= m;
  let rMin = Infinity, rMax = 0;
  for (const v of loopVerts) {
    const r = Math.hypot(v[0] - rcx, v[1] - rcy);
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
  }
  const radialSwing = rMax > 1e-6 ? (rMax - rMin) / rMax : 0;
  if (radialSwing < STAR_MIN_RADIAL_SWING) return null;
  // NOTCH-DEPTH gate (the decisive star discriminant): a TRUE star's concave
  // notches sit DEEP inside its convex hull; a rough square/circle's "concave"
  // vertices are shallow JITTER bumps within a px or two of the hull edge. Require
  // the MEDIAN concave-vertex depth-below-hull to exceed STAR_MIN_NOTCH_DEPTH_FRAC
  // of the bbox diagonal — this is what stops heavy jitter on a square/triangle
  // from masquerading as a star. (A vertex's "depth" = how far inside the hull it
  // lies = the convex-hull turn would be 0 for a hull point; we measure distance
  // from each concave vertex to the hull boundary.)
  const hull = convexHull(loopVerts);
  if (hull.length >= 3) {
    const depths: number[] = [];
    for (let i = 0; i < m; i++) {
      const a = loopVerts[(i - 1 + m) % m];
      const b = loopVerts[i];
      const c = loopVerts[(i + 1) % m];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const sgn = Math.sign(cr);
      if (sgn !== 0 && sgn !== winding) {
        // concave vertex → distance to the hull boundary (how deep the notch is)
        let d = Infinity;
        for (let j = 0; j < hull.length; j++) {
          d = Math.min(d, pointSegDist(b, hull[j], hull[(j + 1) % hull.length]));
        }
        depths.push(d);
      }
    }
    if (depths.length === 0) return null;
    depths.sort((x, y) => x - y);
    const medDepth = depths[Math.floor(depths.length / 2)];
    if (medDepth < sig.bboxDiag * STAR_MIN_NOTCH_DEPTH_FRAC) return null;
  }
  const base = fitPolygon(sig, loopVerts);
  if (!base) return null;
  const pointCount = Math.round(m / 2);
  return {
    kind: 'star',
    points: loopVerts,
    normErr: base.normErr,
    score: 1 - base.normErr,
    closed: true,
    label: 'Star',
    notes: `points=${pointCount} concave=${concave} convex=${convex} flips=${signFlips}`,
  };
}

/** ARROW — geometry-based shaft + V-head decomposition (the standard sketch-
 *  recognition arrow read). An arrow is an OPEN corner-chain: one DOMINANT shaft
 *  segment, then 1-2 short segments that fold back as the head. We test the
 *  trailing end (the natural draw order: shaft first, head last) AND the leading
 *  end (head-first draw), and keep whichever decomposes. The shaft must be
 *  ≥ ARROW_SHAFT_HEAD_RATIO × the mean head-segment length, and each head barb
 *  must diverge ≥ ARROW_HEAD_MIN_TURN_DEG from the shaft direction. The emitted
 *  geometry KEEPS the drawn shaft + barbs (no symmetric template — proportions
 *  honored, like polyline). */
function fitArrow(sig: SnapSignals, corners: number[]): ShapeCandidate | null {
  const m = corners.length;
  if (m < ARROW_MIN_CORNERS || m > ARROW_MAX_CORNERS) return null;
  const pts = sig.resampled;
  const verts = corners.map((c) => pts[c]);
  // Segment lengths + unit directions along the open chain.
  const segLen: number[] = [];
  const segDir: FitPoint[] = [];
  for (let i = 0; i + 1 < verts.length; i++) {
    const dx = verts[i + 1][0] - verts[i][0];
    const dy = verts[i + 1][1] - verts[i][1];
    const l = Math.hypot(dx, dy) || 1;
    segLen.push(l);
    segDir.push([dx / l, dy / l]);
  }
  const nSeg = segLen.length;
  if (nSeg < 3) return null;

  // Try both orientations: head at the END (shaft = leading segments) and head
  // at the START (shaft = trailing segments). Pick the better-scoring valid one.
  const tryDecomp = (headAtEnd: boolean): ShapeCandidate | null => {
    // Head = the last 2 segments (end) or first 2 (start). The barbs are the
    // head endpoints relative to the tip (shaft/head junction).
    const headSegIdx = headAtEnd ? [nSeg - 2, nSeg - 1] : [0, 1];
    const shaftSegIdx: number[] = [];
    for (let i = 0; i < nSeg; i++) if (!headSegIdx.includes(i)) shaftSegIdx.push(i);
    if (shaftSegIdx.length < 1) return null;

    // THE SHAFT IS ONE DOMINANT STRAIGHT RUN. (1) Its segments must be nearly
    // collinear — consecutive shaft directions agree within the merge tolerance
    // (a zigzag's "shaft" bends hard → rejected). (2) The total shaft length
    // must dominate the LONGEST single barb segment by ARROW_SHAFT_HEAD_RATIO
    // (a zigzag's segments are all ~equal → no dominance → rejected).
    for (let k = 1; k < shaftSegIdx.length; k++) {
      const a = segDir[shaftSegIdx[k - 1]];
      const b = segDir[shaftSegIdx[k]];
      const cos = a[0] * b[0] + a[1] * b[1];
      const turnDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      if (turnDeg > COLLINEAR_MERGE_TURN_DEG * 1.6) return null; // shaft bends → not an arrow
    }
    const shaftLen = shaftSegIdx.reduce((a, i) => a + segLen[i], 0);
    const longestBarb = Math.max(...headSegIdx.map((i) => segLen[i]));
    if (longestBarb < 1e-6) return null;
    if (shaftLen < ARROW_SHAFT_HEAD_RATIO * longestBarb) return null;
    // Tip = shaft/head junction vertex; shaft direction = junction − shaft start.
    const tipIdx = headAtEnd ? nSeg - 2 : 2;
    const tip = verts[tipIdx];
    const shaftStart = headAtEnd ? verts[0] : verts[verts.length - 1];
    const sx = tip[0] - shaftStart[0], sy = tip[1] - shaftStart[1];
    const sl = Math.hypot(sx, sy) || 1;
    // Both head endpoints (the two barb tips) must fold BACK from the shaft.
    const barbEnds = headAtEnd ? [verts[nSeg - 1], verts[nSeg]] : [verts[1], verts[0]];
    let barbsOk = true;
    let minBarbTurn = Infinity;
    for (const end of barbEnds) {
      const bx = end[0] - tip[0], by = end[1] - tip[1];
      const bl = Math.hypot(bx, by) || 1;
      const cosA = (sx * bx + sy * by) / (sl * bl);
      const turnDeg = (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180) / Math.PI;
      // The incoming shaft heads toward the tip; a real barb leaves the tip
      // folding back (the barb–shaft angle is large → foldDeg large). Both barbs
      // must fold, and they should sit on OPPOSITE sides (a V), which the
      // residual + the two-barb requirement together enforce.
      const foldDeg = 180 - turnDeg;
      if (foldDeg < ARROW_HEAD_MIN_TURN_DEG) barbsOk = false;
      minBarbTurn = Math.min(minBarbTurn, foldDeg);
    }
    if (!barbsOk) return null;
    // The two barbs must straddle the shaft (one each side) — a V-head, not two
    // barbs on the same side (which would be a hook/zigzag). Cross-products of
    // the shaft direction with each barb direction must have OPPOSITE signs.
    const cross = (ex: number, ey: number) => sx * ey - sy * ex;
    const b0 = barbEnds[0], b1 = barbEnds[1];
    const c0 = cross(b0[0] - tip[0], b0[1] - tip[1]);
    const c1 = cross(b1[0] - tip[0], b1[1] - tip[1]);
    if (Math.sign(c0) === Math.sign(c1)) return null;
    // Residual: points to the open shaft+head chain (kept geometry).
    const residuals: number[] = [];
    for (let s = 0; s + 1 < corners.length; s++) {
      const a = pts[corners[s]];
      const b = pts[corners[s + 1]];
      for (let k = corners[s]; k <= corners[s + 1]; k++) residuals.push(pointSegDist(pts[k], a, b));
    }
    const normErr = normRms(residuals, sig.bboxDiag);
    return {
      kind: 'arrow',
      points: verts,
      normErr,
      score: 1 - normErr,
      closed: false,
      label: 'Arrow',
      notes: `shaft/barb=${(shaftLen / longestBarb).toFixed(2)} barbTurn=${minBarbTurn.toFixed(0)}`,
    };
  };

  const end = tryDecomp(true);
  const start = tryDecomp(false);
  if (end && start) return end.normErr <= start.normErr ? end : start;
  return end || start;
}

/** Taubin algebraic circle fit [Chernov, CircleFitByTaubin]. Gradient-weighted,
 *  so it stays UNBIASED on a partial / slightly-open arc where Kåsa pulls the
 *  centre inward and under-closes the snapped circle (Sebs 2026-06-19). Residual
 *  = RMS radial deviation ÷ radius, ÷ bboxDiag-normalized for ranking parity. */
function fitCircle(sig: SnapSignals): ShapeCandidate | null {
  const pts = sig.resampled;
  if (pts.length < 5) return null;
  const n = pts.length;
  // Centre on the centroid for conditioning, then accumulate the moments Taubin
  // needs (everything in centred coords u=x-mx, v=y-my, z=u²+v²).
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let Mxx = 0, Myy = 0, Mxy = 0, Mxz = 0, Myz = 0, Mzz = 0;
  for (const [x, y] of pts) {
    const u = x - mx, v = y - my;
    const z = u * u + v * v;
    Mxx += u * u; Myy += v * v; Mxy += u * v;
    Mxz += u * z; Myz += v * z; Mzz += z * z;
  }
  Mxx /= n; Myy /= n; Mxy /= n; Mxz /= n; Myz /= n; Mzz /= n;
  const Mz = Mxx + Myy;
  const CovXy = Mxx * Myy - Mxy * Mxy;
  const VarZ = Mzz - Mz * Mz;
  // Characteristic quartic coefficients; Newton from 0 finds its smallest root.
  const A3 = 4 * Mz;
  const A2 = -3 * Mz * Mz - Mzz;
  const A1 = VarZ * Mz + 4 * CovXy * Mz - Mxz * Mxz - Myz * Myz;
  const A0 = Mxz * (Mxz * Myy - Myz * Mxy) + Myz * (Myz * Mxx - Mxz * Mxy) - VarZ * CovXy;
  const A22 = A2 + A2;
  const A33 = A3 + A3 + A3;
  let xx = 0, yy = A0;
  for (let iter = 0; iter < 99; iter++) {
    const Dy = A1 + xx * (A22 + A33 * xx);
    if (Dy === 0) break;
    const xnew = xx - yy / Dy;
    if (xnew === xx || !Number.isFinite(xnew)) break;
    const ynew = A0 + xnew * (A1 + xnew * (A2 + xnew * A3));
    if (Math.abs(ynew) >= Math.abs(yy)) break;
    xx = xnew; yy = ynew;
  }
  const DET = xx * xx - xx * Mz + CovXy;
  if (!(Math.abs(DET) > 1e-12)) return null;
  const ucx = (Mxz * (Myy - xx) - Myz * Mxy) / DET / 2;
  const ucy = (Myz * (Mxx - xx) - Mxz * Mxy) / DET / 2;
  const cx = ucx + mx;
  const cy = ucy + my;
  const r2 = ucx * ucx + ucy * ucy + Mz;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  // Geometric corroboration [PaleoSketch]: a closed round form turns ≈ 2π. Accept
  // EITHER the per-sample turnSum OR the wobble-robust centroid winding near 2π
  // (MED-1: an ultra-wobbly circle's per-sample turnSum is corrupted into noise,
  // but it still winds ≈ ±2π around its centre — that rescues the round read the
  // turnSum-only gate was rejecting outright).
  const turnOk =
    Math.abs(Math.abs(sig.turnSum) - 2 * Math.PI) < ROUND_TURNSUM_TOL ||
    Math.abs(Math.abs(sig.windingSum) - 2 * Math.PI) < ROUND_TURNSUM_TOL;
  if (!turnOk) return null;
  const residuals = pts.map((p) => Math.abs(dist(p, [cx, cy]) - r));
  const normErr = normRms(residuals, sig.bboxDiag);
  // Emit the circle as a dense polygon (the caller renders it through the pen;
  // 48 segments stay Catmull-Rom-smooth downstream).
  const polyPts = circlePoints(cx, cy, r, r, 0, 48);
  return {
    kind: 'circle',
    points: polyPts,
    normErr,
    score: 1 - normErr,
    closed: true,
    label: 'Circle',
    notes: `r=${r.toFixed(1)}`,
  };
}

/** Direct least-squares ellipse fit [Fitzgibbon-Pilu-Fisher '99], simplified
 *  to the algebraic conic + an approximate radial residual. Cedes rank to
 *  circle when bbox aspect ≤ CIRCLE_PREFERENCE_ASPECT. */
function fitEllipse(sig: SnapSignals): ShapeCandidate | null {
  const pts = sig.resampled;
  if (pts.length < 6) return null;
  // Same wobble-robust round corroboration as fitCircle (turnSum OR centroid
  // winding near 2π) — MED-1.
  const turnOk =
    Math.abs(Math.abs(sig.turnSum) - 2 * Math.PI) < ROUND_TURNSUM_TOL ||
    Math.abs(Math.abs(sig.windingSum) - 2 * Math.PI) < ROUND_TURNSUM_TOL;
  if (!turnOk) return null;
  const conic = fitConicEllipse(pts);
  if (!conic) return null;
  const { cx, cy, rx, ry, theta } = conic;
  if (!(rx > 0) || !(ry > 0)) return null;
  // Approximate radial residual: for each point, distance to the nearest point
  // on a 64-sample ellipse outline (cheap + robust vs the exact conic dist).
  const outline = circlePoints(cx, cy, rx, ry, theta, 64);
  const residuals = pts.map((p) => pointToLoopDist(p, outline));
  const normErr = normRms(residuals, sig.bboxDiag);
  return {
    kind: 'ellipse',
    points: circlePoints(cx, cy, rx, ry, theta, 64),
    normErr,
    score: 1 - normErr,
    closed: true,
    label: 'Ellipse',
    notes: `rx=${rx.toFixed(1)} ry=${ry.toFixed(1)}`,
  };
}

function circlePoints(cx: number, cy: number, rx: number, ry: number, theta: number, n: number): FitPoint[] {
  const out: FitPoint[] = [];
  const c = Math.cos(theta), s = Math.sin(theta);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const ex = rx * Math.cos(a);
    const ey = ry * Math.sin(a);
    out.push([cx + ex * c - ey * s, cy + ex * s + ey * c]);
  }
  return out;
}

// ─── Tiny linear algebra (pure, no deps) ─────────────────────────────────────

/** Gaussian elimination for a 3×3 system. Returns null when singular. */
function solve3(A: number[][], b: number[]): number[] | null {
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= 3; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** Ellipse via second-moment (covariance) fit on the boundary points — a
 *  stable, dependency-free stand-in for the full Fitzgibbon generalized
 *  eigenproblem. Centroid + principal axes from the point covariance; radii
 *  scaled so the fit ellipse area ≈ the point cloud's spread (2× std along each
 *  axis). Good enough for snap (the residual gate rejects bad reads anyway). */
function fitConicEllipse(
  pts: FitPoint[],
): { cx: number; cy: number; rx: number; ry: number; theta: number } | null {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (const [x, y] of pts) {
    const dx = x - mx, dy = y - my;
    cxx += dx * dx; cyy += dy * dy; cxy += dx * dy;
  }
  cxx /= n; cyy /= n; cxy /= n;
  // Eigen-decomposition of the 2×2 symmetric covariance.
  const tr = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, (tr / 2) ** 2 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  if (!(l1 > 0) || !(l2 > 0)) return null;
  const theta = Math.abs(cxy) < 1e-9 && cxx >= cyy ? 0 : Math.atan2(l1 - cxx, cxy);
  // Radii: project all points onto each principal axis, take max |projection|
  // (the actual extent the user drew, not a statistical estimate).
  const ux = Math.cos(theta), uy = Math.sin(theta);
  const vx = -uy, vy = ux;
  let rx = 0, ry = 0;
  for (const [x, y] of pts) {
    rx = Math.max(rx, Math.abs((x - mx) * ux + (y - my) * uy));
    ry = Math.max(ry, Math.abs((x - mx) * vx + (y - my) * vy));
  }
  return { cx: mx, cy: my, rx, ry, theta };
}

// ─── THE engine ──────────────────────────────────────────────────────────────

/** DOMINANT-CORNER loop (SA-corner-robustness): a rough/sparse closed stroke can
 *  leave the collinear-merge with a few corners ABOVE the template count — a
 *  rough triangle as 5 corners, a very-rough square as 6 — because the residual
 *  jitter corners turn just past COLLINEAR_MERGE_TURN_DEG. Rather than over-tune
 *  the merge (and risk eating a real pentagon vertex), we let the rect/triangle
 *  templates ALSO try the K SHARPEST-turn corners (the dominant vertices), in
 *  cyclic order. The template's own geometric gate (right-angle for rect, the
 *  residual-vs-bbox error for all) rejects the hypothesis if those K corners
 *  don't actually form the shape — so this only ever HELPS a genuine K-gon, never
 *  forces one. [PaleoSketch / $N: enumerate the low-vertex polygon hypotheses.] */
function dominantLoopVertices(sig: SnapSignals, corners: number[], k: number): FitPoint[] | null {
  const pts = sig.resampled;
  if (corners.length <= k) return null; // the full loop already has ≤k corners
  const n = pts.length;
  const m = corners.length;
  // Score each corner by its cyclic turn against its corner-neighbours.
  const scored = corners.map((c, i) => {
    const prev = corners[(i - 1 + m) % m];
    const next = corners[(i + 1) % m];
    return { c, turn: cornerTurnDeg(pts, prev, c, next) };
  });
  // Greedily pick the SHARPEST corners that are also well SPREAD around the loop:
  // a real k-gon's vertices sit ~loop/k apart, so two jitter bumps on the same
  // edge must not both be picked (that's what made fitRect's 90° gate reject the
  // dominant-4 on a very-rough square). Require each pick to be at least
  // (loop circumference / k) × SPREAD_FRAC of arc away from every prior pick.
  const order = scored.slice().sort((a, b) => b.turn - a.turn);
  const minSep = (n / k) * DOMINANT_CORNER_SPREAD_FRAC;
  const cyclicSep = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, n - d);
  };
  const picked: number[] = [];
  for (const { c } of order) {
    if (picked.length >= k) break;
    if (picked.every((p) => cyclicSep(p, c) >= minSep)) picked.push(c);
  }
  // If the spread constraint starved the pick (very few corners), fall back to the
  // k sharpest regardless of spread.
  if (picked.length < k) {
    for (const { c } of order) {
      if (picked.length >= k) break;
      if (!picked.includes(c)) picked.push(c);
    }
  }
  if (picked.length !== k) return null;
  picked.sort((a, b) => a - b);
  return picked.map((c) => pts[c]);
}

/** REGULAR-POLYGON RECOVERY (MED-2 robustness): a SECOND, finer-epsilon corner
 *  pass that recovers soft n-gon vertices the primary pipeline smeared, then a
 *  hard regularity gate (equal edges + consistent convex turning). Returns the
 *  recovered loop vertices only when the stroke really is a regular 5-8-gon; else
 *  null. Purely additive — the caller offers fitPolygon on these as an EXTRA
 *  candidate. Never disturbs the primary corner pipeline or the shipped reads. */
function regularPolygonHypothesis(sig: SnapSignals): FitPoint[] | null {
  const pts = sig.resampled;
  const n = pts.length;
  if (n < 8 || !sig.snapClosed) return null;
  // Finer cyclic epsilon than the primary pipeline (recovers soft vertices).
  const eb = bboxOf(pts);
  const minDim = Math.max(1, Math.min(eb.maxX - eb.minX, eb.maxY - eb.minY));
  const eps = Math.max(NGON_RECOVERY_EPS_FLOOR, minDim * NGON_RECOVERY_MINDIM_RATIO);
  const simplified = rdpPoints(pts as unknown as StrokeInputPoint[], eps).map(xy);
  // Map simplified vertices to nearest resampled indices, dedupe the seam.
  const idxs: number[] = [];
  for (const a of simplified) {
    let best = -1, bestD = Infinity;
    for (let k = 0; k < n; k++) { const d = dist(pts[k], a); if (d < bestD) { bestD = d; best = k; } }
    if (best >= 0 && !idxs.includes(best)) idxs.push(best);
  }
  idxs.sort((a, b) => a - b);
  // Collapse a seam-duplicated first/last vertex (closed loop).
  if (idxs.length >= 2 && dist(pts[idxs[0]], pts[idxs[idxs.length - 1]]) < INTENT_RESAMPLE_SPACING_PX * 2) {
    idxs.pop();
  }
  // Merge any near-straight (collinear) corner so soft over-segmentation collapses
  // to the true vertex count — same DCR merge as the primary pipeline, cyclic.
  let loop = idxs.slice();
  let changed = true;
  while (changed && loop.length > NGON_RECOVERY_MIN_VERTS) {
    changed = false;
    const m = loop.length;
    let flatIdx = -1, flatTurn = COLLINEAR_MERGE_TURN_DEG;
    for (let k = 0; k < m; k++) {
      const turn = cornerTurnDeg(pts, loop[(k - 1 + m) % m], loop[k], loop[(k + 1) % m]);
      if (turn < flatTurn) { flatTurn = turn; flatIdx = k; }
    }
    if (flatIdx >= 0) { loop.splice(flatIdx, 1); changed = true; }
  }
  const m = loop.length;
  if (m < NGON_RECOVERY_MIN_VERTS || m > NGON_RECOVERY_MAX_VERTS) return null;
  const verts = loop.map((c) => pts[c]);
  // REGULARITY GATE — equal edges + consistent convex turning.
  const edges: number[] = [];
  for (let i = 0; i < m; i++) edges.push(dist(verts[i], verts[(i + 1) % m]));
  const meanEdge = edges.reduce((a, b) => a + b, 0) / m;
  if (meanEdge < 1e-6) return null;
  const edgeCv = Math.sqrt(edges.reduce((a, e) => a + (e - meanEdge) ** 2, 0) / m) / meanEdge;
  if (edgeCv > NGON_EDGE_CV_MAX) return null;
  const winding = Math.sign(sig.turnSum) || 1;
  let convex = 0;
  for (let i = 0; i < m; i++) {
    const a = verts[(i - 1 + m) % m], b = verts[i], c = verts[(i + 1) % m];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.sign(cross) === winding) convex++;
  }
  if (convex / m < NGON_CONVEX_FRAC_MIN) return null; // a star / lumpy blob has concave notches
  return verts;
}

/** Build the loop vertices for a closed/treated-as-closed stroke's corner
 *  chain (drops the duplicate endpoint, since the loop closes implicitly). */
function closedLoopVertices(sig: SnapSignals, corners: number[]): FitPoint[] {
  const pts = sig.resampled;
  let idxs = corners.slice();
  // For a closed stroke the endpoints (0 and n-1) are nearly the same point —
  // collapse them so the loop doesn't carry a doubled vertex.
  if (idxs.length >= 2) {
    const first = pts[idxs[0]];
    const last = pts[idxs[idxs.length - 1]];
    // D4: collapse a doubled/OVERSHOT seam vertex with a PROPORTIONAL tolerance
    // (was a fixed 8px) so a larger overshoot near the start folds into the first
    // vertex instead of surviving as a visible tail past the closing edge.
    const seamTol = Math.max(INTENT_RESAMPLE_SPACING_PX * 2, 0.04 * sig.bboxDiag);
    if (dist(first, last) < seamTol) idxs = idxs.slice(0, -1);
  }
  return idxs.map((c) => pts[c]);
}

/** Fit a stroke. `action` selects the candidate set:
 *   - 'snap'        all candidates (templates + corner chains)
 *   - 'straighten'  {line, polyline, polygon} only — no template regularization
 *  Returns a ranked candidate list ('original' always last) + accept/refuse. */
export function fitStroke(raw: StrokeInputPoint[], action: SnapAction = 'snap'): ShapeFitResult {
  const sig = computeSignals(raw);
  const baseDiag = {
    closure: sig.closure,
    bboxDiag: sig.bboxDiag,
    resampledCount: sig.resampled.length,
    cornerCount: 0,
    reversalFreq: sig.reversalFreq,
    selfIsectDensity: sig.selfIsectDensity,
    turnSum: sig.turnSum,
    bboxAspect: sig.bboxAspect,
  };

  const originalCandidate: ShapeCandidate = {
    kind: 'original',
    points: sig.resampled.length ? sig.resampled : raw.map(xy),
    normErr: 0,
    score: -1, // always ranks last among accepted; chip appends it explicitly
    closed: sig.closure !== 'open',
    label: 'Original',
  };

  // Degenerate / refusal gates (Sebs's law: never force a fit).
  if (raw.length < 2 || sig.resampled.length < 2) {
    return {
      action,
      accepted: false,
      candidates: [originalCandidate],
      refusedReason: 'too-few-points',
      diag: baseDiag,
    };
  }
  if (sig.bboxDiag < SNAP_MIN_BBOX_DIAG) {
    return {
      action,
      accepted: false,
      candidates: [originalCandidate],
      refusedReason: 'below-dot-floor',
      diag: baseDiag,
    };
  }

  const corners = detectCorners(sig);
  baseDiag.cornerCount = corners.length;

  // Scribble gate — REUSE markIntent's energy constants. A scribble is tone
  // intent, not a shape; Snap refuses. Straighten refuses only on corner-count
  // explosion (a genuine zigzag with few corners IS straightenable).
  const scribbleEnergy =
    sig.reversalFreq >= SCRIBBLE_REVERSAL_FREQ || sig.selfIsectDensity >= SCRIBBLE_SELF_ISECT;
  if (action === 'snap' && scribbleEnergy) {
    return {
      action,
      accepted: false,
      candidates: [originalCandidate],
      refusedReason: 'scribble-energy',
      diag: baseDiag,
    };
  }
  if (action === 'straighten' && (corners.length > STRAIGHTEN_MAX_CORNERS || scribbleEnergy)) {
    return {
      action,
      accepted: false,
      candidates: [originalCandidate],
      refusedReason: corners.length > STRAIGHTEN_MAX_CORNERS ? 'too-many-corners' : 'scribble-energy',
      diag: baseDiag,
    };
  }

  // Candidate family is driven by the FORGIVING snap closure (explicit act), not
  // the conservative shared closureStateOf — so a rough lifted-pen square/circle
  // still gets the closed templates. diag.closure keeps the honest value.
  const open = !sig.snapClosed;
  const candidates: ShapeCandidate[] = [];

  if (action === 'straighten') {
    // Corner-chain fits only, drawn proportions kept.
    if (open) {
      candidates.push(fitLine(sig));
      candidates.push(fitPolyline(sig, corners));
    } else {
      const loop = closedLoopVertices(sig, corners);
      const poly = fitPolygon(sig, loop);
      if (poly) candidates.push(poly);
      // A closed stroke can still straighten to a line if it's actually flat
      // (a barely-closed scrawl) — but only offer it; the loop usually wins.
      candidates.push({ ...fitLine(sig), label: 'Line' });
    }
  } else {
    // Snap — the full template set per closure family.
    if (open) {
      candidates.push(fitLine(sig));
      candidates.push(fitPolyline(sig, corners));
      // Arrow = open shaft + V-head decomposition (more primitives — bug 2).
      const arrow = fitArrow(sig, corners);
      if (arrow) candidates.push(arrow);
    } else {
      const loop = closedLoopVertices(sig, corners);
      // Templates try the full corner loop AND (when there are extra corners)
      // the dominant top-3/top-4 corner loops, so a rough K+1/K+2-corner stroke
      // still recovers its triangle/rect. Keep the lowest-error fit of each kind.
      const triLoop3 = dominantLoopVertices(sig, corners, 3);
      const rectLoop4 = dominantLoopVertices(sig, corners, 4);
      const bestOf = (
        a: ShapeCandidate | null,
        b: ShapeCandidate | null,
      ): ShapeCandidate | null => {
        if (!a) return b;
        if (!b) return a;
        return b.normErr < a.normErr ? b : a;
      };
      const tri = bestOf(fitTriangle(sig, loop), triLoop3 ? fitTriangle(sig, triLoop3) : null);
      // Rect: best of corner-loop fit, dominant-4 fit, AND the corner-pick-free
      // min-area bounding rect (the robust recovery for rough/sparse strokes).
      const rect = bestOf(
        bestOf(fitRect(sig, loop), rectLoop4 ? fitRect(sig, rectLoop4) : null),
        fitRectMinArea(sig),
      );
      const star = fitStar(sig, loop); // closed alternating star (bug 2)
      const circle = fitCircle(sig);
      const ellipse = fitEllipse(sig);
      // Polygon: best of the primary-pipeline corner loop AND the regular-polygon
      // RECOVERY loop (a finer-epsilon pass that recovers soft n-gon vertices the
      // primary pipeline smeared — MED-2 robustness). Purely additive: if the
      // recovery yields a better-fitting regular n-gon, that polygon is used; the
      // shipped triangle/rect/square reads are untouched (recovery only fires for
      // 5-8-gons and only when the regularity gate passes).
      const ngonLoop = regularPolygonHypothesis(sig);
      const poly = bestOf(fitPolygon(sig, loop), ngonLoop ? fitPolygon(sig, ngonLoop) : null);
      if (circle) candidates.push(circle);
      if (ellipse) candidates.push(ellipse);
      if (star) candidates.push(star);
      if (tri) candidates.push(tri);
      if (rect) candidates.push(rect);
      if (poly) candidates.push(poly);
    }
  }

  // Complexity prior (PaleoSketch ranking) — added to error so the simpler
  // read wins on near-ties.
  const priorOf: Record<ShapeKind, number> = {
    line: 0,
    circle: 1,
    triangle: 2,
    rect: 3,
    ellipse: 4,
    arrow: 5,
    star: 6,
    polygon: 7,
    polyline: 8,
    original: 99,
  };
  for (const c of candidates) {
    const prior = priorOf[c.kind] * COMPLEXITY_PRIOR;
    c.score = 1 - c.normErr - prior;
  }

  // REGULARIZATION PREFERENCE (bug 1 / PaleoSketch interpretation-priority): a
  // rect / triangle / star that CLEARED its geometric gate is the higher-value
  // read the user wants — give it the win over the generic polygon whenever its
  // (regularized) normErr is within TEMPLATE_OVER_POLYGON_ERR_MULT of the
  // polygon's raw error. Without this, a clean WIDE or ROTATED rect read as
  // "Polygon (4)" because the forced-square regularization carries a hair more
  // RMS than the drawn-corner polygon. We nudge the template's score just above
  // the polygon's so it ranks first; the polygon stays in the chip to cycle to.
  const poly = candidates.find((c) => c.kind === 'polygon');
  if (poly) {
    // When the polygon has MANY more vertices than the template, those extra
    // vertices are almost certainly jitter the template averaged through (a rough
    // triangle read as Polygon(12) that hugs every wobble at a tiny RMS — the
    // dominant-corner triangle is the read the user wants). Scale the accept
    // multiple up with the polygon's vertex EXCESS over the template so a much-
    // higher-vertex polygon yields to the template, while a 4-vs-4 tie stays at
    // the base multiple (a genuine pentagon's dominant-3 triangle has huge RMS and
    // never clears even the scaled bound, so real polygons are safe).
    const polyVerts = poly.points.length;
    for (const tplKind of ['rect', 'triangle', 'star'] as const) {
      const tpl = candidates.find((c) => c.kind === tplKind);
      if (!tpl) continue;
      const tplVerts = tpl.kind === 'triangle' ? 3 : tpl.kind === 'rect' ? 4 : tpl.points.length;
      const excess = Math.max(0, polyVerts - tplVerts);
      const mult = TEMPLATE_OVER_POLYGON_ERR_MULT * (1 + TEMPLATE_VERTEX_EXCESS_GAIN * excess);
      if (tpl.normErr <= poly.normErr * mult && tpl.normErr <= SNAP_MAX_NORM_ERR) {
        if (tpl.score <= poly.score) tpl.score = poly.score + COMPLEXITY_PRIOR;
      }
    }
  }

  // Circle-vs-ellipse preference: a near-round stroke ranks circle first; the
  // chip cycles to ellipse (SA-C). Nudge ellipse below circle when aspect ≤
  // CIRCLE_PREFERENCE_ASPECT and circle cleared threshold.
  const circ = candidates.find((c) => c.kind === 'circle');
  const ell = candidates.find((c) => c.kind === 'ellipse');
  if (circ && ell && sig.bboxAspect <= CIRCLE_PREFERENCE_ASPECT && circ.normErr <= SNAP_MAX_NORM_ERR) {
    if (ell.score >= circ.score) ell.score = circ.score - COMPLEXITY_PRIOR;
  }

  // CIRCLE ⟷ POLYGON ARBITRATION (MED-1 + MED-2): the decisive discriminant is
  // the polygon-fit VERTEX COUNT (proven on the catalog — a clean n-gon's polygon
  // fit has 3-8 corners; an ultra-wobbly circle's has 20+). [PaleoSketch NDDE/DCR
  // + vertex-count, the same philosophy as TEMPLATE_VERTEX_EXCESS_GAIN.]
  //
  //  • MED-2  a LOW-vertex (≤ POLYGON_NGON_MAX_VERTS) polygon-family read (regular
  //           polygon / rect / triangle / star) that fits markedly better than the
  //           best circle/ellipse is the n-gon the user drew → it WINS over circle.
  //  • MED-1  when a circle/ellipse fits well (round evidence) and the ONLY
  //           competing polygon is a HIGH-vertex jitter polygon (the wobble case)
  //           — or any worse-fitting template — the round read WINS over it,
  //           mirroring TEMPLATE_OVER_POLYGON for the round family.
  //
  // The two are mutually exclusive by construction: a genuine n-gon's best
  // polygon-family read is low-vertex (MED-2 fires, MED-1's promote-round skips
  // because the competing read is a real n-gon); a wobbly circle's polygon is
  // high-vertex (MED-2 skips, MED-1 fires). A real circle has no good polygon at
  // all, so neither demotes it.
  {
    const roundCands = candidates.filter((c) => c.kind === 'circle' || c.kind === 'ellipse');
    // STAR is excluded from this arbitration entirely — it cleared its own strict
    // alternation / radial-swing / notch-depth gates, so it's a high-value read
    // that neither a round promotion nor an n-gon promotion may disturb (a genuine
    // star's circle fit is decent, ~0.066, which must NOT demote the star).
    const jitterFamily = candidates.filter(
      (c) => c.kind === 'polygon' || c.kind === 'rect' || c.kind === 'triangle',
    );
    const hasGoodStar = candidates.some((c) => c.kind === 'star' && c.normErr <= SNAP_MAX_NORM_ERR);
    const vertsOf = (c: ShapeCandidate): number =>
      c.kind === 'triangle' ? 3 : c.kind === 'rect' ? 4 : c.points.length;
    let bestRound: ShapeCandidate | null = null;
    for (const c of roundCands) if (!bestRound || c.normErr < bestRound.normErr) bestRound = c;
    // The best LOW-vertex jitter-family read (a candidate regular polygon / rect /
    // triangle). Pick the highest-SCORING one — this runs AFTER
    // TEMPLATE_OVER_POLYGON, so for a rough SQUARE (where rect was already promoted
    // above the jitter polygon) the winner is the RECT, not the 5-vert jitter
    // polygon. We then promote THAT winning template over circle, so a rough square
    // reads Rectangle (not Polygon) while still beating a circle. A min-area Rect
    // ALWAYS fits a closed cloud (4 verts), so the presence of a low-vertex read
    // alone is NOT n-gon evidence — it must also out-fit the round read by the
    // MED-2 factor to count as a real n-gon.
    let bestNgon: ShapeCandidate | null = null;
    for (const c of jitterFamily) {
      if (vertsOf(c) > POLYGON_NGON_MAX_VERTS) continue;
      if (!bestNgon || c.score > bestNgon.score) bestNgon = c;
    }
    const ngonWins =
      !!bestNgon &&
      !!bestRound &&
      bestNgon.normErr <= SNAP_MAX_NORM_ERR &&
      bestNgon.normErr * POLYGON_OVER_CIRCLE_ERR_FACTOR <= bestRound.normErr;

    // A low-vertex template is "competitive" with the round read when it fits at
    // least as well as the circle — that means the shape really is a cornered
    // square / n-gon (even a very rough one), NOT a wobbly circle, so MED-1 must
    // NOT promote the round read. (A genuinely-round wobbly circle has only a
    // HIGH-vertex jitter polygon — no competitive low-vertex template — so MED-1
    // still fires for it.)
    const roundBeatsTemplates = !bestNgon || !bestRound || bestRound.normErr < bestNgon.normErr;

    if (ngonWins && bestNgon) {
      // MED-2: the real n-gon out-fits the circle by the factor → it wins over
      // every round read (the round reads stay in the chip to cycle to).
      const maxRoundScore = Math.max(...roundCands.map((c) => c.score));
      if (bestNgon.score <= maxRoundScore) bestNgon.score = maxRoundScore + COMPLEXITY_PRIOR;
    } else if (
      bestRound &&
      bestRound.normErr <= ROUND_OVER_POLYGON_NORMERR &&
      roundBeatsTemplates &&
      !hasGoodStar
    ) {
      // MED-1: round evidence is good, NO competitive low-vertex template (the only
      // competing jitter reads are a min-area Rect / wobble Polygon that merely
      // bound the cloud, both fitting WORSE than the circle). Promote the round
      // read above the jitter family so an ultra-wobbly circle defaults to Circle,
      // not Rectangle/Polygon. Star is protected by the hasGoodStar guard; a rough
      // square (whose rect fits as well as / better than the circle) is protected
      // by roundBeatsTemplates.
      const maxJitterScore = jitterFamily.length
        ? Math.max(...jitterFamily.map((c) => c.score))
        : -Infinity;
      if (bestRound.score <= maxJitterScore) bestRound.score = maxJitterScore + COMPLEXITY_PRIOR;
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const accepted = !!best && best.normErr <= SNAP_MAX_NORM_ERR;

  // Chip set: candidates within 2× the threshold, ranked, + original last.
  const chipCutoff = SNAP_MAX_NORM_ERR * CHIP_CANDIDATE_ERR_MULT;
  const chip = candidates.filter((c) => c.normErr <= chipCutoff);
  // ROUND CHIP GUARANTEE (MED-1): the user must ALWAYS be able to recover a
  // circle/ellipse when there's strong round evidence, even when a rect/polygon
  // also fits and the round normErr would otherwise miss the 2× cutoff. Splice
  // any strong-round candidate that the cutoff dropped back into the chip (ranked
  // by score alongside the rest), so Circle never disappears from the cycle.
  for (const c of candidates) {
    if (
      (c.kind === 'circle' || c.kind === 'ellipse') &&
      c.normErr <= ROUND_CHIP_GUARANTEE_NORMERR &&
      !chip.includes(c)
    ) {
      chip.push(c);
    }
  }
  chip.sort((a, b) => b.score - a.score);
  const ranked = (accepted ? chip : []).slice();
  ranked.push(originalCandidate);

  return {
    action,
    accepted,
    candidates: accepted ? ranked : [originalCandidate],
    refusedReason: accepted ? null : 'no-candidate-below-threshold',
    diag: baseDiag,
  };
}

// ─── Apply: candidate → the points that REPLACE stroke.points ────────────────

/** Emission spacing along the ideal outline (spec §4: "~8px spacing"). The raw
 *  perfect-freehand commit layer (Sketch mode) needs a CONTINUOUS point stream
 *  to build a clean outline — 3 sparse corners 100s of px apart break it into
 *  disconnected segments. The styled layer's RDP (ε=3.0) re-collapses straight
 *  runs back to the corner anchors, so the sharp-corner read is preserved.
 *  Both layers stay correct; only the raw layer needed the density. */
export const SNAP_EMIT_SPACING_PX = 8;

/** Walk the vertex chain (optionally closed) and sample at ~SNAP_EMIT_SPACING_PX
 *  so straight edges become a dense run of collinear points. Corners are always
 *  kept exactly (they're the vertices themselves). */
function densifyVertexChain(verts: FitPoint[], closeIt: boolean): FitPoint[] {
  if (verts.length < 2) return verts.slice();
  const out: FitPoint[] = [verts[0]];
  const segs = closeIt ? verts.length : verts.length - 1;
  for (let s = 0; s < segs; s++) {
    const a = verts[s];
    const b = verts[(s + 1) % verts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.round(len / SNAP_EMIT_SPACING_PX));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Emit the point list a chosen candidate writes back into stroke.points.
 *  Closed candidates WELD (the loop is exactly closed — SA-G, legitimate
 *  because snap is an explicit act) when the source was treated-as-closed or
 *  closed; open candidates never weld. Pressure: the mean of the original
 *  stroke's pressures (stays a stroke, renders in the pen — spec §4).
 *  Density: ALL candidates emit a ~8px-spaced continuous stream — circle/
 *  ellipse already do (their fit returns 48/64 outline points); corner chains
 *  (line/polyline/polygon/triangle/rect) get densified here so the raw
 *  perfect-freehand layer renders an unbroken shape (the U3 broken-triangle
 *  bug). RDP downstream re-finds the corners for the styled read. */
export function applyCandidate(
  candidate: ShapeCandidate,
  original: StrokeInputPoint[],
): StrokeInputPoint[] {
  const pressures = original.map((p) => (p.length > 2 ? (p as [number, number, number])[2] : 0.5));
  const meanP = pressures.length ? pressures.reduce((a, b) => a + b, 0) / pressures.length : 0.5;
  if (candidate.kind === 'original') {
    return original.slice();
  }
  // circle/ellipse fits are already dense outlines — emit verbatim (densifying
  // would just re-sample an already-fine curve). Corner chains densify.
  const isCurve = candidate.kind === 'circle' || candidate.kind === 'ellipse';
  const verts = isCurve
    ? candidate.points
    : densifyVertexChain(candidate.points, candidate.closed);
  const pts = verts.map((p): StrokeInputPoint => [p[0], p[1], meanP]);
  if (candidate.closed && pts.length >= 3) {
    // Weld: append the first vertex so the loop closes exactly.
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6) {
      pts.push([first[0], first[1], meanP]);
    }
    // SEAM SEAL (Sebs 2026-06-13, verified visually): perfect-freehand renders a
    // closed point-loop as an OPEN ribbon with a cap-GAP at the start/end — so a
    // snapped circle/rect/triangle showed a visible seam even though the data was
    // closed. Retrace a short run of the LEADING points so the end-cap overlaps
    // the start arc → the shape renders SEALED. Length-based (density-independent)
    // and capped to a small fraction of the loop so a tiny shape never overshoots
    // into a tail.
    let perim = 0;
    for (let i = 1; i < pts.length; i++) {
      perim += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    const overlapPx = Math.min(14, perim * 0.05);
    const lead: StrokeInputPoint[] = [];
    let acc = 0;
    for (let i = 1; i < pts.length && acc < overlapPx; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lead.push([pts[i][0], pts[i][1], meanP]);
    }
    pts.push(...lead);
  }
  return pts;
}
