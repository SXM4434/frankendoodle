// ─── hardPath — AI-mesh HARD 3D path (Tripo + fal.ai/TRELLIS) · SCAFFOLD ─────
//
// THE "way harder 3D path": a recognizable doodle → vision-router picks an AI
// 3D generator (Tripo or TRELLIS) → async job → GLB mesh → loaded into R3F via
// useGLTF. When this path lands, it becomes the DEFAULT 3D for doodles the
// router tags `tripo`/`trellis`; the local geometry modes (rod/extrude/inflate/
// solid in strokeTo3d.ts) become the FALLBACK LADDER (see fallbackLadder.ts).
//
// SCAFFOLD STATUS (2026-06-13, Round 9 earmark): interface + a stub that
// returns 'not-configured'. NO live API calls — the Tripo/fal keys are
// Sebs-side at point-of-need (~Day 14). NO DB writes. This module imports
// nothing from a hot file; it ships the contract the gen-API stage will fill.
//
// PROVIDER GROUNDING (real, cited — see docs/design/ai-mesh-hard-path-spec.md
// §2 for the full citation block):
//   • fal.ai TRELLIS  — model id "fal-ai/trellis"; queue submit/status/result
//     on https://queue.fal.run; input.image_url; output.model_mesh.url (GLB);
//     auth "Authorization: Key $FAL_KEY". Source: fal.ai/models/fal-ai/trellis/api
//   • Tripo via fal   — model id "tripo3d/tripo/v2.5/image-to-3d"; same queue
//     flow; input.image_url + texture/pbr/style; output.model_mesh / pbr_model
//     / base_model. Source: fal.ai/models/tripo3d/tripo/v2.5/image-to-3d/api
//   • Tripo direct    — POST api.tripo3d.ai/v2/openapi/task, type
//     "image_to_model", file {type,file_token|url}, model_version
//     "v2.5-20250123", style "object:clay" etc.; GET /task/{task_id}; status
//     queued|running|success|failed|...; output.model / output.pbr_model;
//     "Authorization: Bearer $TRIPO_KEY". Source: VAST-AI-Research tripo-python-sdk docs/API.md
//
// SECURITY MODEL (locked, handoff 06-10 + vision-router-spec §3): keys NEVER
// ship client-side. Both providers' calls run server-side (Supabase Edge
// Function family — same place vision-router lives). FAL_KEY is in .env.local
// WITHOUT a VITE_ prefix already; a TRIPO_KEY would follow the identical path.
// This module is the CLIENT-SIDE contract + a server-call shim that, until the
// Edge Function exists, returns 'not-configured' instead of calling anything.

import type { ViewBoxSize } from './strokeTo3d.ts';

// ─── Providers ───────────────────────────────────────────────────────────────

/** AI mesh generators the hard path can route to. The router (vision-router-
 *  spec, RouteResult.recommendedEngine) emits 'tripo' | 'trellis'; this path
 *  owns those two branches. 'tripo-direct' is the same engine via Tripo's own
 *  REST API instead of fal — a deploy-time choice, not a router choice. */
export type HardPathProvider = 'tripo' | 'trellis' | 'tripo-direct';

/** fal model ids (the routed integration layer the research doc recommends). */
export const FAL_MODEL_IDS = {
  trellis: 'fal-ai/trellis',
  tripo: 'tripo3d/tripo/v2.5/image-to-3d',
} as const;

/** Tripo direct API surface (used only if 'tripo-direct' is the chosen
 *  provider). Base + endpoints quoted from the SDK docs. */
export const TRIPO_DIRECT = {
  baseUrl: 'https://api.tripo3d.ai/v2/openapi',
  createTaskPath: '/task', // POST
  getTaskPath: (taskId: string) => `/task/${taskId}`, // GET
  defaultModelVersion: 'v2.5-20250123',
} as const;

// ─── Request — what the caller hands the hard path ───────────────────────────

/** Tripo `style` enum (object/person/animal presets). 'object:clay' is the
 *  research-doc default for a hand-made feel (21-research §5c / v1.2). null =
 *  no style preset (clean mesh). Only consumed by Tripo-family providers. */
