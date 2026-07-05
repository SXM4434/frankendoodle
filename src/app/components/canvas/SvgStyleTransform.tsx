import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
// Smart Hachure System (v1) — opt-in via `?smartHachure=1` URL param.
// See `docs/labs/hero/cells/F3-smart-hachure-system/06-architecture-technical-core.md`.
import { renderSmartHachure, type SmartHachureStyle } from '../../lib/smartHachure';
import rough from 'roughjs';
import type { Options as RoughOptions } from 'roughjs/bin/core';
import { useF3SvgStyle, isRoughFamilyStyle, type F3SvgStyle } from '../../state/F3SvgStyleContext';
import {
  useF3RoughModifiers,
  type F3ModifiersState,
  type MultiStrokeStep,
  type FillStyleStep,
  type TextureStep,
  type PaletteModeStep,
  type EndpointBehaviorStep,
  type SketchingStyleStep,
  type PenTipStep,
  type DotPatternStep,
} from '../../state/F3RoughModifiersContext';
import {
  roughRectPoints,
  roughOvalPoints,
  roughPolygonPoints,
  roughLinePoints,
  // Playground-native cubic-Bezier path builders — used directly for layer 0
  // (and layers without per-vertex transforms) so wobble produces the exact
  // playground wandering character, not the over-jittered Q-bezier-on-short-segments
  // mess that the rebuild was producing.
  roughRectPathExtended,
  roughOvalPathExtended,
  roughLinePathExtended,
  rotatePointsAround,
  scalePointsAround,
  crossHatchRotationFor,
  parallelPassScaleFor,
  parallelPassTranslateFor,
  offsetLinePerpendicular,
  HAND_FEEL_BASE,
  penTipPath,
  pointsToPolylinePath,
  seededRandom,
  type ShapeModifiers,
} from '../../lib/f3HandFeel';

// ─── PER-STYLE PRESETS — applied at preset-reset; state values override ──

// When user clicks "Reset to preset" while a style is active, these values
// snap the state. Live render uses raw state values, not these.
export const STYLE_PRESETS: Record<F3SvgStyle, Partial<F3ModifiersState>> = {
  // Non-rough styles set wobble: 0 (clean baseline; jitter inactive).
  // Rough-family styles set wobble: 1.0 (playground calibration baseline per I-11).
  'clean':           { wobble: 0, bowing: 0, strokeWidth: 1.0, inkIntensity: 1.0, fillOpacity: 1.0, texture: 'none', fillStyle: 'hachure' },
  'outline-only':    { wobble: 0, bowing: 0, strokeWidth: 1.0, inkIntensity: 1.0, fillOpacity: 0,   texture: 'none' },
  // Rock Y 2026-06-12 — wireframe rebuilt as a REAL schematic register
  // (applyWireframeSchematic below). strokeWidth is in SCREEN px here
  // (non-scaling-stroke): 0.75 = the hairline default. fillOpacity drives
  // fill-BOUNDARY line prominence — 1.0 default (full ink; construction-line
  // feel is opt-in by dialing it down). Hand-feel keys pinned to 0 so a
  // switch from a rough style reads instantly as the clean counterpoint.
  'wireframe':       { wobble: 0, jaggedness: 0, bowing: 0, strokeWidth: 0.75, simplification: 1.0, inkIntensity: 1.0, fillOpacity: 1.0, texture: 'none' },
  // 2026-06-08 default calibration bump per Sebs: each style should READ as
  // itself at the default thumbnail scale (~140px), not as near-clean. Prior
  // values made wet-ink / charcoal / newsprint / risograph almost
  // indistinguishable from clean in the /audit grid.
  'wet-ink':         { wobble: 0.6, strokeWidth: 1.2, inkIntensity: 1.0, fillOpacity: 0.9, texture: 'wet-ink',  blurAmount: 1.5, bleed: 0.3 },
  'charcoal':        { wobble: 1.0, strokeWidth: 1.4, inkIntensity: 1.0, fillOpacity: 1.0, texture: 'chalky',   grainIntensity: 3.0, smudgeAmount: 0, pressureVariance: 0.3 },
  'newsprint':       { wobble: 0, strokeWidth: 0.9, inkIntensity: 1.0, fillOpacity: 1.0, texture: 'stipple', textureIntensity: 2.0, dotSize: 1.2, dotSpacing: 4, dotPattern: 'staggered' },
  'risograph':       { wobble: 0.4, strokeWidth: 1.0, inkIntensity: 1.0, fillOpacity: 0.7, texture: 'none',     offsetDistance: 4, offsetAngle: 45, colorShift: 0.7, risoSecondaryColor: 'accent', registrationError: 0 },
  // curveDamp 0 → 0.4 (2026-06-08): per §I-13 pair-wise interactions,
  // curveDamp dampens wobble jitter scale + bowing offset. At default 0
  // the rough.js double-stroke + wobble jitter produced visibly splintered
  // edges on small rects (band patch, gig ticket). 0.4 smooths the rough
  // character without flattening the hand-drawn feel.
  // Jaggedness defaults set to 0 (2026-06-09 per Sebs): splinter is opt-in
  // via slider, NOT default. Prior 0.6/0.4/0.5/0.3 stamped perpendicular
  // zigzag intermediates on every shape at default state.
  // wobble 1.0→0.4 + curveDamp 0.4→0.3 per Sebs 2026-06-11 ("start at these
  // values") — calmer default line; full range still reachable on the sliders.
  'rough-handdrawn': { wobble: 0.4, jaggedness: 0, bowing: 1.0, strokeWidth: 1.2, curveDamp: 0.3, multiStroke: 'double', fillStyle: 'hachure', hachureGap: 4, hachureAngle: -41, fillDensity: 0.7, texture: 'paper-tooth' },
  'sketchy':         { wobble: 0.6, jaggedness: 0, bowing: 0.4, strokeWidth: 0.9, curveDamp: 0, multiStroke: 'single', fillStyle: 'none', hachureGap: 4, hachureAngle: -41, fillDensity: 0.5, texture: 'light', inkIntensity: 0.85 },
  'bold-ink':        { wobble: 0.4, jaggedness: 0, bowing: 0.2, strokeWidth: 2.8, curveDamp: 0, multiStroke: 'off', fillStyle: 'solid', fillDensity: 1.0, texture: 'none' },
  'stipple':         { wobble: 0.8, jaggedness: 0, bowing: 0.7, strokeWidth: 0.7, curveDamp: 0, multiStroke: 'single', fillStyle: 'dots', hachureGap: 2.5, hachureAngle: 0, fillDensity: 1.0, texture: 'stipple', dotSize: 1.0, dotSpacing: 3, dotScatter: 0.3 },
};

// Helper: apply preset to current state (used by chrome's "Reset to preset" button)
export function applyStylePreset(
  currentState: F3ModifiersState,
  style: F3SvgStyle,
): F3ModifiersState {
  return { ...currentState, ...STYLE_PRESETS[style] };
}

// ─── MULTI-STROKE LAYER COUNTS ──────────────────────────────────────────────

function multiStrokeMeta(step: MultiStrokeStep): { layerCount: number } {
  switch (step) {
    case 'off':    return { layerCount: 0 };
    case 'single': return { layerCount: 1 };
    case 'double': return { layerCount: 2 };
    case 'triple': return { layerCount: 3 };
    case 'quad':   return { layerCount: 4 };
    case 'quint':  return { layerCount: 5 };
    case 'six':    return { layerCount: 6 };
    case 'heavy':  return { layerCount: 8 };
  }
}

function fillStyleToRough(step: FillStyleStep): string | undefined {
  if (step === 'none') return undefined;
  return step;
}

// ─── PALETTE COLOR MAPPING — preserves color-mix transparency ──────────────
//
// The source SVG often uses `color-mix(in oklab, var(--dir-text-primary) 8%, transparent)`
// for translucent fills. When we apply a palette mode we want to swap ONLY the
// token (var(...)) while preserving the percentage + transparent endpoint, so a
// faint wash stays faint when the user picks `body`, `secondary`, etc.
//
// Plain tokens (`var(--dir-text-primary)`) swap directly. Anything else passes
// through unchanged.

// `isInk` distinguishes STROKE/ink resolution from FILL resolution.
//
// feedback_palette_overrides_ink_not_paper (LOCKED): palette overrides remap
// INK only and must NEVER resolve ink to the paper color. The `bg` and
// `inverted` modes are the only two that point at paper (`var(--dir-bg)`):
//   - For a FILL they're legitimate — `bg` is the explicit opt-in to flood a
//     region with paper, `inverted` paints a region paper-colored.
//   - For a STROKE that is fatal: ink === paper makes the stroke VANISH on
//     ~every shape (RC-3: ~197 shapes lost all strokes when strokePalette was
//     `bg` or `inverted`). So in ink context BOTH paper-pointing modes resolve
//     to a real, visible ink instead. `inverted` = the true inverse of paper
//     (the darkest ink, --dir-text-primary); `bg`-as-stroke is GUARDED to the
//     same visible ink so it can never blank the line.
function paletteToToken(mode: PaletteModeStep, isInk = false): string | null {
  switch (mode) {
    case 'source':     return null;
    case 'primary':    return 'var(--dir-text-primary)';
    case 'body':       return 'var(--dir-text-body)';
    case 'body-soft':  return 'var(--dir-text-body-soft)';
    case 'secondary':  return 'var(--dir-text-secondary)';
    case 'detail':     return 'var(--dir-detail)';
    case 'accent':     return 'var(--dir-accent, #D4574A)';
    // Ink can never become paper — guard `bg` to the darkest visible ink.
    case 'bg':         return isInk ? 'var(--dir-text-primary)' : 'var(--dir-bg)';
    case 'neutral':    return 'var(--dir-text-body)';
    // `inverted` ink = the inverse OF paper = the darkest ink (visible). As a
    // fill it stays paper-colored (region painted to the substrate).
    case 'inverted':   return isInk ? 'var(--dir-text-primary)' : 'var(--dir-bg)';
  }
}

const COLOR_MIX_TOKEN_RE = /var\(--[a-zA-Z0-9-]+(?:,\s*[^)]+)?\)/;

function mapPaletteColor(originalColor: string | undefined, paletteMode: PaletteModeStep, isInk = false): string | undefined {
  if (paletteMode === 'source') return originalColor;
  const replacement = paletteToToken(paletteMode, isInk);
  if (!replacement) return originalColor;
  if (!originalColor) return originalColor;  // null/undefined fills must NOT become opaque
  // NEVER remap "paper" fills. Palette overrides remap INK, not the substrate.
  // --dir-bg = page background (paper); transparent/none = no fill. Sebs 2026-06-04:
  // "look at clean from source to anything else it just fills the entire object"
  // — that was BG fills being incorrectly mapped to opaque ink colors.
  if (originalColor === 'none' || originalColor === 'transparent') return originalColor;
  if (originalColor.includes('--dir-bg')) return originalColor;
  // color-mix(...) — swap the first var() token inside, preserve everything else
  // (percentage + transparent endpoint) so an 8% wash stays 8% under any palette.
  if (originalColor.includes('color-mix')) {
    return originalColor.replace(COLOR_MIX_TOKEN_RE, replacement);
  }
  // Plain var(--token) — swap to replacement token.
  if (originalColor.startsWith('var(')) {
    return replacement;
  }
  // Plain hex / named color — swap.
  return replacement;
}

// ─── PEN-TIP / SKETCHING — per-layer point transforms ──────────────────────

/** Apply the per-layer geometric transform (cross-hatch rotate, parallel-pass
 *  scale, loose-overlap already baked into the points via ShapeModifiers). */
function applyLayerTransform(
  points: Array<[number, number]>,
  sketchingStyle: SketchingStyleStep,
  layerIndex: number,
  cx: number,
  cy: number,
  isClosed: boolean,
): Array<[number, number]> {
  if (layerIndex === 0) return points;
  if (sketchingStyle === 'cross-rotate') {
    return rotatePointsAround(points, cx, cy, crossHatchRotationFor(layerIndex));
  }
  if (sketchingStyle === 'parallel-pass') {
    if (isClosed) {
      return scalePointsAround(points, cx, cy, parallelPassScaleFor(layerIndex));
    }
    return offsetLinePerpendicular(points, layerIndex);
  }
  // 'single-pass' and 'loose-overlap' are handled by the seed offset / mods.
  return points;
}

/** Geometric center of a point set (used as the cross-hatch / parallel-pass pivot). */
function centroidOf(points: Array<[number, number]>): { cx: number; cy: number } {
  if (points.length === 0) return { cx: 0, cy: 0 };
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  return { cx: cx / points.length, cy: cy / points.length };
}

// ─── SEED OFFSETS — coprime increments per playground convention ─────────────

const SEED_INCREMENTS = [0, 47, 113, 181, 257, 331, 401, 479];

function seedOffsets(base: number, count: number): number[] {
  return SEED_INCREMENTS.slice(0, count).map((inc) => base + inc);
}

// ─── STABLE PER-LAYER NUDGE — multi-stroke visible at any roughness ─────────
//
// Generalizes rough.js's `_curveWithOffset` technique (which applies base
// offsets of 1 and 1.5 units INDEPENDENT of roughness — see
// https://github.com/rough-stuff/rough/blob/master/src/renderer.ts#L60-L67)
// to ALL shapes. Each layer ≥ 1 gets a tiny fixed XY translate so layers stay
// visibly distinct even when roughness × jitter is sub-pixel (the failure
// mode the user surfaced 2026-06-02: at rough ~0.24 + strokeWidth ~0.45,
// per-vertex jitter is ~0.58 px which is barely above stroke width — layers
// overlap into a single perceived stroke).
//
// rough.js itself has this bug for `_doubleLine` (see Agent 2 research).
// Adding the curve-style stable offset here closes the gap.
//
// Magnitude scales with strokeWidth so multi-stroke stays proportionally
// visible across the stroke-width range (per user direction 2026-06-03 — at
// rough=0 + strokeWidth=0.30 the original fixed 0.6px nudge was sub-pixel and
// rasterized as a single blurry line). Floor at 0.6 px so thin strokes still
// get the baseline nudge. Capped at 4 px so heavy multi-stroke + thick stroke
// doesn't bleed into loose-overlap's 5 px register.
//
// Examples at default angle steps:
// strokeWidth 0.30 → layer1 0.6, layer3 0.9 (same as before for thin strokes)
// strokeWidth 1.0  → layer1 1.0, layer3 1.4
// strokeWidth 2.5  → layer1 2.5, layer3 3.5
// strokeWidth 3.0  → layer1 3.0, layer3 4.0 (cap engaged for layer ≥ 4)
// ─── LOOSE-OVERLAP TRANSLATE — Hero-8-Lab calibration ──────────────────────
//
// Playground's parallelPassTranslateFor uses magnitude=5 (calibrated for
// playground's 300-500px artifacts). On Hero-8-Lab's 60-80px hero pins that
// reads as 8-12% of shape size — far too aggressive (user flagged 2026-06-03).
// Local override at magnitude=2 matches the same half-playground calibration
// already applied to LOCAL_LOOSE_OVERLAP in f3HandFeel.ts:70.
function looseOverlapTranslate(layerIndex: number): { dx: number; dy: number } {
  if (layerIndex === 0) return { dx: 0, dy: 0 };
  const magnitude = 2;
  const patterns = [
    { dx: 0, dy: 0 },
    { dx: magnitude, dy: magnitude },
    { dx: -magnitude, dy: -magnitude },
    { dx: magnitude * 1.5, dy: -magnitude },
    { dx: -magnitude, dy: magnitude * 1.5 },
  ];
  return patterns[Math.min(layerIndex, patterns.length - 1)];
}

function stableLayerNudge(layerIndex: number, strokeWidth: number): { dx: number; dy: number } {
  if (layerIndex === 0) return { dx: 0, dy: 0 };
  const angle = layerIndex * 0.7;
  // Increased again (2026-06-09 take 2): at heart-scale drawings (300+px) the
  // earlier 2-4px offsets were still barely distinguishable. Bumping to
  // 3-9px so triple multi-stroke reads as three distinct outlines at zoom.
  const base = Math.max(3.5, strokeWidth * 2.5);
  const step = Math.max(2.0, strokeWidth * 1.0);
  const magnitude = Math.min(14, base + (layerIndex - 1) * step);
  return {
    dx: magnitude * Math.cos(angle),
    dy: magnitude * Math.sin(angle),
  };
}

// ─── HAND-FEEL POINT EXTRACTION + RENDER ───────────────────────────────────
//
// For each SVG primitive (rect/circle/ellipse/line/polygon/polyline) we
// compute the closed/open jittered point loop via f3HandFeel, then either:
//   • penTip === 'plain' → render as stroked polyline path (one path per layer)
//   • penTip != 'plain'  → feed each layer's points through penTipPath
//                          (perfect-freehand) → render as filled polygon
//
// <path> stays on rough.js since arbitrary path commands aren't sampleable
// without a full SVG path parser.

type ShapeContext = {
  ROUGH: number;             // roughness base × wobble
  baseSeed: number;
  isClosed: boolean;
  /** Smaller bbox dimension (px) — used to scale pen-tip presets so they
   *  read correctly on small shapes. */
  bboxMin: number;
  /** rough.js SVG renderer — used for HYBRID hachure layer (real hachure /
   *  cross-hatch / dots / zigzag fill rendered underneath the hand-feel outline
   *  when fillStyle requires a patterned fill). */
  rc: ReturnType<typeof rough.svg>;
  // Function that builds the jittered point loop for a given seed + mods.
  // Caller closure should bake protrudeScale (derived from bbox) into the call.
  buildPoints: (seed: number, mods: ShapeModifiers) => Array<[number, number]>;
  /** OPTIONAL: when provided, layer 0 + layers WITHOUT cross-hatch/parallel-pass
   *  transforms use this playground-native path-builder DIRECTLY (matches
   *  playground rendering exactly — fewer long cubic-Bezier segments per side,
   *  jittered control points at 1/3 and 2/3 with j()*1.4 amplitude). For
   *  cross-hatch / parallel-pass / pen-tip layers, falls back to buildPoints
   *  + pointsToPolylinePath since those need per-vertex transforms. */
  buildPath?: (seed: number, mods: ShapeModifiers) => string;
  /** OPTIONAL pivot override (see groupPivot in transformElement). */
  pivotOverride?: { cx: number; cy: number };
  /** OPTIONAL: when true, ctx.buildPath handles per-layer transforms internally
   *  (cross-hatch / parallel-pass) so the normal needsPerVertexTransform fallback
   *  is bypassed. Used by case 'path' Catmull-Rom buildPath which can apply
   *  perpendicular offset to anchors before smoothing → clean parallel curves
   *  on dense drawn input instead of the chaos-fallback. */
  handlesPerVertexLayer?: boolean;
  /** OPTIONAL size override for the effectiveLayerCount / effectiveWobble
   *  / effectiveRoughness clamps. When a child is part of a group, the GROUP's
   *  bbox-min is passed here so multi-stroke (etc.) gets the layer count the
   *  user actually picked even though the individual child is tiny.
   *  Added 2026-06-07 — diagnostic confirmed multi-stroke was silently
   *  downgrading to 1 layer on stackedSketchbooks because each book's bbox
   *  was 14-18px and the clamp rule is "30px per layer." With this override,
   *  the whole 84×70 group's bboxMin=70 lets multi-stroke fire as intended. */
  bboxMinOverride?: number;
};

/** Compute protrude scale from a shape's smaller dimension. Playground baseline
 *  is ~140px; below that we scale down so endpoints don't blow out. */
function protrudeScaleForBbox(bboxMin: number): number {
  return Math.max(0.25, Math.min(1.0, bboxMin / 140));
}

/** Inject jaggedness — adds perpendicular zig-zag intermediates between each
 *  pair of consecutive sampled points. Does NOT change wobble amplitude (the
 *  outer points stay where they were); just adds sharp angle character ALONG
 *  each segment so the line reads as splintered / zigzag at high jaggedness,
 *  smooth at low. Added 2026-06-08 per Sebs's "splinter toggle" intent. */
