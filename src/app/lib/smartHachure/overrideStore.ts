// Smart Hachure System — override store.
//
// Persists manual classifications keyed by (svgHash, regionPath).
// Manual overrides ALWAYS win over the classifier — Sebastian's authority is
// absolute, the algorithm is suggestion.
//
// Storage: localStorage in v1 (frontend-only, per decision lock 2026-06-03).
// Export to JSON for git commit; import from JSON when checking out.
// v2 (when backend opens): server-synced.
//
// Architecture: signals → classify ↤ OVERRIDE STORE ↦ select treatment → render
// See `docs/labs/hero/cells/F3-smart-hachure-system/06-architecture-technical-core.md`

import type { Override, OverrideStoreApi, Signals, TonalRole } from './types';

const LOCAL_STORAGE_KEY = 'smartHachure.overrides.v1';

// ─── INTERNAL SHAPE ───────────────────────────────────────────────────────

type OverrideMap = Record<string /* svgHash */, Record<string /* regionPath */, Override>>;

// ─── LOAD / SAVE ──────────────────────────────────────────────────────────

function load(): OverrideMap {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Light validation — drop entries with the wrong shape rather than throw
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as OverrideMap;
  } catch {
    return {};
  }
}

function save(map: OverrideMap): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage can throw (quota exceeded, private mode, etc.) — silent
    // failure is OK; classifier still works, overrides just don't persist
    // this session
  }
}

// ─── STORE IMPLEMENTATION ─────────────────────────────────────────────────

/**
 * Create a fresh override store instance.
 *
 * v1: backed by localStorage on construction. Cached in-memory for fast reads.
 * Writes update both the cache and localStorage immediately.
 *
 * v2 (future): backend-synced — same API, different storage layer.
 */
export function createOverrideStore(): OverrideStoreApi {
  let cache: OverrideMap = load();

  return {
    get(svgHash, regionPath) {
      return cache[svgHash]?.[regionPath] ?? null;
    },

    set(svgHash, regionPath, partial) {
      if (!cache[svgHash]) cache[svgHash] = {};
      const fullOverride: Override = {
        ...partial,
        setAt: new Date().toISOString(),
        setBy: 'manual',
      };
      cache[svgHash][regionPath] = fullOverride;
      save(cache);
    },

    clear(svgHash, regionPath) {
      if (cache[svgHash]) {
        delete cache[svgHash][regionPath];
        if (Object.keys(cache[svgHash]).length === 0) {
          delete cache[svgHash];
        }
        save(cache);
      }
    },

    exportToJson() {
      // Pretty-printed for git readability
      return JSON.stringify(cache, null, 2);
    },

    importFromJson(json) {
      try {
        const parsed = JSON.parse(json);
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('Invalid override JSON');
        }
        cache = parsed as OverrideMap;
        save(cache);
      } catch (err) {
        // Bubble up so caller knows the import failed; don't silently swap state
        throw new Error(
          `Failed to import override store: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

// ─── SVG HASH HELPER ──────────────────────────────────────────────────────

/**
 * Compute a stable hash of an SVG's outerHTML for use as the override-store key.
 * Same SVG content → same hash. Different content → different hash.
 *
 * Implementation: djb2 hash — fast, deterministic, non-cryptographic.
 * Sufficient for our use case (collision risk negligible across a portfolio's
 * ~120 SVG shapes).
 */
export function hashSvg(svgRoot: SVGSVGElement): string {
  const source = svgRoot.outerHTML;
  let hash = 5381;
  for (let i = 0; i < source.length; i++) {
    // djb2: hash = ((hash << 5) + hash) + char (i.e. hash * 33 + char)
    hash = (hash * 33) ^ source.charCodeAt(i);
  }
  // Convert to unsigned + base36 for compactness in the JSON key
  return (hash >>> 0).toString(36);
}

// ─── BULK HELPERS — for chrome UI later ───────────────────────────────────

/** Convenience: read all overrides for one SVG (e.g. to show a "regions
 *  tagged" indicator in the chrome). */
export function getOverridesForSvg(
  store: OverrideStoreApi,
  svgHash: string,
): Record<string, Override> {
  // O(n) where n = total overrides; acceptable since we expect << 1000 in v1
  // and the call site is chrome (not the hot render loop).
  const out: Record<string, Override> = {};
  const json = store.exportToJson();
  try {
    const all = JSON.parse(json) as OverrideMap;
    Object.assign(out, all[svgHash] ?? {});
  } catch {
    // empty
  }
  return out;
}

/** Convenience: clear all overrides for one SVG (e.g. "reset this asset"). */
export function clearOverridesForSvg(store: OverrideStoreApi, svgHash: string): void {
  const overrides = getOverridesForSvg(store, svgHash);
  for (const regionPath of Object.keys(overrides)) {
    store.clear(svgHash, regionPath);
  }
}

// ─── BACKWARDS-COMPAT EXPORTS ─────────────────────────────────────────────
// Re-export for typed callers that don't want to import from types.ts directly.
export type { Override, OverrideStoreApi, Signals, TonalRole };
