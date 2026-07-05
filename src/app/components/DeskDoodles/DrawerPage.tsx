// DrawerPage — the full-page Drawer + Shelf area (/drawer, R9 personal-space IA),
// reworked AUDIT-PAGE-STYLE (Sebs 2026-06-14): the user's own drawer/shelf
// doodles render in a grid through a LIVE Style + Modifier controls panel + a
// 2D/3D toggle, exactly the way DeskDoodlesAudit drives the 197-shape catalog —
// so you can view, restyle, and flip 2D/3D your OWN doodles.
//
// Two compartments of YOUR OWN doodles, named to match the desk metaphor:
//   • DRAWER — private, closed, just you. listMyDrawer() — items you've stashed
//              but not shared. Each can be "shared to shelf" (moves it public).
//   • SHELF  — public, on display. listMyShelf() — what others browse from your
//              handle. No share action (already public).
//
// ── LIVE-RESTYLE WIRING (the audit pattern, applied to YOUR doodles) ─────────
// DeskDoodlesAudit wraps each catalog shape in <SvgStyleTransform> and mounts
// <SmartHachureChrome> in a right CollapsiblePanel; twisting a control restyles
// the whole grid because every cell reads the same style/modifier state. The
// catalog renders COMPONENT shapes; a drawer doodle is raw SVG MARKUP — so the
// live path here is the SAME one ObjectSurface uses for markup: each card's art
// goes through <F3SvgStyleProvider>+<F3RoughModifiersProvider>+a render-scope
// (which syncs the shared style/mods into those nested providers), and ObjectCard
// renders the markup via SvgStyleTransform inside that scope. One shared
// surfStyle/surfMods state (held here, exactly like ObjectSurface's local state)
// drives EVERY card at once. The right panel is the exported SurfaceControls (the
// full per-style control set the surface uses), plus a 2D/3D segmented toggle.
//
// ── 2D / 3D ─────────────────────────────────────────────────────────────────
// 3D rebuilds from a doodle's recorded strokes (render_config.strokes), so only
// drawn doodles can flip — flipEligibility() gates it, and ineligible cards show
// the same honest "upload→3D is the hard path" note ObjectConvertAction uses
// (no dead affordance). Eligible cards render through DeskObject3DMount — the
// SAME Stroke3DScene the /canvas flip uses, sourced from the record — under each
// card's own persisted geometry3d config.
//
// House style is borrowed wholesale from DeskGallery (full-height column: auto
// header + scrolling body) + DeskDoodlesHome (wordmark NavLink + handle chip).
// Tokens only — no invented colors.
//
// DEGRADE GRACEFULLY: every data call is .catch()'d to []/false, so a
// pre-migration / off DB renders honest empty states instead of crashing. Each
// tab loads on its own (effect keyed on `tab`) so switching shows a loading
// note rather than stale rows.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { NavLink, useSearchParams } from 'react-router';
import { IS, ISe } from '../../lib/typography';
import { PILL, CTA, SECTION_LABEL, CHIP } from '../../lib/chromeStyles';
import { PAPER_GRAIN } from '../../lib/deskCraft';
import type { DoodleRow } from '../../lib/publish';
import { updateDoodleMeta, deleteDoodle } from '../../lib/publish';
import {
  listMyDrawer,
  listMyShelf,
  shareToShelf,
  getEffectiveHandle,
  getIdentityId,
} from '../../lib/personalSpace';
import { displayHandle, handleFromId } from '../../lib/handle';
import { sanitizeSvgMarkup } from '../../lib/svgUpload';
import { ObjectCard } from './ObjectCard';
import { ObjectSurface, SurfaceControls } from './ObjectSurface';
import { Canvas3DBoundary, DeskObject3DMount, LiveObject3DSlot, Shared3DOverlay } from './DeskObject3DMount';
import { Canvas3DProvider } from '../../state/Canvas3DContext';
import { Canvas3DChrome } from '../chrome/Canvas3DChrome';
import { svgMarkupToStrokes } from '../../lib/svgToStrokes';
import { applyStylePreset } from '../canvas/SvgStyleTransform';
import {
  F3SvgStyleProvider,
  useF3SvgStyle,
  type F3SvgStyle,
} from '../../state/F3SvgStyleContext';
import {
  F3RoughModifiersProvider,
  useF3RoughModifiers,
  DEFAULT_MODIFIERS,
  type F3ModifiersState,
} from '../../state/F3RoughModifiersContext';
import {
  flipEligibility,
  type Geometry3DConfig,
} from '../../lib/geometry3d/deskRenderMode';
import type { StrokeInputPoint } from '../../lib/geometry3d/strokeTo3d';
import {
  CollapsiblePanel,
  PanelToggle,
  useMinimizeUi,
  usePanelOpen,
} from '../chrome/CollapsiblePanel';

