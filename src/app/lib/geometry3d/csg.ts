import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TreatFeature, ReliefWindow } from '../../components/canvas3d/drawingTexture';
// The proven marching-squares contour tracer (the flood-fill region path uses it) —
// reused to pull a freehand doodle's STRUCTURAL regions out of the height field.
import { marchingSquaresLoops, loopArea } from '../fill/regionFill';
// Vite-resolved URL of manifold's WASM binary. Emscripten's default fetch path is
// wrong under a bundler → it loaded an HTML 404 as wasm ("expected magic word").
// Passing this via `locateFile` points it at the real emitted asset.
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';

// ─── manifold-3d CSG relief (Phase 2 Step 4 — V2, Sebs 2026-06-21) ────────────
// The Make-friendly relief (V1) gives STEEP RAMPS (cap displacement). This gives
// TRUE VERTICAL WALLS: import the welded slab into manifold-3d, then per treatMask
// feature subtract a tool solid (a sunk screen panel) or union a low boss (a proud
// button). manifold guarantees a WATERTIGHT result → safe for GLB export + can't
// crack. LAZY-LOADED WASM (~1.5MB) only when CSG is actually requested; ANY failure
// (load, non-manifold input, op error) returns null so the caller falls back to V1
// — the Rapier-precedent safety net (never crash, degrade to the geometry path).
//
// ⚠️ The Make-PREVIEW-iframe cold-load race (the Rapier failure mode) can only be
// confirmed by a Make deploy. Locally (Node + headed Chrome) manifold loads fine.

/* eslint-disable @typescript-eslint/no-explicit-any */

let modPromise: Promise<any | null> | null = null;
/** Lazy-load + setup the manifold WASM once; cache the module. null on failure. */
export function loadManifold(): Promise<any | null> {
  if (!modPromise) {
    modPromise = (async () => {
      try {
        const Module = (await import('manifold-3d')).default;
        const wasm = await Module({ locateFile: () => manifoldWasmUrl });
        wasm.setup();
        if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__manifoldLoaded = true;
        return wasm;
      } catch (e) {
        // WASM unavailable / blocked (e.g. the Make cold-load race) → caller uses V1.
        if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__manifoldLoaded = String(e).slice(0, 80);
        return null;
      }
    })();
  }
  return modPromise;
}

/** Is manifold loadable here at all (browser with WASM)? Cheap pre-check. */
export function csgAvailable(): boolean {
  return typeof WebAssembly !== 'undefined';
}

interface CsgReliefOpts {
  /** Front-face world z (top of the slab) — tools cut from / build on this plane. */
  frontZ: number;
  /** Slab thickness (front−back) — the indent is capped to leave a floor. */
  thickness: number;
  /** Relief depth scalar (the 3D-controls slider) → indent/raise amounts. */
  depth: number;
}

/** Build a manifold tool solid for one feature, positioned on the front plane. */
function featureTool(wasm: any, f: TreatFeature, frontZ: number, thickness: number, depth: number): any | null {
  const { Manifold } = wasm;
  const EPS = 0.02;
  // INDENT cuts DOWN from the front by `sink` — CAPPED so a deep screen always
  // leaves ≥30% slab floor (never punches through into a hole). RAISE builds UP.
  const sink = Math.min(Math.max(0.04, depth * 1.1), thickness * 0.7);
  const rise = Math.max(0.03, depth * 0.7);
  const isIndent = f.type === 'indent';
  const amt = isIndent ? sink : rise;
  const h = amt + EPS * 2;
  // z-center so the tool spans [frontZ - sink, frontZ + EPS] (indent) or
  // [frontZ - EPS, frontZ + rise] (raise).
  const cz = isIndent ? (frontZ - sink / 2) : (frontZ + rise / 2);
  let tool: any;
  if (f.shape === 'circle') {
    const r = Math.max(1e-3, f.r ?? 0.05);
    tool = Manifold.cylinder(h, r, r, 40, true);
  } else if (f.shape === 'ellipse') {
    const rx = Math.max(1e-3, f.rx ?? 0.05), ry = Math.max(1e-3, f.ry ?? 0.05);
    tool = Manifold.cylinder(h, 1, 1, 40, true).scale([rx, ry, 1]);
  } else {
    const rx = Math.max(1e-3, f.rx ?? 0.05), ry = Math.max(1e-3, f.ry ?? 0.05);
    tool = Manifold.cube([rx * 2, ry * 2, h], true);
  }
  return tool.translate([f.cx, f.cy, cz]);
}

/** THREE geometry → a manifold-importable mesh. CRITICAL: strip to POSITION-ONLY
 *  before welding — split normals/UVs at creases (the slab corners) block
 *  mergeVertices from welding by position, leaving an open mesh that manifold
 *  rejects as NotManifold. Position-only welds the slab watertight. */
