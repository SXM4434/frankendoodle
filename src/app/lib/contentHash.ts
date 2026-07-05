// Content hashing for pipeline cache keys.
//
// Per docs/research/21-research-3d-pipeline-and-style-translation.md §3:
// `Stage.cacheKey?(input) — SubtleCrypto SHA-1 of normalized input`. SHA-1 is
// fine here — these are cache keys, not security hashes.
//
// Cache points that key off this hash (§3 cache strategy + §5/risk table):
//   • conversion cache (classification / treatment results)
//   • GLB blobs in OPFS (hard-path 3D — biggest cache win)
//   • vision-LLM analysis results (Claude tier-1 = 50 RPM at demo time)
//   • demo pre-warm (hash the demo inputs ahead of time, demo from cache)
//
// Live now — used by publish.ts to stamp each published doodle's content_hash
// (the cache-key column on public.doodles).

/**
 * SHA-1 content hash → lowercase hex string. Strings are hashed over their
 * UTF-8 bytes; Blobs over their raw bytes. Same content always yields the
 * same key, so normalized inputs (see normalizeInput.ts) dedupe across
 * sessions and across the Supabase-cached mode-flip.
 */
export async function contentHash(input: string | Blob): Promise<string> {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : new Uint8Array(await input.arrayBuffer());
  // SubtleCrypto is UNAVAILABLE in a non-secure context (http://, some embeds /
  // judge sandboxes / file://) — calling it there throws and crashed PUBLISH
  // (Sebs 2026-06-19). Guard it and fall back to a pure-JS SHA-1 so hashing never
  // crashes. Same SHA-1 algorithm → byte-identical cache keys both ways, so the
  // Supabase content_hash column stays consistent regardless of context.
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    try {
      const digest = await crypto.subtle.digest('SHA-1', bytes);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Some engines expose crypto.subtle but reject SHA-1 in an insecure
      // context — fall through to the JS implementation.
    }
  }
  return sha1Hex(bytes);
}

/** Pure-JS SHA-1 (FIPS 180-1) over a byte array → lowercase hex. Matches
 *  SubtleCrypto's 'SHA-1' output exactly, so it's a drop-in fallback when
 *  crypto.subtle is unavailable (non-secure context). */
function sha1Hex(bytes: Uint8Array): string {
  const rotl = (n: number, s: number) => (n << s) | (n >>> (32 - s));
  const ml = bytes.length * 8;
  const total = (bytes.length + 1 + 8 + 63) & ~63; // padded to a multiple of 64
  const msg = new Uint8Array(total);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, Math.floor(ml / 0x100000000)); // length high word
  dv.setUint32(total - 4, ml >>> 0); // length low word

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      let f: number, k: number;
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const tmp = (rotl(a, 5) + f + e + k + w[t]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4);
}
