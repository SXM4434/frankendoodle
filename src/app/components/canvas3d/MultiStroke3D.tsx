import { useCallback, useState, type CSSProperties, type MutableRefObject, type RefObject } from 'react';
import { Canvas } from '@react-three/fiber';
import { View, PerspectiveCamera } from '@react-three/drei';
import { Stroke3DContents, resolvePaperHex, type SvgPortBuildOpts, type TumbleState } from './Stroke3DScene';
import { attachContextLossHandlers } from './contextLoss';
import { INK_3D_DEFAULT, type MaterialPresetId, type NativeProps3D } from './materials3d';
import type { Mode3DParams } from './modeParams';
import type { HatchInputs } from './hatchMaterial';
import type {
  GeometryModeSetting,
  StrokeInputPoint,
  ViewBoxSize,
} from '../../lib/geometry3d/strokeTo3d';

// ─── Shared-canvas 3D — ONE WebGL context, N scissored viewports (drei <View>) ─
// THE flip-all-3D engine. The per-object DeskObject3DMount/Live3DMount each spin
// their OWN <Canvas> (= one WebGL context each); a browser caps live contexts
// (~16), so flipping a whole desk/drawer/shelf to 3D at once exhausts them and
// crashes (the CubeCamera/context error). This renders EVERY object through a
// SINGLE shared canvas using drei's <View> (gl.setScissor per object) — so the
// context count is always 1, the cap is gone, and any number of objects flip to
// 3D at once, each independently rotatable (Sebs 2026-06-14: "flip ALL without
// this happening"; the old per-object cap was the "cheap solution that looks
// stupid").
//
// ── HOW IT FITS TOGETHER ────────────────────────────────────────────────────
// drei's inline <View> (rendered OUTSIDE a Canvas) renders the SLOT div itself
// AND tunnels its 3D children into whichever <Canvas> contains <View.Port/>.
// So a consumer:
//   1. wraps its surface in a positioned container (ref),
//   2. renders an <Object3DView> as each object's art well (the View = the slot),
//   3. renders ONE <Shared3DCanvas containerRef={ref}/> as an overlay.
// No per-object ref juggling — each View tracks its own div's on-screen rect
// every frame (so it follows scroll, desk pan AND CSS scale).
//
// ── STREAMING / CULLING (Sebs's N64 idea) ──────────────────────────────────
// drei <View> already culls OFF-SCREEN views (its useFrame skips gl.render when
// the tracked rect is outside the canvas), so a scrolling drawer / panned desk
// only PAINTS what's on screen — load-near, unload-far, seamless, for free. The
// consumer owns the second half: pass an <Object3DView> only for objects within
// viewport+margin so far ones don't even build geometry. Never all-at-once.
//
// ── MAKE-SAFE ───────────────────────────────────────────────────────────────
// @react-three/drei is verified in Figma Make (20-research-figma-make-
// capabilities). eventSource is a consumer-owned REF (never
// document.getElementById — no assumption about Make's root DOM). The canvas is
// mounted PER PAGE (consumer unmounts on route change), sidestepping drei #1053
// ("OrbitControls dies after react-router nav" — that bites a persistent
// app-root canvas, not per-page mounts).

/** Scene inputs for one object — pre-resolved by the consumer (from a saved
 *  render_config via resolveScene3DInputs, or the live Canvas3D chrome). Kept
 *  context-free so the same component serves desk / drawer / shelf. */
export interface Object3DViewProps {
  strokes: StrokeInputPoint[][];
  viewBox?: ViewBoxSize;
  geometryMode?: GeometryModeSetting;
  style3d?: 'native' | 'hatch' | 'svg-port';
  materialPreset?: MaterialPresetId;
  nativeProps?: NativeProps3D;
  modeParams?: Mode3DParams;
  hatchInputs?: HatchInputs;
  svgPortMarkup?: string;
  /** svg-port BUILD controls — flip-MANY surfaces (desk/drawer) gate + size the
   *  carve build so a whole-desk restyle doesn't rebuild every object at full
   *  res, and pass the active style for the per-style relief profile. */
  svgPortBuild?: SvgPortBuildOpts;
  /** Hard-path AI mesh GLB — renders in place of the local form when set (so a
   *  placed AI-mesh object shows its MESH in 3D on the desk, not the local form). */
  hardMeshUrl?: string;
  /** Per-object AI-mesh look override (saved render_config.aiMesh) — the maker's
   *  Material/Darkness/Auto-spin, so each placed mesh keeps its own look instead
   *  of the shared 3D context's. */
  aiMeshLook?: { materialMode?: 'greyscale' | 'og-pbr' | 'hatch' | 'native' | 'svg-port'; dark?: number; contrast?: number; autoSpin?: boolean };
  /** Drag-rotate this object. Default true (the point of flip-all 3D). */
  orbit?: boolean;
  /** Per-object manual tumble (desk rotate-HANDLE). When set the form follows
   *  {az,el} from this ref and orbit stays off — body drags MOVE, handle drags
   *  ROTATE (Sebs 2026-06-27). Forwarded to Stroke3DContents. */
  tumbleRef?: MutableRefObject<TumbleState> | null;
  /** The slot box — positions/sizes this object's viewport (the View renders
   *  this div, drei scissors the canvas to match its on-screen rect). */
  style?: CSSProperties;
}

