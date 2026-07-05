// ─── demoWall — a curated, no-DB "made-up wall" seed for recording ───────────
// Sebs 2026-06-15: "make me a made up wall with different objects from my audit
// page for me to record a video." This builds a recordable public-desk fill from
// the real catalog (PegToolShape / F3PegboardShapeId) — NO Supabase needed. It
// renders each catalog shape to its clean SVG markup (the same offscreen-render
// trick the homepage hero uses), normalizes it to the desk's 180px add-box, and
// pairs it with a render style so the wall shows the engine's full range. DeskPage
// consumes this behind the ?demo= URL flag, so normal /desk is untouched.

import { createRoot } from 'react-dom/client';
import { PegToolShape } from './items/PegToolShape';
import type { F3PegboardShapeId } from './items/identitySet';
import { normalizeSvgSize } from './normalizeInput';
import { applyStylePreset } from '../components/canvas/SvgStyleTransform';
import { DEFAULT_MODIFIERS, type F3ModifiersState } from '../state/F3RoughModifiersContext';
import type { F3SvgStyle } from '../state/F3SvgStyleContext';
import type { Geometry3DConfig } from './geometry3d/deskRenderMode';

export interface DemoWallObject {
  id: string;
  svgMarkup: string;
  x: number;
  y: number;
  rotation: number;
  name: string;
  // is3d + geometry3d are OPTIONAL (legacy demo objects render 2D). When set,
  // DeskPage's force3dIds renders the object 3D with the saved geometry3d config
  // — the same per-object 3D path real saved objects use.
  renderConfig: {
    svgStyle: F3SvgStyle;
    modifiers: F3ModifiersState;
    is3d?: boolean;
    geometry3d?: Geometry3DConfig;
    // Hard-path AI mesh GLB (Suzanne / Trellis). When set, DeskPage renders the
    // GLB in 3D in place of the local form — the same path real AI-mesh objects use.
    hardMeshUrl?: string;
  };
}

// "3D Rock" preset — the Rock-3D-font look applied to a sketch: a chunky bevelled
// EXTRUDE (the block), wearing the styled 2D hand-marks via SVG-PORT, in matte
// pencil. Composition only — every piece already exists in the 3D engine
// (Sebs 2026-06-25; the deterministic baseline to A/B the Suzanne API against).
const ROCK_3D_PRESET: Geometry3DConfig = {
  geometryMode: 'extrude',     // chunky bevelled slab (EXTRUDE_DEPTH 0.5 + rounded bevel)
  style3d: 'svg-port',         // the 2D hand outline carried onto the 3D form
  materialPreset: 'matteClay', // matte pencil, zero gloss
};

// Closed / bold catalog shapes that extrude into clean blocks. Mixed 2D styles so
// Sebs can eyeball chunky (bold-ink) vs wobbly (rough-handdrawn) hand character.
const ROCK_PICKS: { shape: F3PegboardShapeId; name: string; style: F3SvgStyle }[] = [
  { shape: 'pokeball',   name: 'Poké Ball',   style: 'bold-ink' },
  { shape: 'gameBoy',    name: 'Game Boy',    style: 'bold-ink' },
  { shape: 'medal',      name: 'Race medal',  style: 'rough-handdrawn' },
  { shape: 'ring',       name: 'Ring',        style: 'rough-handdrawn' },
  { shape: 'fidgetCube', name: 'Fidget cube', style: 'bold-ink' },
  { shape: 'seltzerCan', name: 'Seltzer can', style: 'rough-handdrawn' },
];

// Curated spread — varied object FAMILIES (work · games · music · running ·
// travel · roots · daily) crossed with EVERY render style (all 11 appear at
// least once) so the recording shows the engine's full range at a glance.
const PICKS: { shape: F3PegboardShapeId; name: string; style: F3SvgStyle }[] = [
  { shape: 'pokeball',          name: 'Poké Ball',       style: 'bold-ink' },
  { shape: 'gameBoy',           name: 'Game Boy',        style: 'rough-handdrawn' },
  { shape: 'shoe',              name: 'Running shoe',     style: 'sketchy' },
  { shape: 'electricGuitar',    name: 'Electric guitar',  style: 'charcoal' },
  { shape: 'vinyl',             name: 'Vinyl record',     style: 'stipple' },
  { shape: 'macbook',           name: 'MacBook',          style: 'clean' },
  { shape: 'mxMouse',           name: 'MX mouse',         style: 'wireframe' },
  { shape: 'medal',             name: 'Race medal',       style: 'risograph' },
  { shape: 'instaxCamera',      name: 'Instax camera',    style: 'wet-ink' },
  { shape: 'mokaPotGreca',      name: 'Moka pot',         style: 'newsprint' },
  { shape: 'arepaPan',          name: 'Arepa pan',        style: 'outline-only' },
  { shape: 'switch',            name: 'Switch',           style: 'bold-ink' },
  { shape: 'ps5Controller',     name: 'PS5 controller',   style: 'charcoal' },
  { shape: 'clapperboard',      name: 'Clapperboard',     style: 'rough-handdrawn' },
  { shape: 'popcornBucket',     name: 'Popcorn',          style: 'sketchy' },
  { shape: 'ring',              name: 'Ring',             style: 'bold-ink' },
  { shape: 'passport',          name: 'Passport',         style: 'risograph' },
  { shape: 'rollerSuitcase',    name: 'Suitcase',         style: 'rough-handdrawn' },
  { shape: 'overEarHeadphones', name: 'Headphones',       style: 'charcoal' },
  { shape: 'fidgetCube',        name: 'Fidget cube',      style: 'stipple' },
  { shape: 'seltzerCan',        name: 'Seltzer can',      style: 'bold-ink' },
];

