// Frankendoodle — auto-rig engine.
//
// The drawing IS the rig. We don't staple fake limbs on; we READ the creature's
// own shape and find its skeleton — body, limbs, joints, tips — whatever it is
// (a biped, a fish, a tentacle-blob, a scribble). Proven medial-axis lineage
// (Monster Mash / Pinocchio): rasterize the strokes → fill enclosed regions →
// thin to a 1px medial axis (Zhang–Suen) → trace it into a bone/joint graph.
//
// It's best-effort by construction: 2 legs → 2 branches, a tail → 1 branch,
// six tentacles → six, a blob → a stub. Garbage in still yields *something*
// riggable, it just won't pretend a scribble is a leg.

import type { StrokePoint } from '../../components/DeskDoodles/DrawSurface';

export interface Vec {
  x: number;
  y: number;
}
export interface RigNode {
  x: number;
  y: number;
  kind: 'tip' | 'joint' | 'root';
  thick: number; // local half-thickness of the shape here (distance transform)
}
export interface RigBone {
  a: number; // node index
  b: number; // node index
  poly: Vec[]; // the medial polyline between a and b (in drawing coords)
  parent: number; // parent bone index (-1 = root chain start)
}
export interface Rig {
  nodes: RigNode[];
  bones: RigBone[];
  root: number; // root node index
  bbox: { x: number; y: number; w: number; h: number };
  ok: boolean; // did we find real structure (branches), or only a stub?
}

const GRID = 150; // longest raster dimension — modest for real-time

function strokesBBox(strokes: StrokePoint[][]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const [x, y] of s) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

// ── rasterize strokes to a thick binary mask ────────────────────────────────
function rasterize(strokes: StrokePoint[][], bbox: { x: number; y: number; w: number; h: number }, thick: number) {
  const pad = thick + 3;
  const s = (GRID - 2 * pad) / Math.max(bbox.w, bbox.h);
  const W = Math.max(8, Math.round(bbox.w * s) + 2 * pad);
  const H = Math.max(8, Math.round(bbox.h * s) + 2 * pad);
  const mask = new Uint8Array(W * H);
  const toPx = (x: number, y: number): [number, number] => [(x - bbox.x) * s + pad, (y - bbox.y) * s + pad];
  const disk = (cx: number, cy: number, r: number) => {
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const px = Math.round(cx + dx), py = Math.round(cy + dy);
      if (px >= 0 && py >= 0 && px < W && py < H) mask[py * W + px] = 1;
    }
  };
  for (const pts of strokes) {
    if (pts.length === 1) { const [x, y] = toPx(pts[0][0], pts[0][1]); disk(x, y, thick); continue; }
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = toPx(pts[i][0], pts[i][1]);
      const [x2, y2] = toPx(pts[i + 1][0], pts[i + 1][1]);
      const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1)));
      for (let t = 0; t <= steps; t++) disk(x1 + (x2 - x1) * (t / steps), y1 + (y2 - y1) * (t / steps), thick);
    }
  }
  return { mask, W, H, s, pad };
}

// ── fill regions enclosed by the linework (so a drawn circle → solid disk) ───
function fillEnclosed(mask: Uint8Array, W: number, H: number) {
  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  const push = (x: number, y: number) => { const i = y * W + x; if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  const out = mask.slice();
  for (let i = 0; i < W * H; i++) if (!mask[i] && !outside[i]) out[i] = 1;
  return out;
}

// ── smooth the mask boundary (majority filter) so the medial axis isn't spurred
function smoothMask(mask: Uint8Array, W: number, H: number, iters: number) {
  let m = mask;
  for (let it = 0; it < iters; it++) {
    const n = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += m[(y + dy) * W + (x + dx)];
      n[y * W + x] = s >= 5 ? 1 : 0; // 3×3 majority
    }
    m = n;
  }
  return m;
}

