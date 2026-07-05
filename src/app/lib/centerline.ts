// Centerline trace — the "LINE / direct-simplification" image-mode for uploaded
// SVGs.
//
// THE PROBLEM. A lot of "line art" SVGs aren't strokes at all — the lines are
// thin FILLED shapes (a vectorizer / icon export draws each pen-line as a long
// skinny filled polygon, or as a hollow outline = two parallel boundaries with a
// gap between them). Run our hand-feel pipeline on that and it either re-fills
// the slivers (wrong: a doodle is strokes, not filled ribbons) or strokes the
// OUTLINE of each sliver (wrong: you get a hollow double-line, the ghost of the
// original line's two edges). Neither reads as a single confident pen-line.
//
// THE FIX = CENTERLINE / SKELETONIZATION. We rasterize the filled art to a bitmap,
// thin the ink to a 1-pixel-wide skeleton (the medial axis — the TRUE middle of
// each line), prune the fine creases thinning leaves behind, then VECTORIZE that
// skeleton back into clean `<path>` polylines. Output is genuine single-line
// strokes — `fill="none"`, one centerline per visual line, no hollow outline —
// exactly the line-art the SvgStyleTransform hand-feel pipeline wants to wobble /
// hachure / pen-tip. This is the inverse of "expand stroke to fill": we collapse
// fill back to its centerline.
//
// PURE FUNCTION, degrade-safe — same contract + structure as lib/simplifyToSketch.ts:
//   • parse with DOMParser; bail to the input unchanged on anything unparseable
//   • mount offscreen in a try/finally so we never leak nodes
//   • a single `noop(reason)` helper does the console.warn + return-input path
//   • REUSE the exported `rdpSimplify` from simplifyToSketch (one RDP in the repo)
//   • output is plain SVG markup; the CALLER (svgUpload / DrawSurface / DrawPanel)
//     sanitizes it through the shared DOMPurify profile afterward — we never inject
//   • no new npm deps: canvas 2D, DOMParser, and Image are browser built-ins, the
//     same primitives simplifyToSketch already relies on
//
// ── RESEARCH BASIS (real, cited) ─────────────────────────────────────────────
// • Zhang–Suen thinning — T.Y. Zhang & C.Y. Suen, "A Fast Parallel Algorithm for
//   Thinning Digital Patterns" (Comm. ACM 27(3), 1984). The classic two-sub-
//   iteration parallel thinning that reduces a binary region to a 1-px-wide,
//   8-connected, topology-preserving skeleton. Both sub-iteration neighbor tests
//   (B = neighbor count 2..6, A = exactly one 0→1 transition, plus the two
//   corner-deletion masks) are the published conditions; this is the SAME logic
//   the proven prototype harness (tmp/dd-rose-centerline.mjs) rasterized + ran.
// • Skeleton pruning by endpoint erosion — iteratively deleting endpoint pixels
//   (degree-1 in the 8-neighborhood) K times removes every branch shorter than K
//   while leaving the main skeleton intact (standard morphological spur removal;
//   the harness's `prune`). Erases the hair-fine creases thinning always sheds.
// • Skeleton → polyline tracing — graph-walk vectorization: classify each
//   skeleton pixel by 8-neighbor degree into endpoint(1) / path(2) / junction(≥3),
//   then walk degree-2 chains between branch points to emit one ordered polyline
//   per skeleton EDGE (the standard "skeleton-to-graph" / branch-point traversal,
//   e.g. skimage `skeleton_to_csgraph`, the medial-axis-to-strokes step in
//   pencil/centerline vectorizers). Pure loops (no endpoints/junctions) are walked
//   once from any pixel around the ring.
// • RDP point simplification — Ramer–Douglas–Peucker on each traced polyline:
//   distance-bounded (never deviates more than ε from the skeleton), corner-
//   preserving, slider-stable. We import the project's single RDP from
//   simplifyToSketch (docs/research/22-research-simplification-toggle.md §2).

import { rdpSimplify } from './simplifyToSketch';

