// Simplify-to-sketch post-process — THE image-mode differentiator.
//
// Sebs locked (DECISIONS-FOR-SEBS.md "Image-mode refinement", 2026-06-13):
//   image→SVG must output a SIMPLER SKETCH version of the photo — abstract it to
//   a FEW hand-drawn strokes that fit the Desk Doodles look — NOT a detailed /
//   photo-real vectorization. The simplify-to-sketch step IS part of the
//   conversion.
//
// A vectorizer (Quiver Arrow) returns a FAITHFUL trace: many filled <path>
// regions, fine detail, noise specks, photographic color. That is the OPPOSITE
// of a desk doodle. This module turns that trace into something that reads as a
// few confident hand-drawn lines so the existing SvgStyleTransform hand-feel
// pipeline (wobble / hachure / pen-tips) has line art to work on — not a
// photo-real fill stack it would only flatten.
//
// PURE FUNCTION, no DOM-injection: it parses with DOMParser (same approach as
// lib/normalizeInput.ts), transforms the element tree, and serializes back. No
// new deps (svgson/roughjs not imported — keeps it Make-importable + matches the
// dependency-light house style). Output is plain SVG markup; the caller
// (imageToSvg.ts) sanitizes it through the shared DOMPurify profile afterward.
//
// ── RESEARCH BASIS (real, cited) ────────────────────────────────────────────
// • Path-importance / salience filtering — Kang & Lee, "Level-of-Detail Line
//   Abstraction" and Son et al. "Abstract Line Drawings from 2D Images"
//   (Pacific Graphics 2007, https://www.umsl.edu/~kangh/Papers/kang_pg07.pdf):
//   line importance H(e) = length + curliness + β·segmentSize + α·visibility;
//   a single salience THRESHOLD sweeps level-of-detail from structural lines to
//   fine detail. We use a discrete, area+length proxy of the same idea (we have
//   vector paths, not an edge-pixel pyramid) to RANK paths and keep only the
//   most important — exactly the "structural lines only" end of their slider.
// • Drop-tiny-paths cleanup — the standard auto-trace cleanup heuristic: remove
//   paths with opacity < 0.05 or area < ~10px and merge same-color overlaps
//   (documented in vectorization-cleanup tooling, e.g. Figma "SVG Path Cleaner",
//   SVGOMG remove-out-of-bounds/merge-paths). Our area floor is the doodle-scale
//   analogue.
// • RDP point simplification — Ramer–Douglas–Peucker: distance-bounded (never
//   deviates more than ε from the source → "still reads as what it traced"),
//   spike-preserving (keeps sharp corners — the right bias for line art), and
//   slider-stable (raising ε only prunes; retained points are a subset). Chosen
//   over Visvalingam–Whyatt for v1 in docs/research/22-research-simplification-
//   toggle.md §2 (VW shaves narrow spikes; RDP is the project's shipped engine
//   at ε=3.0). Refs in that doc: Wikipedia RDP; Fleischmann line-simplification;
//   msbarry comparison gist; matthewdeutsch polyline-simplification.
// • Filled-region → outline stroke — a faithful trace fills shapes; line art
//   strokes their outlines. The hand-feel pipeline's outline filter keeps
//   stroked geometry and drops raw fills, so we re-express each kept region as a
//   stroked outline (fill→none, stroke→ink) — the inverse of the common
//   "expand stroke to fill" operation (Sketch "export borders as SVG";
//   Illustrator Object > Path > Outline Stroke).

// ── Tunables (the "few strokes" knobs — exposed so it's REAL + tunable) ───────

