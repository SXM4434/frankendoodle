// Smart Hachure System — classifier.
//
// Takes Signals + override-store check → produces a Classification per region.
// v1 ships with ONE provider: the rule engine. v2/v3 add cached LLM + decision
// tree providers via the ClassifierProvider chain.
//
// Architecture: signals → classify → select treatment → render
// See `docs/labs/hero/cells/F3-smart-hachure-system/04-agent-research-classifier-architectures.md`
// for the hybrid pattern + why rules are the right v1 substrate.

import type {
  Signals,
  Classification,
  ClassificationContext,
  ClassifierProvider,
  OverrideStoreApi,
  TonalRole,
} from './types';

// ─── PUBLIC ENTRY POINT ───────────────────────────────────────────────────

/**
 * Classify one region.
 *
 * Resolution order:
 *   1. Override store wins (manual tag = full confidence)
 *   2. Walk provider chain in order (v1 = [ruleEngineProvider])
 *   3. First provider returning confidence ≥ threshold wins
 *   4. Fallback = paper (Agent 3 conservative policy)
 */
export function classify(
  signals: Signals,
  ctx: ClassificationContext,
  providers: ClassifierProvider[],
  overrideStore: OverrideStoreApi,
): Classification {
  // (1) override wins
  const override = overrideStore.get(ctx.svgHash, ctx.regionPath);
  if (override) {
    return {
      role: override.role,
      confidence: 1.0,
      rawScore: 1, // manual tag = full-confidence trace (QW-2)
      margin: 1,
      firedRules: [`manual-override (${override.setBy})`],
      classifiedBy: 'manual-override',
      signalsSnapshot: signals,
    };
  }

  // (2) "ALWAYS LOOK AT BOTH" (Sebs 2026-06-26) — collect EVERY provider's raw
  //     opinion (no short-circuit). With only [ruleEngineProvider] this is
  //     byte-identical to the old first-confident-wins (one opinion → step 4a).
  const opinions: Classification[] = [];
  for (const provider of providers) {
    const r = provider.classify(signals, ctx);
    if (r) opinions.push(r);
  }
  const ruleOp = opinions.find((o) => o.classifiedBy === 'rules');
  const learnedOp = opinions.find((o) => o.classifiedBy === 'decision-tree');

  // (3) ENSEMBLE — a rule opinion AND a learned opinion → reconcile them. This is
  //     the wedge: rules carry provenance + cover roles the model never learned;
  //     the learned model fixes the in-vocab disagreements it's proven 90.5% on
  //     (tools/ml held-out hard cases). Augments the rule layer, never blind-
  //     replaces it — and the trace records BOTH so nothing is hidden.
  if (ruleOp && learnedOp) {
    return reconcileBoth(ruleOp, learnedOp, signals);
  }

  // (4a) single provider (or only one fired) → the original first-confident-wins.
  for (const o of opinions) {
    if (o.confidence >= ctx.confidenceThreshold) return o;
  }
  // A confident learned opinion with NO rule firing fills the gap (the
  // documented "learned fills where rules abstain" intent). It already cleared
  // its own minConfidence to be in `opinions`.
  if (learnedOp && !ruleOp) return learnedOp;

  // (4b) conservative fallback — when in doubt, do less hachure
  return {
    role: 'paper',
    confidence: 0,
    rawScore: 0, // nothing fired confidently — zero trace (QW-2)
    margin: 0,
    firedRules: ['fallback:no-provider-confident'],
    classifiedBy: 'rules',
    signalsSnapshot: signals,
  };
}

/** The 6 roles the learned signals model can predict (mirror of
 *  datasets/smart-layer.signals.model.json `classes`). The rule engine speaks a
 *  SUPERSET (mid-tonal, sparse-tonal, decorative-accent, inner-* …) the model
 *  was never trained on — so the model only adjudicates a disagreement when the
 *  RULE's role also lives in this vocabulary (else the model would flatten a
 *  nuance it can't represent). */
const LEARNED_VOCAB: ReadonlySet<TonalRole> = new Set([
  'dense-tonal', 'label-text', 'line-decoration', 'paper', 'solid-content', 'structural-frame',
] as TonalRole[]);

