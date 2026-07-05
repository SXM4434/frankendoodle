// Smart Pick — Phase C of the smart-system build plan (the demo-visible
// smart moment). See docs/design/smart-system-build-plan.md §2 row 06-13 +
// SD-2 (visible chip with the receipts) + SD-3 (fires ONCE at ingest).
//
// ONE job: at INGEST (upload-SVG staging · drawn-doodle Done), look at the
// input through the EXISTING Smart Hachure signal extractor
// (smartHachure/signals.ts — imported, never copied) and recommend initial
// pen values: svgStyle + fillStyle, plus texture / penTip / multiStroke /
// sketchingStyle ONLY where a rule is honestly confident. The host
// (DrawPanel) applies the pick through the normal preset-snap path — after
// that the user's dropdowns are sacred (I-1); smart pick never re-fires on
// style changes (SD-3 option a).
//
// HONESTY CONTRACT (the receipts ARE the demo):
//   - every rule reads REAL aggregate signals (region count, darkness
//     distribution, region sizes, linework density, stroke-width bins) and
//     states its claim in plain language — the chip prints that claim;
//   - axes with no honest rule stay SILENT (texture + sketchingStyle have
//     scoring slots but no rules today — better silent than invented);
//   - ambiguous inputs produce NO pick at all (logged as 'abstain') —
//     silence beats noise.
//
// RECEIPTS: every evaluation (pick / abstain / undo) appends to an in-memory
// FIFO exposed at `window.__dd_inputPickLog` — the same write-only
// side-channel idiom as smartHachure/index.ts's `window.__dd_decisionLog`
// (QW-1). Entries carry `surface: 'input-pick'`. Merging into the main
// decision log waits for the smartHachure lock-lift (build plan §3
// edit-points table) — index.ts is not touched here.
//
// DETERMINISM: pure rule table, no randomness, no wall-clock — the same
// input always produces the same pick.

import { extractAllSignals } from '../smartHachure/signals';
import { hashSvg } from '../smartHachure/overrideStore';
import type { Signals } from '../smartHachure/types';
import type { F3SvgStyle } from '../../state/F3SvgStyleContext';
import type {
  FillStyleStep,
  MultiStrokeStep,
  PenTipStep,
  SketchingStyleStep,
  TextureStep,
} from '../../state/F3RoughModifiersContext';

// ─── PUBLIC TYPES ───────────────────────────────────────────────────────────

export type SmartPickInput = 'draw' | 'upload-svg';

/** One recommended value per conversion picker. `svgStyle` is mandatory in a
 *  pick (no confident style → the whole pick abstains); the rest appear only
 *  when a rule cleared the secondary confidence floor. */
export type SmartPickAxes = {
  svgStyle: F3SvgStyle;
  fillStyle?: FillStyleStep;
  texture?: TextureStep;
  penTip?: PenTipStep;
  multiStroke?: MultiStrokeStep;
  sketchingStyle?: SketchingStyleStep;
};

/** Aggregate feature vector the rules read — derived from the per-region
 *  Signals map, serialized into every log entry so each pick/abstain carries
 *  the numbers it was decided on. */
export type SmartPickFeatures = {
  /** Renderable leaf regions (tag ≠ 'g'). */
  regionCount: number;
  /** Leaf regions with a real fill (not none/transparent, fill-opacity > 0). */
  filledCount: number;
  /** Leaf regions with a stroke and NO fill (pure linework). */
  strokedOnlyCount: number;
  /** <text> leaves — never style-driving, recorded for the receipts. */
  textCount: number;
  /** Mean darknessL (1 − OKLab L) over filled regions; 0 when none. */
  meanDarkness: number;
  /** Fraction of filled regions with darknessL ≥ 0.65. */
  darkFraction: number;
  /** Fraction of filled regions with darknessL ≤ 0.30. */
  lightFraction: number;
  /** Fraction of leaf regions smaller than 1.5% of the root area. */
  tinyFraction: number;
  /** Largest filled region's area as a fraction of the root area. */
  largestFillFraction: number;
  /** Total path length of all leaves ÷ root bbox DIAGONAL — linework
   *  density. Diagonal (not √area) so a single straight stroke ≈ 1.0 even
   *  in its own degenerate-thin tight bbox (drawn markup uses tight
   *  viewBoxes); loops and scribbles climb honestly from there. ≥6 = a
   *  dense scribble. */
  inkPerDiag: number;
  /** Among stroked leaves, fraction binned hairline/thin (< 1px). */
  thinStrokeFraction: number;
  /** Root area in user units (viewBox, else bbox union). */
  rootArea: number;
};

