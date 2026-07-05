// ─── strokeTo3d — pure stroke→geometry math for the 3D round-trip ───────────
// Implements docs/design/3d-roundtrip-build-plan.md §1.1 (Rod + Extrude easy
// path, research doc 21 §5b) + the §6.6 Inflate-Lite stretch mode (swept
// capsule — explicit-only, never auto-picked). NEW file: imports NOTHING from
// the 2D pipeline (SvgStyleTransform / smartHachure / handFeel stay
// untouched).
//
// PURITY CONTRACT (node-runnable — tools/3d/strokeTo3d-smoke.mjs imports this
// file directly):
//   - no React, no DOM, no window/document
//   - no wall-clock reads, no unseeded randomness — same input, same geometry
//
// Coordinate flow:
//   VIEWBOX (800×600, y-down) ──normalize──▶ world space (y-up, centered,
//   ~8 units wide) ──▶ Rod (open stroke) | Extrude (closed stroke)
//                      | Inflate (EXPLICIT pick — swept variable-radius capsule)
//                      | Solid (EXPLICIT pick — pool raster → marching squares)

import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Raw stroke point in viewBox coords (y-down).
 *  Accepts both the repo's StrokePoint shape ([x, y, pressure] —
 *  DrawSurface.tsx:13) and bare [x, y] pairs. Pressure (index 2) is accepted
 *  and IGNORED in MVP — the radius-modulation stretch (plan §6.1) consumes it
 *  later. Kept structurally compatible so the wiring layer can pass
 *  `stroke.points` through unchanged. */
export type StrokeInputPoint = [number, number] | [number, number, number];

export type GeometryMode = 'rod' | 'extrude' | 'inflate' | 'solid';
/** Modes the AUTO pick can resolve to. 'inflate' and 'solid' are
 *  EXPLICIT-ONLY (the stretch modes, plan §6.6 / research §5b) — auto never
 *  selects them. */
export type AutoGeometryMode = Extract<GeometryMode, 'rod' | 'extrude'>;
/** The FORM axis (Sebs 2026-06-27 unification). The stroke generators
 *  (rod/extrude/inflate/solid) + 'auto', PLUS 'ai-mesh' — a non-stroke FORM that
 *  renders the object's generated GLB instead of building geometry from strokes.
 *  'ai-mesh' is only meaningful when the object carries a hard-path mesh URL; the
 *  stroke builders never receive it (the render gate routes it to HardMesh). */
export type GeometryModeSetting = GeometryMode | 'auto' | 'ai-mesh';

export interface ViewBoxSize {
  w: number;
  h: number;
}

export interface RodGeometryResult {
  kind: 'rod';
  geometry: THREE.TubeGeometry;
  /** Endpoint cap centers (empty when the curve is closed), inset along the
   *  tangents by radius × CAP_INSET_FACTOR (free-stroke character). Rendered
   *  as sibling sphere meshes — simpler than CSG merge (plan §1.1). */
  capPositions: THREE.Vector3[];
  /** Raw stroke endpoints (start, end — empty when closed). The Tier-2 cap
   *  families place flat disks / ink-blob beads relative to the TRUE end,
   *  not the inset sphere center (rodAdornments.ts consumes these). */
  endPositions: THREE.Vector3[];
  /** Outward unit tangents at the endpoints (start points backward along the
   *  curve, end points forward — empty when closed). Orients flat-disk caps. */
  endDirections: THREE.Vector3[];
  /** Joint-sphere centers (free-stroke detectJoints3D port) — centerline
   *  spheres that fill the crease where the tube kinks. Same radius as the
   *  tube; rendered as sibling sphere meshes like the caps. */
  jointPositions: THREE.Vector3[];
  radius: number;
}

export interface ExtrudeGeometryResult {
  kind: 'extrude';
  geometry: THREE.ExtrudeGeometry;
  /** Donut-parity holes cut into the slab (conversion-semantics D2-B —
   *  nested drawn loops at odd containment depth become Shape.holes).
   *  0 for the plain single-outline path. */
  holesCut: number;
}

export interface InflateGeometryResult {
  kind: 'inflate';
  /** Custom swept-capsule BufferGeometry (TubeGeometry cannot vary radius). */
  geometry: THREE.BufferGeometry;
  /** Centerline sample count (ring count). Vertex layout:
   *  rings · (radialSegments + 1) side vertices + 2 pole vertices. */
  rings: number;
  radialSegments: number;
  /** Per-ring world radius after profile + pressure modulation — honest
   *  introspection for the smoke harness + future debug overlays. */
  ringRadii: number[];
}

export interface SolidGeometryResult {
  kind: 'solid';
  geometry: THREE.ExtrudeGeometry;
  /** How many outer contours / holes the marching-squares pass produced —
   *  honest introspection for the smoke harness + future debug overlays. */
  outerContours: number;
  holes: number;
}

export type StrokeGeometryResult =
  | RodGeometryResult
  | ExtrudeGeometryResult
  | InflateGeometryResult
  | SolidGeometryResult;

// ─── Constants (plan §1.1 + §5b budgets) ─────────────────────────────────────

export const DEFAULT_VIEWBOX: ViewBoxSize = { w: 800, h: 600 };

/** ε matches the 2D canonical RDP epsilon (research doc 22 dispatch-freeze). */
export const RDP_EPSILON = 3.0;

/** viewBox px → world units. 800px-wide canvas → 8 world units. */
export const WORLD_SCALE = 0.01;

// ── Rod character — PORTED from Free Stroke (2026-06-12) ──
// PROVENANCE: ~/Desktop/Projects/free-stroke origin/main lib/geometry-engines.ts
// (read via `git show origin/main:lib/geometry-engines.ts` — the local checkout
// is stale; per docs/memory/project_free_stroke.md PORT-FIRST). Free Stroke
// maps the canvas's LONGEST side to 3 world units (strokeTo3D: normScale =
// 3 / max(w, h)); we map 800px → 8 units (WORLD_SCALE 0.01). All ABSOLUTE
// world lengths convert ×8/3; radius-RELATIVE factors port verbatim.
export const ROD_RADIUS = 0.032; // TUBE_RADIUS 0.012 × 8/3 — the tuned ink-line weight
/** RC-4(b): hard floor on the tube half-thickness, world units. At the old
 *  slider min (0.01) the rod collapses toward a 1-D line: its bounding box has
 *  near-zero cross-section, so the bounding-sphere radius the camera frames to
 *  shrinks toward the major HALF-axis, the camera pulls in close, and a tall or
 *  wide form's long axis runs off the frame (the overflow read). The
 *  framing-aware camera fix (Stroke3DScene CameraFramer) handles the geometry,
 *  but the rod also needs a sane minimum girth so it stays a visible ink line
 *  rather than a hairline at any zoom. 0.016 = half the tuned default — still
 *  clearly thinner than default, never degenerate. Engine-side clamp so EVERY
 *  caller (slider, conversion pipeline, solid rodRadius pass) is protected. */
export const ROD_RADIUS_FLOOR = 0.016;
export const ROD_RADIAL_SEGMENTS = 16; // RADIAL_SEGMENTS 16 — round ink, not faceted
export const ROD_TUBE_SEGMENTS_MULTIPLIER = 3; // TUBE_SEGMENTS_MULTIPLIER (already matched)
export const ROD_MAX_TUBULAR_SEGMENTS = 512; // MAX_TUBULAR_SEGMENTS (already matched)
/** Cap/joint sphere tessellation (SPHERE_SEGMENTS 14). */
export const SPHERE_SEGMENTS = 14;
/** Endpoint cap spheres sit INSIDE the tube ends — inset along the curve
 *  tangent by radius × this factor, so the cap reads as a rounded ink tip,
 *  not a bead stuck onto the end. */
export const CAP_INSET_FACTOR = 0.35;
/** Joint-sphere pass (the ink-blob feel): spheres on the centerline fill the
 *  crease where TubeGeometry pinches at a kink. Threshold semantics ported
 *  verbatim from detectJoints3D. */
export const JOINT_ANGLE_THRESHOLD_DEG = 40;
/** No joints within radius × this of either endpoint ("dot" artifacts —
 *  free-stroke comment, verbatim factor). */
export const JOINT_ENDPOINT_EPS_FACTOR = 1.25;
/** Min spacing between consecutive joints, radius × this (verbatim factor). */
export const JOINT_DEDUP_FACTOR = 0.75;
/** Consecutive-point dedupe distance — filterDuplicates minDist 0.001 × 8/3.
 *  (Was an exact-duplicate guard 1e-6; the tuned distance also stabilizes
 *  joint detection on dense capture.) */
export const DEDUPE_MIN_DIST = 0.001 * (8 / 3);
/** Rod centerline resample spacing — free-stroke feeds its CatmullRom DENSE
 *  arc-length-resampled points (processStroke spacing default 4 canvas px),
 *  NOT sparse simplified anchors. 4 viewBox px × WORLD_SCALE = 0.04 world.
 *  Without this the ×3 segment multiplier under-samples sharp corners (the
 *  tube cuts the corner and the joint sphere floats off the ink — seen on
 *  the first /canvas wiring screenshot 2026-06-12). */
export const ROD_RESAMPLE_SPACING = 0.04;

export const EXTRUDE_DEPTH = 0.5;
/** Rounded extrude edge (2026-06-12 look pass): the old 0.02 hairline bevel
 *  left the camera-facing face meeting the side wall at a hard 90° — under
 *  any rig the face reads as a flat cut-out. A fatter 3-segment bevel gives
 *  the rim a curved band that catches the key light and carries the form
 *  (the "pressed cookie" read). Shared by Extrude + Solid. */
export const EXTRUDE_BEVEL_SIZE = 0.05;
export const EXTRUDE_BEVEL_THICKNESS = 0.05;
export const EXTRUDE_BEVEL_SEGMENTS = 3;

// ── Tier-2 Extrude style families (3d-mode-controls-spec three-tier
//    amendment — discrete look choices, additive engine options) ─────────────

/** Bevel profile family: how the front/back faces meet the side wall.
 *  'rounded' = today's tuned default (the constants above, byte-identical);
 *  'soft' = a single-segment chamfer (cut corner, no curve); 'sharp' =
 *  bevel disabled (hard 90° die-cut edge). */
export type ExtrudeBevelProfile = 'sharp' | 'soft' | 'rounded';
export const EXTRUDE_BEVEL_PROFILES: Record<
  ExtrudeBevelProfile,
  { enabled: boolean; size: number; thickness: number; segments: number }
> = {
  sharp: { enabled: false, size: 0, thickness: 0, segments: 0 },
  soft: { enabled: true, size: 0.022, thickness: 0.022, segments: 1 },
  rounded: {
    enabled: true,
    size: EXTRUDE_BEVEL_SIZE,
    thickness: EXTRUDE_BEVEL_THICKNESS,
    segments: EXTRUDE_BEVEL_SEGMENTS,
  },
};

/** Side-wall family: 'straight' = vertical walls (today); 'drafted' = walls
 *  taper toward the BACK face (pressed/molded read — the front face keeps the
 *  drawn silhouette, the back shrinks by EXTRUDE_DRAFT_AMOUNT around the
 *  slab's own xy center). */
export type ExtrudeSideWall = 'straight' | 'drafted';
export const EXTRUDE_DRAFT_AMOUNT = 0.18;

/** Inflate-Lite (swept capsule, research §5b "Free Stroke heuristic" — true
 *  Teddy chordal-axis inflation is explicitly OUT of scope). */
export const INFLATE_BASE_RADIUS = 0.22; // mid-stroke fullness, world units
export const INFLATE_TIP_RADIUS = 0.035; // end taper floor (never 0 — degenerate rings)
export const INFLATE_RADIAL_SEGMENTS = 12; // §5b budget: 8-12 thin, 16 hero
export const INFLATE_MIN_SEGMENTS = 32; // radius profile needs longitudinal resolution
export const INFLATE_MAX_SEGMENTS = 256;
/** sin(πt)^exp profile: exp < 1 → fuller shoulders (capsule read, not football). */
export const INFLATE_PROFILE_EXP = 0.8;
/** How strongly pressure (0..1, neutral 0.5) scales the local radius. */
export const INFLATE_PRESSURE_INFLUENCE = 0.35;
/** Base radius is clamped to this fraction of the stroke's arc length so a
 *  short stroke reads as a small blob, not a sphere swallowing its footprint. */
export const INFLATE_MAX_BASE_TO_LENGTH = 0.35;

/** Solid (research §5b "raster → marching squares → contour → extrude").
 *  Pool-level: ALL strokes rasterize into ONE binary grid (pure JS, no
 *  canvas/DOM) so overlapping strokes merge into a watertight mass. */
