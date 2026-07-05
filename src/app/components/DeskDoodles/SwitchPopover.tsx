// ─── SwitchPopover — the override's full switch grid (UX rework §4) ──────────
// A CONTROLLED, PRESENTATIONAL popover (owns no canvas state). It renders the
// ShapeOverride's full `switchSet` — recognized alternatives, then the 12
// library shapes, then 'Original' last — as a grouped grid, and emits the user's
// pick via onSwitchTo(entry, index). The host applies it (recognized → the
// carried candidate; library → generateShape at the stroke bbox; original →
// restore originalPoints). Worst case to reach an arbitrary shape: 2 taps (open
// + pick), per spec §4.1.
//
// This is the "✎ all" half of the dispose path. Every entry is one tap; the
// currently-applied entry is highlighted (appliedIndex). 'Original' is always
// reachable here — the cheap full undo of an unwanted auto-snap (spec §4.4).
//
// Matches the DrawToolbar pill grammar (IS typography + var(--dir-*) tokens; the
// shape cells echo ShapeStrip's overflow-cell idiom; the soft-radius popover
// surface follows chromeStyles' RAISED_SHADOW convention).

import { IS } from '../../lib/typography';
import { SECTION_LABEL } from '../../lib/chromeStyles';
import type { SwitchEntry, ShapeOverride } from '../../lib/draw/switchSet';

/** A compact glyph per library / recognizer kind for the grid cells. Anything
 *  without a tidy glyph falls back to the label's first letter. */
const KIND_GLYPH: Record<string, string> = {
  // recognizer kinds
  line: '╱', polyline: '⌒', polygon: '⬠', triangle: '△', rect: '▢',
  square: '◻', star: '★', arrow: '➜', circle: '◯', ellipse: '⬭', original: '✎',
  // library kinds
  diamond: '◇', pentagon: '⬟', hexagon: '⬡', octagon: '⯃', heart: '♥',
  cloud: '☁', 'speech-bubble': '💬', lightning: '⚡', crescent: '☾',
  teardrop: '💧', 'arrow-block': '➜', 'star-5': '★',
};

function glyphFor(entry: SwitchEntry): string {
  return KIND_GLYPH[entry.kind] ?? entry.label.charAt(0);
}

const GROUP_LABEL: Record<SwitchEntry['source'], string> = {
  recognized: 'Recognized',
  library: 'Library',
  original: 'Original',
};

export interface SwitchPopoverProps {
  /** The override whose switchSet + appliedIndex this grid renders. */
  override: ShapeOverride;
  /** The user picked a switch target — host applies it to override.strokeId. */
  onSwitchTo: (entry: SwitchEntry, index: number) => void;
  /** Optional: close the popover (host owns open/close). */
  onClose?: () => void;
}

/** One selectable shape cell. */
function SwitchCell({
  entry,
  index,
  applied,
  onPick,
}: {
  entry: SwitchEntry;
  index: number;
  applied: boolean;
  onPick: (entry: SwitchEntry, index: number) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={applied}
      title={entry.source === 'original' ? 'Back to your drawn stroke' : `Switch to ${entry.label}`}
      onClick={() => onPick(entry, index)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '8px 6px',
        borderRadius: 12,
        border: '1px solid',
        borderColor: applied ? 'var(--dir-accent)' : 'var(--dir-border)',
        background: applied
          ? 'color-mix(in srgb, var(--dir-accent) 12%, var(--dir-bg))'
          : 'var(--dir-bg)',
        color: 'var(--dir-text-primary)',
        cursor: 'pointer',
        fontFamily: IS,
      }}
    >
      <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{glyphFor(entry)}</span>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
        {entry.label}
      </span>
    </button>
  );
}

/** The full switch grid, grouped recognized · library · original. Presentational
 *  + controlled. The applied entry (override.appliedIndex) is highlighted. */
export function SwitchPopover({ override, onSwitchTo, onClose }: SwitchPopoverProps) {
  const { switchSet, appliedIndex } = override;

  // Group entries by source while preserving their global index (the index the
  // host needs for onSwitchTo / appliedIndex bookkeeping).
  const groups: { source: SwitchEntry['source']; items: { entry: SwitchEntry; index: number }[] }[] = [];
  switchSet.forEach((entry, index) => {
    const last = groups[groups.length - 1];
    if (last && last.source === entry.source) last.items.push({ entry, index });
    else groups.push({ source: entry.source, items: [{ entry, index }] });
  });

  return (
    <div
      role="menu"
      data-switch-popover
      style={{
        // OVERLAY dropdown — anchored under its trigger (the receipt's
        // "Snapped to X ▾" button), NOT inserted into the flow. Mirrors the
        // ShapeStrip overflow popover idiom exactly (Sebs 2026-06-15: "make it
        // just drop down under like a normal dropdown"). The parent receipt div
        // is position:relative, so this lands directly below the pill row.
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: 0,
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: 264,
        maxHeight: 360,
        overflowY: 'auto',
        padding: 12,
        borderRadius: 16,
        border: '1px solid var(--dir-border)',
        background: 'var(--dir-bg)',
        boxShadow:
          '0 12px 36px color-mix(in srgb, var(--dir-text-primary) 10%, transparent), 0 2px 8px color-mix(in srgb, var(--dir-text-primary) 6%, transparent)',
        fontFamily: IS,
      }}
    >
      {groups.map((group) => (
        <div key={group.source} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...SECTION_LABEL }}>{GROUP_LABEL[group.source]}</span>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 6,
            }}
          >
            {group.items.map(({ entry, index }) => (
              <SwitchCell
                key={`${entry.source}:${entry.kind}`}
                entry={entry}
                index={index}
                applied={index === appliedIndex}
                onPick={(e, i) => {
                  onSwitchTo(e, i);
                  onClose?.();
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