export type SmartPick = {
  axes: SmartPickAxes;
  /** Chip headline, e.g. "sketchy + hachure". */
  headline: string;
  /** Chip reason, e.g. "all linework, no fills" — the fired rules' claims. */
  reason: string;
  firedRules: string[];
  features: SmartPickFeatures;
};

export type SmartPickResult = {
  /** null = abstained (ambiguous signals — no chip, pen untouched). */
  pick: SmartPick | null;
  input: SmartPickInput;
  svgHash: string;
};

// ─── INPUT-PICK LOG (window.__dd_inputPickLog) ──────────────────────────────

export type InputPickLogEntry = {
  surface: 'input-pick';
  event: 'pick' | 'abstain' | 'undo' | 'overridden';
  input: SmartPickInput;
  svgHash: string;
  axes: SmartPickAxes | null;
  firedRules: string[];
  reason: string;
  features: SmartPickFeatures;
};

// FIFO cap — same guard idiom as smartHachure's DECISION_LOG_MAX; ingest
// events are rare (one per upload/Done) so this only protects marathon
// sessions.
const INPUT_PICK_LOG_MAX = 500;
const inputPickLog: InputPickLogEntry[] = [];

function pushInputPickLogEntry(entry: InputPickLogEntry): void {
  inputPickLog.push(entry);
  if (inputPickLog.length > INPUT_PICK_LOG_MAX) {
    inputPickLog.splice(0, inputPickLog.length - INPUT_PICK_LOG_MAX);
  }
}

/** Snapshot of the input-pick log (copy — safe to mutate/serialize). */
export function getInputPickLog(): InputPickLogEntry[] {
  return inputPickLog.slice();
}

/** Reset the collector (harness calls this between runs). */
export function clearInputPickLog(): void {
  inputPickLog.length = 0;
}

// Harness access from DevTools / playwright — same window-flag idiom as
// `__dd_decisionLog` in smartHachure/index.ts.
if (typeof window !== 'undefined') {
  (
    window as {
      __dd_inputPickLog?: { get: () => InputPickLogEntry[]; clear: () => void };
    }
  ).__dd_inputPickLog = { get: getInputPickLog, clear: clearInputPickLog };
}

/** Log that the user undid a pick (the chip's quiet undo affordance, SD-2).
 *  The correction is itself a labeled data point — "smart pick rejected on
 *  this input" — so it rides the same log. */
export function logSmartPickUndo(result: SmartPickResult): void {
  if (!result.pick) return;
  pushInputPickLogEntry({
    surface: 'input-pick',
    event: 'undo',
    input: result.input,
    svgHash: result.svgHash,
    axes: result.pick.axes,
    firedRules: result.pick.firedRules,
    reason: result.pick.reason,
    features: result.pick.features,
  });
}

/** Log that a pick stopped being the active truth WITHOUT an undo: the user
 *  manually moved a style/control after it (their choice supersedes the
 *  pick — the chip would be lying if it kept claiming the pen), or the
 *  picked input itself was removed. A softer correction than 'undo' (the
 *  user built ON TOP of the pick rather than rejecting it) — labeled
 *  separately so the two never get conflated in training data. */
export function logSmartPickOverridden(result: SmartPickResult): void {
  if (!result.pick) return;
  pushInputPickLogEntry({
    surface: 'input-pick',
    event: 'overridden',
    input: result.input,
    svgHash: result.svgHash,
    axes: result.pick.axes,
    firedRules: result.pick.firedRules,
    reason: result.pick.reason,
    features: result.pick.features,
  });
}

// ─── FEATURE EXTRACTION ─────────────────────────────────────────────────────

/** A leaf region is "tiny" below this fraction of the root area. */
const TINY_AREA_FRACTION = 0.015;
/** Filled region counts as "dark" at darknessL ≥ this. */
const DARK_THRESHOLD = 0.65;
/** Filled region counts as "light" at darknessL ≤ this. */
const LIGHT_THRESHOLD = 0.3;

function hasRealFill(s: Signals): boolean {
  return (
    s.fill !== null &&
    s.fill !== 'none' &&
    s.fill !== 'transparent' &&
    s.fillOpacity > 0
  );
}