// ── Tunables ─────────────────────────────────────────────────────────────────

export interface CenterlineOptions {
  /** Raster width (px) the filled SVG is drawn at before thinning. Higher =
   *  finer skeleton + more trace detail, but quadratically more work. Default
   *  600. Hard-capped to MAX_RASTER_WIDTH so a caller can't request a giant
   *  canvas. */
  rasterWidth: number;
  /** Prune skeleton spurs shorter than this (in raster px). Each pass erodes one
   *  endpoint layer; we run `minBranchLen` passes, erasing every branch below
   *  that length — kills the hair-fine creases thinning leaves on a filled blob.
   *  Default 12. */
  minBranchLen: number;
  /** RDP tolerance in *viewBox units* applied to every traced polyline. Higher =
   *  fewer anchors = looser, more gestural centerline. Default 1.5 (ε; the
   *  distance the simplified line may deviate from the skeleton). */
  rdpEpsilon: number;
  /** Stroke width (viewBox units) on the emitted centerline paths. Default 2.5. */
  strokeWidth: number;
  /** Ink color for the centerline strokes. Default 'currentColor' so the desk's
   *  ink token / palette overrides drive it (per feedback_palette_overrides_ink_
   *  not_paper — we set INK, never paper). */
  ink: string;
}

export const DEFAULT_CENTERLINE: CenterlineOptions = {
  rasterWidth: 600,
  minBranchLen: 12,
  rdpEpsilon: 1.5,
  strokeWidth: 2.5,
  ink: 'currentColor',
};

export interface CenterlineResult {
  markup: string;
  /** What the trace produced — surfaced for honest UI copy + the smart-layer
   *  dataset (per feedback_keep_feeding_smart_ml: every conversion is a data
   *  point). `strokes` = emitted centerline paths; `points` = total anchors. */
  stats: { strokes: number; points: number };
}

// ── Performance ceilings (a pathological upload can't freeze the main thread) ──
//
// The whole pass runs on the main thread (canvas + per-pixel passes), so every
// loop is bounded by construction, mirroring svgUpload / simplifyToSketch:
//   MAX_RASTER_WIDTH / MAX_RASTER_HEIGHT — the canvas is at most ~600×900. Width
//     is clamped to MAX_RASTER_WIDTH; an extreme aspect ratio is clamped by
//     scaling so HEIGHT never exceeds MAX_RASTER_HEIGHT (a tall sliver can't
//     spawn a million-row bitmap).
//   MAX_THIN_ITERATIONS — guard on the Zhang–Suen converge loop (the harness's
//     `guard<60`); a non-converging mask still terminates.
//   MAX_PRUNE_PASSES — hard cap on spur-erosion passes even if minBranchLen is
//     set absurdly high.
//   MAX_STROKES — cap on emitted polylines; a noisy raster that fragments into
//     thousands of micro-segments stops here instead of emitting pathological
//     output (matches the simplifyToSketch maxPaths spirit).
const MAX_RASTER_WIDTH = 600;
const MAX_RASTER_HEIGHT = 900;
const MAX_THIN_ITERATIONS = 60;
const MAX_PRUNE_PASSES = 200;
const MAX_STROKES = 20000; // high — keep the whole skeleton (incl. the stem) continuous

// Luminance threshold below which a pixel counts as ink. 128 = mid-grey, the
// harness value; anti-aliased line edges fall on the bright side and drop out,
// keeping the skeleton clean.
const INK_LUMINANCE = 128;

// ── Geometry ─────────────────────────────────────────────────────────────────

