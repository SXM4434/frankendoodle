// YourSpacePage — the PERSONAL AREA landing (R9 IA: the "Your space" door from
// the homepage; route /your-space, wired separately).
//
// This is where IDENTITY now lives — NOT forced on /desk. A quick doodler never
// has to claim anything; the claim moment surfaces HERE, on first arrival to the
// personal area (and re-openably via the handle chip / "edit handle"). Per Sebs:
// "if people just wanna do a quick doodle they shouldn't have to make a personal
// space." Identity stays invitational — the deterministic handle is always shown
// as already-yours; settling it is one click and fully skippable.
//
// Structure echoes DeskDoodlesHome: full-height flex column, header (wordmark +
// handle chip), centered paper main, paper-grain DoorCards. All data degrades
// gracefully with the DB off — listMyDesks()/createPrivateDesk() return []/null
// pre-migration, so empty states render honestly and nothing crashes.

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { IS, ISe } from '../../lib/typography';
import { PILL, CTA, SECTION_LABEL, CHIP, RAISED_SHADOW } from '../../lib/chromeStyles';
import { PAPER_GRAIN } from '../../lib/deskCraft';
import {
  isPersonalSpaceEnabled,
  getIdentityId,
  getEffectiveHandle,
  listMyDesks,
  createPrivateDesk,
  deleteMyDesk,
} from '../../lib/personalSpace';
import { displayHandle, handleFromId } from '../../lib/handle';
import { deskName } from '../../lib/deskNames';
import type { DeskRow } from '../../lib/publish';
import { OnboardingFlow, hasOnboarded } from './OnboardingFlow';

