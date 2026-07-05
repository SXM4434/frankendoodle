import {
  Component,
  Fragment,
  Suspense,
  lazy,
  memo,
  useMemo,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import type { StrokeInputPoint } from '../../lib/geometry3d/strokeTo3d';
import {
  resolveScene3DInputs,
  type Geometry3DConfig,
} from '../../lib/geometry3d/deskRenderMode';
import type { SvgPortBuildOpts, TumbleState } from '../canvas3d/Stroke3DScene';
import { useCanvas3D } from '../../state/Canvas3DContext';
import { useF3RoughModifiersOptional, DEFAULT_MODIFIERS } from '../../state/F3RoughModifiersContext';

// ─── DeskObject3DMount — the desk's per-object 3D render slot ─────────────────
// Gap-hunt H3 SCAFFOLD (docs/design/desk-flip-2d3d-seam.md §3 "the desk mount").
// The /canvas flip lives in DeskDoodlesCanvas.tsx, which lazy-loads Stroke3DScene
// and feeds it the LIVE in-memory strokes. A PLACED desk object has no such
// mount — DeskObjectArt only ever renders the 2D SvgStyleTransform subtree. This
// component is the missing 3D slot: given a placed object's stored strokes + its
// Geometry3DConfig (from render_config), it renders the SAME Stroke3DScene the
// /canvas flip uses, sourced from the RECORD instead of the live context.
//
// ── WHY A SEPARATE COMPONENT (not inline in DeskObjectArt) ──────────────────
// DeskObjectArt is in a HOT file (DeskPage.tsx, under active edit per the round
// ledger). Keeping the 3D mount here means the wiring at the seam is ONE branch
// in DeskObjectArt's render: `renderMode === '3d' ? <DeskObject3DMount …/> :
// <the existing 2D subtree>`. That one line is FLAGGED for the queue
// (desk-flip-2d3d-seam.md §"Wiring to flag"); this file is fully additive.
//
// ── LAZY CHUNK DISCIPLINE (matches DeskDoodlesCanvas) ───────────────────────
// Importing Stroke3DScene's VALUES pulls three + drei (~600KB gz) into the
// importer's chunk. DeskDoodlesCanvas keeps three out of the main chunk via
// React.lazy(() => import('../canvas3d')); this mount does the SAME so /desk's
// initial paint never ships three until an object actually renders in 3D. Only
// type-only imports above touch geometry3d (erased at compile).
//
// ── INTERACTION SCOPE (scaffold honesty) ────────────────────────────────────
// v1 of this mount is a STILL 3D render in the object's desk footprint: it
// shows the form, lit, in the object's own Geometry3DConfig. Whether desk
// objects get live per-object orbit (each a mini OrbitControls canvas) or a
// single shared desk camera is a DESIGN decision flagged for Sebs in the design
// doc — Stroke3DScene supports orbit, but N live R3F canvases on one desk is a
// perf question (3d-roundtrip-build-plan §5 risk 6 budgets ONE composer pass).
// This scaffold mounts the scene with orbit OFF by default via the `interactive`
// prop, so it's cheap and deterministic until that decision lands.

const Stroke3DSceneLazy = lazy(() => import('../canvas3d'));

// ── SHARED-CANVAS flip-all (one WebGL context, N drei <View>s) ───────────────
// Live3DMount/DeskObject3DMount each spin their OWN <Canvas> — fine for a single
// object (edit modal, preview), but N of them on a desk/drawer/shelf exhaust the
// ~16-context browser limit and crash. These two lazy wrappers drive the SHARED
// canvas (MultiStroke3D) so any number of objects flip to 3D at once. Same lazy
// chunk discipline — three/drei stay out of the main bundle until 3D is used.
const Object3DViewLazy = lazy(() =>
  import('../canvas3d/MultiStroke3D').then((m) => ({ default: m.Object3DView })),
);
const Shared3DCanvasLazy = lazy(() =>
  import('../canvas3d/MultiStroke3D').then((m) => ({ default: m.Shared3DCanvas })),
);

/** Mirror of canvas3d MAX_STROKES_3D — kept by hand (importing the real
 *  constant would defeat the lazy chunk, same note as DeskDoodlesCanvas). */
const MAX_STROKES_3D = 60;

// ─── Canvas3DBoundary — self-healing 3D fence (auto-retry → fallback) ─────────
// Every 3D mount here needs a WebGL context. In Make's sandboxed editor-preview
// iframe, acquiring it on a cold load is a RACE (same family as the Rapier cold-
// load issue): the first mount can lose the race and react-three-fiber throws
// while building the scene (`reading 'fg'` at createInstance) — which, unfenced,
// bubbles to React Router and white-screens the WHOLE route. The published site
// warms up fine; the preview is the flake. So instead of giving up, this fence:
//   1. AUTO-RETRIES — on a 3D throw it shows `fallback`, waits a short backoff
//      (150 → 400 → 1000ms), then REMOUNTS the 3D (fresh key). The retry almost
//      always lands on a now-warm context, so 3D appears on its own.
//   2. FALLS BACK gracefully — only after the retries are spent does it stay on
//      `fallback`. Never a white-screen.
// PROVEN: the homepage uses an identical boundary and Sebs confirmed it self-heals
// in Make's preview (2026-06-15). This is the shared copy for the desk / drawer /
// per-object mounts. (Homepage keeps its own validated copy to avoid re-uploading
// that file; consolidate post-makeathon.)
const CANVAS3D_BACKOFFS_MS = [150, 400, 1000];
export class Canvas3DBoundary extends Component<
  { fallback?: ReactNode; children: ReactNode },
  { down: boolean; attempt: number }
> {
  state = { down: false, attempt: 0 };
  private timer: number | undefined;
  static getDerivedStateFromError() {
    return { down: true };
  }
  componentDidCatch() {
    if (this.state.attempt < CANVAS3D_BACKOFFS_MS.length) {
      this.timer = window.setTimeout(() => {
        this.setState((s) => ({ down: false, attempt: s.attempt + 1 }));
      }, CANVAS3D_BACKOFFS_MS[this.state.attempt]);
    }
  }
  componentWillUnmount() {
    if (this.timer) window.clearTimeout(this.timer);
  }
  render() {
    if (this.state.down) return <>{this.props.fallback ?? null}</>;
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}

export interface DeskObject3DMountProps {
  /** The object's stored source strokes (render_config.strokes), viewBox coords.
   *  Pre-validated by the caller via flipEligibility — a 3d-mode object always
   *  has flippable strokes (the convert action gates on it). */
  strokes: StrokeInputPoint[][];
  /** The object's persisted 3D inputs (render_config.geometry3d). Undefined ⇒
   *  tuned defaults (resolveScene3DInputs fills them in). */
  config?: Geometry3DConfig | null;
  /** Source viewBox for the strokes. Default 800×600 (draw surface space). */
  viewBox?: { w: number; h: number };
  /** Whether the mount allows orbit. Default false (still render) — see the
   *  interaction-scope note above; the desk-wide decision is flagged for Sebs. */
  interactive?: boolean;
  /** Transparent canvas — the doodle sits on the desk/page instead of a white
   *  box (Sebs 2026-06-14). Default false (the panel-well keeps its paper). */
  transparent?: boolean;
  /** Show the "treat as closed?" chips. Default false (preview surfaces). */
  showChips?: boolean;
  /** svg-port carve source: the styled 2D drawing markup. REQUIRED for any
   *  `style3d:'svg-port'` config to actually carve — without it the carve effect
   *  early-returns and the form renders as an uncarved blob (R10 unblock). The
   *  caller provides it (e.g. the homepage's already-computed shape markup) so
   *  this mount never imports the heavy DrawSurface helper into its chunk. */
  svgPortMarkup?: string;
  /** svg-port BUILD controls (perf gate + per-style relief) — set by a flip-MANY
   *  surface (desk/drawer) so a whole-desk restyle gates the carve build to
   *  on-screen objects, sizes thumbnails small, and passes the active style. */
  svgPortBuild?: SvgPortBuildOpts;
  /** Hard-path AI mesh GLB url — when set, the scene renders this GLB in place of
   *  the local geometry (modal-only opt-in; dormant until the chip generates it). */
  hardMeshUrl?: string;
  /** Per-object AI-mesh look (saved render_config.aiMesh) — Material/Darkness/
   *  Auto-spin the maker set, so a placed mesh keeps its own look on the desk. */
  aiMeshLook?: { materialMode?: 'greyscale' | 'og-pbr' | 'hatch' | 'native' | 'svg-port'; dark?: number; contrast?: number; autoSpin?: boolean };
  /** Per-object manual tumble (the desk rotate-HANDLE). When set the form spins
   *  to {az,el} from this ref and orbit stays off — body drags MOVE, handle drags
   *  ROTATE (Sebs 2026-06-27). Desk slots only; the modal/preview omit it. */
  tumbleRef?: MutableRefObject<TumbleState> | null;
  /** Footprint — the desk object's ~180px box. The Canvas fills this. */
  style?: CSSProperties;
}

/** A quiet still placeholder shown while the lazy three chunk + scene load — no
 *  layout jump (fills the same footprint). Paper-toned so it reads as "the
 *  object is becoming 3D", not an error. */
function Mount3DFallback() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--dir-raised)',
        borderRadius: 8,
        fontSize: 10,
        fontStyle: 'italic',
        color: 'var(--dir-text-body-soft)',
      }}
    >
      lifting into 3D…
    </div>
  );
}

