import { useMemo, type CSSProperties } from 'react';
import { PILL } from '../../lib/chromeStyles';
import { IS } from '../../lib/typography';
import {
  flipEligibility,
  resolveRenderMode,
  snapshotGeometry3DConfig,
  type DeskRenderMode,
  type Geometry3DConfig,
  type RenderModeRecordFields,
} from '../../lib/geometry3d/deskRenderMode';

// ─── ObjectConvertAction — the Edit-surface 2D↔3D convert seam ────────────────
// Gap-hunt H3 SCAFFOLD (docs/design/desk-flip-2d3d-seam.md §2 "the convert
// action"). ObjectSurface (Edit) today exposes Restyle, Re-draw, Delete, Done —
// but NO way to flip a placed object to 3D, which is the demo climax. This is
// the missing action, written as a NEW self-contained file so the wiring into
// ObjectSurface (a HOT file) is ONE import + ONE placement of <ObjectConvert
// Action/> in the control column, plus passing the resulting record fields into
// the existing config persist path. Both are FLAGGED in the design doc.
//
// ── HOW IT PERSISTS (no new RPC, no schema paste) ───────────────────────────
// The flip writes renderMode + geometry3d onto the object's render_config — the
// SAME jsonb that already carries svgStyle/modifiers/strokes. ObjectSurface's
// handleDone already persists the whole config via updateDoodleConfig
// (ObjectSurface.tsx ~632); this action produces the EXTRA fields to merge into
// that config object, so it rides the existing persist with zero new plumbing.
// The convert builder returns the fields; the surface spreads them into the
// SurfaceRenderConfig it already builds at Done. (FLAGGED: SurfaceRenderConfig
// is in the hot ObjectSurface file — it `&`-extends RenderModeRecordFields at
// the wiring point.)
//
// ── HONESTY (project_f3_styles_must_all_be_real) ────────────────────────────
// Upload-only objects (no strokes) CANNOT flip yet — that's the vision-router
// hard path. This control shows an HONEST note instead of a dead/greyed button
// (flipEligibility drives the copy), exactly like DeskDoodlesCanvas's upload→3D
// note. No fake affordance.

/** The minimal slice of the object's record this action reads. The surface
 *  passes these from its parsed config (renderMode/geometry3d) + the raw strokes
 *  it already validates for Re-draw (ObjectSurface.tsx storedStrokes). */
export interface ConvertActionState {
  /** Current render mode on the record (resolveRenderMode'd by the caller, or
   *  raw — this component re-resolves defensively). */
  renderMode?: unknown;
  /** Raw render_config.strokes (the source the 3D scene rebuilds from). */
  strokes?: unknown;
  /** Current persisted 3D config (so a re-flip preserves prior picks). */
  geometry3d?: Geometry3DConfig | null;
}

/** Build the record fields a flip should persist. Pure — the surface calls this
 *  on toggle, merges the result into the config it persists at Done, and
 *  optimistically re-pins the desk object (onConfigSave path). `liveGeometry3d`
 *  lets a future 3D control column snapshot the viewer's current 3D picks at
 *  convert time; omitted ⇒ keep prior config (or tuned defaults). */
export function buildFlipFields(
  current: ConvertActionState,
  to: DeskRenderMode,
  liveGeometry3d?: Partial<Geometry3DConfig>,
): RenderModeRecordFields {
  if (to === '2d') {
    // Flipping back to 2D keeps geometry3d on the record (so a re-flip restores
    // the viewer's picks) but sets the mode. Nothing destructive.
    return { renderMode: '2d', geometry3d: current.geometry3d ?? undefined };
  }
  // → 3D. Snapshot any live picks over the prior config; absent ⇒ prior or
  // tuned defaults (snapshotGeometry3DConfig drops default-equal fields).
  const merged: Partial<Geometry3DConfig> = { ...(current.geometry3d ?? {}), ...(liveGeometry3d ?? {}) };
  return { renderMode: '3d', geometry3d: snapshotGeometry3DConfig(merged) };
}

const NOTE: CSSProperties = {
  fontFamily: IS,
  fontSize: 10,
  fontStyle: 'italic',
  color: 'var(--dir-text-body-soft)',
  lineHeight: 1.4,
};

/** The convert control — a single pill that flips the object's mode, with an
 *  honest note when the object can't flip (upload-only). Self-contained so the
 *  surface drops it in with one tag. `onFlip` receives the record fields to
 *  merge into the persist path. */
export function ObjectConvertAction({
  state,
  onFlip,
  liveGeometry3d,
}: {
  state: ConvertActionState;
  /** Called with the fields to persist + optimistically apply (the surface
   *  merges them into its SurfaceRenderConfig and re-pins the desk object). */
  onFlip: (fields: RenderModeRecordFields) => void;
  /** Optional live 3D picks to snapshot when flipping → 3D (from a future
   *  in-surface 3D control column; omitted ⇒ prior config / tuned defaults). */
  liveGeometry3d?: Partial<Geometry3DConfig>;
}) {
  const mode = resolveRenderMode(state.renderMode);
  const eligible = useMemo(() => flipEligibility(state.strokes), [state.strokes]);

  // Upload-only object → honest note, no button (no dead affordance).
  if (!eligible.canFlip) {
    return <div style={NOTE}>{eligible.message}</div>;
  }

  const next: DeskRenderMode = mode === '3d' ? '2d' : '3d';
  return (
    <button
      type="button"
      onClick={() => onFlip(buildFlipFields(state, next, liveGeometry3d))}
      title={
        next === '3d'
          ? 'Lift this doodle into 3D — your strokes become form (the same flip as /canvas)'
          : 'Flatten back to the 2D ink drawing'
      }
      style={{ ...PILL, padding: '6px 14px' }}
    >
      {next === '3d' ? 'Flip to 3D' : 'Flatten to 2D'}
    </button>
  );
}
