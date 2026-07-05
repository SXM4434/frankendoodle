// ─── visionProvider — the VISION/LLM LAYER (smart-system layer #3) · SCAFFOLD ─
//
// THE 3-LAYER ARCHITECTURE (Sebs ratified 2026-06-13, canonical — see
// project_desk_doodles_smart_layer_built + docs/knowledge/05-the-interconnection-
// graph.md "Honest status"). The smart system is an ADDITIVE stack, escalating
// cheap→expensive, NONE replaces another:
//
//   1. SMART LAYER  = the RULE ENGINE (classifier.ts `ruleEngineProvider`).
//      Deterministic, traceable FLOOR. Cheap, instant, every decision
//      explainable. Stays the floor + safety net forever.
//   2. ML LAYER     = a learned model trained on our own dataset — an additive
//      provider that AUGMENTS the rule engine where patterns beat hand rules.
//   3. VISION/LLM LAYER = THIS FILE. The REASONING layer for the HARD cases the
//      other two can't crack: look at the source (esp. complex uploads) and
//      reason about what it IS and which transformation / 3D path fits it.
//      EXPENSIVE — used SPARINGLY (at publish/upload, NOT per-region at render).
//
// WHAT THIS LAYER DOES (its honest job — narrow on purpose):
//   • The HARD cases. The rule engine + ML give a confident answer on most
//     inputs; this layer is consulted ONLY when they don't (low confidence /
//     contested / a recognizable subject the geometry heuristics can't honor).
//   • ROUTING. The headline use: upload → which 3D path (local rod/extrude/
//     inflate vs the AI-mesh hard path) + which treatment. This is the
//     vision-router (docs/design/vision-router-spec.md): one PNG + stroke stats
//     → strict-JSON RouteResult. It is the UPSTREAM engine picker that
//     hardPath.ts consumes.
//   • It mostly ABSTAINS. As a classifier provider it returns `null` ("no
//     opinion, delegate") on every region except the hard ones — so it slots
//     into classifier.ts's provider chain WITHOUT ever out-voting the cheap
//     layers on the common case.
//
// SCAFFOLD STATUS (2026-06-13, Round 9 earmark — the first attempt died on an
// API socket error; this is the redo): interface + an INERT stub that ABSTAINS
// by default, behind a flag, configured:false until a server Edge Function
// lands. NO live LLM calls. NO DB writes. NO key reads client-side. This module
// imports nothing from a hot file; it ships the contract the Edge Function will
// fill. The chain-wiring into classifier.ts / smartHachure/index.ts is HOT and
// is FLAGGED for the pending queue — NOT done here.
//
// SECURITY MODEL (locked, handoff 06-10 + vision-router-spec §3): the
// ANTHROPIC_API_KEY NEVER ships client-side. The model call runs server-side in
// the Supabase Edge Function `vision-router` (same family as `mesh-generate`,
// the hard-path sibling). FAL_KEY is already in .env.local WITHOUT a VITE_
// prefix; ANTHROPIC_API_KEY follows the identical path
// (`supabase secrets set ANTHROPIC_API_KEY=… ROUTER_MODEL=claude-haiku-4-5`).
// This module is the CLIENT-SIDE contract + a server-call shim that, until the
// Edge Function exists, returns 'not-configured' and abstains instead of
// calling anything.
//
// MODEL CHOICE (decided in vision-router-spec.md §1, cited): claude-haiku-4-5
// primary (vision + structured output, ~$0.003/call, fastest Claude),
// claude-sonnet-4-6 as the one-env-var quality fallback. Anthropic-first per
// repo standard; cost doesn't argue for a 2nd SDK/secret at sub-cent/call. The
// model id lives server-side in the ROUTER_MODEL secret — NOT in this file.

import type {
  Signals,
  Classification,
  ClassificationContext,
  ClassifierProvider,
} from '../smartHachure/types.ts';

// ─── Config probe — is the vision layer actually usable right now? ────────────