function hasRealStroke(s: Signals): boolean {
  return s.strokeWidthBin !== 'none';
}

function computeFeatures(
  signalsByPath: Map<string, Signals>,
  rootArea: number,
  rootDiag: number,
): SmartPickFeatures {
  // Leaves only — <g> containers double-count their children's geometry.
  const leaves = [...signalsByPath.values()].filter((s) => s.tag !== 'g');

  const filled = leaves.filter(hasRealFill);
  const strokedOnly = leaves.filter((s) => !hasRealFill(s) && hasRealStroke(s));
  const stroked = leaves.filter(hasRealStroke);

  const darknesses = filled.map((s) => s.darknessL);
  const meanDarkness =
    darknesses.length === 0
      ? 0
      : darknesses.reduce((a, b) => a + b, 0) / darknesses.length;
  const darkFraction =
    filled.length === 0
      ? 0
      : darknesses.filter((d) => d >= DARK_THRESHOLD).length / filled.length;
  const lightFraction =
    filled.length === 0
      ? 0
      : darknesses.filter((d) => d <= LIGHT_THRESHOLD).length / filled.length;

  const tinyFraction =
    leaves.length === 0 || rootArea <= 0
      ? 0
      : leaves.filter((s) => s.area < TINY_AREA_FRACTION * rootArea).length /
        leaves.length;

  const largestFillFraction =
    rootArea <= 0
      ? 0
      : filled.reduce((max, s) => Math.max(max, s.area / rootArea), 0);

  const totalInk = leaves.reduce((sum, s) => sum + s.perimeter, 0);
  const inkPerDiag = rootDiag <= 0 ? 0 : totalInk / rootDiag;

  const thinStrokeFraction =
    stroked.length === 0
      ? 0
      : stroked.filter(
          (s) => s.strokeWidthBin === 'hairline' || s.strokeWidthBin === 'thin',
        ).length / stroked.length;

  return {
    regionCount: leaves.length,
    filledCount: filled.length,
    strokedOnlyCount: strokedOnly.length,
    textCount: leaves.filter((s) => s.tag === 'text').length,
    meanDarkness,
    darkFraction,
    lightFraction,
    tinyFraction,
    largestFillFraction,
    inkPerDiag,
    thinStrokeFraction,
    rootArea,
  };
}

// ─── THE RULE TABLE ─────────────────────────────────────────────────────────
//
// Each rule = one honest, plain-language claim about the input + the votes
// that claim justifies. Per-axis votes are summed across fired rules; an
// axis winner needs both a score floor AND a margin over the runner-up
// (mirrors the margin trace in smartHachure/classifier.ts). The chip prints
// the fired rules' claims verbatim — if a claim would read as a lie, the
// rule doesn't belong here.

type AxisVote =
  | { axis: 'svgStyle'; value: F3SvgStyle; weight: number }
  | { axis: 'fillStyle'; value: FillStyleStep; weight: number }
  | { axis: 'texture'; value: TextureStep; weight: number }
  | { axis: 'penTip'; value: PenTipStep; weight: number }
  | { axis: 'multiStroke'; value: MultiStrokeStep; weight: number }
  | { axis: 'sketchingStyle'; value: SketchingStyleStep; weight: number };

type PickRule = {
  id: string;
  /** The plain-language claim — printed on the chip when the rule fires. */
  reason: string;
  when: (f: SmartPickFeatures, input: SmartPickInput) => boolean;
  votes: AxisVote[];
};

