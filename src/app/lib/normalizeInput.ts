// Input-boundary auto-resize normalizer.
//
// Locked decision per docs/research/21-research-3d-pipeline-and-style-translation.md
// §2 (ask #11): AUTO-RESIZE on every upload, NO reshape controls in MVP.
// Every input (drawn / SVG / image bbox) is normalized to a canonical size
// (~140-200px, target 180px on the longest axis) by a SINGLE function at the
// input boundary, applied once before the item enters the render pipeline.
// Reshape gestures (drag-handles, pinch-zoom, aspect locking) = post-MVP.
//
// Live now — used by the /desk flow (DeskPage / DrawPanel) to size every
// added item (~180px on the longest axis) at the input boundary.

/**
 * Normalize an SVG markup string so its longest axis renders at
 * `targetMaxPx`. Scales UP small inputs and DOWN large ones (uniform scale
 * per 21-research §2 pseudo-code). The viewBox is preserved (or derived from
 * width/height when missing) so the content scales with the new
 * width/height attributes instead of cropping.
 *
 * Degenerate inputs (unparseable markup, no usable dimensions, zero-size)
 * return the input unchanged with a console.warn — §2 logs edge cases, MVP
 * doesn't fix them.
 */
export function normalizeSvgSize(svgMarkup: string, targetMaxPx = 180): string {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    console.warn('[normalizeSvgSize] unparseable SVG markup — returning input unchanged');
    return svgMarkup;
  }
  const svg = doc.documentElement;
  if (svg.tagName.toLowerCase() !== 'svg') {
    console.warn('[normalizeSvgSize] root element is not <svg> — returning input unchanged');
    return svgMarkup;
  }

  // Read viewBox; fall back to width/height attrs when missing.
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
    // No usable viewBox — derive from width/height attrs (parseFloat drops
    // unit suffixes like "px"; percentage sizes have no px meaning, so the
    // zero-dimension guard below catches NaN too).
    const attrW = parseFloat(svg.getAttribute('width') ?? '');
    const attrH = parseFloat(svg.getAttribute('height') ?? '');
    if (attrW > 0 && attrH > 0) {
      vbX = 0;
      vbY = 0;
      vbW = attrW;
      vbH = attrH;
    }
  }

  const longSide = Math.max(vbW, vbH);
  if (!(longSide > 0) || !Number.isFinite(longSide)) {
    console.warn('[normalizeSvgSize] zero/unknown dimensions — returning input unchanged');
    return svgMarkup;
  }

  const scale = targetMaxPx / longSide;
  const round = (v: number) => Math.round(v * 100) / 100;
  svg.setAttribute('width', String(round(vbW * scale)));
  svg.setAttribute('height', String(round(vbH * scale)));
  // Preserve (or set the derived) viewBox so content scales with the new size.
  svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);

  return new XMLSerializer().serializeToString(svg);
}

/**
 * Bbox flavor of the same §2 normalization — for non-SVG inputs (drawn
 * strokes, raster images) where the caller already has a width/height.
 * Returns the uniformly-scaled size whose longest axis = `targetMaxPx`.
 * Zero/invalid dimensions return the input unchanged with a console.warn.
 */
export function normalizeBBox(
  w: number,
  h: number,
  targetMaxPx = 180,
): { width: number; height: number } {
  const longSide = Math.max(w, h);
  if (!(longSide > 0) || !Number.isFinite(longSide)) {
    console.warn('[normalizeBBox] zero/unknown dimensions — returning input unchanged');
    return { width: w, height: h };
  }
  const scale = targetMaxPx / longSide;
  return { width: w * scale, height: h * scale };
}
