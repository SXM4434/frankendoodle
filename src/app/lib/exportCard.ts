// ─── exportCard — turn a rendered doodle into a shareable SVG / PNG file ─────
//
// Card features (Sebs 2026-06-13, docs/submission/DECISIONS-FOR-SEBS.md):
// "Export card → SVG (+ PNG) for social sharing." This is the export side of
// that — a small, dependency-free util the card detail modal calls.
//
// WHY CAPTURE THE LIVE DOM, NOT THE RAW MARKUP. The doodle's final look is the
// product of three layers that only exist once it's MOUNTED: (1) rough.js has
// rewritten the source <svg> into hand-drawn paths in the DOM, (2) the wrapper
// CSS resolves var(--dir-*) ink/paper tokens + a stack of !important palette
// rules onto those paths (SvgStyleTransform.tsx ~line 2856), (3) filters /
// textures apply. Serializing the source markup would export the CLEAN shape,
// not the styled doodle. So we read the rendered <svg> straight out of the
// card's art well and bake the computed cascade into it.
//
// SELF-CONTAINED OUTPUT (the spec's hard requirement). A standalone .svg can't
// see the page's stylesheet or its :root custom properties, so we resolve every
// paint to a concrete value: walk the clone, read getComputedStyle for each
// element, and write fill / stroke / opacities / dash / line-caps as INLINE
// attributes. After this pass the SVG carries zero external refs and renders
// identically in an <img>, a design tool, or a fresh tab.
//
// Research (cited in the PR report):
//   · MDN XMLSerializer.serializeToString — DOM → string.
//   · ourcodeworld "render SVG string onto a canvas → PNG/JPEG at custom
//     resolution": serialize → data URI (xmlns required, drop <?xml?>) →
//     Image → drawImage at a scaled size → canvas.toBlob('image/png').
//   · MDN "Allowing cross-origin use of images and canvas" / tainted-canvas:
//     drawing a cross-origin (or <foreignObject>) source taints the canvas and
//     toBlob throws SecurityError. Doodle SVGs are self-generated strokes +
//     sanitized uploads (no <foreignObject>, no external <image>), and the
//     paper texture we add is a same-origin data: URI — so the canvas stays
//     clean. We still wrap the rasterize step in try/catch and fall back to the
//     SVG download, so a future exotic input degrades instead of breaking.

import { PAPER_GRAIN } from './deskCraft';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Default export padding (SVG user units) around the doodle on the paper. */
const PAD = 28;
/** PNG raster scale floor — a social-friendly 2x, multiplied by the device
 *  pixel ratio so the export is crisp on the machine that made it. Capped so a
 *  huge doodle on a 3x display can't ask for a multi-thousand-px canvas. */
const PNG_BASE_SCALE = 2;
const PNG_MAX_SCALE = 4;

export type ExportColors = {
  /** Paper background fill (resolved --dir-bg). */
  paper: string;
  /** Warm light-pool tint, rgba — matches deskCraft WARM_POOL's inner color. */
  pool: string;
};

/** Read the live theme colors off the document so the export matches whatever
 *  direction (light / dark) the page is in. Falls back to the warm-paper light
 *  values if the tokens aren't resolvable (SSR / detached node). */
export function readExportColors(el?: Element | null): ExportColors {
  const probe = el ?? (typeof document !== 'undefined' ? document.documentElement : null);
  let paper = '#FDFCF9';
  if (probe && typeof getComputedStyle === 'function') {
    const v = getComputedStyle(probe).getPropertyValue('--dir-bg').trim();
    if (v) paper = v;
  }
  // The warm pool is a fixed warm-white in deskCraft (direction-independent).
  return { paper, pool: 'rgba(255,246,229,0.5)' };
}

// ─── computed-paint baking ───────────────────────────────────────────────────
// The properties that carry the doodle's look. Read each via getComputedStyle
// (which resolves var() tokens AND the wrapper's !important rules) and write it
// as an inline attribute on the clone, so the standalone SVG needs no CSS.
const PAINT_PROPS: Array<[prop: string, attr: string]> = [
  ['fill', 'fill'],
  ['fill-opacity', 'fill-opacity'],
  ['fill-rule', 'fill-rule'],
  ['stroke', 'stroke'],
  ['stroke-opacity', 'stroke-opacity'],
  ['stroke-width', 'stroke-width'],
  ['stroke-linecap', 'stroke-linecap'],
  ['stroke-linejoin', 'stroke-linejoin'],
  ['stroke-dasharray', 'stroke-dasharray'],
  ['stroke-dashoffset', 'stroke-dashoffset'],
  ['opacity', 'opacity'],
];