export interface SketchifyOptions {
  /** Keep at most this many paths (the dominant ones by salience). The single
   *  biggest "abstract to a few strokes" lever. Default 12 reads as a confident
   *  sketch; lower = sparser. */
  maxPaths: number;
  /** Drop any path whose bbox area is below this fraction of the whole drawing's
   *  bbox area (noise-speck filter — the area<threshold cleanup heuristic,
   *  scaled to the drawing instead of an absolute px floor so it works at any
   *  source size). Default 0.0015 (0.15%). */
  minAreaFrac: number;
  /** RDP tolerance in *viewBox units* applied to every kept sub-path. Higher =
   *  fewer anchors = looser, more gestural line. Default 1.6. (ε; distance the
   *  simplified path may deviate from the trace.) */
  rdpEpsilon: number;
  /** Re-express filled regions as stroked outlines (line-art look the hand-feel
   *  pipeline wants). Default true. When false, fills are preserved (lets the
   *  Smart-Hachure classifier shade them instead). */
  outlineFills: boolean;
  /** Stroke width (viewBox units) applied when outlining. Default 2. */
  strokeWidth: number;
  /** Ink color for outlined strokes. Default 'currentColor' so the desk's ink
   *  token / palette overrides drive it (per feedback_palette_overrides_ink_
   *  not_paper — we set INK, never paper). */
  ink: string;
  /** Merge near-duplicate parallel sub-paths a trace emits for a single visual
   *  edge (inner+outer boundary of a thick line). Off by default — conservative;
   *  the maxPaths cap already removes most redundancy. */
  dedupeParallel: boolean;
  /** Chaikin corner-cutting iterations applied to each sub-path AFTER RDP
   *  (Sebs 2026-06-16, the Quiver "improve it" pass). A vectorizer emits faceted
   *  polygon edges; Chaikin rounds them into clean curves. 0 = off (default);
   *  2 = the image-trace smoothing level. Closed sub-paths cut around the loop;
   *  open ones keep their endpoints. */
  chaikinSmooth: number;
  /** Drop SUB-paths shorter than this fraction of the LONGEST sub-path within a
   *  path (Sebs 2026-06-16 "use L3"). The real "simplify down more" lever for
   *  filled compound line-art (e.g. the rose = one <path> with ~112 sub-paths):
   *  maxPaths can't thin a single compound path, but this removes the fine
   *  internal creases while keeping the major strokes complete. 0 = off
   *  (default); ~0.1 = the L3 minimal level. */
  minSubpathFrac: number;
}

// DEFAULTS = NON-DESTRUCTIVE NORMALIZE (Sebs 2026-06-16, supersedes the 6/13
// "abstract to a few strokes" call). Two SEPARATE jobs: (1) the Quiver request
// in imageToSvg.ts controls HOW the trace comes out (model/target_size/crop);
// (2) THIS step normalizes that SVG into our register WITHOUT destroying the
// picture. The old defaults demolished it — maxPaths:12 deleted all but 12
// regions, outlineFills:true hollowed every filled shape into a thin outline.
// New defaults: keep the picture (high path cap), KEEP fills as fills (our Smart
// Hachure converts them to value), only gentle RDP + true-noise removal. Callers
// that genuinely want the sparse few-strokes look pass explicit opts.
export const DEFAULT_SKETCHIFY: SketchifyOptions = {
  maxPaths: 200, // safety cap for pathological traces only — not an abstraction lever
  minAreaFrac: 0.0008, // drop only true noise specks (<0.08% of the drawing)
  rdpEpsilon: 1.2, // gentle: clean redundant anchors, keep the shape
  outlineFills: false, // KEEP fills — never hollow shapes into outlines
  strokeWidth: 2,
  ink: 'currentColor',
  dedupeParallel: false,
  chaikinSmooth: 0, // off by default; the image-trace cleanup opts into 2
  minSubpathFrac: 0, // off by default; the upload LINE/FILLED L3 modes opt in
};

export interface SketchifyResult {
  markup: string;
  /** What the pass did — surfaced for honest UI copy + the smart-layer dataset
   *  (per feedback_keep_feeding_smart_ml: every conversion is a data point). */
  stats: {
    pathsIn: number;
    pathsKept: number;
    pointsIn: number;
    pointsKept: number;
    outlined: boolean;
  };
}

// ── Geometry primitives ──────────────────────────────────────────────────────

type Pt = [number, number];

/** Perpendicular distance from p to the segment a→b (RDP's core measurement). */
function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  // Project p onto the (infinite) line, clamp t to the SEGMENT, measure to it.
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  return Math.hypot(p[0] - projX, p[1] - projY);
}

/** Ramer–Douglas–Peucker. Iterative (explicit stack) so a pathological trace
 *  with thousands of points can't blow the call stack. Distance-bounded by
 *  epsilon; endpoints always retained. */