type Pt = [number, number];

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * Convert FILLED line-art SVG markup into true single-line centerline strokes.
 *
 * Pipeline (each step grounded in the cited research above):
 *  a. Parse the SVG, read its viewBox (fallback to width/height) → source dims +
 *     the raster-px → viewBox-unit transform.
 *  b. Offscreen-mount + draw the FILLED svg onto a `<canvas>` (white background,
 *     then drawImage of a base64 data-URI Image), width = clamped rasterWidth,
 *     height scaled to the source aspect.
 *  c. Threshold to a binary ink mask (luminance < 128 = ink).
 *  d. Zhang–Suen thinning → a 1-px-wide skeleton.
 *  e. Prune spurs: erode endpoint pixels `minBranchLen` times → fine creases gone.
 *  f. VECTORIZE: classify skeleton pixels by 8-neighbor degree, walk degree-2
 *     chains from every endpoint + junction (and any leftover loops) → one ordered
 *     pixel polyline per skeleton edge; map each px → viewBox units; RDP-simplify
 *     at `rdpEpsilon`; drop polylines with < 2 points.
 *  g. Emit each polyline as a `fill="none"` stroked `<path>` inside a `<g>`, in an
 *     `<svg>` carrying the ORIGINAL viewBox + xmlns. Coords rounded to 2 decimals.
 *
 * Degrades safely (never throws): no DOM, no document, unparseable markup, or a
 * canvas/Image failure → console.warn + return the INPUT unchanged with zeroed
 * stats. The caller sanitizes the markup we return.
 */
