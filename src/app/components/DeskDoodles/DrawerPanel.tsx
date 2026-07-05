import { useEffect, useMemo, useRef, useState } from 'react';
import { IS } from '../../lib/typography';
import { PILL, SECTION_LABEL } from '../../lib/chromeStyles';

// Hover-reveal for the per-card Place pill (Sebs: 8 identical pills = noise).
// Drag is the primary path; the pill appears on hover/focus-within for the
// keyboard + fallback path. Injected once, id-guarded.
const DRAWER_CSS_ID = 'dd-drawer-style';
function ensureDrawerCss() {
  if (document.getElementById(DRAWER_CSS_ID)) return;
  const el = document.createElement('style');
  el.id = DRAWER_CSS_ID;
  el.textContent = `
.dd-drawer-card .dd-place-pill { opacity: 0; transition: opacity 0.15s; }
.dd-drawer-card:hover .dd-place-pill,
.dd-drawer-card:focus-within .dd-place-pill { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .dd-drawer-card .dd-place-pill { transition: none; } }
`;
  document.head.appendChild(el);
}
import { normalizeSvgSize } from '../../lib/normalizeInput';
import { listDesks, listMyDoodles, type DoodleRow } from '../../lib/publish';
import { sanitizeSvgMarkup } from '../../lib/svgUpload';
import { ObjectCard } from './ObjectCard';

// ─── DrawerPanel v2 — "My doodles", the collectible binder (round 6) ─────────
// Sebs-ratified drawer decisions (2026-06-11 board #26-32 + 2026-06-12 round 6):
//   #26 the drawer is a PASSIVE INDEX, not a stash — records live on desks;
//       the drawer is the VIEW that groups records by owner.
//   #27 CROSS-DESK: lists this session's doodles across ALL desks
//       (publish.ts listMyDoodles).
//   #28 placing = COPY: a NEW row publishes onto the current open desk
//       through DeskPage's addObject path; the original row is untouched and
//       the copy carries the source's render_config verbatim.
//   #29 ONE-RECORD delete semantics: deleting a doodle from a desk removes
//       it here too — same record, two views. The footer says so honestly.
//   #30 LEFT CollapsiblePanel (shell + PanelToggle live in DeskPage chrome).
//   R6.1 2-COL GRID of MINI COLLECTIBLE CARDS (ObjectCard mini — TCG frame:
//        name banner, the one marks stat, art well). Kills the v1
//        one-row-too-much-scrolling problem. Premium card treatment
//        (shine/colophon) rides the 06-16 identity pass.
//   R6.2 DRAG-TO-PLACE: every card is an HTML5 drag source (contract below);
//        the desk is the drop side. The Place-here pill STAYS — it is the
//        keyboard/fallback path for the same copy semantics.
//   R6.4 CLICK-TO-OPEN: a card click opens the SAME Edit ObjectSurface the
//        desk uses (one surface everywhere; drawer cards are always yours) —
//        via the onOpenDoodle prop, wired by DeskPage's activeSurface flow.
//
// Mini art is PLAIN-injected (sanitized + normalized record markup), NOT the
// live SvgStyleTransform pipeline: deterministic, cheap at N cards, and the
// binder never re-renders on pen tweaks (records rule, D-7). The pipeline
// renders the copy once it lands on the desk with the carried render_config.

// ─── Drag contract (R6.2 — drawer card → desk drop) ──────────────────────────
// The drawer side WRITES, the desk side (DeskPage, rock A) READS:
//   dataTransfer type:  DD_DOODLE_DRAG_TYPE = 'application/x-dd-doodle'
//   dataTransfer data:  JSON.stringify(DoodleDragPayload)
//   effectAllowed:      'copy' (drop = copy published at the drop point, #28)
//   drag image:         the card's art well ([data-dd-card-art])
// The payload svg is the RAW record markup — the drop side sanitizes on read
// (sanitizeSvgMarkup) exactly like placeFromDrawer does.
export const DD_DOODLE_DRAG_TYPE = 'application/x-dd-doodle';

/** JSON shape carried on a drawer-card drag (parse on drop). */
export interface DoodleDragPayload {
  svg: string;
  name: string | null;
  why: string | null;
  renderConfig: Record<string, unknown> | null;
}

type DrawerState =
  | { phase: 'loading' }
  | { phase: 'ready'; rows: DoodleRow[]; deskNames: Map<string, string> }
  | { phase: 'error' };

