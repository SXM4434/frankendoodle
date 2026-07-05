// ─── rodAdornments — Tier-2 Rod cap/joint family geometry specs ─────────────
// ONE source of truth for where the rod's sibling meshes (caps + joint blobs)
// sit and how they're shaped per family, consumed by BOTH the product scene
// (Stroke3DScene) and the tools/3d board harness — the contact sheets show
// exactly what the app renders, no duplicated placement math.
//
// Families (3d-mode-controls-spec three-tier amendment, Rod row):
//   cap 'round'    — inset sphere (FS verbatim — today's look, byte-identical)
//   cap 'flat'     — flush disk perpendicular to the end tangent (chopped
//                    marker end); cylinder primitive oriented along the
//                    outward direction, sunk half-in so it caps the open tube
//   cap 'ink-blob' — swollen sphere centered at the TRUE endpoint (the
//                    nib-rest ink pool)
//   joint 'blob'   — FS joint spheres (today) · 'clean' — none
//
// PURITY: deterministic, no DOM, no randomness. Imports three (this module
// lives in the lazy 3D chunk only).

import * as THREE from 'three';
import type { RodGeometryResult } from '../../lib/geometry3d/strokeTo3d';
import type { RodCapStyle3D, RodJointStyle3D } from './modeParams';

/** Ink-blob bead radius, ×tube radius — swollen enough to read as a pooled
 *  drop, small enough not to swallow short strokes. Board-calibrated. */
export const INK_BLOB_SCALE = 1.5;
/** Flat-disk thickness, ×tube radius. */
export const FLAT_CAP_THICKNESS = 0.36;
/** Flat-disk radius, ×tube radius — slight overhang hides the tube rim. */
export const FLAT_CAP_RADIUS = 1.04;

export type RodAdornmentShape = 'sphere' | 'disk';

export interface RodAdornmentSpec {
  shape: RodAdornmentShape;
  position: THREE.Vector3;
  /** Per-axis scale applied to the UNIT primitive (sphere r=1 / cylinder
   *  r=1 h=1, axis +Y). */
  scale: THREE.Vector3;
  /** Orientation (identity for spheres). */
  quaternion: THREE.Quaternion;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Cap + joint sibling-mesh specs for one rod build under the Tier-2 rod
 *  families. `capsOn` mirrors the Tier-3 End-caps toggle. */
export function rodAdornmentSpecs(
  build: RodGeometryResult,
  capStyle: RodCapStyle3D,
  jointStyle: RodJointStyle3D,
  capsOn: boolean,
): RodAdornmentSpec[] {
  const specs: RodAdornmentSpec[] = [];
  const r = build.radius;

  if (capsOn) {
    if (capStyle === 'round') {
      for (const p of build.capPositions) {
        specs.push({
          shape: 'sphere',
          position: p.clone(),
          scale: new THREE.Vector3(r, r, r),
          quaternion: new THREE.Quaternion(),
        });
      }
    } else if (capStyle === 'ink-blob') {
      for (const p of build.endPositions) {
        specs.push({
          shape: 'sphere',
          position: p.clone(),
          scale: new THREE.Vector3(r * INK_BLOB_SCALE, r * INK_BLOB_SCALE, r * INK_BLOB_SCALE),
          quaternion: new THREE.Quaternion(),
        });
      }
    } else {
      // 'flat' — disk axis along the outward end direction, sunk half-in so
      // the inner face seals the open tube end and the outer face is flush.
      for (let i = 0; i < build.endPositions.length; i++) {
        const dir = build.endDirections[i];
        if (!dir || dir.lengthSq() < 1e-9) continue;
        const h = r * FLAT_CAP_THICKNESS;
        specs.push({
          shape: 'disk',
          position: build.endPositions[i].clone().addScaledVector(dir, -h / 2),
          scale: new THREE.Vector3(r * FLAT_CAP_RADIUS, h, r * FLAT_CAP_RADIUS),
          quaternion: new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.clone().normalize()),
        });
      }
    }
  }

  if (jointStyle === 'blob') {
    for (const p of build.jointPositions) {
      specs.push({
        shape: 'sphere',
        position: p.clone(),
        scale: new THREE.Vector3(r, r, r),
        quaternion: new THREE.Quaternion(),
      });
    }
  }

  return specs;
}