export const DeskObject3DMount = memo(function DeskObject3DMount({
  strokes,
  config,
  viewBox = { w: 800, h: 600 },
  interactive = false,
  transparent = false,
  showChips,
  svgPortMarkup,
  hardMeshUrl,
  style,
}: DeskObject3DMountProps) {
  // Resolve the record's (possibly partial) 3D config to the full prop bundle
  // Stroke3DScene needs — same fallbacks the /canvas Canvas3DContext applies.
  const resolved = useMemo(() => resolveScene3DInputs(config), [config]);
  // Cap the pool the same way /canvas does (perf budget, plan §5 risk 6).
  const pool = useMemo(
    () => strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES_3D),
    [strokes],
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
     <Canvas3DBoundary fallback={<Mount3DFallback />}>
      <Suspense fallback={<Mount3DFallback />}>
        <Stroke3DSceneLazy
          strokes={pool}
          viewBox={viewBox}
          geometryMode={resolved.geometryMode}
          style3d={resolved.style3d}
          materialPreset={resolved.materialPreset}
          nativeProps={resolved.nativeProps}
          modeParams={resolved.modeParams}
          initialTreatAsClosed={resolved.initialTreatAsClosed}
          // svg-port carve source (R10): without this, style3d:'svg-port' renders
          // an uncarved blob — the engraving effect keys off this markup.
          svgPortMarkup={svgPortMarkup}
          hardMeshUrl={hardMeshUrl}
          // Hatch grammar/direction from the resolved config so hatch styles
          // render their actual grammar (contour/cross-hatch/stipple), not the
          // default hachure (mirrors Live3DMount's hatchInputs wiring).
          hatchInputs={{
            hachureGap: 4,
            hachureAngle: -41,
            strokeWidth: 1.2,
            inkIntensity: 1.0,
            grammar: resolved.hatchGrammar,
            direction: resolved.hatchDirection,
          }}
          transparent={transparent}
          // Thumbnail = static framed object (no orbit/zoom) unless interactive.
          orbit={interactive}
          // The "Open-ish — treat as closed?" chips are an INTERACTIVE
          // correction (each tap is logged). Default off for non-interactive
          // previews; explicit showChips wins when the host wants them.
          showAmbiguityChips={showChips ?? interactive}
          style={{ width: '100%', height: '100%', pointerEvents: interactive ? 'auto' : 'none' }}
        />
      </Suspense>
     </Canvas3DBoundary>
    </div>
  );
});

