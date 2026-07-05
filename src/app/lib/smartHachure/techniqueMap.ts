// Smart Hachure System — technique selector.
//
// Pure function: (Classification + user style choice + modifier state) → Treatment.
// Maps the 9 tonal roles to specific 5-axis treatments (gap · weight · layers ·
// pressure · opacity), then modulates by user's style choice + slider state.
//
// Architecture: signals → classify → SELECT TREATMENT → render
// Sources:
//   - Agent 1: tonal-to-multi-axis-mark canonical mapping table
//   - Doc 06: Option E hybrid bias picking (fillStyle + darkness + size)

import type { Classification, Treatment, TonalRole } from './types';

// ─── PUBLIC ENTRY POINT ───────────────────────────────────────────────────

/** User's style choice (from F3SvgStyle context).
 *
 *  Phase B (smart-system-build-plan · makeathon-plan §8.6 workstream B): ALL
 *  8 shading-capable styles route through the technique map — and therefore
 *  through the shared coverage math in renderRegion — not just the 4
 *  rough-family styles. The 4 additions (wet-ink · charcoal · risograph ·
 *  newsprint) keep their style-specific FX layers (filters/dot-screens) in
 *  SvgStyleTransform; what THIS map owns is their tonal-fill grammar +
 *  weight/opacity character, so source darkness drives density identically
 *  across every style (one math, every register).
 *
 *  NOTE: the SvgStyleTransform smartHachure gate currently admits only the 4
 *  rough-family styles — lifting it is a 1-line host edit documented in the
 *  rock followups (host file owned by another rock). This map is total over
 *  all 8 either way. */
export type SmartHachureStyle =
  | 'rough-handdrawn'
  | 'sketchy'
  | 'bold-ink'
  | 'stipple'
  | 'wet-ink'
  | 'charcoal'
  | 'risograph'
  | 'newsprint';

/** Styles whose chrome exposes NO fillStyle control (modifierSpecs
 *  MODIFIER_SETS_BY_STYLE rows for wet-ink / charcoal / risograph /
 *  newsprint / sketchy omit 'fillStyle'). For these, the stored
 *  `fillStyle` modifier is stale default state, NOT a user pick — the
 *  style's own grammar modulation owns the mark family, and the narrow
 *  user-pick override in index.ts must not apply
 *  (feedback_fillstyle_slider_must_switch_classifier_pick is about the
 *  user's ACTUAL pick; honoring un-pickable state would be drift). */
export const STYLE_OWNS_FILL_GRAMMAR: ReadonlySet<SmartHachureStyle> = new Set<SmartHachureStyle>([
  'sketchy',
  'wet-ink',
  'charcoal',
  'risograph',
  'newsprint',
]);

/** Minimal subset of F3 modifier state that the technique selector needs.
 *  Decoupled from the full F3ModifiersState type so this module stays portable. */
export type ModifierSubset = {
  /** User's base hachure gap slider (px). */
  hachureGap: number;
  /** User's base fillDensity slider (0-1.2 after recalibration). */
  fillDensity: number;
  /** User's base strokeWidth (px). */
  strokeWidth: number;
  /** User's hachureAngle (degrees). */
  hachureAngle: number;
  /** User's inkIntensity (0-1) — scales overall ink opacity. */
  inkIntensity: number;
  /** User's fillOpacity (0-1) — scales hachure opacity specifically. */
  fillOpacity: number;
};

/**
 * Pick the right treatment for one classified region.
 *
 * 3-stage pipeline:
 *   1. Look up the BASE treatment for the role (Agent 1 canon)
 *   2. Modulate by the user's style choice (rough vs sketchy vs bold vs stipple)
 *   3. Modulate by user's modifier sliders (existing slider state still applies)
 */
export function selectTreatment(
  classification: Classification,
  styleChoice: SmartHachureStyle,
  modifiers: ModifierSubset,
): Treatment {
  // Stage 1: role → base treatment
  const base = BASE_BY_ROLE[classification.role];

  // Stage 2: style choice modulates the base (role-aware: dark tonal BODIES
  // that carry knockout structure must keep a legible mark grammar across
  // every style — never flatten to solid, never strip to empty).
  const styled = applyStyleModulation(base, styleChoice, classification.role);

  // Stage 3: user sliders fine-tune within the role's range
  const final = applyModifierOverrides(styled, modifiers, classification);

  return final;
}

