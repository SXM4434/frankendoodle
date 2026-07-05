// DrawerExpandPopup — the "Expand ⤢" overlay opened from a desk's drawer panel.
//
// MODEL (Sebs locked 2026-06-14): this is an OVERLAY over the desk, not a
// navigation. Opening it dims the desk; closing it (scrim click / Escape / ×)
// reveals the same desk underneath — no route change, the desk is never lost.
// It's the full-size view of the little drawer panel: your private DRAWER and
// your public SHELF, in one place.
//
//   context='public'  → show ONLY the SHELF (this person's public doodles).
//                        A read-only display of what's out for everyone.
//   context='private' → DRAWER + SHELF as a switchable pill-tab pair. On the
//                        Drawer tab each item can be SHARED to the shelf; and
//                        when a desk is open (currentDeskId != null) each drawer
//                        item can be PLACED onto that desk.
//
// METAPHOR (the line shown under the tabs): "Drawer = private, just you.
// Shelf = public — others see it from your handle." In the drawer = hidden; on
// the shelf = on display.
//
// CHROME LINEAGE — the OnboardingFlow / ProfileShelfPopover overlay pattern:
//   • position:fixed inset:0 scrim, tinted ink (primary 28% → transparent)
//   • click-outside = close · Escape = close (window keydown listener)
//   • framer-motion entrance on the dialog card
//   • paper-grain wash behind the content (warmth, not realism — deskCraft)
//   • a "×" close affordance
// zIndex sits at 330 — matching the shelf popover, one above onboarding's 320 —
// so an expand opened from a desk's drawer panel lands on top.
//
// DB-OFF SAFE: every data call .catch()-es to its graceful empty / false result
// (listMyDrawer / listMyShelf return [] on a pre-migration DB; shareToShelf /
// placeFromDrawer return false until the DB is ready). So the overlay renders
// honest empty states and the share / place actions are quiet no-ops rather
// than crashes when the personal-space migrations aren't applied yet.

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IS, ISe } from '../../lib/typography';
import { PILL, CTA, SECTION_LABEL, CHIP, RAISED_SHADOW } from '../../lib/chromeStyles';
import { PAPER_GRAIN } from '../../lib/deskCraft';
import {
  listMyDrawer,
  listMyShelf,
  shareToShelf,
  placeFromDrawer,
} from '../../lib/personalSpace';
import type { DoodleRow } from '../../lib/publish';
import { sanitizeSvgMarkup } from '../../lib/svgUpload';
import { ObjectCard } from './ObjectCard';
import { ObjectSurface } from './ObjectSurface';

export interface DrawerExpandPopupProps {
  /** 'public' shows ONLY the shelf (someone's public face); 'private' shows the
   *  Drawer | Shelf tab pair with per-item share / place actions. */
  context: 'public' | 'private';
  /** The desk currently open underneath, or null. When set, drawer items get a
   *  "Place here" action that drops them onto this desk. null hides it (e.g. the
   *  expand was opened from a context with no desk to place onto). */
  currentDeskId: string | null;
  /** Close the overlay — scrim click, Escape, the × button. Reveals the desk. */
  onClose: () => void;
  /** Optional — called with the placed row after a drawer item lands on the desk
   *  (so the caller can spawn it on the live desk). The placed item is removed
   *  from the drawer list here on success. */
  onPlaced?: (d: DoodleRow) => void;
}

type Tab = 'drawer' | 'shelf';

