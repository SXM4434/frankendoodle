// svgToParts — turn an SVG drawing into a list of editable PARTS *losslessly*.
//
// Unlike svgToStrokes (which flattens every shape to an ink outline for the 3D
// bridge — fills lost), this keeps each geometry element AS a real SVG element:
// it tags each one with a `data-part-id` and returns the annotated markup plus
// per-part metadata (bbox in viewBox space, computed fill/stroke) for the editor's
// hit-testing, handles, and restyle UI. The editor mounts the annotated markup and
// manipulates the live elements by id (move = transform, restyle = fill/stroke,
// delete = remove) — so fills, colours, and curves survive every edit, and on
// save the element-set re-serialises with everything intact.
//
// Browser-only: getBBox/getCTM/getComputedStyle need a live mounted element.
// Deterministic: no randomness, no wall-clock.

const GEOM_SELECTOR = 'path, line, polyline, polygon, rect, circle, ellipse';

export interface SvgPart {
  /** Stable id, also written as data-part-id on the live element. */
  id: string;
  /** Element tag (path/rect/circle/…). */
  tag: string;
  /** Axis-aligned bbox in the SVG's viewBox coordinate space (incl. transforms). */
  bbox: { x: number; y: number; w: number; h: number };
  /** Computed fill (resolves inherited group fills) — for the selection chip / restyle default. */
  fill: string;
  /** Computed stroke. */
  stroke: string;
  /** The element's OWN `transform` attribute as authored (e.g. a baked-in move from a
   *  previous edit). The bbox above already reflects it (getCTM). The editor must
   *  COMPOSE its move/resize on TOP of this — never replace it, or a previously-moved
   *  part snaps back to its untransformed spot while its selection box stays put. */
  transform: string;
}

export interface SvgPartsResult {
  parts: SvgPart[];
  viewBox: { x: number; y: number; w: number; h: number };
  /** The SVG markup with a data-part-id on every geometry element — what the editor mounts. */
  markup: string;
}

function readViewBox(svg: SVGSVGElement): { x: number; y: number; w: number; h: number } | null {
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every(Number.isFinite) && p[2] > 0 && p[3] > 0) return { x: p[0], y: p[1], w: p[2], h: p[3] };
  }
  const w = parseFloat(svg.getAttribute('width') || '');
  const h = parseFloat(svg.getAttribute('height') || '');
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { x: 0, y: 0, w, h };
  return null;
}

/** bbox of `el` in the SVG's viewBox-USER coordinate space — i.e. the same raw
 *  coordinates the elements carry in the markup (so the editor, which renders the
 *  stripped inner markup directly, places the selection box exactly on the element).
 *  getBBox is element-local; getCTM carries the element's own + ancestor transforms
 *  to the viewport BUT also normalizes the viewBox origin to 0 (verified: a child of
 *  `viewBox="-106 -60 …"` maps local 0 → 106). So we ADD (vb.x, vb.y) back to undo that
 *  normalization and return true user coords — critical for off-origin/negative
 *  viewBoxes (a re-saved part-edited doodle), identity for the common `0 0 W H`. */
function bboxInViewBox(el: SVGGraphicsElement, vb: { x: number; y: number }): { x: number; y: number; w: number; h: number } | null {
  let b: DOMRect;
  try { b = el.getBBox(); } catch { return null; }
  if (!Number.isFinite(b.width) || !Number.isFinite(b.height)) return null;
  const m = el.getCTM();
  const corners = [
    [b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height],
  ].map(([x, y]) => (m ? { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f } : { x, y }));
  const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  return { x: minX + vb.x, y: minY + vb.y, w: maxX - minX, h: maxY - minY };
}

export interface SvgToPartsOptions {
  /** Cap on parts; beyond this the caller should fall back to draw-over (too many to edit). Default 60. */
  maxParts?: number;
}

/** Parse SVG markup → editable parts. Returns null if no viewBox / no geometry. */
export function svgToParts(markup: string, options: SvgToPartsOptions = {}): SvgPartsResult | null {
  if (typeof document === 'undefined' || !markup) return null;
  const maxParts = options.maxParts ?? 60;

  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;
  const parsedSvg = doc.querySelector('svg');
  if (!parsedSvg) return null;
  const vb = readViewBox(parsedSvg as SVGSVGElement);
  if (!vb) return null;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const mountSvg = doc.documentElement.cloneNode(true) as SVGSVGElement;
  mountSvg.setAttribute('width', String(vb.w));
  mountSvg.setAttribute('height', String(vb.h));
  mountSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  host.appendChild(mountSvg);
  document.body.appendChild(host);

  const parts: SvgPart[] = [];
  try {
    const els = Array.from(mountSvg.querySelectorAll(GEOM_SELECTOR)) as SVGGraphicsElement[];
    for (let i = 0; i < els.length && parts.length < maxParts; i++) {
      const el = els[i];
      const bbox = bboxInViewBox(el, vb);
      if (!bbox || bbox.w < 0.01 && bbox.h < 0.01) continue; // skip degenerate
      const id = `part-${i}`;
      const transform = el.getAttribute('transform') || ''; // original, BEFORE we touch it
      el.setAttribute('data-part-id', id);
      let fill = '', stroke = '';
      try { const cs = getComputedStyle(el); fill = cs.fill; stroke = cs.stroke; } catch { /* */ }
      parts.push({ id, tag: el.tagName.toLowerCase(), bbox, fill, stroke, transform });
    }
  } finally {
    document.body.removeChild(host);
  }
  if (parts.length === 0) return null;
  const markupOut = new XMLSerializer().serializeToString(mountSvg);
  return { parts, viewBox: vb, markup: markupOut };
}