// ─── STAGE 1 — BASE TREATMENT PER ROLE ────────────────────────────────────
//
// Per Agent 1 canon table. Each role declares:
//   - fillStyle  (what kind of mark)
//   - gap multiplier   (× the user's hachureGap slider)
//   - weight multiplier (× the user's strokeWidth)
//   - layerCount
//   - opacity multiplier (× the user's fillOpacity)
//   - biasMode  (Option E — primary axis for tonal variation)
//
// These are STARTING POINTS. Style choice + slider state modulate from here.

const BASE_BY_ROLE: Record<TonalRole, Treatment> = {
  paper: {
    fillStyle: 'none',
    gap: 0,
    weight: 0,
    angle: -41,
    layerCount: 0,
    pressureEnvelope: null,
    opacity: 0,
    biasMode: 'hybrid',
  },

  // Light grey register — Agent 1 Lancaster-style "sparse single-direction hatch"
  // gap 4-6× strokeWidth, weight 0.5-0.7×, opacity 0.6-0.8
  'sparse-tonal': {
    fillStyle: 'hachure',
    gap: 5.0, // × hachureGap slider
    weight: 0.6, // × strokeWidth slider
    angle: -41,
    layerCount: 1,
    pressureEnvelope: null,
    opacity: 0.7,
    biasMode: 'gap-dominant',
  },

  // Mid grey register — parallel hatch tightening
  // gap 2-3× strokeWidth, weight 0.7-1.0×, opacity 0.8-1.0
  'mid-tonal': {
    fillStyle: 'hachure',
    gap: 2.5,
    weight: 0.85,
    angle: -41,
    layerCount: 1,
    pressureEnvelope: null,
    opacity: 0.9,
    biasMode: 'hybrid',
  },

  // Dark grey register — cross-hatch (2 directions handled internally by rough.js)
  // gap 1.5-2× strokeWidth, weight 1.0×, opacity 1.0
  // NOTE: cross-hatch produces 2 directions INTERNALLY — layerCount stays at 1.
  // Setting > 1 stacks more directions and approaches solid black.
  'dense-tonal': {
    fillStyle: 'cross-hatch',
    gap: 1.75,
    weight: 1.0,
    angle: -41,
    layerCount: 1,
    pressureEnvelope: null,
    opacity: 1.0,
    biasMode: 'layers-dominant',
  },

  // Near-black register — fine cross-hatch / Dürer double-hatch accumulation
  // gap ≤1× (lines touching), weight 1.0-1.4×, opacity 1.0
  // NOTE: cross-hatch internal 2 directions + tight gap + high weight already
  // reads as "near-black with structure". layerCount stays at 1.
  'solid-content': {
    fillStyle: 'cross-hatch',
    gap: 0.9,
    weight: 1.2,
    angle: -41,
    layerCount: 1,
    pressureEnvelope: null,
    opacity: 1.0,
    biasMode: 'weight-dominant',
  },

  // Frames render as clean outlines — no fill technique regardless of darkness
  'structural-frame': {
    fillStyle: 'none',
    gap: 0,
    weight: 0,
    angle: -41,
    layerCount: 0,
    pressureEnvelope: null,
    opacity: 0,
    biasMode: 'hybrid',
  },

  // Decorative accents — preserve as-is, no hachure
  'decorative-accent': {
    fillStyle: 'none',
    gap: 0,
    weight: 0,
    angle: -41,
    layerCount: 0,
    pressureEnvelope: null,
    opacity: 1.0,
    biasMode: 'hybrid',
  },

  // Line decorations — outline only, no fill family
  'line-decoration': {
    fillStyle: 'none',
    gap: 0,
    weight: 0,
    angle: -41,
    layerCount: 0,
    pressureEnvelope: null,
    opacity: 1.0,
    biasMode: 'hybrid',
  },

  // Text — pass through, never hachure
  'label-text': {
    fillStyle: 'none',
    gap: 0,
    weight: 0,
    angle: -41,
    layerCount: 0,
    pressureEnvelope: null,
    opacity: 1.0,
    biasMode: 'hybrid',
  },
};