function injectJaggedness(
  points: Array<[number, number]>,
  jaggedness: number,
  seed: number,
): Array<[number, number]> {
  if (points.length < 2 || jaggedness <= 0.05) return points;
  // jagged 0.5 → 1 zig per segment; jagged 1 → 2 zigs; jagged 2 → 4 zigs.
  //
  // 2026-06-11 slider-sweep QUEUE fix (audit-runs/2026-06-11-slider-sweep/
  // REPORT.md §2): the integer Math.round(jaggedness * 2) collapsed the
  // 41-tick slider into a 4-level STAIRCASE — crossing a rounding boundary
  // re-laid-out every zig (measured MAD cliff ~1.5-1.9), while moves inside
  // a bucket only scaled amplitude (~0.2-0.4). Fix: per-segment DITHERED zig
  // count — the fractional part of `jaggedness * 2` sets what FRACTION of
  // segments carry the next integer zig count (seeded draw, deterministic),
  // so each slider tick migrates ~10% of segments instead of all-at-once.
  // At the integer anchors (0.5 → 1, 1.0 → 2, 1.5 → 3, 2.0 → 4) every
  // segment gets the same count as before — the calibrated endpoint looks
  // (subtle roughening → dramatic full-sawtooth) are preserved. Default
  // jaggedness = 0 early-returns above, byte-identical.
  const zigFloat = Math.min(4, Math.max(1, jaggedness * 2));
  const zigBase = Math.floor(zigFloat);
  const zigFrac = zigFloat - zigBase;
  // Perpendicular displacement scales with jaggedness so high jaggedness = wider zig
  const ampScale = jaggedness * 0.9;
  const r = seededRandom(seed + 9973);
  const out: Array<[number, number]> = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) { out.push([bx, by]); continue; }
    // Per-segment dithered zig count (seeded — deterministic per shape).
    const zigsPerSeg = Math.min(4, zigBase + (r() < zigFrac ? 1 : 0));
    // unit perpendicular
    const px = -dy / len;
    const py = dx / len;
    // segment-length-relative zig amplitude — keeps small segments from
    // disappearing into noise, but lets long segments get visible zig
    const ampPx = Math.min(len * 0.18, 1.2 + ampScale * 2.0);
    for (let z = 1; z <= zigsPerSeg; z++) {
      const t = z / (zigsPerSeg + 1);
      const mx = ax + dx * t;
      const my = ay + dy * t;
      // alternate sign + small random jitter so zigs aren't perfectly regular
      const sign = z % 2 === 0 ? -1 : 1;
      const noise = (r() - 0.5) * 0.5;
      const amp = ampPx * (sign + noise);
      out.push([mx + px * amp, my + py * amp]);
    }
    out.push([bx, by]);
  }
  return out;
}

/**
 * SOURCE-FILL DARKNESS PARSING.
 *
 * Drawing convention: shading TECHNIQUE (hachure/cross-hatch/dots/etc) REPLACES
 * each tonal area's solid fill with a pattern at density matching the area's
 * darkness. Dark fills → dense hachure. Light wash → sparse hachure. White →
 * blank. The fillStyle toggle CHANGES THE TECHNIQUE; the source fill COLOR
 * dictates which areas are dark / mid / light.
 *
 * Maps a source SVG fill color to a 0-1 "darkness" score the shading layer
 * uses to scale hachure density (gap, fillWeight, line count).
 *
 *   1.0 = fully opaque dark ink (--dir-text-primary)
 *   0.65 = mid (--dir-text-body, --dir-text-body-soft)
 *   0.45 = secondary / detail
 *   0.08 = 8% wash (the WASH constant — faint translucent overlay)
 *   0 = background, transparent, or none
 *
 * Literal hex / rgb(a) / hsl(a) fills (uploaded SVGs) are parsed to WCAG
 * relative luminance → darkness = 1 - Y, per F3-shading-calibration-spec
 * §4.2 + §7.B-14.
 */
