import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─── Sealed watertight relief mesh (Phase 2 Step 1, Sebs 2026-06-19) ─────────
// Builds ONE welded, watertight mesh from a closed 2D contour + a height field:
//
//   displaced front cap ──┐ (boundary ring kept FLAT)
//                         ├─ shared boundary ring (welded)
//   vertical skirt walls ─┤
//                         ├─ shared back ring
//   flat back cap ────────┘
//
// The front cap's boundary stays at the flat level and is WELDED to the skirt, so
// the interior can displace to REAL depth without the cap tearing off the body —
// the failure mode of the old free-floating displaced-cap clone (drawingTexture's
// SVGPORT_DISPLACEMENT_SCALE was pinned to 0.06 precisely to avoid that tear).
//
// PURE: no React, no WebGL — just three.js geometry math, so it's node-testable
// for watertightness (see tools/harnesses/sealed-relief-smoke.mjs). NOT wired into
// any scene yet (Step 2 routes svg-port's body here); building it as an isolated,
// verified foundation changes zero rendering.

export type Vec2 = [number, number];

export interface SealedReliefOpts {
  /** Back-cap depth below the flat front level (world units). Default 0.5 (≈ the
   *  current EXTRUDE_DEPTH so the body reads the same thickness). */
  thickness?: number;
  /** Max front displacement from the flat level. Height field is in [0,1] with
   *  0.5 = flat → displacement = (h − 0.5) · 2 · scale. Default 0.3 (real depth,
   *  safe now that the cap is welded). */
  displacementScale?: number;
  /** Midpoint-subdivision passes for interior density (0–5; more = denser/slower).
   *  Default 3. */
  subdivisions?: number;
}

/** Build a sealed watertight relief mesh from a closed contour + a height field.
 *  `heightAt(x,y)` returns the field in [0,1] (0.5 = flat) at a cap point. */
export function buildSealedReliefGeometry(
  contour: Vec2[],
  heightAt: (x: number, y: number) => number,
  opts: SealedReliefOpts = {},
): THREE.BufferGeometry {
  const thickness = opts.thickness ?? 0.5;
  const dispScale = opts.displacementScale ?? 0.3;
  const subdiv = Math.max(0, Math.min(5, Math.round(opts.subdivisions ?? 3)));

  // ── 1. Clean the ring (drop a duplicated closing point) + triangulate it. ──
  const ring = contour.map((p) => [p[0], p[1]] as Vec2);
  if (ring.length > 1) {
    const a = ring[0], b = ring[ring.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) ring.pop();
  }
  if (ring.length < 3) {
    return new THREE.BufferGeometry(); // degenerate — nothing to build
  }
  const verts: Vec2[] = ring.map((p) => [p[0], p[1]]);
  let faces = (
    THREE.ShapeUtils.triangulateShape(
      ring.map((p) => new THREE.Vector2(p[0], p[1])),
      [],
    ) as number[][]
  ).map((t) => [t[0], t[1], t[2]] as [number, number, number]);

  // ── 2. Midpoint-subdivide for interior vertices to displace. A shared-edge
  //       midpoint cache keeps the mesh manifold (no cracks between triangles). ──
  for (let s = 0; s < subdiv; s++) {
    const mid = new Map<string, number>();
    const getMid = (i: number, j: number): number => {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      let m = mid.get(key);
      if (m === undefined) {
        const a = verts[i], b = verts[j];
        m = verts.length;
        verts.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        mid.set(key, m);
      }
      return m;
    };
    const next: [number, number, number][] = [];
    for (const [a, b, c] of faces) {
      const ab = getMid(a, b), bc = getMid(b, c), ca = getMid(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    faces = next;
  }

  // ── 3. Boundary edges (in exactly ONE cap face) = the silhouette ring; their
  //       vertices stay FLAT so they weld to the skirt. ──
  const ekey = (i: number, j: number) => (i < j ? `${i}_${j}` : `${j}_${i}`);
  const edgeN = new Map<string, number>();
  for (const [a, b, c] of faces) {
    for (const [i, j] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = ekey(i, j);
      edgeN.set(k, (edgeN.get(k) ?? 0) + 1);
    }
  }
  const boundaryVert = new Set<number>();
  const boundaryDirected: [number, number][] = [];
  for (const [a, b, c] of faces) {
    for (const [i, j] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      if (edgeN.get(ekey(i, j)) === 1) {
        boundaryDirected.push([i, j]); // oriented as the cap face winds it
        boundaryVert.add(i);
        boundaryVert.add(j);
      }
    }
  }

  // ── 4. Assemble positions: FRONT block (displaced; boundary flat) + BACK block
  //       (flat at −thickness). Front faces, back faces (reversed), skirt quads. ──
  const n = verts.length;
  const pos: number[] = [];
  // FRONT block (indices 0 .. n−1): displaced by the field, boundary kept flat.
  for (let i = 0; i < n; i++) {
    const [x, y] = verts[i];
    const frontZ = boundaryVert.has(i) ? 0 : (heightAt(x, y) - 0.5) * 2 * dispScale;
    pos.push(x, y, frontZ);
  }
  // BACK block (indices n .. 2n−1): same xy, flat at −thickness.
  for (let i = 0; i < n; i++) {
    const [x, y] = verts[i];
    pos.push(x, y, -thickness);
  }

  const idx: number[] = [];
  // Front faces (as wound by triangulateShape).
  for (const [a, b, c] of faces) idx.push(a, b, c);
  // Back faces (reversed winding so the back normal faces away).
  for (const [a, b, c] of faces) idx.push(a + n, c + n, b + n);
  // Skirt: each boundary edge (i→j) on the front connects to back j,i.
  for (const [i, j] of boundaryDirected) {
    const fi = i, fj = j, bi = i + n, bj = j + n;
    // Outward-facing wall (two triangles per quad). Winding chosen so the wall
    // normal points away from the interior; computeVertexNormals finalizes it.
    idx.push(fi, bi, fj);
    idx.push(fj, bi, bj);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  // Weld any exact-coincident vertices (front/skirt/back rings) → guaranteed seal.
  const sealed = mergeVertices(geo);
  sealed.computeVertexNormals();
  return sealed;
}