/** Confidence the learned model must clear to OVERRIDE the rule on an in-vocab
 *  disagreement. Below it, the conservative rule opinion stands. */
const LEARNED_OVERRIDE_CONF = 0.6;

/** I-2 GUARD: roles that imply a DARK-FILL treatment (near-black / dense marks).
 *  The model may not assign one to a region whose SOURCE darkness sits in the
 *  paper/light band — that would push the region across an I-2 darkness band
 *  (source darkness owns per-region identity; a light region always reads light)
 *  and bury whatever the region outlines. This is exactly the nintendo "M": a
 *  light circle outline the model wanted to fill solid black. */
const DARK_FILL_ROLES: ReadonlySet<TonalRole> = new Set(['solid-content', 'dense-tonal'] as TonalRole[]);
/** Below this source darkness a region is paper/light band → cannot be dark-fill. */
const I2_DARK_FILL_FLOOR = 0.3;

/** Reconcile a rule opinion and a learned opinion ("look at both"). */
function reconcileBoth(rule: Classification, learned: Classification, signals: Signals): Classification {
  // AGREE → both independent methods concur. Keep rule provenance, boost
  // confidence to the stronger of the two, record the concurrence.
  if (rule.role === learned.role) {
    return {
      ...rule,
      confidence: Math.max(rule.confidence, learned.confidence),
      firedRules: [...rule.firedRules, `learned-agrees(${learned.confidence.toFixed(2)})`],
      signalsSnapshot: signals,
    };
  }
  // I-2 GUARD — the model may NOT push a paper/light region to a dark-fill role.
  // Reject that override outright (keep the rule), no matter how confident the
  // model is: I-2 is a hard invariant, not a vote. This is the nintendo "M" fix —
  // a light circle outline stays an outline, never gets filled solid.
  if (DARK_FILL_ROLES.has(learned.role) && signals.darknessL < I2_DARK_FILL_FLOOR) {
    return {
      ...rule,
      firedRules: [...rule.firedRules, `i2-blocked-learned:${learned.role}(dark ${signals.darknessL.toFixed(2)})`],
      signalsSnapshot: signals,
    };
  }
  // DISAGREE, and the model can speak to the rule's role, and it's confident →
  // the model wins (it's right ~90% on exactly these). Trace keeps the rule's
  // claim for provenance + reversibility.
  if (LEARNED_VOCAB.has(rule.role) && learned.confidence >= LEARNED_OVERRIDE_CONF) {
    return {
      ...learned,
      firedRules: [`learned-override:${learned.firedRules[0] ?? 'learned'}(${learned.confidence.toFixed(2)})`, `over-rule:${rule.role}`],
      signalsSnapshot: signals,
    };
  }
  // DISAGREE but the model is out-of-vocab on the rule's role OR not confident
  // enough → the rule stands (don't let the coarser model flatten a nuance).
  return {
    ...rule,
    firedRules: [...rule.firedRules, `learned-dissents:${learned.role}(${learned.confidence.toFixed(2)})`],
    signalsSnapshot: signals,
  };
}

// ─── RULE ENGINE PROVIDER ─────────────────────────────────────────────────

/**
 * Rule = a named heuristic that inspects Signals and emits a candidate role
 * with a confidence contribution.
 *
 * Each rule is INDEPENDENT — they don't know about each other. The engine
 * collects all firings, sums confidence per role, returns the highest-scoring
 * role. This avoids ordering bugs (rule A overriding rule B accidentally).
 */
type Rule = {
  id: string;
  description: string;
  evaluate: (s: Signals, ctx: ClassificationContext) => RuleFiring | null;
};

type RuleFiring = {
  role: TonalRole;
  confidence: number; // [0, 1] — contribution from THIS rule
};

// ─── THE RULES (Agent 3 catalog → executable form) ────────────────────────
// Grouped by cluster. Each cluster targets one structural pattern.

// Cluster A — TEXT (highest-priority, simplest)
// Text is never hachured. This fires hard and early.