export const SOLID_INK_RADIUS = 0.08; // world-unit half-width of the stamped ink body
export const SOLID_GRID_RESOLUTION = 144; // samples along the pool bbox's longest side
export const SOLID_MAX_GRID_RESOLUTION = 200;
/** Contour loops below this area (grid-cell units²) are rasterization noise. */
export const SOLID_MIN_LOOP_AREA = 2;
/** RDP epsilon for contour simplification, in grid-cell units (< 1 cell).
 *  0.6 filters the marching-squares staircase (~0.25–0.35 cell deviation)
 *  while keeping curvature; one Chaikin pass then rounds the corners so a
 *  drawn circle reads as a circle, not a 14-gon. This GENTLE epsilon is what
 *  the CRISP 2D-fill path needs (conform tightly to the drawn boundary). */
export const SOLID_RDP_EPSILON_CELLS = 0.6;
/** STAIRCASE-COLLAPSE epsilon (grid-cell units) for the SMOOTHED 3D-solid /
 *  svg-port contour ONLY. The gentle 0.6 epsilon leaves the marching-squares
 *  staircase intact on a circle (max per-vertex turn ~45° — the facet read
 *  Sebs sees), and a single Chaikin pass barely dents it. Re-decimating the
 *  contour at ~1.4 cells collapses the staircase steps (max turn → ~20°) so the
 *  subsequent multi-pass corner-aware Chaikin can rebuild a TRUE smooth curve,
 *  while a real corner's large deviation always survives RDP (it's the farthest
 *  point on its segment). Cell-unit space, so it scales with grid resolution.
 *  Crisp 2D fill keeps the gentle 0.6 (no staircase collapse). */
export const SOLID_SMOOTH_DECIMATE_EPSILON_CELLS = 1.4;

/** Tier-2 Solid edge family: 'eased' = today's rounded bevel band (the
 *  EXTRUDE_BEVEL_* constants, byte-identical default); 'crisp' = bevel off —
 *  the die-cut hard rim. */
export type SolidEdge = 'crisp' | 'eased';

/** Closed-stroke endpoint gap thresholds (plan §1.1 isClosedStroke). These
 *  are the LOOSE bounds of the 3-state closure below — kept as the outer
 *  edge of the solid family per the conversion-semantics RED-TEAM AMENDMENT. */
export const CLOSE_GAP_PX = 24;
export const CLOSE_GAP_BBOX_RATIO = 0.08;
/** TIGHT closure bounds (conversion-semantics addendum §1.1, decision A-1):
 *  gap < max(8px, 2.5% bbox diag) → unambiguously closed (the heart stays a
 *  silent slab). Between tight and loose → 'treated-as-closed' (solid family
 *  + honesty chip — Sebs's arrow repro lands here). Both are CALIBRATION
 *  CONSTANTS (same standing as K_ZIGZAG in coverage.ts): sweep + chip-flip
 *  corrections tune them before any freeze. */
export const CLOSE_GAP_TIGHT_PX = 8;
export const CLOSE_GAP_TIGHT_BBOX_RATIO = 0.025;

/** Shoelace-area floor (world units²) below which a "closed" stroke is
 *  treated as degenerate (collinear scribble) and falls back to Rod.
 *  0.005 world² ≈ 50 viewBox px² at WORLD_SCALE 0.01 — same order as the 2D
 *  tiny-area clamp (40px², 18-scope-audit row 13). */
export const MIN_EXTRUDE_AREA = 0.005;

// ─── THE ARROW RULE — PENDING SEBS RULING (rock X, 2026-06-12) ──────────────
// What does the AMBIGUOUS closure band ('treated-as-closed') resolve to by
// DEFAULT in auto mode? Two ratified candidates, both implemented:
//   'rod'   — open-ish stays an honest open rod + "Treat as closed?" chip
//             (the verifier's red-team amendment; matches Sebs's original
//             anti-auto-fill complaint — nothing fills unless he says so)
//   'solid' — open-ish welds into the solid family + "Treated as closed" chip
//             (addendum A-2: closed-means-mass is the drawn-register law)
// The chip flips PER OBJECT either way (see isSolidFamilyClosure overrides +
// the conversion-log corrections — every flip is a labeled training tuple).
// Flip = change this one literal. Fixture board: tools/3d/arrow-rule-board.
export type TreatedAsClosedDefault = 'rod' | 'solid';
export const TREATED_AS_CLOSED_DEFAULT: TreatedAsClosedDefault = 'rod';

/** Per-stroke identity key for chip-override maps — stable across re-renders,
 *  invalidates the moment the stroke is edited (same fields strokesKey uses). */
export function strokeSignature(stroke: StrokeInputPoint[]): string {
  if (stroke.length === 0) return '0';
  const [fx, fy] = stroke[0];
  const [lx, ly] = stroke[stroke.length - 1];
  return `${stroke.length}:${fx.toFixed(1)},${fy.toFixed(1)}:${lx.toFixed(1)},${ly.toFixed(1)}`;
}

/** Resolve a closure state to solid-family membership under the arrow rule:
 *  'closed' → always solid family; 'open' → never; 'treated-as-closed' → the
 *  per-object chip override when present, else the pending-Sebs default.
 *  `dflt` is parameterized for the smoke suite (proves both branches without
 *  flipping the constant); callers omit it. */
export function isSolidFamilyClosure(
  state: ClosureState,
  treatAsClosed?: boolean,
  dflt: TreatedAsClosedDefault = TREATED_AS_CLOSED_DEFAULT,
): boolean {
  if (state === 'closed') return true;
  if (state === 'open') return false;
  if (treatAsClosed !== undefined) return treatAsClosed;
  return dflt === 'solid';
}

// ─── Input sanitation (BUILDER BOUNDARY GUARD) ───────────────────────────────

/** True when x AND y are finite real numbers. A stray Infinity (from a corrupt
 *  publish/upload record, a divide-by-zero in an upstream transform, or a
 *  bad pointer-event coalesce) is the ONE non-finite input that is dangerous:
 *  it makes a polyline SEGMENT length Infinity, and the arc-length resamplers
 *  (resampleWorldPolyline here + resamplePolyline in markIntent) walk
 *  `while (walked <= segLen) walked += spacing` — an Infinity segLen never
 *  terminates and OOMs the process/tab. (NaN is already harmless: rdpPoints'
 *  hypot/compare drop NaN anchors and dedupe filters NaN distances, so NaN
 *  never reaches a live segLen.) Index 2 (pressure) is NOT range-checked here
 *  — extractPressures already clamps it. */
export function isFinitePoint(p: StrokeInputPoint): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/** Drop every point with a non-finite x/y from one stroke. This is the
 *  ENGINE BOUNDARY GUARD for the Infinity-OOM class: applied at the
 *  convertStrokePool entry (before analyzeMarkIntent, which resamples FIRST)
 *  so no Infinity ever reaches an arc-length walk. Builders also defend
 *  themselves (resampleWorldPolyline filters too) — defence in depth, since
 *  the scene/smoke paths call builders directly. Returns a NEW array;
 *  pressure-bearing tuples are preserved verbatim. */
export function dropNonFinitePoints<P extends StrokeInputPoint>(stroke: P[]): P[] {
  return stroke.filter(isFinitePoint);
}

/** Apply dropNonFinitePoints across a whole pool. Strokes that become empty
 *  after filtering are dropped entirely (a stroke of only-Infinity points
 *  carries no recoverable geometry). */
export function sanitizeStrokePool<P extends StrokeInputPoint>(strokes: P[][]): P[][] {
  return strokes.map((s) => dropNonFinitePoints(s)).filter((s) => s.length > 0);
}

// ─── Simplification ──────────────────────────────────────────────────────────

/** Ramer-Douglas-Peucker polyline simplification.
 *  PROVENANCE: local copy of the module-private `rdp()` in
 *  src/app/components/canvas/SvgStyleTransform.tsx (~line 579), duplicated
 *  here per build plan §1.1 so the 2D pipeline file stays untouched.
 *  Generalized over the point tuple so pressure (index 2) carries through
 *  unchanged. A point is dropped if its perpendicular distance from the
 *  chord through the segment endpoints is < epsilon. */
export function rdpPoints<P extends StrokeInputPoint>(
  points: P[],
  epsilon: number = RDP_EPSILON,
): P[] {
  if (points.length < 3) return points.slice();
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lineLen = Math.hypot(dx, dy);
  // DEGENERATE-CHORD GUARD (BUG 2 — closed-loop collapse): when the first and
  // last points coincide (a CLOSED loop: a clean circle's endpoints are equal,
  // or within float noise ~1e-13), the chord length is ~0 and the
  // perpendicular-distance formula `|…|/lineLen` divides by ~0 → garbage
  // distances → RDP collapses the whole symmetric loop to just [first, last]
  // (2 coincident anchors). Downstream closureStateOf then reads <3 pts → 'open'
  // → a closed circle routes to a hollow ROD instead of a solid slab, and the
  // bug is RADIUS-DEPENDENT (which intermediate point happens to win the
  // garbage-max) so it looks non-deterministic. Treat any near-zero chord as
  // the degenerate case and measure distance from the shared endpoint, so the
  // farthest point splits the loop and recursion keeps it ≥3 anchors. */
  const chordDegenerate = lineLen < 1e-9;
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const dist = chordDegenerate
      ? Math.hypot(px - x1, py - y1)
      : Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / lineLen;
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpPoints(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpPoints(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

// ─── Closure detection + mode pick ───────────────────────────────────────────

/** 3-state closure (conversion-semantics RED-TEAM AMENDMENT, ratified
 *  2026-06-12 + addendum §1.1 — replaces the grabby boolean threshold that
 *  was root cause #1 of the arrow-slab):
 *    'closed'            gap < max(8px, 2.5% diag)  → solid family, silent
 *    'treated-as-closed' gap ∈ [tight, max(24px, 8% diag)) → solid family,
 *                        FLAGGED (the "Treated as closed" chip — rock 1
 *                        renders it from ConversionReceipt.treatedAsClosed)
 *    'open'              gap ≥ loose bound → rod */
export type ClosureState = 'closed' | 'treated-as-closed' | 'open';

export function closureStateOf(points: StrokeInputPoint[]): ClosureState {
  if (points.length < 3) return 'open';
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const [fx, fy] = points[0];
  const [lx, ly] = points[points.length - 1];
  const gap = Math.hypot(lx - fx, ly - fy);
  if (gap < Math.max(CLOSE_GAP_TIGHT_PX, diag * CLOSE_GAP_TIGHT_BBOX_RATIO)) return 'closed';
  if (gap < Math.max(CLOSE_GAP_PX, diag * CLOSE_GAP_BBOX_RATIO)) return 'treated-as-closed';
  return 'open';
}

/** LOOSE closure boolean: gap < max(24 viewBox px, 8% of the stroke's bbox
 *  diagonal) — i.e. 'closed' ∪ 'treated-as-closed'. This is the EXPLICIT-mode
 *  + raster-fill reading (Solid scanline interiors, explicit-Rod ring
 *  closure, region extraction): those paths keep today's tolerant behavior
 *  regardless of the arrow rule. The AUTO family pick goes through
 *  pickGeometryMode, which respects TREATED_AS_CLOSED_DEFAULT + the chip. */
export function isClosedStroke(points: StrokeInputPoint[]): boolean {
  return closureStateOf(points) !== 'open';
}

/** Auto pick: solid-family closure → Extrude, else Rod (§5b Phase-D
 *  auto-pick; the user toggle overrides per the I-1 spirit — see
 *  resolveGeometryMode). The ambiguous closure band resolves through the
 *  ARROW RULE (TREATED_AS_CLOSED_DEFAULT + per-object `treatAsClosed` chip
 *  override). UNTOUCHED: auto resolves rod/extrude ONLY — 'inflate'/'solid'
 *  are explicit user choices, enforced by the AutoGeometryMode return type. */
export function pickGeometryMode(
  points: StrokeInputPoint[],
  opts: { treatAsClosed?: boolean } = {},
): AutoGeometryMode {
  return isSolidFamilyClosure(closureStateOf(points), opts.treatAsClosed) ? 'extrude' : 'rod';
}

/** Map the chrome setting onto a concrete mode for one stroke. */
export function resolveGeometryMode(
  setting: GeometryModeSetting,
  points: StrokeInputPoint[],
  opts: { treatAsClosed?: boolean } = {},
): GeometryMode {
  // 'ai-mesh' is a non-stroke FORM (renders a GLB) — it never reaches a stroke
  // builder, but if a coalescing path lands here, resolve it like 'auto'.
  return setting === 'auto' || setting === 'ai-mesh'
    ? pickGeometryMode(points, opts)
    : setting;
}

// ─── Normalization (viewBox y-down → world y-up) ─────────────────────────────

/** Whole-pool bbox center in viewBox coords. Passing this as the `center` of
 *  normalizeStrokePoints centers the GROUP at the origin while preserving the
 *  strokes' relative layout (plan §1.2 — pool center, never per-stroke).
 *  Empty pool → viewBox center. */
export function poolCenter(
  strokes: StrokeInputPoint[][],
  viewBox: ViewBoxSize = DEFAULT_VIEWBOX,
): { x: number; y: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      // 3D-2: a single Inf/NaN sample (corrupt compound-path) would otherwise
      // make max=Infinity → center=Infinity → viewBox="Infinity …" parse error.
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { x: viewBox.w / 2, y: viewBox.h / 2 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** viewBox (y-down) → world (y-up, centered):
 *    x' = (x − cx) · scale,  y' = −(y − cy) · scale,  z = 0
 *  Default center = viewBox center; pass poolCenter(...) to center a
 *  multi-stroke pool on its own bbox. 800px → 8 world units at the default
 *  scale. Pressure is ignored here (MVP — plan §6.1 stretch). */
export function normalizeStrokePoints(
  points: StrokeInputPoint[],
  viewBox: ViewBoxSize = DEFAULT_VIEWBOX,
  scale: number = WORLD_SCALE,
  center?: { x: number; y: number },
): THREE.Vector3[] {
  const cx = center ? center.x : viewBox.w / 2;
  const cy = center ? center.y : viewBox.h / 2;
  // WORLD BOUNDARY GUARD (Infinity-OOM, BUG 1): every builder path funnels
  // through normalization, so dropping non-finite coords here protects the
  // direct-builder callers (Stroke3DScene + the smoke harness) that bypass
  // convertStrokePool's front-door sanitize. A non-finite coord would survive
  // the scale/offset (Infinity·k = Infinity) into the raster bbox (Infinity
  // span → grid blow-up) and the resamplers (Infinity segLen → non-terminating
  // walk). No-op for finite input (the common path).
  return points
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]) => new THREE.Vector3((x - cx) * scale, -(y - cy) * scale, 0));
}

// ─── Geometry builders ───────────────────────────────────────────────────────

/** Drop consecutive near-duplicate points — identical neighbors make
 *  centripetal Catmull-Rom produce NaN tangents, and sub-threshold jitter
 *  destabilizes joint detection. Distance = free-stroke filterDuplicates
 *  minDist (0.001, converted ×8/3 — DEDUPE_MIN_DIST). RDP upstream removes
 *  most; this is the deterministic last guard. */
const DEDUPE_MIN_DIST_SQ = DEDUPE_MIN_DIST * DEDUPE_MIN_DIST;
function dedupeConsecutive(world: THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const v of world) {
    const prev = out[out.length - 1];
    if (!prev || prev.distanceToSquared(v) > DEDUPE_MIN_DIST_SQ) out.push(v);
  }
  return out;
}

/** Arc-length resample — PORT of free-stroke resampleStroke (origin/main
 *  lib/stroke-processing.ts ~47): walk the polyline, emit a point every
 *  `spacing` world units, always keep the true endpoint (the caps anchor
 *  there). The dense centerline is what makes the ×3 tubular multiplier hug
 *  corners the way free-stroke tubes do. Deterministic, pure. */
function resampleWorldPolyline(ptsIn: THREE.Vector3[], spacing: number): THREE.Vector3[] {
  // DEFENCE IN DEPTH (Infinity-OOM guard): drop any non-finite vertex before
  // the arc-length walk. A single Infinity coordinate makes segLen Infinity,
  // and `while (walked <= segLen)` would never terminate (it OOMs the
  // process). convertStrokePool sanitizes at the front door, but the scene +
  // smoke paths call the builders directly, so the walk hardens itself too.
  // A non-positive/non-finite spacing would also never advance — clamp it.
  const pts =
    ptsIn.length === ptsIn.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).length
      ? ptsIn
      : ptsIn.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  const step = Number.isFinite(spacing) && spacing > 0 ? spacing : ROD_RESAMPLE_SPACING;
  if (pts.length < 2) return pts.map((p) => p.clone());
  const out: THREE.Vector3[] = [pts[0].clone()];
  let prev = pts[0];
  let carry = 0; // distance walked past the last emitted point
  for (let i = 1; i < pts.length; i++) {
    const curr = pts[i];
    const segLen = prev.distanceTo(curr);
    if (!(segLen > 1e-12) || !Number.isFinite(segLen)) continue;
    let walked = step - carry;
    while (walked <= segLen) {
      out.push(new THREE.Vector3().lerpVectors(prev, curr, walked / segLen));
      walked += step;
    }
    carry = segLen - (walked - step);
    prev = curr;
  }
  const last = pts[pts.length - 1];
  if (out[out.length - 1].distanceToSquared(last) > 1e-12) out.push(last.clone());
  return out;
}

