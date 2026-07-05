// ─── hardPath — the "hard" 3D path (AI mesh: doodle/image → GLB) ─────────────
//
// R10 (gated on Sebs's fal/Tripo credits). The COMPLEMENT to the local
// geometry engine (strokeTo3d.ts — rod/extrude/inflate/solid, deterministic,
// instant, free, offline). The hard path crosses the network, costs money,
// runs async (~30–90s), and produces a real volumetric GLB mesh for subjects
// the local heuristics can't honor (a cat with a face + tail, a coffee mug).
//
// STATUS: INERT / DEFAULT-OFF. `isHardPathEnabled()` returns false until a
// runtime flag is set AND the Edge function is reachable. While off, the
// fallback ladder degrades to the local modes — nothing here ever throws into
// the render path or fakes a mesh. NO live provider calls happen in this file:
// every network call goes to OUR Supabase Edge function (`image-to-3d`), which
// holds the provider keys server-side. This client never sees FAL_KEY/TRIPO_KEY.
//
// ── KEY HANDLING (publishable-key-safe rule, CLAUDE.md) ──────────────────────
// FAL_KEY / TRIPO_KEY are SECRETS. They are NEVER VITE_-prefixed, NEVER in
// client code, NEVER committed. They live ONLY in the Supabase Edge function's
// secrets and are used ONLY inside that function. The browser calls our Edge
// function `image-to-3d` (authorized by the client-safe ANON/publishable key);
// the function holds the provider secret and proxies submit/poll/result.
// Client-side we read only VITE_ FLAGS/URLs, never a secret.
//
// ── PROVIDER LANDSCAPE (verified vs live docs, 2026-06-13) ───────────────────
//  fal.ai fronts BOTH engines with ONE queue protocol + ONE key (FAL_KEY):
//    • fal-ai/trellis                     (Microsoft TRELLIS — cheap, open
//      weights; newer fal-ai/trellis-2 also exists) — PRIMARY
//    • tripo3d/tripo/v2.5/image-to-3d     (Tripo via fal) — FALLBACK
//  Tripo-direct (api.tripo3d.ai/v2/openapi, TRIPO_KEY Bearer) is the alternate
//  only when we want Tripo's `style` presets (object:clay) that the fal-hosted
//  endpoint does not expose. The Edge function owns provider dispatch; this
//  client speaks ONE normalized protocol to the Edge function regardless.
//
// Grounding: docs/HARD-3D-PLAN.md · docs/design/ai-mesh-hard-path-spec.md ·
// docs/research/21-research-3d-pipeline-and-style-translation.md §3/§5/§8.
//
// PURITY: no React, no DOM beyond `fetch`; importing the module triggers no
// network. Importing only the `ViewBoxSize` TYPE from strokeTo3d (no runtime
// coupling to the 2D pipeline / smartHachure / SvgStyleTransform).

import type { ViewBoxSize } from './geometry3d/strokeTo3d';
import { SUPABASE_URL, SUPABASE_KEY } from './supabase';

// ─── Provider + job types ─────────────────────────────────────────────────────

/** Which mesh engine the Edge function should target. `auto` lets the server
 *  pick (TRELLIS primary, Tripo fallback) — the normal path. The explicit
 *  values are escape hatches for testing / forcing the stylized engine. */
export type HardPathProvider = 'auto' | 'fal-trellis' | 'fal-tripo' | 'tripo-direct';

/** Normalized job status. Maps BOTH provider vocabularies onto one enum so the
 *  UI + ladder never branch on provider:
 *    fal:   IN_QUEUE | IN_PROGRESS | COMPLETED            (+ HTTP error)
 *    tripo: queued | running | success | failed | cancelled | banned | …
 *  'cached' = the Edge function returned a prior GLB by content_hash (no gen). */
export type HardPathStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'cached';

/** A submitted mesh-gen job. `jobId` is the provider request_id/task_id; the
 *  client only ever passes it back to the Edge function — never to a provider. */