const RULE_text_label: Rule = {
  id: 'text-label',
  description: '<text> elements are labels — never hachure them',
  evaluate: (s) => (s.tag === 'text' ? { role: 'label-text', confidence: 0.95 } : null),
};

// Cluster B — STRUCTURAL FRAMES
// Outer rectangles that enclose other content. Render as clean outlines.

// Dark band floor (I-2, 09-LOCKED-MODEL §I-2): source darkness ≥ 0.55 is the
// "Dark" identity band. At/above it a region MUST read as filled tonal content,
// never as paper-white reservation. A frame border is a LIGHT wash (darkness
// ≈ 0.08); a full-bleed near-black poster body, document cover, dark photo, or
// TV screen is FILLED CONTENT that happens to enclose siblings (knockout text /
// logos painted on top). Treating it as a structural frame — or dropping it to
// the paper fallback when it encloses only 1–2 knockout siblings (below the
// frame rule's ≥3 floor yet above the root-tonal rules' "encloses 0" guard) —
// drops its fill → the empty-outline bug (shading-conversion-fidelity-catalog
// P11: outer-frame-encloses-all + paper-fallback, same dark-fill-dropped root).
// The darkness-aware branch below keeps LIGHT enclosing rects as frames and
// routes DARK ones to the fillable tonal role their darkness band deserves.
//
// DARK-BLOB RE-FIX (2026-06-13, supersedes 8980b8e's solid-content routing):
// the prior version routed Near-black enclosing bodies to `solid-content`,
// whose cross-hatch base solves coverage ≈ 1.0 → clamps to the 1.5 px gap
// floor → delivers ~0.91 coverage = a structure-losing solid-black BLOB
// (knockout text/panels overwhelmed). The GOAL (this task) is LEGIBLE DENSE
// HAND-DRAWN HATCHING: clearly pen lines with gaps, internal knockout
// structure still readable. The classifier half of that = route dark
// ENCLOSING bodies (which carry knockout siblings on top — structure that MUST
// stay readable) to `dense-tonal` for BOTH the Dark and Near-black bands, NOT
// `solid-content`. dense-tonal renders cross-hatch with a legible gap; the
// render-side upper-darkness guard (renderRegion.resolveDensity DENSE_TONAL_
// COVERAGE_CAP + techniqueMap dense-tonal gap) keeps it dark-but-hand-drawn.
// solid-content stays the role for tiny pure-black DETAILS (no knockout
// structure to preserve) routed by RULE_inner_content_solid below at a
// stricter near-black threshold.
const DARK_BAND_FLOOR = 0.55;

const RULE_outer_frame_encloses_all: Rule = {
  id: 'outer-frame-encloses-all',
  description:
    'Z-index 0 element that fills > 80% of its parent and encloses siblings. ' +
    'LIGHT (darkness < 0.55) + ≥3 enclosed siblings → structural frame (clean outline). ' +
    'DARK (darkness ≥ 0.55) + ≥1 enclosed knockout sibling → filled content body ' +
    '(poster/cover/screen): routes to DENSE-TONAL so it SHADES with legible dense ' +
    'hatching (I-2) — knockout structure stays readable — never an empty outline ' +
    'and never a solid-black blob.',
  evaluate: (s) => {
    if (s.zIndex !== 0) return null;
    if (s.areaFractionOfParent < 0.8) return null;
    // Darkness gate. A large enclosing rect in the Dark/Near-black band is a
    // filled poster body, not a frame border. Even ONE knockout sibling (logo
    // or title painted on top) is enough to recognize it as content — without
    // this the 1–2-sibling dark posters fall through both the frame floor (≥3)
    // and the root-tonal "encloses 0" guard, landing on paper (empty). Route
    // it to DENSE-TONAL (not solid-content) for the WHOLE Dark+Near-black band:
    // an enclosing body has knockout siblings painted on top, so it must hatch
    // (gaps preserve the knockout structure), never flood to a solid mass.
    if (s.darknessL >= DARK_BAND_FLOOR) {
      if (s.enclosesSiblingCount < 1) return null; // a 0-sibling dark rect is root-tonal's job
      return { role: 'dense-tonal', confidence: 0.85 };
    }
    // LIGHT enclosing rect: the original frame heuristic, UNCHANGED — needs ≥3
    // enclosed siblings to read as a wash-bordered card frame. No regression
    // for thin wash-bordered cards (darkness ≈ 0.08).
    if (s.enclosesSiblingCount < 3) return null;
    return { role: 'structural-frame', confidence: 0.85 };
  },
};

