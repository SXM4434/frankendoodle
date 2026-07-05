// Image → SVG seam (the "Upload image" input path).
//
// A raster image (PNG/JPG/WebP) becomes a SIMPLER HAND-DRAWN SKETCH in SVG, then
// re-enters the SAME pipeline as Draw / Upload-SVG: the markup is sanitized
// through svgUpload's `sanitizeSvgMarkup`, then the caller hands it to the desk's
// add boundary exactly like an uploaded .svg (normalizeSvgSize sizes it, the
// SvgStyleTransform 2D styles restyle it, strokeTo3d's 3D path converts it).
//
// ── LOCKED FEATURE (Sebs, DECISIONS-FOR-SEBS.md "Image-mode refinement") ──────
//  1. Best-QUALITY provider: Quiver Arrow via a Supabase EDGE FUNCTION
//     (api.quiver.ai/v1/svgs/vectorizations, Bearer key, model arrow-1.1-max).
//     Quality over key-convenience — NOT the free-vtracer path.
//  2. The output must be a SIMPLER SKETCH of the photo: abstract it to a few
//     hand-drawn strokes that fit the Desk Doodles look — NOT a detailed /
//     photo-real vectorization. The simplify-to-sketch step (simplifyToSketch.ts)
//     IS part of the conversion and runs AFTER the trace, BEFORE the desk gets it.
//
// PROVIDER INTERFACE — the conversion engine is swappable behind one type so the
// caller never changes when the engine does. Today: the hosted Quiver provider
// (best quality) and an honest unconfigured default (never fakes linework).
//
// ── KEY HANDLING (publishable-key-safe rule, CLAUDE.md) ──────────────────────
// QUIVERAI_API_KEY is a SECRET. It is NEVER VITE_-prefixed, NEVER in client code,
// NEVER committed. It lives only in the Supabase Edge function's secrets and is
// used only inside that function. The browser calls our Edge function
// `image-to-svg` (authorized by the client-safe ANON/publishable key); the Edge
// function holds the Quiver secret and proxies the request. Client-side we read
// only VITE_ FLAGS/URLs (provider flag, Supabase URL/anon key), never a secret.

import { sanitizeSvgMarkup } from './svgUpload';
import { SUPABASE_URL, SUPABASE_KEY } from './supabase';
import {
  simplifyToSketch,
  DEFAULT_SKETCHIFY,
  type SketchifyOptions,
  type SketchifyResult,
} from './simplifyToSketch';

// ── Result + validation ──────────────────────────────────────────────────────

export type ImageToSvgResult =
  | {
      ok: true;
      markup: string;
      sketch?: SketchifyResult['stats'];
      /** The downscaled ORIGINAL photo as a data URL (image/jpeg). The hard-path
       *  3D ("Generate AI 3D") sends THIS to TRELLIS — it's built for photos, so
       *  a real photo yields a far better mesh than the rasterized line-art
       *  doodle (Sebs 2026-06-16). Undefined in a non-DOM context. */
      sourceImage?: string;
    }
  | { ok: false; error: string };

// Mirror svgUpload's caps philosophy (OWASP/Fortinet attack-surface guidance):
// reject oversized input BEFORE handing it to any parser/encoder/network call.
// Raster source files are bigger than SVGs (a phone photo is multi-MB), so the
// raw-input cap is more generous than svgUpload's 2 MiB — but it is still a hard
// ceiling so a 50 MB drop never freezes the tab or runs up a hosted bill. 12 MiB
// is also Quiver's documented per-image decoded cap (12582912 bytes).
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MiB — also Quiver's per-image cap
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ACCEPTED_EXT = /\.(png|jpe?g|webp)$/i;