export function rdpSimplify(points: Pt[], epsilon: number): Pt[] {
  const n = points.length;
  if (n < 3 || epsilon <= 0) return points.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let idx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxDist > epsilon) {
      keep[idx] = 1;
      stack.push([start, idx], [idx, end]);
    }
  }

  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

// ── Path <d> ↔ polyline sampling ─────────────────────────────────────────────
//
// We don't reimplement an SVG arc/curve flattener. Instead we use the browser's
// SVGGeometryElement geometry API (getTotalLength / getPointAtLength) to sample
// ANY path command (M/L/C/Q/A/Z) into a polyline, simplify the polyline, then
// re-emit a polyline <d>. This is the "flatten to anchors then RDP" approach the
// project already uses for drawn strokes (SvgStyleTransform rdp() :579), applied
// to the trace's paths. Sub-paths (multiple M) are split + sampled separately so
// a multi-region path doesn't get bridged by a bogus connector (the same multi-M
// hazard the Day-9 drawn-canvas overhaul fixed).

/** Split a path `d` string into sub-path `d` strings, one per `M`/`m` command. */
function splitSubpaths(d: string): string[] {
  const out: string[] = [];
  // Match an M/m and everything up to the next M/m (or end).
  const re = /[Mm][^Mm]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) out.push(m[0].trim());
  return out.length ? out : [d];
}

// DEFENSIVE SAMPLING CEILINGS (bug 1, image-flow side). svgUpload rejects giant
// path data before this module ever runs, but simplifyToSketch can also be fed
// markup from other callers, so it guards the sampling loop independently —
// never trust the input to be pre-capped. Two ceilings:
//   MAX_SAMPLE_POINTS — hard cap on getPointAtLength calls per sub-path. Even an
//     absurd total length yields at most this many samples (one path can't spin
//     the main thread on millions of geometry queries). Kept at 2048 (the prior
//     implicit clamp) — finer than any doodle needs.
//   MAX_PATH_DATA_CHARS — skip a sub-path whose `d` string is itself absurd
//     (a ~2MB single path). getTotalLength on monster data is the extra freeze
//     risk the upload-harden pass names; bail BEFORE constructing/measuring it.
const MAX_SAMPLE_POINTS = 2048;
const MAX_PATH_DATA_CHARS = 64 * 1024; // matches svgUpload's per-path cap

/** Sample a single sub-path into a polyline using the DOM geometry API.
 *  `sampleStep` is the arc-length spacing (viewBox units). Returns null if the
 *  path is degenerate (zero length / unsupported) OR absurd (oversized `d` —
 *  skipped so a monster path can't freeze the getTotalLength sampler). */
function samplePath(d: string, sampleStep: number): { pts: Pt[]; closed: boolean } | null {
  // SVGGeometryElement lives only in a DOM. Guard for non-DOM contexts (tests).
  if (typeof document === 'undefined') return null;
  // Bail on an absurd sub-path before touching the geometry API — getTotalLength
  // on a ~MB `d` string is itself a freeze hazard. Skipping returns null so the
  // caller keeps the original `d` unchanged (no crash, no freeze).
  if (d.length > MAX_PATH_DATA_CHARS) return null;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
  el.setAttribute('d', d);
  let total: number;
  try {
    total = el.getTotalLength();
  } catch {
    return null;
  }
  if (!(total > 0) || !Number.isFinite(total)) return null;

  const closed = /[Zz]\s*$/.test(d.trim());
  const step = Math.max(0.5, sampleStep);
  // MAX_SAMPLE_POINTS ceiling: an absurd `total` (or a tiny step) can't blow the
  // getPointAtLength loop into millions of iterations / a multi-second freeze.
  const count = Math.max(2, Math.min(MAX_SAMPLE_POINTS, Math.ceil(total / step) + 1));
  const pts: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const len = (i / (count - 1)) * total;
    const p = el.getPointAtLength(len);
    pts.push([p.x, p.y]);
  }
  return { pts, closed };
}

/** Chaikin corner-cutting: replace each point with two quarter/three-quarter
 *  points along its edges → rounds polygon facets into a smooth curve. Closed
 *  sub-paths cut around the loop; open ones keep their first/last point. Each
 *  iteration ~doubles the point count, so callers keep iterations small (≤2). */