export function YourSpacePage() {
  const navigate = useNavigate();

  // First paint shows a handle that's already yours (deterministic, no flicker);
  // the effective handle (claimed → local → deterministic) settles in via effect.
  const [handle, setHandle] = useState<string>(() => handleFromId(getIdentityId()));
  const [desks, setDesks] = useState<DeskRow[]>([]);
  const [loadingDesks, setLoadingDesks] = useState(true);
  const [creating, setCreating] = useState(false);

  // First-run claim: show once, only when the personal space is on and the
  // visitor hasn't onboarded. Re-openable from the chip + "edit handle".
  const [claimOpen, setClaimOpen] = useState<boolean>(
    () => isPersonalSpaceEnabled() && !hasOnboarded(),
  );

  // Effective handle (graceful: getEffectiveHandle never throws, but guard anyway).
  useEffect(() => {
    let alive = true;
    getEffectiveHandle()
      .then((h) => {
        if (alive && h) setHandle(h);
      })
      .catch(() => {
        /* keep the deterministic fallback already in state */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Load my private desks (empty pre-migration; never crashes).
  const refreshDesks = useCallback(async () => {
    setLoadingDesks(true);
    const rows = await listMyDesks().catch(() => [] as DeskRow[]);
    setDesks(rows);
    setLoadingDesks(false);
  }, []);

  useEffect(() => {
    void refreshDesks();
  }, [refreshDesks]);

  // New desk → create, then open it. Null result (DB off) = honest no-op; the
  // empty state keeps inviting them to try once the DB is ready.
  const newDesk = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    // Give each private desk its OWN fun name instead of all "My Desk" (Sebs
    // 2026-06-17: "every desk just makes the same one"). A random index into the
    // same deskName() generator the public wall uses → a unique-feeling label.
    const desk = await createPrivateDesk(deskName(Math.floor(Math.random() * 400) + 13)).catch(() => null);
    setCreating(false);
    if (desk) {
      setDesks((prev) => [desk, ...prev]);
      navigate(`/desk?desk=${desk.id}`);
    }
  }, [creating, navigate]);

  // Delete one of MY desks (+ its doodles). A STYLED inline confirm (✕ arms it →
  // Delete/Cancel), NOT a chrome window.confirm (Sebs 2026-06-17: "the delete
  // popup should be styled, not a chrome alert popping up"). Removes everywhere.
  const [confirmDeskId, setConfirmDeskId] = useState<string | null>(null);
  const [deletingDeskId, setDeletingDeskId] = useState<string | null>(null);
  const removeDesk = useCallback(async (id: string) => {
    setConfirmDeskId(null);
    setDeletingDeskId(id);
    const ok = await deleteMyDesk(id).catch(() => false);
    setDeletingDeskId(null);
    if (ok) {
      setDesks((prev) => prev.filter((d) => d.id !== id));
    } else {
      // RPC not pasted yet (schema-v6-delete-desk.sql) → it can't delete; re-list
      // so the desk stays honestly (Sebs: "deleting doesn't delete, it stays" —
      // that's this: the delete RPC isn't deployed).
      const rows = await listMyDesks().catch(() => [] as DeskRow[]);
      setDesks(rows);
    }
  }, []);

  const safeHandle = handle || handleFromId(getIdentityId());

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--dir-bg)',
        color: 'var(--dir-text-primary)',
        fontFamily: IS,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── HEADER ───────────────────────────────────────────────────────────── */}
      <header
        style={{
          padding: '24px 48px',
          borderBottom: '1px solid var(--dir-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <NavLink
          to="/"
          style={{
            fontFamily: ISe,
            fontSize: 22,
            letterSpacing: '-0.01em',
            color: 'var(--dir-text-primary)',
            textDecoration: 'none',
          }}
        >
          Desk Doodles
        </NavLink>
        {/* Identity chip — your handle; click re-opens the claim overlay. */}
        <button
          onClick={() => setClaimOpen(true)}
          title="Edit your handle"
          style={{ ...CHIP, cursor: 'pointer', background: 'transparent' }}
        >
          {displayHandle(safeHandle)}
        </button>
      </header>

      {/* ── MAIN ─────────────────────────────────────────────────────────────── */}
      <main
        style={{
          flex: 1,
          padding: '72px 48px',
          width: '100%',
          maxWidth: 960,
          marginInline: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 48,
        }}
      >
        {/* WELCOME */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 620 }}>
          <span style={SECTION_LABEL}>Your space</span>
          <h1
            style={{
              fontFamily: ISe,
              fontSize: 44,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              margin: 0,
            }}
          >
            This is your space, {displayHandle(safeHandle)}.
          </h1>
          <p
            style={{
              fontFamily: IS,
              fontSize: 15,
              lineHeight: 1.55,
              color: 'var(--dir-text-body)',
              margin: 0,
              maxWidth: 560,
            }}
          >
            Private desks and a drawer of your own. Your handle is optional — you can stay anonymous
            and just doodle.{' '}
            <button
              onClick={() => setClaimOpen(true)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontFamily: IS,
                fontSize: 15,
                lineHeight: 1.55,
                color: 'var(--dir-text-body-soft)',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              Edit your handle
            </button>
          </p>
        </div>

        {/* MY DESKS */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <h2
              style={{
                fontFamily: ISe,
                fontSize: 26,
                lineHeight: 1.15,
                letterSpacing: '-0.01em',
                margin: 0,
              }}
            >
              My desks
            </h2>
            <button
              onClick={newDesk}
              disabled={creating}
              style={{ ...CTA, padding: '8px 16px', opacity: creating ? 0.6 : 1 }}
            >
              {creating ? 'Making…' : '+ New desk'}
            </button>
          </div>

          {!loadingDesks && desks.length === 0 && (
            <div
              style={{
                position: 'relative',
                overflow: 'hidden',
                background: 'var(--dir-raised)',
                border: '1px solid var(--dir-border)',
                borderRadius: 14,
                boxShadow: RAISED_SHADOW,
                padding: '28px 24px',
              }}
            >
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage: PAPER_GRAIN,
                  opacity: 0.5,
                  pointerEvents: 'none',
                }}
              />
              <p
                style={{
                  position: 'relative',
                  fontFamily: IS,
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: 'var(--dir-text-body)',
                  margin: 0,
                }}
              >
                No private desks yet — make one to keep work just for you.
              </p>
            </div>
          )}

          {desks.length > 0 && (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 14,
              }}
            >
              {desks.map((d) => (
                <li key={d.id}>
                  <NavLink
                    to={`/desk?desk=${d.id}`}
                    style={{
                      position: 'relative',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      background: 'var(--dir-raised)',
                      border: '1px solid var(--dir-border)',
                      borderRadius: 14,
                      boxShadow: RAISED_SHADOW,
                      padding: 18,
                      textDecoration: 'none',
                      color: 'var(--dir-text-primary)',
                      minHeight: 96,
                    }}
                  >
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundImage: PAPER_GRAIN,
                        opacity: 0.5,
                        pointerEvents: 'none',
                      }}
                    />
                    <span
                      style={{
                        position: 'relative',
                        fontFamily: ISe,
                        fontSize: 17,
                        lineHeight: 1.2,
                        letterSpacing: '-0.01em',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {d.name}
                    </span>
                    <span style={{ ...SECTION_LABEL, position: 'relative' }}>
                      {d.object_count} {d.object_count === 1 ? 'doodle' : 'doodles'}
                    </span>
                    {/* Delete — STYLED inline confirm (no chrome alert). ✕ arms a
                        Delete/Cancel chip in place. preventDefault+stopPropagation
                        so it never navigates into the desk. */}
                    <div
                      style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, display: 'flex', gap: 4 }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    >
                      {confirmDeskId === d.id ? (
                        <>
                          <button
                            type="button"
                            disabled={deletingDeskId === d.id}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); void removeDesk(d.id); }}
                            style={{ ...CTA, padding: '4px 10px', fontSize: 10, borderRadius: 999 }}
                          >
                            {deletingDeskId === d.id ? 'Deleting…' : 'Delete'}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDeskId(null); }}
                            style={{ ...PILL, padding: '4px 10px', fontSize: 10 }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Delete ${d.name}`}
                          title="Delete this desk"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDeskId(d.id); }}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 999,
                            border: '1px solid var(--dir-border)',
                            background: 'var(--dir-bg)',
                            color: 'var(--dir-text-body-soft)',
                            cursor: 'pointer',
                            fontSize: 13,
                            lineHeight: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </NavLink>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* DRAWER & SHELF */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <DoorCard
            eyebrow="Drawer & shelf"
            title="Your drawer & shelf"
            body="Your drawer is private — just you, for doodles you're not ready to share. Your shelf is public: the doodles others can browse from your handle."
          >
            <NavLink to="/drawer" style={{ ...CTA, padding: '12px 20px', textDecoration: 'none' }}>
              Open your drawer →
            </NavLink>
          </DoorCard>
        </section>
      </main>

      {/* ── FIRST-RUN / EDIT CLAIM OVERLAY ──────────────────────────────────── */}
      {claimOpen && (
        <OnboardingFlow
          onDone={(h) => {
            setHandle(h);
            setClaimOpen(false);
          }}
        />
      )}
    </div>
  );
}

// One door — a raised paper card with an eyebrow, title, body, and its CTAs.
// Mirrors the DoorCard idiom in DeskDoodlesHome (paper-grain wash, soft radius,
// raised shadow) so the personal area reads as the same house.
function DoorCard({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--dir-raised)',
        border: '1px solid var(--dir-border)',
        borderRadius: 16,
        boxShadow: RAISED_SHADOW,
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        minHeight: 180,
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: PAPER_GRAIN,
          opacity: 0.5,
          pointerEvents: 'none',
        }}
      />
      <span style={{ ...SECTION_LABEL, position: 'relative' }}>{eyebrow}</span>
      <h2
        style={{
          position: 'relative',
          fontFamily: ISe,
          fontSize: 22,
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
          margin: 0,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          position: 'relative',
          fontFamily: IS,
          fontSize: 14,
          lineHeight: 1.5,
          color: 'var(--dir-text-body)',
          margin: 0,
          flex: 1,
        }}
      >
        {body}
      </p>
      <div style={{ position: 'relative', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {children}
      </div>
    </div>
  );
}