function bytesToReadable(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** True for raster image files this seam knows how to trace. SVGs are NOT a
 *  raster image — they go through prepareSvgUpload directly (the caller routes
 *  by type), so an .svg here is a caller bug and rejected. */
export function isRasterImageFile(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXT.test(file.name);
}

function validateImage(file: File): { ok: true } | { ok: false; error: string } {
  if (!isRasterImageFile(file)) {
    return { ok: false, error: `Not a PNG/JPG/WebP image: ${file.name}` };
  }
  // file.size is the raw byte length — zero-cost, checked before any read.
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `Image too large (${bytesToReadable(file.size)}). Max ${bytesToReadable(
        MAX_IMAGE_BYTES,
      )}.`,
    };
  }
  return { ok: true };
}

// ── Provider interface (swappable engines) ──────────────────────────────────

/** A conversion engine: takes a validated raster File, returns raw SVG markup
 *  (UNSANITIZED, UN-SIMPLIFIED — imageToSvg sanitizes + sketchifies every
 *  provider's output uniformly) or a user-facing error. `needsKey` documents
 *  whether the provider depends on a server-side secret (drives selection +
 *  honest UI copy). */
export interface ImageToSvgProvider {
  readonly id: string;
  readonly label: string;
  /** True if this provider needs a server-side API key (hosted). The default is
   *  false (no account, no key — keeps the build runnable + honest). */
  readonly needsKey: boolean;
  convert(file: File): Promise<{ ok: true; markup: string } | { ok: false; error: string }>;
}

// ── QUIVER provider (hosted, best quality, via Supabase Edge Function) ────────
//
// Quiver image→SVG IS a real API (verified against the QuiverAI public-beta docs
// + OpenAPI, 2026-06):
//   POST https://api.quiver.ai/v1/svgs/vectorizations
//   Authorization: Bearer <QUIVERAI_API_KEY>
//   body: { model: 'arrow-1.1' | 'arrow-1.1-max',
//           image: { base64 } | { url },
//           auto_crop?: boolean (default false),
//           target_size?: 128..4096 (square resize),
//           stream?: boolean (default false) }
//   → 200 { id, created, credits, data: [{ mime_type:'image/svg+xml', svg }], usage }
//   (docs.quiver.ai/api-reference/vectorize-svg/image-to-svg)
//
// The key is a SECRET → it must NOT reach the browser. So the client does NOT
// call api.quiver.ai directly; it calls our Supabase Edge Function
// `image-to-svg`, which holds QUIVERAI_API_KEY in its secrets and proxies the
// request, returning a normalized `{ svg }`. The Edge function is scaffolded
// under supabase/functions/image-to-svg/ (NOT deployed here — artifact only).
//
// Best-quality default: model 'arrow-1.1-max' (Sebs: quality over cost). The
// Edge function may downscale via target_size — a smaller source naturally
// yields fewer, cleaner paths, which helps the simplify-to-sketch step. This is
// the DEFAULT/active provider per the locked feature; selectProvider() makes it
// active whenever the Supabase URL is configured, falling back to the honest
// unconfigured provider only when it is not.
const EDGE_FUNCTION_PATH = '/functions/v1/image-to-svg';
// arrow-1.1 (NOT -max): the low-path, primitive-favoring variant — "reduced
// over-reliance on paths, greater use of primitives" (Quiver Arrow 1.1 docs).
// Switched from arrow-1.1-max 2026-06-16 per Sebs's "simple SVG like ours" goal
// + API research (wf we4g2hyh4): -max deliberately adds detail/control-points =
// the dense-trace mess we want to avoid for clean line-art. Flip back to
// 'arrow-1.1-max' if you want maximum fidelity over simplicity. The edge fn's
// DEFAULT_MODEL should mirror this (re-deploy needed there); the client sends
// `model` explicitly, so this value wins per-call regardless.
// arrow-1.1-max @ target_size 768: the FIDELITY winner (Sebs 2026-06-16, live
// Game Boy compare). arrow-1.1 + max@512 over-abstract a detailed photo to a
// featureless blob (lose D-pad/buttons/text); -max@768 keeps the structure +
// FILLED tonal regions our Smart Hachure shades. "best case scenario clean SVG."
const QUIVER_MODEL = 'arrow-1.1-max';
const QUIVER_TARGET_SIZE = 1024; // @1024 = clean AND detailed (768 was messy, 512 blobbed)

