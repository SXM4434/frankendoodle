// PersonalDrawer — the desk-view drawer panel (personal-space).
//
// Shows YOUR drawer doodles + an "Expand ⤢" button → the full Drawer/Shelf popup
// (DrawerExpandPopup, mounted by the host, context-aware). Desk management
// (new / switch desks) does NOT live here — it's on the /your-space page (Sebs
// 2026-06-14: "i dont need the new desk in the drawer"). Mounted by DeskPage only
// when isPersonalSpaceEnabled(); all data calls degrade gracefully (empty) on a
// pre-migration DB.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IS } from '../../lib/typography';
import { PILL, SECTION_LABEL } from '../../lib/chromeStyles';
import { sanitizeSvgMarkup } from '../../lib/svgUpload';
import { subscribeDoodles, type DoodleRow } from '../../lib/publish';
import { listMyDrawer, listMyShelf, getEffectiveHandle } from '../../lib/personalSpace';
import { displayHandle } from '../../lib/handle';
import { ObjectCard } from './ObjectCard';
import { DD_DOODLE_DRAG_TYPE } from './DrawerPanel';
import { F3SvgStyleProvider, useF3SvgStyle, type F3SvgStyle } from '../../state/F3SvgStyleContext';
import { F3RoughModifiersProvider, useF3RoughModifiers, DEFAULT_MODIFIERS, type F3ModifiersState } from '../../state/F3RoughModifiersContext';
import { Canvas3DProvider } from '../../state/Canvas3DContext';
import { Canvas3DBoundary, LiveObject3DSlot, Shared3DOverlay } from './DeskObject3DMount';
import { svgMarkupToStrokes } from '../../lib/svgToStrokes';
import { flipEligibility } from '../../lib/geometry3d/deskRenderMode';
import type { Geometry3DConfig } from '../../lib/geometry3d/deskRenderMode';
import type { StrokeInputPoint } from '../../lib/geometry3d/strokeTo3d';

// ── Per-row 3D inputs (mirror DrawerPage) — so a card the maker switched to 3D
// shows its 3D MODEL in the panel preview, not the flat SVG (Sebs 2026-06-17:
// "it's still the svg when it should be a 3d model… switching to 3d doesn't update
// the preview"). ───────────────────────────────────────────────────────────────
type AiMeshLook = { materialMode?: 'greyscale' | 'og-pbr' | 'hatch' | 'native' | 'svg-port'; dark?: number; contrast?: number; autoSpin?: boolean };
function rc(row: DoodleRow): Record<string, unknown> | null {
  return (row.render_config as Record<string, unknown> | null | undefined) ?? null;
}
function rowIs3d(row: DoodleRow): boolean {
  return rc(row)?.is3d === true;
}
/** The static 3D thumbnail (render_config.thumb3d, a data-URL captured at save) →
 *  the panel shows THIS as the 3D preview, no live canvas. */
function rowThumb3d(row: DoodleRow): string | undefined {
  const v = rc(row)?.thumb3d;
  return typeof v === 'string' && v ? v : undefined;
}
function rowIsUpload(row: DoodleRow): boolean {
  return typeof rc(row)?.sourceImage === 'string';
}
function rowHardMesh(row: DoodleRow): string | undefined {
  const v = rc(row)?.hardMeshUrl;
  return typeof v === 'string' && v ? v : undefined;
}
function rowGeometry3d(row: DoodleRow): Geometry3DConfig | undefined {
  const v = rc(row)?.geometry3d;
  return v && typeof v === 'object' ? (v as Geometry3DConfig) : undefined;
}
function rowAiMeshLook(row: DoodleRow): AiMeshLook | undefined {
  const v = rc(row)?.aiMesh;
  return v && typeof v === 'object' ? (v as AiMeshLook) : undefined;
}
function rowStrokes(row: DoodleRow): StrokeInputPoint[][] | null {
  const raw = rc(row)?.strokes;
  if (flipEligibility(raw).canFlip) return raw as StrokeInputPoint[][];
  const derived = svgMarkupToStrokes(sanitizeSvgMarkup(row.svg));
  return derived.length > 0 ? (derived as StrokeInputPoint[][]) : null;
}