/** Joint detection — VERBATIM PORT of free-stroke detectJoints3D
 *  (origin/main lib/geometry-engines.ts ~688, epsilons kept radius-relative).
 *  Walks interior points of the polyline and emits a sphere center wherever
 *  the turn clears the threshold, EXCEPT (a) within radius×1.25 of either
 *  endpoint (cap zone — sphere there reads as a stray dot) and (b) within
 *  radius×0.75 of the previous joint (dedup). The spheres ride the
 *  centerline at tube radius, so on smooth runs they hide inside the tube
 *  and at kinks they fill the pinch crease — the ink-blob feel. */
export function detectJointPositions(
  filtered: THREE.Vector3[],
  startPt: THREE.Vector3,
  endPt: THREE.Vector3,
  radius: number,
  /** Corner angle (deg) that earns a blob — the chrome's Joint-sensitivity
   *  slider (20–70°) drives this directly; default = FS verbatim 40°. */
  angleThresholdDeg: number = JOINT_ANGLE_THRESHOLD_DEG,
): THREE.Vector3[] {
  const positions: THREE.Vector3[] = [];
  const angleThresholdRad = (angleThresholdDeg * Math.PI) / 180;
  const endpointEps = radius * JOINT_ENDPOINT_EPS_FACTOR;
  const jointDedup = radius * JOINT_DEDUP_FACTOR;

  for (let i = 1; i < filtered.length - 1; i++) {
    const prev = filtered[i - 1];
    const curr = filtered[i];
    const next = filtered[i + 1];

    const ax = curr.x - prev.x, ay = curr.y - prev.y, az = curr.z - prev.z;
    const bx = next.x - curr.x, by = next.y - curr.y, bz = next.z - curr.z;

    const magA = Math.sqrt(ax * ax + ay * ay + az * az);
    const magB = Math.sqrt(bx * bx + by * by + bz * bz);
    if (magA < 1e-6 || magB < 1e-6) continue;

    const dot = ax * bx + ay * by + az * bz;
    const cosAngle = Math.max(-1, Math.min(1, dot / (magA * magB)));
    const deviation = Math.PI - Math.acos(cosAngle);

    if (deviation > angleThresholdRad) {
      if (curr.distanceTo(startPt) < endpointEps) continue;
      if (curr.distanceTo(endPt) < endpointEps) continue;
      if (positions.length > 0) {
        const lastJoint = positions[positions.length - 1];
        if (curr.distanceTo(lastJoint) < jointDedup) continue;
      }
      positions.push(curr.clone());
    }
  }
  return positions;
}

/** Open-stroke Rod: TubeGeometry over a centripetal CatmullRomCurve3
 *  (plan §1.1) with the free-stroke ink character: endpoint cap spheres
 *  INSET along the tangents (radius × 0.35, so the tip reads rounded, not
 *  beaded) + joint spheres filling kink creases (detectJointPositions).
 *  Degenerate inputs (0-1 points — a dot tap) synthesize a tiny straight
 *  segment so the geometry never throws — free-stroke SKIPS sub-
 *  MIN_STROKE_LENGTH strokes; we keep the honest ink-bead instead. */
export function buildRodGeometry(
  world: THREE.Vector3[],
  opts: {
    radius?: number;
    closed?: boolean;
    /** REAL engine option (rock-1 cross-contract): joint detection angle in
     *  degrees — the chrome slider drives the engine, not a local mirror. */
    jointAngleThresholdDeg?: number;
  } = {},
): RodGeometryResult {
  // RC-4(b): floor the radius so a thin-rod slider extreme can't collapse the
  // tube toward a 1-D line (which under-frames elongated forms and clips them).
  const radius = Math.max(opts.radius ?? ROD_RADIUS, ROD_RADIUS_FLOOR);
  const closed = opts.closed ?? false;

  let pts = dedupeConsecutive(world);
  if (pts.length === 0) pts = [new THREE.Vector3(0, 0, 0)];
  if (pts.length === 1) {
    const p = pts[0];
    pts = [
      p.clone().add(new THREE.Vector3(-radius, 0, 0)),
      p.clone().add(new THREE.Vector3(radius, 0, 0)),
    ];
  }
  const canClose = closed && pts.length >= 3;
  // Joints detect on the SPARSE anchors (one sphere per real corner — the
  // tube can only crease at an anchor turn); the tube itself builds from the
  // DENSE resampled centerline, free-stroke's actual curve input (their
  // pipeline resamples every 4 canvas px BEFORE the CatmullRom — sparse
  // anchors under-sample corners and the joint spheres float off the ink).
  const jointPositions = detectJointPositions(
    pts,
    pts[0],
    pts[pts.length - 1],
    radius,
    opts.jointAngleThresholdDeg,
  );
  const dense = resampleWorldPolyline(pts, ROD_RESAMPLE_SPACING);
  const curve = new THREE.CatmullRomCurve3(dense, canClose, 'centripetal', 0.5);
  const tubularSegments = Math.min(
    Math.max(dense.length * ROD_TUBE_SEGMENTS_MULTIPLIER, 8),
    ROD_MAX_TUBULAR_SEGMENTS,
  );
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, ROD_RADIAL_SEGMENTS, canClose);
  // Caps inset along the curve tangents so they sit inside the tube ends
  // (free-stroke RodEngine, verbatim: inset = TUBE_RADIUS * 0.35).
  let capPositions: THREE.Vector3[] = [];
  let endPositions: THREE.Vector3[] = [];
  let endDirections: THREE.Vector3[] = [];
  if (!canClose) {
    const inset = radius * CAP_INSET_FACTOR;
    const startTangent = curve.getTangentAt(0);
    const endTangent = curve.getTangentAt(1);
    capPositions = [
      pts[0].clone().addScaledVector(startTangent, inset),
      pts[pts.length - 1].clone().addScaledVector(endTangent, -inset),
    ];
    endPositions = [pts[0].clone(), pts[pts.length - 1].clone()];
    // Outward = away from the tube body at each end.
    endDirections = [startTangent.clone().negate(), endTangent.clone()];
  }
  return { kind: 'rod', geometry, capPositions, endPositions, endDirections, jointPositions, radius };
}

