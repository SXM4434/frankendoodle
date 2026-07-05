// Smart Hachure System — signal extractor.
//
// Extracts geometric · topological · stylistic signals from one SVG element
// + its parent context. Pure DOM traversal + culori for perceptual lightness.
// Output: a `Signals` value (pure data, no DOM refs) ready for the classifier.
//
// Architecture: signals → classify → select treatment → render
// See `docs/labs/hero/cells/F3-smart-hachure-system/03-agent-research-svg-structural-signals.md`
// for the full signal catalog + rationale.

import { parse, converter, formatRgb } from 'culori';
import type { Signals } from './types';

// ─── ENTRY POINT ──────────────────────────────────────────────────────────

/** Extraction context — parent state passed through traversal. */
export type ExtractionContext = {
  /** Parent element's bbox (null at SVG root). */
  parentBBox: { x: number; y: number; w: number; h: number } | null;
  /** Siblings of the current element (DOM order). */
  siblings: SVGElement[];
  /** Current element's z-index within parent.children. */
  zIndex: number;
};

/**
 * Extract structural + perceptual signals from one SVG element.
 *
 * Throws nothing — falls back to safe defaults if DOM APIs fail (e.g. `getBBox`
 * on elements not yet rendered). The classifier handles low-quality signals
 * via confidence threshold.
 */
export function extractSignals(el: SVGElement, ctx: ExtractionContext): Signals {
  const bbox = safeGetBBox(el);
  const tag = normalizeTag(el.tagName);
  // Edge-case policy "CSS-class-only fills": fall back to getComputedStyle
  // when no fill attribute exists, so class/currentColor-driven fills are
  // seen (18-scope-audit edge-case table). Computed pure-black is only
  // trusted when a raw value exists (else it's the UA default, not a fill —
  // limitation: a CSS class painting exactly black on an attr-less element
  // is still missed; acceptable v1).
  const fillAttr = readAttr(el, 'fill');
  // trustBlack: a computed rgb(0,0,0) is the AUTHOR's fill only when fill is
  // EXPLICITLY DECLARED — own `fill` attr, own inline `style` fill, OR an
  // ancestor declaring fill (attr/inline-style) that this element inherits
  // (Sebs 2026-06-15: the cat silhouette rendered fill-less because its fill is
  // `style="fill:black"`, not a `fill` attr → the old `fillAttr !== null` guard
  // dropped it). Purely-DEFAULTED black (no declaration anywhere up the chain)
  // stays GUARDED → the catalog doesn't shift ("doesn't cause the other thing").
  //
  // NOTE — pure SVG-default black (no fill AND no stroke declared, e.g.
  // simple-icons github/x-twitter/nintendo) is DELIBERATELY still guarded. It's
  // a real design fork (dark icons → dense hachure blob that loses fill-rule
  // holes; touches the locked catalog) — see RUNNING-TODO "default-black fill" +
  // BUG U4. Sequenced: winding-correct fill (clip marks to true fill-rule
  // region) FIRST, then re-enable default-black trust.
  let fillDeclared = fillAttr !== null;
  if (!fillDeclared) {
    let n: Element | null = el;
    for (let depth = 0; depth < 10 && n; depth++) {
      const inlineFill = (n as SVGElement).style?.fill;
      if ((inlineFill && inlineFill !== '') || n.getAttribute('fill') != null) {
        fillDeclared = true;
        break;
      }
      n = n.parentElement;
    }
  }
  const computedFill = readComputedFill(el, fillDeclared);
  const fill = fillAttr ?? computedFill;
  const stroke = readAttr(el, 'stroke');
  const strokeWidth = parseFloat(readAttr(el, 'stroke-width') ?? '1');

  const area = bbox.w * bbox.h;
  const aspectRatio = bbox.h === 0 ? 0 : bbox.w / bbox.h;
  const perimeter = safeGetTotalLength(el);

  const parentArea = ctx.parentBBox ? ctx.parentBBox.w * ctx.parentBBox.h : 0;
  const areaFractionOfParent = parentArea === 0 ? 0 : area / parentArea;

  // Topological — needs sibling pass
  const { enclosesSiblingCount, containedInZIndex, isPartOfStripeCluster } =
    extractTopology(el, bbox, ctx);

  return {
    // Geometric
    bbox,
    area,
    aspectRatio,
    perimeter,

    // Topological
    zIndex: ctx.zIndex,
    parentBBox: ctx.parentBBox,
    areaFractionOfParent,
    enclosesSiblingCount,
    containedInZIndex,
    isPartOfStripeCluster,

    // Stylistic
    fill,
    stroke,
    strokeWidthBin: binStrokeWidth(strokeWidth, stroke),
    hasDasharray: readAttr(el, 'stroke-dasharray') !== null,
    tag,
    opacity: parseFloat(readAttr(el, 'opacity') ?? '1'),
    fillOpacity: parseFloat(readAttr(el, 'fill-opacity') ?? '1'),

    // Derived perceptual — url(#...) fills resolve their def first
    // (gradient → average stop darkness; pattern → 0 = pass-through;
    // 18-scope-audit edge-case table rows "linearGradient/radialGradient"
    // + "<pattern> as fill").
    darknessL:
      fill !== null && fill.startsWith('url(')
        ? resolveUrlFillDarkness(el, fill)
        : computeDarkness(fill, computedFill),
  };
}

