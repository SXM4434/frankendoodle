// Personal-space data layer — profiles (handles), private desks, drawer.
//
// Typed wrappers over the Supabase RPCs added by supabase/migrations/
// (0001 profiles, 0002 anon-auth RLS, 0003 private desks + drawer). Mirrors the
// shape + graceful-fallback discipline of lib/publish.ts: every call swallows
// the "table/function does not exist" error (migrations not applied yet) and
// returns a null/empty/false result so the app NEVER crashes on a DB that
// hasn't run the personal-space migrations.
//
// ⚠️  FLAGGED OFF BY DEFAULT. isPersonalSpaceEnabled() gates whether the UI
//     wires any of this. Until the migrations are applied + Sebs flips the flag,
//     these helpers are dormant — nothing calls the live DB. This keeps the
//     stream DB-SAFE (no live mutation) and lets DeskPage integrate behind one
//     boolean.

import { supabase } from './supabase';
import { getSessionId } from './session';
import { contentHash } from './contentHash';
import { handleFromId } from './handle';
import type { DeskRow, DoodleRow } from './publish';

// ─── Feature flag ────────────────────────────────────────────────────────────
// Gates whether the personal-space UI (the homepage "Your space" door, the
// /your-space + /drawer surfaces) is wired. Reads an env var so Make + local can
// toggle without a code edit. Defaults ON: the UI is DB-SAFE on its own — the
// SEPARATE isPersonalSpaceDbReady() gate (VITE_PERSONAL_SPACE_DB) still guards
// every live mutation, so showing the UI never touches the shared public DB.
// (Make doesn't carry env vars, so the door would silently vanish if this
// defaulted OFF.) Set VITE_PERSONAL_SPACE='0' to force the UI off.
export function isPersonalSpaceEnabled(): boolean {
  try {
    return import.meta.env.VITE_PERSONAL_SPACE !== '0';
  } catch {
    return true;
  }
}

// ─── DB-WRITE GATE (now DEFAULTS ON — migrations are live) ────────────────────
// HISTORY: this used to default OFF (write-free head-start) while the owner_id
// migrations (0001-0005) weren't applied yet. They ARE applied now (verified
// 2026-06-15 against the live Supabase project), so private-desk writes are
// safe. It must default ON because env vars (VITE_*) DON'T travel to Figma Make
// — a default-OFF flag made create_private_desk / stash / publish silently no-op
// in the Make build ("create a new desk does nothing"). Private-desk writes are
// owner-scoped (owner_id = session) and never touch the public board, so there's
// no risk in defaulting on. Set VITE_PERSONAL_SPACE_DB='0' to force write-free.
export function isPersonalSpaceDbReady(): boolean {
  try {
    return import.meta.env.VITE_PERSONAL_SPACE_DB !== '0';
  } catch {
    return true;
  }
}

// ─── Identity (swappable to anon-auth) ───────────────────────────────────────
// TODAY this returns the localStorage UUID (lib/session.ts). After the anon-auth
// swap, change getSessionId() itself to return supabase.auth.signInAnonymously()
// .user.id (the SDK persists it in localStorage, so "never blank, no wall" holds)
// — then this helper + every owner_id/session_id keyed off it become a real
// auth.uid(). Keeping the indirection here documents the single swap point.
export function getIdentityId(): string {
  return getSessionId();
}

// Postgres "relation does not exist" / PostgREST "function not found" — the
// signal that a personal-space migration hasn't been applied. (Same codes
// lib/publish.ts checks.)
function isMissing(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST202') return true;
  const m = (err.message ?? '').toLowerCase();
  return m.includes('does not exist') || m.includes('schema cache') || m.includes('could not find');
}

// ─── Profiles / handles ──────────────────────────────────────────────────────

export interface ProfileRow {
  id: string;
  handle: string;
  handle_source: 'generated' | 'rerolled' | 'custom' | string;
  avatar_svg: string | null;
  created_at: string;
  updated_at: string;
}

/** Read the caller's profile (handle), or null if none yet / pre-migration. */
export async function getMyProfile(): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', getIdentityId())
    .maybeSingle();
  if (error) {
    if (isMissing(error)) return null; // pre-migration → no profile
    throw new Error(`getMyProfile failed: ${error.message}`);
  }
  return (data as ProfileRow) ?? null;
}

/** Read one profile by id (for rendering another person's handle). */
export async function getProfile(id: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissing(error)) return null;
    throw new Error(`getProfile failed: ${error.message}`);
  }
  return (data as ProfileRow) ?? null;
}

/**
 * Claim (or update) the caller's handle. Resolves:
 *   'claimed'      — the handle is now yours
 *   'taken'        — someone else owns it (caller should reroll / append token)
 *   'unavailable'  — pre-migration DB (RPC absent) — caller falls back to the
 *                    deterministic local handle (handleFromId) with no persistence
 */
