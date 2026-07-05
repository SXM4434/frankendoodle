// Shared SVG sanitization + upload preparation.
// THE sanitizer for every SVG that reaches dangerouslySetInnerHTML —
// uploads (DrawPanel/DrawSurface) AND DB-sourced rows on read (DeskPage).
// A regex strip is NOT enough (it misses unquoted on* handlers, javascript:
// hrefs, <foreignObject>, external <use>/<image>, <style>@import beacons), so
// this uses DOMPurify with the SVG profile — pure-JS, Make-importable.

import DOMPurify from 'dompurify';
import { simplifyToSketch } from './simplifyToSketch';
import { centerlineTrace } from './centerline';

// ─── SVG-upload SIMPLIFY MODE (Sebs 2026-06-16) ──────────────────────────────
// The user's choice of how a .svg upload comes into our register. The base
// "always differs per image" — a filled source vs line-art source — so the
// modes respect that:
//   'off'    → as-is (just sanitized). The original.
//   'filled' → clean filled line-art: simplifyToSketch keeps the fills, drops
//              tiny noise creases, loosens lines. NEVER hollows strokes into
//              outlines (the bug Sebs caught). Right for filled sources.
//   'line'   → centerline trace: filled shapes → TRUE single-line strokes (no
//              fill, no outline, no solid). The "direct simplification" look.
export type UploadSimplifyMode = 'off' | 'filled' | 'line';

/** Apply the chosen simplify mode to already-sanitized uploaded SVG markup.
 *  Degrades safely (the underlying transforms return the input unchanged if they
 *  can't parse), so this never throws. */
// CACHE the per-mode result keyed by (mode + the source markup). The 'line'
// centerline is heavy (rasterize → Zhang-Suen thin → vectorize) and ran on EVERY
// toggle click → the UI FROZE (Sebs 2026-06-16). Caching makes re-toggling
// instant; only the FIRST compute of a given (markup,mode) pays. Bounded so it
// can't grow unbounded across many uploads.
const _uploadSimplifyCache = new Map<string, string>();
function _cacheKey(markup: string, mode: UploadSimplifyMode): string {
  return `${mode}:${markup.length}:${markup.slice(0, 80)}`;
}

export function applyUploadSimplify(markup: string, mode: UploadSimplifyMode): string {
  const key = _cacheKey(markup, mode);
  const hit = _uploadSimplifyCache.get(key);
  if (hit !== undefined) return hit;

  let out: string;
  if (mode === 'off') {
    out = markup;
  } else if (mode === 'line') {
    // Match the PROVEN harness output (rose-centerline.png): trace the RAW art at
    // full raster with a gentle prune + RDP. No pre-simplify, no edge-drop — those
    // were MY additions that fragmented it into disconnected dashes.
    out = centerlineTrace(markup, { rasterWidth: 600, minBranchLen: 14, rdpEpsilon: 1.5 }).markup;
  } else {
    // 'filled' at L3 (Sebs "use L3", the FIXED complete version — NOT the blob):
    // drop only fine internal creases (minSubpathFrac 0.03 keeps the rose
    // COMPLETE), loosen lines, drop specks, light smooth. Keeps fills, never
    // hollows into outlines, never blobs.
    out = simplifyToSketch(markup, {
      minSubpathFrac: 0.03,
      rdpEpsilon: 2.0,
      minAreaFrac: 0.004,
      chaikinSmooth: 1,
      outlineFills: false,
    }).markup;
  }

  if (_uploadSimplifyCache.size > 24) _uploadSimplifyCache.clear();
  _uploadSimplifyCache.set(key, out);
  return out;
}

/** Quick heuristic for the SMART DEFAULT mode: does this SVG read as FILLED art
 *  (has real fills) or LINE art (stroke-only / fill:none)? Picks the mode that
 *  matches the source so we never force a filled icon to lines or vice-versa.
 *  A filled source defaults to 'filled'; a stroke-only source to 'line'. */