type Tab = 'drawer' | 'shelf';
type RenderMode = '2d' | '3d';

// Per-tab loading is its own phase so a tab switch shows the loading note (not
// the previous tab's rows). A caught error folds into an empty list — the DB
// being off is the same honest "nothing here yet" truth for a personal space.
type Phase = 'loading' | 'ready';

// ── Live-restyle render scope ────────────────────────────────────────────────
// A local copy of ObjectSurface's (module-private) SurfaceRenderScope: it runs
// INSIDE the nested F3 providers and syncs the page's shared style/mods into the
// card's shadowed context, so the card re-renders through the IDENTICAL desk
// render path with the panel's values. useLayoutEffect so the sync lands before
// paint (no flash of provider-default style). Replicated here (not imported) to
// avoid touching the hot ObjectSurface file.
function CardRenderScope({
  svgStyle,
  mods,
  children,
}: {
  svgStyle: F3SvgStyle;
  mods: F3ModifiersState;
  children: ReactNode;
}) {
  const styleCtx = useF3SvgStyle();
  const modsCtx = useF3RoughModifiers();
  useLayoutEffect(() => {
    if (styleCtx.state !== svgStyle) styleCtx.setState(svgStyle);
  }, [styleCtx, svgStyle]);
  useLayoutEffect(() => {
    if (modsCtx.state !== mods) modsCtx.replace(mods);
  }, [modsCtx, mods]);
  return <>{children}</>;
}

/** Pull a row's recorded strokes out of its render_config (the 3D source). Same
 *  validation flipEligibility runs (number tuples, len ≥ 2). Returns null when
 *  the row has no flippable strokes (uploads, legacy rows) so the card can show
 *  the honest 3D note instead of a broken mount. */
function rowStrokes(row: DoodleRow): StrokeInputPoint[][] | null {
  const raw = (row.render_config as Record<string, unknown> | null | undefined)?.strokes;
  if (flipEligibility(raw).canFlip) return raw as StrokeInputPoint[][];
  // No recorded strokes → DERIVE from the SVG so every doodle flips to 3D too
  // (Sebs: "some objects just don't turn 3D"). [] → honest 2D.
  const derived = svgMarkupToStrokes(sanitizeSvgMarkup(row.svg));
  return derived.length > 0 ? (derived as StrokeInputPoint[][]) : null;
}

/** The row's persisted 3D config (render_config.geometry3d), if any — passed to
 *  DeskObject3DMount so each doodle flips under its own saved 3D look. */
function rowGeometry3d(row: DoodleRow): Geometry3DConfig | null {
  const raw = (row.render_config as Record<string, unknown> | null | undefined)?.geometry3d;
  return raw && typeof raw === 'object' ? (raw as Geometry3DConfig) : null;
}

/** The row's persisted AI MESH (render_config.hardMeshUrl), if one was generated.
 *  THE 3D RULE (Sebs 2026-06-16): a generated AI mesh IS the object's 3D form — so
 *  on flip we show the MESH, not the local/native rebuild. Drawn doodles with no
 *  mesh fall back to the native 3D; uploads with no mesh stay 2D. */
function rowHardMesh(row: DoodleRow): string | undefined {
  const raw = (row.render_config as Record<string, unknown> | null | undefined)?.hardMeshUrl;
  return typeof raw === 'string' && raw ? raw : undefined;
}

/** True when the maker SAVED this doodle as 3D (render_config.is3d) → the grid
 *  shows it as 3D on its own, even while the global 2D/3D toggle is on 2D (Sebs
 *  2026-06-16: "3d won't save in the drawer" — it saved, the grid just ignored
 *  the per-object flag). */
function rowIs3d(row: DoodleRow): boolean {
  return (row.render_config as Record<string, unknown> | null | undefined)?.is3d === true;
}

/** An uploaded image (render_config.sourceImage) → only 3D via a mesh, never a
 *  native rebuild (same rule as the desk). */
function rowIsUpload(row: DoodleRow): boolean {
  return typeof (row.render_config as Record<string, unknown> | null | undefined)?.sourceImage === 'string';
}

/** The row's persisted 2D STYLE (render_config.svgStyle + .modifiers), if any.
 *  Restyle-persist fix (task #24): the drawer grid used to paint every card with
 *  the page's shared panel state, so a restyle done on the desk was invisible
 *  here. Each card now defaults to its OWN saved style (this), and the shared
 *  panel only overrides once the user engages it. Modifiers are merged onto the
 *  defaults so partial/legacy configs fill in. Returns null when the row has no
 *  saved style (→ card falls back to the panel/default). */
