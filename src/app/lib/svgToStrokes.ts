// svgToStrokes — the EASY uploaded-SVG → 3D bridge (no AI / no credits).
//
// Uploaded SVGs land in DrawSurface as 2D-only markup and never enter the stroke
// pool, so flipping to 3D showed "nothing to convert" (svg-upload OFAT aaaf91d8,
// Sebs's repeated "wire the svg up"). This flattens the uploaded vector art into
// the SAME StrokePoint[][] the drawn-stroke path already feeds into the proven
// strokeTo3d engine (rod / extrude / solid). Complex raster→GLB stays the R10
// hard path; this covers every line/curve/shape an SVG carries.
//
// Coordinate space: the 3D engine normalizes strokes from the 800×600 draw
// viewBox (DEFAULT_VIEWBOX / VIEWBOX_W×H). fitUploadMarkup keeps the upload's OWN
// viewBox and fits it visually with `xMidYMid meet`, so we reproduce that exact
// letterboxed fit here — sampled points land where the user SEES the art.
//
// Browser-only: uses DOMParser + SVGGeometryElement.getTotalLength/getPointAtLength
// (every path/line/polyline/polygon/rect/circle/ellipse is an SVGGeometryElement),
// which need the element mounted in the live document. Deterministic: fixed-step
// arc-length sampling, no randomness, no wall-clock — same markup → same strokes.

export type StrokePoint = [number, number, number]; // x, y, pressure (matches DrawSurface)

const TARGET_W = 800; // VIEWBOX_W
const TARGET_H = 600; // VIEWBOX_H

/** Geometry elements we can arc-length sample. All are SVGGeometryElement. */
const GEOM_SELECTOR = 'path, line, polyline, polygon, rect, circle, ellipse';

export interface SvgToStrokesOptions {
  /** Target draw-frame width (engine viewBox). Default 800. */
  targetW?: number;
  /** Target draw-frame height. Default 600. */
  targetH?: number;
  /** Approx arc-length (target-space px) between sampled points. Default 4. */
  stepPx?: number;
  /** Min samples per element (so a tiny shape still has a usable loop). Default 12. */
  minSamples?: number;
  /** Max samples per single element (perf guard). Default 600. */
  maxSamplesPerEl?: number;
  /** Max elements converted (perf guard; matches the canvas stroke cap intent). Default 400. */
  maxElements?: number;
}

interface FitTransform {
  scale: number;
  offX: number;
  offY: number;
}

/** Parse `0 0 W H` viewBox; fall back to width/height; else null. */
function readViewBox(svg: SVGSVGElement): { x: number; y: number; w: number; h: number } | null {
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every((n) => Number.isFinite(n)) && p[2] > 0 && p[3] > 0) {
      return { x: p[0], y: p[1], w: p[2], h: p[3] };
    }
  }
  const w = parseFloat(svg.getAttribute('width') || '');
  const h = parseFloat(svg.getAttribute('height') || '');
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { x: 0, y: 0, w, h };
  }
  return null;
}

/** xMidYMid meet fit of [vb] into target W×H (letterbox, centered) — the same
 *  contract as fitUploadMarkup's preserveAspectRatio, so 3D matches the 2D view. */
function fitOf(
  vb: { x: number; y: number; w: number; h: number },
  tW: number,
  tH: number,
): FitTransform {
  const scale = Math.min(tW / vb.w, tH / vb.h);
  const offX = (tW - vb.w * scale) / 2 - vb.x * scale;
  const offY = (tH - vb.h * scale) / 2 - vb.y * scale;
  return { scale, offX, offY };
}

/** Max path `d` chars to sample (a ~2MB single path freezes getTotalLength). */
const MAX_PATH_DATA_CHARS = 64 * 1024;

/** Split a path `d` into sub-path `d` strings, one per M/m, so a compound path —
 *  e.g. the rose's 112 filled loops — is sampled as SEPARATE loops instead of one
 *  arc-length parameterization that bridges disjoint subpaths with bogus
 *  connectors (the 3D "bird's-nest" rod). Mirrors simplifyToSketch.splitSubpaths. */
function splitSubpaths(d: string): string[] {
  const out: string[] = [];
  const re = /[Mm][^Mm]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) out.push(m[0].trim());
  return out.length ? out : [d];
}

/** Sample one geometry element into a target-space polyline. Returns [] on any
 *  failure (degenerate length, non-finite point, browser refusal) — never throws. */
