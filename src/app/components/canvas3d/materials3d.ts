// ─── materials3d — Native style's material presets (FS port, plain data) ────
// Implements docs/design/3d-mode-controls-spec.md §3 "Native's Material
// sub-dropdown": the SIX real Free Stroke presets (every one `implemented:
// true` in FS's own registry — the dither/ASCII/texture families are labeled
// shells even at the source and are NOT ported, per the no-stub rule).
//
// PROVENANCE: free-stroke origin/main lib/style-system.ts MATERIAL_PARAMS
// (L339-460) + MODE_MATERIAL_DEFAULTS (L460-466), read via `git show
// origin/main:lib/style-system.ts` 2026-06-12. SURFACE params verbatim per
// D-C; COLORS follow the RATIFIED COLOR POLICY (spec footer, Sebs 2026-06-12,
// supersedes FS preset colors): ink-black across everything — every preset
// renders in the SINGLE warm-graphite ink (INK_3D_DEFAULT); presets differ
// ONLY in surface qualities (roughness/metalness/sheen/clearcoat), never in
// hue or value. Hue-carrying FS channels are re-registered: sheenColor → the
// warm-graphite sheen register (SHEEN_GRAPHITE below — see its comment for
// why D2-E's paper sheen floods at sheen 1.0); Signal's emissive → the ink
// range's light end #383632 (the glow survives as a value whisper, the teal
// does not). Original FS hex kept in comments for the provenance trail.
//
// PURITY: no three import — this file feeds both the chrome dropdown (main
// chunk) and the lazy scene. The scene turns these plain numbers into
// MeshPhysicalMaterial instances.

// ─── Ink register (conversion-semantics-spec §7 / amendment D2-E) ───────────
// Monochrome warm-graphite ink. Locked range #121110 (primary, L*≈7) →
// #383632 (body, L*≈23) on the warm axis; default ≈ #2A2622 — the warm-axis
// sibling of FS's proven charcoal #26262b. This REPLACES the out-of-register
// #5A5043 (caption-ink tier — the "bronze/clay tan" read Sebs flagged).
// Exact hex = 06-16 identity-pass call; the range locks now.

export const INK_3D_DEFAULT = '#2A2622';
export const INK_3D_RANGE = { darkest: '#121110', lightest: '#383632' } as const;

/** Short alias for the preset table below (ratified single ink). */
const INK = INK_3D_DEFAULT;
/** Sheen register for the FULL-sheen presets (softGel/rubber, sheen 1.0).
 *  D2-E's paper-tinted #d8c9ae was calibrated for the old single material at
 *  sheen 0.35 — at sheen 1.0 it FLOODS the ink to beige (caught on the
 *  2026-06-12 material sweep screenshots: softGel/rubber read tan, breaking
 *  the ratified everything-black policy). The warm-graphite #6b6258 (Δr−b 19)
 *  STILL tinted the wide sheen lobe warm — and three.js sheen integrates the
 *  warm scene lights + env panels too — so on a TRUE FLAT coplanar slab face
 *  the broad lobe read milk-chocolate (2026-06-13 slab battery). NEUTRALISED
 *  to true grey #626262 at the SAME luminance (99) — the satin/balloon surface
 *  identity (broad soft sheen) is unchanged, only the warm CAST is removed, so
 *  the sheen lobe reads grey-on-black, never tan. Ink-black policy (D2-E). */
const SHEEN_GRAPHITE = '#626262';

export type MaterialPresetId =
  | 'ink'
  | 'softGel'
  | 'matteClay'
  | 'glossyPlastic'
  | 'rubber'
  | 'signal';

export type MaterialParams3D = {
  color: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  reflectivity: number;
  sheen: number;
  sheenRoughness: number;
  sheenColor: string;
  emissive: string;
  emissiveIntensity: number;
  envMapIntensity: number;
};

/** FS MATERIAL_PARAMS — surface params verbatim, colors re-registered to the
 *  single ink (six real presets; 'custom' deliberately not ported — its
 *  slider panel is the spec's "only if free" stretch). */