function rowConfig(row: DoodleRow): { svgStyle: F3SvgStyle; modifiers: F3ModifiersState } | null {
  const rc = row.render_config as Record<string, unknown> | null | undefined;
  if (!rc || typeof rc.svgStyle !== 'string') return null;
  const mods = rc.modifiers;
  return {
    svgStyle: rc.svgStyle as F3SvgStyle,
    modifiers:
      mods && typeof mods === 'object'
        ? { ...DEFAULT_MODIFIERS, ...(mods as Partial<F3ModifiersState>) }
        : DEFAULT_MODIFIERS,
  };
}

export function DrawerPage() {
  // Synchronous fallback handle so the chip is never blank, even pre-onboarding
  // / DB-off (getEffectiveHandle resolves the claimed/local/derived one below).
  // ?back=<deskId> → "← back to desk" (Expand carries the desk you came from).
  // ?ctx=public → Shelf only (a public desk reaches only your public drawer);
  // ?ctx=private (or absent on the homepage) → both, with the Drawer|Shelf toggle.
  const [searchParams] = useSearchParams();
  const backDeskId = searchParams.get('back') || '';
  // Came from a desk (Expand) iff the `back` key is present — even when empty
  // (the flat public board has no specific desk id). Distinguishes Expand from
  // the homepage's /drawer link, which carries no `back` key. The return target
  // is the specific desk when known, else plain /desk (the open desk = where
  // they were). Sebs 2026-06-14: "make sure we can get back to the current desk".
  const cameFromDesk = searchParams.has('back');
  const backToDeskHref = backDeskId ? `/desk?desk=${encodeURIComponent(backDeskId)}` : '/desk';
  const publicOnly = searchParams.get('ctx') === 'public';
  const [handle, setHandle] = useState<string>(() => handleFromId(getIdentityId()));
  const [tab, setTab] = useState<Tab>(publicOnly ? 'shelf' : 'drawer');
  const [phase, setPhase] = useState<Phase>('loading');
  const [rows, setRows] = useState<DoodleRow[]>([]);
  // The item currently being shared — disables its button + shows "Sharing…".
  const [sharingId, setSharingId] = useState<string | null>(null);
  // The item whose share just FAILED (DB off / RLS) — shows an honest "Couldn't
  // share — retry" instead of silently doing nothing. Cleared on the next try.
  const [shareFailedId, setShareFailedId] = useState<string | null>(null);
  // The doodle whose full view is open as a read-only ObjectSurface overlay.
  // null = grid; clicking a card sets it, closing returns to the grid.
  const [viewRow, setViewRow] = useState<DoodleRow | null>(null);

  // ── LIVE-RESTYLE STATE (the audit-page coupling) ───────────────────────────
  // One shared Style + Modifier state, held here, drives EVERY card in the grid
  // (exactly like ObjectSurface's surfStyle/surfMods drive its one card). The
  // panel's SurfaceControls reads/writes this; each card's CardRenderScope syncs
  // it into that card's nested providers.
  const [surfStyle, setSurfStyle] = useState<F3SvgStyle>('clean');
  const [surfMods, setSurfMods] = useState<F3ModifiersState>(DEFAULT_MODIFIERS);
  // Restyle-persist (task #24): until the user ENGAGES the shared panel, each
  // card shows its OWN saved style (rowConfig) so a desk/modal restyle persists
  // here too. Touching the panel flips this true → the panel overrides the whole
  // grid (the audit-page live-restyle sandbox); Reset returns to saved looks.
  const [engaged, setEngaged] = useState(false);
  // 2D / 3D — the whole grid flips together (audit-page MODE toggle analog).
  const [renderMode, setRenderMode] = useState<RenderMode>('2d');
  // FLIP-ALL: the grid's left <main> is the event-source container for the ONE
  // shared 3D canvas (Shared3DOverlay) — every card's LiveObject3DSlot draws
  // into it, so the whole grid flips to 3D with a single GL context (no
  // per-card-canvas crash). Off-screen cards are culled by drei <View>.
  const gridRef = useRef<HTMLElement>(null);

  // Right controls panel — same persisted-open + ⌘\ minimize wiring as the audit.
  const [rightOpen, toggleRight, setRightOpen] = usePanelOpen('drawer.right');
  useMinimizeUi([{ open: rightOpen, setOpen: setRightOpen }]);

  // Style switch — desk-chrome semantics (SmartHachureChrome / ObjectSurface
  // handleStyle): apply the new style's preset onto the CURRENT modifier state,
  // so picking "Bold ink" actually reads as bold ink and the rows snap to the
  // style's calibration.
  const handleStyle = (next: F3SvgStyle) => {
    setEngaged(true); // touching the panel = override the whole grid
    setSurfStyle(next);
    setSurfMods((prev) => applyStylePreset(prev, next));
  };
  const handleMod = <K extends keyof F3ModifiersState>(key: K, value: F3ModifiersState[K]) => {
    setEngaged(true);
    setSurfMods((prev) => ({ ...prev, [key]: value }));
  };
  // Reset — chrome semantics: DEFAULT baseline + this style's preset. Also drops
  // the override so the grid returns to each card's OWN saved style.
  const handleReset = () => {
    setEngaged(false);
    setSurfMods(applyStylePreset(DEFAULT_MODIFIERS, surfStyle));
  };

  // Resolve the warm handle once on mount. .catch keeps the deterministic
  // fallback if the profile read throws (DB off).
  useEffect(() => {
    let cancelled = false;
    getEffectiveHandle()
      .then((h) => {
        if (!cancelled && h) setHandle(h);
      })
      .catch(() => {
        /* keep the deterministic fallback set in useState */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetch the active tab's compartment. Returns the fresh rows so callers
  // (edit-save) can also re-point the open overlay to the updated record.
  const reload = useCallback(async (): Promise<DoodleRow[]> => {
    const data = await (tab === 'drawer' ? listMyDrawer() : listMyShelf()).catch(
      // Pre-migration DB / network / RLS — never crash; an empty compartment is
      // the honest read for a personal space that isn't wired up yet.
      () => [] as DoodleRow[],
    );
    setRows(data);
    setPhase('ready');
    return data;
  }, [tab]);

  // Load the active tab's data. Keyed on `tab`: switching re-fetches the right
  // compartment and shows the loading note in between.
  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setRows([]);
    void reload().then((data) => {
      // reload sets state unconditionally; if the tab changed mid-flight, the
      // newer effect already reset — drop this stale paint.
      if (cancelled) setRows((prev) => (prev === data ? [] : prev));
    });
    return () => {
      cancelled = true;
    };
  }, [tab, reload]);

  // Share a drawer item to the shelf. On a true result it has moved out of the
  // drawer (and into the shelf), so optimistically drop it from the drawer list.
  async function share(id: string) {
    setSharingId(id);
    setShareFailedId(null); // clear any prior failure on retry
    const ok = await shareToShelf(id).catch(() => false);
    setSharingId(null);
    if (ok) {
      setRows((prev) => prev.filter((r) => r.id !== id));
    } else {
      // Honest feedback instead of a silent no-op (sweep finding 2026-06-16).
      setShareFailedId(id);
    }
  }

  const isEmpty = phase === 'ready' && rows.length === 0;

  return (
    // Canvas3DProvider — shared 3D state so the panel's Canvas3DChrome drives
    // every card's Live3DMount in 3D mode (the gallery-wide 3D restyle lens).
    <Canvas3DProvider>
    <div
      style={{
        // Definite height (not min-height) so the page never scrolls — the left
        // grid and right panel each scroll internally (the /audit + /canvas
        // pattern). Was a single scrolling column; now a two-pane shell.
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--dir-bg)',
        color: 'var(--dir-text-primary)',
        fontFamily: IS,
        display: 'flex',
      }}
    >
      {/* ─── LEFT — header + the live-styled doodle grid ───────────────────── */}
      {/* position:relative so the shared 3D canvas (absolute inset:0) binds to
          THIS area, not the viewport — it can't paint over the right panel. */}
      <main
        ref={gridRef}
        style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}
      >
        {/* The ONE shared 3D canvas for the whole grid (flip-all, single GL
            context). Mounted only in 3D so 2D never pays for an idle canvas. */}
        {(renderMode === '3d' || rows.some(rowIs3d)) && (
          // Mounted for the global 3D toggle OR whenever any doodle is saved as
          // per-object 3D (those need their slot in this one shared canvas even
          // while the grid toggle is on 2D).
          // Self-heal the cold-load WebGL race in Make's preview (same fence as
          // the desk/homepage) — auto-retry instead of white-screening the grid.
          <Canvas3DBoundary>
            <Shared3DOverlay containerRef={gridRef} />
          </Canvas3DBoundary>
        )}
        {/* Top chrome — back chip + wordmark home left, handle chip + controls
            toggle right. Kept from the original, plus the PanelToggle. */}
        <header
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--dir-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            background: 'var(--dir-bg)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {cameFromDesk && (
              // Return to the desk you opened Expand from (Sebs: "no way back to
              // the desk they are on" / "make sure we can get back to the current
              // desk they were on"). Specific desk when known, else the open desk.
              <NavLink
                to={backToDeskHref}
                style={{ ...PILL, padding: '4px 12px', fontSize: 12, textDecoration: 'none' }}
              >
                ← Back to desk
              </NavLink>
            )}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={CHIP} title="Your handle">
              {displayHandle(handle)}
            </span>
            <PanelToggle
              side="right"
              open={rightOpen}
              label="Controls"
              onToggle={toggleRight}
              controlsId="drawer-right-panel"
            />
          </div>
        </header>

        {/* Body — scrollable, centered ~960 column. */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '40px 24px' }}>
          <div
            style={{
              width: '100%',
              maxWidth: 960,
              marginInline: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 28,
            }}
          >
            {/* Title block */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={SECTION_LABEL}>Your space</span>
              <h1
                style={{
                  fontFamily: ISe,
                  fontSize: 32,
                  lineHeight: 1.15,
                  letterSpacing: '-0.02em',
                  margin: 0,
                }}
              >
                Drawer &amp; Shelf
              </h1>
            </div>

            {/* Tab toggle — a segmented pill (PILL base; active segment filled
                like a CTA). The two named compartments. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* The Drawer|Shelf toggle ALWAYS shows — VIEWING your private
                  drawer from anywhere is harmless (Sebs 2026-06-14: "does it
                  even matter if they see their private one in the expand… the one
                  we only care about is them not being able to USE their private
                  doodle in a public space"). The privacy gate lives on the PLACE
                  action (the side panel), not on viewing. ?ctx=public still picks
                  the SHELF as the opening tab (you came from public), but you can
                  flip to your drawer freely. */}
              <div
                role="tablist"
                aria-label="Drawer and Shelf"
                style={{
                  display: 'inline-flex',
                  alignSelf: 'flex-start',
                  gap: 6,
                  padding: 4,
                  borderRadius: 999,
                  border: '1px solid var(--dir-border)',
                  background: 'var(--dir-raised)',
                }}
              >
                <TabButton label="Drawer" active={tab === 'drawer'} onClick={() => setTab('drawer')} />
                <TabButton label="Shelf" active={tab === 'shelf'} onClick={() => setTab('shelf')} />
              </div>

              {/* The metaphor line — the locked one-line explainer. */}
              <p
                style={{
                  fontFamily: IS,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: 'var(--dir-text-body-soft)',
                  margin: 0,
                }}
              >
                Drawer = private, just you. Shelf = public — others can see it from your handle.
              </p>
            </div>

            {/* Tab content — loading note, empty state, or the live doodle grid. */}
            <section role="tabpanel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {phase === 'loading' && (
                <div style={noteStyle}>
                  {tab === 'drawer' ? 'Opening your drawer…' : 'Opening your shelf…'}
                </div>
              )}

              {isEmpty && (
                <EmptyCompartment
                  title={tab === 'drawer' ? 'Your drawer is empty.' : 'Your shelf is empty.'}
                  body={
                    tab === 'drawer'
                      ? 'Stash a doodle here to keep it private.'
                      : 'Doodles you share — or post to the public wall — show up here for others to browse.'
                  }
                />
              )}

              {phase === 'ready' && rows.length > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: 16,
                  }}
                >
                  {/* Share-to-shelf is REVEAL-ON-HOVER (Sebs 2026-06-14: "don't
                      like when buttons are like that [always resting] — maybe on
                      hover or in the popup"). Hidden + non-interactive by default;
                      fades in over the card on hover / keyboard focus, so cards
                      stay clean. (The whole card already opens the object popup.) */}
                  <style>{`
                    .dd-drawer-card .dd-share { opacity: 0; pointer-events: none; transition: opacity .15s ease; }
                    .dd-drawer-card:hover .dd-share, .dd-drawer-card:focus-within .dd-share { opacity: 1; pointer-events: auto; }
                  `}</style>
                  {rows.map((row) => (
                    <div
                      key={row.id}
                      className={tab === 'drawer' ? 'dd-drawer-card' : undefined}
                      style={{ position: 'relative' }}
                    >
                      {/* The whole card is a click target → opens the full read-only
                          view. role=button wrapper (the card itself isn't a button)
                          so the mini art opens its doodle. */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setViewRow(row)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setViewRow(row);
                          }
                        }}
                        title="Open this doodle"
                        style={{ cursor: 'pointer' }}
                      >
                        <DoodleGridCard
                          row={row}
                          surfStyle={surfStyle}
                          surfMods={surfMods}
                          engaged={engaged}
                          renderMode={renderMode}
                        />
                      </div>
                      {/* Drawer items can be shared to the shelf; shelf items are
                          already public, so no action there. Overlaid at the card's
                          bottom, revealed on hover (above CSS). stopPropagation keeps
                          the Share tap from also opening the full view. */}
                      {tab === 'drawer' && (
                        <button
                          type="button"
                          className="dd-share"
                          onClick={(e) => {
                            e.stopPropagation();
                            share(row.id);
                          }}
                          disabled={sharingId === row.id}
                          title="Move this doodle to your public shelf"
                          style={{
                            ...CTA,
                            position: 'absolute',
                            bottom: 8,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            padding: '5px 12px',
                            fontSize: 10,
                            whiteSpace: 'nowrap',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                            // While a share is in flight OR after a failure, keep it
                            // shown even if the pointer leaves (so "Sharing…" /
                            // "Couldn't share" doesn't vanish before it's read).
                            ...(sharingId === row.id || shareFailedId === row.id
                              ? { opacity: 1, pointerEvents: 'auto' }
                              : null),
                            // Failed share → warm error tint so it reads as "tap again".
                            ...(shareFailedId === row.id
                              ? { borderColor: 'var(--dir-detail, #b45309)', color: 'var(--dir-detail, #b45309)' }
                              : null),
                          }}
                        >
                          {sharingId === row.id
                            ? 'Sharing…'
                            : shareFailedId === row.id
                              ? "Couldn't share — retry"
                              : 'Share to shelf'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      {/* ─── RIGHT — live Style/Modifier controls + 2D/3D toggle ───────────── */}
      <CollapsiblePanel
        side="right"
        open={rightOpen}
        width={420}
        id="drawer-right-panel"
        style={{
          borderLeft: '1px solid var(--dir-border)',
          background: 'var(--dir-raised)',
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={SECTION_LABEL}>Restyle your doodles</span>
          <p
            style={{
              fontFamily: IS,
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--dir-text-body-soft)',
              margin: 0,
            }}
          >
            Twist any control → every doodle above updates at once. Flip 2D/3D to
            see your drawn doodles as form.
          </p>

          {/* 2D / 3D — the whole grid flips together (audit MODE analog). */}
          <div
            role="tablist"
            aria-label="2D and 3D"
            style={{
              display: 'inline-flex',
              alignSelf: 'flex-start',
              gap: 6,
              padding: 4,
              borderRadius: 999,
              border: '1px solid var(--dir-border)',
              background: 'var(--dir-bg)',
            }}
          >
            <ModeButton label="2D" active={renderMode === '2d'} onClick={() => setRenderMode('2d')} />
            <ModeButton label="3D" active={renderMode === '3d'} onClick={() => setRenderMode('3d')} />
          </div>
          {renderMode === '3d' && (
            <p style={{ ...noteHint }}>
              3D rebuilds from a doodle's recorded strokes — drawn doodles flip;
              uploads stay 2D (vision router, coming later).
            </p>
          )}

          {/* 3D → the full 3D control set (Canvas3DChrome), driving every card's
              Live3DMount via Canvas3DProvider. 2D → the per-style restyle set
              (Sebs: "add the 3d toggles everywhere it's missing"). */}
          {renderMode === '3d' ? (
            <Canvas3DChrome />
          ) : (
            <SurfaceControls
              svgStyle={surfStyle}
              mods={surfMods}
              onStyle={handleStyle}
              onMod={handleMod}
              onReset={handleReset}
            />
          )}
        </div>
      </CollapsiblePanel>

      {/* Full EDIT view of the tapped doodle (these are all YOUR doodles —
          drawer = private, shelf = your public). Edit mode lets you twist the
          toggles and Save, re-draw the strokes, or delete — persisting back to
          the record (Sebs 2026-06-14: "do it anywhere"; "they mess with the
          toggles and that saves too… like an update button"). The config save
          runs inside ObjectSurface (updateDoodleConfig); we refresh the grid +
          re-point the overlay so the new look shows without a reload. */}
      {viewRow && (
        <ObjectSurface
          mode="edit"
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
          onSave={(name, why) => {
            if (viewRow.id) void updateDoodleMeta(viewRow.id, name, why).catch(() => {});
          }}
          onConfigSave={(config) => {
            // OPTIMISTIC — patch the row's render_config locally so the grid
            // reflects the save IMMEDIATELY (incl. is3d → per-object 3D). The old
            // reload() re-fetched the DB BEFORE ObjectSurface's await-write landed,
            // so it pulled stale rows and the 3D never showed (Sebs 2026-06-16:
            // "3d toggle still doesn't save in the drawer"). The DB write still
            // runs inside ObjectSurface; next natural reload reconciles.
            if (!viewRow.id) return;
            const next = config as unknown as Record<string, unknown>;
            setRows((prev) => prev.map((r) => (r.id === viewRow.id ? { ...r, render_config: next } : r)));
            setViewRow((v) => (v && v.id === viewRow.id ? { ...v, render_config: next } : v));
          }}
          onObjectUpdate={(svgMarkup, config) => {
            // Re-draw saved → patch svg + config locally (same optimistic reason).
            if (!viewRow.id) return;
            const next = config as unknown as Record<string, unknown>;
            setRows((prev) =>
              prev.map((r) => (r.id === viewRow.id ? { ...r, svg: svgMarkup, render_config: next } : r)),
            );
            setViewRow((v) => (v && v.id === viewRow.id ? { ...v, svg: svgMarkup, render_config: next } : v));
          }}
          onDelete={
            viewRow.id
              ? () => {
                  const id = viewRow.id!;
                  setViewRow(null);
                  setRows((prev) => prev.filter((r) => r.id !== id));
                  void deleteDoodle(id).catch(() => {});
                }
              : undefined
          }
        />
      )}
    </div>
    </Canvas3DProvider>
  );
}

// ── DoodleGridCard — one grid cell, rendered through the live shared style ────
// 2D: the card's art well runs the markup through the nested-provider render
// scope (the audit-page live path, for raw markup). 3D: if the row carries
// flippable strokes, DeskObject3DMount renders the SAME Stroke3DScene the
// /canvas flip uses (still render, no orbit), inside the same mini-card frame;
// otherwise an honest "stays 2D" note (no dead 3D affordance).
function DoodleGridCard({
  row,
  surfStyle,
  surfMods,
  engaged,
  renderMode,
}: {
  row: DoodleRow;
  surfStyle: F3SvgStyle;
  surfMods: F3ModifiersState;
  engaged: boolean;
  renderMode: RenderMode;
}) {
  const strokes = useMemo(() => rowStrokes(row), [row]);
  const geometry3d = useMemo(() => rowGeometry3d(row), [row]);
  const hardMeshUrl = useMemo(() => rowHardMesh(row), [row]);
  const aiMeshLook = useMemo(() => {
    const v = (row.render_config as Record<string, unknown> | null | undefined)?.aiMesh;
    return v && typeof v === 'object'
      ? (v as { materialMode?: 'greyscale' | 'og-pbr' | 'hatch' | 'native' | 'svg-port'; dark?: number; contrast?: number; autoSpin?: boolean })
      : undefined;
  }, [row]);
  const markup = useMemo(() => sanitizeSvgMarkup(row.svg), [row.svg]);
  // Restyle-persist: default to the card's OWN saved style; the shared panel
  // wins only once engaged (task #24).
  const saved = useMemo(() => rowConfig(row), [row]);
  const cardStyle = engaged || !saved ? surfStyle : saved.svgStyle;
  // svg-port 3D carves the SAVED markup (row.svg) → match the carve PROFILE to the
  // saved style; small thumbnail texture (512) keeps the grid's restyle snappy.
  const drawerSvgPortBuild = useMemo(
    () => ({ styleId: saved?.svgStyle, longEdge: 512 }),
    [saved],
  );
  const cardMods = engaged || !saved ? surfMods : saved.modifiers;

  // Show 3D when the global toggle is 3D OR this doodle was saved as per-object
  // 3D (render_config.is3d). An uploaded image only counts when it has a mesh.
  const upload = useMemo(() => rowIsUpload(row), [row]);
  const show3d = (renderMode === '3d' || rowIs3d(row)) && (!!hardMeshUrl || (!!strokes && !upload));
  if (show3d) {
    // A generated AI mesh IS the 3D form → flip shows the mesh even when the
    // doodle also has flippable strokes (an upload with a mesh has no strokes but
    // still flips). Drawn doodles with no mesh fall back to the native rebuild.
    if (strokes || hardMeshUrl) {
      // Mirror ObjectCard's mini frame so 2D↔3D cards sit identically in the grid.
      return (
        <div style={MINI_3D_SHELL}>
          <div style={MINI_3D_NAME} title={row.name ?? 'Untitled doodle'}>
            {row.name || 'Untitled doodle'}
          </div>
          <div style={MINI_3D_WELL}>
            {/* LiveObject3DSlot = a viewport in the grid's ONE shared canvas
                (Shared3DOverlay above) — driven by the panel's Canvas3DChrome
                (one 3D look across the gallery), rotatable, no per-card canvas.
                hardMeshUrl set ⇒ it renders the AI MESH in place of the rebuild. */}
            <LiveObject3DSlot strokes={strokes ?? []} svgPortMarkup={markup} svgPortBuild={drawerSvgPortBuild} hardMeshUrl={hardMeshUrl} aiMeshLook={aiMeshLook} config={geometry3d} />
          </div>
        </div>
      );
    }
    // No flippable strokes — honest note, same register as ObjectConvertAction.
    return (
      <div style={MINI_3D_SHELL}>
        <div style={MINI_3D_NAME} title={row.name ?? 'Untitled doodle'}>
          {row.name || 'Untitled doodle'}
        </div>
        <div style={{ ...MINI_3D_WELL, padding: 12 }}>
          <span style={noteHint}>stays 2D — no recorded strokes to lift</span>
        </div>
      </div>
    );
  }

  // 2D — each card shows its SAVED style by default; the shared panel overrides
  // the whole grid once engaged (restyle-persist + the audit-page sandbox).
  return (
    <F3SvgStyleProvider>
      <F3RoughModifiersProvider>
        <CardRenderScope svgStyle={cardStyle} mods={cardMods}>
          <ObjectCard svgMarkup={markup} name={row.name} owner="you" mini />
        </CardRenderScope>
      </F3RoughModifiersProvider>
    </F3SvgStyleProvider>
  );
}

// One segment of the tab pill. Active = filled (CTA tokens); inactive = a quiet
// borderless pill so only the live tab carries weight.
function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        ...PILL,
        border: 'none',
        padding: '7px 18px',
        background: active ? 'var(--dir-cta-bg)' : 'transparent',
        color: active ? 'var(--dir-cta-text)' : 'var(--dir-text-body)',
      }}
    >
      {label}
    </button>
  );
}