export type TripoStyle =
  | null
  | 'object:clay'
  | 'object:steampunk'
  | 'object:christmas'
  | 'object:barbie'
  | 'person:person2cartoon'
  | 'animal:venom'
  | 'gold'
  | 'ancient_bronze';

export interface HardPathRequest {
  /** SHA-1 of the normalized source (lib/contentHash.ts) — THE cache key.
   *  Same doodle → same GLB → free repeat (the biggest cache win, 21-research
   *  §3). The GLB blob caches in OPFS under this hash. */
  contentHash: string;
  /**
   * The source image as a 512px-long-edge PNG (base64, no data: prefix) OR a
   * public URL the provider can fetch. NO API accepts SVG natively (21-research
   * §8) — the caller rasterizes the styled doodle first (canvas.toBlob).
   */
  image: { kind: 'base64-png'; data: string } | { kind: 'url'; url: string };
  /** Which generator to use. Defaults to the router's pick when omitted. */
  provider?: HardPathProvider;
  /** Tripo-family style preset. Ignored by TRELLIS. */
  style?: TripoStyle;
  /** Enable PBR materials (Tripo). Default true per the API. */
  pbr?: boolean;
  /** Texture quality (Tripo: 'standard' | 'no' | 'HD'). */
  texture?: 'standard' | 'no' | 'HD';
  /** Optional correlation tag for receipts / the decision log. */
  renderSurface?: string | null;
}

// ─── Job — the async lifecycle (both providers are queue/poll based) ──────────

/** Normalized job status across providers. Maps fal IN_QUEUE/IN_PROGRESS/
 *  COMPLETED and Tripo queued/running/success/failed onto one vocabulary so
 *  the UI + fallback ladder never branch on a provider. */
export type HardPathJobStatus =
  | 'not-configured' // no key / no Edge Function wired — drop to fallback ladder
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface HardPathJob {
  /** Provider job id (fal request_id / Tripo task_id). Empty for
   *  'not-configured'. */
  jobId: string;
  provider: HardPathProvider;
  status: HardPathJobStatus;
  /** Correlates to the request (and the OPFS cache slot). */
  contentHash: string;
  /** 0..1 best-effort (fal logs / Tripo progress); null when unknown. */
  progress: number | null;
  /** Human-readable when status === 'failed' / 'not-configured'. */
  message: string | null;
}

/** Terminal result of a succeeded job — the GLB the R3F scene loads. */
export interface HardPathMesh {
  contentHash: string;
  provider: HardPathProvider;
  /** Where the GLB lives. 'remote' = the provider's signed url (short-lived —
   *  download + re-cache in OPFS); 'opfs' = already cached locally; 'blob' =
   *  an object URL for an in-memory blob. The R3F loader (useGLTF) takes any
   *  of these as a string url. */
  glb: { kind: 'remote' | 'opfs' | 'blob'; url: string };
  /** Bytes, when known (for the OPFS cache + UI). */
  fileSize: number | null;
  /** Provider-reported generation seconds (telemetry / cost realism). */
  generationSeconds: number | null;
}

// ─── Config probe — is the hard path actually usable right now? ───────────────

/** Reflects whether the server-side gen path is wired. Until the Edge Function
 *  + keys exist (Sebs-side, ~Day 14), this is always not-configured and every
 *  caller MUST drop to the fallback ladder. NEVER reads a key client-side. */
export interface HardPathConfig {
  configured: boolean;
  /** The provider the server would use, when configured. */
  provider: HardPathProvider | null;
  /** Why it's not usable (for the honest UI chip). */
  reason: string | null;
}

/** Endpoint the gen calls will POST to when wired (mirrors vision-router's
 *  Edge Function family). Resolved from VITE_SUPABASE_URL at call time; the
 *  function itself is NOT deployed yet. */
export const HARD_PATH_FUNCTION_NAME = 'mesh-generate';

