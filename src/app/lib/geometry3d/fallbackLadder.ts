// ─── fallbackLadder — the 2D→3D resolution ladder · SCAFFOLD ─────────────────
//
// One seam that decides HOW a doodle becomes 3D, in priority order, so every
// rung always answers (nothing ever renders a blank scene). When the AI-mesh
// hard path lands it sits at the TOP as the default for routed doodles; the
// local geometry engine (strokeTo3d.ts / convert.ts) is the middle ladder; an
// honest paper card is the floor that can never fail.
//
// This generalizes the routing-layer ladder in vision-router-spec §4/§5 (which
// resolves WHICH ENGINE) down to the GEOMETRY layer (which resolves WHAT GETS
// BUILT when an engine is unavailable). It is the "fallback-ladder seam" the
// Round-9 task names — a pure decision function + types, no rendering, no calls.
//
// SCAFFOLD STATUS (2026-06-13): the ladder is a pure resolver over already-
// known state (config probe + whether local strokes exist). It does NOT call
// hardPath (the caller does that and feeds the outcome back in), does NOT
// build geometry (convert.ts owns that), and does NOT touch the DB or any hot
// file. tsc-green stub.

import type { HardPathConfig, HardPathJob, HardPathMesh } from './hardPath.ts';
import type { GeometryModeSetting } from './strokeTo3d.ts';

// ─── The rungs ───────────────────────────────────────────────────────────────

/**
 * Resolution rungs, highest priority first:
 *
 *  - 'hard-mesh'    AI-mesh GLB (Tripo / TRELLIS) succeeded → load it. DEFAULT
 *                   for router-tagged tripo/trellis doodles once wired.
 *  - 'local-cached' A previously-built local geometry (OPFS/IndexedDB) for this
 *                   contentHash — instant, no recompute (the mode-flip cache).
 *  - 'local-build'  Build geometry now from the strokes via convert.ts (the
 *                   local engine: rod/extrude/inflate/solid). The honest "fast
 *                   path" floor that ALWAYS works when strokes exist.
 *  - 'paper-card'   No strokes (upload-only / generation failed and no local
 *                   geometry possible) → the honest 2D paper card in the 3D
 *                   scene. Never a blank scene, never a fake mesh.
 */
export type FallbackRung = 'hard-mesh' | 'local-cached' | 'local-build' | 'paper-card';

/** Inputs the ladder reasons over — all already-known, no I/O performed here. */
export interface LadderInput {
  /** Result of probeHardPathConfig() — null/!configured pushes past the top. */
  hardPathConfig: HardPathConfig;
  /** Whether the router (or the user) wants the hard path for THIS doodle.
   *  The local modes are always allowed; the hard path is opt-in per doodle. */
  hardPathRequested: boolean;
  /** A succeeded hard-path mesh for this doodle, if one is already in hand
   *  (cache hit or a completed job). Presence short-circuits to 'hard-mesh'. */
  hardMesh: HardPathMesh | null;
  /** An in-flight / failed hard-path job, if one exists (for UI + to know the
   *  hard path was attempted and lost — drop a rung). */
  hardJob: HardPathJob | null;
  /** A cached local geometry exists for this contentHash (mode-flip cache). */
  hasLocalCache: boolean;
  /** The doodle has drawn strokes we can convert locally. Uploads-without-
   *  trace have none → the local rungs are unavailable, floor is paper-card. */
  hasStrokes: boolean;
  /** The user's explicit geometry-mode pick (sacred per I-1). 'auto' lets the
   *  local engine route; an explicit mode is honored on the local rungs. */
  geometryMode: GeometryModeSetting;
}

/** What the ladder decided + why (the receipt the UI chip + training log read). */
export interface LadderDecision {
  rung: FallbackRung;
  /** Ladder rungs that were considered and skipped, with a one-line reason
   *  (so the honest UI can say "AI mesh cooling down — built locally"). */
  skipped: Array<{ rung: FallbackRung; reason: string }>;
  /** Honest one-liner for the UI chip. */
  note: string;
  /** True when the chosen rung is a degraded outcome the user should know
   *  about (hard path wanted but unavailable). */
  degraded: boolean;
}

// ─── THE resolver (pure) ─────────────────────────────────────────────────────

/**
 * Walk the ladder top-down and return the first rung that can answer. Pure
 * over LadderInput — no network, no geometry build, no DB. The caller acts on
 * `decision.rung`:
 *   hard-mesh    → load decision-supplied HardPathMesh.glb.url via useGLTF
 *   local-cached → read the cached BufferGeometry (OPFS) for this hash
 *   local-build  → convertStrokePool(strokes, { mode: geometryMode, ... })
 *   paper-card   → render the 2D paper card billboard in the scene
 */
export function resolveFallback(input: LadderInput): LadderDecision {
  const skipped: LadderDecision['skipped'] = [];

  // Rung 1 — hard mesh (the default once wired).
  if (input.hardPathRequested) {
    if (input.hardMesh) {
      return {
        rung: 'hard-mesh',
        skipped,
        note: 'AI mesh ready.',
        degraded: false,
      };
    }
    if (!input.hardPathConfig.configured) {
      skipped.push({
        rung: 'hard-mesh',
        reason: input.hardPathConfig.reason ?? 'hard path not configured',
      });
    } else if (input.hardJob && (input.hardJob.status === 'failed' || input.hardJob.status === 'cancelled')) {
      skipped.push({
        rung: 'hard-mesh',
        reason: input.hardJob.message ?? `generation ${input.hardJob.status}`,
      });
    } else {
      // Configured + requested + no mesh yet + no terminal failure = the job is
      // still running. The ladder still resolves a rung to show NOW (instant
      // local floor while the GLB generates — vision-router-spec §5 "instant
      // local 3D first"). We fall through to local rungs but mark non-degraded
      // (the mesh is coming, not lost).
      skipped.push({ rung: 'hard-mesh', reason: 'generating — showing local meanwhile' });
    }
  } else {
    skipped.push({ rung: 'hard-mesh', reason: 'not requested for this doodle' });
  }

  // Whether the top rung was lost (vs merely not-requested or still-coming).
  const hardLost =
    input.hardPathRequested &&
    !input.hardMesh &&
    (!input.hardPathConfig.configured ||
      (input.hardJob?.status === 'failed' || input.hardJob?.status === 'cancelled'));

  // Rung 2 — local cache (instant mode-flip).
  if (input.hasLocalCache) {
    return {
      rung: 'local-cached',
      skipped,
      note: hardLost ? 'AI mesh unavailable — using cached local 3D.' : 'Cached local 3D.',
      degraded: hardLost,
    };
  }
  skipped.push({ rung: 'local-cached', reason: 'no cached geometry for this doodle' });

  // Rung 3 — local build from strokes (the honest fast floor).
  if (input.hasStrokes) {
    return {
      rung: 'local-build',
      skipped,
      note: hardLost ? 'AI mesh unavailable — built locally from your strokes.' : 'Local 3D from your strokes.',
      degraded: hardLost,
    };
  }
  skipped.push({ rung: 'local-build', reason: 'no strokes to convert (upload without trace)' });

  // Rung 4 — paper card (can never fail).
  return {
    rung: 'paper-card',
    skipped,
    note: 'Showing your doodle as a paper card in 3D.',
    degraded: hardLost,
  };
}

/** Convenience: would the hard path be the chosen rung right now? (For the
 *  "✨ AI mesh available — generate?" upgrade chip in vision-router-spec §5.) */
export function hardPathIsDefault(config: HardPathConfig): boolean {
  return config.configured;
}