function fillDarknessFactor(fillColor: string | undefined): number {
  if (!fillColor || fillColor === 'none' || fillColor === 'transparent') return 0;
  // color-mix(... TOKEN N%, transparent) — read the percentage, treat as opacity
  const colorMixMatch = fillColor.match(/(\d+(?:\.\d+)?)%\s*,\s*transparent/);
  if (colorMixMatch) {
    return Math.max(0, Math.min(1, parseFloat(colorMixMatch[1]) / 100));
  }
  // Plain CSS-var token. Map common W1 ink tiers to a darkness score.
  if (fillColor.includes('--dir-bg')) return 0;
  if (fillColor.includes('--dir-text-primary')) return 1.0;
  if (fillColor.includes('--dir-text-body-soft')) return 0.6;
  if (fillColor.includes('--dir-text-body')) return 0.8;
  if (fillColor.includes('--dir-text-secondary')) return 0.55;
  if (fillColor.includes('--dir-detail')) return 0.4;
  if (fillColor.includes('--dir-accent')) return 0.85;

  // ── F3-shading-calibration-spec §4.2 + §7.B-14 ──────────────────────────
  // Literal hex / rgb / rgba / hsl / hsla fills — uploaded SVGs carry these,
  // not var() tokens; previously they all fell to the 0.75 catch-all so every
  // region got uniform hachure density regardless of tone. Per spec: parse
  // the color, compute WCAG relative luminance
  //   Y = 0.2126·R + 0.7152·G + 0.0722·B   (channels sRGB-linearized:
  //   c/12.92 below 0.04045, else ((c+0.055)/1.055)^2.4)
  // then darkness = 1 - Y, multiplied by alpha for rgba/hsla. This lands on
  // the SAME 0-1 scale the var() tiers above hand-map (near-black → ~1.0
  // like --dir-text-primary; white → 0 like --dir-bg), so literal colors
  // feed the identical downstream gap/weight math with no rescaling.
  let rgb: [number, number, number] | null = null; // channels in 0-1
  let alpha = 1;
  const lit = fillColor.trim();
  const hexMatch = lit.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    const h = hexMatch[1];
    if (h.length === 3 || h.length === 4) {
      rgb = [
        parseInt(h[0] + h[0], 16) / 255,
        parseInt(h[1] + h[1], 16) / 255,
        parseInt(h[2] + h[2], 16) / 255,
      ];
      if (h.length === 4) alpha = parseInt(h[3] + h[3], 16) / 255;
    } else if (h.length === 6 || h.length === 8) {
      rgb = [
        parseInt(h.slice(0, 2), 16) / 255,
        parseInt(h.slice(2, 4), 16) / 255,
        parseInt(h.slice(4, 6), 16) / 255,
      ];
      if (h.length === 8) alpha = parseInt(h.slice(6, 8), 16) / 255;
    }
  } else {
    const rgbMatch = lit.match(
      /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i,
    );
    const hslMatch = lit.match(
      /^hsla?\(\s*(-?[\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i,
    );
    if (rgbMatch) {
      const ch = (s: string) => (s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s) / 255);
      rgb = [ch(rgbMatch[1]), ch(rgbMatch[2]), ch(rgbMatch[3])];
      if (rgbMatch[4] !== undefined) {
        alpha = rgbMatch[4].endsWith('%') ? parseFloat(rgbMatch[4]) / 100 : parseFloat(rgbMatch[4]);
      }
    } else if (hslMatch) {
      // hsl → rgb first (spec §7.B-14), then the same luminance path below.
      const hDeg = ((parseFloat(hslMatch[1]) % 360) + 360) % 360;
      const sat = Math.max(0, Math.min(1, parseFloat(hslMatch[2]) / 100));
      const lig = Math.max(0, Math.min(1, parseFloat(hslMatch[3]) / 100));
      const chroma = (1 - Math.abs(2 * lig - 1)) * sat;
      const hPrime = hDeg / 60;
      const xSec = chroma * (1 - Math.abs((hPrime % 2) - 1));
      const base = lig - chroma / 2;
      const [r1, g1, b1] =
        hPrime < 1 ? [chroma, xSec, 0] :
        hPrime < 2 ? [xSec, chroma, 0] :
        hPrime < 3 ? [0, chroma, xSec] :
        hPrime < 4 ? [0, xSec, chroma] :
        hPrime < 5 ? [xSec, 0, chroma] :
                     [chroma, 0, xSec];
      rgb = [r1 + base, g1 + base, b1 + base];
      if (hslMatch[4] !== undefined) {
        alpha = hslMatch[4].endsWith('%') ? parseFloat(hslMatch[4]) / 100 : parseFloat(hslMatch[4]);
      }
    }
  }
  if (rgb) {
    const lin = (ch: number) =>
      ch <= 0.04045 ? ch / 12.92 : Math.pow((ch + 0.055) / 1.055, 2.4);
    const y = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    return Math.max(0, Math.min(1, (1 - y) * Math.max(0, Math.min(1, alpha))));
  }

  // Unknown opaque color — assume mid-dark (spec §4.2 catch-all, kept as-is).
  return 0.75;
}

// ─── SMART ADAPTIVE CLAMPS — toggle interactions per shape size ───────────
//
// User direction 2026-06-02: treat the modifier set as a "living ecosystem"
// — when a shape is small, certain modifiers (hachure, multi-stroke, roughness)
// should auto-scale down so the rendering stays legible. Each clamp accepts
// the user's slider value + the shape's bboxMin and returns the effective
// value used at render time.

/** Hachure gap auto-widens on small shapes so the pattern doesn't blob.
 *  At bboxMin >= 80px, no adjustment. Below 80, gap grows inversely. */
function effectiveHachureGap(userGap: number, bboxMin: number): number {
  const scale = Math.max(1, 80 / Math.max(1, bboxMin));
  return userGap * scale;
}

/** Multi-stroke layer count caps based on shape size so layered strokes
 *  don't fully overlap on tiny items.
 *
 *  RAISED 2026-06-08: ~30px per layer ceilinged at 3 layers for typical
 *  60-100px shapes — user couldn't reach quad/quint/six/heavy regardless of
 *  slider. Loosened to ~12px per layer (80px shape → 7 layers reachable,
 *  100px → 8). Aligns with `feedback_more_toggle_options_better`: the user
 *  picks the visual budget; the clamp is only a tiny-shape sanity bound. */
function effectiveLayerCount(userLayers: number, bboxMin: number): number {
  const sizeCappedLayers = Math.max(1, Math.ceil(bboxMin / 12));
  return Math.min(Math.max(1, userLayers), sizeCappedLayers);
}

/** Roughness clamps so jitter amplitude doesn't exceed a fraction of shape size.
 *  Below 60px, roughness max scales down so shapes stay recognizable. */
function effectiveRoughness(userRoughness: number, bboxMin: number): number {
  const maxUseful = Math.max(0.3, bboxMin / 60);
  return Math.min(userRoughness, maxUseful);
}

/** Wobble clamp — same size-aware logic as effectiveRoughness, applied to the
 *  master wobble multiplier. Playground (C3UserFlow) content is 100-300px so
 *  the unclamped wobble * HAND_FEEL_BASE works there. Trophy Wall pins are
 *  60-80px so the same amplitude reads as shredded. Clamp so wobble's effect
 *  scales with shape size — small pins get muted wobble, big content gets full. */
function effectiveWobble(userWobble: number, bboxMin: number): number {
  // Floor 0.3 → 0.5 (2026-06-08 quick fix per Sebs): simple shapes (stick
  // figure, simple pen) were getting too clamped at default rough-handdrawn
  // (geomean of tiny bbox ⇒ wobble ≤ 0.3). 0.5 floor lifts the baseline so
  // every shape reads as visibly hand-drawn at default without re-shredding
  // small geometry (the geomean clamp + min-with-userWobble still bound it).
  // Real fix = smart-layer per-element role classifier; this is the interim.
  const maxUseful = Math.max(0.5, bboxMin / 60);
  return Math.min(userWobble, maxUseful);
}

/** Fill density / hachure weight clamp — prevents hachure from filling shape
 *  to a solid block at high density on small shapes. */
function effectiveFillWeight(userDensity: number, bboxMin: number): number {
  // density slider is 0-1.5; multiply by 2 to get rough.js fillWeight.
  // For small shapes, halve the effective density to keep hachure airy.
  const sizeDamp = Math.max(0.5, Math.min(1.0, bboxMin / 100));
  return userDensity * 2 * sizeDamp;
}

/** Resample a built path `d` into evenly-spaced points for pen-tip inking.
 *  The built d carries ALL line-feel modifiers (wobble/bowing/curveDamp/
 *  jaggedness/endpoint), so sampling it — instead of the clean anchors —
 *  makes every toggle affect pen-tip ink exactly as it affects plain mode.
 *  Needs the source's <svg> to measure against; returns null when that (or
 *  the path) isn't measurable so the caller can fall back to raw anchors. */
function samplePathForPenTip(
  d: string,
  sourceEl: SVGElement,
  ownerDoc: Document,
): Array<[number, number]> | null {
  const svg = sourceEl.ownerSVGElement;
  if (!svg || !d) return null;
  const tmp = ownerDoc.createElementNS('http://www.w3.org/2000/svg', 'path');
  tmp.setAttribute('d', d);
  svg.appendChild(tmp);
  let len = 0;
  try { len = tmp.getTotalLength(); } catch { /* invalid path */ }
  if (!len) { svg.removeChild(tmp); return null; }
  // ~4px spacing keeps the wobble field's ~60px wavelength fully sampled;
  // cap so huge shapes × multi-stroke layers stay cheap.
  const n = Math.max(8, Math.min(256, Math.round(len / 4)));
  const out: Array<[number, number]> = [];
  for (let k = 0; k <= n; k++) {
    const p = tmp.getPointAtLength((k / n) * len);
    out.push([p.x, p.y]);
  }
  svg.removeChild(tmp);
  return out;
}

/** Ramer-Douglas-Peucker polyline simplification.
 *  Reduces dense input (drawn freehand / auto-traced) to audit-compatible
 *  vertex density without losing curve shape. A point is dropped if its
 *  perpendicular distance from the chord through its neighbors is < epsilon.
 *  Audit shapes already sit at sparse density — RDP is a no-op for them. */
function rdp(points: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  if (points.length < 3) return points;
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lineLen = Math.hypot(dx, dy);
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const dist = lineLen === 0
      ? Math.hypot(px - x1, py - y1)
      : Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / lineLen;
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, maxIdx + 1), epsilon);
    const right = rdp(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

/** Catmull-Rom smooth-curve path generator.
 *  Converts a polyline (list of anchors) into a cubic-Bezier `d` string that
 *  passes smoothly THROUGH every anchor — control points derived from the
 *  tangent at each anchor (neighbor-difference). Hand-feel jitter is added to
 *  the control points so the curve still reads as drawn-by-hand.
 *
 *  Why: after RDP simplifies a dense drawn input (heart → ~15-20 anchors),
 *  pointsToPolylinePath produces straight-ish bezier segments between adjacent
 *  anchors — visible polygon corners. Catmull-Rom produces a curve that
 *  follows the polyline shape with no corner artifacts. Audit shapes (no RDP)
 *  never use this; they keep their polygon-between-corners character which is
 *  correct for rect/trapezoid sides. */
/** Corner-preserving smoothing. Applies 3-point moving average ONLY at points
 *  where the local angle change is small (smooth curve). Skips smoothing at
 *  sharp corners (>30° turn) so rectangles stay rectangles, hearts keep their
 *  V-bottom sharp, etc. Endpoints always preserved exactly.
 *  intensity (0-1) blends original ↔ smoothed at smooth interior points. */
function smoothPolyline(
  points: Array<[number, number]>,
  intensity = 0.5,
  cornerThresholdRad = Math.PI / 6, // 30 degrees
): Array<[number, number]> {
  if (points.length < 3 || intensity <= 0) return points;
  const out: Array<[number, number]> = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const [cx, cy] = points[i + 1];
    // Angle change at point i (signed turn from incoming → outgoing segment)
    const v1x = bx - ax, v1y = by - ay;
    const v2x = cx - bx, v2y = cy - by;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 0.01 || len2 < 0.01) { out.push([bx, by]); continue; }
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    const cosClamped = Math.max(-1, Math.min(1, dot));
    const angle = Math.acos(cosClamped);
    if (angle > cornerThresholdRad) {
      // Corner — preserve as-is.
      out.push([bx, by]);
    } else {
      // Smooth segment — blend toward 3-point average.
      const sx = (ax + bx + cx) / 3;
      const sy = (ay + by + cy) / 3;
      out.push([bx * (1 - intensity) + sx * intensity, by * (1 - intensity) + sy * intensity]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Generate a smooth low-frequency 1D wobble field along arc length.
 *  Returns a function (t: 0..1) → [dx, dy] that produces ~1 oscillation per
 *  `wavelengthPx` of path length. Used to add flowing wobble to a Catmull-Rom
 *  curve without per-anchor micro-jitter. */
function arcLengthWobbleField(
  totalArcLen: number,
  amplitude: number,
  wavelengthPx: number,
  seed: number,
): (t: number) => [number, number] {
  if (amplitude <= 0.001 || totalArcLen <= 1) return () => [0, 0];
  const r = seededRandom(seed);
  // Anchor count = arc length / wavelength, minimum 3 so we get a curve.
  const numAnchors = Math.max(3, Math.ceil(totalArcLen / wavelengthPx));
  // Random anchor displacements
  const dxs: number[] = [];
  const dys: number[] = [];
  for (let k = 0; k <= numAnchors; k++) {
    dxs.push((r() - 0.5) * 2 * amplitude);
    dys.push((r() - 0.5) * 2 * amplitude);
  }
  return (t: number): [number, number] => {
    const clampedT = Math.max(0, Math.min(1, t));
    const u = clampedT * numAnchors;
    const i = Math.floor(u);
    const f = u - i;
    // Cosine interpolation for smooth transitions
    const fs = (1 - Math.cos(f * Math.PI)) / 2;
    const dx = dxs[i] * (1 - fs) + dxs[Math.min(i + 1, numAnchors)] * fs;
    const dy = dys[i] * (1 - fs) + dys[Math.min(i + 1, numAnchors)] * fs;
    return [dx, dy];
  };
}

/** Apply endpointBehavior to a polyline: extend / push points based on the
 *  user-selected endpoint mode. */
function applyEndpointBehavior(
  points: Array<[number, number]>,
  mode: ShapeModifiers['endpointBehavior'],
  isClosed: boolean,
  seed: number,
): Array<[number, number]> {
  if (mode === 'clean' || points.length < 2) return points;
  const amount = mode === 'protrude' ? 4 : mode === 'long-overshoot' ? 9 : 2.5;
  const r = seededRandom(seed + 5555);
  if (mode === 'kink') {
    // Random-angle push at every anchor — produces the twitchy/spasm kink
    return points.map(([x, y]) => {
      const a = r() * Math.PI * 2;
      return [x + Math.cos(a) * amount, y + Math.sin(a) * amount] as [number, number];
    });
  }
  if (isClosed) {
    // Radial outward from centroid for all anchors (matches old case 'path')
    let cx = 0, cy = 0;
    for (const p of points) { cx += p[0]; cy += p[1]; }
    cx /= points.length; cy /= points.length;
    return points.map(([x, y]) => {
      const dx = x - cx, dy = y - cy;
      const len = Math.max(0.01, Math.hypot(dx, dy));
      return [x + (dx / len) * amount, y + (dy / len) * amount] as [number, number];
    });
  }
  // Open path: extend first point backward along outgoing segment, last point
  // forward along incoming segment.
  const out = points.slice();
  const [p0, p1n] = [points[0], points[1]];
  const d1x = p1n[0] - p0[0], d1y = p1n[1] - p0[1];
  const l1 = Math.max(0.01, Math.hypot(d1x, d1y));
  out[0] = [p0[0] - (d1x / l1) * amount, p0[1] - (d1y / l1) * amount];
  const [pn1, pn] = [points[points.length - 2], points[points.length - 1]];
  const d2x = pn[0] - pn1[0], d2y = pn[1] - pn1[1];
  const l2 = Math.max(0.01, Math.hypot(d2x, d2y));
  out[points.length - 1] = [pn[0] + (d2x / l2) * amount, pn[1] + (d2y / l2) * amount];
  return out;
}

/** Straight-bezier-per-side path — control points sit ON each side's chord
 *  with perpendicular jitter for hand-feel wobble. Corners stay sharp because
 *  consecutive bezier segments END/START at the same vertex with control
 *  points along the segments' own chord directions, not curved through.
 *  Used for polygonal inputs (rectangles, triangles, diamonds) where the
 *  intended shape has clear corners.
 *  Honors bowing (perpendicular bow per segment), curveDamp (damps bow),
 *  endpointBehavior (applied before path generation). */
function straightBezierPath(
  points: Array<[number, number]>,
  isClosed: boolean,
  wobbleAmplitude: number,
  bowing: number,
  curveDamp: number,
  endpointBehavior: ShapeModifiers['endpointBehavior'],
  seed: number,
): string {
  const working = applyEndpointBehavior(points, endpointBehavior, isClosed, seed);
  if (working.length < 2) return '';
  const r = seededRandom(seed);
  const j = () => (r() - 0.5) * 2 * wobbleAmplitude;
  const tightnessDamp = Math.max(0.1, 1 - curveDamp * 0.45);
  const effectiveBow = bowing * tightnessDamp;
  let d = `M ${working[0][0].toFixed(2)} ${working[0][1].toFixed(2)}`;
  const N = working.length;
  const segEnd = isClosed ? N : N - 1;
  for (let i = 0; i < segEnd; i++) {
    const p1 = working[i];
    const p2 = working[(i + 1) % N];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);
    const perpX = len > 0.01 ? -dy / len : 0;
    const perpY = len > 0.01 ? dx / len : 0;
    const sign = r() > 0.5 ? 1 : -1;
    // Bowing perpendicular offset on control points (matches pointsToPolylinePath formula)
    const bow = effectiveBow * len * 0.06 * sign;
    const c1x = p1[0] + dx / 3 + perpX * bow + j();
    const c1y = p1[1] + dy / 3 + perpY * bow + j();
    const c2x = p1[0] + (2 * dx) / 3 + perpX * bow + j();
    const c2y = p1[1] + (2 * dy) / 3 + perpY * bow + j();
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  if (isClosed) d += ' Z';
  return d;
}

function catmullRomPath(
  points: Array<[number, number]>,
  isClosed: boolean,
  wobbleAmplitude: number,
  bowing: number,
  curveDamp: number,
  endpointBehavior: ShapeModifiers['endpointBehavior'],
  seed: number,
): string {
  const n0 = points.length;
  if (n0 < 2) return '';

  // 0) Apply endpoint behavior BEFORE smoothing so the extended/kinked points
  //    feed into the curve.
  const adjusted = applyEndpointBehavior(points, endpointBehavior, isClosed, seed);

  // 1) Corner-preserving smoothing: remove input micro-jitter at gentle-curve
  //    segments so wobble=0 reads clean. Sharp corners (rectangles, V-bottoms)
  //    bypass smoothing entirely so they stay sharp.
  const smoothed = smoothPolyline(adjusted, 0.5);
  const N = smoothed.length;

  // 2) Build arc-length-parameterized wobble field. Wavelength scales with
  //    overall path length so short paths get full character but long paths
  //    don't read as braid (one cycle per ~60px).
  let arcLen = 0;
  const cum: number[] = [0];
  for (let i = 1; i < N; i++) {
    arcLen += Math.hypot(smoothed[i][0] - smoothed[i - 1][0], smoothed[i][1] - smoothed[i - 1][1]);
    cum.push(arcLen);
  }
  // Wavelength scales with path length so short paths still get a few cycles
  // and long paths don't read as braid. 1 cycle per ~12% of total length
  // floored at 35px and capped at 90px.
  const wavelength = Math.max(35, Math.min(90, arcLen * 0.12));
  const wobbleAt = arcLengthWobbleField(arcLen, wobbleAmplitude, wavelength, seed);

  // Apply wobble field to each anchor before generating Catmull-Rom curve.
  // (Displacing the anchors themselves produces a curve that wobbles WITH the
  // path direction. Jittering only control points doesn't move the curve.)
  const displaced: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    const t = N > 1 ? cum[i] / arcLen : 0;
    const [wdx, wdy] = wobbleAt(t);
    displaced.push([smoothed[i][0] + wdx, smoothed[i][1] + wdy]);
  }

  // CORNER PRESERVATION: at sharp corners (angle change > 45°), use the
  // OUTGOING/INCOMING segment direction as the tangent at that vertex rather
  // than the average of neighbors. Catmull-Rom's neighbor-averaged tangent
  // produces rounded corners (since it pulls control points sideways into
  // the curve). Tangent-along-segment keeps corners sharp.
  const CORNER_THRESHOLD = Math.PI / 4; // 45°
  const isSharpCornerAt = (p0: [number, number], p1: [number, number], p2: [number, number]): boolean => {
    const v1x = p1[0] - p0[0], v1y = p1[1] - p0[1];
    const v2x = p2[0] - p1[0], v2y = p2[1] - p1[1];
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 0.01 || len2 < 0.01) return false;
    const cosAng = (v1x * v2x + v1y * v2y) / (len1 * len2);
    return cosAng < Math.cos(CORNER_THRESHOLD);
  };

  // curveDamp damps the tangent strength (higher → tighter / straighter
  // curves). bowing adds perpendicular displacement to control points.
  const tightnessDamp = Math.max(0.1, 1 - curveDamp * 0.45);
  const tangentScale = tightnessDamp;
  const effectiveBow = bowing * tightnessDamp;
  const rBow = seededRandom(seed + 4242);

  let d = `M ${displaced[0][0].toFixed(2)} ${displaced[0][1].toFixed(2)}`;
  const segEnd = isClosed ? N : N - 1;
  for (let i = 0; i < segEnd; i++) {
    const p0 = isClosed
      ? displaced[((i - 1 + N) % N)]
      : (i - 1 < 0 ? [2 * displaced[0][0] - displaced[1][0], 2 * displaced[0][1] - displaced[1][1]] as [number, number] : displaced[i - 1]);
    const p1 = displaced[i];
    const p2 = isClosed ? displaced[(i + 1) % N] : displaced[Math.min(i + 1, N - 1)];
    const p3 = isClosed
      ? displaced[(i + 2) % N]
      : (i + 2 >= N ? [2 * displaced[N - 1][0] - displaced[N - 2][0], 2 * displaced[N - 1][1] - displaced[N - 2][1]] as [number, number] : displaced[i + 2]);

    const p1IsCorner = isSharpCornerAt(p0, p1, p2);
    const p2IsCorner = isSharpCornerAt(p1, p2, p3);

    // Per-segment chord and perpendicular for bowing
    const segDx = p2[0] - p1[0];
    const segDy = p2[1] - p1[1];
    const segLen = Math.hypot(segDx, segDy);
    const perpX = segLen > 0.01 ? -segDy / segLen : 0;
    const perpY = segLen > 0.01 ? segDx / segLen : 0;
    const bowSign = rBow() > 0.5 ? 1 : -1;
    const bowOffset = effectiveBow * segLen * 0.06 * bowSign;

    // Control point 1: tangent at p1. If p1 is a sharp corner, use direction
    // toward p2 (straight outward); else neighbor-averaged Catmull-Rom.
    let c1x: number, c1y: number;
    if (p1IsCorner) {
      c1x = p1[0] + ((p2[0] - p1[0]) / 3) * tangentScale;
      c1y = p1[1] + ((p2[1] - p1[1]) / 3) * tangentScale;
    } else {
      c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tangentScale;
      c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tangentScale;
    }
    // Control point 2: tangent at p2.
    let c2x: number, c2y: number;
    if (p2IsCorner) {
      c2x = p2[0] - ((p2[0] - p1[0]) / 3) * tangentScale;
      c2y = p2[1] - ((p2[1] - p1[1]) / 3) * tangentScale;
    } else {
      c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tangentScale;
      c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tangentScale;
    }
    // Bowing adds perpendicular displacement to both control points (segment
    // bends symmetrically toward the perp side).
    c1x += perpX * bowOffset;
    c1y += perpY * bowOffset;
    c2x += perpX * bowOffset;
    c2y += perpY * bowOffset;

    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  if (isClosed) d += ' Z';
  return d;
}

function renderHandFeelShape(
  ctx: ShapeContext,
  m: F3ModifiersState,
  /** Source SVG element — used to pull original stroke / fill colors. */
  sourceEl: SVGElement,
  /** SVG namespace document. */
  ownerDoc: Document,
): SVGElement[] {
  const { ROUGH, baseSeed, isClosed, buildPoints } = ctx;
  void ROUGH; // ctx.ROUGH is informational; actual roughness baked into buildPoints closure
  const ms = multiStrokeMeta(m.multiStroke);
  // SMART layer count clamp: small shapes can't fit many distinct layers
  // before they overlap into a solid blob. ~30px per supported layer.
  // Use GROUP bbox-min when provided — a child of a coherent group should
  // get the layer count the user picked even if the child itself is tiny
  // (the user reads the layers at GROUP scale, not child scale).
  // SOFT per-detail scaling: geomean of per-child and group-level bboxMin.
  // Matches the per-shape-case sizeClampBbox formula so wobble/multi-stroke
  // both honor the same "small parts of big SVG get partial scaling" rule.
  const effectiveBboxMin = ctx.bboxMinOverride && ctx.bboxMinOverride > ctx.bboxMin
    ? Math.sqrt(ctx.bboxMin * ctx.bboxMinOverride)
    : ctx.bboxMin;
  const layerCount = effectiveLayerCount(ms.layerCount, effectiveBboxMin);

  // DIAG 2026-06-07 — show why multi-stroke + sketching style aren't visibly
  // working on multi-child shapes. Remove once shading calibration ships.
  // EXTENDED 2026-06-09 — wobble character investigation. Capture per-element
  // route signals so we can compare curated audit shapes (rect/circle/line →
  // built-path route) vs uploaded rose SVG (<path> → fallback route) vs drawn
  // heart polyline (<polyline> → fallback route). Hypothesis: route divergence
  // explains wobble character difference, not wobble magnitude.
  if ((window as { __dd_diag?: boolean }).__dd_diag) {
    const diagEffW = effectiveWobble(m.wobble, effectiveBboxMin);
    const diagHasBuildPath = !!ctx.buildPath;
    const diagCanUseBuiltPath = diagHasBuildPath && m.jaggedness <= 0.05;
    const diagIsHachureFamily =
      m.fillStyle === 'hachure' || m.fillStyle === 'cross-hatch' ||
      m.fillStyle === 'zigzag' || m.fillStyle === 'dashed' ||
      m.fillStyle === 'dots' || m.fillStyle === 'zigzag-line';
    // eslint-disable-next-line no-console
    console.log('[dd-diag] renderHandFeelShape', {
      tag: sourceEl.tagName.toLowerCase(),
      isClosed: ctx.isClosed,
      bboxMin: Number(ctx.bboxMin.toFixed(1)),
      effectiveBboxMin: Number(effectiveBboxMin.toFixed(1)),
      userWobble: m.wobble,
      effW: Number(diagEffW.toFixed(3)),
      ROUGH: Number(ctx.ROUGH.toFixed(3)),
      jaggedness: m.jaggedness,
      hasBuildPath: diagHasBuildPath,
      canUseBuiltPath: diagCanUseBuiltPath,
      route: diagCanUseBuiltPath ? 'built-path' : 'points-fallback',
      sketchingStyle: m.sketchingStyle,
      fillStyle: m.fillStyle,
      isHachureFamily: diagIsHachureFamily,
      multiStrokeUserPicked: m.multiStroke,
      multiStrokeMetaLayers: ms.layerCount,
      effectiveLayerCount: layerCount,
      hasPivotOverride: !!ctx.pivotOverride,
    });
  }
  const seeds = seedOffsets(baseSeed, layerCount);
  const usePenTip = m.penTip !== 'plain';
  const endpointBehavior = m.endpointBehavior;
  const sketchingStyle = m.sketchingStyle;

  // Resolve source colors → palette-mapped colors. Preserves color-mix
  // transparency wrappers.
  const sourceStroke = sourceEl.getAttribute('stroke');
  const sourceFill = sourceEl.getAttribute('fill');
  const strokeColor = mapPaletteColor(sourceStroke ?? undefined, m.strokePalette, true)
    ?? 'var(--dir-text-primary)';
  const fillColor = (() => {
    if (!sourceFill || sourceFill === 'none' || sourceFill === 'transparent') return undefined;
    return mapPaletteColor(sourceFill, m.fillPalette);
  })();

  // For pen-tip mode the polygon fill color = strokeColor (perfect-freehand
  // outputs a filled polygon outline; the "stroke" IS the fill).
  const penTipColor = strokeColor;

  // Build a base layer to determine the centroid (used as the cross-hatch /
  // parallel-pass pivot). If a group-level pivot was passed in (ctx.pivotOverride),
  // use that instead — keeps multi-child group shapes (stackedSketchbooks etc.)
  // scaling/rotating around the GROUP's center, not each child's center.
  const layer0Points = buildPoints(seeds[0], { endpointBehavior, sketchingStyle, layerIndex: 0 });
  const childCentroid = centroidOf(layer0Points);
  const cxCentroid = ctx.pivotOverride?.cx ?? childCentroid.cx;
  const cyCentroid = ctx.pivotOverride?.cy ?? childCentroid.cy;

  const out: SVGElement[] = [];

  const isHachureFamily =
    m.fillStyle === 'hachure' || m.fillStyle === 'cross-hatch' ||
    m.fillStyle === 'dots' || m.fillStyle === 'zigzag' ||
    m.fillStyle === 'dashed' || m.fillStyle === 'zigzag-line';

  // For closed shapes: paper-color background fill BUT only when fill style
  // is 'solid' or 'none' (source has fill). When fillStyle is hachure-family,
  // skip the basePath — the user picked hachure because they want a PATTERN,
  // not a solid wash UNDER the pattern. The hachure layer renders alone.
  if (isClosed && fillColor && !isHachureFamily) {
    const basePath = ownerDoc.createElementNS('http://www.w3.org/2000/svg', 'path');
    // Jaggedness applies to the fill boundary too — solid-filled shapes
    // (lacroixRack, decorative pegboard items rendered with fill={STROKE})
    // otherwise stay perfectly smooth at any jaggedness value. Use layer 0's
    // seed so the fill boundary matches the outline character.
    const basePts = m.jaggedness > 0.05
      ? injectJaggedness(layer0Points, m.jaggedness, baseSeed)
      : layer0Points;
    basePath.setAttribute('d', pointsToPolylinePath(basePts, true));
    basePath.setAttribute('fill', fillColor);
    basePath.setAttribute('stroke', 'none');
    basePath.setAttribute('fill-opacity', String(m.fillOpacity));
    out.push(basePath);
  }

  // SHADING — fillStyle = the SHADING TECHNIQUE (hachure/cross-hatch/dots/etc).
  // The technique REPLACES each filled area's solid tone with a pattern at
  // density matching the source's darkness:
  //   - Dark fills (opaque primary ink) → DENSE hachure (the area was "darkly shaded")
  //   - Light fills (8% wash) → SPARSE hachure (the area was "lightly shaded")
  //   - White / bg / transparent → no hachure (the area was unshaded white)
  // This is how an artist replaces tonal regions with pen-shading techniques.
  //
  // Density scales by source darkness × user's Fill density slider × per-shape
  // size damping. Hachure gap also scales — denser source = tighter gap.
  if (isClosed && isHachureFamily && fillColor) {
    const darkness = fillDarknessFactor(sourceFill ?? undefined);
    // PARKED 2026-06-03: the 3-band skip/sparse/full approach + the "fix the fix"
    // raised gap floor + lowered fillWeight cap both broke things differently.
    // Reverted to Phase 1A baseline pending the Smart Hachure System redesign
    // (Task #22 — classification-based system per user direction). Phase 1A
    // baseline = visible everywhere darkness ≥ 0.05, 1.5 px gap floor,
    // fillWeight ≤ gap × 0.7 cap.
    if (darkness < 0.05) {
      // Near-zero / transparent / BG → no hachure
    } else {
      const hachureColor = mapPaletteColor(sourceStroke ?? undefined, m.fillPalette) ?? strokeColor;
      // SHADING math — F3-shading-calibration-spec §4 (Phase 1A baseline).
      // PRIMARY axis = gap (1/darkness). SECONDARY = weight (0.5-floored).
      // sizeMul bounded [1, 2] so tiny shapes don't blow gap to invisible.
      const sizeMul = Math.max(1.0, Math.min(2.0, 80 / Math.max(40, ctx.bboxMin)));
      // Per-fillStyle darkness clamp floor per §4.4: zigzag 0.2, dots 0.15,
      // hachure / cross-hatch / dashed / zigzag-line 0.1.
      const darknessFloor =
        m.fillStyle === 'zigzag' ? 0.2 :
        m.fillStyle === 'dots'   ? 0.15 :
                                   0.1;
      const clampedDarkness = Math.max(darknessFloor, Math.min(1.0, darkness));
      let adaptedGap = m.hachureGap * sizeMul * (1 / clampedDarkness);
      // Floor at 1.5 px — below this, lines optically merge into solid block
      // (Craftsy "fine crosshatching" optical-blend threshold, §1.2).
      adaptedGap = Math.max(1.5, adaptedGap);

      // FILL WEIGHT: secondary axis. Floor 0.5 so light-source fills don't
      // vanish into hairlines (§4.4.1). dots uses ×1.5 multiplier instead
      // of ×2 (filled circles render visually heavier per same weight, §4.4.3).
      const sizeDamp = Math.max(0.4, Math.min(1.0, ctx.bboxMin / 100));
      const weightMul = m.fillStyle === 'dots' ? 1.5 : 2;
      let adaptedFillWeight = m.fillDensity * weightMul * sizeDamp * Math.max(0.5, 0.5 + darkness * 0.5);
      // Cap weight at 70 % of gap so lines never overlap into solid.
      adaptedFillWeight = Math.min(adaptedFillWeight, adaptedGap * 0.7);

      const dPath = pointsToPolylinePath(layer0Points, true);
      const fillOpts: RoughOptions = {
        seed: baseSeed,
        stroke: 'none',
        fill: hachureColor,
        fillStyle: m.fillStyle as RoughOptions['fillStyle'],
        hachureGap: adaptedGap,
        hachureAngle: m.hachureAngle,
        fillWeight: adaptedFillWeight,
        roughness: 0,
      };
      // dotScatter → seeded dots-fill jitter (patchRoughDots.ts). Custom key
      // rough.js's shallow option-merge (_o = Object.assign) preserves down to
      // the patched DotFiller.dotsOnLines. Only attached for fillStyle='dots'.
      // Deterministic: scales the seeded jitter range, not the randomizer.
      if (m.fillStyle === 'dots') {
        (fillOpts as { dotScatter?: number }).dotScatter = m.dotScatter;
      }
      let hachureG = ctx.rc.path(dPath, fillOpts);
      // PERF BACKSTOP (mirror of renderRegion.ts U3 cap): a tiny gap on a huge
      // region can make rough.js emit a multi-MB <path> that freezes the tab.
      // The default render goes through the smart pipeline (already capped); this
      // guards the legacy ?smartHachure=0 fallback the same way. Gap-dependent
      // grammars only (solid is one bounded outline). ≤4 raises, coverage
      // saturates, never hangs.
      if (hachureG && m.fillStyle !== 'solid') {
        const MAX_PATH_CHARS = 300000;
        const dLen = (g: SVGElement) =>
          [...g.querySelectorAll('path')].reduce(
            (mx, p) => Math.max(mx, (p.getAttribute('d') ?? '').length),
            0,
          );
        let len = dLen(hachureG);
        let tries = 0;
        while (len > MAX_PATH_CHARS && tries < 4) {
          tries++;
          adaptedGap *= Math.max(1.6, Math.sqrt(len / MAX_PATH_CHARS));
          const regen = ctx.rc.path(dPath, { ...fillOpts, hachureGap: adaptedGap });
          if (!regen) break;
          hachureG.remove();
          hachureG = regen;
          len = dLen(hachureG);
        }
      }
      if (hachureG) {
        hachureG.setAttribute('data-f3-hachure', 'shading');
        // Hachure opacity scales with fillOpacity slider AND with darkness
        // so light areas don't accidentally render denser than intended.
        hachureG.setAttribute('opacity', String(m.fillOpacity));
        out.push(hachureG);
      }
    }
  }

  for (let i = 0; i < layerCount; i++) {
    const seed = seeds[i];
    const mods: ShapeModifiers = { endpointBehavior, sketchingStyle, layerIndex: i };

    // CHANGED 2026-06-08: for cross-hatch + parallel-pass on closed shapes,
    // apply the rotation/scale as an SVG transform attribute on the rendered
    // path (NOT by mutating points before pointsToPolylinePath). Why: mutating
    // points then re-wrapping in pointsToPolylinePath added wobble ON TOP of
    // already-jittered points → secondary layers looked visibly noisier than
    // the base layer. With SVG transforms, all layers use the SAME clean
    // built path (just rotated/scaled at the SVG level) → uniform line
    // character across all layers, only the position differs.
    const useSvgTransformForLayer =
      i > 0 &&
      (sketchingStyle === 'cross-rotate' ||
        (sketchingStyle === 'parallel-pass' && isClosed));

    let pts = buildPoints(seed, mods);
    if (!useSvgTransformForLayer) {
      // Only mutate points for non-SVG-transform paths (loose-overlap,
      // single-pass, open-path parallel-pass via offsetLinePerpendicular).
      pts = applyLayerTransform(pts, sketchingStyle, i, cxCentroid, cyCentroid, isClosed);
    }

    // Compute per-layer transform. Includes:
    //   - cross-hatch: rotate around centroid (was point-mutation)
    //   - parallel-pass closed: scale around centroid (was point-mutation)
    //   - loose-overlap: visible drift translate
    //   - single-pass: stable micro-nudge
    let layerTransform = '';
    if (i > 0) {
      if (sketchingStyle === 'cross-rotate') {
        const angle = crossHatchRotationFor(i);
        if (angle !== 0) {
          layerTransform = `rotate(${angle} ${cxCentroid.toFixed(2)} ${cyCentroid.toFixed(2)})`;
        }
      } else if (sketchingStyle === 'parallel-pass' && isClosed) {
        const s = parallelPassScaleFor(i);
        if (s !== 1) {
          // SVG scale(s) around (cx, cy): translate(cx, cy) scale(s) translate(-cx, -cy)
          const tx = (cxCentroid * (1 - s)).toFixed(2);
          const ty = (cyCentroid * (1 - s)).toFixed(2);
          layerTransform = `translate(${tx} ${ty}) scale(${s.toFixed(3)})`;
        }
      } else if (sketchingStyle === 'loose-overlap') {
        const t = looseOverlapTranslate(i);
        if (t.dx || t.dy) layerTransform = `translate(${t.dx} ${t.dy})`;
      } else if (sketchingStyle === 'single-pass') {
        const n = stableLayerNudge(i, m.strokeWidth);
        layerTransform = `translate(${n.dx.toFixed(2)} ${n.dy.toFixed(2)})`;
      }
    }

    if (usePenTip) {
      // Pen-tip mode = "re-ink the SAME line plain mode would draw, with a
      // different tip" — NOT "bypass the line-feel toggles." Build the plain-
      // mode d first (wobble / bowing / curveDamp / jaggedness / endpoint all
      // live inside the path builders), then resample points along that built
      // path and feed THOSE to perfect-freehand. Before 2026-06-11 this branch
      // fed the raw clean anchors, so every line-feel slider was silently dead
      // on every tip except plain (Sebs caught it on /desk).
      const needsPerVertexTransformPT =
        i > 0 && sketchingStyle === 'parallel-pass' && !isClosed
        && !ctx.handlesPerVertexLayer;
      const canUseBuiltPathPT =
        ctx.buildPath !== undefined
        && !needsPerVertexTransformPT
        && m.jaggedness <= 0.05;
      let lineD: string;
      if (canUseBuiltPathPT) {
        lineD = ctx.buildPath!(seed, mods);
      } else {
        const wobbleForCurves = effectiveWobble(m.wobble, effectiveBboxMin);
        const jaggedPts = m.jaggedness > 0.05
          ? injectJaggedness(pts, m.jaggedness, seed)
          : pts;
        lineD = pointsToPolylinePath(jaggedPts, isClosed, m.bowing, m.curveDamp, seed, wobbleForCurves);
      }
      const inkPts = samplePathForPenTip(lineD, sourceEl, ownerDoc) ?? pts;
      const d = penTipPath(inkPts, m.penTip, m.strokeWidth, seed, ctx.bboxMin);
      if (!d) continue;
      const path = ownerDoc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', penTipColor);
      path.setAttribute('stroke', 'none');
      // Pen-tip ink is a FILLED polygon by construction (perfect-freehand).
      // Tag it so smartHachure's outline filter — which strips real fills to
      // stop base-fill shapes painting over hachure — keeps the ink. Without
      // this tag every stroke vanishes when penTip ≠ plain (2026-06-11 bug).
      path.setAttribute('data-pen-tip-ink', '1');
      if (layerTransform) path.setAttribute('transform', layerTransform);
      out.push(path);
    } else {
      // Plain mode. If ctx.buildPath is provided AND we don't need per-vertex
      // transforms (cross-hatch / parallel-pass), use the playground-native
      // path-builder directly. That matches the playground rendering EXACTLY:
      // 4 long cubic-Bezier segments per rect (vs our 32 short Q-bezier
      // segments), control points jittered at j()*1.4 amplitude. Result: wobble
      // produces the same visual wandering as playground at matched values.
      // BUG FIX 2026-06-08 (refinement): now that cross-hatch / parallel-pass
      // (closed) apply via SVG transform attribute instead of per-vertex
      // mutation, ALL layers can use the playground-native built path.
      // Only open-path parallel-pass (offsetLinePerpendicular) still needs
      // the per-vertex transform fallback for now.
      const needsPerVertexTransform =
        i > 0 && sketchingStyle === 'parallel-pass' && !isClosed
        && !ctx.handlesPerVertexLayer;
      // When jaggedness > 0, force the points-pipeline route so rect/circle/
      // ellipse/line shapes get zig-zag injection too (the buildPath fast-path
      // bypasses injectJaggedness). Trade: gives up the playground-matched
      // cubic-bezier accuracy on those shape types, but only when user has
      // explicitly dialed jaggedness above default.
      const canUseBuiltPath =
        ctx.buildPath !== undefined
        && !needsPerVertexTransform
        && m.jaggedness <= 0.05;
      let d: string;
      if (canUseBuiltPath) {
        d = ctx.buildPath!(seed, mods);
      } else {
        // Fallback for cross-hatch / parallel-pass (need per-vertex transforms)
        // or shapes without a playground-native builder (polygon/polyline).
        // Use the GROUP-scaled bbox (see effectiveBboxMin block above) so
        // multi-child SVGs don't silently floor wobble per tiny child.
        // WOBBLE: how far points wander. Untouched by jaggedness (Sebs:
        // "jaggedness shouldn't reduce wobble amplitude").
        const wobbleForCurves = effectiveWobble(m.wobble, effectiveBboxMin);
        // JAGGEDNESS: sharpness of connections between wandering points.
        //   - jagged 0 → smooth flowing bezier curves between points
        //   - jagged 2 → sharp zig-zag character (extra alternating-perp
        //     intermediate points injected between consecutive samples)
        // Independent of wobble; same point-cloud, different connection style.
        const jaggedPts = m.jaggedness > 0.05
          ? injectJaggedness(pts, m.jaggedness, seed)
          : pts;
        d = pointsToPolylinePath(jaggedPts, isClosed, m.bowing, m.curveDamp, seed, wobbleForCurves);
      }
      const path = ownerDoc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('data-f3-hand-feel', 'outline');
      // Match playground convention: layer 0 = 1.25× (primary stroke),
      // all other layers = 1.0× (ghost outlines). Verified against
      // `Homepage Surfaces v2 Lab/.../C3UserFlow.tsx:333` and `handFeel.ts`.
      const widthMul = i === 0 ? 1.25 : 1.0;
      path.setAttribute('stroke-width', String(m.strokeWidth * widthMul));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      // Preserve stroke-dasharray from source element (2026-06-09): dashed
      // <line>/<path>/<polyline> sources (ticket dividers, lanyard dashes,
      // flyer rules) need their dash pattern carried through the jitter
      // pipeline. The underlying path stays continuous; SVG's native
      // stroke-dasharray renders the dashes on the jittered stroke.
      const sourceDash = sourceEl.getAttribute('stroke-dasharray');
      if (sourceDash && sourceDash !== 'none') {
        path.setAttribute('stroke-dasharray', sourceDash);
      }
      if (layerTransform) path.setAttribute('transform', layerTransform);
      out.push(path);
    }
  }

  return out;
}


// ─── ELEMENT DISPATCH ──────────────────────────────────────────────────────

/** Compute the bounding box of a <g> element by unioning its primitive
 *  children's bboxes. Used to derive a group-shared pivot for cross-hatch /
 *  parallel-pass layer transforms (so a group's children rotate/scale around
 *  the group's center, not each child's own centroid).
 *
 *  Handles rect / circle / ellipse / line / polygon / polyline / nested <g>.
 *  For <path> and unsupported elements, falls back to SVG getBBox() if
 *  available (DOM-connected); otherwise skipped. Returns null if no
 *  computable children. */
function computeGroupBBox(
  g: SVGElement,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (parent: SVGElement) => {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof SVGElement)) continue;
      const tag = child.tagName.toLowerCase();
      let bx = 0, by = 0, bw = 0, bh = 0, ok = false;
      switch (tag) {
        case 'rect': {
          bx = parseFloat(child.getAttribute('x') ?? '0');
          by = parseFloat(child.getAttribute('y') ?? '0');
          bw = parseFloat(child.getAttribute('width') ?? '0');
          bh = parseFloat(child.getAttribute('height') ?? '0');
          ok = bw > 0 && bh > 0;
          break;
        }
        case 'circle': {
          const cx = parseFloat(child.getAttribute('cx') ?? '0');
          const cy = parseFloat(child.getAttribute('cy') ?? '0');
          const r = parseFloat(child.getAttribute('r') ?? '0');
          bx = cx - r; by = cy - r; bw = 2 * r; bh = 2 * r;
          ok = r > 0;
          break;
        }
        case 'ellipse': {
          const cx = parseFloat(child.getAttribute('cx') ?? '0');
          const cy = parseFloat(child.getAttribute('cy') ?? '0');
          const rx = parseFloat(child.getAttribute('rx') ?? '0');
          const ry = parseFloat(child.getAttribute('ry') ?? '0');
          bx = cx - rx; by = cy - ry; bw = 2 * rx; bh = 2 * ry;
          ok = rx > 0 && ry > 0;
          break;
        }
        case 'line': {
          const x1 = parseFloat(child.getAttribute('x1') ?? '0');
          const y1 = parseFloat(child.getAttribute('y1') ?? '0');
          const x2 = parseFloat(child.getAttribute('x2') ?? '0');
          const y2 = parseFloat(child.getAttribute('y2') ?? '0');
          bx = Math.min(x1, x2); by = Math.min(y1, y2);
          bw = Math.abs(x2 - x1); bh = Math.abs(y2 - y1);
          ok = true;
          break;
        }
        case 'polygon':
        case 'polyline': {
          const ptsAttr = child.getAttribute('points') ?? '';
          const nums = ptsAttr.split(/[\s,]+/).map(parseFloat).filter((n) => !Number.isNaN(n));
          if (nums.length >= 4) {
            let px1 = Infinity, py1 = Infinity, px2 = -Infinity, py2 = -Infinity;
            for (let i = 0; i + 1 < nums.length; i += 2) {
              px1 = Math.min(px1, nums[i]); py1 = Math.min(py1, nums[i + 1]);
              px2 = Math.max(px2, nums[i]); py2 = Math.max(py2, nums[i + 1]);
            }
            bx = px1; by = py1; bw = px2 - px1; bh = py2 - py1;
            ok = true;
          }
          break;
        }
        case 'g':
          walk(child);
          continue;
        default:
          // path / text / etc — try DOM getBBox if connected, else skip
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const b = (child as any).getBBox?.();
            if (b && b.width > 0 && b.height > 0) {
              bx = b.x; by = b.y; bw = b.width; bh = b.height;
              ok = true;
            }
          } catch { /* not connected to DOM yet — skip */ }
          break;
      }
      if (ok) {
        minX = Math.min(minX, bx);
        minY = Math.min(minY, by);
        maxX = Math.max(maxX, bx + bw);
        maxY = Math.max(maxY, by + bh);
      }
    }
  };
  walk(g);
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function transformElement(
  el: SVGElement,
  rc: ReturnType<typeof rough.svg>,
  m: F3ModifiersState,
  seed: number,
  ownerDoc: Document,
  /** Optional group-level pivot for cross-hatch / parallel-pass. */
  groupPivot?: { cx: number; cy: number },
  /** Optional group-level bbox-min for the size-aware clamps
   *  (effectiveLayerCount etc.) so children of a coherent group don't get
   *  multi-stroke silently downgraded just because the individual child is tiny. */
  groupBBoxMin?: number,
): SVGElement[] {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'rect': {
      const x = parseFloat(el.getAttribute('x') ?? '0');
      const y = parseFloat(el.getAttribute('y') ?? '0');
      const w = parseFloat(el.getAttribute('width') ?? '0');
      const h = parseFloat(el.getAttribute('height') ?? '0');
      const bboxMin = Math.min(w, h);
      const pScale = protrudeScaleForBbox(bboxMin);
      // GROUP-AWARE bbox-min for size clamps — same fix pattern as
      // effectiveLayerCount (commit 5b54e61) but never applied to wobble.
      // Without this, multi-child SVGs (stackedSketchbooks etc.) silently
      // ceiling user wobble at ~0.3 because per-book bbox is 14-18px while
      // the user picks against the whole 80px SVG.
      // SOFT per-detail scaling (placeholder for the smart-layer build) —
      // geometric mean of per-child bbox and group bbox so decorative tiny
      // children (pencil-tip polygons, sombrero band ellipses) don't get
      // FULL group-scale wobble and shred, but multi-child coherent groups
      // (stackedSketchbooks, jar walls) still lift past per-child clamp.
      // Real fix = smart-layer classifier per element role; this is the
      // intermediate compromise that handles 95% without per-role labels.
      const sizeClampBbox = groupBBoxMin && groupBBoxMin > bboxMin
        ? Math.sqrt(bboxMin * groupBBoxMin)
        : bboxMin;
      // I-11: wobble is THE master jitter multiplier on HAND_FEEL_BASE (mirrors
      // playground). Size-aware clamp via effectiveWobble at GROUP scale.
      const ROUGH = HAND_FEEL_BASE.rect * effectiveWobble(m.wobble, sizeClampBbox);
      return renderHandFeelShape({
        ROUGH,
        baseSeed: seed,
        isClosed: true,
        bboxMin,
        rc,
        buildPoints: (s, mods) => roughRectPoints(x, y, w, h, ROUGH, s, mods, pScale),
        // Playground-native cubic-Bezier path + bowing/curve extension so all
        // three axes (wobble, bowing, curveDamp) compose at render time.
        buildPath: (s, mods) => roughRectPathExtended(x, y, w, h, ROUGH, m.bowing, m.curveDamp, s, mods),
        pivotOverride: groupPivot,
        bboxMinOverride: groupBBoxMin,
      }, m, el, ownerDoc);
    }
    case 'circle': {
      const cx = parseFloat(el.getAttribute('cx') ?? '0');
      const cy = parseFloat(el.getAttribute('cy') ?? '0');
      const r = parseFloat(el.getAttribute('r') ?? '0');
      const x = cx - r;
      const y = cy - r;
      const w = r * 2;
      const h = r * 2;
      const bboxMin = Math.min(w, h);
      const pScale = protrudeScaleForBbox(bboxMin);
      // SOFT per-detail scaling (placeholder for the smart-layer build) —
      // geometric mean of per-child bbox and group bbox so decorative tiny
      // children (pencil-tip polygons, sombrero band ellipses) don't get
      // FULL group-scale wobble and shred, but multi-child coherent groups
      // (stackedSketchbooks, jar walls) still lift past per-child clamp.
      // Real fix = smart-layer classifier per element role; this is the
      // intermediate compromise that handles 95% without per-role labels.
      const sizeClampBbox = groupBBoxMin && groupBBoxMin > bboxMin
        ? Math.sqrt(bboxMin * groupBBoxMin)
        : bboxMin;
      // I-11: wobble master, size-clamped at GROUP scale (see rect case)
      const ROUGH = HAND_FEEL_BASE.oval * effectiveWobble(m.wobble, sizeClampBbox);
      return renderHandFeelShape({
        ROUGH,
        baseSeed: seed,
        isClosed: true,
        bboxMin,
        rc,
        buildPoints: (s, mods) => roughOvalPoints(x, y, w, h, ROUGH, s, mods, pScale),
        // Playground-native cubic-Bezier oval + bowing/curve extension
        buildPath: (s, mods) => roughOvalPathExtended(x, y, w, h, ROUGH, m.bowing, m.curveDamp, s, mods),
        pivotOverride: groupPivot,
        bboxMinOverride: groupBBoxMin,
      }, m, el, ownerDoc);
    }
    case 'ellipse': {
      const cx = parseFloat(el.getAttribute('cx') ?? '0');
      const cy = parseFloat(el.getAttribute('cy') ?? '0');
      const rx = parseFloat(el.getAttribute('rx') ?? '0');
      const ry = parseFloat(el.getAttribute('ry') ?? '0');
      const x = cx - rx;
      const y = cy - ry;
      const w = rx * 2;
      const h = ry * 2;
      const bboxMin = Math.min(w, h);
      const pScale = protrudeScaleForBbox(bboxMin);
      // SOFT per-detail scaling (placeholder for the smart-layer build) —
      // geometric mean of per-child bbox and group bbox so decorative tiny
      // children (pencil-tip polygons, sombrero band ellipses) don't get
      // FULL group-scale wobble and shred, but multi-child coherent groups
      // (stackedSketchbooks, jar walls) still lift past per-child clamp.
      // Real fix = smart-layer classifier per element role; this is the
      // intermediate compromise that handles 95% without per-role labels.
      const sizeClampBbox = groupBBoxMin && groupBBoxMin > bboxMin
        ? Math.sqrt(bboxMin * groupBBoxMin)
        : bboxMin;
      // I-11: wobble master, size-clamped at GROUP scale (see rect case)
      const ROUGH = HAND_FEEL_BASE.oval * effectiveWobble(m.wobble, sizeClampBbox);
      return renderHandFeelShape({
        ROUGH,
        baseSeed: seed,
        isClosed: true,
        bboxMin,
        rc,
        buildPoints: (s, mods) => roughOvalPoints(x, y, w, h, ROUGH, s, mods, pScale),
        // Playground-native cubic-Bezier oval + bowing/curve extension
        buildPath: (s, mods) => roughOvalPathExtended(x, y, w, h, ROUGH, m.bowing, m.curveDamp, s, mods),
        pivotOverride: groupPivot,
        bboxMinOverride: groupBBoxMin,
      }, m, el, ownerDoc);
    }
    case 'line': {
      const x1 = parseFloat(el.getAttribute('x1') ?? '0');
      const y1 = parseFloat(el.getAttribute('y1') ?? '0');
      const x2 = parseFloat(el.getAttribute('x2') ?? '0');
      const y2 = parseFloat(el.getAttribute('y2') ?? '0');
      const lineLen = Math.hypot(x2 - x1, y2 - y1);
      const pScale = protrudeScaleForBbox(lineLen);
      // SOFT per-detail scaling (see rect case for rationale).
      const sizeClampBbox = groupBBoxMin && groupBBoxMin > lineLen
        ? Math.sqrt(lineLen * groupBBoxMin)
        : lineLen;
      // I-11: wobble master, size-clamped at GROUP scale (see rect case)
      const ROUGH = HAND_FEEL_BASE.line * effectiveWobble(m.wobble, sizeClampBbox);
      return renderHandFeelShape({
        ROUGH,
        baseSeed: seed,
        isClosed: false,
        bboxMin: lineLen,
        rc,
        buildPoints: (s, mods) => roughLinePoints(x1, y1, x2, y2, ROUGH, s, mods, pScale),
        // Playground-native cubic-Bezier line + bowing/curve extension
        buildPath: (s, mods) => roughLinePathExtended(x1, y1, x2, y2, ROUGH, m.bowing, m.curveDamp, s, mods),
        pivotOverride: groupPivot,
        bboxMinOverride: groupBBoxMin,
      }, m, el, ownerDoc);
    }
    case 'polygon':
    case 'polyline': {
      const pointsStr = (el.getAttribute('points') ?? '').trim();
      if (!pointsStr) return [];
      const nums = pointsStr.split(/[\s,]+/).map(parseFloat);
      const pairs: Array<[number, number]> = [];
      for (let i = 0; i < nums.length - 1; i += 2) pairs.push([nums[i], nums[i + 1]]);
      if (pairs.length < 2) return [];
      const closed = tag === 'polygon';
      // Compute bbox from polygon vertices
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [px, py] of pairs) {
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
      const bboxMin = Math.min(maxX - minX, maxY - minY) || 80;
      const pScale = protrudeScaleForBbox(bboxMin);
      // SOFT per-detail scaling (placeholder for the smart-layer build) —
      // geometric mean of per-child bbox and group bbox so decorative tiny
      // children (pencil-tip polygons, sombrero band ellipses) don't get
      // FULL group-scale wobble and shred, but multi-child coherent groups
      // (stackedSketchbooks, jar walls) still lift past per-child clamp.
      // Real fix = smart-layer classifier per element role; this is the
      // intermediate compromise that handles 95% without per-role labels.
      const sizeClampBbox = groupBBoxMin && groupBBoxMin > bboxMin
        ? Math.sqrt(bboxMin * groupBBoxMin)
        : bboxMin;
      // I-11: wobble master, size-clamped at GROUP scale (see rect case)
      const effW = effectiveWobble(m.wobble, sizeClampBbox);
      const ROUGH = HAND_FEEL_BASE.rect * effW;
      const ROUGH_LINE = HAND_FEEL_BASE.line * effW;
      if ((window as { __dd_diag?: boolean }).__dd_diag) {
        // eslint-disable-next-line no-console
        console.log('[dd-diag] case polyline', {
          tag,
          vertexCount: pairs.length,
          isClosed: closed,
          bboxMin: Number(bboxMin.toFixed(1)),
          sizeClampBbox: Number(sizeClampBbox.toFixed(1)),
          effW: Number(effW.toFixed(3)),
          ROUGH: Number(ROUGH.toFixed(3)),
        });
      }
      return renderHandFeelShape({
        ROUGH,
        baseSeed: seed,
        isClosed: closed,
        bboxMin,
        rc,
        buildPoints: (s, mods) => {
          if (closed) return roughPolygonPoints(pairs, ROUGH, s, mods, pScale);
          const segPoints: Array<[number, number]> = [];
          for (let i = 0; i < pairs.length - 1; i++) {
            const [ax, ay] = pairs[i];
            const [bx, by] = pairs[i + 1];
            const segSeed = s + i * 17;
            const segPts = roughLinePoints(ax, ay, bx, by, ROUGH_LINE, segSeed, mods, pScale);
            if (i > 0) segPts.shift();
            segPoints.push(...segPts);
          }
          return segPoints;
        },
        pivotOverride: groupPivot,
        bboxMinOverride: groupBBoxMin,
      }, m, el, ownerDoc);
    }
    case 'path': {
      const d = el.getAttribute('d');
      if (!d) return [];

      // I-12: route <path> content through the same points-based pipeline as
      // shape primitives so endpointBehavior + sketchingStyle + wobble + bowing
      // + curveDamp all apply uniformly. Previously paths went directly to
      // rough.js with `endpointBowingNudge`, which silently broke endpoint kink
      // + sketchingStyle compounds on Trophy Wall pin content (regressions B.2
      // + B.4 from 19-research-cross-axis-interconnection.md).
      //
      // Sampling strategy: use browser SVG path API (getTotalLength +
      // getPointAtLength) to convert arbitrary path data to a polyline. Then
      // route through renderHandFeelShape's buildPoints, where jitter applies
      // per-point (same as roughLinePoints does for line primitives).

      // Build hidden helper path for length sampling
      const tmpPath = ownerDoc.createElementNS('http://www.w3.org/2000/svg', 'path');
      tmpPath.setAttribute('d', d);
      // tmpPath needs to be in a doc subtree for getTotalLength to work — append
      // to the parent SVG so it inherits coord system, then remove after sample
      const parentSvg = el.ownerSVGElement;
      if (!parentSvg) {
        // Can't sample — fall back to clean clone
        return [el.cloneNode(true) as SVGElement];
      }
      parentSvg.appendChild(tmpPath);
      let totalLen = 0;
      try { totalLen = tmpPath.getTotalLength(); } catch { /* invalid path */ }
      if (totalLen === 0) {
        parentSvg.removeChild(tmpPath);
        return [el.cloneNode(true) as SVGElement];
      }

      // Detect closed path (whole-string ends with Z/z)
      const pathEndsWithZ = /[zZ]\s*$/.test(d.trim());

      // STRAIGHT-LINE FAST PATH: pure-line paths (M/L/H/V/Z only) walk the
      // d-string and extract corners exactly. Curve paths use length-based
      // sampler.
      //
      // SUB-PATH SPLIT (2026-06-09): the corner walker previously concatenated
      // every M-sub-path into ONE cleanPoints array. For auto-traced rose
      // (112 sub-paths via 112 M commands), bezier-smoothing then drew long
      // curves from end-of-sub-path-N to start-of-sub-path-N+1 — the visible
      // diagonal lines crossing the rose. Audit shapes never trigger this
      // (≤1 sub-path each). Fix: break on every M, render each sub-path as
      // its own renderHandFeelShape call.
      //
      // RDP INPUT NORMALIZATION (2026-06-09): drawn freehand and uploaded
      // auto-traced SVGs come in DENSE (heart ≈80 verts / 502px, rose sub-path
      // ≈25 verts / 200px). The wobble pipeline was calibrated against audit
      // shapes which are SPARSE (2-6 verts per path). Dense input through the
      // same wobble produces braid character (wavelength ≈ vertex spacing).
      // RDP at ε=1.5px drops dense input to audit-compatible density WITHOUT
      // losing curve shape, then the same wobble produces the same flowing
      // character. Sparse input (audit) is a no-op for RDP — every vertex
      // exceeds the threshold by default, gated by RDP_VERTEX_THRESHOLD below.
      //
      // EPSILON 1.5 → 3.0 (2026-06-09 follow-up): heart curves at ε=1.5 still
      // produced ~30-40 anchors → braid. Bumped to 3.0 → ~15-20 anchors →
      // flowing. Audit untouched (gated by vertex-count threshold, not ε).
      //
      // SIMPLIFY SLIDER (2026-06-11, doc 22): RDP_EPSILON is now the CANONICAL
      // epsilon (renderer-identity anchor). The user's Simplify slider maps to
      // a render-time epsilon via ε(s) = 3.0 × 4^(s−1) — s = 1.0 ⇒ ε = 3.0
      // exactly (pixel-identical to the pre-slider build). The canonical ε
      // decides WHICH renderer fires (polygonal vs curve, doc 22 §4.5 dispatch
      // freeze) so the slider only changes detail level WITHIN a stable
      // renderer; it never flips renderer identity.
      const RDP_EPSILON = 3.0;
      const epsForSimplify = 3.0 * Math.pow(4, m.simplification - 1);
      type SubPath = { points: Array<[number, number]>; isClosed: boolean };
      const hasCurves = /[CcQqSsTtAa]/.test(d);
      const subPaths: SubPath[] = [];

      if (!hasCurves) {
        const tokens = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
        let cx = 0, cy = 0, cmd = '';
        let current: Array<[number, number]> = [];
        let currentClosed = false;
        const flush = () => {
          if (current.length >= 2) subPaths.push({ points: current, isClosed: currentClosed });
          current = [];
          currentClosed = false;
        };
        for (let i = 0; i < tokens.length; i++) {
          const tok = tokens[i];
          if (/[A-Za-z]/.test(tok)) {
            if (tok === 'Z' || tok === 'z') {
              currentClosed = true;
              flush();
              cmd = '';
            } else {
              cmd = tok;
            }
            continue;
          }
          const num = parseFloat(tok);
          switch (cmd) {
            case 'M': flush(); cx = num; cy = parseFloat(tokens[++i]); current.push([cx, cy]); cmd = 'L'; break;
            case 'm': flush(); cx += num; cy += parseFloat(tokens[++i]); current.push([cx, cy]); cmd = 'l'; break;
            case 'L': cx = num; cy = parseFloat(tokens[++i]); current.push([cx, cy]); break;
            case 'l': cx += num; cy += parseFloat(tokens[++i]); current.push([cx, cy]); break;
            case 'H': cx = num; current.push([cx, cy]); break;
            case 'h': cx += num; current.push([cx, cy]); break;
            case 'V': cy = num; current.push([cx, cy]); break;
            case 'v': cy += num; current.push([cx, cy]); break;
            default: break;
          }
        }
        // Final flush — open sub-path with no trailing Z
        if (current.length >= 2) subPaths.push({ points: current, isClosed: false });
      }

      // CURVE COMPOUND SUB-PATH SPLIT (2026-06-16, Sebs caught it on the donut
      // outline): a curved COMPOUND path (donut = 2 arc sub-paths, icons with
      // holes) sampled as ONE continuous getPointAtLength walk bridges the M-jump
      // between sub-paths into a straight CHORD across the form. The straight-line
      // walker above already splits; the curve sampler did not. Split by M and
      // sample EACH sub-path on its own helper path so no chord crosses the
      // boundary. GATED to all-absolute-M multi-sub-path `d` (a relative `m`
      // sub-path on a fresh path would resolve against 0,0 → mis-position; those
      // fall through to the single-sample path below = old behavior). A
      // single-sub-path `d` matches the old sampler EXACTLY (one entry, same
      // spacing math) → the locked catalog renders byte-identical.
      if (subPaths.length === 0) {
        const subDs = d.match(/[Mm][^Mm]*/g) ?? [];
        const splittable = subDs.length >= 2 && subDs.every((s) => /^\s*M/.test(s));
        if (splittable) {
          for (const sd of subDs) {
            const sp = ownerDoc.createElementNS('http://www.w3.org/2000/svg', 'path');
            sp.setAttribute('d', sd);
            parentSvg.appendChild(sp);
            let len = 0;
            try { len = sp.getTotalLength(); } catch { /* skip degenerate sub-path */ }
            if (len > 0.5) {
              const spacing = Math.max(12, len / 6);
              const n = Math.max(4, Math.ceil(len / spacing));
              const pts: Array<[number, number]> = [];
              for (let i = 0; i <= n; i++) { const p = sp.getPointAtLength((i / n) * len); pts.push([p.x, p.y]); }
              subPaths.push({ points: pts, isClosed: /[zZ]\s*$/.test(sd.trim()) });
            }
            parentSvg.removeChild(sp);
          }
        }
      }
      if (subPaths.length === 0) {
        // Curve path OR parse failed — use length sampler producing a single
        // sub-path. sampleSpacing /6 keeps long curved paths at audit-style
        // sparse density (sombrero brim arc, rose petal Q-bezier, etc).
        const sampleSpacing = Math.max(12, totalLen / 6);
        const numSamples = Math.max(4, Math.ceil(totalLen / sampleSpacing));
        const pts: Array<[number, number]> = [];
        for (let i = 0; i <= numSamples; i++) {
          const t = (i / numSamples) * totalLen;
          const p = tmpPath.getPointAtLength(t);
          pts.push([p.x, p.y]);
        }
        subPaths.push({ points: pts, isClosed: pathEndsWithZ });
      }

      parentSvg.removeChild(tmpPath);

      // Render each sub-path independently — bezier-smoothing in
      // renderHandFeelShape can't reach across sub-path boundaries this way.
      const outElements: SVGElement[] = [];
      let subIdx = 0;
      for (const sub of subPaths) {
        // RDP normalize ONLY when input vertex count is well above the audit
        // sparse range. Audit case-path shapes top out at ~6 verts per
        // sub-path (verified via /audit sweep 2026-06-09). Threshold = 15
        // means audit shapes ALWAYS fall through with raw vertices (no RDP)
        // and only dense drawn/uploaded input gets simplified. Earlier ε=1.5
        // applied unconditionally was dropping middle points off audit's
        // 5-6-point Q-bezier samples → broke audit ticket/statue/etc.
        const RDP_VERTEX_THRESHOLD = 15;
        const rdpTriggered = sub.points.length > RDP_VERTEX_THRESHOLD;
        const subClosed = sub.isClosed;

        // SIMPLIFY SLIDER (doc 22): render at the USER epsilon, but freeze the
        // renderer choice to the CANONICAL epsilon (§4.5). canonicalAnchorCount
        // is the polygonal-vs-curve dispatch input — it belongs to the SOURCE
        // shape, so sweeping the slider never flips the renderer (no identity
        // cliff). The user epsilon only changes how many anchors RENDER.
        let userSimplifiedPts = rdpTriggered
          ? rdp(sub.points, epsForSimplify)
          : sub.points;
        // CLOSED-PATH FLOOR (§4.6): never simplify a closed sub-path below 5
        // retained anchors (pre closure-append) — prevents the circle→triangle
        // degeneracy at high ε. Re-run at the canonical ε if the user ε starved
        // the loop; canonical (ε=3.0) is the densest baseline we ship today.
        if (rdpTriggered && subClosed && userSimplifiedPts.length < 5) {
          const canonicalPts = rdp(sub.points, RDP_EPSILON);
          userSimplifiedPts = canonicalPts.length >= userSimplifiedPts.length
            ? canonicalPts
            : userSimplifiedPts;
        }
        const canonicalAnchorCount = rdpTriggered
          ? rdp(sub.points, RDP_EPSILON).length
          : sub.points.length;
        const cleanPoints = userSimplifiedPts.slice();

        // Closed sub-path: APPEND first point to end for clean bezier loop
        // (matches original case 'path' line 1234 behavior). NOT overwrite —
        // overwriting drops the final corner (broke audit shapes 2026-06-09).
        if (subClosed && cleanPoints.length > 1) {
          cleanPoints.push([cleanPoints[0][0], cleanPoints[0][1]]);
        }

        if (cleanPoints.length < 2) { subIdx++; continue; }

        // Per-sub-path bbox + centroid + ROUGH (matches existing per-shape logic)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let sumX = 0, sumY = 0;
        for (const [px, py] of cleanPoints) {
          if (px < minX) minX = px;
          if (py < minY) minY = py;
          if (px > maxX) maxX = px;
          if (py > maxY) maxY = py;
          sumX += px;
          sumY += py;
        }
        const bboxMin = Math.min(maxX - minX, maxY - minY) || 80;
        const sizeClampBbox = groupBBoxMin && groupBBoxMin > bboxMin
          ? Math.sqrt(bboxMin * groupBBoxMin)
          : bboxMin;
        const effW = effectiveWobble(m.wobble, sizeClampBbox);
        const ROUGH = HAND_FEEL_BASE.line * effW;
        const subCentroidX = cleanPoints.length > 0 ? sumX / cleanPoints.length : 0;
        const subCentroidY = cleanPoints.length > 0 ? sumY / cleanPoints.length : 0;

        if ((window as { __dd_diag?: boolean }).__dd_diag) {
          // eslint-disable-next-line no-console
          console.log('[dd-diag] case path sub', {
            subIdx,
            inputPointCount: sub.points.length,
            simplifiedPointCount: cleanPoints.length,
            isClosed: subClosed,
            bboxMin: Number(bboxMin.toFixed(1)),
            sizeClampBbox: Number(sizeClampBbox.toFixed(1)),
            effW: Number(effW.toFixed(3)),
            ROUGH: Number(ROUGH.toFixed(3)),
          });
        }

        const subOut = renderHandFeelShape({
          ROUGH,
          baseSeed: seed + subIdx * 31,
          isClosed: subClosed,
          bboxMin,
          rc,
          // SMOOTH-CURVE BUILDPATH for RDP-triggered sub-paths (drawn freehand
          // / auto-traced). Catmull-Rom passes a smooth cubic-Bezier curve
          // through every anchor — no visible polygon corners. Audit shapes
          // never trigger this (rdpTriggered=false for vertex count ≤ 15) so
          // they keep their existing pointsToPolylinePath rendering with the
          // wobbly-straight character that's correct for rect/trapezoid sides.
          //
          // PARALLEL-PASS HANDLING: when sketchingStyle is parallel-pass and
          // path is open (no Z), shift anchors perpendicular to the primary
          // direction by layerIndex * stride BEFORE smoothing. Produces a
          // clean parallel sister curve per layer instead of the per-vertex
          // chaos fallback. handlesPerVertexLayer=true bypasses the gate.
          buildPath: rdpTriggered
            ? (s, mods) => {
                let pts = cleanPoints;
                if (
                  !subClosed &&
                  mods.sketchingStyle === 'parallel-pass' &&
                  mods.layerIndex !== undefined &&
                  mods.layerIndex > 0
                ) {
                  pts = offsetLinePerpendicular(cleanPoints, mods.layerIndex);
                }
                const wobbleAmp = Math.max(0, ROUGH * 2);
                // POLYGONAL INTENT DETECTION: when the input simplifies down to
                // ≤8 anchors, treat it as a polygon (rectangle / triangle /
                // diamond / kite / etc) — straight-bezier-per-side keeps corners
                // crisp. Smooth-curve inputs (heart, blob, spiral) have 9+
                // anchors → Catmull-Rom smooth interpolation.
                //
                // DISPATCH FREEZE (doc 22 §4.5 / S1): the renderer choice reads
                // canonicalAnchorCount (anchors at the CANONICAL ε = 3.0), NOT
                // pts.length (anchors at the USER ε). Source shape owns renderer
                // identity; the Simplify slider only varies detail WITHIN the
                // chosen renderer — it can never flip smooth↔polygonal nor the
                // hidden wobbleAmp × 0.4 polygonal attenuation.
                const POLY_ANCHOR_CAP = 8;
                if (canonicalAnchorCount <= POLY_ANCHOR_CAP) {
                  return straightBezierPath(
                    pts, subClosed,
                    wobbleAmp * 0.4,
                    m.bowing, m.curveDamp,
                    mods.endpointBehavior,
                    s,
                  );
                }
                return catmullRomPath(
                  pts, subClosed,
                  wobbleAmp,
                  m.bowing, m.curveDamp,
                  mods.endpointBehavior,
                  s,
                );
              }
            : undefined,
          handlesPerVertexLayer: rdpTriggered,
          buildPoints: (s, mods) => {
            const r = seededRandom(s);
            const j = () => (r() - 0.5) * 2 * ROUGH;
            const protrudeFor = (mode: ShapeModifiers['endpointBehavior']): number => {
              if (mode === 'protrude') return 4;
              if (mode === 'long-overshoot') return 9;
              if (mode === 'kink') return 2.5;
              return 0;
            };
            const protrude = protrudeFor(mods.endpointBehavior);
            const isKinkMode = mods.endpointBehavior === 'kink';
            const looseOffset =
              mods.sketchingStyle === 'loose-overlap' && mods.layerIndex
                ? mods.layerIndex * 3
                : 0;
            const totalShift = isKinkMode ? looseOffset : (protrude + looseOffset);
            const out: Array<[number, number]> = [];
            for (let i = 0; i < cleanPoints.length; i++) {
              const [px, py] = cleanPoints[i];
              let extendX = 0, extendY = 0;
              if (isKinkMode) {
                const angle = r() * Math.PI * 2;
                extendX += Math.cos(angle) * protrude;
                extendY += Math.sin(angle) * protrude;
              }
              if (totalShift > 0) {
                if (subClosed) {
                  const dx = px - subCentroidX;
                  const dy = py - subCentroidY;
                  const len = Math.max(0.01, Math.hypot(dx, dy));
                  extendX += (dx / len) * totalShift;
                  extendY += (dy / len) * totalShift;
                } else if (i === 0 && cleanPoints.length > 1) {
                  const [nx, ny] = cleanPoints[1];
                  const dx = nx - px;
                  const dy = ny - py;
                  const len = Math.max(0.01, Math.hypot(dx, dy));
                  extendX += -(dx / len) * totalShift;
                  extendY += -(dy / len) * totalShift;
                } else if (i === cleanPoints.length - 1 && cleanPoints.length > 1) {
                  const [pvx, pvy] = cleanPoints[i - 1];
                  const dx = px - pvx;
                  const dy = py - pvy;
                  const len = Math.max(0.01, Math.hypot(dx, dy));
                  extendX += (dx / len) * totalShift;
                  extendY += (dy / len) * totalShift;
                }
              }
              out.push([px + extendX + j(), py + extendY + j()]);
            }
            return out;
          },
          pivotOverride: groupPivot,
          bboxMinOverride: groupBBoxMin,
        }, m, el, ownerDoc);

        outElements.push(...subOut);
        subIdx++;
      }

      return outElements;
    }
    case 'text':
      return [el.cloneNode(true) as SVGElement];
    case 'g': {
      // CRITICAL: always compute THIS group's own pivot from its own bbox.
      // Do NOT inherit from a parent's pivot. Why: if 4 book-groups all
      // inherit the SVG's center as pivot, then cross-hatch (rotation)
      // makes the top book swing left while the bottom book swings right
      // (both around the same far-away pivot) → chaos. Each book group
      // should rotate around ITS OWN center for a clean crisscross.
      //
      // BBox-min, on the other hand, IS inherited — multi-stroke layer
      // count caps benefit from the WIDER container's size (the user reads
      // strokes at group scale, not tiny-child scale).
      const groupBBox = computeGroupBBox(el);
      let nextPivot = groupBBox
        ? { cx: groupBBox.x + groupBBox.w / 2, cy: groupBBox.y + groupBBox.h / 2 }
        : groupPivot;  // fall back to inherited only if we can't compute our own
      const nextBBoxMin =
        groupBBoxMin !== undefined
          ? groupBBoxMin
          : groupBBox
            ? Math.min(groupBBox.w, groupBBox.h)
            : undefined;
      // DIAG 2026-06-07
      if ((window as { __dd_diag?: boolean }).__dd_diag) {
        // eslint-disable-next-line no-console
        console.log('[dd-diag] case g', {
          childCount: el.children.length,
          inheritedPivot: !!groupPivot,
          computedBBox: groupBBox,
          pivot: nextPivot,
          groupBBoxMin: nextBBoxMin,
        });
      }
      const flat: SVGElement[] = [];
      Array.from(el.children).forEach((child, idx) => {
        if (child instanceof SVGElement) {
          flat.push(...transformElement(child, rc, m, seed + idx * 17, ownerDoc, nextPivot, nextBBoxMin));
        }
      });
      // GROUP-TRANSFORM PRESERVATION (root cause A, 2026-06-13). The children
      // above were re-rendered in the group's LOCAL coordinate space — their
      // built paths carry no knowledge of the <g>'s own transform/opacity/
      // clip-path. Flattening them straight to top level DROPS that group
      // transform, so every transform-positioned group collapses onto its
      // siblings at the same origin: dominoTiles (3 tiles `translate(0 12/44/
      // 76)`) and lacroixRack (9 cans, each its own `translate`) both stacked
      // into ONE pile (the audit's "dark-dropped" / "blob"). Re-wrap the
      // flattened children in a fresh <g> that re-applies the source group's
      // positioning attributes so each group lands where it belongs. Groups
      // with NO such attributes (e.g. stackedSketchbooks, whose children carry
      // absolute coords) return flat unchanged — zero behavior change there.
      const gTransform = el.getAttribute('transform');
      const gOpacity = el.getAttribute('opacity');
      const gClip = el.getAttribute('clip-path');
      if (gTransform === null && gOpacity === null && gClip === null) {
        return flat;
      }
      const wrap = ownerDoc.createElementNS('http://www.w3.org/2000/svg', 'g');
      if (gTransform !== null) wrap.setAttribute('transform', gTransform);
      if (gOpacity !== null) wrap.setAttribute('opacity', gOpacity);
      if (gClip !== null) wrap.setAttribute('clip-path', gClip);
      for (const child of flat) wrap.appendChild(child);
      return [wrap];
    }
    default:
      return [el.cloneNode(true) as SVGElement];
  }
}