/**
 * Probe config WITHOUT making a network call or reading a secret. The hard
 * path is "configured" only once the server function is deployed AND the
 * caller opts in (a build-time / runtime flag we have not set). Scaffold
 * default: NOT configured.
 *
 * Wiring note (for the queue, NOT done here): flip this to read a real signal
 * (e.g. a `/functions/v1/mesh-generate` health ping cached at boot, or a
 * VITE_HARD_PATH_ENABLED flag) once the Edge Function lands. Today it is a
 * pure, side-effect-free constant so the fallback ladder always engages.
 */
export function probeHardPathConfig(): HardPathConfig {
  return {
    configured: false,
    provider: null,
    reason:
      'AI-mesh hard path not configured — Edge Function + Tripo/fal keys land Sebs-side (~Day 14). Using local geometry fallback.',
  };
}

// ─── THE interface: request mesh → job → GLB ─────────────────────────────────

export interface RequestMeshOptions {
  /** Source viewBox (for normalizing / debugging — not sent to providers). */
  viewBox?: ViewBoxSize;
  /** AbortSignal so the UI can cancel a long generation. */
  signal?: AbortSignal;
}

/**
 * Kick off an AI-mesh generation. STUB: makes NO live call (keys are Sebs-side
 * at point-of-need) — returns a 'not-configured' job so the caller drops to the
 * fallback ladder. When wired, this POSTs to the `mesh-generate` Edge Function
 * (which holds FAL_KEY / TRIPO_KEY) and returns the queued job.
 *
 * The real (post-wiring) body: check OPFS cache by contentHash → if hit, return
 * a 'succeeded' job pointing at the cached GLB; else POST {request} to the Edge
 * Function, which submits to fal (queue.fal.run/{model_id}) or Tripo
 * (POST /task), and returns the provider job id mapped onto HardPathJob.
 */
export async function requestMesh(
  request: HardPathRequest,
  _options: RequestMeshOptions = {},
): Promise<HardPathJob> {
  const config = probeHardPathConfig();
  if (!config.configured) {
    return {
      jobId: '',
      provider: request.provider ?? 'tripo',
      status: 'not-configured',
      contentHash: request.contentHash,
      progress: null,
      message: config.reason,
    };
  }
  // UNREACHABLE in the scaffold (configured is always false). The wired body
  // lives behind the Edge Function — see the spec doc §4 for the server flow.
  throw new Error('hardPath.requestMesh: wired path not implemented (scaffold).');
}

/**
 * Poll a job's status. STUB: a 'not-configured' job stays 'not-configured'
 * (no polling target exists). When wired, GETs the Edge Function's status
 * proxy (fal: /requests/{id}/status · Tripo: GET /task/{id}) and maps the
 * provider status onto HardPathJobStatus.
 */
export async function pollMeshJob(
  job: HardPathJob,
  _options: { signal?: AbortSignal } = {},
): Promise<HardPathJob> {
  if (job.status === 'not-configured') return job;
  throw new Error('hardPath.pollMeshJob: wired path not implemented (scaffold).');
}

/**
 * Fetch the GLB of a succeeded job (the result rung). STUB: returns null for a
 * non-succeeded job. When wired, GETs the Edge Function's result proxy (fal:
 * GET /requests/{id} → output.model_mesh.url · Tripo: output.model), downloads
 * the GLB, caches it in OPFS under contentHash, and returns a HardPathMesh.
 */
export async function fetchMeshResult(
  job: HardPathJob,
  _options: { signal?: AbortSignal } = {},
): Promise<HardPathMesh | null> {
  if (job.status !== 'succeeded') return null;
  throw new Error('hardPath.fetchMeshResult: wired path not implemented (scaffold).');
}

// ─── Provider status normalization (pure helpers — usable now by tests) ──────

/** Map a fal queue status string onto our vocabulary. */
export function normalizeFalStatus(falStatus: string): HardPathJobStatus {
  switch (falStatus) {
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

/** Map a Tripo task status string onto our vocabulary. */
export function normalizeTripoStatus(tripoStatus: string): HardPathJobStatus {
  switch (tripoStatus) {
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
      return 'failed';
    default:
      return 'failed';
  }
}

/** Is this a terminal status (no more polling needed)? */
export function isTerminalStatus(status: HardPathJobStatus): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'not-configured'
  );
}