/**
 * Reflects whether the server-side vision path is wired AND the caller opted
 * in. Until the `vision-router` Edge Function + ANTHROPIC_API_KEY secret exist
 * (Sebs-side, ~Day 14) AND the flag is set, this is always not-configured and
 * every caller MUST treat the layer as absent (abstain / drop to the rule+ML
 * floor + local 3D). NEVER reads a key client-side.
 */
export interface VisionConfig {
  configured: boolean;
  /** Why it's not usable (for the honest UI chip + the decision log). */
  reason: string | null;
}

/** The runtime flag that gates the layer. OFF by default — even once the Edge
 *  Function lands, the layer stays inert until this is explicitly set, so the
 *  scaffold can ship without behavior change. Read at probe time only; never a
 *  secret (no key, just an enable bit). */
export const VISION_LAYER_FLAG = 'VITE_VISION_LAYER_ENABLED';

/** Endpoint the vision call will POST to when wired (mirrors hardPath's
 *  HARD_PATH_FUNCTION_NAME). Resolved from VITE_SUPABASE_URL at call time; the
 *  function itself is NOT deployed yet. */
export const VISION_FUNCTION_NAME = 'vision-router';

/**
 * Read the enable flag WITHOUT throwing in non-Vite contexts (tests, node).
 * `import.meta.env` is the Vite surface; guard it so the module is importable
 * anywhere. Returns false unless the flag is the string "1" / "true".
 */