/** Normalize a computed CSS value into a clean SVG presentation-attribute
 *  value: getComputedStyle hands back px-suffixed lengths ("2px", "4px, 3px")
 *  and quoted url()s ('url("#x")'), neither of which is portable SVG 1.1. Strip
 *  px units from numeric lengths and unquote url() refs so the standalone file
 *  renders identically in strict SVG renderers, not just a browser. */
function cleanAttrValue(val: string): string {
  return val
    .replace(/url\((['"])(.*?)\1\)/g, 'url($2)') // unquote url("#x") → url(#x)
    .replace(/(-?\d*\.?\d+)px\b/g, '$1'); // 2px → 2, 4px, 3px → 4, 3
}

/** Bake the computed cascade of `src` onto `dst` (same element, in a clone),
 *  recursing through children index-aligned. `src` must still be live in the
 *  document (computed styles only exist for mounted nodes). */
function bakeComputed(src: Element, dst: Element) {
  if (typeof getComputedStyle === 'function') {
    const cs = getComputedStyle(src);
    for (const [prop, attr] of PAINT_PROPS) {
      const raw = cs.getPropertyValue(prop).trim();
      // Skip empty / initial-ish values that would just add noise, but DO keep
      // explicit 'none' fills/strokes — they're meaningful (outline-only).
      if (raw === '') continue;
      dst.setAttribute(attr, cleanAttrValue(raw));
    }
    // Preserve any filter reference (texture / wet-ink) — it points at a <defs>
    // filter that lives inside the same captured <svg>, so it stays valid.
    const filter = cs.getPropertyValue('filter').trim();
    if (filter && filter !== 'none') dst.setAttribute('filter', cleanAttrValue(filter));
  }
  const sKids = src.children;
  const dKids = dst.children;
  for (let i = 0; i < sKids.length && i < dKids.length; i++) {
    bakeComputed(sKids[i], dKids[i]);
  }
}

/** The visible rendered <svg> inside a card art well. SvgStyleTransform mounts
 *  TWO inner divs (clean vs fx); only one is display:block at a time. Find the
 *  <svg> whose chain isn't display:none. Falls back to the first <svg>. */
export function findRenderedSvg(root: Element): SVGSVGElement | null {
  const svgs = Array.from(root.querySelectorAll('svg')) as SVGSVGElement[];
  if (svgs.length === 0) return null;
  const visible = svgs.find((svg) => {
    let node: Element | null = svg;
    while (node && node !== root) {
      if (node instanceof HTMLElement && node.style.display === 'none') return false;
      node = node.parentElement;
    }
    return true;
  });
  return visible ?? svgs[0];
}

/** The doodle's intrinsic box in user units — viewBox if present, else the
 *  measured render box, else width/height attrs, else a square fallback. */
function svgBox(svg: SVGSVGElement): { x: number; y: number; w: number; h: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  }
  try {
    const b = svg.getBBox();
    if (b.width > 0 && b.height > 0) return { x: b.x, y: b.y, w: b.width, h: b.height };
  } catch {
    // getBBox throws on a detached node — fall through to attrs.
  }
  const w = Number(svg.getAttribute('width')) || 180;
  const h = Number(svg.getAttribute('height')) || 180;
  return { x: 0, y: 0, w, h };
}

/** Build the self-contained export <svg> as a string: the captured doodle,
 *  computed-paints baked in, sitting on the warm-paper card with padding.
 *  `root` is the card art well (the element wrapping SvgStyleTransform). */
export function buildCardSvgString(root: Element): string | null {
  if (typeof document === 'undefined') return null;
  const rendered = findRenderedSvg(root);
  if (!rendered) return null;

  const box = svgBox(rendered);
  const colors = readExportColors(root);

  // Clone the rendered doodle and bake its computed look in (self-contained).
  const inner = rendered.cloneNode(true) as SVGSVGElement;
  bakeComputed(rendered, inner);
  // The inner <svg> becomes a nested group at the doodle's own coordinates —
  // strip its sizing attrs so the OUTER svg owns layout; keep its viewBox so
  // its internal coordinate system is preserved.
  inner.removeAttribute('width');
  inner.removeAttribute('height');
  inner.removeAttribute('style');
  if (!inner.getAttribute('viewBox')) {
    inner.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  }

  const totalW = box.w + PAD * 2;
  const totalH = box.h + PAD * 2;

  // Compose the outer document. Paper rect + warm-pool radial + grain image
  // (the deskCraft data-URI, decoded from the css url("…") wrapper) + the
  // doodle nested at (PAD, PAD) over the doodle's own box.
  const out = document.createElementNS(SVG_NS, 'svg');
  out.setAttribute('xmlns', SVG_NS);
  out.setAttribute('xmlns:xlink', XLINK_NS);
  out.setAttribute('width', String(Math.round(totalW)));
  out.setAttribute('height', String(Math.round(totalH)));
  out.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

  // defs: warm-pool radial gradient (mirrors deskCraft WARM_POOL ellipse).
  const defs = document.createElementNS(SVG_NS, 'defs');
  const grad = document.createElementNS(SVG_NS, 'radialGradient');
  grad.setAttribute('id', 'dd-pool');
  grad.setAttribute('cx', '50%');
  grad.setAttribute('cy', '42%');
  grad.setAttribute('r', '72%');
  const s0 = document.createElementNS(SVG_NS, 'stop');
  s0.setAttribute('offset', '0%');
  s0.setAttribute('stop-color', colors.pool);
  const s1 = document.createElementNS(SVG_NS, 'stop');
  s1.setAttribute('offset', '63%');
  s1.setAttribute('stop-color', 'rgba(255,246,229,0)');
  grad.appendChild(s0);
  grad.appendChild(s1);
  defs.appendChild(grad);
  out.appendChild(defs);

  // Paper fill.
  const paper = document.createElementNS(SVG_NS, 'rect');
  paper.setAttribute('x', '0');
  paper.setAttribute('y', '0');
  paper.setAttribute('width', String(totalW));
  paper.setAttribute('height', String(totalH));
  paper.setAttribute('fill', colors.paper);
  out.appendChild(paper);

  // Paper grain — the deskCraft tiled data-URI as a tiled <image> pattern. The
  // url("…") css wrapper is unwrapped to the bare data: URI. data: is same-
  // origin, so it never taints the export canvas.
  const grainHref = unwrapCssUrl(PAPER_GRAIN);
  if (grainHref) {
    const pat = document.createElementNS(SVG_NS, 'pattern');
    pat.setAttribute('id', 'dd-grain');
    pat.setAttribute('width', '280');
    pat.setAttribute('height', '280');
    pat.setAttribute('patternUnits', 'userSpaceOnUse');
    const gimg = document.createElementNS(SVG_NS, 'image');
    gimg.setAttribute('width', '280');
    gimg.setAttribute('height', '280');
    gimg.setAttributeNS(XLINK_NS, 'xlink:href', grainHref);
    gimg.setAttribute('href', grainHref);
    pat.appendChild(gimg);
    defs.appendChild(pat);
    const grainRect = document.createElementNS(SVG_NS, 'rect');
    grainRect.setAttribute('width', String(totalW));
    grainRect.setAttribute('height', String(totalH));
    grainRect.setAttribute('fill', 'url(#dd-grain)');
    out.appendChild(grainRect);
  }

  // Warm pool over the grain.
  const pool = document.createElementNS(SVG_NS, 'rect');
  pool.setAttribute('width', String(totalW));
  pool.setAttribute('height', String(totalH));
  pool.setAttribute('fill', 'url(#dd-pool)');
  out.appendChild(pool);

  // The doodle, placed with padding, sized to its box inside the card.
  const place = document.createElementNS(SVG_NS, 'svg');
  place.setAttribute('x', String(PAD));
  place.setAttribute('y', String(PAD));
  place.setAttribute('width', String(box.w));
  place.setAttribute('height', String(box.h));
  place.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  // Move the cloned doodle's children into the placement svg (a nested <svg>
  // re-roots the coordinate system cleanly via its viewBox).
  while (inner.firstChild) place.appendChild(inner.firstChild);
  out.appendChild(place);

  return new XMLSerializer().serializeToString(out);
}

/** Strip the CSS `url("…")` wrapper from a background-image string → the bare
 *  URI (here, the deskCraft data: URI). Returns null if it isn't a url(). */
function unwrapCssUrl(css: string): string | null {
  const m = css.match(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/);
  return m ? m[2] : null;
}

// ─── download helpers ─────────────────────────────────────────────────────────

/** Trigger a browser download of a Blob under `filename`. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click's navigation has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** A filesystem-safe slug for the doodle name → the download filename stem. */
export function slugifyName(name?: string | null): string {
  const base = (name ?? '').trim().toLowerCase();
  const slug = base
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'doodle';
}

export type ExportResult = { ok: true } | { ok: false; error: string };

/** Export the card's doodle as a self-contained .svg download (paper-card frame). */
export function exportCardSvg(root: Element | null, name?: string | null): ExportResult {
  if (!root) return { ok: false, error: 'nothing to export' };
  const svgString = buildCardSvgString(root);
  if (!svgString) return { ok: false, error: 'no rendered doodle to export' };
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, `${slugifyName(name)}.svg`);
  return { ok: true };
}

/** The RAW doodle as a standalone .svg — baked computed look, tightly cropped to
 *  the doodle's box, TRANSPARENT (no paper/pool/grain card frame). This is the
 *  "just export the svg" option (Sebs 2026-06-14), distinct from the framed
 *  card export above. */
export function buildDoodleSvgString(root: Element): string | null {
  if (typeof document === 'undefined') return null;
  const rendered = findRenderedSvg(root);
  if (!rendered) return null;
  const box = svgBox(rendered);
  const out = rendered.cloneNode(true) as SVGSVGElement;
  bakeComputed(rendered, out);
  out.setAttribute('xmlns', SVG_NS);
  out.setAttribute('xmlns:xlink', XLINK_NS);
  if (!out.getAttribute('viewBox')) {
    out.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  }
  out.setAttribute('width', String(Math.round(box.w)));
  out.setAttribute('height', String(Math.round(box.h)));
  out.removeAttribute('style'); // no CSS sizing/background — transparent + self-sized
  return new XMLSerializer().serializeToString(out);
}

/** Download the raw doodle as a frame-less, transparent .svg. */
export function exportDoodleSvg(root: Element | null, name?: string | null): ExportResult {
  if (!root) return { ok: false, error: 'nothing to export' };
  const svgString = buildDoodleSvgString(root);
  if (!svgString) return { ok: false, error: 'no rendered doodle to export' };
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, `${slugifyName(name)}.svg`);
  return { ok: true };
}

// ─── POKÉMON-STYLE TRADING CARD (Sebs 2026-06-15: "card PNG should be an ACTUAL
//     card with info, not just the object") ──────────────────────────────────
// A portrait trading-card frame: double ink border on warm paper, a name + stat
// header, a framed art window holding the doodle, a species/subtitle banner, a
// stat block (strokes / style / mode / date), flavor line, and a brand footer.
// Self-contained (same baked-paint approach as the doodle export) so the .svg /
// .png renders standalone. Fonts use system stacks (serif name, sans labels) so
// the detached Image() rasterize doesn't depend on the app's web fonts.

export type CardMeta = {
  /** Doodle name → card title. */
  name?: string | null;
  /** Pretty SVG-style label (e.g. "Bold ink") → the card's "type". */
  style?: string | null;
  /** 3D geometry mode if the card is a 3D form (e.g. "Inflate") → stat row. */
  mode?: string | null;
  /** Maker @handle → footer. */
  handle?: string | null;
  /** ISO date or any string → "Made" stat (formatted to a short month-year). */
  createdAt?: string | null;
  /** Stroke count → the headline "HP-style" stat + a stat row. */
  strokeCount?: number | null;
  /** A pre-captured raster (data-URL PNG) to place in the art window INSTEAD of
   *  the live SVG — used by the 3D export so the card shows the actual 3D render
   *  (a WebGL canvas snapshot) on the card frame, not the hidden 2D SVG (Sebs
   *  2026-06-16: "export card doesn't export the 3d on the card, just the 3d as a
   *  png"). When set, the SVG art branch is skipped entirely. */
  artImageDataUrl?: string | null;
};

/** XML-escape free text for safe insertion into SVG <text>. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Short, human "Made" date — "Jun 2026" from an ISO/date string; '' if unparseable.
 *  No Date.now()/argless new Date() (those are banned in some runtimes); parsing a
 *  provided string is fine. */
function shortDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** Build the self-contained Pokémon-style card <svg> string. `root` = the card
 *  art well (same source the doodle/PNG export reads). */
export function buildPokemonCardSvgString(root: Element, meta: CardMeta = {}): string | null {
  if (typeof document === 'undefined') return null;
  const rendered = findRenderedSvg(root);
  // The 3D export passes a captured raster (artImageDataUrl) — then we don't need
  // the live SVG for the art (we render the snapshot), only for box/colors when
  // present. Without EITHER a rendered SVG or a captured image there's nothing to
  // draw → bail.
  const artImg = meta.artImageDataUrl && meta.artImageDataUrl.trim() ? meta.artImageDataUrl.trim() : null;
  if (!rendered && !artImg) return null;

  const box = rendered ? svgBox(rendered) : { x: 0, y: 0, w: 100, h: 100 };
  const colors = readExportColors(root);

  // Baked, self-contained doodle clone for the art window — only when we're
  // drawing the live SVG (skipped entirely when a captured image is supplied).
  let inner: SVGSVGElement | null = null;
  if (rendered && !artImg) {
    inner = rendered.cloneNode(true) as SVGSVGElement;
    bakeComputed(rendered, inner);
    inner.removeAttribute('width');
    inner.removeAttribute('height');
    inner.removeAttribute('style');
    if (!inner.getAttribute('viewBox')) inner.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  }

  // ── Card geometry (portrait, real-card 5:7 feel) ──
  const W = 500;
  const H = 700;
  const M = 18; // outer margin to the ink border
  const R = 26; // card corner radius
  const INK = '#1c1a17';
  const INK_SOFT = '#4a4540';
  const PAPER = colors.paper || '#FDFCF9';
  const ART_X = 40;
  const ART_Y = 96;
  const ART_W = W - ART_X * 2;
  const ART_H = 300;

  const name = (meta.name && meta.name.trim()) || 'Untitled doodle';
  const styleLabel = (meta.style && meta.style.trim()) || 'Clean';
  const modeLabel = meta.mode && meta.mode.trim() ? meta.mode.trim() : null;
  const handle = meta.handle && meta.handle.trim() ? meta.handle.replace(/^@?/, '@') : null;
  const made = shortDate(meta.createdAt);
  const strokes = typeof meta.strokeCount === 'number' && meta.strokeCount > 0 ? meta.strokeCount : null;

  // Stat rows (skip empties).
  const rows: Array<[string, string]> = [];
  rows.push(['Style', styleLabel]);
  if (modeLabel) rows.push(['3D mode', modeLabel]);
  if (strokes) rows.push(['Strokes', String(strokes)]);
  if (made) rows.push(['Made', made]);

  const STAT_Y = ART_Y + ART_H + 70;
  const ROW_H = 34;
  const statRows = rows
    .map(([k, v], i) => {
      const y = STAT_Y + i * ROW_H;
      return `
      <line x1="${ART_X}" y1="${y + ROW_H - 8}" x2="${W - ART_X}" y2="${y + ROW_H - 8}" stroke="${INK}" stroke-opacity="0.12" stroke-width="1"/>
      <circle cx="${ART_X + 7}" cy="${y + 8}" r="4" fill="none" stroke="${INK}" stroke-width="1.6"/>
      <text x="${ART_X + 24}" y="${y + 13}" font-family="Georgia, 'Times New Roman', serif" font-size="16" fill="${INK_SOFT}">${esc(k)}</text>
      <text x="${W - ART_X}" y="${y + 13}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="600" fill="${INK}">${esc(v)}</text>`;
    })
    .join('');

  const grainHref = unwrapCssUrl(PAPER_GRAIN);
  const grainDefs = grainHref
    ? `<pattern id="dd-cgrain" width="280" height="280" patternUnits="userSpaceOnUse"><image width="280" height="280" href="${grainHref}" xlink:href="${grainHref}"/></pattern>`
    : '';
  const grainRect = grainHref ? `<rect x="${M}" y="${M}" width="${W - M * 2}" height="${H - M * 2}" rx="${R - 6}" fill="url(#dd-cgrain)" opacity="0.5"/>` : '';

  // species/subtitle banner text
  const species = `Desk Doodle${modeLabel ? ` · ${modeLabel} 3D` : ''} · ${styleLabel}`;

  // The art, contained + centered in the art window (letterbox). Either the
  // captured 3D snapshot (an <image>) or the live doodle SVG, both letterboxed
  // with xMidYMid-meet into the same window.
  const AX = ART_X + 12;
  const AY = ART_Y + 12;
  const AW = ART_W - 24;
  const AH = ART_H - 24;
  let artSvg: string;
  if (artImg) {
    artSvg = `<image x="${AX}" y="${AY}" width="${AW}" height="${AH}" href="${artImg}" xlink:href="${artImg}" preserveAspectRatio="xMidYMid meet"/>`;
  } else {
    const artInner = new XMLSerializer().serializeToString(inner as SVGSVGElement);
    artSvg = `<svg x="${AX}" y="${AY}" width="${AW}" height="${AH}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet">${artInner.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</svg>`;
  }

  const svg = `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="dd-cpool" cx="50%" cy="34%" r="70%">
      <stop offset="0%" stop-color="${colors.pool}"/>
      <stop offset="60%" stop-color="rgba(255,246,229,0)"/>
    </radialGradient>
    ${grainDefs}
  </defs>
  <!-- card body + double ink frame -->
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="${R + 4}" fill="${INK}"/>
  <rect x="${M}" y="${M}" width="${W - M * 2}" height="${H - M * 2}" rx="${R - 6}" fill="${PAPER}"/>
  ${grainRect}
  <rect x="${M}" y="${M}" width="${W - M * 2}" height="${H - M * 2}" rx="${R - 6}" fill="url(#dd-cpool)"/>
  <rect x="${M + 6}" y="${M + 6}" width="${W - (M + 6) * 2}" height="${H - (M + 6) * 2}" rx="${R - 10}" fill="none" stroke="${INK}" stroke-width="1.4" stroke-opacity="0.5"/>

  <!-- header: name + strokes "HP" stat -->
  <text x="${ART_X}" y="${M + 50}" font-family="Georgia, 'Times New Roman', serif" font-size="30" font-weight="700" fill="${INK}">${esc(name.length > 22 ? name.slice(0, 21) + '…' : name)}</text>
  ${strokes ? `<text x="${W - ART_X}" y="${M + 50}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${INK_SOFT}">✦ ${strokes} strokes</text>` : ''}

  <!-- art window -->
  <rect x="${ART_X}" y="${ART_Y}" width="${ART_W}" height="${ART_H}" rx="12" fill="#ffffff" fill-opacity="0.55" stroke="${INK}" stroke-width="2.5"/>
  ${artSvg}

  <!-- species / subtitle banner -->
  <text x="${W / 2}" y="${ART_Y + ART_H + 34}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="16" fill="${INK_SOFT}">${esc(species)}</text>

  <!-- stat block -->
  ${statRows}

  <!-- footer: brand + handle -->
  <line x1="${ART_X}" y1="${H - 56}" x2="${W - ART_X}" y2="${H - 56}" stroke="${INK}" stroke-opacity="0.18" stroke-width="1"/>
  <text x="${ART_X}" y="${H - 32}" font-family="Georgia, 'Times New Roman', serif" font-size="16" font-weight="700" fill="${INK}">Desk Doodles</text>
  ${handle ? `<text x="${W - ART_X}" y="${H - 32}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="${INK_SOFT}">${esc(handle)}</text>` : ''}
</svg>`;
  return svg;
}

/** Export the doodle as a Pokémon-style card PNG (frame + name + info + art). */
export async function exportPokemonCardPng(
  root: Element | null,
  meta: CardMeta = {},
): Promise<ExportResult> {
  if (!root) return { ok: false, error: 'nothing to export' };
  const svgString = buildPokemonCardSvgString(root, meta);
  if (!svgString) return { ok: false, error: 'no rendered doodle to export' };
  try {
    const img = await loadSvgImage(svgString);
    const baseW = img.naturalWidth || 500;
    const baseH = img.naturalHeight || 700;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const scale = Math.min(PNG_MAX_SCALE, PNG_BASE_SCALE * dpr);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(baseW * scale);
    canvas.height = Math.round(baseH * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    if (!blob) throw new Error('canvas produced no PNG');
    downloadBlob(blob, `${slugifyName(meta.name)}-card.png`);
    return { ok: true };
  } catch (err) {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, `${slugifyName(meta.name)}-card.svg`);
    return {
      ok: false,
      error: `couldn't make a PNG (${err instanceof Error ? err.message : 'unknown'}) — saved the card SVG instead`,
    };
  }
}

