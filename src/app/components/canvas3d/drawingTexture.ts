// ─── drawingTexture — drawn marks → bas-relief height field (CanvasTexture) ──
// REPLACES the RC-2 "raised glossy-ink tubes on the front face" stopgap. That
// overlay read as separate wires plopped ON TOP of the slab; this makes the
// drawing PART of the surface — the marks are carved/engraved into the front
// face as relief that the studio lights catch (continuous surface, not separate
// geometry).
//
// TECHNIQUE — digital bas-relief / displacement-from-drawing:
//   1. Rasterize the stroke pool to an offscreen 2D canvas (white = flat
//      surface level; ink strokes = darker = recessed grooves).
//   2. Wrap it in a THREE.CanvasTexture.
//   3. The scene uses it as a MeshStandardMaterial/MeshPhysicalMaterial
//      `bumpMap` on the extruded/solid FRONT FACE. bumpMap perturbs the
//      surface normal from the texture's grayscale gradient WITHOUT moving
//      geometry — "black and white values map to the perceived depth in
//      relation to the lights; bump doesn't actually affect the geometry, only
//      the lighting" (three.js MeshStandardMaterial.bumpMap docs). So a soft-
//      edged dark groove reads as ink pressed INTO the matte clay: the light
//      rolls down the groove wall and the eye reads relief.
//   4. (Optional) the same texture can drive a light `displacementMap` when the
//      front face is tessellated enough; for the makeathon the front cap is a
//      single triangulated fan (ExtrudeGeometry steps:1), so REAL displacement
//      would only move the silhouette ring — bump-only is the achievable
//      premium result and is what the scene applies.
//
// INK-BLACK POLICY (materials3d D2-E, ratified): the relief is LIGHT-DRIVEN.
// The body stays the single warm-graphite ink at one value; the drawing reads
// purely through how light sits on the carved relief, never through any colour
// or value change. This file produces a GRAYSCALE height field only — it is
// never sampled as colour.
//
// CITATIONS (research trail, 2026-06-13):
//   · three.js MeshStandardMaterial.bumpMap / bumpScale / displacementMap docs
//     (github.com/mrdoob/three.js src/materials/MeshStandardMaterial.js).
//   · Canvas → bumpMap pipeline: josdirksen/learning-threejs ch.10
//     10-canvas-texture-bumpmap (CanvasTexture as a live bump source).
//   · Bas-relief = 2D image → compressed height field the light reveals
//     (Region-based bas-relief generation from a single image; Real-time
//     Generation of Digital Bas-Reliefs, CAD Journal 7(4) 2010).

import * as THREE from 'three';
import {
  WORLD_SCALE,
  poolCenter,
  type StrokeInputPoint,
  type ViewBoxSize,
} from '../../lib/geometry3d/strokeTo3d';

/** World-space planar window the relief texture is rasterized FOR. The scene
 *  rewrites the body's front-face UVs as a planar projection over this exact
 *  window so the texture aligns to the carved marks with no manual offset. */
export interface ReliefWindow {
  minX: number;
  minY: number;
  spanX: number;
  spanY: number;
}

export interface DrawingReliefResult {
  texture: THREE.CanvasTexture;
  window: ReliefWindow;
}

/** Offscreen raster resolution along the longest world axis. 1024 keeps fine
 *  multi-feature drawings (eyes/nose/smile) crisp without a heavy upload. */
const TEXTURE_LONG_EDGE = 1024;
/** Margin (fraction of the long span) of flat surface kept around the marks so
 *  the carving never runs off the slab edge and the silhouette ring (whose UVs
 *  land on this margin) samples pure white = flat. */
const RELIEF_MARGIN = 0.06;
/** Groove ink width in world units, slightly fatter than the 2D pen so the
 *  carved line reads at slab scale. */
const GROOVE_WORLD_WIDTH = 0.05;
/** Soft blur radius (fraction of long edge) — gives each groove a graded wall
 *  the light rolls across, so bump reads as a bevelled channel, not a 1px cliff
 *  (the gradient is what the normal-from-height step turns into shading). */
const GROOVE_BLUR_FRAC = 0.006;

/** Build the bas-relief height-field texture for a stroke pool, sized/placed to
 *  the geometry's WORLD-space front-face bounding box.
 *
 *  @param strokes  raw strokes in viewBox coords (same pool the geometry built
 *                  from) — y-down, [x,y] or [x,y,pressure].
 *  @param viewBox  source coordinate space.
 *  @param bbox     the body geometry's WORLD bounding box (min/max x/y). The
 *                  texture window is this bbox padded by RELIEF_MARGIN so the
 *                  carving sits inside the silhouette.
 *  Returns null for an empty pool / degenerate bbox (caller renders the plain
 *  body — byte-identical to no-relief).
 */