export interface HardPathJob {
  jobId: string;
  provider: HardPathProvider;
  status: HardPathStatus;
  /** Queue position when known (fal IN_QUEUE) — honest progress copy. */
  queuePosition?: number;
  /** content_hash the job is keyed by (cache + dedupe). */
  contentHash?: string;
}

/** The terminal result: a GLB the R3F scene can load. `url` is ALWAYS a
 *  Supabase-Storage (or OPFS blob) URL the Edge function re-hosted — NEVER a
 *  raw, short-lived provider URL (those expire; spec §7 signed-URL-expiry). */
export interface HardPathMesh {
  glbUrl: string;
  provider: HardPathProvider;
  /** 'cache' = served from mesh_cache by content_hash (free); 'fresh' = a gen
   *  was spent. Drives honest UI + cost accounting. */
  source: 'cache' | 'fresh';
  fileSize?: number;
  contentHash?: string;
}

/** Everything the Edge function needs to submit a gen. The IMAGE is a data URL
 *  or a public URL of a rasterized render of the doodle (the Edge function
 *  uploads it / passes image_url to the provider). Strokes/viewBox are carried
 *  for the cache key + future server-side rasterization, not sent to providers
 *  raw. */
export interface HardPathRequest {
  /** PNG/JPEG/WebP data URL or public URL of the rasterized doodle. */
  imageUrl: string;
  /** Stable content hash (lib/contentHash) — the cache key. Pass it so a
   *  repeat demo of the same doodle returns the cached GLB for free. */
  contentHash?: string;
  /** Provider hint (default 'auto' — server decides). */
  provider?: HardPathProvider;
  /** Source viewBox — carried for parity with the local path, currently
   *  metadata only (the provider sees only the rasterized image). */
  viewBox?: ViewBoxSize;
  /** Tripo-direct style preset (only honored when provider routes to
   *  tripo-direct). e.g. 'object:clay' for the hand-made-feel default. */
  style?: string;
}

// ─── Config probe (the OFF gate) ──────────────────────────────────────────────

/** Why the hard path is unavailable — honest UI copy, never a silent fail. */
export type HardPathConfig =
  | { configured: true; functionUrl: string }
  | { configured: false; reason: string };

/** Read the VITE flag + Supabase URL. A FLAG turns the path on; the actual
 *  keys live server-side (this client never reads them). `configured:true`
 *  means "the Edge function exists and the flag is on" — the function itself
 *  still returns an honest 503 if FAL_KEY/TRIPO_KEY are unset server-side, and
 *  requestMesh surfaces that as a `failed` job (the ladder then falls through).
 *
 *  DEFAULT OFF: with no flag set (today's state), this returns not-configured
 *  and isHardPathEnabled() is false. */
export function probeHardPathConfig(): HardPathConfig {
  // import.meta.env is statically replaced by Vite; guarded for node/test.
  const env = (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string | undefined> }).env) || {};
  const flag = env.VITE_HARD_PATH_ENABLED;
  // Resolve via supabase.ts (env ?? hardcoded fallback) — a direct env read is
  // undefined in Figma Make and would falsely block the path even when the flag
  // is on. The flag below is the real on/off; the URL always resolves now.
  const supabaseUrl = SUPABASE_URL;

  // DEFAULT ON (Sebs 2026-06-17 "wire it"): env vars don't travel to Figma Make,
  // so a default-OFF flag hid the AI-mesh button there. On unless explicitly
  // disabled. ⚠️ Each generation bills fal/Tripo (server-side, per use).
  if (flag === '0' || flag === 'false') {
    return { configured: false, reason: 'Hard 3D path off (VITE_HARD_PATH_ENABLED=0).' };
  }
  if (!supabaseUrl) {
    return { configured: false, reason: 'Hard 3D path needs a Supabase URL to reach the image-to-3d Edge function.' };
  }
  return {
    configured: true,
    functionUrl: `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/image-to-3d`,
  };
}

/** The simple boolean gate the wiring layer checks before offering the AI-mesh
 *  chip. DEFAULT FALSE. */
export function isHardPathEnabled(): boolean {
  return probeHardPathConfig().configured;
}

