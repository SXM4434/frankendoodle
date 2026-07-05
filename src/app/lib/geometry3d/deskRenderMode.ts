// ─── deskRenderMode — the desk object's 2D↔3D render-mode record extension ───
// Gap-hunt H3 SCAFFOLD (docs/submission/GAP-HUNT.md row H3 + docs/design/
// desk-flip-2d3d-seam.md). The 2D↔3D flip exists ONLY on /canvas today
// (DeskDoodlesCanvas.tsx feeds live in-memory strokes to Stroke3DScene); a
// PLACED desk object cannot be flipped at all, because its record carries no
// render-mode and no 3D geometry config, and ObjectSurface exposes no convert
// action. This module is the ADDITIVE, OPTIONAL record extension that closes
// the data half of that gap WITHOUT a migration and WITHOUT breaking any
// existing object.
//
// ── WHY THIS IS SAFE / ADDITIVE ────────────────────────────────────────────
// Everything here is OPTIONAL. A pre-existing object (the whole live desk)
// carries neither field; `resolveRenderMode(undefined) === '2d'`, so it renders
// exactly as today. No DB column is needed: render_mode + geometry3d ride the
// SAME render_config jsonb that already carries `strokes` (the strokes-in-the-
// record contract, DeskPage.tsx ~98). publish.ts's render_config column is
// already live (publish.ts:44) and its parsers pass UNKNOWN top-level fields
// through untouched — so these fields survive every round-trip the moment a
// writer starts emitting them, with no parser change required for survival.
//
// ── WHY THE 3D CONFIG IS JUST INPUTS, NOT BAKED GEOMETRY ────────────────────
// Per docs/design/3d-roundtrip-build-plan.md the wedge is "the user's hand
// survives the round-trip" — drawn strokes ARE the 3D source. Stroke3DScene
// rebuilds geometry deterministically from (strokes + geometryMode + style3d +
// modeParams) on every mount (Stroke3DScene.tsx:404 Stroke3DSceneProps). So the
// record must store the strokes (already does, for drawn objects) + the small
// set of 3D *inputs* — never a serialized mesh. This keeps the record tiny
// (well under the 64KB svg cap), cache-stable, and re-stylable (S12/S13 Unify
// toggle re-applies config without re-generating — object-model doc §1).
//
// ── PURITY CONTRACT ─────────────────────────────────────────────────────────
// type-only imports from lib/geometry3d + components/canvas3d (erased at
// compile) — nothing here pulls `three` into the main chunk (the React.lazy
// split in DeskDoodlesCanvas). No React, no DOM. Node-runnable.

import type { GeometryModeSetting } from './strokeTo3d.ts';
import type { Style3D } from '../../state/Canvas3DContext.tsx';
import type {
  ExtrudeParams3D,
  InflateParams3D,
  Mode3DParams,
  RodParams3D,
  SolidParams3D,
} from '../../components/canvas3d/modeParams.ts';
import { DEFAULT_MODE3D_PARAMS } from '../../components/canvas3d/modeParams.ts';
import {
  MODE_MATERIAL_DEFAULTS_3D,
  DEFAULT_NATIVE_PROPS_3D,
  type MaterialPresetId,
  type NativeProps3D,
} from '../../components/canvas3d/materials3d.ts';
import type { HatchGrammar, HatchDirection } from '../../components/canvas3d/hatchMaterial.ts';

// ─── The render mode ─────────────────────────────────────────────────────────

/** A desk object renders in one of two modes. Absent on the record ⇒ '2d'
 *  (every legacy object). The flip toggles this field on the record. */
export type DeskRenderMode = '2d' | '3d';

export const DEFAULT_RENDER_MODE: DeskRenderMode = '2d';

/** The full 3D-input bundle a placed object needs to render its 3D mount.
 *  Mirrors exactly the Stroke3DScene props the /canvas flip already feeds from
 *  Canvas3DContext — so the desk mount is the SAME scene with the SAME inputs,
 *  just sourced from the record instead of the live context. Every field is
 *  optional: an absent field falls back to the same default the /canvas
 *  Canvas3DContext uses (Canvas3DContext.tsx UNPROVIDED_DEFAULTS), so a
 *  minimally-stamped record (just `geometryMode`) renders the tuned default
 *  look. */