/** One object's viewport in the shared canvas. Render it where the object's 2D
 *  art would go (a drawer grid cell, the desk's positioned footprint). */
export function Object3DView({
  strokes,
  viewBox,
  geometryMode,
  style3d,
  materialPreset,
  nativeProps,
  modeParams,
  hatchInputs,
  svgPortMarkup,
  svgPortBuild,
  hardMeshUrl,
  aiMeshLook,
  orbit = true,
  tumbleRef,
  style,
}: Object3DViewProps) {
  // One-shot paper resolve (WebGL can't read CSS vars) — each view's bg.
  const [paper] = useState(resolvePaperHex);
  // THIS view's slot div — the View's ref (HtmlView) IS the tracking div. We bind
  // the drag-rotate controls to it explicitly (controlsDomElement) because the
  // shared canvas is pointerEvents:none and drei's implicit events.connected is
  // unreliable across N views (that silently broke rotation). Stable callback ref
  // (useCallback []) so it doesn't detach/reattach every render.
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const slotRef = useCallback((el: HTMLElement | null) => setSlotEl(el), []);
  return (
    // The View IS the slot div; its children tunnel into <Shared3DCanvas>'s
    // <View.Port/>. pointerEvents auto so drag-rotate reaches this view's
    // controls (the overlay canvas is pointerEvents:none — events fall here).
    <View ref={slotRef as never} style={{ width: '100%', height: '100%', pointerEvents: orbit ? 'auto' : 'none', ...style }}>
      {/* Each view needs its OWN camera (makeDefault) so CameraFramer frames
          THIS object to ITS slot — without it every view shares the root camera
          and the framing fights. */}
      <PerspectiveCamera makeDefault position={[0, 1.5, 7]} fov={40} />
      <Stroke3DContents
        strokes={strokes}
        viewBox={viewBox}
        geometryMode={geometryMode}
        style3d={style3d}
        materialPreset={materialPreset}
        nativeProps={nativeProps}
        modeParams={modeParams}
        hatchInputs={hatchInputs}
        svgPortMarkup={svgPortMarkup}
        svgPortBuild={svgPortBuild}
        hardMeshUrl={hardMeshUrl}
        aiMeshLook={aiMeshLook}
        bg={paper}
        ink={INK_3D_DEFAULT}
        transparent
        orbit={orbit}
        controlsDomElement={slotEl}
        tumbleRef={tumbleRef}
      />
    </View>
  );
}

export interface Shared3DCanvasProps {
  /** The element owning pointer events for ALL views — must contain both the
   *  canvas and every <Object3DView> slot (the desk viewport / drawer scroll). */
  containerRef: RefObject<HTMLElement | null>;
  /** Transparent (no white/black box) so objects sit on the paper. Default true. */
  transparent?: boolean;
}

/** The single shared canvas + the View.Port that collects every <Object3DView>
 *  on the page. Mount it ONCE as an absolute overlay inside the container whose
 *  ref is `containerRef`. Only mount it while something is in 3D (an empty
 *  canvas is still one idle GL context). */
export function Shared3DCanvas({ containerRef, transparent = true }: Shared3DCanvasProps) {
  return (
    <Canvas
      // eventSource = the container; eventPrefix 'client' because the canvas is
      // an offset overlay, so pointer coords are client-relative (drei maps them
      // per-view against each slot's rect).
      eventSource={containerRef as unknown as MutableRefObject<HTMLElement>}
      eventPrefix="client"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: transparent }}
      onCreated={({ gl, scene }) => {
        // Recover from a soft WebGL context loss instead of going black.
        attachContextLossHandlers(gl);
        if (transparent) {
          // alpha:true alone clears OPAQUE black — force clear-alpha 0 + null
          // background so the paper shows through.
          gl.setClearColor(0x000000, 0);
          scene.background = null;
        }
      }}
      // OVERSIZED to 150% (overhangs the surface by 25% on each side) so drei
      // <View>'s off-screen cull boundary sits BEYOND the visible edge — an object
      // near the desk edge is then well inside the canvas and keeps PAINTING
      // instead of popping out (Sebs 2026-06-18: "popping/disappear at the edge").
      // STILL clipped to the surface: the container (desk/drawer main) is a SIBLING
      // of the panel and is position:relative + overflow:hidden, so the oversized
      // canvas — and every scissored view — is clipped to the surface box and can
      // never touch the chrome (the original "objects covering UI" guard holds via
      // the container's overflow, not the canvas size). Transparent + pointerEvents
      // none; events route via eventSource (eventPrefix 'client' maps correctly
      // against each slot's client rect regardless of the canvas's own offset).
      style={{ position: 'absolute', left: '-25%', top: '-25%', width: '150%', height: '150%', pointerEvents: 'none', zIndex: 1 }}
      camera={{ position: [0, 1.5, 7], fov: 40 }}
    >
      <View.Port />
    </Canvas>
  );
}

export default Shared3DCanvas;