// ─── STAGE 2 — STYLE CHOICE MODULATION ────────────────────────────────────
//
// rough-handdrawn = default (base treatments unchanged)
// sketchy         = no fills on tonal regions (only structural marks), lower weight
// bold-ink        = solid fills replace cross-hatch for dense roles, heavier weight
// stipple         = dots instead of hachure for all tonal roles
//
// Phase B additions (each anchored in the style's locked semantic from
// F3-shading-calibration-spec §2 + its FX layer in SvgStyleTransform; the
// multipliers are Phase B calibration constants — same standing as K_ZIGZAG
// in coverage.ts, tunable without touching the renderer):
// wet-ink         = loaded-brush register: hachure grammar kept, heavier wet
//                   line (×1.3); the blur/bleed halo is the FX layer's job
// charcoal        = dry-media register: soft wide marks (×1.5) at reduced
//                   opacity (×0.85) — grain/smudge FX ride on top
// risograph       = flat print-ink register: dense roles flood to solid
//                   (riso prints spot-color masses, not fine cross-hatch),
//                   lighter roles keep hachure at a slightly fuller line
// newsprint       = halftone register: dots grammar for ALL tonal roles
//                   (the dot-screen mask in SvgStyleTransform is paper
//                   texture; THESE dots are the region's tone)

// DARK-BLOB RE-FIX (2026-06-13): the tonal-body roles whose dark register MUST
// stay legible across EVERY style. dense-tonal is the role dark ENCLOSING
// bodies route to (knockout text/panels painted on top) — so for these, no
// style may flatten the cross-hatch to a flat solid mass (bold-ink/risograph),
// mass the dots into a near-solid blob (stipple — guarded by the render
// coverage cap), or strip the fill to nothing (sketchy). solid-content stays
// the TINY-detail register (no structure to lose); flat solid there is fine.
const STRUCTURE_BEARING_TONAL_ROLES: ReadonlySet<TonalRole> = new Set<TonalRole>([
  'dense-tonal',
  'mid-tonal',
  'sparse-tonal',
]);