export interface Geometry3DConfig {
  /** Auto / rod / extrude / inflate / solid (Canvas3DContext GEOMETRY_MODE_OPTIONS). */
  geometryMode?: GeometryModeSetting;
  /** native / hatch / svg-port (Canvas3DContext STYLE3D_OPTIONS). */
  style3d?: Style3D;
  /** Native material preset; absent ⇒ the per-mode default for geometryMode. */
  materialPreset?: MaterialPresetId;
  /** Native property dials (polish/reflection/sheen/outline). */
  nativeProps?: NativeProps3D;
  /** Hatch mark grammar (hachure/cross-hatch/stipple/contour). */
  hatchGrammar?: HatchGrammar;
  /** Hatch direction mode (fixed/light-following). */
  hatchDirection?: HatchDirection;
  /** Per-geometry-mode param sets (rod/extrude/inflate/solid sliders). */
  modeParams?: Mode3DParams;
  /** ARROW RULE: per-object chip overrides (strokeSignature → treat-as-closed).
   *  Persisted so a flip a viewer corrected stays corrected on reload. Today
   *  /canvas keeps these scene-local (Stroke3DScene initialTreatAsClosed);
   *  carrying them on the record is the persistence the Rock X report named as
   *  "rides the conversion-wiring round". */
  treatAsClosed?: Record<string, boolean>;
}

/** The two fields this scaffold ADDS to the object render_config. Both
 *  OPTIONAL — spread onto the existing config; legacy configs lack both and
 *  resolve to 2D. Kept as a partial so DeskPage's ObjectRenderConfig /
 *  ObjectSurface's SurfaceRenderConfig can `&`-extend it at the wiring point
 *  (FLAGGED — those types live in hot files; see the design doc). */
export interface RenderModeRecordFields {
  /** Which mode this object renders in. Absent ⇒ '2d'. */
  renderMode?: DeskRenderMode;
  /** The 3D inputs (only meaningful when renderMode === '3d', but harmless to
   *  carry in '2d' — a viewer who flips to 3D and back keeps their picks). */
  geometry3d?: Geometry3DConfig;
}

// ─── Resolvers (pure, defensive — render_config is anon-writable) ───────────

/** Coerce an unknown render_mode value to a legal mode. Anything not exactly
 *  '3d' (missing, malformed, hostile) resolves to '2d' — the safe default that
 *  renders every legacy object unchanged. */
export function resolveRenderMode(raw: unknown): DeskRenderMode {
  return raw === '3d' ? '3d' : '2d';
}

/** True iff this strokes payload can drive a 3D mount. The 3D scene rebuilds
 *  from strokes, so a drawn object (strokes present) CAN flip; an upload-only
 *  object (no strokes) cannot yet — that's the vision-router hard path (out of
 *  this scaffold; see canFlipReason). Mirrors the validation ObjectSurface
 *  already runs on `storedStrokes` (ObjectSurface.tsx ~649) so the convert
 *  affordance and the mount agree on what "flippable" means. */
export function strokesCanFlipTo3D(strokes: unknown): boolean {
  if (!Array.isArray(strokes) || strokes.length === 0) return false;
  return strokes.every(
    (st) =>
      Array.isArray(st) &&
      st.length >= 2 &&
      st.every(
        (pt) =>
          Array.isArray(pt) &&
          (pt.length === 2 || pt.length === 3) &&
          pt.every((n) => typeof n === 'number' && Number.isFinite(n)),
      ),
  );
}

export type FlipEligibility =
  | { canFlip: true }
  | { canFlip: false; reason: 'no-strokes'; message: string };

/** Why an object can or can't flip to 3D — drives the ObjectSurface convert
 *  affordance copy (honest note, never a dead/greyed control per
 *  project_f3_styles_must_all_be_real). */
