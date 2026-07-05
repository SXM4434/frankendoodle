import { useCallback, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { IS, ISe } from '../../lib/typography';
import { PILL, SECTION_LABEL, CHIP } from '../../lib/chromeStyles';
import { PAPER_GRAIN, WARM_POOL } from '../../lib/deskCraft';
import { normalizeSvgSize } from '../../lib/normalizeInput';
import {
  listDesks,
  listDoodlesForDesk,
  type DeskRow,
  type DoodleRow,
} from '../../lib/publish';
import { sanitizeSvgMarkup } from '../../lib/svgUpload';
import { buildDemoWall, type DemoWallObject } from '../../lib/demoWall';

// ─── DeskGallery — the public "wall of walls" (/desks) ──────────────────────
// Grounds in docs/design/object-model-and-desk-architecture.md, Multi-desk
// section: "Gallery to browse past desks — a newest-first grid of desk cards.
// Keep it simple." Each card is a VIEW of a desk RECORD (the doc's unifying
// frame): name + object-count + a LIVE-CAPPED mini-desk preview (the desk's
// first ~6 doodles scattered on a tiny warm-paper surface — see MiniDesk).
// Clicking a card opens that desk at /desk?desk=<desk_index> (DeskPage reads).
//
// Load states are not crashes. A pre-v2 DB makes listDesks return [] (a clean
// EMPTY state); a thrown/timed-out listDesks is caught into a distinct ERROR
// state (honest "couldn't reach the wall" + Retry), NOT folded into the empty
// placeholder — a hang or network failure is a different truth than "no desks
// yet", and the live demo must say which it is. listDesks() is timeout-bounded
// in publish.ts, so a slow/unreachable backend rejects here instead of leaving
// the gallery stuck on "Loading the wall…" forever (the demo-killer fix).

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; desks: DeskRow[] }
  | { phase: 'error' };

