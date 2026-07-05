// Friendly handle generation + normalization (personal-space onboarding).
//
// A "handle" is the warm, lowercase, hyphenated label a visitor is shown as
// theirs — e.g. "doodled-finch". The onboarding flow (OnboardingFlow.tsx) lets
// them KEEP the generated one, REROLL for another, or TYPE-YOUR-OWN.
//
// Generation follows the haikunator adjective+noun precedent (warm critters +
// desk objects). The pools mirror the inline ownerHandle() in ObjectCard.tsx so
// a session's generated handle is the SAME word pair everywhere — this module
// is the shared home; ObjectCard can adopt it post-makeathon (kept separate now
// to stay out of another stream's lane).
//
// COLLISION HANDLING: 16×16 = 256 base combos. The DB unique index
// (profiles_handle_unique_ci, migration 0001) is the authority. The client
// resolves a taken handle by rerolling (reseed) or appending a short numeric
// token (haikunator pattern) — see suggestHandle() + appendToken().
//
// DETERMINISM: handleFromId(id) is deterministic (same id → same pair) so a
// person who never opens onboarding still has a stable identity everywhere.
// Reroll is INTENTIONALLY non-deterministic (a fresh random pair each press).

// ─── Word pools (warm + lowercase) ──────────────────────────────────────────
// Mirror ObjectCard.tsx HANDLE_ADJ / HANDLE_NOUN so generated handles match.
// Warm, intentional vocabulary (cozy desk · small critters · doodle things),
// lowercase single words. ~50×50 = 2500 combos so handles read DISTINCT, not
// "name-7" (Sebs 2026-06-18: a number suffix is lazy). MUST stay byte-identical
// to ObjectCard.tsx's HANDLE_ADJ/HANDLE_NOUN (same order → same hash index).
const ADJ = [
  'quiet', 'warm', 'little', 'sleepy', 'sunny', 'gentle', 'humble', 'wobbly',
  'inky', 'folded', 'scuffed', 'crooked', 'doodled', 'smudged', 'loose', 'tidy',
  'cozy', 'dusty', 'faded', 'soft', 'rumpled', 'hazy', 'mellow', 'drowsy',
  'plucky', 'nimble', 'tiny', 'rounded', 'speckled', 'dappled', 'woolly', 'fuzzy',
  'dainty', 'lanky', 'bashful', 'chipper', 'snug', 'breezy', 'earthy', 'pale',
  'bright', 'brisk', 'calm', 'curly', 'knotted', 'patched', 'stitched', 'amber',
  'briny', 'sandy',
] as const;
const NOUN = [
  'heron', 'wren', 'finch', 'moth', 'snail', 'otter', 'pebble', 'acorn',
  'maple', 'clover', 'pencil', 'eraser', 'paperclip', 'crayon', 'mug', 'stamp',
  'sparrow', 'robin', 'swallow', 'magpie', 'beetle', 'ladybug', 'cricket', 'minnow',
  'tadpole', 'newt', 'hedgehog', 'dormouse', 'vole', 'marmot', 'teapot', 'kettle',
  'thimble', 'button', 'ribbon', 'marble', 'domino', 'inkwell', 'quill', 'notebook',
  'bookmark', 'postcard', 'lantern', 'walnut', 'chestnut', 'pinecone', 'mushroom', 'fern',
  'moss', 'reed',
] as const;

// FNV-1a 32-bit over (value + salt) — same hash family as lib/deskNames.ts +
// ObjectCard. Distinct salts give independent streams so the two words don't
// move together.
function streamHash(value: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  const s = value + ':' + String(salt);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic warm handle for an id (session/auth uuid), e.g. "quiet-heron".
 *  Same id → same handle, on every client, every reload. */
export function handleFromId(id: string): string {
  const adj = ADJ[streamHash(id, 1) % ADJ.length];
  const noun = NOUN[streamHash(id, 2) % NOUN.length];
  // A clean two-word handle — NO number suffix (Sebs 2026-06-18: lazy). The
  // ~2500-combo pool keeps deterministic auto-names distinct at makeathon scale;
  // GUARANTEED uniqueness (re-roll a DIFFERENT combo if taken) is enforced at
  // CLAIM time by claim_handle's collision check (migration 0002).
  return `${adj}-${noun}`;
}

/** A fresh RANDOM warm handle (for the Reroll button — intentionally not
 *  deterministic). Uses Math.random; collisions are resolved against the DB. */
export function randomHandle(): string {
  const adj = ADJ[Math.floor(Math.random() * ADJ.length)];
  const noun = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${adj}-${noun}`;
}

/** Append a short numeric token to disambiguate a taken handle (haikunator
 *  pattern), e.g. "doodled-finch" → "doodled-finch-7". Token 1..999. */
export function appendToken(handle: string): string {
  const base = stripToken(handle);
  const token = Math.floor(Math.random() * 999) + 1;
  // Keep within the 32-char DB cap.
  return `${base}-${token}`.slice(0, 32).replace(/-+$/, '');
}

/** Strip a trailing numeric token if present ("doodled-finch-7" → "doodled-finch"). */
export function stripToken(handle: string): string {
  return handle.replace(/-\d{1,3}$/, '');
}

// ─── Normalization + validation (Type-your-own) ─────────────────────────────
// The DB enforces /^[a-z0-9]+(-[a-z0-9]+)*$/ + length 3..32 (profiles_handle_shape).
// The client normalizes first so a typed "Doodled Finch!" becomes "doodled-finch"
// instead of bouncing off the DB.

/** Normalize free-typed input to the canonical handle shape: lowercase,
 *  spaces/underscores → hyphens, drop disallowed chars, collapse + trim
 *  hyphens. Result may still be invalid (too short) — pass to isValidHandle. */
export function normalizeHandle(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')        // spaces / underscores → hyphen
    .replace(/[^a-z0-9-]/g, '')     // drop anything not a-z 0-9 hyphen
    .replace(/-+/g, '-')            // collapse runs of hyphens
    .replace(/^-+|-+$/g, '')        // trim leading/trailing hyphens
    .slice(0, 32);
}

/** True when a handle matches the DB constraint exactly (call after normalize). */
export function isValidHandle(handle: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(handle) && handle.length >= 3 && handle.length <= 32;
}

/** Human-readable reason a normalized handle is invalid, or null when valid.
 *  Drives the inline error under the Type-your-own field. */
export function handleError(handle: string): string | null {
  if (handle.length === 0) return 'Pick a handle';
  if (handle.length < 3) return 'A little longer (3+ characters)';
  if (handle.length > 32) return 'A little shorter (32 max)';
  if (!isValidHandle(handle)) return 'Letters, numbers and hyphens only';
  return null;
}

/** Display form: handles are shown with an @ prefix in the UI. */
export function displayHandle(handle: string): string {
  return handle.startsWith('@') ? handle : `@${handle}`;
}
