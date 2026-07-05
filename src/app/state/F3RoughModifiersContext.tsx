import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// F3 SVG style modifier state — refactored 2026-06-01 per user direction.
//
// Continuous modifiers store NUMBERS (consumed by sliders in chrome).
// Discrete modifiers store ENUM STRINGS (consumed by dropdowns).
//
// Each style defines its own modifier set via STYLE_MODIFIER_SETS in
// SvgStyleTransform — chrome renders dynamically based on active style.

// ─── DISCRETE TYPES (dropdowns) ────────────────────────────────────────────

export type MultiStrokeStep =
  | 'off' | 'single' | 'double' | 'triple' | 'quad' | 'quint' | 'six' | 'heavy';
export const MULTI_STROKE_STEPS: MultiStrokeStep[] =
  ['off', 'single', 'double', 'triple', 'quad', 'quint', 'six', 'heavy'];

export type FillStyleStep =
  | 'none' | 'solid' | 'hachure' | 'cross-hatch' | 'dots' | 'zigzag' | 'dashed' | 'zigzag-line';
export const FILL_STYLE_STEPS: FillStyleStep[] =
  ['none', 'solid', 'hachure', 'cross-hatch', 'dots', 'zigzag', 'dashed', 'zigzag-line'];

export type PaletteModeStep =
  | 'source' | 'primary' | 'body' | 'body-soft' | 'secondary' | 'detail' | 'accent' | 'bg' | 'neutral' | 'inverted';
export const PALETTE_MODE_STEPS: PaletteModeStep[] =
  ['source', 'primary', 'body', 'body-soft', 'secondary', 'detail', 'accent', 'bg', 'neutral', 'inverted'];

// 10 SVG filter recipes ported from playground gate-a-ion-texture-and-pen-tip-research §3.
export type TextureStep =
  | 'none' | 'light' | 'heavy' | 'chalky' | 'paper-tooth' | 'ribbed' | 'stipple' | 'wet-ink' | 'smudge' | 'canvas';
export const TEXTURE_STEPS: TextureStep[] =
  ['none', 'light', 'heavy', 'chalky', 'paper-tooth', 'ribbed', 'stipple', 'wet-ink', 'smudge', 'canvas'];

// Dot pattern — for stipple / newsprint styles.
export type DotPatternStep = 'grid' | 'staggered' | 'random' | 'concentric';
export const DOT_PATTERN_STEPS: DotPatternStep[] = ['grid', 'staggered', 'random', 'concentric'];

// Endpoint corner treatment (ported from playground C3HandFeel.endpointBehavior).
export type EndpointBehaviorStep = 'clean' | 'protrude' | 'long-overshoot' | 'kink';
export const ENDPOINT_BEHAVIOR_STEPS: EndpointBehaviorStep[] = ['clean', 'protrude', 'long-overshoot', 'kink'];

// Multi-stroke layer pacing (ported from playground C3HandFeel.sketchingStyle).
export type SketchingStyleStep = 'single-pass' | 'loose-overlap' | 'parallel-pass' | 'cross-rotate';
export const SKETCHING_STYLE_STEPS: SketchingStyleStep[] = ['single-pass', 'loose-overlap', 'parallel-pass', 'cross-rotate'];

// Pen-tip preset (ported from playground PEN_TIP_PRESETS).
// 'plain' = no pen-tip variation (default rough.js stroke).
// Others use perfect-freehand for variable-width / textured strokes.
// Implementation: penTip != 'plain' replaces rough.js's stroke render with
// perfect-freehand polygon paths (penTipPath, handFeel.ts). All 8 presets are
// REAL and render visually distinct (verified 2026-06-11).
export type PenTipStep =
  | 'plain' | 'ballpoint' | 'fineliner' | 'pencil-hb' | 'pencil-2b' | 'felt-tip' | 'chisel' | 'charcoal';
export const PEN_TIP_STEPS: PenTipStep[] = ['plain', 'ballpoint', 'fineliner', 'pencil-hb', 'pencil-2b', 'felt-tip', 'chisel', 'charcoal'];

// PARKED 2026-06-03: ShadingScopeStep removed (over-shading 3-band approach reverted).
// Smart Hachure System redesign in progress — see Task #22.