function applyRoughTransform(svgEl: SVGSVGElement, m: F3ModifiersState) {
  const rc = rough.svg(svgEl);
  const sourceChildren = Array.from(svgEl.children) as SVGElement[];
  const renderable = sourceChildren.filter((c) => {
    const t = c.tagName.toLowerCase();
    return t !== 'defs' && t !== 'style' && t !== 'title' && t !== 'desc';
  });
  const preserved = sourceChildren.filter((c) => !renderable.includes(c));

  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  preserved.forEach((p) => svgEl.appendChild(p));

  renderable.forEach((el, idx) => {
    const baseSeed = 100 + idx * 13;
    const replacements = transformElement(el, rc, m, baseSeed, svgEl.ownerDocument!);
    replacements.forEach((r) => svgEl.appendChild(r));
  });

  // Post-process: rough.js's hachure fills (for <path> elements only — the
  // <path> branch in transformElement falls back to rough.js) render as STROKE
  // paths. Apply stroke-opacity so Fill opacity affects them. Skip our own
  // hand-feel polyline outputs — those are tagged data-f3-hand-feel="outline"
  // so we don't kill them when the user lowers Fill opacity.
  if (m.fillOpacity < 1.0) {
    const paths = svgEl.querySelectorAll('path');
    paths.forEach((p) => {
      if (p.getAttribute('data-f3-hand-feel') === 'outline') return;
      const fillAttr = p.getAttribute('fill');
      const strokeAttr = p.getAttribute('stroke');
      const isHachureStroke = (!fillAttr || fillAttr === 'none') && strokeAttr && strokeAttr !== 'none';
      if (isHachureStroke) {
        p.setAttribute('stroke-opacity', String(m.fillOpacity));
      }
    });
  }
}

