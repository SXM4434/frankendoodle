// ─── ShapeStrip — the Shapes quick-pick / insert row (UX rework §5) ──────────
// A CONTROLLED, PRESENTATIONAL component (owns no canvas state). It is the
// INSERT surface: picking a shape ARMS it (`onArmShape(kind)`) so a drag on the
// canvas drops it; `Freehand` (armed === null) is the default and is shown
// selected whenever nothing is armed. Excalidraw/tldraw persistent tool-row
// model (spec §8.3). The host owns `armedShape`; this only renders + emits.
//
// Layout (spec §2.2 / §5): [Freehand*]  [▢][◯][△][◇][★][♥]  [More ▾]
//   - Freehand + 6 highest-frequency inline shapes (rect, circle, triangle,
//     diamond, star, heart). Toolbar-UX best practice: surface a few inline,
//     overflow the long tail (spec §8.3). 7 inline incl. Freehand is at the
//     generous end — justified for a creative tool; flag if it wraps at the
//     /desk popup's narrow width (spec §13.4).
//   - `More ▾` opens the overflow popover with the remaining 9 library shapes
//     (pentagon, hexagon, octagon, cloud, speech-bubble, lightning, crescent,
//     teardrop, arrow-block).
//
// Matches the DrawToolbar pill grammar (PILL + IS typography + var(--dir-*)
// tokens; the armed pill inverts to text-primary bg like the register pills).
//
// KIND NOTE (host wiring — RESOLVED, kept for orientation): the inline set's
// rect / circle / triangle are RECOGNIZER kinds. They DON'T match the
// shapeLibrary entries 1:1 (the library keys 'rectangle', and circle/triangle
// were added with matching keys in R31), but the insert path doesn't depend on
// that: DrawSurface.insertOutlineFor() special-cases rect/square/triangle/
// circle/ellipse with explicit direct geometry BEFORE falling back to
// generateShape(), so these always insert (verified live: Circle in R31, and
// rect/triangle are sibling branches of the same function). generateShape() is
// the fallback for the remaining library kinds (rounded-rect + the decoratives)
// and the switch-set override path (DrawPanel), both of which pass real library
// keys. This component just emits the kind string; it invents no geometry.

import { useState } from 'react';
import { IS } from '../../lib/typography';
import { PILL } from '../../lib/chromeStyles';
import { SHAPE_LIBRARY } from '../../lib/draw/shapeLibrary';

/** One pickable shape in the strip. `kind === null` is the Freehand default.
 *  `glyph` is a compact mark for the pill; `label` is the accessible name. */
export interface ShapeStripEntry {
  /** A shapeLibrary kind, a recognizer-core kind (rect/circle/triangle), or null
   *  (Freehand). The host maps this to geometry at insert time. */
  kind: string | null;
  label: string;
  glyph: string;
}

/** The 6 inline shapes after Freehand (spec §5). rect/circle/triangle are the
 *  recognizer's core; diamond/star/heart are the most-wanted library adds.
 *  NOTE the kinds: diamond/heart use their library keys; the star uses the
 *  library key 'star-5'; rect/circle/triangle are recognizer kinds with no
 *  library entry (see KIND NOTE above). */
export const INLINE_SHAPES: ShapeStripEntry[] = [
  { kind: 'rect', label: 'Rectangle', glyph: '▢' },
  { kind: 'circle', label: 'Circle', glyph: '◯' },
  { kind: 'triangle', label: 'Triangle', glyph: '△' },
  { kind: 'diamond', label: 'Diamond', glyph: '◇' },
  { kind: 'star-5', label: 'Star', glyph: '★' },
  { kind: 'heart', label: 'Heart', glyph: '♥' },
];

/** A compact glyph per library kind, for the `More ▾` overflow cells. Library
 *  kinds without a tidy single glyph fall back to the first letter of the label. */