export function DeskGallery() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  // Bumped by the Retry pill — re-runs the load effect from scratch.
  const [reloadNonce, setReloadNonce] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading' });
    listDesks()
      .then((desks) => {
        if (!cancelled) setState({ phase: 'ready', desks });
      })
      .catch(() => {
        // Table absent / network / RLS / TIMEOUT — never crash, never hang;
        // surface the honest error state with a Retry affordance.
        if (!cancelled) setState({ phase: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  const retry = useCallback(() => setReloadNonce((n) => n + 1), []);

  const desks = state.phase === 'ready' ? state.desks : [];
  // EMPTY is now ONLY the genuine no-desks-yet case (connected, nothing there).
  // ERROR is its own state below — honest copy + Retry, not the empty placeholder.
  const isEmpty = state.phase === 'ready' && desks.length === 0;

  return (
    <div
      style={{
        // Definite height (not min-height) — same viewport-fit chain as /desk
        // and /canvas: header is auto, the grid body takes the leftover and
        // scrolls internally so the page chrome never scrolls.
        height: '100vh',
        background: 'var(--dir-bg)',
        color: 'var(--dir-text-primary)',
        fontFamily: IS,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top chrome — brand left, title center, back-to-open-desk right */}
      <header
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--dir-border)',
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 24,
          background: 'var(--dir-bg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <NavLink
            to="/"
            style={{
              fontFamily: ISe,
              fontSize: 18,
              letterSpacing: '-0.01em',
              color: 'var(--dir-text-primary)',
              textDecoration: 'none',
            }}
          >
            Desk Doodles
          </NavLink>
        </div>

        <div style={{ ...SECTION_LABEL, justifySelf: 'center' }}>The wall of walls</div>

        <div style={{ justifySelf: 'end', display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Back to the open desk — bare /desk opens whichever desk is current. */}
          <NavLink
            to="/desk"
            style={{
              fontFamily: IS,
              fontSize: 13,
              color: 'var(--dir-text-body)',
              textDecoration: 'none',
            }}
          >
            Back to the desk →
          </NavLink>
        </div>
      </header>

      {/* Body — scrollable grid of desk cards. The DEMO WALL card always leads
          (Sebs 2026-06-15: "add the desk to the wall of walls so I can open the
          desk"); it works with NO backend, so the wall-of-walls is never empty
          and the demo desk is always one click away — ideal for recording. Real
          desks append when the DB load resolves; loading/error fall to a small
          note BELOW the grid instead of taking over the screen. */}
      <main style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '32px 24px' }}>
        <div
          style={{
            display: 'grid',
            // Responsive: as many ~240px columns as fit, then stretch.
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 20,
            maxWidth: 1280,
            marginInline: 'auto',
          }}
        >
          {/* The always-available demo wall → opens /desk?demo=1. */}
          <DemoDeskCard onOpen={() => navigate('/desk?demo=1')} />

          {state.phase === 'ready' &&
            desks.map((desk) => (
              <DeskCard
                key={desk.id}
                desk={desk}
                onOpen={() => navigate(`/desk?desk=${desk.desk_index}`)}
              />
            ))}
        </div>

        {state.phase === 'loading' && (
          <div style={{ ...centeredNoteStyle, height: 'auto', marginTop: 28 }}>Loading more walls…</div>
        )}

        {state.phase === 'error' && (
          <div style={{ ...centeredNoteStyle, height: 'auto', marginTop: 28 }}>
            Couldn’t reach the rest of the wall — the demo wall above still opens.
            <div style={{ marginTop: 12 }}>
              <button type="button" onClick={retry} style={{ ...PILL }}>
                Retry
              </button>
            </div>
          </div>
        )}

        {state.phase === 'ready' && isEmpty && (
          <div style={{ ...centeredNoteStyle, height: 'auto', marginTop: 28 }}>
            No community desks yet — be the first.{' '}
            <NavLink
              to="/desk"
              style={{ fontFamily: IS, fontSize: 13, color: 'var(--dir-link-color)', textDecoration: 'none' }}
            >
              Start doodling →
            </NavLink>
          </div>
        )}
      </main>
    </div>
  );
}

const centeredNoteStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  textAlign: 'center',
  color: 'var(--dir-text-body-soft)',
  fontFamily: IS,
  fontSize: 13,
  lineHeight: 1.7,
} as const;

function DeskCard({ desk, onOpen }: { desk: DeskRow; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  const full = desk.object_count >= desk.object_cap;

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        // Card frame — non-interactive radius band (6–16); raised surface with
        // a border per the F1 bordered-card pattern. The whole card is the
        // click target so it reads as one collectible tile, not a form.
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        padding: 0,
        textAlign: 'left',
        background: 'var(--dir-raised)',
        border: '1px solid var(--dir-border)',
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: hover ? '0 6px 20px color-mix(in srgb, var(--dir-text-primary) 10%, transparent)' : 'none',
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'box-shadow 0.18s ease-out, transform 0.18s ease-out, border-color 0.15s',
        borderColor: hover ? 'var(--dir-text-body-soft)' : 'var(--dir-border)',
        font: 'inherit',
        color: 'inherit',
      }}
    >
      {/* Mini-desk preview — the desk's first ~6 doodles scattered on a tiny
          warm-paper surface so the card reads as a real little desk, not a
          single thumbnail (decided 06-11, LIVE-CAPPED approach). */}
      <div
        style={{
          position: 'relative',
          aspectRatio: '4 / 3',
          width: '100%',
          borderBottom: '1px solid var(--dir-border)',
          overflow: 'hidden',
          // The shared warm-paper craft material (lib/deskCraft) — the SAME
          // stock the real desk + ObjectCard use, composed as the card bg:
          // backgroundColor (paper) under the grain + the warm light pool.
          backgroundColor: 'var(--dir-bg)',
          backgroundImage: `${PAPER_GRAIN}, ${WARM_POOL}`,
        }}
      >
        <MiniDesk desk={desk} />

        {/* Live indicator — the single currently-open desk (is_open, partial
            unique index guarantees exactly one). Sits over the thumbnail. */}
        {desk.is_open && (
          <span
            style={{
              ...CHIP,
              // Float over the thumbnail; opaque bg so the mark behind doesn't
              // bleed through (the desk surface is transparent in CHIP).
              position: 'absolute',
              top: 10,
              left: 10,
              background: 'var(--dir-bg)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: 'var(--dir-accent)',
                display: 'inline-block',
              }}
            />
            Live
          </span>
        )}
      </div>

      {/* Caption row — desk name (prominent, ISe) + object-count badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 16px',
        }}
      >
        <span
          style={{
            fontFamily: ISe,
            fontSize: 17,
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
            color: 'var(--dir-text-primary)',
            // Long fun names (e.g. "Golden Hour Cafecito") stay on the card.
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
          title={desk.name}
        >
          {desk.name}
        </span>

        <span
          style={{
            ...CHIP,
            flexShrink: 0,
            // Full desks read as "closed/complete"; filling desks stay neutral.
            background: full ? 'var(--dir-chip-bg)' : 'transparent',
            color: full ? 'var(--dir-text-body)' : 'var(--dir-text-secondary)',
          }}
          title={full ? 'This desk is full' : `${desk.object_count} of ${desk.object_cap} objects`}
        >
          {desk.object_count} / {desk.object_cap}
          {full ? ' · Full' : ''}
        </span>
      </div>
    </button>
  );
}

// ─── DemoDeskCard — the always-available demo wall (no backend) ──────────────
// A real-looking desk card whose preview is built from the catalog (buildDemoWall)
// instead of a DB fetch. Clicking it opens /desk?demo=1 — the curated 21-object
// wall. Same frame grammar as DeskCard so it sits in the grid as a peer.
function DemoDeskCard({ onOpen }: { onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        padding: 0,
        textAlign: 'left',
        background: 'var(--dir-raised)',
        border: '1px solid var(--dir-border)',
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: hover ? '0 6px 20px color-mix(in srgb, var(--dir-text-primary) 10%, transparent)' : 'none',
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'box-shadow 0.18s ease-out, transform 0.18s ease-out, border-color 0.15s',
        borderColor: hover ? 'var(--dir-text-body-soft)' : 'var(--dir-border)',
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '4 / 3',
          width: '100%',
          borderBottom: '1px solid var(--dir-border)',
          overflow: 'hidden',
          backgroundColor: 'var(--dir-bg)',
          backgroundImage: `${PAPER_GRAIN}, ${WARM_POOL}`,
        }}
      >
        <DemoMiniDesk />
        <span style={{ ...CHIP, position: 'absolute', top: 10, left: 10, background: 'var(--dir-bg)' }}>
          <span
            aria-hidden
            style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--dir-accent)', display: 'inline-block' }}
          />
          Demo
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 16px',
        }}
      >
        <span
          style={{
            fontFamily: ISe,
            fontSize: 17,
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
            color: 'var(--dir-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
          title="The Showcase Wall — every style, no setup"
        >
          The Showcase Wall
        </span>
        <span
          style={{ ...CHIP, flexShrink: 0, background: 'transparent', color: 'var(--dir-text-secondary)' }}
          title="21 catalog objects across every render style"
        >
          21 / 120
        </span>
      </div>
    </button>
  );
}

/** The demo card's mini preview — first ~6 catalog objects (buildDemoWall) on the
 *  card's warm-paper surface, scattered via the same SCATTER table MiniDesk uses. */
function DemoMiniDesk() {
  const [objs, setObjs] = useState<DemoWallObject[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    buildDemoWall(MINI_CAP)
      .then((o) => {
        if (!cancelled) setObjs(o);
      })
      .catch(() => {
        if (!cancelled) setObjs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!objs || objs.length === 0) return <EmptyDeskMark />;
  return (
    <div style={{ position: 'absolute', inset: 0 }} aria-hidden>
      {objs.slice(0, MINI_CAP).map((o, i) => {
        const slot = SCATTER[i];
        const markup = sanitizeSvgMarkup(
          normalizeSvgSize(o.svgMarkup, Math.round(MINI_DOODLE_PX * slot.scale)),
        );
        return (
          <div
            key={o.id}
            style={{
              position: 'absolute',
              left: `${slot.left}%`,
              top: `${slot.top}%`,
              transform: `translate(-50%, -50%) rotate(${slot.rot}deg)`,
              display: 'flex',
            }}
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        );
      })}
    </div>
  );
}

// ─── MiniDesk — the card's live-capped mini preview ─────────────────────────
// Renders a desk's first ~6 doodles small + scattered on the card's warm-paper
// surface (the card div owns the paper material; this only places the marks).
// Deck approach (decided 06-11, LIVE-CAPPED): fetch the first 6 via
// listDoodlesForDesk(id, 6) — cheap at demo scale, no schema change. The full
// SvgStyleTransform engine is deliberately NOT pulled in: each doodle's stored
// markup is normalized small + sanitized + injected as plain inline SVG.
//
// SCATTER IS DETERMINISTIC FROM INDEX (no unseeded randomness, no wall-clock):
// a fixed offset + rotation + scale table indexed by the doodle's slot. A
// given slot always lands the same way, so a card never reflows between
// renders and two machines show the identical little desk.

/** ~88px square mini-doodle target — small enough that ~6 sit on a card. */
const MINI_DOODLE_PX = 88;

/** Fixed per-slot scatter table — { left%, top%, rotation°, scale }. Six slots
 *  spread across the surface (the cap is ~6 doodles per card). Hand-placed so
 *  they read as a loosely-arranged little desk, not a grid; pure constants so
 *  the layout is fully deterministic from a doodle's index. */
const SCATTER: ReadonlyArray<{ left: number; top: number; rot: number; scale: number }> = [
  { left: 30, top: 36, rot: -6, scale: 1.0 },
  { left: 68, top: 30, rot: 7, scale: 0.82 },
  { left: 50, top: 64, rot: -3, scale: 0.9 },
  { left: 22, top: 68, rot: 9, scale: 0.7 },
  { left: 78, top: 66, rot: -10, scale: 0.66 },
  { left: 58, top: 20, rot: 4, scale: 0.6 },
];

/** How many doodles a mini-desk shows (matches the SCATTER table length). */
const MINI_CAP = SCATTER.length;

type MiniState =
  | { phase: 'loading' }
  | { phase: 'ready'; doodles: DoodleRow[] }
  | { phase: 'error' };

function MiniDesk({ desk }: { desk: DeskRow }) {
  const [state, setState] = useState<MiniState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // listDoodlesForDesk already takes a limit — cap the fetch at MINI_CAP so
    // each card only pays for its own handful of rows.
    listDoodlesForDesk(desk.id, MINI_CAP)
      .then((doodles) => {
        if (!cancelled) setState({ phase: 'ready', doodles });
      })
      .catch(() => {
        // A pre-v2 DB / network / RLS hiccup must never crash a card — fall
        // back to the empty-desk mark, same friendly-failure rule as the grid.
        if (!cancelled) setState({ phase: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [desk.id]);

  const doodles = state.phase === 'ready' ? state.doodles : [];

  // Empty (no doodles yet) or a caught error → the quiet empty-desk mark on the
  // paper surface, so even an empty card still reads as a real little desk.
  if (state.phase !== 'loading' && doodles.length === 0) {
    return <EmptyDeskMark />;
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }} aria-hidden>
      {doodles.slice(0, MINI_CAP).map((d, i) => {
        const slot = SCATTER[i];
        // Normalize the stored markup small (so several fit), then sanitize on
        // read before injection — same XSS rule the real desk + feed rows use.
        const markup = sanitizeSvgMarkup(
          normalizeSvgSize(d.svg, Math.round(MINI_DOODLE_PX * slot.scale)),
        );
        return (
          <div
            key={d.id}
            style={{
              position: 'absolute',
              left: `${slot.left}%`,
              top: `${slot.top}%`,
              // Center the mark on its slot point, then tilt — deterministic
              // from the slot, so the scatter never moves between renders.
              transform: `translate(-50%, -50%) rotate(${slot.rot}deg)`,
              display: 'flex',
            }}
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        );
      })}
    </div>
  );
}

/** Quiet empty-desk mark — a faint desk-horizon line + stray dot, centered on
 *  the paper surface. Reads as an empty desk waiting for its first doodle.
 *  Deterministic, no external asset. */
function EmptyDeskMark() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="64" height="48" viewBox="0 0 64 48" fill="none" style={{ opacity: 0.5 }}>
        <line x1="8" y1="34" x2="56" y2="34" stroke="var(--dir-text-body-soft)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="32" cy="22" r="6" stroke="var(--dir-text-body-soft)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