const PICK_RULES: PickRule[] = [
  // ── Upload rules (source styling is a REAL property of the file) ────────
  {
    // A file that is entirely stroke-only paths is line art — the gentle
    // sketch register keeps it linework (fillStyle none = nothing invented).
    // Upload-only: drawn markup is stroke-only BY OUR OWN CONSTRUCTION
    // (strokesToObjectMarkup), so "no fills" would be an artifact there,
    // not a signal.
    id: 'upload-linework',
    reason: 'all linework, no fills',
    when: (f, input) =>
      input === 'upload-svg' && f.regionCount >= 1 && f.filledCount === 0 && f.strokedOnlyCount >= 1,
    votes: [
      { axis: 'svgStyle', value: 'sketchy', weight: 2 },
      { axis: 'fillStyle', value: 'none', weight: 1.5 },
    ],
  },
  {
    // Consistently sub-1px stroke widths in the source = a fineliner hand.
    // Upload-only for the same reason as above: our drawn commit layer
    // hardcodes stroke-width 3, so the bin is meaningless for draws.
    id: 'upload-thin-even-lines',
    reason: 'thin, even line weights',
    when: (f, input) =>
      input === 'upload-svg' && f.strokedOnlyCount >= 3 && f.thinStrokeFraction >= 0.7,
    votes: [{ axis: 'penTip', value: 'fineliner', weight: 1 }],
  },
  {
    // PREDOMINANTLY LINE ART with a few INCIDENTAL LIGHT fills — the upload twin
    // of the abstain gap `upload-linework` left open: that rule needs
    // filledCount===0, so a line drawing with one near-white fill (a shoe with a
    // pale sole, a laptop with a pale screen: meanDarkness ~0.08, darkFraction 0)
    // misses it and abstains. The fills are essentially white — rendering them as
    // linework (fillStyle none) loses nothing. EXCLUSIVE with the tonal rules
    // below by darkFraction===0 + meanDarkness≤0.3 (pokeball/vinyl sit at 0.36+,
    // so mid-tone-fills keeps them) and with light-washes by filledCount≤2 (that
    // rule needs ≥2 fills → it owns 2+, this owns the 1-fill line-art case).
    id: 'upload-light-linework',
    reason: 'line art with light, incidental fills',
    when: (f, input) =>
      input === 'upload-svg' &&
      f.strokedOnlyCount >= 2 &&
      f.strokedOnlyCount > f.filledCount &&
      f.filledCount >= 1 &&
      f.filledCount <= 2 &&
      f.darkFraction === 0 &&
      f.meanDarkness <= 0.3,
    votes: [
      { axis: 'svgStyle', value: 'sketchy', weight: 2 },
      { axis: 'fillStyle', value: 'none', weight: 1 },
    ],
  },

  // ── Fill-character rules (any input that actually has fills) ────────────
  {
    // One-to-three big near-black shapes read as confident silhouette work —
    // bold ink + solid fill preserves that weight instead of shredding it
    // into hatch marks. Mutually exclusive with dark-fill-field (≤3 vs ≥4).
    id: 'few-big-blacks',
    reason: 'a few big near-black shapes',
    when: (f) =>
      f.filledCount >= 1 &&
      f.filledCount <= 3 &&
      f.largestFillFraction >= 0.3 &&
      f.meanDarkness >= 0.75,
    votes: [
      { axis: 'svgStyle', value: 'bold-ink', weight: 2 },
      { axis: 'fillStyle', value: 'solid', weight: 1.5 },
    ],
  },
  {
    // A FEW MEDIUM-DARK fills (1-3 dark-majority regions, 0.55-0.75 mean) — the
    // tonal gap between few-big-blacks (needs near-black ≥0.75) and dark-fill-field
    // (needs ≥4 fills). A drawing like a Game Boy (3 fills, darkFraction 0.67,
    // meanDarkness 0.69) is clearly tonal but cleared neither → abstained. It's
    // the signature rough-handdrawn + hachure case (I-2: source darkness → marks).
    // EXCLUSIVE: meanDarkness<0.75 keeps it off few-big-blacks (no bold-ink/rough
    // tie), filledCount≤3 keeps it off dark-fill-field, meanDarkness≥0.55 keeps it
    // off mid-tone-fills (which caps at <0.55).
    id: 'few-mid-dark-fills',
    reason: 'a few medium-dark fills',
    when: (f) =>
      f.filledCount >= 1 &&
      f.filledCount <= 3 &&
      f.darkFraction >= 0.5 &&
      f.meanDarkness >= 0.55 &&
      f.meanDarkness < 0.75,
    votes: [
      { axis: 'svgStyle', value: 'rough-handdrawn', weight: 2 },
      { axis: 'fillStyle', value: 'hachure', weight: 1.5 },
    ],
  },
  {
    // Several dark fills = tonal work — the signature rough-handdrawn +
    // hachure pipeline exists exactly for translating dark fills into marks
    // (I-2: source darkness owns per-region identity).
    id: 'dark-fill-field',
    reason: 'dark fills ask for hatching',
    when: (f) => f.filledCount >= 4 && f.darkFraction >= 0.5,
    votes: [
      { axis: 'svgStyle', value: 'rough-handdrawn', weight: 2 },
      { axis: 'fillStyle', value: 'hachure', weight: 1.5 },
    ],
  },
  {
    // MANY dark fills that are also mostly tiny: single-direction hachure
    // muddies at small sizes — cross-hatch holds tone in small regions
    // (same observation behind techniqueMap's dense-tonal treatment). Outvotes
    // dark-fill-field's hachure (2.0 vs 1.5) when both fire.
    id: 'dense-dark-details',
    reason: 'dense small dark regions',
    when: (f) => f.filledCount >= 6 && f.darkFraction >= 0.6 && f.tinyFraction >= 0.5,
    votes: [
      { axis: 'svgStyle', value: 'rough-handdrawn', weight: 0.5 },
      { axis: 'fillStyle', value: 'cross-hatch', weight: 2 },
    ],
  },
  {
    // A field of many tiny, mostly-filled, not-dark marks IS pointillism —
    // stipple + dots renders it in its own grammar. darkFraction < 0.5
    // keeps this exclusive with dark-fill-field; the mostly-filled guard
    // keeps tiny stroke-only confetti honest (that case abstains).
    id: 'many-tiny-marks',
    reason: 'many tiny marks',
    when: (f) =>
      f.regionCount >= 12 &&
      f.tinyFraction >= 0.6 &&
      f.darkFraction < 0.5 &&
      f.filledCount >= 0.6 * f.regionCount,
    votes: [
      { axis: 'svgStyle', value: 'stipple', weight: 2 },
      { axis: 'fillStyle', value: 'dots', weight: 1.5 },
    ],
  },
  {
    // All fills light (≤0.35 mean, nothing dark): airy source — the gentle
    // sketchy register with sparse hachure keeps it light instead of
    // over-inking it. tinyFraction guard: this rule describes WASHES — a
    // cluster of tiny light marks is many-tiny-marks' territory, and letting
    // both fire would split the vote below the margin gate (exclusive by
    // construction beats abstaining on a clear stipple case).
    id: 'light-washes',
    reason: 'light, airy fills',
    when: (f) =>
      f.filledCount >= 2 &&
      f.meanDarkness <= 0.35 &&
      f.darkFraction === 0 &&
      f.tinyFraction < 0.6,
    votes: [
      { axis: 'svgStyle', value: 'sketchy', weight: 1.5 },
      { axis: 'fillStyle', value: 'hachure', weight: 1 },
    ],
  },
  {
    // Mid-grey fills (0.35–0.55) are the band hachure density maps most
    // directly (Murray-Davies midband, 21-research §4) — the signature
    // style is the honest default for them. Same tinyFraction guard as
    // light-washes: tonal-BAND rules apply to substantial regions; a field
    // of tiny mid-tone marks belongs to many-tiny-marks.
    id: 'mid-tone-fills',
    reason: 'mid-tone fills suit the signature hatch',
    when: (f) =>
      f.filledCount >= 2 &&
      f.meanDarkness > 0.35 &&
      f.meanDarkness < 0.55 &&
      f.darkFraction < 0.5 &&
      f.tinyFraction < 0.6,
    votes: [
      { axis: 'svgStyle', value: 'rough-handdrawn', weight: 1.5 },
      { axis: 'fillStyle', value: 'hachure', weight: 1.5 },
    ],
  },

  // ── Drawn-gesture rules (signals that survive our own markup format:
  //    stroke count + total ink length; darkness/width are artifacts) ──────
  {
    // 10+ strokes packing ≥6 root-diagonals of ink = a dense scribble.
    // It's already busy: gentle sketchy + a single pass per line keeps it
    // readable instead of doubling every line.
    id: 'draw-dense-scribble',
    reason: 'dense scribbly linework',
    when: (f, input) => input === 'draw' && f.regionCount >= 10 && f.inkPerDiag >= 6,
    votes: [
      { axis: 'svgStyle', value: 'sketchy', weight: 2 },
      { axis: 'fillStyle', value: 'none', weight: 1 },
      { axis: 'multiStroke', value: 'single', weight: 1 },
    ],
  },
  {
    // ≤4 strokes that are each LONG (≥1.2 root-diagonals of ink per stroke,
    // i.e. each stroke loops/curves well past a straight corner-to-corner
    // line) read as confident, committed lines — the bold-ink register
    // matches that hand. Short sparse gestures fire nothing and abstain (a
    // 2-stroke squiggle carries too little signal to move anyone's pen).
    id: 'draw-bold-strokes',
    reason: 'a few long, confident strokes',
    when: (f, input) =>
      input === 'draw' &&
      f.regionCount >= 1 &&
      f.regionCount <= 4 &&
      f.inkPerDiag / f.regionCount >= 1.2,
    votes: [{ axis: 'svgStyle', value: 'bold-ink', weight: 1.5 }],
  },
  {
    // ORDINARY HAND-DRAWN LINE ART — the common middle the two rules above
    // miss: a real doodle of several MODERATE strokes (a face = outline + short
    // eyes + smile, a house = box + roof + door). It's not a dense scribble
    // (<10 regions) and not all-long-confident-strokes (per-stroke ink < 1.2,
    // so bold-strokes passed it over), yet it's unmistakably a drawing — enough
    // total ink across ≥2 strokes to carry intent. This restores the
    // line-art→sketchy intent of `upload-linework` for DRAWN content (that rule
    // gates on filledCount===0, an artifact of our stroke-only commit format,
    // so it could never fire for draws — leaving these doodles to abstain).
    // EXCLUSIVE with both draw rules above (regionCount<10, per-stroke ink<1.2)
    // so the three never split the style vote. A genuinely trivial gesture (a
    // 1-stroke squiggle, inkPerDiag below the bar) still abstains — honest.
    id: 'draw-linework',
    reason: 'hand-drawn line art',
    when: (f, input) =>
      input === 'draw' &&
      f.regionCount >= 2 &&
      f.regionCount < 10 &&
      f.inkPerDiag >= 1.2 &&
      f.inkPerDiag / f.regionCount < 1.2,
    votes: [
      { axis: 'svgStyle', value: 'sketchy', weight: 2 },
      { axis: 'fillStyle', value: 'none', weight: 1 },
    ],
  },

  // texture + sketchingStyle: NO rules yet — no aggregate signal we extract
  // today honestly predicts paper texture or layer pacing. The axes keep
  // their scoring slots so a future rule plugs in without refactor, but
  // until one earns its claim they stay silent (no fake intelligence).
];

