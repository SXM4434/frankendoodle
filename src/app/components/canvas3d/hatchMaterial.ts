// ─── hatchMaterial — procedural band-quantized hachure (Hatch + SVG-port) ───
// Implements docs/design/3d-roundtrip-build-plan.md §3 with ONE architecture
// change mandated by the round-7 constraints: the plan's `postprocessing`
// Effect subclass needs a dep that is NOT installed (no-new-deps rule), so the
// hatch is a custom THREE.ShaderMaterial on the meshes themselves — same
// fragment math, no composer pass. Deterministic: fixed light directions
// mirroring the Stroke3DScene rig, no time uniforms, no randomness.
//
// ONE MATH, TWO RENDERERS (the wedge): the 8-band quantization table is
// `coverage.ts` COVERAGE_BANDS via bandTableForUniforms() — the SAME numbers
// the SVG renderer quantizes with (21-research §4, Praun Real-Time Hatching
// banding). The angle/gap/weight/ink uniforms read the LIVE 2D Shading sliders
// (F3RoughModifiersContext — wired by the scene, this module is React-free).
// Moving hachureGap re-hatches the 3D live; that slider moment is the demo
// wedge shot (build plan §13).
//
// TWO VARIANTS, one shader:
//   · 'hatch'    — D-4 shared interim style. Tone = lit-form darkness (the lit
//     face hatches sparse, the shadowed face dense — §7's multi-face problem
//     solved by luminance). Grammar = hachure with TAM-style layer stacking
//     (offset set → cross set → near-solid) from the band's tamLayers column.
//   · 'svg-port' — M8 v1, the honest 2D-treatment-on-3D bridge: SAME band
//     machinery for tone (the 3D form is the tone source — drawn strokes carry
//     no source darkness), but the MARK GRAMMAR comes from the full 2D chrome:
//     fillStyle picks the procedural pattern (hachure / cross-hatch / dots /
//     zigzag / dashed / zigzag-line / solid / none — all 8 real), wobble bends
//     the marks, fillOpacity scales them; an ink EdgesGeometry overlay
//     (Stroke3DScene) carries the outline read. What v1 does NOT do (the
//     post-makeathon TAM path, build plan §3.4): author marks with rough.js
//     into a TAM texture, project EdgesGeometry through SvgStyleTransform with
//     a stable seed, or follow surface tangents — v1 marks are screen-space.

import * as THREE from 'three';
import { bandTableForUniforms } from '../../lib/smart/coverage';

export type HatchVariant = 'hatch' | 'svg-port';

// ─── HATCH STYLE TOGGLES (ratified symmetry law gap cell §1) ────────────────
// The Hatch node was sliders-only; the law gives it BOTH a discrete STYLE set
// AND its continuous PROPERTY set. The grammar + direction discretes live here.
//
// ONE MATH, TWO (now FOUR) RENDERERS: every grammar reads the SAME band/layers
// off the shared COVERAGE_BANDS lambert quantization — a band-5 region is
// equally DARK in Hachure, Cross-hatch, Stipple and Contour. Only the MARK
// SHAPE differs (parallel lines · crossed lines · dots · curvature-following
// lines). The darkness is the band; the grammar is how the band is inked.

/** Discrete MARK GRAMMAR (Hatch variant). One band, four mark shapes. */
export type HatchGrammar = 'hachure' | 'cross-hatch' | 'stipple' | 'contour';

/** Discrete DIRECTION MODE (Hatch variant). Fixed = the angle slider drives
 *  the mark direction (current behavior). Light-following = marks orient off
 *  the rig's light direction in screen space, so they re-orient as the camera
 *  orbits (a different read at every viewing angle). */
export type HatchDirection = 'fixed' | 'light';

/** Grammar → shader int. Hachure/cross-hatch/stipple reuse the proven fill
 *  modes 0/1/2; Contour is the new mode 8 (curvature-following, needs the
 *  view-normal — see the fragment shader). */
export function hatchGrammarToMode(grammar: HatchGrammar): number {
  switch (grammar) {
    case 'cross-hatch':
      return 1;
    case 'stipple':
      return 2;
    case 'contour':
      return 8;
    case 'hachure':
    default:
      return 0;
  }
}

/** Live inputs from the 2D chrome (the scene copies these into uniforms in an
 *  effect — slider moves re-hatch without geometry rebuilds). */