function toManifoldMesh(wasm: any, geom: THREE.BufferGeometry): any {
  const posOnly = new THREE.BufferGeometry();
  posOnly.setAttribute('position', (geom.getAttribute('position') as THREE.BufferAttribute).clone());
  if (geom.index) posOnly.setIndex(geom.index.clone());
  const g = mergeVertices(posOnly);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const vertProperties = new Float32Array(pos.array as ArrayLike<number>);
  const triVerts = g.index
    ? new Uint32Array(g.index.array as ArrayLike<number>)
    : new Uint32Array(pos.count);
  if (!g.index) for (let i = 0; i < pos.count; i++) triVerts[i] = i;
  return new wasm.Mesh({ numProp: 3, vertProperties, triVerts });
}

/** manifold → THREE BufferGeometry (position + computed normals). */
function fromManifold(manifold: any): THREE.BufferGeometry {
  const m = manifold.getMesh();
  const numProp: number = m.numProp;
  const nVert: number = m.numVert;
  const vp: Float32Array = m.vertProperties;
  const positions = new Float32Array(nVert * 3);
  for (let i = 0; i < nVert; i++) {
    positions[i * 3] = vp[i * numProp];
    positions[i * 3 + 1] = vp[i * numProp + 1];
    positions[i * 3 + 2] = vp[i * numProp + 2];
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  geom.computeVertexNormals();
  return geom;
}

/** Pull a doodle's STRUCTURAL relief regions out of a SOFT height field as world-XY
 *  contour polygons (recess + raise), so ANY doodle — not just primitive-classified
 *  features — gets crisp CSG walls. KEY: read the SOFT (heavily-blurred) height
 *  field, NOT the sharp one — fine lines/hatch are blurred away there, so the
 *  thresholded regions are the big STRUCTURE (basins / filled tonal areas /
 *  silhouette). Fine line-detail stays on the normal map (Phase-2 §2c structure-vs-
 *  detail split — that's why rough doodles don't tear). Tiny loops are dropped as
 *  noise. Canvas row 0 = world maxY, so Y is flipped back to world. */
function extractReliefContours(
  heightCanvas: HTMLCanvasElement,
  win: ReliefWindow,
): { recess: [number, number][][]; raise: [number, number][][] } | null {
  const W = heightCanvas.width, H = heightCanvas.height;
  if (W < 4 || H < 4) return null;
  const ctx = heightCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, W, H).data; } catch { return null; }
  // NOTE (OFAT batch-1 hatch-burial, 2026-06-23): a darkness THRESHOLD cannot
  // separate a dense HATCH panel from a SOLID panel here — in the soft height
  // field a dense hatch averages as dark as a solid fill (the blur erased the
  // line/gap variance that distinguishes them). The real fix is a HIGH-FREQUENCY
  // / variance signal from an UN-blurred field (exclude high-variance = textured
  // regions from the deep carve, keep them on the normal map) — a plumbing build,
  // tracked as a follow-up. Keep the loose band so solids still carve.
  const RECESS_BAND = 0.1, RAISE_BAND = 0.1; // 0.5 = flat; beyond ±band = structure
  const MIN_AREA_CELLS = Math.max(20, W * H * 0.001); // drop noise / thin slivers
  const recessMask = new Uint8Array(W * H);
  const raiseMask = new Uint8Array(W * H);
  let anyR = false, anyU = false;
  for (let i = 0; i < W * H; i++) {
    const v = data[i * 4] / 255;
    if (v < 0.5 - RECESS_BAND) { recessMask[i] = 1; anyR = true; }
    else if (v > 0.5 + RAISE_BAND) { raiseMask[i] = 1; anyU = true; }
  }
  // cell-coord loop (0..W, 0..H) → world XY, flipping Y (row 0 = world maxY).
  const toWorld = (loop: [number, number][]): [number, number][] =>
    loop.map(([cx, cy]) => [
      win.minX + (cx / W) * win.spanX,
      win.minY + win.spanY - (cy / H) * win.spanY,
    ] as [number, number]);
  const loopsOf = (mask: Uint8Array) =>
    marchingSquaresLoops(mask, W, H)
      .filter((l) => loopArea(l) >= MIN_AREA_CELLS)
      .map(toWorld);
  return { recess: anyR ? loopsOf(recessMask) : [], raise: anyU ? loopsOf(raiseMask) : [] };
}