const RULE_dark_enclosing_body: Rule = {
  id: 'dark-enclosing-body',
  description:
    'ANY dark body (darkness ≥ 0.55) that ENCLOSES ≥1 sibling → dense-tonal, ' +
    'regardless of z-index / area-fraction / containment. Generalizes the dark ' +
    'branch of outer-frame-encloses-all (which only catches z-index-0 rects that ' +
    'fill ≥80% of their parent) to ANY dark enclosing shape. Without it, a dark ' +
    'enclosing body that is NOT z0+≥80% (e.g. a belt-buckle ellipse, z≠0, ~27% ' +
    'area, holding an inner ring + knockout "W") fires NO rule at all — outer-frame ' +
    'needs z0+≥80%, root-tonal-dense bails when it encloses, inner-content needs ' +
    'containedInZIndex — so it lands on the paper default and renders EMPTY (the ' +
    'replicaBelt bug, 2026-06-13). dense-tonal makes it hatch legibly with its ' +
    'knockout structure preserved (the render-side knockout fix keeps the inner ' +
    'siblings white). Object-AGNOSTIC: keys on signals (dark + encloses), never on ' +
    'shape identity — so it generalizes to any drawn dark form with content inside. ' +
    'Confidence 0.8 < outer-frame 0.85 so the specific frame rule still leads where ' +
    'it applies; scoring is accumulative so this only ADDS dense-tonal weight to ' +
    'bodies that should already hatch — it cannot flip a non-enclosing detail off ' +
    'solid-content (that path requires enclosesSiblingCount < 1).',
  evaluate: (s) => {
    if (s.darknessL < DARK_BAND_FLOOR) return null;
    if (s.enclosesSiblingCount < 1) return null;
    return { role: 'dense-tonal', confidence: 0.8 };
  },
};

// Cluster F+ — ENCLOSING TONAL WASH: a fill-only (stroke=none) region with
// darkness >= 0.10 that ENCLOSES line-art siblings (the shade-brush tone patch,
// and any uploaded fill-only wash that contains line art). The enclosure locks
// it out of RULE_root_tonal_* (need enclosesSiblingCount===0) and the inner-*
// rules (need containedInZIndex); at Light/Mid darkness the dark-body rules
// don't reach (>=0.55) and the wash-frame rule needs a stroke — so it fires
// NOTHING and falls to the `paper` default → no marks (the "tone fills ignore
// fillStyle" bug, I-2 violation: a 0.2-0.5 region must read as filled tonal).
// Band by darkness EXACTLY as RULE_root_tonal_* (09-LOCKED-MODEL I-2) so the
// fillStyle override (index.ts) then swaps mark grammar (I-1). Object-AGNOSTIC:
// keys on signals, never on tone-patch identity. Confidence 0.7 ties root-tonal;
// accumulative scoring means it only ADDS weight on regions that should be tonal
// and can never flip a stroke-only or contained region.
const RULE_enclosing_tonal_wash: Rule = {
  id: 'enclosing-tonal-wash',
  description:
    'Fill-only (stroke=none) region, darkness >= 0.10, encloses siblings → ' +
    'banded tonal role (sparse/mid/dense). Rescues the shade-brush tone patch ' +
    'and any enclosing fill-only wash that root-tonal locks out via encloses>0.',
  evaluate: (s) => {
    if (s.fill === null || s.fill === 'none' || s.fill === 'transparent') return null;
    if (s.stroke !== null && s.stroke !== 'none' && s.stroke !== 'transparent') return null;
    if (s.enclosesSiblingCount < 1) return null; // root-tonal handles non-enclosing
    if (s.containedInZIndex !== null) return null; // inner-* handles contained
    if (s.darknessL < 0.1) return null; // Paper band stays paper (I-2)
    const role =
      s.darknessL < 0.3 ? 'sparse-tonal' : s.darknessL < 0.55 ? 'mid-tonal' : 'dense-tonal';
    return { role, confidence: 0.7 };
  },
};

