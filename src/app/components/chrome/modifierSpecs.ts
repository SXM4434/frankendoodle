// Modifier specs + per-style modifier sets — VERBATIM port from Hero8Shell.tsx
// lines 114-158 (commit 48a6d8c^). Source of truth for the chrome layout.
//
// Don't drift from these. If a slider's max needs to change, change it in
// Hero8Shell first (it's the locked spec), then mirror here.
import type { F3SvgStyle } from '../../state/F3SvgStyleContext';

// SLIDER_SPECS — per-modifier (min, max, step). Recalibrated 2026-06-02 per
// F3-shading-calibration-spec.md §3 for each slider's USEFUL working zone.
export const SLIDER_SPECS = {
  // I-11: master proportion-preserving multiplier on HAND_FEEL_BASE.
  // > 1.4 enters Excalidraw signature zone (slider styling shows warn).
  wobble:            { min: 0,    max: 2.0, step: 0.05 },
  jaggedness:        { min: 0,    max: 2.0, step: 0.05 },
  // Simplify — post-stroke fidelity slider (doc 22 §4.2/§4.3). s ∈ [0,2],
  // mapped to RDP ε via ε(s) = 3.0 × 4^(s−1) in SvgStyleTransform; s = 1.0
  // ≡ ε = 3.0 (pixel-identical to today). Same 41-tick shape as wobble.
  simplification:    { min: 0,    max: 2.0, step: 0.05 },
  bowing:            { min: 0,    max: 2.5, step: 0.05 },
  strokeWidth:       { min: 0.5,  max: 3.0, step: 0.05 },
  curveDamp:    { min: 0,    max: 1.5, step: 0.02 },
  hachureGap:        { min: 1,    max: 12,  step: 0.25 },
  hachureAngle:      { min: -90,  max: 90,  step: 1    },
  fillDensity:       { min: 0,    max: 1.2, step: 0.02 },
  inkIntensity:      { min: 0,    max: 1,   step: 0.01 },
  fillOpacity:       { min: 0,    max: 1,   step: 0.01 },
  blurAmount:        { min: 0,    max: 1.5, step: 0.05 },
  bleed:             { min: 0,    max: 1,   step: 0.02 },
  dotSize:           { min: 0.3,  max: 6,   step: 0.1  },
  dotSpacing:        { min: 1,    max: 20,  step: 0.25 },
  dotScatter:        { min: 0,    max: 1,   step: 0.02 },
  grainIntensity:    { min: 0,    max: 2.5, step: 0.05 },
  smudgeAmount:      { min: 0,    max: 2,   step: 0.05 },
  pressureVariance:  { min: 0,    max: 1,   step: 0.02 },
  offsetDistance:    { min: 0,    max: 6,   step: 0.25 },
  offsetAngle:       { min: -180, max: 180, step: 1    },
  colorShift:        { min: 0,    max: 1,   step: 0.02 },
  registrationError: { min: 0,    max: 1.5, step: 0.05 },
  textureIntensity:  { min: 0,    max: 3,   step: 0.05 },
} as const;

export const UNIVERSAL_MODIFIERS = ['inkIntensity', 'fillOpacity', 'strokePalette', 'fillPalette', 'texture', 'textureIntensity'] as const;