export function defaultSimplifyMode(markup: string): UploadSimplifyMode {
  // Any non-none fill attr/style anywhere = treat as filled art.
  const hasFill = /fill\s*[:=]\s*["']?\s*(?!none|transparent)(#|rgb|[a-df-z])/i.test(markup);
  return hasFill ? 'filled' : 'line';
}

// Presentation properties safe to lift from a <style> class rule onto an element
// as an inline attribute. Color/stroke geometry only — NEVER anything that can
// issue a network request (url()/@import/expression are dropped below).
const INLINABLE_STYLE_PROPS = new Set([
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'fill-rule',
  'fill-opacity', 'stroke-opacity', 'opacity', 'color',
]);

/** Resolve <style> CSS CLASS rules into inline presentation ATTRIBUTES before the
 *  sanitizer strips <style>. THE black-blob bug (Sebs 2026-06-16, 5 rounds): Quiver's
 *  Arrow tracer encodes every region's value-range grey as a CSS class
 *  (`.cls-0 {fill:rgb(154,154,154)}`) inside ONE <style> block. `sanitizeSvgMarkup`
 *  forbids <style> (a real exfil hole) — so those class fills vanish and every
 *  `class="cls-N"` element falls back to the SVG-default BLACK (and `.cls-5{fill:none}`
 *  lines also default to black). The harness reference looked right only because a raw
 *  <img> resolves the cascade itself. This inlines that cascade so the values SURVIVE
 *  sanitize: the live render now matches the browser's raw render. SAFE props only,
 *  url()/@import dropped (the exact vector FORBID_TAGS closes), DOMPurify still runs
 *  after. CSS class beats a presentation attr, so we overwrite — matching the browser.
 *  DOM-based, Make-safe (same DOMParser idiom as normalizeDefaultBlackFills below). */
function inlineStyleClasses(markup: string): string {
  if (!/<style[\s>]/i.test(markup)) return markup; // no <style> → nothing to resolve
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  } catch {
    return markup;
  }
  const root = doc.documentElement;
  if (!root || root.getElementsByTagName('parsererror').length > 0) return markup;
  // Collect `.className → { prop: value }` from every <style> block. Quiver emits
  // exactly `.name { decls }` simple-class selectors (the only form we resolve).
  const rules = new Map<string, Record<string, string>>();
  for (const styleEl of Array.from(root.getElementsByTagName('style'))) {
    const css = styleEl.textContent || '';
    const ruleRe = /\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(css))) {
      const cls = m[1];
      const props = rules.get(cls) || {};
      for (const decl of m[2].split(';')) {
        const ci = decl.indexOf(':');
        if (ci < 0) continue;
        const prop = decl.slice(0, ci).trim().toLowerCase();
        const val = decl.slice(ci + 1).trim();
        if (!INLINABLE_STYLE_PROPS.has(prop)) continue;
        if (/url\s*\(|@import|expression/i.test(val)) continue; // exfil vectors — drop
        props[prop] = val;
      }
      rules.set(cls, props);
    }
  }
  if (rules.size === 0) return markup;
  // Apply onto every element carrying a matching class. Class CSS beats a
  // presentation attr, so SET (overwrite); multiple classes merge left→right.
  for (const el of Array.from(root.querySelectorAll('[class]'))) {
    const merged: Record<string, string> = {};
    for (const cls of (el.getAttribute('class') || '').split(/\s+/)) {
      const props = cls && rules.get(cls);
      if (props) Object.assign(merged, props);
    }
    for (const [prop, val] of Object.entries(merged)) el.setAttribute(prop, val);
  }
  return new XMLSerializer().serializeToString(root);
}

/** Expand `<use href="#id">` into a CLONE of the referenced geometry so the
 *  classifier/renderer see real elements. Icon-system SVGs (a `<symbol>`/`<defs>`
 *  library + `<use>` instances) were rendering EMPTY — `<use>` classified as
 *  'other' and its geometry was never instantiated (Sebs 2026-06-19). DOM-based,
 *  Make-safe (same DOMParser idiom as inlineStyleClasses). */