export const MATERIAL_PARAMS_3D: Record<MaterialPresetId, MaterialParams3D> = {
  // Dark glossy gel-ink: the brand default.
  ink: {
    color: INK, // FS ink #26262b → ratified single ink
    roughness: 0.3,
    metalness: 0.0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
    reflectivity: 0.6,
    sheen: 0.0,
    sheenRoughness: 0.5,
    sheenColor: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    envMapIntensity: 1.1,
  },
  // Softer, fuller balloon/gel feel — best for Inflate / Solid.
  softGel: {
    color: INK, // FS softGel #454b57 → ratified single ink
    roughness: 0.5,
    metalness: 0.0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.5,
    reflectivity: 0.4,
    sheen: 1.0,
    sheenRoughness: 0.65,
    sheenColor: SHEEN_GRAPHITE, // FS #8fa6bd (blue) → warm-graphite sheen register
    emissive: '#000000',
    emissiveIntensity: 0,
    envMapIntensity: 0.8,
  },
  // Matte dry clay: the clear "no highlight" opposite of glossy.
  matteClay: {
    color: INK, // FS matteClay #6f6457 → ratified single ink
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 1.0,
    reflectivity: 0.08,
    sheen: 0.0,
    sheenRoughness: 0.5,
    sheenColor: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    envMapIntensity: 0.12,
  },
  // Smooth shiny plastic — the "wet/glossy" end.
  glossyPlastic: {
    color: INK, // FS glossyPlastic #1b1d24 → ratified single ink
    roughness: 0.06,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    reflectivity: 0.9,
    sheen: 0.0,
    sheenRoughness: 0.5,
    sheenColor: '#000000',
    emissive: '#000000',
    emissiveIntensity: 0,
    envMapIntensity: 1.8,
  },
  // Soft rubber: satin, no hard highlight — warmer sibling of matteClay.
  rubber: {
    color: INK, // FS rubber #33312f → ratified single ink
    roughness: 0.92,
    metalness: 0.0,
    clearcoat: 0.04,
    clearcoatRoughness: 0.95,
    reflectivity: 0.15,
    sheen: 1.0,
    sheenRoughness: 0.8,
    sheenColor: SHEEN_GRAPHITE, // FS #9a8a78 → warm-graphite sheen register
    emissive: '#000000',
    emissiveIntensity: 0,
    envMapIntensity: 0.3,
  },
  // Digital "signal": metallic teal with a cool emissive — screen-lit read.
  signal: {
    color: INK, // FS signal #16242c → ratified single ink
    roughness: 0.2,
    metalness: 0.6,
    clearcoat: 0.6,
    clearcoatRoughness: 0.16,
    reflectivity: 0.8,
    sheen: 0.0,
    sheenRoughness: 0.5,
    sheenColor: '#000000',
    emissive: '#383632', // FS teal #1f6e8c → ink-range light end (value whisper, no hue)
    emissiveIntensity: 0.7,
    envMapIntensity: 1.4,
  },
};

// ─── NATIVE PROPERTY TOGGLES (ratified symmetry law gap cell §2) ────────────
// The Native node was presets-only; the law gives it BOTH its discrete STYLE
// set (the 6 material presets) AND a continuous PROPERTY set. Four dials, each
// shaping how LIGHT sits — never color. INK-BLACK HOLDS AT EVERY DIAL POSITION
// (the ratified policy, be7aac7): no dial touches `color`, and Reflection is
// HARD-BOUNDED so it can never re-introduce the warm-tan band.
//
// These modulate the chosen preset's surface params (the preset is the base
// "look", the dials nudge it) — so a glossy preset + low Polish reads
// different from a matte preset + high Polish, but BOTH stay ink-black.

export type NativeProps3D = {
  /** Polish — highlight tightness, mirror (1) ↔ diffuse (0). Drives clearcoat
   *  + clearcoatRoughness + a touch of base roughness. Default 0.5 = neutral
   *  (the preset's own values pass through unchanged at 0.5). */
  polish: number;
  /** Reflection — environment reflection amount (0..1). BOUNDED: maps to
   *  envMapIntensity in [0, REFLECTION_CEIL]. The ceiling is the
   *  glossyPlastic value already battery-proven tan-dead at 72/72 (be7aac7) —
   *  even at MAX the dark warm-graphite env stays ink-black. Default 0.5 =
   *  neutral (preset's own envMapIntensity passes through). */
  reflection: number;
  /** Sheen — satin grazing glow (0..1). Drives the sheen channel with the
   *  warm-graphite sheen register (never floods to beige). Default 0.5 =
   *  neutral (preset's own sheen passes through). */
  sheen: number;
  /** Outline — drawn ink edge weight on the form (0 = off). The scene renders
   *  an EdgesGeometry overlay in ink at this line width. Default 0 = off
   *  (today's Native render = no outline → byte-identical default). */
  outline: number;
};