function chaikin(pts: Pt[], closed: boolean, iters: number): Pt[] {
  let p = pts;
  for (let k = 0; k < iters && p.length >= 3; k++) {
    const out: Pt[] = [];
    const n = p.length;
    if (!closed) out.push(p[0]);
    const lim = closed ? n : n - 1;
    for (let i = 0; i < lim; i++) {
      const a = p[i];
      const b = p[(i + 1) % n];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}

/** Total length of a polyline (sum of segment distances) — used to rank
 *  sub-paths for the L3 subpath-drop. */
function polylineLen(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return len;
}

/** Build a polyline `d` string from points. Closed paths get a trailing Z. */
function pointsToD(pts: Pt[], closed: boolean): string {
  if (pts.length === 0) return '';
  const r = (v: number) => Math.round(v * 100) / 100;
  let d = `M ${r(pts[0][0])} ${r(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${r(pts[i][0])} ${r(pts[i][1])}`;
  if (closed) d += ' Z';
  return d;
}

// ── Salience scoring (Kang/Son LoD proxy) ───────────────────────────────────

interface ScoredPath {
  el: SVGElement;
  d: string;
  bboxArea: number;
  pathLen: number;
  /** H(e) proxy — bigger = more structurally important = keep first. */
  salience: number;
}

/** Bounding-box area of a path via the DOM geometry API (cheap, robust). */
function pathBBoxArea(el: SVGGraphicsElement): number {
  try {
    const b = el.getBBox();
    return Math.max(0, b.width) * Math.max(0, b.height);
  } catch {
    return 0;
  }
}

function pathLength(el: SVGPathElement): number {
  try {
    const l = el.getTotalLength();
    return Number.isFinite(l) ? l : 0;
  } catch {
    return 0;
  }
}

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * Turn a faithful vectorizer trace into a simpler hand-drawn-style sketch.
 *
 * Steps (each grounded in the cited research above):
 *  1. Parse the SVG, collect all <path>/<polygon>/<polyline> draw elements.
 *  2. Score each by salience (area + length proxy of Kang/Son LoD) and drop
 *     noise specks below `minAreaFrac` of the drawing.
 *  3. Keep only the top `maxPaths` by salience (the "structural lines only" end).
 *  4. Sample each kept path to a polyline (DOM geometry API), RDP-simplify it at
 *     `rdpEpsilon`, re-emit a clean polyline `d`.
 *  5. Re-express fills as outline strokes (`outlineFills`) so the hand-feel
 *     pipeline reads line art, with ink = `ink`, width = `strokeWidth`.
 *  6. Serialize back to markup (caller sanitizes).
 *
 * Degrades safely: unparseable markup, a non-DOM context, or zero usable paths
 * returns the input unchanged with a console.warn (never throws, never fakes).
 */
export function simplifyToSketch(
  svgMarkup: string,
  opts: Partial<SketchifyOptions> = {},
): SketchifyResult {
  const o: SketchifyOptions = { ...DEFAULT_SKETCHIFY, ...opts };
  const noop = (reason: string): SketchifyResult => {
    console.warn(`[simplifyToSketch] ${reason} — returning input unchanged`);
    return {
      markup: svgMarkup,
      stats: { pathsIn: 0, pathsKept: 0, pointsIn: 0, pointsKept: 0, outlined: false },
    };
  };

  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
    return noop('no DOM available');
  }

  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return noop('unparseable SVG markup');
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (svg.tagName.toLowerCase() !== 'svg') return noop('root is not <svg>');

  // The geometry API (getBBox/getTotalLength/getPointAtLength) needs the element
  // to be in a rendered document. Mount the parsed SVG offscreen so the API
  // returns real numbers; remove it in a finally so we never leak nodes.
  const host = document.createElement('div');
  host.setAttribute(
    'style',
    'position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;',
  );
  // Import the parsed <svg> into THIS document so it can be appended + measured.
  const imported = document.importNode(svg, true) as unknown as SVGSVGElement;
  host.appendChild(imported);
  document.body.appendChild(host);

  try {
    // Normalize the drawing-frame so converted path coordinates remain valid.
    // We never reproject points — getPointAtLength returns viewBox-space coords
    // already — so we only need the overall area for the minAreaFrac floor.
    let drawingArea = 0;
    try {
      const b = (imported as unknown as SVGGraphicsElement).getBBox();
      drawingArea = Math.max(1, b.width * b.height);
    } catch {
      drawingArea = 1;
    }

    // Collect convertible draw elements (paths + poly*). Other elements (rect,
    // circle, ellipse, text, image) are left untouched in place if kept, or
    // dropped if they fall outside the kept set — but to keep the contract
    // simple + predictable we only RANK/convert path-like geometry, and we
    // remove non-kept path-like geometry. Primitives (rect/circle) are rare in
    // Quiver vectorize output (it leans on paths) and are preserved verbatim.
    const drawEls = Array.from(
      imported.querySelectorAll('path, polygon, polyline'),
    ) as SVGElement[];

    const pathsIn = drawEls.length;
    if (pathsIn === 0) return noop('no path/polygon/polyline elements to simplify');

    // Convert polygon/polyline to a path `d` up front so everything downstream
    // is uniform. (points="x,y x,y ..." → M/L[/Z].)
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const unified: SVGPathElement[] = [];
    for (const el of drawEls) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'path') {
        unified.push(el as SVGPathElement);
        continue;
      }
      const ptsAttr = el.getAttribute('points') ?? '';
      const nums = ptsAttr.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      if (nums.length < 4) {
        el.parentNode?.removeChild(el);
        continue;
      }
      let d = `M ${nums[0]} ${nums[1]}`;
      for (let i = 2; i + 1 < nums.length; i += 2) d += ` L ${nums[i]} ${nums[i + 1]}`;
      if (tag === 'polygon') d += ' Z';
      const p = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
      // Carry style attributes across so salience + fill detection still work.
      for (const attr of Array.from(el.attributes)) {
        if (attr.name === 'points') continue;
        p.setAttribute(attr.name, attr.value);
      }
      p.setAttribute('d', d);
      el.parentNode?.replaceChild(p, el);
      unified.push(p);
    }

    // Score + filter (steps 2-3).
    const scored: ScoredPath[] = [];
    let pointsIn = 0;
    for (const el of unified) {
      const d = el.getAttribute('d') ?? '';
      if (!d) {
        el.parentNode?.removeChild(el);
        continue;
      }
      const bboxArea = pathBBoxArea(el);
      const pathLen = pathLength(el);
      // Rough point-count estimate for stats (commands ≈ original detail).
      pointsIn += (d.match(/[MLCQAHVZmlcqahvz]/g) ?? []).length;

      // minAreaFrac noise floor (the area<threshold cleanup heuristic).
      if (bboxArea < o.minAreaFrac * drawingArea) {
        el.parentNode?.removeChild(el);
        continue;
      }
      // Salience H(e) proxy: area dominates (segmentSize term), length adds
      // (le term). Normalized so neither swamps the other across scales.
      const areaTerm = Math.sqrt(bboxArea / drawingArea); // 0..1
      const lenTerm = pathLen / (Math.sqrt(drawingArea) + 1); // ~0..a few
      const salience = areaTerm * 2 + lenTerm;
      scored.push({ el, d, bboxArea, pathLen, salience });
    }

    if (scored.length === 0) return noop('all paths fell below the noise floor');

    // Keep top-N by salience; remove the rest from the tree.
    scored.sort((a, b) => b.salience - a.salience);
    const keep = scored.slice(0, Math.max(1, o.maxPaths));
    const drop = scored.slice(Math.max(1, o.maxPaths));
    for (const s of drop) s.el.parentNode?.removeChild(s.el);

    // Step 4-5: sample → RDP → re-emit; optionally outline fills.
    const sampleStep = Math.max(0.75, o.rdpEpsilon * 0.6); // sample finer than ε
    let pointsKept = 0;
    let outlinedAny = false;
    for (const s of keep) {
      const subDs = splitSubpaths(s.d);
      // Sample every sub-path up front so we can rank them by length for the
      // subpath-drop (the L3 lever — thins a single compound path like the rose).
      const sampledSubs = subDs.map((sub) => ({ sub, r: samplePath(sub, sampleStep) }));
      const maxSubLen =
        o.minSubpathFrac > 0
          ? Math.max(1, ...sampledSubs.map(({ r }) => (r ? polylineLen(r.pts) : 0)))
          : 0;
      const newSubDs: string[] = [];
      for (const { sub, r: sampled } of sampledSubs) {
        if (!sampled || sampled.pts.length < 2) {
          // Couldn't sample (degenerate) — keep the original sub-path d.
          newSubDs.push(sub);
          continue;
        }
        // L3 subpath-drop: remove fine internal creases (well below the longest
        // stroke) so a dense compound path reads as a few bold strokes.
        if (o.minSubpathFrac > 0 && polylineLen(sampled.pts) < o.minSubpathFrac * maxSubLen) {
          continue;
        }
        const simplified = rdpSimplify(sampled.pts, o.rdpEpsilon);
        // Chaikin-smooth the simplified polyline (image-trace de-faceting).
        const finalPts =
          o.chaikinSmooth > 0 ? chaikin(simplified, sampled.closed, o.chaikinSmooth) : simplified;
        pointsKept += finalPts.length;
        newSubDs.push(pointsToD(finalPts, sampled.closed));
      }
      const newD = newSubDs.join(' ').trim();
      if (newD) s.el.setAttribute('d', newD);

      if (o.outlineFills) {
        // Re-express as line art: drop the fill, stroke the outline. Inverse of
        // "outline stroke / expand". Ink via `ink` so palette overrides hit it.
        const hadFill =
          (s.el.getAttribute('fill') ?? '').toLowerCase() !== 'none' &&
          s.el.getAttribute('fill') !== '';
        s.el.setAttribute('fill', 'none');
        s.el.setAttribute('stroke', o.ink);
        s.el.setAttribute('stroke-width', String(o.strokeWidth));
        s.el.setAttribute('stroke-linejoin', 'round');
        s.el.setAttribute('stroke-linecap', 'round');
        // Drop trace-specific noise attrs the hand-feel pipeline doesn't want.
        s.el.removeAttribute('fill-opacity');
        s.el.removeAttribute('fill-rule');
        if (hadFill) outlinedAny = true;
      }
    }

    // Optional near-duplicate parallel-edge merge (off by default).
    if (o.dedupeParallel) dedupeParallelPaths(keep.map((k) => k.el));

    const out = new XMLSerializer().serializeToString(imported);
    return {
      markup: out,
      stats: {
        pathsIn,
        pathsKept: keep.length,
        pointsIn,
        pointsKept,
        outlined: outlinedAny,
      },
    };
  } finally {
    document.body.removeChild(host);
  }
}