const RULE_outer_frame_bordered_wash: Rule = {
  id: 'outer-frame-bordered-wash',
  description:
    'Element with light fill (darkness < 0.15) + stroke + encloses siblings → wash-filled frame',
  evaluate: (s) => {
    if (s.darknessL > 0.15) return null;
    if (s.stroke === null) return null;
    if (s.enclosesSiblingCount < 1) return null;
    return { role: 'structural-frame', confidence: 0.75 };
  },
};

// Cluster C — CONTENT REGIONS (the actual tonal areas)
// Things INSIDE a frame, painted on top, that carry real darkness.

// DARK-BLOB RE-FIX guard (2026-06-13): solid-content's cross-hatch base solves
// to ~0.91 delivered coverage at the gap floor (a near-solid mass). That is the
// RIGHT register for a TINY pure-black detail (print block, trophy cup — no
// internal structure to lose), but a LARGE dark region rendered that dense
// reads as a structure-losing blob — and a large dark region that ITSELF
// encloses knockout siblings MUST keep its structure readable. So a contained
// dark region is only allowed to go `solid-content` when it is BOTH small
// (below this footprint fraction of its parent) AND encloses nothing; larger /
// enclosing dark regions route to `dense-tonal` (legible dense hatching, gaps
// preserve structure). This keeps small black details crisp while killing the
// blob on big dark panels/bands/inner bodies.
const SOLID_CONTENT_MAX_AREA_FRACTION = 0.25;

function darkInnerRoutesSolid(s: Signals): boolean {
  return s.enclosesSiblingCount < 1 && s.areaFractionOfParent < SOLID_CONTENT_MAX_AREA_FRACTION;
}

const RULE_inner_band_dark: Rule = {
  id: 'inner-band-dark',
  description:
    'Element contained in another + aspect ratio > 3 + dark fill → tonal band. ' +
    'Small non-enclosing band → solid-content; large / enclosing band → dense-tonal ' +
    '(legible hatching, no blob).',
  evaluate: (s) => {
    if (s.containedInZIndex === null) return null;
    if (s.aspectRatio < 3 && s.aspectRatio > 1 / 3) return null; // not band-shaped
    if (s.darknessL < 0.5) return null;
    return {
      role: darkInnerRoutesSolid(s) ? 'solid-content' : 'dense-tonal',
      confidence: 0.85,
    };
  },
};

const RULE_inner_content_mid_tonal: Rule = {
  id: 'inner-content-mid-tonal',
  description: 'Contained element with mid darkness (0.3–0.55) → mid-tonal',
  evaluate: (s) => {
    if (s.containedInZIndex === null) return null;
    if (s.darknessL < 0.3 || s.darknessL > 0.55) return null;
    return { role: 'mid-tonal', confidence: 0.7 };
  },
};

const RULE_inner_content_dense_tonal: Rule = {
  id: 'inner-content-dense-tonal',
  description: 'Contained element with darkness 0.55–0.85 → dense-tonal',
  evaluate: (s) => {
    if (s.containedInZIndex === null) return null;
    if (s.darknessL < 0.55 || s.darknessL > 0.85) return null;
    return { role: 'dense-tonal', confidence: 0.75 };
  },
};

const RULE_inner_content_solid: Rule = {
  id: 'inner-content-solid',
  description:
    'Contained element with very high darkness (>0.85): SMALL non-enclosing detail ' +
    '→ solid-content (crisp black mark); large / enclosing dark body → dense-tonal ' +
    '(legible dense hatching — knockout structure stays readable, never a blob).',
  evaluate: (s) => {
    if (s.containedInZIndex === null) return null;
    if (s.darknessL < 0.85) return null;
    // DARK-BLOB RE-FIX (2026-06-13): only tiny, non-enclosing pure-black details
    // stay solid-content. A large dark inner panel — especially one carrying
    // knockout siblings — must hatch, not flood to a solid mass.
    return {
      role: darkInnerRoutesSolid(s) ? 'solid-content' : 'dense-tonal',
      confidence: 0.8,
    };
  },
};