const LIBRARY_GLYPH: Record<string, string> = {
  rectangle: '▭',
  circle: '○',
  triangle: '△',
  'rounded-rect': '▢',
  diamond: '◇',
  pentagon: '⬟',
  hexagon: '⬡',
  octagon: '⯃',
  heart: '♥',
  cloud: '☁',
  'speech-bubble': '💬',
  lightning: '⚡',
  crescent: '☾',
  teardrop: '💧',
  'arrow-block': '➜',
  'star-5': '★',
};

/** The overflow set = every library shape NOT already shown inline (spec §5). */
function overflowEntries(inline: ShapeStripEntry[]): ShapeStripEntry[] {
  const inlineKinds = new Set(inline.map((e) => e.kind));
  return SHAPE_LIBRARY.filter((e) => !inlineKinds.has(e.kind)).map((e) => ({
    kind: e.kind,
    label: e.label,
    glyph: LIBRARY_GLYPH[e.kind] ?? e.label.charAt(0),
  }));
}

export interface ShapeStripProps {
  /** The currently armed shape kind, or null for Freehand (the default). */
  armedShape: string | null;
  /** Arm a shape (insert mode) or pass null to return to Freehand. */
  onArmShape: (kind: string | null) => void;
  /** Override the inline set (defaults to Freehand + INLINE_SHAPES). Lets a
   *  narrow host drop to 4 inline per the spec §13.4 fallback without forking. */
  inlineShapes?: ShapeStripEntry[];
  /** Disable the whole strip (e.g. while the Shade register owns the pointer —
   *  insert is mutually exclusive with shade, spec §5). */
  disabled?: boolean;
  /** COLLAPSED (Sebs 2026-06-15: "the shape row clutters the UI"): render a SINGLE
   *  "Shapes ▾" button that opens a popover grid of every shape (Freehand + all),
   *  instead of the inline pill row. The clean default; Freehand stays the
   *  no-pick default (auto-detect still proposes on freehand pen-up). */
  collapsed?: boolean;
}

/** A single shape pill — inverts to the text-primary bg when it is the armed
 *  tool, exactly like the register pills in DrawToolbar. */
function ShapePill({
  selected,
  disabled,
  title,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      title={title}
      style={{
        ...PILL,
        padding: '6px 12px',
        flexShrink: 0,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        background: selected ? 'var(--dir-text-primary)' : 'var(--dir-bg)',
        color: selected ? 'var(--dir-bg)' : 'var(--dir-text-primary)',
      }}
    >
      {children}
    </button>
  );
}

