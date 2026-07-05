// M9 public canvas — typed wrappers over the shared Supabase client.
//
// Per M9 (docs/memory/project_desk_doodles_makeathon.md): anonymous publish
// (session UUID from lib/session.ts, no auth UI) + shared global feed. The
// backing tables are created by supabase/schema.sql (v1, flat feed) then grown
// by supabase/schema-v2-desks.sql (multi-desk) — paste BOTH into the Supabase
// SQL Editor BEFORE wiring these into a page.
//
// v1/v2 TRUST MODEL: RLS lets anon read everything; the desk-aware insert path
// goes through the publish_to_open_desk() RPC (server-side cap + atomic spawn,
// no client race). Mutation scoping ("only delete your own") is still
// honor-system — enforced HERE via .eq('session_id', getSessionId()), not
// server-side. See the policy comments in the SQL files for why + the
// post-makeathon upgrade path (anonymous sign-ins → real owner_id policies).
//
// Wired into the desk flow at /desk (DeskPage) as of 2026-06-11 — schema.sql
// has been run, so publishDoodle / listDoodles / updateDoodlePosition /
// deleteDoodle / subscribeDoodles all hit the live table.
//
// MULTI-DESK GRACEFUL FALLBACK: the desk-aware helpers (getOpenDesk / listDesks)
// catch the "desks table does not exist" error (user hasn't pasted
// schema-v2-desks.sql yet) and return null / [] so callers fall back to flat
// single-desk behavior — the app NEVER crashes on a half-migrated DB.

import { supabase } from './supabase';
import { getSessionId } from './session';
import { contentHash } from './contentHash';
import { deskName } from './deskNames';

/** One row of public.doodles (see supabase/schema.sql + schema-v2-desks.sql). */
export interface DoodleRow {
  id: string;
  session_id: string;
  svg: string;
  content_hash: string;
  x: number;
  y: number;
  rotation: number;
  created_at: string;
  // v2 rich-record fields (null on un-migrated rows / pre-v2 DBs):
  desk_id?: string | null;
  name?: string | null;
  why?: string | null;
  render_config?: Record<string, unknown> | null;
  // personal-space fields (migration 0003 owner_id + a shelf/is_public flag;
  // null/undefined on pre-migration rows):
  owner_id?: string | null;
  is_public?: boolean | null;
}

/** One row of public.desks (see supabase/schema-v2-desks.sql). */
export interface DeskRow {
  id: string;
  desk_index: number;
  name: string;
  object_cap: number;
  object_count: number;
  is_open: boolean;
  preview_svg: string | null;
  owner_id: string | null;
  created_at: string;
}

/** Input for publishDoodle. Placement + rich-record fields are all optional. */
export interface PublishDoodleInput {
  svg: string;
  x?: number;
  y?: number;
  rotation?: number;
  /** Desk to publish onto. Omit/null → the current open public desk (RPC picks). */
  deskId?: string | null;
  /** Object name — doubles as the ML label (object-model doc §3). */
  name?: string | null;
  /** One-line "why you made it". */
  why?: string | null;
  /** Per-object style snapshot (Smart Hachure style + modifier values). */
  renderConfig?: Record<string, unknown> | null;
}

/** publishDoodle result: the inserted row + the desk it actually landed on. */
export interface PublishDoodleResult {
  row: DoodleRow;
  /** The desk the doodle landed on (possibly a freshly-spawned one). May be
   *  null on a pre-v2 DB (RPC absent → flat insert fallback, no desk concept). */
  desk: DeskRow | null;
}

const TABLE = 'doodles';
const DESKS_TABLE = 'desks';

// ─── CONNECTION TIMEOUT (offline/hang fix — demo-killer) ────────────────────
// supabase-js does NOT impose a request deadline: a slow or unreachable
// backend (cold project, throttled network, dead realtime socket) leaves the
// awaited promise PENDING FOREVER — it neither resolves nor rejects. Every
// load path below (getOpenDesk / listDesks / listDoodles / listDoodlesForDesk)
// is awaited by a page that shows "Connecting…" / "Loading…" until it settles,
// so a hung request strands the UI on that spinner with no error and no retry —
// exactly the live-demo failure mode. withTimeout() races the real promise
// against a deadline and REJECTS with a typed TimeoutError if the deadline wins,
// converting an infinite hang into the same honest error path a real rejection
// takes (the page's .catch → offline state + Retry). The underlying request is
// left to settle on its own (we can't cancel the in-flight fetch from here);
// the timeout only frees the UI from waiting on it.

