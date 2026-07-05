// Fast SVG-markup → polylines, WITHOUT the DOM (no offscreen mount, no
// getPointAtLength). This is the no-lag replacement for svgMarkupToStrokes on the
// svg-port 3D detail-line path (Sebs 2026-06-16: svg-port froze/lagged because
// getPointAtLength on a dense styled markup blocked the main thread). Pure math:
// parse each <path d>, flatten beziers, apply the viewBox→target fit. Used ONLY
// by the svg-port 3D incised marks — it never touches the 2D render pipeline, so
// the locked 197-catalog 2D output is unaffected (no catalog-regression risk).
//
// Command coverage: M m L l H h V v C c S s Q q T t Z z (the SvgStyleTransform
// outline output uses M/L/C/Q/Z). A/a (arcs — rare in styled output, common only
// in raw uploads) degrade to a straight segment to the arc endpoint (coarse but
// safe; the donut/etc. still read). Each M starts a NEW polyline (pen-up), so
// compound paths never bridge sub-paths with a chord.

export type FlatPoint = [number, number, number]; // [x, y, pressure] — matches StrokePoint

const NUM_RE = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;

function flattenCubic(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], n: number, out: [number, number][]) {
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
}
function flattenQuad(p0: [number, number], p1: [number, number], p2: [number, number], n: number, out: [number, number][]) {
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u, b = 2 * u * t, c = t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]]);
  }
}

/** Parse one path `d` into sub-path polylines (absolute coords). Each M opens a
 *  new sub-path. Curves flattened at `curveSamples` segments. */
export function flattenPathD(d: string, curveSamples = 8): [number, number][][] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) return [];
  const subs: [number, number][][] = [];
  let cur: [number, number][] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0; // current + sub-path-start
  let prevCtrl: [number, number] | null = null; // for S/T smoothing
  let cmd = '';
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const isNum = (t: string) => /^[-\d.]/.test(t);
  while (i < tokens.length) {
    let tok = tokens[i];
    if (/[A-Za-z]/.test(tok)) { cmd = tok; i++; } // new command (else implicit repeat)
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'M') {
      let x = num(), y = num(); if (rel) { x += cx; y += cy; }
      if (cur.length >= 2) subs.push(cur);
      cur = []; cx = x; cy = y; sx = x; sy = y; cur.push([cx, cy]); prevCtrl = null;
      cmd = rel ? 'l' : 'L'; // subsequent implicit pairs are lineto
    } else if (C === 'L') {
      let x = num(), y = num(); if (rel) { x += cx; y += cy; } cx = x; cy = y; cur.push([cx, cy]); prevCtrl = null;
    } else if (C === 'H') {
      let x = num(); if (rel) x += cx; cx = x; cur.push([cx, cy]); prevCtrl = null;
    } else if (C === 'V') {
      let y = num(); if (rel) y += cy; cy = y; cur.push([cx, cy]); prevCtrl = null;
    } else if (C === 'C') {
      let x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
      if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
      flattenCubic([cx, cy], [x1, y1], [x2, y2], [x, y], curveSamples, cur);
      prevCtrl = [x2, y2]; cx = x; cy = y;
    } else if (C === 'S') {
      let x2 = num(), y2 = num(), x = num(), y = num();
      if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
      const c1: [number, number] = prevCtrl ? [2 * cx - prevCtrl[0], 2 * cy - prevCtrl[1]] : [cx, cy];
      flattenCubic([cx, cy], c1, [x2, y2], [x, y], curveSamples, cur);
      prevCtrl = [x2, y2]; cx = x; cy = y;
    } else if (C === 'Q') {
      let x1 = num(), y1 = num(), x = num(), y = num();
      if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
      flattenQuad([cx, cy], [x1, y1], [x, y], curveSamples, cur);
      prevCtrl = [x1, y1]; cx = x; cy = y;
    } else if (C === 'T') {
      let x = num(), y = num(); if (rel) { x += cx; y += cy; }
      const c1: [number, number] = prevCtrl ? [2 * cx - prevCtrl[0], 2 * cy - prevCtrl[1]] : [cx, cy];
      flattenQuad([cx, cy], c1, [x, y], curveSamples, cur);
      prevCtrl = c1; cx = x; cy = y;
    } else if (C === 'A') {
      // arc → coarse: skip the 5 arc params, line to endpoint (rare in styled out)
      num(); num(); num(); num(); num(); let x = num(), y = num(); if (rel) { x += cx; y += cy; }
      cx = x; cy = y; cur.push([cx, cy]); prevCtrl = null;
    } else if (C === 'Z') {
      if (cur.length) { cur.push([sx, sy]); cx = sx; cy = sy; } prevCtrl = null;
    } else { i++; } // unknown → skip a token (never loop forever)
    void isNum;
  }
  if (cur.length >= 2) subs.push(cur);
  return subs;
}

/** Markup → polylines (StrokePoint[][]) in target space, via pure path math.
 *  Mirrors svgMarkupToStrokes's contract (viewBox→target xMidYMid-meet fit) but
 *  with NO DOM mount / getPointAtLength. Caller passes already-stripped markup. */
export function svgMarkupToPolylinesFast(
  markup: string,
  opts: { targetW: number; targetH: number; curveSamples?: number; maxElements?: number } = { targetW: 800, targetH: 600 },
): FlatPoint[][] {
  if (typeof DOMParser === 'undefined' || !markup) return [];
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return [];
  const svg = doc.querySelector('svg');
  if (!svg) return [];
  const vbRaw = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  let vx = 0, vy = 0, vw = opts.targetW, vh = opts.targetH;
  if (vbRaw.length === 4) [vx, vy, vw, vh] = vbRaw;
  const scale = Math.min(opts.targetW / vw, opts.targetH / vh);
  const offX = (opts.targetW - vw * scale) / 2 - vx * scale;
  const offY = (opts.targetH - vh * scale) / 2 - vy * scale;
  const curveSamples = opts.curveSamples ?? 8;
  const maxEls = opts.maxElements ?? 400;
  const paths = Array.from(svg.querySelectorAll('path'));
  const out: FlatPoint[][] = [];
  for (const el of paths) {
    if (out.length >= maxEls) break;
    const d = el.getAttribute('d');
    if (!d) continue;
    for (const sub of flattenPathD(d, curveSamples)) {
      if (out.length >= maxEls) break;
      if (sub.length < 2) continue;
      out.push(sub.map(([x, y]) => [x * scale + offX, y * scale + offY, 0.5] as FlatPoint));
    }
  }
  return out;
}
