// HardMesh — renders an AI-generated GLB (the "hard path", image→3D via fal/
// TRELLIS) inside the R3F scene (plan §7.5). Loads the re-hosted GLB url, then
// auto-centers + uniform-scales it to fit the same world box the local geometry
// uses, so it drops in where the rod/extrude/inflate/solid form would sit.
//
// PURITY: the GLB url is ALWAYS a Supabase-Storage (re-hosted) url from our Edge
// function — never a raw provider url (those expire). Loading is Suspense-based;
// the caller wraps <HardMesh> in <Suspense fallback={localForm}> so the local
// geometry shows while the mesh streams and if it ever fails. Never throws into
// the render (a load error surfaces via the error boundary → fallback ladder).
import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import {
  applyAiMeshMaterial,
  inkSkinClone,
  AI_MESH_DARK_DEFAULT,
  type AiMeshMaterialMode,
  type InkLineParams,
} from './aiMeshMaterial';
import { INK_3D_DEFAULT } from './materials3d';

/** Target longest-axis size in world units — matches the local form's footprint
 *  (WORLD_SCALE-derived forms sit roughly within a ~3-unit box). Tunable. */
const DEFAULT_TARGET = 3.2;

export function HardMesh({
  url,
  target = DEFAULT_TARGET,
  materialMode = 'greyscale',
  dark = AI_MESH_DARK_DEFAULT,
  contrast = 1,
  engineMaterial = null,
  outline = 0,
  ink = INK_3D_DEFAULT,
  planarUv = false,
  line,
}: {
  url: string;
  /** Longest-axis world size to fit the GLB into (centered at origin). */
  target?: number;
  /** Register the mesh renders in: 'greyscale' (our ink register — DEFAULT, so
   *  the AI mesh fits the desk) or 'og-pbr' (keep the provider's photoreal). */
  materialMode?: AiMeshMaterialMode;
  /** Greyscale darkness ceiling (Sebs 3D pick 0.18). Ignored for 'og-pbr'. */
  dark?: number;
  /** Greyscale value CONTRAST (1 = natural; >1 crisper). Ignored for 'og-pbr'. */
  contrast?: number;
  /** SURFACE AXIS (Sebs 2026-06-27, "all the 3D controls on AI meshes"): when set,
   *  OUR engine material (the native preset OR the screen-space hatch shader — the
   *  exact instance the local geometry uses, so the parent's per-frame uniform sync
   *  drives it for free) is assigned to EVERY mesh in the GLB instead of the
   *  greyscale re-skin. null ⇒ the greyscale/PBR re-skin (the unchanged default —
   *  no regression). The hatch shader is screen-space (gl_FragCoord), so it needs
   *  no UVs and works on arbitrary GLB topology; native is a standard lit material
   *  → also topology-agnostic. (svg-port carves a flat cap with our UVs → NOT here;
   *  that's the separate projection build.) */
  engineMaterial?: THREE.Material | null;
  /** Native OUTLINE dial (0–1) → an inverted-hull silhouette in ink on the GLB
   *  (Sebs 2026-06-27, "make it all work"). 0 = off. Only meaningful with the
   *  native engineMaterial; the push is scale-normalized so weight reads the same
   *  regardless of the source mesh's units. */
  outline?: number;
  /** Ink hex for the outline hull. Default = the 3D ink. */
  ink?: string;
  /** SVG-PORT projection (Sebs 2026-06-27 "every svg port"): when true + an
   *  engineMaterial (the svg-port texture material from the parent), each GLB mesh
   *  gets PLANAR UVs from its XY extent so the object's 2D drawing projects onto
   *  the form — "the drawing worn on the imported mesh". Geometry is cloned before
   *  the UV rewrite so the cached source GLB is never corrupted. */
  planarUv?: boolean;
  /** SVG-PORT PEN controls (Sebs 2026-06-28, "it ports over ALL the SVG stuff"):
   *  the full 2D pen system (strokeWidth/wobble/inkIntensity/fillStyle) ported onto
   *  the mesh's OWN line-art in the pencil branch — line thickness / waver / darkness
   *  / character. Only meaningful for materialMode==='svg-port' (pencil). Changing it
   *  rebuilds the skin (onBeforeCompile bakes the uniforms), same as dark/contrast. */
  line?: InkLineParams;
}) {
  const { scene } = useGLTF(url);
  // Source longest-axis (un-scaled) — used to normalize the outline push so the
  // silhouette weight is constant after the uniform fit-scale below.
  const srcMaxDim = useMemo(() => {
    const s = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    return Math.max(s.x, s.y, s.z) || 1;
  }, [scene]);
  // The inverted-hull ink material (one instance, shared across the GLB's meshes).
  const hullMat = useMemo<THREE.ShaderMaterial | null>(() => {
    if (!(outline > 0) || !engineMaterial) return null;
    return new THREE.ShaderMaterial({
      uniforms: { u_push: { value: outline * 0.03 * srcMaxDim }, u_ink: { value: new THREE.Color(ink) } },
      vertexShader: 'uniform float u_push;\nvoid main(){ vec3 p = position + normal * u_push; gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }',
      fragmentShader: 'uniform vec3 u_ink;\nvoid main(){ gl_FragColor = vec4(u_ink,1.0); }',
      side: THREE.BackSide,
      depthWrite: false,
    });
  }, [outline, engineMaterial, ink, srcMaxDim]);
  useEffect(() => () => hullMat?.dispose(), [hullMat]);
  // Clone (useGLTF caches the source scene — never mutate it), then re-skin to
  // our register, center at the origin and uniform-scale its longest axis.
  const obj = useMemo(() => {
    const cloned = scene.clone(true);
    if (engineMaterial && planarUv) {
      // SVG-PORT: project the drawing — give each mesh PLANAR UVs from its XY extent
      // (clone the geometry first; clone(true) SHARES geometry → must not mutate the
      // cached source), V-flipped (SVG y-down → UV y-up), then wear the svg-port mat.
      cloned.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const g = mesh.geometry.clone();
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        const ex = bb.max.x - bb.min.x || 1;
        const ey = bb.max.y - bb.min.y || 1;
        const ez = bb.max.z - bb.min.z || 1;
        // Project onto the BROADEST face — DROP the smallest-extent axis (the
        // "depth") so the drawing lands on the mesh's big face, not its thin edge.
        // uA/uB = the two kept axes (0=x,1=y,2=z); the vertical (uB) is V-flipped.
        let uA = 0, uB = 1; // default: drop Z → XY face
        if (ey <= ex && ey <= ez) { uA = 0; uB = 2; }       // drop Y → XZ face
        else if (ex <= ey && ex <= ez) { uA = 2; uB = 1; }  // drop X → ZY face
        const droppedAxis = 3 - uA - uB; // the projection direction (0=x,1=y,2=z)
        const get = (attr: THREE.BufferAttribute, i: number, ax: number) => (ax === 0 ? attr.getX(i) : ax === 1 ? attr.getY(i) : attr.getZ(i));
        const minA = uA === 0 ? bb.min.x : uA === 1 ? bb.min.y : bb.min.z;
        const sizeA = uA === 0 ? ex : uA === 1 ? ey : ez;
        const minB = uB === 0 ? bb.min.x : uB === 1 ? bb.min.y : bb.min.z;
        const sizeB = uB === 0 ? ex : uB === 1 ? ey : ez;
        const pos = g.attributes.position as THREE.BufferAttribute;
        // NORMAL MASK (Sebs 2026-06-27 "svg port doesnt work" — the Game Boy banding):
        // a planar projection smears the drawing across the mesh's SIDE WALLS (their
        // UV is a stretched single strip). Mask the engraving by how much each face
        // faces the projection axis — front/back faces (normal ∥ dropped axis) wear
        // the drawing; side walls (normal ⟂) fall to plain dark ink. Written as a
        // per-vertex COLOR the svg-port material multiplies in (sharpened so the
        // falloff is crisp, not a smear). A flat mesh (turntable) had no real walls
        // so this is a no-op there; a deep mesh (Game Boy) stops banding.
        if (!g.attributes.normal) g.computeVertexNormals();
        const nrm = g.attributes.normal as THREE.BufferAttribute;
        // PLANAR projection (NOT the mesh's own UVs — tried 2026-06-28, an image-to-3d
        // mesh's UVs are an ATLAS that scrambles the drawing). Planar keeps the
        // drawing readable as a centered front projection. svg-port reads best on
        // geometry-detail meshes; on a flat texture-detail slab it's the one awkward
        // surface (use Native/Hatch there — they wear the mesh's own detail).
        const uv = new Float32Array(pos.count * 2);
        const col = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          uv[2 * i] = (get(pos, i, uA) - minA) / sizeA;
          uv[2 * i + 1] = 1 - (get(pos, i, uB) - minB) / sizeB;
          const nAxis = get(nrm, i, droppedAxis); // normal component along the projection
          // |n·axis| → 1 on the projected face, 0 on a side wall. A SOFT ramp keeps
          // the broad front (incl. an AI mesh's gently-curved/beveled face, where
          // normals aren't perfectly axis-aligned) at full strength, and only the
          // near-perpendicular side walls (a ≲ 0.25) fall to dark — so the drawing
          // reads on the front while the wall-smear is killed.
          const a = Math.min(1, Math.abs(nAxis));
          const m = a <= 0.25 ? 0 : a >= 0.55 ? 1 : (a - 0.25) / 0.3;
          col[3 * i] = m; col[3 * i + 1] = m; col[3 * i + 2] = m;
        }
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        mesh.geometry = g;
        mesh.material = engineMaterial;
      });
    } else if (engineMaterial && (materialMode === 'native' || materialMode === 'svg-port')) {
      // NATIVE + SVG-PORT in AI-MESH SPACE (Sebs 2026-06-28). Both render the mesh's
      // OWN form in our register (THE CORE RULE — recreate the feeling, never stamp
      // the 2D drawing). Ink-skin the mesh's own material per-mesh (keeps its albedo
      // map + UVs + normals → texture AND geometry detail), wearing the preset's
      // surface finish. SVG-PORT = the PENCIL/LINE-DRAWING feeling (a light form +
      // ink lines drawn from the mesh's OWN texture-edge boundaries); NATIVE = the
      // solid lit-ink feeling. One mechanism, two looks, both from the mesh itself.
      const pencil = materialMode === 'svg-port';
      // svg-port (pencil) wears the 2D PEN controls; native ignores them.
      const lineParams = pencil ? line : undefined;
      cloned.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((mm) => inkSkinClone(mm, dark, contrast, engineMaterial, pencil, lineParams))
          : inkSkinClone(mesh.material, dark, contrast, engineMaterial, pencil, lineParams);
      });
    } else if (engineMaterial) {
      // HATCH keeps the shared instance (its grammar/gap/angle uniforms sync from
      // the parent each frame). But feed it the mesh's OWN albedo so the hatch tone
      // follows the baked detail (Sebs 2026-06-28 "engine in ai mesh space") — else
      // a lambert-only tone is FLAT on a texture-detail slab mesh. Single-mesh GLBs
      // (the norm) → one map; if the GLB has none, hatch falls back to lambert.
      const hatchMat = engineMaterial as THREE.ShaderMaterial;
      let fedMap: THREE.Texture | null = null;
      cloned.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        if (!fedMap) {
          const om = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
          if (om && om.map) fedMap = om.map;
        }
        mesh.material = engineMaterial;
      });
      if (hatchMat.uniforms?.u_valueMap) {
        hatchMat.uniforms.u_valueMap.value = fedMap;
        hatchMat.uniforms.u_hasValueMap.value = fedMap ? 1.0 : 0.0;
      }
    } else {
      applyAiMeshMaterial(cloned, materialMode, dark, contrast); // ours: greyscale; else PBR
    }
    // OUTLINE: add a BackSide inverted-hull child to each mesh (inherits its
    // transform + the fit-scale below) → an ink silhouette under the body.
    if (hullMat) {
      const meshes: THREE.Mesh[] = [];
      cloned.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry) meshes.push(m); });
      for (const m of meshes) m.add(new THREE.Mesh(m.geometry, hullMat));
    }
    const box = new THREE.Box3().setFromObject(cloned);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      cloned.position.sub(center); // recenter at origin
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      cloned.scale.setScalar(target / maxDim);
    }
    return cloned;
    // line.* are primitives (not the object ref) so a same-valued render doesn't
    // rebuild; a slider move (new weight/wobble/ink/style) re-runs inkSkinClone →
    // onBeforeCompile re-bakes the uniforms (same live-rebuild path as dark/contrast).
  }, [scene, target, materialMode, dark, contrast, engineMaterial, hullMat, planarUv, line?.weight, line?.wobble, line?.ink, line?.style]);
  return <primitive object={obj} />;
}

/** Preload a GLB so it's warm before the user flips to 3D (optional; safe to
 *  call with a real re-hosted url). */
export function preloadHardMesh(url: string): void {
  try {
    useGLTF.preload(url);
  } catch {
    /* preload is best-effort */
  }
}
