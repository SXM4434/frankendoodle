import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject, ReactNode } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
  PerspectiveCamera,
  TrackballControls,
} from '@react-three/drei';
import * as THREE from 'three';
// Subdivides the boundary-only Earcut cap so displacementMap has interior
// vertices to push (real carved relief, not bump-only). three example modifier
// — no new dep (rides the already-lazy 3D chunk).
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import {
  DEFAULT_VIEWBOX,
  INFLATE_BASE_RADIUS,
  INFLATE_PRESSURE_INFLUENCE,
  INFLATE_PROFILE_EXP,
  INFLATE_TIP_RADIUS,
  JOINT_ANGLE_THRESHOLD_DEG,
  ROD_RADIUS,
  SOLID_INK_RADIUS,
  SPHERE_SEGMENTS,
  TREATED_AS_CLOSED_DEFAULT,
  WORLD_SCALE,
  buildExtrudeGeometry,
  buildExtrudeGeometryWithHoles,
  buildInflateGeometry,
  buildPoolSolidGeometry,
  buildRodGeometry,
  closureStateOf,
  extractPressures,
  isClosedStroke,
  isSolidFamilyClosure,
  normalizeStrokePoints,
  poolCenter,
  rdpPoints,
  resolveGeometryMode,
  strokeSignature,
  strokesKey,
  type GeometryModeSetting,
  type StrokeGeometryResult,
  type StrokeInputPoint,
  type ViewBoxSize,
} from '../../lib/geometry3d/strokeTo3d';
import { pushClosureCorrection } from '../../lib/smart/conversionMap';
import { svgMarkupToPolylinesFast } from '../../lib/svgPathFlatten';
import { applyDeepCsgRelief } from '../../lib/geometry3d/csg';
import { HardMesh } from './HardMesh';
import { attachContextLossHandlers } from './contextLoss';
import { useCanvas3D } from '../../state/Canvas3DContext';
import { COVERAGE_BANDS } from '../../lib/smart/coverage';
import type { ToneFill } from '../../lib/toneMask';
import {
  DEFAULT_MODE3D_PARAMS,
  INFLATE_PROFILE_FAMILY_PRESETS,
  extrudeBevelAutoDisabled,
  extrudeEffectiveDepth,
  inflatePuffAspectZ,
  type Mode3DParams,
} from './modeParams';
import { rodAdornmentSpecs, type RodAdornmentSpec } from './rodAdornments';
import {
  INK_3D_DEFAULT,
  MATERIAL_PARAMS_3D,
  MODE_MATERIAL_DEFAULTS_3D,
  DEFAULT_NATIVE_PROPS_3D,
  applyNativeProps,
  type MaterialPresetId,
  type NativeProps3D,
} from './materials3d';
import {
  createHatchMaterial,
  updateHatchUniforms,
  updateHatchLightDir,
  fillStyleToMode,
  type HatchInputs,
} from './hatchMaterial';
import {
  buildDrawingReliefTexture,
  buildSvgPortTexture,
  applyPlanarReliefUVs,
  displaceFrontCapByHeight,
  sealedReliefOn,
  sealedReliefScale,
  RELIEF_BUMP_SCALE,
  RELIEF_DISPLACEMENT_SCALE,
  SVGPORT_DISPLACEMENT_SCALE,
  type SvgPortTextureResult,
} from './drawingTexture';

// ─── Stroke3DScene — R3F scene for the stroke→3D round-trip ────────────────
// Round-7 chrome-split build (docs/design/3d-mode-controls-spec.md): the scene
// now consumes the FULL per-mode param sets + the 3-style taxonomy:
//   · Native   — FS MeshPhysicalMaterial presets (materials3d.ts, D-C)
//   · Hatch    — band-quantized procedural hachure, uniforms from the LIVE 2D
//                Shading sliders (hatchMaterial.ts — one math, two renderers)
//   · SVG-port — M8 v1: same band machinery + the 2D chrome's mark grammar
//                (fillStyle/wobble/fillOpacity) + ink EdgesGeometry outline.
// Self-contained: the wiring layer (DeskDoodlesCanvas / chrome) passes strokes
// + params — this file reads no app contexts.
//
// Determinism: no unseeded randomness, no wall-clock reads. Same strokes +
// props → same scene.

const WARM_PAPER_FALLBACK = '#FDFCF9'; // theme.css --dir-bg (light direction)

/** svg-port BUILD controls — threaded from a flip-MANY surface (desk/drawer) so
 *  a whole-desk restyle doesn't rebuild every object's carve texture at full res
 *  (the lag). Omitted ⇒ full res + always build (single-object modal/preview). */
export interface SvgPortBuildOpts {
  /** Build the heavy texture ONLY when on-screen; off-screen objects keep their
   *  warm texture and rebuild on scroll-in (Sebs's N64 load-near/unload-far). */
  inView?: boolean;
  /** Texture long-edge in px (thumbnails ~512 vs the modal's 1024·dpr). */
  longEdge?: number;
  /** Active F3 svg-style id → the per-style carve profile (distinct relief). */
  styleId?: string;
  /** DEEP RELIEF depth (Sebs 2026-06-21, the 3D-controls slider). >0 CPU-displaces
   *  the welded front cap by the height field for REAL geometry depth (no tearing),
   *  and the GPU shallow displacementMap is dropped. 0 = the flat shallow look. */
  reliefDepth?: number;
  /** Deep-relief WALL STYLE: false = V1 Make-friendly steep welded ramps; true =
   *  V2 manifold-3d CSG true-vertical walls (lazy WASM, falls back to V1 on any
   *  failure). Only bites on objects with treatMask primitive features. */
  reliefCsg?: boolean;
}

// ── Studio environment palette (named register — ink-black policy) ─────────
// The baked <Environment> is what clearcoat/envmap channels REFLECT, and
// specular reflection bypasses albedo — so any hue here lands on the object
// at full strength regardless of the ink-black base color. Values live in ONE
// named table so the material battery (tools/3d/material-battery) asserts
// against the exact rig the product ships.
//
// RATIFIED COLOR POLICY (3d-mode-controls-spec footer, Sebs 2026-06-12):
// everything renders as the single warm-graphite ink; presets differ ONLY in
// how light sits. Broad warm-TAN area bands are banned at every orbit angle
// (round-7 verifier measured rgb(142,118,91) on a Glossy Extrude slab —
// reproduced by the battery at rgb(146,122,96), Δr−b 50). Root cause: the
// original port "warmed" this palette for the paper world — env bg #8a8174
// (mid warm grey) + fill #ffd9b0 (Δr−b 79) re-entered through clearcoat/
// envmap ×1.8 as the tan flood. Same violation family as the sheenColor
// flood; same cure: re-register the hue-carrying channel to warm graphite.
//
// PROVENANCE: the Free Stroke calibration ancestor (origin/main
// viewport-3d.tsx, read via git show 2026-06-12) ran these EXACT material
// params against a NEAR-BLACK env bg (#15171a) + #ffffff key — dark bg is
// what the presets were tuned for (feedback_copy_implementation_before_
// tweaking_numbers). Panels keep their positions/intensities so clearcoat
// still has something to reflect (the Day-11 flat-black-blob bug was NO env;
// killing the panels would regress it).
export const STUDIO_ENV = {
  /** Environment background — fills every direction the panels don't; it is
   *  what tilted glossy faces mirror BROADLY. Warm-axis sibling of the FS
   *  ancestor's #15171a, inside the D2-E ink family (#121110–#383632): broad
   *  reflections read as dark warm graphite, never tan. */
  bg: '#211e1a',
  /** Big soft key panel (top-front) → broad clearcoat highlight. NEUTRALISED
   *  to near-grey white (#f8f7f6, Δr−b 2) — the be7aac7 fix darkened the env BG
   *  but left this panel whisper-warm (#fffaf0 Δ15), and rubber/softGel's WIDE
   *  sheen lobe (sheen 1.0) broadly MIRRORS this panel across a FLAT coplanar
   *  slab face → the milk-chocolate read (2026-06-13 slab battery: rubber lit
   *  Δ25, softGel Δ27, local warm buckets Δ29). Specular/sheen bypass albedo,
   *  so the panel HUE lands at full strength regardless of the ink-black base
   *  (RATIFIED COLOR POLICY / ink-black D2-E). Full value + intensity KEPT
   *  (clearcoat/sheen still have a bright source — no Day-11 flat-blob); only
   *  the warm CAST is removed, so a broad mirror reads grey, never tan. */
  key: { color: '#f8f7f6', intensity: 3 },
  /** Cool rim panel (back-left) → separates the form's dark side. */
  rim: { color: '#bcd0e8', intensity: 1.6 },
  /** Low fill (front-low) → soft underside glow for sheen. FS's #ffd9b0 (Δ79)
   *  → be7aac7 whisper-warm #e8e0d4 (Δ20) → NEUTRALISED #dcdad7 (Δ5): the same
   *  sheen-lobe flat-face mirror that warmed the KEY warmed this FILL too (it
   *  sits front-low, square in the sheen lobe of a down-tilted slab). Warmth
   *  killed, value/intensity kept (the underside glow that lifts sheen forms
   *  survives — just neutral now). Ink-black holds at every orbit angle. */
  fill: { color: '#dcdad7', intensity: 1.1 },
  /** Tight bright streak → crisp specular accent on curvature. */
  streak: { color: '#ffffff', intensity: 4 },
} as const;

/** The full studio rig (scene lights + baked Environment) — EXPORTED so the
 *  material battery renders through the EXACT product rig (the tier-2 board
 *  harness omitted the Environment bake, which is precisely the gap that let
 *  the env-reflection tan band ship unseen). */
export function StudioRig({ dimFill = false, lite = false }: { dimFill?: boolean; lite?: boolean } = {}) {
  // SVG-PORT FILL TRIM (sparse-legibility pass 2026-06-13, round-1's "cheapest
  // next lever = trim the studio rig's fill"): the full ambient/hemisphere/near-
  // point flood lights a near-white svg-port cap so evenly that SHALLOW carved
  // relief catches no shadow — the marks wash out. When svg-port is the active
  // style we drop the omnidirectional fills HARD so the form is shaped almost
  // entirely by the grazing svg-port key (added in the scene) — that rake is what
  // makes the grooves throw the highlight/shadow that reads as engraved. Native/
  // Hatch keep the full rig (dimFill stays false → byte-identical for them).
  const amb = dimFill ? 0.07 : 0.25;
  const hemi = dimFill ? 0.16 : 0.55;
  const pt = dimFill ? 14 : 75;
  return (
    <>
      {/* Studio rig — Free Stroke key+fill+rim structure (positions verbatim
          from viewport-3d.tsx), re-balanced for white paper: hemisphere light
          stands in for paper bounce (sky-warm above, paper-bounce below) and
          the ambient floor drops so form shading keeps its gradient range.
          The hatch/svg-port ShaderMaterial computes its own lambert from the
          same key/fill directions — the rig stays for Native + shadows. */}
      <ambientLight intensity={amb} />
      <hemisphereLight args={['#fff7e8', '#cdbfa6', hemi]} />
      <directionalLight position={[5, 8, 5]} intensity={1.45} color="#fff3e0" />
      <directionalLight position={[-4, 2, -2]} intensity={0.5} color="#e3eaf2" />
      <directionalLight position={[0, -3, -5]} intensity={0.3} />
      {/* Soft near point light (white-paper adaptation): directionals shade a
          FLAT camera-facing extrude face perfectly uniformly (constant N·L) —
          a nearby point light varies with position, so flat faces get a real
          brightness gradient instead of the blob read. decay 2 physical.
          DROPPED for svg-port (dimFill): this broad near-fill is the main
          shallow-relief washer. */}
      <pointLight position={[4, 5, 6.5]} intensity={pt} decay={2} color="#fff6e6" />
      {/* Offline studio environment (no HDR fetch) — ported from Free Stroke:
          clearcoat/sheen need something to reflect or the physical material
          collapses to flat diffuse. resolution 256, frames={1} bakes it ONCE
          (static, deterministic, no per-frame cost). Palette = STUDIO_ENV.
          SKIPPED in `lite` (transparent thumbnails): the desk flips MANY object
          canvases at once, and N simultaneous Environment CubeCamera bakes
          exhaust the GL context → "CubeCamera.update" crash (Sebs 2026-06-14).
          The direct key/fill/rim + point lights still shape the form. */}
      {!lite && (
      <Environment resolution={256} frames={1} background={false}>
        <color attach="background" args={[STUDIO_ENV.bg]} />
        <Lightformer
          form="rect"
          intensity={STUDIO_ENV.key.intensity}
          color={STUDIO_ENV.key.color}
          position={[2.5, 4, 3]}
          rotation={[-Math.PI / 3, 0, 0]}
          scale={[8, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={STUDIO_ENV.rim.intensity}
          color={STUDIO_ENV.rim.color}
          position={[-4, 1.5, -3]}
          rotation={[0, Math.PI / 2.2, 0]}
          scale={[5, 4, 1]}
        />
        <Lightformer
          form="rect"
          intensity={STUDIO_ENV.fill.intensity}
          color={STUDIO_ENV.fill.color}
          position={[1, -2.5, 2]}
          rotation={[Math.PI / 2.5, 0, 0]}
          scale={[6, 3, 1]}
        />
        <Lightformer
          form="rect"
          intensity={STUDIO_ENV.streak.intensity}
          color={STUDIO_ENV.streak.color}
          position={[-1.5, 3, 2.5]}
          rotation={[-Math.PI / 4, 0, 0]}
          scale={[0.6, 5, 1]}
        />
      </Environment>
      )}
    </>
  );
}

/** Native preset → MeshPhysicalMaterial — EXPORTED factory so the material
 *  battery instantiates the EXACT product material (no harness re-typing of
 *  the param table). `inkColor` = the legacy explicit override prop.
 *  `nativeProps` = the four PROPERTY dials (symmetry-law gap cell §2); when
 *  omitted/neutral the preset params pass through unchanged (default-identity).
 *  Reflection is HARD-bounded inside applyNativeProps — ink-black holds at
 *  every dial position (be7aac7 policy). */
export function createNativeMaterial(
  preset: MaterialPresetId,
  inkColor?: string,
  nativeProps?: NativeProps3D,
): THREE.MeshPhysicalMaterial {
  const base = MATERIAL_PARAMS_3D[preset];
  const p = nativeProps ? applyNativeProps(base, nativeProps) : base;
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(inkColor ?? p.color),
    roughness: p.roughness,
    metalness: p.metalness,
    clearcoat: p.clearcoat,
    clearcoatRoughness: p.clearcoatRoughness,
    reflectivity: p.reflectivity,
    sheen: p.sheen,
    sheenRoughness: p.sheenRoughness,
    sheenColor: new THREE.Color(p.sheenColor),
    emissive: new THREE.Color(p.emissive),
    emissiveIntensity: p.emissiveIntensity,
    envMapIntensity: p.envMapIntensity,
  });
  applyRimGlow(mat);
  return mat;
}