// ── distance transform (for bone thickness) — cheap two-pass chamfer ─────────
function distanceTransform(mask: Uint8Array, W: number, H: number) {
  const INF = 1e6;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = mask[i] ? INF : 0;
  const relax = (i: number, j: number, c: number) => { if (d[j] + c < d[i]) d[i] = d[j] + c; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!mask[i]) continue;
    if (x > 0) relax(i, i - 1, 1);
    if (y > 0) relax(i, i - W, 1);
    if (x > 0 && y > 0) relax(i, i - W - 1, 1.414);
    if (x < W - 1 && y > 0) relax(i, i - W + 1, 1.414);
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; if (!mask[i]) continue;
    if (x < W - 1) relax(i, i + 1, 1);
    if (y < H - 1) relax(i, i + W, 1);
    if (x < W - 1 && y < H - 1) relax(i, i + W + 1, 1.414);
    if (x > 0 && y < H - 1) relax(i, i + W - 1, 1.414);
  }
  return d;
}

// ── Zhang–Suen thinning → 1px medial skeleton ───────────────────────────────
function thin(src: Uint8Array, W: number, H: number) {
  const px = src.slice();
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : px[y * W + x]);
  let changed = true;
  const rm: number[] = [];
  let guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      rm.length = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (!px[y * W + x]) continue;
        const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1),
          p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let i = 0; i < 8; i++) if (seq[i] === 0 && seq[i + 1] === 1) A++;
        if (A !== 1) continue;
        if (step === 0) { if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue; }
        else { if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue; }
        rm.push(y * W + x);
      }
      if (rm.length) { changed = true; for (const i of rm) px[i] = 0; }
    }
  }
  return px;
}

// ── trace the 1px skeleton into a node/bone graph ───────────────────────────
function traceGraph(skel: Uint8Array, W: number, H: number) {
  const deg = new Int8Array(W * H);
  const N8 = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
  const idxs: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (!skel[i]) continue;
    let d = 0;
    const x = i % W, y = (i / W) | 0;
    if (x > 0 && y > 0 && skel[i - W - 1]) d++;
    if (y > 0 && skel[i - W]) d++;
    if (x < W - 1 && y > 0 && skel[i - W + 1]) d++;
    if (x > 0 && skel[i - 1]) d++;
    if (x < W - 1 && skel[i + 1]) d++;
    if (x > 0 && y < H - 1 && skel[i + W - 1]) d++;
    if (y < H - 1 && skel[i + W]) d++;
    if (x < W - 1 && y < H - 1 && skel[i + W + 1]) d++;
    deg[i] = d;
    idxs.push(i);
  }
  // nodes = endpoints (deg 1) + junctions (deg >= 3)
  const nodeAt = new Map<number, number>();
  const nodePix: number[] = [];
  for (const i of idxs) if (deg[i] === 1 || deg[i] >= 3) { nodeAt.set(i, nodePix.length); nodePix.push(i); }
  // if a pure loop (no nodes), seed one node arbitrarily
  if (nodePix.length === 0 && idxs.length) { const i = idxs[0]; nodeAt.set(i, 0); nodePix.push(i); }

  const bones: { a: number; b: number; poly: number[] }[] = [];
  const visited = new Uint8Array(W * H);
  const neighbors = (i: number) => { const r: number[] = []; const x = i % W, y = (i / W) | 0; for (const o of N8) { const j = i + o; const nx = j % W, ny = (j / W) | 0; if (Math.abs(nx - x) <= 1 && Math.abs(ny - y) <= 1 && j >= 0 && j < W * H && skel[j]) r.push(j); } return r; };

  for (const start of nodePix) {
    for (const first of neighbors(start)) {
      if (visited[first] && nodeAt.has(start)) { /* still may need to walk */ }
      // walk from start through `first` until we hit another node
      let prev = start, cur = first;
      const path = [start];
      let steps = 0;
      while (steps++ < 10000) {
        path.push(cur);
        if (nodeAt.has(cur) && cur !== start) break;
        visited[cur] = 1;
        const nb = neighbors(cur).filter((n) => n !== prev && !(visited[n] && !nodeAt.has(n)));
        const next = nb.find((n) => nodeAt.has(n)) ?? nb[0];
        if (next === undefined) break;
        prev = cur;
        cur = next;
      }
      const endNode = path[path.length - 1];
      if (nodeAt.has(endNode) && endNode !== start && path.length > 1) {
        // avoid duplicate bones
        const a = nodeAt.get(start)!, b = nodeAt.get(endNode)!;
        if (!bones.some((bn) => (bn.a === a && bn.b === b) || (bn.a === b && bn.b === a))) bones.push({ a, b, poly: path });
      }
    }
  }
  return { nodePix, bones };
}

