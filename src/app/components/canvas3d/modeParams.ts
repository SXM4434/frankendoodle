// ─── modeParams — per-geometry-mode 3D control params (pure data + math) ────
// Implements docs/design/3d-mode-controls-spec.md §2 (the round-7 contract):
// every control, range, step and default below is from that spec's tables —
// FULL sets, never trimmed (feedback_more_toggle_options_better + Sebs round 7
// "each of these 3D modes should have their nice range of toggles").
//
// PURITY CONTRACT: no React, no DOM, **no three, no lib/geometry3d imports** —
// this module is consumed by the chrome (main chunk) AND the lazy 3D scene.
// Importing lib/geometry3d/strokeTo3d here would drag `three` into the main
// chunk and defeat the React.lazy split (DeskDoodlesCanvas.tsx plan §2.3).
// Default values that mirror strokeTo3d constants are therefore duplicated as
// literals WITH provenance; Stroke3DScene dev-asserts they stay in sync.
//
// PROVENANCE: free-stroke origin/main lib/geometry-engines.ts (read via
// `git show` — spec §7 line refs) · desk-doodles strokeTo3d.ts constants ·
// unit conversion ×8/3 locked in the spec §0.4 (FS maps longest side → 3
// world units; we map 800px → 8).

// ─── Tier-2 style families (3d-mode-controls-spec THREE-TIER AMENDMENT) ─────
// Discrete per-mode "look" pickers, distinct from the Tier-3 sliders. String
// unions mirror the geometry3d option types (duplicated here as literals —
// this module must stay three-free; Stroke3DScene dev-asserts geometry3d
// agreement where defaults overlap). Family value lists LOCK only after
// Sebs eyeballs the render boards (tools/3d/tier2-board).

export type RodCapStyle3D = 'round' | 'flat' | 'ink-blob';
export type RodJointStyle3D = 'blob' | 'clean';
export type ExtrudeBevelProfile3D = 'sharp' | 'soft' | 'rounded';
export type ExtrudeSideWall3D = 'straight' | 'drafted';
export type InflateProfileFamily3D = 'balloon' | 'cushion' | 'bead';
export type SolidEdge3D = 'crisp' | 'eased';

export type FamilyOption3D<T extends string> = { value: T; label: string; title: string };

export const ROD_CAP_STYLE_OPTIONS: FamilyOption3D<RodCapStyle3D>[] = [
  { value: 'round', label: 'Round', title: 'Inset sphere cap — the FS rounded ink tip (today)' },
  { value: 'flat', label: 'Flat', title: 'Flush disk cap — crisp chopped marker end' },
  { value: 'ink-blob', label: 'Ink blob', title: 'Swollen bead at the very tip — the nib-rest ink pool' },
];
export const ROD_JOINT_STYLE_OPTIONS: FamilyOption3D<RodJointStyle3D>[] = [
  { value: 'blob', label: 'Blob', title: 'Spheres fill the corner creases — the FS ink-blob feel (today)' },
  { value: 'clean', label: 'Clean', title: 'No joint spheres — clean mitered corner read' },
];
export const EXTRUDE_BEVEL_PROFILE_OPTIONS: FamilyOption3D<ExtrudeBevelProfile3D>[] = [
  { value: 'sharp', label: 'Sharp', title: 'No bevel — hard 90° die-cut edge' },
  { value: 'soft', label: 'Soft', title: 'Single chamfer — cut corner, no curve' },
  { value: 'rounded', label: 'Rounded', title: 'Curved 3-segment rim band — the pressed-cookie read (today)' },
];
export const EXTRUDE_SIDE_WALL_OPTIONS: FamilyOption3D<ExtrudeSideWall3D>[] = [
  { value: 'straight', label: 'Straight', title: 'Vertical side walls (today)' },
  { value: 'drafted', label: 'Drafted', title: 'Walls taper toward the back — pressed/molded read' },
];
export const INFLATE_PROFILE_FAMILY_OPTIONS: FamilyOption3D<InflateProfileFamily3D>[] = [
  { value: 'balloon', label: 'Balloon', title: 'Full round middle, tuned default profile (today)' },
  { value: 'cushion', label: 'Cushion', title: 'Pressed-flat plateau — pillow read' },
  { value: 'bead', label: 'Bead', title: 'Tighter pointed bulb — glass-bead read' },
];
export const SOLID_EDGE_OPTIONS: FamilyOption3D<SolidEdge3D>[] = [
  { value: 'crisp', label: 'Crisp', title: 'No bevel — die-cut rim' },
  { value: 'eased', label: 'Eased', title: 'Rounded rim band (today)' },
];

