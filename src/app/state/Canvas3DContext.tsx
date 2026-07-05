import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GeometryModeSetting } from '../lib/geometry3d/strokeTo3d';
import {
  DEFAULT_MODE3D_PARAMS,
  type ExtrudeParams3D,
  type InflateParams3D,
  type Mode3DParams,
  type RodParams3D,
  type SolidParams3D,
} from '../components/canvas3d/modeParams';
import {
  MODE_MATERIAL_DEFAULTS_3D,
  DEFAULT_NATIVE_PROPS_3D,
  type MaterialPresetId,
  type NativeProps3D,
} from '../components/canvas3d/materials3d';
import type { HatchGrammar, HatchDirection } from '../components/canvas3d/hatchMaterial';
import type { AiMeshMaterialMode } from '../components/canvas3d/aiMeshMaterial';
import { AI_MESH_DARK_DEFAULT, AI_MESH_CONTRAST_DEFAULT } from '../components/canvas3d/aiMeshMaterial';

// Canvas 3D controls — geometry mode + 3D style + per-mode param sets.
//
// Pattern-copy of F3SvgStyleContext (the house context template), extended for
// the round-7 chrome split (docs/design/3d-mode-controls-spec.md — THE
// contract; every range/default in modeParams.ts). Per the D-7 locked control
// model (docs/design/global-toggles-and-mixed-3d.md): the geometry control is
// Auto / Rod / Extrude / Inflate / Solid — "Auto" is just the default VALUE
// (the shape decides: open → rod, closed → extrude); set Rod and ALL strokes
// are rods. FULL control set, never trimmed (feedback_more_toggle_options_better).
//
// The 3D STYLE dropdown ships three REAL options (spec §3, no stubs per
// project_f3_styles_must_all_be_real): Native (lit material presets) · Hatch
// (procedural band-quantized hachure reading the LIVE 2D Shading sliders) ·
// SVG-port (M8 v1 — the 2D-treatment-on-3D bridge; the full 2D chrome mounts
// under it). AI mode = round-8 reserved slot, nothing visible (spec §2.5).
//
// MATERIAL OVERRIDE RULE (FS materialUserOverride, ported verbatim): switching
// geometry modes applies MODE_MATERIAL_DEFAULTS_3D ONLY while the user hasn't
// explicitly picked a material; an explicit pick survives every mode switch
// (I-1 spirit in FS's own code, spec §3).
//
// NOTE: type-only import from lib/geometry3d (erased at compile) + value
// imports ONLY from the pure canvas3d data modules — nothing here may pull
// `three` into the main chunk (the React.lazy split in DeskDoodlesCanvas).

export type Style3D = 'native' | 'hatch' | 'svg-port';

export type Style3DMeta = {
  id: Style3D;
  label: string;
  detail: string;
};

/** Chrome dropdown inventory — three real styles, locked order (spec §3). */
export const STYLE3D_OPTIONS: Style3DMeta[] = [
  {
    id: 'native',
    label: 'Native',
    detail: 'Lit physical material — the clay/ink object read. Material presets below.',
  },
  {
    id: 'hatch',
    label: 'Hatch',
    detail: 'Band-quantized procedural hachure driven by the LIVE 2D Shading sliders — one math, two renderers.',
  },
  {
    id: 'svg-port',
    label: 'SVG-port',
    detail: 'The 2D treatment on the 3D form (M8 v1) — the full 2D chrome drives it.',
  },
];

// ─── HATCH STYLE TOGGLES (symmetry-law gap cell §1) ─────────────────────────
// The Hatch node's discrete STYLE set: MARK GRAMMAR + DIRECTION MODE. Both
// feed the SAME band-quantized coverage math as the sliders (one math, four
// renderers). Defaults (hachure / fixed) = the pre-law behavior exactly.

export type HatchGrammarMeta = { id: HatchGrammar; label: string; detail: string };
export type HatchDirectionMeta = { id: HatchDirection; label: string; detail: string };

