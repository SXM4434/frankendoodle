// Frankendoodle — skinning. Bind the creature's OWN strokes to the extracted
// skeleton, then deform the real linework when the bones move. Rigid
// nearest-bone binding + forward-kinematics posing (a clean first pass; smooth
// multi-bone weight blending is a later refinement). This is what makes the
// actual drawing articulate instead of stapled-on fake limbs.

import type { StrokePoint } from '../../components/DeskDoodles/DrawSurface';
import type { Rig, Vec } from './autoRig';

/** Per-point binding: which bone owns it, and its position in that bone's
 * rest frame (u = along the bone, v = perpendicular). */
export interface Bind {
  bone: number;
  u: number;
  v: number;
}

export function bindSkin(strokes: StrokePoint[][], rig: Rig): Bind[][] {
  return strokes.map((s) =>
    s.map(([x, y]): Bind => {
      let best = 0, bestD = Infinity, bu = 0, bv = 0;
      rig.bones.forEach((bn, bi) => {
        const a = rig.nodes[bn.a], b = rig.nodes[bn.b];
        const dx = b.x - a.x, dy = b.y - a.y;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L;
        const u = (x - a.x) * ux + (y - a.y) * uy; // along the bone
        const v = (x - a.x) * -uy + (y - a.y) * ux; // perpendicular
        const uc = Math.max(0, Math.min(L, u));
        const d = Math.hypot(x - (a.x + ux * uc), y - (a.y + uy * uc));
        if (d < bestD) { bestD = d; best = bi; bu = u; bv = v; }
      });
      return { bone: best, u: bu, v: bv };
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

/** Deform the strokes to a posed skeleton (nodes from poseNodes). */
export function poseStrokes(strokes: StrokePoint[][], binds: Bind[][], rig: Rig, posed: Vec[]): StrokePoint[][] {
  return strokes.map((s, si) =>
    s.map(([, , pr], pi): StrokePoint => {
      const { bone, u, v } = binds[si][pi];
      const bn = rig.bones[bone];
      const a = posed[bn.a], b = posed[bn.b];
      const dx = b.x - a.x, dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      return [a.x + ux * u + -uy * v, a.y + uy * u + ux * v, pr];
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