// 2D/3D segment — same pill grammar as TabButton, compact for the panel.
function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        ...PILL,
        border: 'none',
        padding: '6px 16px',
        fontSize: 12,
        background: active ? 'var(--dir-cta-bg)' : 'transparent',
        color: active ? 'var(--dir-cta-text)' : 'var(--dir-text-body)',
      }}
    >
      {label}
    </button>
  );
}

// Empty compartment — a raised paper well with the honest copy, so an empty tab
// still reads as a real, finished surface (not a blank hole). Mirrors the
// DoorCard paper-grain treatment from the Home page.
function EmptyCompartment({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--dir-raised)',
        border: '1px solid var(--dir-border)',
        borderRadius: 16,
        padding: '40px 28px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        textAlign: 'center',
        minHeight: 220,
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
          fontFamily: ISe,
          fontSize: 18,
          lineHeight: 1.3,
          letterSpacing: '-0.01em',
          color: 'var(--dir-text-primary)',
          margin: 0,
        }}
      >
        {title}
      </p>
      <p
        style={{
          position: 'relative',
          fontFamily: IS,
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--dir-text-body)',
          margin: 0,
          maxWidth: 360,
        }}
      >
        {body}
      </p>
    </div>
  );
}

// Centered single-line note (loading), same idiom as DeskGallery's note style.
const noteStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '48px 0',
  textAlign: 'center',
  color: 'var(--dir-text-body-soft)',
  fontFamily: IS,
  fontSize: 13,
} as const;

// Quiet italic hint (3D note / honest caption), same register as the surfaces.
const noteHint: CSSProperties = {
  fontFamily: IS,
  fontSize: 10,
  fontStyle: 'italic',
  color: 'var(--dir-text-body-soft)',
  lineHeight: 1.4,
  textAlign: 'center',
  margin: 0,
};

// ── Mini 3D card frame — mirrors ObjectCard's mini shell so a 3D cell sits the
// same as a 2D ObjectCard in the grid (name banner + square art well). The 2D
// card carries its own shell; this is the parallel for the 3D mount.
const MINI_3D_SHELL: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--dir-raised)',
  border: '1px solid var(--dir-border)',
  borderRadius: 16,
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  fontFamily: IS,
};

const MINI_3D_NAME: CSSProperties = {
  fontFamily: ISe,
  fontVariationSettings: '"SOFT" 60, "WONK" 1',
  fontSize: 13,
  letterSpacing: '-0.01em',
  color: 'var(--dir-text-primary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const MINI_3D_WELL: CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '1 / 1',
  backgroundColor: 'var(--dir-bg)',
  borderRadius: 6,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
