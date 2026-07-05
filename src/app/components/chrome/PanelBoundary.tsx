import { Component, type CSSProperties, type ReactNode } from 'react';
import { IS } from '../../lib/typography';
import { PILL } from '../../lib/chromeStyles';

// ─── PanelBoundary — per-panel error isolation (Rock B, 2026-06-12) ─────────
//
// WHY: a throw inside ANY panel subtree (drawer, right pen panel, a popup
// surface) used to bubble to React Router's route-level error boundary, which
// replaces the WHOLE page — the desk canvas blanked because a side panel hit
// a bug (the smashers hit this twice during fleet churn). This boundary fences
// each panel: the panel shows a quiet fallback, the DESK SURVIVES.
//
// React error boundaries catch render errors, lifecycle errors AND commit-
// phase effect errors (useEffect/useLayoutEffect throws) from the subtree —
// which is exactly the failure class panels produce (style-engine effects,
// data-shape surprises). They do NOT catch event-handler/async throws; those
// already fail soft (React keeps the tree mounted).
//
// FALLBACK CONTRACT: quiet, on-system, never alarmist. Copy is fixed:
// "This panel hit a snag — reload to restore." + a retry pill that REMOUNTS
// the children (key bump → fresh subtree, fresh state). Popups additionally
// get a Close pill (onDismiss) so a dead popup never traps the user.
//
// VARIANTS:
//   'panel' (default) — in-flow quiet block, for the drawer / right chrome.
//   'popup'           — fixed centered card; a crashed popup unmounts its own
//                       fixed overlay + scrim, so the fallback must place
//                       itself (centered, raised) to be seen at all.

/** DEV-only crash probe — lets the resilience battery kill a specific panel
 *  deterministically without editing the panel's source:
 *    window.__dd_crashPanel = '<label>'   → that panel's subtree throws on
 *    its next render. The throw happens HERE (a child of the boundary), never
 *    in the boundary itself — boundaries can't catch their own render errors.
 *  Dead code in production builds (import.meta.env.DEV guard). */
function CrashProbe({ label, children }: { label: string; children: ReactNode }) {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const target = (window as unknown as { __dd_crashPanel?: unknown }).__dd_crashPanel;
    if (target === label) {
      throw new Error(`[PanelBoundary test] forced crash of panel "${label}"`);
    }
  }
  return <>{children}</>;
}

type PanelBoundaryProps = {
  /** Stable name for the wrapped panel — appears in the console.warn and is
   *  the DEV crash-probe key (window.__dd_crashPanel = label). */
  label: string;
  /** 'panel' = in-flow quiet block (side chrome). 'popup' = fixed centered
   *  card (the crashed popup's own overlay is gone with its subtree). */
  variant?: 'panel' | 'popup';
  /** Popup escape hatch — renders a Close pill in the fallback so a dead
   *  popup can be dismissed, not just retried (DeskPage passes the same
   *  close-state setter the popup itself would call). */
  onDismiss?: () => void;
  children: ReactNode;
};

type PanelBoundaryState = {
  error: Error | null;
  /** Remount generation — bumped by Retry; keys the child subtree so a retry
   *  is a TRUE remount (fresh component state), not a re-render of the
   *  poisoned tree. */
  generation: number;
};

const FALLBACK_PANEL: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  padding: '28px 20px',
  fontFamily: IS,
  fontSize: 12,
  fontStyle: 'italic',
  lineHeight: 1.6,
  color: 'var(--dir-text-body-soft)',
  textAlign: 'center',
};

const FALLBACK_POPUP: CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 60, // above the desk; the dead popup's own overlay is unmounted
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  padding: '28px 32px',
  fontFamily: IS,
  fontSize: 12,
  fontStyle: 'italic',
  lineHeight: 1.6,
  color: 'var(--dir-text-body-soft)',
  textAlign: 'center',
  background: 'var(--dir-raised)',
  border: '1px solid var(--dir-border)',
  borderRadius: 12,
  boxShadow: '0 12px 40px rgba(40, 30, 20, 0.18)',
  maxWidth: 360,
};

export class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  state: PanelBoundaryState = { error: null, generation: 0 };

  static getDerivedStateFromError(error: Error): Partial<PanelBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // One honest line per crash — the desk itself is fine, say so.
    console.warn(
      `[PanelBoundary:${this.props.label}] panel crashed — desk survives, fallback shown.`,
      error,
      info.componentStack ?? '',
    );
  }

  private retry = () => {
    // Key bump = full remount of the child subtree; error cleared so the
    // boundary renders children again. If the crash was transient (the case
    // worth a retry), the panel comes back whole.
    this.setState((s) => ({ error: null, generation: s.generation + 1 }));
  };

  render() {
    const { label, variant = 'panel', onDismiss, children } = this.props;
    const { error, generation } = this.state;

    if (error) {
      return (
        <div role="alert" style={variant === 'popup' ? FALLBACK_POPUP : FALLBACK_PANEL}>
          <span>This panel hit a snag — reload to restore.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={this.retry} style={{ ...PILL, fontStyle: 'normal' }}>
              Reload panel
            </button>
            {onDismiss && (
              <button onClick={onDismiss} style={{ ...PILL, fontStyle: 'normal' }}>
                Close
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <CrashProbe key={generation} label={label}>
        {children}
      </CrashProbe>
    );
  }
}