/** MARK GRAMMAR pills — locked order, all four real (no stubs). */
export const HATCH_GRAMMAR_OPTIONS: HatchGrammarMeta[] = [
  { id: 'hachure', label: 'Hachure', detail: 'Parallel lines — the current grammar.' },
  { id: 'cross-hatch', label: 'Cross-hatch', detail: 'A second crossed layer; darker bands earn the cross.' },
  { id: 'stipple', label: 'Stipple', detail: 'Dots; density from the same band table.' },
  { id: 'contour', label: 'Contour', detail: 'Lines following the form curvature.' },
];

/** DIRECTION MODE pills — Fixed keeps the angle slider; Light-following
 *  orients marks off the light, re-orienting as you orbit. */
export const HATCH_DIRECTION_OPTIONS: HatchDirectionMeta[] = [
  { id: 'fixed', label: 'Fixed angle', detail: 'The angle slider drives the marks (current).' },
  { id: 'light', label: 'Light-following', detail: 'Marks orient off the light, shifting as you orbit.' },
];

export type GeometryModeMeta = {
  id: GeometryModeSetting;
  label: string;
  detail: string;
};

/** Chrome inventory — the FULL set, in locked order (D-7). */
export const GEOMETRY_MODE_OPTIONS: GeometryModeMeta[] = [
  { id: 'auto',    label: 'Auto',    detail: 'Shape decides: open stroke → rod, closed stroke → extrude.' },
  { id: 'rod',     label: 'Rod',     detail: 'Every stroke becomes an ink tube with rounded caps + joint blobs.' },
  { id: 'extrude', label: 'Extrude', detail: 'Closed regions become bevelled slabs; degenerate loops fall back to rod.' },
  { id: 'inflate', label: 'Inflate', detail: 'Swept capsule — tapered tips, full middle, pressure-modulated.' },
  { id: 'solid',   label: 'Solid',   detail: 'Whole drawing rasterized + marched into ONE watertight mass.' },
];

/** The 'ai-mesh' FORM option (Sebs 2026-06-27) — prepended to the geometry
 *  dropdown ONLY when the object carries a generated GLB (aiMeshActive). Picking
 *  it renders the mesh; the stroke FORMs above convert the Quiver SVG instead. */
export const AI_MESH_GEOMETRY_OPTION: GeometryModeMeta = {
  id: 'ai-mesh',
  label: 'AI mesh',
  detail: 'The generated 3D mesh — its own form. The stroke forms below rebuild the shape from this drawing instead.',
};

/** Sensible-deep default for the svg-port relief depth slider (Sebs picked a
 *  slider "defaulting to a sensible deep value"). 0 = flat shallow look. */
export const SVGPORT_RELIEF_DEPTH_DEFAULT = 0.25;

