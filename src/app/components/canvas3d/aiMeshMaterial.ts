// aiMeshMaterial — bring an AI-generated GLB (the hard path, image→3D via fal/
// TRELLIS) into OUR register so it "fits the desk" instead of reading as a
// foreign photoreal object.
//
// THE DECISION (Sebs 2026-06-16, the Game Boy mesh sessions): a flat ink-black
// re-skin = a featureless black blob (the R10 problem). Instead use GREYSCALE —
// keep the mesh's value structure (different parts = different shades, the same
// logic our 2D shading uses) but strip hue and COMPRESS DARK so the whole form
// reads ink-dark. Value carries the detail; the object sits in the warm-ink
// desk palette. Two modes so the user can keep the original PBR if they want:
//   'og-pbr'    → leave the provider's photoreal materials untouched.
//   'greyscale' → desaturate every albedo to luminance + compress toward ink.
//
// PURITY: only `three` is imported (no React, no DOM). The caller (HardMesh)
// clones the GLB scene first (useGLTF caches the source — never mutate it) and
// hands the clone here; we mutate the clone's materials in place.

import * as THREE from 'three';

// The AI-mesh SURFACE axis (Sebs 2026-06-27, the "too fake" OFAT — see
// docs/submission/MESH-SURFACE-OFAT.md). Only these read authentic across every
// mesh type; the glossy/preset-heavy end was cut as universally fake.
//   'greyscale' → DEFAULT. Mesh's own value in our ink register (keeps identity).
//   'hatch'     → screen-space cross-hatch on the mesh (the most robust style).
//   'native'    → matte-clay ink form (clean on form-rich meshes).
//   'svg-port'  → the object's own 2D DRAWING projected onto the mesh (planar UV)
//                 as ink relief — "the drawing worn on the imported form".
//   'og-pbr'    → "Original" — the provider's photoreal; demoted off the default.
// 'hatch'/'native'/'svg-port' are applied by the scene (engineMaterial path), NOT here.
export type AiMeshMaterialMode = 'og-pbr' | 'greyscale' | 'hatch' | 'native' | 'svg-port';

/** Default darkness. RAISED 0.18→0.40 (Sebs 2026-06-27 "greyscale could be lighter"
 *  + the grey sweep `/tmp/grey-*`): at 0.18 detail meshes go near-black and bury
 *  the screen/buttons; ~0.40 keeps them legible while staying ink-family (~0.70
 *  washes out the ink character). The luminance is raised to DARK_GAMMA then scaled
 *  by this, so the brightest part of the mesh peaks around this value. */
export const AI_MESH_DARK_DEFAULT = 0.40;
const DARK_GAMMA = 1.2;
/** Default CONTRAST — value spread around mid. 1 = the mesh's natural value
 *  range; >1 pushes lights/darks apart (crisper, more graphic — our pencil
 *  value-range read); <1 flattens toward an even tone. Sebs 2026-06-17 "add more
 *  mesh toggles that fit our app". */
export const AI_MESH_CONTRAST_DEFAULT = 1;

/** Inject a desaturate-to-dark-greyscale step into a material's shader. Works on
 *  any MeshStandardMaterial-family material (the GLTFLoader output): after the
 *  albedo map is sampled, replace diffuseColor.rgb with its luminance, gamma-
 *  shaped and scaled toward ink. Slightly warm-tinted toward our paper/ink axis.
 *  Returns a CLONE (never mutates the cached source material).
 *
 *  THE FOUNDATION for "the engine in AI-mesh space" (Sebs 2026-06-28): because
 *  this re-skins the mesh's OWN material (keeping its albedo map + UVs + normals),
 *  the mesh's detail survives — texture detail via the kept map, geometry detail
 *  via lighting on the still-lit material. Every mesh treatment (Native/Hatch)
 *  builds on this instead of replacing the material with a flat slab (which threw
 *  the detail away → the flat-octagon Game Boy). `surfaceFrom` copies a reference
 *  material's SURFACE finish (roughness/metalness/clearcoat/sheen) onto the skin so
 *  Native = the mesh's detail, in our ink, wearing the chosen material preset. */