// ─── Provider status normalization (PURE — unit-testable, no I/O) ─────────────

/** fal queue status enum → normalized. (queue.fal.run/.../status:
 *  IN_QUEUE → IN_PROGRESS → COMPLETED; a failed gen surfaces COMPLETED-with-
 *  error at the result endpoint, mapped to 'failed' by the Edge function.) */
export function normalizeFalStatus(raw: string): HardPathStatus {
  switch ((raw || '').toUpperCase()) {
    case 'IN_QUEUE':
      return 'queued';
    case 'IN_PROGRESS':
      return 'running';
    case 'COMPLETED':
      return 'succeeded';
    default:
      return 'failed';
  }
}

/** Tripo task status enum → normalized.
 *  (queued | running | success | failed | cancelled | unknown | banned |
 *  expired — docs.tripo3d.ai). */
export function normalizeTripoStatus(raw: string): HardPathStatus {
  switch ((raw || '').toLowerCase()) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'success':
      return 'succeeded';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
    case 'banned':
    case 'expired':
    case 'unknown':
    default:
      return 'failed';
  }
}

/** True once a job will never change again (poll loops stop here). */
export function isTerminalStatus(s: HardPathStatus): boolean {
  return s === 'succeeded' || s === 'failed' || s === 'cancelled' || s === 'cached';
}

// ─── Client API (talks ONLY to our Edge function) ─────────────────────────────
//
// The Edge function `image-to-3d` exposes ONE normalized JSON protocol so the
// client never branches on provider:
//   POST  {functionUrl}            { imageUrl, contentHash?, provider?, style? }
//     → 200 { jobId, provider, status, queuePosition?, source? }   (or cached mesh)
//     → 503 { error }   (keys unset server-side → honest not-configured)
//   GET   {functionUrl}?jobId=…&provider=…
//     → 200 { status, queuePosition? }
//   GET   {functionUrl}?jobId=…&provider=…&result=1
//     → 200 { glbUrl, source, fileSize? }   when succeeded
//
// All requests carry the client-safe Supabase anon key (Authorization +
// apikey), the SAME key the rest of the app uses. No secret ever leaves the
// server.

// Resolved publishable key (env ?? hardcoded fallback) — the SAME key
// image-to-svg sends. A raw import.meta.env read is '' in Figma Make (env doesn't
// travel) → no Authorization header → the Edge function 401s before it runs.
// THAT is why SVG worked (uses SUPABASE_KEY) but the 3D hard path 401'd.
const ANON_KEY = SUPABASE_KEY;

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ANON_KEY) {
    h['Authorization'] = `Bearer ${ANON_KEY}`;
    h['apikey'] = ANON_KEY;
  }
  return h;
}

/** Submit a doodle for AI-mesh generation. Returns a job to poll, OR — when the
 *  Edge function hits a content_hash cache — a job already in 'cached' state
 *  whose result is immediately fetchable. Never throws into the render path:
 *  any failure (off, 503, network) resolves to a `failed` job so the caller's
 *  fallback ladder engages. */
export async function requestMesh(req: HardPathRequest): Promise<HardPathJob> {
  const cfg = probeHardPathConfig();
  if (!cfg.configured) {
    return { jobId: '', provider: req.provider ?? 'auto', status: 'failed' };
  }
  try {
    const res = await fetch(cfg.functionUrl, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        imageUrl: req.imageUrl,
        contentHash: req.contentHash,
        provider: req.provider ?? 'auto',
        style: req.style,
      }),
    });
    if (!res.ok) {
      // 503 = keys unset server-side (honest not-configured); any other = fail.
      return { jobId: '', provider: req.provider ?? 'auto', status: 'failed', contentHash: req.contentHash };
    }
    const data = (await res.json()) as Partial<HardPathJob>;
    return {
      jobId: data.jobId ?? '',
      provider: (data.provider as HardPathProvider) ?? req.provider ?? 'auto',
      status: (data.status as HardPathStatus) ?? 'queued',
      queuePosition: data.queuePosition,
      contentHash: req.contentHash,
    };
  } catch {
    return { jobId: '', provider: req.provider ?? 'auto', status: 'failed', contentHash: req.contentHash };
  }
}