type Ctx = {
  geometryMode: GeometryModeSetting;
  setGeometryMode: (m: GeometryModeSetting) => void;
  /** True once the user has TOUCHED the global geometry control this session.
   *  A surface that hosts many objects with their OWN saved 3D looks (the desk)
   *  shows each saved look UNTIL this flips, then the live chrome sweeps EVERY
   *  object — "change the global geometry → restyle the whole desk" (Sebs
   *  2026-06-18). The saved per-object render_config is untouched and restores on
   *  the next mount (this resets to false), so the sweep is non-destructive. */
  geometryEngaged: boolean;
  style3d: Style3D;
  setStyle3d: (s: Style3D) => void;
  /** SVG-PORT DEEP RELIEF depth (Sebs 2026-06-21) — CPU-displaces the welded
   *  front cap by the carve height field for REAL geometry depth (a screen sinks
   *  IN, a button stands OUT) with no tearing. 0 = flat (the shallow normalMap
   *  look); ~0.25 sensible deep default; up to ~0.6 = bold. svg-port only. */
  reliefDepth: number;
  setReliefDepth: (v: number) => void;
  /** SVG-PORT deep-relief WALL STYLE (Sebs 2026-06-21 "two versions"): false =
   *  Make-friendly steep welded-mass ramps (V1, no WASM, always works); true =
   *  manifold-3d CSG true-vertical walls (V2, lazy WASM, falls back to V1 if it
   *  fails to load — e.g. the Make cold-load race). Only affects svg-port + objects
   *  with treatMask primitive features (screen/buttons). */
  reliefCsg: boolean;
  setReliefCsg: (v: boolean) => void;
  /** Active Native material (resolved: user pick if overridden, else the
   *  FS per-mode default for the current geometry mode). */
  materialPreset: MaterialPresetId;
  /** Explicit user pick — sets materialUserOverride (survives mode switches). */
  setMaterialPreset: (m: MaterialPresetId) => void;
  /** True once the user explicitly picked a material. */
  materialUserOverride: boolean;
  /** Native PROPERTY dials (symmetry-law gap cell §2) — polish/reflection/
   *  sheen/outline. Reflection is bounded so ink-black always holds. */
  nativeProps: NativeProps3D;
  setNativeProps: (p: Partial<NativeProps3D>) => void;
  /** Hatch discrete STYLE set (symmetry-law gap cell §1). */
  hatchGrammar: HatchGrammar;
  setHatchGrammar: (g: HatchGrammar) => void;
  hatchDirection: HatchDirection;
  setHatchDirection: (d: HatchDirection) => void;
  /** AI-mesh (hard-path GLB) shading register — 'greyscale' (our ink register,
   *  DEFAULT, so the AI mesh fits the desk) or 'og-pbr' (the provider's
   *  photoreal). Only affects an active AI mesh; inert otherwise. */
  aiMeshMaterialMode: AiMeshMaterialMode;
  setAiMeshMaterialMode: (m: AiMeshMaterialMode) => void;
  /** True once a hard-path AI mesh exists (Sebs 2026-06-16: the material toggle
   *  should only appear AFTER the user generates the mesh, not always). */
  aiMeshActive: boolean;
  setAiMeshActive: (v: boolean) => void;
  /** AI-mesh's OWN toggle set (Sebs 2026-06-16 "ai mesh needs its own custom set
   *  of toggles that make sense for the mesh + our app"): darkness of the greyscale
   *  re-skin (value, ink register) + slow auto-spin in the preview. Distinct from
   *  the local-3D geometry/material controls, which don't apply to a foreign GLB. */
  aiMeshDark: number;
  setAiMeshDark: (v: number) => void;
  /** AI-mesh greyscale value CONTRAST (1 = natural, >1 crisper). */
  aiMeshContrast: number;
  setAiMeshContrast: (v: number) => void;
  aiMeshAutoSpin: boolean;
  setAiMeshAutoSpin: (v: boolean) => void;
  /** Per-geometry-mode param sets (spec §2 — full, never trimmed). */
  modeParams: Mode3DParams;
  setRodParams: (p: Partial<RodParams3D>) => void;
  setExtrudeParams: (p: Partial<ExtrudeParams3D>) => void;
  setInflateParams: (p: Partial<InflateParams3D>) => void;
  setSolidParams: (p: Partial<SolidParams3D>) => void;
};

const Canvas3DCtx = createContext<Ctx | null>(null);

/** Safe defaults for hosts that mount DrawSurface OUTSIDE the provider
 *  (the /desk DrawPanel popup). When the main thread swaps DrawSurface's 3D
 *  honesty gate to read useCanvas3D(), /desk keeps working on these instead
 *  of throwing — the locked defaults either way. */