/** Native dials at neutral — defaults render the preset EXACTLY as today
 *  (polish/reflection/sheen at 0.5 pass the preset params through unchanged;
 *  outline 0 = no edge overlay). */
export const DEFAULT_NATIVE_PROPS_3D: NativeProps3D = {
  polish: 0.5,
  reflection: 0.5,
  sheen: 0.5,
  outline: 0.0,
};

/** Reflection HARD CEILING — the glossyPlastic envMapIntensity (1.8), the
 *  exact value the be7aac7 battery proved tan-dead at 72/72. Reflection MAX
 *  can never exceed this, so the dial can never reflect the env harder than
 *  the already-proven-safe glossy slab. The env itself is ink-family
 *  (#211e1a), so this is belt-and-suspenders. */
export const REFLECTION_CEIL = 1.8;

/** Apply the four Native dials onto a preset's surface params. PURE (plain
 *  numbers in/out, no three) — the scene turns the result into the material.
 *  NEVER touches color/sheenColor/emissive hue — only how light sits.
 *
 *  At all-neutral (polish/reflection/sheen = 0.5) the returned params equal
 *  the preset's own values EXACTLY (the default-identity guarantee). */
export function applyNativeProps(
  base: MaterialParams3D,
  props: NativeProps3D,
): MaterialParams3D {
  const polish = clamp01(props.polish);
  const reflection = clamp01(props.reflection);
  const sheen = clamp01(props.sheen);

  // Polish: 0.5 = identity. Below → diffuse (raise roughnesses); above →
  // POLISHED. Polish owns highlight TIGHTNESS (roughness), but on a MATTE base
  // (matteClay: roughness 1, clearcoat 0, reflectivity 0.08) a tighter highlight
  // had nothing to sharpen → invisible (OFAT 2026-06-24: polish-H moved 0.17% of
  // px catalog-wide, ~1% "works"). FIX: drop roughness HARDER (0.3→0.62) AND lend
  // a clearcoat coat above neutral so the tightened spec has a surface to sit on.
  // Identity holds at 0.5 (delta 0 → matte north-star untouched at the default).
  const polishDelta = (polish - 0.5) * 2.0; // −1..+1
  const clearcoatRoughness = clampUnit(
    base.clearcoatRoughness - polishDelta * 0.8 * (polishDelta > 0 ? base.clearcoatRoughness : (1 - base.clearcoatRoughness)),
  );
  const roughness = clampUnit(
    base.roughness - polishDelta * (polishDelta > 0 ? base.roughness : (1 - base.roughness)) * 0.62,
  );
  const polishCoat = polishDelta > 0 ? polishDelta * (1 - base.clearcoat) * 0.5 : 0; // coat presence so polish reads on matte

  // Reflection: how much environment/specular the surface bounces. 0.5 = the
  // preset's own values (identity). The VISIBLE lever is `reflectivity` (the
  // dielectric specular F0) + `clearcoat` presence — the de-saturated graphite
  // <Environment> is so dark that envMapIntensity alone moves nothing (measured:
  // Δ0 px across all presets), so envMapIntensity rides along bounded but the
  // reflectivity/clearcoat lift is what the eye reads. Below 0.5 → toward matte;
  // above 0.5 → toward mirror (clearcoat lift 0.5→0.85 for a clearly visible step).
  // TAN BOUND: the env stays ink-family (#211e1a) AND envMapIntensity is hard-
  // capped at REFLECTION_CEIL, so stronger reflection can never mirror a warm band.
  const refDelta = (reflection - 0.5) * 2.0; // −1..+1
  const reflectivity = clampUnit(
    base.reflectivity + refDelta * (refDelta > 0 ? (1 - base.reflectivity) : base.reflectivity),
  );
  const reflCoat = refDelta > 0 ? refDelta * (1 - base.clearcoat) * 0.85 : refDelta * base.clearcoat * 0.5;
  // combine reflection's + polish's clearcoat contributions (bounded).
  const clearcoat = clampUnit(base.clearcoat + reflCoat + polishCoat);
  const envMapIntensity =
    reflection <= 0.5
      ? (reflection / 0.5) * base.envMapIntensity
      : base.envMapIntensity + ((reflection - 0.5) / 0.5) * (REFLECTION_CEIL - base.envMapIntensity);
  const envMapIntensityBounded = Math.min(Math.max(envMapIntensity, 0), REFLECTION_CEIL);

  // Sheen: 0.5 = preset's own sheen. Below → toward 0, above → toward 1. Sheen
  // already reads at H on matte (OFAT: sheen-H ~6.6%); the BROAD lobe
  // (base.sheenRoughness) is what catches the surface — tightening it
  // concentrates the satin into a tiny spot and KILLS the spread (measured
  // 6.6%→0.6% when sheenRoughness was dropped), so leave sheenRoughness on the
  // preset. Keep the warm-graphite sheenColor register (or upgrade #000000
  // presets to it when the dial lifts sheen).
  const sheenAmt =
    sheen <= 0.5 ? (sheen / 0.5) * base.sheen : base.sheen + ((sheen - 0.5) / 0.5) * (1 - base.sheen);
  const sheenColor =
    sheenAmt > 0.001 && base.sheenColor === '#000000' ? SHEEN_GRAPHITE : base.sheenColor;

  return {
    ...base,
    roughness,
    clearcoat,
    clearcoatRoughness,
    reflectivity,
    sheen: clampUnit(sheenAmt),
    sheenColor,
    envMapIntensity: envMapIntensityBounded,
  };
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}
function clampUnit(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}