export function centerlineTrace(
  svgMarkup: string,
  opts: Partial<CenterlineOptions> = {},
): CenterlineResult {
  const o: CenterlineOptions = { ...DEFAULT_CENTERLINE, ...opts };
  const noop = (reason: string): CenterlineResult => {
    console.warn(`[centerlineTrace] ${reason} — returning input unchanged`);
    return { markup: svgMarkup, stats: { strokes: 0, points: 0 } };
  };

  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
    return noop('no DOM available');
  }
  if (typeof Image === 'undefined') return noop('no Image constructor available');

  // ── a. Parse + read the drawing frame ───────────────────────────────────────
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return noop('unparseable SVG markup');
  const svgEl = doc.documentElement as unknown as SVGSVGElement;
  if (svgEl.tagName.toLowerCase() !== 'svg') return noop('root is not <svg>');

  const frame = readViewBox(svgEl);
  if (!frame) return noop('no usable viewBox / width-height dimensions');
  const { vbX, vbY, vbW, vbH } = frame;

  // ── b. Decide raster dims (clamped both axes) ────────────────────────────────
  // Width = requested rasterWidth, hard-capped. Height = aspect-scaled, then a
  // second clamp so an extreme tall aspect can't blow past MAX_RASTER_HEIGHT (we
  // rescale width down to honor it — the canvas is always ≤ ~600×900).
  let W = Math.max(8, Math.min(MAX_RASTER_WIDTH, Math.round(o.rasterWidth)));
  let H = Math.max(8, Math.round(W * (vbH / vbW)));
  if (H > MAX_RASTER_HEIGHT) {
    const k = MAX_RASTER_HEIGHT / H;
    H = MAX_RASTER_HEIGHT;
    W = Math.max(8, Math.round(W * k));
  }

  // raster px → viewBox unit transform: the canvas covers the full viewBox, so a
  // pixel (px,py) maps to (vbX + px*sx, vbY + py*sy). drawImage stretches the SVG
  // to exactly W×H, so the scale is uniform-per-axis (W↔vbW, H↔vbH).
  const sx = vbW / W;
  const sy = vbH / H;
  const toVbX = (px: number) => vbX + px * sx;
  const toVbY = (py: number) => vbY + py * sy;

  // Build a fully-rooted, sized copy of the SVG for rasterizing. We keep the
  // ORIGINAL markup's geometry but force width/height = W/H so the data-URI Image
  // rasterizes at our chosen resolution regardless of the source's attrs.
  const rasterMarkup = buildRasterMarkup(svgMarkup, W, H, vbX, vbY, vbW, vbH);

  // Offscreen host — kept in a try/finally so we never leak the node even on a
  // mid-pipeline throw (mirrors simplifyToSketch's mount discipline).
  const host = document.createElement('div');
  host.setAttribute(
    'style',
    'position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;',
  );
  document.body.appendChild(host);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return noop('2D canvas context unavailable');

    // White paper under the art so any non-ink area thresholds to background,
    // then draw the filled SVG. The Image is decoded SYNCHRONOUSLY from a base64
    // data-URI: SVG data-URIs decode without a network round-trip, so by the time
    // drawImage runs the bitmap is present (the prototype harness relied on an
    // onload await, but in a sync pure-function contract we draw immediately and
    // verify via the pixel read below — a failed decode yields an all-white
    // canvas, which we detect and noop). Encoding matches the harness exactly:
    // base64(utf8) so non-ASCII markup survives btoa.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // SYNCHRONOUS rasterize via Path2D. An SVG <Image> decodes ASYNCHRONOUSLY, so
    // drawing it immediately in this sync pure-function gave a BLANK canvas →
    // empty skeleton → Line returned the input = identical to Off (Sebs 2026-06-16
    // "off and line are the same"). Path2D fills synchronously. Map viewBox →
    // raster, then paint each path's ink (fill, evenodd-aware via ancestors; or
    // stroke for line-only art). `rasterMarkup` is unused now but kept for the
    // doc trail above.
    void rasterMarkup;
    const srcDoc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
    if (srcDoc.querySelector('parsererror')) return noop('unparseable SVG markup');
    /** Resolve a paint-ish attribute (fill / stroke / fill-rule) from the element
     *  or any ancestor — attr OR inline style; the nearest declaration wins. */
    const resolve = (el: Element, name: string): string | null => {
      let n: Element | null = el;
      const re = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i');
      while (n && typeof n.getAttribute === 'function') {
        const a = n.getAttribute(name);
        if (a) return a.trim();
        const s = n.getAttribute('style');
        const m = s && s.match(re);
        if (m) return m[1].trim();
        n = n.parentElement;
      }
      return null;
    };
    ctx.save();
    ctx.scale(W / vbW, H / vbH);
    ctx.translate(-vbX, -vbY);
    const inkPaths = Array.from(srcDoc.querySelectorAll('path'));
    for (const el of inkPaths) {
      const d = el.getAttribute('d');
      if (!d) continue;
      let path: Path2D;
      try {
        path = new Path2D(d);
      } catch {
        continue;
      }
      const fill = resolve(el, 'fill') ?? '#000'; // SVG default paint = black
      const stroke = resolve(el, 'stroke');
      if (fill.toLowerCase() !== 'none' && !/^url\(/i.test(fill)) {
        ctx.fillStyle = '#000';
        ctx.fill(path, (resolve(el, 'fill-rule') || '').toLowerCase() === 'evenodd' ? 'evenodd' : 'nonzero');
      }
      if (stroke && stroke.toLowerCase() !== 'none') {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = Math.max(sx, sy) * 1.6;
        ctx.stroke(path);
      }
    }
    ctx.restore();

    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, W, H).data;
    } catch {
      // A tainted canvas (cross-origin <image>/<use> in the source) blocks the
      // pixel read — bail rather than throw.
      return noop('canvas pixel read blocked (tainted source)');
    }

    // ── c. Threshold → binary ink mask (1 = ink) ───────────────────────────────
    const bin = new Uint8Array(W * H);
    let inkCount = 0;
    for (let i = 0; i < W * H; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const a = data[i * 4 + 3];
      // Treat transparent pixels as paper (a == 0 → over the white fill we already
      // painted, so it's already white; this just makes intent explicit).
      const lum = a === 0 ? 255 : 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < INK_LUMINANCE) {
        bin[i] = 1;
        inkCount++;
      }
    }
    if (inkCount === 0) {
      // All-white canvas — the SVG didn't rasterize (sync decode missed) or the
      // art is empty. Either way there's nothing to skeletonize.
      return noop('no ink pixels after rasterization (empty or undecodable SVG)');
    }

    // ── d. Zhang–Suen thinning → 1-px skeleton ─────────────────────────────────
    thinZhangSuen(bin, W, H);

    // ── e. Prune short spurs ───────────────────────────────────────────────────
    const pruneK = Math.max(0, Math.min(MAX_PRUNE_PASSES, Math.round(o.minBranchLen)));
    if (pruneK > 0) pruneSpurs(bin, W, H, pruneK);

    // ── f. Vectorize the skeleton → viewBox-space polylines ────────────────────
    const pixelPolylines = traceSkeleton(bin, W, H);

    // ── g. Map → viewBox, RDP-simplify, emit ───────────────────────────────────
    const paths: string[] = [];
    let totalPoints = 0;
    const round = (v: number) => Math.round(v * 100) / 100;

    for (const poly of pixelPolylines) {
      if (paths.length >= MAX_STROKES) break;
      // Map raster px → viewBox units BEFORE RDP so ε is measured in viewBox space
      // (the documented unit of rdpEpsilon).
      const vbPts: Pt[] = poly.map(([px, py]) => [toVbX(px), toVbY(py)]);
      const simplified = o.rdpEpsilon > 0 ? rdpSimplify(vbPts, o.rdpEpsilon) : vbPts;
      if (simplified.length < 2) continue; // a single point isn't a stroke

      let d = `M ${round(simplified[0][0])} ${round(simplified[0][1])}`;
      for (let i = 1; i < simplified.length; i++) {
        d += ` L ${round(simplified[i][0])} ${round(simplified[i][1])}`;
      }
      paths.push(
        `<path d="${d}" fill="none" stroke="${o.ink}" stroke-width="${o.strokeWidth}" ` +
          `stroke-linecap="round" stroke-linejoin="round"/>`,
      );
      totalPoints += simplified.length;
    }

    if (paths.length === 0) return noop('skeleton produced no traceable strokes');

    const out =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">` +
      `<g>${paths.join('')}</g>` +
      `</svg>`;
    return { markup: out, stats: { strokes: paths.length, points: totalPoints } };
  } finally {
    document.body.removeChild(host);
  }
}