// ── Optional dedupe (conservative parallel-edge merge) ───────────────────────
//
// A trace often emits an inner + outer boundary for one thick line. If two kept
// paths have near-identical, near-equal-length bounding boxes and centroids,
// drop the shorter one. Off by default (maxPaths already prunes most); exposed
// for tuning. Cheap bbox/centroid test only — no full Fréchet/Hausdorff.
function dedupeParallelPaths(els: SVGElement[]): void {
  const meta = els.map((el) => {
    let cx = 0;
    let cy = 0;
    let area = 0;
    let len = 0;
    try {
      const b = (el as unknown as SVGGraphicsElement).getBBox();
      cx = b.x + b.width / 2;
      cy = b.y + b.height / 2;
      area = b.width * b.height;
    } catch {
      /* leave zeros */
    }
    try {
      len = (el as SVGPathElement).getTotalLength();
    } catch {
      /* leave zero */
    }
    return { el, cx, cy, area, len, dead: false };
  });

  for (let i = 0; i < meta.length; i++) {
    if (meta[i].dead) continue;
    for (let j = i + 1; j < meta.length; j++) {
      if (meta[j].dead) continue;
      const a = meta[i];
      const b = meta[j];
      const span = Math.sqrt(Math.max(a.area, b.area)) + 1;
      const centroidClose = Math.hypot(a.cx - b.cx, a.cy - b.cy) < span * 0.08;
      const areaClose = Math.abs(a.area - b.area) < Math.max(a.area, b.area) * 0.15;
      if (centroidClose && areaClose) {
        // Drop the shorter (less structural) of the pair.
        const victim = a.len >= b.len ? b : a;
        victim.el.parentNode?.removeChild(victim.el);
        victim.dead = true;
      }
    }
  }
}