const UNPROVIDED_DEFAULTS: Ctx = {
  geometryMode: 'auto',
  setGeometryMode: () => {},
  geometryEngaged: false,
  style3d: 'native',
  setStyle3d: () => {},
  reliefDepth: SVGPORT_RELIEF_DEPTH_DEFAULT,
  setReliefDepth: () => {},
  reliefCsg: false,
  setReliefCsg: () => {},
  materialPreset: MODE_MATERIAL_DEFAULTS_3D.auto,
  setMaterialPreset: () => {},
  materialUserOverride: false,
  nativeProps: DEFAULT_NATIVE_PROPS_3D,
  setNativeProps: () => {},
  hatchGrammar: 'hachure',
  setHatchGrammar: () => {},
  hatchDirection: 'fixed',
  setHatchDirection: () => {},
  aiMeshMaterialMode: 'greyscale',
  setAiMeshMaterialMode: () => {},
  aiMeshActive: false,
  setAiMeshActive: () => {},
  aiMeshDark: AI_MESH_DARK_DEFAULT,
  setAiMeshDark: () => {},
  aiMeshContrast: AI_MESH_CONTRAST_DEFAULT,
  setAiMeshContrast: () => {},
  aiMeshAutoSpin: false,
  setAiMeshAutoSpin: () => {},
  modeParams: DEFAULT_MODE3D_PARAMS,
  setRodParams: () => {},
  setExtrudeParams: () => {},
  setInflateParams: () => {},
  setSolidParams: () => {},
};