// ── Drawing-frame parsing (mirrors normalizeInput.ts) ─────────────────────────

/** Read the source viewBox; fall back to width/height attrs. Returns null when
 *  no usable, positive-area frame can be derived. */
function readViewBox(
  svg: SVGSVGElement,
): { vbX: number; vbY: number; vbW: number; vbH: number } | null {
  let vbX = 0;
  let vbY = 0;
  let vbW = 0;
  let vbH = 0;
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      [vbX, vbY, vbW, vbH] = parts;
    }
  }
  if (!(vbW > 0 && vbH > 0)) {
    // parseFloat drops unit suffixes ("px"); percentage sizes have no px meaning
    // so the positive-area guard below catches NaN/0.
    const attrW = parseFloat(svg.getAttribute('width') ?? '');
    const attrH = parseFloat(svg.getAttribute('height') ?? '');
    if (attrW > 0 && attrH > 0) {
      vbX = 0;
      vbY = 0;
      vbW = attrW;
      vbH = attrH;
    }
  }
  if (!(vbW > 0 && vbH > 0) || !Number.isFinite(vbW) || !Number.isFinite(vbH)) return null;
  return { vbX, vbY, vbW, vbH };
}

/** Build a sized, viewBox-stamped copy of the markup for rasterizing. We force
 *  the OUTER `<svg>`'s width/height to the raster dims + restamp the viewBox so
 *  the data-URI Image always decodes at W×H regardless of the source's own sizing
 *  attrs. Geometry is untouched (we only rewrite the root `<svg ...>` open tag).
 *  Falls back to the original markup if the open tag can't be located. */
function buildRasterMarkup(
  svgMarkup: string,
  W: number,
  H: number,
  vbX: number,
  vbY: number,
  vbW: number,
  vbH: number,
): string {
  const open = /<svg\b[^>]*>/i.exec(svgMarkup);
  if (!open) return svgMarkup;
  const newOpen =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
    `viewBox="${vbX} ${vbY} ${vbW} ${vbH}" preserveAspectRatio="none">`;
  return svgMarkup.slice(0, open.index) + newOpen + svgMarkup.slice(open.index + open[0].length);
}

