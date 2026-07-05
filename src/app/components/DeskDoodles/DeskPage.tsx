import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { NavLink, useSearchParams, useNavigate } from 'react-router';
import type { Geometry3DConfig } from '../../lib/geometry3d/deskRenderMode';
import { IS, ISe } from '../../lib/typography';
import { CTA, PILL, SECTION_LABEL, CHIP } from '../../lib/chromeStyles';
import { PAPER_GRAIN, WARM_POOL, OBJECT_SIT_SHADOW } from '../../lib/deskCraft';
import { normalizeSvgSize } from '../../lib/normalizeInput';
import { SvgStyleTransform } from '../canvas/SvgStyleTransform';
import { SmartHachureChrome } from '../chrome/SmartHachureChrome';
import {
  F3SvgStyleProvider,
  useF3SvgStyle,
  F3_SVG_STYLES,
  type F3SvgStyle,
} from '../../state/F3SvgStyleContext';
import {
  F3RoughModifiersProvider,
  useF3RoughModifiers,
  DEFAULT_MODIFIERS,
  MULTI_STROKE_STEPS,
  FILL_STYLE_STEPS,
  PALETTE_MODE_STEPS,
  TEXTURE_STEPS,
  DOT_PATTERN_STEPS,
  ENDPOINT_BEHAVIOR_STEPS,
  SKETCHING_STYLE_STEPS,
  PEN_TIP_STEPS,
  type F3ModifiersState,
} from '../../state/F3RoughModifiersContext';
import {
  CollapsiblePanel,
  PanelToggle,
  useElementNarrow,
  useMinimizeUi,
  usePanelOpen,
} from '../chrome/CollapsiblePanel';
import { PanelBoundary } from '../chrome/PanelBoundary';
import { DrawPanel } from './DrawPanel';
import { Canvas3DBoundary, DeskObject3DMount, Live3DMount, LiveObject3DSlot, Shared3DOverlay } from './DeskObject3DMount';
import type { TumbleState } from '../canvas3d/Stroke3DScene';
import { svgMarkupToStrokes } from '../../lib/svgToStrokes';
import { useDeskPhysics } from '../../lib/useDeskPhysics';
import type { PhysState } from '../../lib/deskPhysics';
import { Canvas3DProvider } from '../../state/Canvas3DContext';
import { Canvas3DChrome } from '../chrome/Canvas3DChrome';
import { DrawerPanel } from './DrawerPanel';
import { OnboardingFlow } from './OnboardingFlow';
import { PersonalDrawer } from './PersonalDrawer';
import { ProfileShelfPopover } from './ProfileShelfPopover';
import { isPersonalSpaceEnabled, getLocalHandle, stashToDrawer, shareToShelf, listMyDesks, publishToPrivateDesk } from '../../lib/personalSpace';
import { handleFromId } from '../../lib/handle';
import {
  getOpenDesk,
  listDesks,
  deleteDoodle,
  listDoodles,
  listDoodlesForDesk,
  publishDoodle,
  subscribeDoodles,
  subscribeDoodlesForDesk,
  updateDoodleMeta,
  updateDoodlePosition,
  type DeskRow,
  type DoodleRow,
} from '../../lib/publish';
import { getSessionId } from '../../lib/session';
import { supabase } from '../../lib/supabase';
import { sanitizeSvgMarkup } from '../../lib/svgUpload';
import { buildDemoWall } from '../../lib/demoWall';
import { ObjectSurface, type ObjectSurfaceMode } from './ObjectSurface';

// ─── DeskPage — the REAL desk flow (/desk) ──────────────────────────────────
// Per docs/memory/project_desk_doodles_draw_panel_vs_desk_canvas.md: the desk
// canvas is the parent surface holding an array of OBJECTS; the DrawPanel
// popup produces ONE object per Done. /canvas stays as the drawing
// primitive's test surface — this page is the product flow.
// M9 WIRED 2026-06-11: every Done auto-publishes to Supabase, the desk loads
// the shared feed on mount, other sessions' doodles arrive live via
// realtime, and drag-end persists position (session-scoped, v1 trust model).
//
// MULTI-DESK (2026-06-11): grounded in docs/design/object-model-and-desk-
// architecture.md §"Multi-desk". Each public desk is capped (~50 objects);
// the data layer's publish_to_open_desk() RPC caps + auto-spawns the next desk
// server-side. This page is now DESK-AWARE: it views ONE desk at a time
// (the open one by default, or a specific past desk via ?desk=N), loads +
// subscribes scoped to THAT desk's id, and shows the desk's fun name + a
// count/cap readout. Drawing always routes to the OPEN desk; viewing a closed
// past desk still lets you add — the new object lands on the open desk and the
// view switches there. GRACEFUL FALLBACK: if getOpenDesk() returns null (the
// desks table isn't pasted yet), the whole page falls back to the flat
// single-desk listDoodles/subscribeDoodles/publishDoodle behavior so the app
// still works pre-SQL-paste.

// ─── THE PEN MODEL (D-6 + D-7, docs/design/global-toggles-and-mixed-3d.md) ──
// An object's treatment is a TREATMENT-STAGE RECORD: the global style + the
// full modifier state are snapshotted into `render_config` at the Done
// boundary, and each placed object renders from ITS OWN config — the right
// panel is your PEN (styles the draw popup + the NEXT doodle only). The
// Pen|Desk gate below flips the panel into the D-1/D-2 viewer-local lens
// (every object re-renders under the live panel state; records untouched;
// nobody else sees it). Objects with NO config (pre-existing rows) fall back
// to the live global state — exactly the pre-D-7 behavior, nothing breaks.
// The index signature is the STROKES-IN-THE-RECORD contract (2026-06-12):
// render_config may carry extra fields beyond the pen snapshot — today
// `strokes` (Array<Array<[x, y, pressure]>>, draw-canvas 800×600 viewBox
// space, written at the Done boundary below) — and every parse/persist hop
// must pass unknown fields through UNTOUCHED so the record's source strokes
// survive round-trips (Edit-restyle re-persists the whole config; a parser
// that rebuilt only {svgStyle, modifiers} would silently destroy them).
type ObjectRenderConfig = {
  svgStyle: F3SvgStyle;
  modifiers: F3ModifiersState;
  [extra: string]: unknown;
};

/** Discrete modifier keys → their legal enum values. parseRenderConfig checks
 *  string fields against these (a bare typeof check would let any string —
 *  e.g. fillStyle:"banana" from a hand-crafted row — into the render path). */
const MODIFIER_ENUMS: Partial<Record<keyof F3ModifiersState, readonly string[]>> = {
  multiStroke: MULTI_STROKE_STEPS,
  fillStyle: FILL_STYLE_STEPS,
  strokePalette: PALETTE_MODE_STEPS,
  fillPalette: PALETTE_MODE_STEPS,
  risoSecondaryColor: PALETTE_MODE_STEPS,
  texture: TEXTURE_STEPS,
  dotPattern: DOT_PATTERN_STEPS,
  endpointBehavior: ENDPOINT_BEHAVIOR_STEPS,
  sketchingStyle: SKETCHING_STYLE_STEPS,
  penTip: PEN_TIP_STEPS,
};

/** Parse a doodles.render_config jsonb payload → a render config, or null.
 *  Defensive on purpose (the column is anon-writable): the style must be a
 *  real F3SvgStyle, and modifier values are taken key-by-key ONLY where the
 *  type matches DEFAULT_MODIFIERS' (finite numbers; enum strings checked
 *  against their step lists) — unknown/missing keys fall back to the
 *  defaults, so configs stay forward-compatible as the modifier set grows.
 *  UNKNOWN TOP-LEVEL FIELDS (e.g. `strokes`) pass through untouched — the
 *  render path only reads svgStyle/modifiers, and consumers of the extras
 *  (3D conversion, re-draw) do their own validation. */
function parseRenderConfig(raw: unknown): ObjectRenderConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const style = rec.svgStyle;
  if (typeof style !== 'string' || !F3_SVG_STYLES.some((s) => s.id === style)) {
    return null;
  }
  const modifiers: F3ModifiersState = { ...DEFAULT_MODIFIERS };
  const rawMods = rec.modifiers;
  if (rawMods && typeof rawMods === 'object') {
    for (const key of Object.keys(DEFAULT_MODIFIERS) as (keyof F3ModifiersState)[]) {
      const v = (rawMods as Record<string, unknown>)[key];
      if (v == null || typeof v !== typeof DEFAULT_MODIFIERS[key]) continue;
      if (typeof v === 'number' && !Number.isFinite(v)) continue;
      const allowed = MODIFIER_ENUMS[key];
      if (typeof v === 'string' && allowed && !allowed.includes(v)) continue;
      (modifiers as Record<string, unknown>)[key] = v;
    }
  }
  // Spread-then-override: extras (strokes etc.) ride through as-is; the
  // validated svgStyle + modifiers replace their raw counterparts.
  return { ...rec, svgStyle: style as F3SvgStyle, modifiers };
}

// ─── LEGACY-ROW FREEZE (UX-audit fix 1, D-7) ────────────────────────────────
// Rows with NO render_config (pre-D-7 legacy rows — most of the live desk)
// used to fall back to the LIVE global context, so every Pen-scope slider
// move restyled the placed desk — flatly contradicting the Pen|Desk pill's
// promise that Pen touches NOTHING placed (audit finding). They now pin to
// this frozen DEFAULT snapshot at load: rough-handdrawn + DEFAULT_MODIFIERS
// is exactly what an untouched pen renders, so a fresh /desk visit looks
// byte-identical to before — the freeze only shows when the pen MOVES (and
// the desk now correctly doesn't). One module-level object so the reference
// is stable for the memoized render path (DeskObjectArt keys on it). The
// Desk lens still sweeps frozen rows — the lens slot renders straight off
// the live context regardless of config.
const LEGACY_FREEZE_CONFIG: ObjectRenderConfig = {
  svgStyle: 'rough-handdrawn',
  modifiers: DEFAULT_MODIFIERS,
};

/** Drag-to-place (DRAWER v2 item 2) — the drag payload MIME type. The drawer
 *  (drag source) sets JSON {svg, name, why, renderConfig} under this type;
 *  the desk below is the drop target and places a COPY at the drop point
 *  through the exact addObject sourceConfig path Place-here uses. */
const DD_DOODLE_MIME = 'application/x-dd-doodle';

/** Publish retry backoff (UX-audit fix 3): attempt 1 fails → wait 2s →
 *  attempt 2 → 6s → attempt 3. Three strikes = permanent failure (honest
 *  note on the object; it stays desk-local for this session). */
const PUBLISH_RETRY_DELAYS_MS = [2000, 6000];

type DeskObject = {
  id: string;
  /** Supabase row id once published/loaded — undefined only for the brief
   *  window between local add and the insert resolving (or on publish fail,
   *  where the object stays desk-local for this session). */
  dbId?: string;
  svgMarkup: string;
  x: number;
  y: number;
  rotation: number;
  // Rich-record fields (the object is a record, not a blob — design doc §1).
  // Populated from the DB row; undefined for a just-added local object until
  // its insert resolves. ownerSession drives own-vs-others (edit vs sandbox).
  name?: string | null;
  why?: string | null;
  ownerSession?: string | null;
  createdAt?: string | null;
  /** The pen snapshot this object was made under (D-6). Legacy pre-config
   *  rows arrive pinned to LEGACY_FREEZE_CONFIG at the row→object boundary,
   *  so by the time an object is on the desk this is never null in practice
   *  (the null branch survives as a render-path safety only). */
  renderConfig?: ObjectRenderConfig | null;
  /** Raw render_config fingerprint (JSON of the row's jsonb, Rock B): lets
   *  the realtime UPDATE handler keep the existing parsed `renderConfig`
   *  REFERENCE when the config didn't actually change — a remote drag is a
   *  position-only update, and re-parsing would hand DeskObjectArt a fresh
   *  object that busts its memo and re-runs the whole rough.js pipeline for
   *  a 2px move. Undefined on optimistic adds (first echo re-parses once). */
  configRaw?: string;
  /** PUBLISH HONESTY (UX-audit fix 3): undefined = saved (or first attempt
   *  in flight — quiet, the common case resolves in well under a second);
   *  'retrying' = a publish attempt failed and a backoff retry is scheduled;
   *  'failed' = all attempts failed — the object stays desk-local, and the
   *  badge says so instead of silently pretending it published. */
  saveState?: 'retrying' | 'failed';
};

/** Sync bridge between an object's stored render config and the NESTED
 *  providers wrapping its art — the same scoping pattern as ObjectSurface's
 *  SandboxRenderScope (nested providers shadow the app-root ones for this
 *  subtree only; the desk around it keeps reading the global context).
 *  One sharpening: children stay unmounted until the nested context HOLDS the
 *  config (useLayoutEffect lands before paint), so SvgStyleTransform's
 *  pipeline never runs at provider-default values — each object pays exactly
 *  ONE pipeline run, with its own config, on mount. */
function ObjectConfigScope({
  config,
  children,
}: {
  config: ObjectRenderConfig;
  children: ReactNode;
}) {
  const styleCtx = useF3SvgStyle();
  const modsCtx = useF3RoughModifiers();
  const { svgStyle, modifiers } = config;
  useLayoutEffect(() => {
    if (styleCtx.state !== svgStyle) styleCtx.setState(svgStyle);
  }, [styleCtx, svgStyle]);
  useLayoutEffect(() => {
    if (modsCtx.state !== modifiers) modsCtx.replace(modifiers);
  }, [modsCtx, modifiers]);
  // `modifiers` is referentially stable per object (parsed once at row→object
  // mapping), so replace() settles in one pass and this stays true after it.
  const synced = styleCtx.state === svgStyle && modsCtx.state === modifiers;
  return synced ? <>{children}</> : null;
}

/** One desk object's ART — the expensive SvgStyleTransform subtree, memoized
 *  on exactly (svgMarkup, renderConfig, deskLens). Position/rotation live on
 *  the wrapper OUTSIDE this memo, so drag never re-runs the rough.js
 *  pipeline — not even for the dragged object itself.
 *
 *  TWO render slots (R6 remount-determinism redesign, 2026-06-11):
 *  - The RECORD render is the object's own look. With a config: nested
 *    providers pin it to ITS OWN record (the global context never reaches
 *    that subtree — panel tweaks skip it). Without one (legacy row): it
 *    renders straight off the global context (follows the live pen, the
 *    pre-D-7 fallback). The record element is useMemo'd on
 *    (svgMarkup, renderConfig) ONLY, so lens flips never re-render it —
 *    its DOM is RETAINED (visibility-hidden) under the lens and re-shown
 *    untouched on flip-back.
 *  - The LENS render mounts only while the Desk scope is on, straight off
 *    the global context (context updates pierce React.memo by design, so
 *    the sweep restyles live), and unmounts when the lens lifts.
 *
 *  WHY retained-DOM instead of re-rendering on flip-back: the
 *  OBJECT_SIT_SHADOW (CSS drop-shadow) does not rasterize reproducibly over
 *  REGENERATED or re-shown-after-repaint nodes — its fractional offsets snap
 *  to one of two subpixel states depending on paint timing, which left the
 *  ink's edge pixels sub-perceptually jittered across flips (isolated by
 *  A/B-removing the filter → byte-identical). The fix is to never rebuild
 *  the record's raster at all: keep its DOM, keep its filter on a promoted
 *  layer, and hide it with a compositor-only opacity flip. That implements
 *  "lift the lens" literally (D-7 amendment 2: records untouched, every
 *  object RETURNS to its own look — here, the very same pixels). Opacity
 *  hiding also keeps layout alive, so a hidden legacy record re-rendering
 *  under a pen tweak still measures real getBBox values. */
// FLIP-ALL via ONE shared canvas (DeskObjectArt → LiveObject3DSlot →
// Shared3DOverlay): all desk objects flip to 3D through a SINGLE WebGL context
// (drei <View> scissoring), so there's no per-object-canvas context limit and
// no cap. We still STREAM by viewport+margin (threeDIds below) so far objects
// don't build geometry — Sebs's N64 load-near/unload-far, seamless, no lag.
/** Canonical add-boundary footprint (matches resetCamera's FOOTPRINT). */
const FOOTPRINT_3D = 180;

