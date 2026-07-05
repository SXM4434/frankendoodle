// Smart Hachure System — region renderer.
//
// Takes a region (SVGElement) + Treatment + RenderContext, produces SVG
// elements that replace the original in the output.
//
// Two render paths:
//   - HACHURE path: treatment.fillStyle is a mark style → rough.js generates
//     the hachure / cross-hatch / dots / etc., clipped to the region's geometry
//   - OUTLINE-ONLY path: treatment.fillStyle === 'none' → return the region
//     as-is so the existing outline render handles it (frame / accent / line)
//
// Architecture: signals → classify → select treatment → RENDER
// See `docs/labs/hero/cells/F3-smart-hachure-system/06-architecture-technical-core.md`

import rough from 'roughjs';
import type { Options as RoughOptions } from 'roughjs/bin/core';
import type { Treatment } from './types';
import {
  COVERAGE_BANDS,
  bandIndexForDarkness,
  coverageToParams,
  darknessToCoverage,
  paramsToCoverage,
  isCoverageFillStyle,
} from '../smart/coverage';
// U4 — even-odd hole knockout. polygon-clipping ships methods on its default
// export (named imports break at runtime under Vite); re-type via the .d.ts
// signatures (mirrors lib/toneMask.ts). xor(rings…) = the odd-parity region.
import polygonClippingDefault from 'polygon-clipping';
import type {
  MultiPolygon as PCMultiPolygon,
  Polygon as PCPolygon,
  Ring as PCRing,
  xor as PCXor,
} from 'polygon-clipping';
const pcXor = (polygonClippingDefault as unknown as { xor: typeof PCXor }).xor;
// Proven marching-squares tracer (the flood-fill region path already uses it to
// honor fill-rule via rasterized pixels) — reused for the self-intersecting
// single-subpath even-odd fallback below.
import { traceToRings } from '../fill/regionFill';

// ─── PUBLIC ENTRY POINT ───────────────────────────────────────────────────

/** Per-call rendering context — owner doc, rough.js instance, seed source. */
export type RenderContext = {
  /** Owning SVG document — used for `createElementNS` calls. */
  ownerDoc: Document;
  /** A rough.js SVG generator bound to the target SVG. */
  rc: ReturnType<typeof rough.svg>;
  /** Base seed for deterministic mark generation. Same input → same marks. */
  baseSeed: number;
  /** Ink color for marks (resolved CSS color string). */
  inkColor: string;
  /** Region's source darkness (the classifier's `darknessL` signal, 0 = paper
   *  · 1 = ink). When present, density is RECALIBRATED from it: darkness →
   *  Murray-Davies coverage → 8-band quantization → per-fillStyle inverse
   *  (smart-system-build-plan Phase A row — THE visible change). Absent →
   *  behavior-preserving round-trip of the treatment's own calibration. */
  sourceDarkness?: number;
  /** User hachureGap-slider bias ratio (slider ÷ its default 4). Multiplies
   *  the darkness-solved gap so the slider stays live as bias-within-band
   *  (I-3: all sliders stay; smart owns the center, the user owns the lean).
   *  1 = neutral (default slider position). Only read by the darkness branch. */
  gapBias?: number;
};

/**
 * Render marks for one classified region.
 *
 * Returns an array of SVG elements to INSERT in place of the original.
 *   - Empty array → caller should skip this region (paper / structural / line)
 *   - One or more elements → marks to render
 */
export function renderRegion(
  region: SVGElement,
  treatment: Treatment,
  ctx: RenderContext,
): SVGElement[] {
  // OUTLINE-ONLY path — no marks generated, caller preserves source as-is
  if (treatment.fillStyle === 'none') return [];

  // HACHURE path — call rough.js with the treatment's params, clip to region
  return renderHachureFamily(region, treatment, ctx);
}

// ─── HACHURE FAMILY RENDERER (chunk 6a) ───────────────────────────────────
//
// For tonal-role regions (sparse-tonal · mid-tonal · dense-tonal · solid-content),
// generate hachure / cross-hatch / dots / zigzag marks via rough.js, clipped to
// the region's geometry.

/** Rough bbox area of a path `d` (min/max over its coordinate numbers). Not
 *  geometry-exact — only a magnitude estimate to size the dot-count safety cap. */