// ─── RISOGRAPH — DARKNESS-AWARE two-color spot register ─────────────────────
//
// Real Riso prints a flat SPOT COLOR whose ink density tracks source darkness:
// the machine reads levels of black and cuts a stencil by opacity — 100% black
// prints solid ink, white paper stays untouched, mid greys print as pale tones.
// (Risolve "How to set up files for Riso": "The Risograph reads levels of black…
// 100% black prints at 100% ink, 50% black at 50% ink"; Duplikat Riso Guide:
// "darker artwork → more ink, lighter areas and white paper remain untouched";
// Spectrolite best-practices: aim ≤~75–90% coverage on solid areas.)
//
// The OLD code flooded EVERY non-transparent fill with the secondary color and
// kept the primary's original fill — so an 8%-WASH white body (actionFigure,
// amiibo, switch, etc.) got inked into a solid colored mass and its knockouts
// (paper-through holes, var(--dir-bg) registers) vanished. This is the flat
// spot-color analog of the smartHachure source-darkness rule (I-2): we only ink
// regions that are DARK in the source; LIGHT/white regions render as paper.
//
// This is a FLAT register (no hachure) — DARK fills get solid spot ink, MID
// fills get partial-opacity ink (the pale-tone behavior), LIGHT/white fills are
// dropped to `none` so the paper shows and knockout structure survives. Strokes
// are line-art ink and always register on both layers.