/** DEEP CSG relief (Phase 2 — Sebs 2026-06-22 "crisp engrave everywhere"). Carves
 *  TRUE-vertical relief into the welded slab via manifold CSG for BOTH:
 *    1. primitive treatMask features (buttons/screens) — crisp cylinders/boxes, AND
 *    2. the doodle's STRUCTURAL tonal regions (from the soft height field) — so a
 *       FREEHAND doodle gets crisp sheer walls too, not just the soft displacement.
 *  All in ONE manifold session (one import/export round-trip) — recess regions
 *  batch into ONE subtract, raise regions ONE union (fast: ≤ a few ops). Fine
 *  line-detail is NEVER cut (it lives on the normal map). Watertight by manifold
 *  guarantee; ANY failure → null → caller falls back to V1 (soft displacement). */
export async function applyDeepCsgRelief(
  massGeom: THREE.BufferGeometry,
  features: TreatFeature[],
  heightCanvas: HTMLCanvasElement | null,
  win: ReliefWindow,
  opts: CsgReliefOpts,
): Promise<THREE.BufferGeometry | null> {
  if (opts.depth <= 0) return null;
  const contours = heightCanvas ? extractReliefContours(heightCanvas, win) : null;
  const hasContours = !!contours && (contours.recess.length > 0 || contours.raise.length > 0);
  if (!features.length && !hasContours) return null;
  const wasm = await loadManifold();
  if (!wasm) return null;
  try {
    const { Manifold, CrossSection } = wasm;
    let solid = Manifold.ofMesh(toManifoldMesh(wasm, massGeom));
    if (!solid || solid.isEmpty() || solid.volume() <= 0) return null;
    const sink = Math.min(Math.max(0.04, opts.depth * 1.1), opts.thickness * 0.7);
    const rise = Math.max(0.03, opts.depth * 0.7);
    const EPS = 0.02;
    // 1) primitive features — crisp cylinders/boxes (unchanged classifier path).
    for (const f of features.slice(0, 24)) {
      const tool = featureTool(wasm, f, opts.frontZ, opts.thickness, opts.depth);
      if (tool) solid = f.type === 'indent' ? solid.subtract(tool) : solid.add(tool);
    }
    // 2) structural region contours — ANY doodle. EvenOdd so nested loops (a hole
    // inside a filled region) knock out. scaleTop 1 + nDivisions 1 = vertical walls.
    if (hasContours && contours) {
      if (contours.recess.length) {
        const tool = CrossSection.ofPolygons(contours.recess, 'EvenOdd')
          .extrude(sink + EPS * 2, 1, 0, 1, true)
          .translate([0, 0, opts.frontZ - sink / 2]);
        solid = solid.subtract(tool);
      }
      if (!solid.isEmpty() && contours.raise.length) {
        const tool = CrossSection.ofPolygons(contours.raise, 'EvenOdd')
          .extrude(rise + EPS * 2, 1, 0, 1, true)
          .translate([0, 0, opts.frontZ + rise / 2]);
        solid = solid.add(tool);
      }
    }
    if (solid.isEmpty() || solid.volume() <= 0) return null;
    if (typeof window !== 'undefined') {
      const w = window as unknown as Record<string, number>;
      w.__csgApplied = (w.__csgApplied ?? 0) + 1;
      w.__csgDeepRegions = (w.__csgDeepRegions ?? 0) + (contours?.recess.length ?? 0) + (contours?.raise.length ?? 0);
    }
    return fromManifold(solid);
  } catch {
    return null; // any manifold error → V1 fallback
  }
}

/** Carve TRUE-vertical relief into the welded slab via manifold CSG. Returns a
 *  watertight THREE geometry, or null on any failure (caller falls back to V1). */
export async function applyCsgRelief(
  massGeom: THREE.BufferGeometry,
  features: TreatFeature[],
  opts: CsgReliefOpts,
): Promise<THREE.BufferGeometry | null> {
  if (!features.length || opts.depth <= 0) return null;
  const wasm = await loadManifold();
  if (!wasm) return null;
  try {
    const { Manifold } = wasm;
    let solid = Manifold.ofMesh(toManifoldMesh(wasm, massGeom));
    // ofMesh on a non-watertight input yields an empty/errored manifold → bail.
    if (!solid || solid.isEmpty() || solid.volume() <= 0) return null;
    // INDENTS first (subtract), then RAISES (union); cap to bound op count.
    const feats = features.slice(0, 24);
    for (const f of feats) {
      const tool = featureTool(wasm, f, opts.frontZ, opts.thickness, opts.depth);
      if (!tool) continue;
      solid = f.type === 'indent' ? solid.subtract(tool) : solid.add(tool);
    }
    if (solid.isEmpty() || solid.volume() <= 0) return null;
    if (typeof window !== 'undefined') {
      const w = window as unknown as Record<string, number>;
      w.__csgApplied = (w.__csgApplied ?? 0) + 1;
    }
    return fromManifold(solid);
  } catch {
    return null; // any manifold error → V1 fallback
  }
}