function expandUseReferences(markup: string): string {
  if (!/<use[\s>]/i.test(markup)) return markup; // no <use> → nothing to expand
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  } catch {
    return markup;
  }
  const root = doc.documentElement;
  if (!root || root.getElementsByTagName('parsererror').length > 0) return markup;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const hrefOf = (u: Element) =>
    (u.getAttribute('href') || u.getAttribute('xlink:href') || '').trim();

  // A few passes so a <use> whose target itself contains <use> also expands;
  // bounded so a malicious self-referential cycle can't hang.
  for (let pass = 0; pass < 5; pass++) {
    const uses = Array.from(root.getElementsByTagName('use'));
    if (uses.length === 0) break;
    let changed = false;
    for (const use of uses) {
      const ref = hrefOf(use);
      const target = ref.startsWith('#') ? doc.getElementById(ref.slice(1)) : null;
      if (!target || (target as Element) === (use as Element) || target.contains(use)) {
        use.remove(); // unresolvable / external / self-referential → drop the empty <use>
        changed = true;
        continue;
      }
      const g = doc.createElementNS(SVG_NS, 'g');
      const tag = target.tagName.toLowerCase();
      // <symbol>/<svg> instantiate their CHILDREN; any other element clones itself.
      if (tag === 'symbol' || tag === 'svg') {
        for (const child of Array.from(target.childNodes)) g.appendChild(child.cloneNode(true));
      } else {
        g.appendChild(target.cloneNode(true));
      }
      // Carry the <use>'s placement (x/y → translate) + its own transform/paint.
      const x = parseFloat(use.getAttribute('x') || '0') || 0;
      const y = parseFloat(use.getAttribute('y') || '0') || 0;
      const useT = use.getAttribute('transform') || '';
      const t = `${useT}${x || y ? ` translate(${x} ${y})` : ''}`.trim();
      if (t) g.setAttribute('transform', t);
      for (const attr of ['class', 'style', 'fill', 'stroke', 'opacity']) {
        const v = use.getAttribute(attr);
        if (v != null) g.setAttribute(attr, v);
      }
      use.replaceWith(g);
      changed = true;
    }
    if (!changed) break;
  }
  return new XMLSerializer().serializeToString(root);
}

/** Sanitize arbitrary SVG markup for safe injection. Run on EVERY untrusted
 *  SVG — uploaded files AND public-feed rows (RLS can't parse SVG, so
 *  sanitize-on-read is the enforceable XSS layer). */
export function sanitizeSvgMarkup(markup: string): string {
  // Instantiate <use> geometry FIRST so the cloned elements get style-inlined +
  // sanitized like everything else (icon-system SVGs were coming up empty).
  const expanded = expandUseReferences(markup);
  // Resolve <style> CSS classes → inline attrs BEFORE forbidding <style>, else
  // Quiver's class-encoded value-range greys fall back to black (see above).
  const inlined = inlineStyleClasses(expanded);
  // FORBID_TAGS: ['style'] closes a real exfil hole the SVG profile leaves open —
  // DOMPurify keeps inline <style>, so `@import url(...)` / `fill:url(http://evil)`
  // survive and the browser fires the request on inject (a CSS request/exfil
  // beacon). Proven by tools/security/security-battery.mjs (style-import-beacon /
  // style-url-background). Safe to forbid: Desk Doodles art is pure geometry with
  // inline attrs (rough.js / smartHachure / perfect-freehand) — never inline <style>.
  return DOMPurify.sanitize(inlined, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['style'],
  });
}

