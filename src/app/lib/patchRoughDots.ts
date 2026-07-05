// Runtime determinism patch for rough.js's dots filler (rough.js issue #211).
//
// The stock DotFiller jitters each dot position with raw `Math.random()`, ignoring
// the seeded randomizer every other filler honors — so fillStyle='dots'
// re-renders with dots in NEW positions every time, violating Smart Hachure
// invariant I-7 (same input + seed → identical output) and shimmering across
// toggle changes / demo takes.
//
// Why a runtime prototype patch (not patch-package, not a node_modules edit):
// Figma Make installs dependencies fresh from public npm — file edits and
// postinstall hooks don't reliably travel (per 20-research Make constraints).
// This patch lives in OUR bundle, so it works identically local + Make.
//
// The override is a faithful copy of dotsOnLines with exactly two lines
// changed: `Math.random() * 2 * ro` → `helper.randOffsetWithRange(-ro, ro, o)`
// (same uniform [-ro, +ro] distribution, but drawn from the seeded
// randomizer). Sanctioned by 18-scope-audit §H-6 + 09-LOCKED-MODEL §5
// ("vendored where needed — fix #211"); full Secord/CCVT dot replacement
// remains the scheduled Smart Phase A work.
//
// 2026-06-11 dotScatter wiring: the slider now also scatters the rough.js
// dots FILL (was texture-recipe only) by scaling the seeded jitter RANGE.
// dotScatter is threaded in via a custom option key (preserved by rough.js's
// shallow option-merge; see SvgStyleTransform's dots-fill construction). The
// scatterFactor curve is exactly 1.0 at the 0.3 default so the golden v2
// baseline is byte-identical (the helper's seeded draw is unchanged at the
// default). Determinism is fully preserved — only the [-ro, +ro] RANGE handed
// to the SAME seeded randOffsetWithRange changes; no new randomness source is
// introduced, never Math.random. NOTE: the dominant shading path builds the
// dots fill with roughness:0, where randOffsetWithRange collapses to 0 — so
// the visible effect of this slider is on the dots-fill outline path (where
// roughness = jaggedness can be > 0) and composes with the stipple TEXTURE
// recipe scatter. Making it bite at roughness:0 too is a follow-up (would
// shift the blessed default and needs a golden re-bless).

import { DotFiller } from 'roughjs/bin/fillers/dot-filler';
import { lineLength } from 'roughjs/bin/geometry';
import type { Line } from 'roughjs/bin/geometry';
import type { ResolvedOptions, OpSet, Op } from 'roughjs/bin/core';
import type { RenderHelper } from 'roughjs/bin/fillers/filler-interface';

let applied = false;

export function applyRoughDotsDeterminismPatch(): void {
  if (applied) return;
  applied = true;

  // dotsOnLines is `private` in the d.ts — runtime patching needs the cast.
  const proto = DotFiller.prototype as unknown as {
    helper: RenderHelper;
    dotsOnLines(lines: Line[], o: ResolvedOptions): OpSet;
  };

  proto.dotsOnLines = function (lines: Line[], o: ResolvedOptions): OpSet {
    const ops: Op[] = [];
    let gap = o.hachureGap;
    if (gap < 0) {
      gap = o.strokeWidth * 4;
    }
    gap = Math.max(gap, 0.1);
    let fweight = o.fillWeight;
    if (fweight < 0) {
      fweight = o.strokeWidth / 2;
    }
    // dotScatter scales the seeded jitter RANGE. scatterFactor is exactly 1.0
    // at the 0.3 default (so ro is unchanged → golden v2 baseline byte-
    // identical), widens above, tightens toward the grid below. 0.4 + 2.0·s
    // mirrors the stipple-TEXTURE scatter curve (modifierSpecs §dotScatter) so
    // the two scatter knobs read consistently.
    const scatterRaw = (o as { dotScatter?: number }).dotScatter;
    const scatterFactor =
      typeof scatterRaw === 'number' ? 0.4 + 2.0 * scatterRaw : 1.0;
    const ro = (gap / 4) * scatterFactor;
    for (const line of lines) {
      const length = lineLength(line);
      const dl = length / gap;
      const count = Math.ceil(dl) - 1;
      const offset = length - count * gap;
      const x = (line[0][0] + line[1][0]) / 2 - gap / 4;
      const minY = Math.min(line[0][1], line[1][1]);
      for (let i = 0; i < count; i++) {
        const y = minY + offset + i * gap;
        // THE FIX — seeded jitter instead of Math.random()
        const cx = x + this.helper.randOffsetWithRange(-ro, ro, o);
        const cy = y + this.helper.randOffsetWithRange(-ro, ro, o);
        const el = this.helper.ellipse(cx, cy, fweight, fweight, o);
        ops.push(...el.ops);
      }
    }
    return { type: 'fillSketch', ops };
  };
}