// ─── Live3DMount — the SAME scene, but LIVE-driven by Canvas3DContext ─────────
// The static mount above reads a doodle's SAVED render_config. This one reads the
// LIVE Canvas3D chrome (useCanvas3D) so the full 3D control set (geometry /
// material / style / hatch — Canvas3DChrome) drives the render in real time, the
// same way /canvas does. Use it under a <Canvas3DProvider> + <Canvas3DChrome>
// (the edit modal, the gallery, the desk-wide 3D lens) so "the rest of the 3D
// toggles from canvas" work everywhere, not just /canvas (Sebs 2026-06-14).
export const Live3DMount = memo(function Live3DMount({
  strokes,
  viewBox = { w: 800, h: 600 },
  transparent = false,
  interactive = false,
  showChips,
  style,
  svgPortMarkup, // svg-port carve source — wire the object's styled 2D so svg-port
                 // LIVES the drawing here too (was unwired → plain slab on the desk/modal)
  svgPortBuild,  // svg-port build controls — modal passes { styleId } for per-style relief
  hardMeshUrl,   // hard-path AI mesh GLB — renders in place of the local form when set
}: Omit<DeskObject3DMountProps, 'config'>) {
  const {
    geometryMode,
    style3d,
    materialPreset,
    nativeProps,
    modeParams,
    hatchGrammar,
    hatchDirection,
    reliefDepth,
    reliefCsg,
  } = useCanvas3D();
  // 2D Shading sliders → 3D hatch micro-dials ("one math, two renderers"). Optional
  // (falls back to DEFAULT_MODIFIERS = the prior hardcoded values) so a provider-less
  // preview mount stays byte-identical.
  const mods = useF3RoughModifiersOptional()?.state ?? DEFAULT_MODIFIERS;
  const pool = useMemo(
    () => strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES_3D),
    [strokes],
  );
  // Fold the global deep-relief depth + wall style (3D-controls) into the bundle.
  const svgPortBuildWithDepth = useMemo(
    () => ({ ...(svgPortBuild ?? {}), reliefDepth, reliefCsg }),
    [svgPortBuild, reliefDepth, reliefCsg],
  );
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
     <Canvas3DBoundary fallback={<Mount3DFallback />}>
      <Suspense fallback={<Mount3DFallback />}>
        <Stroke3DSceneLazy
          strokes={pool}
          viewBox={viewBox}
          geometryMode={geometryMode}
          style3d={style3d}
          materialPreset={materialPreset}
          nativeProps={nativeProps}
          modeParams={modeParams}
          svgPortMarkup={svgPortMarkup}
          svgPortBuild={svgPortBuildWithDepth}
          hardMeshUrl={hardMeshUrl}
          hatchInputs={{
            // Live 2D Shading values drive the 3D hatch dials (one math); grammar/
            // direction from Canvas3D. wobble + fillStyle additionally PORT the 2D pen
            // onto the AI-mesh svg-port line-art (Sebs 2026-06-28 "ports over ALL the
            // SVG stuff"). Defaults keep Native/SVG-port-default unaffected.
            hachureGap: mods.hachureGap,
            hachureAngle: mods.hachureAngle,
            strokeWidth: mods.strokeWidth,
            inkIntensity: mods.inkIntensity,
            wobble: mods.wobble,
            fillStyle: mods.fillStyle,
            fillOpacity: mods.fillOpacity,
            grammar: hatchGrammar,
            direction: hatchDirection,
          }}
          transparent={transparent}
          orbit={interactive}
          showAmbiguityChips={showChips ?? interactive}
          style={{ width: '100%', height: '100%', pointerEvents: interactive ? 'auto' : 'none' }}
        />
      </Suspense>
     </Canvas3DBoundary>
    </div>
  );
});