/** Inflate family → engine preset: presets OVER the Puff curve (the slider
 *  keeps working inside every family). profileExp drives the longitudinal
 *  sin(πt)^exp taper in buildInflateGeometry (default 0.8 = strokeTo3d
 *  INFLATE_PROFILE_EXP, provenance comment there); aspectScale multiplies
 *  the puff-derived Z aspect. */
export const INFLATE_PROFILE_FAMILY_PRESETS: Record<
  InflateProfileFamily3D,
  { profileExp: number; aspectScale: number }
> = {
  balloon: { profileExp: 0.8, aspectScale: 1.0 }, // strokeTo3d INFLATE_PROFILE_EXP — today
  cushion: { profileExp: 0.5, aspectScale: 0.58 }, // fuller plateau, pressed flat
  bead: { profileExp: 1.7, aspectScale: 1.12 }, // pointier taper, rounder section
};

// ─── Param state shapes (spec §2.1–2.4 + Tier-2 families) ───────────────────

export type RodParams3D = {
  /** Tube half-thickness, world units (spec §2.1 / FS TUBE_RADIUS ×8/3). */
  radius: number;
  /** End caps on/off (off = open tube ends — Tier-3 toggle, spec §2.1). */
  caps: boolean;
  /** Tier-2 cap family (applies while caps are on). */
  capStyle: RodCapStyle3D;
  /** Tier-2 joint family — 'blob' = FS joint spheres, 'clean' = none.
   *  (Replaces the old jointBlobs boolean.) */
  jointStyle: RodJointStyle3D;
  /** Corner angle (deg) that earns a blob — lower = blobbier. */
  jointSensitivityDeg: number;
};

export type ExtrudeParams3D = {
  /** Perceptual width slider t ∈ 0..1 — quadratic map, see extrudeWidthFromSlider. */
  width: number;
  /** Width-relative depth multiplier (decoupled — depth never bloats XY). */
  depthMult: number;
  /** Tier-2 bevel profile family (replaces the old bevel boolean; 'sharp' =
   *  off). Auto-falls to sharp below EXTRUDE_TINY_WIDTH (chip, never silent). */
  bevelProfile: ExtrudeBevelProfile3D;
  /** Tier-2 side-wall family. */
  sideWall: ExtrudeSideWall3D;
};

export type InflateParams3D = {
  /** Mid-stroke fullness (XY radius around centerline), world units. */
  baseRadius: number;
  /** End-taper floor — never 0 (degenerate rings). */
  tipRadius: number;
  /** How strongly stylus pressure (0..1, neutral 0.5) scales local radius. */
  pressureInfluence: number;
  /** Z-aspect / cross-section roundness — FS feel bundle, one slider (D-A). */
  puff: number;
  /** Tier-2 profile family — discrete presets over the Puff curve. */
  profileFamily: InflateProfileFamily3D;
};

export type SolidParams3D = {
  /** Half-width of the stamped ink body each stroke contributes, world units. */
  inkRadius: number;
  /** Z extrusion of the fused silhouette, world units. */
  depth: number;
  /** Preserve interior holes (donut stays a donut) vs filled silhouette (D-B). */
  holes: boolean;
  /** Tier-2 edge family. */
  edge: SolidEdge3D;
};

export type Mode3DParams = {
  rod: RodParams3D;
  extrude: ExtrudeParams3D;
  inflate: InflateParams3D;
  solid: SolidParams3D;
};

// ─── Defaults (spec §2 tables — each literal's provenance beside it) ────────

export const DEFAULT_MODE3D_PARAMS: Mode3DParams = {
  rod: {
    radius: 0.032, // strokeTo3d ROD_RADIUS (FS TUBE_RADIUS 0.012 ×8/3)
    caps: true,
    capStyle: 'round', // today's FS inset-sphere cap
    jointStyle: 'blob', // today's FS joint spheres
    jointSensitivityDeg: 40, // strokeTo3d JOINT_ANGLE_THRESHOLD_DEG (FS verbatim)
  },
  extrude: {
    width: 0.5, // mid-slider = FS's tuned "clean default" (mapExtrudeWidthSlider)
    depthMult: 1.0, // FS anchor: "as deep as half-wide"
    bevelProfile: 'rounded', // today's EXTRUDE_BEVEL_* constants
    sideWall: 'straight',
  },
  inflate: {
    baseRadius: 0.22, // strokeTo3d INFLATE_BASE_RADIUS
    tipRadius: 0.035, // strokeTo3d INFLATE_TIP_RADIUS
    pressureInfluence: 0.35, // strokeTo3d INFLATE_PRESSURE_INFLUENCE
    puff: 0.5, // FS inflateBuildStaticGeometries neutral
    profileFamily: 'balloon', // today's INFLATE_PROFILE_EXP read
  },
  solid: {
    inkRadius: 0.08, // strokeTo3d SOLID_INK_RADIUS
    depth: 0.48, // spec §2.4 (≈ today's EXTRUDE_DEPTH 0.5 look, FS ×8/3 family)
    holes: true, // D-B recommendation: ON — donuts stay donuts
    edge: 'eased', // today's rounded rim
  },
};