const RULE_inner_content_sparse_tonal: Rule = {
  id: 'inner-content-sparse-tonal',
  description: 'Contained element with light fill (0.05–0.3) → sparse-tonal',
  evaluate: (s) => {
    if (s.containedInZIndex === null) return null;
    if (s.darknessL < 0.05 || s.darknessL > 0.3) return null;
    return { role: 'sparse-tonal', confidence: 0.7 };
  },
};

// Cluster D — LINE DECORATIONS
// Paths/lines with stroke only, no fill = decorative not tonal.

const RULE_stroke_only_path: Rule = {
  id: 'stroke-only-path',
  description: 'Element with stroke but no fill → line-decoration',
  evaluate: (s) => {
    if (s.fill !== null && s.fill !== 'none' && s.fill !== 'transparent') return null;
    if (s.stroke === null) return null;
    if (s.tag === 'text') return null;
    return { role: 'line-decoration', confidence: 0.85 };
  },
};

const RULE_stripe_cluster_member: Rule = {
  id: 'stripe-cluster-member',
  description: 'Member of a sibling stripe cluster (e.g. ruling lines) → line-decoration',
  evaluate: (s) => {
    if (!s.isPartOfStripeCluster) return null;
    return { role: 'line-decoration', confidence: 0.9 };
  },
};

const RULE_dashed_annotation: Rule = {
  id: 'dashed-annotation',
  description: 'Element with stroke-dasharray → decorative-accent (annotation / stitch)',
  evaluate: (s) => {
    if (!s.hasDasharray) return null;
    return { role: 'decorative-accent', confidence: 0.85 };
  },
};

// Cluster E — ACCENTS (small, decorative)
// Tiny elements not contained in larger ones = standalone accents.

const RULE_tiny_decorative: Rule = {
  id: 'tiny-decorative',
  description: 'Very small element (areaFractionOfParent < 0.02) → decorative-accent',
  evaluate: (s) => {
    if (s.areaFractionOfParent > 0.02 && s.areaFractionOfParent !== 0) return null;
    if (s.area === 0) return null;
    // Only fire on standalone tiny things, not stripe members (stripes fire separately)
    if (s.isPartOfStripeCluster) return null;
    return { role: 'decorative-accent', confidence: 0.65 };
  },
};

// Cluster F — TOP-LEVEL TONAL (when nothing else fires)
// Elements at the root that carry darkness but aren't enclosing siblings.
//
// Confidence 0.55 → 0.7 (2026-06-11): 0.55 sat below the 0.7 provider
// threshold, so EVERY standalone root-level filled shape silently fell back
// to paper — zero shading (the recall hole, 24-research finding #1;
// reproduced by the gradient-sampler fixture). Golden-diff receipts:
// 140 regions across 67/197 audit shapes flip paper→dense-tonal, ALL with
// source darkness 1.00 (pure-black details that had been rendering as empty
// outlines — silent under-shading, not curated intent). Visual A/B
// 2026-06-11 confirmed: only true-black regions gained marks (trophy cup,
// print blocks); light regions unchanged — "sparing" preserved per I-2.

const RULE_root_tonal_sparse: Rule = {
  id: 'root-tonal-sparse',
  description: 'Root-level element with light darkness (0.05–0.3) → sparse-tonal',
  evaluate: (s) => {
    if (s.containedInZIndex !== null) return null; // not root
    if (s.enclosesSiblingCount > 0) return null; // not a frame
    if (s.darknessL < 0.05 || s.darknessL > 0.3) return null;
    return { role: 'sparse-tonal', confidence: 0.7 };
  },
};

const RULE_root_tonal_mid: Rule = {
  id: 'root-tonal-mid',
  description: 'Root-level element with mid darkness (0.3–0.55) → mid-tonal',
  evaluate: (s) => {
    if (s.containedInZIndex !== null) return null;
    if (s.enclosesSiblingCount > 0) return null;
    if (s.darknessL < 0.3 || s.darknessL > 0.55) return null;
    return { role: 'mid-tonal', confidence: 0.7 };
  },
};

