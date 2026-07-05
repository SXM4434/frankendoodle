import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  buildPoolSolidGeometry,
  poolCenter,
  DEFAULT_VIEWBOX,
  type StrokeInputPoint,
  type ViewBoxSize,
} from './geometry3d/strokeTo3d';
import { DEFAULT_MODE3D_PARAMS } from '../components/canvas3d/modeParams';
import { slugifyName } from './exportCard';

// ─── exportObjectGlb — a doodle's strokes → a real .glb 3D model ──────────────
// The "export the 3D model" option (Sebs 2026-06-14). Builds the SAME watertight
// pool-solid mass the 3D view renders (buildPoolSolidGeometry — donut holes +
// eased rim preserved), wraps it in a one-mesh scene, and writes a binary glTF
// the user can open in Blender / any 3D tool. Lazy-loaded by the export menu so
// three + GLTFExporter never enter the main chunk. Geometry builders come from
// strokeTo3d directly (NOT Stroke3DScene) so this pulls no drei/Canvas.

const MAX_STROKES = 60; // same pool cap as the scene (perf budget)
const INK = '#2b2b2b'; // warm graphite (matches the 3D ink read)

/** Same pattern exportCard.ts uses — anchor download, revoke after. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface GlbExportResult {
  ok: boolean;
  reason?: string;
  filename?: string;
}

/** Build + download a .glb from a doodle's source strokes (viewBox coords). */
export async function exportObjectGlb(
  strokes: StrokeInputPoint[][],
  name?: string | null,
  viewBox: ViewBoxSize = DEFAULT_VIEWBOX,
): Promise<GlbExportResult> {
  const pool = strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES);
  if (pool.length === 0) return { ok: false, reason: 'no strokes to lift into 3D' };

  const center = poolCenter(pool, viewBox);
  const p = DEFAULT_MODE3D_PARAMS;
  const built = buildPoolSolidGeometry(pool, {
    viewBox,
    center,
    inkRadius: p.solid.inkRadius,
    depth: p.solid.depth,
    rodRadius: p.rod.radius,
    holes: p.solid.holes,
    edge: p.solid.edge,
  });
  const geometry = built.geometry;
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(INK),
    roughness: 0.6,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const scene = new THREE.Scene();
  scene.add(mesh);

  let buffer: ArrayBuffer;
  try {
    buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      new GLTFExporter().parse(
        scene,
        (out) => resolve(out as ArrayBuffer),
        (err) => reject(err),
        { binary: true },
      );
    });
  } catch (e) {
    geometry.dispose();
    material.dispose();
    return { ok: false, reason: e instanceof Error ? e.message : 'GLB export failed' };
  }
  geometry.dispose();
  material.dispose();

  const filename = `${slugifyName(name)}.glb`;
  triggerDownload(new Blob([buffer], { type: 'model/gltf-binary' }), filename);
  return { ok: true, filename };
}