// ─── Shared3DOverlay + LiveObject3DSlot — the FLIP-ALL path ───────────────────
// A surface that flips MANY objects to 3D (desk, drawer grid, shelf grid) mounts
// ONE <Shared3DOverlay> over its container and renders a <LiveObject3DSlot> in
// each object's art well. All slots draw into the overlay's single shared canvas
// (drei <View>) — so the live GL-context count stays at 1 no matter how many
// objects are 3D (kills the per-object-canvas crash + the cheap first-N cap).
// drei <View> auto-culls off-screen slots, so only on-screen objects paint
// (Sebs's N64 load-near/unload-far, seamless). Both are LIVE-driven by
// Canvas3DContext, exactly like Live3DMount — so the surface's Canvas3DChrome
// restyles every object at once.

/** Mount ONCE as an absolute overlay inside a 3D surface's (position:relative)
 *  container. Pass that container's ref so pointer events route to each slot's
 *  controls. Only render it while the surface is actually in 3D. */
export function Shared3DOverlay({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  return (
    <Suspense fallback={null}>
      <Shared3DCanvasLazy containerRef={containerRef} />
    </Suspense>
  );
}

/** One object's 3D viewport inside the shared overlay canvas — drop-in for
 *  Live3DMount on a surface that hosts a <Shared3DOverlay>, but it draws into
 *  the ONE shared canvas instead of spinning its own. LIVE-driven by
 *  Canvas3DContext (the same chrome Live3DMount reads). */
export const LiveObject3DSlot = memo(function LiveObject3DSlot({
  strokes,
  viewBox = { w: 800, h: 600 },
  interactive = true,
  style,
  svgPortMarkup, // svg-port carve source per desk object (else svg-port = plain slab)
  svgPortBuild, // svg-port build gate/res/style (perf + per-style relief)
  hardMeshUrl, // per-object AI mesh GLB → shows the MESH in 3D on the desk
  aiMeshLook, // per-object saved AI-mesh look (Material/Darkness/Auto-spin)
  config, // per-object SAVED local-3D look (render_config.geometry3d) — overrides the live context
  tumbleRef, // per-object rotate-HANDLE orientation (body=move, handle=rotate)
}: Pick<DeskObject3DMountProps, 'strokes' | 'viewBox' | 'interactive' | 'style' | 'svgPortMarkup' | 'svgPortBuild' | 'hardMeshUrl' | 'aiMeshLook' | 'config' | 'tumbleRef'>) {
  const ctx = useCanvas3D();
  // PER-OBJECT 3D LOOK vs GLOBAL SWEEP:
  // • Until the user touches the global geometry control, an object the maker
  //   saved a 3D look on (config.geometry3d) renders with THAT look; un-saved
  //   objects follow the live desk context (Sebs 2026-06-16: "3d edits don't
  //   appear for normal 3d objects").
  // • Once they touch it (ctx.geometryEngaged), the LIVE chrome sweeps EVERY
  //   object — "change the global geometry → restyle the whole desk" (Sebs
  //   2026-06-18). We do that by dropping the saved source to null while engaged,
  //   so all axes fall through to the live ctx. The saved render_config is left
  //   untouched and restores on the next desk mount (geometryEngaged resets).
  const savedRaw = useMemo(() => (config ? resolveScene3DInputs(config) : null), [config]);
  const saved = ctx.geometryEngaged ? null : savedRaw;
  const geometryMode = saved?.geometryMode ?? ctx.geometryMode;
  const style3d = saved?.style3d ?? ctx.style3d;
  const materialPreset = saved?.materialPreset ?? ctx.materialPreset;
  const nativeProps = saved?.nativeProps ?? ctx.nativeProps;
  const modeParams = saved?.modeParams ?? ctx.modeParams;
  const hatchGrammar = saved?.hatchGrammar ?? ctx.hatchGrammar;
  const hatchDirection = saved?.hatchDirection ?? ctx.hatchDirection;
  // 2D Shading sliders → 3D hatch micro-dials (one math; optional → DEFAULT_MODIFIERS
  // = the prior hardcoded values, so byte-identical when no provider/at default).
  const mods = useF3RoughModifiersOptional()?.state ?? DEFAULT_MODIFIERS;
  const pool = useMemo(
    () => strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES_3D),
    [strokes],
  );
  // Fold the global DEEP-RELIEF depth (the 3D-controls slider) into the build
  // bundle — it's a live global control, never per-object saved.
  const svgPortBuildWithDepth = useMemo(
    () => ({ ...(svgPortBuild ?? {}), reliefDepth: ctx.reliefDepth, reliefCsg: ctx.reliefCsg }),
    [svgPortBuild, ctx.reliefDepth, ctx.reliefCsg],
  );
  return (
    <Suspense fallback={<Mount3DFallback />}>
      <Object3DViewLazy
        strokes={pool}
        viewBox={viewBox}
        geometryMode={geometryMode}
        style3d={style3d}
        materialPreset={materialPreset}
        nativeProps={nativeProps}
        modeParams={modeParams}
        svgPortMarkup={svgPortMarkup}
        svgPortBuild={svgPortBuildWithDepth}
        hardMeshUrl={hardMeshUrl}
        aiMeshLook={aiMeshLook}
        hatchInputs={{
          hachureGap: mods.hachureGap,
          hachureAngle: mods.hachureAngle,
          strokeWidth: mods.strokeWidth,
          inkIntensity: mods.inkIntensity,
          wobble: mods.wobble,
          fillStyle: mods.fillStyle,
          fillOpacity: mods.fillOpacity,
          grammar: hatchGrammar,
          direction: hatchDirection,
        }}
        orbit={interactive}
        tumbleRef={tumbleRef}
        style={style}
      />
    </Suspense>
  );
});