// ── d. Zhang–Suen thinning ────────────────────────────────────────────────────

/**
 * In-place Zhang–Suen parallel thinning. Reduces the binary ink mask `bin`
 * (1 = ink) to a 1-px-wide, 8-connected, topology-preserving skeleton. Two
 * sub-iterations per pass, repeated until no pixel is removed (or the iteration
 * guard trips). Copied from the proven harness — the neighbor conditions are the
 * published 1984 conditions and are correct.
 */
function thinZhangSuen(bin: Uint8Array, W: number, H: number): void {
  const idx = (x: number, y: number) => y * W + x;

  // One sub-iteration. `step` 0 = first sub-iteration's masks, 1 = second's.
  // Returns how many pixels it removed (0 = converged for this sub-iteration).
  const pass = (step: 0 | 1): number => {
    const rem: number[] = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!bin[idx(x, y)]) continue;
        // P2..P9 = the 8 neighbors, clockwise from north (matches the paper's
        // numbering — the harness order).
        const p2 = bin[idx(x, y - 1)];
        const p3 = bin[idx(x + 1, y - 1)];
        const p4 = bin[idx(x + 1, y)];
        const p5 = bin[idx(x + 1, y + 1)];
        const p6 = bin[idx(x, y + 1)];
        const p7 = bin[idx(x - 1, y + 1)];
        const p8 = bin[idx(x - 1, y)];
        const p9 = bin[idx(x - 1, y - 1)];

        // B(P1) = number of ink neighbors; must be 2..6.
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;

        // A(P1) = number of 0→1 transitions in the ordered neighbor ring; must be
        // exactly 1 (P1 lies on a simple boundary, not a junction).
        const s = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let i = 0; i < 8; i++) if (s[i] === 0 && s[i + 1] === 1) A++;
        if (A !== 1) continue;

        // Sub-iteration corner masks (the two condition pairs from the paper).
        if (step === 0) {
          if (p2 * p4 * p6 !== 0) continue;
          if (p4 * p6 * p8 !== 0) continue;
        } else {
          if (p2 * p4 * p8 !== 0) continue;
          if (p2 * p6 * p8 !== 0) continue;
        }
        rem.push(idx(x, y));
      }
    }
    for (const i of rem) bin[i] = 0;
    return rem.length;
  };

  let changed = 1;
  let guard = 0;
  while (changed && guard < MAX_THIN_ITERATIONS) {
    changed = pass(0) + pass(1);
    guard++;
  }
}

// ── e. Spur pruning ───────────────────────────────────────────────────────────

/** Count 8-neighbors of (x,y) in `arr`. Interior-only callers (1..W-2, 1..H-2)
 *  so no bounds branch is needed. */
function neighborCount(arr: Uint8Array, W: number, x: number, y: number): number {
  const idx = (xx: number, yy: number) => yy * W + xx;
  return (
    arr[idx(x, y - 1)] +
    arr[idx(x + 1, y - 1)] +
    arr[idx(x + 1, y)] +
    arr[idx(x + 1, y + 1)] +
    arr[idx(x, y + 1)] +
    arr[idx(x - 1, y + 1)] +
    arr[idx(x - 1, y)] +
    arr[idx(x - 1, y - 1)]
  );
}

/**
 * Erode skeleton spurs in-place: K passes, each removing every endpoint pixel
 * (≤ 1 ink neighbor). K passes delete every branch shorter than K, clearing the
 * fine creases thinning sheds off a filled blob, while the main skeleton (whose
 * pixels keep ≥ 2 neighbors) survives. (The harness's `prune`.)
 */
function pruneSpurs(bin: Uint8Array, W: number, H: number, K: number): void {
  const idx = (x: number, y: number) => y * W + x;
  for (let k = 0; k < K; k++) {
    const rem: number[] = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (bin[idx(x, y)] && neighborCount(bin, W, x, y) <= 1) rem.push(idx(x, y));
      }
    }
    if (rem.length === 0) break; // converged early
    for (const i of rem) bin[i] = 0;
  }
}