// ─── DECISION (per-axis tally → floor + margin gates) ──────────────────────

/** svgStyle is the headline pick — it needs a strong score AND clear margin. */
const STYLE_FLOOR = 1.5;
const STYLE_MARGIN = 0.75;
/** Secondary axes ride along only when their own rule(s) cleared this. */
const SECONDARY_FLOOR = 1.0;
const SECONDARY_MARGIN = 0.5;

type AxisName = AxisVote['axis'];
const AXES: AxisName[] = [
  'svgStyle',
  'fillStyle',
  'texture',
  'penTip',
  'multiStroke',
  'sketchingStyle',
];

function tallyAxis(
  fired: PickRule[],
  axis: AxisName,
): { value: string; score: number; margin: number } | null {
  const sums = new Map<string, number>();
  for (const rule of fired) {
    for (const vote of rule.votes) {
      if (vote.axis !== axis) continue;
      sums.set(vote.value, (sums.get(vote.value) ?? 0) + vote.weight);
    }
  }
  if (sums.size === 0) return null;
  const ranked = [...sums.entries()].sort((a, b) => b[1] - a[1]);
  const [value, score] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  return { value, score, margin: score - runnerUp };
}

/**
 * Evaluate the rule table over a LIVE (in-document) SVG root and log the
 * outcome. Returns the pick (null = abstained). The element must be attached
 * to the document — getBBox/getComputedStyle need layout.
 */