/** Extract a rig (skeleton) from the creature's strokes. */
export function autoRig(strokes: StrokePoint[][]): Rig {
  const clean = strokes.filter((s) => s.length >= 1);
  const bbox = strokesBBox(clean);
  const thick = 3;
  const { mask, W, H, s, pad } = rasterize(clean, bbox, thick);
  const filled = smoothMask(fillEnclosed(mask, W, H), W, H, 3);
  const dist = distanceTransform(filled, W, H);
  const skel = thin(filled, W, H);
  const { nodePix, bones } = traceGraph(skel, W, H);

  // grid px → drawing coords
  const toWorld = (i: number): Vec => ({ x: bbox.x + (((i % W) - pad) / s), y: bbox.y + ((((i / W) | 0) - pad) / s) });
  const thickAt = (i: number) => dist[i] / s;

  const nodes: RigNode[] = nodePix.map((i) => {
    const w = toWorld(i);
    // degree via bones
    const d = bones.reduce((a, bn) => a + (nodePix[bn.a] === i || nodePix[bn.b] === i ? 1 : 0), 0);
    return { x: w.x, y: w.y, kind: d >= 3 ? 'joint' : 'tip', thick: thickAt(i) };
  });

  // root = the body hub: thickest node where limbs converge (not a thin nose junction)
  let root = 0, bestScore = -1;
  nodes.forEach((n, i) => {
    const degree = bones.reduce((a, bn) => a + (bn.a === i || bn.b === i ? 1 : 0), 0);
    const score = n.thick * 6 + degree * 2;
    if (score > bestScore) { bestScore = score; root = i; }
  });
  if (nodes[root]) nodes[root].kind = 'root';

  // ── extract limbs: from the body hub (root), trace the medial path to each
  // significant extremity. Robust to spur noise — we only follow to real tips.
  const nadj: { to: number; bi: number }[][] = nodePix.map(() => []);
  bones.forEach((bn, bi) => { nadj[bn.a].push({ to: bn.b, bi }); nadj[bn.b].push({ to: bn.a, bi }); });
  const ndeg = nodePix.map((_, i) => nadj[i].length);
  const polyLenPx = (poly: number[]) => { let L = 0; for (let i = 0; i < poly.length - 1; i++) { const p = poly[i], q = poly[i + 1]; L += Math.hypot((q % W) - (p % W), ((q / W) | 0) - ((p / W) | 0)); } return L; };
  const par = new Array(nodePix.length).fill(-1);
  const parBone = new Array(nodePix.length).fill(-1);
  const dpx = new Array(nodePix.length).fill(Infinity);
  dpx[root] = 0;
  const bfs = [root];
  while (bfs.length) {
    const n = bfs.shift()!;
    for (const { to, bi } of nadj[n]) if (dpx[to] === Infinity) { dpx[to] = dpx[n] + polyLenPx(bones[bi].poly); par[to] = n; parBone[to] = bi; bfs.push(to); }
  }
  const diag = Math.hypot(bbox.w, bbox.h);
  const minLimb = diag * 0.11;
  const tips = nodePix.map((_, i) => i).filter((i) => ndeg[i] === 1 && i !== root && dpx[i] / s > minLimb);

  const outNodes: RigNode[] = [{ ...toWorld(nodePix[root]), kind: 'root', thick: thickAt(nodePix[root]) }];
  const outBones: RigBone[] = [];
  for (const tip of tips) {
    const seq: number[] = [];
    let cur = tip;
    let guard = 0;
    while (cur !== root && parBone[cur] >= 0 && guard++ < 5000) { seq.push(parBone[cur]); cur = par[cur]; }
    seq.reverse();
    let poly: Vec[] = [];
    let node = root;
    for (const bi of seq) {
      const bn = bones[bi];
      const seg = (bn.a === node ? bn.poly : bn.poly.slice().reverse()).map(toWorld);
      poly = poly.length === 0 ? seg : poly.concat(seg.slice(1));
      node = bn.a === node ? bn.b : bn.a;
    }
    const fine = simplify(poly, diag * 0.012);
    if (fine.length < 2) continue;
    // joints = strong bends the limb actually has; a straight limb gets one mid-joint
    // so it can still articulate (a knee / elbow even when drawn as a stick).
    const bends = simplify(fine, diag * 0.06).slice(1, -1);
    let joints: Vec[] = bends;
    if (joints.length === 0) joints = [{ x: (fine[0].x + fine[fine.length - 1].x) / 2, y: (fine[0].y + fine[fine.length - 1].y) / 2 }];
    else if (joints.length > 2) joints = [joints[Math.floor(joints.length / 3)], joints[Math.floor((2 * joints.length) / 3)]];
    const tipThick = thickAt(nodePix[tip]);
    const chain: Vec[] = [...joints, toWorld(nodePix[tip])];
    let prevIdx = 0;
    let prevPt: Vec = { x: outNodes[0].x, y: outNodes[0].y };
    let parentBone = -1;
    chain.forEach((pt, k) => {
      const last = k === chain.length - 1;
      const idx = outNodes.length;
      outNodes.push({ x: pt.x, y: pt.y, kind: last ? 'tip' : 'joint', thick: last ? tipThick : Math.max(3, tipThick) });
      outBones.push({ a: prevIdx, b: idx, poly: [prevPt, pt], parent: parentBone });
      parentBone = outBones.length - 1;
      prevIdx = idx;
      prevPt = pt;
    });
  }

  return { nodes: outNodes, bones: outBones, root: 0, bbox, ok: outBones.length >= 2 && outNodes.some((n) => n.kind === 'joint') };
}