// Below this source-darkness a fill is treated as paper/white and gets NO ink.
// 8% WASH = 0.08 darkness sits well below; --dir-text-body (0.8) / -primary (1.0)
// / -accent (0.85) sit well above. Picked to match the smartHachure darkness<0.05
// "blank" floor while still dropping the 8% body wash (the flood source).
const RISO_INK_FLOOR = 0.18;

/** Maps a fill color to its riso treatment.
 *  - paper (darkness < floor, or none/transparent/--dir-bg) → drop fill to 'none'
 *  - ink (darkness ≥ floor) → keep on primary; spot-color on secondary at an
 *    opacity scaled by darkness (mid greys read as pale tone, blacks solid).
 *
 *  PAPER-OCCLUSION (root causes B + D, 2026-06-13). A light region is paper —
 *  but HOW it must render depends on what sits BENEATH it in z-order:
 *    - paperKind 'opaque'  → the source explicitly painted PAPER (var(--dir-bg)
 *      or a white literal) over something: a nested white emblem/label drawn ON
 *      TOP of a dark body (collectorTin's white circle over the dark embossed
 *      card; boxedGameCartridge's white art panel over the dark cartridge). If
 *      we drop it to 'none', the DARK body beneath shows through and the white
 *      region reads flooded (the bug). It must re-stamp as an OPAQUE paper fill
 *      so it knocks the dark body out — same paper-knockout the smart-hachure
 *      path already honors in index.ts.
 *    - paperKind 'transparent' → none/transparent/WASH body (ampCombo's 8% wash
 *      slatted body, cardBinder's transparent pockets). These sit over paper
 *      already; dropping to 'none' correctly reveals it. Re-stamping would be
 *      visually identical but we keep the minimal change to the WORKING cases. */
function risoFillTreatment(
  fillVal: string | null,
): { isInk: boolean; darkness: number; paperKind: 'opaque' | 'transparent' } {
  if (!fillVal || fillVal === 'transparent' || fillVal === 'none') {
    return { isInk: false, darkness: 0, paperKind: 'transparent' };
  }
  // Paper register — var(--dir-bg) is the substrate. It's an EXPLICIT paint of
  // paper (often over a dark body), so it knocks out opaquely (never inked).
  if (fillVal.includes('--dir-bg')) {
    return { isInk: false, darkness: 0, paperKind: 'opaque' };
  }
  // White / near-white literals (uploaded art) are likewise explicit paper.
  if (isWhitePaperLiteral(fillVal)) {
    return { isInk: false, darkness: 0, paperKind: 'opaque' };
  }
  const darkness = fillDarknessFactor(fillVal);
  // A light-but-not-substrate fill (e.g. an 8% WASH body) is paper too, but the
  // 'transparent' kind — it sits over paper and drops to none (working cases).
  return {
    isInk: darkness >= RISO_INK_FLOOR,
    darkness,
    paperKind: 'transparent',
  };
}

/** True for white / near-white literal fills (#fff, white, rgb(255,255,255),
 *  hsl(...,100%)) — explicit paper paint in uploaded art. var() tokens are
 *  handled by the caller's --dir-bg check; this covers literal colors only. */
function isWhitePaperLiteral(fillVal: string): boolean {
  const v = fillVal.trim().toLowerCase();
  if (v === 'white') return true;
  if (v.startsWith('var(') || v.includes('color-mix')) return false;
  // fillDarknessFactor parses literal hex/rgb/hsl into a 0-1 darkness; treat the
  // top luminance sliver (darkness ≤ 0.04, i.e. ~#f5+ white) as paper.
  if (/^#|^rgb|^hsl/.test(v)) {
    return fillDarknessFactor(fillVal) <= 0.04;
  }
  return false;
}

// Secondary-layer multiply-opacity ceiling (BUG2 fix, 2026-06-13). The
// colorShift→group-opacity curve is identity up to RISO_KNEE (= the default
// preset's colorShift 0.7, so the default render is byte-identical) and
// compresses the top range toward RISO_CEIL at colorShift 1.0 — a strong offset
// that never multiplies to a full-opacity black stamp over the body.
const RISO_KNEE = 0.7;
const RISO_CEIL = 0.82;

function applyRisographTransform(svgEl: SVGSVGElement, m: F3ModifiersState) {
  const originals = Array.from(svgEl.children) as SVGElement[];
  const renderable = originals.filter((c) => {
    const t = c.tagName.toLowerCase();
    return t !== 'defs' && t !== 'style' && t !== 'title' && t !== 'desc';
  });

  // PRIMARY layer = the source register, but with LIGHT fills knocked out to
  // paper so white bodies don't read as solid ink. Dark fills keep their ink;
  // strokes (line art) always survive.
  const primary = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  primary.setAttribute('data-riso-layer', 'primary');
  renderable.forEach((c) => {
    const clone = c.cloneNode(true) as SVGElement;
    knockOutLightFills(clone);
    primary.appendChild(clone);
  });

  const angleRad = (m.offsetAngle * Math.PI) / 180;
  const dx = m.offsetDistance * Math.cos(angleRad);
  const dy = m.offsetDistance * Math.sin(angleRad);
  const reg = m.registrationError;
  // §7.B-12: seed registration jitter from the modifier state so renders are
  // stable across re-runs (was Math.random — every HMR / route nav produced
  // a different jitter, which read as a broken slider).
  const regSeed = Math.round(m.offsetDistance * 100 + m.offsetAngle * 10 + m.registrationError * 31);
  const regRand = seededRandom(regSeed || 1);
  const rdx = dx + (regRand() - 0.5) * 2 * reg;
  const rdy = dy + (regRand() - 0.5) * 2 * reg;

  const secondary = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  secondary.setAttribute('data-riso-layer', 'secondary');
  secondary.setAttribute('transform', `translate(${rdx},${rdy})`);
  // §7.B-3 ceiling fix (2026-06-13): the secondary offset layer multiplies over
  // the body via this GROUP opacity (= colorShift). At colorShift 1.0 a
  // full-opacity multiply obliterates light/mid-tone artwork to a near-solid
  // black mass (bandPatch / bandTshirt / conferenceLanyard) — the secondary
  // stops reading as an offset and becomes a black stamp over the body. Fix:
  // COMPRESS the top of the colorShift→group-opacity curve so 1.0 reads as a
  // strong-but-not-obliterating offset. The curve is identity (linear) up to
  // RISO_KNEE so the default preset (colorShift 0.7) is byte-identical; the
  // (knee, 1.0] range compresses toward RISO_CEIL — still strictly monotonic
  // (the slider always does something across its full range), never reaching
  // full multiply, so the source artwork stays visible at every colorShift.
  // (Fill-opacity is already honored on the secondary's fills by the
  // [data-f3-stroke] svg [fill] { fill-opacity: var(--f3-fill-opacity) } rule —
  // verified in the live DOM — so it is NOT re-folded here.)
  const csClamped = Math.min(1, Math.max(0, m.colorShift));
  const secondaryOpacity =
    csClamped <= RISO_KNEE
      ? csClamped
      : RISO_KNEE + (csClamped - RISO_KNEE) * ((RISO_CEIL - RISO_KNEE) / (1 - RISO_KNEE));
  secondary.setAttribute('style', `mix-blend-mode: multiply; opacity: ${secondaryOpacity};`);

  // §7.B-3: secondary color is user-picked via risoSecondaryColor (was hardcoded
  // #D4574A). 'source' falls back to accent — risograph by definition needs a
  // contrasting secondary, so passthrough doesn't make sense here.
  const shiftedColor = paletteToToken(m.risoSecondaryColor) ?? 'var(--dir-accent)';
  renderable.forEach((c) => {
    const clone = inkSecondaryLayer(c.cloneNode(true) as SVGElement, shiftedColor);
    secondary.appendChild(clone);
  });

  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  svgEl.appendChild(secondary);
  svgEl.appendChild(primary);
}

/** Recursively resolve LIGHT/white fills so the paper register reads right.
 *  - opaque paper (var(--dir-bg) / white literal) → re-stamp var(--dir-bg) so a
 *    nested white emblem/label KNOCKS OUT the dark body beneath it instead of
 *    going transparent and letting the dark show through (root causes B + D).
 *  - transparent/wash paper → 'none' (sits over paper, reveals it).
 *  Dark fills keep their source ink; strokes are untouched (line-art register).
 *  Walks into <g> subtrees so grouped catalog objects knockout correctly. */
function knockOutLightFills(el: SVGElement): void {
  const tag = el.tagName.toLowerCase();
  if (tag === 'defs' || tag === 'style' || tag === 'title' || tag === 'desc') return;
  // text stays legible — never knock out its fill (recurse into other groups).
  if (tag !== 'text') {
    const fillVal = el.getAttribute('fill');
    if (fillVal !== null) {
      const { isInk, paperKind } = risoFillTreatment(fillVal);
      if (!isInk) {
        el.setAttribute('fill', paperKind === 'opaque' ? 'var(--dir-bg)' : 'none');
      }
    }
  }
  Array.from(el.children).forEach((child) => knockOutLightFills(child as SVGElement));
}

/** Build the offset spot-color register for one element subtree.
 *  - strokes → spot color (line art registers on both layers)
 *  - DARK fills → spot color, fill-opacity scaled by source darkness so mid
 *    tones read as pale spot ink and blacks read as solid (the Riso ramp)
 *  - LIGHT/white fills → 'none' (paper, knockout preserved) */
function inkSecondaryLayer(el: SVGElement, spotColor: string): SVGElement {
  const tag = el.tagName.toLowerCase();
  if (tag !== 'defs' && tag !== 'style' && tag !== 'title' && tag !== 'desc' && tag !== 'text') {
    if (el.getAttribute('stroke')) el.setAttribute('stroke', spotColor);
    const fillVal = el.getAttribute('fill');
    if (fillVal !== null) {
      const { isInk, darkness, paperKind } = risoFillTreatment(fillVal);
      if (isInk) {
        el.setAttribute('fill', spotColor);
        // Pale-tone ramp: mid greys ink lighter than blacks. Cap at 0.9 per
        // riso solid-area coverage best-practice (Spectrolite).
        el.setAttribute('fill-opacity', String(Math.min(0.9, 0.35 + darkness * 0.55)));
      } else if (paperKind === 'opaque') {
        // Opaque paper knockout on the OFFSET layer too (root causes B + D):
        // the secondary is offset under the primary, so a nested white emblem/
        // label must knock out the secondary's own inked dark body in that
        // region — else the offset dark ink peeks past the primary's knockout.
        el.setAttribute('fill', 'var(--dir-bg)');
        el.removeAttribute('fill-opacity');
      } else {
        el.setAttribute('fill', 'none');
      }
    }
  }
  Array.from(el.children).forEach((child) => inkSecondaryLayer(child as SVGElement, spotColor));
  return el;
}

// ─── TEXTURE — dynamic filter (charcoal / wet-ink / texture × intensity) ──

function buildDynamicFilterId(style: F3SvgStyle, m: F3ModifiersState): string {
  if (style === 'charcoal') {
    return `hero8-dyn-charcoal-${m.grainIntensity.toFixed(2)}-${m.smudgeAmount.toFixed(2)}-${m.pressureVariance.toFixed(2)}`;
  }
  if (style === 'wet-ink') {
    return `hero8-dyn-wet-ink-${m.blurAmount.toFixed(2)}-${m.bleed.toFixed(2)}`;
  }
  if (m.texture !== 'none') {
    return `hero8-tex-${m.texture}-${m.textureIntensity.toFixed(2)}`;
  }
  return '';
}

function applyTexture(svgEl: SVGSVGElement, _texture: TextureStep, style: F3SvgStyle, m: F3ModifiersState) {
  // NEWSPRINT DOT SCREEN (2026-06-10): dotPattern is consumed as a real
  // dot-layout <pattern> + luminance mask (defined in TextureFilterDefs,
  // document-wide like the filters). The mask knocks paper-through holes
  // into the ink in the chosen arrangement and rides ALONGSIDE the texture
  // filter — per the SVG rendering model filters apply first, then masking,
  // so the displaced grain gets perforated, not the other way round.
  // Cluster 4 (Surface Texture) axes compose per 09-LOCKED-MODEL I-13.
  if (style === 'newsprint') {
    svgEl.setAttribute('mask', 'url(#dd-newsprint-dot-mask)');
  } else {
    svgEl.removeAttribute('mask');
  }
  const dynId = buildDynamicFilterId(style, m);
  if (dynId) {
    svgEl.setAttribute('filter', `url(#${dynId})`);
    if (!svgEl.getAttribute('overflow')) svgEl.setAttribute('overflow', 'visible');
    return;
  }
  svgEl.removeAttribute('filter');
}

// ─── DOM-clone helper ─────────────────────────────────────────────────────

function cloneSvg(srcContainer: HTMLDivElement | null, dstContainer: HTMLDivElement | null): SVGSVGElement | null {
  if (!srcContainer || !dstContainer) return null;
  const src = srcContainer.querySelector('svg');
  if (!src) return null;
  dstContainer.innerHTML = '';
  const clone = src.cloneNode(true) as SVGSVGElement;
  // Force overflow:visible so wobble/endpoint overshoots that push geometry
  // outside the source viewBox aren't clipped. The pin SVGs use tight viewBoxes
  // (e.g. rects at x=3 in a 80×100 viewBox); rough.js + protrude routinely push
  // 5-10px beyond. SVG defaults overflow:hidden — we need visible.
  clone.setAttribute('overflow', 'visible');
  clone.style.overflow = 'visible';
  dstContainer.appendChild(clone);
  return clone;
}

// ─── WIREFRAME — true-geometry uniform-hairline schematic (Rock Y rebuild) ──
//
// Sebs 2026-06-12 "build it fr real" — supersedes the Rock B stub removal.
// The OLD stub replaced every child with its axis-aligned bounding rect
// (bounding-box garbage on real art — that render is the explicit
// anti-fixture; never reintroduce it). The rebuild renders every piece of the
// artwork as its TRUE GEOMETRY in clean technical linework:
//
//   - every renderable leaf goes stroke-only at ONE uniform weight
//     (m.strokeWidth, interpreted in SCREEN px via
//     vector-effect:non-scaling-stroke — a 682×986-viewBox upload and an
//     800×600 drawn doodle render the SAME hairline; without it, user-space
//     hairlines vanish on large-viewBox uploads)
//   - painted fills are REMOVED and their boundary (the element's own
//     geometry — for SVG the fill region's edge IS the path) renders as a
//     line. Fill-boundary lines take the lighter construction register:
//     0.75× weight + stroke-opacity from m.fillOpacity. Source-stroked
//     geometry = primary contour: full weight, full opacity. (Pen-tip ink
//     ribbons and tone-fill band patches are filled geometry → they render
//     as their outline, which is their true geometry.)
//   - ink is fixed to the page ink (var(--dir-text-primary)) — ink-black
//     schematic register; palettes deliberately not exposed
//   - NO hand-feel: this branch never enters the rough/smartHachure pipeline
//     (wobble/multiStroke/penTip structurally inert) and applyTexture is
//     skipped at the call site — wireframe is the clean schematic
//     counterpoint to every other style
//   - Simplify rides along (doc 22 semantics, ε(s) = 3.0 × 4^(s−1), s=1 ≡
//     canonical ε=3.0): RDP applies to POLYLINE geometry only — polygon/
//     polyline elements + paths whose d is pure move/line (drawn commit-layer
//     strokes, traced art like the rose). Curve commands stay untouched —
//     faceting a circle into segments would betray "true geometry".
//   - pass-through: text stays legible; <image> is raster (no contour to
//     extract) → honest pass-through, NEVER a bounding box; defs/clipPath/
//     mask/pattern/marker/symbol/gradient/filter subtrees untouched.

const WIREFRAME_INK = 'var(--dir-text-primary)';
/** Fill-boundary lines render at this fraction of the primary weight — the
 *  light "construction line" register vs primary contours. */
const WIREFRAME_BOUNDARY_RATIO = 0.75;
const WIREFRAME_RENDERABLE = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
// Non-rendered containers — geometry inside these is referenced, not drawn;
// restyling it would corrupt clip shapes / gradient stops / marker glyphs.
// SVG tagNames are case-preserving, so both exact and lowercase are listed.
const WIREFRAME_SKIP_CONTAINERS = new Set([
  'defs', 'clipPath', 'clippath', 'mask', 'pattern', 'marker', 'symbol',
  'linearGradient', 'lineargradient', 'radialGradient', 'radialgradient', 'filter',
]);

/** True when a computed paint value actually puts ink on the page. */
function wireframePaintVisible(paint: string | null | undefined): boolean {
  if (!paint) return false;
  const p = paint.trim();
  if (p === 'none' || p === 'transparent') return false;
  const rgba = p.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/);
  if (rgba && parseFloat(rgba[1]) === 0) return false;
  return true;
}

function wireframeInsideSkipContainer(el: Element, root: Element): boolean {
  let p = el.parentElement;
  while (p && p !== root) {
    if (WIREFRAME_SKIP_CONTAINERS.has(p.tagName)) return true;
    p = p.parentElement;
  }
  return false;
}

type WireframeSubPath = { points: Array<[number, number]>; closed: boolean };

/** Parse a path `d` into absolute polylines IFF it contains only move/line
 *  commands (M m L l H h V v Z z). Returns null for anything with curves —
 *  those keep their true geometry (no resample-faceting). */
function parseLinearPathD(d: string): WireframeSubPath[] | null {
  if (/[^MmLlHhVvZz0-9eE+\-.,\s]/.test(d)) return null;
  const tokens = d.match(/[MmLlHhVvZz]|[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/g);
  if (!tokens || tokens.length === 0) return null;
  const subs: WireframeSubPath[] = [];
  let cur: WireframeSubPath | null = null;
  let x = 0;
  let y = 0;
  let i = 0;
  let cmd = '';
  let guard = tokens.length * 2 + 8; // malformed-d safety, never spins
  const num = () => parseFloat(tokens[i++] ?? 'NaN');
  while (i < tokens.length && guard-- > 0) {
    const t = tokens[i];
    if (/^[MmLlHhVvZz]$/.test(t)) {
      cmd = t;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        if (cur && cur.points.length > 0) {
          cur.closed = true;
          [x, y] = cur.points[0];
        }
        continue;
      }
      if (i >= tokens.length) break;
    } else if (cmd === '' || cmd === 'Z' || cmd === 'z') {
      return null; // bare number with no live command — malformed
    }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        cur = { points: [[x, y]], closed: false };
        subs.push(cur);
        cmd = rel ? 'l' : 'L'; // implicit lineto after moveto per spec
        break;
      }
      case 'L': {
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        cur?.points.push([x, y]);
        break;
      }
      case 'H': {
        const nx = num();
        x = rel ? x + nx : nx;
        cur?.points.push([x, y]);
        break;
      }
      case 'V': {
        const ny = num();
        y = rel ? y + ny : ny;
        cur?.points.push([x, y]);
        break;
      }
      default:
        return null;
    }
    if (Number.isNaN(x) || Number.isNaN(y)) return null;
  }
  if (guard <= 0) return null;
  return subs.length > 0 ? subs : null;
}