export function buildDrawingReliefTexture(
  strokes: StrokeInputPoint[][],
  viewBox: ViewBoxSize,
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
): DrawingReliefResult | null {
  if (typeof document === 'undefined') return null; // SSR / non-DOM guard
  const pool = strokes.filter((s) => s.length > 0);
  if (pool.length === 0) return null;

  const rawSpanX = bbox.maxX - bbox.minX;
  const rawSpanY = bbox.maxY - bbox.minY;
  if (!(rawSpanX > 1e-6) || !(rawSpanY > 1e-6)) return null;

  // Pad the world window so the carving never touches the silhouette edge and
  // the side-wall UVs land on flat (white) margin.
  const longSpan = Math.max(rawSpanX, rawSpanY);
  const pad = longSpan * RELIEF_MARGIN;
  const win: ReliefWindow = {
    minX: bbox.minX - pad,
    minY: bbox.minY - pad,
    spanX: rawSpanX + pad * 2,
    spanY: rawSpanY + pad * 2,
  };

  // Canvas sized to the world window aspect, longest edge = TEXTURE_LONG_EDGE.
  const aspect = win.spanX / win.spanY;
  const longPx = TEXTURE_LONG_EDGE;
  const w = aspect >= 1 ? longPx : Math.max(8, Math.round(longPx * aspect));
  const h = aspect >= 1 ? Math.max(8, Math.round(longPx / aspect)) : longPx;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Flat surface level = WHITE (bumpMap: white = high / at-surface). Strokes are
  // carved BELOW it (darker = lower), so they read as engraved grooves.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // World → canvas px. World y is up; canvas y is down → flip y so the relief
  // is not mirrored vs the drawing. The same center the geometry used keeps the
  // raster registered to the mass.
  const center = poolCenter(pool, viewBox);
  const sx = w / win.spanX;
  const sy = h / win.spanY;
  const toCanvas = (vx: number, vy: number): [number, number] => {
    // viewBox → world (matches normalizeStrokePoints exactly):
    const wx = (vx - center.x) * WORLD_SCALE;
    const wy = -(vy - center.y) * WORLD_SCALE;
    // world → canvas px (y flipped: world-up → canvas-down).
    const cx = (wx - win.minX) * sx;
    const cy = h - (wy - win.minY) * sy;
    return [cx, cy];
  };

  // Groove ink width in canvas px (world width × px-per-world). Carved channels
  // are drawn in BLACK so the height field bottoms out in the groove.
  const grooveWidthPx = Math.max(2, GROOVE_WORLD_WIDTH * ((sx + sy) / 2));
  ctx.strokeStyle = '#000000';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = grooveWidthPx;

  for (const stroke of pool) {
    if (stroke.length === 1) {
      // Single-point stroke → a carved dot.
      const [cx, cy] = toCanvas(stroke[0][0], stroke[0][1]);
      ctx.beginPath();
      ctx.arc(cx, cy, grooveWidthPx / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#000000';
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    let started = false;
    for (const [vx, vy] of stroke) {
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
      const [cx, cy] = toCanvas(vx, vy);
      if (!started) {
        ctx.moveTo(cx, cy);
        started = true;
      } else {
        ctx.lineTo(cx, cy);
      }
    }
    if (started) ctx.stroke();
  }

  // Soft the groove walls so bump reads as a bevelled channel (graded normal),
  // not a hard 1px cliff. CSS filter blur on a 2D context is supported in
  // browsers; guarded so a context without filter support still ships a crisp
  // (still valid) height field.
  try {
    if ('filter' in ctx) {
      const blurPx = Math.max(1, Math.round(longPx * GROOVE_BLUR_FRAC));
      const blurred = document.createElement('canvas');
      blurred.width = w;
      blurred.height = h;
      const bctx = blurred.getContext('2d');
      if (bctx) {
        (bctx as CanvasRenderingContext2D & { filter: string }).filter = `blur(${blurPx}px)`;
        bctx.drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, w, h);
        (ctx as CanvasRenderingContext2D & { filter: string }).filter = 'none';
        ctx.drawImage(blurred, 0, 0);
      }
    }
  } catch {
    // crisp height field is an acceptable fallback — no throw to the scene.
  }

  const texture = new THREE.CanvasTexture(canvas);
  // Height field, NOT colour — keep linear so the gradient the bump step reads
  // is the literal pixel value (no sRGB curve warping the slope).
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  return { texture, window: win };
}

// ─── SVG-PORT — the real 2D styled render BECOMES the 3D surface ─────────────
// svg-port's contract (project_f3_shading_port_to_3d): port the ACTUAL
// SvgStyleTransform output onto the form — never a parallel shader (the killed
// hatchMaterial). Two hard parts (Sebs 2026-06-13): (1) feel FULLY 3D — the
// marks carved INTO the surface, wrapping on orbit; (2) RETAIN the 2D vibe —
// the hand-drawn hachure/ink, untouched by lighting.
//
// SHADING-INTERACTION (the crux Sebs flagged): the 2D shading is region-based
// source-darkness baked as CONTENT; the 3D rig adds a SECOND lambert tone →
// double-shading / wash-out. RESOLUTION: separate tone from dimensionality —
// the drawing rides EMISSIVE (unlit, value-exact, never re-shaded), while the
// carved RELIEF (displacement + Sobel normal) provides the 3D the light reveals.
// Head-on reads as the drawing; orbit reveals the carve = "became 3D, kept vibe."
//
// ONE raster, THREE registered channels (all over the SAME ReliefWindow so they
// co-locate via applyPlanarReliefUVs):
//   · emissiveMap  — the styled render (paper + ink), sRGB, the vibe.
//   · displacementMap — luminance of that render (paper bright = flat/high; ink
//     dark = recessed groove); real geometry on a tessellated cap.
//   · normalMap    — Sobel of the luminance; crisp groove walls so even head-on
//     the relief catches a hint of light without tessellation.

export interface SvgPortTextureResult {
  /** The styled 2D render (paper + ink), sRGB → emissiveMap. */
  emissive: THREE.CanvasTexture;
  /** Luminance height field (NoColorSpace) → displacementMap (SOFT, GPU path). */
  height: THREE.CanvasTexture;
  /** Sharper structure height (lighter blur) for the CPU deep-relief displacement
   *  on the welded mass — STEEPER (crisper) walls than `height`. Make-friendly
   *  crisp version; used by displaceFrontCapByHeight when relief depth > 0. */
  structureHeight?: THREE.CanvasTexture;
  /** Sobel-derived tangent normal map (NoColorSpace) → normalMap. */
  normal: THREE.CanvasTexture;
  window: ReliefWindow;
  /** treatMask primitive features (screen rect, button circles) in WORLD coords —
   *  for the manifold CSG path (V2) to subtract/union sheer-walled tool solids.
   *  Empty for freehand doodles (no primitives → CSG no-ops → V1 fallback). */
  treatFeatures?: TreatFeature[];
}

/** A classified treatMask primitive in world coords → a CSG tool solid. */
export interface TreatFeature {
  type: 'indent' | 'raise';
  shape: 'circle' | 'ellipse' | 'rect';
  /** World-space center (the relief window's plane). */
  cx: number;
  cy: number;
  /** Circle radius (world). */
  r?: number;
  /** Ellipse/rect half-extents (world). */
  rx?: number;
  ry?: number;
}

/** Displacement depth (world units) for the carved svg-port relief — how far
 *  ink grooves sink below the paper surface. Pair with displacementBias =
 *  −RELIEF_DISPLACEMENT_SCALE so WHITE(paper)=at-surface, BLACK(ink)=recessed.
 *  Eyeball-tunable. 0.13→0.15 (craft pass 2): with the adaptive carve no longer
 *  flooding dense fills, a slightly deeper push reads as a real carved channel on
 *  orbit. 0.18 still tears THIN line-art on the single-step cap (faceting/dashing
 *  on hairlines), so the heavy lifting of the "engraved" READ rides the steep-
 *  wall normalMap (geometry-free, never tears); 0.15 is the deep-but-safe pair.
 *  Boldness variants: subtle 0.13 · medium 0.15 · bold 0.17.
 *  R10 2026-06-15: 0.17→0.22→0.42 — only affects the two solid/extrude NATIVE
 *  objects (Pokéball band/button, Game Boy screen/buttons). A deep recess casts
 *  real shadow + glints on the glossy/lit black edge, so the engraving actually
 *  reads on the black form (Sebs: "engraving needs to be seen more"). */
export const RELIEF_DISPLACEMENT_SCALE = 0.42;

/** SVG-PORT displacement amplitude for the SIGNED 3-treatment height field
 *  (Sebs 2026-06-15). The field is now centered on 0.5 = FLAT (paired with
 *  displacementBias = −0.5·this in Stroke3DScene): a texel of 0.5 sits at the
 *  surface, 1.0 pushes OUT by +0.5·this (raised), 0.0 pushes IN by −0.5·this
 *  (deep indent). So the per-side amplitude is HALF this value.
 *  0.18→0.5: the old 0.18 was a one-sided recess depth where the WHOLE inked area
 *  (incl. thin lines) carved deep → tearing, so it was kept shallow. The signed
 *  field carves THIN LINES only shallowly (ENGRAVE_AMT) and reserves the deep push
 *  for broad FILLED areas (a screen/panel) which don't tear — so a bigger
 *  amplitude is now safe AND needed for an inset panel to read as a real recess.
 *  Native keeps RELIEF_DISPLACEMENT_SCALE (0.42, its own recess-only convention
 *  for now — Stage 2 ports the signed field there too). Eyes-on tunable. */
// 0.22→0.06 (Sebs 2026-06-15, research wq0iqh7ra): the displaced front-cap CLONE
// tears off the welded body at any real depth (topology problem — the proper fix
// is a single sealed welded mesh, post-makeathon). Near-flat displacement CAN'T
// tear by construction; the 3 relief layers + marks now read via the normalMap
// (light/shadow) + the crisp detail-LINES, exactly like the clean homepage native
// (bump=detail, minimal displacement). Deep geometric relief = post-makeathon.
// 0.06→0.09 (Sebs 2026-06-21 "scale it up a little for everything"): a touch more
// physical relief so the carving reads more dimensional across ALL styles. Still
// well below the tear threshold (the 0.5 original tore; the deep push stays on
// broad fills, thin lines stay shallow via ENGRAVE_AMT). Verified no-tear headed.
export const SVGPORT_DISPLACEMENT_SCALE = 0.09;

/** Global relief-depth BOOST (Sebs 2026-06-21 "scale it up a little for
 *  everything"). Multiplies every per-style carve depth (engrave/deep + the
 *  raise/indent treatments) so the relief reads punchier uniformly while
 *  preserving the per-style RATIOS (clean still shallowest, rough deepest, etc.).
 *  Kept modest — thin-line styles tear if the field amplitude runs away. */
export const CARVE_DEPTH_BOOST = 1.25;

// ── ADAPTIVE-CARVE constants (craft pass 2026-06-13) ────────────────────────
/** Min-filter half-width as a fraction of the long edge — the SPARSE-line
 *  fattener. 0.0045→0.006 (sparse-legibility pass 2026-06-13): a thin pen line
 *  on a near-white cap reads faint because the groove is too narrow to throw a
 *  shadow; a slightly wider fatten gives isolated hairlines a channel the rake
 *  catches, still below the dense-hachure spacing so it doesn't re-bridge fills. */
const GROOVE_FRAC = 0.01; // R10: 0.007→0.010 — fatter walls so a 1px line carves as a graded channel, not noise.
/** Neighborhood-luminance band that crossfades the carve from "fatten the
 *  groove" (open paper) to "keep the hachure grain, floor-lifted" (dense fill).
 *  Above DENSE_LO = sparse (full fatten); below DENSE_HI = dense (full grain).
 *  Tuned so a real hachure FILL (avg luminance ~0.4–0.6) lands inside the band. */
const DENSE_LO = 0.72;
const DENSE_HI = 0.42;
/** Darkest the carve may sink in a DENSE neighborhood (height 0=deepest…1=flat).
 *  A packed fill bottoms out at this dark-GREY value instead of pure black, so
 *  the displaced cap keeps a continuous wall the light rakes (texture), and the
 *  hachure stripe↔gap grain rides on top. The deep black is reserved for true
 *  isolated grooves where it reads as a crisp carved line, not a muddy pit.
 *  0.34→0.30 (sparse pass): a touch deeper so dense fills carve a little harder
 *  without flooding — verified still legible-not-black in the boldness board. */
const DENSE_FLOOR = 0.28;
/** Sobel normal z = 1/NORMAL_STRENGTH; LOWER = steeper groove walls = stronger
 *  carved read head-on. 0.85→0.6 (sparse pass): steeper walls so an isolated
 *  groove throws a bolder bright-edge/shadow-edge under the grazing key — the
 *  single biggest lever for "the marks read engraved head-on, not faint". */
const NORMAL_STRENGTH = 0.5;
/** Max bold-ink coverage — densest source ink lands at this grey, not pure ink,
 *  so emissive matches the floored carve (dark-grey, never flat black). 0.82→
 *  0.94 (sparse pass): the cap exists to stop a DENSE flood reading solid black;
 *  it was also needlessly weakening isolated marks. Raised here, and the SPARSE-
 *  INK-FLOOR below lifts isolated marks past it — dense stays grain, sparse goes
 *  near-ink. */
const BOLD_INK_MAX = 1.0;
/** SPARSE marks (low local density = isolated lines on open paper) get their ink
 *  coverage lifted to AT LEAST this, overriding BOLD_INK_MAX, so a thin face line
 *  reads as near-solid ink (the contrast that makes it legible) while a dense
 *  fill — where flooding-to-black is the risk — keeps the BOLD_INK_MAX cap and
 *  its stripe↔gap grain. This is the core sparse-faint fix: bold the lonely
 *  marks, cap the crowded ones. (0 = off → pure BOLD_INK_MAX everywhere.) */
const SPARSE_INK_FLOOR = 0.62;
/** Paper-substrate albedo dim (multiplies the paper fill of the emissive, NOT
 *  the ink). A near-white paper cap under the studio rig is GLOSSY-bright and
 *  washes shallow ink contrast (round-1 caveat). Dimming the paper to a warm
 *  mid-light grey restores the ink↔paper contrast frame so engraved marks pop —
 *  while the ink stays near-black, so the relief reads. 1 = no dim. */
const PAPER_DARKEN = 0.72;
/** AO / groove-shadow strength baked INTO the emissive. The carved relief has
 *  only a Sobel normal (no aoMap — that needs a 2nd UV channel we don't plumb);
 *  on a flat near-white cap the normal alone reads weak head-on. We darken the
 *  emissive in/around a groove proportional to how recessed it is, so every
 *  carved channel reads as a shadowed crevice even before the rake — the
 *  texture-space AO research lever. 0 = off. */
const AO_STRENGTH = 0.7;

// ── PER-STYLE CARVE PROFILE (Sebs 2026-06-20: "improve the differences") ─────
// DIAGNOSIS (style-diff research): every 2D style funnelled through ONE depth
// ramp (ENGRAVE_AMT→DEEP_AMT) + ONE wall shape + ONE normal strength, so the
// styles' inherent pixel differences got smoothed to the same surface — clean,
// rough, bold-ink and stipple all read as "one carved drawing". The EMISSIVE
// ink already differs per style (the markup IS the styled SvgStyleTransform
// output); what was uniform is the RELIEF. This table gives each style its own
// carved SURFACE so ONE light reads four (clean=crisp shallow V · rough=deep
// soft U · bold-ink=RAISED proud · stipple=round dimples) — the single cheapest
// lever for distinct 3D reads. Stays MONOCHROME (north-star): value from the
// relief + the same light, never hue/gloss. Fields:
//   engraveAmt   thin-line incision depth (height units below the 0.5 flat plane)
//   deepAmt      dense-fill incision depth (a tone/screen sinks this deep)
//   raise        marks push OUT (emboss) instead of IN (incise) — sign flip
//   wall         cov→depth remap: 'V' linear/crisp · 'U' eased/soft · 'round' domed
//   grooveBlurFrac  carve-wall softness (fraction of long edge; tight=crisp)
//   normalStrength  Sobel nz = 1/strength; LOWER = steeper walls = harder read
interface StyleCarveProfile {
  engraveAmt: number;
  deepAmt: number;
  raise: boolean;
  wall: 'V' | 'U' | 'round';
  grooveBlurFrac: number;
  normalStrength: number;
}
const DEFAULT_CARVE_PROFILE: StyleCarveProfile = {
  engraveAmt: 0.12, deepAmt: 0.46, raise: false, wall: 'V',
  grooveBlurFrac: GROOVE_BLUR_FRAC, normalStrength: NORMAL_STRENGTH,
};
const STYLE_CARVE_PROFILE: Record<string, StyleCarveProfile> = {
  // CRISP-SHALLOW family — thin precise marks, steep tight walls, little fill depth.
  clean:          { engraveAmt: 0.10, deepAmt: 0.34, raise: false, wall: 'V',     grooveBlurFrac: 0.004, normalStrength: 0.42 },
  'outline-only': { engraveAmt: 0.11, deepAmt: 0.22, raise: false, wall: 'V',     grooveBlurFrac: 0.004, normalStrength: 0.42 },
  wireframe:      { engraveAmt: 0.08, deepAmt: 0.14, raise: false, wall: 'V',     grooveBlurFrac: 0.003, normalStrength: 0.40 },
  // DEEP-SOFT family — scratchy organic marks, deep soft U-grooves, soft walls.
  'rough-handdrawn': { engraveAmt: 0.17, deepAmt: 0.52, raise: false, wall: 'U',  grooveBlurFrac: 0.009, normalStrength: 0.60 },
  sketchy:        { engraveAmt: 0.13, deepAmt: 0.42, raise: false, wall: 'U',     grooveBlurFrac: 0.008, normalStrength: 0.55 },
  charcoal:       { engraveAmt: 0.15, deepAmt: 0.50, raise: false, wall: 'U',     grooveBlurFrac: 0.011, normalStrength: 0.66 },
  'wet-ink':      { engraveAmt: 0.14, deepAmt: 0.46, raise: false, wall: 'round', grooveBlurFrac: 0.013, normalStrength: 0.70 },
  risograph:      { engraveAmt: 0.13, deepAmt: 0.40, raise: false, wall: 'V',     grooveBlurFrac: 0.006, normalStrength: 0.50 },
  // RAISED — confident felt-tip marks stand PROUD of the surface (emboss).
  'bold-ink':     { engraveAmt: 0.18, deepAmt: 0.44, raise: true,  wall: 'U',     grooveBlurFrac: 0.007, normalStrength: 0.50 },
  // DIMPLED — dot fills read as round pits (pointillist relief), deeper-per-dot.
  stipple:        { engraveAmt: 0.22, deepAmt: 0.30, raise: false, wall: 'round', grooveBlurFrac: 0.005, normalStrength: 0.50 },
  newsprint:      { engraveAmt: 0.17, deepAmt: 0.30, raise: false, wall: 'round', grooveBlurFrac: 0.005, normalStrength: 0.50 },
};
/** cov→depth remap implementing the wall shape (cheap, per-pixel). */
function carveWallRemap(cov: number, wall: 'V' | 'U' | 'round'): number {
  if (wall === 'U') return cov * cov * (3 - 2 * cov);     // smoothstep — flatter floor, soft shoulder
  if (wall === 'round') return Math.sqrt(cov < 0 ? 0 : cov); // domed — rolled edges (dimple/bleed)
  return cov;                                              // 'V' — linear, crisp
}

/** Inline externally-referenced <defs> (mask / filter / pattern / clipPath /
 *  gradient) into a DETACHED svg so it rasterizes SELF-CONTAINED. The styled
 *  markup references shared defs (TextureFilterDefs, mounted ONCE at the app root)
 *  by `url(#id)` / `href="#id"` — e.g. NEWSPRINT's dot mask + the dot pattern it
 *  references, CHARCOAL/WET-INK feTurbulence/feGaussianBlur filters, texture
 *  overlays. A standalone data-URL <img> can't see those external defs, so the
 *  mask/filter SILENTLY NO-OPS (newsprint rendered a solid form with NO dots —
 *  the carve had nothing to read). Pull each referenced def from the LIVE
 *  document, RECURSIVELY (a mask references a pattern), and append clones to this
 *  svg's own <defs>. No-op when nothing external is referenced (clean/rough/…) →
 *  those rasters are byte-identical. Returns the set of ids that ARE applied to
 *  the ROOT (mask/filter) so the treatMask clone can drop them (its geometry
 *  raster must not be dot-masked). */
function inlineExternalDefs(svgEl: SVGSVGElement, doc: Document): void {
  if (typeof document === 'undefined') return;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const URL_REF = /url\(\s*['"]?#([\w:-]+)['"]?\s*\)/g;
  const present = new Set<string>();
  svgEl.querySelectorAll('[id]').forEach((el) => present.add((el as Element).id));
  const queue: string[] = [];
  const seen = new Set<string>();
  const scan = (node: Element) => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.localName || attr.name;
      const val = attr.value;
      if ((name === 'href') && val.startsWith('#')) {
        const id = val.slice(1);
        if (id && !seen.has(id)) { seen.add(id); queue.push(id); }
        continue;
      }
      URL_REF.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = URL_REF.exec(val))) {
        const id = m[1];
        if (!seen.has(id)) { seen.add(id); queue.push(id); }
      }
    }
  };
  scan(svgEl);
  svgEl.querySelectorAll('*').forEach((el) => scan(el as Element));
  const collected: Element[] = [];
  while (queue.length) {
    const id = queue.shift() as string;
    if (present.has(id)) continue;             // already defined inside this svg
    const live = document.getElementById(id);
    if (!live) continue;                        // not in the live doc (already inline / external)
    const clone = doc.importNode(live, true) as Element;
    collected.push(clone);
    present.add(id);
    scan(clone);                                // a mask references a pattern → pull that too
    clone.querySelectorAll?.('*').forEach((el) => scan(el as Element));
  }
  if (!collected.length) return;
  let defs = svgEl.querySelector('defs');
  if (!defs) {
    defs = doc.createElementNS(SVG_NS, 'defs');
    svgEl.insertBefore(defs, svgEl.firstChild);
  }
  for (const node of collected) defs.appendChild(node);
}