function pathBBoxArea(d: string): number {
  const nums = d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
  if (!nums || nums.length < 4) return 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = parseFloat(nums[i]);
    const y = parseFloat(nums[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return 0;
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}

/** U4: the source `fill-rule` for this region (own attr / inline style / nearest
 *  ancestor that declares it). Default 'nonzero' (SVG default). */
function readFillRule(el: SVGElement): string {
  let n: Element | null = el;
  for (let depth = 0; depth < 10 && n; depth++) {
    const attr = n.getAttribute?.('fill-rule');
    const inline = (n as SVGElement).style?.fillRule;
    if (attr) return attr;
    if (inline) return inline;
    n = n.parentElement;
  }
  return 'nonzero';
}

/** Split a path `d` into one `d` string per sub-path (M/m). Mirrors
 *  svgToStrokes.splitSubpaths (kept local to avoid coupling). */
function splitPathSubpaths(d: string): string[] {
  const out: string[] = [];
  const re = /[Mm][^Mm]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) out.push(m[0].trim());
  return out.length ? out : [d];
}

/** Even-odd region via RASTERIZE + TRACE: render the path with the browser's own
 *  `fill('evenodd')` into an offscreen mask, then run the proven marching-squares
 *  tracer (`traceToRings`) to recover the true odd-parity region (outer + holes)
 *  as clean L-only rings. Used for the SINGLE self-intersecting subpath the
 *  ring-XOR can't resolve (the pentagram). Coord-exact: the mask grid maps back
 *  to the path's own coordinate space via origin+cell. Browser-only; returns null
 *  on any failure (caller keeps the raw path → no regression). */
function evenOddViaRaster(d: string): string | null {
  if (typeof document === 'undefined' || typeof Path2D === 'undefined') return null;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const svg = document.createElementNS(SVG_NS, 'svg');
  host.appendChild(svg);
  document.body.appendChild(host);
  try {
    const el = document.createElementNS(SVG_NS, 'path') as SVGGeometryElement;
    el.setAttribute('d', d);
    svg.appendChild(el);
    let bb: { x: number; y: number; width: number; height: number };
    try {
      bb = el.getBBox();
    } catch {
      return null;
    }
    if (!Number.isFinite(bb.width) || !Number.isFinite(bb.height) || bb.width <= 0.01 || bb.height <= 0.01) {
      return null;
    }
    // ~256-cell long edge (matches the flood tracer's working resolution) + a
    // 2-cell pad so a boundary touching the bbox edge still closes a loop.
    const GRID_LONG = 256;
    const cell = Math.max(bb.width, bb.height) / GRID_LONG;
    if (!Number.isFinite(cell) || cell <= 0) return null;
    const pad = 2;
    const w = Math.ceil(bb.width / cell) + pad * 2;
    const h = Math.ceil(bb.height / cell) + pad * 2;
    if (w < 4 || h < 4 || w * h > 4_000_000) return null; // sanity + OOM guard
    const origin = { x: bb.x - pad * cell, y: bb.y - pad * cell };
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c2d = canvas.getContext('2d', { willReadFrequently: true });
    if (!c2d) return null;
    c2d.fillStyle = '#000';
    c2d.fillRect(0, 0, w, h);
    // Map world (path) coords → cell coords: px = (world − origin) / cell.
    c2d.fillStyle = '#fff';
    c2d.setTransform(1 / cell, 0, 0, 1 / cell, -origin.x / cell, -origin.y / cell);
    c2d.fill(new Path2D(d), 'evenodd'); // the BROWSER's even-odd = ground truth
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    const data = c2d.getImageData(0, 0, w, h).data;
    const raw = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) raw[i] = data[i * 4] > 127 ? 1 : 0; // white = inside
    // SEAL PINCH POINTS: a pentagram's filled arms meet at measure-zero points at
    // the inner vertices; in the raster the center hole leaks to the outside
    // through those pinches, so marching squares finds ONE merged boundary instead
    // of an enclosed pentagon hole. A 1-cell dilation (8-connected) thickens the
    // arms just enough to seal the leaks → the hole is a real island. Cost: the
    // hole shrinks ~1 cell all round (invisible for hachure-clipping). A simple
    // disc just grows 1px → still one ring (no regression on non-pinched shapes).
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (raw[idx]) { mask[idx] = 1; continue; }
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && raw[ny * w + nx]) { on = 1; break; }
          }
        }
        mask[idx] = on;
      }
    }
    const traced = traceToRings(mask, w, h, origin, cell);
    if (!traced || traced.outer.length < 4) return null;
    const ringToPath = (ring: [number, number][]) =>
      ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') + ' Z';
    const parts = [
      ringToPath(traced.outer as unknown as [number, number][]),
      ...traced.holes.filter((hh) => hh.length >= 4).map((hh) => ringToPath(hh as unknown as [number, number][])),
    ];
    return parts.join(' ');
  } finally {
    try {
      document.body.removeChild(host);
    } catch {
      /* ignore */
    }
  }
}