/** Poll a job's status via the Edge function. On any error returns a 'failed'
 *  job (the poll loop is terminal-aware, so this stops the loop and the ladder
 *  falls through). */
export async function pollMeshJob(job: HardPathJob): Promise<HardPathJob> {
  const cfg = probeHardPathConfig();
  if (!cfg.configured || !job.jobId) {
    return { ...job, status: 'failed' };
  }
  try {
    const url = `${cfg.functionUrl}?jobId=${encodeURIComponent(job.jobId)}&provider=${encodeURIComponent(job.provider)}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return { ...job, status: 'failed' };
    const data = (await res.json()) as { status?: string; queuePosition?: number };
    return {
      ...job,
      status: (data.status as HardPathStatus) ?? 'failed',
      queuePosition: data.queuePosition ?? job.queuePosition,
    };
  } catch {
    return { ...job, status: 'failed' };
  }
}

/** Fetch the terminal GLB result via the Edge function. Returns null on
 *  anything but a succeeded/cached job with a usable re-hosted GLB url. */
export async function fetchMeshResult(job: HardPathJob): Promise<HardPathMesh | null> {
  const cfg = probeHardPathConfig();
  if (!cfg.configured || !job.jobId) return null;
  if (job.status !== 'succeeded' && job.status !== 'cached') return null;
  try {
    // Pass contentHash on the RESULT fetch too (not just submit) so the Edge fn
    // can WRITE mesh_cache(content_hash → re-hosted glbUrl) after it re-hosts —
    // making a later gen of the SAME doodle a free cache hit. Backward-compatible:
    // an older deployed Edge fn just ignores the extra param.
    const ch = job.contentHash ? `&contentHash=${encodeURIComponent(job.contentHash)}` : '';
    const url = `${cfg.functionUrl}?jobId=${encodeURIComponent(job.jobId)}&provider=${encodeURIComponent(job.provider)}&result=1${ch}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as { glbUrl?: string; source?: string; fileSize?: number };
    if (!data.glbUrl) return null;
    return {
      glbUrl: data.glbUrl,
      provider: job.provider,
      source: data.source === 'cache' || job.status === 'cached' ? 'cache' : 'fresh',
      fileSize: data.fileSize,
      contentHash: job.contentHash,
    };
  } catch {
    return null;
  }
}

// ─── Convenience: submit → poll-to-terminal → result (one await) ──────────────

export interface RunMeshOptions {
  /** Poll interval ms (default 2500 — gens take ~30–90s). */
  pollIntervalMs?: number;
  /** Hard ceiling on total wait before giving up (default 180_000 = 3 min). */
  timeoutMs?: number;
  /** Status callback for honest progress UI (queue position, running, …). */
  onStatus?: (job: HardPathJob) => void;
  /** Cooperative cancel — return true to abort the poll loop. */
  shouldCancel?: () => boolean;
  /** Injectable clock + sleep for deterministic tests (defaults to real). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** End-to-end: submit, poll until terminal (or timeout/cancel), fetch the GLB.
 *  Returns null on any non-success — the caller's fallback ladder takes over.
 *  Never throws. */
export async function runMesh(
  req: HardPathRequest,
  opts: RunMeshOptions = {},
): Promise<HardPathMesh | null> {
  const pollIntervalMs = opts.pollIntervalMs ?? 2500;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let job = await requestMesh(req);
  opts.onStatus?.(job);
  if (job.status === 'cached') return fetchMeshResult(job);
  if (isTerminalStatus(job.status)) {
    return job.status === 'succeeded' ? fetchMeshResult(job) : null;
  }

  const start = now();
  while (!isTerminalStatus(job.status)) {
    if (opts.shouldCancel?.()) return null;
    if (now() - start > timeoutMs) return null;
    await sleep(pollIntervalMs);
    job = await pollMeshJob(job);
    opts.onStatus?.(job);
  }
  return job.status === 'succeeded' || job.status === 'cached' ? fetchMeshResult(job) : null;
}