export function DrawerPanel({
  open,
  refreshKey,
  viewedDeskId,
  onPlace,
  onOpenDoodle,
}: {
  /** Panel visibility — a closed drawer doesn't fetch. */
  open: boolean;
  /** Bumped by DeskPage when a publish or delete settles → refetch, so the
   *  index tracks the records (one-record semantics, #29). */
  refreshKey: number;
  /** The desk currently in view — its rows get a quiet "here" mark. */
  viewedDeskId: string | null;
  /** Place-here: DeskPage publishes a COPY via its addObject path (#28). */
  onPlace: (row: DoodleRow) => void;
  /** CLICK-TO-OPEN (R6.4): card click opens the SAME Edit ObjectSurface the
   *  desk objects use — DeskPage wires this into its activeSurface flow
   *  (drawer cards are always the session's own, so Edit is the right mode;
   *  rows not on the viewed desk need DeskPage to resolve/show the record).
   *  Optional: while unwired, cards are draggable but not clickable. */
  onOpenDoodle?: (row: DoodleRow) => void;
}) {
  useEffect(() => { ensureDrawerCss(); }, []);
  const [state, setState] = useState<DrawerState>({ phase: 'loading' });
  // Manual retry for the error state — a passive index doesn't poll.
  const [retryNonce, setRetryNonce] = useState(0);
  // Transient per-row "Placed ✓" feedback after a place-here click.
  const [placedId, setPlacedId] = useState<string | null>(null);
  const placedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return; // don't pay the reads while closed
    let cancelled = false;
    // Keep the current rows on screen during a refetch (no flicker on the
    // publish/delete bumps); only the first load / error-retry shows loading.
    setState((s) => (s.phase === 'ready' ? s : { phase: 'loading' }));
    Promise.all([listMyDoodles(), listDesks()])
      .then(([rows, desks]) => {
        if (cancelled) return;
        setState({
          phase: 'ready',
          rows,
          deskNames: new Map(desks.map((d) => [d.id, d.name])),
        });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [open, refreshKey, retryNonce]);

  // Clear the transient placed-feedback timer on unmount.
  useEffect(
    () => () => {
      if (placedTimerRef.current) clearTimeout(placedTimerRef.current);
    },
    [],
  );

  const handlePlace = (row: DoodleRow) => {
    onPlace(row);
    setPlacedId(row.id);
    if (placedTimerRef.current) clearTimeout(placedTimerRef.current);
    placedTimerRef.current = setTimeout(() => setPlacedId(null), 1800);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        fontFamily: IS,
      }}
    >
      {/* Sticky header band — mirrors the right panel's PenPreview header. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          background: 'var(--dir-raised)',
          padding: '14px 16px 12px',
          borderBottom: '1px solid var(--dir-border)',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span style={SECTION_LABEL}>My doodles</span>
        {state.phase === 'ready' && state.rows.length > 0 && (
          <span
            style={{
              fontFamily: IS,
              fontSize: 10,
              fontStyle: 'italic',
              color: 'var(--dir-text-body-soft)',
            }}
          >
            {state.rows.length} across every desk
          </span>
        )}
      </div>

      <div
        style={{
          flex: 1,
          padding: '12px 12px 8px',
        }}
      >
        {state.phase === 'loading' && <DrawerNote>Opening your drawer…</DrawerNote>}

        {state.phase === 'error' && (
          <DrawerNote>
            Couldn’t reach your drawer.
            <button
              onClick={() => setRetryNonce((n) => n + 1)}
              style={{ ...PILL, marginTop: 10, padding: '4px 12px', fontSize: 10 }}
            >
              Retry
            </button>
          </DrawerNote>
        )}

        {state.phase === 'ready' && state.rows.length === 0 && (
          <DrawerNote>
            Your drawer is empty — every doodle you make lands here, whichever
            desk it’s on.
          </DrawerNote>
        )}

        {/* The binder — 2-col grid of mini collectible cards (R6.1). */}
        {state.phase === 'ready' && state.rows.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 10,
              alignItems: 'start',
            }}
          >
            {state.rows.map((row) => (
              <DrawerCard
                key={row.id}
                row={row}
                deskLabel={
                  row.desk_id
                    ? (state.deskNames.get(row.desk_id) ?? 'A desk')
                    : 'Shared desk'
                }
                here={row.desk_id === viewedDeskId}
                placed={placedId === row.id}
                onPlace={() => handlePlace(row)}
                onOpen={onOpenDoodle ? () => onOpenDoodle(row) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Honest one-record footer (#29) — only when there's something to lose. */}
      {state.phase === 'ready' && state.rows.length > 0 && (
        <div
          style={{
            padding: '10px 16px 14px',
            borderTop: '1px solid var(--dir-border)',
            fontFamily: IS,
            fontSize: 10,
            fontStyle: 'italic',
            lineHeight: 1.6,
            color: 'var(--dir-text-body-soft)',
          }}
        >
          Drag a card onto the desk to place a copy. Removing a doodle removes
          it from your drawer too.
        </div>
      )}
    </div>
  );
}

/** Quiet centered copy for the loading / error / empty states. */
function DrawerNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '28px 12px',
        fontFamily: IS,
        fontSize: 11,
        lineHeight: 1.7,
        color: 'var(--dir-text-body-soft)',
      }}
    >
      {children}
    </div>
  );
}