export async function claimHandle(
  handle: string,
  source: 'generated' | 'rerolled' | 'custom' = 'generated',
): Promise<'claimed' | 'taken' | 'unavailable'> {
  // Head-start: don't even reach the wire until the DB is confirmed ready —
  // the caller already treats 'unavailable' as "keep the local handle, enter".
  if (!isPersonalSpaceDbReady()) return 'unavailable';
  const { data, error } = await supabase.rpc('claim_handle', {
    p_id: getIdentityId(),
    p_handle: handle,
    p_source: source,
  });
  if (error) {
    if (isMissing(error)) return 'unavailable';
    throw new Error(`claimHandle failed: ${error.message}`);
  }
  return data === true ? 'claimed' : 'taken';
}

// ─── Local handle persistence (DB-INDEPENDENT) ───────────────────────────────
// The settled onboarding handle, mirrored to localStorage so a rerolled / custom
// choice STICKS across reloads and reads CONSISTENTLY everywhere — even before
// the migrations land. Pre-migration, claimHandle() is a no-op (DB not ready),
// so localStorage is the ONLY place a chosen handle can live; without it the
// drawer chip falls back to the deterministic handle and disagrees with the
// onboarding choice (the top-bar chip). Once the DB is ready the CLAIMED profile
// handle takes precedence (getEffectiveHandle reads the profile first).
const LOCAL_HANDLE_KEY = 'dd.handle';

/** The locally-remembered settled handle, or null (never set / private mode). */
export function getLocalHandle(): string | null {
  try {
    const h = localStorage.getItem(LOCAL_HANDLE_KEY);
    return h && h.length > 0 ? h : null;
  } catch {
    return null;
  }
}

/** Remember the settled handle locally (called by onboarding on settle / skip). */
export function setLocalHandle(handle: string): void {
  try {
    localStorage.setItem(LOCAL_HANDLE_KEY, handle);
  } catch {
    /* private mode — handle won't persist; the deterministic fallback covers it */
  }
}

/** The caller's effective handle: their CLAIMED one (DB), else the LOCALLY
 *  remembered onboarding choice, else the deterministic fallback so the UI
 *  always has a friendly label even pre-onboarding. The local layer keeps the
 *  drawer chip in sync with the onboarding choice while the DB is off. */
export async function getEffectiveHandle(): Promise<string> {
  const profile = await getMyProfile().catch(() => null);
  return profile?.handle ?? getLocalHandle() ?? handleFromId(getIdentityId());
}

// ─── Private desks ───────────────────────────────────────────────────────────

/** Create a new private desk owned by the caller. Returns the desk, or null
 *  pre-migration. */
export async function createPrivateDesk(name = 'My Desk'): Promise<DeskRow | null> {
  // Head-start: write-free until the DB is ready (caller treats null as no-op).
  if (!isPersonalSpaceDbReady()) return null;
  const { data, error } = await supabase.rpc('create_private_desk', {
    p_session: getIdentityId(),
    p_name: name,
  });
  if (error) {
    if (isMissing(error)) return null;
    throw new Error(`createPrivateDesk failed: ${error.message}`);
  }
  return (data as DeskRow) ?? null;
}

/** List the caller's private desks (owner_id = me), newest-first. [] pre-migration. */
export async function listMyDesks(): Promise<DeskRow[]> {
  // Gate the READ like the writes (Sebs 2026-06-19): without this it hits the wire
  // on every /desk mount before the migrations exist → 404/400 spam in the console.
  if (!isPersonalSpaceDbReady()) return [];
  const { data, error } = await supabase
    .from('desks')
    .select('*')
    .eq('owner_id', getIdentityId())
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissing(error)) return [];
    throw new Error(`listMyDesks failed: ${error.message}`);
  }
  return (data ?? []) as DeskRow[];
}

/** Delete one of MY private desks (+ its doodles) via the owner-scoped
 *  delete_private_desk RPC (supabase/schema-v6-delete-desk.sql). Returns true if a
 *  desk was removed. Write-free / false until the DB is ready (caller treats false
 *  as a no-op). The public open desk is never deletable (RPC requires owner_id). */
export async function deleteMyDesk(deskId: string): Promise<boolean> {
  if (!isPersonalSpaceDbReady()) return false;
  const { data, error } = await supabase.rpc('delete_private_desk', {
    p_id: deskId,
    p_session: getIdentityId(),
  });
  if (error) {
    if (isMissing(error)) return false; // RPC not pasted yet → quiet no-op
    throw new Error(`deleteMyDesk failed: ${error.message}`);
  }
  return data === true;
}

// ─── Personal drawer ─────────────────────────────────────────────────────────
// A drawer doodle = owner_id is me AND desk_id is null.

/** Save a doodle into the caller's personal drawer (separate from any desk). */
export async function stashToDrawer(input: {
  svg: string;
  name?: string | null;
  why?: string | null;
  renderConfig?: Record<string, unknown> | null;
}): Promise<DoodleRow | null> {
  // Head-start: write-free until the DB is ready (caller treats null as no-op).
  if (!isPersonalSpaceDbReady()) return null;
  const content_hash = await contentHash(input.svg);
  const { data, error } = await supabase.rpc('stash_to_drawer', {
    p_session: getIdentityId(),
    p_svg: input.svg,
    p_content_hash: content_hash,
    p_name: input.name ?? null,
    p_why: input.why ?? null,
    p_render_config: input.renderConfig ?? null,
  });
  if (error) {
    if (isMissing(error)) return null;
    throw new Error(`stashToDrawer failed: ${error.message}`);
  }
  return (data as DoodleRow) ?? null;
}