export type HatchInputs = {
  /** m.hachureGap (0.5–30 px, default 4). */
  hachureGap: number;
  /** m.hachureAngle (−90..90°, default −41 — the house angle). */
  hachureAngle: number;
  /** m.strokeWidth (0.1–10, default 1.2). */
  strokeWidth: number;
  /** m.inkIntensity (0–1). */
  inkIntensity: number;
  /** SVG-port only: m.fillStyle — picks the procedural mark grammar. */
  fillStyle?: string;
  /** SVG-port only: m.wobble (0–2) — bends the marks. */
  wobble?: number;
  /** SVG-port only: m.fillOpacity (0–1) — scales mark ink. */
  fillOpacity?: number;
  /** Hatch variant only: discrete MARK GRAMMAR (default 'hachure' = current). */
  grammar?: HatchGrammar;
  /** Hatch variant only: discrete DIRECTION MODE (default 'fixed' = current). */
  direction?: HatchDirection;
};

/** Screen-px calibration: 2D hachureGap is SVG-px inside an ~800px viewBox
 *  frame; on screen the 3D frame renders at comparable size, so k≈2 reads
 *  matched at defaults (build plan §3.2's calibration constant — eyeball
 *  budget; if it reads wrong after 2 tweaks, port rough.js spacing per
 *  feedback_copy_implementation_before_tweaking_numbers). */
export const HATCH_GAP_SCREEN_K = 2.0;

/** Hatch gap CEILING in CSS px (RC-4(a) fix). The slider's HIGH end (gap 30 ×
 *  K 2 = 60 CSS px, ×dpr → 120 device px) puts the line spacing WIDER than the
 *  3D form's on-screen footprint, so zero marks land inside it and every shape
 *  renders blank — the band tone is still computed, but no line ever crosses
 *  the form. A typical framed 3D doodle spans ~200–300 CSS px; capping the
 *  effective spacing at 22 CSS px guarantees at least several line crossings on
 *  even the smallest form, so a large gap still reads as airy-but-visible
 *  hatching instead of nothing. Mirrors the 2D renderer's own gap cap (12 SVG
 *  px in an 800px viewBox ≈ this fraction of frame). The slider keeps its full
 *  0.5–30 range and feel UP TO the ceiling — past it the look just stops
 *  thinning out (a usable plateau, not a cliff to blank). Pre-dpr so the cap is
 *  a fixed fraction of the frame regardless of display density. */
export const HATCH_GAP_MAX_CSS_PX = 22;

/** fillStyle → shader mode int (all 8 FillStyleStep values real). */
export function fillStyleToMode(fillStyle: string | undefined): number {
  switch (fillStyle) {
    case 'none':
      return 7;
    case 'solid':
      return 6;
    case 'cross-hatch':
      return 1;
    case 'dots':
      return 2;
    case 'zigzag':
      return 3;
    case 'dashed':
      return 4;
    case 'zigzag-line':
      return 5;
    case 'hachure':
    default:
      return 0;
  }
}