/** Fallback px size for plain art when the stretch step can't run — the
 *  normalize call's real job here is deriving a viewBox for markup without
 *  one, so the 100%-stretched svg scales inside the card's art well. */
const PLAIN_ART_FALLBACK_PX = 96;

/** Prep the record markup for the mini card's plain art well: derive a
 *  viewBox / canonical size (normalizeSvgSize), stretch the root svg to
 *  100%×100% so the well box owns the final size, and sanitize LAST before
 *  injection — the same read-side XSS rule the desk feed applies. */
function plainArtMarkup(svg: string): string {
  const normalized = normalizeSvgSize(svg, PLAIN_ART_FALLBACK_PX);
  let stretched = normalized;
  try {
    const doc = new DOMParser().parseFromString(normalized, 'image/svg+xml');
    const root = doc.documentElement;
    if (!doc.querySelector('parsererror') && root.tagName.toLowerCase() === 'svg') {
      root.setAttribute('width', '100%');
      root.setAttribute('height', '100%');
      stretched = new XMLSerializer().serializeToString(root);
    }
  } catch {
    // keep the normalized px-sized markup — still renders, just fixed-size
  }
  return sanitizeSvgMarkup(stretched);
}

function DrawerCard({
  row,
  deskLabel,
  here,
  placed,
  onPlace,
  onOpen,
}: {
  row: DoodleRow;
  deskLabel: string;
  here: boolean;
  placed: boolean;
  onPlace: () => void;
  onOpen?: () => void;
}) {
  const markup = useMemo(() => plainArtMarkup(row.svg), [row.svg]);
  const displayName = row.name || 'Untitled doodle';
  const deskLine = here ? `${deskLabel} · here` : deskLabel;
  // DRAG-FOLLOWER (Sebs 2026-06-23): only the DOODLE floats (setDragImage of the
  // art well, below) — and the SOURCE CARD dims while it's in flight, so it reads
  // as "the doodle popped OFF the card", not the whole card flying. Restored on
  // dragend. (Native HTML5 DnD keeps the desk's drop pipeline intact.)
  const [isDragging, setIsDragging] = useState(false);

  // R6.2 drag source — see the drag contract block at the top of this file.
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const payload: DoodleDragPayload = {
      svg: row.svg,
      name: row.name ?? null,
      why: row.why ?? null,
      renderConfig: row.render_config ?? null,
    };
    e.dataTransfer.setData(DD_DOODLE_DRAG_TYPE, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
    // Drag image = the card's ART well, centered under the cursor — the
    // doodle is what lands on the desk. Fallback: browser default snapshot.
    const art = e.currentTarget.querySelector('[data-dd-card-art]');
    if (art instanceof HTMLElement && typeof e.dataTransfer.setDragImage === 'function') {
      e.dataTransfer.setDragImage(art, art.offsetWidth / 2, art.offsetHeight / 2);
    }
    // Dim the card AFTER the drag-image snapshot is taken (next frame) so the
    // floating doodle stays bright while only the LEFT-BEHIND card greys out.
    requestAnimationFrame(() => setIsDragging(true));
  };

  return (
    <div
      className="dd-drawer-card"
      data-dd-drawer-card={row.id}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={() => setIsDragging(false)}
      // R6.4 click-to-open (Enter/Space included when wired). The inner
      // Place pill stops propagation so it never double-fires an open.
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `Open “${displayName}” to edit` : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.target !== e.currentTarget) return; // pill handles itself
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      title={`${displayName} — ${deskLine}. Drag onto the desk to place a copy.`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        cursor: onOpen ? 'pointer' : 'grab',
        // The doodle popped off → the card it left behind dims (restored on drop).
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 0.16s ease',
      }}
    >
      {/* The collectible — ObjectCard's mini TCG frame (name banner + the one
          marks stat + art well), plain-injected art (header comment). */}
      <ObjectCard svgMarkup={markup} name={row.name} mini plainArt />

      {/* Which desk this record lives on (+ a quiet mark when in view). */}
      <div
        style={{
          fontFamily: IS,
          fontSize: 9,
          fontStyle: 'italic',
          color: 'var(--dir-text-body-soft)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          padding: '0 2px',
        }}
      >
        {deskLine}
      </div>

      {/* Place here = COPY (#28) — the keyboard/fallback path beside drag;
          original stays put, a new row lands via DeskPage's addObject. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPlace();
        }}
        disabled={placed}
        title="Place a copy of this doodle on the current desk — the original stays put"
        className="dd-place-pill"
        style={{
          ...PILL,
          alignSelf: 'flex-start',
          padding: '3px 10px',
          fontSize: 9,
          ...(placed
            ? {
                background: 'var(--dir-raised)',
                borderColor: 'var(--dir-accent)',
                color: 'var(--dir-text-primary)',
                cursor: 'default',
              }
            : {}),
        }}
      >
        {placed ? 'Placed ✓' : 'Place here'}
      </button>
    </div>
  );
}