// ─── NUMERIC MODIFIER STATE (sliders) ──────────────────────────────────────

export type F3ModifiersState = {
  // Universal numeric modifiers (multiple styles use these)
  /** Master proportion-preserving multiplier on HAND_FEEL_BASE per shape.
   *  0 = no jitter (clean baseline), 1.0 = playground calibration, 2.0 = doubly
   *  wobbly while preserving per-shape ratios (rect:oval:diamond:line:orthogonal).
   *  > 1.4 enters Excalidraw signature zone (chrome warn). Added 2026-06-04 per
   *  09-LOCKED-MODEL.md I-11 to restore playground's master dial. */
  wobble: number;           // 0 - 2
  /** Jaggedness — added 2026-06-08 per Sebs. Decoupled from wobble's amplitude:
   *  jaggedness controls how JAGGED vs SMOOTH the rendered path looks (sharp
   *  angle changes vs flowing curves). Same conceptual role as the original
   *  playground "rough.js roughness" knob — wobble = how far the line wanders,
   *  jaggedness = how jagged the wandering reads. Threaded into rough.js's
   *  `roughness` parameter (was driven by wobble). */
  jaggedness: number;       // 0 - 2
  /** Simplify — post-stroke geometry fidelity (Fidelity-class control, doc 22).
   *  Re-added 2026-06-11 after the Day 9 sweep removed it as a dead stub.
   *  Modulates the RDP epsilon on drawn/uploaded paths: maps s → ε via
   *  ε(s) = 3.0 × 4^(s−1), so s = 1.0 ≡ ε = 3.0 (today's pixel-identical
   *  behavior). s = 0 → faithful (ε 0.75, keeps every wiggle); s = 2 →
   *  essential (ε 12, smooths to clean lines). Display label "Simplify". */
  simplification: number;   // 0 - 2
  bowing: number;           // 0 - 5
  strokeWidth: number;      // 0.1 - 10
  curveDamp: number;   // 0 - 2
  hachureGap: number;       // 0.5 - 30
  hachureAngle: number;     // -90 - 90
  fillDensity: number;      // 0 - 3
  inkIntensity: number;     // 0 - 1   (applied as wrapper opacity)
  fillOpacity: number;      // 0 - 1   (applied via CSS var on inner fills)

  // Style-specific numeric modifiers
  blurAmount: number;       // 0 - 5   — wet-ink
  bleed: number;            // 0 - 1   — wet-ink (saturation drop)
  dotSize: number;          // 0.5 - 10 — stipple, newsprint
  dotSpacing: number;       // 1 - 30   — stipple, newsprint
  dotScatter: number;       // 0 - 1   — stipple
  grainIntensity: number;   // 0 - 5   — charcoal (feTurbulence scale)
  smudgeAmount: number;     // 0 - 5   — charcoal (asymmetric displacement)
  pressureVariance: number; // 0 - 1   — charcoal (stroke width variance)
  offsetDistance: number;   // 0 - 20  — risograph
  offsetAngle: number;      // -180 - 180 — risograph
  colorShift: number;       // 0 - 1   — risograph (saturation of secondary layer)
  /** Risograph secondary-layer color (§7.B-3). Was hardcoded #D4574A; now
   *  user-pickable from the palette token set. 'source' falls back to accent. */
  risoSecondaryColor: PaletteModeStep;
  registrationError: number;// 0 - 5   — risograph (random per-layer offset)
  /** Multiplies the active texture's displacement scale. 1 = playground baseline,
   *  0 = effectively off, 3 = very heavy. Universal modifier — affects whatever
   *  texture is selected. Lets the user dial light/medium/heavy on any texture. */
  textureIntensity: number; // 0 - 3   — multiplier on the active texture's scale

  // Discrete modifiers
  multiStroke: MultiStrokeStep;
  fillStyle: FillStyleStep;
  /** Stroke (outline) color override. 'source' = use SVG source color. */
  strokePalette: PaletteModeStep;
  /** Fill color override (affects fills + hachure-as-fill strokes). */
  fillPalette: PaletteModeStep;
  texture: TextureStep;
  dotPattern: DotPatternStep;
  // Playground-ported hand-feel toggles
  endpointBehavior: EndpointBehaviorStep;
  sketchingStyle: SketchingStyleStep;
  penTip: PenTipStep;
};