function buildLinearPathD(subs: WireframeSubPath[]): string {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return subs
    .map(({ points, closed }) => {
      if (points.length === 0) return '';
      const [first, ...rest] = points;
      const head = `M ${r2(first[0])} ${r2(first[1])}`;
      const body = rest.map(([px, py]) => `L ${r2(px)} ${r2(py)}`).join(' ');
      return `${head}${body ? ` ${body}` : ''}${closed ? ' Z' : ''}`;
    })
    .filter(Boolean)
    .join(' ');
}

function applyWireframeSchematic(svgEl: SVGSVGElement, m: F3ModifiersState) {
  const primaryW = Math.max(0.25, m.strokeWidth);
  const boundaryW = Math.max(0.25, m.strokeWidth * WIREFRAME_BOUNDARY_RATIO);
  const boundaryOpacity = Math.min(1, Math.max(0, m.fillOpacity));
  // Doc-22 Simplify mapping — same ε math as the drawn-path pipeline.
  const eps = 3.0 * Math.pow(4, m.simplification - 1);

  const all = Array.from(svgEl.querySelectorAll('*')) as SVGElement[];
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (!WIREFRAME_RENDERABLE.has(tag)) continue; // text/image/etc pass through
    if (wireframeInsideSkipContainer(el, svgEl)) continue;

    let cs: CSSStyleDeclaration;
    try {
      cs = getComputedStyle(el);
    } catch {
      continue;
    }
    // Effective paints via computed style — resolves inheritance from <g>
    // fill attrs, CSS classes, currentColor, var() tokens AND the SVG
    // default black fill on bare elements (the rose's traced paths).
    const hasStroke =
      wireframePaintVisible(cs.stroke) &&
      parseFloat(cs.strokeWidth || '1') > 0 &&
      parseFloat(cs.strokeOpacity || '1') > 0;
    // <line> never paints fill — fill is meaningless on it.
    const hasFill =
      tag !== 'line' &&
      wireframePaintVisible(cs.fill) &&
      parseFloat(cs.fillOpacity || '1') > 0;
    // Invisible helper geometry stays invisible — schematic never invents ink.
    if (!hasStroke && !hasFill) continue;

    // Source-stroked geometry = primary contour. Fill-only geometry = its
    // boundary as a construction line (lighter register).
    const isBoundary = !hasStroke;

    // Inline style wins over presentation attributes, inherited <g> attrs and
    // non-!important CSS — the schematic owns these paints unconditionally.
    el.style.setProperty('fill', 'none');
    el.style.setProperty('stroke', WIREFRAME_INK);
    el.style.setProperty('stroke-width', String(isBoundary ? boundaryW : primaryW));
    el.style.setProperty('stroke-opacity', String(isBoundary ? boundaryOpacity : 1));
    el.style.setProperty('stroke-linecap', 'round');
    el.style.setProperty('stroke-linejoin', 'round');
    // Uniform weight in SCREEN px regardless of the source viewBox scale.
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    el.setAttribute('data-f3-wireframe', isBoundary ? 'boundary' : 'contour');

    // ── Simplify (linear geometry only) ──────────────────────────────────
    if (tag === 'path') {
      const d = el.getAttribute('d');
      if (d) {
        const subs = parseLinearPathD(d);
        if (subs) {
          const simplified = subs.map((s) => ({ ...s, points: rdp(s.points, eps) }));
          el.setAttribute('d', buildLinearPathD(simplified));
        }
      }
    } else if (tag === 'polyline' || tag === 'polygon') {
      const ptsAttr = el.getAttribute('points');
      if (ptsAttr) {
        const nums = ptsAttr.match(/[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/g);
        if (nums && nums.length >= 4) {
          const pts: Array<[number, number]> = [];
          for (let k = 0; k + 1 < nums.length; k += 2) {
            pts.push([parseFloat(nums[k]), parseFloat(nums[k + 1])]);
          }
          const simplified = rdp(pts, eps);
          el.setAttribute('points', simplified.map(([px, py]) => `${Math.round(px * 100) / 100},${Math.round(py * 100) / 100}`).join(' '));
        }
      }
    }
    // rect/circle/ellipse/line carry exact parametric geometry — nothing to
    // simplify without faceting them (true-geometry rule).
  }
}

// ─── OUTLINE-ONLY — synthesize contours for fill-only-no-stroke geometry ────
//
// "Outline only" strips every fill to transparent (CSS §7.B-1) and keeps the
// existing stroke. That's correct for stroked artwork, but a SOLID FILL-ONLY
// shape — a poster rect drawn as `fill={STROKE}` with NO stroke attribute and
// knockout text in `fill={BG}` (psPoster / pitchDeckCover / ppvPoster, plus the
// frame of framedMoviePoster) — has nothing left to draw and renders BLANK once
// its fill is gone. The general fix (NOT per-catalog-item): any element that
// puts ink on the page via FILL but has NO visible stroke gets a synthesized
// hairline outline of its own boundary — its fill region's edge IS its
// geometry, exactly how the wireframe register derives a contour from a
// fill-only leaf. Stroked elements are untouched here; the CSS rules continue
// to recolor their strokes + strip their fills. This runs as a DOM-clone pass
// (outline-only joined NEEDS_DOM_CLONE) so the synthesized strokes are real
// attributes the palette CSS can still recolor.
/** Resolve a leaf's SOURCE paint (fill or stroke) from attributes + inherited
 *  <g> attributes + the SVG UA default — deliberately NOT via getComputedStyle,
 *  because the outline-only CSS forces `fill: transparent !important` on the live
 *  DOM, which would poison a computed-style read (every fill would look empty).
 *  `prop` is 'fill' | 'stroke'. Returns the effective paint string, or null. */
function resolveSourcePaint(el: Element, root: Element, prop: 'fill' | 'stroke'): string | null {
  let cur: Element | null = el;
  while (cur && cur !== root.parentElement) {
    const inlineStyle = (cur as SVGElement).style?.getPropertyValue(prop);
    if (inlineStyle && inlineStyle.trim()) return inlineStyle.trim();
    const attr = cur.getAttribute(prop);
    if (attr && attr.trim()) return attr.trim();
    if (cur === root) break;
    cur = cur.parentElement;
  }
  // SVG UA default: fill is black, stroke is none.
  return prop === 'fill' ? 'black' : null;
}

function applyOutlineOnlySynthesis(svgEl: SVGSVGElement, m: F3ModifiersState) {
  // Match the outline-only preset weight (CSS forces var(--f3-stroke-width) on
  // every [stroke-width]; we write the same value so a synthesized contour reads
  // identically to a source-stroked one). Floor mirrors the wireframe register.
  const w = Math.max(0.25, m.strokeWidth);
  const all = Array.from(svgEl.querySelectorAll('*')) as SVGElement[];
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (!WIREFRAME_RENDERABLE.has(tag)) continue; // text/image/etc untouched
    if (wireframeInsideSkipContainer(el, svgEl)) continue;

    // Resolve SOURCE paints from attributes/inheritance (NOT computed style —
    // the outline-only fill→transparent CSS has already nuked computed fill).
    const srcStroke = resolveSourcePaint(el, svgEl, 'stroke');
    const hasStroke = wireframePaintVisible(srcStroke);
    // Already stroked → leave it for the CSS path (don't double-paint or change
    // a deliberately hairline source stroke). <line> never has a fill region.
    if (hasStroke || tag === 'line') continue;
    const hasFill = wireframePaintVisible(resolveSourcePaint(el, svgEl, 'fill'));
    if (!hasFill) continue; // invisible helper geometry stays invisible

    // Synthesize the boundary: drop the fill, draw the element's own edge as a
    // hairline at the page ink. The stroke is written as an ATTRIBUTE (not just
    // inline style) so the data-f3-stroke palette CSS — which selects on the
    // [stroke] attribute — recolors it like any source-stroked geometry. The
    // outline-only fill→transparent CSS keeps the fill stripped.
    el.style.setProperty('fill', 'none');
    el.setAttribute('stroke', 'var(--dir-text-primary)');
    el.setAttribute('stroke-width', String(w));
    el.style.setProperty('stroke-linecap', 'round');
    el.style.setProperty('stroke-linejoin', 'round');
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    el.setAttribute('data-f3-outline-synth', '1');
  }
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────

const NEEDS_DOM_CLONE: F3SvgStyle[] = [
  'rough-handdrawn', 'sketchy', 'bold-ink', 'stipple', 'risograph', 'wet-ink', 'charcoal', 'newsprint', 'wireframe',
  'outline-only',
];

export function SvgStyleTransform({
  children,
  wrapperOverride,
  onRender,
}: {
  children: ReactNode;
  /** Call-site layout override for the outer wrapper. Default inline-block
   *  sizes to content (audit cells / playground pins). The /canvas upload
   *  branch passes block + 100%×100% so a viewBox-only uploaded svg can
   *  resolve percentage sizing and fill the frame (0×0 bug, 2026-06-11). */
  wrapperOverride?: CSSProperties;
  /** Opt-in: fired after each style pass with the SERIALIZED styled <svg>
   *  (null on failure). The seam the 3D svg-port path rasterizes from — the
   *  3D form wears the EXACT 2D render (project_f3_shading_port_to_3d: use the
   *  real pipeline, no parallel shader). Default undefined = zero behavior
   *  change for every existing call site. */
  onRender?: (styledSvg: string | null) => void;
}) {
  const { state: rawM } = useF3RoughModifiers();
  const { state: style } = useF3SvgStyle();
  // RC-4 — inkIntensity FLOOR. The raw slider bottoms at 0 (modifierSpecs:25),
  // which drives wrapper opacity → 0 AND multiplies ink opacity to 0 inside
  // every render path (CSS-route wrapper, rough-family, smartHachure techniqueMap)
  // — so the minimum BLANKED all ~197 shapes. Floor it so the slider minimum is
  // a faint-but-VISIBLE ink, never invisible. Same family as the locked roughness
  // (0→0.2) / strokeWidth (0.3→0.5) slider floors. Flooring once on the derived
  // `m` carries the floor into EVERY downstream consumer (the opacity below +
  // renderSmartHachure) without touching the dark-blob fix's files.
  const INK_INTENSITY_FLOOR = 0.15;
  const m = useMemo<F3ModifiersState>(
    () =>
      rawM.inkIntensity < INK_INTENSITY_FLOOR
        ? { ...rawM, inkIntensity: INK_INTENSITY_FLOOR }
        : rawM,
    [rawM],
  );
  const cleanRef = useRef<HTMLDivElement | null>(null);
  const fxRef = useRef<HTMLDivElement | null>(null);

  // CASE-3 — PERCENTAGE-SIZED SOURCE detection (2026-06-13).
  // The /canvas committed-strokes + upload sources declare their root <svg> as
  // width="100%" height="100%" + a viewBox. A percentage-sized <svg> needs a
  // DEFINITE containing block to resolve against, but the default wrapper host
  // is `display:inline-block` (content-sized) and the inner host divs carry no
  // explicit size — so on engines that don't fall back to the viewBox aspect
  // ratio the styled <svg> collapses to its intrinsic ~300×225 default,
  // shrinking the render to the top-left and cropping the far end of an
  // elongated drawing off-frame. (The clean SKETCH layer fills the frame, so
  // the mismatch only surfaces on the STYLE flip.)
  //
  // Fix: when the SOURCE svg is percentage-sized, host it as
  // `display:block; width:100%; height:100%` (wrapper + active inner host) so
  // the 100% resolves against the real frame. Audit / playground sources use
  // FIXED px sizing (e.g. width="78" height="98") → detection does NOT fire and
  // those content-sized inline-block hosts stay byte-identical. A call-site
  // `wrapperOverride` still wins (spread last in wrapperStyle below).
  const [sourceIsPercent, setSourceIsPercent] = useState(false);
  useLayoutEffect(() => {
    const sourceSvg = cleanRef.current?.querySelector('svg');
    const w = sourceSvg?.getAttribute('width');
    const h = sourceSvg?.getAttribute('height');
    setSourceIsPercent(!!w && !!h && w.trim().endsWith('%') && h.trim().endsWith('%'));
  }, [children]);

  const needsClone = NEEDS_DOM_CLONE.includes(style);

  // Smart Hachure is now DEFAULT ON (2026-06-11) — the param is an opt-OUT:
  // only `?smartHachure=0` disables it. Absent param = enabled. This kills the
  // white reload-flash that the old opt-in (`=1`) forced on every fresh visit
  // (pages used to set the param + window.location.reload to turn it on).
  // Read on mount only — toggling requires a reload, by design.
  const smartHachureEnabled = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('smartHachure') !== '0';
  }, []);
  // Smart Hachure hosts the rough family PLUS wet-ink + charcoal (RC-5 / SA-3
  // FX-gate lift, 2026-06-13). wet-ink + charcoal already carry real tonal
  // grammar in techniqueMap (loaded-brush ×1.3 weight; dry-media ×1.5 weight,
  // 0.85 opacity) but the old gate routed them to a texture-filter-ONLY path —
  // they rendered as Clean + a thin filter, no real hand-drawn transform (the
  // "dead styles" bug). Admitting them runs their tonal grammar; applyTexture
  // still layers their wet/chalky media filter ON TOP (line ~2636). Clean /
  // outline-only / risograph / newsprint / wireframe keep their own paths.
  const useSmartHachure =
    smartHachureEnabled &&
    (style === 'rough-handdrawn' || style === 'sketchy' || style === 'bold-ink' ||
      style === 'stipple' || style === 'wet-ink' || style === 'charcoal');

  // DEGRADE-TO-RAW warn-once latch (Rock B): the first transform throw per
  // component instance logs one console.warn; later throws degrade silently
  // (same honest fallback, no log spam from a desk full of poisoned objects).
  const degradeWarnedRef = useRef(false);

  useEffect(() => {
    // Canonical visibility every run — a prior DEGRADE-TO-RAW (catch below)
    // flips these directly on the DOM, and React's style diffing won't put
    // them back (it diffs against the previous vnode, not the live DOM). So
    // every fresh transform attempt starts from the canonical layout.
    if (cleanRef.current) cleanRef.current.style.display = needsClone ? 'none' : 'block';
    if (fxRef.current) fxRef.current.style.display = needsClone ? 'block' : 'none';
    try {
      if (!needsClone) {
        if (fxRef.current) fxRef.current.innerHTML = '';
        const cleanSvg = cleanRef.current?.querySelector('svg');
        if (cleanSvg instanceof SVGSVGElement) applyTexture(cleanSvg, m.texture, style, m);
        return;
      }
      const clone = cloneSvg(cleanRef.current, fxRef.current);
      if (!clone) return;
      if (useSmartHachure) {
        // NEW PATH — Smart Hachure System (full F3ModifiersState wired through
        // so roughness · bowing · curveDamp · strokeWidth · multiStroke ·
        // sketchingStyle · endpointBehavior · penTip all feed the outline jitter)
        renderSmartHachure(clone, m, {
          styleChoice: style as SmartHachureStyle,
          inkColor: 'var(--dir-text-primary)',
        });
      } else if (isRoughFamilyStyle(style)) {
        applyRoughTransform(clone, m);
      } else if (style === 'risograph') {
        applyRisographTransform(clone, m);
      } else if (style === 'wireframe') {
        applyWireframeSchematic(clone, m);
      } else if (style === 'outline-only') {
        // Synthesize a hairline contour for any fill-only-no-stroke leaf so
        // solid posters/knockouts show their outline instead of vanishing.
        // Stroked artwork is left to the existing CSS outline-only rules.
        applyOutlineOnlySynthesis(clone, m);
      }
      // Wireframe is the clean schematic counterpoint — grain/dot textures are
      // hand-feel surface noise and structurally suppressed for it (its
      // modifier set doesn't expose texture, so a stale texture value carried
      // over from another style must not leak in).
      if (style !== 'wireframe') {
        applyTexture(clone, m.texture, style, m);
      }
    } catch (err) {
      // ── DEGRADE-TO-RAW (Rock B resilience) ─────────────────────────────
      // The style engine threw mid-pass. Blanking the art (or letting the
      // throw bubble to an error boundary and take the whole subtree) hides
      // the user's work; the honest fallback is the SOURCE markup, unstyled:
      // drop the half-transformed clone and show the raw children instead.
      // The next state change re-runs this effect from the canonical layout
      // above — degrade never sticks past the next successful pass.
      if (fxRef.current) {
        fxRef.current.innerHTML = '';
        fxRef.current.style.display = 'none';
      }
      if (cleanRef.current) cleanRef.current.style.display = 'block';
      if (!degradeWarnedRef.current) {
        degradeWarnedRef.current = true;
        console.warn(
          '[SvgStyleTransform] style engine threw — rendering source markup unstyled:',
          err,
        );
      }
    }
  }, [style, m, children, needsClone, useSmartHachure]);

  // onRender seam — runs AFTER the transform effect (declared later → React
  // commits it after), so it serializes the freshly-styled <svg> the effect
  // above just wrote (fxRef on the clone path, cleanRef on the CSS path). The
  // 3D svg-port path rasterizes this exact markup onto the form.
  useEffect(() => {
    if (!onRender) return;
    const host = needsClone ? fxRef.current : cleanRef.current;
    const svg = host?.querySelector('svg');
    if (svg instanceof SVGSVGElement) {
      try {
        onRender(new XMLSerializer().serializeToString(svg));
      } catch {
        onRender(null);
      }
    } else {
      onRender(null);
    }
  }, [onRender, needsClone, style, m, children, useSmartHachure]);

  const wrapperStyle: CSSProperties = {
    // CASE-3: a percentage-sized source <svg> needs a definite containing block;
    // host it block + 100%×100% so the 100% resolves against the real frame
    // instead of collapsing to the svg intrinsic default. Fixed-px sources keep
    // the content-sized inline-block (byte-identical to /audit + playground).
    display: sourceIsPercent ? 'block' : 'inline-block',
    ...(sourceIsPercent ? { width: '100%', height: '100%' } : null),
    position: 'relative',
    opacity: m.inkIntensity < 1.0 ? m.inkIntensity : undefined,
    ['--f3-fill-opacity' as keyof CSSProperties]: String(m.fillOpacity),
    // Consumed by the outline-only CSS rule (§7.B-1). For rough-family
    // styles the stroke-width is written inline by the rough.js render so
    // this var is harmless.
    ['--f3-stroke-width' as keyof CSSProperties]: String(m.strokeWidth),
    // A call-site wrapperOverride still wins (spread last).
    ...wrapperOverride,
  };

  const strokeAttrVal = needsClone ? 'opts-applied' : m.strokePalette;
  const fillAttrVal = needsClone ? 'opts-applied' : m.fillPalette;

  return (
    <div
      data-svg-style={style}
      data-f3-stroke={strokeAttrVal}
      data-f3-fill={fillAttrVal}
      style={wrapperStyle}
    >
      <style>{`
        [data-svg-style="outline-only"] svg [fill]:not(text) {
          fill: transparent !important;
        }
        [data-svg-style="outline-only"] svg [stroke-width] {
          stroke-width: var(--f3-stroke-width, 1) !important;
        }
        [data-f3-stroke] svg [fill]:not(text):not([fill="transparent"]):not([fill="none"]) {
          fill-opacity: var(--f3-fill-opacity, 1) !important;
        }
        [data-f3-stroke="primary"] svg [stroke]:not([stroke="none"]) { stroke: var(--dir-text-primary) !important; }
        [data-f3-stroke="body"] svg [stroke]:not([stroke="none"]) { stroke: var(--dir-text-body) !important; }
        [data-f3-stroke="body-soft"] svg [stroke]:not([stroke="none"]) { stroke: var(--dir-text-body-soft) !important; }
        [data-f3-stroke="secondary"] svg [stroke]:not([stroke="none"]) { stroke: var(--dir-text-secondary) !important; }
        [data-f3-stroke="detail"] svg [stroke]:not([stroke="none"]) { stroke: var(--dir-detail) !important; }
        [data-f3-stroke="accent"] svg [stroke]:not([stroke="none"]) { stroke: var(--dir-accent, #D4574A) !important; }
        /* feedback_palette_overrides_ink_not_paper (LOCKED): ink must never
           resolve to the paper color or the stroke VANISHES on every shape
           (RC-3). The bg-as-stroke rule is GUARDED and inverted ink = the inverse
           OF paper = the darkest visible ink. Mirrors paletteToToken(mode, isInk=true).
           The data-f3-fill bg / inverted rules below KEEP var(--dir-bg) —
           paper-flood as a FILL is the legitimate opt-in. */
        [data-f3-stroke="bg"] svg [stroke]:not([stroke="none"]) { stroke: var(--dir-text-primary) !important; }
        [data-f3-stroke="neutral"] svg [stroke]:not([stroke="none"]) { stroke: var(--dir-text-body) !important; }
        [data-f3-stroke="inverted"] svg [stroke]:not([stroke="none"]) { stroke: var(--dir-text-primary) !important; }
        /* Palette overrides remap INK fills only. Exclusions:
           - :not([fill*="--dir-bg"]) — paper stays paper (Polaroid outer rect etc.)
           - :not([fill*="color-mix"]) — wash fills stay as their source color-mix
             wrapper. CSS can't dynamically swap the var() token inside a color-mix
             attribute, so overriding here would FLATTEN the wash to opaque palette
             color (losing the 8% transparency wrapper). Stacked sketchbooks render
             all 4 bars same color instead of alternating wash/ink without this.
             For wash-color migration on palette swap, rough-handdrawn style routes
             through JS mapPaletteColor which properly handles color-mix wrappers.
           Sebs 2026-06-04: "stacked sketchbooks get full all filled the same color." */
        [data-f3-fill="primary"] svg [fill]:not(text):not([fill="transparent"]):not([fill="none"]):not([fill*="--dir-bg"]):not([fill*="color-mix"]) { fill: var(--dir-text-primary) !important; }
        [data-f3-fill="body"] svg [fill]:not(text):not([fill="transparent"]):not([fill="none"]):not([fill*="--dir-bg"]):not([fill*="color-mix"]) { fill: var(--dir-text-body) !important; }
        [data-f3-fill="body-soft"] svg [fill]:not(text):not([fill="transparent"]):not([fill="none"]):not([fill*="--dir-bg"]):not([fill*="color-mix"]) { fill: var(--dir-text-body-soft) !important; }
        [data-f3-fill="secondary"] svg [fill]:not(text):not([fill="transparent"]):not([fill="none"]):not([fill*="--dir-bg"]):not([fill*="color-mix"]) { fill: var(--dir-text-secondary) !important; }
        [data-f3-fill="detail"] svg [fill]:not(text):not([fill="transparent"]):not([fill="none"]):not([fill*="--dir-bg"]):not([fill*="color-mix"]) { fill: var(--dir-detail) !important; }
        [data-f3-fill="accent"] svg [fill]:not(text):not([fill="transparent"]):not([fill="none"]):not([fill*="--dir-bg"]):not([fill*="color-mix"]) { fill: var(--dir-accent, #D4574A) !important; }
        [data-f3-fill="bg"] svg [fill]:not(text):not([fill="transparent"]):not([fill="none"]):not([fill*="color-mix"]) { fill: var(--dir-bg) !important; }
        [data-f3-fill="neutral"] svg [fill]:not(text):not([fill="transparent"]):not([fill="none"]):not([fill*="--dir-bg"]):not([fill*="color-mix"]) { fill: var(--dir-text-body-soft) !important; }
        [data-f3-fill="inverted"] svg [fill]:not(text):not([fill="transparent"]):not([fill="none"]):not([fill*="--dir-bg"]):not([fill*="color-mix"]) { fill: var(--dir-bg) !important; }
      `}</style>
      <div
        ref={cleanRef}
        style={{
          display: needsClone ? 'none' : 'block',
          // CASE-3: the active inner host must also carry a definite size so the
          // percentage-sized source <svg> fills the frame. Fixed-px sources skip
          // this → byte-identical content-sized host.
          ...(sourceIsPercent ? { width: '100%', height: '100%' } : null),
        }}
      >
        {children}
      </div>
      <div
        ref={fxRef}
        style={{
          display: needsClone ? 'block' : 'none',
          ...(sourceIsPercent ? { width: '100%', height: '100%' } : null),
        }}
      />
    </div>
  );
}

