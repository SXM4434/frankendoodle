// Frankendoodle — skinning. Bind the creature's OWN strokes to the extracted
// skeleton, then deform the real linework when the bones move. Smooth linear-
// blend skinning: each stroke point is weighted across its nearest few bones
// (plus the rigid body hub as a soft influence), so the linework bends
// organically at joints and limb-roots instead of kinking at a single bone.
// This is what makes the actual drawing articulate instead of stapled-on limbs.

import type { StrokePoint } from '../../components/DeskDoodles/DrawSurface';
import type { Rig, Vec } from './autoRig';

/** One bone's influence on a point: weight + the point's position in that bone's
 * rest frame (u = along the bone, v = perpendicular). bone -1 = the rigid body
 * hub, where u/v hold the point's original absolute position. */
export interface BoneWeight {
  bone: number;
  w: number;
  u: number;
  v: number;
}

/** A point is bound to a small blend of bones (weights sum to 1). */
export type Bind = BoneWeight[];

export function bindSkin(strokes: StrokePoint[][], rig: Rig): Bind[][] {
  const rootN = rig.nodes[rig.root];
  const diag = Math.hypot(rig.bbox.w, rig.bbox.h) || 1;
  const eps = Math.max(8, Math.min(40, diag * 0.02)); // half-influence distance (blend softness)
  const eps2 = eps * eps;
  const coreSoft = rootN.thick * 0.9; // points within ~this of the hub read as fully rigid

  // precompute each bone's rest geometry once
  const bg = rig.bones.map((bn) => {
    const a = rig.nodes[bn.a], b = rig.nodes[bn.b];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    return { ax: a.x, ay: a.y, ux: dx / L, uy: dy / L, L };
  });

  return strokes.map((s) =>
    s.map(([x, y]): Bind => {
      // distance to every bone, plus the rigid hub as a soft-radius pseudo-bone
      const inf: { bone: number; d: number; u: number; v: number }[] = [];
      for (let bi = 0; bi < bg.length; bi++) {
        const g = bg[bi];
        const u = (x - g.ax) * g.ux + (y - g.ay) * g.uy; // along the bone
        const v = (x - g.ax) * -g.uy + (y - g.ay) * g.ux; // perpendicular
        const uc = Math.max(0, Math.min(g.L, u));
        const d = Math.hypot(x - (g.ax + g.ux * uc), y - (g.ay + g.uy * uc));
        inf.push({ bone: bi, d, u, v });
      }
      const dCore = Math.max(0, Math.hypot(x - rootN.x, y - rootN.y) - coreSoft);
      inf.push({ bone: -1, d: dCore, u: x, v: y }); // rigid hub

      // keep the nearest influences within a locality window (stays local, blends joints)
      inf.sort((p, q) => p.d - q.d);
      const dmin = inf[0].d;
      const kept = inf.filter((p) => p.d <= dmin * 1.7 + eps).slice(0, 3);
      let sum = 0;
      const bw: BoneWeight[] = kept.map((p) => { const w = 1 / (p.d * p.d + eps2); sum += w; return { bone: p.bone, w, u: p.u, v: p.v }; });
      for (const k of bw) k.w /= sum;
      return bw;
    }),
  );
}

/** Forward-kinematics: given a per-bone rotation delta (radians, about that
 * bone's start joint), compute every node's posed position. */
export function poseNodes(rig: Rig, rot: number[]): Vec[] {
  const posed: Vec[] = rig.nodes.map((n) => ({ x: n.x, y: n.y }));
  const accum = new Array(rig.bones.length).fill(0);
  const done = new Array(rig.bones.length).fill(false);
  let progress = true;
  while (progress) {
    progress = false;
    rig.bones.forEach((bn, bi) => {
      if (done[bi]) return;
      if (bn.parent >= 0 && !done[bn.parent]) return;
      const a = rig.nodes[bn.a], b = rig.nodes[bn.b];
      const restAng = Math.atan2(b.y - a.y, b.x - a.x);
      const parentAccum = bn.parent >= 0 ? accum[bn.parent] : 0;
      const ang = restAng + parentAccum + (rot[bi] || 0);
      accum[bi] = parentAccum + (rot[bi] || 0);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const aP = posed[bn.a];
      posed[bn.b] = { x: aP.x + Math.cos(ang) * L, y: aP.y + Math.sin(ang) * L };
      done[bi] = true;
      progress = true;
    });
  }
  return posed;
}

/** Deform the strokes to a posed skeleton (nodes from poseNodes) via linear
 * blend skinning — each point is the weighted sum of its bones' reconstructions. */
export function poseStrokes(strokes: StrokePoint[][], binds: Bind[][], rig: Rig, posed: Vec[]): StrokePoint[][] {
  return strokes.map((s, si) =>
    s.map(([, , pr], pi): StrokePoint => {
      const bw = binds[si][pi];
      let x = 0, y = 0;
      for (const { bone, w, u, v } of bw) {
        if (bone < 0) { x += w * u; y += w * v; continue; } // rigid hub — u,v are absolute
        const bn = rig.bones[bone];
        const a = posed[bn.a], b = posed[bn.b];
        const dx = b.x - a.x, dy = b.y - a.y;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L;
        x += w * (a.x + ux * u + -uy * v);
        y += w * (a.y + uy * u + ux * v);
      }
      return [x, y, pr];
    }),
  );
}

/** Strokes → a self-contained SVG path string (for rendering the posed drawing). */
export function strokesToPathSvg(strokes: StrokePoint[][], viewBox: { x: number; y: number; w: number; h: number }, color = 'var(--dir-text-primary)', width = 4): string {
  const d = strokes
    .map((s) => s.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' '))
    .join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}" style="width:100%;height:100%;display:block;overflow:visible"><path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