export function Canvas3DProvider({ children }: { children: ReactNode }) {
  const [geometryMode, setGeometryModeRaw] = useState<GeometryModeSetting>('auto');
  const [geometryEngaged, setGeometryEngaged] = useState(false);
  const [style3d, setStyle3d] = useState<Style3D>('native');
  const [reliefDepth, setReliefDepth] = useState<number>(SVGPORT_RELIEF_DEPTH_DEFAULT);
  const [reliefCsg, setReliefCsg] = useState<boolean>(false);
  const [materialPick, setMaterialPick] = useState<MaterialPresetId | null>(null); // null = no override
  const [nativeProps, setNativePropsState] = useState<NativeProps3D>(DEFAULT_NATIVE_PROPS_3D);
  const [hatchGrammar, setHatchGrammar] = useState<HatchGrammar>('hachure');
  const [hatchDirection, setHatchDirection] = useState<HatchDirection>('fixed');
  const [aiMeshMaterialMode, setAiMeshMaterialMode] = useState<AiMeshMaterialMode>('greyscale');
  const [aiMeshActive, setAiMeshActive] = useState(false);
  const [aiMeshDark, setAiMeshDark] = useState<number>(AI_MESH_DARK_DEFAULT);
  const [aiMeshContrast, setAiMeshContrast] = useState<number>(AI_MESH_CONTRAST_DEFAULT);
  const [aiMeshAutoSpin, setAiMeshAutoSpin] = useState(false);
  const [modeParams, setModeParams] = useState<Mode3DParams>(DEFAULT_MODE3D_PARAMS);

  // FS materialUserOverride semantics: mode switches re-default the material
  // ONLY while no explicit pick exists. The pick is stored, not the default —
  // so un-overridden state keeps following the mode.
  const setGeometryMode = useCallback((m: GeometryModeSetting) => {
    setGeometryModeRaw(m);
    // Touching the geometry control engages the global sweep — from now on the
    // live chrome drives every object on the desk, overriding saved per-object
    // 3D looks ("restyle the whole desk", Sebs 2026-06-18).
    setGeometryEngaged(true);
  }, []);

  const setMaterialPreset = useCallback((m: MaterialPresetId) => {
    setMaterialPick(m);
  }, []);

  // NOTE (Sebs 2026-06-27): the AI mesh is the NATIVE STYLE, not a geometry mode.
  // A mesh object opens at geometryMode 'auto' (the default), which the render gate
  // already resolves to "show the mesh" when a GLB exists — so no special FORM
  // default is needed. Picking an explicit geometry mode rebuilds from the drawing.

  const materialPreset = materialPick ?? MODE_MATERIAL_DEFAULTS_3D[geometryMode];

  const setNativeProps = useCallback((p: Partial<NativeProps3D>) => {
    setNativePropsState((prev) => ({ ...prev, ...p }));
  }, []);

  const setRodParams = useCallback((p: Partial<RodParams3D>) => {
    setModeParams((prev) => ({ ...prev, rod: { ...prev.rod, ...p } }));
  }, []);
  const setExtrudeParams = useCallback((p: Partial<ExtrudeParams3D>) => {
    setModeParams((prev) => ({ ...prev, extrude: { ...prev.extrude, ...p } }));
  }, []);
  const setInflateParams = useCallback((p: Partial<InflateParams3D>) => {
    setModeParams((prev) => ({ ...prev, inflate: { ...prev.inflate, ...p } }));
  }, []);
  const setSolidParams = useCallback((p: Partial<SolidParams3D>) => {
    setModeParams((prev) => ({ ...prev, solid: { ...prev.solid, ...p } }));
  }, []);

  // DEV/TEST hook (R36): expose the 3D-control setters on window so a headed-Chrome
  // verification harness can drive the desk's global 3D style/material without
  // reaching the chrome dropdowns (which only show in DESK+3D mode). No-op in normal
  // use; harmless to leave. NOT a product surface — purely for live 3D verification.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).__dd_canvas3d = {
      setStyle3d,
      setMaterialPreset,
      setNativeProps,
      setHatchGrammar,
      setHatchDirection,
      setAiMeshMaterialMode,
      setAiMeshDark,
      setAiMeshContrast,
      setGeometryMode,
    };
  }, [
    setStyle3d,
    setMaterialPreset,
    setNativeProps,
    setHatchGrammar,
    setHatchDirection,
    setAiMeshMaterialMode,
    setAiMeshDark,
    setAiMeshContrast,
    setGeometryMode,
  ]);

  const value = useMemo<Ctx>(
    () => ({
      geometryMode,
      setGeometryMode,
      geometryEngaged,
      style3d,
      setStyle3d,
      reliefDepth,
      setReliefDepth,
      reliefCsg,
      setReliefCsg,
      materialPreset,
      setMaterialPreset,
      materialUserOverride: materialPick !== null,
      nativeProps,
      setNativeProps,
      hatchGrammar,
      setHatchGrammar,
      hatchDirection,
      setHatchDirection,
      aiMeshMaterialMode,
      setAiMeshMaterialMode,
      aiMeshActive,
      setAiMeshActive,
      aiMeshDark,
      setAiMeshDark,
      aiMeshContrast,
      setAiMeshContrast,
      aiMeshAutoSpin,
      setAiMeshAutoSpin,
      modeParams,
      setRodParams,
      setExtrudeParams,
      setInflateParams,
      setSolidParams,
    }),
    [
      geometryMode,
      setGeometryMode,
      geometryEngaged,
      style3d,
      reliefDepth,
      reliefCsg,
      materialPreset,
      setMaterialPreset,
      materialPick,
      nativeProps,
      setNativeProps,
      hatchGrammar,
      hatchDirection,
      aiMeshMaterialMode,
      aiMeshActive,
      aiMeshDark,
      aiMeshContrast,
      aiMeshAutoSpin,
      modeParams,
      setRodParams,
      setExtrudeParams,
      setInflateParams,
      setSolidParams,
    ],
  );

  return <Canvas3DCtx.Provider value={value}>{children}</Canvas3DCtx.Provider>;
}

/** Unlike the house template this does NOT throw when unprovided — see
 *  UNPROVIDED_DEFAULTS (deliberate: the same DrawSurface mounts under both
 *  /canvas, which has the provider, and the /desk DrawPanel, which doesn't). */
export function useCanvas3D(): Ctx {
  return useContext(Canvas3DCtx) ?? UNPROVIDED_DEFAULTS;
}
