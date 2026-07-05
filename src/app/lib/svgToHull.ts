// svgToHull — the doodle's CONVEX HULL outline, so the desk physics collider sits
// behind the real shape instead of a bounding box. Samples every geometry element
// (paths via getPointAtLength, circles/ellipses/rects/polys analytically), maps to the
// 180px visual frame via getCTM, and runs a monotone-chain hull. Returns flat CENTRED
// local px [x0,y0,x1,y1,…] (origin at the footprint centre) — what DeskPhysics wants.
//
// Browser-only (needs a mounted SVG for getCTM/getPointAtLength). Convex, so a concave
// doodle (a U, a donut) collides as its outer silhouette — the right trade for a desk
// (cheap, stable, "feels like the shape"); concave decomposition is a later refinement.

const GEOM = 'path, line, polyline, polygon, rect, circle, ellipse';

function convexHull(points: [number, number][]): [number, number][] {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Convex-hull outline of `markup`, centred in a `size`×`size` frame. null if it can't
 *  build a usable hull (caller falls back to the bounding box). */
export function svgToHull(markup: string, size = 180): number[] | null {
  if (typeof document === 'undefined' || !markup) return null;
  let doc: Document;
  try { doc = new DOMParser().parseFromString(markup, 'image/svg+xml'); } catch { return null; }
  if (doc.querySelector('parsererror')) return null;
  const svg = doc.querySelector('svg');
  if (!svg) return null;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:absolute;left:-99999px;top:-99999px;width:${size}px;height:${size}px;overflow:hidden;opacity:0;pointer-events:none`;
  const mount = svg.cloneNode(true) as SVGSVGElement;
  mount.setAttribute('width', String(size));
  mount.setAttribute('height', String(size));
  host.appendChild(mount);
  document.body.appendChild(host);

  const pts: [number, number][] = [];
  const num = (v: string | null) => (v ? parseFloat(v) || 0 : 0);
  try {
    const els = Array.from(mount.querySelectorAll(GEOM)) as SVGGraphicsElement[];
    for (const el of els) {
      const m = el.getCTM();
      const push = (x: number, y: number) => pts.push(m ? [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f] : [x, y]);
      const tag = el.tagName.toLowerCase();
      if (tag === 'path') {
        const path = el as unknown as SVGPathElement;
        let len = 0;
        try { len = path.getTotalLength(); } catch { len = 0; }
        if (len > 0.5) {
          const N = Math.min(48, Math.max(6, Math.round(len / 8)));
          for (let i = 0; i <= N; i++) {
            try { const q = path.getPointAtLength((len * i) / N); push(q.x, q.y); } catch { /* */ }
          }
        }
      } else if (tag === 'circle' || tag === 'ellipse') {
        const cx = num(el.getAttribute('cx')), cy = num(el.getAttribute('cy'));
        const rx = num(el.getAttribute('r') || el.getAttribute('rx')), ry = num(el.getAttribute('r') || el.getAttribute('ry'));
        for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; push(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
      } else if (tag === 'rect') {
        const x = num(el.getAttribute('x')), y = num(el.getAttribute('y')), w = num(el.getAttribute('width')), h = num(el.getAttribute('height'));
        push(x, y); push(x + w, y); push(x + w, y + h); push(x, y + h);
      } else if (tag === 'line') {
        push(num(el.getAttribute('x1')), num(el.getAttribute('y1')));
        push(num(el.getAttribute('x2')), num(el.getAttribute('y2')));
      } else if (tag === 'polygon' || tag === 'polyline') {
        const raw = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        for (let i = 0; i + 1 < raw.length; i += 2) if (Number.isFinite(raw[i]) && Number.isFinite(raw[i + 1])) push(raw[i], raw[i + 1]);
      }
    }
  } finally {
    document.body.removeChild(host);
  }

  if (pts.length < 3) return null;
  const hull = convexHull(pts);
  if (hull.length < 3) return null;
  const out: number[] = [];
  for (const [x, y] of hull) { out.push(x - size / 2, y - size / 2); }
  return out;
}

export interface HullPhysicsProfile {
  /** weight — dense/big shapes sit heavier. */
  density: number;
  /** bounce — round shapes recoil more. */
  restitution: number;
  /** tumble — elongated shapes spin/flutter more freely (lower = freer). */
  angularDamping: number;
  /** skid — light shapes slide FAR (low), heavy shapes plant (high). The most
   *  visible per-shape difference on a throw. */
  linearDamping: number;
  /** tumble-on-throw 0–1 — elongated shapes get spun when flung so they visibly
   *  whirl (a guitar tumbles); round shapes get ~0 and roll straight. */
  spin: number;
}

/** SMART, object-AGNOSTIC physics from a doodle's own SHAPE signals (per
 *  project_desk_doodles_generalizes — shape, never object identity):
 *  · roundness (isoperimetric 4πA/P²) → bounce (a round doodle rolls/bounces)
 *  · coverage (hull area / footprint) → weight (a big/dense doodle sits heavy)
 *  · elongation (bbox max/min) → tumble (a long/thin doodle flutters + spins).
 *  Pure geometry on the centred hull — deterministic, no identity lookup. */
export function hullPhysicsProfile(hull: number[], size = 180): HullPhysicsProfile {
  const n = hull.length / 2;
  if (n < 3) return { density: 5, restitution: 0.3, angularDamping: 2, linearDamping: 1.7, spin: 0 };
  let area2 = 0, perim = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = hull[2 * i], y = hull[2 * i + 1];
    const j = (i + 1) % n, jx = hull[2 * j], jy = hull[2 * j + 1];
    area2 += x * jy - jx * y;
    perim += Math.hypot(jx - x, jy - y);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const area = Math.abs(area2) / 2;
  const w = maxX - minX, h = maxY - minY;
  const roundness = perim > 0 ? Math.min(1, (4 * Math.PI * area) / (perim * perim)) : 0; // 1 = circle
  const elong = w > 0 && h > 0 ? Math.max(w, h) / Math.min(w, h) : 1; // 1 = square, >1 long
  const coverage = Math.min(1, area / (size * size)); // fill fraction of the footprint
  // WIDE spreads so the per-shape feel is obvious, not subtle (Sebs: "hard to notice").
  const longness = Math.min(1, (elong - 1) / 2.5); // 0 = compact, 1 = clearly elongated
  return {
    density: 1.5 + 10 * coverage, // ~1.5 (sparse) → ~11.5 (big & solid) — big weight gap
    restitution: 0.04 + 0.82 * roundness, // ~0.04 (boxy, DEAD) → ~0.86 (round, REALLY bounces)
    // skid: light/sparse slides far (0.7); heavy plants quick; elongated slides further
    // still (knock ~1.6 off) so a guitar skitters where a gameboy stops short.
    linearDamping: Math.max(0.6, 0.7 + 4.3 * coverage - 1.6 * longness),
    angularDamping: Math.max(0.4, 4.6 - 1.3 * (elong - 1)), // compact 4.6 (no spin) → long 0.4 (whirls)
    spin: longness, // elongated → spun on throw (visible tumble); round → rolls straight
  };
}