/** FS MODE_MATERIAL_DEFAULTS verbatim — applied only while the user has NOT
 *  explicitly picked a material (materialUserOverride false). A user pick
 *  always wins; geometry is never touched by this map (I-1 spirit in FS's own
 *  code, spec §3). 'auto' takes rod's default (ink) — auto's per-stroke
 *  resolution is geometry-level; the live material is one pick. */
export const MODE_MATERIAL_DEFAULTS_3D: Record<
  'auto' | 'rod' | 'extrude' | 'inflate' | 'solid' | 'ai-mesh',
  MaterialPresetId
> = {
  // 'ai-mesh' FORM (Sebs 2026-06-27): the GLB owns its surface via
  // aiMeshMaterialMode, so this preset is never read for the mesh render —
  // matteClay is a harmless default that keeps the index-by-geometryMode sites
  // (Canvas3DContext, deskRenderMode) total over the FORM axis.
  'ai-mesh': 'matteClay',
  // PENCIL NORTH-STAR (Sebs 2026-06-15): 3D reads as a matte pencil sketch —
  // value from light, never gloss. Default EVERY mode to the matte preset
  // (matteClay: roughness 1, no clearcoat/sheen, low reflectivity); stays
  // ink-black (matteClay's color IS the single ink). A user can still explicitly
  // pick a glossy preset. Was: auto/rod=ink, extrude=glossyPlastic, inflate=softGel
  // (all glossy → fought the pencil look). Homepage hero hardcodes are art-directed
  // separately (left as Sebs set them — flagged for his taste call).
  auto: 'matteClay',
  rod: 'matteClay',
  extrude: 'matteClay',
  solid: 'matteClay',
  inflate: 'matteClay',
};

/** Chrome dropdown inventory — the full real set, locked order (spec §3). */
export const MATERIAL_PRESET_OPTIONS: Array<{
  id: MaterialPresetId;
  label: string;
  detail: string;
}> = [
  // Detail copy describes SURFACE QUALITY only — every preset is the same
  // ink-black (ratified policy); what changes is how the light sits on it.
  { id: 'ink', label: 'Ink', detail: 'Glossy gel-ink — hard tight clearcoat highlight.' },
  { id: 'softGel', label: 'Soft Gel', detail: 'Full balloon feel — broad soft sheen, gentle highlight.' },
  { id: 'matteClay', label: 'Matte Clay', detail: 'Chalky dry clay — fully rough, zero highlight.' },
  { id: 'glossyPlastic', label: 'Glossy Plastic', detail: 'Mirror-sharp clearcoat + strong reflections — the wet end.' },
  { id: 'rubber', label: 'Rubber', detail: 'Satin rubber — soft broad sheen, no hard highlight.' },
  { id: 'signal', label: 'Signal', detail: 'Metallic, faint inner glow — the screen-lit read, hue-free.' },
];
