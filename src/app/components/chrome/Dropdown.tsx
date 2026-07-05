import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IS } from '../../lib/typography';

// Custom dropdown popover — replaces native <select> so the open menu
// honors the locked design rules (W1 tokens, IS typography, container
// border + raised surface). Modeled on the Color Lab DirectionSwitcher
// pattern: rich rows (label + name + thesis excerpt), optional section
// headers, current-value marker. Inline popover (not modal) since this
// is a toolbar control, not a ⌘K palette.

// ─── Trigger focus ring (keyboard only) ──────────────────────────────────────
// Inline styles can't express :focus-visible, so the trigger's focus treatment
// lives in ONE injected stylesheet (id-guarded — many Dropdown instances share
// it). :focus-visible only matches keyboard/AT focus, so mouse clicks never
// show a ring; the plain :focus rule keeps the old no-ring look for pointer
// focus. Ring is token-based (accent ink over paper) and follows the pill's
// border-radius via outline-offset.
const TRIGGER_FOCUS_CLASS = 'dd-dropdown-trigger';
const TRIGGER_FOCUS_STYLE_ID = 'dd-dropdown-trigger-focus-style';
const TRIGGER_FOCUS_CSS = `
.${TRIGGER_FOCUS_CLASS}:focus { outline: none; }
.${TRIGGER_FOCUS_CLASS}:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dir-accent) 70%, transparent);
  outline-offset: 2px;
}
`;

