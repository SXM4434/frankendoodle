import type { CSSProperties } from 'react';
import { IS } from './typography';

// Shared chrome style constants — single source for every page's interactive
// chrome. The /playground page is the visual reference; all pages import
// these rather than declaring their own copies. All interactive controls are
// fully rounded (pill); larger non-interactive surfaces use soft radii
// (popover 16, cards 6-16) and are not governed by PILL.

export const PILL: CSSProperties = {
  borderRadius: 999,
  fontFamily: IS,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  border: '1px solid var(--dir-border)',
  background: 'transparent',
  color: 'var(--dir-text-body)',
  padding: '6px 14px',
  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
};

export const CTA: CSSProperties = {
  ...PILL,
  background: 'var(--dir-cta-bg)',
  color: 'var(--dir-cta-text)',
  borderColor: 'var(--dir-cta-border)',
};

export const SECTION_LABEL: CSSProperties = {
  fontFamily: IS,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--dir-text-secondary)',
  margin: 0,
};

// CHIP — a non-interactive status/count badge. Shares PILL's pill shape +
// uppercase 600 idiom but at badge sizing (10/4×12) and cursor:default, so the
// desk Live chip + gallery Live/count badges stop hand-rolling near-copies.
// Override background/color/border at the call site for state (full/offline).
export const CHIP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  borderRadius: 999,
  fontFamily: IS,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  cursor: 'default',
  padding: '4px 12px',
  border: '1px solid var(--dir-border)',
  background: 'transparent',
  color: 'var(--dir-text-body)',
  whiteSpace: 'nowrap',
};

// RAISED_SHADOW — the tinted elevation used by raised modals + cards (the
// ObjectSurface modal, DrawPanel modal, standalone ObjectCard). One layered,
// hue-tinted drop: a wide ambient cast (primary 10%) + a tight contact cast
// (primary 6%). Single source so every raised surface lifts off the page by the
// same amount instead of drifting between 9% and 10%.
export const RAISED_SHADOW =
  '0 12px 36px color-mix(in srgb, var(--dir-text-primary) 10%, transparent), 0 2px 8px color-mix(in srgb, var(--dir-text-primary) 6%, transparent)';