/** Build a data: URI for an SVG string. URL-encoded (not base64): SVG wants
 *  plain URL-encoded data, and encodeURIComponent handles the # / % / quotes
 *  that would otherwise break the URI (ourcodeworld). */
function svgStringToDataUri(svgString: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
}

/** Load an SVG string into an HTMLImageElement (decoded), or reject. */
function loadSvgImage(svgString: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Same-origin data: URI — crossOrigin is unnecessary, but setting it
    // anonymous is harmless and keeps the canvas clean if a UA is strict.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('svg image failed to decode'));
    img.src = svgStringToDataUri(svgString);
  });
}

/** Export the card's doodle as a crisp PNG download. Rasterizes the SAME
 *  self-contained SVG used for the .svg export onto a DPR-aware 2x canvas, on
 *  the paper background, then toBlob → download. Async (image decode + toBlob).
 *
 *  Falls back to the SVG download if rasterization fails (e.g. a tainted
 *  canvas from a future exotic input) — the user still gets a usable file. */
export async function exportCardPng(
  root: Element | null,
  name?: string | null,
): Promise<ExportResult> {
  if (!root) return { ok: false, error: 'nothing to export' };
  const svgString = buildCardSvgString(root);
  if (!svgString) return { ok: false, error: 'no rendered doodle to export' };

  try {
    const img = await loadSvgImage(svgString);
    // The outer svg carries width/height in user units = the natural px box.
    const baseW = img.naturalWidth || img.width || 256;
    const baseH = img.naturalHeight || img.height || 256;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const scale = Math.min(PNG_MAX_SCALE, PNG_BASE_SCALE * dpr);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(baseW * scale);
    canvas.height = Math.round(baseH * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // The SVG already paints its own paper rect, so drawImage fills the frame;
    // a paper underlay guarantees opacity even if the SVG had transparency.
    const { paper } = readExportColors(root);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    );
    if (!blob) throw new Error('canvas produced no PNG (possibly tainted)');
    downloadBlob(blob, `${slugifyName(name)}.png`);
    return { ok: true };
  } catch (err) {
    // Rasterize failed — fall back to the vector download so the user still
    // gets a shareable file, and report the downgrade honestly.
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, `${slugifyName(name)}.svg`);
    return {
      ok: false,
      error: `couldn't make a PNG (${err instanceof Error ? err.message : 'unknown'}) — saved the SVG instead`,
    };
  }
}

