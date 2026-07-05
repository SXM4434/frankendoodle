// monochromeSvg — strip COLOUR from uploaded SVG markup at INGESTION, so the whole
// app (desk, editor, 3D, everywhere) sees a monochrome doodle. Desk Doodles is
// colourless by identity — "value from marks, never hue". Each element's EFFECTIVE
// fill/stroke (resolving inheritance + <style> blocks via getComputedStyle) is
// mapped to its LUMINANCE grey, written as an explicit attribute, and the
// colour-bearing <style> blocks are dropped. Shapes keep their VALUE so they stay
// distinct (a light head vs dark eyes) — only hue is removed. none/transparent kept.
//
// Browser-only (getComputedStyle needs a mounted element). Deterministic: pure
// luminance, no randomness/wall-clock — same markup → same monochrome.

const SKIP_TAGS = new Set(['style', 'defs', 'lineargradient', 'radialgradient', 'pattern', 'filter', 'clippath', 'mask', 'symbol', 'metadata', 'title', 'desc']);

export function monochromeSvgMarkup(markup: string): string {
  if (typeof document === 'undefined' || !markup) return markup;
  let doc: Document;
  try { doc = new DOMParser().parseFromString(markup, 'image/svg+xml'); } catch { return markup; }
  if (doc.querySelector('parsererror')) return markup;
  const svg = doc.querySelector('svg');
  if (!svg) return markup;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const mount = svg.cloneNode(true) as SVGSVGElement;
  host.appendChild(mount);
  document.body.appendChild(host);
  const probe = document.createElement('span');
  host.appendChild(probe);

  // Any CSS colour string → its luminance grey (rgb), or null for none/url()/unparseable.
  const greyOf = (c: string | null | undefined): string | null => {
    const v = (c || '').trim();
    if (!v || v === 'none' || v === 'transparent' || v.startsWith('url(')) return null;
    probe.style.color = '';
    probe.style.color = v;
    const rgb = getComputedStyle(probe).color;
    const m = rgb.match(/\d+(?:\.\d+)?/g);
    if (!m || m.length < 3) return null;
    const lum = Math.round(0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]);
    return `rgb(${lum}, ${lum}, ${lum})`;
  };

  try {
    const els = Array.from(mount.querySelectorAll('*'));
    for (const el of els) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'stop') { // gradient stop colours → grey (keeps the gradient, just colourless)
        const cs = getComputedStyle(el);
        const g = greyOf(cs.stopColor || el.getAttribute('stop-color'));
        if (g) el.setAttribute('stop-color', g);
        continue;
      }
      if (SKIP_TAGS.has(tag)) continue;
      const cs = getComputedStyle(el);
      const fg = greyOf(cs.fill);
      if (fg) el.setAttribute('fill', fg);
      else if ((cs.fill || '').trim() === 'none') el.setAttribute('fill', 'none');
      const sg = greyOf(cs.stroke);
      if (sg) el.setAttribute('stroke', sg);
      const st = (el as unknown as { style?: CSSStyleDeclaration }).style;
      st?.removeProperty?.('fill');
      st?.removeProperty?.('stroke');
    }
    // drop colour-bearing <style> blocks — their rules are now overridden by attrs.
    mount.querySelectorAll('style').forEach((s) => s.remove());
  } finally {
    document.body.removeChild(host);
  }
  return new XMLSerializer().serializeToString(mount);
}