/** Signed shoelace area of the world-space polygon (xy plane). */
function shoelaceArea(world: THREE.Vector3[]): number {
  let area = 0;
  for (let i = 0; i < world.length; i++) {
    const a = world[i];
    const b = world[(i + 1) % world.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** True if any vertex coordinate is non-finite — self-intersecting input can
 *  triangulate into garbage without throwing (plan §5 risk 3). */
function hasNonFinitePositions(geometry: THREE.BufferGeometry): boolean {
  const pos = geometry.getAttribute('position');
  if (!pos) return true;
  const arr = pos.array as ArrayLike<number>;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return true;
  }
  return false;
}

/** 2D-parity outline dispatch for Extrude — mirrors the drawn-canvas
 *  polygonal-vs-curve dispatch (research doc 22 dispatch-freeze; the 2D
 *  pipeline renders ≤8 anchors as straight segments, 9+ as a smooth
 *  Catmull-Rom). Without it a drawn circle extrudes as a faceted 14-gon
 *  while its 2D render is a smooth spline — the round-trip must keep the
 *  same shape family. */
export const EXTRUDE_SMOOTH_MIN_ANCHORS = 9;
const EXTRUDE_SMOOTH_SAMPLES_PER_ANCHOR = 8;
const EXTRUDE_SMOOTH_MAX_SAMPLES = 256;

/** Dedupe one closed loop + drop the duplicated closing point (THREE.Shape
 *  closes implicitly). Returns null when degenerate (collinear / near-zero
 *  area) — callers fall back honestly. */
function dedupeClosedLoop(world: THREE.Vector3[]): THREE.Vector3[] | null {
  const pts = dedupeConsecutive(world);
  if (pts.length > 1 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-12) pts.pop();
  if (pts.length < 3 || Math.abs(shoelaceArea(pts)) < MIN_EXTRUDE_AREA) return null;
  return pts;
}

/** OPEN/SELF-INTERSECTING GUARD (LOW-3, 2026-06-13): Auto correctly routes an
 *  open stroke to Rod, but the MANUAL Extrude/Solid override is exposed unguarded
 *  — forcing a slab from an open or self-intersecting outline makes THREE.Shape
 *  implicitly close the path with a straight chord, and for a figure-8 / bowtie /
 *  spiral that produces a CRUMPLED self-intersecting surface (the degenerate
 *  triangulation). These two predicates let the slab builders detect that case
 *  and fall back to a clean Rod (the honest read of a non-fillable stroke),
 *  exactly as Auto would, instead of emitting the bowtie. A genuinely CLOSED
 *  simple loop passes both → identical behaviour to before. */

/** Do segments a1-a2 and b1-b2 properly cross in XY? (shared endpoints don't
 *  count — adjacent edges of a polygon always touch.) */
function segmentsCrossXY(
  a1: THREE.Vector3,
  a2: THREE.Vector3,
  b1: THREE.Vector3,
  b2: THREE.Vector3,
): boolean {
  const d = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = d(b1, b2, a1);
  const d2 = d(b1, b2, a2);
  const d3 = d(a1, a2, b1);
  const d4 = d(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when the CLOSED polygon (implicit last→first edge) has any non-adjacent
 *  edge pair that crosses — i.e. the outline is self-intersecting and would
 *  triangulate into a crumpled bowtie. O(n²); n is a deduped loop (small). */
function loopSelfIntersectsXY(pts: THREE.Vector3[]): boolean {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // skip adjacent edges (share a vertex) including the wrap-around pair
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsCrossXY(a1, a2, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** A stroke is slab-eligible (Extrude/Solid can fill it) only when it reads as a
 *  CLOSED loop AND its outline is a simple (non-self-intersecting) polygon. An
 *  open path (large endpoint gap) or a self-intersecting one falls back to Rod.
 *  `world` is the raw (pre-dedupe) world stroke. */
function isSlabEligible(world: THREE.Vector3[]): boolean {
  if (!isClosedWorldLoop(world)) return false;
  const loop = dedupeClosedLoop(world);
  if (!loop) return false;
  return !loopSelfIntersectsXY(loop);
}

/** 2D-parity outline dispatch on a deduped closed loop:
 *   • 9+ anchors = curve intent → CLOSED centripetal Catmull-Rom through the
 *     anchors (the same smooth family the 2D render shows);
 *   • ≤8 anchors = polygonal intent → corner-aware Chaikin smoothing, which
 *     PINS sharp corners (a 4-anchor square keeps all four 90° corners verbatim
 *     → byte-identical to the old untouched path) but ROUNDS the shallow turns
 *     of a low-anchor circle/blob so its extruded RIM stops reading as flat
 *     facets (the systemic faceted-silhouette fix — Sebs's "polygon artifacts").
 *  Shared by the plain extrude AND the donut-parity holes so outer wall and
 *  hole rim keep the same shape family. May throw on pathological input —
 *  callers run it inside their honest-degradation try. */
function smoothClosedOutline(pts: THREE.Vector3[]): THREE.Vector3[] {
  if (pts.length < 3) return pts;
  if (pts.length < EXTRUDE_SMOOTH_MIN_ANCHORS) {
    // Polygonal intent: corner-aware smoothing on the 2D loop. Squares stay
    // square (every corner pinned → input returned unchanged); a coarse
    // low-poly circle rounds into a curve.
    const flat = pts.map((v) => [v.x, v.y] as [number, number]);
    const rounded = smoothClosedLoopCornerAware(flat);
    return rounded.map(([x, y]) => new THREE.Vector3(x, y, 0));
  }
  const loop = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  const divisions = Math.min(
    pts.length * EXTRUDE_SMOOTH_SAMPLES_PER_ANCHOR,
    EXTRUDE_SMOOTH_MAX_SAMPLES,
  );
  const outline = loop.getPoints(divisions);
  outline.pop(); // closed-curve sampling duplicates the start point
  return outline;
}

/** Closed-stroke Extrude: THREE.Shape + ExtrudeGeometry (plan §1.1).
 *  Degenerate (collinear / near-zero area) inputs fall back to Rod
 *  PROACTIVELY; triangulation throws / NaN output fall back in the catch —
 *  honest degradation, never a crash. Geometry is z-centered so Rods and
 *  Extrudes share the z=0 plane. */
export interface ExtrudeBuildOpts {
  depth?: number;
  rodRadius?: number;
  /** Tier-2 bevel profile family. Default 'rounded' (today's constants —
   *  existing callers render byte-identically). */
  bevelProfile?: ExtrudeBevelProfile;
  /** Tier-2 side-wall family. Default 'straight' (today). */
  sideWall?: ExtrudeSideWall;
}

export function buildExtrudeGeometry(
  world: THREE.Vector3[],
  opts: ExtrudeBuildOpts = {},
): StrokeGeometryResult {
  return buildExtrudeGeometryWithHoles(world, [], opts);
}

/** Drafted side-wall deform: linear xy taper toward the back face (−z) around
 *  the geometry's own bbox center. Runs AFTER z-centering; recomputes vertex
 *  normals (side walls are face-shaded anyway — the deform keeps the read). */
function applyDraftTaper(geometry: THREE.BufferGeometry, draft: number): void {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const zMin = bb.min.z;
  const zMax = bb.max.z;
  const span = zMax - zMin;
  if (span <= 1e-9) return;
  const pos = geometry.getAttribute('position');
  const arr = pos.array as Float32Array;
  for (let i = 0; i < pos.count; i++) {
    const z = arr[i * 3 + 2];
    const s = 1 - draft * ((zMax - z) / span); // front face (zMax) keeps 1.0
    arr[i * 3] = cx + (arr[i * 3] - cx) * s;
    arr[i * 3 + 1] = cy + (arr[i * 3 + 1] - cy) * s;
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** Extrude with donut-parity holes (conversion-semantics §4 hole row +
 *  addendum §1.2 — the parity tree the Solid mode already proves, applied to
 *  Extrude via THREE.Shape.holes). `holeWorlds` are nested drawn loops at odd
 *  containment depth (the caller — convertStrokePool — runs the parity walk).
 *  Degenerate holes are SKIPPED (logged via holesCut), never crash the slab;
 *  a degenerate OUTER falls back to Rod exactly like the plain path. */
export function buildExtrudeGeometryWithHoles(
  world: THREE.Vector3[],
  holeWorlds: THREE.Vector3[][],
  opts: ExtrudeBuildOpts = {},
): StrokeGeometryResult {
  const depth = opts.depth ?? EXTRUDE_DEPTH;
  const profile = EXTRUDE_BEVEL_PROFILES[opts.bevelProfile ?? 'rounded'];
  const pts = dedupeClosedLoop(world);
  if (!pts) {
    return buildRodGeometry(world, { radius: opts.rodRadius });
  }
  // OPEN / SELF-INTERSECTING GUARD (LOW-3): a forced Extrude on an open or
  // self-intersecting outline would emit a crumpled bowtie slab. Auto routes such
  // a stroke to Rod; the manual override now does the same — fall back to a clean
  // closed Rod (the honest read of a non-fillable single stroke) instead of the
  // degenerate surface. A genuinely-closed simple loop passes through unchanged.
  if (!isClosedWorldLoop(world) || loopSelfIntersectsXY(pts)) {
    return buildRodGeometry(world, { radius: opts.rodRadius, closed: isClosedWorldLoop(world) });
  }

  try {
    const outline = smoothClosedOutline(pts);
    const shape = new THREE.Shape(outline.map((v) => new THREE.Vector2(v.x, v.y)));
    let holesCut = 0;
    for (const holeWorld of holeWorlds) {
      const holePts = dedupeClosedLoop(holeWorld);
      if (!holePts) continue; // degenerate hole — skip, never crash
      const holeOutline = smoothClosedOutline(holePts);
      shape.holes.push(new THREE.Path(holeOutline.map((v) => new THREE.Vector2(v.x, v.y))));
      holesCut++;
    }
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: profile.enabled,
      bevelSize: profile.size,
      bevelThickness: profile.thickness,
      bevelSegments: profile.segments,
      curveSegments: 12,
      steps: 1,
    });
    if (hasNonFinitePositions(geometry)) {
      geometry.dispose();
      throw new Error('extrude produced non-finite positions');
    }
    geometry.translate(0, 0, -depth / 2);
    if ((opts.sideWall ?? 'straight') === 'drafted') {
      applyDraftTaper(geometry, EXTRUDE_DRAFT_AMOUNT);
    }
    return { kind: 'extrude', geometry, holesCut };
  } catch {
    return buildRodGeometry(world, { radius: opts.rodRadius, closed: true });
  }
}

// ─── Inflate-Lite (swept capsule — custom BufferGeometry) ────────────────────

/** Deterministic seed normal ⟂ the first tangent: cross against the world
 *  axis LEAST aligned with it (no randomness, no frame-dependent state). */
function seedNormal(tangent: THREE.Vector3): THREE.Vector3 {
  const ax = Math.abs(tangent.x);
  const ay = Math.abs(tangent.y);
  const az = Math.abs(tangent.z);
  const axis =
    ax <= ay && ax <= az
      ? new THREE.Vector3(1, 0, 0)
      : ay <= az
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3().crossVectors(axis, tangent).normalize();
}

/** Linear interpolation of a per-anchor pressure array at parameter u∈[0,1]
 *  (by anchor index fraction — an arc-length map would be marginally truer
 *  but anchor-index is smooth, deterministic, and indistinguishable at the
 *  radii involved). */
function samplePressure(pressures: number[], u: number): number {
  if (pressures.length === 0) return 0.5;
  if (pressures.length === 1) return pressures[0];
  const f = u * (pressures.length - 1);
  const i = Math.min(Math.floor(f), pressures.length - 2);
  const t = f - i;
  return pressures[i] * (1 - t) + pressures[i + 1] * t;
}

/** Pull the pressure channel ([x, y, pressure]) out of raw stroke points as
 *  the parallel array buildInflateGeometry consumes (plan §1.1 note). Returns
 *  undefined when NO point carries pressure (bare [x, y] input) so the
 *  capsule profile stays purely sine-eased. Missing entries default to the
 *  pointer-event neutral 0.5. */
export function extractPressures(points: StrokeInputPoint[]): number[] | undefined {
  let has = false;
  const out = points.map((p) => {
    const v = p.length > 2 ? p[2] : undefined;
    if (typeof v === 'number' && Number.isFinite(v)) {
      has = true;
      return Math.min(Math.max(v, 0), 1);
    }
    return 0.5;
  });
  return has ? out : undefined;
}

/** Synthesize a pseudo-pressure envelope from CURVATURE when the input carries no
 *  real pressure channel (mouse / SVG — the common case, where the Inflate
 *  "Pressure" slider was previously DEAD: constant 0.5 → `(p-0.5)=0` → no effect
 *  at any influence; Sebs 2026-06-15 "pressure still does nothing"). Maps the
 *  turn angle at each centerline point to 0.5 (neutral on straight runs) … 1.0
 *  (fuller at bends), 3-tap smoothed. Straights stay uniform (never invents
 *  bulges on a line); bends fatten as influence rises — so the slider does
 *  something on every input. Real stylus pressure still wins (this is the
 *  fallback only). */
function synthPressures(world: THREE.Vector3[]): number[] {
  const n = world.length;
  if (n < 3) return new Array(Math.max(n, 1)).fill(0.5);
  const curv = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const ax = world[i].x - world[i - 1].x, ay = world[i].y - world[i - 1].y, az = world[i].z - world[i - 1].z;
    const bx = world[i + 1].x - world[i].x, by = world[i + 1].y - world[i].y, bz = world[i + 1].z - world[i].z;
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
    if (la < 1e-6 || lb < 1e-6) continue;
    const dot = Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (la * lb)));
    curv[i] = Math.acos(dot); // 0 = straight … π = hairpin
  }
  curv[0] = curv[1];
  curv[n - 1] = curv[n - 2];
  let max = 1e-6;
  for (const c of curv) if (c > max) max = c;
  // 3-tap smooth + map to 0.5 (neutral) … 1.0 (fuller at bends).
  return curv.map((_, i) => {
    const lo = Math.max(0, i - 1), hi = Math.min(n - 1, i + 1);
    const s = (curv[lo] + curv[i] + curv[hi]) / 3;
    return 0.5 + 0.5 * (s / max);
  });
}

/** Inflate-Lite: swept tube whose RADIUS VARIES along the stroke — tapered
 *  ends, fuller middle (sine-eased profile), optionally modulated by pressure.
 *  THREE.TubeGeometry cannot vary radius, so this builds a custom
 *  BufferGeometry: arc-length-uniform centerline samples on the same
 *  centripetal Catmull-Rom the Rod uses, PARALLEL-TRANSPORT frames (rotate the
 *  previous normal by the angle between consecutive tangents — no Frenet
 *  twist/flip at inflections), one vertex ring per sample with per-ring
 *  radius, and pole-fan end caps offset by the tip radius for a rounded tip.
 *
 *  Vertex normals account for the radius slope (surface-of-revolution local
 *  correction: n = radial − tangent·(dr/ds)) so the taper shades correctly.
 *
 *  Degenerate input (< 2 distinct points) and any non-finite output fall back
 *  to Rod — same honest-degradation contract as the extrude path. */
export function buildInflateGeometry(
  world: THREE.Vector3[],
  opts: {
    baseRadius?: number;
    tipRadius?: number;
    radialSegments?: number;
    /** Parallel per-point pressure channel (0..1, neutral 0.5) — pass
     *  extractPressures(simplifiedPoints). Omit for pure sine profile. */
    pressures?: number[];
    pressureInfluence?: number;
    /** sin(πt)^exp longitudinal profile exponent (Tier-2 Inflate profile
     *  family drives this: cushion < balloon < bead). Default = the tuned
     *  INFLATE_PROFILE_EXP (balloon). */
    profileExp?: number;
    /** Radius for the Rod fallback, not the capsule. */
    rodRadius?: number;
  } = {},
): StrokeGeometryResult {
  const tipRadius = opts.tipRadius ?? INFLATE_TIP_RADIUS;
  const radialSegments = opts.radialSegments ?? INFLATE_RADIAL_SEGMENTS;
  const pressures = opts.pressures;
  const influence = opts.pressureInfluence ?? INFLATE_PRESSURE_INFLUENCE;
  // PRESSURE FALLBACK (Sebs 2026-06-15): mouse/SVG carry no pressure channel
  // (`pressures` undefined) so the slider was inert. Synthesize an envelope from
  // curvature so the slider actually modulates the form. Real stylus wins.
  // Real pressure only counts if it actually VARIES. Mouse/SVG capture writes a
  // CONSTANT 0.5 into the pressure channel (DrawSurface ~:1850 `e.pressure || 0.5`),
  // so `pressures` is non-null but flat → a plain `??` gate is defeated and
  // `(p-0.5)=0` kills all modulation (the "pressure does nothing" bug, root-caused
  // 2026-06-15). Treat a flat channel as NO pressure → fall back to curvature synth
  // so the slider actually shapes the form. Real stylus (varying) still wins.
  let hasRealPressure = false;
  if (pressures && pressures.length > 1) {
    let mn = pressures[0], mx = pressures[0];
    for (const v of pressures) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    hasRealPressure = mx - mn > 0.02;
  }
  const effPressures = hasRealPressure
    ? pressures
    : influence > 0
      ? synthPressures(world)
      : undefined;
  const profileExp = opts.profileExp ?? INFLATE_PROFILE_EXP;

  const pts = dedupeConsecutive(world);
  if (pts.length < 2) return buildRodGeometry(world, { radius: opts.rodRadius });

  try {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const arcLen = curve.getLength();
    if (!Number.isFinite(arcLen) || arcLen <= 0) throw new Error('degenerate arc length');

    // Short strokes stay blobs, not spheres bigger than their own footprint.
    const baseRadius = Math.max(
      tipRadius,
      Math.min(opts.baseRadius ?? INFLATE_BASE_RADIUS, arcLen * INFLATE_MAX_BASE_TO_LENGTH),
    );

    const segments = Math.min(
      Math.max(pts.length * 4, INFLATE_MIN_SEGMENTS),
      INFLATE_MAX_SEGMENTS,
    );
    const rings = segments + 1;

    // ── Centerline samples + parallel-transport frames ──
    const centers: THREE.Vector3[] = [];
    const tangents: THREE.Vector3[] = [];
    const normals: THREE.Vector3[] = [];
    const binormals: THREE.Vector3[] = [];
    for (let i = 0; i < rings; i++) {
      const u = i / segments;
      centers.push(curve.getPointAt(u));
      const t = curve.getTangentAt(u);
      // getTangentAt can collapse on pathological curves — reuse the previous
      // direction (deterministic) rather than emit NaN frames.
      if (t.lengthSq() < 1e-12) {
        tangents.push(i > 0 ? tangents[i - 1].clone() : new THREE.Vector3(1, 0, 0));
      } else {
        tangents.push(t.normalize());
      }
    }
    normals.push(seedNormal(tangents[0]));
    binormals.push(new THREE.Vector3().crossVectors(tangents[0], normals[0]).normalize());
    for (let i = 1; i < rings; i++) {
      const prevT = tangents[i - 1];
      const currT = tangents[i];
      const n = normals[i - 1].clone();
      const axis = new THREE.Vector3().crossVectors(prevT, currT);
      if (axis.lengthSq() > 1e-12) {
        axis.normalize();
        const angle = Math.acos(Math.min(Math.max(prevT.dot(currT), -1), 1));
        n.applyAxisAngle(axis, angle);
      }
      n.normalize();
      normals.push(n);
      binormals.push(new THREE.Vector3().crossVectors(currT, n).normalize());
    }

    // ── Per-ring radius: sine-eased capsule profile × pressure modulation ──
    const ringRadii: number[] = [];
    for (let i = 0; i < rings; i++) {
      const u = i / segments;
      const profile = Math.pow(Math.sin(Math.PI * u), profileExp);
      let r = tipRadius + (baseRadius - tipRadius) * profile;
      if (effPressures && influence > 0) {
        const p = samplePressure(effPressures, u);
        r *= Math.max(1 + influence * 2 * (p - 0.5), 0.25);
      }
      ringRadii.push(Math.max(r, tipRadius * 0.5));
    }

    // ── Assemble: rings·(radialSegments+1) side verts + 2 poles ──
    const vertsPerRing = radialSegments + 1; // seam duplicate, TubeGeometry-style
    const vertexCount = rings * vertsPerRing + 2;
    const positions = new Float32Array(vertexCount * 3);
    const vNormals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const ds = arcLen / segments;

    const radial = new THREE.Vector3();
    const vNrm = new THREE.Vector3();
    for (let i = 0; i < rings; i++) {
      // Radius slope dr/ds (central difference; one-sided at the ends) tilts
      // the normal along the axis so the taper doesn't shade like a cylinder.
      const rPrev = ringRadii[Math.max(i - 1, 0)];
      const rNext = ringRadii[Math.min(i + 1, rings - 1)];
      const span = (Math.min(i + 1, rings - 1) - Math.max(i - 1, 0)) * ds;
      const slope = span > 0 ? (rNext - rPrev) / span : 0;
      for (let j = 0; j <= radialSegments; j++) {
        const theta = (j / radialSegments) * Math.PI * 2;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        radial
          .copy(normals[i])
          .multiplyScalar(cos)
          .addScaledVector(binormals[i], sin);
        const vi = i * vertsPerRing + j;
        positions[vi * 3] = centers[i].x + radial.x * ringRadii[i];
        positions[vi * 3 + 1] = centers[i].y + radial.y * ringRadii[i];
        positions[vi * 3 + 2] = centers[i].z + radial.z * ringRadii[i];
        vNrm.copy(radial).addScaledVector(tangents[i], -slope).normalize();
        vNormals[vi * 3] = vNrm.x;
        vNormals[vi * 3 + 1] = vNrm.y;
        vNormals[vi * 3 + 2] = vNrm.z;
        uvs[vi * 2] = j / radialSegments;
        uvs[vi * 2 + 1] = i / segments;
      }
    }
    // Poles: offset along the outward tangent by the end radius → rounded tip.
    const startPole = vertexCount - 2;
    const endPole = vertexCount - 1;
    const sp = centers[0].clone().addScaledVector(tangents[0], -ringRadii[0]);
    const ep = centers[rings - 1].clone().addScaledVector(tangents[rings - 1], ringRadii[rings - 1]);
    positions.set([sp.x, sp.y, sp.z], startPole * 3);
    positions.set([ep.x, ep.y, ep.z], endPole * 3);
    vNormals.set([-tangents[0].x, -tangents[0].y, -tangents[0].z], startPole * 3);
    vNormals.set(
      [tangents[rings - 1].x, tangents[rings - 1].y, tangents[rings - 1].z],
      endPole * 3,
    );
    uvs.set([0.5, 0], startPole * 2);
    uvs.set([0.5, 1], endPole * 2);

    // ── Indices: side quads + pole fans (windings derived for outward CCW) ──
    const indices: number[] = [];
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radialSegments; j++) {
        const a = i * vertsPerRing + j;
        const b = a + 1;
        const c = (i + 1) * vertsPerRing + j;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const lastRing = segments * vertsPerRing;
    for (let j = 0; j < radialSegments; j++) {
      indices.push(startPole, j + 1, j); // cap normal faces −tangent
      indices.push(endPole, lastRing + j, lastRing + j + 1); // faces +tangent
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(vNormals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    if (hasNonFinitePositions(geometry)) {
      geometry.dispose();
      throw new Error('inflate produced non-finite positions');
    }
    return { kind: 'inflate', geometry, rings, radialSegments, ringRadii };
  } catch {
    return buildRodGeometry(world, { radius: opts.rodRadius });
  }
}

// ─── Solid (stroke-polygon raster → marching squares → contour → extrude) ───
// Research §5b Solid mode, pool-level: every stroke rasterizes into ONE binary
// sample grid — closed-stroke interiors via even-odd SCANLINE fill, stroke ink
// bodies via per-segment capsule stamping — so overlapping strokes merge into
// a watertight mass. Marching squares (midpoint interpolation, deterministic
// saddle resolution) extracts boundary loops; containment depth classifies
// outer contours vs holes; RDP simplifies; ExtrudeGeometry builds the solid.
// Pure JS throughout: no canvas, no DOM, no randomness.

/** World-space closure check (same thresholds as isClosedStroke, scaled by
 *  WORLD_SCALE) for callers that only have normalized points. */
function isClosedWorldLoop(pts: THREE.Vector3[]): boolean {
  if (pts.length < 3) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const gap = pts[0].distanceTo(pts[pts.length - 1]);
  return gap < Math.max(CLOSE_GAP_PX * WORLD_SCALE, diag * CLOSE_GAP_BBOX_RATIO);
}

/** Even-odd scanline fill of a closed polygon onto the sample grid. */
function scanlineFillPolygon(
  grid: Uint8Array,
  w: number,
  h: number,
  originX: number,
  originY: number,
  cell: number,
  poly: THREE.Vector3[],
): void {
  for (let row = 0; row < h; row++) {
    const y = originY + row * cell;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a.y > y !== b.y > y) {
        xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(Math.ceil((xs[k] - originX) / cell), 0);
      const c1 = Math.min(Math.floor((xs[k + 1] - originX) / cell), w - 1);
      for (let col = c0; col <= c1; col++) grid[row * w + col] = 1;
    }
  }
}

/** Stamp a thick polyline (capsule per segment) onto the sample grid:
 *  row-by-row scan of each segment's expanded bbox, marking samples within
 *  inkRadius of the segment. */
function stampInkBody(
  grid: Uint8Array,
  w: number,
  h: number,
  originX: number,
  originY: number,
  cell: number,
  pts: THREE.Vector3[],
  inkRadius: number,
): void {
  const r2 = inkRadius * inkRadius;
  const segs = Math.max(pts.length - 1, 0);
  for (let s = 0; s < Math.max(segs, 1); s++) {
    const a = pts[Math.min(s, pts.length - 1)];
    const b = pts[Math.min(s + 1, pts.length - 1)];
    const minX = Math.min(a.x, b.x) - inkRadius;
    const maxX = Math.max(a.x, b.x) + inkRadius;
    const minY = Math.min(a.y, b.y) - inkRadius;
    const maxY = Math.max(a.y, b.y) + inkRadius;
    const r0 = Math.max(Math.ceil((minY - originY) / cell), 0);
    const r1 = Math.min(Math.floor((maxY - originY) / cell), h - 1);
    const c0 = Math.max(Math.ceil((minX - originX) / cell), 0);
    const c1 = Math.min(Math.floor((maxX - originX) / cell), w - 1);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    for (let row = r0; row <= r1; row++) {
      const y = originY + row * cell;
      for (let col = c0; col <= c1; col++) {
        const x = originX + col * cell;
        let t = lenSq > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / lenSq : 0;
        t = Math.min(Math.max(t, 0), 1);
        const ex = x - (a.x + t * dx);
        const ey = y - (a.y + t * dy);
        if (ex * ex + ey * ey <= r2) grid[row * w + col] = 1;
      }
    }
  }
}

/** Marching squares over the binary sample grid → closed loops of [x, y]
 *  points in SAMPLE units. Midpoint interpolation (binary data), saddle cases
 *  resolved by a fixed deterministic choice. Every boundary point has degree
 *  exactly 2, so chaining always yields clean loops. The grid border is
 *  guaranteed empty by the margin, so every loop closes. */
function marchingSquaresLoops(grid: Uint8Array, w: number, h: number): Array<Array<[number, number]>> {
  // Point ids: coords doubled to stay integral (edge midpoints are .5).
  const STRIDE = 4096; // > 2·(SOLID_MAX_GRID_RESOLUTION + 2)
  const pid = (x2: number, y2: number) => x2 * STRIDE + y2;
  const adj = new Map<number, number[]>();
  const segList: Array<[number, number]> = [];
  const addSeg = (px2: number, py2: number, qx2: number, qy2: number) => {
    const p = pid(px2, py2);
    const q = pid(qx2, qy2);
    if (!adj.has(p)) adj.set(p, []);
    if (!adj.has(q)) adj.set(q, []);
    adj.get(p)!.push(q);
    adj.get(q)!.push(p);
    segList.push([p, q]);
  };

  for (let row = 0; row < h - 1; row++) {
    for (let col = 0; col < w - 1; col++) {
      const a = grid[row * w + col]; // bottom-left
      const b = grid[row * w + col + 1]; // bottom-right
      const c = grid[(row + 1) * w + col + 1]; // top-right
      const d = grid[(row + 1) * w + col]; // top-left
      const code = a | (b << 1) | (c << 2) | (d << 3);
      if (code === 0 || code === 15) continue;
      // Edge midpoints in doubled coords.
      const bot: [number, number] = [col * 2 + 1, row * 2];
      const rgt: [number, number] = [col * 2 + 2, row * 2 + 1];
      const top: [number, number] = [col * 2 + 1, row * 2 + 2];
      const lft: [number, number] = [col * 2, row * 2 + 1];
      switch (code) {
        case 1: case 14: addSeg(...lft, ...bot); break;
        case 2: case 13: addSeg(...bot, ...rgt); break;
        case 3: case 12: addSeg(...lft, ...rgt); break;
        case 4: case 11: addSeg(...rgt, ...top); break;
        case 6: case 9: addSeg(...bot, ...top); break;
        case 7: case 8: addSeg(...lft, ...top); break;
        case 5: // saddle (a,c) — fixed deterministic resolution
          addSeg(...lft, ...bot);
          addSeg(...rgt, ...top);
          break;
        case 10: // saddle (b,d) — fixed deterministic resolution
          addSeg(...bot, ...rgt);
          addSeg(...top, ...lft);
          break;
      }
    }
  }

  const edgeKey = (p: number, q: number) => (p < q ? p * 16777216 + q : q * 16777216 + p);
  const visited = new Set<number>();
  const loops: Array<Array<[number, number]>> = [];
  for (const [p0, p1] of segList) {
    if (visited.has(edgeKey(p0, p1))) continue;
    const loop: number[] = [p0];
    let prev = p0;
    let curr = p1;
    visited.add(edgeKey(p0, p1));
    let guard = adj.size + 8;
    while (curr !== p0 && guard-- > 0) {
      loop.push(curr);
      const nbrs = adj.get(curr)!;
      const next = nbrs[0] === prev ? nbrs[1] : nbrs[0];
      if (next === undefined) break; // dangling — malformed, drop below
      visited.add(edgeKey(curr, next));
      prev = curr;
      curr = next;
    }
    if (curr !== p0 || loop.length < 3) continue;
    loops.push(loop.map((id) => [Math.floor(id / STRIDE) / 2, (id % STRIDE) / 2]));
  }
  return loops;
}

/** Shoelace area of a [x, y] loop (absolute value). */
function loopArea(loop: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const [ax, ay] = loop[i];
    const [bx, by] = loop[(i + 1) % loop.length];
    area += ax * by - bx * ay;
  }
  return Math.abs(area / 2);
}

/** One Chaikin corner-cutting pass on a CLOSED loop (deterministic): each
 *  edge contributes its 1/4 and 3/4 points. Rounds the RDP corners so solid
 *  contours keep a hand-drawn curve read instead of a low-poly facet read. */
function chaikinClosed(loop: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < loop.length; i++) {
    const [ax, ay] = loop[i];
    const [bx, by] = loop[(i + 1) % loop.length];
    out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
    out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  return out;
}

// ── Corner-aware contour smoothing (THE faceted-silhouette fix, 2026-06-13) ──
// The marching-squares + RDP contour is a coarse polygon: a drawn circle reads
// as a ~14-gon with visible flat facets on the extruded RIM (Sebs: "weird
// polygon artifacts in different 3d things"). A SINGLE Chaikin pass only doubles
// the vertex count — a 14-gon → 28-gon still catches the studio key light as
// flats. The fix (research-backed — Chaikin's corner-cutting run in MULTIPLE
// passes converges to a quadratic B-spline; angle-limited Chaikin from the
// path-smoothing literature keeps straight runs straight and sharp corners
// sharp): run several passes, but PIN any vertex whose turn exceeds a corner
// threshold so a drawn SQUARE keeps its 90° corners while a circle's gentle
// staircase rounds into a true curve. Watertightness is preserved — smoothing
// only nudges existing boundary vertices toward their neighbours (the loop
// never opens; each new point lies strictly inside an existing edge so no new
// self-intersection, and the area only shrinks by sub-pixel corner-cuts).

/** Turn angle (radians) at/above which a vertex is a REAL corner and is PINNED
 *  (never corner-cut), so intentional sharp corners survive smoothing. A drawn
 *  square turns ~90° (π/2 ≈ 1.571) at each corner; a circle/blob's per-vertex
 *  turn on a ~14–28-gon contour is ≪ this. 1.05 rad ≈ 60° sits comfortably
 *  between the two: anything sharper than a hexagon corner is treated as
 *  deliberate. (Turn angle = π − interior angle: 0 = straight, π = full
 *  reversal.) */
export const CONTOUR_CORNER_PIN_RAD = 1.05;
/** How many corner-aware Chaikin passes to run on a closed contour. 3 passes
 *  takes a 14-gon to a smooth ~64-point curve on the rounded segments while
 *  pinned corners stay crisp — the rim reads as a curve, not facets, without an
 *  unbounded vertex blow-up (cap below keeps perf sane). */
export const CONTOUR_SMOOTH_PASSES = 3;
/** Hard ceiling on smoothed-contour vertex count (per loop) so a dense input
 *  contour can't explode the mesh. A circle rim at ~96 points already reads
 *  perfectly smooth; beyond that is wasted verts. */
export const CONTOUR_SMOOTH_MAX_POINTS = 192;

/** Turn angle (radians, 0..π) at vertex i of a CLOSED loop — the deviation of
 *  the path from straight (0 = collinear, π/2 = right angle, π = doubles back).
 *  Degenerate (coincident-neighbour) vertices report 0 (treated as smoothable
 *  filler, never a corner). */
function turnAngleAt(loop: Array<[number, number]>, i: number): number {
  const n = loop.length;
  const [px, py] = loop[(i - 1 + n) % n];
  const [cx, cy] = loop[i];
  const [nx, ny] = loop[(i + 1) % n];
  const ax = cx - px, ay = cy - py;
  const bx = nx - cx, by = ny - cy;
  const magA = Math.hypot(ax, ay);
  const magB = Math.hypot(bx, by);
  if (magA < 1e-12 || magB < 1e-12) return 0;
  const cos = Math.min(Math.max((ax * bx + ay * by) / (magA * magB), -1), 1);
  return Math.acos(cos); // 0 = straight, π = reversal
}

/** Mark which vertices of a CLOSED loop are CORNERS to pin (never corner-cut).
 *  Two ways to qualify, so BOTH a clean vector corner AND a raster-chamfered
 *  one survive WITHOUT pinning a uniformly-curving circle/polygon:
 *    (1) DIRECT — the vertex's own turn ≥ pinRad (a sharp single-vertex corner,
 *        e.g. an Extrude/vector square's exact 90°).
 *    (2) CONCENTRATED — marching-squares quantizes a 90° corner into a 2-step
 *        ~45° chamfer (no single vertex clears pinRad). Such a corner is a
 *        SHORT high-turn cluster bordered by STRAIGHT runs: the vertex + its
 *        sharper neighbour sum ≥ pinRad WHILE the next ring out (±2) is nearly
 *        flat (Σ < flatRad). A regular polygon / coarse circle turns UNIFORMLY
 *        — the ±2 ring is just as bent as the centre — so it fails the
 *        flatness test and rounds normally. Only the cluster PEAK pins (local
 *        max) so the corner stays a single crisp vertex, never a flat chamfer.
 *  This keeps a drawn square SQUARE through the raster→smooth path while an
 *  octagon / circle rounds. */
function markCorners(loop: Array<[number, number]>, pinRad: number): boolean[] {
  const n = loop.length;
  const turn = new Array<number>(n);
  for (let i = 0; i < n; i++) turn[i] = turnAngleAt(loop, i);
  const pinned = new Array<boolean>(n).fill(false);
  // "Flat" = the outer ring carries little turn, marking the corner as isolated
  // rather than part of a continuous curve. Half pinRad is a comfortable gap
  // between a straight run (~0) and uniform curvature (each vertex ~pinRad/k).
  const flatRad = pinRad * 0.5;
  for (let i = 0; i < n; i++) {
    const prev = turn[(i - 1 + n) % n];
    const next = turn[(i + 1) % n];
    if (turn[i] >= pinRad) {
      pinned[i] = true; // direct sharp corner
      continue;
    }
    const localMax = turn[i] >= prev && turn[i] >= next;
    const concentrated = turn[i] + Math.max(prev, next) >= pinRad;
    const outerFlat = turn[(i - 2 + n) % n] + turn[(i + 2) % n] < flatRad;
    if (localMax && concentrated && outerFlat) pinned[i] = true;
  }
  return pinned;
}

/** ONE corner-aware Chaikin pass on a CLOSED loop. Pinned vertices (markCorners)
 *  are emitted verbatim so corners stay sharp; every other vertex is corner-cut
 *  (the standard ¼/¾ split) so the facet read disappears. The loop stays closed
 *  and simple — each cut point lies strictly inside an existing edge, so no new
 *  self-intersection. A pinned vertex emits only the edge endpoints that keep
 *  the path leaving/arriving STRAIGHT at the corner; plain edges between two
 *  non-corners emit both Chaikin points (the classic doubling on rounds). */
function chaikinCornerAwarePass(
  loop: Array<[number, number]>,
  pinRad: number,
): Array<[number, number]> {
  const n = loop.length;
  if (n < 3) return loop;
  const pinned = markCorners(loop, pinRad);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = loop[i];
    const [bx, by] = loop[(i + 1) % n];
    if (pinned[i]) out.push([ax, ay]); // keep the corner exactly
    if (!pinned[i]) out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
    if (!pinned[(i + 1) % n]) out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  return out;
}

/** Corner-aware multi-pass smoother for a CLOSED contour loop — THE shared
 *  facet fix. Smooths the marching-squares/RDP staircase into a curve on
 *  rounded stretches while PINNING genuine sharp corners (drawn squares stay
 *  square). Watertight by construction (only repositions/duplicates existing
 *  boundary vertices inside their edges) and capped so vert count stays sane.
 *  `passes`/`pinRad` exposed for the smoke suite; callers use the tuned
 *  defaults. */
function smoothClosedLoopCornerAware(
  loop: Array<[number, number]>,
  passes: number = CONTOUR_SMOOTH_PASSES,
  pinRad: number = CONTOUR_CORNER_PIN_RAD,
): Array<[number, number]> {
  if (loop.length < 3) return loop;
  let cur = loop;
  for (let p = 0; p < passes; p++) {
    if (cur.length * 2 > CONTOUR_SMOOTH_MAX_POINTS) break;
    const next = chaikinCornerAwarePass(cur, pinRad);
    if (next.length < 3) break;
    cur = next;
  }
  return cur;
}

/** Even-odd ray-cast point-in-polygon ([x, y] loops, any consistent units).
 *  Exported: the drawn-register conversion layer (convert.ts) runs the same
 *  containment tests on drawn loop polygons. */
export function pointInLoop(x: number, y: number, loop: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0; i < loop.length; i++) {
    const [ax, ay] = loop[i];
    const [bx, by] = loop[(i + 1) % loop.length];
    if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inside = !inside;
  }
  return inside;
}

/** Containment-depth walk — THE donut-parity machinery (even = outer mass,
 *  odd = hole), generalized out of the Solid pipeline (conversion-semantics
 *  addendum §1.2: "the containment-parity walk feeds every mode"). Each
 *  loop's depth = how many OTHER loops contain its first point. Deterministic:
 *  pure function of the loop arrays. Units don't matter as long as all loops
 *  share them (grid samples for Solid, viewBox px for drawn-loop parity). */
export function containmentDepths(loops: Array<Array<[number, number]>>): number[] {
  return loops.map((loop, i) => {
    const [x, y] = loop[0];
    let d = 0;
    for (let j = 0; j < loops.length; j++) {
      if (j !== i && pointInLoop(x, y, loops[j])) d++;
    }
    return d;
  });
}

/** The pool-raster region core (conversion-semantics addendum §1.2 — promoted
 *  from "Solid's internal trick" to THE drawn-register region extractor):
 *  grid spec → scanline fill + capsule stamp → marching squares → area filter
 *  → containment-depth parity. Shared VERBATIM by buildSolidGeometry (its
 *  original front half, byte-identical) and extractPoolRegions (the exported
 *  conversion-time extractor). Returns null when no loop survives the noise
 *  floor. Deterministic throughout. */
interface PoolRasterResult {
  rawLoops: Array<Array<[number, number]>>;
  depths: number[];
  originX: number;
  originY: number;
  cell: number;
}

function rasterizePoolLoops(
  pool: THREE.Vector3[][],
  inkRadius: number,
  resolution: number,
  closedFlags?: boolean[],
): PoolRasterResult | null {
  // ── Grid spec: pool bbox + margin so the border stays empty ──
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of pool) {
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const cell = Math.max(spanX, spanY) / resolution;
  const margin = inkRadius + 2 * cell;
  const originX = minX - margin;
  const originY = minY - margin;
  const w = Math.ceil((spanX + 2 * margin) / cell) + 1;
  const h = Math.ceil((spanY + 2 * margin) / cell) + 1;
  const grid = new Uint8Array(w * h);

  // ── Rasterize: closed interiors (scanline) + ink bodies (stamp) ──
  for (let i = 0; i < pool.length; i++) {
    const closed = closedFlags?.[i] ?? isClosedWorldLoop(pool[i]);
    // SELF-INTERSECTION GUARD (LOW-3): scanline even-odd fill of a SELF-CROSSING
    // loop produces a garbage interior (alternating filled/empty bands → a
    // crumpled solid). Only scanline-fill SIMPLE closed loops; a self-intersecting
    // one falls through to the ink-body stamp alone (a clean ribbon, the honest
    // read), never the bowtie. Simple closed loops are unaffected.
    if (closed && !loopSelfIntersectsXY(pool[i])) {
      scanlineFillPolygon(grid, w, h, originX, originY, cell, pool[i]);
    }
    stampInkBody(grid, w, h, originX, originY, cell, pool[i], inkRadius);
  }

  // ── Contours → classify ──
  const rawLoops = marchingSquaresLoops(grid, w, h).filter(
    (l) => loopArea(l) >= SOLID_MIN_LOOP_AREA,
  );
  if (rawLoops.length === 0) return null;

  // Containment depth: even = outer contour, odd = hole of its innermost
  // even-depth container. Loop points never coincide across loops (each
  // boundary midpoint has degree exactly 2), so the ray-cast is safe.
  const depths = containmentDepths(rawLoops);

  return { rawLoops, depths, originX, originY, cell };
}

/** FLOOD-FILL the paper region containing a world-space seed, bounded by the
 *  stamped ink (the proven Inkscape/bucket-fill model — see KNOWN-SOLUTIONS.md).
 *  Robust where the extract-all-then-pick path failed: a tap INSIDE a small
 *  nested shape floods ONLY that shape's interior (bounded by its ink, never the
 *  parent); a tap in the ring floods the ring with inner shapes as holes; a tap
 *  ON a line, or in the open outside, returns null (honest miss). The flood is
 *  the connected paper COMPONENT, so it's robust to region SIZE/nesting — no
 *  region tree to starve. inkRadius closes small gaps. Returns { outline, holes }
 *  in WORLD coords (cell-unit loops mapped back), or null. */
export function floodFillRegionAt(
  worldStrokes: THREE.Vector3[][],
  seedX: number,
  seedY: number,
  opts: { inkRadius?: number; resolution?: number; maxResolution?: number } = {},
): { outline: Array<[number, number]>; holes: Array<Array<[number, number]>> } | null {
  const inkRadius = opts.inkRadius ?? SOLID_INK_RADIUS;
  const resolution = Math.min(
    opts.resolution ?? SOLID_GRID_RESOLUTION,
    opts.maxResolution ?? SOLID_MAX_GRID_RESOLUTION,
  );
  const pool = worldStrokes.map(dedupeConsecutive).filter((s) => s.length > 0);
  if (pool.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of pool) {
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const cell = Math.max(spanX, spanY) / resolution;
  const margin = inkRadius + 2 * cell;
  const originX = minX - margin;
  const originY = minY - margin;
  const w = Math.ceil((spanX + 2 * margin) / cell) + 1;
  const h = Math.ceil((spanY + 2 * margin) / cell) + 1;
  const grid = new Uint8Array(w * h);
  for (const s of pool) stampInkBody(grid, w, h, originX, originY, cell, s, inkRadius);

  const sc = Math.floor((seedX - originX) / cell);
  const sr = Math.floor((seedY - originY) / cell);
  if (sc < 0 || sc >= w || sr < 0 || sr >= h) return null;
  if (grid[sr * w + sc] !== 0) return null; // seed on ink → honest miss

  // BFS flood over PAPER (grid==0) from the seed (4-connectivity — won't leak
  // through diagonal pinholes). If the flood reaches the (margin) border it's
  // the unbounded outside, not a fillable enclosed area → miss.
  const mask = new Uint8Array(w * h);
  const q: number[] = [sr * w + sc];
  mask[sr * w + sc] = 1;
  let touchedBorder = false;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = q[qi];
    const row = (idx / w) | 0;
    const col = idx - row * w;
    if (row === 0 || row === h - 1 || col === 0 || col === w - 1) touchedBorder = true;
    if (col > 0 && grid[idx - 1] === 0 && mask[idx - 1] === 0) { mask[idx - 1] = 1; q.push(idx - 1); }
    if (col < w - 1 && grid[idx + 1] === 0 && mask[idx + 1] === 0) { mask[idx + 1] = 1; q.push(idx + 1); }
    if (row > 0 && grid[idx - w] === 0 && mask[idx - w] === 0) { mask[idx - w] = 1; q.push(idx - w); }
    if (row < h - 1 && grid[idx + w] === 0 && mask[idx + w] === 0) { mask[idx + w] = 1; q.push(idx + w); }
  }
  if (touchedBorder) return null;

  const loops = marchingSquaresLoops(mask, w, h).filter((l) => loopArea(l) >= SOLID_MIN_LOOP_AREA);
  if (loops.length === 0) return null;
  // Largest-area loop = the flooded region's outer boundary; loops whose first
  // point sits inside it = holes (inner shapes the flood went around).
  const areas = loops.map((l) => loopArea(l));
  let outerI = 0;
  for (let i = 1; i < loops.length; i++) if (areas[i] > areas[outerI]) outerI = i;
  const outer = loops[outerI];
  const toWorld = ([cx, cy]: [number, number]): [number, number] => [originX + cx * cell, originY + cy * cell];
  const holes: Array<Array<[number, number]>> = [];
  for (let i = 0; i < loops.length; i++) {
    if (i === outerI) continue;
    const [hx, hy] = loops[i][0];
    if (pointInLoop(hx, hy, outer)) holes.push(loops[i].map(toWorld));
  }
  return { outline: outer.map(toWorld), holes };
}

/** Solid: rasterize ALL strokes into one binary grid (closed interiors
 *  scanline-filled + ink bodies stamped), extract contours via marching
 *  squares, classify outer/hole by containment depth, RDP-simplify, extrude.
 *  Overlapping strokes merge watertight (research §5b). Degenerate input or
 *  non-finite output falls back to Rod on the first stroke — same contract as
 *  the other builders. NOTE: per-stroke modes go through buildStrokeGeometry;
 *  this is POOL-level (one geometry for the whole drawing). */
export function buildSolidGeometry(
  worldStrokes: THREE.Vector3[][],
  opts: {
    inkRadius?: number;
    resolution?: number;
    depth?: number;
    /** Per-stroke closedness (pass viewBox-space isClosedStroke results when
     *  available); computed from world points when omitted. */
    closedFlags?: boolean[];
    rodRadius?: number;
    /** D2-B Holes toggle (rock-1 cross-contract, now a REAL engine option):
     *  true (default) preserves interior holes — donut stays a donut; false =
     *  filled silhouette (odd-depth loops are NOT subtracted). */
    holes?: boolean;
    /** Tier-2 edge family. Default 'eased' (today's rounded bevel). */
    edge?: SolidEdge;
  } = {},
): StrokeGeometryResult {
  const inkRadius = opts.inkRadius ?? SOLID_INK_RADIUS;
  const depth = opts.depth ?? EXTRUDE_DEPTH;
  const holesEnabled = opts.holes ?? true;
  const eased = (opts.edge ?? 'eased') === 'eased';
  const resolution = Math.min(opts.resolution ?? SOLID_GRID_RESOLUTION, SOLID_MAX_GRID_RESOLUTION);

  const pool = worldStrokes.map(dedupeConsecutive).filter((s) => s.length > 0);
  const fallback = () =>
    buildRodGeometry(pool[0] ?? [], { radius: opts.rodRadius });
  if (pool.length === 0) return fallback();

  try {
    const raster = rasterizePoolLoops(pool, inkRadius, resolution, opts.closedFlags);
    if (!raster) return fallback();
    const { rawLoops, depths, originX, originY, cell } = raster;

    const simplify = (loop: Array<[number, number]>): THREE.Vector2[] => {
      const open = [...loop, loop[0]] as Array<[number, number]>;
      // Staircase-collapse decimation THEN corner-aware multi-pass smoothing
      // (was: gentle RDP + a single Chaikin pass, which left the circle a
      // faceted ~45°-step polygon). The harder RDP removes the marching-squares
      // steps; multi-pass corner-aware Chaikin then rebuilds a TRUE smooth curve
      // on the rounded stretches while pinning real sharp corners (a drawn
      // square stays square — its corners are the farthest points RDP keeps).
      const simple = rdpPoints(open, SOLID_SMOOTH_DECIMATE_EPSILON_CELLS);
      simple.pop(); // re-open (Shape/Path close implicitly)
      const rounded = simple.length >= 3 ? smoothClosedLoopCornerAware(simple) : simple;
      return rounded.map(([x, y]) => new THREE.Vector2(originX + x * cell, originY + y * cell));
    };

    const shapes: THREE.Shape[] = [];
    const shapeDepths: number[] = [];
    const shapeLoops: Array<Array<[number, number]>> = [];
    for (let i = 0; i < rawLoops.length; i++) {
      if (depths[i] % 2 !== 0) continue;
      const pts = simplify(rawLoops[i]);
      if (pts.length < 3) continue;
      shapes.push(new THREE.Shape(pts));
      shapeDepths.push(depths[i]);
      shapeLoops.push(rawLoops[i]);
    }
    if (shapes.length === 0) return fallback();

    let holeCount = 0;
    for (let i = 0; i < rawLoops.length; i++) {
      if (!holesEnabled) break; // holes OFF → filled silhouette, nothing subtracts
      if (depths[i] % 2 !== 1) continue;
      // Innermost containing outer = the smallest-area outer that contains it.
      const [x, y] = rawLoops[i][0];
      let best = -1;
      let bestArea = Infinity;
      for (let s = 0; s < shapes.length; s++) {
        if (shapeDepths[s] === depths[i] - 1 && pointInLoop(x, y, shapeLoops[s])) {
          const a = loopArea(shapeLoops[s]);
          if (a < bestArea) {
            bestArea = a;
            best = s;
          }
        }
      }
      if (best < 0) continue;
      const pts = simplify(rawLoops[i]);
      if (pts.length < 3) continue;
      const path = new THREE.Path(pts);
      shapes[best].holes.push(path);
      holeCount++;
    }

    const geometry = new THREE.ExtrudeGeometry(shapes, {
      depth,
      bevelEnabled: eased,
      bevelSize: EXTRUDE_BEVEL_SIZE,
      bevelThickness: EXTRUDE_BEVEL_THICKNESS,
      bevelSegments: EXTRUDE_BEVEL_SEGMENTS,
      curveSegments: 12,
      steps: 1,
    });
    if (hasNonFinitePositions(geometry)) {
      geometry.dispose();
      throw new Error('solid produced non-finite positions');
    }
    geometry.translate(0, 0, -depth / 2); // share the z=0 plane with the other modes
    return { kind: 'solid', geometry, outerContours: shapes.length, holes: holeCount };
  } catch {
    return fallback();
  }
}

/** Pool-level convenience mirroring buildStrokeGeometry's front half:
 *  rdp simplify each stroke (viewBox space, where closure thresholds are
 *  calibrated) → compute closed flags → normalize to world → buildSolid. */
export function buildPoolSolidGeometry(
  strokes: StrokeInputPoint[][],
  opts: {
    viewBox?: ViewBoxSize;
    center?: { x: number; y: number };
    epsilon?: number;
    inkRadius?: number;
    resolution?: number;
    depth?: number;
    rodRadius?: number;
    /** D2-B Holes toggle passthrough (default true — donuts stay donuts). */
    holes?: boolean;
    /** Tier-2 edge family passthrough (default 'eased'). */
    edge?: SolidEdge;
  } = {},
): StrokeGeometryResult {
  const viewBox = opts.viewBox ?? DEFAULT_VIEWBOX;
  const simplified = strokes
    .filter((s) => s.length > 0)
    .map((s) => rdpPoints(s, opts.epsilon ?? RDP_EPSILON));
  const closedFlags = simplified.map((s) => isClosedStroke(s));
  const world = simplified.map((s) =>
    normalizeStrokePoints(s, viewBox, WORLD_SCALE, opts.center),
  );
  return buildSolidGeometry(world, {
    inkRadius: opts.inkRadius,
    resolution: opts.resolution,
    depth: opts.depth,
    closedFlags,
    rodRadius: opts.rodRadius,
    holes: opts.holes,
    edge: opts.edge,
  });
}

// ─── Region extraction (conversion-semantics addendum §1.2-1.3) ──────────────
// The pool raster as THE drawn-register region extractor for ALL modes:
// Extrude inherits donut holes from the same parity tree, Rod/Inflate get
// closure + containment facts, Solid keeps its path verbatim. Runs at
// conversion time; deterministic, so any cache (render_config summary) is an
// optimization, never a truth source — recompute always agrees (A-4).

/** Bump when the extraction algorithm changes — cache rows keyed on an older
 *  version recompute (the golden-gate pattern applied to caches, addendum
 *  §2.2). */
export const REGION_EXTRACTOR_VERSION = 1;

export interface ExtractedRegion {
  /** Closed outline in WORLD coords (y-up) — RDP-simplified + Chaikin-rounded,
   *  the same treatment Solid contours get. */
  outline: Array<[number, number]>;
  /** Containment depth (even = outer mass, odd = hole). */
  depth: number;
  role: 'outer' | 'hole';
  /** For holes: index (into regions) of the innermost containing outer —
   *  the solid this hole subtracts from. Null for outers / orphan holes. */
  parentIndex: number | null;
  /** Loop area in world units² (from the raw contour, pre-simplify). */
  areaWorld: number;
}

export interface RegionExtraction {
  extractorVersion: number;
  regions: ExtractedRegion[];
}

/** Extract the enclosed-region graph of a WORLD-space stroke pool via the
 *  Solid raster machinery. Near-misses fuse and T-junction gaps ≤ ink radius
 *  auto-close — the ink radius IS the tolerance (addendum §1.2 table). */
export function extractPoolRegions(
  worldStrokes: THREE.Vector3[][],
  opts: {
    inkRadius?: number;
    resolution?: number;
    closedFlags?: boolean[];
    /** CRISP mode (2026-06-13, fill-conform): skip the Chaikin corner-rounding
     *  pass so the region outline keeps the drawn shape's SHARP corners. The
     *  default (Chaikin on) rounds an RDP rectangle into an octagon/blob — fine
     *  for a soft 3D-solid contour, WRONG for a tone FILL that must conform to
     *  a drawn rectangle's corners (Sebs: "fill doesn't conform, edges not
     *  clean"). Fill passes crisp:true. */
    crisp?: boolean;
    /** Raise the grid-resolution ceiling above SOLID_MAX_GRID_RESOLUTION. The
     *  2D tone FILL passes a higher cap so sharp corners staircase the least
     *  (the white corner-notch bug, Sebs 2026-06-13); 3D solid keeps the
     *  default cap (mesh density / perf). */
    maxResolution?: number;
  } = {},
): RegionExtraction {
  const inkRadius = opts.inkRadius ?? SOLID_INK_RADIUS;
  const resolution = Math.min(opts.resolution ?? SOLID_GRID_RESOLUTION, opts.maxResolution ?? SOLID_MAX_GRID_RESOLUTION);
  const pool = worldStrokes.map(dedupeConsecutive).filter((s) => s.length > 0);
  if (pool.length === 0) return { extractorVersion: REGION_EXTRACTOR_VERSION, regions: [] };

  const raster = rasterizePoolLoops(pool, inkRadius, resolution, opts.closedFlags);
  if (!raster) return { extractorVersion: REGION_EXTRACTOR_VERSION, regions: [] };
  const { rawLoops, depths, originX, originY, cell } = raster;

  // Same simplify treatment as the Solid contours (RDP in cell units), mapped
  // to world coords. Chaikin corner-rounding runs UNLESS crisp mode is set —
  // crisp keeps the drawn shape's sharp corners so a FILL conforms to the
  // boundary instead of rounding into a blob.
  const simplifyToWorld = (loop: Array<[number, number]>): Array<[number, number]> => {
    const open = [...loop, loop[0]] as Array<[number, number]>;
    // CRISP (2D tone fill, another lane): gentle RDP + NO smoothing — conform
    // tightly to the drawn boundary, keep sharp corners verbatim. SMOOTHED (3D
    // solid / svg-port cap): staircase-collapse RDP + corner-aware multi-pass
    // Chaikin so the contour rim reads as a curve (not a facet polygon) while
    // real corners stay pinned.
    const eps = opts.crisp ? SOLID_RDP_EPSILON_CELLS : SOLID_SMOOTH_DECIMATE_EPSILON_CELLS;
    const simple = rdpPoints(open, eps);
    simple.pop();
    const rounded =
      opts.crisp || simple.length < 3 ? simple : smoothClosedLoopCornerAware(simple);
    return rounded.map(([x, y]) => [originX + x * cell, originY + y * cell]);
  };

  const regions: ExtractedRegion[] = rawLoops.map((loop, i) => ({
    outline: simplifyToWorld(loop),
    depth: depths[i],
    role: depths[i] % 2 === 0 ? ('outer' as const) : ('hole' as const),
    parentIndex: null,
    areaWorld: loopArea(loop) * cell * cell,
  }));

  // Hole → innermost containing outer (smallest-area container at depth − 1),
  // the same assignment rule buildSolidGeometry uses.
  for (let i = 0; i < rawLoops.length; i++) {
    if (depths[i] % 2 !== 1) continue;
    const [x, y] = rawLoops[i][0];
    let best = -1;
    let bestArea = Infinity;
    for (let j = 0; j < rawLoops.length; j++) {
      if (j === i || depths[j] !== depths[i] - 1) continue;
      if (pointInLoop(x, y, rawLoops[j])) {
        const a = loopArea(rawLoops[j]);
        if (a < bestArea) {
          bestArea = a;
          best = j;
        }
      }
    }
    if (best >= 0) regions[i].parentIndex = best;
  }

  return { extractorVersion: REGION_EXTRACTOR_VERSION, regions };
}

export interface StrokePoolRegionExtraction extends RegionExtraction {
  /** Per input stroke (post-RDP), the 3-state closure — the compact summary
   *  shape the addendum §1.3 render_config cache stores alongside the tree. */
  closureStates: ClosureState[];
}

/** ViewBox-space convenience mirroring buildPoolSolidGeometry's front half:
 *  rdp simplify → closure states → normalize (pool-centered) → extract.
 *  This is the cacheable conversion-time entry (addendum §1.3 — computed at
 *  Done, persisted, recompute-on-mismatch). */
export function extractStrokePoolRegions(
  strokes: StrokeInputPoint[][],
  opts: {
    viewBox?: ViewBoxSize;
    center?: { x: number; y: number };
    epsilon?: number;
    inkRadius?: number;
    resolution?: number;
  } = {},
): StrokePoolRegionExtraction {
  const viewBox = opts.viewBox ?? DEFAULT_VIEWBOX;
  const simplified = strokes
    .filter((s) => s.length > 0)
    .map((s) => rdpPoints(s, opts.epsilon ?? RDP_EPSILON));
  const closureStates = simplified.map((s) => closureStateOf(s));
  const center = opts.center ?? poolCenter(simplified, viewBox);
  const world = simplified.map((s) => normalizeStrokePoints(s, viewBox, WORLD_SCALE, center));
  const extraction = extractPoolRegions(world, {
    inkRadius: opts.inkRadius,
    resolution: opts.resolution,
    closedFlags: closureStates.map((c) => c !== 'open'),
  });
  return { ...extraction, closureStates };
}

// ─── Top-level convenience ───────────────────────────────────────────────────

/** Full per-stroke pipeline: rdp simplify → resolve mode → normalize → build.
 *  The scene component calls this once per stroke inside a useMemo. */
export function buildStrokeGeometry(
  points: StrokeInputPoint[],
  opts: {
    viewBox?: ViewBoxSize;
    mode?: GeometryModeSetting;
    /** Pool bbox center (poolCenter) — keeps multi-stroke layout intact. */
    center?: { x: number; y: number };
    epsilon?: number;
    radius?: number;
    depth?: number;
    /** Mid-stroke fullness for the explicit 'inflate' mode. */
    inflateRadius?: number;
    /** ARROW RULE chip override for the auto family pick (per-object flip). */
    treatAsClosed?: boolean;
    /** Engine option passthroughs (rock-1 cross-contract + Tier-2 families). */
    jointAngleThresholdDeg?: number;
    bevelProfile?: ExtrudeBevelProfile;
    sideWall?: ExtrudeSideWall;
    inflateProfileExp?: number;
    solidHoles?: boolean;
    solidEdge?: SolidEdge;
  } = {},
): StrokeGeometryResult {
  const viewBox = opts.viewBox ?? DEFAULT_VIEWBOX;
  const simplified = rdpPoints(points, opts.epsilon ?? RDP_EPSILON);
  const mode = resolveGeometryMode(opts.mode ?? 'auto', simplified, {
    treatAsClosed: opts.treatAsClosed,
  });
  const world = normalizeStrokePoints(simplified, viewBox, WORLD_SCALE, opts.center);
  if (mode === 'extrude') {
    return buildExtrudeGeometry(world, {
      depth: opts.depth,
      rodRadius: opts.radius,
      bevelProfile: opts.bevelProfile,
      sideWall: opts.sideWall,
    });
  }
  if (mode === 'inflate') {
    // Explicit-only (auto never lands here). Pressure rides the rdp-simplified
    // tuples — rdpPoints preserves index 2 — and modulates the capsule radius.
    // A forced-inflate on a closed-ish stroke stays an OPEN capsule whose tips
    // meet (croissant read) — that taper IS the mode's character.
    return buildInflateGeometry(world, {
      baseRadius: opts.inflateRadius,
      pressures: extractPressures(simplified),
      profileExp: opts.inflateProfileExp,
      rodRadius: opts.radius,
    });
  }
  if (mode === 'solid') {
    // Explicit-only. Solid is POOL-level by nature (overlapping strokes merge
    // — the scene calls buildPoolSolidGeometry); this branch keeps the
    // per-stroke API total with a single-stroke solid.
    // OPEN / SELF-INTERSECTING GUARD (LOW-3): a forced Solid on a single open or
    // self-intersecting stroke can't fill a clean silhouette (scanline even-odd
    // on a self-crossing loop is garbage) — fall back to Rod exactly like Auto /
    // forced-Extrude. A simple closed loop is unaffected.
    if (!isSlabEligible(world)) {
      return buildRodGeometry(world, {
        radius: opts.radius,
        closed: isClosedStroke(simplified),
      });
    }
    return buildSolidGeometry([world], {
      depth: opts.depth,
      closedFlags: [isClosedStroke(simplified)],
      rodRadius: opts.radius,
      holes: opts.solidHoles,
      edge: opts.solidEdge,
    });
  }
  // Rod: explicit pick keeps the tolerant ring closure (today's behavior); an
  // AUTO-resolved rod from the ambiguous band stays an OPEN tube — the gap is
  // the honest read (the chip welds it shut, not the engine).
  const closeRing =
    opts.mode !== undefined && opts.mode !== 'auto'
      ? isClosedStroke(simplified)
      : isSolidFamilyClosure(closureStateOf(simplified), opts.treatAsClosed);
  return buildRodGeometry(world, {
    radius: opts.radius,
    closed: closeRing,
    jointAngleThresholdDeg: opts.jointAngleThresholdDeg,
  });
}

// ─── Memo key ────────────────────────────────────────────────────────────────

/** Cheap synchronous key for useMemo deps (plan §1.1 — NOT lib/contentHash,
 *  which is async SHA-1 and overkill for a render memo). Stroke count +
 *  per-stroke length + endpoints catch every add/clear/edit the draw flow
 *  can produce. */
export function strokesKey(strokes: StrokeInputPoint[][]): string {
  return strokes.map(strokeSignature).join('|');
}