// ─── Object3DSlot — prop-driven sibling of LiveObject3DSlot (SHARED canvas) ────
// Same shared-canvas slot as LiveObject3DSlot (one WebGL context via drei <View>),
// but reads an EXPLICIT per-object config (resolveScene3DInputs) instead of the
// live Canvas3D chrome. So a surface can show MANY objects each in its OWN 3D
// style through ONE context — the homepage hero (each doodle a distinct 3D look)
// without N <Canvas> elements. The per-object DeskObject3DMount worked locally
// (under the ~16-context cap) but Make's iframe has a tighter cap → the homepage
// hit "THREE.WebGLRenderer: Context Lost" + the R3F connect/null cascade. Drop-in
// for DeskObject3DMount on a surface that hosts a <Shared3DOverlay>.
export const Object3DSlot = memo(function Object3DSlot({
  strokes,
  config,
  viewBox = { w: 800, h: 600 },
  interactive = true,
  svgPortMarkup,
  style,
}: DeskObject3DMountProps) {
  const resolved = useMemo(() => resolveScene3DInputs(config), [config]);
  const pool = useMemo(
    () => strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES_3D),
    [strokes],
  );
  // A placed AI-mesh object persists its GLB in render_config.hardMeshUrl → show
  // the MESH in 3D on the desk (not the local form). Local objects = undefined.
  const hardMeshUrl =
    config && typeof (config as Record<string, unknown>).hardMeshUrl === 'string'
      ? ((config as Record<string, unknown>).hardMeshUrl as string)
      : undefined;
  const aiMeshLook =
    config && typeof (config as Record<string, unknown>).aiMesh === 'object'
      ? ((config as Record<string, unknown>).aiMesh as { materialMode?: 'greyscale' | 'og-pbr' | 'hatch' | 'native' | 'svg-port'; dark?: number; contrast?: number; autoSpin?: boolean })
      : undefined;
  return (
    <Suspense fallback={<Mount3DFallback />}>
      <Object3DViewLazy
        strokes={pool}
        viewBox={viewBox}
        geometryMode={resolved.geometryMode}
        style3d={resolved.style3d}
        materialPreset={resolved.materialPreset}
        nativeProps={resolved.nativeProps}
        modeParams={resolved.modeParams}
        hatchInputs={{
          hachureGap: 4,
          hachureAngle: -41,
          strokeWidth: 1.2,
          inkIntensity: 1.0,
          grammar: resolved.hatchGrammar,
          direction: resolved.hatchDirection,
        }}
        svgPortMarkup={svgPortMarkup}
        hardMeshUrl={hardMeshUrl}
        aiMeshLook={aiMeshLook}
        orbit={interactive}
        style={style}
      />
    </Suspense>
  );
});