/** U4 — recompute a clean EVEN-ODD region path (outer minus holes) from a
 *  compound `d`. rough.js mis-renders source compound/curved evenodd paths
 *  (donut → solid, star → fragment, github → scribble) because it doesn't honor
 *  the source fill-rule. We sample each sub-path into a clean point ring (via the
 *  LIVE-mounted FULL path so relative `m` resolves correctly — cumulative-length
 *  boundaries), XOR them (polygon-clipping = odd parity), and emit L-only rings
 *  that rough.js hachures with correct hole knockout. Returns null on ANY failure
 *  → caller keeps the raw path (no regression). Browser-only; evenodd compound
 *  paths only (narrow → the locked catalog of single-subpath shapes is untouched). */
function evenOddRegionPath(d: string): string | null {
  if (typeof document === 'undefined') return null;
  const subs = splitPathSubpaths(d);
  // SINGLE subpath: the sub-by-sub ring XOR has nothing to knock out, so a
  // SELF-INTERSECTING single path (a PENTAGRAM under even-odd — the center
  // pentagon should be a HOLE) used to fall through to the raw path and flood
  // solid. polygon-clipping resolves a self-intersecting ring to NONZERO (the
  // solid star — verified), so it can't recover the hole either. Rasterize the
  // path with the browser's OWN even-odd fill + trace the pixels (the proven
  // flood-fill tracer) → the true odd-parity region. Simple (non-self-crossing)
  // single subpaths trace to just the outer ring = unchanged (no regression).
  if (subs.length < 2) return evenOddViaRaster(d);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const svg = document.createElementNS(SVG_NS, 'svg');
  host.appendChild(svg);
  document.body.appendChild(host);
  try {
    const full = document.createElementNS(SVG_NS, 'path') as SVGGeometryElement;
    full.setAttribute('d', d);
    svg.appendChild(full);
    let totalAll = 0;
    try {
      totalAll = full.getTotalLength();
    } catch {
      return null;
    }
    if (!Number.isFinite(totalAll) || totalAll <= 0.01) return null;
    // Cumulative sub-path length boundaries: the cumulative path IS the real path
    // up to sub-path k, so relative-m positions resolve correctly.
    const bnd: number[] = [0];
    const cum = document.createElementNS(SVG_NS, 'path') as SVGGeometryElement;
    svg.appendChild(cum);
    let acc = '';
    for (const s of subs) {
      acc += (acc ? ' ' : '') + s;
      cum.setAttribute('d', acc);
      try {
        bnd.push(cum.getTotalLength());
      } catch {
        return null;
      }
    }
    const rings: PCRing[] = [];
    for (let k = 1; k < bnd.length; k++) {
      const start = bnd[k - 1];
      const span = bnd[k] - start;
      if (span <= 0.5) continue;
      const n = Math.max(8, Math.min(400, Math.ceil(span / 2)));
      const ring: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const len = Math.min(start + (span * i) / n, totalAll);
        let pt: DOMPoint;
        try {
          pt = full.getPointAtLength(len);
        } catch {
          return null;
        }
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
        ring.push([pt.x, pt.y]);
      }
      if (ring.length >= 4) rings.push(ring as unknown as PCRing);
    }
    if (rings.length < 2) return null;
    let region: PCMultiPolygon;
    try {
      region = pcXor([rings[0]], ...rings.slice(1).map((r) => [r] as PCPolygon));
    } catch {
      return null;
    }
    if (!region || region.length === 0) return null;
    const parts: string[] = [];
    for (const poly of region) {
      for (const ring of poly) {
        if (ring.length < 4) continue;
        const segs = ring.map(
          ([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`,
        );
        segs.push('Z');
        parts.push(segs.join(' '));
      }
    }
    return parts.length ? parts.join(' ') : null;
  } finally {
    try {
      document.body.removeChild(host);
    } catch {
      /* ignore */
    }
  }
}

function renderHachureFamily(
  region: SVGElement,
  treatment: Treatment,
  ctx: RenderContext,
): SVGElement[] {
  // Convert region's geometry into a path string rough.js can clip to.
  let pathD = extractRegionPath(region);
  if (pathD === null) return []; // Region has no fillable geometry
  // U4: even-odd compound paths (donut / star / knockout icons) flood or fragment
  // under rough.js. Recompute the true odd-parity region as clean rings so holes
  // knock out. Narrow (evenodd + multi-subpath only); falls back to the raw path.
  if (readFillRule(region) === 'evenodd') {
    const eo = evenOddRegionPath(pathD);
    if (eo) pathD = eo;
  }

  // Density math routes through the shared coverage module (smart Phase A —
  // one math, two renderers). See resolveDensity below.
  const density = resolveDensity(treatment, ctx);

  // U3: 'dots' renders as ONE <path> of per-dot arc commands; dotCount ≈
  // area/gap²·layers, so a large dark region can emit a ~20M-char path that
  // freezes the tab. Cap the count by RAISING the gap — coverage honestly
  // saturates at the cap instead of hanging (same spirit as the gap-floor cap).
  // Provably bounded: gap=sqrt(area·layers/MAX_DOTS) ⇒ new count = MAX_DOTS.
  if (treatment.fillStyle === 'dots') {
    const area = pathBBoxArea(pathD);
    const layers = Math.max(1, density.layers);
    const MAX_DOTS = 6000;
    const est = area > 0 && density.gap > 0 ? (area / (density.gap * density.gap)) * layers : 0;
    if (est > MAX_DOTS) density.gap = Math.sqrt((area * layers) / MAX_DOTS);
  }

  // Build rough.js options from the treatment.
  // Map our biasMode → rough.js hachure angle variation:
  //   gap-dominant  = single direction (use treatment angle as-is)
  //   layers-dominant = cross-hatch handles 2nd direction internally
  //   weight-dominant = single direction; weight does the tonal work
  //   hybrid        = single direction; modifiers do tonal work
  const fillOpts: RoughOptions = {
    seed: ctx.baseSeed,
    stroke: 'none',
    fill: ctx.inkColor,
    fillStyle: treatment.fillStyle as RoughOptions['fillStyle'],
    hachureGap: density.gap,
    fillWeight: density.weight,
    // Hachure angle from the user's hachureAngle modifier, routed via the
    // treatment (default -41° per spec when unset), plus a tiny constant
    // epsilon (18-scope-audit §H-6 edge-case policy: jitter the scan
    // alignment so scan lines can't pass exactly through polygon corners —
    // the Inkscape-documented stray-hachure bug). Deterministic constant,
    // imperceptible at 0.07°, preserves I-7 determinism.
    hachureAngle: treatment.angle + 0.07,
    // Disable rough.js's per-mark roughness on the hachure layer itself —
    // we want clean parallel lines clipped to a possibly-jittered outline,
    // not jittered hachure lines (artistically distracting).
    roughness: 0,
  };

  let hachureGroup = ctx.rc.path(pathD, fillOpts);
  if (!hachureGroup) return [];

  // U3 BACKSTOP (OFAT 2026-06-14: Stipple emitted a 10.4M-char dots <path> that
  // freezes the tab). The pre-estimate above (pathBBoxArea) MIS-PARSES arc/curve
  // command params as coords, so its area can under-shoot → the gap-raise is
  // skipped → rough.js emits a multi-MB path. This guarantees a ceiling
  // regardless of the estimate: if the GENERATED dots path is over the char cap,
  // regenerate with a proportionally larger gap until bounded (≤4 tries). A
  // render-policy ceiling like the gap-floor — coverage saturates, never hangs.
  // GENERALIZED to ALL gap-dependent grammars (OFAT 2026-06-15: the rose emitted
  // a 1.1M-char HACHURE path — the bomb class isn't just dots; any per-mark fill
  // over a huge/complex region can blow up). solid/none are gap-independent
  // (their path is just the outline, already bounded) so they're excluded.
  if (treatment.fillStyle !== 'none' && treatment.fillStyle !== 'solid') {
    const MAX_PATH_CHARS = 300000;
    // MAX over all paths in the group (rough.js may emit >1; measure the worst).
    const dLen = (g: SVGElement) =>
      [...g.querySelectorAll('path')].reduce((m, p) => Math.max(m, (p.getAttribute('d') ?? '').length), 0);
    let len = dLen(hachureGroup);
    let tries = 0;
    while (len > MAX_PATH_CHARS && tries < 4) {
      tries++;
      density.gap *= Math.max(1.6, Math.sqrt(len / MAX_PATH_CHARS));
      const regen = ctx.rc.path(pathD, { ...fillOpts, hachureGap: density.gap });
      if (!regen) break;
      hachureGroup.remove();
      hachureGroup = regen;
      len = dLen(hachureGroup);
    }
    // CRITICAL: propagate the raised gap to fillOpts so the EXTRA LAYERS below
    // (layers>1, e.g. stipple's 2 dot layers) inherit the bounded gap. Without
    // this they re-render at the original tiny gap → a second multi-MB layer
    // ships uncapped (OFAT: 'tonal-layer-1' was the 10.4M path, base was fine).
    fillOpts.hachureGap = density.gap;
  }

  hachureGroup.setAttribute('data-smart-hachure', 'tonal');
  // Apply treatment opacity at the group level — preserves per-stroke
  // alpha for downstream filters (texture grain, etc.)
  hachureGroup.setAttribute('opacity', String(treatment.opacity));
  // Density receipts — the RENDERED numbers (post-recalibration), stamped
  // here because resolveDensity is where truth lives now; index.ts stamps
  // role/confidence provenance, never density.
  stampDensity(hachureGroup, density);

  // If layerCount > 1, generate additional layers offset slightly so they
  // accumulate tonal density without overlapping perfectly.
  // (rough.js's cross-hatch handles 2 directions internally — additional
  // layers go beyond that.)
  const extraLayers = Math.max(0, density.layers - 1);
  if (extraLayers === 0 || treatment.fillStyle === 'cross-hatch') {
    return [hachureGroup];
  }

  const out: SVGElement[] = [hachureGroup];
  for (let i = 1; i <= extraLayers; i++) {
    const layerOpts: RoughOptions = {
      ...fillOpts,
      seed: ctx.baseSeed + i * 100,
      // Offset subsequent layers' angle slightly (Agent 1 — cross-hatch at
      // 60-75° not 90°). Layer i offsets by 22° per layer, relative to the
      // user's chosen treatment angle so the whole hatch family rotates with
      // the hachureAngle slider.
      hachureAngle: treatment.angle + 22 * i,
    };
    const layerGroup = ctx.rc.path(pathD, layerOpts);
    if (layerGroup) {
      layerGroup.setAttribute('data-smart-hachure', `tonal-layer-${i}`);
      layerGroup.setAttribute('opacity', String(treatment.opacity));
      stampDensity(layerGroup, density);
      out.push(layerGroup);
    }
  }
  return out;
}

/** Stamp the rendered density numbers for DevTools / harness receipts. */
function stampDensity(
  el: SVGElement,
  density: { gap: number; weight: number; layers: number; band: number | null; coverage: number | null },
): void {
  el.setAttribute('data-smart-gap', density.gap.toFixed(2));
  el.setAttribute('data-smart-weight', density.weight.toFixed(2));
  el.setAttribute('data-smart-layers', String(density.layers));
  if (density.band !== null) el.setAttribute('data-smart-band', String(density.band));
  if (density.coverage !== null) el.setAttribute('data-smart-coverage', density.coverage.toFixed(3));
}

// ─── DENSITY RESOLUTION — ONE MATH, TWO RENDERERS (smart Phase A) ─────────
//
// RECALIBRATED (Phase A row, smart-system-build-plan — THE visible change):
// when the render context carries the region's source darkness, density is
// driven by it — NOT by the role table's legacy gap heuristics:
//
//   darknessL ──bandIndexForDarkness──► band (0..7, Praun TAM cell)
//   band midpoint darkness ──darknessToCoverage──► target ink coverage
//        (Murray-Davies inverse — 21-research §4; quantized so every region
//         inside one band renders IDENTICAL density: I-2's 8-level identity)
//   target ──coverageToParams (per-fillStyle inverse, weight-anchored)──► gap
//   layers = band's tamLayers column (cross-hatch keeps layerCount 1 —
//        rough.js stacks its 2nd direction internally and renderHachureFamily
//        never adds extra passes for it; the forward model already accounts)
//
// The user's sliders all stay live (I-3 bias-within-band):
//   strokeWidth · fillDensity → the anchored weight (via techniqueMap)
//   hachureGap → ctx.gapBias multiplies the solved gap (1 = neutral default)
//   hachureAngle / fillOpacity / inkIntensity → angle + opacity, untouched
//
// Render policy (Agent 5 — same locked bounds techniqueMap enforces on its
// own gap): solved gap clamps to [1.5, 12] px, weight caps at 0.7 × gap so
// lines never merge to solid. Where the bounds bind, delivered coverage
// honestly saturates — the bound is the locked perceptual contract.
//
// FALLBACK (no sourceDarkness in ctx — e.g. a direct renderRegion caller):
// behavior-preserving round-trip of the treatment's own calibration through
// the same module (forward → inverse, exact by construction; snapToAnchor
// strips ≤1-ulp float residue and UNMASKS any larger disagreement).

const POLICY_GAP_FLOOR = 1.5; // px — lines never optically blend (Agent 5)
const POLICY_GAP_CAP = 12; // px — beyond this, lines read as strokes not tone
const POLICY_WEIGHT_RATIO = 0.7; // weight ≤ 0.7 × gap — never merge to solid

// UPPER-DARKNESS GUARD (dark-blob re-fix, 2026-06-13). THE missing render half.
//
// Murray-Davies pins coverage → 1.0 once source darkness ≳ 0.63, and the
// gap-floor re-solve then delivers ~0.91 effective cross-hatch coverage at the
// 1.5 px floor — a structure-losing SOLID-BLACK BLOB (knockout text/panels
// overwhelmed, no readable gaps). The GOAL is LEGIBLE DENSE HAND-DRAWN
// HATCHING: clearly pen lines with gaps, internal structure still readable,
// dark but NOT solid. So we CAP the target coverage for the darkness-driven
// solve below the reads-as-solid threshold. At this cap the cross-hatch solves
// to gap ≈ 2.3 px at a 1.05 px line weight (w/g ≈ 0.45) — visibly gapped dense
// hatching that still reads DARK. Empirically (the blob probe): footprint dark
// fraction drops from ~0.6–0.8 (blob) to a legible dense register while paper
// gaps inside the body rise enough to keep knockout structure readable.
//
// This is a RENDER-POLICY ceiling on tone (like the gap floor / weight ratio),
// not a change to the documented coverage math (coverage.ts is untouched). It
// applies ONLY to the source-darkness recalibration branch — the branch that
// produces the dark-region tone. Slider bias still rides on top.
const COVERAGE_LEGIBLE_DENSE_CAP = 0.72;

function resolveDensity(
  treatment: Treatment,
  ctx: RenderContext,
): { gap: number; weight: number; layers: number; band: number | null; coverage: number | null } {
  const { fillStyle } = treatment;
  // 'solid' has no density axes (coverage ≡ 1); degenerate gap/weight (≤ 0
  // or non-finite) can't carry coverage — pass both through untouched.
  if (
    !isCoverageFillStyle(fillStyle) ||
    !Number.isFinite(treatment.gap) ||
    !Number.isFinite(treatment.weight) ||
    treatment.gap <= 0 ||
    treatment.weight <= 0
  ) {
    return {
      gap: treatment.gap,
      weight: treatment.weight,
      layers: treatment.layerCount,
      band: null,
      coverage: null,
    };
  }

  // ── RECALIBRATION BRANCH — source darkness drives density ──
  const d = ctx.sourceDarkness;
  if (d !== undefined && Number.isFinite(d)) {
    const band = bandIndexForDarkness(d);
    const bandDef = COVERAGE_BANDS[band];
    // Band midpoint = the quantized tone for every region in this band.
    const dQuant = (bandDef.darknessMin + bandDef.darknessMax) / 2;
    // UPPER-DARKNESS GUARD: cap the dark-region tone target below the
    // reads-as-solid threshold so a high-darkness region renders as LEGIBLE
    // DENSE HATCHING (visible gaps, knockout structure readable) instead of a
    // solid-black blob. Light/mid bands are untouched — their targets sit far
    // below the cap, so only the Dark/Near-black/black bands (the blob bands)
    // are reined in. See COVERAGE_LEGIBLE_DENSE_CAP note above.
    const rawTarget = darknessToCoverage(dQuant);
    const targetCoverage = Math.min(rawTarget, COVERAGE_LEGIBLE_DENSE_CAP);
    // When the upper-darkness guard BINDS (dark/near-black/black bands), the
    // dot/zigzag/dashed grammars would otherwise stack the band's full TAM
    // nesting depth (3–4 layers) — and overlapping passes at the gap floor fill
    // the inter-dot gaps into a near-solid MASS even though each layer is sparse
    // (the stipple half of the blob: a dot field that reads solid). Cross-hatch
    // is exempt (rough.js handles its 2 internal directions; layerCount stays).
    // Capping the nesting depth at 2 where the guard binds keeps the dark dot
    // screen LEGIBLY STIPPLED (visible dots + gaps) instead of massing.
    const guardBinds = rawTarget > COVERAGE_LEGIBLE_DENSE_CAP;
    const bandLayers = guardBinds
      ? Math.min(2, bandDef.tamLayers || 1)
      : bandDef.tamLayers || 1;
    const layers =
      fillStyle === 'cross-hatch'
        ? Math.max(1, treatment.layerCount)
        : Math.max(1, bandLayers);

    // 1. Weight-anchored solve (user's strokeWidth/fillDensity own weight).
    const solved = coverageToParams(targetCoverage, fillStyle, {
      weight: treatment.weight,
      layers,
    });
    let gap = solved.gap;
    let weight = solved.weight;

    // 2. If the POLICY bounds bind the solved gap, the tone target re-solves
    //    along the OTHER axis at the bound (coverage.ts gap-anchored mode) —
    //    21-research §4's function shape returns weight as an output, and
    //    saturating tone silently would break I-2 harder than nudging weight.
    //    Matters most for dots: coverage ∝ (w/g)², so the 1.5 px floor alone
    //    would crush dark stipple bands to ~0.2 coverage at thin pen weights.
    if (gap < POLICY_GAP_FLOOR || gap > POLICY_GAP_CAP) {
      gap = Math.max(POLICY_GAP_FLOOR, Math.min(POLICY_GAP_CAP, gap));
      weight = coverageToParams(targetCoverage, fillStyle, { gap, layers }).weight;
    }

    // 3. User hachureGap bias rides ON TOP of the policy-fitted solve (never
    //    weight-compensated — compensating would cancel the slider). Clamped
    //    to the same bounds.
    const gapBias =
      ctx.gapBias !== undefined && Number.isFinite(ctx.gapBias) && ctx.gapBias > 0
        ? ctx.gapBias
        : 1;
    gap = Math.max(POLICY_GAP_FLOOR, Math.min(POLICY_GAP_CAP, gap * gapBias));

    // 4. Lines never merge to solid (Agent 5) — final ratio cap.
    weight = Math.min(weight, gap * POLICY_WEIGHT_RATIO);

    return { gap, weight, layers, band, coverage: targetCoverage };
  }

  // ── FALLBACK — behavior-preserving round-trip of the treatment ──
  const layers = Math.max(1, treatment.layerCount);
  const targetCoverage = paramsToCoverage(
    { gap: treatment.gap, weight: treatment.weight, layers },
    fillStyle,
  );
  const params = coverageToParams(targetCoverage, fillStyle, {
    weight: treatment.weight,
    layers,
  });
  return {
    gap: snapToAnchor(params.gap, treatment.gap),
    weight: snapToAnchor(params.weight, treatment.weight),
    layers: params.layers,
    band: null,
    coverage: targetCoverage,
  };
}

/** Strip float-division residue: if the computed value matches its anchor to
 *  1e-9 relative, return the anchor bit-exactly (rough.js scan-line layout is
 *  a function of gap — bit-identical input → bit-identical marks). Larger
 *  deviations pass through UNMASKED: if the coverage math ever disagrees
 *  with the calibration, the render (and the screenshot gate) must show it,
 *  never hide it. */
function snapToAnchor(computed: number, anchor: number): number {
  if (computed === anchor) return anchor;
  const scale = Math.max(Math.abs(anchor), 1e-12);
  return Math.abs(computed - anchor) / scale < 1e-9 ? anchor : computed;
}

// ─── GEOMETRY EXTRACTION ──────────────────────────────────────────────────
//
// Convert each SVG primitive into a path string rough.js can clip hachure to.
// rough.js's `polygonHachureLines` accepts arbitrary closed polygon paths and
// handles concave shapes correctly (per Agent 2 verification).

function extractRegionPath(el: SVGElement): string | null {
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case 'rect': {
      const x = parseFloat(el.getAttribute('x') ?? '0');
      const y = parseFloat(el.getAttribute('y') ?? '0');
      const w = parseFloat(el.getAttribute('width') ?? '0');
      const h = parseFloat(el.getAttribute('height') ?? '0');
      if (w === 0 || h === 0) return null;
      return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
    }

    case 'circle': {
      const cx = parseFloat(el.getAttribute('cx') ?? '0');
      const cy = parseFloat(el.getAttribute('cy') ?? '0');
      const r = parseFloat(el.getAttribute('r') ?? '0');
      if (r === 0) return null;
      // Approximate circle as 4 cubic Bezier arcs (kappa = 0.5523)
      const k = 0.5523 * r;
      return [
        `M ${cx - r} ${cy}`,
        `C ${cx - r} ${cy - k}, ${cx - k} ${cy - r}, ${cx} ${cy - r}`,
        `C ${cx + k} ${cy - r}, ${cx + r} ${cy - k}, ${cx + r} ${cy}`,
        `C ${cx + r} ${cy + k}, ${cx + k} ${cy + r}, ${cx} ${cy + r}`,
        `C ${cx - k} ${cy + r}, ${cx - r} ${cy + k}, ${cx - r} ${cy}`,
        'Z',
      ].join(' ');
    }

    case 'ellipse': {
      const cx = parseFloat(el.getAttribute('cx') ?? '0');
      const cy = parseFloat(el.getAttribute('cy') ?? '0');
      const rx = parseFloat(el.getAttribute('rx') ?? '0');
      const ry = parseFloat(el.getAttribute('ry') ?? '0');
      if (rx === 0 || ry === 0) return null;
      const kx = 0.5523 * rx;
      const ky = 0.5523 * ry;
      return [
        `M ${cx - rx} ${cy}`,
        `C ${cx - rx} ${cy - ky}, ${cx - kx} ${cy - ry}, ${cx} ${cy - ry}`,
        `C ${cx + kx} ${cy - ry}, ${cx + rx} ${cy - ky}, ${cx + rx} ${cy}`,
        `C ${cx + rx} ${cy + ky}, ${cx + kx} ${cy + ry}, ${cx} ${cy + ry}`,
        `C ${cx - kx} ${cy + ry}, ${cx - rx} ${cy + ky}, ${cx - rx} ${cy}`,
        'Z',
      ].join(' ');
    }

    case 'polygon': {
      const points = (el.getAttribute('points') ?? '').trim();
      if (points === '') return null;
      const pairs = parsePointsString(points);
      if (pairs.length < 3) return null;
      const segs = pairs.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`);
      segs.push('Z');
      return segs.join(' ');
    }

    case 'path': {
      const d = el.getAttribute('d');
      if (d === null || d.trim() === '') return null;
      // Trust the source path — rough.js handles the clipping
      return d;
    }

    case 'polyline':
    case 'line':
      // Open paths can't be hachured (no closed area) — caller treats as outline
      return null;

    case 'g': {
      // U1: uploaded SVGs often wrap geometry in <g fill="#…"><path…/></g>. The
      // <g> is classified as ONE region but has no own geometry → null → zero
      // fill marks (fill-style a no-op on grouped uploads). Union the group's
      // renderable LEAF geometry into one multi-subpath d so the <g> becomes a
      // fillable region (rough.js clips fine to a compound path; nested <g>
      // recurse). The <g>'s own fill (signals reads it directly) drives darkness.
      const parts: string[] = [];
      for (const child of Array.from(el.children)) {
        const cd = extractRegionPath(child as unknown as SVGElement);
        if (cd) parts.push(cd);
      }
      return parts.length ? parts.join(' ') : null;
    }

    default:
      return null;
  }
}

function parsePointsString(s: string): [number, number][] {
  const nums = s.split(/[\s,]+/).map(parseFloat).filter((n) => !isNaN(n));
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pairs.push([nums[i], nums[i + 1]]);
  }
  return pairs;
}