/** FRESNEL RIM GLOW (R10, Sebs 2026-06-15 — "ink-black + rim glow"). An
 *  ink-black 3D form reads as a featureless silhouette/blob: its interior relief
 *  has no value contrast, and ink-on-ink edge lines are invisible. A view-angle
 *  fresnel term emits a soft warm-paper glow along the silhouette + every
 *  curvature edge (where the normal grazes the eye) — so the FORM pops as a
 *  backlit inked sculpture at ANY size or orbit angle (works at homepage
 *  thumbnail size where positional rim lights fail). Body stays pure ink-black;
 *  only the rim lifts. Injected at <dithering_fragment> where `normal` (view-
 *  space) + `vViewPosition` are both valid; adds to gl_FragColor after tonemap. */
function applyRimGlow(mat: THREE.MeshPhysicalMaterial): void {
  mat.onBeforeCompile = (shader) => {
    // SUBTLE: a faint warm rim ONLY at the grazing silhouette so the form reads
    // but the body stays ink-BLACK (Sebs: "rim glow is fine as long as it's still
    // blackish — we only use black, like the svg strokes"). 1.9 washed it grey.
    shader.uniforms.uRimColor = { value: new THREE.Color('#fdf6ea') };
    shader.uniforms.uRimPower = { value: 2.6 };
    shader.uniforms.uRimStrength = { value: 0.55 };
    shader.fragmentShader =
      'uniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimStrength;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `float dd_rim = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), uRimPower);
         gl_FragColor.rgb += uRimColor * (dd_rim * uRimStrength);
         #include <dithering_fragment>`,
      );
  };
  // onBeforeCompile materials need a custom cache key or three reuses the wrong
  // program. Key on the rim version + map presence: the svg-port path CLONES
  // this material and adds normal/emissive/bump maps — those clones must compile
  // their OWN (map-aware) program, not reuse the map-less one.
  mat.customProgramCacheKey = () =>
    'dd-rim-v1|' +
    (mat.normalMap ? 'n' : '') +
    (mat.emissiveMap ? 'e' : '') +
    (mat.bumpMap ? 'b' : '') +
    (mat.map ? 'm' : '');
}

// ── Studio rig — PORTED from Free Stroke ───────────────────────────────────
// PROVENANCE: free-stroke origin/main components/viewport-3d.tsx (ambient/key/
// fill/rim + baked <Environment> with four Lightformer panels), read via
// `git show origin/main:...` 2026-06-12. ADAPTED for white paper (hemisphere
// stands in for paper bounce). The single mid-graphite material that lived
// here (#5A5043) is GONE per amendment D2-E — it sat at the W1 caption-ink
// tier and produced the bronze/clay read. Native now uses the FS material
// presets verbatim (materials3d.ts); ink for the mark styles = INK_3D_DEFAULT.

/** Ground-contact shadow (soft AO pool under the doodle — the cue that the
 *  form is an OBJECT above paper, not a flat mark on it). */
const CONTACT_SHADOW = {
  opacity: 0.32,
  blur: 2.6,
  color: '#3a3128',
  resolution: 256,
  scale: 14, // pool is ≤ 8 world units wide — covers with margin
  far: 6, // capture height above the plane
} as const;
/** Gap between the lowest geometry point and the shadow plane. */
const CONTACT_SHADOW_DROP = 0.04;

// ── Content-fit camera framing — PORTED from Free Stroke, made FOV-aware ────
// PROVENANCE: viewport-3d.tsx `bounds.center + dir · bounds.radius × FRAME_K`
// (FRAME_K = 3.0, verbatim). Gentler mostly-frontal 3/4 so the doodle still
// reads as the drawing, with top + side walls visible for depth.
//
// RC-4(b) framing-aware fix: the verbatim FS framing distances the camera by
// bounds.RADIUS (the bounding-sphere half-diagonal) × a fixed K. That K was
// tuned for roughly-cubic doodles. For an ELONGATED form (a tall can, a wide
// boarding pass) — and ESPECIALLY when the rod is thin so the cross-section is
// negligible — the half-diagonal ≈ the major HALF-axis, the camera pulls in
// close, and the long axis runs off the frame (the overflow the audit caught).
// The fix keeps the sphere-radius distance as a FLOOR (so the verbatim look is
// untouched for normal doodles) but ALSO computes the distance the perspective
// frustum needs to fit the box's largest projected extent, and takes the max.
// So a normal doodle frames exactly as before; only an elongated one gets
// pushed back enough to stop clipping.
const FRAME_K = 3.0;
const FRAME_DIR = new THREE.Vector3(0.5, 0.55, 1).normalize();
/** Floor on the framing radius so a dot-tap doodle doesn't slam the camera
 *  into the near plane. */
const FRAME_MIN_RADIUS = 1.2;
/** Extra breathing room around the fitted box (RC-4(b)) — the form sits inside
 *  the frame with margin, never kissing the border. R10 2026-06-15: 1.18→1.32 —
 *  a long object (the running shoe, rod) still clipped a tip mid-rotation; more
 *  margin on the sphere-fit guarantees no orbit angle touches the frame edge. */
const FRAME_FIT_MARGIN = 1.32;

interface PoolBounds {
  center: THREE.Vector3;
  radius: number;
  minY: number;
  /** Full world-space extents (RC-4(b) framing-aware fit). */
  size: THREE.Vector3;
}

/** Deterministic one-shot camera fit: position = center + dir·dist, target =
 *  center. Re-runs only when the pool bounds OR the viewport aspect change
 *  (new strokes / mode / resize) — user orbits are never fought mid-gesture. */
function CameraFramer({ bounds }: { bounds: PoolBounds | null }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size); // re-fit on container resize (aspect)
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  useEffect(() => {
    if (!bounds) return;
    const radius = Math.max(bounds.radius, FRAME_MIN_RADIUS);
    // Verbatim-FS distance (the look for normal doodles) = the floor.
    let dist = radius * FRAME_K;
    // FOV-aware distance: push back far enough that the box's largest projected
    // extent fits the frustum with margin. Vertical fov fits the box HEIGHT;
    // the box WIDTH must fit the horizontal fov (= vfov scaled by aspect). Use
    // whichever needs the farther camera so neither axis overflows.
    const persp = camera as THREE.PerspectiveCamera;
    if (persp.isPerspectiveCamera) {
      const vFov = (persp.fov * Math.PI) / 180;
      const aspect = persp.aspect || (size.height > 0 ? size.width / size.height : 1);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      // Half-extents the camera must fit: include depth so an oblique 3/4 view
      // (FRAME_DIR is not axis-aligned) never tucks a corner past the edge.
      const halfH = (bounds.size.y + bounds.size.z * 0.6) * 0.5 * FRAME_FIT_MARGIN;
      const halfW = (bounds.size.x + bounds.size.z * 0.6) * 0.5 * FRAME_FIT_MARGIN;
      const distForH = halfH / Math.tan(vFov / 2);
      const distForW = halfW / Math.tan(hFov / 2);
      // Bounding-SPHERE fit (rotation-invariant): the box fit above is only valid
      // at the default angle, so a free-tumble thumbnail clips its corners as it
      // rotates (Sebs: "still clipping on some"). The sphere fits at EVERY angle,
      // so framing to it guarantees no rotation ever pushes the form off-frame.
      const distForSphere = (radius * FRAME_FIT_MARGIN) / Math.tan(Math.min(vFov, hFov) / 2);
      dist = Math.max(dist, distForH, distForW, distForSphere);
    }
    camera.position.copy(bounds.center).addScaledVector(FRAME_DIR, dist);
    camera.lookAt(bounds.center);
    if (controls) {
      controls.target.copy(bounds.center);
      controls.update();
    }
  }, [bounds, camera, controls, size]);
  return null;
}

/** A per-object manual orientation (radians). az = turntable spin (around Y),
 *  el = tilt (around X). Driven by the desk's rotate HANDLE so dragging the body
 *  stays MOVE/fling and dragging the handle ROTATES — no shared-drag conflict,
 *  no mode switch (Sebs 2026-06-27). */
export interface TumbleState {
  az: number;
  el: number;
}

/** Wraps the form and rotates it in place from `tumbleRef` each frame. The whole
 *  doodle is built CENTERED AT ORIGIN (poolCenter, plan §1.2) and HardMesh
 *  auto-centers too, so a plain group rotation about origin spins the object
 *  about its own center — no recenter math. Read imperatively via useFrame so a
 *  handle-drag never re-renders the (heavy) 3D React subtree: only the GL frame
 *  loop reads the ref. When `tumbleRef` is absent (the /canvas single-canvas
 *  path) the group stays identity and OrbitControls owns rotation as before. */
function TumbleGroup({
  tumbleRef,
  children,
}: {
  tumbleRef?: MutableRefObject<TumbleState> | null;
  children: ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    const t = tumbleRef?.current;
    if (g && t) g.rotation.set(t.el, t.az, 0);
  });
  return <group ref={ref}>{children}</group>;
}

/** Perf budget (plan §5 risk 6): cap the pool; the wiring layer owns any
 *  user-facing "too many strokes" messaging.
 *  R10 (2026-06-15): raised 60 → 220. At 60 a complex line-drawing (the rose =
 *  112 strokes) lost HALF its strokes BEFORE render → "detail can barely be
 *  seen / black blob" (Sebs, video). 220 covers real hand-drawn + uploaded
 *  line-art with headroom; concurrent-object perf on the desk is bounded by the
 *  viewport streaming (only near-view objects mount), not this per-object cap. */
const MAX_STROKES_3D = 220;

/** Depth (world units) of a tone/fill slab — a low tone PLATE, thinner than an
 *  ink extrude so the fill reads as the region's shaded body, not a tall block.
 *  (fill→3D-hollow fix.) */
const TONE_FILL_DEPTH = 0.4;

/** Resolve the paper CSS var ONCE at mount (plan §2.1). WebGL cannot consume
 *  `var(--dir-bg)` strings — passing them to three fails silently to black
 *  (same family as feedback_media_overlay_ink_doesnt_flip). Hex fallback keeps
 *  the scene warm-paper even with no stylesheet (tests / Make cold mounts). */
export function resolvePaperHex(): string {
  if (typeof document === 'undefined') return WARM_PAPER_FALLBACK;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--dir-bg').trim();
    return v.length > 0 ? v : WARM_PAPER_FALLBACK;
  } catch {
    return WARM_PAPER_FALLBACK;
  }
}

// ── Param-default sync guard (dev only) ─────────────────────────────────────
// modeParams.ts duplicates strokeTo3d defaults as literals (it must stay
// three-free for the lazy-chunk split). This assert catches drift the moment
// either side moves.
if (import.meta.env.DEV) {
  const d = DEFAULT_MODE3D_PARAMS;
  if (
    d.rod.radius !== ROD_RADIUS ||
    d.rod.jointSensitivityDeg !== JOINT_ANGLE_THRESHOLD_DEG ||
    d.inflate.baseRadius !== INFLATE_BASE_RADIUS ||
    d.inflate.tipRadius !== INFLATE_TIP_RADIUS ||
    d.inflate.pressureInfluence !== INFLATE_PRESSURE_INFLUENCE ||
    INFLATE_PROFILE_FAMILY_PRESETS.balloon.profileExp !== INFLATE_PROFILE_EXP ||
    d.solid.inkRadius !== SOLID_INK_RADIUS
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[Stroke3DScene] modeParams defaults drifted from strokeTo3d constants — re-sync modeParams.ts',
    );
  }
}

// ── Engine-option wiring (rock X) ───────────────────────────────────────────
// The rock-1 local mirrors (detectJointsWithAngle / buildExtrudeNoBevel) are
// DELETED — joint sensitivity and bevel profile are REAL strokeTo3d options
// now; the chrome drives the engine, not a copy.

/** Per-stroke build with the FULL spec §2 param sets + Tier-2 families
 *  applied. EXPORTED: the tools/3d board harness renders contact sheets
 *  through this exact product path. `treatAsClosed` = the ARROW RULE chip
 *  override for this stroke (auto mode only). */
export function buildStrokeWithParams(
  points: StrokeInputPoint[],
  viewBox: ViewBoxSize,
  center: { x: number; y: number },
  setting: GeometryModeSetting,
  p: Mode3DParams,
  treatAsClosed?: boolean,
): StrokeGeometryResult {
  const simplified = rdpPoints(points);
  const mode = resolveGeometryMode(setting, simplified, { treatAsClosed });
  const world = normalizeStrokePoints(simplified, viewBox, WORLD_SCALE, center);

  if (mode === 'extrude') {
    const depth = extrudeEffectiveDepth(p.extrude.width, p.extrude.depthMult);
    // Spec §2.2 tiny-width auto-disable: profile falls to 'sharp' under the
    // floor (the chrome surfaces the chip — never silent).
    const profile = extrudeBevelAutoDisabled(p.extrude.width)
      ? 'sharp'
      : p.extrude.bevelProfile;
    return buildExtrudeGeometry(world, {
      depth,
      rodRadius: p.rod.radius,
      bevelProfile: profile,
      sideWall: p.extrude.sideWall,
    });
  }

  if (mode === 'inflate') {
    const family = INFLATE_PROFILE_FAMILY_PRESETS[p.inflate.profileFamily];
    const result = buildInflateGeometry(world, {
      baseRadius: p.inflate.baseRadius,
      tipRadius: p.inflate.tipRadius,
      pressures: extractPressures(simplified),
      pressureInfluence: p.inflate.pressureInfluence,
      profileExp: family.profileExp,
      rodRadius: p.rod.radius,
    });
    // Puff (D-A): FS Z-aspect applied as a geometry-space Z scale, modulated
    // by the Tier-2 profile family (presets OVER the Puff curve).
    // applyMatrix4 runs positions AND normals through the normal matrix, so
    // the non-uniform scale shades correctly. aspect 1.0 is skipped (no-op).
    if (result.kind === 'inflate') {
      const aspectZ = inflatePuffAspectZ(p.inflate.puff) * family.aspectScale;
      if (Math.abs(aspectZ - 1) > 1e-3) {
        result.geometry.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, aspectZ));
      }
    }
    return result;
  }

  // rod — explicit pick keeps the tolerant ring closure (today); an
  // AUTO-resolved rod from the ambiguous band stays an OPEN tube (the gap is
  // the honest read; the chip welds it, not the engine).
  const closeRing =
    setting === 'auto'
      ? isSolidFamilyClosure(closureStateOf(simplified), treatAsClosed)
      : isClosedStroke(simplified);
  return buildRodGeometry(world, {
    radius: p.rod.radius,
    closed: closeRing,
    jointAngleThresholdDeg: p.rod.jointSensitivityDeg,
  });
}

