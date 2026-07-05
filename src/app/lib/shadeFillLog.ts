// ─── shadeFillLog — the 'shade-fill' decision-log channel (rock F2) ──────────
// region-fill-spec §7: "every fill act pushes to window.__dd_decisionLog
// (surface-tagged per G-10)". This module is the storage for those entries and
// the third source behind the ONE window-visible decision log:
//
//   - smartHachure/index.ts stores shading entries + installs its collector;
//   - smart/conversionMap.ts wraps the window face with conversion receipts;
//   - THIS module wraps whatever face is current with shade-fill entries.
//
// Same load-order-safe defineProperty pattern conversionMap uses (its install
// is `configurable: true` by design): whichever of the two wrap modules loads
// last wraps the other — get() returns the union either way. Entries here
// carry their own `entryType`, so conversionMap's "tag untyped entries as
// 'shading' at read time" pass leaves them untouched.
//
// PURITY: no React, no DOM beyond the guarded window hook, no wall-clock in
// the entries (deterministic battery diffs), no randomness.

/** How the act was made. The spec's tap|highlight|lasso plus 'scrub' (a
 *  press-hold gap scrub that committed on release) — richer training data,
 *  same channel. */
export type ShadeFillGesture = 'tap' | 'highlight' | 'scrub' | 'lasso';

/** 'lasso-after-miss' = a lasso commit immediately following an extractor
 *  miss — the spec's explicit extractor-miss label (§7 row 1). */
export type ShadeFillOutcome = 'committed' | 'cancelled' | 'miss' | 'lasso-after-miss';

export interface ShadeFillEntry {
  entryType: 'shade-fill';
  surface: 'shade-fill';
  tool: 'fill' | 'lasso';
  gesture: ShadeFillGesture;
  /** Band committed (0 = the erase act — lift to paper). */
  band: number;
  erase: boolean;
  /** Gap-tolerance multiplier in effect at the act (ladder 0.5×–3×). */
  gapTol: number;
  /** Containment depth of the committed region (null on miss/lasso). */
  regionDepth: number | null;
  /** Region area in world units² (null on miss/lasso). */
  regionAreaWorld: number | null;
  outcome: ShadeFillOutcome;
  /** strokeTo3d REGION_EXTRACTOR_VERSION the act ran under. */
  extractorVersion: number;
  /** How many regions the extractor saw at act time (miss context). */
  regionCount: number;
}

// FIFO cap — same guard as the sibling collectors.
const SHADE_FILL_LOG_MAX = 5000;
const shadeFillLog: ShadeFillEntry[] = [];

export function pushShadeFillEntry(entry: ShadeFillEntry): void {
  shadeFillLog.push(entry);
  if (shadeFillLog.length > SHADE_FILL_LOG_MAX) {
    shadeFillLog.splice(0, shadeFillLog.length - SHADE_FILL_LOG_MAX);
  }
}

/** Snapshot (copy — safe to mutate/serialize). */
export function getShadeFillLog(): ShadeFillEntry[] {
  return shadeFillLog.slice();
}

export function clearShadeFillLog(): void {
  shadeFillLog.length = 0;
}

// ─── Unified window install (the conversionMap wrap pattern, verbatim) ──────

type HostDecisionLog = {
  get: () => Array<Record<string, unknown>>;
  clear: () => void;
  setSurface?: (s: unknown) => void;
};

if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  let host = (w.__dd_decisionLog as HostDecisionLog | undefined) ?? null;
  const unified = {
    get: () => [...(host ? host.get() : []), ...getShadeFillLog()],
    clear: () => {
      host?.clear();
      clearShadeFillLog();
    },
    setSurface: (s: unknown) => host?.setSurface?.(s),
  };
  try {
    Object.defineProperty(w, '__dd_decisionLog', {
      configurable: true,
      get: () => unified,
      // A later collector install assigns here — it becomes the host behind
      // this face instead of replacing it (the conversionMap contract).
      set: (v: HostDecisionLog) => {
        host = v;
      },
    });
  } catch {
    w.__dd_decisionLog = unified;
  }
  // Direct channel for batteries (filtered view, the __dd_conversionLog idiom).
  w.__dd_shadeFillLog = { get: getShadeFillLog, clear: clearShadeFillLog };
}
