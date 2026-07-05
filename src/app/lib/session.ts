// Anonymous session identity for the public canvas.
//
// Per M9 (makeathon-plan): anonymous publish + shared feed, NO auth UI.
// A random UUID minted on first call and persisted in localStorage is the
// only identity — it becomes the `session_id` column on published doodles.
//
// Live now — used by the /desk flow (DeskPage / DrawSurface) and read by
// publish.ts to stamp the session_id on every published doodle.

const SESSION_KEY = 'dd.session.id';

// In-memory fallback so the function still returns a stable id within the
// page session when localStorage is unavailable (private mode / Make quirks).
let memorySessionId: string | null = null;

/**
 * Returns this browser's anonymous session id, minting + persisting one on
 * first call.
 */
export function getSessionId(): string {
  if (memorySessionId) return memorySessionId;
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) {
      memorySessionId = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, fresh);
    memorySessionId = fresh;
    return fresh;
  } catch {
    // localStorage blocked — fall back to a per-page-load id.
    memorySessionId = memorySessionId ?? crypto.randomUUID();
    return memorySessionId;
  }
}
