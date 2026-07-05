// DeskDoodlesAudit — full-inventory verification matrix.
//
// Renders ALL 197 shape cases (93 Trophy Wall PinShape + 104 Pegboard
// PegToolShape) as a single grid wrapped in SvgStyleTransform, alongside the
// same SmartHachureChrome the playground uses. Twisting any modifier updates
// all 197 simultaneously — visual scan of the grid IS the
// audit pass. Per-cell label includes subject + shape id so failures are
// pinpointable in the dd-diag console output.
//
// Companion of DeskDoodlesPlayground; kept separate so the playground stays
// single-item focused.
import { useEffect, useMemo, type CSSProperties } from 'react';
import { NavLink } from 'react-router';
import { IS, ISe } from '../../lib/typography';
import { SECTION_LABEL } from '../../lib/chromeStyles';
import {
  F3_TROPHY_WALL_SUBJECTS,
  F3_PEGBOARD_SUBJECTS,
  type F3TrophyWallShapeId,
  type F3PegboardShapeId,
} from '../../lib/items/identitySet';
import { PinShape } from '../../lib/items/PinShape';
import { PegToolShape } from '../../lib/items/PegToolShape';
import { SvgStyleTransform } from '../canvas/SvgStyleTransform';
import { SmartHachureChrome } from '../chrome/SmartHachureChrome';
import {
  CollapsiblePanel,
  PanelToggle,
  useMinimizeUi,
  usePanelOpen,
} from '../chrome/CollapsiblePanel';

type AuditCell = {
  kind: 'trophy';
  shape: F3TrophyWallShapeId;
  label: string;
  subjectId: string;
  subjectName: string;
} | {
  kind: 'pegboard';
  shape: F3PegboardShapeId;
  label: string;
  subjectId: string;
  subjectName: string;
};

/** Flatten all subject forms → one cell per UNIQUE shape id.
 *  Trophy Wall (93) + Pegboard (104) both ported per fork-everything rule.
 *  Some shape ids appear under multiple subjects in the trophy set
 *  (e.g. `polaroid` under GF + fidget + seltzer); dedupe by shape id,
 *  keep first subject seen. Pegboard + Trophy share no shape names so
 *  no cross-kind dedupe needed. */
function flattenInventory(): AuditCell[] {
  const seenTrophy = new Set<F3TrophyWallShapeId>();
  const seenPeg = new Set<F3PegboardShapeId>();
  const out: AuditCell[] = [];
  for (const subj of F3_TROPHY_WALL_SUBJECTS) {
    for (const form of subj.forms) {
      if (seenTrophy.has(form.shape)) continue;
      seenTrophy.add(form.shape);
      out.push({
        kind: 'trophy',
        shape: form.shape,
        label: form.label,
        subjectId: subj.id,
        subjectName: subj.displayName,
      });
    }
  }
  for (const subj of F3_PEGBOARD_SUBJECTS) {
    for (const form of subj.forms) {
      if (seenPeg.has(form.shape)) continue;
      seenPeg.add(form.shape);
      out.push({
        kind: 'pegboard',
        shape: form.shape,
        label: form.label,
        subjectId: subj.id,
        subjectName: subj.displayName,
      });
    }
  }
  return out;
}

export function DeskDoodlesAudit() {
  const inventory = useMemo(flattenInventory, []);
  const [rightOpen, toggleRight, setRightOpen] = usePanelOpen('audit.right');
  useMinimizeUi([{ open: rightOpen, setOpen: setRightOpen }]);

  // Enable dd-diag console logging so silent clamps log automatically. Smart
  // Hachure is now default-ON in SvgStyleTransform (opt-out via ?smartHachure=0),
  // so no URL-param dance + reload is needed — that reload was the white flash.
  useEffect(() => {
    (window as { __dd_diag?: boolean }).__dd_diag = true;
    return () => {
      (window as { __dd_diag?: boolean }).__dd_diag = false;
    };
  }, []);

  return (
    <div
      style={{
        // Definite height (not min-height) so the page never scrolls — the
        // left grid and right panel each scroll internally (/canvas pattern).
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        background: 'var(--dir-bg)',
        color: 'var(--dir-text-primary)',
        fontFamily: IS,
      }}
    >
      {/* ─── LEFT — audit grid ─────────────────────────────────────── */}
      <main style={{ flex: 1, minWidth: 0, padding: '20px 28px', overflowY: 'auto' }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
            <NavLink
              to="/"
              style={{
                fontFamily: ISe,
                fontSize: 17,
                letterSpacing: '-0.01em',
                color: 'var(--dir-text-primary)',
                textDecoration: 'none',
              }}
            >
              Desk Doodles
            </NavLink>
            <span style={SECTION_LABEL}>Audit · {inventory.length} shapes</span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
            <NavLink to="/playground" style={LINK}>← Playground</NavLink>
            <span style={{ ...SECTION_LABEL, color: 'var(--dir-text-body-soft)' }}>
              dd-diag on (check console)
            </span>
            <PanelToggle
              side="right"
              open={rightOpen}
              label="Controls"
              onToggle={toggleRight}
              controlsId="audit-right-panel"
            />
          </div>
        </header>

        <p style={{ ...SECTION_LABEL, color: 'var(--dir-text-body-soft)', marginBottom: 14 }}>
          Every shape rendered through current Style + Modifier state. Twist controls →
          all cells update. Failures (silent clamp, broken render, no-op past threshold)
          are visible by visual scan + dd-diag console output.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: 18,
          }}
        >
          {inventory.map((cell) => (
            <article
              key={cell.shape}
              data-shape-id={cell.shape}
              data-subject-id={cell.subjectId}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 10,
                border: '1px solid var(--dir-border)',
                borderRadius: 6,
                background: 'var(--dir-raised)',
              }}
            >
              <div
                style={{
                  aspectRatio: '1 / 1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  background: 'var(--dir-bg)',
                  borderRadius: 4,
                }}
              >
                <SvgStyleTransform>
                  {cell.kind === 'trophy'
                    ? <PinShape shape={cell.shape} />
                    : <PegToolShape shape={cell.shape} />}
                </SvgStyleTransform>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 28 }}>
                <span
                  style={{
                    fontFamily: IS,
                    fontSize: 10,
                    fontWeight: 500,
                    color: 'var(--dir-text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={cell.label}
                >
                  {cell.label}
                </span>
                <span
                  style={{
                    fontFamily: IS,
                    fontSize: 9,
                    color: 'var(--dir-text-body-soft)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  {cell.subjectName} · {cell.shape}
                </span>
              </div>
            </article>
          ))}
        </div>
      </main>

      {/* ─── RIGHT — same chrome as playground ─────────────────────── */}
      <CollapsiblePanel
        side="right"
        open={rightOpen}
        width={480}
        id="audit-right-panel"
        style={{
          borderLeft: '1px solid var(--dir-border)',
          background: 'var(--dir-raised)',
          overflowY: 'auto',
        }}
      >
        <SmartHachureChrome />
      </CollapsiblePanel>
    </div>
  );
}

const LINK: CSSProperties = {
  fontFamily: IS,
  fontSize: 11,
  color: 'var(--dir-text-body)',
  textDecoration: 'none',
};