const RULE_root_tonal_dense: Rule = {
  id: 'root-tonal-dense',
  description: 'Root-level element with darkness > 0.55 → dense-tonal',
  evaluate: (s) => {
    if (s.containedInZIndex !== null) return null;
    if (s.enclosesSiblingCount > 0) return null;
    if (s.darknessL < 0.55) return null;
    return { role: 'dense-tonal', confidence: 0.7 };
  },
};

// Cluster G — PAPER FALLBACKS
// Things that should explicitly stay paper-white.

const RULE_paper_near_zero: Rule = {
  id: 'paper-near-zero',
  description: 'Darkness ≈ 0 (BG / transparent / paper) → paper',
  evaluate: (s) => {
    if (s.darknessL > 0.03) return null;
    if (s.fill === null) return null; // covered by stroke-only rule instead
    return { role: 'paper', confidence: 0.9 };
  },
};

// ─── ALL RULES (ordered for clarity, not for precedence) ──────────────────

const ALL_RULES: Rule[] = [
  // A. text
  RULE_text_label,
  // B. frames
  RULE_outer_frame_encloses_all,
  RULE_dark_enclosing_body,
  RULE_outer_frame_bordered_wash,
  // C. content
  RULE_inner_band_dark,
  RULE_inner_content_mid_tonal,
  RULE_inner_content_dense_tonal,
  RULE_inner_content_solid,
  RULE_inner_content_sparse_tonal,
  // D. lines
  RULE_stroke_only_path,
  RULE_stripe_cluster_member,
  RULE_dashed_annotation,
  // E. accents
  RULE_tiny_decorative,
  // F. root tonal
  RULE_root_tonal_sparse,
  RULE_root_tonal_mid,
  RULE_root_tonal_dense,
  RULE_enclosing_tonal_wash, // rescue enclosing fill-only tonal washes (shade-brush tone)
  // G. paper fallback
  RULE_paper_near_zero,
];

// ─── PROVIDER IMPLEMENTATION ──────────────────────────────────────────────

/**
 * Evaluation strategy: ALL rules fire independently → confidence per role
 * accumulates → highest-scoring role wins (with the firings as provenance).
 *
 * This avoids "rule ordering matters" failure modes that hand-coded rule
 * engines drift into.
 */
export const ruleEngineProvider: ClassifierProvider = {
  name: 'rule-engine',
  classify(signals, _ctx) {
    const scores: Partial<Record<TonalRole, number>> = {};
    const firings: string[] = [];

    for (const rule of ALL_RULES) {
      const firing = rule.evaluate(signals, _ctx);
      if (firing === null) continue;
      firings.push(rule.id);
      scores[firing.role] = (scores[firing.role] ?? 0) + firing.confidence;
    }

    // Pick winning role — also track the runner-up sum so the trace can
    // expose how contested the decision was (QW-2: rawScore + margin).
    let bestRole: TonalRole = 'paper';
    let bestScore = 0;
    let secondBestScore = 0;
    for (const [role, score] of Object.entries(scores) as [TonalRole, number][]) {
      if (score > bestScore) {
        secondBestScore = bestScore;
        bestRole = role;
        bestScore = score;
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    }

    if (firings.length === 0) return null; // no opinion — delegate to next provider

    // Cap confidence at 1.0 — sums can exceed if multiple rules agree.
    // rawScore keeps the UNCAPPED sum so 1.0-cap ties stay distinguishable
    // in the decision log (QW-2; decisions unchanged).
    const confidence = Math.min(1, bestScore);

    return {
      role: bestRole,
      confidence,
      rawScore: bestScore,
      margin: bestScore - secondBestScore,
      firedRules: firings,
      classifiedBy: 'rules',
      signalsSnapshot: signals,
    };
  },
};

// Convenience export — the rule list, in case other modules want to inspect.
export const RULE_REGISTRY = ALL_RULES;