/** Default deadline for a single load request. ~8s is generous enough that a
 *  merely-slow-but-alive backend still succeeds, tight enough that a true hang
 *  surfaces the offline state well inside a demo's patience window. */
export const LOAD_TIMEOUT_MS = 8000;

/** Error thrown when a load request misses its deadline. A distinct class so
 *  callers / tests can tell "timed out" from "the server said no". */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/** Race a promise against a deadline. Resolves/rejects with the original
 *  promise if it settles first; rejects with TimeoutError if the deadline wins.
 *  The timer is always cleared so it can't leak or fire late. */
export function withTimeout<T>(
  promise: PromiseLike<T>,
  label: string,
  ms: number = LOAD_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new TimeoutError(label, ms));
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// Postgres error code for "relation does not exist" — the signal that the user
// has not pasted schema-v2-desks.sql yet. PostgREST surfaces it as 42P01.
const UNDEFINED_TABLE = '42P01';
// PostgREST "could not find the function" — RPC absent (pre-v2 DB).
const UNDEFINED_FUNCTION = 'PGRST202';

/** True when an error means "the v2 desks table / RPC isn't there yet". */
function isMissingV2(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === UNDEFINED_TABLE || err.code === UNDEFINED_FUNCTION) return true;
  const m = (err.message ?? '').toLowerCase();
  return (
    m.includes('does not exist') ||
    m.includes('schema cache') ||
    m.includes('could not find')
  );
}

/**
 * M9 + v2: publish a doodle to the shared public canvas.
 *
 * Stamps the row with this browser's anonymous session id (lib/session.ts)
 * and the SHA-1 content hash of the SVG (lib/contentHash.ts — same key the
 * conversion caches use).
 *
 * v2 path: calls the publish_to_open_desk() RPC so the cap-check + auto-spawn
 * happen SERVER-SIDE in one transaction (no client race). The RPC ignores the
 * passed deskId for which desk to write — it always writes to the current open
 * public desk — and the client supplies the deterministic name for the NEXT
 * desk (lib/deskNames.ts) so DB + client agree if this publish fills the desk.
 * Returns the inserted row AND the (possibly new) desk it landed on.
 *
 * GRACEFUL FALLBACK: on a pre-v2 DB (RPC absent), falls back to the flat v1
 * insert and returns { row, desk: null } so the app still works.
 */