function applyStyleModulation(
  base: Treatment,
  style: SmartHachureStyle,
  role: TonalRole,
): Treatment {
  // Only modify if the role HAS a tonal treatment to modulate
  if (base.fillStyle === 'none') return base;

  // Does this region carry knockout structure that any style must preserve?
  const keepsStructure = STRUCTURE_BEARING_TONAL_ROLES.has(role);

  switch (style) {
    case 'rough-handdrawn':
      return base;

    case 'sketchy':
      // sketchy = draft / outline-leaning. Light roles stay outline-only.
      // But a DARK TONAL BODY must NEVER render to nothing (Tone-band-visibility
      // law SA-2 / "tone may change grammar but never vanish"): strip-to-empty
      // is the same dark-blob root, opposite symptom. Dark roles fall back to a
      // sparse-but-present hatch (single direction, wider gap) — reads as a
      // loose draft shade, keeps the body legibly toned.
      //
      // DARK-BODY LEGIBILITY (2026-06-13, empty-poster residual): a near-black
      // ENCLOSING body (poster/cover — darkness ≈ 1.0, dense-tonal) rendered at
      // the old ×0.7 opacity (× sketchy's inkIntensity 0.85 = 0.595 effective)
      // landed its single-direction hatch lines at ~grey-103 luminance, so the
      // whole body read at mean-luminance ≈ 202 — a PALE wash, not the "dark
      // poster" its source darkness demands (I-2: source darkness owns
      // perceptual identity; SA-2: tone never renders to nothing). Measured vs
      // the rough gold standard (mean-lum ≈ 132): sketchy was ~70 luminance
      // steps too light, near the empty/untoned read the bug reports. Fix: keep
      // sketchy's LIGHT draft GRAMMAR (single direction, loose gap, thin weight
      // — still visibly lighter & looser than rough/bold) but bring the present
      // lines to FULL ink so the dark body reads as legible dark draft shading,
      // knockout text intact. Opacity for a structure-bearing dark/near-black
      // body is the role base (1.0 × inkIntensity); the looser gap is what keeps
      // it the lighter draft register, NOT a faded ink. mid/sparse dark bands
      // (base.opacity 0.9 / 0.7) keep their lighter-than-full draft falloff.
      if (keepsStructure && role !== 'sparse-tonal') {
        const isNearBlackBody = role === 'dense-tonal';
        return {
          ...base,
          fillStyle: 'hachure',
          gap: Math.max(base.gap, 2.4) * 1.4, // looser than the dense register
          weight: base.weight * 0.7,
          layerCount: 1,
          biasMode: 'gap-dominant',
          // near-black enclosing body → full ink (legible dark); lighter dark
          // bands keep the draft falloff so the register still steps with tone.
          opacity: isNearBlackBody ? base.opacity : base.opacity * 0.7,
        };
      }
      // solid-content (tiny pure-black details) under sketchy also keep a mark
      // rather than vanish — a single sparse hatch reads as a draft fill.
      if (role === 'solid-content') {
        return {
          ...base,
          fillStyle: 'hachure',
          gap: 3.2,
          weight: base.weight * 0.7,
          layerCount: 1,
          biasMode: 'gap-dominant',
          opacity: base.opacity * 0.75,
        };
      }
      // light / sparse register stays outline-leaning (the draft look).
      return { ...base, fillStyle: 'none', gap: 0, weight: 0, layerCount: 0 };

    case 'bold-ink':
      // bold-ink = heavier ink. A structure-bearing dark body must HATCH (just
      // heavier line) so its knockout structure survives — NEVER flatten to a
      // solid black mass. Only solid-content (tiny detail, no structure) goes
      // flat solid.
      if (base.fillStyle === 'cross-hatch') {
        if (keepsStructure) {
          return { ...base, weight: base.weight * 1.2 }; // keep cross-hatch, bolder line
        }
        return { ...base, fillStyle: 'solid', weight: base.weight * 1.2 };
      }
      return { ...base, weight: base.weight * 1.2 };

    case 'stipple':
      // stipple = dots instead of hachure. The render-side upper-darkness cap
      // (renderRegion COVERAGE_LEGIBLE_DENSE_CAP) keeps dark dot fields from
      // massing into a near-solid blob — dots stay a legible dense stipple.
      return { ...base, fillStyle: 'dots', biasMode: 'gap-dominant' };

    case 'wet-ink':
      // wet-ink = loaded brush: same grammar, fatter line carries the tone
      return { ...base, weight: base.weight * 1.3 };

    case 'charcoal':
      // charcoal = dry media: wide soft marks, slightly lifted off full black
      return { ...base, weight: base.weight * 1.5, opacity: base.opacity * 0.85 };

    case 'risograph':
      // risograph = flat ink. Same structure law as bold-ink: a dark TONAL BODY
      // keeps its cross-hatch (knockout structure survives) — only solid-content
      // tiny details print as a flat spot-color mass.
      if (base.fillStyle === 'cross-hatch') {
        if (keepsStructure) {
          return { ...base, weight: base.weight * 1.1 }; // keep cross-hatch
        }
        return { ...base, fillStyle: 'solid', weight: base.weight * 1.1 };
      }
      return { ...base, weight: base.weight * 1.1 };

    case 'newsprint':
      // newsprint = halftone: tone is a dot screen, never line hatch. The
      // upper-darkness cap keeps the dark dot screen legible (not a solid mass).
      return { ...base, fillStyle: 'dots', biasMode: 'gap-dominant' };
  }
}

// ─── STAGE 3 — USER SLIDER MODULATION ─────────────────────────────────────
//
// Existing slider state still has effect — within the role's range.
//   - hachureGap slider × treatment.gap multiplier = effective gap (px)
//   - strokeWidth slider × treatment.weight multiplier = effective weight (px)
//   - fillDensity slider scales weight further (denser fills = thicker hachure)
//   - inkIntensity × fillOpacity = effective opacity
//
// Final caps preserve perceptual constraints from Agent 5:
//   - effective weight ≤ effective gap × 0.7 (lines never merge to solid)
//   - effective gap ≥ 1.5 px (lines never optically blend)