const DeskObjectArt = memo(function DeskObjectArt({
  svgMarkup,
  renderConfig,
  deskLens,
  render3d,
  rotatable,
  orbitable,
  tumbleRef,
  inView,
}: {
  svgMarkup: string;
  renderConfig: ObjectRenderConfig | null;
  deskLens: boolean;
  /** Camera-math viewport test (tighter than the cull margin) — gates the heavy
   *  svg-port carve BUILD to on-screen objects so a whole-desk restyle doesn't
   *  rebuild every object at once (Sebs 2026-06-20 "get rid of lag"). */
  inView: boolean;
  /** Global desk flip ON — render this object's 3D form when it has flippable
   *  strokes (uploads/legacy stay 2D). The mount is the SAME Stroke3DScene the
   *  /canvas + edit modal use, sourced from this object's render_config. */
  render3d: boolean;
  /** Drag-rotate this object in place. TRUE only under the global desk-3D flip
   *  (the whole desk is in 3D → spin objects, Sebs 2026-06-16 "i can't rotate the
   *  object when i do global flip to 3d"). FALSE for a per-object force3d
   *  thumbnail on a 2D-lens desk — there it's a static thumbnail that opens its
   *  card on click / moves on drag. */
  rotatable: boolean;
  /** 3D slot orbit-enabled. Now ALWAYS false on the desk — rotation moved off the
   *  body (which drags to MOVE/fling) onto an explicit rotate HANDLE (tumbleRef).
   *  Kept as a prop so the slot stays non-interactive (renders, no orbit capture). */
  orbitable: boolean;
  /** Per-object rotate-HANDLE orientation. The wrapper's handle mutates this ref;
   *  the 3D slot reads it each frame (no React re-render on drag). */
  tumbleRef?: MutableRefObject<TumbleState> | null;
}) {
  // Flippable strokes: the recorded ones if present, else DERIVED from the SVG
  // so EVERY doodle flips to 3D, not just pen-drawn ones (Sebs 2026-06-14: "some
  // objects just don't turn 3D" — those had no recorded strokes). null = truly
  // nothing to lift (empty/broken markup) → honest 2D.
  const strokes3d = useMemo(() => {
    // Computed REGARDLESS of render3d now (warm rebuild, Sebs 2026-06-18): the 3D
    // slot stays mounted in 2D too so the geometry builds ONCE and the flip is an
    // instant show/hide, not a mount+build flash.
    const raw = renderConfig?.strokes as unknown;
    if (Array.isArray(raw) && raw.length > 0) return raw as [number, number, number][][];
    // An UPLOADED image (render_config.sourceImage) never derives native 3D
    // strokes — a traced photo outline rebuilds rough, so an upload is 3D ONLY
    // via its AI mesh (hardMeshUrl, handled below). Drawn doodles with no recorded
    // strokes still derive from the SVG (Sebs 2026-06-16: "an upload should not go
    // 3d" without a mesh).
    const isUpload = typeof (renderConfig as Record<string, unknown> | null)?.sourceImage === 'string';
    if (isUpload) return null;
    const derived = svgMarkupToStrokes(svgMarkup);
    return derived.length > 0 ? (derived as [number, number, number][][]) : null;
  }, [renderConfig, svgMarkup]);

  // A placed AI-mesh object persists its GLB in render_config.hardMeshUrl — in 3D
  // it shows the MESH (not the local form), so Done no longer "reverts to the SVG"
  // for the 3D view (Sebs 2026-06-16). 2D view stays the saved SVG (you can't go
  // mesh→SVG). The global 3D style is moot here — the mesh overrides the local form.
  const hardMeshUrl = useMemo(() => {
    const v = (renderConfig as Record<string, unknown> | null)?.hardMeshUrl;
    return typeof v === 'string' ? v : undefined;
  }, [renderConfig]);

  // Per-object saved AI-mesh look (Material/Darkness/Auto-spin) → the placed mesh
  // shows the look the maker saved, not the shared 3D context's (Sebs 2026-06-16:
  // "3d edits don't save or show on the desk").
  const aiMeshLook = useMemo(() => {
    const v = (renderConfig as Record<string, unknown> | null)?.aiMesh;
    return v && typeof v === 'object'
      ? (v as { materialMode?: 'greyscale' | 'og-pbr' | 'hatch' | 'native' | 'svg-port'; dark?: number; contrast?: number; autoSpin?: boolean })
      : undefined;
  }, [renderConfig]);

  // Per-object SAVED local-3D look (render_config.geometry3d) → the object renders
  // with the geometry/material the maker saved instead of the shared desk context
  // (Sebs 2026-06-16: "3d edits don't appear for normal 3d objects").
  const geometry3d = useMemo(() => {
    const v = (renderConfig as Record<string, unknown> | null)?.geometry3d;
    return v && typeof v === 'object' ? (v as Geometry3DConfig) : undefined;
  }, [renderConfig]);

  // DESK-mode svg-port re-styling on the global toggle SWEEP — perf-safe (Sebs
  // 2026-06-20: "fix it real, no fake fix"). The naive version serialized the
  // styled markup on EVERY frame ×N objects = bad lag. The fix: key the swept
  // overlay (which is BOTH the visible 2D sweep AND the svg-port source) by the
  // style VALUE (stringified — immune to the context's per-render reference churn),
  // so it re-renders (→ re-styles + re-captures via onRender) ONLY when the style
  // actually changes, never per-frame.
  const [svgPortStyled, setSvgPortStyled] = useState<string | null>(null);
  const setSvgPortStyledDedup = useCallback(
    (s: string | null) => setSvgPortStyled((prev) => (prev === s ? prev : s)),
    [],
  );
  const sweptStyle = useF3SvgStyle().state;
  const sweptMods = useF3RoughModifiers().state;
  const styleKey = JSON.stringify(sweptStyle) + '|' + JSON.stringify(sweptMods);
  // svg-port BUILD controls (Sebs 2026-06-20 — kill the desk-restyle lag + make
  // styles read distinct in 3D). inView gates the heavy carve build to on-screen
  // objects (20 builds → ~the few visible); longEdge 512 sizes the thumbnail
  // texture small (a ~180px well needs nowhere near 1024·dpr — 4–16× less pixel
  // work per build, the dominant cost); styleId routes the active swept style to
  // its per-style carve PROFILE so clean/rough/bold-ink/stipple carve distinct
  // surfaces. Stable ref (only changes when a value changes) so the memoized 3D
  // slot doesn't churn. styleId only under the desk lens (the global sweep);
  // per-object force3d thumbnails fall to the default profile.
  const svgPortBuild = useMemo(
    () => ({ inView, longEdge: 512, styleId: deskLens ? sweptStyle : undefined }),
    [inView, deskLens, sweptStyle],
  );
  const svgMarkupChild = useMemo(() => <div dangerouslySetInnerHTML={{ __html: svgMarkup }} />, [svgMarkup]);
  const sweptOverlay = useMemo(
    () => (
      <div style={{ position: 'absolute', left: 0, top: 0, filter: OBJECT_SIT_SHADOW }}>
        {/* swept 2D display AND the svg-port source (onRender). Memoized on the
            style VALUE → fires once per style change, not per frame. */}
        <SvgStyleTransform onRender={setSvgPortStyledDedup}>{svgMarkupChild}</SvgStyleTransform>
      </div>
    ),
    [styleKey, svgMarkupChild, setSvgPortStyledDedup],
  );
  const record = useMemo(() => {
    const art = (
      <SvgStyleTransform>
        <div dangerouslySetInnerHTML={{ __html: svgMarkup }} />
      </SvgStyleTransform>
    );
    if (!renderConfig) return art;
    return (
      <F3SvgStyleProvider>
        <F3RoughModifiersProvider>
          <ObjectConfigScope config={renderConfig}>{art}</ObjectConfigScope>
        </F3RoughModifiersProvider>
      </F3SvgStyleProvider>
    );
  }, [svgMarkup, renderConfig]);

  // 3D view (global desk flip) — the object lifts into its form in the same
  // ~180px footprint. Only when it has flippable strokes; otherwise it stays 2D
  // below (honest — uploads/legacy can't lift). Computed after all hooks so the
  // hook order never changes between 2D and 3D renders.
  if (strokes3d || hardMeshUrl) {
    // WARM REBUILD (Sebs 2026-06-18): a flippable object renders its 2D art AND
    // its 3D slot BOTH always-mounted, toggling VISIBILITY by render3d. The 3D
    // geometry builds ONCE (not on every flip), so the flip is an instant
    // show/hide — no cold-mount, no build, no blank flash. Off-screen perf is
    // bounded by the wrapper's display:none viewport cull.
    return (
      <div style={{ width: 180, height: 180, position: 'relative' }}>
        {/* 2D layer — the SAME record + desk-lens overlay as the 2D-only branch,
            KEPT MOUNTED (no rough.js re-process) and faded out when in 3D. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: render3d ? 0 : 1,
            transition: 'opacity 200ms ease',
            pointerEvents: render3d ? 'none' : undefined,
          }}
        >
          <div style={{ filter: OBJECT_SIT_SHADOW, willChange: 'filter, opacity', opacity: deskLens ? 0 : 1 }}>
            {record}
          </div>
          {deskLens && sweptOverlay}
        </div>
        {/* 3D slot — ALWAYS mounted (warm geometry); display:none in 2D so drei
            <View> doesn't paint it (no GPU) but the built geometry stays in
            memory → flipping to 3D is instant. The ONE shared canvas
            (Shared3DOverlay) keeps N slots at a single WebGL context.
            interactive={rotatable}: under the global flip a drag ROTATES in place
            (tap still opens the card via the wrapper's capture handler). */}
        <div style={{ position: 'absolute', inset: 0, display: render3d ? 'block' : 'none', zIndex: 1 }}>
          <LiveObject3DSlot strokes={strokes3d ?? []} svgPortMarkup={deskLens ? (svgPortStyled ?? svgMarkup) : svgMarkup} svgPortBuild={svgPortBuild} hardMeshUrl={hardMeshUrl} aiMeshLook={aiMeshLook} config={geometry3d} interactive={orbitable} tumbleRef={tumbleRef} />
        </div>
      </div>
    );
  }

  // Slot mechanics: the record box carries the sit-shadow filter on its OWN
  // permanently-promoted layer (willChange) and is hidden under the lens via
  // `opacity: 0` — an opacity flip on a composited layer is COMPOSITOR-ONLY,
  // so the record's raster (ink + shadow) is never rebuilt and flip-back
  // re-shows the exact same pixels. visibility/display hiding re-rasterized
  // on re-show and re-rolled the drop-shadow snap (measured). The lens is a
  // separate transient overlay with its own shadow, outside that layer, so
  // its mount/unmount can't disturb the record layer's bounds. Opacity is
  // set explicitly both ways so React can't leave a stale style residue.
  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          filter: OBJECT_SIT_SHADOW,
          willChange: 'filter, opacity',
          opacity: deskLens ? 0 : 1,
        }}
      >
        {record}
      </div>
      {deskLens && (
        <div style={{ position: 'absolute', left: 0, top: 0, filter: OBJECT_SIT_SHADOW }}>
          <SvgStyleTransform>
            <div dangerouslySetInnerHTML={{ __html: svgMarkup }} />
          </SvgStyleTransform>
        </div>
      )}
    </div>
  );
});

// ─── THE LIVE PREVIEW SQUIGGLE (D-7 amendment — REQUIRED with the gate) ─────
// In Pen mode the desk deliberately doesn't react to the panel, so without
// feedback the controls would FEEL broken. This sample stroke at the top of
// the panel renders through the CURRENT pen settings and re-renders the
// instant any control changes — direct manipulation, no tween (Procreate
// Brush Studio pattern: the brush panel never repaints the canvas; the
// preview stroke gives the hand immediate feedback). The markup is the exact
// commit-layer form a Done produces (fill="none" + primary-ink stroke, same
// width), so the preview IS what the next doodle will look like. Fixed path —
// fully deterministic, no randomness.
const PREVIEW_SQUIGGLE = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60" viewBox="0 0 264 72"><path d="M 14 46 C 30 14 52 12 66 34 C 80 56 100 58 116 38 C 132 18 150 16 162 34 C 170 46 164 60 152 58 C 140 56 142 40 156 30 C 178 14 206 18 222 36 C 232 47 242 50 252 44" fill="none" stroke="var(--dir-text-primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** memo with only the `deskLens` label prop: parent re-renders (drag moves,
 *  camera pans) skip it entirely; panel changes reach SvgStyleTransform's own
 *  context subscription directly, so the squiggle still updates instantly. */
const PenPreview = memo(function PenPreview({ deskLens, view3d }: { deskLens: boolean; view3d: boolean }) {
  // In 3D view the preview shows the sample stroke LIFTED into 3D, styled live by
  // the panel's Canvas3DChrome — so you tune your next doodle's 3D the same way
  // the 2D preview tunes its ink (Sebs 2026-06-14). Strokes derived from the
  // same squiggle markup; transparent so it sits on the panel.
  const previewStrokes = useMemo(
    () => (view3d ? svgMarkupToStrokes(PREVIEW_SQUIGGLE) : null),
    [view3d],
  );
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        background: 'var(--dir-raised)',
        padding: '14px 20px 12px',
        borderBottom: '1px solid var(--dir-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={SECTION_LABEL}>Preview</span>
        <span
          style={{
            fontFamily: IS,
            fontSize: 10,
            fontStyle: 'italic',
            color: 'var(--dir-text-body-soft)',
          }}
        >
          {view3d ? (deskLens ? 'the whole desk · 3D' : 'your next doodle · 3D') : deskLens ? 'the whole desk follows' : 'your next doodle'}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        {view3d && previewStrokes && previewStrokes.length > 0 ? (
          <div style={{ width: 220, height: 96 }}>
            <Live3DMount strokes={previewStrokes} transparent showChips={false} />
          </div>
        ) : (
          <SvgStyleTransform>
            <div dangerouslySetInnerHTML={{ __html: PREVIEW_SQUIGGLE }} />
          </SvgStyleTransform>
        )}
      </div>
    </div>
  );
});

/** One desk object = cheap positioned wrapper (drag updates ONLY this div's
 *  style) + the memoized art. React.memo here keeps the other N−1 objects
 *  from re-rendering at all while one is dragged: setObjects preserves the
 *  references of untouched objects, and every callback prop is stable. */
const DeskObjectView = memo(function DeskObjectView({
  obj,
  hidden,
  inView,
  dragging,
  nudged,
  landing,
  deskLens,
  render3d,
  rotatable,
  onPointerDown,
  onNudgeEnd,
  onLandEnd,
  settling,
  onSettleEnd,
  nodeRef,
}: {
  obj: DeskObject;
  /** Zoom-aware viewport cull: when off-screen this wrapper gets display:none —
   *  not painted (cheap), but stays in the DOM/React state. Replaces
   *  content-visibility, which mis-culled under the parent scale() transform
   *  (the "objects disappear while still in view near the edge" bug). The map
   *  computes this from camera + viewport; never set for the dragged object. */
  hidden: boolean;
  /** Tighter on-screen test (camera math) than `hidden`'s cull margin — gates
   *  the svg-port carve BUILD so a desk-wide restyle rebuilds only visible
   *  objects (perf, Sebs 2026-06-20). Distinct from `hidden`: an object can be
   *  un-hidden (warm, in the cull ring) but not inView (don't spend the build). */
  inView: boolean;
  dragging: boolean;
  /** Foreign-drag feedback — plays the nudge-and-settle keyframe. */
  nudged: boolean;
  /** Fresh arrival — plays the ratified doodle-lands spring (scale-in
   *  0.92→1 slight overshoot + sit-shadow fade; 25-research motion table).
   *  Done-mints and drag-to-place drops share this ONE moment — no third
   *  motion family. Interruptible: pointer events stay live throughout. */
  landing: boolean;
  deskLens: boolean;
  /** Global desk flip ON — this object renders 3D if it has flippable strokes. */
  render3d: boolean;
  /** TRUE under the global desk-3D flip → the 3D slot rotates on drag (a tap
   *  still opens the card). FALSE for a per-object force3d thumbnail. */
  rotatable: boolean;
  onPointerDown: (e: React.PointerEvent, obj: DeskObject) => void;
  onNudgeEnd: () => void;
  onLandEnd: (id: string) => void;
  /** Anti-pile drop resolved to a different (clear) spot → SLIDE there instead
   *  of teleporting. Utilitarian motion (motion rule, [[reference_vocab_motion]]):
   *  a fast ~200ms ease-out, NO decorative glow — frequent/quick actions stay
   *  light so the interface never feels sludgy. */
  settling: boolean;
  onSettleEnd: (id: string) => void;
  /** Physics: register this wrapper's positioned node so the desk sim can write
   *  left/top/rotate straight onto it each frame (null on unmount). */
  nodeRef?: (el: HTMLDivElement | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  // ROTATE/MOVE SPLIT (Sebs 2026-06-27, the redesign): the body NEVER orbits now —
  // dragging the object body MOVES it (or FLINGS it when physics is on), exactly
  // like a 2D object, and a tap opens its card. Rotation lives on an explicit, clean
  // rotate HANDLE (below) that the user grabs to tumble the 3D form. So MOVE and
  // ROTATE are both always available, with no mode switch and no shared-drag
  // conflict ("WE DO NOT REMOVE A FUNCTION… without that ugly grip icon"). The slot
  // is non-interactive (renders the form, captures no pointer) so body events fall
  // through to the wrapper's MOVE handler.
  const orbitable = false;

  // Per-object rotate-HANDLE orientation, read imperatively by the 3D slot each
  // frame (useFrame) — so dragging the handle spins the form WITHOUT re-rendering
  // this (heavy) object subtree, the same imperative model OrbitControls used.
  const tumbleRef = useRef<TumbleState>({ az: 0, el: 0 });
  const [rotating, setRotating] = useState(false);
  const rotateStart = useRef<{ x: number; y: number; az: number; el: number } | null>(null);
  // Handle drag: horizontal → azimuth (turntable spin around Y), vertical →
  // elevation (tilt around X). Tuned so dragging ~the object's width ≈ a half-turn.
  const AZ_PER_PX = 0.014;
  const EL_PER_PX = 0.011;
  const onRotateDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    rotateStart.current = { x: e.clientX, y: e.clientY, az: tumbleRef.current.az, el: tumbleRef.current.el };
    setRotating(true);
  };
  const onRotateMove = (e: React.PointerEvent) => {
    const s = rotateStart.current;
    if (!s) return;
    tumbleRef.current = {
      az: s.az + (e.clientX - s.x) * AZ_PER_PX,
      el: s.el + (e.clientY - s.y) * EL_PER_PX,
    };
  };
  const onRotateUp = (e: React.PointerEvent) => {
    if (!rotateStart.current) return;
    rotateStart.current = null;
    setRotating(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  // HOVER-reveal on ANY 3D object (clean by default). Rotation is a view-only
  // inspect (the tumble is session-local, never persisted), so spinning a
  // stranger's doodle is harmless — and KEEPING it preserves the old "every 3D
  // object is rotatable" function (only MOVE is own-only, enforced in
  // handlePointerDown's foreign block). Stays mounted WHILE rotating so a drag
  // that wanders off the object doesn't unmount mid-gesture and drop the capture.
  const showRotateHandle = rotatable && (hovered || rotating);
  return (
    <div
      ref={nodeRef}
      data-desk-obj-id={obj.id}
      onPointerEnter={rotatable ? () => setHovered(true) : undefined}
      onPointerLeave={rotatable ? () => setHovered(false) : undefined}
      // ONE pointer model now (2D and 3D alike): the body handler MOVES on a drag
      // (flings under physics) and OPENS the card on a tap — handlePointerDown /
      // handlePointerUp own the tap-vs-drag split and the foreign-drag block. 3D
      // rotation is no longer a body gesture; it lives on the rotate HANDLE below,
      // so there's no slot-eats-the-pointerdown problem and no capture-phase tap
      // shim. handlePointerDown stopPropagations internally (never reaches desk-pan).
      onPointerDown={(e) => onPointerDown(e, obj)}
      // Route by animationName — nudge and land (and their reduced-motion
      // twins) both fire animationend, and each clears only its own state.
      onAnimationEnd={
        nudged || landing
          ? (e) => {
              if (e.animationName.startsWith('dd-land')) onLandEnd(obj.id);
              else if (nudged) onNudgeEnd();
            }
          : undefined
      }
      // Settle slide finished → clear (left/top each fire; clear on first).
      onTransitionEnd={
        settling
          ? (e) => {
              if (e.propertyName === 'left' || e.propertyName === 'top') onSettleEnd(obj.id);
            }
          : undefined
      }
      // Both moments ride CLASSES (not inline animations) so the page's
      // prefers-reduced-motion media query can swap the keyframes — inline
      // styles can't be overridden by a media query (R5). All keyframes fire
      // animationend, so the states always clear. (An object can't be nudged
      // and landing at once — nudge is foreign-only, landing is own-only.)
      className={
        [nudged ? 'dd-nudge' : '', landing ? 'dd-land' : ''].filter(Boolean).join(' ') ||
        undefined
      }
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        transform: `rotate(${obj.rotation}deg)`,
        // ANTI-PILE SETTLE: a fast, clean slide to the clear spot ONLY while
        // settling; none otherwise so a live drag follows the cursor instantly.
        // ~200ms ease-out, no overshoot/glow (motion rule — a utilitarian,
        // frequent move stays light; decoration here would add friction).
        transition: settling ? 'left 0.2s ease-out, top 0.2s ease-out' : undefined,
        // The OBJECT_SIT_SHADOW filter lives INSIDE DeskObjectArt (per render
        // slot, on a promoted layer) — see the R6 note there for why the
        // wrapper itself must stay filter-free.
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
        // PERF (Sebs 2026-06-18 lag pass): EXPLICIT zoom-aware viewport cull.
        // Off-screen objects get display:none — not painted (cheap on load+pan
        // with N heavy SVGs), but kept in the DOM/state. Replaces
        // content-visibility:auto, whose on-screen heuristic + implied paint-clip
        // MIS-CULLED under the parent scale() transform (objects vanished while
        // still in view near the edge — confirmed Chrome behaviour + the user's
        // report). The visibility is computed in the map from camera + viewport
        // with a generous proportional margin, so it's correct at every zoom.
        display: hidden ? 'none' : undefined,
      }}
    >
      {/* Markup already normalized to ~180px at the add boundary. */}
      <DeskObjectArt
        svgMarkup={obj.svgMarkup}
        renderConfig={obj.renderConfig ?? null}
        deskLens={deskLens}
        render3d={render3d}
        rotatable={rotatable}
        orbitable={orbitable}
        tumbleRef={tumbleRef}
        inView={inView}
      />
      {/* ROTATE HANDLE — hover-reveal on your own 3D object, top-right corner. Drag
          to TUMBLE the 3D form (mutates tumbleRef → the slot follows each frame).
          The object body drags to MOVE/fling; this is the only extra affordance and
          it's a clean rotate glyph, not the old braille grip (Sebs 2026-06-27:
          "rotate the object without that ugly grip icon while getting everything
          else to work"). stopPropagation so its drag never reaches the move/pan. */}
      {showRotateHandle && (
        <div
          role="button"
          aria-label="Drag to rotate this doodle in 3D"
          title="Drag to rotate"
          onPointerDown={onRotateDown}
          onPointerMove={onRotateMove}
          onPointerUp={onRotateUp}
          onPointerCancel={onRotateUp}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 4,
            width: 28,
            height: 28,
            borderRadius: 999,
            background: rotating
              ? 'color-mix(in srgb, var(--dir-raised) 96%, var(--dir-text-primary) 6%)'
              : 'color-mix(in srgb, var(--dir-raised) 88%, transparent)',
            border: '1px solid var(--dir-border)',
            backdropFilter: 'blur(3px)',
            boxShadow: rotating
              ? '0 0 0 3px color-mix(in srgb, var(--dir-text-primary) 12%, transparent), 0 2px 6px rgba(0,0,0,0.16)'
              : '0 1px 4px rgba(0,0,0,0.12)',
            color: 'var(--dir-text-body)',
            cursor: rotating ? 'grabbing' : 'grab',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            touchAction: 'none',
            transition: 'box-shadow 120ms ease, background 120ms ease',
          }}
        >
          {/* Circular rotate arrow — the universal rotate glyph. */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v5h-5" />
          </svg>
        </div>
      )}
      {/* PUBLISH HONESTY badge (UX-audit fix 3) — quiet, under the object,
          only while a publish is retrying or has permanently failed. Faint
          paper backing so it reads over the grain; pointer-transparent so
          drag/click behave exactly as without it. */}
      {obj.saveState && (
        <span
          role="status"
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: 4,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            fontFamily: IS,
            fontSize: 9,
            fontStyle: 'italic',
            letterSpacing: '0.02em',
            color: 'var(--dir-text-body-soft)',
            background: 'color-mix(in srgb, var(--dir-bg) 82%, transparent)',
            borderRadius: 999,
            padding: '2px 8px',
          }}
        >
          {obj.saveState === 'retrying'
            ? 'not saved — retrying'
            : 'couldn’t save — kept on your desk'}
        </span>
      )}
    </div>
  );
});