const QUIVER_PROVIDER: ImageToSvgProvider = {
  id: 'quiver',
  label: 'Quiver Arrow (best quality)',
  needsKey: true,
  async convert(file: File) {
    // Resolve via supabase.ts (env var ?? hardcoded fallback) — NOT readEnv,
    // which is undefined in Figma Make and made a reachable backend look unwired.
    const base = SUPABASE_URL;
    const anon = SUPABASE_KEY;
    if (!base) {
      return {
        ok: false,
        error: 'Image tracing needs a Supabase URL to reach the Edge function.',
      };
    }
    try {
      // DOWNSCALE before the trace (Sebs 2026-06-16, live upload 413'd): a phone
      // photo is multi-MB → base64 blows past Quiver's 12MiB decoded cap (413).
      // Downscaling to ~1280px also IS the quality lever — @1024 target on a 1280
      // source is the clean-but-detailed sweet spot. JPEG to shrink the payload;
      // white-flatten so a transparent PNG doesn't trace a black field.
      const base64 = await fileToTracerBase64(file, 1280, 0.95);
      const res = await fetch(`${base.replace(/\/$/, '')}${EDGE_FUNCTION_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The ANON (publishable) key authorizes the Edge invoke — it is
          // client-safe by design; the SECRET QUIVERAI_API_KEY lives only in
          // the Edge function's environment, never here.
          ...(anon ? { Authorization: `Bearer ${anon}`, apikey: anon } : {}),
        },
        body: JSON.stringify({
          image: { base64 },
          model: QUIVER_MODEL,
          // 768 (was 512): a bigger source keeps the structural detail (-max @512
          // collapsed the Game Boy to a blob). The trace is the "filter" for the
          // image path; we take it as-is and only valueize hue → our register.
          target_size: QUIVER_TARGET_SIZE,
          auto_crop: true,
        }),
      });
      if (!res.ok) {
        // Edge function returns honest JSON errors ({ error }); surface them.
        let detail = '';
        try {
          const j = (await res.json()) as { error?: string };
          detail = j.error ? ` — ${j.error}` : '';
        } catch {
          /* non-JSON body */
        }
        return {
          ok: false,
          error: `Tracer service error (${res.status})${detail}. Try draw or SVG upload.`,
        };
      }
      const data = (await res.json()) as { svg?: string; error?: string };
      if (data.error) return { ok: false, error: data.error };
      if (!data.svg || !/<svg[\s\S]*<\/svg>/i.test(data.svg)) {
        return { ok: false, error: 'Tracer returned no usable SVG.' };
      }
      return { ok: true, markup: data.svg };
    } catch (err) {
      return { ok: false, error: `Tracer request failed: ${(err as Error).message}` };
    }
  },
};

// ── DEFAULT / unconfigured provider — honest, never fakes ─────────────────────
//
// Desk Doodles forbids fake/stub UI that pretends to work (feedback_actual_ml_
// not_fake's spirit). When the Quiver Edge function is not configured (no
// Supabase URL / secret unset), the seam returns a clear "not wired" error
// instead of fabricating linework. The integration steps are in
// supabase/functions/image-to-svg/index.ts + docs/IMAGE-MODE-PLAN.md.
const UNCONFIGURED_PROVIDER: ImageToSvgProvider = {
  id: 'unconfigured',
  label: 'Image tracing (not configured)',
  needsKey: false,
  async convert(_file: File) {
    return {
      ok: false,
      error:
        'Image tracing is not configured yet (Quiver Edge function needs ' +
        'VITE_SUPABASE_URL + the QUIVERAI_API_KEY secret). For now, draw it or ' +
        'upload an SVG.',
    };
  },
};

// ── Provider selection ───────────────────────────────────────────────────────

const PROVIDERS: Record<string, ImageToSvgProvider> = {
  [QUIVER_PROVIDER.id]: QUIVER_PROVIDER,
  [UNCONFIGURED_PROVIDER.id]: UNCONFIGURED_PROVIDER,
};

/** Read a Vite env var safely in any bundler context (Make included). Only
 *  VITE_-prefixed values are ever read here — and only FLAGS/URLs, never a
 *  secret key (secrets live in Edge-function secrets). */
function readEnv(key: string): string | undefined {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

/** Pick the active provider. Per the locked feature, the BEST-QUALITY Quiver
 *  Edge path is the default whenever Supabase is configured (VITE_SUPABASE_URL
 *  present). When it isn't, fall back to the honest unconfigured provider so the
 *  build stays runnable and never fakes output. An explicit
 *  VITE_IMAGE_TO_SVG_PROVIDER flag overrides selection (a FLAG, never a key). */
function selectProvider(): ImageToSvgProvider {
  const flag = readEnv('VITE_IMAGE_TO_SVG_PROVIDER');
  if (flag && PROVIDERS[flag]) return PROVIDERS[flag];
  // SUPABASE_URL always resolves (env ?? hardcoded fallback), so the Quiver Edge
  // path is the default everywhere — including Figma Make. If the Edge function
  // isn't deployed / its key is unset, convert() surfaces the function's honest
  // error rather than this client falsely claiming "not configured."
  if (SUPABASE_URL) return QUIVER_PROVIDER;
  return UNCONFIGURED_PROVIDER;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** File → DOWNSCALED JPEG base64 (no data: prefix) for the tracer request. Caps
 *  the longest side at `maxDim` (so a multi-MB phone photo fits Quiver's decoded
 *  cap) and white-flattens transparency (a transparent PNG would otherwise trace
 *  a black field). Falls back to the raw base64 in a non-DOM context. */
function fileToTracerBase64(file: File, maxDim: number, quality: number): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return fileToBase64(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode the image file.'));
    };
    img.onload = () => {
      try {
        const longest = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height) || 1;
        const scale = Math.min(1, maxDim / longest);
        const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Could not get a 2D canvas context.'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const comma = dataUrl.indexOf(',');
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err as Error);
      }
    };
    img.src = url;
  });
}

/** File → base64 string (no data: prefix) for the hosted request body. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** Map every fill/stroke COLOR in SVG markup to its greyscale luminance (value,
 *  not hue) so a photo trace reads in our ink register. Leaves none/transparent/
 *  currentColor/inherit and url() pattern/gradient refs untouched (U5). Keeps
 *  fills as fills (only desaturated) so Smart Hachure still shades them. Pure
 *  string transform — no DOM, Make-safe. */
function valueizeColors(markup: string): string {
  const toGrey = (c: string): string => {
    const v = c.trim();
    if (/^(none|transparent|currentcolor|inherit)$/i.test(v)) return c;
    if (/^url\(/i.test(v)) return c; // pattern/gradient ref — leave (U5 keep-source)
    const rgb = parseCssColor(v);
    if (!rgb) return c;
    // DARK value map (Sebs 2026-06-16 "darker please"): hue stripped, luminance
    // compressed toward ink so the traced image reads dark/inky in our register
    // (like the 3D model) while keeping value separation. The earlier "muddy"
    // dark was the aggressive CLEANUP, not the curve — with the light cleanup +
    // Chaikin smooth, this dark curve reads clean. gamma 1.2 + 0.5 ceiling.
    // VALUE RANGE, not crushed dark (Sebs 2026-06-16 "too dark" — the agreed
    // gameboy-final look): keep a light→dark spread so parts read + the ink
    // outlines stay visible against the fill. pow 1.05 + 0.82 ceiling.
    let n = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    n = Math.pow(n, 1.05) * 0.82;
    const l = Math.max(0, Math.min(255, Math.round(n * 255)));
    return `rgb(${l},${l},${l})`;
  };
  return markup
    .replace(/fill="([^"]+)"/gi, (_m, c) => `fill="${toGrey(c)}"`)
    .replace(/stroke="([^"]+)"/gi, (_m, c) => `stroke="${toGrey(c)}"`)
    .replace(/(fill|stroke)\s*:\s*([^;"'}]+)/gi, (_m, prop, c) => `${prop}:${toGrey(c)}`)
    // Gradient stops carry their own color (a fill="url(#grad)" is left as the ref,
    // so its stops are the only place the hue lives) — grey them too.
    .replace(/stop-color="([^"]+)"/gi, (_m, c) => `stop-color="${toGrey(c)}"`)
    .replace(/stop-color\s*:\s*([^;"'}]+)/gi, (_m, c) => `stop-color:${toGrey(c)}`);
}

// Cached 2D context — the browser's own color parser, used as the robust fallback
// so NO hue ever leaks through valueize (Sebs 2026-06-16 "it's showing purple").
let _colorCanvasCtx: CanvasRenderingContext2D | null | undefined;
function colorCanvas(): CanvasRenderingContext2D | null {
  if (_colorCanvasCtx === undefined) {
    try {
      _colorCanvasCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      _colorCanvasCtx = null;
    }
  }
  return _colorCanvasCtx ?? null;
}

/** Parse ANY CSS color to [r,g,b] 0..255, or null. Fast paths for hex + rgb(); the
 *  canvas FALLBACK normalizes everything else the trace can carry — named colors,
 *  hsl()/hsla(), 8-digit hex — so a purple region never survives greyscaling. */
function parseCssColor(c: string): [number, number, number] | null {
  let m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const h = m[1];
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const h = m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = c.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(',').map((s) => parseFloat(s));
    if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) return [p[0], p[1], p[2]];
  }
  // FALLBACK — let the browser normalize whatever it is, then re-parse the rgb/hex.
  const ctx = colorCanvas();
  if (ctx) {
    try {
      ctx.fillStyle = '#000000';
      ctx.fillStyle = c; // invalid → stays #000000; valid → normalized form
      const norm = String(ctx.fillStyle);
      const hm = norm.match(/^#([0-9a-f]{6})$/i);
      if (hm) {
        const h = hm[1];
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      }
      const rm = norm.match(/rgba?\(([^)]+)\)/i);
      if (rm) {
        const p = rm[1].split(',').map((s) => parseFloat(s));
        if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) return [p[0], p[1], p[2]];
      }
    } catch {
      /* ignore — fall through to null */
    }
  }
  return null;
}

/** Strip the traced PHOTO BACKGROUND — the full-frame region(s) a vectorizer
 *  emits for a photo/screenshot backdrop (a transparent PNG is fine; a Preview
 *  screenshot or a real photo is not — Sebs 2026-06-16). A background region is
 *  one whose bbox TOUCHES ALL FOUR EDGES of the viewBox and covers most of it.
 *  Conservative: only removes when ≥2 non-background shapes remain (so a tight-
 *  cropped object that legitimately fills the frame is never stripped). Uses the
 *  offscreen-mount geometry pattern (same as simplifyToSketch); degrades to the
 *  input unchanged with no DOM / unparseable. */
function dropBackgroundRegions(markup: string): string {
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') return markup;
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return markup;
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (svg.tagName.toLowerCase() !== 'svg') return markup;

  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  let W = 0;
  let H = 0;
  if (vb.length === 4 && vb.every(Number.isFinite)) {
    W = vb[2];
    H = vb[3];
  } else {
    W = parseFloat(svg.getAttribute('width') ?? '0');
    H = parseFloat(svg.getAttribute('height') ?? '0');
  }
  if (!(W > 0) || !(H > 0)) return markup;

  const host = document.createElement('div');
  host.setAttribute(
    'style',
    'position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;',
  );
  const imported = document.importNode(svg, true) as unknown as SVGSVGElement;
  host.appendChild(imported);
  document.body.appendChild(host);
  try {
    const shapes = Array.from(
      imported.querySelectorAll('path,rect,polygon,polyline,circle,ellipse'),
    ) as unknown as SVGGraphicsElement[];
    const eX = W * 0.03; // edge tolerance (3% of the frame)
    const eY = H * 0.03;
    const isBg: SVGGraphicsElement[] = [];
    let nonBg = 0;
    for (const el of shapes) {
      let b: { x: number; y: number; width: number; height: number };
      try {
        b = el.getBBox();
      } catch {
        nonBg++;
        continue;
      }
      const touchesAllEdges =
        b.x <= eX && b.y <= eY && b.x + b.width >= W - eX && b.y + b.height >= H - eY;
      const coverage = (b.width / W) * (b.height / H);
      if (touchesAllEdges && coverage >= 0.85) isBg.push(el);
      else nonBg++;
    }
    // Only strip the background when a real object clearly remains.
    if (isBg.length > 0 && nonBg >= 2) {
      for (const el of isBg) el.parentNode?.removeChild(el);
      return new XMLSerializer().serializeToString(imported);
    }
    return markup;
  } finally {
    document.body.removeChild(host);
  }
}

/** Drop tiny ISOLATED trace specks — the stray dots Quiver leaves floating OFF the
 *  object (Sebs 2026-06-16 "the dot in the upper left it's artifact"). A speck = a
 *  shape that is both TINY (< SPECK_MAX_AREA of the frame) AND spatially SEPARATED
 *  from every large region (its bbox doesn't touch any "body" shape's bbox within a
 *  small margin). Buttons / detail marks sit ON the object → their bbox overlaps a
 *  body region → kept. Conservative by construction: needs a clear big region to
 *  anchor against, only drops shapes detached from ALL of them, and keeps ≥3 shapes.
 *  Same offscreen-mount geometry pattern as dropBackgroundRegions; degrades to the
 *  input unchanged with no DOM / unparseable. */
function dropIsolatedSpecks(markup: string): string {
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') return markup;
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return markup;
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (svg.tagName.toLowerCase() !== 'svg') return markup;

  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  let W = 0;
  let H = 0;
  if (vb.length === 4 && vb.every(Number.isFinite)) {
    W = vb[2];
    H = vb[3];
  } else {
    W = parseFloat(svg.getAttribute('width') ?? '0');
    H = parseFloat(svg.getAttribute('height') ?? '0');
  }
  if (!(W > 0) || !(H > 0)) return markup;

  const host = document.createElement('div');
  host.setAttribute(
    'style',
    'position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;',
  );
  const imported = document.importNode(svg, true) as unknown as SVGSVGElement;
  host.appendChild(imported);
  document.body.appendChild(host);
  try {
    const shapes = Array.from(
      imported.querySelectorAll('path,rect,polygon,polyline,circle,ellipse'),
    ) as unknown as SVGGraphicsElement[];
    const total = W * H;
    type Box = { x: number; y: number; width: number; height: number };
    const boxes = new Map<SVGGraphicsElement, Box>();
    for (const el of shapes) {
      try {
        boxes.set(el, el.getBBox());
      } catch {
        /* unmeasurable → leave it alone (never drop what we can't size) */
      }
    }
    const BIG_AREA = 0.02; // a real "body" region (≥2% of the frame)
    const SPECK_MAX_AREA = 0.0025; // tiny enough to be noise, smaller than a button
    const margin = Math.min(W, H) * 0.02; // "touching" tolerance
    const bigs = [...boxes.entries()].filter(([, b]) => (b.width * b.height) / total >= BIG_AREA);
    if (bigs.length === 0) return markup; // nothing solid to anchor against → bail

    const near = (a: Box, b: Box) =>
      a.x <= b.x + b.width + margin &&
      a.x + a.width >= b.x - margin &&
      a.y <= b.y + b.height + margin &&
      a.y + a.height >= b.y - margin;

    const toDrop: SVGGraphicsElement[] = [];
    for (const [el, b] of boxes) {
      if ((b.width * b.height) / total >= SPECK_MAX_AREA) continue; // not tiny
      const attached = bigs.some(([be, bb]) => be !== el && near(b, bb));
      if (!attached) toDrop.push(el); // tiny AND detached from every body region
    }
    if (toDrop.length > 0 && boxes.size - toDrop.length >= 3) {
      for (const el of toDrop) el.parentNode?.removeChild(el);
      return new XMLSerializer().serializeToString(imported);
    }
    return markup;
  } finally {
    document.body.removeChild(host);
  }
}

/** Turn a (valueized) Quiver trace into our line-art register: strip <text>
 *  labels, ink-ify any existing stroke (attr OR inline style — kills Quiver's
 *  faint colored edge strokes), and add an ink OUTLINE to every region shape
 *  that has none. Pure string transform (no DOM), Make-safe. The ink token is a
 *  fixed dark (#161310) — image marks ride fixed media, never page-direction
 *  tokens (feedback_media_overlay_ink_doesnt_flip). */
const LINE_INK = '#161310';
function toLineArt(markup: string): string {
  // 1) drop <text> labels (huge after <style> is sanitized away — Sebs).
  let out = markup.replace(/<text[\s\S]*?<\/text>/gi, '');
  // 2) ink-ify every existing stroke (attr + inline style), leave none/url().
  out = out
    .replace(/stroke="(?!none|url\()[^"]*"/gi, `stroke="${LINE_INK}"`)
    .replace(/stroke:\s*(?!none|url\()[^;"'}]+/gi, `stroke:${LINE_INK}`);
  // 3) add an ink outline to every region shape that has no stroke yet.
  out = out.replace(
    /<(path|polygon|polyline|rect|circle|ellipse)\b((?:(?!\/?>)[\s\S])*?)(\/?)>/gi,
    (full, tag, attrs, slash) => {
      if (/stroke\s*[:=]/i.test(attrs)) return full; // already inked above
      return `<${tag}${attrs} stroke="${LINE_INK}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"${slash}>`;
    },
  );
  return out;
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Convert a raster image File to sanitized, SIMPLIFIED-TO-SKETCH SVG markup
 * ready for the desk pipeline. Pipeline:
 *
 *   validate (type + size cap)
 *     → selected provider (Quiver Edge, best quality) returns a faithful trace
 *     → simplifyToSketch() abstracts the trace to a few hand-drawn strokes
 *       (the differentiator: path-salience filter + RDP + fill→outline)
 *     → sanitizeSvgMarkup() (the SAME DOMPurify SVG profile every uploaded/DB
 *       SVG passes through — a hosted provider can never inject script/etc.)
 *
 * The returned `markup` is the exact thing the caller hands to the desk add
 * boundary — identical contract to a prepared .svg upload — plus `sketch` stats
 * for honest UI copy + the smart-layer dataset.
 *
 * `sketchify` lets a caller tune the abstraction (or pass `false` to skip it and
 * get the raw trace — e.g. if the user explicitly wants a faithful vectorize).
 */
// LIGHT artifact cleanup for the image path — drops the noise specks Quiver
// leaves (Sebs: "a bunch of weird artifacts") + a gentle RDP, but KEEPS FILLS
// and the structure. This is the "match-us filter when needed" for Quiver's
// noise — NOT the destructive few-strokes abstraction (that demolished the
// picture). maxPaths high enough to keep real detail; minAreaFrac trims specks.
const IMAGE_CLEANUP: Partial<SketchifyOptions> = {
  // Sebs 2026-06-16 "too dark the fills": keeping ~300 regions stacked ~300 dark
  // outlines → near-black. The approved gameboy-final used ~30 bold regions →
  // clean + light. Drop the small regions so there are FEW outlines.
  minAreaFrac: 0.004,
  maxPaths: 32,
  rdpEpsilon: 1.6,
  outlineFills: false, // keep fills → tone survives for Smart Hachure + Clean base
  chaikinSmooth: 2, // round Quiver's faceted region edges into clean curves
};

export async function imageToSvg(
  file: File,
  sketchify: Partial<SketchifyOptions> | false = IMAGE_CLEANUP,
): Promise<ImageToSvgResult> {
  const valid = validateImage(file);
  if (!valid.ok) return valid;

  const provider = selectProvider();
  const converted = await provider.convert(file);
  if (!converted.ok) return converted;

  // Extract the <svg> element from the provider output (treat as untrusted).
  const match = converted.markup.match(/<svg[\s\S]*<\/svg>/i);
  if (!match) return { ok: false, error: 'Traced output had no <svg> element.' };
  let working = match[0];
  let sketchStats: SketchifyResult['stats'] | undefined;

  // MATCH-US, DON'T ABSTRACT (Sebs 2026-06-16): the Quiver trace IS the image
  // filter — it already abstracts the photo to vector regions. We only run a
  // LIGHT cleanup (IMAGE_CLEANUP: drop artifact specks + gentle RDP, KEEP FILLS)
  // to remove Quiver's noise, never the destructive few-strokes abstraction.
  // Quiver returns FILLED regions carrying the photo's tone → the Clean style
  // renders them as our baseline (filled), and a shading style hachures the dark
  // regions = the differentiator. Pass `false` to skip cleanup entirely.
  if (sketchify !== false) {
    const result = simplifyToSketch(working, sketchify);
    working = result.markup;
    sketchStats = result.stats;
  }

  // OUR REGISTER (Sebs 2026-06-16, "why is it in color, ugly"): a photo trace
  // comes back in full COLOR. Desk Doodles is value-not-hue, so map every fill /
  // stroke color to its LUMINANCE — the traced image then reads in our ink
  // register. Fills are KEPT (only desaturated) so the dark regions still carry
  // tone for Smart Hachure to shade. Pure string transform, no DOM.
  // NO BACKGROUND (Sebs 2026-06-16): Quiver traces the PHOTO'S BACKGROUND as a
  // full-frame region → a black rectangle fills the canvas with the object on
  // top. Strip the background BEFORE valueize/outline so we keep only the object.
  working = dropBackgroundRegions(working);

  // Drop the stray floating specks Quiver leaves OFF the object (the "dot in the
  // upper left" — Sebs 2026-06-16). Runs AFTER background removal so the body
  // regions are what's left to anchor against; conservative (only detached tiny
  // shapes go, attached detail stays). Before valueize so it works on real fills.
  working = dropIsolatedSpecks(working);

  working = valueizeColors(working);

  // OUR LINE-ART REGISTER (Sebs 2026-06-16, the Game Boy sessions): a Quiver
  // trace is FILLED regions with no real outlines → reads as color blobs, and
  // our hand-drawn styles have no lines to draw. Our doodles ALWAYS have
  // outlines, so: strip <text> labels (they render huge once <style> is
  // sanitized away), ink-ify Quiver's faint native edge strokes, and add an ink
  // outline to every region. Result = lines + fill, in our register.
  working = toLineArt(working);

  // Sanitize LAST: whatever the provider + our transform produced, it passes the
  // same gate as a file upload before it can reach dangerouslySetInnerHTML.
  const clean = sanitizeSvgMarkup(working);
  if (!/<svg[\s\S]*<\/svg>/i.test(clean)) {
    return { ok: false, error: 'Traced SVG could not be safely sanitized.' };
  }

  // Keep the downscaled ORIGINAL photo for the hard-path 3D (send the real photo
  // to TRELLIS, not the doodle). Best-effort — never fails the trace result.
  let sourceImage: string | undefined;
  try {
    if (typeof document !== 'undefined') {
      sourceImage = `data:image/jpeg;base64,${await fileToTracerBase64(file, 1280, 0.9)}`;
    }
  } catch {
    /* best-effort — the hard path falls back to rasterizing the doodle */
  }
  return { ok: true, markup: clean, sketch: sketchStats, sourceImage };
}

/** Default sketchify options (re-exported for callers/UI that surface the knobs). */
export { DEFAULT_SKETCHIFY };

/** Whether the active provider needs a server-side key (for honest UI copy:
 *  the unconfigured fallback vs. the hosted Quiver path). */
export function activeProviderNeedsKey(): boolean {
  return selectProvider().needsKey;
}

/** The active provider's human label (for UI: "Quiver Arrow (best quality)"
 *  vs "Image tracing (not configured)"). */
export function activeProviderLabel(): string {
  return selectProvider().label;
}
