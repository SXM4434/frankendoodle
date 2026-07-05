// ─── DrawToolbar — the ONE shared draw-tool row (Phase 0 extraction) ─────────
// Behavior-preserving extraction of the tool-row UI that was DUPLICATED inline
// in DrawPanel.tsx (the /desk add-doodle popup) and DeskDoodlesCanvas.tsx (the
// /canvas page), and ABSENT a third time in ObjectSurface.tsx's RE-DRAW modal.
//
// It is a CONTROLLED, PRESENTATIONAL component: it owns no canvas state. Every
// host owns its own register / shadeTool / snap-chip state and computes the
// caption + disabled flags itself, then passes them down so the rendered row is
// byte-identical to what each host drew before. The toolbar does NOT own the
// render axis (Sketch | Style) — that stays in the host and is passed through
// the `leading` slot when a host wants it inline.
//
// ToneShadeCluster is imported (unchanged) from DrawSurface — this file never
// edits DrawSurface.
import type { ReactNode } from 'react';
import { IS } from '../../lib/typography';
import { PILL, SECTION_LABEL } from '../../lib/chromeStyles';
import { ToneShadeCluster, type ShadeToolState } from './DrawSurface';
import type { SnapAction } from '../../lib/draw/shapeFit';

export interface DrawToolbarProps {
  // — register (Ink | Shade | Erase) —
  register: 'ink' | 'shade' | 'erase';
  onRegisterChange: (r: 'ink' | 'shade' | 'erase') => void;
  /** Disables both register pills (DrawPanel: true while in Style mode). The
   *  pills stay VISIBLE (dimmed) — only the canvas's render axis paused them. */
  registerDisabled?: boolean;
  /** Title for the register pills while disabled (DrawPanel's Style-mode hint).
   *  When unset, the enabled per-register hints are used. */
  registerDisabledTitle?: string;

  // — shade tool cluster (ToneShadeCluster) —
  shadeTool: ShadeToolState;
  onShadeToolChange: (s: ShadeToolState) => void;
  /** ERASE sub-mode (the GoodNotes Object/Pixel toggle) — shown when the Erase
   *  register is active. Optional: a host that doesn't wire it gets no toggle. */
  eraseMode?: 'object' | 'pixel';
  onEraseModeChange?: (m: 'object' | 'pixel') => void;
  /** Whether the Shade register / tone cluster is in scope on this host. When
   *  false the Shade pill is hidden and the cluster never mounts. */
  shadeEnabled?: boolean;

  // — shape assist (Snap | Straighten + the candidate chip) —
  /** Whether the Snap/Straighten cluster + chip render at all (DrawPanel hides
   *  the whole cluster in Style mode; /canvas + RE-DRAW always show it). */
  showSnap?: boolean;
  /** Shared enabled state for both snap pills (ink register + ≥1 stroke). */
  snapEnabled: boolean;
  onSnapAction: (action: SnapAction) => void;
  /** Per-action tooltip — the host owns the honest wording (shade/no-stroke/…). */
  snapTitle: (action: SnapAction) => string;
  /** The snap-switcher receipt, rendered INLINE right after the Snap/Straighten
   *  pills (Sebs 2026-06-15: "should just appear next to the snap"). The host
   *  passes its "Snapped to X ▾" pill + ✕ + SwitchPopover here so the switcher
   *  lives at the SNAP button instead of floating detached above the canvas.
   *  null/undefined = nothing snapped. */
  snapSwitcher?: ReactNode;

  // — caption (the honest-miss / register-hint one-liner) —
  captionText: string;
  /** True when the caption is an alert (removeNote / fillNote) → accent color +
   *  role="status". */
  captionAlert?: boolean;

  // — slots —
  /** Inline content BEFORE the register pills, in the same row (DrawPanel uses
   *  it for the Sketch | Style render-axis pills + separator). */
  leading?: ReactNode;
  /** Inline content at the row's tail (DrawPanel uses it for the upload
   *  Replace / Remove cluster). */
  trailing?: ReactNode;

  // — layout —
  /** Minor spacing only; behavior identical across variants. */
  variant: 'panel' | 'canvas' | 'redraw';
}

/** The one shared draw-tool row. Renders (left → right, wrapping): the
 *  `leading` slot · Ink|Shade register pills · the Snap|Straighten action pills
 *  + candidate chip · the caption · the `trailing` slot — then, on a second
 *  row, the ToneShadeCluster when Shade is in hand. Spacing tracks `variant`
 *  to stay byte-identical to each host's previous inline markup. */