// ─── DESK SURFACE CRAFT ─────────────────────────────────────────────────────
// The desk should feel like a warm paper surface objects SIT on, not a flat div
// they float over (design doc §"The desk as a crafted surface"). The shared
// warm-paper material — PAPER_GRAIN (whisper of grain, NEVER wood/cork) +
// WARM_POOL (soft lamp pool) + OBJECT_SIT_SHADOW (lifted-not-floating shadow) —
// lives in lib/deskCraft so the desk and the ObjectCard read as the SAME stock.
// The desk adds one desk-only layer on top: an edge vignette + inset boxShadow
// for surface depth (a card has no edge vignette).

// ─── DESK CAMERA (pan/zoom) ─────────────────────────────────────────────────
// The camera is a pure VIEW transform: screen = desk·zoom + pan. Doodle
// positions are stored in DESK coordinates (x/y on the doodles table) and are
// NEVER rewritten because of camera state. The transform is applied to ONE
// desk-surface div that carries the warm-paper material (grain + pool +
// vignette) AND the objects, so zooming reads as leaning into a real desk —
// the grain magnifies with the doodles. Limits 25%–400% per Sebs's locked
// decision (desk metaphor, not Figma's 2%–25,600%).
type DeskCamera = { zoom: number; panX: number; panY: number };

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const CAMERA_HOME: DeskCamera = { zoom: 1, panX: 0, panY: 0 };
/** Per-click zoom step for the header − / + pills. */
const ZOOM_STEP = 1.25;

/** Zoom the camera by `factor`, keeping the desk point under the screen-space
 *  anchor (sx, sy — relative to the desk viewport) stationary:
 *  desk = (screen − pan) / zoom must be equal before and after, so
 *  pan' = screen − (screen − pan) · (zoom'/zoom). */
function zoomCameraAt(c: DeskCamera, sx: number, sy: number, factor: number): DeskCamera {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.zoom * factor));
  if (zoom === c.zoom) return c;
  const k = zoom / c.zoom;
  return { zoom, panX: sx - (sx - c.panX) * k, panY: sy - (sy - c.panY) * k };
}

/** The PAPER_GRAIN data-URI tile is 280×280 (deskCraft.ts svg width/height) —
 *  the viewport-fixed grain layer needs the natural tile size to scale its
 *  background-size by zoom so the tooth magnifies exactly like it did when it
 *  rode the camera transform. */
const GRAIN_TILE = 280;

/** Reachable empty-paper buffer (WORLD px) around the content — lets the desk
 *  wander onto blank paper while keeping every object pannable-back at any zoom. */
const PAN_PAD = 800;
/** Object footprint (normalizeSvgSize at the add boundary) — the per-object span
 *  the content bbox extends past each object's top-left (x,y) origin. */
const OBJ_FOOTPRINT = 180;

/** World bbox of the placed objects, or null when empty. Used by leashCamera so
 *  the pan clamp is tied to the CONTENT, not the viewport. */