/**
 * Normalize SVG-DEFAULT-BLACK fills on UPLOADS only (Sebs 2026-06-15: "isn't
 * there a way it doesn't affect the other objects we have").
 *
 * An element with NO fill declared anywhere up its ancestry renders BLACK by the
 * SVG default. Many uploaded logos (github / nintendo / x-twitter) rely on that
 * default — they carry no `fill` attr at all. Our smart pipeline deliberately
 * GUARDS pure-defaulted black (signals.ts) so the LOCKED 197-catalog doesn't
 * shift — but that also makes those uploads come up EMPTY (the EMPTY-FILL flags
 * in the corpus sweep). The clean scope: make the default EXPLICIT here, in the
 * upload sanitizer the catalog never passes through — so uploads fill while the
 * catalog stays byte-identical BY CONSTRUCTION (no render-flag plumbing, no
 * catalog risk).
 *
 * SVG-CORRECT: any leaf with NO fill declared up its ancestry renders black in a
 * browser (fill defaults to black even WITH a stroke), so we make that explicit —
 * this matches exactly what the uploader sees in their browser, and fills the
 * donut/icons (incl. stroke+no-fill rings) so U4's even-odd knockout can apply.
 * `fill:none` and fill-declared art (incl. url() patterns/gradients) are untouched.
 */
export function normalizeDefaultBlackFills(markup: string): string {
  if (typeof DOMParser === 'undefined') return markup;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  } catch {
    return markup;
  }
  if (doc.querySelector('parsererror')) return markup;
  const svg = doc.querySelector('svg');
  if (!svg) return markup;
  const declaresUp = (el: Element, prop: string): boolean => {
    let n: Element | null = el;
    while (n) {
      const attr = n.getAttribute(prop);
      if (attr != null && attr !== '') return true;
      const inline = (n as unknown as { style?: CSSStyleDeclaration }).style?.getPropertyValue(prop);
      if (inline && inline !== '') return true;
      if (n === svg) break;
      n = n.parentElement;
    }
    return false;
  };
  let changed = false;
  for (const el of Array.from(svg.querySelectorAll('path,circle,rect,ellipse,polygon'))) {
    if (declaresUp(el, 'fill')) continue; // fill (incl. 'none' / url() pattern) declared → leave
    el.setAttribute('fill', '#000000'); // SVG default = black; make it explicit so it fills
    changed = true;
  }
  if (!changed) return markup;
  try {
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return markup;
  }
}

export type SvgUploadResult =
  | { ok: true; name: string; markup: string }
  | { ok: false; error: string };

// Hard caps on RAW uploaded bytes + element count. A ~3.3MB / ~60k-path SVG
// froze the app: prepareSvgUpload ran an O(n) regex + a full DOMPurify parse +
// dangerouslySetInnerHTML on a 60k-node tree on the main thread, locking the UI
// for seconds. The established mitigation (OWASP / Fortinet SVG attack-surface
// guidance) is to REJECT files over a size limit AND cap file complexity before
// parsing — never hand an unbounded document to the parser/DOM.
//
// 2 MiB is comfortably above any hand-drawn / honestly-traced doodle (a dense
// auto-traced rose is ~tens of KB; the desk stores ≤64KB) yet well under the
// freeze threshold. The element cap bounds the DOM the browser must build even
// when a small file declares a huge tree.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MiB raw file
const MAX_ELEMENT_COUNT = 12000; // total markup tags before sanitize