// ─── SHARED TEXTURE FILTER DEFS — static base set + dynamic (charcoal / wet-ink) ──

const TEXTURE_RECIPES: Record<Exclude<TextureStep, 'none'>, {
  type: 'fractalNoise' | 'turbulence';
  baseFrequency: string;
  numOctaves: string;
  seed: string;
  baseScale: number;
  margin: number;
  blur?: number;
}> = {
  light:        { type: 'fractalNoise', baseFrequency: '0.04',       numOctaves: '2', seed: '7',   baseScale: 1.2, margin: 5  },
  heavy:        { type: 'fractalNoise', baseFrequency: '0.06',       numOctaves: '3', seed: '13',  baseScale: 2.5, margin: 8  },
  chalky:       { type: 'fractalNoise', baseFrequency: '0.08',       numOctaves: '4', seed: '29',  baseScale: 3.5, margin: 12 },
  'paper-tooth':{ type: 'fractalNoise', baseFrequency: '0.18',       numOctaves: '2', seed: '41',  baseScale: 1.4, margin: 6  },
  ribbed:       { type: 'fractalNoise', baseFrequency: '0.02 0.6',   numOctaves: '2', seed: '53',  baseScale: 2.2, margin: 8  },
  stipple:      { type: 'fractalNoise', baseFrequency: '0.45',       numOctaves: '3', seed: '67',  baseScale: 1.6, margin: 6  },
  'wet-ink':    { type: 'fractalNoise', baseFrequency: '0.05',       numOctaves: '2', seed: '79',  baseScale: 1.3, margin: 8, blur: 0.4 },
  smudge:       { type: 'fractalNoise', baseFrequency: '0.025 0.12', numOctaves: '3', seed: '89',  baseScale: 4.2, margin: 12 },
  canvas:       { type: 'turbulence',   baseFrequency: '0.22',       numOctaves: '2', seed: '103', baseScale: 1.8, margin: 8  },
};

/** Displacement scale for the recipe-driven texture filter.
 *
 *  2026-06-11 slider-sweep fix-now #3 (audit-runs/2026-06-11-slider-sweep/
 *  REPORT.md §12): the pure `baseScale × intensity` product left every
 *  low-baseScale recipe (light 1.2 / wet-ink 1.3 / paper-tooth 1.4) sub-pixel
 *  until intensity ~2 — texture `light` at the DEFAULT intensity 1.0 was
 *  byte-identical to texture OFF (the user picks a texture and sees nothing).
 *  Fix: an additive visibility ramp that reaches its full 1.6 offset by
 *  intensity 0.4, so every recipe is subtle-but-present at 1.0 (light:
 *  scale 1.2 → 2.8, ≈ today's intensity-2.3 look) while intensity 0 still
 *  means OFF and the per-recipe growth slope stays monotonic — no new flat
 *  zone anywhere in the range. Deterministic (pure function of slider state).
 *
 *  `stipple` keeps the pure multiplicative form: its prominence is owned by
 *  the dotSize/dotScatter axes, and the newsprint + stipple PRESETS ship this
 *  texture — adding the ramp would jump both presets (no-jump constraint;
 *  verified byte-identical in the rock-3 before/after capture). */
function textureDisplacementScale(
  baseScale: number,
  m: F3ModifiersState,
  activeTexture: Exclude<TextureStep, 'none'>,
): number {
  if (activeTexture === 'stipple') {
    return baseScale * m.textureIntensity * (m.dotSize * (0.4 + 2.0 * m.dotScatter));
  }
  return baseScale * m.textureIntensity + 1.6 * Math.min(1, m.textureIntensity / 0.4);
}

// ─── NEWSPRINT DOT SCREEN — real per-layout dot geometry ───────────────────
//
// 2026-06-10: dotPattern ('grid' | 'staggered' | 'random' | 'concentric')
// was a dead control — state + chrome existed but nothing consumed it. It
// now drives a REAL SVG <pattern> tile of dot circles, applied to the
// newsprint render as a luminance-mask KNOCKOUT: paper shows through the
// ink in the chosen dot arrangement (the white-dot screen visible in
// printed solids). Knockout-over-ink was chosen over "render the image AS
// dots" (feComposite operator="in") because it COMPOSES with the existing
// feTurbulence stipple displacement instead of replacing it — that keeps
// the 'staggered' default as close as possible to the pre-change newsprint
// look (same grain, plus a subtle true halftone perforation).
//
// Cluster note (09-LOCKED-MODEL I-13): dotSize / dotSpacing / dotScatter /
// dotPattern all live in Cluster 4 (Surface Texture) and compose — radius
// from dotSize, pitch from dotSpacing, and the 'random' layout's jitter
// amplitude rides dotScatter.
//
// Determinism: 'random' uses this file's seeded-noise idiom
// (seededRandom(<fixed seed>)) — identical layout every render, no
// Math.random(). All other layouts are closed-form.
//
// Mask fills below are luminance values (white = keep ink, black = punch
// hole), NOT ink colors — W1 palette tokens deliberately don't apply here
// (same reasoning as feedback_media_overlay_ink_doesnt_flip: these aren't
// page-direction inks).

interface DotScreenTile {
  tileW: number;
  tileH: number;
  dots: { cx: number; cy: number; r: number }[];
}

function buildNewsprintDotTile(
  pattern: DotPatternStep,
  dotSpacing: number,
  dotSize: number,
  dotScatter: number,
): DotScreenTile {
  const s = Math.max(1, dotSpacing); // pitch (user-space px, same units the feTurbulence baseFrequency operates in)
  // Cap radius at 0.45·pitch so dots can never fuse into full-coverage
  // knockout (dotSize 6 at dotSpacing 1 would otherwise erase the graphic).
  const r = Math.min(Math.max(dotSize, 0.3), s * 0.45);
  const dots: DotScreenTile['dots'] = [];

  switch (pattern) {
    case 'grid':
      // Aligned rows + columns — one dot per s×s cell. Machine-set register.
      return { tileW: s, tileH: s, dots: [{ cx: s / 2, cy: s / 2, r }] };
    case 'staggered':
      // Classic halftone: alternate rows offset by half a pitch. The
      // second-row dots sit ON the vertical tile edges (cx = 0 and s) — the
      // clipped halves rejoin seamlessly when the pattern tiles, the
      // standard polka-dot-tile trick. r ≤ 0.45s keeps rows from straddling
      // the horizontal edges.
      return {
        tileW: s,
        tileH: 2 * s,
        dots: [
          { cx: s / 2, cy: s / 2, r },
          { cx: 0, cy: (3 * s) / 2, r },
          { cx: s, cy: (3 * s) / 2, r },
        ],
      };
    case 'random': {
      // Hand-stippled: one dot per s×s sub-cell of a 4s×4s tile, jittered
      // off-center via the seeded-noise idiom. Jitter half-range rides
      // dotScatter (Cluster 4 composition; newsprint chrome doesn't expose
      // the slider yet so this sits at the 0.3 default ≈ 0.55·pitch).
      // Positions clamp fully inside the tile so circles never straddle
      // edges — tiling stays seamless. Layout repeats every 4 pitches,
      // acceptable at doodle scale.
      const rand = seededRandom(6767);
      const tile = 4 * s;
      const amp = s * (0.35 + 0.65 * dotScatter);
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const cx = (col + 0.5) * s + (rand() - 0.5) * 2 * amp;
          const cy = (row + 0.5) * s + (rand() - 0.5) * 2 * amp;
          dots.push({
            cx: Math.min(Math.max(cx, r), tile - r),
            cy: Math.min(Math.max(cy, r), tile - r),
            r,
          });
        }
      }
      return { tileW: tile, tileH: tile, dots };
    }
    case 'concentric':
    default: {
      // Dots along concentric rings: radius step = pitch, ~one dot per
      // pitch of arc length (round(2πk)), deterministic per-ring phase
      // rotation so dots don't align radially. Rings cap at the largest
      // radius fully inside the 6s×6s tile, so the tiled result reads as
      // repeating ring medallions (a real circular-screen register).
      // `default` rides this case so a future DotPatternStep addition
      // degrades visibly instead of returning undefined.
      const tile = 6 * s;
      const c = tile / 2;
      const maxK = Math.floor((c - r) / s);
      for (let k = 0; k <= maxK; k++) {
        if (k === 0) {
          dots.push({ cx: c, cy: c, r });
          continue;
        }
        const count = Math.max(1, Math.round(2 * Math.PI * k));
        const phase = k * 0.7; // fixed per-ring rotation — deterministic
        for (let i = 0; i < count; i++) {
          const a = phase + (i / count) * 2 * Math.PI;
          dots.push({ cx: c + k * s * Math.cos(a), cy: c + k * s * Math.sin(a), r });
        }
      }
      return { tileW: tile, tileH: tile, dots };
    }
  }
}

export function TextureFilterDefs() {
  const { state: style } = useF3SvgStyle();
  const { state: m } = useF3RoughModifiers();

  const activeTexture = m.texture !== 'none' ? m.texture : null;
  const recipe = activeTexture ? TEXTURE_RECIPES[activeTexture] : null;
  const margin = recipe ? recipe.margin : 8;

  // Newsprint dot screen — rebuilt only when its Cluster-4 inputs change.
  const dotScreen = useMemo(
    () => (style === 'newsprint' ? buildNewsprintDotTile(m.dotPattern, m.dotSpacing, m.dotSize, m.dotScatter) : null),
    [style, m.dotPattern, m.dotSpacing, m.dotSize, m.dotScatter],
  );

  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {/* Skip the recipe-driven filter for charcoal + wet-ink — those styles
            have dedicated <filter> blocks below with the right params, and
            buildDynamicFilterId returns the SAME id for both paths so the DOM
            would have two filters with the same id (browser honors only one,
            usually the recipe one, swallowing the dedicated filter's color-
            matrix + extra feTurbulence stages). Surfaced by /audit 2026-06-08
            when wet-ink looked identical to clean despite the dedicated filter
            apparently being defined. */}
        {recipe && activeTexture && style !== 'charcoal' && style !== 'wet-ink' && (
          <filter
            id={buildDynamicFilterId(style, m)}
            x={`${-margin}%`}
            y={`${-margin}%`}
            width={`${100 + margin * 2}%`}
            height={`${100 + margin * 2}%`}
          >
            {recipe.blur !== undefined && (
              <feGaussianBlur in="SourceGraphic" stdDeviation={recipe.blur * m.textureIntensity} result="blurred" />
            )}
            {/* baseFrequency drives the dot/grain density. For the 'stipple'
                texture (newsprint + stipple style), let dotSpacing modulate
                it — higher dotSpacing = lower frequency = larger / sparser
                dots. dotSpacing default = 4; scale inverse-linearly.
                dotScatter (2026-06-10, Cluster 4 Surface Texture per
                09-LOCKED-MODEL I-13 — dotSize/dotSpacing/dotScatter/dotPattern
                compose): secondary axis here is a frequency jitter term
                (0.85 + 0.5·scatter) — higher scatter breaks the dot rhythm
                into finer, less even cells. Term is exactly 1.0 at the 0.3
                default, so preset defaults render pixel-identical.
                Deterministic: pure function of the slider value; the
                feTurbulence seed stays the fixed recipe seed (67). */}
            <feTurbulence
              type={recipe.type}
              baseFrequency={
                activeTexture === 'stipple'
                  ? String(((parseFloat(recipe.baseFrequency) * 4) / Math.max(1, m.dotSpacing)) * (0.85 + 0.5 * m.dotScatter))
                  : recipe.baseFrequency
              }
              numOctaves={recipe.numOctaves}
              seed={recipe.seed}
              result="noise"
            />
            {/* dotSize amplifies the displacement scale on stipple texture
                so the user can dial the dot/grain prominence. Multiplier is
                m.dotSize directly (default 1.0-1.2 → near baseline).
                dotScatter (2026-06-10) — PRIMARY "dots placed by hand vs
                machine" axis: multiplies displacement scale by
                (0.4 + 2.0·scatter). At 0 marks barely displace (ordered,
                machine-set register); at 1 they push ~2.4× (heavy hand
                scatter). Exactly 1.0 at the 0.3 default — zero change at
                preset defaults. Displacement-scale mapping chosen over
                re-seeding / octave switching because it is continuous,
                deterministic, and reads as positional randomness rather than
                a density change. NO collision with lib/patchRoughDots.ts —
                that patch seeds the rough.js dots FILLER (fill-mark
                geometry); this modulates the raster texture filter layered
                on top. Different layers, both seeded. */}
            <feDisplacementMap
              in={recipe.blur !== undefined ? 'blurred' : 'SourceGraphic'}
              in2="noise"
              scale={textureDisplacementScale(recipe.baseScale, m, activeTexture)}
            />
          </filter>
        )}
        {style === 'charcoal' && (
          <filter id={buildDynamicFilterId('charcoal', m)} x="-14%" y="-14%" width="128%" height="128%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={`${0.03 + m.grainIntensity * 0.02} ${0.03 + m.grainIntensity * 0.02 + m.smudgeAmount * 0.05}`}
              numOctaves="3"
              seed="29"
              result="noise"
            />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={(1.5 + m.grainIntensity * 1.0 + m.smudgeAmount * 1.5) * m.textureIntensity} result="displaced" />
            {m.pressureVariance > 0 && (
              <>
                <feTurbulence type="fractalNoise" baseFrequency={0.4 + m.pressureVariance * 0.3} numOctaves="2" seed="37" result="pressureNoise" />
                <feDisplacementMap in="displaced" in2="pressureNoise" scale={m.pressureVariance * 3 * m.textureIntensity} />
              </>
            )}
          </filter>
        )}
        {style === 'wet-ink' && (
          <filter id={buildDynamicFilterId('wet-ink', m)} x="-14%" y="-14%" width="128%" height="128%">
            {/* WET-INK FILTER — rewritten 2026-06-08 after Sebs flagged the
                prior version as "just a blur mask over everything." The fix:
                keep SourceGraphic CRISP, build a soft bleed halo by
                dilating + blurring + fading + displacing, then composite
                source ON TOP of the halo. Result: crisp stroke with
                capillary-bleed shadow behind it — actual wet-ink character,
                not uniform softness. */}
            {/* 1. Dilate strokes by `bleed × 1.5` px → halo's spread. */}
            <feMorphology
              in="SourceGraphic"
              operator="dilate"
              radius={m.bleed * 1.5 * m.textureIntensity}
              result="dilated"
            />
            {/* 2. Blur the dilated mask by `blurAmount` → halo softness. */}
            <feGaussianBlur
              in="dilated"
              stdDeviation={m.blurAmount * m.textureIntensity}
              result="haloBlurred"
            />
            {/* 3. Paper-grain displacement on the halo only (not source). */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency={0.04 + m.bleed * 0.06}
              numOctaves="2"
              seed="79"
              result="paperGrain"
            />
            <feDisplacementMap
              in="haloBlurred"
              in2="paperGrain"
              scale={(1.0 + m.bleed * 2.0) * m.textureIntensity}
              result="haloDisplaced"
            />
            {/* 4. Drop halo alpha so it reads as bleed-through, not a stroke. */}
            <feColorMatrix
              in="haloDisplaced"
              type="matrix"
              values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${0.45 + m.bleed * 0.25} 0`}
              result="haloFaded"
            />
            {/* 5. Composite crisp source OVER the bleed halo. */}
            <feComposite
              in="SourceGraphic"
              in2="haloFaded"
              operator="over"
            />
          </filter>
        )}
        {/* NEWSPRINT DOT SCREEN — consumed via mask="url(#dd-newsprint-dot-
            mask)" set in applyTexture(). Same document-wide-defs mechanism
            as the filters above. patternUnits/maskUnits are userSpaceOnUse
            so dotSpacing means viewBox px — the same space dotSpacing
            already drives in the stipple feTurbulence recipe. The mask
            cover spans -1024..3072 user units, far beyond any doodle /
            canvas viewBox today; bump if a giant canvas ever exceeds it.
            85%-black dots on white = soft luminance knockout (15% ink
            survives inside each hole) — softer than a hard punch, closer
            to real newsprint show-through, and keeps the staggered default
            near the pre-change look. */}
        {dotScreen && (
          <>
            <pattern
              id="dd-newsprint-dot-screen"
              patternUnits="userSpaceOnUse"
              width={dotScreen.tileW}
              height={dotScreen.tileH}
            >
              {dotScreen.dots.map((d, i) => (
                <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill="#000" fillOpacity={0.85} />
              ))}
            </pattern>
            <mask id="dd-newsprint-dot-mask" maskUnits="userSpaceOnUse" x={-1024} y={-1024} width={4096} height={4096}>
              {/* Luminance mask: white = keep ink, dark dots = paper-through
                  holes. NOT ink colors — W1 tokens don't apply (see
                  buildNewsprintDotTile header comment). */}
              <rect x={-1024} y={-1024} width={4096} height={4096} fill="#fff" />
              <rect x={-1024} y={-1024} width={4096} height={4096} fill="url(#dd-newsprint-dot-screen)" />
            </mask>
          </>
        )}
      </defs>
    </svg>
  );
}

// Suppress unused-import warnings for types that are exported through the
// public surface but not referenced in this file directly.
export type { F3SvgStyle, EndpointBehaviorStep, SketchingStyleStep, PenTipStep };
