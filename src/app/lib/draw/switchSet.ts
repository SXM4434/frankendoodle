// ─── switchSet — the shape-override switcher's data (UX rework §4.2) ──────────
// PURE + node-runnable like shapeFit.ts / shapeLibrary.ts: no React, no DOM, no
// wall-clock, no randomness. Deterministic in, deterministic out.
//
// buildSwitchSet merges the override's three sources, in this order:
//   1. RECOGNIZED alternatives — the recognizer's ranked candidates, EXCLUDING
//      'original' (it's appended last). These carry the FITTED geometry, which
//      honors the proportions the user actually drew.
//   2. LIBRARY shapes — the 12 shapeLibrary primitives (diamond, pentagon, …,
//      star-5), EXCLUDING any kind a recognized candidate already covers (no
//      "Star" twice). Library entries carry `candidate: null` — the host
//      generates the outline from the stroke's bbox at apply time (spec §4.5).
//   3. ORIGINAL always last — Sebs's first-class "back to my literal stroke".
//
// SEBS'S LAW (never-force-a-fit): auto-detect PROPOSES; the user DISPOSES. This
// switch set IS the dispose half — recognized OR any of the 12 library shapes OR
// the original, every entry one tap away. A snapped result the user didn't ask
// for is never the only reachable state. (Engine stays a pure proposer in
// shapeFit.ts; this module just lays out the override choices.)
//
// Spec ref: docs/FEATURES-UX-BUILD-SPEC.md §4.2 (the merge) + §2.1 (the types).

import { SHAPE_LIBRARY } from './shapeLibrary.ts';
import type { ShapeFitResult, ShapeCandidate } from './shapeFit.ts';

/** One entry in the override switcher — a single switch target the user can pick.
 *  Spec §2.1 (SwitchEntry). */
export interface SwitchEntry {
  /** Where this target came from. Recognized = a fitted recognizer candidate;
   *  library = one of the 12 shapeLibrary primitives; original = the drawn stroke. */
  source: 'recognized' | 'library' | 'original';
  /** shapeFit ShapeKind OR shapeLibrary kind OR 'original'. */
  kind: string;
  /** Human label for the switcher cell ("Circle", "Heart", "Original"). */
  label: string;
  /** For RECOGNIZED entries: the actual ShapeCandidate to apply (carries the
   *  fitted geometry). For LIBRARY entries: null — the host generates the outline
   *  from the stroke's bbox. For ORIGINAL: null — the host restores originalPoints. */
  candidate: ShapeCandidate | null;
}

/** The override receipt's state — the just-auto-detected (or selected) stroke's
 *  current standing choice plus its full switch set. Spec §2.1 (ShapeOverride). */
export interface ShapeOverride {
  /** The stroke the receipt/override currently targets. */
  strokeId: string;
  /** The kind the host applied on pen-up (best candidate, or 'original' if
   *  auto-detect refused). Drives the receipt label + the switcher highlight. */
  appliedKind: ShapeCandidate['kind'] | (string & {});
  /** The full, merged + ordered switch set (recognized · library · Original). */
  switchSet: SwitchEntry[];
  /** Index of appliedKind within switchSet (for the highlight + cheap cycle). */
  appliedIndex: number;
  /** The drawn stroke's pre-snap points, so 'Original' restores exactly. */
  originalPoints: [number, number, number][];
}

/** Semantic aliases between recognizer ShapeKinds and shapeLibrary kinds that
 *  denote the SAME shape under different keys. The spec's literal dedup keys on
 *  exact string equality, but the recognizer emits 'star' / 'arrow' while the
 *  library emits 'star-5' / 'arrow-block' — so an exact-string check alone would
 *  list a star (or arrow) twice, contradicting the spec's stated intent ("no
 *  'Star' twice", §4.2). This map folds those aliases together so a recognized
 *  star suppresses the library star-5 (and recognized arrow suppresses the
 *  library arrow-block). Recognizer kind → the library kind it subsumes. */
const RECOGNIZED_TO_LIBRARY_ALIAS: Record<string, string> = {
  star: 'star-5',
  arrow: 'arrow-block',
};

/**
 * Build the override's switch set (spec §4.2). PURE + node-testable.
 *
 * @param result        the recognizer's ShapeFitResult (its `candidates` are the
 *                      recognized-alternative source; 'original' is dropped here
 *                      and re-added last).
 * @param strokePoints  the drawn stroke's points — accepted for API parity with
 *                      the spec signature (the host uses them for the library
 *                      bbox map at apply time; the merge itself doesn't need
 *                      them, so they're not consumed here).
 * @returns recognized (ranked, no 'original') ∪ library (the 12, minus kinds a
 *          recognized candidate already covers) ∪ 'Original' last.
 */
export function buildSwitchSet(
  result: ShapeFitResult,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  strokePoints: [number, number, number][],
): SwitchEntry[] {
  const out: SwitchEntry[] = [];

  // 1. RECOGNIZED alternatives, ranked, EXCLUDING 'original' (added last).
  for (const c of result.candidates) {
    if (c.kind === 'original') continue;
    out.push({ source: 'recognized', kind: c.kind, label: c.label, candidate: c });
  }

  // Kinds already covered by a recognized candidate — exact keys PLUS their
  // library aliases (so a recognized 'star' suppresses the library 'star-5').
  const recognizedKinds = new Set<string>(out.map((e) => e.kind));
  for (const e of out) {
    const alias = RECOGNIZED_TO_LIBRARY_ALIAS[e.kind];
    if (alias) recognizedKinds.add(alias);
  }

  // 2. LIBRARY shapes (the 12), EXCLUDING kinds already recognized. candidate:
  //    null — the host generates the outline from the stroke's bbox (§4.5).
  for (const e of SHAPE_LIBRARY) {
    if (recognizedKinds.has(e.kind)) continue;
    out.push({ source: 'library', kind: e.kind, label: e.label, candidate: null });
  }

  // 3. ORIGINAL always last — the user's literal drawn stroke.
  out.push({ source: 'original', kind: 'original', label: 'Original', candidate: null });

  return out;
}