export interface Stroke3DSceneProps {
  /** Raw strokes in viewBox coords (y-down). Points are [x, y] or
   *  [x, y, pressure] — DrawSurface's `stroke.points` pass through unchanged. */
  strokes: StrokeInputPoint[][];
  /** Painted TONE/FILL regions (toneMask.ts ToneFill, band 1–7) in the SAME
   *  viewBox space as `strokes`. Each becomes a band-greyscale extruded slab so
   *  a filled region carries its tone into 3D instead of vanishing (the
   *  fill→3D-hollow fix). Empty/undefined = no fill bodies (byte-identical old
   *  render). */
  toneFills?: ToneFill[];
  /** ARROW RULE: seed chip overrides (strokeSignature → treat-as-closed).
   *  The chip mutates scene-local state from here; harness boards use it to
   *  show the 'solid' variant without flipping the constant. */
  initialTreatAsClosed?: Record<string, boolean>;
  /** Source coordinate space. Defaults to the draw surface's 800×600. */
  viewBox?: ViewBoxSize;
  /** 'auto' picks per stroke: open → rod, closed → extrude. 'inflate' and
   *  'solid' are explicit-only — auto never resolves to them. */
  geometryMode?: GeometryModeSetting;
  /** 3D style (spec §3): native (lit presets) · hatch (Shading-slider
   *  hachure) · svg-port (2D-chrome-driven treatment + ink edges). */
  style3d?: 'native' | 'hatch' | 'svg-port';
  /** Native material preset. Default: FS per-mode default for geometryMode. */
  materialPreset?: MaterialPresetId;
  /** Native PROPERTY dials (symmetry-law gap cell §2): polish/reflection/
   *  sheen/outline. Default = neutral (preset passes through, no outline). */
  nativeProps?: NativeProps3D;
  /** Per-mode param sets (spec §2). Default: the spec's tuned defaults. */
  modeParams?: Mode3DParams;
  /** Live 2D Shading-cluster values for hatch/svg-port (the scene only
   *  consumes; the wiring layer reads F3RoughModifiersContext). */
  hatchInputs?: HatchInputs;
  /** svg-port ONLY: the serialized styled <svg> from the REAL SvgStyleTransform
   *  (via its onRender seam). The form WEARS this exact 2D render — rasterized
   *  to emissive ink + carve relief, never a parallel shader
   *  (project_f3_shading_port_to_3d). Absent → svg-port falls back to the lit
   *  body (no marks). */
  svgPortMarkup?: string;
  /** svg-port BUILD controls (perf gate + per-style relief). On a single-canvas
   *  mount (modal/preview) usually just { styleId } for the per-style profile;
   *  the desk/drawer path also sets inView + longEdge. */
  svgPortBuild?: SvgPortBuildOpts;
  /** Hard-path AI mesh GLB url — renders in place of the local form when set. */
  hardMeshUrl?: string;
  /** Background override. Default: --dir-bg resolved once at mount. */
  background?: string;
  /** Legacy explicit ink override — when set, overrides the Native preset's
   *  color and the mark styles' ink. Default ink = INK_3D_DEFAULT (D2-E). */
  inkColor?: string;
  style?: CSSProperties;
  className?: string;
  /** ARROW-RULE "Open-ish — treat as closed?" chips. Default true (the main
   *  /canvas flip, where each tap is a logged correction). Set false for
   *  non-interactive previews (the desk grid, the Drawer/Shelf restyle gallery)
   *  where the mount sets pointerEvents:none — there the chips can't be tapped,
   *  so showing them is dead clutter (Sebs 2026-06-14: "idk if the openish makes
   *  sense here"). Closure decisions on those surfaces belong in the edit flow. */
  showAmbiguityChips?: boolean;
  /** Transparent canvas — no scene background fill, alpha GL buffer, so the
   *  doodle sits on whatever is behind it (the desk paper / page) instead of an
   *  opaque white box. Default false (the /canvas + panel-well keep their paper
   *  fill). Sebs 2026-06-14: desk-flip + homepage 3D must blend, "keep it no
   *  background". */
  transparent?: boolean;
  /** Orbit controls (drag-rotate / scroll-zoom). Default true (the /canvas).
   *  THUMBNAIL mounts (desk flip, homepage, gallery) set false — there the
   *  object must just SWITCH to 3D and STAY framed in its own box; user
   *  zoom/drag must NOT rotate or push it out of frame (Sebs 2026-06-14:
   *  "it should just be the object switched, contained in its own box"). */
  orbit?: boolean;
}

const DEFAULT_HATCH_INPUTS: HatchInputs = {
  hachureGap: 4,
  hachureAngle: -41,
  strokeWidth: 1.2,
  inkIntensity: 1.0,
};

/** Copies live slider values into the hatch uniforms (device-px aware).
 *  Runs as an effect INSIDE the Canvas so it can read the real pixel ratio. */
function HatchUniformSync({
  material,
  variant,
  inputs,
  ink,
  paper,
}: {
  material: THREE.ShaderMaterial;
  variant: 'hatch' | 'svg-port';
  inputs: HatchInputs;
  ink: string;
  paper: string;
}) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    updateHatchUniforms(material, variant, inputs, ink, paper, gl.getPixelRatio());
  }, [material, variant, inputs, ink, paper, gl]);
  // Light-following + contour read the camera-relative light direction, which
  // changes every orbit frame — push it per-frame (one matrix transform; for
  // Fixed hachure the uniform is set but the shader ignores it, so this is
  // harmless when light-following is off).
  useFrame((s) => {
    updateHatchLightDir(material, s.camera.matrixWorldInverse);
  });
  return null;
}

/** Dispose the three svg-port channel textures (three never auto-frees GPU
 *  textures; reassigning material.map/emissiveMap/normalMap does NOT free the
 *  old one — leak guard for every rebuild + the async stale-loser). */
function disposeSvgPortTex(t: SvgPortTextureResult | null | undefined): void {
  if (!t) return;
  t.emissive.dispose();
  t.height.dispose();
  t.structureHeight?.dispose();
  t.normal.dispose();
}

/** Rasterize the object's LINE WORK (its strokes) as dark ink polylines on a
 *  PAPER-filled canvas → a clean line-drawing texture. This is the source the
 *  AI-mesh 'svg-port' SURFACE projects onto the imported GLB (planar UV, HardMesh)
 *  — "the drawing worn on the form". STROKES, not the filled SVG: a filled silhouette
 *  projects to a dark blob, but the line work reads as the drawing on the surface
 *  (the holy-grail look) and works for real hand-drawn doodles + derived outlines
 *  alike. Sync (canvas only); auto-fits the strokes' bbox with a margin. */
function rasterizeStrokesToTexture(
  strokes: StrokeInputPoint[][],
  paperHex: string,
  inkHex: string,
  size = 1024,
): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let n = 0;
  for (const s of strokes) for (const p of s) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); n++; }
  if (n === 0 || !(maxX > minX) || !(maxY > minY)) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  // Ground = paperHex, marks = inkHex (caller chooses). The mesh 'svg-port' surface
  // passes a DARK ground + LIGHT marks (engraved) for contrast on the light desk.
  ctx.fillStyle = paperHex || '#efe9df';
  ctx.fillRect(0, 0, size, size);
  const w = maxX - minX, h = maxY - minY;
  const margin = size * 0.1;
  const sc = Math.min((size - 2 * margin) / w, (size - 2 * margin) / h);
  const ox = (size - w * sc) / 2 - minX * sc;
  const oy = (size - h * sc) / 2 - minY * sc;
  ctx.strokeStyle = inkHex || '#1a1a1a';
  ctx.fillStyle = inkHex || '#1a1a1a';
  ctx.lineWidth = Math.max(9, size * 0.028); // VERY bold so the lines clearly read at the desk's small render scale
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    if (stroke.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke[0][0] * sc + ox, stroke[0][1] * sc + oy, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(stroke[0][0] * sc + ox, stroke[0][1] * sc + oy);
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i][0] * sc + ox, stroke[i][1] * sc + oy);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // NO mipmaps — minification mipmapping averaged the bold ink lines down to faint
  // grey when the small desk mesh sampled this big texture (the wash-out cause).
  // Anisotropic linear keeps the lines crisp + dark at the desk's small render size.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Rasterize the object's STYLED 2D markup → an ENGRAVING texture (dark ground +
 *  LIGHT marks) for the AI-mesh 'svg-port' surface. Unlike the strokes path, this
 *  CARRIES THE 2D STYLE (rough.js wobble / charcoal grain / stipple dots / wet-ink
 *  bleed / etc.) onto the form — "the drawing, in its style, engraved on the mesh"
 *  (Sebs 2026-06-27 "svg port not done like asked"). Draws the styled SVG on white,
 *  then INVERTS (canvas 'difference' w/ white) so the dark ink becomes light incised
 *  marks on a dark form. Async (Image load). Returns null if the markup won't load. */