function sampleElement(
  el: SVGGeometryElement,
  fit: FitTransform,
  opts: Required<SvgToStrokesOptions>,
): StrokePoint[] {
  let total = 0;
  try {
    total = el.getTotalLength();
  } catch {
    return [];
  }
  if (!Number.isFinite(total) || total <= 0.01) return [];
  // Step is in TARGET space; convert to the element's user-space length.
  const userStep = Math.max(opts.stepPx / Math.max(fit.scale, 1e-6), 0.01);
  let n = Math.ceil(total / userStep) + 1;
  n = Math.max(opts.minSamples, Math.min(n, opts.maxSamplesPerEl));
  const out: StrokePoint[] = [];
  for (let i = 0; i < n; i++) {
    const len = (total * i) / (n - 1);
    let pt: DOMPoint;
    try {
      pt = el.getPointAtLength(len);
    } catch {
      return [];
    }
    const x = pt.x * fit.scale + fit.offX;
    const y = pt.y * fit.scale + fit.offY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    out.push([x, y, 0.5]);
  }
  return out;
}

/** Convert sanitized SVG markup into StrokePoint[][] for the 3D engine.
 *  Mounts the markup offscreen (getPointAtLength needs a live element), samples
 *  every geometry element, then tears the mount down. Returns [] if the markup
 *  has no usable geometry or no viewBox/size — the caller keeps the honest gate. */
export function svgMarkupToStrokes(markup: string, options: SvgToStrokesOptions = {}): StrokePoint[][] {
  if (typeof document === 'undefined' || !markup) return [];
  const opts: Required<SvgToStrokesOptions> = {
    targetW: options.targetW ?? TARGET_W,
    targetH: options.targetH ?? TARGET_H,
    stepPx: options.stepPx ?? 4,
    minSamples: options.minSamples ?? 12,
    maxSamplesPerEl: options.maxSamplesPerEl ?? 600,
    maxElements: options.maxElements ?? 400,
  };

  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return [];
  const parsedSvg = doc.querySelector('svg');
  if (!parsedSvg) return [];

  const vb = readViewBox(parsedSvg as SVGSVGElement);
  if (!vb) return [];
  const fit = fitOf(vb, opts.targetW, opts.targetH);

  // Offscreen host so SVGGeometryElement length APIs resolve. Sized to the
  // viewBox in user units (1:1) so getPointAtLength returns user-space coords;
  // we apply the fit transform ourselves (not via CSS) for exact control.
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const mountSvg = doc.documentElement.cloneNode(true) as SVGSVGElement;
  mountSvg.setAttribute('width', String(vb.w));
  mountSvg.setAttribute('height', String(vb.h));
  mountSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  host.appendChild(mountSvg);
  document.body.appendChild(host);

  const strokes: StrokePoint[][] = [];
  try {
    const els = Array.from(mountSvg.querySelectorAll(GEOM_SELECTOR)) as SVGGeometryElement[];
    const SVG_NS = 'http://www.w3.org/2000/svg';
    for (const el of els) {
      if (strokes.length >= opts.maxElements) break;
      // SUBPATH SPLIT (rose fix): a compound <path> (M…M…) sampled as ONE element
      // parameterizes every subpath as a single arc length → one polyline that
      // bridges disjoint loops (the rose's 112 filled loops → a giant tangled rod
      // in 3D). Split a multi-subpath <path> and sample EACH subpath as its own
      // loop. Single-subpath paths + other geometry sample exactly as before.
      const d = el.tagName.toLowerCase() === 'path' ? el.getAttribute('d') : null;
      const subs = d ? splitSubpaths(d) : null;
      if (subs && subs.length > 1) {
        for (const sd of subs) {
          if (strokes.length >= opts.maxElements) break;
          if (!sd || sd.length > MAX_PATH_DATA_CHARS) continue;
          const tmp = document.createElementNS(SVG_NS, 'path') as SVGGeometryElement;
          tmp.setAttribute('d', sd);
          mountSvg.appendChild(tmp);
          const pts = sampleElement(tmp, fit, opts);
          mountSvg.removeChild(tmp);
          if (pts.length >= 2) strokes.push(pts);
        }
      } else {
        const pts = sampleElement(el, fit, opts);
        if (pts.length >= 2) strokes.push(pts);
      }
    }
  } finally {
    document.body.removeChild(host);
  }
  return strokes;
}