function applyModifierOverrides(
  styled: Treatment,
  m: ModifierSubset,
  _classification: Classification,
): Treatment {
  if (styled.fillStyle === 'none') {
    // Tonal-less treatments still get opacity scaled (for paper roles this stays 0,
    // for structural/accent/line/label it scales their stroke-only render).
    return {
      ...styled,
      opacity: styled.opacity * m.fillOpacity * m.inkIntensity,
    };
  }

  // Tiny shapes (area < 40 px²): coverage statistics too noisy for discrete
  // marks — render solid at the role's tonal opacity instead (18-scope-audit
  // edge-case table "Tiny shapes" row, Agent 2 §7).
  const area = _classification.signalsSnapshot.area;
  if (area > 0 && area < 40) {
    return {
      ...styled,
      fillStyle: 'solid',
      opacity: styled.opacity * m.fillOpacity * m.inkIntensity,
    };
  }

  // Effective gap (px) = base hachureGap slider × role's gap multiplier,
  // capped at 12 px (edge-case table "Huge shapes" row: beyond that, lines
  // read as discrete strokes, not a darker hatched area — Agent 2 §7).
  //
  // 2026-06-11 slider-sweep fix-now #1 (audit-runs/2026-06-11-slider-sweep/
  // REPORT.md §7): the role gap multipliers (0.9-5×) pushed the raw product
  // past the 12 px cap by slider ~5-6, pinning every fillable role for the
  // top HALF of the slider (two measured consecutive steps with literally
  // zero pixel change). Fix per I-3 "bias within band": keep the sub-default
  // mapping byte-identical (slider ≤ 4 — preserves the default render AND
  // every preset that sets hachureGap ≤ 4, e.g. stipple's 2.5), and remap
  // the above-default half so each role travels from its default-anchored
  // gap to the 12 px cap as the slider reaches its max — slider max now
  // lands AT the cap for every role instead of hitting it early and dying.
  // sparse-tonal (5×) is already AT the cap at the default; it stays pinned
  // above 4 by design (the cap is the locked perceptual bound) — the
  // aggregate response stays alive via mid/dense/solid roles.
  const GAP_FLOOR = 1.5;
  const GAP_CAP = 12;
  const GAP_SLIDER_DEFAULT = 4; // DEFAULT_MODIFIERS.hachureGap — anchor value
  const GAP_SLIDER_MAX = 12; // SLIDER_SPECS.hachureGap.max
  let effectiveGap: number;
  if (m.hachureGap <= GAP_SLIDER_DEFAULT) {
    // Bottom half: today's exact formula — byte-identical output.
    effectiveGap = Math.max(GAP_FLOOR, Math.min(GAP_CAP, m.hachureGap * styled.gap));
  } else {
    // Top half: lerp from the role's default-anchored gap to the cap.
    const gapAtDefault = Math.max(GAP_FLOOR, Math.min(GAP_CAP, GAP_SLIDER_DEFAULT * styled.gap));
    const t = Math.min(1, (m.hachureGap - GAP_SLIDER_DEFAULT) / (GAP_SLIDER_MAX - GAP_SLIDER_DEFAULT));
    effectiveGap = gapAtDefault + (GAP_CAP - gapAtDefault) * t;
  }

  // Effective weight (px) = strokeWidth × role's weight multiplier × fillDensity scale
  //
  // 2026-06-11 slider-sweep fix-now #2 (REPORT.md §9): the flat
  // Math.max(0.5, m.fillDensity) floor swallowed slider values 0-0.5 —
  // the bottom 40% of the slider was byte-identical output. Default-
  // preserving piecewise remap: keep the 0.5 floor's INTENT (light fills
  // never vanish) by mapping 0 → 0.5 and ramping to the 0.7 default
  // (0.7 → 0.7 exactly — default render byte-identical; ≥ 0.7 passes
  // through untouched, so bold-ink/stipple presets at 1.0 are unchanged).
  // Monotonic, continuous at 0.7, no dead zone.
  const densityScale =
    m.fillDensity < 0.7 ? 0.5 + (m.fillDensity / 0.7) * 0.2 : m.fillDensity;
  let effectiveWeight = m.strokeWidth * styled.weight * densityScale;

  // Cap weight at 70% of gap so hachure lines never merge to solid (Agent 5)
  effectiveWeight = Math.min(effectiveWeight, effectiveGap * 0.7);

  // Effective opacity scales by both ink intensity and fill opacity
  const effectiveOpacity = styled.opacity * m.fillOpacity * m.inkIntensity;

  // User's hachureAngle modifier routes through to the fill scan-line angle.
  // Falls back to the role-default (-41) when the modifier is unset. This is
  // I-1-safe: we route the EXISTING angle modifier into the treatment, we do
  // not change classification or fillStyle.
  const effectiveAngle = Number.isFinite(m.hachureAngle) ? m.hachureAngle : styled.angle;

  return {
    ...styled,
    gap: effectiveGap,
    weight: effectiveWeight,
    angle: effectiveAngle,
    opacity: effectiveOpacity,
  };
}

// ─── HELPER — query the role table directly (for debugging/inspection) ────

/** Returns the base treatment for a role without any modulation.
 *  Useful for chrome debugging + tests. */
export function getBaseTreatmentForRole(role: TonalRole): Treatment {
  return BASE_BY_ROLE[role];
}