/** Newsprint 3D dot-tile scale (Sebs 2026-06-21 "scale up a little"). The 2D
 *  halftone is fine print-screen dots; at relief/thumbnail scale they read faint,
 *  so the 3D build enlarges the dot TILE (and the dots within it, proportionally)
 *  for a punchier carved screen. 3D-ONLY — operates on the build's inlined CLONE
 *  of the pattern, so the 2D newsprint render is untouched. */
const NEWSPRINT_3D_DOT_SCALE = 1.6;
function scaleNewsprintDots(svgEl: SVGSVGElement, f: number): void {
  const pat = svgEl.querySelector('#dd-newsprint-dot-screen');
  if (!pat) return;
  const sw = parseFloat(pat.getAttribute('width') || '');
  const sh = parseFloat(pat.getAttribute('height') || '');
  if (Number.isFinite(sw) && sw > 0) pat.setAttribute('width', String(sw * f));
  if (Number.isFinite(sh) && sh > 0) pat.setAttribute('height', String(sh * f));
  pat.querySelectorAll('circle').forEach((c) => {
    for (const a of ['cx', 'cy', 'r']) {
      const v = parseFloat(c.getAttribute(a) || '');
      if (Number.isFinite(v)) c.setAttribute(a, String(v * f));
    }
  });
}

/** Build the svg-port channel textures from the REAL styled SvgStyleTransform
 *  markup, registered to the geometry's world front-face window. ASYNC — the
 *  SVG is rasterized via an Image (decode()). Returns null on SSR / empty pool /
 *  degenerate bbox / load failure (caller falls back to the plain body).
 *
 *  @param svgString  serialized styled <svg> (SvgStyleTransform output) — MUST
 *                    be self-contained (no foreignObject / external http href)
 *                    or the canvas taints and the GL upload fails.
 *  @param strokes    the same pool the geometry built from (for poolCenter).
 *  @param viewBox    source coordinate space (matches the svg's viewBox).
 *  @param bbox       the body geometry's WORLD bounding box.
 *  @param opts.paperColor  resolved --dir-bg hex; filled under the marks so the
 *                    front reads as the drawing (paper + ink), not bare body.
 */
