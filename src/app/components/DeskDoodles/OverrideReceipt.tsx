// ─── OverrideReceipt — the persistent shape-override receipt (UX rework §4.4) ─
// A CONTROLLED, PRESENTATIONAL component (owns no canvas state). It is the
// DISPOSE half of propose-dispose: it appears right after a stroke auto-detects
// and stays VISIBLE until the host tears it down (a new stroke commits, the
// register/input/mode switches, Done/Save, or an explicit dismiss). NO TIMER —
// a fade-out would make an un-noticed auto-snap un-undoable except by re-draw,
// which IS "forced" (spec §4.4, load-bearing for SEBS'S LAW, never-force-a-fit).
//
// Three affordances on one persistent pill (spec §4.1 — fewer clicks than the old
// chip-cycle):
//   1. Tap the LABEL = cycle to the next switch entry (the cheap 1-tap path).
//      onCycleOverride().
//   2. Tap "✎ all" = open the SwitchPopover to pick ANY of recognized / the 12
//      library shapes / Original in 1 tap. onToggleAll().
//   3. Tap ✕ = dismiss (keep the standing choice; host logs 'keep').
//      onDismiss().
//
// This file does NOT mount the SwitchPopover itself — the host decides placement
// (so it can anchor the popover relative to the receipt). `allOpen` only drives
// the ✎-all pill's pressed state. The host renders <SwitchPopover> when allOpen.
//
// Matches the DrawToolbar SnapChip pill grammar: fully-rounded pill, accent dot
// = a system act, IS typography, var(--dir-*) tokens, no accent-ink background
// (system rule).

import { IS } from '../../lib/typography';
import type { ShapeOverride } from '../../lib/draw/switchSet';

export interface OverrideReceiptProps {
  /** The override to show, or null = nothing to override right now (the receipt
   *  renders nothing). The label is `override.appliedKind`'s switch-set entry. */
  override: ShapeOverride | null;
  /** Tap the label = cycle to the next switch entry (cheap path). */
  onCycleOverride: () => void;
  /** Toggle the "✎ all" SwitchPopover (host mounts the popover when open). */
  onToggleAll: () => void;
  /** Whether the SwitchPopover is currently open (drives ✎-all pressed state). */
  allOpen: boolean;
  /** Dismiss the receipt — keep the standing choice; host logs 'keep'. */
  onDismiss: () => void;
}

/** Resolve the receipt's display label from the override's applied entry, falling
 *  back to the raw appliedKind if the index is stale. */
function appliedLabel(override: ShapeOverride): string {
  const entry = override.switchSet[override.appliedIndex];
  if (entry) return entry.label;
  const byKind = override.switchSet.find((e) => e.kind === override.appliedKind);
  return byKind?.label ?? String(override.appliedKind);
}

/** The persistent override receipt. Renders null when there's nothing to dispose. */
export function OverrideReceipt({
  override,
  onCycleOverride,
  onToggleAll,
  allOpen,
  onDismiss,
}: OverrideReceiptProps) {
  if (!override) return null;

  const label = appliedLabel(override);
  // There's something to cycle whenever the switch set holds more than the one
  // applied entry (it always holds library + Original, so this is ≈ always true,
  // but we guard for the degenerate single-entry case).
  const hasAlternatives = override.switchSet.length > 1;

  return (
    <div
      data-override-receipt
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        border: '1px solid var(--dir-border)',
        background: 'var(--dir-bg)',
        padding: '4px 6px 4px 10px',
        flexShrink: 0,
        minWidth: 0,
        fontFamily: IS,
      }}
    >
      {/* Accent dot — a system act surfaced for the user to dispose. */}
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--dir-accent)', flexShrink: 0 }}
      />

      {/* LABEL — tap to cycle the next switch entry (cheap 1-tap path). */}
      <button
        type="button"
        data-override-cycle
        onClick={onCycleOverride}
        disabled={!hasAlternatives}
        title={hasAlternatives ? 'Tap to try another shape' : 'Only one reading — nothing to cycle'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          border: 'none',
          background: 'transparent',
          padding: '2px 2px',
          cursor: hasAlternatives ? 'pointer' : 'default',
          fontFamily: IS,
          minWidth: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--dir-text-primary)', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {hasAlternatives && (
          <span aria-hidden style={{ fontSize: 11, color: 'var(--dir-text-secondary)' }}>▸</span>
        )}
      </button>

      {/* ✎ all — open the full SwitchPopover (recognized · library · Original). */}
      <button
        type="button"
        data-override-all
        onClick={onToggleAll}
        aria-pressed={allOpen}
        aria-expanded={allOpen}
        aria-haspopup="menu"
        title="Switch to any shape"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          borderRadius: 999,
          border: '1px solid var(--dir-border)',
          background: allOpen ? 'var(--dir-text-primary)' : 'var(--dir-bg)',
          color: allOpen ? 'var(--dir-bg)' : 'var(--dir-text-secondary)',
          padding: '3px 9px',
          cursor: 'pointer',
          fontFamily: IS,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.04em',
          flexShrink: 0,
        }}
      >
        <span aria-hidden>✎</span>
        <span>all</span>
      </button>

      {/* ✕ — dismiss; keep the standing choice (host logs 'keep'). NO timer. */}
      <button
        type="button"
        data-override-dismiss
        onClick={onDismiss}
        aria-label="Dismiss — keep this shape"
        title="Keep this shape"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: 999,
          border: 'none',
          background: 'transparent',
          color: 'var(--dir-text-secondary)',
          cursor: 'pointer',
          fontFamily: IS,
          fontSize: 12,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