export function DrawerExpandPopup({
  context,
  currentDeskId,
  onClose,
  onPlaced,
}: DrawerExpandPopupProps) {
  // Public context is shelf-only; private opens on the drawer (your own stuff
  // first). The tab pill-pair only renders for private.
  const [tab, setTab] = useState<Tab>(context === 'public' ? 'shelf' : 'drawer');

  const [drawer, setDrawer] = useState<DoodleRow[]>([]);
  const [shelf, setShelf] = useState<DoodleRow[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(context === 'private');
  const [shelfLoading, setShelfLoading] = useState(true);

  // Per-item in-flight guards so a doubled tap on Share / Place can't fire the
  // RPC twice or leave a half-removed list. Keyed by doodle id.
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // The doodle whose full view is open as a read-only ObjectSurface overlay.
  // null = grid; clicking a card sets it, closing returns to the grid.
  const [viewRow, setViewRow] = useState<DoodleRow | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  // Escape closes — same convention as the onboarding / shelf overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load the shelf always (both contexts show it); load the drawer only in
  // private context (public never sees a private drawer). A cancelled flag stops
  // a late response writing into an unmounted instance. Both .catch → [] so a
  // pre-migration / offline DB renders an honest empty state.
  useEffect(() => {
    let cancelled = false;

    setShelfLoading(true);
    void listMyShelf()
      .catch(() => [] as DoodleRow[])
      .then((rows) => {
        if (cancelled) return;
        setShelf(rows);
        setShelfLoading(false);
      });

    if (context === 'private') {
      setDrawerLoading(true);
      void listMyDrawer()
        .catch(() => [] as DoodleRow[])
        .then((rows) => {
          if (cancelled) return;
          setDrawer(rows);
          setDrawerLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [context]);

  // Share a drawer item onto the shelf. On success the item stays in the drawer
  // (it's now ALSO public — sharing flips a flag, it doesn't move the row) but we
  // refresh the shelf so it shows up there immediately. DB-off → false → no-op.
  const onShare = useCallback(
    async (row: DoodleRow) => {
      if (busy[row.id]) return;
      setBusy((b) => ({ ...b, [row.id]: true }));
      try {
        const ok = await shareToShelf(row.id).catch(() => false);
        if (ok) {
          // Optimistically reflect it on the shelf (avoid a flash of the old
          // list); also mark the drawer row as public so its chip updates.
          setDrawer((d) =>
            d.map((r) => (r.id === row.id ? { ...r, is_public: true } : r)),
          );
          setShelf((s) =>
            s.some((r) => r.id === row.id) ? s : [{ ...row, is_public: true }, ...s],
          );
        }
      } finally {
        setBusy((b) => {
          const next = { ...b };
          delete next[row.id];
          return next;
        });
      }
    },
    [busy],
  );

  // Place a drawer item onto the currently-open desk. On success it leaves the
  // drawer (the row moves to that desk) and the caller is told via onPlaced so it
  // can spawn it live. DB-off → false → no-op (item stays put).
  const onPlace = useCallback(
    async (row: DoodleRow) => {
      if (!currentDeskId || busy[row.id]) return;
      setBusy((b) => ({ ...b, [row.id]: true }));
      try {
        const ok = await placeFromDrawer(row.id, currentDeskId).catch(() => false);
        if (ok) {
          setDrawer((d) => d.filter((r) => r.id !== row.id));
          onPlaced?.({ ...row, desk_id: currentDeskId });
        }
      } finally {
        setBusy((b) => {
          const next = { ...b };
          delete next[row.id];
          return next;
        });
      }
    },
    [currentDeskId, busy, onPlaced],
  );

  // Header copy reads to the context: public is someone's display face; private
  // is your own space (both halves of it).
  const eyebrow = context === 'public' ? 'Their shelf' : 'Your space';
  const title = context === 'public' ? 'On the shelf' : 'Drawer & shelf';

  const showTabs = context === 'private';
  const activeLoading = tab === 'drawer' ? drawerLoading : shelfLoading;
  const activeItems = tab === 'drawer' ? drawer : shelf;

  return (
    <>
    <div
      // Scrim — tinted ink, same as the onboarding / shelf overlays. Click
      // outside closes; zIndex 330 lands above an open desk + onboarding (320).
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 330,
        background: 'color-mix(in srgb, var(--dir-text-primary) 28%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={context === 'public' ? 'Their shelf' : 'Your drawer and shelf'}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: 'relative',
          background: 'var(--dir-raised)',
          border: '1px solid var(--dir-border)',
          borderRadius: 16,
          boxShadow: RAISED_SHADOW,
          width: 'min(720px, calc(100vw - 64px))',
          maxHeight: '82vh',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: IS,
          overflow: 'hidden',
        }}
      >
        {/* Paper-grain wash — warmth, not realism (deskCraft). Behind content,
            over the whole card so the scrolling grid reads on one paper. */}
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

        {/* × close — quiet, top-right, above the wash. */}
        <button
          onClick={close}
          aria-label="Close"
          title="Close"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            zIndex: 1,
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: IS,
            fontSize: 20,
            lineHeight: 1,
            color: 'var(--dir-text-body-soft)',
            borderRadius: 999,
          }}
        >
          ×
        </button>

        {/* Header — eyebrow + title, tab pair (private only), metaphor note.
            Padded; the grid below owns its own scroll so the header stays put. */}
        <div
          style={{
            position: 'relative',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '28px 28px 16px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...SECTION_LABEL }}>{eyebrow}</span>
            <h2
              style={{
                fontFamily: ISe,
                fontVariationSettings: '"SOFT" 60, "WONK" 1',
                fontSize: 28,
                lineHeight: 1.1,
                letterSpacing: '-0.01em',
                color: 'var(--dir-text-primary)',
                margin: 0,
              }}
            >
              {title}
            </h2>
          </div>

          {showTabs && (
            // Drawer | Shelf — a pill-tab pair (PILL idiom). The active tab fills
            // (CTA), the other stays outline. Counts ride along as a quiet badge.
            <div role="tablist" aria-label="Drawer or shelf" style={{ display: 'flex', gap: 8 }}>
              <TabPill
                label="Drawer"
                count={drawerLoading ? null : drawer.length}
                active={tab === 'drawer'}
                onClick={() => setTab('drawer')}
              />
              <TabPill
                label="Shelf"
                count={shelfLoading ? null : shelf.length}
                active={tab === 'shelf'}
                onClick={() => setTab('shelf')}
              />
            </div>
          )}

          {/* Metaphor note — the line that explains the two halves. Public shows
              only the shelf, so it gets the shelf-only gloss. */}
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--dir-text-body-soft)',
              margin: 0,
            }}
          >
            {context === 'public'
              ? "The shelf is public — the doodles they've put out for everyone to see."
              : 'Drawer = private, just you. Shelf = public — others see it from your handle.'}
          </p>
        </div>

        {/* Body — the scroll region. One tab's content at a time (private), or the
            shelf alone (public). Loading → empty → grid, cross-faded. */}
        <div
          style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '4px 28px 28px',
          }}
        >
          <AnimatePresence mode="wait">
            {activeLoading ? (
              <FadeMsg key={`loading-${tab}`}>
                {tab === 'drawer' ? 'Opening the drawer…' : 'Loading the shelf…'}
              </FadeMsg>
            ) : activeItems.length === 0 ? (
              <FadeMsg key={`empty-${tab}`}>
                {tab === 'drawer'
                  ? 'Your drawer is empty — doodles you stash privately land here.'
                  : context === 'public'
                  ? 'Nothing on the shelf yet.'
                  : "Your shelf is empty — share a doodle from the drawer and it shows up here."}
              </FadeMsg>
            ) : (
              <motion.div
                key={`grid-${tab}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={GRID}
              >
                {activeItems.map((row) => (
                  <DrawerItem
                    key={row.id}
                    row={row}
                    // Actions only on the private DRAWER tab. The shelf tab + the
                    // public context are read-only displays.
                    showShare={context === 'private' && tab === 'drawer'}
                    showPlace={context === 'private' && tab === 'drawer' && currentDeskId != null}
                    shared={row.is_public === true}
                    busy={busy[row.id] === true}
                    onShare={() => onShare(row)}
                    onPlace={() => onPlace(row)}
                    onView={() => setViewRow(row)}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>

    {/* Full read-only view of the tapped doodle — ObjectSurface in sandbox
        mode renders its own scrim/modal above this overlay; close returns to
        the grid. */}
    {viewRow && (
      <ObjectSurface
        mode="sandbox"
        object={{
          svgMarkup: viewRow.svg,
          name: viewRow.name ?? null,
          why: viewRow.why ?? null,
          owner: 'you',
          createdAt: viewRow.created_at ?? null,
          id: viewRow.id ?? null,
          renderConfig: viewRow.render_config ?? null,
        }}
        onClose={() => setViewRow(null)}
      />
    )}
    </>
  );
}

// ─── Grid + tab pill + helpers ───────────────────────────────────────────────

const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: 14,
};

/** A loading / empty message — the quiet SECTION_LABEL idiom, lowercase, faded
 *  in/out so tab switches don't jump. */
function FadeMsg({ children }: { children: ReactNode }) {
  return (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      style={{
        ...SECTION_LABEL,
        textTransform: 'none',
        letterSpacing: '0.01em',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--dir-text-body-soft)',
        margin: 0,
      }}
    >
      {children}
    </motion.p>
  );
}

/** One tab in the Drawer | Shelf pair — a PILL that fills (CTA) when active. The
 *  count rides as a quiet badge once its list has loaded. */
function TabPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        ...(active ? CTA : PILL),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
      }}
    >
      {label}
      {count != null && (
        <span
          aria-hidden
          style={{
            fontSize: 10,
            fontWeight: 600,
            opacity: 0.7,
            // Inherit the pill's ink (CTA text on active, body on outline).
            color: 'inherit',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** A grid cell — the mini ObjectCard plus, on the private drawer tab, the
 *  Share-to-shelf + Place-here actions. The card is the same collectible
 *  read-view used everywhere; actions sit below it so the art stays the hero. */
function DrawerItem({
  row,
  showShare,
  showPlace,
  shared,
  busy,
  onShare,
  onPlace,
  onView,
}: {
  row: DoodleRow;
  showShare: boolean;
  showPlace: boolean;
  shared: boolean;
  busy: boolean;
  onShare: () => void;
  onPlace: () => void;
  onView: () => void;
}) {
  // Sanitize once per row (cheap, deterministic) — the card injects markup, so
  // it must be clean before it ever reaches the DOM.
  const markup = useMemo(() => sanitizeSvgMarkup(row.svg), [row.svg]);
  const showActions = showShare || showPlace;

  // The action pills sit at PILL's idiom but at a snug grid-cell size so two
  // fit a 160px column comfortably.
  const actionPill: CSSProperties = {
    ...PILL,
    fontSize: 10,
    padding: '5px 10px',
    flex: 1,
    textAlign: 'center',
    justifyContent: 'center',
    display: 'inline-flex',
    alignItems: 'center',
    opacity: busy ? 0.55 : 1,
    pointerEvents: busy ? 'none' : undefined,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* The whole card is a click target → opens the full read-only view.
          role=button wrapper so the mini art opens its doodle; the action
          pills below stopPropagation so they don't also open it. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onView}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onView();
          }
        }}
        title="Open this doodle"
        style={{ cursor: 'pointer' }}
      >
        <ObjectCard svgMarkup={markup} name={row.name} owner={row.owner_id} mini />
      </div>

      {showActions && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {showShare &&
            (shared ? (
              // Already public — a quiet status chip, not a re-share button.
              <span
                style={{
                  ...CHIP,
                  fontSize: 9,
                  padding: '4px 10px',
                  color: 'var(--dir-text-secondary)',
                }}
                title="This doodle is on your shelf"
              >
                On shelf
              </span>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onShare();
                }}
                disabled={busy}
                title="Make this public on your shelf"
                style={actionPill}
              >
                Share to shelf
              </button>
            ))}
          {showPlace && (
            // The primary action — drop onto the open desk. CTA fill (the one
            // filled pill in the cell) so it reads as the main move.
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlace();
              }}
              disabled={busy}
              title="Drop this onto the desk you have open"
              style={{
                ...actionPill,
                background: 'var(--dir-cta-bg)',
                color: 'var(--dir-cta-text)',
                borderColor: 'var(--dir-cta-border)',
              }}
            >
              Place here
            </button>
          )}
        </div>
      )}
    </div>
  );
}