/** HARD-PATH RASTERIZER (plan §7.4): rasterize the rendered doodle to a SQUARE
 *  PNG data-URL — the `imageUrl` the image→3D Edge function sends to the provider
 *  (fal/TRELLIS). Providers want a clean, CENTERED, square subject, so the doodle
 *  is contain-fit + padded onto a paper-background square (default 768²). Reuses
 *  the SAME self-contained SVG + loadSvgImage path as the PNG export (same-origin
 *  data: URI → canvas stays clean → toDataURL never taints). Returns null on any
 *  failure so the caller's fallback ladder degrades to local 3D — never throws. */
export async function rasterizeDoodlePng(
  root: Element | null,
  opts: { size?: number } = {},
): Promise<string | null> {
  if (!root) return null;
  const svgString = buildCardSvgString(root);
  if (!svgString) return null;
  try {
    const img = await loadSvgImage(svgString);
    const size = opts.size ?? 768;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const { paper } = readExportColors(root);
    ctx.fillStyle = paper || '#ffffff';
    ctx.fillRect(0, 0, size, size);
    // contain-fit the doodle into a padded square, centered (10% margin)
    const bw = img.naturalWidth || img.width || size;
    const bh = img.naturalHeight || img.height || size;
    const avail = size * 0.8;
    const s = Math.min(avail / bw, avail / bh);
    const dw = bw * s;
    const dh = bh * s;
    ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** Same as rasterizeDoodlePng but from a raw SVG markup STRING (the doodle's
 *  artMarkup) instead of a DOM root — the AI-mesh chip fires while the 3D view
 *  has swapped the rendered SVG out of the DOM, so it can't read a live element.
 *  Square, centered, padded, paper-bg PNG data-url; null on any failure. */
export async function rasterizeMarkupPng(
  svgMarkup: string,
  opts: { size?: number; paper?: string } = {},
): Promise<string | null> {
  if (!svgMarkup) return null;
  try {
    const img = await loadSvgImage(svgMarkup);
    const size = opts.size ?? 768;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = opts.paper || '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const bw = img.naturalWidth || img.width || size;
    const bh = img.naturalHeight || img.height || size;
    const avail = size * 0.8;
    const s = Math.min(avail / bw, avail / bh);
    const dw = bw * s;
    const dh = bh * s;
    ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