function visionFlagEnabled(): boolean {
  try {
    // import.meta.env is statically replaced by Vite; the optional chain keeps
    // this safe under tsc/node where it may be undefined.
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const raw = env?.[VISION_LAYER_FLAG];
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

/**
 * Probe config WITHOUT making a network call or reading a secret. The vision
 * layer is "configured" only once the `vision-router` Edge Function is deployed
 * AND the flag is set. Scaffold default: NOT configured (the flag is unset).
 *
 * Wiring note (for the queue, NOT done here): once the Edge Function lands,
 * leave this reading the flag — flipping VITE_VISION_LAYER_ENABLED=1 in the
 * deploy env is the single switch that turns the layer on. Optionally add a
 * boot-time health ping to `/functions/v1/vision-router` so a deployed-but-
 * unreachable function still reports not-configured. Today it is pure +
 * side-effect-free so the rule+ML floor always answers.
 */
export function probeVisionConfig(): VisionConfig {
  if (!visionFlagEnabled()) {
    return {
      configured: false,
      reason:
        `Vision/LLM layer not enabled (${VISION_LAYER_FLAG} unset) — using rule + ML floor. ` +
        'Enable lands with the vision-router Edge Function (Sebs-side, ~Day 14).',
    };
  }
  // Flag is on but the Edge Function isn't proven reachable in the scaffold —
  // stay not-configured until the wiring round adds the health check. This
  // branch exists so flipping the flag early can't accidentally route a live
  // call into a non-existent function.
  return {
    configured: false,
    reason:
      'Vision/LLM layer flag is set but the vision-router Edge Function is not wired yet — staying on the rule + ML floor.',
  };
}

// ─── Routing — the layer's PRIMARY job (upstream of the 3D path) ─────────────
//
// This is the vision-router contract (vision-router-spec.md §2). One PNG + stroke
// stats → a strict-JSON route decision that hardPath.ts consumes. It runs ONCE
// per publish/upload, async, never per-region. RouteResult mirrors the spec's
// schema verbatim so the Edge Function's json_schema and this type stay in lock-
// step (additionalProperties:false server-side).

/** 3D engines the router can recommend. rod/extrude/inflate = local (instant,
 *  free); tripo/trellis = the AI-mesh hard path (hardPath.ts). The client maps
 *  unavailable engines to the nearest shipped one (e.g. inflate→extrude until
 *  Inflate-Lite lands) — see vision-router-spec §2. */
export type RouteEngine = 'rod' | 'extrude' | 'inflate' | 'tripo' | 'trellis';

/** Source complexity — how much the AI path actually buys over local geometry.
 *  "simple" = local clearly sufficient · "medium" = local works but AI adds real
 *  value · "complex" = only AI generation does it justice. */
export type RouteComplexity = 'simple' | 'medium' | 'complex';

/** Strict-JSON result of one vision-router call (vision-router-spec §2 schema). */
export interface RouteResult {
  complexity: RouteComplexity;
  /** 2–6 lowercase words a person would say ("dog", "coffee mug",
   *  "abstract scribble"). Never identifies a real person. */
  subjectGuess: string;
  recommendedEngine: RouteEngine;
  /** NSFW/safety screen rides this same call (vision-router-spec §2, nearly
   *  free). ok=false only on flagrant content; reason is null when ok. */
  moderation: { ok: boolean; reason: string | null };
}

/** Stroke statistics the caller passes alongside the rasterized PNG. Cheap to
 *  compute client-side; anchors the stats→engine mapping in the prompt. */
export interface StrokeStats {
  strokeCount: number;
  closedCount: number;
  openCount: number;
  bbox: { w: number; h: number };
}

/** What the caller hands the router. The PNG is rasterized client-side (512px
 *  long edge — no API accepts SVG natively, vision-router-spec §5). The
 *  contentHash (lib/contentHash.ts) is THE cache key: same doodle → cached
 *  route → free. */
export interface RouteRequest {
  contentHash: string;
  /** PNG, base64 (no data: prefix), 512px long edge — or a public URL. */
  image: { kind: 'base64-png'; data: string } | { kind: 'url'; url: string };
  strokeStats: StrokeStats;
  /** Optional correlation tag for the decision log. */
  renderSurface?: string | null;
}

/** Where a route came from — for the receipt/decision log + the UI chip. */
export type RouteSource = 'cache' | 'llm' | 'abstain';

export type RouteResponse =
  | { ok: true; route: RouteResult; source: RouteSource }
  | { ok: false; error: string; source: 'abstain' };

export interface RouteMeshOptions {
  /** AbortSignal so a slow publish can cancel the router call. */
  signal?: AbortSignal;
}

/**
 * Ask the vision layer to route a doodle to a 3D path. STUB: makes NO live call
 * (the Edge Function + ANTHROPIC_API_KEY are Sebs-side at point-of-need) — it
 * ABSTAINS, returning `{ ok: false, source: 'abstain' }` so the caller drops to
 * the local heuristic rung (vision-router-spec §4, rung 2) and renders local 3D.
 *
 * The real (post-wiring) body: check the route cache by contentHash → if hit,
 * return `source:'cache'`; else POST {request} to the `vision-router` Edge
 * Function (which holds ANTHROPIC_API_KEY + ROUTER_MODEL, calls the Anthropic
 * Messages API with structured outputs, validates against the json_schema,
 * upserts route_cache) and return `source:'llm'`. Wrapped client-side in
 * Cockatiel (retry + timeout + consecutiveBreaker) so a provider outage opens
 * the circuit and abstains instantly.
 */
export async function routeDoodle(
  request: RouteRequest,
  _options: RouteMeshOptions = {},
): Promise<RouteResponse> {
  const config = probeVisionConfig();
  if (!config.configured) {
    // ABSTAIN — the locked default. The caller uses the local heuristic
    // (routeHeuristic, vision-router-spec §4 rung 2) and renders local 3D.
    return {
      ok: false,
      error: config.reason ?? 'vision layer not configured',
      source: 'abstain',
    };
  }
  // UNREACHABLE in the scaffold (configured is always false). The wired body
  // lives behind the Edge Function — see vision-router-spec §3 for the server
  // flow. Throwing (rather than calling) guarantees no live LLM call ships in
  // the scaffold even if the flag is forced on.
  throw new Error('visionProvider.routeDoodle: wired path not implemented (scaffold).');
}

// ─── Classifier-provider adapter — the chain-wiring SHAPE (abstains) ─────────
//
// This is how the vision layer slots into classifier.ts's provider chain. It
// matches the ClassifierProvider contract EXACTLY (types.ts) so the chain can
// become [ruleEngineProvider] → [ruleEngineProvider, learnedProvider,
// visionClassifierProvider] with no refactor. Per the chain semantics, a
// provider returns `null` to mean "no opinion, delegate" — and that is what the
// vision layer does on EVERY region in the scaffold: it ABSTAINS.
//
// WHY ABSTAIN-by-default is correct here (not a placeholder cop-out):
//   • The vision layer is the EXPENSIVE, SPARINGLY-USED layer. Speaking on a
//     region requires a server round-trip to an LLM. Per-region render-time
//     calls would blow the I-10 ~16ms/frame budget AND cost real money. So even
//     when WIRED, this provider must abstain on the overwhelming majority of
//     regions and only speak on the genuinely hard ones — and a region-level
//     classify() call has no access to a rasterized image or a server channel
//     anyway. The real vision work happens out-of-band (routeDoodle, at publish/
//     upload), and its results get FED BACK into the pipeline as cached signals/
//     overrides — not synchronously inside classify().
//   • Returning null guarantees the vision layer NEVER out-votes the cheap rule/
//     ML floor on the common case — it can only ever rescue a region the floor
//     already failed on, and only once the async route result is cached.
//
// SCAFFOLD: always returns null. The wired version would consult a per-region
// cache populated by the async routeDoodle pass (keyed by contentHash +
// regionPath) and return a Classification ONLY for hard regions with a cached
// vision verdict; otherwise still null.

/**
 * Look up a cached vision verdict for one region. STUB: always null (the cache
 * is empty in the scaffold; nothing populates it without the Edge Function).
 * When wired, reads the per-region store the async routeDoodle pass fills.
 */
function lookupCachedVisionVerdict(
  _signals: Signals,
  _ctx: ClassificationContext,
): Classification | null {
  // No vision results exist client-side until the Edge Function is wired AND a
  // routeDoodle pass has run + cached. Scaffold: nothing to return.
  return null;
}

/**
 * The vision layer as a classifier-chain provider. ABSTAINS (returns null) on
 * every region in the scaffold. Inert until configured: even when the flag is
 * on, it only ever returns a cached vision verdict for a hard region — never a
 * live call inside classify() (that would break the per-frame budget + cost
 * model). Matches ClassifierProvider verbatim so chain-wiring is a one-line
 * array push — see the FLAG below.
 */
export const visionClassifierProvider: ClassifierProvider = {
  name: 'vision-llm',
  classify(signals, ctx) {
    if (!probeVisionConfig().configured) return null; // inert: abstain
    // Wired path: return a cached hard-case verdict if one exists, else abstain.
    return lookupCachedVisionVerdict(signals, ctx);
  },
};

// ─── CHAIN-WIRING FLAG (HOT files — do NOT edit here; pending queue) ──────────
//
// To make this layer live, the provider chain must be extended in TWO hot files
// (READ-ONLY in this scaffold pass — they are under the BUILD-WHEN-RUNNABLE /
// watchdog protocol; wire only when those files are COLD):
//
//   1. src/app/lib/smartHachure/index.ts — where renderSmartHachure builds the
//      provider array passed to classify(). Today it is effectively
//      `[ruleEngineProvider]`. The vision provider appends AFTER the rule engine
//      (and after the future learnedProvider): the order encodes the
//      cheap→expensive escalation — rules first, ML next, vision last, each only
//      consulted when the prior abstained/under-thresholded.
//
//        providers: [ruleEngineProvider, /* learnedProvider, */ visionClassifierProvider]
//
//   2. classifier.ts is the CONSUMER of the chain (classify() walks it) — it
//      needs NO change; it already walks whatever array index.ts hands it. The
//      Classification.classifiedBy union already enumerates 'cached-llm', so a
//      wired vision verdict tags itself there. (READ-ONLY here regardless —
//      classifier.ts is explicitly hands-off this pass.)
//
// The ROUTING use (routeDoodle) wires separately at the publish/upload site
// (publish.ts / the Done flow) — ONE async call per publish, never in the render
// path. That site is also hot; it is the same pending-queue item.
//
// Until both are wired AND the Edge Function lands AND the flag is set, this
// module is fully inert: probeVisionConfig() → not-configured, routeDoodle() →
// abstain, visionClassifierProvider.classify() → null.