/** The Shapes quick-pick row. Presentational + controlled; emits onArmShape. */
export function ShapeStrip({
  armedShape,
  onArmShape,
  inlineShapes = INLINE_SHAPES,
  disabled = false,
  collapsed = false,
}: ShapeStripProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflow = overflowEntries(inlineShapes);
  const overflowArmed = overflow.some((e) => e.kind === armedShape);

  // COLLAPSED — one "Shapes ▾" button → a popover grid of every shape. Keeps the
  // toolbar uncluttered; Freehand stays the no-pick default.
  if (collapsed) {
    const all = [...inlineShapes, ...overflow];
    const armedEntry = all.find((e) => e.kind === armedShape);
    return (
      <div data-shape-strip style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
        <ShapePill
          selected={armedShape !== null}
          disabled={disabled}
          title="Shapes — pick one, then drag on the canvas to place it (Freehand = draw + auto-snap)"
          onClick={() => setOverflowOpen((v) => !v)}
        >
          {armedEntry ? (
            <>
              <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>{armedEntry.glyph}</span>
              <span style={{ marginLeft: 6 }}>{armedEntry.label}</span>
            </>
          ) : (
            'Shapes'
          )}
          <span aria-hidden style={{ marginLeft: 6, fontSize: 10, color: armedShape !== null ? 'var(--dir-bg)' : 'var(--dir-text-secondary)' }}>▾</span>
        </ShapePill>
        {overflowOpen && !disabled && (
          <div
            role="menu"
            data-shape-overflow
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              zIndex: 20,
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(72px, 1fr))',
              gap: 6,
              padding: 8,
              borderRadius: 16,
              border: '1px solid var(--dir-border)',
              background: 'var(--dir-bg)',
              boxShadow:
                '0 12px 36px color-mix(in srgb, var(--dir-text-primary) 10%, transparent), 0 2px 8px color-mix(in srgb, var(--dir-text-primary) 6%, transparent)',
            }}
          >
            {all.map((e) => {
              const selected = armedShape === e.kind;
              return (
                <button
                  key={String(e.kind)}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  title={selected ? `${e.label} armed — tap to go back to Freehand` : `Insert ${e.label} — drag to place (Shift = 1:1)`}
                  onClick={() => { onArmShape(selected ? null : e.kind); setOverflowOpen(false); }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 6px',
                    borderRadius: 12, border: '1px solid',
                    borderColor: selected ? 'var(--dir-accent)' : 'var(--dir-border)',
                    background: selected ? 'color-mix(in srgb, var(--dir-accent) 10%, var(--dir-bg))' : 'var(--dir-bg)',
                    color: 'var(--dir-text-primary)', cursor: 'pointer', fontFamily: IS,
                  }}
                >
                  <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{e.glyph}</span>
                  <span style={{ fontSize: 10, fontWeight: 600 }}>{e.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-shape-strip
      style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}
    >
      {/* FREEHAND — the default; selected whenever nothing is armed. */}
      <ShapePill
        selected={armedShape === null}
        disabled={disabled}
        title="Freehand — draw with the pen (auto-detect proposes a shape on pen-up)"
        onClick={() => onArmShape(null)}
      >
        Freehand
      </ShapePill>

      {/* The 6 inline most-common shapes. */}
      {inlineShapes.map((e) => (
        <ShapePill
          key={String(e.kind)}
          selected={armedShape === e.kind}
          disabled={disabled}
          title={`Insert ${e.label} — drag on the canvas to place (Shift = 1:1)`}
          onClick={() => onArmShape(e.kind)}
        >
          <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>{e.glyph}</span>
          <span style={{ marginLeft: 6 }}>{e.label}</span>
        </ShapePill>
      ))}

      {/* MORE ▾ — the long-tail overflow popover (spec §8.3). */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <ShapePill
          selected={overflowArmed}
          disabled={disabled}
          title="More shapes"
          onClick={() => setOverflowOpen((v) => !v)}
        >
          More
          <span aria-hidden style={{ marginLeft: 6, fontSize: 10, color: 'var(--dir-text-secondary)' }}>▾</span>
        </ShapePill>

        {overflowOpen && !disabled && (
          <div
            role="menu"
            data-shape-overflow
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              zIndex: 20,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(76px, 1fr))',
              gap: 6,
              padding: 8,
              borderRadius: 16,
              border: '1px solid var(--dir-border)',
              background: 'var(--dir-bg)',
              boxShadow:
                '0 12px 36px color-mix(in srgb, var(--dir-text-primary) 10%, transparent), 0 2px 8px color-mix(in srgb, var(--dir-text-primary) 6%, transparent)',
            }}
          >
            {overflow.map((e) => {
              const selected = armedShape === e.kind;
              return (
                <button
                  key={String(e.kind)}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  title={`Insert ${e.label}`}
                  onClick={() => {
                    onArmShape(e.kind);
                    setOverflowOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: '8px 6px',
                    borderRadius: 12,
                    border: '1px solid',
                    borderColor: selected ? 'var(--dir-accent)' : 'var(--dir-border)',
                    background: selected ? 'color-mix(in srgb, var(--dir-accent) 10%, var(--dir-bg))' : 'var(--dir-bg)',
                    color: 'var(--dir-text-primary)',
                    cursor: 'pointer',
                    fontFamily: IS,
                  }}
                >
                  <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{e.glyph}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.02em' }}>{e.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