export function DrawToolbar({
  register,
  onRegisterChange,
  registerDisabled = false,
  registerDisabledTitle,
  shadeTool,
  onShadeToolChange,
  eraseMode,
  onEraseModeChange,
  shadeEnabled = true,
  showSnap = true,
  snapEnabled,
  onSnapAction,
  snapTitle,
  snapSwitcher,
  captionText,
  captionAlert = false,
  leading,
  trailing,
  variant,
}: DrawToolbarProps) {
  // The register options — Shade is dropped when the host has no tone scope.
  // Erase is always available (it rubs out ink; with tone scope it lifts tone too).
  const registers: ('ink' | 'shade' | 'erase')[] = shadeEnabled
    ? ['ink', 'shade', 'erase']
    : ['ink', 'erase'];
  // Spacing parity: DrawPanel's row had marginBottom 8 and its shade cluster
  // marginBottom 8; the /canvas row sat inside a maxWidth wrapper with no row
  // margin and a marginTop-8 shade cluster. RE-DRAW follows /canvas.
  const rowMarginBottom = variant === 'panel' ? 8 : 0;
  const clusterMargin =
    variant === 'panel' ? { marginBottom: 8 } : { marginTop: 8 };

  return (
    <>
      {/* TOOL ROW — pills never shrink; the caption is the row's ONE flexible
          item (single line, ellipsized, full text on hover via title). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          rowGap: 6,
          marginBottom: rowMarginBottom,
          flexWrap: 'wrap',
        }}
      >
        {leading}

        {/* INK | SHADE register — which tool the pointer wields while sketching.
            Shade puts down tone bands; Ink draws strokes. */}
        {registers.map((r) => (
          <button
            key={r}
            onClick={() => onRegisterChange(r)}
            aria-pressed={register === r}
            disabled={registerDisabled}
            title={
              registerDisabled && registerDisabledTitle
                ? registerDisabledTitle
                : r === 'ink'
                  ? 'Draw ink strokes'
                  : r === 'shade'
                    ? 'Brush flat tone bands under your ink'
                    : 'Erase — drag over ink or tone to rub it out'
            }
            style={{
              ...PILL,
              padding: '6px 14px',
              flexShrink: 0,
              opacity: registerDisabled ? 0.45 : 1,
              cursor: registerDisabled ? 'default' : 'pointer',
              background: register === r ? 'var(--dir-text-primary)' : 'var(--dir-bg)',
              color: register === r ? 'var(--dir-bg)' : 'var(--dir-text-primary)',
            }}
          >
            {r === 'ink' ? 'Ink' : r === 'shade' ? 'Shade' : 'Erase'}
          </button>
        ))}

        {/* SHAPE ASSIST — Snap + Straighten action pills. Ink register only
            (tone patches don't snap); disabled until ≥1 stroke exists. The chip
            cycles ranked candidates in this same row. */}
        {showSnap && (
          <>
            <span
              aria-hidden
              style={{ width: 1, alignSelf: 'stretch', background: 'var(--dir-border)', flexShrink: 0 }}
            />
            {(['snap', 'straighten'] as const).map((act) => (
              <button
                key={act}
                data-snap-pill={act}
                onClick={() => onSnapAction(act)}
                disabled={!snapEnabled}
                title={snapTitle(act)}
                style={{
                  ...PILL,
                  padding: '6px 14px',
                  flexShrink: 0,
                  opacity: snapEnabled ? 1 : 0.45,
                  cursor: snapEnabled ? 'pointer' : 'default',
                  background: 'var(--dir-bg)',
                  color: 'var(--dir-text-primary)',
                }}
              >
                {act === 'snap' ? 'Snap' : 'Straighten'}
              </button>
            ))}
            {snapSwitcher}
          </>
        )}

        {/* Caption — the honest-miss one-liner takes the slot when it fires,
            else the current register's hint. Single line, ellipsized, full text
            on hover via title. */}
        <span
          role={captionAlert ? 'status' : undefined}
          title={captionText}
          style={{
            fontFamily: IS,
            fontSize: 10,
            fontStyle: 'italic',
            color: captionAlert ? 'var(--dir-accent)' : 'var(--dir-text-body-soft)',
            flex: '1 1 0%',
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {captionText}
        </span>

        {trailing}
      </div>

      {/* SHADE TOOL CLUSTER — visible only while the shade register is in hand:
          the full 8-band ladder (7 paint swatches + Erase = band 0/paper), the
          Brush|Fill|Lasso tools, the per-tool slider, and the FULL FILL pill.
          The whole cluster comes from DrawSurface's exported ToneShadeCluster
          (the same one every host mounts). Disabled register (DrawPanel's Style
          mode) hides it — matching the host's old composeMode==='draw' gate. */}
      {shadeEnabled && register === 'shade' && !registerDisabled && (
        <div
          data-shade-cluster
          style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, ...clusterMargin }}
        >
          <span style={{ ...SECTION_LABEL, flexShrink: 0 }}>Tone</span>
          <ToneShadeCluster value={shadeTool} onChange={onShadeToolChange} />
        </div>
      )}
      {/* ERASE sub-mode — Object (whole) vs Pixel (carve). Shown with the Erase
          register, mirroring the Tone cluster. */}
      {register === 'erase' && !registerDisabled && eraseMode && onEraseModeChange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, ...clusterMargin }}>
          <span style={{ ...SECTION_LABEL, flexShrink: 0 }}>Erase</span>
          <div style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999, border: '1px solid var(--dir-border)', background: 'var(--dir-bg)' }}>
            {(['object', 'pixel'] as const).map((m) => (
              <button
                key={m}
                onClick={() => onEraseModeChange(m)}
                aria-pressed={eraseMode === m}
                title={
                  m === 'object'
                    ? 'Object — touch a stroke or tone patch to remove the whole thing'
                    : 'Pixel — drag to rub out only the part you brush over'
                }
                style={{
                  ...PILL,
                  padding: '4px 12px',
                  fontSize: 11,
                  border: 'none',
                  flexShrink: 0,
                  ...(eraseMode === m
                    ? { background: 'var(--dir-text-primary)', color: 'var(--dir-bg)' }
                    : { background: 'transparent' }),
                }}
              >
                {m === 'object' ? 'Object' : 'Pixel'}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