function objectsBounds(
  objs: readonly { x: number; y: number }[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of objs) {
    if (o.x < minX) minX = o.x;
    if (o.y < minY) minY = o.y;
    if (o.x + OBJ_FOOTPRINT > maxX) maxX = o.x + OBJ_FOOTPRINT;
    if (o.y + OBJ_FOOTPRINT > maxY) maxY = o.y + OBJ_FOOTPRINT;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Clamp pan so the CONTENT (padded by PAN_PAD world px) stays reachable at
 *  EVERY zoom — d3-zoom's constrain/translateExtent math (world↔screen:
 *  screen = world·zoom + pan). FIX (2026-06-18): the old leash clamped to a
 *  vw×vh viewport box whose DESK-space extent shrank as 1/zoom, so objects you
 *  saw zoomed out became unreachable zoomed in. Now the reachable region is the
 *  objects' world bbox + a constant world pad → reachable area stays put across
 *  zoom. Centers an axis whose padded content is narrower than the viewport;
 *  otherwise pins the content edges inside the viewport. Pure; runs in setCamera. */
function leashCamera(
  c: DeskCamera,
  vw: number,
  vh: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
): DeskCamera {
  const z = Math.max(c.zoom, 0.01);
  const cx0 = (bounds ? bounds.minX : 0) - PAN_PAD;
  const cy0 = (bounds ? bounds.minY : 0) - PAN_PAD;
  const cx1 = (bounds ? bounds.maxX : vw / z) + PAN_PAD;
  const cy1 = (bounds ? bounds.maxY : vh / z) + PAN_PAD;
  const clampAxis = (pan: number, vp: number, a0: number, a1: number) =>
    (a1 - a0) * c.zoom <= vp
      ? (vp - (a0 + a1) * c.zoom) / 2 // padded content fits → center it
      : Math.min(-a0 * c.zoom, Math.max(vp - a1 * c.zoom, pan)); // pin edges in view
  const panX = clampAxis(c.panX, vw, cx0, cx1);
  const panY = clampAxis(c.panY, vh, cy0, cy1);
  if (panX === c.panX && panY === c.panY) return c;
  return { ...c, panX, panY };
}

/** Deterministic 32-bit FNV-1a hash of an object id — seeds the scatter
 *  offset + rotation so a given id always lands the same way (no unseeded
 *  randomness in the add path). */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** ANTI-PILE placement (Sebs 2026-06-14: "I don't want objects piling on top of
 *  each other"; "can't be placed on top — if they move over objects while still
 *  moving that's okay"). Returns the nearest CLEAR (non-overlapping) spot for a
 *  ~180px object, spiralling OUT from the anchor (ax, ay) in DESK coords. The
 *  FIRST fully-clear spot is the closest-to-anchor clear spot (so a dropped
 *  doodle settles to open paper nearest where you let go; a new doodle to open
 *  paper nearest the view center) — neighbours never move (predictable, no
 *  cascade; the research's "snap the moved object" family over "push-apart").
 *  `excludeId` skips the object being moved. Deterministic (seed = its hash).
 *  Truly-packed desk → the least-covered spot found (graceful, still spread). */
const PLACE_FOOT = 190; // ~180px object + breathing room
function findClearSpot(
  ax: number,
  ay: number,
  objects: ReadonlyArray<{ id: string; x: number; y: number }>,
  excludeId: string | null,
  seed: number,
): { x: number; y: number } {
  const score = (px: number, py: number): number => {
    let s = 0;
    for (const o of objects) {
      if (o.id === excludeId) continue;
      if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) continue;
      const ix = Math.max(0, PLACE_FOOT - Math.abs(px - o.x));
      const iy = Math.max(0, PLACE_FOOT - Math.abs(py - o.y));
      s += ix * iy;
    }
    return s;
  };
  let best = score(ax, ay);
  if (best === 0) return { x: ax, y: ay };
  let bx = ax, by = ay;
  const STEP = PLACE_FOOT * 0.7; // ~133px between rings
  for (let ring = 1; ring <= 14; ring++) {
    const r = ring * STEP;
    const samples = 6 + ring * 2; // denser as the ring widens
    for (let k = 0; k < samples; k++) {
      const ang = (((seed % samples) + k) / samples) * Math.PI * 2 + ring * 0.5;
      const px = ax + Math.cos(ang) * r;
      const py = ay + Math.sin(ang) * r * 0.8; // desks read wider than tall
      const s = score(px, py);
      if (s === 0) return { x: px, y: py }; // closest clear spot — done
      if (s < best) { best = s; bx = px; by = py; }
    }
  }
  return { x: bx, y: by };
}

/** Map a loaded/realtime DoodleRow → a desk object, sanitizing the SVG on read
 *  (RLS can't parse SVG, so this is the enforceable XSS layer for the shared
 *  feed — applies to both the initial load and the realtime insert paths). */
function rowToObject(r: DoodleRow): DeskObject {
  return {
    id: `row-${r.id}`,
    dbId: r.id,
    svgMarkup: sanitizeSvgMarkup(r.svg),
    x: r.x,
    y: r.y,
    rotation: r.rotation,
    name: r.name ?? null,
    why: r.why ?? null,
    ownerSession: r.session_id ?? null,
    createdAt: r.created_at ?? null,
    // The pen snapshot (D-6) — parsed ONCE here so the object's config is
    // referentially stable for the memoized render path. Pre-config legacy
    // rows pin to the frozen DEFAULT snapshot (UX-audit fix 1) so the Pen
    // scope touches nothing placed; the Desk lens still sweeps them.
    renderConfig: parseRenderConfig(r.render_config) ?? LEGACY_FREEZE_CONFIG,
    // Fingerprint for the realtime UPDATE handler's no-change fast path.
    configRaw: JSON.stringify(r.render_config ?? null),
  };
}

/** Read the optional ?desk=… target from the URL. May be a numeric desk index
 *  (e.g. ?desk=3) or a desk uuid. Returns null when absent. */
function readDeskParam(): { index: number | null; id: string | null } | null {
  try {
    const raw = new URL(window.location.href).searchParams.get('desk');
    if (!raw) return null;
    const n = Number(raw);
    if (Number.isInteger(n) && String(n) === raw.trim()) {
      return { index: n, id: null };
    }
    return { index: null, id: raw };
  } catch {
    return null;
  }
}

export function DeskPage() {
  // (Removed the smartHachure param-set + window.location.reload effect — the
  // engine defaults ON now (SvgStyleTransform), so it was dead weight AND it
  // caused a white reload-flash on every /desk visit where the desk briefly
  // emptied before objects reloaded. That flash read as "all objects
  // disappeared". Smart Hachure is on by default; ?smartHachure=0 opts out.)

  // The ?desk= target (numeric index or uuid). Read via react-router so a
  // gallery click that navigates to /desk?desk=N while ALREADY on /desk
  // re-resolves the view (the resolve effect keys on this value) — without it,
  // the param was read once on mount only and never switched.
  const [searchParams] = useSearchParams();
  const deskParam = searchParams.get('desk');
  // DEMO WALL (?demo) — the curated no-DB recording wall. When true, the desk is
  // purely session-local: the seed effect fills it, and adds stay LOCAL (never
  // publish to / switch to the real open desk — Sebs 2026-06-15).
  const isDemoWall = searchParams.get('demo') != null;
  // PHYSICS TEST DESK (?test) — also a purely session-LOCAL wall (no DB): adds /
  // place-from-shelf must stay local just like the demo wall, never publish/switch.
  const isTestDesk = searchParams.get('test') != null;
  const navigate = useNavigate();

  const [objects, setObjects] = useState<DeskObject[]>([]);
  // Live mirror for event-time reads (P-1 smart placement scores candidate
  // landing spots against current objects without entering addObject's deps).
  const objectsRef = useRef<DeskObject[]>([]);
  objectsRef.current = objects;
  const [drawOpen, setDrawOpen] = useState(false);
  const [feedStatus, setFeedStatus] = useState<'loading' | 'live' | 'offline'>('loading');
  // Live mirror for the channel watcher below (interval closure reads the
  // CURRENT load state without re-arming on every transition).
  const feedStatusRef = useRef(feedStatus);
  feedStatusRef.current = feedStatus;
  const [rightOpen, toggleRight, setRightOpen] = usePanelOpen('desk.right');
  // THE DRAWER (ratified #26-32) — left panel, "My doodles" passive cross-desk
  // index (DrawerPanel). Defaults CLOSED: it's an index you open, not chrome
  // every fresh session pays 300px for. ⌘\ minimize-all covers both panels.
  const [drawerOpen, toggleDrawer, setDrawerOpen] = usePanelOpen('desk.drawer', false);
  useMinimizeUi([
    { open: rightOpen, setOpen: setRightOpen },
    { open: drawerOpen, setOpen: setDrawerOpen },
  ]);
  // Drawer refresh signal (#29 one-record semantics): bumped when a publish or
  // delete SETTLES so the index refetches and tracks the records — a desk
  // delete disappears from the drawer, a Done / place-copy appears in it.
  const [drawerNonce, setDrawerNonce] = useState(0);
  // A drawer card click opens the FULL detailed view (Edit surface) for that
  // row — including rows living on OTHER desks (they aren't in `objects`, so
  // they get their own surface slot; the one-surface rule still holds because
  // opening this closes activeSurface and vice versa).
  const [drawerRow, setDrawerRow] = useState<DoodleRow | null>(null);
  const bumpDrawer = useCallback(() => setDrawerNonce((n) => n + 1), []);

  // ── DOUBLE-PUBLISH GUARD (UX-audit fix 2) ────────────────────────────────
  // Staged markups whose publish hasn't settled yet. The naming-stage Place
  // double-fire (double-click / Enter+click racing) re-enters addObject with
  // the SAME staged markup before the first publish resolves — re-entries
  // are ignored until that publish settles (success or permanent failure),
  // so one Done mints exactly one object + one row.
  const inFlightPublishRef = useRef<Set<string>>(new Set());
  // DESK-MOVE FIX (2026-06-13): a drag that lands DURING the optimistic-add
  // window (before the publish resolves a dbId) has nowhere to persist yet —
  // queue the resting position by LOCAL id here; the publish .then flushes it
  // once the dbId attaches, so the move is never silently dropped.
  const pendingMoveRef = useRef<Map<string, { x: number; y: number; rotation: number }>>(new Map());
  // PUBLISH RETRY timers (UX-audit fix 3) — per-object so unmount cancels
  // every pending backoff instead of letting a late retry fire into a
  // torn-down page.
  const retryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(
    () => () => {
      retryTimersRef.current.forEach(clearTimeout);
      retryTimersRef.current.clear();
    },
    [],
  );

  // ── THE DOODLE-LANDS MOMENT (ratified, 25-research motion table) ─────────
  // ids currently playing the landing spring. Done-mints, Place-here copies
  // and drag-to-place drops ALL mark their optimistic add here — one shared
  // moment, reused, never a new motion family. Cleared by animationend.
  const [landingIds, setLandingIds] = useState<ReadonlySet<string>>(() => new Set());
  const markLanding = useCallback((id: string) => {
    setLandingIds((prev) => new Set(prev).add(id));
  }, []);
  const clearLanding = useCallback((id: string) => {
    setLandingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // ── ANTI-PILE SETTLE (Sebs 2026-06-14: "when it snaps to an open spot it
  // shouldn't be jarring — keep the user aware"). When a drop resolves to a
  // different (clear) spot, the object SLIDES there (CSS transition on
  // left/top, set in DeskObjectView while settling) + a soft accent glow, so
  // the move reads as intentional, not a teleport. Cleared on transitionend.
  const [settlingIds, setSettlingIds] = useState<ReadonlySet<string>>(() => new Set());
  const markSettling = useCallback((id: string) => {
    setSettlingIds((prev) => new Set(prev).add(id));
  }, []);
  const clearSettling = useCallback((id: string) => {
    setSettlingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // ── HONEST CONNECTIVITY (R3/R4) ──────────────────────────────────────────
  // The ●Live chip must never lie: `feedStatus` tracks the LOAD lifecycle
  // (loading/live/offline-as-in-failed), `linkDown` tracks the LINK (navigator
  // connectivity + supabase realtime channel health). The chip shows
  // "○ Offline" when either says down. `reloadNonce` re-runs the whole
  // mount-resolve (fresh loads + fresh subscriptions — the verified
  // resubscribe path) — bumped on restore events, the auto-retry timer, and
  // the error-state Retry pill.
  const [linkDown, setLinkDown] = useState(false);
  const linkDownRef = useRef(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const retryNow = useCallback(() => setReloadNonce((n) => n + 1), []);
  const setLink = useCallback((down: boolean, reloadOnRecover: boolean) => {
    if (linkDownRef.current === down) return; // transitions only — no churn
    linkDownRef.current = down;
    setLinkDown(down);
    if (!down && reloadOnRecover) setReloadNonce((n) => n + 1);
  }, []);

  // navigator connectivity — the chip flips to ○ Offline the moment the
  // browser knows the link dropped (well under the ~2s budget); coming back
  // online triggers a full reload + resubscribe so the desk catches up on
  // anything missed while down.
  useEffect(() => {
    const goOffline = () => setLink(true, false);
    const goOnline = () => setLink(false, true);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) setLink(true, false);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [setLink]);

  // supabase realtime channel health — a 2s poll of the client's channel
  // states (event-driven UI state, never a render-path read). Only judged in
  // steady state (feed live): during desk switches channels legitimately pass
  // through closed/joining and must not flap the chip. All-channels
  // errored/closed → the socket is gone → ○ Offline; when supabase's own
  // reconnect lands the channels rejoin → chip recovers via a reload (fresh
  // subscription + catch-up, the path the sweep verified).
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // navigator owns this case
      if (feedStatusRef.current !== 'live') return;
      let channels: Array<{ state: string }> = [];
      try {
        channels = supabase.getChannels();
      } catch {
        return;
      }
      if (channels.length === 0) return; // nothing to judge (flat pre-realtime)
      const allDown = channels.every((c) => c.state === 'errored' || c.state === 'closed');
      setLink(allDown, true);
    }, 2000);
    return () => clearInterval(id);
  }, [setLink]);

  // FAILED LOAD ≠ EMPTY (R4): while a load has failed and the browser still
  // believes it's online, retry on a quiet 5s cadence. Navigator-offline skips
  // the timer — the 'online' event owns that resume.
  useEffect(() => {
    if (feedStatus !== 'offline') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const t = setTimeout(retryNow, 5000);
    return () => clearTimeout(t);
  }, [feedStatus, reloadNonce, retryNow]);

  // ── The Pen|Desk gate (D-7 ratified) ─────────────────────────────────────
  // 'pen' (default): the right panel styles the draw popup + the NEXT doodle;
  // placed objects render from their own records. 'desk': the sweep — the
  // panel becomes a viewer-local lens over every object (D-1/D-2: never
  // synced, never written into records; flipping back restores per-object
  // looks). React state only — a reload always lands back on Pen.
  const [panelScope, setPanelScope] = useState<'pen' | 'desk'>('pen');
  const deskLens = panelScope === 'desk';
  // GLOBAL DESK 2D/3D FLIP (Sebs 2026-06-14) — a view toggle that flips EVERY
  // object on the desk to its 3D form at once (objects with flippable strokes;
  // uploads stay 2D). Pure view state: nothing persists, drawing is always 2D.
  const [deskView, setDeskView] = useState<'2d' | '3d'>('2d');

  // The live global panel state — read here ONLY to snapshot it into the
  // object record at the Done boundary (D-6). The desk page subscribing to
  // these contexts is cheap now: per-object memoization keeps panel tweaks
  // from touching config-pinned objects.
  const { state: penStyle } = useF3SvgStyle();
  const { state: penModifiers } = useF3RoughModifiers();

  // ── Multi-desk view state ────────────────────────────────────────────────
  // `desk` is the desk currently being VIEWED (null = flat fallback / pre-v2
  // DB). `openDeskId` is the id of the desk that ACCEPTS new doodles — drawing
  // always routes there even while viewing a closed past desk. `freshNote` is
  // a transient friendly note shown when a fresh desk opens. A ref to the
  // active per-desk subscription's unsubscribe lets us tear it down when the
  // view switches desks.
  const [desk, setDesk] = useState<DeskRow | null>(null);
  const [openDeskId, setOpenDeskId] = useState<string | null>(null);
  const [freshNote, setFreshNote] = useState<string | null>(null);
  const deskSubRef = useRef<(() => void) | null>(null);
  const freshNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic load token — every desk-view load bumps it; a load only applies
  // its results if it's still the latest. Guards against a slow earlier load
  // resolving after a faster later switch (rapid spawn-switches / ?desk nav).
  const loadTokenRef = useRef(0);

  const isViewingOpenDesk = desk == null || desk.id === openDeskId;
  // "Past — full and closed" is ONLY a PUBLIC desk the server has CLOSED
  // (is_open === false) — it filled at the cap and spawned the next one, so it's
  // browse-only. Everything else is addable and must NOT read as past:
  //   • a desk you OWN (owner_id) is YOURS, never "past" — always addable;
  //   • a still-open desk (is_open !== false), including a freshly-spawned one
  //     whose id hasn't caught up to openDeskId, is live, never "past".
  // The old gate equated "not THE open desk" with "closed", so a brand-new EMPTY
  // desk (and every PRIVATE desk, whose id never equals the public openDeskId)
  // wrongly read "past desk — full and closed" at 0/cap (Sebs 2026-06-18).
  const isClosedPastDesk = !!desk && !desk.owner_id && desk.is_open === false;
  // Adding is blocked only on that closed PUBLIC past desk.
  const addBlocked = isClosedPastDesk;

  // ── PERSONAL SPACE (R9 head-start — DB-INDEPENDENT UI wiring) ─────────────
  // Flagged OFF by default (isPersonalSpaceEnabled reads VITE_PERSONAL_SPACE):
  // until the owner_id migrations (0001-0003) are applied + Sebs flips the flag,
  // NONE of this mounts, so the LIVE public desk is untouched (zero DB writes,
  // zero new calls). When the flag is on, every data path in lib/personalSpace
  // degrades gracefully on a pre-migration DB (returns null/empty), so the UI
  // renders an honest empty state instead of crashing or writing.
  const personalSpaceOn = isPersonalSpaceEnabled();
  // Identity is LAZY (Sebs 2026-06-14): the "claim your space" moment lives on
  // /your-space, NOT as a forced overlay on the public desk — a visitor who just
  // wants a quick doodle never has to claim anything (everyone still has a silent
  // session handle). The overlay still MOUNTS here so the handle chip / "edit
  // handle" can re-open it on demand; it just never auto-shows.
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  // The settled handle, surfaced after onboarding so the rest of the UI can show
  // it immediately (the PersonalDrawer reads its own effective handle too).
  // Initialized from the locally-remembered handle so a returning visitor's
  // top-bar chip shows their chosen handle on reload (stays in sync with the
  // drawer chip's getEffectiveHandle, DB on or off).
  const [myHandle, setMyHandle] = useState<string | null>(() =>
    personalSpaceOn ? getLocalHandle() : null,
  );
  const finishOnboarding = useCallback((handle: string) => {
    setMyHandle(handle);
    setShowOnboarding(false);
  }, []);
  // The handle chip / "edit your handle" re-opens onboarding (invitational).
  const editHandle = useCallback(() => setShowOnboarding(true), []);
  // Social: clicking another maker's @handle on a doodle opens their public
  // SHELF (ProfileShelfPopover). owner_id == session id in the honor-system era,
  // so the desk object's ownerSession is the shelf key. null = closed.
  const [profileTarget, setProfileTarget] = useState<{
    ownerId: string;
    handle: string;
    // The surface to return to on "← back" (the doodle the shelf was opened
    // from), or null when opened standalone. Take-over, never stacked.
    back: { mode: ObjectSurfaceMode; objectId: string } | null;
  } | null>(null);

  // ── REALTIME DELETE + UPDATE (Rock B 2026-06-12) ─────────────────────────
  // Subscriptions were INSERT-only, so another viewer's deletes and moves
  // stayed stale until reload. These two handlers close that gap; both are
  // dep-free (refs only) so the subscription effects never re-arm over them.

  // A row vanished server-side → drop it from the desk. Desk-scoping is the
  // id match itself (only the viewed desk's rows are in state — see the
  // bindFeedHandlers note in publish.ts: DELETE events can't be desk-filtered
  // server-side because the old record carries only the PK). Applies to OWN
  // rows too (delete from another tab / the drawer surface): the optimistic
  // paths already removed theirs, so a second pass is a no-op. A delete is
  // final — it lands even mid-drag (unlike updates, there is no hand to
  // fight: the row is gone). If the deleted row was your own, the drawer
  // index refetches so the one-record rule holds everywhere.
  const handleRemoteDelete = useCallback(
    (oldId: string) => {
      const victim = objectsRef.current.find((o) => o.dbId === oldId);
      if (!victim) return;
      setObjects((prev) => prev.filter((o) => o.dbId !== oldId));
      if (victim.ownerSession === getSessionId()) bumpDrawer();
    },
    [bumpDrawer],
  );

  // A row changed server-side → apply it in place: position (x/y/rotation),
  // meta (name/why), restyle (render_config) and re-draw (svg) all arrive as
  // the full new row. EXCEPTION — never fight the hand: if the local user is
  // actively dragging THIS object, skip the event entirely (their pointer
  // owns the truth; their own drag-end persist wins the record anyway).
  // Own-session echoes are NOT skipped on purpose: a second tab of the same
  // session is a real viewer, and a same-values echo is a cheap no-op (the
  // configRaw fingerprint keeps the parsed config reference — and therefore
  // the memoized art — stable when only position moved).
  const handleRemoteUpdate = useCallback((row: DoodleRow) => {
    if (draggingIdRef.current) {
      const dragged = objectsRef.current.find((o) => o.id === draggingIdRef.current);
      if (dragged && dragged.dbId === row.id) return; // don't fight the hand
    }
    // OWN-SESSION echo = redundant: the optimistic update (re-draw / restyle / move)
    // already applied the truth locally. Re-applying the DB echo (jsonb re-orders
    // keys → configRaw differs → re-parse) RE-RENDERED the object and made it
    // glitch/disappear until reload (Sebs 2026-06-16). Skip our own echoes — the
    // optimistic state is authoritative for our own edits.
    if (row.session_id === getSessionId()) return;
    setObjects((prev) =>
      prev.map((o) => {
        if (o.dbId !== row.id) return o;
        const rawCfg = JSON.stringify(row.render_config ?? null);
        const cfgChanged = rawCfg !== o.configRaw;
        return {
          ...o,
          x: row.x,
          y: row.y,
          rotation: row.rotation,
          name: row.name ?? null,
          why: row.why ?? null,
          // sanitize on read — same XSS boundary as rowToObject. The result
          // is a string, so an unchanged svg compares === in the art memo.
          svgMarkup: sanitizeSvgMarkup(row.svg),
          renderConfig: cfgChanged
            ? (parseRenderConfig(row.render_config) ?? LEGACY_FREEZE_CONFIG)
            : o.renderConfig,
          configRaw: rawCfg,
        };
      }),
    );
  }, []);

  // Load one desk's doodles + (re)attach a desk-scoped realtime subscription.
  // Used on mount, when ?desk switches the view, and when a publish spawns a
  // fresh desk. Replaces the previous desk subscription so realtime stays
  // scoped to THE desk on screen, not the whole world.
  const loadDeskView = useCallback((target: DeskRow, preserve?: DeskObject) => {
    const token = ++loadTokenRef.current;
    setFeedStatus('loading');
    // Tear down any prior per-desk subscription before swapping the view.
    deskSubRef.current?.();
    deskSubRef.current = null;
    setDesk(target);

    listDoodlesForDesk(target.id)
      .then((rows) => {
        if (token !== loadTokenRef.current) return; // a newer load superseded us
        // Replace the desk's object set wholesale — switching desks shows a
        // clean slate of just this desk's (capped) objects.
        // NEWEST ON TOP: array order IS stacking order (absolute siblings
        // paint in DOM order), so reverse the newest-first feed to
        // oldest-first — the most recent doodle paints highest, and realtime
        // arrivals / fresh publishes (appended) keep landing on top.
        const mapped = rows.map(rowToObject).reverse();
        // DESK-MOVE FIX (2026-06-13): keep the just-placed object if the feed
        // hasn't surfaced it yet (the read-after-write race that made a placed
        // doodle vanish on the post-publish repaint). Newest = top, so the
        // preserved object pushes to the end (paints highest).
        if (preserve?.dbId && !mapped.some((o) => o.dbId === preserve.dbId)) {
          mapped.push(preserve);
        }
        setObjects(mapped);
        setFeedStatus('live');
      })
      .catch(() => {
        if (token === loadTokenRef.current) setFeedStatus('offline');
      });

    const unsubscribe = subscribeDoodlesForDesk(target.id, {
      onInsert: (row) => {
        // Own inserts are already on the desk optimistically — skip them.
        if (row.session_id === getSessionId()) return;
        setObjects((prev) =>
          prev.some((o) => o.dbId === row.id) ? prev : [...prev, rowToObject(row)],
        );
      },
      // Rock B: deletes/moves/restyles propagate live (were reload-only).
      onUpdate: handleRemoteUpdate,
      onDelete: handleRemoteDelete,
    });
    deskSubRef.current = unsubscribe;
  }, [handleRemoteUpdate, handleRemoteDelete]);

  // ── Mount: resolve which desk to view, else fall back to the flat feed ────
  useEffect(() => {
    // DEMO WALL (?demo) — a no-DB recordable fill (see the dedicated seed effect
    // below). Skip the network load entirely so it can't clobber the seed or flip
    // the feed to Offline.
    if (searchParams.get('demo') != null || searchParams.get('test') != null) return;
    let cancelled = false;
    let flatUnsub: (() => void) | null = null;

    (async () => {
      let open: DeskRow | null = null;
      try {
        open = await getOpenDesk();
      } catch {
        // getOpenDesk REJECTED. publish.ts only rejects getOpenDesk on a real
        // connection failure (timeout / network / non-missing-table error) —
        // a pre-v2 DB resolves null, it never throws. So a throw here means the
        // link is down: surface OFFLINE immediately instead of chaining a
        // SECOND full-length probe (the flat-fallback listDoodles) that is
        // guaranteed to time out the same way (that double timeout = ~16s of
        // "Connecting", the demo-killer). The 5s auto-retry / Retry pill / the
        // navigator 'online' event all re-run this resolve, so recovery is
        // automatic once the link is back.
        if (!cancelled) setFeedStatus('offline');
        return;
      }
      if (cancelled) return;

      // ── FLAT FALLBACK (pre-v2 DB) — original single-desk behavior ────────
      if (!open) {
        setDesk(null);
        setOpenDeskId(null);
        listDoodles()
          .then((rows) => {
            if (cancelled) return;
            setObjects((prev) => {
              const have = new Set(prev.map((o) => o.dbId).filter(Boolean));
              const loaded = rows.filter((r) => !have.has(r.id)).map(rowToObject);
              // NEWEST ON TOP: reverse the newest-first feed to oldest-first
              // (array order = stacking order); local optimistic objects in
              // `prev` are the newest of all, so they stay above the load.
              return [...loaded.reverse(), ...prev];
            });
            setFeedStatus('live');
          })
          .catch(() => {
            if (!cancelled) setFeedStatus('offline');
          });
        flatUnsub = subscribeDoodles({
          onInsert: (row) => {
            if (row.session_id === getSessionId()) return;
            setObjects((prev) =>
              prev.some((o) => o.dbId === row.id) ? prev : [...prev, rowToObject(row)],
            );
          },
          // Rock B: same live delete/move propagation on the flat fallback.
          onUpdate: handleRemoteUpdate,
          onDelete: handleRemoteDelete,
        });
        return;
      }

      // ── MULTI-DESK ───────────────────────────────────────────────────────
      setOpenDeskId(open.id);

      // Resolve an optional ?desk=N|uuid read-context. If it names a real
      // desk, view it (read-only past desk); otherwise view the open desk.
      const param = readDeskParam();
      let target = open;
      if (param) {
        try {
          const all = await listDesks();
          if (cancelled) return;
          let match = all.find((d) =>
            param.id != null ? d.id === param.id : d.desk_index === param.index,
          );
          // listDesks only returns PUBLIC desks (owner_id IS NULL). A PRIVATE desk
          // id therefore never matches → the view fell back to the public open desk
          // ("every new desk is The Graphite Orchard / it doesn't make a new desk",
          // Sebs 2026-06-17). Also resolve against the caller's OWN desks so a
          // /desk?desk=<private id> opens that private desk.
          if (!match && param.id != null) {
            const mine = await listMyDesks().catch(() => [] as typeof all);
            if (cancelled) return;
            match = mine.find((d) => d.id === param.id);
          }
          if (match) target = match;
        } catch {
          // listDesks failed — just view the open desk.
        }
      }
      if (cancelled) return;
      loadDeskView(target);
    })();

    return () => {
      cancelled = true;
      // Invalidate any in-flight desk load so a late resolve can't repaint a
      // torn-down component, and drop the live subscription + note timer.
      loadTokenRef.current++;
      deskSubRef.current?.();
      deskSubRef.current = null;
      flatUnsub?.();
      if (freshNoteTimerRef.current) clearTimeout(freshNoteTimerRef.current);
    };
    // deskParam: re-resolve the viewed desk when the ?desk= target changes
    // (e.g. clicking another gallery card while already on /desk). readDeskParam
    // inside reads the now-current URL, so the resolve picks up the new target.
    // reloadNonce: connectivity restore / auto-retry / Retry pill — re-runs the
    // whole resolve (fresh loads + fresh realtime subscriptions) so recovering
    // from offline actually reconnects instead of just relabeling the chip.
    // The two remote handlers are stable callbacks (ref-based) — listed for
    // lint truth, they never actually re-arm this effect.
  }, [loadDeskView, deskParam, reloadNonce, handleRemoteUpdate, handleRemoteDelete]);

  // Surface a transient "a fresh desk opened" note (auto-clears).
  const announceFreshDesk = useCallback((name: string) => {
    if (freshNoteTimerRef.current) clearTimeout(freshNoteTimerRef.current);
    setFreshNote(`“${name}” just opened — your doodle starts a fresh desk.`);
    freshNoteTimerRef.current = setTimeout(() => setFreshNote(null), 6000);
  }, []);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Live mirror for the realtime UPDATE handler (Rock B): a remote echo of
  // our own in-flight drag (or a foreign update racing the local hand) must
  // never yank the object out from under the cursor — the handler checks
  // this ref at event time. Render-time mirror, same pattern as objectsRef.
  const draggingIdRef = useRef<string | null>(null);
  draggingIdRef.current = draggingId;
  // Every object press (own OR foreign) — pointer-up needs the pressed object
  // to tell click (open surface) from drag, and `mine` decides whether the
  // press may drag at all. draggingId stays own-objects-only.
  // startX/startY = the object's DESK coords at pointer-down: a within-slop
  // press still routes its pointermoves through the live drag path, so the
  // click branch must RESTORE these (R1) — otherwise every open applies an
  // unreverted, unpersisted micro-drag (≈8 desk px per open at 25% zoom).
  const pressRef = useRef<{
    id: string;
    mine: boolean;
    nudged: boolean;
    startX: number;
    startY: number;
  } | null>(null);
  // FOREIGN-DRAG BLOCK: id of the object currently playing its tiny
  // nudge-and-settle (you tried to drag someone else's doodle — it shrugs and
  // settles back, never ghost-moves). Cleared by the animation's end event.
  const [nudgeId, setNudgeId] = useState<string | null>(null);
  const clearNudge = useCallback(() => setNudgeId(null), []);
  // Drag offset in DESK coordinates: pointer-desk-position minus object
  // origin at pointer-down. Desk-space (not screen-space) so the same offset
  // stays exact at any zoom — moves divide screen deltas by zoom implicitly
  // by recomputing the pointer's desk position each event.
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  // ── TOP-DOWN DESK PHYSICS (toggleable; OFF = the desk behaves exactly as before) ──
  // When ON, doodles have weight: they collide, get shoved, and can be flung. The sim
  // owns positions imperatively (DeskPhysics + useDeskPhysics write left/top/rotate per
  // frame onto the registered nodes); React state is synced only when it settles.
  const [physicsOn, setPhysicsOn] = useState(false);
  const physicsOnRef = useRef(false);
  physicsOnRef.current = physicsOn;
  const physicsNodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  // Recent pointer samples (desk px) for computing a FLING velocity on release.
  const flingRef = useRef<{ x: number; y: number; t: number; vx: number; vy: number }>({ x: 0, y: 0, t: 0, vx: 0, vy: 0 });
  const onPhysicsSettle = useCallback((states: Map<string, PhysState>) => {
    // Settle → write final centres back to state (top-left + degrees) so any later
    // re-render matches the simulated rest, no jump. DB persist stays lazy for now.
    setObjects((prev) =>
      prev.map((o) => {
        const st = states.get(o.id);
        if (!st) return o;
        return { ...o, x: Math.round(st.x - OBJ_FOOTPRINT / 2), y: Math.round(st.y - OBJ_FOOTPRINT / 2), rotation: (st.rot * 180) / Math.PI };
      }),
    );
  }, []);
  const physics = useDeskPhysics({ enabled: physicsOn, objectsRef, nodeRefs: physicsNodeRefs, footprint: OBJ_FOOTPRINT, onSettle: onPhysicsSettle });
  // Pointer-down position — lets pointer-up tell a CLICK (open the object
  // surface) from a DRAG (persist position) by movement distance. Screen-space
  // on purpose: click slop is a finger/mouse steadiness budget, not a desk
  // distance, so it must NOT shrink/grow with zoom.
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  // Monotonic counter for object ids — deterministic within a session.
  const counterRef = useRef(0);

  // NARROW-VIEWPORT HEADER (responsive chrome fix): the header's three control
  // clusters (identity · zoom unit · scope/panel/live) overflow horizontally
  // once the header box gets tight (the sweep confirmed overflow at ~820px).
  // Measure the HEADER's own box (not the viewport — open panels eat width) and
  // switch to a wrapping two-row layout below the breakpoint so the clusters
  // stack cleanly instead of spilling off the right edge. 880px gives the wide
  // layout headroom before it would clip; below it, wrap.
  const headerRef = useRef<HTMLElement>(null);
  const headerNarrow = useElementNarrow(headerRef, 880);

  // ── Camera state ─────────────────────────────────────────────────────────
  // State drives the render; the ref mirror is updated inside the setter so
  // native listeners (non-passive wheel) + pointer handlers always read the
  // CURRENT camera without dep-array churn or stale closures.
  const [camera, setCameraState] = useState<DeskCamera>(CAMERA_HOME);
  const cameraRef = useRef<DeskCamera>(CAMERA_HOME);
  const setCamera = useCallback((updater: (c: DeskCamera) => DeskCamera) => {
    setCameraState((prev) => {
      let next = updater(prev);
      // PAN LEASH (R2): every camera update is clamped so the lamp-pool
      // working area can never be pushed fully out of view — the desk stays
      // recoverable by panning back, no Fit required. Event-driven measure
      // (setCamera only runs on input events), never a render-path read.
      const rect = deskRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0)
        next = leashCamera(next, rect.width, rect.height, objectsBounds(objectsRef.current));
      cameraRef.current = next;
      return next;
    });
  }, []);

  // ── MEASURED VIEWPORT SIZE (3D virtualization) ───────────────────────────
  // The desk viewport's pixel size, MEASURED via ResizeObserver (never a static
  // estimate — feedback_no_static_pixels_when_viewport_relative). Feeds the 3D
  // virtualization math below: which objects' footprints fall inside the
  // viewport at the current camera. Only the size matters here (intersection is
  // pure camera math), so this re-renders only on actual resize.
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  useEffect(() => {
    const el = deskRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setViewportSize((p) =>
        p.width === r.width && p.height === r.height ? p : { width: r.width, height: r.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── DESK 3D FLIP — `render3d` is computed INLINE in the objects.map as
  // `(deskView === '3d' && deskLens) || force3dIds.has(id)` (Sebs 2026-06-18).
  // No more effect-set Set: the old `threeDIds` streaming lagged ONE render behind
  // `deskView` — the flip's first frame had deskView='3d' but render3d still false,
  // so the 2D branch RE-MOUNTED (its rough.js re-ran) = the blank-flash on flip.
  // Computing it inline flips every object SYNCHRONOUSLY with the toggle (no blank
  // intermediate frame); the FlipFallback2D cross-fade then covers the WebGL
  // build. Off-screen perf is bounded by the display:none viewport cull (drei
  // <View> skips a display:none slot), so flipping all objects costs nothing
  // off-screen and can't churn mid-pan.

  // ── PER-OBJECT 3D — an object the maker saved in 3D (render_config.is3d) shows
  // its 3D form on the desk ON ITS OWN, independent of the global desk lens (Sebs
  // 2026-06-16: "it treats each object as its own… the 3d just doesn't save
  // anywhere"). The flag is written at Done/place in ObjectSurface/DrawPanel.
  // These render 3D always (no viewport streaming) — there are only a handful per
  // desk in practice, and the shared canvas + drei <View> still culls their
  // off-screen PAINT, so it stays cheap.
  const force3dIds = useMemo(() => {
    const s = new Set<string>();
    for (const o of objects) {
      const cfg = o.renderConfig as Record<string, unknown> | null;
      if (cfg && cfg.is3d === true) s.add(o.id);
    }
    return s;
  }, [objects]);

  // Empty-desk drag-to-pan (mouse drag on the paper, not on an object).
  const [panning, setPanning] = useState(false);
  const panDragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );

  /** Screen (client) point → desk coordinates through the current camera. */
  const screenToDesk = useCallback((clientX: number, clientY: number) => {
    const rect = deskRef.current?.getBoundingClientRect();
    const c = cameraRef.current;
    const left = rect ? rect.left : 0;
    const top = rect ? rect.top : 0;
    return { x: (clientX - left - c.panX) / c.zoom, y: (clientY - top - c.panY) / c.zoom };
  }, []);

  /** Header − / + pills: zoom about the CENTER of the desk viewport. */
  const zoomBy = useCallback(
    (factor: number) => {
      const rect = deskRef.current?.getBoundingClientRect();
      const sx = rect ? rect.width / 2 : 0;
      const sy = rect ? rect.height / 2 : 0;
      setCamera((c) => zoomCameraAt(c, sx, sy, factor));
    },
    [setCamera],
  );

  /** Fit = the full desk: zoom 100%, pan 0 (also ⌘/Ctrl+0). */
  // FIT-TO-CONTENT (2026-06-13): "Fit the full desk" frames the actual objects,
  // not a fixed home. Compute the objects' bbox (each is a canonical ~180px
  // footprint at its x/y origin), pick the uniform zoom limited by the most-
  // constraining axis (aspect preserved, clamped to ZOOM_MIN/MAX), and pan so
  // the bbox center lands at the viewport center (screen = desk·zoom + pan).
  // Empty desk / unmeasured viewport / non-finite bbox → safe CAMERA_HOME.
  const resetCamera = useCallback(() => {
    const objs = objectsRef.current;
    const deskEl = deskRef.current;
    if (objs.length === 0 || !deskEl) {
      setCamera(() => CAMERA_HOME);
      return;
    }
    const FOOTPRINT = 180; // normalizeSvgSize add-boundary box
    const PAD = 80;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of objs) {
      if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) continue;
      minX = Math.min(minX, o.x);
      minY = Math.min(minY, o.y);
      maxX = Math.max(maxX, o.x + FOOTPRINT);
      maxY = Math.max(maxY, o.y + FOOTPRINT);
    }
    const rect = deskEl.getBoundingClientRect();
    const vpW = rect.width, vpH = rect.height;
    const bboxW = maxX - minX + PAD * 2, bboxH = maxY - minY + PAD * 2;
    if (!Number.isFinite(minX) || vpW <= 0 || vpH <= 0 || bboxW <= 0 || bboxH <= 0) {
      setCamera(() => CAMERA_HOME);
      return;
    }
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(vpW / bboxW, vpH / bboxH)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    setCamera(() => ({ zoom, panX: vpW / 2 - cx * zoom, panY: vpH / 2 - cy * zoom }));
  }, [setCamera]);

  // SMOOTH CAMERA-FOLLOW on place (Sebs 2026-06-17): when a placed object lands
  // off-screen (the nearest clear spot can be well outside the view), gently pan
  // so the user SEES where it went — never a jarring jump. rAF ease-out on the
  // pan (zoom unchanged); no-ops when the object is already comfortably in view.
  const flyTimerRef = useRef<number | null>(null);
  const flyCameraToDesk = useCallback((deskCx: number, deskCy: number) => {
    const rect = deskRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vw = rect.width, vh = rect.height;
    const start = cameraRef.current;
    const sx = deskCx * start.zoom + start.panX;
    const sy = deskCy * start.zoom + start.panY;
    const mx = vw * 0.18, my = vh * 0.18; // comfort margin — already visible? skip
    if (sx >= mx && sx <= vw - mx && sy >= my && sy <= vh - my) return;
    const targetPanX = vw / 2 - deskCx * start.zoom;
    const targetPanY = vh / 2 - deskCy * start.zoom;
    const fromX = start.panX, fromY = start.panY;
    const dur = 520;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // ease-out cubic
    if (flyTimerRef.current != null) cancelAnimationFrame(flyTimerRef.current);
    let t0: number | null = null;
    const step = (ts: number) => {
      if (t0 == null) t0 = ts;
      const p = Math.min(1, (ts - t0) / dur);
      const e = ease(p);
      setCamera((c) => ({ ...c, panX: fromX + (targetPanX - fromX) * e, panY: fromY + (targetPanY - fromY) * e }));
      if (p < 1) flyTimerRef.current = requestAnimationFrame(step);
      else flyTimerRef.current = null;
    };
    flyTimerRef.current = requestAnimationFrame(step);
  }, [setCamera]);

  // ── DEMO WALL seed (?demo) ───────────────────────────────────────────────
  // A no-DB recordable fill of the public desk from the real catalog (Sebs
  // 2026-06-15: "make me a made up wall… to record a video"). Builds once on
  // mount, drops the curated objects, marks the feed live, and frames the whole
  // wall. Gated on the URL flag so normal /desk is untouched. The objects are
  // session-local (ownerSession null, no dbId) — drag / flip / click-to-edit all
  // work, but nothing publishes.
  useEffect(() => {
    if (searchParams.get('demo') == null) return;
    let cancelled = false;
    // ?n=<count> = the edge test desk (Sebs 2026-06-18): seed N objects locally
    // (no DB) to stress-test pan/zoom/3D smoothness. e.g. /desk?demo=1&n=80.
    buildDemoWall(Number(searchParams.get('n')) || undefined, searchParams.get('demo')).then((objs) => {
      if (cancelled || objs.length === 0) return;
      setObjects(
        objs.map((o) => ({
          id: o.id,
          svgMarkup: o.svgMarkup,
          x: o.x,
          y: o.y,
          rotation: o.rotation,
          name: o.name,
          why: null,
          ownerSession: null,
          createdAt: null,
          renderConfig: o.renderConfig,
          configRaw: JSON.stringify(o.renderConfig),
        })),
      );
      setFeedStatus('live');
      // Let React commit (objectsRef updates) + the desk element measure, then
      // frame the whole bbox.
      requestAnimationFrame(() => requestAnimationFrame(() => resetCamera()));
    });
    return () => {
      cancelled = true;
    };
  }, [searchParams, resetCamera]);

  // ── PHYSICS TEST DESK (?test) ────────────────────────────────────────────
  // A small empty desk seeded with distinct-shape doodles + physics auto-ON, so
  // the smart per-object behaviour is easy to see/test by hand. Objects are seeded
  // as YOURS (draggable + sim-grabbable). No DB (the mount load above skips ?test).
  useEffect(() => {
    if (searchParams.get('test') == null) return;
    let cancelled = false;
    // Reuse the demo-wall render path (real catalog shapes render correctly through
    // SvgStyleTransform; hand-authored SVGs don't). The first picks are shape-distinct
    // — pokeball (round), gameBoy (boxy), shoe (irregular), guitar (long/thin), vinyl
    // (round-flat), macbook (flat) — perfect to SEE the smart per-shape physics. Seeded
    // as YOURS so they drag + grab.
    // ?test=suzanne → the Suzanne hard-mesh wall; ?test=1 → catalog shapes.
    buildDemoWall(Number(searchParams.get('n')) || 6, searchParams.get('test')).then((objs) => {
      if (cancelled || objs.length === 0) return;
      setObjects(
        objs.map((o) => ({
          id: o.id,
          svgMarkup: o.svgMarkup,
          x: o.x,
          y: o.y,
          rotation: o.rotation,
          name: o.name,
          why: null,
          ownerSession: getSessionId(),
          createdAt: null,
          renderConfig: o.renderConfig,
          configRaw: JSON.stringify(o.renderConfig),
        })),
      );
      setFeedStatus('live');
      setPhysicsOn(true);
      requestAnimationFrame(() => requestAnimationFrame(() => resetCamera()));
    });
    return () => { cancelled = true; };
  }, [searchParams, resetCamera]);

  // ── ORCHARD SEED (?seedorchard) — DEV one-off, publishes to the LIVE DB ─────
  // Sebs 2026-06-17: wipe the Graphite Orchard (SQL — supabase/wipe-orchard.sql)
  // then open /desk?seedorchard=1 ONCE to publish the curated audit catalog,
  // randomly scattered, onto the live open desk (= the orchard). Writes to the
  // shared Supabase the Make site also reads, so the demo desk gets nice content
  // with ZERO Make credits. No StrictMode → runs once. Remove the flag after.
  useEffect(() => {
    if (searchParams.get('seedorchard') == null) return;
    void (async () => {
      // Capped at 12 (was 21) — keeps the orchard light so the desk isn't laggy
      // for the demo (Sebs 2026-06-17). Bump if you want a fuller wall.
      const objs = await buildDemoWall(12);
      if (objs.length === 0) {
        window.alert('seedorchard: built 0 objects (catalog render failed) — retry.');
        return;
      }
      // jittered-grid scatter: organic spread, but the cell/jitter math
      // GUARANTEES no overlap. Objects are ~180px; min center-to-center distance
      // = CELL - 2·(jitter amplitude) = 440 - 2·90 = 260 > 180, so neighbours
      // never collide while still looking randomly placed.
      const COLS = 5;
      const CELL = 440;
      const X0 = 200;
      const Y0 = 200;
      let ok = 0;
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = X0 + col * CELL + (Math.random() - 0.5) * 180; // ±90
        const y = Y0 + row * CELL + (Math.random() - 0.5) * 180; // ±90
        const rotation = (Math.random() - 0.5) * 28; // ±14°
        try {
          const res = await publishDoodle({
            svg: o.svgMarkup,
            x,
            y,
            rotation,
            name: o.name,
            renderConfig: o.renderConfig,
          });
          if (res?.row?.id) ok++;
          // eslint-disable-next-line no-console
          console.log(`[seedorchard] ${ok}/${objs.length} published (${o.name})`);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[seedorchard] failed', o.name, e);
        }
      }
      // eslint-disable-next-line no-console
      console.log(`[seedorchard] DONE — ${ok} objects on the orchard.`);
      window.alert(
        `Seeded ${ok} audit objects onto the Graphite Orchard. ` +
          'Remove ?seedorchard from the URL and reload to see it.',
      );
    })();
    // run once when the flag is present; searchParams is stable per URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wheel/trackpad camera input — native non-passive listener (React's onWheel
  // can't reliably preventDefault browser pinch-zoom/overscroll). Pinch
  // (ctrlKey wheel) + ⌘/Ctrl-wheel = zoom toward the CURSOR; plain two-finger
  // scroll = pan. Event-driven reads only — no per-frame measurement.
  useEffect(() => {
    const el = deskRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        // Clamp the per-event delta so one mouse-wheel notch (±100+) steps
        // ~1.28× while trackpad pinch (small deltas) stays butter-smooth.
        const d = Math.min(50, Math.max(-50, e.deltaY));
        const factor = Math.exp(-d * 0.005);
        setCamera((c) => zoomCameraAt(c, e.clientX - rect.left, e.clientY - rect.top, factor));
      } else {
        setCamera((c) => ({ ...c, panX: c.panX - e.deltaX, panY: c.panY - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setCamera]);

  // ⌘/Ctrl+0 — reset the camera (and keep the browser's own zoom-reset from
  // firing while the desk is the surface being looked at).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        resetCamera();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [resetCamera]);

  // The ONE object surface slot (design doc §2) — Create lives in DrawPanel;
  // this holds Edit (your object) / Sandbox (someone else's). A single slot
  // means the object surface and DrawPanel can never both be open (no nesting).
  const [activeSurface, setActiveSurface] = useState<
    // `origin` = the screen point the user tapped (the doodle's spot) → the focus
    // surface LIFTS from there on open and settles back on close (in-place focus,
    // not a box that pops at center). Optional: the back-nav path omits it.
    { mode: ObjectSurfaceMode; objectId: string; origin?: { x: number; y: number } } | null
  >(null);

  // ONE object per Done — the add boundary. normalizeSvgSize here is the
  // locked auto-resize decision (21-research §2): every object lands at
  // ~180px on its longest axis before entering the render pipeline.
  // `meta` rides in from the DrawPanel naming stage (2026-06-12): the raw
  // source strokes (already size-guarded by the panel per the strokes-in-the-
  // record contract) join the render_config snapshot, and name/why publish
  // with the row (publish_to_open_desk's p_name/p_why). All optional —
  // upload-SVG objects carry no strokes, a skipped naming stage publishes
  // nameless exactly as before.
  const addObject = useCallback(
    (
      rawMarkup: string,
      meta?: {
        strokes?: [number, number, number][][];
        name?: string | null;
        why?: string | null;
        /** DRAWER place-here COPY (#28): the SOURCE row's render_config,
         *  carried VERBATIM into the copy (strokes and any future extras ride
         *  through untouched) instead of snapshotting the live pen. null =
         *  the source predates configs — the copy publishes configless too
         *  (the row stays legacy; renders freeze on read, same rule as its
         *  original). Absent (undefined) = the normal pen-snapshot path. */
        sourceConfig?: Record<string, unknown> | null;
        /** DRAG-TO-PLACE (DRAWER v2 item 2): desk coordinates of the drop
         *  point. Present = the user CHOSE the spot — the object centers on
         *  it and P-1 smart placement stays out of the way. Absent = the
         *  normal scatter + anti-cover placement. */
        at?: { x: number; y: number };
        /** CREATE-FLOW (Sebs 2026-06-14): where this doodle goes — the PUBLIC
         *  wall (default) or the maker's PRIVATE drawer. 'drawer' is intercepted
         *  by handleDone (→ stashToDrawer) and never reaches addObject; the field
         *  rides here only so the shared onDone type accepts it. */
        dest?: 'public' | 'drawer';
        /** PRIVATE multi-save (Sebs 2026-06-18): on a desk you OWN, ALSO save the
         *  placed doodle to your Drawer and/or Shelf — handleDone reads these,
         *  addObject ignores them. */
        saveDrawer?: boolean;
        saveShelf?: boolean;
        /** PUBLIC-only: posted anonymously (hide the @handle). Carried into
         *  render_config via sourceConfig so the card can hide the handle. */
        anon?: boolean;
      },
    ) => {
      // DOUBLE-PUBLISH GUARD (UX-audit fix 2): ignore re-entry while a
      // publish for this same staged markup is in flight (the naming-stage
      // Place double-fire) — released when that publish settles.
      if (inFlightPublishRef.current.has(rawMarkup)) return;
      inFlightPublishRef.current.add(rawMarkup);
      const svgMarkup = normalizeSvgSize(rawMarkup, 180);
      counterRef.current += 1;
      const id = `doodle-${counterRef.current}`;
      // Scatter near the center of the CURRENT VIEW, converted to desk
      // coordinates through the camera — so a new doodle always lands where
      // the user is looking, at any zoom/pan, and its stored x/y stay pure
      // desk coords. The measurement is event-driven (add click), not a
      // render-path read.
      const deskRect = deskRef.current?.getBoundingClientRect();
      const cam = cameraRef.current;
      const vw = deskRect ? deskRect.width : 800;
      const vh = deskRect ? deskRect.height : 600;
      const cx = (vw / 2 - cam.panX) / cam.zoom - 90; // ~180px object → center it
      const cy = (vh / 2 - cam.panY) / cam.zoom - 90;
      const h = hashId(id);
      const dx = (((h & 0xff) / 255) - 0.5) * 160; // ±80px
      const dy = ((((h >> 8) & 0xff) / 255) - 0.5) * 120; // ±60px
      const rotation = ((((h >> 16) & 0xff) / 255) - 0.5) * 16; // ±8°
      let x: number;
      let y: number;
      if (meta?.at) {
        // DRAG-TO-PLACE: center on the drop point, but STILL honor the anti-cover
        // rule — slide to the nearest clear spot from there so it never lands on
        // top of an existing object (Sebs 2026-06-17: "when I drag it just places
        // over the other object, it doesn't do the don't-cover rule"). The drop
        // point is the seed; findClearSpot nudges it clear only if it would pile.
        const spot = findClearSpot(meta.at.x - 90, meta.at.y - 90, objectsRef.current, id, h);
        x = spot.x;
        y = spot.y;
      } else {
        // ANTI-PILE auto-placement: nearest clear spot to the hash spot near the
        // view center (shared findClearSpot — same anti-pile rule the drag-drop
        // uses). A new doodle never lands on top of an existing one.
        const spot = findClearSpot(cx + dx, cy + dy, objectsRef.current, id, h);
        x = spot.x;
        y = spot.y;
      }
      setDrawOpen(false);

      // D-6 — snapshot the PEN at the Done boundary: the current global style
      // + the full modifier state become this object's permanent record.
      // penModifiers is the context's state object (immutably replaced on
      // every change), so holding the reference is a true snapshot.
      // STROKES IN THE RECORD: the raw gesture rides the same snapshot
      // (optional field — absent on uploads), so the record holds the SOURCE
      // of the doodle, not just its look (the wedge: the hand survives).
      //
      // DRAWER COPY OVERRIDE (#28): when meta.sourceConfig is present (even
      // null) this Done is a place-here COPY — the row stores the source's
      // config BYTE-FOR-BYTE (publishConfig) and the optimistic object renders
      // under the same parse the reload path applies (localConfig via
      // parseRenderConfig, exactly what rowToObject would produce), so the
      // copy's first paint == its post-reload paint.
      const isCopy = meta !== undefined && meta.sourceConfig !== undefined;
      const penSnapshot: ObjectRenderConfig = {
        svgStyle: penStyle,
        modifiers: penModifiers,
        ...(meta?.strokes && meta.strokes.length > 0 ? { strokes: meta.strokes } : {}),
      };
      const publishConfig: Record<string, unknown> | null = isCopy
        ? (meta?.sourceConfig ?? null)
        : penSnapshot;
      // Configless copy sources pin to the same frozen DEFAULT the reload
      // path applies (UX-audit fix 1) — first paint == post-reload paint.
      const localConfig: ObjectRenderConfig | null = isCopy
        ? (parseRenderConfig(meta?.sourceConfig) ?? LEGACY_FREEZE_CONFIG)
        : penSnapshot;
      const name = meta?.name ?? null;
      const why = meta?.why ?? null;

      // DEMO WALL — purely local (Sebs 2026-06-15: "when I add an object it
      // changes to the other desk wtf"). The demo wall has no DB row, so the
      // normal publish path would push the doodle to the REAL open desk and the
      // resolve would swap the view to it. Here we just drop the object on the
      // demo wall (optimistic add only) and stop — no publish, no desk switch.
      if (isDemoWall || isTestDesk) {
        setObjects((prev) => [
          ...prev,
          { id, svgMarkup, x, y, rotation, ownerSession: getSessionId(), renderConfig: localConfig, name, why },
        ]);
        markLanding(id);
        inFlightPublishRef.current.delete(rawMarkup); // release the double-publish guard
        return;
      }

      // PRIVATE DESK — ANY add path (Done, place-from-shelf/drawer, drag-drop) that
      // happens while you're viewing one of YOUR private desks lands ON that desk,
      // NOT the public open desk. Publishing to the open desk made the view jump
      // to the public Orchard (Sebs 2026-06-17: "placing from the shelf still
      // causes the public Graphite Orchard"). This lives in addObject so EVERY
      // caller is covered, not just the Done router.
      if (desk?.owner_id && desk.id !== openDeskId) {
        const pdid = desk.id;
        setObjects((prev) => [
          ...prev,
          { id, svgMarkup, x, y, rotation, ownerSession: getSessionId(), renderConfig: localConfig, name, why },
        ]);
        markLanding(id);
        flyCameraToDesk(x + 90, y + 90);
        void publishToPrivateDesk(pdid, { svg: svgMarkup, name, why, renderConfig: publishConfig, x, y, rotation })
          .then((row) => {
            if (row?.id) setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, dbId: row.id } : o)));
            bumpDrawer();
          })
          .catch((err) => console.warn('[desk] publish-to-private-desk failed:', err?.message ?? err))
          .finally(() => inFlightPublishRef.current.delete(rawMarkup));
        return;
      }

      // FULL / PAST PUBLIC DESK — you can browse it, but you can't ADD to it.
      // The old behavior silently republished to the OPEN desk and yanked the
      // view there, which reads as a bug (Sebs 2026-06-17: "it lets u add an
      // object to a full desk but it just switches to the open desk"). Block the
      // add with an honest notice — no publish, no view-switch. (Private desks
      // were handled above; the demo wall short-circuits earlier. Block ONLY a
      // server-CLOSED public desk — a fresh/open one whose id hasn't caught up to
      // openDeskId is NOT full and must still accept doodles (Sebs 2026-06-18).)
      if (isClosedPastDesk) {
        if (freshNoteTimerRef.current) clearTimeout(freshNoteTimerRef.current);
        setFreshNote('This desk is full — open the live desk (Browse → the ●Live desk) to add a doodle.');
        freshNoteTimerRef.current = setTimeout(() => setFreshNote(null), 6000);
        inFlightPublishRef.current.delete(rawMarkup);
        return;
      }

      // Drawing routes to the OPEN desk — add it locally now; the publish below
      // persists it to the shared feed. (Reached on the open desk OR a fresh
      // not-yet-caught-up public desk; either way it lands live, not refused.)
      {
        // ownerSession on the optimistic add so clicking your just-drawn
        // object opens Edit (yours), not Sandbox, before the insert resolves.
        // renderConfig rides along so the optimistic object is pinned to the
        // pen it was drawn with from its very first paint; name/why from the
        // naming stage show up immediately if the object is opened.
        setObjects((prev) => [
          ...prev,
          {
            id,
            svgMarkup,
            x,
            y,
            rotation,
            ownerSession: getSessionId(),
            renderConfig: localConfig,
            name,
            why,
          },
        ]);
        // The ratified doodle-lands moment — Done-mints, Place-here copies
        // and drag-to-place drops all arrive through here, one shared spring.
        markLanding(id);
        // Follow it if it landed off-screen (e.g. the clear spot was pushed out
        // of view) — a smooth pan so the user can see where it went.
        flyCameraToDesk(x + 90, y + 90);
      }

      // M9 — auto-publish to the shared feed. The data layer's RPC handles the
      // per-desk cap + atomic spawn server-side; it returns the inserted row
      // AND the desk it actually landed on (a freshly-spawned one if this Done
      // filled the desk). renderConfig persists the pen snapshot into
      // doodles.render_config (D-6) so every viewer renders this object under
      // the look it was MADE with.
      //
      // PUBLISH HONESTY (UX-audit fix 3): a rejected publish no longer fails
      // silently — the optimistic object gets a quiet "not saved — retrying"
      // badge and the publish auto-retries on backoff (PUBLISH_RETRY_DELAYS_MS).
      // Success clears the badge; exhausting the attempts marks it honestly
      // failed and the object stays desk-local for this session. The in-flight
      // guard key is held through the retries, so a Place double-fire can't
      // sneak a duplicate in between attempts either.
      const payload = {
        svg: svgMarkup,
        x,
        y,
        rotation,
        name,
        why,
        deskId: openDeskId ?? undefined,
        renderConfig: publishConfig,
      };
      const settle = () => {
        inFlightPublishRef.current.delete(rawMarkup);
        const t = retryTimersRef.current.get(id);
        if (t) clearTimeout(t);
        retryTimersRef.current.delete(id);
      };
      const setSaveState = (s: DeskObject['saveState']) =>
        setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, saveState: s } : o)));
      const attempt = (tryNo: number) => {
        publishDoodle(payload)
          .then(({ row, desk: landedDesk }) => {
            settle();
            // The record exists now — the drawer index gains a row (#29).
            bumpDrawer();
            // DESK-MOVE FIX (2026-06-13): a drag may have landed during the
            // optimistic-add window (before dbId). Flush the queued move now the
            // row id exists, and use the dragged resting position as truth so the
            // patch/repaint below never snaps it back to the add-point.
            const queued = pendingMoveRef.current.get(id);
            if (queued) pendingMoveRef.current.delete(id);
            const restX = queued ? queued.x : x;
            const restY = queued ? queued.y : y;
            const restRot = queued ? queued.rotation : rotation;
            if (queued) updateDoodlePosition(row.id, restX, restY, restRot).catch(() => {});
            // The desk this object actually landed on (when v2 is live).
            if (landedDesk) {
              const spawnedFresh = openDeskId != null && landedDesk.id !== openDeskId;
              // The open desk may have advanced (this Done filled it and spawned
              // the next). Track the new open desk so future draws route right.
              setOpenDeskId(landedDesk.id);

              const switchingView = desk == null || landedDesk.id !== desk.id;
              if (switchingView) {
                // Either we were viewing a closed past desk (add routes to open),
                // or the desk just filled + spawned — show the now-open desk.
                if (spawnedFresh) announceFreshDesk(landedDesk.name);
                // Pass the just-placed object (resolved dbId + resting position)
                // so loadDeskView keeps it on screen even when the fresh insert
                // hasn't surfaced in the feed yet — without this it vanishes.
                const placed: DeskObject = {
                  id,
                  dbId: row.id,
                  svgMarkup,
                  x: restX,
                  y: restY,
                  rotation: restRot,
                  ownerSession: getSessionId(),
                  createdAt: row.created_at ?? null,
                };
                loadDeskView(landedDesk, placed);
                return; // loadDeskView repaints; skip the local dbId patch.
              }
            }
            // Same desk still in view — attach the row id (drag/delete target)
            // + the server timestamp so the card shows a real date; clear any
            // retry badge (a late success after a failed first attempt).
            setObjects((prev) =>
              prev.map((o) =>
                o.id === id
                  ? {
                      ...o,
                      dbId: row.id,
                      // Apply the queued resting position so a drag-before-publish
                      // survives the patch; with no queued move, keep the object's
                      // CURRENT live coords (a still-in-progress drag is never
                      // snapped back — queued is only set on pointerUp).
                      x: queued ? restX : o.x,
                      y: queued ? restY : o.y,
                      rotation: queued ? restRot : o.rotation,
                      createdAt: row.created_at ?? o.createdAt,
                      saveState: undefined,
                    }
                  : o,
              ),
            );
          })
          .catch((err) => {
            const delay = PUBLISH_RETRY_DELAYS_MS[tryNo - 1];
            if (delay != null) {
              console.warn(
                `[desk] publish attempt ${tryNo} failed — retrying in ${delay}ms:`,
                err.message,
              );
              setSaveState('retrying');
              const t = setTimeout(() => {
                retryTimersRef.current.delete(id);
                attempt(tryNo + 1);
              }, delay);
              retryTimersRef.current.set(id, t);
            } else {
              console.warn('[desk] publish failed permanently — object stays local:', err.message);
              settle();
              setSaveState('failed');
            }
          });
      };
      attempt(1);
    },
    [
      isDemoWall,
      isClosedPastDesk,
      openDeskId,
      desk,
      loadDeskView,
      announceFreshDesk,
      penStyle,
      penModifiers,
      bumpDrawer,
      markLanding,
      flyCameraToDesk,
    ],
  );

  // CREATE-FLOW ROUTER (Sebs 2026-06-14) — the DrawPanel's "Done" lands here.
  // dest === 'drawer' → the doodle is saved PRIVATELY (stashToDrawer), never
  // touches the public wall or the open desk; everything else falls through to
  // addObject (the public-wall path). The drawer item carries the same render
  // config addObject would build (svgStyle + modifiers + strokes), so it renders
  // — and flips 2D/3D — identically in the drawer view. A drawer save bumps the
  // drawer index so the side panel + /drawer page refresh.
  const handleDone = useCallback(
    (rawMarkup: string, meta?: Parameters<typeof addObject>[1]) => {
      // Non-drawer → addObject (which now routes private-desk vs public itself, so
      // EVERY path — Done, place-from-shelf, drag-drop — lands correctly).
      if (meta?.dest !== 'drawer') {
        addObject(rawMarkup, meta);
        // PLACE ON DESK + multi-save (Sebs 2026-06-18): on a desk you OWN the maker
        // can ALSO tick Drawer and/or Shelf — the doodle lands on the desk AND is
        // saved to whichever they picked. One drawer row covers both (the shelf is
        // the PUBLIC face of a drawer item — share_to_shelf just flips it public).
        // Public board has no drawer/shelf (allowDrawer false there) so this only
        // fires on your own desk. Best-effort — never blocks the placement.
        if (desk?.owner_id && (meta?.saveDrawer || meta?.saveShelf)) {
          const drawerConfig: Record<string, unknown> =
            (meta?.sourceConfig as Record<string, unknown> | null | undefined) ?? {
              svgStyle: penStyle,
              modifiers: penModifiers,
              ...(meta?.strokes && meta.strokes.length > 0 ? { strokes: meta.strokes } : {}),
            };
          void (async () => {
            const row = await stashToDrawer({
              svg: normalizeSvgSize(rawMarkup, 180),
              name: meta?.name ?? null,
              why: meta?.why ?? null,
              renderConfig: drawerConfig,
            });
            if (row && meta?.saveShelf) await shareToShelf(row.id);
            bumpDrawer();
          })().catch((err) => console.warn('[desk] multi-save (drawer/shelf) failed:', err?.message ?? err));
        }
        return;
      }
      // Prefer the verbatim sourceConfig (carries toneFills when present);
      // otherwise snapshot the live pen exactly as addObject's penSnapshot does.
      const renderConfig: Record<string, unknown> =
        (meta.sourceConfig as Record<string, unknown> | null | undefined) ?? {
          svgStyle: penStyle,
          modifiers: penModifiers,
          ...(meta.strokes && meta.strokes.length > 0 ? { strokes: meta.strokes } : {}),
        };
      void stashToDrawer({
        svg: normalizeSvgSize(rawMarkup, 180),
        name: meta.name ?? null,
        why: meta.why ?? null,
        renderConfig,
      })
        .then(() => bumpDrawer())
        .catch((err) => console.warn('[desk] stash-to-drawer failed:', err?.message ?? err));
    },
    [addObject, penStyle, penModifiers, bumpDrawer, desk, openDeskId, findClearSpot, flyCameraToDesk, markLanding],
  );

  // DRAWER "Place here" (#28: place = COPY) — publish a NEW row of the source
  // doodle onto the current OPEN desk through the exact addObject path (same
  // ~180px normalize, same P-1 smart placement, same optimistic add + RPC +
  // desk-spawn handling). The original row is untouched; the copy carries the
  // source's render_config verbatim — strokes included — so Edit on the copy
  // re-draws the same hand. The svg is sanitized on read (anon-writable
  // column), the same rule rowToObject applies to the feed.
  const placeFromDrawer = useCallback(
    (row: DoodleRow) => {
      addObject(sanitizeSvgMarkup(row.svg), {
        name: row.name ?? null,
        why: row.why ?? null,
        sourceConfig: row.render_config ?? null,
      });
    },
    [addObject],
  );

  // ── DRAG-TO-PLACE drop target (DRAWER v2 item 2) ─────────────────────────
  // The desk accepts drags carrying the DD_DOODLE_MIME payload (the drawer's
  // mini cards are the drag source). Drop = a COPY published at the drop
  // point through the exact addObject sourceConfig path Place-here uses
  // (same ~180px normalize, same optimistic add + RPC + desk-spawn handling,
  // same doodle-lands moment) — the keyboard/fallback Place-here pill stays.
  const handleDeskDragOver = useCallback((e: React.DragEvent) => {
    // dataTransfer VALUES are protected until drop — only the type list is
    // readable here, which is exactly enough to accept or ignore the drag.
    if (Array.from(e.dataTransfer.types).includes(DD_DOODLE_MIME)) {
      e.preventDefault(); // accept — without this the drop event never fires
      e.dataTransfer.dropEffect = 'copy'; // place = COPY (#28); the cursor says so
    }
  }, []);

  const handleDeskDrop = useCallback(
    (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(DD_DOODLE_MIME);
      if (!raw) return; // not ours — leave the event alone
      e.preventDefault();
      // Defensive parse — the payload crosses a string boundary, so it gets
      // the same treatment as a DB read: parse, type-check, sanitize.
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      const svg = payload.svg;
      if (typeof svg !== 'string' || svg.trim() === '') return;
      const rc = payload.renderConfig;
      // The drop point in DESK coordinates (camera-aware, any zoom/pan).
      const p = screenToDesk(e.clientX, e.clientY);
      addObject(sanitizeSvgMarkup(svg), {
        name: typeof payload.name === 'string' && payload.name ? payload.name : null,
        why: typeof payload.why === 'string' && payload.why ? payload.why : null,
        // sourceConfig present (even null) marks this Done a COPY — the
        // source's config rides verbatim, strokes included (#28).
        sourceConfig: rc && typeof rc === 'object' ? (rc as Record<string, unknown>) : null,
        at: p,
      });
    },
    [addObject, screenToDesk],
  );

  // Drag — same pointer-event pattern as the playground's placed items, but
  // camera-aware: the grab offset is captured in DESK coordinates (pointer's
  // desk position minus the object's origin), and every move recomputes the
  // pointer's desk position. Screen deltas therefore divide by zoom exactly —
  // the desk point grabbed at pointer-down stays under the cursor at 50% and
  // 200% alike. Stored x/y never change because of camera state.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, obj: DeskObject) => {
      e.stopPropagation();
      downPosRef.current = { x: e.clientX, y: e.clientY };
      // FOREIGN-DRAG BLOCK: only YOUR objects drag. A press on someone else's
      // doodle is tracked (click still opens its Sandbox on pointer-up) but
      // never becomes a drag — a drag attempt just plays the nudge-and-settle
      // (see handlePointerMove). Unknown owner (null) counts as foreign: we
      // can't prove it's yours, and the server-side session scope would
      // reject the move anyway — so no ghost-move.
      const mine = obj.ownerSession != null && obj.ownerSession === getSessionId();
      pressRef.current = { id: obj.id, mine, nudged: false, startX: obj.x, startY: obj.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (!mine) return;
      const p = screenToDesk(e.clientX, e.clientY);
      dragOffsetRef.current = { dx: p.x - obj.x, dy: p.y - obj.y };
      setDraggingId(obj.id);
      // Set the ref EAGERLY (not only via the render-time mirror) so pointer-move's
      // drag branch sees the id on the very next event even if React hasn't re-rendered
      // yet — fixes a physics-drag freeze after an edit modal closed (the re-render that
      // would update the ref didn't land before the next gesture).
      draggingIdRef.current = obj.id;
      // PHYSICS: grab the body (it becomes kinematic + shoves neighbours) and start
      // tracking pointer velocity for the fling on release.
      if (physicsOnRef.current) {
        physics.grab(obj.id, p.x, p.y);
        flingRef.current = { x: p.x, y: p.y, t: performance.now(), vx: 0, vy: 0 };
      }
    },
    [screenToDesk, physics],
  );

  // Pointer-down on the EMPTY desk (objects stopPropagation, so reaching the
  // desk means paper) → start a drag-to-pan. Pan deltas are screen-space —
  // the camera's pan IS screen pixels (transform = translate(pan) scale(zoom)).
  const handleDeskPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const c = cameraRef.current;
    panDragRef.current = { startX: e.clientX, startY: e.clientY, panX: c.panX, panY: c.panY };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Desk pan in flight — move the camera, never the objects.
      const pan = panDragRef.current;
      if (pan) {
        const dx = e.clientX - pan.startX;
        const dy = e.clientY - pan.startY;
        setCamera((c) => ({ ...c, panX: pan.panX + dx, panY: pan.panY + dy }));
        return;
      }
      // Foreign press pulled past the click slop = a drag attempt on someone
      // else's doodle → fire the nudge-and-settle ONCE per press and ignore
      // the rest of the gesture. The object never moves (no ghost-move).
      const press = pressRef.current;
      if (press && !press.mine) {
        const dp = downPosRef.current;
        if (dp && !press.nudged && Math.hypot(e.clientX - dp.x, e.clientY - dp.y) > 5) {
          press.nudged = true;
          setNudgeId(press.id);
        }
        return;
      }
      // Read draggingId from the REF, not the closure (Sebs 2026-06-19): keeping
      // it out of the deps makes this handler STABLE across a drag (it no longer
      // re-creates on drag-start/end), and the ref is always current at event time
      // — no stale-jump.
      const dragId = draggingIdRef.current;
      if (!dragId || !deskRef.current) return;
      const p = screenToDesk(e.clientX, e.clientY);
      // PHYSICS: drive the grabbed body to the cursor + sample velocity for the fling;
      // the sim writes the position, so DON'T touch React state here.
      if (physicsOnRef.current) {
        physics.move(dragId, p.x, p.y);
        const f = flingRef.current;
        const now = performance.now();
        const dt = Math.max(8, now - f.t) / 1000;
        f.vx = (p.x - f.x) / dt;
        f.vy = (p.y - f.y) / dt;
        f.x = p.x; f.y = p.y; f.t = now;
        return;
      }
      const x = p.x - dragOffsetRef.current.dx;
      const y = p.y - dragOffsetRef.current.dy;
      setObjects((prev) => prev.map((o) => (o.id === dragId ? { ...o, x, y } : o)));
    },
    [screenToDesk, setCamera, physics],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (panDragRef.current) {
        panDragRef.current = null;
        setPanning(false);
      }
      const press = pressRef.current;
      if (press) {
        // objectsRef, not the `objects` closure (Sebs 2026-06-19): `objects`
        // changes every drag FRAME, so closing over it re-created this handler on
        // every pointermove (churn that defeats child memo) and risked a one-frame-
        // stale read at drop. The ref is always current and keeps the handler stable.
        const obj = objectsRef.current.find((o) => o.id === press.id);
        const dp = downPosRef.current;
        const moved = dp ? Math.hypot(e.clientX - dp.x, e.clientY - dp.y) : 999;
        // Touch taps jitter more than a mouse — a higher click threshold on
        // touch so a finger-roll tap still opens the surface (not a drag).
        const clickSlop = e.pointerType === 'touch' ? 12 : 5;
        if (e.type === 'pointerup' && moved < clickSlop && obj) {
          // PHYSICS: a TAP still grabbed the body on pointer-down — release it (no
          // fling) so the tapped object returns to the sim instead of freezing
          // kinematic while its card is open.
          if (physicsOnRef.current && press.mine) physics.release(press.id, 0, 0);
          // A click, not a drag → open the ONE object surface: Edit if it's
          // yours, Sandbox if it's someone else's.
          // R1: within-slop pointermoves on an own object were applied as a
          // live drag (screen-px ÷ zoom → up to ~8 desk px at 25%), and the
          // click branch never persists — RESTORE the pointer-down coords so
          // opening a doodle never shifts it out of sync with the DB.
          if (press.mine && (obj.x !== press.startX || obj.y !== press.startY)) {
            setObjects((prev) =>
              prev.map((o) =>
                o.id === press.id ? { ...o, x: press.startX, y: press.startY } : o,
              ),
            );
          }
          setActiveSurface({ mode: press.mine ? 'edit' : 'sandbox', objectId: obj.id, origin: { x: e.clientX, y: e.clientY } });
        } else if (press.mine && obj && physicsOnRef.current) {
          // PHYSICS drop → no anti-pile snap; let it FLING and settle by collision.
          // The sim's settle-edge syncs the final position back to state (+ DB later).
          const f = flingRef.current;
          physics.release(press.id, f.vx, f.vy);
        } else if (press.mine && obj) {
          // A real drag of YOUR object → persist the resting position.
          // ANTI-PILE on DROP (Sebs 2026-06-14: free drag, overlap fine WHILE
          // moving, but it can't come to REST on top of another). Settle to the
          // nearest CLEAR spot from where it was let go; neighbours don't move.
          // (Same findClearSpot the auto-placement uses.) Persist the RESOLVED
          // position so the no-pile rule survives reloads + other viewers.
          const spot = findClearSpot(obj.x, obj.y, objectsRef.current, obj.id, hashId(obj.id));
          const rx = spot.x;
          const ry = spot.y;
          if (rx !== obj.x || ry !== obj.y) {
            // It overlapped where dropped → SLIDE it to the clear spot (not a
            // jarring jump) + glow (markSettling). The wrapper's settle
            // transition animates left/top from the drop point to (rx, ry).
            markSettling(obj.id);
            setObjects((prev) =>
              prev.map((o) => (o.id === obj.id ? { ...o, x: rx, y: ry } : o)),
            );
          }
          if (obj.dbId) {
            updateDoodlePosition(obj.dbId, rx, ry, obj.rotation).catch(() => {});
          } else {
            // DESK-MOVE FIX: insert hasn't resolved yet (drag during the
            // optimistic-add window) — QUEUE by local id; addObject's publish
            // .then flushes it once the dbId attaches, so the move isn't lost.
            pendingMoveRef.current.set(obj.id, { x: rx, y: ry, rotation: obj.rotation });
          }
        }
      }
      setDraggingId(null);
      pressRef.current = null;
      downPosRef.current = null;
    },
    [markSettling, physics],
  );

  // A cancelled/interrupted pointer (touch scroll-steal, OS gesture, palm
  // rejection) fires neither pointerup nor a reliable leave — without this the
  // drag stays glued to the object forever. Just end the drag/pan, never a click.
  const handlePointerCancel = useCallback(() => {
    // Restore the pressed object's coords (same as the click branch) — a
    // cancel mid-press (touch scroll-steal, OS gesture) must not leave the
    // unreverted micro-drag the click-open fix eliminated.
    const press = pressRef.current;
    if (press) {
      setObjects((prev) =>
        prev.map((o) => (o.id === press.id ? { ...o, x: press.startX, y: press.startY } : o)),
      );
    }
    setDraggingId(null);
    pressRef.current = null;
    downPosRef.current = null;
    panDragRef.current = null;
    setPanning(false);
  }, []);

  // Delete one of your own objects (Edit-mode action) — removes from the DB
  // (session-scoped) and the desk, then closes the surface. ONE RECORD (#29):
  // the drawer is a view of the same rows, so the settle bumps its refetch —
  // a desk delete disappears from the drawer too (and a rollback reappears).
  const handleDeleteObject = useCallback(
    (obj: DeskObject) => {
      setActiveSurface(null);
      // Optimistic remove, but ROLL BACK if the DB delete didn't actually remove
      // the row (not yours / failed) — never claim a delete that didn't happen.
      setObjects((prev) => prev.filter((o) => o.id !== obj.id));
      if (obj.dbId) {
        const restore = () =>
          setObjects((prev) => (prev.some((o) => o.id === obj.id) ? prev : [...prev, obj]));
        deleteDoodle(obj.dbId)
          .then((ok) => {
            if (!ok) restore();
          })
          .catch(restore)
          .finally(bumpDrawer);
      }
    },
    [bumpDrawer],
  );

  // Header desk readout — name + count/cap. Falls back to a neutral label on
  // the flat (pre-v2) path where there is no desk row.
  const deskTitle = desk?.name ?? 'Shared desk';
  const countReadout = desk
    ? `${objects.length} / ${desk.object_cap}`
    : `${objects.length}`;

  return (
    // Canvas3DProvider — shared live 3D state so the panel's Canvas3DChrome (3D
    // controls) drives every desk object's Live3DMount at once (the desk-lens 3D
    // restyle). Cheap context; the 2D paths never read it.
    <Canvas3DProvider>
    <div
      style={{
        // Definite height (not min-height) — same viewport-fit chain as
        // /canvas: header is auto, desk takes the measured leftover, the
        // page never scrolls.
        height: '100vh',
        background: 'var(--dir-bg)',
        color: 'var(--dir-text-primary)',
        fontFamily: IS,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* FOREIGN-DRAG nudge keyframes — a few px shrug + quick settle. Scoped
          here with the only consumer (DeskObjectView) rather than in shared
          CSS. Animates the standalone `translate` property so it composes
          with (never clobbers) the wrapper's rotate on `transform`.
          REDUCED MOTION (R5): prefers-reduced-motion swaps the shrug for a
          motion-free opacity dip of the same duration — feedback survives,
          movement doesn't, and animationend still fires to clear the state. */}
      <style>{`@keyframes dd-foreign-nudge {
        0% { translate: 0 0; }
        35% { translate: 5px 2px; rotate: 0.6deg; }
        70% { translate: -2px -1px; rotate: -0.3deg; }
        100% { translate: 0 0; rotate: 0deg; }
      }
      @keyframes dd-foreign-nudge-dim {
        0% { opacity: 1; }
        35% { opacity: 0.55; }
        100% { opacity: 1; }
      }
      .dd-nudge { animation: dd-foreign-nudge 280ms ease-out; }
      @media (prefers-reduced-motion: reduce) {
        .dd-nudge { animation: dd-foreign-nudge-dim 280ms ease-out; }
      }
      /* THE DOODLE-LANDS MOMENT (ratified, 25-research motion table): ONE
         spring — scale-in 0.92→1 with slight overshoot; the opacity ramp
         fades the ink AND its sit-shadow in together (the filter lives on
         the same subtree). Animates the standalone scale property so it
         composes with the wrapper's rotate — and stays interruptible
         (pointer events live throughout; a mid-spring grab just works).
         Done-mints and drag-to-place drops share this one moment — no
         third motion family. Reduced motion keeps the fade, drops the
         spring; both fire animationend so the landing state always clears. */
      @keyframes dd-land {
        0% { scale: 0.92; opacity: 0; }
        62% { scale: 1.015; opacity: 1; }
        100% { scale: 1; opacity: 1; }
      }
      @keyframes dd-land-dim {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
      .dd-land { animation: dd-land 360ms cubic-bezier(0.22, 1, 0.36, 1); }
      @media (prefers-reduced-motion: reduce) {
        .dd-land { animation: dd-land-dim 360ms ease-out; }
      }
      /* 2D→3D flip cross-fade: the 2D art fades out UNDER the 3D slot as the
         WebGL geometry builds + paints (~250ms), so the flip reads as a morph
         instead of a blank box (Sebs 2026-06-18 "everything disappears then
         comes back on flip"). Opacity-only → reduced-motion safe. */
      @keyframes dd-flip2d-fade {
        from { opacity: 1; }
        to { opacity: 0; }
      }`}</style>
      {/* Top chrome — HEADER CRAFT PASS (ROUND 6 spec): one shared control
          row; 12px gaps INSIDE clusters, 20px BETWEEN clusters; wordmark /
          desk name / count sit on ONE baseline; the zoom cluster reads as
          one unit; the Pen|Desk caption hangs under its pills without
          pushing them off the row axis; the LIVE chip centers with the
          pill row because everything centers on the same single row. */}
      <header
        ref={headerRef}
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--dir-border)',
          // WIDE: the crafted 3-column row (identity · Add · controls) on one
          // baseline. NARROW: a wrapping flex so the clusters stack instead of
          // overflowing the right edge — identity + Add on row 1, the control
          // clusters wrap onto row 2. The grid is restored the instant the
          // header has room again (measured, not a static viewport query).
          display: headerNarrow ? 'flex' : 'grid',
          flexWrap: headerNarrow ? 'wrap' : undefined,
          gridTemplateColumns: headerNarrow ? undefined : '1fr auto 1fr',
          alignItems: 'center',
          // Tighter cross-cluster gap when wrapped (the inter-cluster rhythm is
          // 20px; on two rows the row-gap is what reads, kept a touch tighter).
          gap: headerNarrow ? '12px 16px' : 20,
          rowGap: headerNarrow ? 14 : undefined,
          background: 'var(--dir-bg)',
        }}
      >
        {/* IDENTITY side — [wordmark · desk name · count] on one shared
            baseline (12px intra), then the DRAWER toggle with breathing room
            (20px inter; toggles-always-in-chrome, #30 left panel). */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            minWidth: 0,
            // NARROW: take the row-1 leading space so the Add CTA sits at the
            // trailing edge; WIDE: the grid's first 1fr column owns sizing.
            flex: headerNarrow ? '1 1 auto' : undefined,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
            <NavLink
              to="/"
              style={{
                fontFamily: ISe,
                fontSize: 18,
                letterSpacing: '-0.01em',
                color: 'var(--dir-text-primary)',
                textDecoration: 'none',
                flexShrink: 0,
              }}
            >
              Desk Doodles
            </NavLink>
            {/* Desk name from the desk row (deskName generator). overflow
                'clip' (not 'hidden') keeps the span's text baseline alive for
                the row's baseline alignment — a hidden-overflow flex item
                synthesizes its baseline from the border box and drifts. */}
            <span
              title={isClosedPastDesk ? `${deskTitle} (past desk — viewing)` : deskTitle}
              style={{
                fontFamily: ISe,
                fontSize: 13,
                color: 'var(--dir-text-body)',
                whiteSpace: 'nowrap',
                overflow: 'clip',
                textOverflow: 'ellipsis',
                minWidth: 0,
              }}
            >
              {deskTitle}
              {isClosedPastDesk && (
                <span style={{ color: 'var(--dir-text-body-soft)' }}> · past desk</span>
              )}
            </span>
            {/* Objects-on-this-desk / cap — same baseline as the names. */}
            <span style={{ ...SECTION_LABEL, fontSize: 9, flexShrink: 0 }}>{countReadout}</span>
            {/* PERSONAL SPACE (R9): the visitor's handle, once settled — a quiet
                chip that re-opens onboarding. Only when the flag is on AND a
                handle has been settled this session (the PersonalDrawer carries
                the always-present chip; this header one is a settled-state
                affordance, never an empty placeholder). */}
            {personalSpaceOn && myHandle && (
              <button
                onClick={editHandle}
                title="Edit your handle"
                style={{
                  ...CHIP,
                  flexShrink: 0,
                  cursor: 'pointer',
                  border: '1px solid var(--dir-border)',
                  letterSpacing: '-0.005em',
                }}
              >
                @{myHandle}
              </button>
            )}
          </div>
          <PanelToggle
            side="left"
            open={drawerOpen}
            label="Drawer"
            onToggle={toggleDrawer}
            controlsId="desk-drawer-panel"
          />
        </div>

        <button
          onClick={() => {
            if (addBlocked) {
              if (freshNoteTimerRef.current) clearTimeout(freshNoteTimerRef.current);
              setFreshNote('This desk is full — open the live desk (Browse → the ●Live desk) to add a doodle.');
              freshNoteTimerRef.current = setTimeout(() => setFreshNote(null), 6000);
              return;
            }
            setDrawOpen(true);
          }}
          disabled={addBlocked}
          title={addBlocked ? 'This desk is full — open the live desk to add a doodle' : undefined}
          style={{
            ...CTA,
            flexShrink: 0,
            ...(addBlocked ? { opacity: 0.45, cursor: 'not-allowed' } : null),
          }}
        >
          Add doodle
        </button>

        {/* CONTROL side — four clusters at the 20px inter-cluster rhythm:
            scope gate · zoom unit · panel toggle · live chip. WIDE: one row,
            grid-end aligned, one vertical center. NARROW: wraps to its own full
            row (flexBasis 100%) and its four sub-clusters may wrap among
            themselves at very tight widths — no horizontal overflow. The
            row-1→row-2 gap (header rowGap) plus a little bottom padding here
            leaves the absolutely-positioned Pen|Desk caption its hang space. */}
        <div
          style={{
            justifySelf: headerNarrow ? undefined : 'end',
            display: 'flex',
            gap: headerNarrow ? '10px 16px' : 20,
            alignItems: 'center',
            flexWrap: headerNarrow ? 'wrap' : undefined,
            flexBasis: headerNarrow ? '100%' : undefined,
            justifyContent: headerNarrow ? 'flex-start' : undefined,
            // Room for the scope caption that hangs below the Pen|Desk pills
            // when the cluster is the last thing on a wrapped row.
            paddingBottom: headerNarrow ? 10 : undefined,
          }}
        >
          {/* THE PEN|DESK GATE (D-7 ratified) — scope is always visible, never
              implicit. Pen: the panel styles the draw popup + your NEXT doodle;
              placed records hold their own looks. Desk: the viewer-local sweep
              — the panel restyles everything you see (nobody else's view, no
              record writes; flipping back lifts the lens). The caption keeps
              the active scope readable without opening the doc — ABSOLUTE so
              it hangs under the pills (centered on them, never floating off)
              while the pill row itself stays on the shared control axis. */}
          <div style={{ position: 'relative' }}>
            <div role="tablist" aria-label="Panel scope" style={{ display: 'flex', gap: 4 }}>
              {(
                [
                  ['pen', 'Pen'],
                  ['desk', 'Desk'],
                ] as const
              ).map(([scope, label]) => (
                <button
                  key={scope}
                  role="tab"
                  aria-selected={panelScope === scope}
                  onClick={() => setPanelScope(scope)}
                  title={
                    scope === 'pen'
                      ? 'Pen — the panel styles your next doodle; placed doodles keep their own looks'
                      : 'Desk — the panel restyles the whole desk, just for you (nothing saves)'
                  }
                  style={{
                    ...PILL,
                    padding: '5px 12px',
                    background: panelScope === scope ? 'var(--dir-raised)' : 'transparent',
                    borderColor: panelScope === scope ? 'var(--dir-accent)' : 'var(--dir-border)',
                    color:
                      panelScope === scope
                        ? 'var(--dir-text-primary)'
                        : 'var(--dir-text-body-soft)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <span
              style={{
                position: 'absolute',
                top: 'calc(100% + 3px)',
                left: '50%',
                transform: 'translateX(-50%)',
                fontFamily: IS,
                fontSize: 9,
                letterSpacing: '0.02em',
                color: 'var(--dir-text-body-soft)',
                whiteSpace: 'nowrap',
              }}
            >
              {deskLens
                ? 'restyling the whole desk — only you see this'
                : 'styling your next doodle'}
            </span>
          </div>
          {/* DESK CAMERA — ONE visual unit: a single bordered pill wrapping
              borderless − / % / + / Fit segments (shared bounding treatment
              per the craft spec). Toggles live in chrome, never on the desk;
              zoom steps about the viewport center; Fit = full desk (⌘0). */}
          <div
            role="group"
            aria-label="Desk zoom"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: 2,
              border: '1px solid var(--dir-border)',
              borderRadius: 999,
            }}
          >
            <button
              onClick={() => zoomBy(1 / ZOOM_STEP)}
              title="Zoom out"
              aria-label="Zoom out"
              style={{ ...PILL, border: 'none', padding: '4px 10px' }}
            >
              −
            </button>
            <span
              title="Desk zoom"
              style={{
                ...CHIP,
                border: 'none',
                padding: '4px 2px',
                minWidth: 44,
                justifyContent: 'center',
                letterSpacing: '0.02em',
              }}
            >
              {Math.round(camera.zoom * 100)}%
            </span>
            <button
              onClick={() => zoomBy(ZOOM_STEP)}
              title="Zoom in"
              aria-label="Zoom in"
              style={{ ...PILL, border: 'none', padding: '4px 10px' }}
            >
              +
            </button>
            <button
              onClick={resetCamera}
              title="Fit the full desk (⌘0)"
              aria-label="Fit the full desk"
              style={{ ...PILL, border: 'none', padding: '4px 12px' }}
            >
              Fit
            </button>
          </div>
          <button
            onClick={() => setPhysicsOn((v) => !v)}
            title="Top-down desk physics — doodles get weight, collide, and can be flung. Off = the desk behaves as normal."
            aria-pressed={physicsOn}
            style={{
              ...PILL,
              border: 'none',
              padding: '4px 12px',
              background: physicsOn ? 'var(--dir-text-primary)' : undefined,
              color: physicsOn ? 'var(--dir-bg)' : undefined,
            }}
          >
            {physicsOn ? 'Physics · on' : 'Physics'}
          </button>
          <PanelToggle
            side="right"
            open={rightOpen}
            label="Controls"
            onToggle={toggleRight}
            controlsId="desk-right-panel"
          />
          {/* Auto-publish status — every Done saves itself, so there is no
              Publish button to press (M9 wired 2026-06-11). R3: the chip is
              HONEST — it reads the load lifecycle AND the link (navigator
              connectivity + realtime channel health), so a dropped connection
              flips it to ○ Offline within ~2s and a restore reconnects +
              brings it back to ● Live. */}
          {(() => {
            const chipState = linkDown || feedStatus === 'offline'
              ? 'offline'
              : feedStatus === 'loading'
                ? 'loading'
                : 'live';
            return (
              <span
                title={
                  chipState === 'live'
                    ? 'Connected — doodles save to the shared desk automatically'
                    : chipState === 'loading'
                      ? 'Connecting to the shared desk…'
                      : 'Offline — doodles stay on this desk until reconnect'
                }
                style={{
                  ...CHIP,
                  // Offline reads quieter; live/connecting use the default body ink.
                  color:
                    chipState === 'offline'
                      ? 'var(--dir-text-body-soft)'
                      : 'var(--dir-text-body)',
                }}
              >
                {chipState === 'live' ? '● Live' : chipState === 'loading' ? '○ Connecting' : '○ Offline'}
              </span>
            );
          })()}
        </div>
      </header>

      {/* Body — drawer (left) + desk surface + right Smart Hachure chrome */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left chrome — THE DRAWER (#26-32): "My doodles", the passive
            cross-desk index. Same fixed-but-collapsible system as the right
            panel; Place-here publishes a COPY through addObject (P-1). */}
        <CollapsiblePanel
          side="left"
          open={drawerOpen}
          width={300}
          id="desk-drawer-panel"
          style={{
            borderRight: '1px solid var(--dir-border)',
            background: 'var(--dir-raised)',
            overflowY: 'auto',
          }}
        >
          {/* PanelBoundary (Rock B): a drawer crash shows the quiet fallback
              inside the panel — the desk canvas survives untouched. */}
          <PanelBoundary label="drawer">
            {/* PERSONAL DRAWER (R9): every person gets their own drawer — and it
                shows on the PUBLIC desk too, not only inside a private desk.
                Flagged OFF by default; when on it degrades gracefully (empty
                "my desks" / "my drawer" + the deterministic local handle) on a
                pre-migration DB. The handle chip re-opens onboarding; "Place
                here" only acts once a real private desk exists (currentDeskId =
                the viewed desk, or null on the flat/public fallback). */}
            {personalSpaceOn && (
              <PersonalDrawer
                currentDeskId={desk?.id ?? null}
                // A desk with owner_id is YOURS/private → show your drawer; the
                // public board shows your shelf (so the panel populates).
                isPrivate={!!desk?.owner_id}
                refreshSignal={drawerNonce}
                onPlaced={bumpDrawer}
                onOpenItem={(row) => setDrawerRow(row)}
                onEditHandle={editHandle}
                onExpand={() =>
                  // Expand → the full /drawer PAGE (Sebs: not a popup). ALWAYS
                  // carry the `back` key (even empty) so the page knows it came
                  // from a desk and shows "← Back to desk" — falling back to the
                  // open desk id, then to plain /desk when no specific id is
                  // known (the flat public board), so the user can always return
                  // to where they were (Sebs 2026-06-14). ctx drives the opening
                  // tab; both Drawer + Shelf are always reachable.
                  navigate(
                    `/drawer?back=${encodeURIComponent(desk?.id ?? openDeskId ?? '')}&ctx=${desk?.owner_id ? 'private' : 'public'}`,
                  )
                }
              />
            )}
            <DrawerPanel
              open={drawerOpen}
              refreshKey={drawerNonce}
              viewedDeskId={desk?.id ?? null}
              onPlace={placeFromDrawer}
              onOpenDoodle={(row) => {
                setActiveSurface(null); // one surface at a time
                setDrawerRow(row);
              }}
            />
          </PanelBoundary>
        </CollapsiblePanel>

        {/* THE DESK — full leftover viewport, objects scattered + draggable */}
        <main
          ref={deskRef}
          onPointerDown={handleDeskPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onDragOver={handleDeskDragOver}
          onDrop={handleDeskDrop}
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            // The VIEWPORT — plain warm bg; the paper material lives on the
            // camera-transformed desk surface below, so leaning back (zoom
            // out) shows the desk's grained edge against the same warm tone.
            backgroundColor: 'var(--dir-bg)',
            overflow: 'hidden',
            cursor: panning || draggingId ? 'grabbing' : 'default',
            // The desk owns its gestures — no browser scroll/pinch stealing.
            touchAction: 'none',
          }}
        >
          {/* ENDLESS PAPER v2 (R2 — replaces the oversized in-camera layer,
              which still ENDED after ~3 viewport-widths of pan and showed a
              hard grain seam): the grain is now a VIEWPORT-FIXED layer whose
              background-position is driven by the camera's pan and whose
              background-size scales the natural 280px tile by zoom — exactly
              the screen = desk·zoom + pan mapping, but as an infinitely-tiling
              background. Infinite paper, one viewport-sized paint. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'var(--dir-bg)',
              backgroundImage: PAPER_GRAIN,
              backgroundPosition: `${camera.panX}px ${camera.panY}px`,
              backgroundSize: `${GRAIN_TILE * camera.zoom}px ${GRAIN_TILE * camera.zoom}px`,
              pointerEvents: 'none',
            }}
          />
          {/* THE DESK SURFACE — the camera-transformed plane. The lamp pool,
              edge vignette + every object ride ONE transform, so zooming
              reads as leaning into a real desk, not scaling a flat div (the
              grain layer above tracks the same camera math from outside the
              transform). transformOrigin 0 0 keeps the screen = desk·zoom +
              pan math exact. */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              transform: `translate(${camera.panX}px, ${camera.panY}px) scale(${camera.zoom})`,
              transformOrigin: '0 0',
              willChange: 'transform',
            }}
          >
            {/* The LAMP POOL + vignette — camera-space so the light marks the
                working area, but FADED as you zoom out: at far zoom the pool's
                hard ellipse edge + inset shadow read as a floating box (Sebs
                2026-06-12 "wtf is this" at 25%). Light pools when you're at
                the desk; leaning far back you just see endless paper. */}
            <div
              aria-hidden="true"
              style={{
                // OVERFILL the viewport (inset -100% ⇒ 300%×300%) so the warm pool
                // covers the whole canvas at every zoom — at <100% the old inset:0
                // box (100% of the scaled plane) shrank to a lighter RECTANGLE with
                // a hard vignette/inset-shadow edge mid-screen (Sebs 2026-06-16:
                // "part of the texture doesn't fill the whole canvas"). Oversized,
                // the vignette + shadow edges fall off-screen and only the warm
                // fill shows. Still fades out at far zoom (endless-paper look).
                position: 'absolute',
                inset: '-100%',
                backgroundImage: `${WARM_POOL}, radial-gradient(ellipse at 50% 38%, transparent 48%, rgba(60,50,40,0.07) 100%)`,
                boxShadow: 'inset 0 0 160px rgba(60,50,40,0.05)',
                opacity: Math.max(0, Math.min(1, (camera.zoom - 0.35) / 0.45)),
                pointerEvents: 'none',
              }}
            />
            {/* Array order IS stacking order (absolute siblings paint in DOM
                order) — the load paths reverse the newest-first feed and all
                add paths append, so the newest doodle always sits on top. */}
            {objects.map((obj) => {
              // ZOOM-AWARE VIEWPORT CULL (replaces content-visibility): hide
              // (display:none) objects whose on-screen footprint is outside the
              // viewport + a ½-viewport margin — computed from the LIVE camera so
              // it's correct at EVERY zoom (the CSS heuristic was not, which made
              // edge objects vanish while still in view). Never cull the dragged
              // object (a drag can carry it off-screen). vw=0 (pre-measure) → show
              // all. force3d objects are never hidden (their 3D thumbnail must mount).
              const vw = viewportSize.width;
              const vh = viewportSize.height;
              const sx = obj.x * camera.zoom + camera.panX;
              const sy = obj.y * camera.zoom + camera.panY;
              const sSize = OBJ_FOOTPRINT * camera.zoom;
              // GENEROUS margin (a FULL viewport on each side, not ½) so nothing
              // disappears near the edge — Sebs 2026-06-18: "the radius of when
              // something disappears is too narrow," objects popped switching to
              // 3D. Off-screen-by-a-whole-viewport is the only thing culled. Perf
              // still bounded (only objects within ~3 viewports paint).
              const mX = vw, mY = vh;
              const onScreen =
                vw === 0 ||
                (sx + sSize > -mX && sx < vw + mX && sy + sSize > -mY && sy < vh + mY);
              // TIGHTER on-screen test (perf, Sebs 2026-06-20): gates the heavy
              // svg-port carve BUILD to objects actually near the viewport (a
              // 0.3-viewport pre-build buffer ≈ the shared canvas's 25% overhang,
              // so the texture is ready just before the slot paints). A whole-desk
              // restyle then rebuilds only the few visible objects, not all ~20.
              const ivX = vw * 0.3, ivY = vh * 0.3;
              const inView =
                vw === 0 ||
                (sx + sSize > -ivX && sx < vw + ivX && sy + sSize > -ivY && sy < vh + ivY);
              // EFFECTIVE 3D for THIS object. In DESK mode the global VIEW toggle is
              // AUTHORITATIVE — "the whole desk follows", so flipping to 2D flattens
              // EVERY object (incl. saved-3D / AI-mesh ones, which then show their 2D
              // SVG), and flipping to 3D raises them all (Sebs 2026-06-19: "some
              // objects stay 3D when I global-flip to 2D"). In PEN mode the global
              // flip doesn't apply, so each object keeps its OWN saved 3D state
              // (force3dIds = render_config.is3d).
              const obj3d = deskLens ? deskView === '3d' : force3dIds.has(obj.id);
              const hidden = !onScreen && obj.id !== draggingId && !obj3d;
              return (
              <DeskObjectView
                key={obj.id}
                obj={obj}
                hidden={hidden}
                inView={inView}
                dragging={draggingId === obj.id}
                nudged={nudgeId === obj.id}
                landing={landingIds.has(obj.id)}
                deskLens={deskLens}
                // 2D/3D is a DESK-LENS value, like the restyle controls: it only
                // flips the whole desk when DESK mode is on (Sebs 2026-06-14:
                // "doesn't affect the whole desk unless desk mode on"). In PEN
                // mode the placed objects keep their own look.
                // SHARED-CANVAS flip-all (threeDIds): every in-view object gets a
                // 3D viewport in the desk's ONE shared canvas (Shared3DOverlay),
                // so there's no per-object context limit and no cap — all flip.
                // threeDIds streams by viewport+margin (far ones stay 2D, no lag);
                // drei <View> culls off-screen painting. No crash, truly flip-all.
                render3d={obj3d}
                // 3D objects show a clean rotate HANDLE on hover (any object — a
                // view-only inspect spin); MY OWN ones also MOVE/fling on body-drag.
                // Both available, no mode switch, no grip (Sebs 2026-06-27 redesign,
                // replacing the 2026-06-17 body-rotate + grip-move model). Tap opens
                // the card via the standard handlePointerUp tap path.
                rotatable={obj3d}
                onPointerDown={handlePointerDown}
                onNudgeEnd={clearNudge}
                onLandEnd={clearLanding}
                settling={settlingIds.has(obj.id)}
                onSettleEnd={clearSettling}
                nodeRef={(el) => {
                  if (el) physicsNodeRefs.current.set(obj.id, el);
                  else physicsNodeRefs.current.delete(obj.id);
                }}
              />
              );
            })}
          </div>

          {/* The ONE shared 3D canvas for the whole desk (flip-all, single GL
              context). Mounted only in Desk-lens 3D, with the desk viewport as
              event source so each object's rotate routes to its own slot. Every
              DeskObjectArt 3D branch (LiveObject3DSlot) draws into THIS canvas. */}
          {objects.length > 0 && (
            // WARM REBUILD (Sebs 2026-06-18): the shared canvas is mounted
            // whenever the desk has objects — NOT only in 3D — so every flippable
            // object's 3D slot stays warm (geometry built once, display:none in
            // 2D so it costs no paint). Flipping to 3D is then an instant
            // show/hide, no cold-mount. One canvas = one WebGL context regardless.
            // Self-heal the cold-load WebGL race in Make's preview: if the shared
            // canvas fails to get a context, auto-retry remounts it (warm) instead
            // of white-screening the desk. Objects briefly blank during a retry,
            // then their 3D returns. (Same proven fence as the homepage.)
            <Canvas3DBoundary>
              <Shared3DOverlay containerRef={deskRef} />
            </Canvas3DBoundary>
          )}

          {/* Fresh-desk note — friendly, transient, auto-clears. Floats top-
              center over the desk so it doesn't reflow the layout. */}
          {freshNote && (
            <div
              role="status"
              style={{
                position: 'absolute',
                top: 16,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 5,
                ...PILL,
                cursor: 'default',
                background: 'var(--dir-raised)',
                color: 'var(--dir-text-body)',
                textTransform: 'none',
                letterSpacing: 0,
                fontWeight: 500,
                padding: '8px 16px',
                maxWidth: 'min(90%, 520px)',
                textAlign: 'center',
              }}
            >
              {freshNote}
            </div>
          )}

          {/* VIEW-ONLY banner — persistent on a full/closed PUBLIC past desk
              (Sebs 2026-06-17). The desk fills at the cap and spawns the next
              one; a past desk is browse-only. This always-on note (vs the
              transient freshNote) tells the visitor WHY "Add doodle" is disabled
              and gives a one-tap path to the live desk. Gated by !freshNote so
              the two pills never stack. */}
          {addBlocked && !freshNote && (
            <div
              role="status"
              style={{
                position: 'absolute',
                top: 16,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 5,
                ...PILL,
                cursor: 'default',
                background: 'var(--dir-raised)',
                color: 'var(--dir-text-body)',
                textTransform: 'none',
                letterSpacing: 0,
                fontWeight: 500,
                padding: '8px 16px',
                maxWidth: 'min(90%, 560px)',
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              <span>View only — this desk is full.</span>
              <NavLink
                to="/desk"
                style={{
                  color: 'var(--dir-text-primary)',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                Go to the live desk →
              </NavLink>
            </div>
          )}

          {/* R4 — FAILED LOAD ≠ EMPTY: the friendly empty copy only renders
              when a load actually SUCCEEDED and the desk is truly empty. A
              failed load gets honest copy + a Retry pill (the 5s auto-retry
              runs regardless); while loading, say nothing rather than briefly
              lying that the desk is empty. */}
          {objects.length === 0 && feedStatus === 'offline' && (
            <div
              role="status"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--dir-text-body-soft)',
                fontFamily: IS,
                fontSize: 12,
                textAlign: 'center',
                lineHeight: 1.7,
                pointerEvents: 'none',
              }}
            >
              <span>
                Couldn’t reach the desk — retrying.<br />
                Anything you draw stays on this desk and publishes once it reconnects.
              </span>
              <button onClick={retryNow} onPointerDown={(e) => e.stopPropagation()} style={{ ...PILL, pointerEvents: 'auto' }}>
                Retry now
              </button>
            </div>
          )}

          {objects.length === 0 && feedStatus === 'live' && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--dir-text-body-soft)',
                fontFamily: IS,
                fontSize: 12,
                textAlign: 'center',
                lineHeight: 1.7,
                pointerEvents: 'none',
              }}
            >
              {!isClosedPastDesk ? (
                <>
                  This desk is empty.<br />
                  Hit “Add doodle” to draw — each Done drops one object here.<br />
                  Drag doodles to arrange; the panel is your pen — it styles your next one.
                </>
              ) : (
                <>
                  This is a past desk — full and closed.<br />
                  You can browse it, but new doodles go on the live desk.
                </>
              )}
            </div>
          )}

        </main>

        {/* Right chrome — the PEN panel (D-7): live preview squiggle pinned on
            top, Smart Hachure controls below. In Pen scope tweaks style the
            squiggle + the next doodle; in Desk scope they sweep the desk. */}
        <CollapsiblePanel
          side="right"
          open={rightOpen}
          width={360}
          id="desk-right-panel"
          style={{
            borderLeft: '1px solid var(--dir-border)',
            background: 'var(--dir-raised)',
            overflowY: 'auto',
          }}
        >
          {/* PanelBoundary (Rock B): a pen-panel crash (preview squiggle or
              chrome controls) fences here — the desk canvas survives. */}
          <PanelBoundary label="pen-panel">
            <PenPreview deskLens={deskLens} view3d={deskView === '3d'} />
            {/* 2D / 3D — a side-panel control like the rest: it flips the WHOLE
                desk to 3D only in Desk mode (render3d is gated on deskLens), so
                it never overrides the Pen/Desk scope (Sebs 2026-06-14). */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '12px 20px',
                borderBottom: '1px solid var(--dir-border)',
              }}
            >
              <span style={SECTION_LABEL}>
                View{deskLens ? '' : ' · desk mode to flip all'}
              </span>
              <div
                role="tablist"
                aria-label="Desk view 2D or 3D"
                style={{
                  display: 'inline-flex',
                  gap: 4,
                  padding: 4,
                  borderRadius: 999,
                  border: '1px solid var(--dir-border)',
                  background: 'var(--dir-bg)',
                }}
              >
                {(['2d', '3d'] as const).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={deskView === v}
                    onClick={() => setDeskView(v)}
                    style={{
                      ...PILL,
                      padding: '4px 14px',
                      fontSize: 11,
                      border: 'none',
                      ...(deskView === v
                        ? { background: 'var(--dir-text-primary)', color: 'var(--dir-bg)' }
                        : { background: 'transparent' }),
                    }}
                  >
                    {v.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {/* In 3D view the panel becomes the full 3D control set
                (Canvas3DChrome — geometry / material / style) — in EITHER scope
                (Sebs 2026-06-14: "3d toggles should appear when we switch to 3d
                even if desk isn't on"). Pen+3D tunes your NEXT doodle's 3D (the
                preview shows it); Desk+3D drives the whole desk's Live3DMounts.
                2D view → the normal pen/desk chrome. */}
            {deskView === '3d' ? <Canvas3DChrome /> : <SmartHachureChrome />}
          </PanelBoundary>
        </CollapsiblePanel>
      </div>

      {/* Draw popup — unmounts on close, so each open is a fresh session.
          rightInset/leftInset center it over the VISIBLE desk when the
          controls panel and/or drawer are open (UX-audit fix 4). */}
      {drawOpen && (
        // PanelBoundary (Rock B): a draw-popup crash unmounts the popup's own
        // overlay with it — the popup-variant fallback places itself centered
        // (Retry remounts a fresh draw session; Close returns to the desk).
        <PanelBoundary label="draw-popup" variant="popup" onDismiss={() => setDrawOpen(false)}>
          <DrawPanel
            onDone={handleDone}
            onCancel={() => setDrawOpen(false)}
            rightInset={rightOpen ? 360 : 0}
            leftInset={drawerOpen ? 300 : 0}
            // Drawer destination only in a PRIVATE context (a desk you own). The
            // public board (no owner_id) is public-only — no dest toggle there.
            allowDrawer={!!desk?.owner_id}
          />
        </PanelBoundary>
      )}

      {/* The one object surface — click an object to inspect it. Edit (yours)
          or Sandbox (someone else's); a single slot means it can never stack
          with the draw popup. */}
      {activeSurface &&
        (() => {
          const obj = objects.find((o) => o.id === activeSurface.objectId);
          if (!obj) return null;
          return (
            <PanelBoundary
              label="object-surface"
              variant="popup"
              onDismiss={() => setActiveSurface(null)}
            >
            <ObjectSurface
              mode={activeSurface.mode}
              origin={activeSurface.origin}
              // Save-routing parity: offer "Also save to: Drawer/Shelf" only in the
              // owner-edit context — personal space on + a desk you OWN + your own
              // object + edit mode (same gate DrawPanel's place flow uses).
              allowDrawer={
                personalSpaceOn &&
                !!desk?.owner_id &&
                obj.ownerSession === getSessionId() &&
                activeSurface.mode === 'edit'
              }
              object={{
                svgMarkup: obj.svgMarkup,
                name: obj.name,
                why: obj.why,
                // Owner handle: "you" for yours, otherwise the maker's session
                // handle (real generated handles land with the identity layer;
                // for now the session id stands in so others aren't all "anon").
                owner: obj.ownerSession === getSessionId() ? 'you' : (obj.ownerSession ?? null),
                createdAt: obj.createdAt,
                id: obj.dbId ?? null,
                renderConfig: obj.renderConfig ?? null,
              }}
              onOwnerClick={
                personalSpaceOn && obj.ownerSession && obj.ownerSession !== getSessionId()
                  ? () => {
                      // No stacked modals (object-model doc §"never nest a modal"):
                      // close the object surface and let the shelf TAKE OVER,
                      // remembering the surface so the shelf's "← back" returns to
                      // this doodle (the infinite-modal flow).
                      const back = activeSurface;
                      setActiveSurface(null);
                      setProfileTarget({
                        ownerId: obj.ownerSession as string,
                        handle: handleFromId(obj.ownerSession as string),
                        back,
                      });
                    }
                  : undefined
              }
              onObjectUpdate={
                activeSurface.mode === 'edit'
                  ? (svgMarkup, config) => {
                      // Re-draw saved: the desk object updates in place (svg +
                      // re-pinned config); persistence already ran in the surface.
                      // configRaw tracks the new config so the realtime echo of
                      // this very save is a reference-stable no-op (Rock B).
                      setObjects((prev) =>
                        prev.map((o) =>
                          o.id === obj.id
                            ? {
                                ...o,
                                // SANITIZE the optimistic markup so it's byte-identical
                                // to the realtime echo / reload (which sanitize on read).
                                // Without this the raw vs sanitized strings differ → the
                                // echo re-renders → the object glitched/disappeared until
                                // reload (Sebs 2026-06-16).
                                svgMarkup: sanitizeSvgMarkup(svgMarkup),
                                renderConfig: parseRenderConfig(config),
                                configRaw: JSON.stringify(config ?? null),
                              }
                            : o,
                        ),
                      );
                    }
                  : undefined
              }
              onConfigSave={
                activeSurface.mode === 'edit'
                  ? (config) => {
                      // Re-pin the desk object to the saved config immediately
                      // (no reload needed); persistence already ran in the surface.
                      // configRaw tracks the save for echo stability (Rock B).
                      setObjects((prev) =>
                        prev.map((o) =>
                          o.id === obj.id
                            ? {
                                ...o,
                                renderConfig: parseRenderConfig(config),
                                configRaw: JSON.stringify(config ?? null),
                              }
                            : o,
                        ),
                      );
                    }
                  : undefined
              }
              onClose={() => setActiveSurface(null)}
              onDelete={activeSurface.mode === 'edit' ? () => handleDeleteObject(obj) : undefined}
              onSave={
                activeSurface.mode === 'edit'
                  ? (name, why) => {
                      // Optimistic local update + persist (session-scoped RPC).
                      setObjects((prev) =>
                        prev.map((o) => (o.id === obj.id ? { ...o, name, why } : o)),
                      );
                      if (obj.dbId) updateDoodleMeta(obj.dbId, name, why).catch(() => {});
                    }
                  : undefined
              }
              // Center over the VISIBLE desk area — not behind the open
              // controls panel, and not behind the open drawer either.
              rightInset={rightOpen ? 360 : 0}
              leftInset={drawerOpen ? 300 : 0}
            />
            </PanelBoundary>
          );
        })()}

      {/* Drawer-card detailed view — full Edit surface for ANY of your rows,
          including ones on other desks. Saves/deletes refresh the drawer. */}
      {drawerRow && (
        // PanelBoundary (Rock B): same popup fence for the drawer-card surface.
        <PanelBoundary
          label="drawer-surface"
          variant="popup"
          onDismiss={() => setDrawerRow(null)}
        >
        <ObjectSurface
          mode="edit"
          object={{
            svgMarkup: sanitizeSvgMarkup(drawerRow.svg),
            name: drawerRow.name ?? null,
            why: drawerRow.why ?? null,
            owner: 'you',
            createdAt: drawerRow.created_at ?? null,
            id: drawerRow.id,
            renderConfig: drawerRow.render_config ?? null,
          }}
          onClose={() => setDrawerRow(null)}
          onDelete={() => {
            const id = drawerRow.id;
            setDrawerRow(null);
            // Remove from the visible desk too if it lives here (one record).
            setObjects((prev) => prev.filter((o) => o.dbId !== id));
            deleteDoodle(id)
              .catch(() => {})
              .finally(() => setDrawerNonce((n) => n + 1));
          }}
          onSave={(name, why) => {
            updateDoodleMeta(drawerRow.id, name, why)
              .catch(() => {})
              .finally(() => setDrawerNonce((n) => n + 1));
            setObjects((prev) =>
              prev.map((o) => (o.dbId === drawerRow.id ? { ...o, name, why } : o)),
            );
          }}
          onConfigSave={(config) => {
            setObjects((prev) =>
              prev.map((o) =>
                o.dbId === drawerRow.id
                  ? {
                      ...o,
                      renderConfig: parseRenderConfig(config),
                      configRaw: JSON.stringify(config ?? null),
                    }
                  : o,
              ),
            );
            setDrawerNonce((n) => n + 1);
          }}
          onObjectUpdate={(svgMarkup, config) => {
            setObjects((prev) =>
              prev.map((o) =>
                o.dbId === drawerRow.id
                  ? {
                      ...o,
                      svgMarkup: sanitizeSvgMarkup(svgMarkup),
                      renderConfig: parseRenderConfig(config),
                      configRaw: JSON.stringify(config ?? null),
                    }
                  : o,
              ),
            );
            setDrawerNonce((n) => n + 1);
          }}
          rightInset={rightOpen ? 360 : 0}
          leftInset={drawerOpen ? 300 : 0}
        />
        </PanelBoundary>
      )}

      {/* ── ONBOARDING (R9): the "claim your space" first-run moment ──────────
          Mounts only when personal space is on AND this browser hasn't
          onboarded (or the handle chip re-opened it). The flow is DB-safe: it
          pre-fills a deterministic local handle, and claimHandle returns
          'unavailable' (never throws) on a pre-migration DB, so Keep / Reroll /
          Type / Skip all settle locally and the visitor enters the desk. The
          overlay is its own fixed scrim above all desk chrome. */}
      {personalSpaceOn && showOnboarding && (
        <PanelBoundary label="onboarding" variant="popup" onDismiss={() => setShowOnboarding(false)}>
          <OnboardingFlow onDone={finishOnboarding} />
        </PanelBoundary>
      )}
      {personalSpaceOn && profileTarget && (
        <ProfileShelfPopover
          ownerId={profileTarget.ownerId}
          handle={profileTarget.handle}
          onClose={() => setProfileTarget(null)}
          onBack={
            profileTarget.back
              ? () => {
                  const b = profileTarget.back!;
                  setProfileTarget(null);
                  setActiveSurface(b); // return to the doodle (infinite-modal back)
                }
              : undefined
          }
        />
      )}
    </div>
    </Canvas3DProvider>
  );
}