export async function publishDoodle(
  input: PublishDoodleInput,
): Promise<PublishDoodleResult> {
  const {
    svg,
    x = 0,
    y = 0,
    rotation = 0,
    name = null,
    why = null,
    renderConfig = null,
  } = input;
  const content_hash = await contentHash(svg);
  const session_id = getSessionId();

  // The name the NEXT public desk should get if THIS publish fills the current
  // one. We can't know the next index without a round-trip, so peek the open
  // desk; if that's unavailable (pre-v2), the RPC path is moot anyway. The
  // peeked row is REUSED below to resolve the landed desk, so publish costs
  // one desks read total, not two.
  // The peek is best-effort: a slow/timed-out peek must NOT abort a publish the
  // RPC could still complete. On any peek failure (timeout, pre-v2, network) we
  // publish without a precomputed next-desk name — the RPC still writes the row;
  // only the post-state desk resolution below loses its fast path (it falls back
  // to the explicit desks read, or null on a pre-v2 DB).
  let nextDeskName: string | null = null;
  let openDesk: DeskRow | null = null;
  try {
    openDesk = await getOpenDesk();
  } catch {
    openDesk = null;
  }
  if (openDesk) nextDeskName = deskName(openDesk.desk_index + 1);

  const { data, error } = await supabase.rpc('publish_to_open_desk', {
    p_session_id: session_id,
    p_svg: svg,
    p_content_hash: content_hash,
    p_x: x,
    p_y: y,
    p_rot: rotation,
    p_name: name,
    p_why: why,
    p_render_config: renderConfig,
    p_next_desk_name: nextDeskName,
  });

  if (error) {
    // Pre-v2 DB (RPC not created yet) → fall back to the flat v1 insert.
    if (isMissingV2(error)) {
      const { data: flat, error: flatErr } = await supabase
        .from(TABLE)
        .insert({ session_id, svg, content_hash, x, y, rotation })
        .select()
        .single();
      if (flatErr) throw new Error(`publishDoodle failed: ${flatErr.message}`);
      return { row: flat as DoodleRow, desk: null };
    }
    throw new Error(`publishDoodle failed: ${error.message}`);
  }

  const row = data as DoodleRow;
  // Resolve the desk the row landed on WITHOUT a second desks round-trip: in
  // the common case the row lands on the open desk peeked above, and the RPC's
  // post-state is fully determined from that peek (object_count + 1; the RPC
  // closes the desk at cap) — the same snapshot the old re-read fetched. Only
  // when the peek missed (null on a fresh DB → genesis spawn, or the open desk
  // advanced between peek and RPC) do we actually fetch the landed desk
  // (best-effort — null if the lookup fails).
  let desk: DeskRow | null = null;
  if (row.desk_id) {
    if (openDesk && openDesk.id === row.desk_id) {
      const object_count = openDesk.object_count + 1;
      desk = {
        ...openDesk,
        object_count,
        is_open: object_count >= openDesk.object_cap ? false : openDesk.is_open,
      };
    } else {
      const { data: deskData } = await supabase
        .from(DESKS_TABLE)
        .select('*')
        .eq('id', row.desk_id)
        .single();
      desk = (deskData as DeskRow) ?? null;
    }
  }
  return { row, desk };
}

/**
 * v2: the current open PUBLIC desk row, or null.
 *
 * Returns the open public desk with the highest index (the "live" one). The
 * genesis desk is seeded by schema-v2-desks.sql and the RPC opens the next one
 * on the publish that fills a desk, so this is a pure read — if it returns null
 * on a migrated DB the next publishDoodle's RPC will open the genesis desk.
 *
 * GRACEFUL FALLBACK: on a pre-v2 DB (desks table absent) returns null so
 * callers fall back to flat single-desk behavior.
 */
export async function getOpenDesk(): Promise<DeskRow | null> {
  // withTimeout: a hung backend must reject (→ flat-fallback / offline path),
  // never leave the awaiting page stuck on its spinner forever.
  const { data, error } = await withTimeout(
    supabase
      .from(DESKS_TABLE)
      .select('*')
      .eq('is_open', true)
      .is('owner_id', null)
      .order('desk_index', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'getOpenDesk',
  );
  if (error) {
    if (isMissingV2(error)) return null; // pre-v2 DB → flat fallback
    throw new Error(`getOpenDesk failed: ${error.message}`);
  }
  return (data as DeskRow) ?? null;
}

/**
 * v2: all PUBLIC desks, newest-first (for the gallery).
 *
 * GRACEFUL FALLBACK: on a pre-v2 DB returns [] so the gallery renders empty
 * rather than crashing.
 */
export async function listDesks(limit = 100): Promise<DeskRow[]> {
  const { data, error } = await withTimeout(
    supabase
      .from(DESKS_TABLE)
      .select('*')
      .is('owner_id', null)
      .order('created_at', { ascending: false })
      .limit(limit),
    'listDesks',
  );
  if (error) {
    if (isMissingV2(error)) return []; // pre-v2 DB → empty gallery
    throw new Error(`listDesks failed: ${error.message}`);
  }
  return (data ?? []) as DeskRow[];
}

/**
 * M9: read the shared feed, newest first.
 *
 * Public by design — RLS grants anon SELECT on everything. Default limit 200
 * keeps the first desk-canvas paint cheap; pagination is post-MVP (S13
 * multi-desk pagination).
 */
export async function listDoodles(limit = 200): Promise<DoodleRow[]> {
  const { data, error } = await withTimeout(
    supabase
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit),
    'listDoodles',
  );
  if (error) throw new Error(`listDoodles failed: ${error.message}`);
  return (data ?? []) as DoodleRow[];
}

