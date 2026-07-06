// Frankendoodle — face feature detection. After the skeleton is found, look for
// the creature's OWN eyes and mouth in the drawn strokes so it can emote through
// its real face (blink, widen in fear, open its mouth) instead of only body-
// acting. Pure heuristics — best-effort, like the rig: a clear pair of small
// round marks up top reads as eyes; a wide low mark reads as a mouth. When the
// drawing has no clear face, nothing is tagged and the creature just body-acts.

import type { StrokePoint } from '../../components/DeskDoodles/DrawSurface';
import type { Vec } from './autoRig';

export type FeatureTag = 'eye' | 'mouth' | null;

export interface FaceMap {
  /** one tag per stroke (by index), aligned with the strokes array */
  tags: FeatureTag[];
  eyes: number; // how many eye strokes were found (0–2)
  mouth: boolean;
}

interface StrokeStat {
  i: number;
  cx: number; cy: number; // centroid
  w: number; h: number; // bbox size
  size: number; // max dimension
  round: number; // aspect max/min (1 = circle)
}

function stat(s: StrokePoint[], i: number): StrokeStat {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, sx = 0, sy = 0;
  for (const [x, y] of s) { if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; sx += x; sy += y; }
  const n = s.length || 1;
  const w = maxx - minx, h = maxy - miny;
  return { i, cx: sx / n, cy: sy / n, w, h, size: Math.max(w, h), round: Math.max(w, h) / Math.max(1, Math.min(w, h)) };
}

/** Detect eyes + mouth. `root` is the rig's body hub — everything meaningfully
 * above it is the head/face region, which adapts to any morphology. */
export function detectFeatures(strokes: StrokePoint[][], bbox: { x: number; y: number; w: number; h: number }, root: Vec): FaceMap {
  const tags: FeatureTag[] = strokes.map(() => null);
  const diag = Math.hypot(bbox.w, bbox.h) || 1;
  // face zone = above the body hub (or the upper half, whichever is lower)
  const faceY = Math.min(root.y, bbox.y + bbox.h * 0.5);
  const stats = strokes.map((s, i) => stat(s, i)).filter((s) => Number.isFinite(s.cx));

  // ── eyes: small, roundish marks up in the face zone ──
  const eyeCand = stats.filter((s) => s.cy < faceY && s.size < diag * 0.17 && s.size > diag * 0.004 && s.round < 3.6);
  let bestPair: [StrokeStat, StrokeStat] | null = null, bestScore = -Infinity;
  for (let a = 0; a < eyeCand.length; a++) {
    for (let b = a + 1; b < eyeCand.length; b++) {
      const p = eyeCand[a], q = eyeCand[b];
      const dy = Math.abs(p.cy - q.cy), dx = Math.abs(p.cx - q.cx);
      if (dy > diag * 0.15) continue; // eyes sit roughly level
      if (dx < diag * 0.02 || dx > diag * 0.55) continue; // sensible separation
      const ratio = Math.max(p.size, q.size) / Math.max(1, Math.min(p.size, q.size));
      if (ratio > 2.4) continue; // a matched pair
      const score = 1000 - dy - (ratio - 1) * 60 - ((p.cy + q.cy) / 2) * 0.2 - (p.round + q.round) * 10;
      if (score > bestScore) { bestScore = score; bestPair = [p, q]; }
    }
  }
  let eyeY = faceY, eyes = 0;
  if (bestPair) { tags[bestPair[0].i] = 'eye'; tags[bestPair[1].i] = 'eye'; eyeY = (bestPair[0].cy + bestPair[1].cy) / 2; eyes = 2; }
  else if (eyeCand.length === 1 && eyeCand[0].round < 1.9 && eyeCand[0].cy < bbox.y + bbox.h * 0.34) {
    tags[eyeCand[0].i] = 'eye'; eyeY = eyeCand[0].cy; eyes = 1; // a cyclops still gets to blink
  }

  // ── mouth: a wide, low mark below the eyes but still up front ──
  let mouth: StrokeStat | null = null;
  for (const s of stats) {
    if (tags[s.i]) continue;
    if (s.cy <= eyeY + diag * 0.02) continue; // below the eyes
    if (s.cy > faceY + bbox.h * 0.14) continue; // not down in the belly
    if (s.w < s.h * 1.2 || s.w < diag * 0.05) continue; // wider than tall
    if (s.w > diag * 0.5) continue; // not the whole head outline
    if (!mouth || s.w > mouth.w) mouth = s;
  }
  if (mouth) tags[mouth.i] = 'mouth';

  return { tags, eyes, mouth: !!mouth };
}

/** Deform the tagged eye/mouth strokes in place (posed drawing space) to express
 * a facial state. `eyeClose` 0→1 blink, `eyeWide` 0→1 startle, `mouthOpen` 0→1. */
export function applyFace(ps: StrokePoint[][], tags: FeatureTag[], eyeClose: number, eyeWide: number, mouthOpen: number): void {
  for (let i = 0; i < ps.length; i++) {
    const tag = tags[i];
    if (!tag) continue;
    const s = ps[i];
    if (!s.length) continue;
    if (tag === 'eye') {
      let cx = 0, cy = 0;
      for (const p of s) { cx += p[0]; cy += p[1]; }
      cx /= s.length; cy /= s.length;
      const g = 1 + eyeWide * 0.4; // fear widens the eye
      const sy = g * (1 - eyeClose * 0.92); // a blink squashes it shut
      for (const p of s) { p[0] = cx + (p[0] - cx) * g; p[1] = cy + (p[1] - cy) * sy; }
    } else {
      // mouth opens downward — anchor at its top edge, like a jaw dropping
      let cx = 0, topY = Infinity;
      for (const p of s) { cx += p[0]; if (p[1] < topY) topY = p[1]; }
      cx /= s.length;
      const sy = 1 + mouthOpen * 1.0, sxx = 1 + mouthOpen * 0.1;
      for (const p of s) { p[0] = cx + (p[0] - cx) * sxx; p[1] = topY + (p[1] - topY) * sy; }
    }
  }
}