// Ramer–Douglas–Peucker polyline simplify.
function simplify(poly: Vec[], tol: number): Vec[] {
  if (poly.length < 3) return poly;
  const keep = new Uint8Array(poly.length);
  keep[0] = 1;
  keep[poly.length - 1] = 1;
  const stack: [number, number][] = [[0, poly.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    let maxD = 0, idx = -1;
    const a = poly[i0], b = poly[i1];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((poly[i].x - a.x) * dy - (poly[i].y - a.y) * dx) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([i0, idx], [idx, i1]); }
  }
  return poly.filter((_, i) => keep[i]);
}

// Clean the raw medial-axis graph into a usable rig: kill short spur branches,
// collapse degree-2 chain nodes into single bones, simplify, then re-parent
// every bone away from the root (body hub → limb tip).
function pruneRig(rig: Rig): Rig {
  const diag = Math.hypot(rig.bbox.w, rig.bbox.h);
  const minSpur = diag * 0.06;
  const nodes = rig.nodes.map((n) => ({ ...n }));
  let bones = rig.bones.map((b) => ({ a: b.a, b: b.b, poly: b.poly.slice(), parent: -1 }));
  let root = rig.root;
  const deg = (ni: number) => bones.reduce((a, b) => a + (b.a === ni || b.b === ni ? 1 : 0), 0);
  const blen = (b: { poly: Vec[] }) => { let L = 0; for (let i = 0; i < b.poly.length - 1; i++) L += Math.hypot(b.poly[i + 1].x - b.poly[i].x, b.poly[i + 1].y - b.poly[i].y); return L; };

  for (let pass = 0; pass < 80; pass++) {
    const idx = bones.findIndex((b) => { const leaf = deg(b.a) === 1 ? b.a : deg(b.b) === 1 ? b.b : -1; return leaf >= 0 && leaf !== root && blen(b) < minSpur; });
    if (idx < 0) break;
    bones.splice(idx, 1);
  }
  for (let pass = 0; pass < 800; pass++) {
    let did = false;
    for (let ni = 0; ni < nodes.length; ni++) {
      if (ni === root) continue;
      const inc = bones.filter((b) => b.a === ni || b.b === ni);
      if (inc.length !== 2) continue;
      const [b1, b2] = inc;
      const o1 = b1.a === ni ? b1.b : b1.a;
      const o2 = b2.a === ni ? b2.b : b2.a;
      if (o1 === o2) continue;
      const p1 = b1.b === ni ? b1.poly.slice() : b1.poly.slice().reverse();
      const p2 = b2.a === ni ? b2.poly.slice() : b2.poly.slice().reverse();
      bones = bones.filter((b) => b !== b1 && b !== b2);
      bones.push({ a: o1, b: o2, poly: p1.concat(p2.slice(1)), parent: -1 });
      did = true;
      break;
    }
    if (!did) break;
  }
  // compact node indices
  const used = new Set<number>([root]);
  bones.forEach((b) => { used.add(b.a); used.add(b.b); });
  const remap = new Map<number, number>();
  const newNodes: RigNode[] = [];
  [...used].forEach((old) => { remap.set(old, newNodes.length); newNodes.push({ ...nodes[old] }); });
  bones.forEach((b) => { b.a = remap.get(b.a)!; b.b = remap.get(b.b)!; b.poly = simplify(b.poly, diag * 0.01); });
  root = remap.get(root)!;
  // reclassify + reparent (BFS from root, orient parent→child)
  newNodes.forEach((n, i) => { const d = bones.reduce((a, b) => a + (b.a === i || b.b === i ? 1 : 0), 0); n.kind = i === root ? 'root' : d >= 3 ? 'joint' : 'tip'; });
  const adj: number[][] = newNodes.map(() => []);
  bones.forEach((b, bi) => { adj[b.a].push(bi); adj[b.b].push(bi); });
  const seen = new Set<number>([root]);
  const q = [root];
  while (q.length) {
    const nd = q.shift()!;
    for (const bi of adj[nd]) {
      const other = bones[bi].a === nd ? bones[bi].b : bones[bi].a;
      if (seen.has(other)) continue;
      seen.add(other);
      if (bones[bi].a !== nd) { const t = bones[bi].a; bones[bi].a = bones[bi].b; bones[bi].b = t; bones[bi].poly.reverse(); }
      bones[bi].parent = adj[nd].find((pbi) => bones[pbi].b === nd) ?? -1;
      q.push(other);
    }
  }
  return { nodes: newNodes, bones, root, bbox: rig.bbox, ok: bones.length >= 2 };
}

/** Debug: the skeleton as an SVG string (bones + joints) for overlaying on the drawing. */
export function rigDebugSvg(rig: Rig, opts?: { bone?: string; joint?: string; tip?: string }, viewBox?: { x: number; y: number; w: number; h: number }): string {
  const bone = opts?.bone ?? '#e5484d';
  const joint = opts?.joint ?? '#1d70b8';
  const tip = opts?.tip ?? '#2a9d3f';
  const b = viewBox ?? rig.bbox;
  const bonePaths = rig.bones
    .map((bn) => `<polyline points="${bn.poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${bone}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`)
    .join('');
  const dots = rig.nodes
    .map((n) => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.kind === 'root' ? 6 : n.kind === 'joint' ? 4.5 : 3.4}" fill="${n.kind === 'tip' ? tip : joint}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible">${bonePaths}${dots}</svg>`;
}