export function flipEligibility(strokes: unknown): FlipEligibility {
  if (strokesCanFlipTo3D(strokes)) return { canFlip: true };
  return {
    canFlip: false,
    reason: 'no-strokes',
    // Same honesty register as DeskDoodlesCanvas's upload→3D note.
    message: 'Drawn doodles flip to 3D — upload→3D is the hard path (vision router), coming later.',
  };
}

// ─── Geometry3DConfig → Stroke3DScene props (the seam adapter) ──────────────

/** The exact prop bundle Stroke3DScene needs, resolved from a (possibly
 *  partial) Geometry3DConfig with the same fallbacks Canvas3DContext applies on
 *  /canvas. Returned as a plain object the desk mount spreads onto
 *  <Stroke3DSceneLazy {...} strokes={...} />. Type-only on the scene side —
 *  this returns data, never imports the scene. */
export interface ResolvedScene3DInputs {
  geometryMode: GeometryModeSetting;
  style3d: Style3D;
  materialPreset: MaterialPresetId;
  nativeProps: NativeProps3D;
  hatchGrammar: HatchGrammar;
  hatchDirection: HatchDirection;
  modeParams: Mode3DParams;
  initialTreatAsClosed: Record<string, boolean>;
}

export function resolveScene3DInputs(config?: Geometry3DConfig | null): ResolvedScene3DInputs {
  const c = config ?? {};
  const geometryMode = c.geometryMode ?? 'auto';
  return {
    geometryMode,
    style3d: c.style3d ?? 'native',
    // Same rule as Canvas3DContext: user pick if present, else per-mode default.
    materialPreset: c.materialPreset ?? MODE_MATERIAL_DEFAULTS_3D[geometryMode],
    nativeProps: c.nativeProps ?? DEFAULT_NATIVE_PROPS_3D,
    hatchGrammar: c.hatchGrammar ?? 'hachure',
    hatchDirection: c.hatchDirection ?? 'fixed',
    modeParams: c.modeParams ?? DEFAULT_MODE3D_PARAMS,
    initialTreatAsClosed: c.treatAsClosed ?? {},
  };
}

/** Snapshot the live Canvas3DContext-shaped values into a Geometry3DConfig for
 *  persistence at convert time. The ObjectSurface convert action calls this
 *  with the current 3D picks (or just leaves it undefined to mean "tuned
 *  defaults"). Kept here so the convert seam and the desk mount agree on the
 *  shape. Drops fields equal to their default to keep the record minimal
 *  (smaller jsonb, cleaner diffs) — resolveScene3DInputs re-adds them on read. */
export function snapshotGeometry3DConfig(live: Partial<Geometry3DConfig>): Geometry3DConfig {
  const out: Geometry3DConfig = {};
  if (live.geometryMode && live.geometryMode !== 'auto') out.geometryMode = live.geometryMode;
  if (live.style3d && live.style3d !== 'native') out.style3d = live.style3d;
  if (live.materialPreset) out.materialPreset = live.materialPreset;
  if (live.nativeProps) out.nativeProps = live.nativeProps;
  if (live.hatchGrammar && live.hatchGrammar !== 'hachure') out.hatchGrammar = live.hatchGrammar;
  if (live.hatchDirection && live.hatchDirection !== 'fixed') out.hatchDirection = live.hatchDirection;
  if (live.modeParams) out.modeParams = live.modeParams;
  if (live.treatAsClosed && Object.keys(live.treatAsClosed).length > 0) {
    out.treatAsClosed = live.treatAsClosed;
  }
  return out;
}

// Re-export the param sub-types so a consumer importing the seam gets the whole
// 3D-config vocabulary from one module.
export type {
  ExtrudeParams3D,
  InflateParams3D,
  Mode3DParams,
  RodParams3D,
  SolidParams3D,
  MaterialPresetId,
  NativeProps3D,
  GeometryModeSetting,
  Style3D,
  HatchGrammar,
  HatchDirection,
};