/** Render a catalog shape to its clean SVG markup via a detached offscreen root
 *  (same approach as DeskDoodlesHome.shapeMarkupAsync — Make-safe, no
 *  react-dom/server). Resolves '' if the shape yields no <svg>. */
function shapeMarkupAsync(shape: F3PegboardShapeId): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve('');
      return;
    }
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
      'position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden';
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(<PegToolShape shape={shape} />);
    let tries = 0;
    const tick = () => {
      const svg = host.querySelector('svg');
      if (svg || tries >= 20) {
        let markup = svg ? svg.outerHTML : '';
        try {
          root.unmount();
        } catch {
          /* ignore */
        }
        host.remove();
        if (markup && /^\s*<svg[\s>]/.test(markup) && !/\sxmlns=/.test(markup)) {
          markup = markup.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        resolve(markup);
        return;
      }
      tries++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Deterministic small jitter from an index (so the wall scatters but is stable
 *  across renders — no Math.random). */
function jitter(i: number, span: number, salt: number): number {
  return (((i * 73 + salt * 131) % (span * 2 + 1)) - span);
}

/** Build the curated demo wall. Lays the picks out in a wide 7-column grid in
 *  desk-WORLD pixels (DeskPage's resetCamera frames the whole bbox), each object
 *  normalized to the 180px add-box and given its style's modifier preset. */
// The Suzanne-generated meshes we staged in public/suzanne/. Each becomes a
// hard-mesh desk object (GLB shown in 3D), seeded as YOURS so it drags + edits.
// `shape` = the matching catalog drawing used as the object's source 2D markup —
// so the svg-port SURFACE has a real drawing to project onto the mesh (and the 2D
// fallback shows a real doodle, not a placeholder). vinyl is the closest round-flat
// stand-in for the turntable.
const SUZANNE_MESHES: { file: string; name: string; src: string; shape?: F3PegboardShapeId }[] = [
  { file: 'turntable-text.glb',       name: 'Turntable',        src: 'text → 3d', shape: 'vinyl' },
  { file: 'gameboy-sketchy-text.glb', name: 'Game Boy (sketchy)', src: 'text → 3d, hand-drawn prompt', shape: 'gameBoy' },
  { file: 'gameboy-purple-photo.glb', name: 'Game Boy (purple)', src: 'photo → 3d', shape: 'gameBoy' },
  { file: 'gameboy-doodle.glb',       name: 'Game Boy (doodle)', src: 'doodle → 3d', shape: 'gameBoy' },
  { file: 'pokeball-doodle.glb',      name: 'Poké Ball (doodle)', src: 'doodle → 3d', shape: 'pokeball' },
];

/** A tiny placeholder 2D form for a hard-mesh object (only shows if flipped to 2D;
 *  the GLB is the real content). Labeled card at the 180-frame size. */
function meshPlaceholderSvg(label: string): string {
  const safe = label.replace(/[<&>]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="100%" height="100%">` +
    `<rect x="14" y="14" width="152" height="152" rx="16" fill="none" stroke="#1a1a1a" stroke-width="3"/>` +
    `<text x="90" y="86" text-anchor="middle" font-family="Helvetica,Arial" font-size="13" font-weight="700" fill="#1a1a1a">3D MESH</text>` +
    `<text x="90" y="106" text-anchor="middle" font-family="Helvetica,Arial" font-size="9" fill="#1a1a1a">${safe}</text></svg>`;
}

export async function buildDemoWall(limit?: number, variant?: string | null): Promise<DemoWallObject[]> {
  // ?test=quiver → the REAL Quiver-traced SVG saved with a Trellis AI mesh (Sebs
  // 2026-06-27: "geometry routes to the svg — OFAT that it does the same thing on a
  // QUIVER svg; they're a little different from ours"). Pulled from the DB (a
  // "gameboy test" AI-mesh object): 27 traced REGION paths + circle/ellipse/rect,
  // NOT our many-separate-stroke drawings — so it exercises svgMarkupToStrokes +
  // every geometry mode (rod/extrude/inflate/solid) on exactly the SVG the image→3D
  // path produces. Carries the real GLB too (Auto = the mesh; a mode rebuilds from
  // this Quiver SVG).
  if (variant === 'quiver') {
    let raw = '';
    try { raw = await (await fetch('/test-svgs/quiver-gameboy.svg')).text(); } catch { /* fixture missing */ }
    const svgMarkup = raw ? normalizeSvgSize(raw, 180) : meshPlaceholderSvg('Quiver SVG');
    const MESH = 'https://revoukwqlisqdjteortc.supabase.co/storage/v1/object/public/meshes/3f3e5dd4-cba2-42f9-9c5e-9942b3b5c60b.glb';
    const out: DemoWallObject[] = [];
    for (let i = 0; i < 3; i++) {
      out.push({
        id: `quiver-${i}`,
        svgMarkup,
        x: 260 + i * 320,
        y: 300,
        rotation: 0,
        name: `Quiver Game Boy ${i + 1}`,
        renderConfig: {
          svgStyle: 'clean' as F3SvgStyle,
          modifiers: applyStylePreset(DEFAULT_MODIFIERS, 'clean'),
          is3d: true,
          hardMeshUrl: MESH,
        },
      });
    }
    return out;
  }
  // ?test=suzanne / ?demo=suzanne → the Suzanne hard-mesh wall: each generated GLB
  // as a 3D desk object (movable + editable via the normal controls).
  if (variant === 'suzanne') {
    const out: DemoWallObject[] = [];
    const cache = new Map<F3PegboardShapeId, string>();
    for (let i = 0; i < SUZANNE_MESHES.length; i++) {
      const m = SUZANNE_MESHES[i];
      // Real catalog drawing as the source markup (svg-port projects it); placeholder
      // only if no matching shape.
      let svgMarkup = meshPlaceholderSvg(m.name);
      if (m.shape) {
        let raw = cache.get(m.shape);
        if (raw === undefined) { raw = await shapeMarkupAsync(m.shape); cache.set(m.shape, raw); }
        if (raw) svgMarkup = normalizeSvgSize(raw, 180);
      }
      out.push({
        id: `suzanne-${i}`,
        svgMarkup,
        x: 200 + (i % 3) * 300,
        y: 200 + Math.floor(i / 3) * 320,
        rotation: 0,
        name: m.name,
        renderConfig: {
          svgStyle: 'clean' as F3SvgStyle,
          modifiers: applyStylePreset(DEFAULT_MODIFIERS, 'clean'),
          is3d: true,
          hardMeshUrl: `/suzanne/${m.file}`,
        },
      });
    }
    return out;
  }
  // ?demo=rock → the "3D Rock" eyeball wall (closed shapes, each pre-flipped to
  // 3D in the Rock preset). Any other ?demo value → the normal 2D recording wall.
  const isRock = variant === 'rock';
  const picks = isRock ? ROCK_PICKS : PICKS;
  const n = Math.max(0, limit ?? picks.length);
  // Grid widens with n so a big STRESS count (e.g. ?n=80) spreads out instead of
  // stacking into a column. Each unique catalog shape renders ONCE (cached), then
  // PICKS cycles — any n is cheap to build. The edge test desk (Sebs 2026-06-18:
  // "put stuff in there to really test the limits"). URL: /desk?demo=1&n=80
  const COLS = Math.max(7, Math.ceil(Math.sqrt(n)));
  const GAP_X = 250;
  const GAP_Y = 250;
  const X0 = 160;
  const Y0 = 160;
  const out: DemoWallObject[] = [];
  const markupCache = new Map<F3PegboardShapeId, string>();
  for (let i = 0; i < n; i++) {
    const p = picks[i % picks.length];
    let raw = markupCache.get(p.shape);
    if (raw === undefined) {
      raw = await shapeMarkupAsync(p.shape);
      markupCache.set(p.shape, raw);
    }
    if (!raw) continue;
    const svgMarkup = normalizeSvgSize(raw, 180);
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    out.push({
      id: `demo-${p.shape}-${i}`,
      svgMarkup,
      x: X0 + col * GAP_X + jitter(i, 26, 1),
      y: Y0 + row * GAP_Y + jitter(i, 26, 2),
      rotation: jitter(i, 7, 3),
      name: p.name,
      renderConfig: {
        svgStyle: p.style,
        modifiers: applyStylePreset(DEFAULT_MODIFIERS, p.style),
        ...(isRock ? { is3d: true, geometry3d: ROCK_3D_PRESET } : {}),
      },
    });
  }
  return out;
}