// ─── GEOMETRIC HELPERS ────────────────────────────────────────────────────

function safeGetBBox(el: SVGElement): { x: number; y: number; w: number; h: number } {
  try {
    const r = (el as unknown as SVGGraphicsElement).getBBox();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  } catch {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
}

function safeGetTotalLength(el: SVGElement): number {
  try {
    // `getTotalLength` only exists on SVGGeometryElement subtypes
    const fn = (el as unknown as { getTotalLength?: () => number }).getTotalLength;
    return typeof fn === 'function' ? fn.call(el) : 0;
  } catch {
    return 0;
  }
}

// ─── STYLISTIC HELPERS ────────────────────────────────────────────────────

function readAttr(el: SVGElement, name: string): string | null {
  const v = el.getAttribute(name);
  return v === null || v === '' ? null : v;
}

function normalizeTag(rawTag: string): Signals['tag'] {
  const t = rawTag.toLowerCase();
  switch (t) {
    case 'rect':
    case 'circle':
    case 'ellipse':
    case 'path':
    case 'polygon':
    case 'polyline':
    case 'line':
    case 'text':
    case 'g':
      return t;
    default:
      return 'other';
  }
}

/**
 * Bin stroke width per Agent 3 (`<0.5` hairline, `0.5–1` thin, `1–1.5` medium,
 * `>1.5` heavy). When stroke is absent entirely → 'none'.
 */
function binStrokeWidth(width: number, stroke: string | null): Signals['strokeWidthBin'] {
  if (stroke === null || stroke === 'none' || stroke === 'transparent') return 'none';
  if (width < 0.5) return 'hairline';
  if (width < 1) return 'thin';
  if (width < 1.5) return 'medium';
  return 'heavy';
}

// ─── TOPOLOGICAL HELPERS ──────────────────────────────────────────────────

// Above this many siblings the per-element topology scan goes quadratic and
// hangs; we skip it (the signals are meaningless at that scale). 1500² ≈ 2.25M
// bbox checks worst-case — still snappy; a real doodle is far below this.
const MAX_TOPOLOGY_SIBLINGS = 1500;

function extractTopology(
  el: SVGElement,
  bbox: { x: number; y: number; w: number; h: number },
  ctx: ExtractionContext,
): {
  enclosesSiblingCount: number;
  containedInZIndex: number | null;
  isPartOfStripeCluster: boolean;
} {
  let enclosesSiblingCount = 0;
  let containedInZIndex: number | null = null;
  const stripeCandidates: { sib: SVGElement; bbox: { w: number; y: number } }[] = [];

  // O(n²) GUARD (Sebs 2026-06-19): this pass runs per element and scans EVERY
  // sibling, so a pathological upload (e.g. a 10k-rect document) is quadratic and
  // hangs the tab. Topology signals (enclosure / stripe-cluster) carry no useful
  // meaning at that scale anyway, so above the cap we skip the scan and return the
  // neutral result — the element still classifies on its own bbox/fill signals.
  if (ctx.siblings.length > MAX_TOPOLOGY_SIBLINGS) {
    return { enclosesSiblingCount: 0, containedInZIndex: null, isPartOfStripeCluster: false };
  }

  // Compute self's bbox params used in repeated checks
  const right = bbox.x + bbox.w;
  const bottom = bbox.y + bbox.h;

  ctx.siblings.forEach((sib, sibIdx) => {
    if (sib === el) return;
    const sibBBox = safeGetBBox(sib);
    if (sibBBox.w === 0 || sibBBox.h === 0) return;

    // Containment check — does THIS element fully contain `sib`?
    const sibRight = sibBBox.x + sibBBox.w;
    const sibBottom = sibBBox.y + sibBBox.h;
    if (sibBBox.x >= bbox.x && sibBBox.y >= bbox.y && sibRight <= right && sibBottom <= bottom) {
      enclosesSiblingCount += 1;
    }

    // Reverse containment — is THIS element contained inside `sib`?
    if (
      containedInZIndex === null &&
      bbox.x >= sibBBox.x &&
      bbox.y >= sibBBox.y &&
      right <= sibRight &&
      bottom <= sibBottom &&
      sibIdx < ctx.zIndex // only count siblings painted BEFORE this one as containers
    ) {
      containedInZIndex = sibIdx;
    }

    // Stripe-cluster detection — same width, same x
    if (
      Math.abs(sibBBox.w - bbox.w) < 1 &&
      Math.abs(sibBBox.x - bbox.x) < 1 &&
      sib.tagName.toLowerCase() === el.tagName.toLowerCase()
    ) {
      stripeCandidates.push({ sib, bbox: { w: sibBBox.w, y: sibBBox.y } });
    }
  });

  // Stripe cluster = ≥2 siblings with same width/x + constant y-stride
  let isPartOfStripeCluster = false;
  if (stripeCandidates.length >= 2) {
    const ys = [bbox.y, ...stripeCandidates.map((c) => c.bbox.y)].sort((a, b) => a - b);
    const strides: number[] = [];
    for (let i = 1; i < ys.length; i++) strides.push(ys[i] - ys[i - 1]);
    const meanStride = strides.reduce((a, b) => a + b, 0) / strides.length;
    const allWithinTolerance = strides.every((s) => Math.abs(s - meanStride) < 2);
    if (allWithinTolerance && meanStride > 0) isPartOfStripeCluster = true;
  }

  return { enclosesSiblingCount, containedInZIndex, isPartOfStripeCluster };
}

// ─── PERCEPTUAL DARKNESS (culori) ─────────────────────────────────────────

const toOklab = converter('oklab');

/**
 * Compute perceived darkness in [0, 1] from a fill string.
 *
 * `fillRaw` is the raw attribute (e.g. `var(--dir-text-primary)`,
 * `color-mix(...)`, `#FFF`, `none`).
 *
 * `fillComputed` is the resolved CSS value via `getComputedStyle` —
 * needed when fillRaw is a CSS variable or `color-mix` expression.
 *
 * Resolution order:
 *   1. Explicit token detection (mirrors legacy `fillDarknessFactor`) — culori
 *      can't parse `var()` references so we need this fallback for W1 tokens
 *   2. `color-mix(... TOKEN N%, transparent)` percentage extraction
 *   3. Culori OKLab L for direct color strings (hex, rgb, etc.)
 *
 * Returns 1 - L so 0 = paper, 1 = pure ink (consistent with legacy fillDarknessFactor).
 */
function computeDarkness(fillRaw: string | null, fillComputed: string | null): number {
  if (fillRaw === null || fillRaw === 'none' || fillRaw === 'transparent') return 0;

  // 1. color-mix percentage: `color-mix(in oklab, ..., TOKEN N%, transparent)`.
  //    MUST run before the bare-token table: the token name also appears INSIDE
  //    the mix expression, so token-first read the catalog's 8% washes as 1.0
  //    pure ink (the Process-print solid-black flood, found 2026-06-12).
  //    Per 09-LOCKED-MODEL §3 darknessL = 1 - OKLab L*: an 8% ink wash ≈ 0.08.
  const colorMixMatch = fillRaw.match(/(\d+(?:\.\d+)?)%\s*,\s*transparent/);
  if (colorMixMatch) {
    return Math.max(0, Math.min(1, parseFloat(colorMixMatch[1]) / 100));
  }

  // 2. W1 token detection — culori can't parse `var(...)` references, so we
  //    have to mirror legacy `fillDarknessFactor`'s explicit token table.
  if (fillRaw.includes('--dir-bg')) return 0;
  if (fillRaw.includes('--dir-text-primary')) return 1.0;
  if (fillRaw.includes('--dir-text-body-soft')) return 0.6;
  if (fillRaw.includes('--dir-text-body')) return 0.8;
  if (fillRaw.includes('--dir-text-secondary')) return 0.55;
  if (fillRaw.includes('--dir-detail')) return 0.4;
  if (fillRaw.includes('--dir-accent')) return 0.85;

  // 3. Culori OKLab for direct color strings (hex/rgb/hsl/etc.)
  const source = fillComputed ?? fillRaw;
  try {
    const parsed = parse(source);
    if (!parsed) return 0.75; // unknown opaque color — assume mid-dark
    const oklab = toOklab(parsed);
    if (!oklab || typeof oklab.l !== 'number') return 0.75;
    const L = Math.max(0, Math.min(1, oklab.l));
    return 1 - L;
  } catch {
    return 0.75;
  }
}

function readComputedFill(el: SVGElement, trustBlack = false): string | null {
  try {
    const computed = getComputedStyle(el).fill;
    if (computed === '') return null;
    // rgb(0,0,0) is the UA default for unstyled fills — only trust it as a
    // real black when a raw fill value exists (currentColor / class-driven),
    // per edge-case policy "currentColor" row.
    if (computed === 'rgb(0, 0, 0)' && !trustBlack) return null;
    return computed;
  } catch {
    return null;
  }
}

/**
 * Resolve a `url(#id)` fill to a darkness value per the edge-case policy:
 *   - linearGradient / radialGradient → average stop darkness (quick
 *     approximation; perfect would require rasterization)
 *   - <pattern> → 0 (pass-through / treat as opaque — patterns author their
 *     own density; smart layer must not over-mark)
 *   - unresolvable → 0.75 (same catch-all as computeDarkness)
 */
function resolveUrlFillDarkness(el: SVGElement, fill: string): number {
  const idMatch = fill.match(/url\(\s*['"]?#([^'")\s]+)/);
  if (!idMatch) return 0.75;
  const def = el.ownerSVGElement?.querySelector(`#${CSS.escape(idMatch[1])}`);
  if (!def) return 0.75;
  const defTag = def.tagName.toLowerCase();
  if (defTag === 'pattern') return 0;
  if (defTag === 'lineargradient' || defTag === 'radialgradient') {
    const stops = Array.from(def.querySelectorAll('stop'));
    if (stops.length === 0) return 0.75;
    let sum = 0;
    let n = 0;
    for (const stop of stops) {
      const c =
        stop.getAttribute('stop-color') ??
        getComputedStyle(stop).stopColor ??
        null;
      if (!c) continue;
      const opacity = parseFloat(stop.getAttribute('stop-opacity') ?? '1');
      try {
        const parsed = parse(c);
        if (!parsed) continue;
        const oklab = toOklab(parsed);
        if (!oklab || typeof oklab.l !== 'number') continue;
        sum += (1 - Math.max(0, Math.min(1, oklab.l))) * opacity;
        n += 1;
      } catch {
        /* skip unparseable stop */
      }
    }
    return n === 0 ? 0.75 : sum / n;
  }
  return 0.75;
}

// ─── WHOLE-SVG TRAVERSAL ──────────────────────────────────────────────────

/**
 * Walk the entire SVG tree and extract signals for every renderable child.
 *
 * Skips: `<defs>`, `<style>`, `<title>`, `<desc>`, `<metadata>`, `<clipPath>`,
 * `<mask>`, `<filter>` — they don't render visible content.
 *
 * Returns map keyed by region path (e.g. `"rect[0]"`, `"g[1]/path[0]"`) so
 * the classifier + override store can address regions stably across renders.
 */
export function extractAllSignals(svgRoot: SVGSVGElement): Map<string, Signals> {
  const result = new Map<string, Signals>();
  walkInto(svgRoot, [], null, result);
  return result;
}

function walkInto(
  parent: SVGElement,
  pathSegs: string[],
  parentBBox: { x: number; y: number; w: number; h: number } | null,
  out: Map<string, Signals>,
): void {
  // SHARED contract — same call as index.ts:resolveRegionPath uses.
  const renderableChildren = getRenderableChildren(parent);
  renderableChildren.forEach((child, zIdx) => {
    const childPath = [...pathSegs, `${child.tagName.toLowerCase()}[${zIdx}]`];
    const ctx: ExtractionContext = {
      parentBBox,
      siblings: renderableChildren,
      zIndex: zIdx,
    };
    const signals = extractSignals(child, ctx);
    out.set(childPath.join('/'), signals);

    // Recurse into groups
    if (child.tagName.toLowerCase() === 'g') {
      walkInto(child, childPath, signals.bbox, out);
    }
  });
}

const SKIP_TAGS = new Set([
  'defs', 'style', 'title', 'desc', 'metadata',
  'clippath', 'mask', 'filter', 'lineargradient', 'radialgradient', 'pattern',
  // <symbol> is inert except via <use> (edge-case policy table) — walking it
  // would generate marks for invisible content.
  'symbol',
]);

/**
 * Whether an SVG node is "renderable" — i.e. contributes to visible output and
 * should appear in the signals walk + classification + render passes.
 *
 * SHARED CONTRACT — `index.ts:resolveRegionPath` MUST walk through the same
 * set of children this filter accepts, or path lookups silently fail. Single
 * source of truth lives here; everyone imports from here.
 */
export function isRenderable(node: Element): boolean {
  if (!(node instanceof SVGElement)) return false;
  return !SKIP_TAGS.has(node.tagName.toLowerCase());
}

/**
 * Return the renderable children of a parent element, in DOM order.
 *
 * SHARED CONTRACT — both `signals.ts:walkInto` and `index.ts:resolveRegionPath`
 * use this. Changing the filter here changes both at once — no drift risk.
 */
export function getRenderableChildren(parent: Element): SVGElement[] {
  return Array.from(parent.children).filter(isRenderable) as SVGElement[];
}

// Re-export for convenience (also exported via index.ts later)
export { formatRgb };  // suppresses unused-import warning; helper for debug