export function evaluateSmartPick(
  svgRoot: SVGSVGElement,
  input: SmartPickInput,
): SmartPickResult {
  const svgHash = hashSvg(svgRoot);
  const signalsByPath = extractAllSignals(svgRoot);
  const root = resolveRootSize(svgRoot, signalsByPath);
  const features = computeFeatures(signalsByPath, root.area, root.diag);

  const fired = PICK_RULES.filter((r) => r.when(features, input));

  // Headline gate: no confident svgStyle → the WHOLE pick abstains (a
  // fillStyle-only nudge with no style conviction is noise, not a pick).
  const style = tallyAxis(fired, 'svgStyle');
  if (!style || style.score < STYLE_FLOOR || style.margin < STYLE_MARGIN) {
    pushInputPickLogEntry({
      surface: 'input-pick',
      event: 'abstain',
      input,
      svgHash,
      axes: null,
      firedRules: fired.map((r) => r.id),
      reason:
        fired.length === 0
          ? 'no rule fired — signals carry too little to move the pen'
          : 'rules disagree — no clear winner, pen left alone',
      features,
    });
    return { pick: null, input, svgHash };
  }

  const axes: SmartPickAxes = { svgStyle: style.value as F3SvgStyle };
  for (const axis of AXES) {
    if (axis === 'svgStyle') continue;
    const t = tallyAxis(fired, axis);
    if (t && t.score >= SECONDARY_FLOOR && t.margin >= SECONDARY_MARGIN) {
      // Safe by construction: tally values come from typed AxisVote unions.
      (axes as Record<string, string>)[axis] = t.value;
    }
  }

  // Chip copy — the fired rules' claims, deduped, in rule-table order. Only
  // rules that actually contributed a winning-axis vote get printed (a rule
  // whose vote lost the tally didn't shape the pick).
  const winningRules = fired.filter((r) =>
    r.votes.some(
      (v) => (axes as Record<string, string | undefined>)[v.axis] === v.value,
    ),
  );
  const reason = [...new Set(winningRules.map((r) => r.reason))].join(', ');
  // Headline: "style + fillStyle" when a mark grammar was picked; a picked
  // fillStyle of 'none' isn't a grammar ("sketchy + none" reads broken) —
  // the no-fill claim already lives in the reason text.
  const headline =
    axes.fillStyle && axes.fillStyle !== 'none'
      ? `${axes.svgStyle} + ${axes.fillStyle}`
      : axes.svgStyle;

  const pick: SmartPick = {
    axes,
    headline,
    reason,
    firedRules: fired.map((r) => r.id),
    features,
  };
  pushInputPickLogEntry({
    surface: 'input-pick',
    event: 'pick',
    input,
    svgHash,
    axes,
    firedRules: pick.firedRules,
    reason,
    features,
  });
  return { pick, input, svgHash };
}