function ensureTriggerFocusStyle() {
  if (document.getElementById(TRIGGER_FOCUS_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = TRIGGER_FOCUS_STYLE_ID;
  el.textContent = TRIGGER_FOCUS_CSS;
  document.head.appendChild(el);
}

export type DropdownOption = {
  value: string;
  label: string;
  meta?: string; // right-aligned tag (e.g. "T1-L1")
  detail?: string; // sub-line (thesis / descriptor)
};

export type DropdownSection = {
  heading: string;
  subheading?: string;
  options: DropdownOption[];
};

type Props = {
  label: string;
  value: string;
  placeholder?: string;
  sections: DropdownSection[];
  onChange: (v: string) => void;
  width?: number;
  popoverWidth?: number;
  popoverAlign?: 'left' | 'right';
  renderTrigger?: (active: DropdownOption | undefined) => string;
};

export function Dropdown({
  label,
  value,
  placeholder,
  sections,
  onChange,
  width,
  popoverWidth = 480,
  popoverAlign = 'left',
  renderTrigger,
}: Props) {
  const [open, setOpen] = useState(false);
  // Popover placement, measured at open against the live viewport:
  //   · dir  — flip UP when there isn't room below (long menus near the bottom
  //            would otherwise get cut off); cap maxH to the space available.
  //   · left — horizontal SHIFT (offset from the trigger's left) so a wide menu
  //            inside a right-side panel never spills off the right edge. It
  //            stays fully on-screen with a consistent margin, anchored as close
  //            to the trigger as it can — extending leftward into the canvas when
  //            needed. This is the Floating-UI "shift" / Figma menu behavior.
  // VIEWPORT-ABSOLUTE placement — the popover is PORTALED to <body> with
  // position:fixed (see below), so it can never be clipped by a scrolling
  // ancestor (e.g. the edit modal's overflow:auto control column, which cropped
  // the AI-mesh Material menu — Sebs 2026-06-16 "the dropdown crops"). top/bottom
  // are measured against the live viewport at open.
  const [placement, setPlacement] = useState<{ dir: 'down' | 'up'; maxH: number; left: number; top: number; bottom: number; width: number }>({
    dir: 'down',
    maxH: 600,
    left: 0,
    top: 0,
    bottom: 0,
    width: popoverWidth,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  function toggleOpen() {
    if (!open) {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) {
        const gap = 6;
        const margin = 12;
        // Match the trigger's width (native-select behavior): the menu opens
        // straight below/above its trigger, flush to the panel, inheriting the
        // panel's own edge margin — so it can never bulge past the panel and
        // hug the screen edge. This kills the whole horizontal-spill class.
        const w = r.width;
        // vertical: flip up when there isn't room below
        const below = window.innerHeight - r.bottom - gap - margin;
        const above = r.top - gap - margin;
        const dir = below < 220 && above > below ? 'up' : 'down';
        const maxH = Math.max(160, dir === 'up' ? above : below);
        // horizontal: with width == trigger width this is a no-op in the normal
        // case; it stays as a safety clamp so the menu is never off-screen.
        const vw = window.innerWidth;
        const maxLeft = Math.max(margin, vw - w - margin);
        const desiredLeft = Math.min(Math.max(r.left, margin), maxLeft);
        // Fixed-position anchors (viewport coords): open below → top at the
        // trigger's bottom; open above → bottom at the trigger's top.
        const top = r.bottom + gap;
        const bottom = window.innerHeight - r.top + gap;
        setPlacement({ dir, maxH, left: desiredLeft, top, bottom, width: w });
      }
    }
    setOpen((v) => !v);
  }

  const allOptions = sections.flatMap((s) => s.options);
  const active = allOptions.find((o) => o.value === value);
  const triggerText = renderTrigger
    ? renderTrigger(active)
    : active
      ? active.label
      : (placeholder ?? '—');

  // One shared stylesheet for the keyboard focus ring (see top of file).
  useEffect(() => {
    ensureTriggerFocusStyle();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      // The popover is portaled OUTSIDE rootRef now → also exempt it, else a
      // mousedown on an option would read as "outside" and close before the
      // option's click lands.
      if (rootRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // ESCAPE LAYERING: when the popover is open, Escape closes ONLY the
      // popover — the top layer. Host modals (DrawPanel / ObjectSurface) close
      // on bubble-phase window keydown, so this listener runs in the CAPTURE
      // phase on document (fires first regardless of registration order) and
      // stops propagation so the event never reaches the modal. One press,
      // one layer; the next press reaches the modal because this listener is
      // only attached while the popover is open.
      e.stopPropagation();
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontFamily: IS,
        fontSize: 11,
        width: width ?? '100%',
      }}
    >
      <span
        style={{
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--dir-text-secondary)',
          fontWeight: 600,
          fontSize: 10,
        }}
      >
        {label}
      </span>
      <button
        type="button"
        className={TRIGGER_FOCUS_CLASS}
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          position: 'relative',
          fontFamily: IS,
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--dir-text-primary)',
          backgroundColor: 'var(--dir-bg)',
          // Single border shorthand — never mix with borderColor longhand
          // (React dev warns on shorthand/longhand style conflicts). The
          // hover handlers below set the full shorthand for the same reason.
          border: '1px solid var(--dir-border)',
          borderRadius: 999,
          padding: '10px 36px 10px 16px',
          cursor: 'pointer',
          appearance: 'none',
          // No inline outline:none — focus treatment lives in the injected
          // .dd-dropdown-trigger rules (keyboard :focus-visible ring only).
          lineHeight: 1.4,
          textAlign: 'left',
          width: '100%',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          transition: 'border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.border = '1px solid var(--dir-text-secondary)')}
        onMouseLeave={(e) => (e.currentTarget.style.border = '1px solid var(--dir-border)')}
      >
        {triggerText}
        {/* Chevron in its own span: icon ink is text-secondary (the trigger
            text itself stays text-primary). currentColor flips with direction. */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            pointerEvents: 'none',
            color: 'var(--dir-text-secondary)',
          }}
        >
          <svg width="10" height="6" viewBox="0 0 10 6">
            <path
              d="M1 1l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          role="listbox"
          style={{
            // PORTALED to <body> + position:fixed so NO ancestor overflow can
            // clip it (the edit modal's scrolling control column was cropping
            // the menu). Coords are viewport-absolute (measured at open).
            position: 'fixed',
            // Flip up when there's no room below (cut-off fix); cap height to
            // the available space so long menus scroll instead of spilling off.
            ...(placement.dir === 'up'
              ? { bottom: placement.bottom }
              : { top: placement.top }),
            // Horizontal: viewport-absolute left, clamped on-screen at open.
            left: placement.left,
            zIndex: 4000,
            // Menu width == trigger width (measured at open); falls back to the
            // popoverWidth prop before first measurement.
            width: placement.width,
            maxHeight: placement.maxH,
            overflowY: 'auto',
            backgroundColor: 'var(--dir-bg)',
            border: '1px solid var(--dir-border)',
            borderRadius: 16,
            boxShadow:
              '0 12px 36px color-mix(in srgb, var(--dir-text-primary) 10%, transparent), 0 2px 8px color-mix(in srgb, var(--dir-text-primary) 6%, transparent)',
            fontFamily: IS,
            padding: 6,
          }}
        >
          {sections.map((section, si) => (
            <section key={section.heading + si} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(section.heading || section.subheading) && (
                <div
                  style={{
                    padding: '10px 14px 6px',
                    fontFamily: IS,
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--dir-text-secondary)',
                    marginTop: si === 0 ? 0 : 6,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 8,
                  }}
                >
                  <span>{section.heading}</span>
                  {section.subheading && (
                    <span
                      style={{
                        fontWeight: 400,
                        letterSpacing: '0.04em',
                        color: 'var(--dir-text-body-soft)',
                        textTransform: 'none',
                      }}
                    >
                      {section.subheading}
                    </span>
                  )}
                </div>
              )}
              {section.options.map((opt) => {
                const isActive = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                          'var(--dir-raised)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                        isActive ? 'var(--dir-recessed)' : 'transparent';
                    }}
                    style={{
                      width: '100%',
                      display: 'grid',
                      gridTemplateColumns: opt.meta ? '56px 1fr auto' : '1fr auto',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      border: 'none',
                      background: isActive ? 'var(--dir-recessed)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: IS,
                      color: 'var(--dir-text-primary)',
                      // Concentric radius: popover is 16 with 6px padding,
                      // so nested rows get 16 - 6 = 10. NOT pill — full-round
                      // reads as a lozenge on multi-line option rows.
                      borderRadius: 10,
                      transition: 'background 0.1s',
                    }}
                  >
                    {opt.meta && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 500,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--dir-text-secondary)',
                          alignSelf: 'start',
                          marginTop: 2,
                        }}
                      >
                        {opt.meta}
                      </span>
                    )}
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: isActive ? 600 : 500,
                          lineHeight: 1.3,
                          letterSpacing: '-0.005em',
                          color: 'var(--dir-text-primary)',
                        }}
                      >
                        {opt.label}
                      </span>
                      {opt.detail && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 400,
                            lineHeight: 1.45,
                            color: 'var(--dir-text-body-soft)',
                          }}
                        >
                          {opt.detail}
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: isActive ? 'var(--dir-accent)' : 'transparent',
                        flexShrink: 0,
                        alignSelf: 'center',
                      }}
                    />
                  </button>
                );
              })}
            </section>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