// ─── Chrome slider specs (spec §2 ranges/steps — the chrome renders FROM this) ──

export type Param3DSliderSpec = {
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  precision?: number;
  title: string;
};

export const ROD_SLIDER_SPECS = {
  radius: {
    label: 'Radius',
    // RC-4(b): min raised 0.01 → 0.016 = strokeTo3d ROD_RADIUS_FLOOR (kept in
    // sync as a literal — this module is three/geometry3d-free per the purity
    // contract; the engine also clamps, so a stale UI min can never overflow).
    // Below the floor a thin rod collapses toward a 1-D line and the
    // framing-aware camera still needs the form to have real cross-section.
    min: 0.016,
    max: 0.128, // D-E: 4× default — past that rods read as worms and swallow joints
    step: 0.002,
    precision: 3,
    title: 'Tube half-thickness of the ink line (world units)',
  },
  jointSensitivityDeg: {
    label: 'Joint sensitivity',
    min: 20,
    max: 70,
    step: 5,
    unit: '°',
    title: 'Corner angle that earns a blob — lower = blobbier',
  },
} as const satisfies Record<string, Param3DSliderSpec>;

export const EXTRUDE_SLIDER_SPECS = {
  width: {
    label: 'Width',
    min: 0,
    max: 1,
    step: 0.01,
    precision: 2,
    title:
      'Perceptual width — mid-slider is the tuned clean default; the last ~25% reaches chunky territory (FS quadratic map)',
  },
  depthMult: {
    label: 'Depth',
    min: 0.1,
    max: 4.0,
    step: 0.05,
    unit: '×',
    precision: 2,
    title:
      'Width-relative depth multiplier, decoupled: 0.25 shallow · 1.0 as-deep-as-half-wide · 4.0 max',
  },
} as const satisfies Record<string, Param3DSliderSpec>;

export const INFLATE_SLIDER_SPECS = {
  baseRadius: {
    label: 'Base radius',
    min: 0.06,
    max: 0.45,
    step: 0.01,
    precision: 2,
    title: 'Mid-stroke fullness; auto-clamped to 0.35× arc length so short strokes stay blobs',
  },
  tipRadius: {
    label: 'Tip radius',
    min: 0.01,
    max: 0.15,
    step: 0.005,
    precision: 3,
    title: 'End-taper floor — never 0 (degenerate rings)',
  },
  pressureInfluence: {
    label: 'Pressure',
    min: 0,
    max: 1,
    step: 0.05,
    precision: 2,
    title: 'How strongly stylus pressure scales local radius — the hand survives into the volume',
  },
  puff: {
    label: 'Puff',
    min: 0,
    max: 1,
    step: 0.05,
    precision: 2,
    title: 'Z-aspect / cross-section roundness — sqrt-eased aspect 0.34→1.55 (FS feel bundle, D-A)',
  },
} as const satisfies Record<string, Param3DSliderSpec>;

export const SOLID_SLIDER_SPECS = {
  inkRadius: {
    label: 'Ink radius',
    min: 0.03,
    max: 0.2,
    step: 0.005,
    precision: 3,
    title: 'Half-width of the ink body each stroke stamps into the fused mass',
  },
  depth: {
    label: 'Depth',
    min: 0.05,
    max: 1.35,
    step: 0.025,
    precision: 3,
    title: 'Z extrusion of the fused silhouette',
  },
} as const satisfies Record<string, Param3DSliderSpec>;

// ─── Extrude perceptual maps — PORT of FS mapExtrudeWidthSlider (spec §2.2) ──
// FS native: exp 2.0, floor 0.020, ceil 0.080, effective clamp 0.010–0.085.
// DD (×8/3): floor 0.0533, ceil 0.2133, clamp 0.0267–0.2267.
// Anchor table (FS → DD): t=0 → 0.053 · 0.25 → 0.064 · 0.5 → 0.093 (default) ·
// 0.75 → 0.144 · 1.0 → 0.213.

export const EXTRUDE_WIDTH_EXP = 2.0;
export const EXTRUDE_WIDTH_FLOOR = 0.02 * (8 / 3); // 0.0533
export const EXTRUDE_WIDTH_CEIL = 0.08 * (8 / 3); // 0.2133
export const EXTRUDE_WIDTH_CLAMP_MIN = 0.01 * (8 / 3); // 0.0267
export const EXTRUDE_WIDTH_CLAMP_MAX = 0.085 * (8 / 3); // 0.2267