// ── f. Skeleton → polyline tracing ────────────────────────────────────────────

/**
 * Trace a 1-px skeleton mask into ordered pixel polylines, one per skeleton EDGE.
 *
 * Classify each ink pixel by its 8-neighbor degree:
 *   1  → endpoint (a line's tip)
 *   2  → path pixel (interior of a line)
 *   ≥3 → junction (where lines meet)
 * Then:
 *  1. From every endpoint and every junction, walk along degree-2 chains until
 *     the next endpoint/junction, emitting an ordered polyline per segment.
 *     A `visited` set marks each path pixel as it's consumed so every edge is
 *     emitted exactly once; branch points are NOT marked global-visited (they
 *     anchor multiple edges) — instead we forbid re-entering an edge by its first
 *     step. This is the standard branch-point traversal of a skeleton graph.
 *  2. Any pixels left unvisited after step 1 form pure LOOPS (rings with no
 *     endpoint or junction — e.g. a traced 'O'). Walk each such loop once from any
 *     remaining pixel, all the way around, marking as we go.
 *
 * Coordinates are returned in RASTER px (centered on each pixel via +0.5 so the
 * polyline runs through pixel centers); the caller maps to viewBox units. Bounds:
 * skeleton pixels live in the interior (thinning + pruning only touch 1..W-2,
 * 1..H-2), and the walk only steps to existing ink pixels, so no edge guard is
 * needed inside the 8-neighbor probes.
 */
function traceSkeleton(bin: Uint8Array, W: number, H: number): Pt[][] {
  const idx = (x: number, y: number) => y * W + x;
  // 8-neighbor offsets (any consistent order works for a walk).
  const NX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const NY = [-1, -1, -1, 0, 0, 1, 1, 1];

  const degree = (x: number, y: number): number => {
    let d = 0;
    for (let k = 0; k < 8; k++) if (bin[idx(x + NX[k], y + NY[k])]) d++;
    return d;
  };

  // visited[i] = this path pixel has been consumed into an emitted polyline.
  // Branch points (endpoints/junctions) are tracked separately so multiple edges
  // can still anchor on them.
  const visited = new Uint8Array(W * H);
  const isBranch = new Uint8Array(W * H);

  // Collect branch points (degree 1 or ≥3) in one interior pass.
  const branchPts: Array<[number, number]> = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!bin[idx(x, y)]) continue;
      const d = degree(x, y);
      if (d === 1 || d >= 3) {
        isBranch[idx(x, y)] = 1;
        branchPts.push([x, y]);
      }
    }
  }

  const polylines: Pt[][] = [];
  const center = (x: number, y: number): Pt => [x + 0.5, y + 0.5];

  // Walk one edge starting at branch point (sx,sy) by stepping to neighbor
  // (nx,ny). Follows degree-2 chain until the next branch point (inclusive) or a
  // dead end. Returns the ordered pixel polyline (branch endpoints included).
  const walkEdge = (sx: number, sy: number, nx: number, ny: number): Pt[] => {
    const pts: Pt[] = [center(sx, sy)];
    let px = sx;
    let py = sy;
    let cx = nx;
    let cy = ny;
    // Guard the step count so a degenerate ring can't loop forever.
    let steps = 0;
    const maxSteps = W * H + 4;
    while (steps++ < maxSteps) {
      pts.push(center(cx, cy));
      if (isBranch[idx(cx, cy)]) return pts; // reached the next branch point
      visited[idx(cx, cy)] = 1; // consume this interior (degree-2) pixel
      // Step to the single unvisited ink neighbor that isn't where we came from.
      let foundX = -1;
      let foundY = -1;
      for (let k = 0; k < 8; k++) {
        const ax = cx + NX[k];
        const ay = cy + NY[k];
        if (!bin[idx(ax, ay)]) continue;
        if (ax === px && ay === py) continue; // don't backtrack
        if (isBranch[idx(ax, ay)]) {
          // A branch point closes the edge — prefer it immediately.
          foundX = ax;
          foundY = ay;
          break;
        }
        if (!visited[idx(ax, ay)]) {
          foundX = ax;
          foundY = ay;
          // keep scanning in case a branch point is also adjacent (handled above)
        }
      }
      if (foundX === -1) return pts; // dead end (shouldn't happen on a clean skel)
      px = cx;
      py = cy;
      cx = foundX;
      cy = foundY;
    }
    return pts;
  };

  // Step 1 — walk every edge out of every branch point. For an endpoint there's
  // one outgoing direction; for a junction, one per incident edge. We start an
  // edge only into a NON-branch (degree-2) neighbor that hasn't been consumed, OR
  // directly into another branch point (a 1-px edge between two junctions) which
  // we record as a 2-point segment guarded against duplication.
  const directEdgeSeen = new Set<number>();
  for (const [bx, by] of branchPts) {
    for (let k = 0; k < 8; k++) {
      const nx = bx + NX[k];
      const ny = by + NY[k];
      if (!bin[idx(nx, ny)]) continue;
      if (isBranch[idx(nx, ny)]) {
        // Branch-to-branch single-pixel edge. Emit once (keyed on the unordered
        // pixel pair) so both endpoints don't both emit it.
        const aI = idx(bx, by);
        const bI = idx(nx, ny);
        const key = aI < bI ? aI * (W * H) + bI : bI * (W * H) + aI;
        if (!directEdgeSeen.has(key)) {
          directEdgeSeen.add(key);
          polylines.push([center(bx, by), center(nx, ny)]);
        }
        continue;
      }
      if (visited[idx(nx, ny)]) continue; // this edge already walked
      polylines.push(walkEdge(bx, by, nx, ny));
      if (polylines.length >= MAX_STROKES) return polylines;
    }
  }

  // Step 2 — pure loops: any unvisited, non-branch ink pixel belongs to a ring
  // with no endpoint/junction. Walk it once around and close it.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (!bin[i] || visited[i] || isBranch[i]) continue;
      const loop = walkLoop(bin, W, NX, NY, visited, x, y);
      if (loop.length >= 2) polylines.push(loop);
      if (polylines.length >= MAX_STROKES) return polylines;
    }
  }

  return polylines;
}