/**
 * Evaluate smart pick from raw SVG markup (the form DrawPanel holds at
 * ingest). Mounts the markup in an offscreen, layout-participating host so
 * getBBox/getTotalLength work, evaluates, and removes the host. Markup MUST
 * already be sanitized (prepareSvgUpload / strokesToObjectMarkup both are).
 * Never throws — ingest must never break the panel; failure = null.
 */
export function smartPickFromMarkup(
  markup: string,
  input: SmartPickInput,
): SmartPickResult | null {
  if (typeof document === 'undefined') return null;
  const host = document.createElement('div');
  // visibility:hidden / opacity:0 keep layout alive (getBBox returns zeros
  // under display:none); fixed + offscreen keeps it out of the page flow
  // and out of any screenshot.
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = '600px';
  host.style.height = '600px';
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  host.setAttribute('aria-hidden', 'true');
  host.innerHTML = markup;
  document.body.appendChild(host);
  try {
    const svg = host.querySelector('svg');
    if (!svg) return null;
    return evaluateSmartPick(svg, input);
  } catch {
    return null;
  } finally {
    document.body.removeChild(host);
  }
}

// Root size (area for the tiny-region threshold, diagonal for ink density):
// viewBox when present (same source renderSmartHachure uses for its root
// parent-bbox), else the root's own bbox, else the union of leaf bboxes.
function resolveRootSize(
  svgRoot: SVGSVGElement,
  signalsByPath: Map<string, Signals>,
): { area: number; diag: number } {
  const fromWH = (w: number, h: number) => ({ area: w * h, diag: Math.hypot(w, h) });
  const vb = svgRoot.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) return fromWH(vb.width, vb.height);
  try {
    const r = svgRoot.getBBox();
    if (r.width > 0 && r.height > 0) return fromWH(r.width, r.height);
  } catch {
    /* fall through to union */
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of signalsByPath.values()) {
    if (s.bbox.w <= 0 || s.bbox.h <= 0) continue;
    minX = Math.min(minX, s.bbox.x);
    minY = Math.min(minY, s.bbox.y);
    maxX = Math.max(maxX, s.bbox.x + s.bbox.w);
    maxY = Math.max(maxY, s.bbox.y + s.bbox.h);
  }
  return maxX > minX && maxY > minY ? fromWH(maxX - minX, maxY - minY) : { area: 0, diag: 0 };
}