function rasterizeMarkupToEngraving(markup: string, size = 1024): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined' || !markup) { resolve(null); return; }
    let svg = markup;
    if (!/\sxmlns=/.test(svg)) svg = svg.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
    // STRIP FILLS → keep the styled LINE WORK only. A filled silhouette inverts to a
    // light blob; the strokes (with their rough/bold/wet style intact) engrave as
    // clean light lines. Real hand-drawn doodles are already fill:none (unchanged).
    svg = svg.replace(/\sfill="(?!none)[^"]*"/gi, ' fill="none"');
    svg = svg.replace(/fill:\s*(?!none)[^;"]+/gi, 'fill:none');
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      const m = size * 0.1;
      const ar = img.width / img.height || 1;
      let dw = size - 2 * m, dh = size - 2 * m;
      if (ar > 1) dh = dw / ar; else dw = dh * ar;
      ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
      // If stripping fills left ~no line work (a fill-only source, e.g. a catalog
      // illustration), bail → the caller falls back to the derived-strokes engraving.
      try {
        const data = ctx.getImageData(0, 0, size, size).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4 * 53) if (data[i] < 180) dark++;
        if (dark < 12) { resolve(null); return; }
      } catch { /* tainted canvas — proceed */ }
      // INVERT → dark ground, light incised marks (engraving); carries the 2D style.
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Slow auto-spin for the AI mesh (the AI-mesh's own 'Auto-spin' toggle). A group
 *  wrapper so only the mesh turns; spin=false leaves it static. */
function AiMeshSpinner({ spin, children }: { spin: boolean; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (spin && ref.current) ref.current.rotation.y += dt * 0.6;
  });
  return <group ref={ref}>{children}</group>;
}

/** One mesh per stroke (matches the 2D commit layer's one-<path>-per-stroke),
 *  grouped so OrbitControls orbit the whole doodle. Geometries are built in a
 *  useMemo and EXPLICITLY disposed on swap/unmount — programmatic geometries
 *  don't auto-dispose (plan §5 risk 2). */
function StrokeMeshes({
  strokes,
  toneFills,
  viewBox,
  geometryMode,
  material,
  isNative,
  isSvgPort,
  svgPortMarkup,
  hardMeshUrl,
  paperColor,
  modeParams,
  showEdges,
  edgeColor,
  outlineWidth = 0,
  treatAsClosedBySig,
  hideContactShadow = false,
  aiMeshLook,
  meshEngineMaterial = null,
  meshOutline = 0,
  meshPlanarUv = false,
  svgPortBuild,
  hatchInputs = DEFAULT_HATCH_INPUTS,
}: {
  strokes: StrokeInputPoint[][];
  toneFills?: ToneFill[];
  /** Live 2D PEN controls (strokeWidth/wobble/inkIntensity/fillStyle) → drive the
   *  AI-mesh svg-port LINE-ART (HardMesh pencil branch). The same one math the hatch
   *  surface reads; on svg-port it ports the pen FEELING onto the mesh's own lines. */
  hatchInputs?: HatchInputs;
  /** AI-mesh SURFACE material (the OFAT-approved hatch/native instance from the
   *  parent). When set, HardMesh wears it instead of the greyscale re-skin. null ⇒
   *  greyscale/og-pbr (the default, via aiMeshLook.materialMode). */
  meshEngineMaterial?: THREE.Material | null;
  /** AI-mesh native OUTLINE dial (0–1) → inverted-hull ink silhouette on the GLB. */
  meshOutline?: number;
  /** SVG-PORT surface → project the drawing onto the GLB via planar UVs (HardMesh). */
  meshPlanarUv?: boolean;
  /** svg-port BUILD controls (PERF + per-style relief, Sebs 2026-06-20). When a
   *  surface flips MANY objects at once (the desk/drawer), gate + size the heavy
   *  texture build so a restyle doesn't rebuild every object at full res:
   *   · inView   build only on-screen objects (off-screen keep their warm tex)
   *   · longEdge texture long-edge px — thumbnails use ~512 (vs 1024·dpr)
   *   · styleId  the active F3 svg-style → per-style carve profile (distinct relief)
   *  Omitted ⇒ full res, always build (the single-object modal/preview path). */
  svgPortBuild?: SvgPortBuildOpts;
  /** PER-OBJECT AI-mesh look override (saved render_config.aiMesh) — when set it
   *  wins over the shared 3D context, so a placed AI mesh shows the Material /
   *  Darkness / Auto-spin the maker saved (Sebs 2026-06-16: "the ai-mesh toggles
   *  don't save / don't show on the desk"). Omitted ⇒ the live context drives it
   *  (the edit modal), so there's no behavior change where it isn't passed. */
  aiMeshLook?: { materialMode?: 'greyscale' | 'og-pbr' | 'hatch' | 'native' | 'svg-port'; dark?: number; contrast?: number; autoSpin?: boolean };
  viewBox: ViewBoxSize;
  geometryMode: GeometryModeSetting;
  material: THREE.Material;
  /** True when `material` is the lit Native MeshPhysicalMaterial (so the
   *  bas-relief bumpMap is meaningful — the Hatch/SVG-port shaders ignore it). */
  isNative: boolean;
  /** True for the svg-port style — the body wears the REAL 2D render as a
   *  carved relief (emissive ink + normal/displacement), built from svgPortMarkup. */
  isSvgPort?: boolean;
  /** svg-port: serialized styled <svg> (SvgStyleTransform onRender output). */
  svgPortMarkup?: string;
  /** Hard-path AI mesh GLB url (re-hosted). When set, the scene renders THIS GLB
   *  in place of the local geometry (the local builds still compute → bounds/
   *  shadow/framing). Dormant until the modal's "Generate AI 3D" chip sets it. */
  hardMeshUrl?: string;
  /** Resolved --dir-bg — the paper fill under the svg-port marks. */
  paperColor?: string;
  modeParams: Mode3DParams;
  showEdges: boolean;
  edgeColor: string;
  /** Native OUTLINE dial → inverted-hull silhouette weight (0 = off). */
  outlineWidth?: number;
  /** ARROW RULE chip overrides, keyed by strokeSignature (auto mode only). */
  treatAsClosedBySig?: Record<string, boolean>;
  /** Drop the ground-contact shadow plane (transparent/floating previews — the
   *  homepage + desk flip, where a shadow patch on no-background reads as dirt). */
  hideContactShadow?: boolean;
}) {
  const key = strokesKey(strokes);
  const paramsKey = JSON.stringify(modeParams) + '|' + JSON.stringify(treatAsClosedBySig ?? {});

  // AI-mesh shading register — only consumed by HardMesh below (the hard-path
  // GLB). 'greyscale' (default) drops the mesh into our ink register; 'og-pbr'
  // keeps the provider's photoreal. Inert when there's no hard mesh.
  // Per-object override (aiMeshLook, from a placed object's saved config) wins
  // over the shared 3D context; falls back to the context when not passed.
  const _ctx3d = useCanvas3D();
  const aiMeshMaterialMode = aiMeshLook?.materialMode ?? _ctx3d.aiMeshMaterialMode;
  const aiMeshDark = aiMeshLook?.dark ?? _ctx3d.aiMeshDark;
  const aiMeshContrast = aiMeshLook?.contrast ?? _ctx3d.aiMeshContrast;
  const aiMeshAutoSpin = aiMeshLook?.autoSpin ?? _ctx3d.aiMeshAutoSpin;
  // SVG-PORT PEN AXIS (Sebs 2026-06-28, "it ports over ALL the SVG stuff"): the live
  // 2D pen controls (strokeWidth/wobble/inkIntensity/fillStyle) → the mesh's OWN
  // line-art weight / waver / darkness / character (HardMesh pencil branch). Only
  // consumed when materialMode==='svg-port'; native ignores it. fillStyle → an int
  // (same mapping the 2D + hatch renderers use) so picking a pen STYLE re-characters
  // the lines (none=contour-only, dots=stipple, dashed=dashes, else continuous).
  const meshLine = useMemo(
    () => ({
      weight: hatchInputs.strokeWidth,
      wobble: hatchInputs.wobble ?? 0.4,
      ink: hatchInputs.inkIntensity,
      style: fillStyleToMode(hatchInputs.fillStyle),
    }),
    [hatchInputs.strokeWidth, hatchInputs.wobble, hatchInputs.inkIntensity, hatchInputs.fillStyle],
  );

  const builds = useMemo<StrokeGeometryResult[]>(() => {
    const pool = strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES_3D);
    if (pool.length === 0) return [];
    // Pool bbox center (NOT per-stroke) keeps the strokes' relative layout
    // and centers the whole doodle at the origin (plan §1.2).
    const center = poolCenter(pool, viewBox);
    // AUTO line-art routing (R10, Sebs video-confirmed — mirrors convert.ts
    // AUTO_LINEART_MIN_STROKES): a many-stroke pool is a LINE DRAWING → route
    // Auto to per-stroke INFLATE so its lines survive (+ edge-line pass outlines
    // them) instead of fusing into a featureless black blob via extrude/solid. A
    // deliberate solid shape is few strokes (closed loop / snap = 1) → stays Auto
    // → extrudes. Explicit picks (geometryMode !== 'auto') pass through untouched.
    // 'ai-mesh' is a FORM that renders the GLB, not a stroke generator — but the
    // local stroke build still runs for bounds/shadow/framing, so coalesce it to
    // 'auto' here (defensive: it never reaches the builder as a real stroke mode).
    const gmBase: GeometryModeSetting = geometryMode === 'ai-mesh' ? 'auto' : geometryMode;
    const effectiveMode: GeometryModeSetting =
      gmBase === 'auto' && pool.length >= 6 ? 'inflate' : gmBase;
    // FILLED-REGION TRACE (Sebs 2026-06-27, the Quiver-SVG OFAT): a Quiver image→SVG
    // trace is MANY nested CLOSED region paths, not open strokes (our drawings).
    // Per-stroke EXTRUDE fills each region as a solid slab → the big body region
    // buries all the nested detail = a featureless black blob (verified live on the
    // real DB gameboy Quiver SVG). The SOLID pipeline (raster → marching squares →
    // ONE unified mass) is literally "extrude the unified contour" and reads cleanly
    // (clean Game Boy with a recessed screen). So route Extrude on a filled trace
    // through it too. Gated on many-closed-loops so our own (mostly open-stroke)
    // drawings' Extrude is untouched — a deliberate few-stroke closed shape still
    // extrudes per-stroke as before.
    const closedFrac = pool.length ? pool.filter((p) => isClosedStroke(p)).length / pool.length : 0;
    const filledTrace = pool.length >= 8 && closedFrac >= 0.6;
    // EXTRUDE and INFLATE both fail on a filled trace (extrude → buried black blob;
    // inflate → fat merged tubes that read as a frame-with-a-hole, not the object),
    // so route both to the unified solid mass when the input is a filled trace. Rod
    // stays per-stroke (its thin outlines read as clean line-art even on a trace).
    const fillModeOnTrace = (effectiveMode === 'extrude' || effectiveMode === 'inflate') && filledTrace;
    if (effectiveMode === 'solid' || isSvgPort || fillModeOnTrace) {
      // Solid is pool-level by nature: ALL strokes rasterize into ONE
      // watertight mass — a single mesh, not per-stroke. Holes + edge are
      // REAL engine options now (rock X) — the chrome toggle drives the
      // builder directly.
      // SVG-PORT always routes here regardless of geometryMode: the style is
      // "the 2D drawing WORN on a dimensional surface", which needs ONE flat
      // front cap to carry the rasterized render (emissive ink + normal carve).
      // Without this, auto/rod/inflate gave svg-port no cap → the marks were
      // absent (Sebs's "dark blob"); per-stroke extrude also jittered the
      // silhouette. One mass cap fixes both (Bug 2 structural).
      return [
        buildPoolSolidGeometry(pool, {
          viewBox,
          center,
          inkRadius: modeParams.solid.inkRadius,
          depth: modeParams.solid.depth,
          rodRadius: modeParams.rod.radius,
          holes: modeParams.solid.holes,
          edge: modeParams.solid.edge,
        }),
      ];
    }
    return pool.map((points) =>
      buildStrokeWithParams(
        points,
        viewBox,
        center,
        effectiveMode,
        modeParams,
        treatAsClosedBySig?.[strokeSignature(points)],
      ),
    );
    // `key`/`paramsKey` stand in for array/object identity (cheap deterministic keys).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, paramsKey, geometryMode, isSvgPort, viewBox.w, viewBox.h]);

  useEffect(() => {
    return () => {
      for (const b of builds) b.geometry.dispose();
    };
  }, [builds]);

  // ── TONE/FILL BODIES (fill→3D-hollow fix, researched 2026-06-14) ──────────
  // A painted tone region (toneMask ToneFill, band 1–7) used to vanish on the
  // 2D→3D flip — only ink strokes converted, so a filled mass arrived as just
  // its outline (hollow), and the band VALUE was lost. Each ToneFill now builds
  // a band-greyscale extruded SLAB via the existing buildExtrudeGeometryWithHoles
  // (so holes are real, the slab is z-centered to the same plane as the ink),
  // colored by the band's source-darkness (band-5 vs band-7 read distinctly —
  // the tone carries into 3D). Aligned to the SAME pool center as the strokes so
  // fill + ink sit together. Empty fills → [] → byte-identical old render.
  const toneFillsKey = useMemo(
    () => (toneFills ?? []).map((f) => `${f.id}:${f.band}:${f.points?.length ?? 0}:${f.holes?.length ?? 0}`).join('|'),
    [toneFills],
  );
  const fillBodies = useMemo<{ geometry: THREE.BufferGeometry; material: THREE.Material }[]>(() => {
    if (!toneFills || toneFills.length === 0) return [];
    const pool = strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES_3D);
    // Co-center with the ink pool so fill + strokes share the origin; if there
    // are no strokes (pure tone), center on the fills' own outlines.
    const centerSrc = pool.length > 0 ? pool : toneFills.map((f) => f.points);
    const center = poolCenter(centerSrc as StrokeInputPoint[][], viewBox);
    const out: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    for (const f of toneFills) {
      if (!f.points || f.points.length < 3) continue;
      try {
        const outer = normalizeStrokePoints(f.points as StrokeInputPoint[], viewBox, WORLD_SCALE, center);
        const holeWorlds = (f.holes ?? [])
          .map((h) => normalizeStrokePoints(h as StrokeInputPoint[], viewBox, WORLD_SCALE, center))
          .filter((h) => h.length >= 3);
        const build = buildExtrudeGeometryWithHoles(outer, holeWorlds, { depth: TONE_FILL_DEPTH });
        const bandIdx = Math.min(Math.max(Math.round(f.band), 0), COVERAGE_BANDS.length - 1);
        const cb = COVERAGE_BANDS[bandIdx];
        const darkness = (cb.darknessMin + cb.darknessMax) / 2;
        const grey = Math.max(0.03, Math.min(1, 1 - darkness));
        out.push({
          geometry: build.geometry,
          material: new THREE.MeshStandardMaterial({
            color: new THREE.Color(grey, grey, grey),
            roughness: 1,
            metalness: 0,
          }),
        });
      } catch {
        // degenerate fill region (collinear / self-intersecting) → skip honestly.
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toneFillsKey, key, viewBox.w, viewBox.h]);
  useEffect(() => {
    return () => {
      for (const f of fillBodies) {
        f.geometry.dispose();
        f.material.dispose();
      }
    };
  }, [fillBodies]);

  // ── BAS-RELIEF FACE (RC-2 fix, replaces the raised-tube overlay) ───────────
  // The pool-raster Solid (and the closed-loop Extrude) merge the drawing into
  // ONE watertight silhouette mass — faithful to the OUTLINE, but the interior
  // hand is buried into a featureless slab (the exhaustive audit's RC-2). The
  // earlier stopgap floated the user's strokes as glossy ink TUBES riding proud
  // of the front face — they read as wires plopped ON TOP, not as part of the
  // form. We replace that with a real DIGITAL BAS-RELIEF: the drawing is
  // rasterized to an offscreen canvas height field (white = surface, ink =
  // recessed grooves) → a THREE.CanvasTexture → applied as the body material's
  // `bumpMap` on the FRONT FACE, so the marks read as CARVED/ENGRAVED relief
  // that the studio key light catches — a continuous surface, not separate
  // geometry. bumpMap perturbs the normal from the height gradient WITHOUT
  // moving vertices (three.js MeshStandardMaterial.bumpMap), which is exactly
  // achievable on the single-step extruded cap (a displacementMap would only
  // move the silhouette ring at steps:1, so bump is the premium result here).
  //
  // INK-BLACK POLICY HOLDS: the body stays the single warm-graphite ink at one
  // value; the drawing reads purely through how light sits on the relief, never
  // through colour. Solid + Extrude, NATIVE style only (the Hatch/SVG-port
  // shaders ignore bumpMap). rod/inflate are per-stroke — they ALREADY are the
  // strokes — so they keep null and render byte-identically.
  // Key off the RESOLVED geometry kind, not the geometryMode SETTING: the in-app
  // default is 'auto', so `geometryMode === 'solid'|'extrude'` was FALSE for every
  // auto object → relief + detail-lines never fired (the homepage heroes only got
  // them because they set 'extrude' EXPLICITLY). Reading builds[0].kind fixes the
  // missing interior detail for ALL auto-native solid/extrude objects at the root.
  const reliefBody = builds.length > 0 && (builds[0].kind === 'solid' || builds[0].kind === 'extrude');
  const relief = useMemo(() => {
    if (!isNative || !reliefBody || builds.length === 0) return null;
    const mass = builds[0];
    mass.geometry.computeBoundingBox();
    const bb = mass.geometry.boundingBox;
    if (!bb || !Number.isFinite(bb.min.x) || !Number.isFinite(bb.max.x)) return null;
    const pool = strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES_3D);
    if (pool.length === 0) return null;
    const built = buildDrawingReliefTexture(pool, viewBox, {
      minX: bb.min.x,
      maxX: bb.max.x,
      minY: bb.min.y,
      maxY: bb.max.y,
    });
    if (!built) return null;
    // Register the texture to the front face: rewrite the mass UVs as a planar
    // projection over the SAME world window the height field was rasterized for.
    // (Fallback UVs on the flat mass for the brief pre-tessellation frame; the
    // tessellated reliefGeom below gets its own UVs for the real displacement.)
    applyPlanarReliefUVs(mass.geometry, built.window);
    return built; // { texture, window } — window needed to UV-map the carved cap
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builds, key, paramsKey, geometryMode, isNative, reliefBody, viewBox.w, viewBox.h]);
  useEffect(() => {
    return () => {
      if (relief) relief.texture.dispose();
    };
  }, [relief]);

  // REAL CARVE on the BLACK native material (R10, Sebs 2026-06-15 — "stays black,
  // actually show the detail"). bumpMap alone is shading-only → invisible on a
  // small black form. svg-port renders GREY (paints the drawing as paper-albedo).
  // So: tessellate the native cap + drive a real DISPLACEMENT from the same height
  // field → genuine recessed geometry that casts real shadow (Game Boy screen +
  // Pokéball band carve IN), while the material stays pure ink-black (no emissive,
  // no albedo image). This is the only carve that's both deep AND black.
  const reliefGeom = useMemo<THREE.BufferGeometry | null>(() => {
    if (!relief || builds.length === 0) return null;
    try {
      const clone = builds[0].geometry.clone();
      const carved = new TessellateModifier(0.03, 6).modify(clone);
      clone.dispose();
      applyPlanarReliefUVs(carved, relief.window);
      carved.computeVertexNormals();
      return carved;
    } catch {
      return null; // tessellation failed → fall back to flat cap (bump-only)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relief, builds, key, paramsKey]);
  useEffect(() => () => { reliefGeom?.dispose(); }, [reliefGeom]);

  // The body material wearing the carved relief: clone the lit Native material
  // (so the shared instance the caller passed for non-relief modes / other
  // meshes is never mutated) and hang the bumpMap on the clone. Non-relief
  // modes (or non-native styles) use the passed `material` untouched →
  // byte-identical default render.
  const reliefMaterial = useMemo<THREE.Material | null>(() => {
    if (!relief || !(material instanceof THREE.MeshStandardMaterial)) return null;
    const m = material.clone();
    // REAL displacement when we have a tessellated cap to push (recesses cast
    // real shadow → the detail reads on the black). Height field: white(paper)=1=
    // surface, black(ink)=0 → scale + (bias=-scale) puts paper at 0 and ink at
    // -scale (recessed). Keep a light bump for sub-triangle fine detail head-on.
    if (reliefGeom) {
      m.displacementMap = relief.texture;
      m.displacementScale = RELIEF_DISPLACEMENT_SCALE;
      m.displacementBias = -RELIEF_DISPLACEMENT_SCALE;
    }
    m.bumpMap = relief.texture;
    m.bumpScale = RELIEF_BUMP_SCALE;
    m.needsUpdate = true;
    return m;
  }, [relief, reliefGeom, material]);
  useEffect(() => {
    return () => {
      if (reliefMaterial) reliefMaterial.dispose();
    };
  }, [reliefMaterial]);

  // ETCHING (R10, Sebs 2026-06-15 — "the inner details I can't read"). Black-on-
  // black is physically low-contrast: bump/displacement shadow is too subtle to
  // read the Pokéball band/button or Game Boy screen/buttons. The fix that WORKS
  // while keeping the form black: draw the doodle's own lines as LIGHT incised
  // lines sitting proud of the front face — like an engraving / etched plate.
  // The FORM stays solid ink-black; only the cut lines are light, so the inner
  // detail reads clearly at any size. Native solid/extrude only (= the fused
  // forms that lose detail); rod/inflate already ARE the lines, hatch draws marks.
  // STROKE-TOGGLE TRANSLATION (Sebs 2026-06-16: "multi stroke should show in 3d…
  // many things to translate"). The incised marks used to be built from the RAW
  // strokes, so stroke-PATH toggles (wobble/jaggedness/simplification/bowing/
  // multiStroke/sketchingStyle/penTip/endpoint) changed the 2D but never reached
  // the 3D marks — proven byte-identical 3D across those toggles (OFAT
  // /tmp/dd-shots/svgport-translate). For svg-port we now derive the marks from
  // the ACTUAL styled markup (svgMarkupToStrokes(svgPortMarkup)) so every 2D
  // stroke treatment shows as incised lines. Native relief keeps raw strokes
  // (its marks should stay the clean geometry, not the styled jitter).
  const styledMarkupPool = useMemo<StrokeInputPoint[][] | null>(() => {
    if (!isSvgPort || !svgPortMarkup) return null;
    // Sample at scale 1 (target == the markup's OWN viewBox) so the styled
    // polylines stay in the source draw space — same units as the raw strokes the
    // form is built from. normalizeStrokePoints then re-centers both by their own
    // poolCenter, so the incised marks register on the form (a fit-to-800×600
    // would balloon them off the cap). Falls back to the engine viewBox if the
    // markup has no parseable viewBox.
    const m = svgPortMarkup.match(/viewBox\s*=\s*["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
    const tW = m ? parseFloat(m[3]) : viewBox.w;
    const tH = m ? parseFloat(m[4]) : viewBox.h;
    // Incise ONLY the styled OUTLINE strokes — strip the [data-smart-hachure]
    // fill/tone groups (their dense hachure incised as a white blob = the
    // "scratch mess"). The shape's stroke treatment (multiStroke/wobble/
    // jaggedness/sketchy/penTip) lives OUTSIDE those groups; tone still reads via
    // the texture relief, untouched. Falls back to full markup if parse fails.
    // NO-LAG FLATTENER (Sebs 2026-06-16: svg-port "froze / lagged"): the old path
    // mounted the markup offscreen + ran getPointAtLength per element SYNCHRONOUSLY
    // → a dense styled doodle (hundreds of paths) blocked the main thread = freeze.
    // svgMarkupToPolylinesFast parses the path `d` strings with PURE MATH (no DOM
    // mount, no getPointAtLength) → ~instant, so the synchronous useMemo is safe.
    // It's svg-port-3D-only, so it never touches the 2D engine / locked catalog.
    let source = svgPortMarkup;
    try {
      const doc = new DOMParser().parseFromString(svgPortMarkup, 'image/svg+xml');
      if (!doc.querySelector('parsererror')) {
        // strip the dense [data-smart-hachure] fill/tone groups (else they incise
        // as a white blob — the "scratch mess"); keep the styled OUTLINE strokes
        // where multiStroke/wobble/jaggedness/sketchy/penTip live.
        doc.querySelectorAll('[data-smart-hachure]').forEach((el) => el.remove());
        source = new XMLSerializer().serializeToString(doc.documentElement);
      }
    } catch { /* keep full markup */ }
    const polys = svgMarkupToPolylinesFast(source, { targetW: tW, targetH: tH, maxElements: 300 });
    return polys.length ? (polys as unknown as StrokeInputPoint[][]) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSvgPort, svgPortMarkup, viewBox.w, viewBox.h]);
  const detailLines = useMemo<THREE.BufferGeometry | null>(() => {
    // Native solid/extrude OR svg-port (Sebs 2026-06-15): svg-port now SMOOTHS its
    // displacement (so the cap can't tear), which dims the carved marks — so it
    // needs the SAME crisp light incised lines native uses to read line-art clearly
    // (the homepage look). Build them for both; render is style-agnostic below.
    if (builds.length === 0) return null;
    if (!reliefBody && !isSvgPort) return null;
    const mass = builds[0];
    mass.geometry.computeBoundingBox();
    const bb = mass.geometry.boundingBox;
    if (!bb || !Number.isFinite(bb.max.z) || !Number.isFinite(bb.min.z)) return null;
    // svg-port displaces its tessellated cap outward (scale 0.06, bias −0.03 ⇒
    // peak ≈ bb.max.z + 0.03), which OCCLUDED the old +0.012 etch — the marks
    // were built but buried under the cap. Lift the svg-port etch above the peak
    // so the styled incised lines actually read. Native (no displaced cap) keeps
    // the tight 0.012.
    const proud = isSvgPort ? 0.06 : 0.012;
    const zFront = bb.max.z + proud; // proud of the front cap (no z-fight)
    const zBack = bb.min.z - proud;  // and the back cap — the etch reads from BOTH sides
    const positions: number[] = [];
    if (styledMarkupPool) {
      // SVG-PORT — incise the STYLED marks (so stroke toggles translate). The marks
      // come from the markup in its OWN viewBox units (e.g. 180), but the form is
      // built from strokes in the ENGINE viewBox (e.g. 800). normalizeStrokePoints
      // scales by a CONSTANT world-scale per viewBox-unit, so feeding markup-space
      // marks with the engine center rendered them at ~markupVB/engineVB ≈ 0.22×,
      // centered = a MINI copy of the drawing floating on the middle of the form
      // (Sebs 2026-06-21: "the little mini version of the object on it in the
      // middle"). FIX: fit the marks' bbox straight onto the FORM's xy bbox — the
      // same window the carve texture registers to — so they wear the form full-size.
      const pool = styledMarkupPool.slice(0, MAX_STROKES_3D);
      let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
      for (const s of pool) for (const pt of s) {
        const x = pt[0], y = pt[1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < pMinX) pMinX = x; if (x > pMaxX) pMaxX = x;
        if (y < pMinY) pMinY = y; if (y > pMaxY) pMaxY = y;
      }
      const pW = pMaxX - pMinX, pH = pMaxY - pMinY;
      if (!(pW > 1e-6) || !(pH > 1e-6)) return null;
      const bx = bb.min.x, bw = bb.max.x - bb.min.x, byTop = bb.max.y, bh = bb.max.y - bb.min.y;
      const mapX = (x: number) => bx + ((x - pMinX) / pW) * bw;
      const mapY = (y: number) => byTop - ((y - pMinY) / pH) * bh; // markup y-down → world y-up
      for (const s of pool) {
        for (let i = 0; i + 1 < s.length; i++) {
          const x0 = s[i][0], y0 = s[i][1], x1 = s[i + 1][0], y1 = s[i + 1][1];
          if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) continue;
          const ax = mapX(x0), ay = mapY(y0), cx2 = mapX(x1), cy2 = mapY(y1);
          positions.push(ax, ay, zFront, cx2, cy2, zFront);
          positions.push(ax, ay, zBack, cx2, cy2, zBack);
        }
      }
    } else {
      // NATIVE — raw strokes already live in the engine viewBox, so the form's own
      // normalization registers them correctly (no mini there).
      const pool = strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES_3D);
      if (pool.length === 0) return null;
      const center = poolCenter(pool, viewBox);
      for (const stroke of pool) {
        const world = normalizeStrokePoints(stroke, viewBox, WORLD_SCALE, center);
        for (let i = 0; i + 1 < world.length; i++) {
          positions.push(world[i].x, world[i].y, zFront, world[i + 1].x, world[i + 1].y, zFront);
          positions.push(world[i].x, world[i].y, zBack, world[i + 1].x, world[i + 1].y, zBack);
        }
      }
    }
    if (positions.length === 0) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geom;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reliefMaterial, reliefBody, isSvgPort, builds, key, paramsKey, viewBox.w, viewBox.h, styledMarkupPool, strokes]);
  useEffect(() => () => { detailLines?.dispose(); }, [detailLines]);
  const detailLineMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: new THREE.Color(paperColor ?? '#efe9dc') }),
    [paperColor],
  );
  useEffect(() => () => { detailLineMaterial.dispose(); }, [detailLineMaterial]);
  // ── SVG-PORT: the form WEARS the REAL 2D render (project_f3_shading_port_to_3d:
  // use the actual SvgStyleTransform output, never a parallel shader). Rasterize
  // svgPortMarkup → emissive ink + Sobel normal (+ height for Stage-2
  // displacement), all registered to the front-cap window via
  // applyPlanarReliefUVs. Shading stays SEPARATED so the rig never double-shades
  // the 2D tone: the drawing is the (matte) surface albedo + a partial emissive
  // that resists shadow-wash; the relief gives the carved 3D read. solid/extrude
  // only (flat cap where planar UVs behave); rod/inflate keep the lit body. ──
  // svg-port now ALWAYS builds a single pool-solid mass (see builds useMemo), so
  // the carved-cap treatment applies in every geometryMode — the marks are never
  // absent again (Bug 2: was gated to solid/extrude → blob at auto/rod/inflate).
  const svgPortBody = !!isSvgPort;
  const [svgPortTex, setSvgPortTex] = useState<SvgPortTextureResult | null>(null);
  // The TESSELLATED front cap the svg-port body renders — a CLONE of the mass
  // (so the shared builds geometry is never mutated/double-disposed), subdivided
  // so displacementMap has interior vertices to carve. null until the async
  // texture lands.
  const [svgPortGeom, setSvgPortGeom] = useState<THREE.BufferGeometry | null>(null);
  const svgPortGenRef = useRef(0);
  // Signature of the LAST committed build — so we skip a rebuild when nothing
  // that affects the texture changed (e.g. a pan re-renders this slot but the
  // markup/style are identical), and so an off-screen object that restyled
  // rebuilds exactly once when it scrolls back into view. Reset on failure.
  const builtSigRef = useRef<string | null>(null);
  // The deep-relief flag (window.__sealedRelief) is read in the build below but a
  // plain window flag isn't reactive — so toggling it wouldn't rebuild. This nonce
  // is bumped by a 'dd-relief' event; the eval helper window.__sealedReliefApply()
  // dispatches it. So: set window.__sealedRelief = 1 → window.__sealedReliefApply()
  // → the svg-port body rebuilds with (or without) the deep relief. (Sebs 2026-06-20.)
  const [reliefNonce, setReliefNonce] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as { __sealedReliefApply?: () => void }).__sealedReliefApply = () =>
      window.dispatchEvent(new Event('dd-relief'));
    const onRelief = () => setReliefNonce((n) => n + 1);
    window.addEventListener('dd-relief', onRelief);
    return () => window.removeEventListener('dd-relief', onRelief);
  }, []);
  useEffect(() => {
    if (!svgPortBody || !svgPortMarkup || builds.length === 0) {
      builtSigRef.current = null;
      setSvgPortTex((prev) => { disposeSvgPortTex(prev); return null; });
      setSvgPortGeom((prev) => { prev?.dispose(); return null; });
      return;
    }
    // PERF GATE (Sebs 2026-06-20 "get rid of lag"): a flip-MANY surface (desk/
    // drawer) restyles EVERY object at once → 20 full-res carve builds in one
    // frame = the hitch. Build ONLY on-screen objects; off-screen ones keep their
    // warm texture and rebuild the first time they scroll into view. Also skip
    // when the build inputs are byte-identical to the last commit (a pan/hover
    // re-render). Default inView=true ⇒ the single-object modal/preview path is
    // unchanged (always builds, full res).
    const inView = svgPortBuild?.inView ?? true;
    const sig =
      svgPortMarkup + '|' + paramsKey + '|' + geometryMode + '|' +
      viewBox.w + '×' + viewBox.h + '|' + (paperColor ?? '') + '|' + reliefNonce +
      '|' + (svgPortBuild?.longEdge ?? 0) + '|' + (svgPortBuild?.styleId ?? '') +
      '|' + (svgPortBuild?.reliefDepth ?? 0) + // deep-relief slider → rebuild on change
      '|' + (svgPortBuild?.reliefCsg ? 'csg' : 'geo'); // V1↔V2 wall style → rebuild
    if (!inView || sig === builtSigRef.current) return;
    const mass = builds[0];
    mass.geometry.computeBoundingBox();
    const bb = mass.geometry.boundingBox;
    if (!bb || !Number.isFinite(bb.min.x) || !Number.isFinite(bb.max.x)) {
      builtSigRef.current = null;
      setSvgPortTex((prev) => { disposeSvgPortTex(prev); return null; });
      setSvgPortGeom((prev) => { prev?.dispose(); return null; });
      return;
    }
    const pool = strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES_3D);
    const myGen = ++svgPortGenRef.current;
    builtSigRef.current = sig; // commit intent; reset on failure so a retry can rebuild
    let cancelled = false;
    buildSvgPortTexture(
      svgPortMarkup,
      pool,
      viewBox,
      { minX: bb.min.x, maxX: bb.max.x, minY: bb.min.y, maxY: bb.max.y },
      { paperColor, styleId: svgPortBuild?.styleId, longEdge: svgPortBuild?.longEdge },
    )
      .then(async (res) => {
        // Stale-guard: a newer build superseded this async load → drop it.
        if (cancelled || myGen !== svgPortGenRef.current) { disposeSvgPortTex(res); return; }
        if (!res) return;
        // Build the carve surface: clone the mass, subdivide so displacement has
        // interior vertices, then write planar UVs from world xy (exact per
        // vertex regardless of topology) so ink + carve co-register.
        let carved: THREE.BufferGeometry | null = null;
        // DEEP RELIEF depth from the 3D-controls slider (svgPortBuild.reliefDepth);
        // the dev flag (window.__sealedRelief) still overrides for tuning.
        const reliefDepth = sealedReliefOn() ? sealedReliefScale() : (svgPortBuild?.reliefDepth ?? 0);
        try {
          const clone = mass.geometry.clone();
          // maxEdgeLength in WORLD units (~groove width) so a mark spans several
          // triangles; cap iterations to bound the non-indexed vertex balloon.
          // FINER 0.06→0.04 + 5 iters (deep-carve pass): the deeper displacement
          // faceted/dashed HAIRLINE strokes on the coarse cap (a thin groove fell
          // between triangle edges). A denser cap lets thin marks carve as smooth
          // continuous channels instead of a dashed ridge.
          // R10 2026-06-15: 0.04,5 → 0.03,6 — finer cap so thin marks (Game Boy
          // screen edge, button rims) carve as continuous channels at the deeper
          // displacement, not faceted dashes. Research ceiling for thumbnail slabs.
          // Finer cap when DEEP relief is on so the steeper (crisper) walls resolve
          // as continuous geometry, not facets (Make-friendly crisp version).
          carved = new TessellateModifier(reliefDepth > 0 ? 0.022 : 0.03, 6).modify(clone);
          clone.dispose();
          applyPlanarReliefUVs(carved, res.window);
          // V2 — manifold CSG TRUE-VERTICAL walls. DEEP version (Sebs 2026-06-22
          // "crisp engrave everywhere"): carves BOTH the primitive treatMask features
          // (buttons/screens) AND the doodle's STRUCTURAL tonal regions (from the soft
          // height field) — so a FREEHAND doodle gets crisp sheer walls too, not just
          // the soft displacement. Fine line-detail stays on the normal map. Opt-in
          // (reliefCsg); no longer needs primitive features (contours cover any doodle).
          // Returns null on ANY failure (WASM blocked, non-manifold, op error) → V1.
          let usedCsg = false;
          if (reliefDepth > 0 && svgPortBuild?.reliefCsg) {
            // SOFT height field (carveDisp) → fine lines blurred out → STRUCTURE only.
            const structCanvas = res.height.image instanceof HTMLCanvasElement ? res.height.image : null;
            const csgGeom = await applyDeepCsgRelief(
              mass.geometry, res.treatFeatures ?? [], structCanvas, res.window,
              { frontZ: bb.max.z, thickness: Math.max(0.05, bb.max.z - bb.min.z), depth: reliefDepth },
            );
            if (cancelled || myGen !== svgPortGenRef.current) { csgGeom?.dispose(); disposeSvgPortTex(res); return; }
            if (csgGeom) {
              applyPlanarReliefUVs(csgGeom, res.window); // re-register the ink/normal map
              carved.dispose();
              carved = csgGeom;
              usedCsg = true;
            }
          }
          // V1 — Make-friendly CPU front-cap displacement (the always-safe fallback /
          // default). Uses the SHARPER structure height for steeper crisper walls.
          const deepHeight = (res.structureHeight?.image instanceof HTMLCanvasElement
            ? res.structureHeight.image
            : (res.height.image instanceof HTMLCanvasElement ? res.height.image : null));
          if (reliefDepth > 0 && !usedCsg && deepHeight) {
            displaceFrontCapByHeight(carved, deepHeight, res.window, reliefDepth);
          }
          carved.computeVertexNormals();
        } catch {
          carved = null; // tessellation failed → fall back to flat cap (normalMap only)
        }
        setSvgPortTex((prev) => { disposeSvgPortTex(prev); return res; });
        setSvgPortGeom((prev) => { prev?.dispose(); return carved; });
        // Fallback registration on the original mass for the brief pre-carve frame.
        if (!carved) applyPlanarReliefUVs(mass.geometry, res.window);
      })
      .catch(() => {
        // load failure → caller keeps the plain lit body; clear the committed
        // signature so a later re-render retries the build.
        if (myGen === svgPortGenRef.current) builtSigRef.current = null;
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgPortBody, svgPortMarkup, builds, key, paramsKey, geometryMode, viewBox.w, viewBox.h, paperColor, reliefNonce, svgPortBuild]);
  useEffect(() => () => { disposeSvgPortTex(svgPortTex); }, [svgPortTex]);
  useEffect(() => () => { svgPortGeom?.dispose(); }, [svgPortGeom]);

  // reliefNonce in deps: the deep-relief flag flips this material's GPU
  // displacementScale to 0 (CPU did the displacement) — re-derive on apply.
  const svgPortMaterial = useMemo<THREE.Material | null>(() => {
    if (!svgPortTex) return null;
    // TUNE HOOK (calibration only): the catalog harness driver may set
    // window.__svgPortTune to sweep material params live without a rebuild. Inert
    // in the product (the global is never set there). Final values are the
    // literals below; the lead applies those, not this hook.
    const tune = (typeof window !== 'undefined'
      ? (window as unknown as { __svgPortTune?: Record<string, number> }).__svgPortTune
      : undefined) ?? {};
    // svg-port uses the SPLIT (safe 0.18) so deep displacement doesn't tear thin
    // line-art on the single-step cap (diagnosis fix C); native keeps 0.42 (line 901).
    // When the deep-relief flag is on, the CPU already displaced the cap geometry
    // → drop the GPU displacementMap so it isn't applied twice.
    // When DEEP relief is on (dev flag OR the controls slider), the CPU already
    // displaced the welded cap → drop the GPU displacementMap so it isn't doubled.
    const deepOn = sealedReliefOn() || (svgPortBuild?.reliefDepth ?? 0) > 0;
    const dispScale = deepOn ? 0 : (tune.displacementScale ?? SVGPORT_DISPLACEMENT_SCALE);
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: svgPortTex.emissive,            // the drawing as lit albedo (relief shades it)
      normalMap: svgPortTex.normal,        // crisp groove walls (head-on relief)
      displacementMap: svgPortTex.height,  // REAL carved geometry on the tessellated cap
      displacementScale: dispScale,
      // SIGNED 3-treatment field (Sebs 2026-06-15): texel 0.5 = FLAT surface,
      // 1.0 = +0.5·scale (RAISED out), 0.0 = −0.5·scale (INDENT in). Recentering
      // the bias to −0.5·scale is what unlocks raised relief (was −scale = a
      // one-sided recess-only field that could never push a vertex outward).
      displacementBias: -0.5 * dispScale,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: svgPortTex.emissive,    // partial self-lit → ink values resist shadow wash
      // LOWERED 0.30→0.18 (sparse-legibility pass 2026-06-13): high emissive makes
      // the WHOLE cap self-glow uniformly — that FLAT glow is what washed sparse
      // marks out (the lit relief, which is what reads as "engraved", got drowned
      // by the constant self-light). At 0.18 the emissive still keeps the ink
      // VALUES from crushing to pure shadow (the 2D vibe), but the lit carve now
      // DOMINATES the read so the marks look incised, not printed-flat. The carve-
      // side AO + paper-darken (drawingTexture) do the contrast work that the high
      // emissive used to fake. */
      // 0.12→0.42: the svg-port scene's grazing key leaves the front face dark, so
      // light-albedo marks didn't pop. Higher emissive SELECTIVELY brightens the
      // marks (their emissiveMap value is high) while the dark graphite ground
      // (low emissiveMap) stays dark — marks read without washing the form.
      emissiveIntensity: tune.emissiveIntensity ?? 0.42,
      roughness: 1.0,                      // matte — no plastic highlight over the ink
      metalness: 0.0,
    });
    // STRENGTHENED 2.6→3.4 (sparse-legibility pass 2026-06-13): the Sobel normal
    // walls tilt harder still so an ISOLATED thin groove throws a bold light/
    // shadow edge head-on — the single biggest "the mark reads engraved, not
    // faint" lever on a flat near-white cap. Paired with the steeper carve-side
    // NORMAL_STRENGTH (0.6) and the trimmed studio fill. Y inverted (canvas
    // y-down → world y-up).
    // PENCIL/artifact pass (Sebs 2026-06-15, diagnosis wccranuf1 fix B): 4.0 ×
    // (1/NORMAL_STRENGTH 0.5) = 8× compounded, which turned rasterized carve
    // stairs into HARSH facets (the "jagged/dashy etch"). Back off to 2.5 to
    // soften the wall normals — conservative + reversible; etch still reads.
    // (Carve-field blur (fix A) + displacement split (fix C) are the eyes-on
    // morning follow-ups; this is the safe single-value backoff.)
    const ns = tune.normalScale ?? 2.0;
    m.normalScale = new THREE.Vector2(ns, -ns);
    m.needsUpdate = true;
    return m;
  }, [svgPortTex, reliefNonce, svgPortBuild]);
  useEffect(() => () => { if (svgPortMaterial) svgPortMaterial.dispose(); }, [svgPortMaterial]);

  /** The material the BODY mesh renders with: svg-port relief when ported, else
   *  bas-relief-augmented when carved (Native), else the plain passed material.
   *  (MeshPhysicalMaterial extends MeshStandardMaterial, so the Native presets
   *  qualify for the bumpMap.) */
  const bodyMaterial = (svgPortBody && svgPortMaterial) ? svgPortMaterial : (reliefMaterial ?? material);

  // Debug introspection (window.__dd_decisionLog house pattern, QW-2): the
  // verify harness + future calibration sweeps read what the scene actually
  // built — no sampled claims, receipts from the live object.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__dd3d = {
      geometryMode,
      paramsKey,
      // RC-2 receipt: whether the body wears the carved bas-relief height field
      // (true on Solid/Extrude + Native, false otherwise). The verify harness
      // reads this from the live object — no sampled claims.
      reliefBump: relief != null,
      rodFamilies: {
        capStyle: modeParams.rod.capStyle,
        jointStyle: modeParams.rod.jointStyle,
        jointSensitivityDeg: modeParams.rod.jointSensitivityDeg,
      },
      builds: builds.map((b) =>
        b.kind === 'rod'
          ? { kind: b.kind, joints: b.jointPositions.length, caps: b.capPositions.length, radius: b.radius }
          : b.kind === 'solid'
            ? { kind: b.kind, outerContours: b.outerContours, holes: b.holes }
            : b.kind === 'extrude'
              ? { kind: b.kind, holesCut: b.holesCut }
              : { kind: b.kind },
      ),
    };
  }, [builds, geometryMode, paramsKey, modeParams.rod, relief]);

  // SVG-port ink outline: EdgesGeometry per mesh (30° crease threshold —
  // smooth tubes contribute almost nothing, slab rims read as drawn lines).
  // This is the v1 bridge's outline register; the post-makeathon TAM path
  // replaces it with a stable-seed SvgStyleTransform projection (M8 doc).
  const edges = useMemo<THREE.EdgesGeometry[]>(() => {
    if (!showEdges) return [];
    return builds.map((b) => new THREE.EdgesGeometry(b.geometry, 30));
  }, [builds, showEdges]);
  useEffect(() => {
    return () => {
      for (const e of edges) e.dispose();
    };
  }, [edges]);
  const edgeMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: new THREE.Color(edgeColor) }),
    [edgeColor],
  );
  useEffect(() => {
    return () => edgeMaterial.dispose();
  }, [edgeMaterial]);

  // Shared UNIT primitives for rod adornments (caps + joint blobs), scaled/
  // oriented per rodAdornmentSpecs (plan §1.1 — sibling meshes instead of CSG
  // merge). Sphere tessellation = free-stroke SPHERE_SEGMENTS (14×14).
  const capSphere = useMemo(() => new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_SEGMENTS), []);
  const capDisk = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 24), []);
  useEffect(() => {
    return () => {
      capSphere.dispose();
      capDisk.dispose();
    };
  }, [capSphere, capDisk]);

  // Tier-2 rod families → adornment specs (ONE placement source of truth —
  // rodAdornments.ts — shared with the tools/3d board harness).
  const adornments = useMemo<RodAdornmentSpec[][]>(
    () =>
      builds.map((b) =>
        b.kind === 'rod'
          ? rodAdornmentSpecs(b, modeParams.rod.capStyle, modeParams.rod.jointStyle, modeParams.rod.caps)
          : [],
      ),
    [builds, modeParams.rod.capStyle, modeParams.rod.jointStyle, modeParams.rod.caps],
  );

  // World-space pool bounds across every geometry (incl. cap/joint spheres,
  // which extend radius around their centerline positions). Drives the
  // ground-contact shadow plane (minY) AND the content-fit camera framing
  // (center + radius). Deterministic: pure function of builds.
  const bounds = useMemo<PoolBounds | null>(() => {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const b of builds) {
      b.geometry.computeBoundingBox();
      const bb = b.geometry.boundingBox;
      if (bb && Number.isFinite(bb.min.x) && Number.isFinite(bb.max.x)) {
        min.min(bb.min);
        max.max(bb.max);
      }
      if (b.kind === 'rod') {
        // Pad by the largest adornment reach (ink-blob bead = 1.5×radius) so
        // shadow + framing cover every cap family without re-measuring.
        const pad = b.radius * 1.5;
        for (const p of b.capPositions.concat(b.jointPositions, b.endPositions)) {
          min.min(new THREE.Vector3(p.x - pad, p.y - pad, p.z - pad));
          max.max(new THREE.Vector3(p.x + pad, p.y + pad, p.z + pad));
        }
      }
    }
    if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) return null;
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    const size = new THREE.Vector3().subVectors(max, min);
    const radius = size.length() / 2;
    return { center, radius, minY: min.y, size };
  }, [builds]);

  // Native OUTLINE: inverted-hull material — backfaces pushed out along the
  // normal by (outlineWidth × radius-scaled amount), flat ink. Push is in
  // world units scaled by the pool radius so the silhouette weight reads the
  // same regardless of object scale; depthWrite off so it never z-fights the
  // body. 0 = no hull at all (default — byte-identical default render).
  const outlinePush = outlineWidth > 0 && bounds ? outlineWidth * 0.04 * Math.max(bounds.radius, 0.5) : 0;
  const hullMaterial = useMemo<THREE.ShaderMaterial | null>(() => {
    if (outlinePush <= 0) return null;
    return new THREE.ShaderMaterial({
      uniforms: {
        u_push: { value: outlinePush },
        u_ink: { value: new THREE.Color(edgeColor) },
      },
      vertexShader: /* glsl */ `
        uniform float u_push;
        void main() {
          vec3 p = position + normal * u_push;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 u_ink;
        void main() { gl_FragColor = vec4(u_ink, 1.0); }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
  }, [outlinePush, edgeColor]);
  useEffect(() => {
    return () => {
      if (hullMaterial) hullMaterial.dispose();
    };
  }, [hullMaterial]);

  // The local 3D form (native builds + tone/fill slabs). Rendered directly when
  // there's no AI mesh, AND used as the Suspense fallback so the doodle's own 3D
  // shows while the GLB streams — then swaps to the AI mesh on load (no blank well).
  const localForm = (
    <>
      {builds.map((b, i) => (
        <group key={i}>
          {/* Native OUTLINE — inverted-hull backface pass UNDER the body. */}
          {hullMaterial && <mesh geometry={b.geometry} material={hullMaterial} />}
          {/* Body — wears the carved bas-relief bumpMap on Solid/Extrude+Native,
              or the svg-port carve (tessellated cap geometry) on i=0. bodyMaterial
              === material for every other mode → unchanged. */}
          <mesh
            geometry={
              svgPortBody && i === 0 && svgPortGeom
                ? svgPortGeom
                : reliefMaterial && i === 0 && reliefGeom
                  ? reliefGeom // native carve: tessellated cap so displacement recesses real geometry
                  : b.geometry
            }
            // The carved bas-relief/svg-port material (displacementMap + bumpMap on
            // PLANAR relief UVs over the whole-pool height field) is the MASS's
            // material — it only fits build[0]'s tessellated cap. Applying it to the
            // OTHER builds shattered them: in explicit Extrude a multi-stroke line
            // drawing yields disc(=build[0], carved) + per-stroke ROD rays, and the
            // rods have their OWN rod UVs + no tessellation, so the displacementMap
            // pushed their verts to garbage → the "feathered shards" (Sebs 2026-06-21,
            // dd-lineart-many). Mass wears the carve; every other build wears the plain
            // ink material → clean rods, identical to Rod mode. (Solid/svg-port are a
            // single build, so i===0 always → byte-identical there.)
            material={i === 0 ? bodyMaterial : material}
          />
          {showEdges && edges[i] && (
            <lineSegments geometry={edges[i]} material={edgeMaterial} />
          )}
          {/* Etched detail — the doodle's lines as LIGHT incised lines on the
              black form so the inner detail reads (i=0 mass only). */}
          {i === 0 && detailLines && (
            <lineSegments geometry={detailLines} material={detailLineMaterial} />
          )}
          {/* Rod adornments — Tier-2 cap family (round/flat/ink-blob) + joint
              family (blob/clean) + the End-caps toggle, all through
              rodAdornmentSpecs (one placement source, shared with the board
              harness). */}
          {adornments[i]?.map((spec, j) => (
            <mesh
              key={`a${j}`}
              geometry={spec.shape === 'sphere' ? capSphere : capDisk}
              position={spec.position}
              scale={spec.scale}
              quaternion={spec.quaternion}
              material={material}
            />
          ))}
        </group>
      ))}
      {/* TONE/FILL bodies — each painted region as a band-greyscale slab so the
          fill (and its band value) carries into 3D instead of vanishing on the
          flip (fill→3D-hollow fix). Sits slightly behind z=0 so coplanar ink
          edges read on top without z-fighting.
          GATED OFF for svg-port (Sebs 2026-06-15): svg-port now carries tone via
          the signed relief BASIN in its own height field — the separate grey slab
          was rendering ON TOP as a mid-grey mesh = the "bright blob" artifact (a
          flat albedo tint, the north-star violation). Native still uses it until
          its tone→etch port (Stage 2). */}
      {!svgPortBody && fillBodies.map((f, i) => (
        <mesh key={`fill${i}`} geometry={f.geometry} material={f.material} position={[0, 0, -0.03]} />
      ))}
    </>
  );

  return (
    <group>
      {/* HARD PATH (FORM axis, Sebs 2026-06-27): the AI-generated GLB is the
          'ai-mesh' FORM. It renders when a GLB exists AND the geometry FORM is
          'ai-mesh' (its default) OR 'auto' (untouched — backward-compat for every
          placed mesh saved before the FORM split). An EXPLICIT stroke FORM
          (rod/extrude/inflate/solid) converts the Quiver SVG instead → the local
          form shows. Local builds still compute (above) for bounds/shadow/framing.
          While the GLB streams, Suspense falls back to the local form (no blank
          well); it swaps to the AI mesh on load. */}
      {hardMeshUrl && (geometryMode === 'ai-mesh' || geometryMode === 'auto') ? (
        <Suspense fallback={localForm}>
          <AiMeshSpinner spin={aiMeshAutoSpin}>
            <HardMesh url={hardMeshUrl} materialMode={aiMeshMaterialMode} dark={aiMeshDark} contrast={aiMeshContrast} engineMaterial={meshEngineMaterial} outline={meshOutline} planarUv={meshPlanarUv} line={meshLine} ink={edgeColor} target={(bounds ? Math.max(bounds.radius * 2, 2) : 3.2) * 0.7} />{/* ×0.7 = margin so wide/flat meshes (gameboy) don't clip the camera frame; line = the 2D pen controls ported onto svg-port line-art */}
          </AiMeshSpinner>
        </Suspense>
      ) : (
        localForm
      )}
      {/* (RC-2 fix: the buried-hand problem is now solved by the bas-relief
          bumpMap on the body itself — applied above — so there is no separate
          face-ink overlay group. The drawing IS the surface.) */}
      {/* Soft ground-contact shadow (rig adaptation for white paper). frames={1}
          bakes ONCE per mount = deterministic; the key remounts it whenever
          the strokes/mode/params (and therefore the geometry) change. */}
      {builds.length > 0 && bounds && !hideContactShadow && (
        <ContactShadows
          key={`${key}|${geometryMode}|${paramsKey}`}
          frames={1}
          position={[bounds.center.x, bounds.minY - CONTACT_SHADOW_DROP, bounds.center.z]}
          opacity={CONTACT_SHADOW.opacity}
          blur={CONTACT_SHADOW.blur}
          color={CONTACT_SHADOW.color}
          resolution={CONTACT_SHADOW.resolution}
          scale={Math.max(CONTACT_SHADOW.scale, bounds.radius * 3)}
          far={CONTACT_SHADOW.far}
        />
      )}
      <CameraFramer bounds={bounds} />
    </group>
  );
}

/** Props for the scene INTERNALS — everything that renders inside an R3F
 *  renderer (a `<Canvas>` OR a drei `<View>`). Extracted from Stroke3DScene so
 *  the SAME scene can run as one-object-per-canvas (Stroke3DScene, below) OR as
 *  many-objects-one-canvas (MultiStroke3D via drei <View> — the flip-all path
 *  that removes the WebGL context limit). No DOM/Canvas-level props here. */
export interface Stroke3DContentsProps {
  strokes: StrokeInputPoint[][];
  toneFills?: ToneFill[];
  viewBox?: ViewBoxSize;
  geometryMode?: GeometryModeSetting;
  style3d?: 'native' | 'hatch' | 'svg-port';
  materialPreset?: MaterialPresetId;
  nativeProps?: NativeProps3D;
  modeParams?: Mode3DParams;
  hatchInputs?: HatchInputs;
  svgPortMarkup?: string;
  /** svg-port BUILD controls (perf gate + per-style relief) — forwarded to
   *  StrokeMeshes. Omitted ⇒ full res, always build (single-object path). */
  svgPortBuild?: SvgPortBuildOpts;
  hardMeshUrl?: string;
  /** Per-object AI-mesh look override (saved render_config.aiMesh) → forwarded to
   *  StrokeMeshes so a placed AI mesh shows the maker's saved Material/Darkness/
   *  Auto-spin instead of the shared context. */
  aiMeshLook?: { materialMode?: 'greyscale' | 'og-pbr' | 'hatch' | 'native' | 'svg-port'; dark?: number; contrast?: number; autoSpin?: boolean };
  inkColor?: string;
  /** Resolved paper hex (the parent owns the one-shot resolve). */
  bg: string;
  /** Resolved ink hex. */
  ink: string;
  /** ARROW-RULE overrides (controlled — the chip lives outside the renderer in
   *  Stroke3DScene; thumbnails/Views pass {} / no chips). */
  treatAsClosedBySig?: Record<string, boolean>;
  /** No scene-background fill → page/desk paper shows through. */
  transparent?: boolean;
  /** Mount drag-rotate controls inside this renderer. */
  orbit?: boolean;
  /** Element the drag-rotate controls bind their pointer listeners to. In a
   *  shared-canvas <View> (MultiStroke3D) the canvas is pointerEvents:none, so
   *  controls MUST bind to THIS view's slot div — drei's implicit
   *  events.connected proved unreliable across N views and silently killed
   *  rotation (Sebs 2026-06-14: "I can still rotate?"). Omit on a single
   *  <Canvas> (controls fall back to the canvas, which is correct there). */
  controlsDomElement?: HTMLElement | null;
  /** Per-object manual tumble (desk rotate-HANDLE). When set, the form rotates to
   *  {az,el} each frame from this ref and orbit controls are left OFF — so the
   *  body drags to MOVE and the handle drags to ROTATE (Sebs 2026-06-27, "drag
   *  the object too… no mode switch"). Omitted ⇒ identity + OrbitControls (/canvas). */
  tumbleRef?: MutableRefObject<TumbleState> | null;
}

/** The scene internals — lights + meshes + controls. Renders inside whatever
 *  R3F renderer wraps it (`<Canvas>` for Stroke3DScene, `<View>` for
 *  MultiStroke3D). Self-contained: builds its own materials (each object needs
 *  its own instance). */
export function Stroke3DContents({
  strokes,
  toneFills,
  viewBox = DEFAULT_VIEWBOX,
  geometryMode = 'auto',
  style3d = 'native',
  materialPreset,
  nativeProps = DEFAULT_NATIVE_PROPS_3D,
  modeParams = DEFAULT_MODE3D_PARAMS,
  hatchInputs = DEFAULT_HATCH_INPUTS,
  svgPortMarkup,
  svgPortBuild,
  hardMeshUrl,
  aiMeshLook,
  inkColor,
  bg,
  ink,
  treatAsClosedBySig = {},
  transparent = false,
  orbit = true,
  controlsDomElement,
  tumbleRef,
}: Stroke3DContentsProps) {
  // ── Native: FS preset MeshPhysicalMaterial (materials3d.ts, verbatim) +
  // the four PROPERTY dials (symmetry-law gap cell §2). Neutral dials =
  // preset params unchanged; Reflection is hard-bounded (ink-black holds). ──
  const preset: MaterialPresetId = materialPreset ?? MODE_MATERIAL_DEFAULTS_3D[geometryMode];
  const nativeMaterial = useMemo(
    () => createNativeMaterial(preset, inkColor, nativeProps),
    [preset, inkColor, nativeProps],
  );
  useEffect(() => {
    return () => nativeMaterial.dispose();
  }, [nativeMaterial]);

  // Native OUTLINE dial → inverted-hull silhouette in ink (the drawn edge
  // weight on the form). 0 = off (default → no overlay → byte-identical
  // default Native render). The hull pushes backfaces out along the normal,
  // so weight reads even on non-spherical forms and scales with the object.
  const outlineWidth = style3d === 'native' ? nativeProps.outline : 0;

  // ── Hatch: the band-quantized ShaderMaterial (one instance, uniforms updated
  // live — slider moves re-hatch without rebuilds). svg-port NO LONGER uses
  // this shader (the killed parallel-shader path): it builds a SvgPort relief
  // material inside StrokeMeshes from the REAL 2D render. native uses the lit
  // preset. So the hatch ShaderMaterial is created for the 'hatch' style only. ──
  const hatchMaterial = useMemo(() => {
    if (style3d !== 'hatch') return null;
    return createHatchMaterial('hatch');
  }, [style3d]);
  useEffect(() => {
    return () => {
      if (hatchMaterial) hatchMaterial.dispose();
    };
  }, [hatchMaterial]);

  // svg-port + native both fall back to the lit nativeMaterial as the BASE; the
  // svg-port body gets overridden with its relief material inside StrokeMeshes.
  const material: THREE.Material = hatchMaterial ?? nativeMaterial;

  // ── AI-MESH SURFACE (Sebs 2026-06-27 — "don't remove stuff, just make it work").
  // A hard-mesh GLB wears one of the surface MODES, independent of the global
  // style3d that dresses LOCAL geometry. greyscale/og-pbr are handled in HardMesh
  // (the texture re-skin); 'native'/'hatch' get OUR engine material here — the
  // FULL one, so EVERY control works on the mesh:
  //   · 'native' → the lit nativeMaterial = respects the Material preset (ink…
  //     glossyPlastic) AND the Polish/Reflection/Sheen dials (nothing forced).
  //   · 'hatch'  → a screen-space hatch instance that respects the live Grammar
  //     (hachure / cross-hatch / stipple / contour) + Direction (synced below).
  // The OFAT (docs/submission/MESH-SURFACE-OFAT.md) is the recommended DEFAULT
  // (greyscale default; cross-hatch + matte read best), not a removal — every
  // option stays reachable. PBR is the lone photoreal exception.
  const _ctxSurf = useCanvas3D();
  const aiMeshSurface = aiMeshLook?.materialMode ?? _ctxSurf.aiMeshMaterialMode;
  const meshHatch = useMemo(
    () => (hardMeshUrl && aiMeshSurface === 'hatch' ? createHatchMaterial('hatch') : null),
    [hardMeshUrl, aiMeshSurface],
  );
  useEffect(() => () => meshHatch?.dispose(), [meshHatch]);
  // SVG-PORT on the mesh (Sebs 2026-06-27): the object's drawing ENGRAVED on the GLB
  // as light incised lines on a dark form (planar UV in HardMesh). It CARRIES THE 2D
  // STYLE — rasterize the STYLED markup (rough / charcoal / stipple / wet-ink / …) and
  // invert to light-on-dark; fall back to plain strokes when there's no markup (e.g.
  // a photo-upload mesh). Async (Image load for the styled SVG) → useState/useEffect.
  const [meshSvgPortMat, setMeshSvgPortMat] = useState<THREE.MeshStandardMaterial | null>(null);
  useEffect(() => {
    if (!(hardMeshUrl && aiMeshSurface === 'svg-port')) { setMeshSvgPortMat(null); return; }
    let cancelled = false;
    const makeMat = (tex: THREE.Texture) => {
      const m = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: tex,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: tex, // the LIGHT marks (high value) self-glow; the dark ground stays dark
        emissiveIntensity: 1.6, // ↑ from 1.15 so the incised lines pop on darker drawings (Game Boy)
        roughness: 1,
        metalness: 0,
        // NORMAL MASK (the Game Boy banding fix): HardMesh writes a per-vertex
        // color = how much the face faces the projection axis. vertexColors makes
        // it multiply the diffuse marks; the inject below fades the self-lit
        // emissive marks too → side walls drop to plain dark ink, no smeared bands.
        vertexColors: true,
      });
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor;',
        );
      };
      m.customProgramCacheKey = () => 'dd-svgport-engrave-normal-masked';
      return m;
    };
    rasterizeMarkupToEngraving(svgPortMarkup ?? '')
      .then((styled) => {
        if (cancelled) { styled?.dispose(); return; }
        if (styled) { setMeshSvgPortMat(makeMat(styled)); return; }
        // fallback — plain strokes engraving (no styled markup available)
        const pool = strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES_3D);
        const tex = rasterizeStrokesToTexture(pool, ink || '#1a1a1a', bg || '#efe9df');
        if (tex) setMeshSvgPortMat(makeMat(tex));
        else setMeshSvgPortMat(null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [hardMeshUrl, aiMeshSurface, svgPortMarkup, strokes, bg, ink]);
  useEffect(
    () => () => {
      if (meshSvgPortMat) {
        (meshSvgPortMat.map as THREE.Texture | null)?.dispose();
        meshSvgPortMat.dispose();
      }
    },
    [meshSvgPortMat],
  );
  // SVG-PORT on a mesh = the mesh's OWN form drawn as a hand-drawn LINE DRAWING
  // (Sebs 2026-06-28, THE CORE RULE: "you can't take the strokes from 2D and plop
  // them onto the ai mesh — we RECREATE THE FEELING"). It no longer stamps the 2D
  // drawing (`meshSvgPortMat`/planar projection — deleted from the path); instead it
  // ink-skins the mesh's own material and inks its texture-edge boundaries (HardMesh
  // pencil path). So svg-port = the line look, native = the solid lit-ink look, both
  // from the mesh ITSELF. (`meshSvgPortMat` is left built but unused — dormant.)
  const meshEngineMaterial: THREE.Material | null =
    !hardMeshUrl ? null
      : aiMeshSurface === 'hatch' ? meshHatch
      : aiMeshSurface === 'native' || aiMeshSurface === 'svg-port' ? nativeMaterial
      : null;
  const meshPlanarUv = false; // no 2D-drawing projection — the core-rule violation
  // OUTLINE on the mesh = the Outline dial. Works on BOTH native AND hatch surfaces
  // (the hull is a separate BackSide ink pass, independent of the body material) →
  // a clean ink silhouette can wrap a hatched form (pen-and-ink), not just native
  // (Sebs 2026-06-27 mega-OFAT R3). greyscale/PBR keep their own re-skin (no hull).
  const meshOutline = hardMeshUrl && (aiMeshSurface === 'native' || aiMeshSurface === 'hatch') ? nativeProps.outline : 0;

  return (
    <>
      {/* Transparent = no scene background fill → the page/desk paper shows
          through (the doodle sits on the desk, not in a white box). Opaque =
          the paper fill (the /canvas + panel-well render). */}
      {!transparent && <color attach="background" args={[bg]} />}
      {/* svg-port trims the omnidirectional fill so shallow relief catches the
          grazing carve key (sparse-legibility pass). Native/Hatch = full rig. */}
      <StudioRig dimFill={style3d === 'svg-port'} lite={transparent} />
      {/* svg-port carve light — a LOW grazing key so the drawing's carved
          grooves cast micro-shadow and read as engraved relief (the high studio
          key alone leaves shallow grooves flat). STRENGTHENED + lowered
          (deep-carve pass, Sebs "deep enough to be seen"): intensity 1.15→1.7
          and elevation pushed down (y 2→1.3) so the rake is harder and the
          channel walls throw a deeper shadow. A second, opposite low fill keeps
          the far groove walls from going pure black on orbit. Only when svg-port
          is active; never perturbs Native/Hatch. */}
      {style3d === 'svg-port' && (
        <>
          <directionalLight position={[7, 1.3, 3.2]} intensity={1.7} color="#fff8ee" />
          <directionalLight position={[-5, 1.0, 2.6]} intensity={0.6} color="#eef2f8" />
        </>
      )}
      {/* svg-port MESH = ENGRAVED dark form + light incised lines. Keep the form
          lighting LOW so the dark ground stays dark and the emissive light lines POP
          (the contrast that makes the drawing read); a soft key gives the form just
          enough shading to read 3D (Sebs 2026-06-27, the real build). */}
      {aiMeshSurface === 'svg-port' && (
        <>
          <directionalLight position={[0, 2, 8]} intensity={1.1} color="#fffaf2" />
          <ambientLight intensity={0.18} />
        </>
      )}
      {/* Native bas-relief carve light (deep-carve pass, Sebs "native shouldn't
          bury the drawing in a featureless dark blob"): the bumpMap drawing on
          the extrude/solid front face is near-invisible under the high studio
          key alone — a LOW grazing rake makes the carved grooves throw a bright
          highlight + shadow on the dark ink body so the drawing reads. Native
          form modes only; rod/inflate ARE the strokes (no slab face to carve). */}
      {style3d === 'native' && (geometryMode === 'extrude' || geometryMode === 'solid') && (
        <>
          <directionalLight position={[6.5, 1.4, 3.4]} intensity={1.5} color="#fff5e6" />
          <directionalLight position={[-5, 1.1, 2.4]} intensity={0.5} color="#eef2f8" />
        </>
      )}
      {hatchMaterial && (
        <HatchUniformSync
          material={hatchMaterial}
          variant="hatch"
          inputs={hatchInputs}
          ink={ink}
          paper={bg}
        />
      )}
      {/* Mesh-surface hatch needs its own per-frame uniform sync (the GLB wears
          this exact instance) — uses the LIVE hatch inputs so the Grammar +
          Direction controls drive it (cross-hatch is the recommended default). */}
      {meshHatch && (
        <HatchUniformSync
          material={meshHatch}
          variant="hatch"
          inputs={hatchInputs}
          ink={ink}
          paper={bg}
        />
      )}
      {/* TumbleGroup = the desk rotate-HANDLE pivot (identity on /canvas). It
          wraps StrokeMeshes; CameraFramer inside is camera-only (renders null, so
          the rotation never touches it) and ContactShadows is OFF when transparent
          (the desk path) — so only the visible form spins, framed + in place. */}
      <TumbleGroup tumbleRef={tumbleRef}>
        <StrokeMeshes
          strokes={strokes}
          toneFills={toneFills}
          viewBox={viewBox}
          geometryMode={geometryMode}
          material={material}
          isNative={style3d === 'native'}
          isSvgPort={style3d === 'svg-port'}
          svgPortMarkup={svgPortMarkup}
          svgPortBuild={svgPortBuild}
          hardMeshUrl={hardMeshUrl}
          aiMeshLook={aiMeshLook}
          meshEngineMaterial={meshEngineMaterial}
          meshOutline={meshOutline}
          meshPlanarUv={meshPlanarUv}
          hatchInputs={hatchInputs}
          paperColor={bg}
          modeParams={modeParams}
          showEdges={false}
          edgeColor={ink}
          outlineWidth={outlineWidth}
          treatAsClosedBySig={treatAsClosedBySig}
          hideContactShadow={transparent}
        />
      </TumbleGroup>
      {/* Rotation must always work (Sebs). Thumbnails (transparent) use Trackball
          = FREE tumble in ANY direction, no pole clamp (Sebs: "doesn't go full
          360 at some points" — OrbitControls clamps the vertical); zoom/pan off
          so it can't leave its box. The full /canvas keeps OrbitControls. */}
      {orbit &&
        (transparent ? (
          // staticMoving = no spin-after-release momentum; modest rotateSpeed so
          // it's not hyper-sensitive (Sebs: "too sensitive, moves too fast").
          // domElement = this view's slot (shared canvas) or undefined (single
          // canvas → falls back to the canvas). undefined ⇒ drei's default.
          <TrackballControls
            noZoom
            noPan
            rotateSpeed={1.6}
            staticMoving
            domElement={controlsDomElement ?? undefined}
          />
        ) : (
          <OrbitControls
            makeDefault
            enableDamping
            enableZoom={false}
            enablePan={false}
            domElement={controlsDomElement ?? undefined}
          />
        ))}
    </>
  );
}

export function Stroke3DScene({
  strokes,
  toneFills,
  initialTreatAsClosed,
  viewBox = DEFAULT_VIEWBOX,
  geometryMode = 'auto',
  style3d = 'native',
  materialPreset,
  nativeProps = DEFAULT_NATIVE_PROPS_3D,
  modeParams = DEFAULT_MODE3D_PARAMS,
  hatchInputs = DEFAULT_HATCH_INPUTS,
  svgPortMarkup,
  svgPortBuild,
  hardMeshUrl,
  background,
  inkColor,
  style,
  className,
  showAmbiguityChips = true,
  transparent = false,
  orbit = true,
}: Stroke3DSceneProps) {
  // Lazy initializer = resolved once at mount, never re-read during render.
  const [paper] = useState(resolvePaperHex);
  const bg = background ?? paper;
  const ink = inkColor ?? INK_3D_DEFAULT;

  // ── ARROW RULE chip state (scene-local, signature-keyed — a stroke edit
  // changes its signature and the stale override simply stops matching). ──
  const [treatAsClosedBySig, setTreatAsClosedBySig] = useState<Record<string, boolean>>(
    () => initialTreatAsClosed ?? {},
  );

  /** Ambiguous-closure strokes (auto mode only — explicit picks are sacred,
   *  no chip). One chip per stroke; resolution = override > default. */
  const ambiguousStrokes = useMemo(() => {
    if (geometryMode !== 'auto') return [];
    const out: Array<{ sig: string; index: number; resolvedSolid: boolean }> = [];
    const pool = strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES_3D);
    for (let i = 0; i < pool.length; i++) {
      const simplified = rdpPoints(pool[i]);
      if (closureStateOf(simplified) !== 'treated-as-closed') continue;
      const sig = strokeSignature(pool[i]);
      out.push({
        sig,
        index: i,
        resolvedSolid: isSolidFamilyClosure('treated-as-closed', treatAsClosedBySig[sig]),
      });
    }
    return out;
  }, [strokes, geometryMode, treatAsClosedBySig]);

  const flipTreatAsClosed = (sig: string, resolvedSolid: boolean) => {
    // Every flip = a labeled correction into the unified decision log
    // (conversion-semantics §8 / addendum §1.1 chip-flip training tuples).
    pushClosureCorrection({
      entryType: 'conversion-correction',
      surface: 'conversion',
      renderSurface: null,
      strokeSignature: sig,
      from: resolvedSolid,
      to: !resolvedSolid,
      defaultAtFlip: TREATED_AS_CLOSED_DEFAULT,
      mode: geometryMode,
    });
    setTreatAsClosedBySig((prev) => ({ ...prev, [sig]: !resolvedSolid }));
  };

  return (
    // Wrapper carries the caller's style/className (the Canvas fills it) so
    // the ARROW RULE chips can overlay the GL viewport as HTML.
    <div style={{ position: 'relative', ...style }} className={className}>
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 1.5, 7], fov: 40 }}
      // preserveDrawingBuffer so the modal can EXPORT the 3D render as a PNG
      // (Sebs 2026-06-16 "switch to 3D and export still does the svg").
      gl={{ antialias: true, alpha: transparent, preserveDrawingBuffer: true }}
      onCreated={({ gl, scene }) => {
        // Recover from a soft WebGL context loss instead of going black.
        attachContextLossHandlers(gl);
        if (transparent) {
          // True transparency — alpha:true alone leaves an OPAQUE clear
          // (renders black). Force clear-alpha 0 + null the scene background
          // so the desk/page paper shows straight through (Sebs: "no
          // background, just the object switching").
          gl.setClearColor(0x000000, 0);
          scene.background = null;
        }
      }}
      style={{ width: '100%', height: '100%' }}
    >
      <Stroke3DContents
        strokes={strokes}
        toneFills={toneFills}
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
        inkColor={inkColor}
        bg={bg}
        ink={ink}
        treatAsClosedBySig={treatAsClosedBySig}
        transparent={transparent}
        orbit={orbit}
      />
    </Canvas>
    {/* ARROW RULE chips — the honest boundary made tappable (conversion-
        semantics §6 row 2). One pill per ambiguous stroke; copy follows the
        RESOLVED family; every tap is a logged correction. */}
    {showAmbiguityChips && ambiguousStrokes.length > 0 && (
      <div
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 6,
          zIndex: 2,
        }}
      >
        {ambiguousStrokes.map((a, n) => (
          <button
            key={a.sig}
            type="button"
            data-dd-chip="treat-as-closed"
            data-resolved={a.resolvedSolid ? 'closed' : 'open'}
            onClick={() => flipTreatAsClosed(a.sig, a.resolvedSolid)}
            title={
              a.resolvedSolid
                ? 'This nearly-closed stroke was welded into a solid — tap to keep it an open line instead.'
                : 'This stroke nearly closes — tap to weld the gap and fill it as a solid.'
            }
            style={{
              fontFamily:
                "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              fontSize: 10,
              letterSpacing: '0.04em',
              lineHeight: 1.2,
              padding: '5px 12px',
              borderRadius: 999,
              border: '1px solid var(--dir-border, #d8d2c6)',
              background: 'var(--dir-raised, #ffffff)',
              color: 'var(--dir-text-secondary, #5f5b54)',
              cursor: 'pointer',
            }}
          >
            {ambiguousStrokes.length > 1 ? `Stroke ${n + 1} · ` : ''}
            {a.resolvedSolid ? 'Treated as closed — tap to open' : 'Open-ish — treat as closed?'}
          </button>
        ))}
      </div>
    )}
    </div>
  );
}

// Default export so the wiring layer can `React.lazy(() => import(...))` and
// keep three+drei out of the main chunk (plan §2.3).
export default Stroke3DScene;