const VERTEX = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vViewNormal;  // view-space normal — drives light-following + contour
varying vec2 vUv;          // for the AI-mesh value map (hatch follows the mesh's own value)
void main() {
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewNormal = normalize(normalMatrix * normal);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Lambert tone from the rig's key/fill structure (Stroke3DScene directional
// positions, normalized) + ambient floor — deterministic, no scene queries.
const FRAGMENT = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vViewNormal;
varying vec2 vUv;
uniform sampler2D u_valueMap; // AI-mesh albedo (its baked detail) — drives hatch tone
uniform float u_hasValueMap;  // 1 when an AI mesh fed its own texture (else lambert only)
uniform vec3 u_bands[8];      // [darknessMin, darknessMax, tamLayers] — coverage.ts verbatim
uniform float u_gapPx;        // hachure gap, device px
uniform float u_angleRad;     // hachure angle (Fixed direction mode)
uniform float u_weightPx;     // line half-thickness, device px
uniform float u_inkIntensity; // 0..1
uniform vec3 u_ink;
uniform vec3 u_paper;
uniform int u_fillMode;       // 0 hachure · 1 cross-hatch · 2 dots · 3 zigzag · 4 dashed · 5 zigzag-line · 6 solid · 7 none · 8 contour
uniform float u_wobblePx;     // svg-port mark bend amplitude, device px
uniform float u_markOpacity;  // svg-port fillOpacity (1.0 for hatch variant)
uniform float u_occStrength;  // contour-hatch: deepen tone toward silhouette (denser marks)
uniform int u_directionMode;  // 0 fixed (angle slider) · 1 light-following
uniform vec3 u_lightDirView;  // rig key light direction in VIEW space (light-following)

// Distance-to-line-set mask: lines run along x at spacing 'gap'.
float lineMask(vec2 p, float gap, float halfW) {
  float d = abs(fract(p.y / gap) - 0.5) * gap;
  float aa = 0.9;
  return 1.0 - smoothstep(halfW - aa, halfW + aa, d);
}

// Dashed variant: rough.js default duty cycle 0.5 (dash length == dash gap).
float dashedMask(vec2 p, float gap, float halfW) {
  float m = lineMask(p, gap, halfW);
  float duty = step(fract(p.x / (gap * 2.0)), 0.5);
  return m * duty;
}

// Triangle wave for zigzag grammars.
float tri(float x) {
  return abs(fract(x) - 0.5) * 2.0;
}

// Dot-grid mask (one dot per gap² cell — the coverage.ts dots model).
float dotMask(vec2 p, float cell, float r) {
  vec2 g = (fract(p / cell) - 0.5) * cell;
  float d = length(g);
  float aa = 0.9;
  return 1.0 - smoothstep(r - aa, r + aa, d);
}

void main() {
  vec3 n = normalize(vWorldNormal);
  // Two-light lambert mirroring the scene rig (key 5,8,5 · fill -4,2,-2).
  float shade = 0.22;
  shade += 0.95 * max(dot(n, normalize(vec3(5.0, 8.0, 5.0))), 0.0);
  shade += 0.33 * max(dot(n, normalize(vec3(-4.0, 2.0, -2.0))), 0.0);
  shade = clamp(shade, 0.0, 1.0);
  float darkness = 1.0 - shade;
  // CONTOUR-HATCH silhouette deepening (Sebs 2026-06-15): real pencil contour
  // hatching gets DENSER where the form curves AWAY (toward the silhouette), not
  // only on shadowed faces. vViewNormal.z ≈ 1 facing the camera, ≈ 0 at the
  // silhouette → push darkness up toward the rim so the hatch packs there. Pure
  // value-via-DENSITY (feeds the same band lookup below) — never a tint.
  float occ = pow(1.0 - clamp(abs(vViewNormal.z), 0.0, 1.0), 1.5);
  darkness = clamp(darkness + u_occStrength * occ, 0.0, 1.0);

  // AI-MESH VALUE (Sebs 2026-06-28 "bring the engine into ai mesh space"): an
  // image-to-3d mesh bakes its detail into its TEXTURE, not its geometry, so a
  // lambert-only tone reads FLAT (the screen/buttons vanish). When the mesh feeds
  // its own albedo, drive the hatch tone from that value instead — dark texture
  // areas hatch dense, light areas stay open → the form reads in hatch. Lambert
  // still adds a touch of form-shading on top.
  if (u_hasValueMap > 0.5) {
    float tv = dot(texture2D(u_valueMap, vUv).rgb, vec3(0.299, 0.587, 0.114));
    float texDark = 1.0 - clamp(pow(tv, 0.85), 0.0, 1.0);
    darkness = clamp(mix(texDark, darkness, 0.25), 0.0, 1.0);
  }

  // 8-band quantization — the SAME table the SVG renderer uses (one math).
  int band = 0;
  float layers = 0.0;
  for (int i = 7; i >= 0; i--) {
    if (darkness >= u_bands[i].x) {
      band = i;
      layers = u_bands[i].z;
      break;
    }
  }

  // ── Mark direction: the DIRECTION MODE + CONTOUR grammar decide the angle ──
  // Default: u_angleRad (Fixed direction mode, the angle slider).
  float markAngle = u_angleRad;
  if (u_directionMode == 1) {
    // Light-following: marks run ACROSS the light gradient (perpendicular to
    // the screen-projected key light), so they re-orient as the camera orbits.
    // u_lightDirView is in view space; its xy projects to screen. atan gives
    // the light's screen bearing; +90° (the .yx swizzle with sign) runs the
    // marks across it — the classic NPR "hatch follows shading" read.
    vec2 lvxy = u_lightDirView.xy;
    if (length(lvxy) > 1e-4) markAngle = atan(lvxy.x, lvxy.y);
  }
  if (u_fillMode == 8) {
    // Contour grammar: marks follow the FORM, not a global angle. The view-
    // space normal's xy is the screen-projected surface gradient; running marks
    // ALONG it (atan of yx) makes lines wrap around curvature — dense where the
    // form turns toward silhouette, the cross-contour read. Falls back to the
    // direction-mode angle on flat camera-facing faces (xy ≈ 0).
    vec2 nvxy = vViewNormal.xy;
    if (length(nvxy) > 1e-3) markAngle = atan(nvxy.y, nvxy.x);
  }
  // Rotated screen-space mark coordinate (gl_FragCoord is device px).
  float c = cos(markAngle);
  float s = sin(markAngle);
  vec2 p = mat2(c, -s, s, c) * gl_FragCoord.xy;
  // SVG-port wobble: deterministic low-frequency bend along the mark direction.
  p.y += sin(p.x * 0.045) * u_wobblePx;

  float gap = max(u_gapPx, 2.0);
  // "Lines never merge" cap (techniqueMap render policy, weight ≤ 0.7·gap).
  float halfW = min(u_weightPx, gap * 0.35);
  vec2 pc = vec2(p.y, -p.x); // +90° cross direction

  float mask = 0.0;
  if (band > 0) {
    if (u_fillMode == 2) {
      // dots: radius grows with TAM layer depth; layer 3+ adds offset set.
      float r = halfW * (0.9 + 0.6 * layers);
      mask = dotMask(p, gap, r);
      if (layers >= 3.0) mask = max(mask, dotMask(p + vec2(gap * 0.5), gap, r));
    } else if (u_fillMode == 6) {
      // solid grammar: any inked band is solid ink.
      mask = 1.0;
    } else if (u_fillMode == 7) {
      // none: marks off — the edge overlay carries the read.
      mask = 0.0;
    } else {
      vec2 pl = p;
      if (u_fillMode == 3 || u_fillMode == 5) {
        // zigzag family: triangular perturbation across the line direction.
        pl.y += tri(pl.x / (gap * 1.6)) * gap * 0.45;
      }
      bool dashed = (u_fillMode == 4);
      // TAM-style layer stacking (build plan §3.3 / tamLayers column):
      //   L1 base set · L2 + half-gap offset set · L3 + cross set · L4 + cross offset.
      // cross-hatch grammar starts crossed at L1 (its grammar IS crossed).
      float base = dashed ? dashedMask(pl, gap, halfW) : lineMask(pl, gap, halfW);
      mask = base;
      if (layers >= 2.0 || u_fillMode == 1) {
        float crossSet = dashed ? dashedMask(pc, gap, halfW) : lineMask(pc, gap, halfW);
        if (u_fillMode == 1) mask = max(mask, crossSet); // crossed from the start
        if (layers >= 2.0) {
          float off = dashed ? dashedMask(pl + vec2(0.0, gap * 0.5), gap, halfW)
                             : lineMask(pl + vec2(0.0, gap * 0.5), gap, halfW);
          mask = max(mask, off);
        }
        if (layers >= 3.0 && u_fillMode != 1) mask = max(mask, crossSet);
        if (layers >= 4.0) {
          float crossOff = dashed ? dashedMask(pc + vec2(0.0, gap * 0.5), gap, halfW)
                                  : lineMask(pc + vec2(0.0, gap * 0.5), gap, halfW);
          mask = max(mask, crossOff);
        }
      }
    }
    // Band 7 approaches solid in every grammar (build plan §3.3 step 3).
    if (band >= 7) mask = max(mask, 0.92);
  }

  // Paper carries a whisper of form shade so the volume never goes cardboard.
  vec3 paper = u_paper * (0.94 + 0.06 * shade);
  float ink = clamp(mask * u_inkIntensity * u_markOpacity, 0.0, 1.0);
  gl_FragColor = vec4(mix(paper, u_ink, ink), 1.0);
}
`;

export function createHatchMaterial(variant: HatchVariant): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      u_bands: { value: bandsAsVec3() },
      u_gapPx: { value: 8.0 },
      u_angleRad: { value: (-41 * Math.PI) / 180 },
      u_weightPx: { value: 1.0 },
      u_inkIntensity: { value: 1.0 },
      u_ink: { value: new THREE.Color('#2A2622') },
      u_paper: { value: new THREE.Color('#FDFCF9') },
      u_fillMode: { value: 0 },
      u_wobblePx: { value: 0.0 },
      u_markOpacity: { value: 1.0 },
      u_directionMode: { value: 0 },
      u_lightDirView: { value: new THREE.Vector3(0, 0, 1) },
      // Contour-hatch silhouette deepening — on for the form-shaded hatch variant,
      // off for svg-port (which wears the 2D's own density). Tunable for the eyes-on pass.
      u_occStrength: { value: variant === 'hatch' ? 0.35 : 0.0 },
      // AI-mesh value feed (HardMesh sets these per mesh) — off by default.
      u_valueMap: { value: null },
      u_hasValueMap: { value: 0.0 },
    },
    name: variant === 'hatch' ? 'dd-hatch' : 'dd-svg-port',
  });
}

/** coverage.ts band table → vec3[8] (stride 3: darknessMin/darknessMax/tamLayers). */
function bandsAsVec3(): THREE.Vector3[] {
  const flat = bandTableForUniforms();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(new THREE.Vector3(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]));
  }
  return out;
}

/** Copy live slider values into uniforms (no rebuild — the live re-hatch). */
export function updateHatchUniforms(
  mat: THREE.ShaderMaterial,
  variant: HatchVariant,
  inputs: HatchInputs,
  inkHex: string,
  paperHex: string,
  pixelRatio: number,
): void {
  const u = mat.uniforms;
  // RC-4(a): floor (1.5 CSS px — lines never merge to mush) AND ceiling
  // (HATCH_GAP_MAX_CSS_PX — a 30px gap still lands marks inside the form
  // instead of blanking it). Both clamps are in CSS px BEFORE the dpr scale so
  // the cap is a fixed fraction of the on-screen frame at any display density.
  const gapCssPx = Math.min(
    Math.max(inputs.hachureGap * HATCH_GAP_SCREEN_K, 1.5),
    HATCH_GAP_MAX_CSS_PX,
  );
  u.u_gapPx.value = gapCssPx * pixelRatio;
  u.u_angleRad.value = (inputs.hachureAngle * Math.PI) / 180;
  // strokeWidth 0.1–10 → half-thickness px (×0.6 reads matched to the 2D line
  // at default 1.2); the gap*0.35 merge cap applies in-shader.
  u.u_weightPx.value = Math.max(inputs.strokeWidth * 0.6, 0.35) * pixelRatio;
  u.u_inkIntensity.value = Math.min(Math.max(inputs.inkIntensity, 0), 1);
  (u.u_ink.value as THREE.Color).set(inkHex);
  (u.u_paper.value as THREE.Color).set(paperHex);
  if (variant === 'svg-port') {
    u.u_fillMode.value = fillStyleToMode(inputs.fillStyle);
    u.u_wobblePx.value = (inputs.wobble ?? 0) * 2.2 * pixelRatio;
    u.u_markOpacity.value = inputs.fillOpacity ?? 1.0;
    // SVG-port keeps the 2D angle slider (no light-following) — its grammar
    // comes from fillStyle, not the Hatch grammar pills.
    u.u_directionMode.value = 0;
  } else {
    // Hatch variant: the STYLE toggles (grammar + direction) now drive it
    // alongside the Shading cluster sliders. Default grammar 'hachure' +
    // direction 'fixed' = the pre-law behavior exactly (mode 0, dir 0).
    u.u_fillMode.value = hatchGrammarToMode(inputs.grammar ?? 'hachure');
    u.u_wobblePx.value = 0;
    u.u_markOpacity.value = 1.0;
    u.u_directionMode.value = (inputs.direction ?? 'fixed') === 'light' ? 1 : 0;
  }
}

/** Push the rig key light into the shader in VIEW space (light-following needs
 *  the screen-projected light, which depends on the camera). Called per-frame
 *  by the scene's uniform sync — cheap (one matrix transform). The world key
 *  direction mirrors the Stroke3DScene rig (directionalLight at 5,8,5). */
export function updateHatchLightDir(
  mat: THREE.ShaderMaterial,
  viewMatrix: THREE.Matrix4,
): void {
  const worldKey = new THREE.Vector3(5, 8, 5).normalize();
  // Transform DIRECTION by the view matrix's rotation only (w=0 → no
  // translation). transformDirection handles the upper-3x3 + renormalize.
  const viewDir = worldKey.clone().transformDirection(viewMatrix);
  (mat.uniforms.u_lightDirView.value as THREE.Vector3).copy(viewDir);
}
