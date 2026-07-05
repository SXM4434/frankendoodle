// ─── shapeSnapLog — the 'shape-snap' decision-log channel (Rock F3) ──────────
// shape-assist-spec.md §2.5/§8: every Snap/Straighten evaluation (accepted,
// refused, chip cycle, chip keep/revert) pushes a tuple to the ONE
// window-visible decision log so the training flywheel sees what the user drew,
// what we offered, and what they chose. Same load-order-safe defineProperty
// wrap pattern as shadeFillLog.ts / smart/conversionMap.ts: whichever wrap
// module loads last wraps the others — get() returns the union either way.
// Entries carry their own `entryType: 'shape-snap'`, so conversionMap's
// "tag untyped entries as 'shading' at read" pass leaves them untouched.
//
// PURITY: no React, no DOM beyond the guarded window hook, no wall-clock in the
// entries (deterministic battery diffs), no randomness.

import type { ShapeKind, SnapAction } from './draw/shapeFit.ts';

/** What happened. evaluate = the initial Snap/Straighten tap (accepted OR
 *  refused — both carry the full candidate table, the spec's training pair);
 *  cycle = the chip advanced to another ranked candidate; keep = the chip
 *  dismissed with the snapped choice standing (next stroke / Done / register
 *  flip); revert = the chip cycled back to 'original' (the drawn stroke
 *  restored). */
export type ShapeSnapOutcome = 'evaluate' | 'cycle' | 'keep' | 'revert';

/** One ranked candidate as recorded (the geometry isn't stored — kind + error
 *  is the training signal; the points live in the record itself). */
export interface ShapeSnapCandidateRow {
  kind: ShapeKind;
  normErr: number;
  score: number;
}

export interface ShapeSnapEntry {
  entryType: 'shape-snap';
  surface: 'shape-snap';
  action: SnapAction;
  outcome: ShapeSnapOutcome;
  /** Stable id of the targeted stroke (so a cycle/keep/revert links to its
   *  originating evaluate). */
  strokeId: string;
  /** Whether the evaluate accepted (best candidate cleared the threshold). */
  accepted: boolean;
  /** Refusal reason on a declined evaluate (null otherwise). */
  refusedReason: string | null;
  /** The full ranked candidate table at evaluate time ('original' included). */
  candidates: ShapeSnapCandidateRow[];
  /** The candidate kind the user is currently SITTING ON (after this act). On
   *  evaluate = the best (auto-applied) kind; on cycle = the new kind; on keep
   *  = the standing kind; on revert = 'original'. */
  chosen: ShapeKind;
  /** Score margin between the top two candidates at evaluate (ambiguity
   *  signal; 0 on refusals / single-candidate sets). */
  margin: number;
}

// FIFO cap — same guard as the sibling collectors.
const SHAPE_SNAP_LOG_MAX = 5000;
const shapeSnapLog: ShapeSnapEntry[] = [];

export function pushShapeSnapEntry(entry: ShapeSnapEntry): void {
  shapeSnapLog.push(entry);
  if (shapeSnapLog.length > SHAPE_SNAP_LOG_MAX) {
    shapeSnapLog.splice(0, shapeSnapLog.length - SHAPE_SNAP_LOG_MAX);
  }
}

/** Snapshot (copy — safe to mutate/serialize). */
export function getShapeSnapLog(): ShapeSnapEntry[] {
  return shapeSnapLog.slice();
}

export function clearShapeSnapLog(): void {
  shapeSnapLog.length = 0;
}

// ─── Unified window install (the conversionMap/shadeFill wrap pattern) ───────

type HostDecisionLog = {
  get: () => Array<Record<string, unknown>>;
  clear: () => void;
  setSurface?: (s: unknown) => void;
};

if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  let host = (w.__dd_decisionLog as HostDecisionLog | undefined) ?? null;
  const unified = {
    get: () => [...(host ? host.get() : []), ...getShapeSnapLog()],
    clear: () => {
      host?.clear();
      clearShapeSnapLog();
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
  w.__dd_shapeSnapLog = { get: getShapeSnapLog, clear: clearShapeSnapLog };
}