/** The 2D PEN controls ported onto the mesh's own line-art (Sebs 2026-06-28, THE
 *  CORE RULE: recreate the FEELING from the mesh's own form — never stamp the 2D
 *  drawing). svg-port = the full SVG pen system applied to the lines the shader
 *  draws from the mesh's texture-edges + silhouette:
 *    weight  → strokeWidth (line thickness)
 *    wobble  → m.wobble (hand-drawn waver of the inked lines)
 *    ink     → inkIntensity (line darkness)
 *    style   → fillStyleToMode int (line CHARACTER: none=silhouette-only,
 *              dots/stipple=broken dots, dashed/zigzag-line=dashes, else continuous)
 *  Only consumed in the pencil branch (svg-port); ignored for Native. */
export type InkLineParams = {
  weight?: number;
  wobble?: number;
  ink?: number;
  style?: number;
};

export function inkSkinClone(
  src: THREE.Material,
  dark: number,
  contrast: number,
  surfaceFrom?: THREE.Material | null,
  pencil = false,
  line?: InkLineParams,
): THREE.Material {
  const m = src.clone() as THREE.Material & {
    metalness?: number;
    roughness?: number;
    clearcoat?: number;
    clearcoatRoughness?: number;
    sheen?: number;
    envMapIntensity?: number;
    onBeforeCompile?: (shader: { fragmentShader: string; uniforms: Record<string, { value: unknown }> }) => void;
  };
  // Matte, non-metallic so value comes from form + light, not specular hue.
  if (typeof m.metalness === 'number') m.metalness = Math.min(m.metalness, 0.08);
  if (typeof m.roughness === 'number') m.roughness = Math.max(m.roughness, 0.78);
  // SURFACE finish from the chosen material preset (Native) — applied ON TOP of the
  // ink-skin so the mesh keeps its detail but wears matte/clay/satin/etc.
  if (surfaceFrom) {
    const ref = surfaceFrom as THREE.Material & {
      metalness?: number; roughness?: number; clearcoat?: number;
      clearcoatRoughness?: number; sheen?: number; envMapIntensity?: number;
    };
    if (typeof ref.roughness === 'number' && typeof m.roughness === 'number') m.roughness = ref.roughness;
    if (typeof ref.metalness === 'number' && typeof m.metalness === 'number') m.metalness = Math.min(ref.metalness, 0.2);
    if (typeof ref.clearcoat === 'number') m.clearcoat = ref.clearcoat;
    if (typeof ref.clearcoatRoughness === 'number') m.clearcoatRoughness = ref.clearcoatRoughness;
    if (typeof ref.sheen === 'number') m.sheen = ref.sheen;
    if (typeof ref.envMapIntensity === 'number') m.envMapIntensity = ref.envMapIntensity;
  }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAiDark = { value: dark };
    shader.uniforms.uAiContrast = { value: contrast };
    shader.uniforms.uAiPencil = { value: pencil ? 1.0 : 0.0 };
    // The 2D PEN axis (svg-port) → line weight / wobble / ink / style. Defaults
    // match the prior hardcoded look (weight 1.2, wobble 0.4, ink 1, hachure 0)
    // so an untouched svg-port render is unchanged.
    shader.uniforms.uLineWeight = { value: line?.weight ?? 1.2 };
    shader.uniforms.uLineWobble = { value: line?.wobble ?? 0.4 };
    shader.uniforms.uLineInk = { value: line?.ink ?? 1.0 };
    shader.uniforms.uLineStyle = { value: line?.style ?? 0.0 };
    shader.fragmentShader =
      'uniform float uAiDark;\nuniform float uAiContrast;\nuniform float uAiPencil;\n' +
      'uniform float uLineWeight;\nuniform float uLineWobble;\nuniform float uLineInk;\nuniform float uLineStyle;\n' +
      // INJECT after <normal_fragment_begin> — NOT <map_fragment>. The pencil
      // silhouette needs a view-space normal; the raw `vNormal` varying is only
      // declared for SMOOTH-shaded materials, so on a FLAT-shaded / normal-mapped
      // GLB (the real Trellis Game Boy) referencing vNormal made the fragment
      // shader FAIL TO COMPILE → the mesh rendered invisible/broken (Sebs 2026-06-28
      // "svg port doesn't actually work on the ai meshes"). `normal` is the value
      // three.js computes in <normal_fragment_begin> and is ALWAYS valid (it derives
      // from screen-space derivatives when flat-shaded), so the shader compiles on
      // every GLB. diffuseColor (set earlier at <map_fragment>) is still live here.
      shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         {
           float _l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
           if (uAiPencil > 0.5) {
             // PENCIL / LINE-ART look for NATIVE (Sebs 2026-06-28 "the renders are
             // ass" → make it read HAND-DRAWN, not a photographic 3D model). Two
             // parts: (a) a LIGHT paper-toned cel form, (b) INK LINES drawn from the
             // mesh's TEXTURE EDGES — a real-time Sobel on the albedo finds the
             // boundaries (screen / buttons / body outline) and inks them, so the
             // object reads as a DRAWING whose lines carry the detail. This is the
             // fix for slab meshes: their detail is in the texture, so we edge-detect
             // the texture, not the geometry.
             // FORM TONE is the user's Darkness slider (uAiDark, ~0.40 default):
             // higher → a darker paper form; lower → near-white. The lines carry the read.
             // _w = NORMALIZED LINE WEIGHT (strokeWidth/1.2) — the 2D pen's thickness,
             // ported onto the mesh's own lines (Sobel reach + silhouette rim widen with it).
             float _w = clamp(uLineWeight / 1.2, 0.35, 4.0);
             float _formLo = mix(0.74, 0.34, clamp(uAiDark, 0.0, 1.0));
             _l = clamp((_l - 0.5) * (uAiContrast + 0.6) + 0.5, 0.0, 1.0);
             _l = pow(_l, 0.9);
             _l = floor(_l * 3.0 + 0.5) / 3.0;          // 4 flat cel steps
             _l = mix(_formLo, 0.96, _l);               // LIGHT form — the lines carry the read
             vec3 base = vec3(_l) * vec3(1.04, 1.0, 0.93);
             float _ink = 0.0;
             #ifdef USE_MAP
               // WOBBLE (uLineWobble, the 2D pen's m.wobble) bends the inked lines —
               // a procedural waver of the sample coords so the texture-edge lines read
               // hand-drawn, not machine-crisp. 0 → dead straight; 2 → loose sketch.
               vec2 _wob = vec2(sin(vMapUv.y * 88.0), cos(vMapUv.x * 92.0)) * (uLineWobble * 0.0045);
               vec2 _c = vMapUv + _wob;
               // Sobel the albedo → CRISP interior line work (screen / buttons / part
               // seams). The reach (_t) scales with LINE WEIGHT so a heavier pen draws
               // thicker, softer lines; a fine pen stays tight.
               float _t = 0.0022 * _w;
               float _e = 0.0;
               for (int _k = 1; _k <= 2; _k++) {
                 float _o = _t * float(_k);
                 float _ll = dot(texture2D(map, _c + vec2(-_o, 0.0)).rgb, vec3(0.299,0.587,0.114));
                 float _lr = dot(texture2D(map, _c + vec2( _o, 0.0)).rgb, vec3(0.299,0.587,0.114));
                 float _lu = dot(texture2D(map, _c + vec2(0.0, -_o)).rgb, vec3(0.299,0.587,0.114));
                 float _ld = dot(texture2D(map, _c + vec2(0.0,  _o)).rgb, vec3(0.299,0.587,0.114));
                 _e = max(_e, abs(_ll - _lr) + abs(_lu - _ld));
               }
               // LINE DETAIL is the user's Contrast slider (uAiContrast, 1.0 default):
               // higher pulls the threshold down → more interior lines; lower keeps
               // only the strongest edges. A heavier pen (_w) also lowers it → more line.
               float _thLo = clamp(0.16 - (uAiContrast - 1.0) * 0.07 - (_w - 1.0) * 0.03, 0.04, 0.30);
               _ink = smoothstep(_thLo, _thLo + 0.14, _e);
             #endif
             // GEOMETRY SILHOUETTE — a clean ink CONTOUR around the form's rim, from
             // the view-space normal (no texture needed → works on ANY mesh, incl.
             // low-detail spheres that have no edges to Sobel). This is what makes
             // every mesh read as a confident pen drawing, not faint pale ghosts. The
             // rim THICKENS with line weight (_w).
             float _facing = abs(dot(normalize(vViewPosition), normalize(normal)));
             float _silh = 1.0 - smoothstep(0.14, 0.30 + 0.16 * _w, _facing);
             // LINE STYLE (uLineStyle = fillStyleToMode int) ports the 2D pen's CHARACTER:
             //   7 'none'        → silhouette only, no interior linework (pure contour).
             //   2 'dots'        → stipple: break every line into a screen-space dot field.
             //   4/5 dashed/zz-line → dashes: break lines along a screen diagonal.
             //   else (hachure/cross-hatch/solid/zigzag) → continuous pen lines.
             // Screen-space patterns (gl_FragCoord) match the app's hatch register and
             // keep the dots/dashes hand-sized regardless of the mesh's UV scale.
             if (uLineStyle > 6.5) { _ink = 0.0; }
             _ink = max(_ink, _silh);
             if (uLineStyle > 1.5 && uLineStyle < 2.5) {
               float _cell = max(2.2, 3.4 / _w);
               vec2 _g = floor(gl_FragCoord.xy / _cell);
               float _dot = step(0.42, fract(sin(dot(_g, vec2(12.99, 78.23))) * 43758.5453));
               _ink *= _dot;
             } else if (uLineStyle > 3.5 && uLineStyle < 5.5) {
               float _dash = step(0.42, fract((gl_FragCoord.x + gl_FragCoord.y) / max(4.0, 8.0 / _w)));
               _ink *= _dash;
             }
             // INK DARKNESS (uLineInk = inkIntensity) scales how dark the lines sit —
             // a faint pen vs a hard black line. Form tone is untouched.
             float _amt = _ink * clamp(uLineInk, 0.0, 1.0);
             base = mix(base, vec3(0.12, 0.10, 0.09), _amt);
             diffuseColor.rgb = base;
           } else {
             // VALUE (greyscale) — the mesh's own value in our ink register, dark.
             _l = clamp((_l - 0.5) * uAiContrast + 0.5, 0.0, 1.0);
             _l = pow(_l, ${DARK_GAMMA.toFixed(2)}) * uAiDark;
             diffuseColor.rgb = vec3(_l) * vec3(1.03, 0.99, 0.92);
           }
         }`,
      );
  };
  m.needsUpdate = true;
  return m;
}

/**
 * Re-skin a cloned AI-mesh scene to our register. No-op for 'og-pbr'. For
 * 'greyscale', every mesh material becomes a dark-greyscale clone (value kept,
 * hue stripped, compressed to `dark`). Mutates the passed object's meshes.
 */
export function applyAiMeshMaterial(
  root: THREE.Object3D,
  mode: AiMeshMaterialMode,
  dark: number = AI_MESH_DARK_DEFAULT,
  contrast: number = AI_MESH_CONTRAST_DEFAULT,
): void {
  // 'og-pbr' keeps the provider's photoreal; everything else re-skins to greyscale.
  // hatch/native ALWAYS arrive with an engineMaterial so this isn't called for them;
  // 'svg-port' lands here only as the fallback while its texture builds (or if the
  // object has no drawing to project) → greyscale, never raw PBR.
  if (mode === 'og-pbr') return;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((mat) => inkSkinClone(mat, dark, contrast));
    } else {
      mesh.material = inkSkinClone(mesh.material, dark, contrast);
    }
  });
}