// PATH-DATA CAPS (bug 1) — the element-count + byte caps both MISS the
// single-giant-geometry freeze: one `<path>` (or `<polygon>`) carrying a ~2MB
// `d`/`points` string is 1 element and <2MiB, so it slips past BOTH guards →
// DOMPurify + dangerouslySetInnerHTML on a monster path string → multi-second
// main-thread freeze (and, in the image flow, getTotalLength/getPointAtLength
// sampling over it = a second freeze). The fix is a cap on PATH-DATA VOLUME, the
// dimension the other guards don't measure: the sum of all `d`+`points`
// attribute lengths, AND a cap on any SINGLE such attribute.
//
//   MAX_TOTAL_PATH_DATA_CHARS = 256K
//     Headroom math: a real-world dense icon/illustration is a few KB of path
//     data; an honestly auto-traced photo (the heaviest legit input — Quiver
//     output, hundreds of sub-paths) lands in the low tens of KB. 256K is ~10×
//     above that worst legit case — generous enough that no real doodle is ever
//     rejected — yet ~8× UNDER the ~2MB single-path that freezes, so the freeze
//     class is closed with margin on both sides.
//   MAX_SINGLE_PATH_DATA_CHARS = 64K
//     A single hand/traced sub-path is at most a few KB; 64K (= the desk row's
//     whole-SVG storage cap, a known-safe upper bound for one doodle's geometry)
//     bounds the per-element work so one pathological `<path>` can't freeze the
//     parser or the getTotalLength sampler even while the total stays under cap.
const MAX_TOTAL_PATH_DATA_CHARS = 256 * 1024; // 256K summed d+points chars
const MAX_SINGLE_PATH_DATA_CHARS = 64 * 1024; // 64K for any one d/points attr

function bytesToReadable(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/**
 * Sum the length of every `d` and `points` attribute in the markup, and track
 * the single largest one. Cheap regex pass over the sanitized string, run BEFORE
 * rendering / BEFORE any getTotalLength sampling — never parses the geometry,
 * just measures the volume of path data. Handles both quote styles. Exported so
 * the verify harness can assert the measured volume directly.
 */
export function measurePathData(markup: string): { total: number; max: number } {
  let total = 0;
  let max = 0;
  // d="..." | d='...' | points="..." | points='...'  (attribute VALUE only).
  const re = /\b(?:d|points)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) {
    const value = m[2] ?? m[3] ?? '';
    const len = value.length;
    total += len;
    if (len > max) max = len;
  }
  return { total, max };
}