// Render-scope (mirror of DrawerPage.CardRenderScope): syncs a card's OWN saved
// style into the shadowed F3 context so it re-renders through the IDENTICAL desk
// path with ITS values — so a Quiver-traced upload (saved Clean) shows clean
// line-art, not the panel's default rough (Sebs 2026-06-17: "the svg quiver cards
// show a normal svg, not the quiver — make sure it's the right one for any card").
function CardRenderScope({ svgStyle, mods, children }: { svgStyle: F3SvgStyle; mods: F3ModifiersState; children: ReactNode }) {
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

/** The card's SAVED 2D style (render_config.svgStyle + .modifiers), defaulted. */
function itemStyle(item: DoodleRow): { svgStyle: F3SvgStyle; mods: F3ModifiersState } {
  const rc = item.render_config as Record<string, unknown> | null | undefined;
  const svgStyle = (typeof rc?.svgStyle === 'string' ? rc.svgStyle : 'rough-handdrawn') as F3SvgStyle;
  const m = rc?.modifiers;
  const mods = m && typeof m === 'object' ? { ...DEFAULT_MODIFIERS, ...(m as Partial<F3ModifiersState>) } : DEFAULT_MODIFIERS;
  return { svgStyle, mods };
}

export interface PersonalDrawerProps {
  /** The desk currently in view — "Place here" drops a drawer item onto it. */
  currentDeskId: string | null;
  /** True when the desk in view is one of YOUR private desks (has owner_id). The
   *  panel then shows your DRAWER (private stash); on the PUBLIC desk it shows your
   *  SHELF (your public doodles) instead — so it actually populates (Sebs
   *  2026-06-16: "the side panel shows shelf for public desk, drawer for private…
   *  the left panel doesn't have objects"). */
  isPrivate?: boolean;
  /** A drawer item was placed onto the current desk — host can refresh the desk. */
  onPlaced?: (doodle: DoodleRow) => void;
  /** Open the onboarding / handle editor (the handle chip is the entry point). */
  onEditHandle?: () => void;
  /** Open the full Drawer/Shelf expand popup (host mounts DrawerExpandPopup). */
  onExpand: () => void;
  /** Bumped by the host after a drag-drop places an item → re-list (the placed
   *  item leaves the drawer/shelf). */
  refreshSignal?: number;
  /** Click a card → open its full card (the host's drawer-row Edit surface). */
  onOpenItem?: (row: DoodleRow) => void;
}

export function PersonalDrawer({ currentDeskId, isPrivate = false, onEditHandle, onExpand, refreshSignal = 0, onOpenItem }: PersonalDrawerProps) {
  const [handle, setHandle] = useState<string>('');
  const [drawer, setDrawer] = useState<DoodleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const placingId: string | null = null;
  // DRAG-FOLLOWER (Sebs 2026-06-23): the source card dims while its doodle is in
  // flight to the desk (only the doodle floats via setDragImage; the card stays
  // behind, greyed). Restored on dragend.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // WHICH list the panel shows. On a PRIVATE desk it opens on DRAWER (your private
  // stash) with a toggle to your SHELF (Sebs 2026-06-17: "my private desk should
  // show my drawer not the shelf… a toggle to switch, always drawer first"). On
  // the PUBLIC board it's your SHELF (your public doodles).
  const [tab, setTab] = useState<'drawer' | 'shelf'>(isPrivate ? 'drawer' : 'shelf');
  useEffect(() => {
    setTab(isPrivate ? 'drawer' : 'shelf');
  }, [isPrivate]);

  const gridRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [h, dr] = await Promise.all([
      getEffectiveHandle().catch(() => ''),
      (tab === 'drawer' ? listMyDrawer() : listMyShelf()).catch(() => [] as DoodleRow[]),
    ]);
    setHandle(h);
    // DEDUPE — collapse identical doodles (same content_hash, else id) so the same
    // drawing doesn't show twice (Sebs 2026-06-17: "still some duplicates"). Keeps
    // the newest of each (the list is created_at-desc).
    const seen = new Set<string>();
    const deduped = dr.filter((r) => {
      const ch = (r as unknown as Record<string, unknown>).content_hash;
      const key = (typeof ch === 'string' ? ch : r.id) as string;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setDrawer(deduped);
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshSignal]);

  // LIVE — re-list when any of your doodles changes (add / restyle / 3D edit /
  // delete), from THIS surface or anywhere else, so the panel never reads stale
  // (Sebs 2026-06-17: "no edits update in the side panel… it doesn't update at
  // all"). Fires post-commit, so it sidesteps the optimistic-vs-write race the
  // refreshSignal bump had. Graceful no-op if realtime is unavailable.
  useEffect(() => {
    const unsub = subscribeDoodles({
      onInsert: () => void refresh(),
      onUpdate: () => void refresh(),
      onDelete: () => void refresh(),
    });
    return unsub;
  }, [refresh]);

  const any3d = drawer.some((it) => rowIs3d(it) && (rowHardMesh(it) || (rowStrokes(it) && !rowIsUpload(it))));

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        fontFamily: IS,
        background: 'var(--dir-bg)',
        borderRight: '1px solid var(--dir-border)',
      }}
    >
      <button
        onClick={onEditHandle}
        title="Edit your handle"
        style={{ ...PILL, alignSelf: 'flex-start', textTransform: 'none', letterSpacing: '-0.005em', fontSize: 13 }}
      >
        {handle ? displayHandle(handle) : 'Your space'}
      </button>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={SECTION_LABEL}>{tab === 'drawer' ? 'My drawer' : 'My shelf'}</h3>
          <button onClick={onExpand} title="Open the full drawer & shelf" style={{ ...PILL, padding: '4px 10px', fontSize: 10 }}>
            Expand ⤢
          </button>
        </div>
        {/* Drawer | Shelf toggle — PRIVATE desks only (Sebs 2026-06-17: "the toggle
            is only for the private space desk, not the public desk panels"). On the
            public board the panel just shows your shelf. The 3D PREVIEW for 3D cards
            lives on Expand (the full drawer page) — a live 3D canvas can't render in
            this side panel without bleeding over the desk (drei's shared <View>
            tunnel collides with the desk's 3D canvas). */}
        {isPrivate && (
        <div role="tablist" aria-label="Drawer or shelf" style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999, border: '1px solid var(--dir-border)', background: 'var(--dir-raised)', alignSelf: 'flex-start' }}>
          {(['drawer', 'shelf'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              style={{ ...PILL, padding: '3px 12px', fontSize: 10, border: 'none', background: tab === t ? 'var(--dir-text-primary)' : 'transparent', color: tab === t ? 'var(--dir-bg)' : 'var(--dir-text-body)' }}
            >
              {t === 'drawer' ? 'Drawer' : 'Shelf'}
            </button>
          ))}
        </div>
        )}
        {!loading && drawer.length === 0 && (
          <p style={{ ...SECTION_LABEL, textTransform: 'none', color: 'var(--dir-text-body-soft)' }}>
            {tab === 'drawer'
              ? 'Empty. Stash a doodle here to save it privately.'
              : 'Empty. Share a doodle to your shelf to show it on your profile.'}
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10, minWidth: 0 }}>
          {drawer.map((item) => (
            <div
              key={item.id}
              draggable={!!currentDeskId}
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  DD_DOODLE_DRAG_TYPE,
                  JSON.stringify({ svg: item.svg, name: item.name ?? null, why: item.why ?? null, renderConfig: item.render_config ?? null }),
                );
                e.dataTransfer.effectAllowed = 'copy';
                const art = e.currentTarget.querySelector('[data-dd-card-art]');
                if (art instanceof HTMLElement && typeof e.dataTransfer.setDragImage === 'function') {
                  e.dataTransfer.setDragImage(art, art.offsetWidth / 2, art.offsetHeight / 2);
                }
                // dim AFTER the drag-image snapshot (next frame) → bright doodle, grey card.
                requestAnimationFrame(() => setDraggingId(item.id));
              }}
              onDragEnd={() => setDraggingId(null)}
              onClick={() => onOpenItem?.(item)}
              title={onOpenItem ? 'Click to open · drag onto the desk to place' : currentDeskId ? 'Drag onto the desk to place it' : 'Open a desk to place it'}
              style={{ minWidth: 0, cursor: onOpenItem ? 'pointer' : currentDeskId ? 'grab' : 'default', opacity: draggingId === item.id || placingId === item.id ? 0.4 : 1, transition: 'opacity 0.16s ease' }}
            >
              <F3SvgStyleProvider>
                <F3RoughModifiersProvider>
                  <CardRenderScope {...itemStyle(item)}>
                    {/* 3D card → show the STATIC 3D thumbnail (captured at save) in
                        the SAME card frame via artOverride; else the 2D SVG. */}
                    <ObjectCard
                      svgMarkup={sanitizeSvgMarkup(item.svg)}
                      name={item.name}
                      owner="you"
                      mini
                      artOverride={
                        rowThumb3d(item) ? (
                          <img
                            src={rowThumb3d(item)}
                            alt=""
                            draggable={false}
                            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                          />
                        ) : undefined
                      }
                    />
                  </CardRenderScope>
                </F3RoughModifiersProvider>
              </F3SvgStyleProvider>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