/** Walk a pure loop (degree-2 ring) once from (sx,sy), marking pixels visited and
 *  closing back to the start. Used only for skeleton rings with no branch point. */
function walkLoop(
  bin: Uint8Array,
  W: number,
  NX: number[],
  NY: number[],
  visited: Uint8Array,
  sx: number,
  sy: number,
): Pt[] {
  const idx = (x: number, y: number) => y * W + x;
  const center = (x: number, y: number): Pt => [x + 0.5, y + 0.5];
  const pts: Pt[] = [center(sx, sy)];
  visited[idx(sx, sy)] = 1;
  let px = -1;
  let py = -1;
  let cx = sx;
  let cy = sy;
  let steps = 0;
  const maxSteps = bin.length + 4;
  while (steps++ < maxSteps) {
    let foundX = -1;
    let foundY = -1;
    for (let k = 0; k < 8; k++) {
      const ax = cx + NX[k];
      const ay = cy + NY[k];
      if (!bin[idx(ax, ay)]) continue;
      if (ax === px && ay === py) continue; // don't backtrack
      if (ax === sx && ay === sy && steps > 1) {
        // Looped back to the start — close the ring and stop.
        pts.push(center(sx, sy));
        return pts;
      }
      if (!visited[idx(ax, ay)]) {
        foundX = ax;
        foundY = ay;
        break;
      }
    }
    if (foundX === -1) return pts; // ring opened (shouldn't on a clean skeleton)
    visited[idx(foundX, foundY)] = 1;
    pts.push(center(foundX, foundY));
    px = cx;
    py = cy;
    cx = foundX;
    cy = foundY;
  }
  return pts;
}