export async function prepareSvgUpload(file: File): Promise<SvgUploadResult> {
  if (!/\.svg$/i.test(file.name) && !file.type.includes('svg')) {
    return { ok: false, error: `Not an SVG file: ${file.name}` };
  }
  // SIZE CAP (bug 1) — check before reading text into memory + parsing. file.size
  // is the raw byte length, zero-cost. Over the cap = clear reject, no freeze.
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `SVG too large (${bytesToReadable(file.size)}). Max ${bytesToReadable(
        MAX_UPLOAD_BYTES,
      )}.`,
    };
  }
  try {
    const text = await file.text();
    // Belt-and-suspenders: file.size can lie (e.g. a 0-size blob with content,
    // or a mis-typed source). Re-check the decoded string length too.
    if (text.length > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        error: `SVG too large (${bytesToReadable(
          text.length,
        )}). Max ${bytesToReadable(MAX_UPLOAD_BYTES)}.`,
      };
    }

    // BILLION-LAUGHS / XML-bomb guard — reject DTD/entity declarations outright.
    // DOMPurify forbids them by default, but we parse raw text BEFORE sanitizing,
    // and an exponential-entity DOCTYPE can OOM/lock a browser during native XML
    // expansion. Cheap pre-reject (OWASP XXE/entity-expansion guidance).
    if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) {
      return {
        ok: false,
        error: 'SVG contains a DOCTYPE/entity declaration and was rejected.',
      };
    }

    // ELEMENT-COUNT CAP (bug 1) — a 60k-path tree freezes DOMPurify + the DOM
    // build even under the byte cap (paths are short, so byte size stays modest
    // while node count explodes). Count opening tags cheaply on the raw text
    // BEFORE the expensive parse; over the cap = clear reject.
    const tagMatches = text.match(/<[a-zA-Z][^>]*>/g);
    const elementCount = tagMatches ? tagMatches.length : 0;
    if (elementCount > MAX_ELEMENT_COUNT) {
      return {
        ok: false,
        error: `SVG too complex (${elementCount.toLocaleString()} elements). Max ${MAX_ELEMENT_COUNT.toLocaleString()}.`,
      };
    }

    // EXTRACT the <svg> element (bug 2) — FIRST complete root, non-greedy.
    // The previous fix went GREEDY (match to the LAST `</svg>`) to keep nested
    // SVGs whole, but greedy ALSO merges two sibling roots and swallows any junk
    // between them: `<svg>…</svg><script>…</script><svg></svg>` extracts the
    // whole blob — the inter-root `<script>` + a second root — defeating the
    // "extract THE svg" intent (DOMPurify strips the script downstream, but we
    // should never feed it that extra unsanitized text + a merged document).
    // Fix: strip comments + CDATA first (a `</svg>` hidden there is dead markup,
    // not a real close), then take the FIRST `<svg`…matching-`</svg>` only —
    // dropping everything AFTER the first root (the existing leading-junk drop is
    // preserved by anchoring on the first `<svg`).
    const stripped = text
      .replace(/<!--[\s\S]*?-->/g, '') // XML comments
      .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ''); // CDATA sections
    const extracted = extractFirstSvgRoot(stripped);
    if (!extracted) return { ok: false, error: 'Could not find <svg> in file.' };

    // PATH-DATA CAP (bug 1) — measure the extracted root's path-data volume
    // BEFORE sanitizing/rendering. A single ~2MB `d` slips past the byte +
    // element caps; reject it here so it never reaches DOMPurify / the DOM /
    // getTotalLength sampling. Measured on the extracted root (the only markup
    // we keep) so trailing junk we already dropped can't inflate the count.
    const pathData = measurePathData(extracted);
    if (pathData.max > MAX_SINGLE_PATH_DATA_CHARS) {
      return {
        ok: false,
        error: `SVG has an oversized path (${bytesToReadable(
          pathData.max,
        )} of path data in one element). Max ${bytesToReadable(
          MAX_SINGLE_PATH_DATA_CHARS,
        )} per path.`,
      };
    }
    if (pathData.total > MAX_TOTAL_PATH_DATA_CHARS) {
      return {
        ok: false,
        error: `SVG too detailed (${bytesToReadable(
          pathData.total,
        )} of path data). Max ${bytesToReadable(MAX_TOTAL_PATH_DATA_CHARS)}.`,
      };
    }

    const clean = sanitizeSvgMarkup(extracted);
    if (!/<svg[\s\S]*<\/svg>/i.test(clean)) {
      return { ok: false, error: 'SVG could not be safely sanitized.' };
    }
    // Make SVG-default-black explicit (uploads only — catalog-safe by construction;
    // see normalizeDefaultBlackFills). Runs AFTER sanitize (only adds fill attrs).
    return { ok: true, name: file.name, markup: normalizeDefaultBlackFills(clean) };
  } catch (err) {
    return { ok: false, error: `Read failed: ${(err as Error).message}` };
  }
}

/**
 * Take the FIRST complete `<svg>…</svg>` from the text — the first `<svg` opener
 * to its matching close. Scans tags from the first opener forward, tracking nest
 * depth so a legitimately NESTED `<svg>` (e.g. an `<svg>` inside a `<symbol>`)
 * keeps the OUTER root whole instead of closing on the inner one. Drops anything
 * after the first root (sibling roots + inter-root junk). Returns null if no
 * `<svg` opener or no matching close is found. Exported for the verify harness.
 */
export function extractFirstSvgRoot(text: string): string | null {
  const open = /<svg\b/i.exec(text);
  if (!open) return null;
  const start = open.index;
  // Walk every <svg…> / </svg> from the first opener, balancing depth.
  const tagRe = /<svg\b[^>]*?(\/?)>|<\/svg\s*>/gi;
  tagRe.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    const tag = m[0];
    if (/^<\/svg/i.test(tag)) {
      depth--;
      if (depth === 0) {
        // Matched the close for the first root → return through this tag only.
        return text.slice(start, m.index + tag.length);
      }
    } else if (m[1] === '/') {
      // Self-closing <svg/> — only a root by itself when depth is 0.
      if (depth === 0) return text.slice(start, m.index + tag.length);
    } else {
      depth++;
    }
  }
  return null; // opener with no matching close
}