// Defaults match the rough-handdrawn preset baseline (other styles override
// when active — but state persists across style switches).
// Exported for the chrome's Reset button: reset = DEFAULT + style preset,
// so keys NO preset carries (penTip / endpointBehavior / sketchingStyle /
// palettes) actually reset too. Before 2026-06-11 Reset merged the preset
// onto CURRENT state, silently keeping those keys (Sebs: "reset doesn't work").
export const DEFAULT_MODIFIERS: F3ModifiersState = {
  wobble: 0.4,              // Start value per Sebs 2026-06-11 (calibration ratios I-11 unaffected)
  jaggedness: 0,            // Splinter is opt-in via slider, NOT default (2026-06-09 per Sebs)
  simplification: 1.0,      // ε(1.0) = 3.0 — pixel-identical to pre-slider behavior (doc 22 §4.8)
  bowing: 1.0,
  strokeWidth: 1.2,
  curveDamp: 0.3,           // Start value per Sebs 2026-06-11
  hachureGap: 4,
  hachureAngle: -41,
  fillDensity: 0.7,
  inkIntensity: 1.0,
  fillOpacity: 1.0,

  blurAmount: 0.4,
  bleed: 0,
  dotSize: 1.0,
  dotSpacing: 4,
  dotScatter: 0.3,
  grainIntensity: 2.5,
  smudgeAmount: 0,
  pressureVariance: 0,
  offsetDistance: 2,
  offsetAngle: 45,
  colorShift: 0.7,
  risoSecondaryColor: 'accent',
  registrationError: 0,
  textureIntensity: 1.0,

  multiStroke: 'double',
  fillStyle: 'hachure',
  strokePalette: 'source',
  fillPalette: 'source',
  texture: 'none',
  dotPattern: 'staggered',
  endpointBehavior: 'clean',
  sketchingStyle: 'single-pass',
  penTip: 'plain',
};

type Ctx = {
  state: F3ModifiersState;
  set: <K extends keyof F3ModifiersState>(key: K, value: F3ModifiersState[K]) => void;
  replace: (next: F3ModifiersState) => void;
  reset: () => void;
};

const F3RoughModifiersCtx = createContext<Ctx | null>(null);

export function F3RoughModifiersProvider({ children, devHook = false }: { children: ReactNode; devHook?: boolean }) {
  const [state, setState] = useState<F3ModifiersState>(DEFAULT_MODIFIERS);
  const set = <K extends keyof F3ModifiersState>(key: K, value: F3ModifiersState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };
  const replace = (next: F3ModifiersState) => setState(next);
  const reset = () => setState(DEFAULT_MODIFIERS);
  // DEV/TEST: the app-level provider exposes its setter on window so a headed-Chrome
  // OFAT harness can drive the 2D Shading sliders (which now also feed the 3D hatch).
  useEffect(() => {
    if (!devHook || typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).__dd_mods = {
      set: <K extends keyof F3ModifiersState>(k: K, v: F3ModifiersState[K]) => setState((p) => ({ ...p, [k]: v })),
      reset: () => setState(DEFAULT_MODIFIERS),
    };
  }, [devHook]);
  return <F3RoughModifiersCtx.Provider value={{ state, set, replace, reset }}>{children}</F3RoughModifiersCtx.Provider>;
}

export function useF3RoughModifiers(): Ctx {
  const v = useContext(F3RoughModifiersCtx);
  if (!v) throw new Error('useF3RoughModifiers must be used inside F3RoughModifiersProvider');
  return v;
}

/** Non-throwing variant — returns null outside a provider. For render paths that
 *  MAY mount without the provider (e.g. a 3D mount reused in a provider-less
 *  preview): fall back to DEFAULT_MODIFIERS so the 2D Shading sliders drive the
 *  3D hatch when present, and the byte-identical defaults apply when absent. */
export function useF3RoughModifiersOptional(): Ctx | null {
  return useContext(F3RoughModifiersCtx);
}

// Backwards-compat type alias used by render code (was F3RoughModifiersState).
export type F3RoughModifiersState = F3ModifiersState;