/** Quadratic perceptual map: slider t ∈ 0..1 → ribbon half-width (world). */
export function extrudeWidthFromSlider(t: number): number {
  const tt = Math.min(Math.max(t, 0), 1);
  const w = EXTRUDE_WIDTH_FLOOR + (EXTRUDE_WIDTH_CEIL - EXTRUDE_WIDTH_FLOOR) * Math.pow(tt, EXTRUDE_WIDTH_EXP);
  return Math.min(Math.max(w, EXTRUDE_WIDTH_CLAMP_MIN), EXTRUDE_WIDTH_CLAMP_MAX);
}

/** Inverse (debug readout — FS extrudeWidthToSlider ports too, spec §2.2). */
export function extrudeWidthToSlider(width: number): number {
  const w = Math.min(Math.max(width, EXTRUDE_WIDTH_FLOOR), EXTRUDE_WIDTH_CEIL);
  return Math.sqrt((w - EXTRUDE_WIDTH_FLOOR) / (EXTRUDE_WIDTH_CEIL - EXTRUDE_WIDTH_FLOOR));
}

/** FS depth-multiplier block: effDepth = clamp(mult × effWidth, floor, ceil).
 *  FS world clamp 0.005–0.50 → DD ×8/3 = 0.0133–1.333. Depth never bloats XY;
 *  width never compresses Z (the decoupling is the port's whole point). */
export const EXTRUDE_DEPTH_CLAMP_MIN = 0.005 * (8 / 3); // 0.0133
export const EXTRUDE_DEPTH_CLAMP_MAX = 0.5 * (8 / 3); // 1.333

export function extrudeEffectiveDepth(widthSlider: number, depthMult: number): number {
  const effWidth = extrudeWidthFromSlider(widthSlider);
  return Math.min(Math.max(depthMult * effWidth, EXTRUDE_DEPTH_CLAMP_MIN), EXTRUDE_DEPTH_CLAMP_MAX);
}

/** FS tiny-width bevel auto-disable: FS 0.03 → DD 0.08 (spec §2.2). The chrome
 *  surfaces this as a status chip — never silent. */
export const EXTRUDE_TINY_WIDTH = 0.03 * (8 / 3); // 0.08

export function extrudeBevelAutoDisabled(widthSlider: number): boolean {
  return extrudeWidthFromSlider(widthSlider) < EXTRUDE_TINY_WIDTH;
}

// ─── Inflate Puff map — FS inflateBuildStaticGeometries Z-aspect (spec §2.3) ─
// One slider, sqrt-eased: aspectZ 0.34 (flat pressed) → 1.55 (over-round).
// v1 NOTE (honest scope): the slider drives the PRIMARY axis of the FS feel
// bundle — the cross-section Z aspect, applied as a geometry-space Z scale
// (normals corrected via applyMatrix4's normal-matrix path). The bundle's four
// derived curves (profileExponent 2.1→3.4 · crossSectionBulge 0.07→0.28 ·
// capRoundness 0.6→1.0 · joinSoftness 0.45→0.85) live INSIDE the sweep loop
// that geometry3d/strokeTo3d owns — they ride in when buildInflateGeometry
// grows the corresponding options (cross-rock followup, noted in the rock
// report). Numbers preserved here so the wiring is a constant-lookup later.

export const INFLATE_PUFF_ASPECT_MIN = 0.34;
export const INFLATE_PUFF_ASPECT_MAX = 1.55;
/** The FS bundle constants, for the geometry3d option followup (verbatim). */
export const INFLATE_PUFF_BUNDLE = {
  profileExponent: [2.1, 3.4],
  crossSectionBulge: [0.07, 0.28],
  capRoundness: [0.6, 1.0],
  joinSoftness: [0.45, 0.85],
} as const;

/** sqrt-eased puff → cross-section Z aspect. */
export function inflatePuffAspectZ(puff: number): number {
  const t = Math.min(Math.max(puff, 0), 1);
  return INFLATE_PUFF_ASPECT_MIN + (INFLATE_PUFF_ASPECT_MAX - INFLATE_PUFF_ASPECT_MIN) * Math.sqrt(t);
}

// ─── Solid calibration note (spec §2.4) ─────────────────────────────────────
// The spec's FS provenance carries slider eases (ink ^1.35, depth ^1.2 — FS
// maps slider px → effective px non-linearly). v1 keeps the sliders LINEAR in
// world units so the readout is the truth (the ranges/defaults above are the
// spec's own world-unit table and preserve today's tuned defaults exactly).
// The ease is a feel-calibration pass (project_f3_slider_recalibration_pending
// family) — single-function change here when it lands.

export const SOLID_EASE_NOTE = 'linear-v1' as const;