export async function buildSvgPortTexture(
  svgString: string,
  strokes: StrokeInputPoint[][],
  viewBox: ViewBoxSize,
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  opts?: { paperColor?: string; styleId?: string; longEdge?: number },
): Promise<SvgPortTextureResult | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  const pool = strokes.filter((s) => s.length > 0);
  if (pool.length === 0 || !svgString) return null;

  // PER-STYLE CARVE PROFILE — the styled markup already differs per style; this
  // gives the RELIEF its own surface per style so the light reads them distinctly.
  const profile = (opts?.styleId && STYLE_CARVE_PROFILE[opts.styleId]) || DEFAULT_CARVE_PROFILE;

  // CALIBRATION-only tune (the catalog harness sets window.__svgPortCarveTune to
  // sweep the carve constants live without a rebuild; inert in the product where
  // the global is never set). Final values are the module constants above; the
  // lead applies those literals, not this hook.
  const ct =
    (typeof window !== 'undefined'
      ? (window as unknown as { __svgPortCarveTune?: Record<string, number> }).__svgPortCarveTune
      : undefined) ?? {};
  const denseFloor = ct.denseFloor ?? DENSE_FLOOR;
  const grooveFrac = ct.grooveFrac ?? GROOVE_FRAC;
  const boldMaxT = ct.boldMax ?? BOLD_INK_MAX;
  // normal/blur fall to the PER-STYLE profile (then the module const) so a live
  // tune-hook still wins for calibration.
  const normalStrengthT = ct.normalStrength ?? profile.normalStrength;
  // sparse-legibility levers (sparse pass 2026-06-13) — also tune-hook readable.
  const sparseInkFloorT = ct.sparseInkFloor ?? SPARSE_INK_FLOOR;
  const paperDarkenT = ct.paperDarken ?? PAPER_DARKEN;
  const aoStrengthT = ct.aoStrength ?? AO_STRENGTH;

  const rawSpanX = bbox.maxX - bbox.minX;
  const rawSpanY = bbox.maxY - bbox.minY;
  if (!(rawSpanX > 1e-6) || !(rawSpanY > 1e-6)) return null;

  // Same padded world window as the bas-relief raster (registration parity).
  const longSpan = Math.max(rawSpanX, rawSpanY);
  const pad = longSpan * RELIEF_MARGIN;
  const win: ReliefWindow = {
    minX: bbox.minX - pad,
    minY: bbox.minY - pad,
    spanX: rawSpanX + pad * 2,
    spanY: rawSpanY + pad * 2,
  };

  // Oversampled canvas (DPR-aware) so the vector marks stay crisp as a texture.
  const dpr = Math.min(typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1), 2);
  const aspect = win.spanX / win.spanY;
  // longEdge override (PERF, Sebs 2026-06-20 "get rid of lag"): the desk/drawer
  // thumbnails build at a SMALL fixed long edge (~180px display → 512 is ample,
  // 4–16× less pixel work than the full 1024·dpr — the dominant restyle cost),
  // while the edit modal (one big object, no burst) keeps the full resolution.
  const longPx = opts?.longEdge ?? Math.round(TEXTURE_LONG_EDGE * dpr);
  const w = aspect >= 1 ? longPx : Math.max(8, Math.round(longPx * aspect));
  const h = aspect >= 1 ? Math.max(8, Math.round(longPx / aspect)) : longPx;

  // World window → SVG viewBox sub-rect (inverse of normalizeStrokePoints).
  // world x = (vx − center.x)·WORLD_SCALE ; world y = −(vy − center.y)·WORLD_SCALE
  // → vx = wx/WORLD_SCALE + center.x ; vy = center.y − wy/WORLD_SCALE. World y is
  // up, viewBox y is down, so the window's world-max-Y is the sub-rect's TOP.
  const center = poolCenter(pool, viewBox);
  const worldMaxY = win.minY + win.spanY;
  const vMinX = win.minX / WORLD_SCALE + center.x;
  const vMinY = center.y - worldMaxY / WORLD_SCALE;
  const vW = win.spanX / WORLD_SCALE;
  const vH = win.spanY / WORLD_SCALE;
  // 3D-2: a degenerate / non-finite window or center would emit
  // viewBox="Infinity Infinity …" (browser parse error + blank raster). Bail →
  // the caller falls back to the plain lit body (same degenerate-bbox contract
  // the parse/origin guards below use).
  if (![vMinX, vMinY, vW, vH].every(Number.isFinite) || !(vW > 0) || !(vH > 0)) return null;

  // Re-root the styled svg onto the sub-rect viewBox at the canvas pixel size.
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  } catch {
    return null;
  }
  const svgEl = doc.documentElement as unknown as SVGSVGElement;
  if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') return null;
  // Origin-clean guard: external refs / foreignObject taint the canvas → blank.
  if (svgEl.querySelector('foreignObject, image[href^="http"], image[*|href^="http"]')) {
    return null;
  }
  // CSS-VAR RESOLUTION (else the marks vanish → blank slab): the styled render
  // paints ink/paper with var(--dir-text-primary)/var(--dir-bg), which are
  // UNDEFINED in a detached SVG rasterized via a data-URL Image. Copy the page's
  // resolved --dir-* tokens (+ the wrapper's --f3-* vars) onto the svg root so
  // they cascade to every mark and var() resolves at raster time.
  // W1 fallbacks (verbatim src/styles/theme.css :root) — if the page's computed
  // --dir-* are EMPTY (cold mount / detached doc / a test harness with no
  // stylesheet), every styled mark paints with an unresolved var() and the
  // drawing VANISHES → a blank slab (the "svg-port reads faint/blank" class).
  // Seed each token with the real W1 value so the marks ALWAYS resolve to ink.
  const DIR_FALLBACK: Record<string, string> = {
    '--dir-text-primary': '#121110', '--dir-bg': '#FDFCF9',
    '--dir-text-secondary': '#5F5B54', '--dir-text-body': '#383632',
    '--dir-text-body-soft': '#797369', '--dir-accent': '#121110',
    '--dir-border': '#E3DFD4', '--dir-muted': '#EBE7DC', '--dir-detail': '#878075',
    '--dir-raised': '#F9F7F3', '--dir-recessed': '#F3F0E8',
    '--dir-link-color': '#121110', '--dir-chip-bg': 'transparent',
    '--dir-chip-border': '#E3DFD4',
  };
  const resolvedDir: Record<string, string> = {};
  {
    const rootStyle =
      typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    let varStyle = '';
    for (const v of Object.keys(DIR_FALLBACK)) {
      const val = (rootStyle?.getPropertyValue(v).trim() || '') || DIR_FALLBACK[v];
      resolvedDir[v] = val;
      varStyle += `${v}:${val};`;
    }
    varStyle += '--f3-fill-opacity:1;--f3-stroke-width:1;';
    svgEl.setAttribute('style', `${varStyle}${svgEl.getAttribute('style') ?? ''}`);
  }
  // NATIVE-VIEWBOX REMAP (Sebs 2026-06-15 — the desk/catalog "black block" root
  // cause): the markup may be in its OWN viewBox (a catalog shape = "0 0 64 100"),
  // but vMinX..vH were computed in the ENGINE viewBox (the passed `viewBox`, 800×600
  // by default) because svgMarkupToStrokes FITS the markup into that target before
  // deriving the strokes/geometry. So the world→engine sub-rect lands OUTSIDE the
  // markup's native content → an empty raster (uniform block). Remap the sub-rect
  // from engine space → the markup's native space via the SAME xMidYMid-meet fit
  // svgMarkupToStrokes uses, so the raster hits the actual marks. No-op when the
  // markup is already in the engine viewBox (e.g. /canvas) → that path is untouched.
  let vbX = vMinX, vbY = vMinY, vbW = vW, vbH = vH;
  {
    const nvbRaw = svgEl.getAttribute('viewBox');
    const nvb = nvbRaw ? nvbRaw.trim().split(/[\s,]+/).map(Number) : null;
    if (nvb && nvb.length === 4 && nvb.every(Number.isFinite) && nvb[2] > 0 && nvb[3] > 0 &&
        (Math.abs(nvb[2] - viewBox.w) > 0.5 || Math.abs(nvb[3] - viewBox.h) > 0.5)) {
      const sc = Math.min(viewBox.w / nvb[2], viewBox.h / nvb[3]); // native → engine (meet)
      const ox = (viewBox.w - nvb[2] * sc) / 2 - nvb[0] * sc;
      const oy = (viewBox.h - nvb[3] * sc) / 2 - nvb[1] * sc;
      vbX = (vMinX - ox) / sc; vbY = (vMinY - oy) / sc; vbW = vW / sc; vbH = vH / sc;
    }
  }
  svgEl.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  svgEl.setAttribute('width', String(w));
  svgEl.setAttribute('height', String(h));
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // SELF-CONTAIN the raster: pull the styled markup's externally-referenced defs
  // (newsprint dot mask+pattern, charcoal/wet-ink filters, texture overlays) from
  // the live TextureFilterDefs into this svg, so the mask/filter actually applies
  // when rasterized standalone (else newsprint = solid form, no dots). No-op for
  // styles that reference nothing external (clean/rough/…) → byte-identical there.
  inlineExternalDefs(svgEl, doc);
  // Punch up newsprint's halftone for the relief (3D-only; 2D untouched).
  if (opts?.styleId === 'newsprint') scaleNewsprintDots(svgEl, NEWSPRINT_3D_DOT_SCALE);
  let serialized = new XMLSerializer().serializeToString(svgEl);
  // RESOLVE var(--dir-*) → concrete hex BEFORE rasterizing. CSS custom properties
  // referenced in SVG PRESENTATION ATTRIBUTES (e.g. stroke="var(--dir-text-primary)",
  // and var() inside color-mix()) do NOT resolve when the SVG is rasterized via a
  // data-URL <img> — the root-style seeding only covers CSS-property usage, not
  // presentation attrs. So STORED markup (desk/catalog/modal) painted every mark
  // with an unresolved var() → invisible → the uniform "BLACK BLOCK". (/canvas
  // markup already carried resolved colors, which is why it worked there only.)
  // Bake the resolved tokens in so the marks ALWAYS rasterize → svg-port lives the
  // drawing everywhere, not just /canvas.
  for (const [tok, hex] of Object.entries(resolvedDir)) {
    serialized = serialized.replace(new RegExp(`var\\(\\s*${tok}\\s*(?:,[^)]*)?\\)`, 'g'), hex);
  }
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  let img: HTMLImageElement;
  try {
    img = new Image();
    img.width = w;
    img.height = h;
    img.src = url;
    await img.decode();
  } catch {
    return null; // load/decode failure → caller renders plain body
  }

  // ── emissive: paper fill + the styled render = the drawing, value-exact ──
  const emCanvas = document.createElement('canvas');
  emCanvas.width = w;
  emCanvas.height = h;
  const emCtx = emCanvas.getContext('2d');
  if (!emCtx) return null;
  emCtx.fillStyle = opts?.paperColor ?? '#FDFCF9';
  emCtx.fillRect(0, 0, w, h);
  emCtx.drawImage(img, 0, 0, w, h);

  // ── height: luminance of the render (paper bright = flat; ink dark = groove) ──
  // Read once; build a grayscale ImageData and a Sobel normal in the same pass.
  let src: ImageData;
  try {
    src = emCtx.getImageData(0, 0, w, h); // throws if tainted (defensive)
  } catch {
    return null;
  }
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = src.data[i * 4], g = src.data[i * 4 + 1], b = src.data[i * 4 + 2];
    lum[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; // 0 ink … 1 paper
  }

  // ── RAISE MASK (Sebs 2026-06-15, the 3rd treatment): SMALL CLOSED shapes —
  // buttons, pads — should pop OUT, not sink. Render ONLY those (filled white)
  // through the SAME window → a mask; those pixels get a RAISED signed height
  // below. Large closed shapes (screen/body) + open strokes (lines/dpad) are
  // excluded → they engrave / indent as before. Per-element by GEOMETRY (robust —
  // the pixel-space heuristic was too fragile), keyed on signals not identity:
  // a small circle/ellipse/rect = a button. /canvas freehand doodles carry no such
  // primitives → no raise there (no regression). ──
  // treatMask: 0 = none (per-pixel engrave/tone) · 1 = INDENT interior (a mid-size
  // closed shape = a screen/window/panel → sink it) · 2 = RAISE interior (a small
  // closed shape = a button/pad → pop it out). The form's own big silhouette is
  // excluded (frac too large) so it stays the body, not a recess.
  let treatMask: Uint8Array | null = null;
  const treatFeatures: TreatFeature[] = [];
  // svg (re-rooted viewBox vbX..vbW, y-down) → WORLD relief-window coords (y-up).
  const sx2w = (sx: number) => win.minX + ((sx - vbX) / vbW) * win.spanX;
  const sy2w = (sy: number) => win.minY + win.spanY - ((sy - vbY) / vbH) * win.spanY;
  const sxr2w = (r: number) => (r / vbW) * win.spanX;
  const syr2w = (r: number) => (r / vbH) * win.spanY;
  try {
    const maskDoc = svgEl.cloneNode(true) as unknown as SVGSVGElement;
    // The treatMask is a GEOMETRY raster (white buttons on black) — strip the
    // root's visual mask/filter (e.g. newsprint's dot mask) so the raise/indent
    // classification reads the shapes, not a dot-screened version of them.
    maskDoc.removeAttribute('mask');
    maskDoc.removeAttribute('filter');
    const areaRef = Math.abs(vbW * vbH) || 1; // sub-rect span (markup-native units)
    const RAISE_MAX = 0.045, MIN = 0.0003, INDENT_MAX = 0.6; // area-fraction bands
    let any = false;
    const classify = (el: Element): 0 | 1 | 2 => {
      const tag = el.tagName.toLowerCase();
      let area = 0;
      if (tag === 'circle') { const r = parseFloat(el.getAttribute('r') || '0'); area = Math.PI * r * r; }
      else if (tag === 'ellipse') { const rx = parseFloat(el.getAttribute('rx') || '0'), ry = parseFloat(el.getAttribute('ry') || '0'); area = Math.PI * rx * ry; }
      else if (tag === 'rect') { const ww = parseFloat(el.getAttribute('width') || '0'), hh = parseFloat(el.getAttribute('height') || '0'); area = ww * hh; }
      else return 0; // only primitive closed shapes; lines/paths engrave per-pixel
      const frac = area / areaRef;
      if (frac <= MIN) return 0;
      if (frac < RAISE_MAX) return 2;          // small → raise (button)
      if (frac < INDENT_MAX) return 1;         // mid → indent (screen/panel)
      return 0;                                 // big = the form body itself
    };
    const collectFeature = (el: Element, t: 1 | 2) => {
      const tag = el.tagName.toLowerCase();
      const type: 'indent' | 'raise' = t === 2 ? 'raise' : 'indent';
      const num = (a: string) => parseFloat(el.getAttribute(a) || '0');
      if (tag === 'circle') {
        treatFeatures.push({ type, shape: 'circle', cx: sx2w(num('cx')), cy: sy2w(num('cy')), r: sxr2w(num('r')) });
      } else if (tag === 'ellipse') {
        treatFeatures.push({ type, shape: 'ellipse', cx: sx2w(num('cx')), cy: sy2w(num('cy')), rx: sxr2w(num('rx')), ry: syr2w(num('ry')) });
      } else if (tag === 'rect') {
        const x = num('x'), y = num('y'), ww = num('width'), hh = num('height');
        treatFeatures.push({ type, shape: 'rect', cx: sx2w(x + ww / 2), cy: sy2w(y + hh / 2), rx: sxr2w(ww) / 2, ry: syr2w(hh) / 2 });
      }
    };
    const walk = (parent: Element) => {
      for (const child of Array.from(parent.children)) {
        if (child.tagName.toLowerCase() === 'g') { walk(child); continue; }
        const t = classify(child);
        if (t === 2) { child.setAttribute('fill', '#fff'); child.setAttribute('stroke', 'none'); any = true; collectFeature(child, 2); }
        else if (t === 1) { child.setAttribute('fill', '#808080'); child.setAttribute('stroke', 'none'); any = true; collectFeature(child, 1); }
        else { child.setAttribute('fill', 'none'); child.setAttribute('stroke', 'none'); }
      }
    };
    walk(maskDoc);
    if (any) {
      const maskUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(maskDoc))}`;
      const mimg = new Image(); mimg.width = w; mimg.height = h; mimg.src = maskUrl;
      await mimg.decode();
      const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
      const mx = mc.getContext('2d');
      if (mx) {
        mx.fillStyle = '#000'; mx.fillRect(0, 0, w, h);
        mx.drawImage(mimg, 0, 0, w, h);
        const md = mx.getImageData(0, 0, w, h).data;
        treatMask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) { const v = md[i * 4]; treatMask[i] = v > 192 ? 2 : v > 64 ? 1 : 0; }
      }
    }
  } catch { treatMask = null; }
  // ── CARVE channel — ADAPTIVE so DENSE fills read as carved TEXTURE, not a
  // flooded flat-black pit, while SPARSE thin lines still fatten into legible
  // grooves. (Craft pass 2026-06-13, Sebs: dense→"dark CARVED texture grooves
  // catching light, not flat black mud"; sparse→"crisp legible carved grooves".)
  //
  // ROOT BUG (texture-dump diagnosed): the old carve was a pure separable MIN-
  // filter over GROOVE_R. For sparse marks that helpfully fattens. But for dense
  // hachure (line spacing ≈ GROOVE_R) the min-filter floods every gap → the whole
  // region collapses to the single darkest value = a FLAT-bottomed pit. No height
  // variation → displacement makes a flat recessed slab, the Sobel normal is
  // uniform → the raking light catches nothing → flat black mud (pitchDeckCover
  // measured spread=4). The hachure gaps the eye reads as texture were erased.
  //
  // FIX — three pieces, all derived from the SAME source luminance:
  //   1. minF  = separable min-filter (the fattener) over GROOVE_R, but SMALLER
  //      now (0.008→0.0045) so it widens hairlines without bridging dense lines.
  //   2. density = local box-average of lum over a wider radius (0 = dark/dense
  //      neighborhood … 1 = paper). Tells dense regions apart from sparse marks.
  //   3. carve = the FATTENED groove in SPARSE areas, but in DENSE areas we keep
  //      the RAW per-pixel luminance (preserves the hachure stripe↔gap structure
  //      = the texture the light catches) AND lift it off the black floor by
  //      DENSE_FLOOR so a dense fill becomes dark-GREY carved texture, never pure
  //      black. The fatten→raw crossover is driven by `density`, so a hairline in
  //      open paper gets the full deep groove while a dense field keeps its grain.
  const GROOVE_R = Math.max(2, Math.round(longPx * grooveFrac));
  // Density radius — a few groove-widths so it averages OVER the hachure spacing
  // (reads "this neighborhood is a fill", not "this is one line").
  const DENS_R = Math.max(4, Math.round(longPx * 0.018));
  const carveAndDensity = (() => {
    // (1) separable min-filter → minF (the fattened-groove field).
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let m = 1;
        for (let dx = -GROOVE_R; dx <= GROOVE_R; dx++) {
          const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
          const v = lum[row + xx];
          if (v < m) m = v;
        }
        tmp[row + x] = m;
      }
    }
    const minF = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = 1;
        for (let dy = -GROOVE_R; dy <= GROOVE_R; dy++) {
          const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
          const v = tmp[yy * w + x];
          if (v < m) m = v;
        }
        minF[y * w + x] = m;
      }
    }
    // (2) separable box-average of lum over DENS_R → density (running-sum, O(n)).
    const colAvg = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      const win = DENS_R * 2 + 1;
      for (let dy = -DENS_R; dy <= DENS_R; dy++) {
        const yy = dy < 0 ? 0 : dy >= h ? h - 1 : dy;
        acc += lum[yy * w + x];
      }
      colAvg[x] = acc / win;
      for (let y = 1; y < h; y++) {
        const add = (y + DENS_R < h ? y + DENS_R : h - 1) * w + x;
        const sub = (y - DENS_R - 1 >= 0 ? y - DENS_R - 1 : 0) * w + x;
        acc += lum[add] - lum[sub];
        colAvg[y * w + x] = acc / win;
      }
    }
    const density = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      const win = DENS_R * 2 + 1;
      for (let dx = -DENS_R; dx <= DENS_R; dx++) {
        const xx = dx < 0 ? 0 : dx >= w ? w - 1 : dx;
        acc += colAvg[row + xx];
      }
      density[row] = acc / win;
      for (let x = 1; x < w; x++) {
        const add = row + (x + DENS_R < w ? x + DENS_R : w - 1);
        const sub = row + (x - DENS_R - 1 >= 0 ? x - DENS_R - 1 : 0);
        acc += colAvg[add] - colAvg[sub];
        density[row + x] = acc / win;
      }
    }
    // (3) combine. denseW: 0 in open paper (use the deep fattened groove) → 1 in a
    // dense fill (use the raw hachure grain, floor-lifted). Smoothstep over the
    // band [DENSE_LO, DENSE_HI] of neighborhood luminance.
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const d = density[i];
      let t = (DENSE_LO - d) / (DENSE_LO - DENSE_HI); // d<HI→1 (dense), d>LO→0
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const denseW = t * t * (3 - 2 * t); // smoothstep
      // Dense path: raw luminance grain, lifted off the floor so the darkest a
      // packed fill can carve is DENSE_FLOOR (dark-grey, not 0=black). The
      // stripe↔gap variation rides on top → real catch-the-light texture.
      const denseCarve = denseFloor + lum[i] * (1 - denseFloor);
      // Sparse path: the deep fattened groove (hairlines read as bold channels).
      out[i] = minF[i] * (1 - denseW) + denseCarve * denseW;
    }
    // Return density too — the bold-ink pass uses it to lift ISOLATED marks past
    // the dense cap (SPARSE_INK_FLOOR) so sparse line-art reads near-ink.
    return { carve: out, density };
  })();
  let carve = carveAndDensity.carve;
  const density = carveAndDensity.density;

  // ── SIGNED 3-TREATMENT HEIGHT FIELD (Sebs 2026-06-15, the wedge) ───────────
  // Replace the luminance carve (a recess-ONLY height) with a REGION-TREATMENT
  // SIGNED field centered on 0.5 = FLAT surface: <0.5 pushed IN (indent), >0.5
  // pushed OUT (raised — Stage 2). Stage 1 is pixel-space (no DOM, works on ANY
  // svg-port input) and does TWO of the three treatments straight from fields we
  // already have:
  //   • a thin ink LINE (open neighborhood) → a SHALLOW engraved incision,
  //   • a FILLED AREA (dense neighborhood)  → an INDENT whose depth ∝ darkness
  //     (mid tone = shallow self-shadowing dent; a dark fill like a Game-Boy
  //     screen = a DEEP recess that reads near-black = an inset panel / hole),
  //   • bare paper → flat (0.5).
  // denseW (fill-vs-line) reuses the SAME density band the carve uses; depth from
  // the per-pixel darkness (one darkness model w/ the 2D — north-star). The box-
  // blur right below then smooths this into clean carved RAMPS before the height
  // / Sobel-normal pass (research: smoothstep ramp + smoothing = the fix for the
  // torn-etch hard-min facets). displacementBias is recentered to −0.5·scale in
  // Stroke3DScene so 0.5 = flat. Raised + deep/shallow SEMANTIC (contained→deep,
  // small-detached→raised) + the per-object override land in Stage 2 via the
  // data-smart-role / data-tone-band provenance already on the markup.
  {
    const ENGRAVE_AMT = profile.engraveAmt * CARVE_DEPTH_BOOST; // thin contour line: shallow incision (per-style, boosted)
    const DEEP_AMT = profile.deepAmt * CARVE_DEPTH_BOOST;       // dense dark fill (a screen): deepest incision (per-style, boosted)
    // RAISE styles (bold-ink) push marks OUT of the surface (emboss) instead of
    // incising IN — a sign flip on the per-pixel depth. The signed displacement
    // material (bias −0.5·scale) already supports >0.5 = raised. Same value read
    // (light/shadow on relief), opposite topology = a confident proud register.
    const dir = profile.raise ? 1 : -1;
    const sh = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      // PER-PIXEL ink → an incised groove, so the 2D's ACTUAL SHADING STRUCTURE is
      // carried faithfully (Sebs: "account for how the 2D handles shades — it can't
      // all be black"). The 2D builds tone with its technique (hatch density /
      // pressure / tone band): a LIGHT shade = a few sparse grooves, a DARK shade =
      // many denser/deeper grooves → the shade LEVELS read as DIFFERENT in 3D via
      // groove density + self-shadow, exactly how the 2D makes lighter/darker —
      // never flattened to one black dent (the smooth-basin mistake). Monochrome,
      // value from relief, no tint, no colour.
      let cov = (1 - lum[i] - 0.06) / 0.5;        // per-pixel ink presence 0..1
      cov = cov < 0 ? 0 : cov > 1 ? 1 : cov;
      cov = carveWallRemap(cov, profile.wall);    // per-style wall shape (V/U/round)
      // fill-vs-line: a fill/tone region may carve DEEPER than a thin contour line
      // (a screen sinks deeper than an outline), so its grooves cast more shadow.
      let dW = (DENSE_LO - density[i]) / (DENSE_LO - DENSE_HI);
      dW = dW < 0 ? 0 : dW > 1 ? 1 : dW;
      dW = dW * dW * (3 - 2 * dW);                // smoothstep
      const maxDepth = ENGRAVE_AMT + dW * (DEEP_AMT - ENGRAVE_AMT);
      sh[i] = 0.5 + dir * maxDepth * cov;         // incise IN (dir −1) or emboss OUT (dir +1) at every ink pixel
    }
    // TREATMENT overlay (the 3 layers): RAISE small closed shapes (buttons → pop
    // OUT, +height) and INDENT mid closed shapes (screen/panel → sink IN, −height).
    // The carveDisp blur below rounds the flat tops/floors into proud pads / inset
    // panels; the dark fill albedo + lit crown / shadowed floor read as button /
    // screen. Engraved lines (per-pixel) stay as-is where treatMask is 0.
    if (treatMask) {
      const RAISE_AMT = 0.30 * CARVE_DEPTH_BOOST;  // field units ABOVE the 0.5 flat plane (boosted)
      const INDENT_AMT = 0.38 * CARVE_DEPTH_BOOST; // field units BELOW → a deep inset panel (boosted)
      for (let i = 0; i < w * h; i++) {
        if (treatMask[i] === 2) sh[i] = 0.5 + RAISE_AMT;
        else if (treatMask[i] === 1) sh[i] = Math.min(sh[i], 0.5 - INDENT_AMT);
      }
    }
    carve = sh; // height canvas + Sobel normal below now read the signed field
  }

  // CARVE BLUR (Sebs 2026-06-15, diagnosis wccranuf1 fix A — the highest-leverage
  // svg-port artifact fix). The carve field is built from a hard MIN-filter
  // (stair-stepped, no anti-aliasing); the height map AND the Sobel normal both
  // read it RAW, so the steep-wall normal (× normalScale) turned pixel stairs into
  // HARSH facets — the "jagged / dashy / torn etch". The bas-relief sibling blurs
  // its walls and reads clean; svg-port never did. Soften `carve` with a small
  // separable box blur (mirrors GROOVE_BLUR_FRAC + the density box-average idiom
  // above) BEFORE height/normal, so walls become smooth ramps. The EMISSIVE map is
  // untouched → the 2D ink stays crisp; only the light response softens.
  {
    const blurR = Math.max(1, Math.round(longPx * profile.grooveBlurFrac));
    const win = blurR * 2 + 1;
    const tmpH = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let dx = -blurR; dx <= blurR; dx++) {
        const xx = dx < 0 ? 0 : dx >= w ? w - 1 : dx;
        acc += carve[row + xx];
      }
      tmpH[row] = acc / win;
      for (let x = 1; x < w; x++) {
        const add = row + (x + blurR < w ? x + blurR : w - 1);
        const sub = row + (x - blurR - 1 >= 0 ? x - blurR - 1 : 0);
        acc += carve[add] - carve[sub];
        tmpH[row + x] = acc / win;
      }
    }
    const blurred = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let dy = -blurR; dy <= blurR; dy++) {
        const yy = dy < 0 ? 0 : dy >= h ? h - 1 : dy;
        acc += tmpH[yy * w + x];
      }
      blurred[x] = acc / win;
      for (let y = 1; y < h; y++) {
        const add = (y + blurR < h ? y + blurR : h - 1) * w + x;
        const sub = (y - blurR - 1 >= 0 ? y - blurR - 1 : 0) * w + x;
        acc += tmpH[add] - tmpH[sub];
        blurred[y * w + x] = acc / win;
      }
    }
    carve = blurred;
  }

  // NOTE: RAISED treatment (small detached blob → pop OUT) is NOT done in pixel
  // space — a connected-components+size heuristic was tried and reverted (too
  // fragile: the cleanup blur fights small buttons, size floors misclassify). The
  // robust path is the PER-ELEMENT semantic layer (read each element's 2D role off
  // the markup → indent/raise/engrave + combos + override). Tracked, task #30.

  // ── INK COVERAGE → MONOCHROME PENCIL VALUE (Sebs 2026-06-15) ──────────────
  // The form is PURE INK-BLACK; the greyscale value EMERGES from the MARKS —
  // exactly how a pencil builds tone — never a flat surface tint. We compute a
  // per-pixel ink COVERAGE that (a) preserves the hachure stripe↔gap grain (it
  // reads the SOURCE luminance per pixel, so a fill stays hatching, not a slab),
  // and (b) lifts ISOLATED thin marks toward solid so a lonely face line never
  // anti-aliases away to a faint wash. That coverage is painted as LIGHT on the
  // black form: paper→black · ink mark→light · dense hatch→many light pixels =
  // a brighter region (density = value). This REPLACES the raw (1-lum) register
  // (which left thin marks faint) and folds in the old bold-ink/sparse-floor
  // pass — value now rides the bolded coverage, so every mark reads crisp.
  // POLARITY (Sebs 2026-06-15, live A/B flag): 'neg' = ink-BLACK form + LIGHT marks
  // (white-chalk-on-black — DRAMATIC, but shading INVERTS: a darker 2D region reads
  // LIGHTER in 3D = "the blob translates lighter"). 'pos' = PAPER form + DARK marks
  // (the literal 2D sketch — shading reads DARKER where you shaded darker, no
  // inversion). Default 'neg' (the accepted look); set window.__svgPortPolarity='pos'
  // to A/B the paper sketch live. Final base = Sebs's call (linked to the
  // line/feature/flat-tone treatment model).
  const polarity = (typeof window !== 'undefined'
    && (window as unknown as { __svgPortPolarity?: string }).__svgPortPolarity === 'pos')
    ? 'pos' : 'neg';
  const BOLD_MAX = boldMaxT;  // dense-fill ink/brightness cap (keeps grain, no blow-out)
  const INK_EDGE = 0.66;      // lum at/above which a pixel is bare paper (no value)
  // NEG ground = a DEEP-GRAPHITE form value (not literal 0=black): the value
  // ladder needs headroom BELOW the form so a filled INDENT can read DARKER than
  // the form (was the "blob translates lighter" inversion). Lines lift toward
  // white chalk; FILLED areas sink toward black by darkness; bare form = graphite.
  // Combined with the indent geometry + grazing key, a shade reads as a dark
  // recess, never a light blob. (≈v36 — reads near-black, not a grey "color".)
  const GROUND_V = 0.14;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    let covRaw = (INK_EDGE - lum[i]) / INK_EDGE;   // 1 at an ink core … 0 at paper
    covRaw = covRaw < 0 ? 0 : covRaw > 1 ? 1 : covRaw;
    // sparseness: density 1 = open paper (isolated mark) → 0 = dense fill. The
    // cap slides from BOLD_MAX (dense → keeps grain) up toward 1 for an isolated
    // mark, so sparse line-art reads near-solid (light in neg / dark in pos).
    const sparseness = density[i] < 0 ? 0 : density[i] > 1 ? 1 : density[i];
    const cap = Math.max(BOLD_MAX, sparseInkFloorT + (1 - sparseInkFloorT) * sparseness);
    const ink = covRaw * cap;                       // bolded ink coverage 0..1
    // fill-vs-line weight (same density band the height field uses): dW 1 = dense
    // filled AREA, 0 = isolated thin line. Lines wear the light chalk; fills do NOT
    // (their value comes from the indent), so the light mark fades out as dW rises.
    let dW = (DENSE_LO - density[i]) / (DENSE_LO - DENSE_HI);
    dW = dW < 0 ? 0 : dW > 1 ? 1 : dW;
    dW = dW * dW * (3 - 2 * dW);
    let v: number;
    if (polarity === 'pos') {
      v = Math.round(255 * (1 - ink));              // paper form, dark marks (A/B)
    } else {
      const darkness = 1 - lum[i];                  // 0 paper … 1 ink
      const lineLift = ink * (1 - dW);              // light chalk on LINES only
      let val = GROUND_V + (1 - GROUND_V) * lineLift; // graphite ground → chalk
      val *= 1 - 0.92 * (dW * darkness);            // FILLED areas sink toward black
      v = Math.round(255 * (val < 0 ? 0 : val > 1 ? 1 : val));
    }
    src.data[o] = v; src.data[o + 1] = v; src.data[o + 2] = v;
  }
  emCtx.putImageData(src, 0, 0); // emissive: neg=ink-black form+light marks · pos=paper form+dark marks

  // ── DISPLACEMENT vs NORMAL SPLIT (Sebs 2026-06-15: "the carving is being made as
  // scratch / polygon mess, not the shading"). FINE marks (lines, rough wobble,
  // hatch) must NOT move geometry — displacing high-frequency detail on the
  // tessellated cap facets/tears = the broken "polygon mess". So the DISPLACEMENT
  // reads a HEAVILY-blurred height (`carveDisp`): only the BIG smooth structure (a
  // screen recess, a raised pad) actually moves vertices → clean, no facets. The
  // NORMAL keeps the SHARP `carve` → the fine marks/rough still read ENGRAVED via
  // shading (normals don't move vertices → can't facet or tear). Same split the
  // clean homepage native uses (bump=detail, displacement=structure): rough reads
  // rough as SHADING, never as broken geometry. ──
  // Separable box-blur of a height field (the structure smoother). Pulled out so
  // we can build TWO at different radii: a SOFT one for the GPU clone cap (can't
  // tear at heavy blur) and a SHARP one for the CPU deep-relief displacement on the
  // WELDED mass (which can't tear, so it takes steeper = crisper walls).
  const boxBlurField = (srcF: Float32Array, R: number): Float32Array => {
    const win = R * 2 + 1;
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w; let acc = 0;
      for (let dx = -R; dx <= R; dx++) { const xx = dx < 0 ? 0 : dx >= w ? w - 1 : dx; acc += srcF[row + xx]; }
      tmp[row] = acc / win;
      for (let x = 1; x < w; x++) {
        const add = row + (x + R < w ? x + R : w - 1);
        const sub = row + (x - R - 1 >= 0 ? x - R - 1 : 0);
        acc += srcF[add] - srcF[sub]; tmp[row + x] = acc / win;
      }
    }
    const out = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let dy = -R; dy <= R; dy++) { const yy = dy < 0 ? 0 : dy >= h ? h - 1 : dy; acc += tmp[yy * w + x]; }
      out[x] = acc / win;
      for (let y = 1; y < h; y++) {
        const add = (y + R < h ? y + R : h - 1) * w + x;
        const sub = (y - R - 1 >= 0 ? y - R - 1 : 0) * w + x;
        acc += tmp[add] - tmp[sub]; out[y * w + x] = acc / win;
      }
    }
    return out;
  };
  // SOFT structure height (heavy blur) → GPU displacementMap; tear-safe on the
  // clone cap (sharp steps = "outer breaking off"). Crisp marks come via the normal.
  const carveDisp = boxBlurField(carve, Math.max(2, Math.round(longPx * 0.018)));
  // STRUCTURE height for the CPU deep-relief displacement on the WELDED mass.
  // RIM-FACET FIX (KS §1E, Sebs 2026-06-21, verified via dd-disp-blur-ab): the old
  // light blur (0.006) left HIGH-FREQUENCY height content — chiefly the outermost
  // ink stroke sitting on the silhouette — which the coarse tessellated cap can't
  // resolve, so the displacement faceted it into a SAWTOOTH CROWN at the rim (the
  // "jagged rim"). The mesh silhouette is already smoothed; the carve was the
  // culprit. Blurring the displacement field to 0.02 smooths those slopes so the
  // cap can resolve them as continuous geometry — the sawtooth crown is gone while
  // the panel/button + ring relief still read clearly (the inner-feature steps are
  // low-frequency, so the heavier blur barely softens them). FREE: boxBlurField is
  // a running-sum O(w·h) regardless of radius, so a wider blur costs nothing. Crisp
  // TRUE-vertical feature walls remain available via the V2 CSG path (reliefCsg).
  const dispBlurFrac = (typeof window !== 'undefined'
    && (window as unknown as { __svgPortDispBlur?: number }).__svgPortDispBlur)
    || 0.02;
  const carveDispSharp = boxBlurField(carve, Math.max(1, Math.round(longPx * dispBlurFrac)));

  // HATCH-BURIAL FIX (OFAT batch-1, 2026-06-23): a dense HATCH/cross-hatch region
  // is a DARK region in the blurred structure field, so depth ops (GPU + CPU
  // displacement AND the deep CSG, which all read these fields) recess it and bury
  // its hatch in the shadow — the "canary panel" that collapsed under every depth
  // factor in the OFAT. But a hatch region is TEXTURED (high local high-frequency
  // energy: alternating ink lines + paper gaps) where a SOLID fill is uniform. So:
  // measure regional high-freq energy = how much the raw `carve` deviates from its
  // local average, smoothed to a region scale; then FLATTEN high-texture regions
  // toward 0.5 (flat) in the STRUCTURE field. Result — hatch panels no longer
  // recess (their texture stays on the NORMAL map as lit surface detail), while
  // SOLID dark regions (low texture, e.g. a Game Boy screen) are untouched and
  // still carve crisply. Fixes displacement + CSG at the source. FREE-ish (2 box
  // blurs, O(w·h)). Tunable / disable via window.__svgPortTextureFlatten = 0.
  const flattenAmt = typeof window !== 'undefined'
    && (window as unknown as { __svgPortTextureFlatten?: number }).__svgPortTextureFlatten === 0
    ? 0
    : ((typeof window !== 'undefined'
      && (window as unknown as { __svgPortTextureFlatten?: number }).__svgPortTextureFlatten) || 1);
  const flattenTextured = (field: Float32Array): Float32Array => {
    if (flattenAmt <= 0) return field;
    const hf = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { const d = carve[i] - field[i]; hf[i] = d < 0 ? -d : d; }
    const tex = boxBlurField(hf, Math.max(3, Math.round(longPx * 0.035))); // regional texture energy
    const T0 = 0.012, T1 = 0.05; // energy → flatten ramp (hatch panels land above T1)
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      let t = (tex[i] - T0) / (T1 - T0); t = t < 0 ? 0 : t > 1 ? 1 : t;
      t = t * t * (3 - 2 * t) * flattenAmt; // smoothstep × amount
      out[i] = field[i] + (0.5 - field[i]) * t; // pull textured regions toward flat
    }
    return out;
  };
  const carveDispFlat = flattenTextured(carveDisp);
  const carveDispSharpFlat = flattenTextured(carveDispSharp);

  const mkHeightCanvas = (field: Float32Array): HTMLCanvasElement | null => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx2 = c.getContext('2d');
    if (!cx2) return null;
    const d = cx2.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(field[i] * 255);
      d.data[i * 4] = v; d.data[i * 4 + 1] = v; d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255;
    }
    cx2.putImageData(d, 0, 0);
    return c;
  };
  const htCanvas = mkHeightCanvas(carveDispFlat);
  const structHtCanvas = mkHeightCanvas(carveDispSharpFlat);
  if (!htCanvas || !structHtCanvas) return null;

  // ── normal: 3×3 Sobel over the CARVE field → tangent-space normal (RGB) ──
  // Groove walls (the fattened gradient) become surface tilt the key light rakes.
  // STEEPER walls 1.4→0.85 (deep-carve pass): lower nz tilts the groove-wall
  // normals harder away from the surface, so the raking key catches a bold
  // bright-edge / shadow-edge on every channel — the carve reads even head-on,
  // before any orbit. (Paired with the higher material normalScale below.)
  const normalStrength = normalStrengthT; // lower = steeper walls = stronger carved read (module const / tune)
  const nmCanvas = document.createElement('canvas');
  nmCanvas.width = w;
  nmCanvas.height = h;
  const nmCtx = nmCanvas.getContext('2d');
  if (!nmCtx) return null;
  const nmData = nmCtx.createImageData(w, h);
  const at = (x: number, y: number) => carve[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), bb = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * bb + br) - (tl + 2 * t + tr);
      // height ∝ luminance (paper high), so a groove (dark) dips → invert grad.
      let nx = -dx, ny = -dy, nz = 1 / normalStrength;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      nmData.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      nmData.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      nmData.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      nmData.data[i + 3] = 255;
    }
  }
  nmCtx.putImageData(nmData, 0, 0);

  const mk = (canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };

  // DEBUG (calibration only): dump the built channels so a harness can inspect
  // what the cheek/screen pixels ACTUALLY are (albedo vs lighting artifact).
  // Gated on a window flag → inert in the product.
  if (typeof window !== 'undefined' && (window as unknown as { __svgPortDebug?: boolean }).__svgPortDebug) {
    (window as unknown as { __svgPortDebugURLs?: Record<string, string> }).__svgPortDebugURLs = {
      emissive: emCanvas.toDataURL(),
      height: htCanvas.toDataURL(),
      normal: nmCanvas.toDataURL(),
      svg: svgString,
      serialized, // the ACTUAL re-rooted + var-resolved svg that gets rasterized
      meta: JSON.stringify({ w, h, vMinX, vMinY, vW, vH, pool: pool.length,
        win, bbox, center }),
    };
  }

  return {
    emissive: mk(emCanvas, true),
    height: mk(htCanvas, false),
    structureHeight: mk(structHtCanvas, false),
    normal: mk(nmCanvas, false),
    window: win,
    treatFeatures: treatFeatures.length ? treatFeatures : undefined,
  };
}

/** Rewrite a body geometry's UV attribute as a PLANAR projection from world xy
 *  over the relief window, so the bas-relief texture aligns to the carved marks
 *  on the FRONT FACE with zero manual offset.
 *
 *  ExtrudeGeometry's default WorldUVGenerator emits front/back-face UVs as raw
 *  world (x,y) and side-wall UVs along the perimeter — neither maps to a 0..1
 *  drawing window. We overwrite ALL vertices with u=(x−minX)/spanX,
 *  v=(y−minY)/spanY: the front cap gets the registered drawing; the silhouette
 *  walls/back (whose xy sits on the mass boundary, inside the white margin)
 *  sample white = flat → relief appears only where the marks are. World y is
 *  up = texture v up, matching the y-flip baked into the raster.
 *
 *  Pure side-effect on the geometry's uv buffer; returns nothing. Idempotent
 *  for a given window (recomputes from position each call). */
/** PHASE 2 (Sebs 2026-06-20) — CPU-displace the FRONT cap of the (sealed) pool
 *  mass by the height field, instead of GPU-displacing a separate clone cap that
 *  tears at depth. Only flat front-facing vertices (normal.z ≳ 0.9) move; the
 *  bevelled rim + skirt + back stay put, so the mesh stays welded and can take
 *  REAL depth without the cap separating. Matches the GPU formula
 *  z += scale·(h − 0.5) (0.5 = flat) so the look is the same, just on the welded
 *  body. FLAG-GATED off by default (window.__sealedRelief) — see Stroke3DScene.
 *  ⚠️ The canvas-row flip vs the texture's flipY is the one thing that can't be
 *  proven headless; if the relief reads upside-down, flip the `1 - v` below. */
export function displaceFrontCapByHeight(
  geom: THREE.BufferGeometry,
  heightCanvas: HTMLCanvasElement,
  win: ReliefWindow,
  scale: number,
): void {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
  const nor = geom.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!pos || !nor || win.spanX <= 0 || win.spanY <= 0) return;
  const ctx = heightCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const W = heightCanvas.width, H = heightCanvas.height;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, W, H).data;
  } catch {
    return; // canvas tainted / readback blocked → leave geometry flat (GPU path covers it)
  }
  const sample = (u: number, v: number): number => {
    const px = Math.min(W - 1, Math.max(0, Math.round(u * (W - 1))));
    // canvas row 0 = world maxY (top); world minY (v=0) = bottom row.
    const py = Math.min(H - 1, Math.max(0, Math.round((1 - v) * (H - 1))));
    return data[(py * W + px) * 4] / 255; // R channel = luminance height (0.5 = flat)
  };
  const count = pos.count;
  for (let i = 0; i < count; i++) {
    if (nor.getZ(i) < 0.9) continue; // skip bevel/skirt/back → rim flat, no tear
    const u = (pos.getX(i) - win.minX) / win.spanX;
    const v = (pos.getY(i) - win.minY) / win.spanY;
    pos.setZ(i, pos.getZ(i) + scale * (sample(u, v) - 0.5));
  }
  pos.needsUpdate = true;
}

/** True when the deep-relief (CPU front-cap displacement) path is enabled — a
 *  dev/eval flag (window.__sealedRelief), default OFF so nothing changes until
 *  Sebs flips it to judge. window.__sealedReliefTune.scale overrides the depth. */
export function sealedReliefOn(): boolean {
  return typeof window !== 'undefined' &&
    !!(window as unknown as { __sealedRelief?: unknown }).__sealedRelief;
}
export function sealedReliefScale(): number {
  const t = typeof window !== 'undefined'
    ? (window as unknown as { __sealedReliefTune?: { scale?: number } }).__sealedReliefTune
    : undefined;
  return t?.scale ?? 0.3;
}

export function applyPlanarReliefUVs(
  geometry: THREE.BufferGeometry,
  win: ReliefWindow,
): void {
  const pos = geometry.getAttribute('position');
  if (!pos) return;
  const count = pos.count;
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uv[i * 2] = (x - win.minX) / win.spanX;
    uv[i * 2 + 1] = (y - win.minY) / win.spanY;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  (geometry.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
}

/** bumpScale for the relief — how hard the carved grooves catch the light.
 *  RAISED 0.9→2.2 (deep-carve pass, Sebs "native shouldn't bury the drawing in
 *  a featureless dark blob"): on the dark single-ink body the old 0.9 bump was
 *  near-invisible under the high studio key. A much stronger perturbation +
 *  the native grazing key (Stroke3DScene) make the carved drawing catch a bold
 *  highlight/shadow on every groove wall — the drawing READS on the slab, while
 *  the body stays one ink value (relief is light-driven, never colour).
 *  R10 2026-06-15: 2.2→3.0→5.0 — svg-port carve renders grey (emissive lifts off
 *  black, Sebs rejected). So the BLACK native bas-relief bump is the only
 *  ink-safe carve. Cranked to 5.0 so the Game Boy screen/buttons + the Pokéball
 *  band/button read as bold engraved edges on the black at thumbnail size — the
 *  body stays pure ink (bump is light-driven, never colour). */
export const RELIEF_BUMP_SCALE = 5.0;