/**
 * v2: read one desk's doodles, newest-first. Like listDoodles but filtered by
 * desk_id — the gallery + per-desk view use this so each desk only pays the
 * rough.js render cost for its own (capped) object set.
 */
export async function listDoodlesForDesk(
  deskId: string,
  limit = 200,
): Promise<DoodleRow[]> {
  const { data, error } = await withTimeout(
    supabase
      .from(TABLE)
      .select('*')
      .eq('desk_id', deskId)
      .order('created_at', { ascending: false })
      .limit(limit),
    'listDoodlesForDesk',
  );
  if (error) throw new Error(`listDoodlesForDesk failed: ${error.message}`);
  return (data ?? []) as DoodleRow[];
}

/**
 * DRAWER (ratified 2026-06-11 board #26-27 — "My doodles" passive cross-desk
 * index): read THIS SESSION's doodles across ALL desks, newest-first.
 *
 * ADDITIVE 2026-06-12: no session-filtered cross-desk read existed before
 * (listDoodles is the whole shared feed; listDoodlesForDesk is one desk, any
 * maker). Same honor-system session scope as the mutation helpers — the
 * .eq('session_id', …) where-clause, v1 trust model.
 */
export async function listMyDoodles(limit = 100): Promise<DoodleRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('session_id', getSessionId())
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listMyDoodles failed: ${error.message}`);
  return (data ?? []) as DoodleRow[];
}

/**
 * M9: persist a dragged doodle's new position/rotation. Session-scoped via
 * the same v1 honor-system where-clause as deleteDoodle — only this
 * session's rows actually move; a 0-row match resolves false silently.
 */
export async function updateDoodlePosition(
  id: string,
  x: number,
  y: number,
  rotation: number,
): Promise<boolean> {
  // v2+ DROPS the open anon UPDATE policy (security), so a direct .update()
  // silently no-ops. Route through the session-scoped SECURITY DEFINER RPC
  // (move_my_doodle), which enforces session_id server-side. Fall back to the
  // direct update on a pre-v3 DB where the RPC isn't installed yet.
  const { data, error } = await supabase.rpc('move_my_doodle', {
    p_id: id,
    p_session: getSessionId(),
    p_x: x,
    p_y: y,
    p_rotation: rotation,
  });
  if (error) {
    if (isMissingV2(error)) {
      const fb = await supabase
        .from(TABLE)
        .update({ x, y, rotation })
        .eq('id', id)
        .eq('session_id', getSessionId())
        .select('id');
      return (fb.data ?? []).length > 0;
    }
    throw new Error(`updateDoodlePosition failed: ${error.message}`);
  }
  return data === true;
}

/**
 * M9: delete one of THIS session's doodles.
 *
 * The session scope lives in the .eq('session_id', …) where-clause — the v1
 * honor-system trust model (see supabase/schema.sql). Resolves true if a row
 * was deleted, false if nothing matched (wrong id, or a row this session
 * doesn't own — the where-clause makes that a silent 0-row delete).
 */
export async function deleteDoodle(id: string): Promise<boolean> {
  // Same as updateDoodlePosition: v2+ drops the open anon DELETE policy, so go
  // through the session-scoped delete_my_doodle RPC (also decrements the desk
  // object_count). Fall back to a direct delete on a pre-v3 DB.
  const { data, error } = await supabase.rpc('delete_my_doodle', {
    p_id: id,
    p_session: getSessionId(),
  });
  if (error) {
    if (isMissingV2(error)) {
      const fb = await supabase
        .from(TABLE)
        .delete()
        .eq('id', id)
        .eq('session_id', getSessionId())
        .select('id');
      return (fb.data ?? []).length > 0;
    }
    throw new Error(`deleteDoodle failed: ${error.message}`);
  }
  return data === true;
}

/**
 * Edit-mode save: rename / re-why one of your own doodles. Routes through the
 * session-scoped update_my_doodle_meta RPC (schema-v3). Resolves true if a row
 * matched. No-op fallback returns false on a pre-v3 DB (the RPC isn't there).
 */
export async function updateDoodleMeta(
  id: string,
  name: string | null,
  why: string | null,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('update_my_doodle_meta', {
    p_id: id,
    p_session: getSessionId(),
    p_name: name,
    p_why: why,
  });
  if (error) {
    if (isMissingV2(error)) return false;
    throw new Error(`updateDoodleMeta failed: ${error.message}`);
  }
  return data === true;
}

/**
 * v4: persist an Edit-mode restyle — write a new render_config onto one of
 * your own doodles. Routes through the session-scoped update_my_doodle_config
 * SECURITY DEFINER RPC (supabase/schema-v4-config.sql — same pattern + grants
 * as the v3 RPCs). Resolves true if a row matched.
 *
 * GRACEFUL NO-RPC FALLBACK: on a DB where schema-v4-config.sql hasn't been
 * pasted yet, the RPC is absent (PGRST202 / schema-cache miss) → returns
 * false so the caller can say "saved locally" honestly instead of lying.
 * There is deliberately NO direct-table fallback here: v2+ dropped the open
 * anon UPDATE policy, so a direct .update() would silently no-op anyway.
 */
export async function updateDoodleConfig(
  id: string,
  renderConfig: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('update_my_doodle_config', {
    p_id: id,
    p_session: getSessionId(),
    p_render_config: renderConfig,
  });
  if (error) {
    if (isMissingV2(error)) return false; // pre-v4 DB — RPC not installed yet
    throw new Error(`updateDoodleConfig failed: ${error.message}`);
  }
  return data === true;
}

/**
 * v5 (Re-draw): rewrite one of YOUR doodles' svg + render_config together —
 * one transaction server-side (update_my_doodle_svg, schema-v5-redraw.sql).
 * Returns false gracefully while v5 isn't pasted (the surface shows the
 * honest local-save note instead of lying).
 */
export async function updateDoodleSvg(
  id: string,
  svg: string,
  renderConfig: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('update_my_doodle_svg', {
    p_id: id,
    p_session: getSessionId(),
    p_svg: svg,
    p_render_config: renderConfig,
    p_content_hash: await contentHash(svg),
  });
  if (error) {
    if (isMissingV2(error)) return false; // pre-v5 DB — RPC not installed yet
    throw new Error(`updateDoodleSvg failed: ${error.message}`);
  }
  return data === true;
}

/**
 * v4 helper: resolve a doodle ROW from its svg markup via the content_hash
 * column (the same SHA-1 cache key publishDoodle stamps at insert).
 *
 * Why it exists: the object surface (Edit/Sandbox popup) receives an object's
 * MARKUP from DeskPage but not its row id / stored render_config. Until the
 * caller passes those through (the clean contract — ObjectSurfaceData.id /
 * .renderConfig), this lookup recovers them so Edit can initialize from the
 * object's real config and persist on Done. scope 'mine' adds the session_id
 * filter (Edit — your own row); 'any' matches any maker (Sandbox baseline).
 *
 * Best-effort by design: returns null on any error (missing table, network,
 * no match) — callers fall back to the current pen values. Known limit: the
 * hash is computed over the markup AS HELD by the caller; DeskPage sanitizes
 * on read, so a sanitizer that rewrites the stored markup would miss here
 * (the sanitize round-trip is idempotent for our own published markup, which
 * was already sanitized at the add boundary). Newest row wins on duplicate
 * content.
 */
export async function findDoodleBySvg(
  svg: string,
  scope: 'mine' | 'any' = 'mine',
): Promise<DoodleRow | null> {
  try {
    const hash = await contentHash(svg);
    let query = supabase
      .from(TABLE)
      .select('*')
      .eq('content_hash', hash)
      .order('created_at', { ascending: false })
      .limit(1);
    if (scope === 'mine') query = query.eq('session_id', getSessionId());
    const { data, error } = await query.maybeSingle();
    if (error) return null;
    return (data as DoodleRow) ?? null;
  } catch {
    return null;
  }
}

/**
 * Realtime feed handlers (Rock B 2026-06-12 — subscriptions were INSERT-only,
 * so another viewer's deletes/moves stayed stale until reload).
 *
 * - onInsert: a new row landed (full row in payload.new).
 * - onUpdate: a row changed — moves (x/y/rotation), meta (name/why), restyles
 *   (render_config) and re-draws (svg) all arrive here with the FULL new row.
 * - onDelete: a row was removed. Supabase postgres_changes DELETE events
 *   carry only the old row's PRIMARY KEY (payload.old = { id }) unless the
 *   table has REPLICA IDENTITY FULL — so the handler gets just the id, and
 *   desk-scoping must happen CLIENT-SIDE (see the filter note below).
 */
export interface DoodleFeedHandlers {
  onInsert: (row: DoodleRow) => void;
  onUpdate?: (row: DoodleRow) => void;
  onDelete?: (oldId: string) => void;
}

/** Shared listener wiring for both feed subscriptions. DELETE is bound
 *  WITHOUT a server-side filter on purpose: postgres_changes filters match
 *  against the event's record, and a DELETE's old record carries only the
 *  primary key — a `desk_id=eq.…` filter would never match, silently
 *  dropping every delete. So deletes arrive table-wide and the caller
 *  desk-scopes by matching the id against its own loaded objects (which IS
 *  the viewed desk's set — an unknown id is a no-op). */
function bindFeedHandlers(
  channel: ReturnType<typeof supabase.channel>,
  handlers: DoodleFeedHandlers,
  insertUpdateFilter?: string,
): ReturnType<typeof supabase.channel> {
  let bound = channel.on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: TABLE, filter: insertUpdateFilter },
    (payload) => {
      handlers.onInsert(payload.new as DoodleRow);
    },
  );
  if (handlers.onUpdate) {
    const onUpdate = handlers.onUpdate;
    bound = bound.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: TABLE, filter: insertUpdateFilter },
      (payload) => {
        onUpdate(payload.new as DoodleRow);
      },
    );
  }
  if (handlers.onDelete) {
    const onDelete = handlers.onDelete;
    bound = bound.on(
      'postgres_changes',
      // NO filter — see the function comment (DELETE old records carry only
      // the PK, so a desk filter would suppress every delete event).
      { event: 'DELETE', schema: 'public', table: TABLE },
      (payload) => {
        const id = (payload.old as { id?: unknown } | null)?.id;
        if (typeof id === 'string' && id) onDelete(id);
      },
    );
  }
  return bound;
}

/**
 * M9: subscribe to the shared feed (live canvas) — INSERT + (Rock B) UPDATE
 * and DELETE postgres_changes on public.doodles (the table is added to the
 * realtime publication by supabase/schema.sql). Graceful no-op when realtime
 * is unavailable: channel setup failures are swallowed and the callbacks
 * simply never fire — the feed still works via listDoodles on load/refresh.
 * Returns an unsubscribe function (call it on unmount).
 */
export function subscribeDoodles(handlers: DoodleFeedHandlers): () => void {
  try {
    const channel = bindFeedHandlers(
      supabase.channel('public:doodles'),
      handlers,
    ).subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  } catch {
    // Realtime unavailable (blocked socket / Make preview quirk) — no-op.
    return () => {};
  }
}

/**
 * v2: subscribe to ONE desk's live feed (multi-desk view).
 *
 * Same as subscribeDoodles but INSERT + UPDATE events scope server-side to
 * `desk_id=eq.<deskId>` so you only get live changes for the desk you're
 * looking at — not the whole world (the multi-desk point). DELETE events
 * cannot be desk-filtered (PK-only old record — see bindFeedHandlers) so
 * they arrive table-wide; the caller's id-match makes them desk-scoped.
 * Graceful no-op when realtime is unavailable. Returns an unsubscribe
 * function (call on unmount).
 */
export function subscribeDoodlesForDesk(
  deskId: string,
  handlers: DoodleFeedHandlers,
): () => void {
  try {
    const channel = bindFeedHandlers(
      supabase.channel(`public:doodles:desk:${deskId}`),
      handlers,
      `desk_id=eq.${deskId}`,
    ).subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  } catch {
    // Realtime unavailable (blocked socket / Make preview quirk) — no-op.
    return () => {};
  }
}