/** List the caller's drawer doodles (owner = me, not on any desk). [] pre-migration. */
export async function listMyDrawer(limit = 100): Promise<DoodleRow[]> {
  if (!isPersonalSpaceDbReady()) return []; // gate the read (no pre-migration 404s)
  const { data, error } = await supabase
    .from('doodles')
    .select('*')
    .eq('owner_id', getIdentityId())
    .is('desk_id', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissing(error)) return [];
    throw new Error(`listMyDrawer failed: ${error.message}`);
  }
  return (data ?? []) as DoodleRow[];
}

/** Move a drawer doodle onto a desk (clears it from the drawer). */
export async function placeFromDrawer(
  id: string,
  deskId: string,
  x = 0,
  y = 0,
  rotation = 0,
): Promise<boolean> {
  // Head-start: write-free until the DB is ready (caller treats false as no-op).
  if (!isPersonalSpaceDbReady()) return false;
  const { data, error } = await supabase.rpc('place_from_drawer', {
    p_id: id,
    p_session: getIdentityId(),
    p_desk_id: deskId,
    p_x: x,
    p_y: y,
    p_rot: rotation,
  });
  if (error) {
    if (isMissing(error)) return false;
    throw new Error(`placeFromDrawer failed: ${error.message}`);
  }
  return data === true;
}

// ─── SHELF (the PUBLIC half of a person's drawer) ────────────────────────────
// Naming (Sebs locked 2026-06-14): a person has a DRAWER (private, closed —
// listMyDrawer above) and a SHELF (public, on display). "In the drawer = hidden,
// on the shelf = visible." A public-desk doodle is inherently public, so it lands
// on the owner's shelf automatically; a private-desk/drawer doodle reaches the
// shelf only when the owner explicitly shares it (shareToShelf). The shelf is the
// shareable face others browse from a doodle's @handle.
//
// The shelf is keyed off the doodle's owner_id (migration 0003) + an is_public /
// shelf flag. Public-read RLS means listShelfOf(id) returns ONLY the rows a
// viewer may see — exactly that person's public set — so the social "view their
// shelf" needs NO profiles-table lookup (the doodle card already carries owner_id).

/** Someone's PUBLIC shelf — their shareable doodles, newest-first. Readable by
 *  anyone (public-read RLS). [] pre-migration / on a DB without the shelf flag. */
export async function listShelfOf(ownerId: string, limit = 100): Promise<DoodleRow[]> {
  if (!isPersonalSpaceDbReady()) return []; // gate the read (no pre-migration 404s); also covers listMyShelf
  const { data, error } = await supabase
    .from('doodles')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissing(error)) return []; // pre-migration / no owner_id|is_public column
    throw new Error(`listShelfOf failed: ${error.message}`);
  }
  return (data ?? []) as DoodleRow[];
}

/** My own PUBLIC shelf (the shareable doodles under my identity). */
export async function listMyShelf(limit = 100): Promise<DoodleRow[]> {
  return listShelfOf(getIdentityId(), limit);
}

/** Share a doodle from my private drawer onto my shelf (make it public).
 *  Write-free until the DB is ready (caller treats false as a no-op). */
export async function shareToShelf(doodleId: string): Promise<boolean> {
  if (!isPersonalSpaceDbReady()) return false;
  const { data, error } = await supabase.rpc('share_to_shelf', {
    p_id: doodleId,
    p_session: getIdentityId(),
  });
  if (error) {
    if (isMissing(error)) return false;
    throw new Error(`shareToShelf failed: ${error.message}`);
  }
  return data === true;
}

/** Publish a doodle directly onto one of MY private desks (owner-scoped) instead
 *  of the public open desk — the routing fix so drawing on a private desk stays
 *  private. null pre-DB (caller treats null as a no-op / falls back). */
export async function publishToPrivateDesk(
  deskId: string,
  input: {
    svg: string;
    name?: string | null;
    why?: string | null;
    renderConfig?: Record<string, unknown> | null;
    x?: number;
    y?: number;
    rotation?: number;
  },
): Promise<DoodleRow | null> {
  if (!isPersonalSpaceDbReady()) return null;
  const content_hash = await contentHash(input.svg);
  const { data, error } = await supabase.rpc('publish_to_private_desk', {
    p_session: getIdentityId(),
    p_desk_id: deskId,
    p_svg: input.svg,
    p_content_hash: content_hash,
    p_name: input.name ?? null,
    p_why: input.why ?? null,
    p_render_config: input.renderConfig ?? null,
    p_x: input.x ?? 0,
    p_y: input.y ?? 0,
    p_rot: input.rotation ?? 0,
  });
  if (error) {
    if (isMissing(error)) return null;
    throw new Error(`publishToPrivateDesk failed: ${error.message}`);
  }
  return (data as DoodleRow) ?? null;
}