// Per-style declared modifier set — chrome only renders the modifiers the
// active style uses.
export const MODIFIER_SETS_BY_STYLE: Record<F3SvgStyle, readonly string[]> = {
  'clean':           ['inkIntensity', 'fillOpacity', 'strokePalette', 'fillPalette', 'texture', 'textureIntensity'],
  'outline-only':    ['strokeWidth', 'inkIntensity', 'strokePalette', 'fillPalette', 'texture', 'textureIntensity'],
  // Rock Y 2026-06-12 — wireframe rebuilt as a REAL schematic register.
  // Honest set, nothing fake:
  //   strokeWidth    → THE uniform line weight, in screen px (the transform
  //                    sets vector-effect:non-scaling-stroke; hairline 0.75
  //                    default via STYLE_PRESETS)
  //   simplification → doc-22 Simplify, rides along: RDP on polyline geometry
  //                    (drawn strokes, traced M/L paths, polygons); curve
  //                    commands keep their true geometry
  //   fillOpacity    → fill-BOUNDARY line prominence (fills render as outline
  //                    lines at 0.75× weight; this slider is their
  //                    stroke-opacity — dial down for construction-line feel)
  //   inkIntensity   → universal wrapper opacity
  // Deliberately ABSENT (suppressed by the register, not hidden-but-active):
  // wobble/jaggedness/bowing/multiStroke/penTip/sketching (no hand-feel — the
  // branch never enters the rough pipeline), texture/textureIntensity
  // (applyTexture is skipped for wireframe), palettes (ink is fixed black —
  // the clean schematic counterpoint to every other style).
  'wireframe':       ['strokeWidth', 'simplification', 'fillOpacity', 'inkIntensity'],
  'wet-ink':         ['blurAmount', 'bleed', 'inkIntensity', 'fillOpacity', 'strokePalette', 'fillPalette', 'textureIntensity'],
  'charcoal':        ['grainIntensity', 'smudgeAmount', 'pressureVariance', 'inkIntensity', 'fillOpacity', 'strokePalette', 'fillPalette', 'textureIntensity'],
  // 2026-06-09: dotSize + dotSpacing now wired in TextureFilterDefs stipple
  // path (dotSize multiplies displacement scale, dotSpacing inverse-scales
  // baseFrequency). Newsprint exposes both so user can dial dot prominence.
  // 2026-06-10: dotPattern made REAL — drives the newsprint dot-screen
  // <pattern> layout (grid / staggered / random / concentric) built in
  // SvgStyleTransform's buildNewsprintDotTile + applied as a luminance mask
  // in applyTexture. Cluster 4 (Surface Texture) per 09-LOCKED-MODEL I-13 —
  // composes with dotSize (radius) / dotSpacing (pitch) / dotScatter
  // ('random' jitter amplitude).
  'newsprint':       ['dotSize', 'dotSpacing', 'dotPattern', 'inkIntensity', 'fillOpacity', 'strokePalette', 'fillPalette', 'texture', 'textureIntensity'],
  'risograph':       ['offsetDistance', 'offsetAngle', 'colorShift', 'risoSecondaryColor', 'registrationError', 'inkIntensity', 'fillOpacity', 'strokePalette', 'fillPalette', 'texture', 'textureIntensity'],
  // 2026-06-11: the dead `roughness` modifier field was DELETED entirely
  // (no chrome row, no consumer — rough.js's roughness is driven by
  // jaggedness). If a Cluster 4 Surface-Texture roughness knob is ever wired
  // (09-LOCKED-MODEL I-11), re-add a fresh field + SLIDER_SPEC + rows then.
  // simplification (Simplify) added 2026-06-11 (doc 22) — Cluster 0 geometry
  // resampling on drawn/uploaded paths; relevant wherever the path pipeline
  // runs (rough-handdrawn, sketchy, bold-ink, stipple).
  'rough-handdrawn': ['wobble', 'jaggedness', 'simplification', 'bowing', 'strokeWidth', 'curveDamp', 'multiStroke', 'endpointBehavior', 'sketchingStyle', 'penTip', 'fillStyle', 'hachureGap', 'hachureAngle', 'fillDensity', 'inkIntensity', 'fillOpacity', 'strokePalette', 'fillPalette', 'texture', 'textureIntensity'],
  'sketchy':         ['wobble', 'jaggedness', 'simplification', 'bowing', 'strokeWidth', 'curveDamp', 'multiStroke', 'endpointBehavior', 'sketchingStyle', 'penTip', 'inkIntensity', 'fillOpacity', 'strokePalette', 'fillPalette', 'texture', 'textureIntensity'],
  // bold-ink intentionally omits multiStroke — the style's identity IS
  // "no layered jitter" (preset locks multiStroke='off'). Showing the
  // dropdown would lie to the user (Bug D from audit 2026-06-08).
  'bold-ink':        ['wobble', 'simplification', 'strokeWidth', 'bowing', 'curveDamp', 'fillStyle', 'fillDensity', 'endpointBehavior', 'penTip', 'inkIntensity', 'fillOpacity', 'strokePalette', 'fillPalette', 'texture', 'textureIntensity'],
  // 2026-06-10: dotScatter made REAL — modulates the stipple texture recipe
  // in TextureFilterDefs (displacement scale ×(0.4 + 2.0·scatter), primary
  // axis; frequency jitter ×(0.85 + 0.5·scatter), secondary). 0 = machine-
  // set order, 1 = heavy hand scatter; both terms are exactly 1.0 at the
  // 0.3 default so defaults don't shift. Cluster 4 (Surface Texture) per
  // 09-LOCKED-MODEL I-13 — composes with dotSize/dotSpacing/dotPattern.
  // Distinct layer from the seeded rough.js dots FILLER (patchRoughDots.ts),
  // which dotScatter ALSO wires (2026-06-11: scales the seeded dots-fill
  // jitter range; visible where the dots fill runs with roughness > 0).
  'stipple':         ['wobble', 'jaggedness', 'simplification', 'bowing', 'strokeWidth', 'curveDamp', 'multiStroke', 'endpointBehavior', 'sketchingStyle', 'penTip', 'fillStyle', 'hachureGap', 'fillDensity', 'dotScatter', 'inkIntensity', 'fillOpacity', 'strokePalette', 'fillPalette', 'texture', 'textureIntensity'],
};
