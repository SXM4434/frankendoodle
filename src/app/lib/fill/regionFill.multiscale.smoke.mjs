// ─── regionFill MULTI-SCALE smoke test — synthetic, node-runnable ────────────
//
// Validates fillRegionAtMultiScale (the §1A TRAPPED-BALL multi-scale fill) on
// the two-failure trap a single gap-close cannot escape:
//
//   (1) TINY NESTED: a small triangle inside a big circle.
//         · tap inside the triangle → fill bbox ≈ the TRIANGLE (small),
//           NOT the whole circle.
//         · tap the ring (between triangle and circle) → fills the ring WITH
//           the triangle as a HOLE.
//   (2) DONUT (concentric circles):
//         · tap the ring → fills the FULL ring (bbox ≈ the BIG circle),
//           NOT a spurious sliver.
//         · tap inner → fills the inner disk.
//   (3) NO-BLEED: no output fill cell lies on the OUTER side of the original
//       ink (the fill never crosses the wall) — verified in raster space.
//
// Run:  node src/app/lib/fill/regionFill.multiscale.smoke.mjs
//
// Bundles the REAL regionFill.ts (resolving polygon-clipping) via esbuild — so
// these assertions exercise the actual shipped code, not a copy. Mirrors
// regionFill.smoke.mjs's loader.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadModule() {
  const result = await build({
    entryPoints: [join(__dirname, 'regionFill.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

// ── assertion helpers ──
let failures = 0;
let passes = 0;
function assert(cond, msg) {
  if (cond) {
    passes++;
    console.log('  PASS  ' + msg);
  } else {
    failures++;
    console.log('  FAIL  ' + msg);
  }
}

// ── synthetic geometry (world-ish coords centered near origin) ──
// A closed circle polyline. gapFrac>0 leaves an open arc (freehand-ish).
function circle(cx, cy, rad, n = 96, gapFrac = 0) {
  const pts = [];
  const skip = Math.floor(n * gapFrac);
  for (let i = 0; i <= n - skip; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return pts;
}
// A closed equilateral-ish triangle centered at (cx,cy), "radius" rad to verts.
function triangle(cx, cy, rad) {
  const pts = [];
  for (let i = 0; i <= 3; i++) {
    const a = -Math.PI / 2 + (i / 3) * Math.PI * 2;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return pts; // last == first (closed)
}

// bbox helpers on a ring.
function bbox(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { w: x1 - x0, h: y1 - y0, x0, y0, x1, y1 };
}

async function main() {
  console.log('Loading regionFill.ts via esbuild bundle...');
  const M = await loadModule();
  const { fillRegionAtMultiScale, rasterInkMask, closeGaps, spanFlood, growUnderInk } = M;
  assert(typeof fillRegionAtMultiScale === 'function', 'fillRegionAtMultiScale is exported');

  // Common opts. inkRadius = the visible ink (~0.02 world, per the caller).
  // gapClosePx is the TOP of the descending trapped-ball ladder.
  const inkRadius = 0.02;
  const resolution = 400;
  const opts = { inkRadius, resolution, maxResolution: resolution, gapClosePx: 0.4 };

  // ════ (1) TINY NESTED: small triangle inside a big circle ════
  console.log('\n(1) TINY NESTED — small triangle inside a big circle:');
  {
    const bigCircle = circle(0, 0, 3); // r=3 → diameter 6
    const smallTri = triangle(0, 0, 0.6); // verts at 0.6 → small, well inside
    const strokes = [bigCircle, smallTri];

    const triBB = bbox(smallTri);
    const circBB = bbox(bigCircle);
    console.log(`    triangle bbox ≈ ${triBB.w.toFixed(2)} x ${triBB.h.toFixed(2)} ; circle bbox ≈ ${circBB.w.toFixed(2)} x ${circBB.h.toFixed(2)}`);

    // tap inside the triangle (its centroid is the origin) → should fill ONLY
    // the triangle, NOT the whole circle.
    const inTri = fillRegionAtMultiScale(strokes, 0, 0, opts);
    assert(inTri !== null, 'tap inside the nested triangle returns a fill');
    if (inTri) {
      const fb = bbox(inTri.outline);
      console.log(`    tap-in-triangle fill bbox = ${fb.w.toFixed(3)} x ${fb.h.toFixed(3)} (want ≈ triangle ${triBB.w.toFixed(2)}, NOT circle ${circBB.w.toFixed(2)})`);
      // fill bbox ≈ triangle: well under HALF the circle's width.
      assert(fb.w < circBB.w * 0.5, `tiny-nested fill width (${fb.w.toFixed(2)}) << circle width (${circBB.w.toFixed(2)}) — filled the TRIANGLE, not the circle`);
      // and it's actually triangle-scale (within a generous band of the tri bbox).
      assert(fb.w <= triBB.w * 1.5 && fb.w >= triBB.w * 0.5, `tiny-nested fill width (${fb.w.toFixed(2)}) ≈ triangle width (${triBB.w.toFixed(2)})`);
    }

    // tap in the RING (between triangle and circle, e.g. (0, 2)) → fills the
    // ring with the triangle as a HOLE.
    const inRing = fillRegionAtMultiScale(strokes, 0, 2, opts);
    assert(inRing !== null, 'tap in the ring (circle minus triangle) returns a fill');
    if (inRing) {
      const fb = bbox(inRing.outline);
      console.log(`    tap-in-ring fill bbox = ${fb.w.toFixed(2)} x ${fb.h.toFixed(2)} (want ≈ circle ${circBB.w.toFixed(2)}) ; holes = ${inRing.holes.length}`);
      assert(fb.w >= circBB.w * 0.7, `ring fill width (${fb.w.toFixed(2)}) ≈ circle width (${circBB.w.toFixed(2)}) — filled the FULL ring`);
      assert(inRing.holes.length >= 1, `ring fill has >=1 hole (the triangle island) — got ${inRing.holes.length}`);
    }
  }

  // ════ (2) DONUT: concentric circles ════
  console.log('\n(2) DONUT — concentric circles (ring + inner disk):');
  {
    const outer = circle(0, 0, 3); // r=3, width ≈ 6
    const inner = circle(0, 0, 1.2); // r=1.2, width ≈ 2.4
    const strokes = [outer, inner];
    const outerBB = bbox(outer);
    const innerBB = bbox(inner);
    console.log(`    outer width ≈ ${outerBB.w.toFixed(2)} ; inner width ≈ ${innerBB.w.toFixed(2)}`);

    // tap the RING (between r=1.2 and r=3, e.g. (0, 2.1)) → FULL ring, bbox ≈
    // outer circle. This is THE bug: a naive increasing-radius first-bound
    // returned a sliver; multi-scale returns the full ring.
    const ring = fillRegionAtMultiScale(strokes, 0, 2.1, opts);
    assert(ring !== null, 'tap the donut ring returns a fill');
    if (ring) {
      const fb = bbox(ring.outline);
      console.log(`    DONUT-RING-FULL fill bbox = ${fb.w.toFixed(3)} x ${fb.h.toFixed(3)} (want ≈ outer ${outerBB.w.toFixed(2)}, NOT a sliver)`);
      assert(fb.w >= outerBB.w * 0.85, `donut ring fills the FULL ring: width ${fb.w.toFixed(2)} ≈ outer ${outerBB.w.toFixed(2)} (no spurious sliver)`);
      assert(ring.holes.length >= 1, `donut ring has the inner disk as a hole — got ${ring.holes.length}`);
    }

    // tap the INNER disk (origin) → fills the inner disk (bbox ≈ inner circle).
    const disk = fillRegionAtMultiScale(strokes, 0, 0, opts);
    assert(disk !== null, 'tap the donut inner disk returns a fill');
    if (disk) {
      const fb = bbox(disk.outline);
      console.log(`    TINY-NESTED-ONLY (inner disk) fill bbox = ${fb.w.toFixed(3)} x ${fb.h.toFixed(3)} (want ≈ inner ${innerBB.w.toFixed(2)}, NOT outer ${outerBB.w.toFixed(2)})`);
      assert(fb.w < outerBB.w * 0.6, `inner-disk fill width ${fb.w.toFixed(2)} << outer ${outerBB.w.toFixed(2)} — filled the inner disk, not the whole donut`);
      assert(fb.w >= innerBB.w * 0.7, `inner-disk fill width ${fb.w.toFixed(2)} ≈ inner ${innerBB.w.toFixed(2)}`);
    }
  }

  // ════ (2b) GAPPY DONUT: freehand outer circle with a real pen-up gap ════
  // THE app bug: a hand-drawn outer circle has a small arc missing. At small
  // ball radii the ring LEAKS through the gap (flood touches border → discarded)
  // and only a SMALL gap-pocket artifact bounds at some radius — so the OLD
  // (halving, caller-capped) ladder picked that ~93px SLIVER instead of the full
  // ring. The full ring only bounds once a ball BIG enough to seal the gap is
  // rolled, which a too-low / too-coarse ladder never sampled. The FIX scales
  // the ladder ceiling to the shape + uses dense steps, so the gappy ring fills
  // FULL (bbox ≈ the outer circle, NOT a ~1/6 sliver) with the inner as a hole.
  console.log('\n(2b) GAPPY DONUT — freehand outer circle with a ~6% arc gap:');
  {
    // gapFrac 0.06 → floor(96·0.06)=5 of 96 segments removed ≈ 5.2% of the
    // circumference, an arc ≈ 0.98 coord wide — squarely in the "~5-8%" band a
    // real freehand pen-up leaves. Full inner circle (no gap).
    const gappyOuter = circle(0, 0, 3, 96, 0.06);
    const inner = circle(0, 0, 1.2);
    const strokes = [gappyOuter, inner];
    const outerBB = bbox(gappyOuter); // bbox of the drawn arc (≈ full circle: the
    //   gap is a chord, the bbox still spans the circle to within ~ink width).
    const innerBB = bbox(inner);
    console.log(`    gappy-outer bbox ≈ ${outerBB.w.toFixed(2)} x ${outerBB.h.toFixed(2)} ; inner ≈ ${innerBB.w.toFixed(2)}`);

    // tap the RING at (0, 2.1) → fills the FULL ring (NOT a sliver), inner = hole.
    const ring = fillRegionAtMultiScale(strokes, 0, 2.1, opts);
    assert(ring !== null, 'GAPPY: tap the gappy donut ring returns a fill (not a miss)');
    if (ring) {
      const fb = bbox(ring.outline);
      console.log(`    GAPPY-RING-FULL fill bbox = ${fb.w.toFixed(3)} x ${fb.h.toFixed(3)} (want ≈ outer ${outerBB.w.toFixed(2)}, NOT a ~${(outerBB.w / 6).toFixed(2)} sliver)`);
      // FULL ring: width ≈ the outer circle, NOT the ~1/6 sliver the old ladder
      // returned. 0.85·outer is the same bar the closed-donut ring uses.
      assert(
        fb.w >= outerBB.w * 0.85,
        `GAPPY ring fills the FULL ring: width ${fb.w.toFixed(2)} ≈ outer ${outerBB.w.toFixed(2)} (NOT a ~1/6 sliver)`,
      );
      // explicit anti-sliver: must be far bigger than a 1/6-width artifact.
      assert(
        fb.w > outerBB.w / 3,
        `GAPPY ring is NOT a sliver: width ${fb.w.toFixed(2)} >> 1/3·outer (${(outerBB.w / 3).toFixed(2)})`,
      );
      assert(ring.holes.length >= 1, `GAPPY ring has the inner disk as a hole — got ${ring.holes.length}`);
    }

    // tap the INNER disk (origin) → fills the inner disk (bbox ≈ inner circle),
    // unaffected by the outer gap.
    const disk = fillRegionAtMultiScale(strokes, 0, 0, opts);
    assert(disk !== null, 'GAPPY: tap the inner disk returns a fill');
    if (disk) {
      const fb = bbox(disk.outline);
      console.log(`    GAPPY inner-disk fill bbox = ${fb.w.toFixed(3)} x ${fb.h.toFixed(3)} (want ≈ inner ${innerBB.w.toFixed(2)}, NOT outer ${outerBB.w.toFixed(2)})`);
      assert(fb.w < outerBB.w * 0.6, `GAPPY inner-disk width ${fb.w.toFixed(2)} << outer ${outerBB.w.toFixed(2)} — filled the inner disk`);
      assert(fb.w >= innerBB.w * 0.7, `GAPPY inner-disk width ${fb.w.toFixed(2)} ≈ inner ${innerBB.w.toFixed(2)}`);
    }
  }

  // ════ (2c) TINY-NESTED still isolates with a GAPPY outer circle ════
  // The gappy-donut fix raises the ladder ceiling — re-prove it doesn't break
  // the tiny-nested trap protection: a small triangle inside a GAPPY big circle
  // still fills the TRIANGLE only (not the whole circle) when tapped inside it.
  console.log('\n(2c) TINY-NESTED inside a GAPPY circle still fills the triangle only:');
  {
    const gappyCircle = circle(0, 0, 3, 96, 0.06);
    const smallTri = triangle(0, 0, 0.6);
    const strokes = [gappyCircle, smallTri];
    const triBB = bbox(smallTri);
    const circBB = bbox(gappyCircle);
    const inTri = fillRegionAtMultiScale(strokes, 0, 0, opts);
    assert(inTri !== null, 'GAPPY+NESTED: tap inside the triangle returns a fill');
    if (inTri) {
      const fb = bbox(inTri.outline);
      console.log(`    tap-in-triangle (gappy parent) fill bbox = ${fb.w.toFixed(3)} (want ≈ triangle ${triBB.w.toFixed(2)}, NOT circle ${circBB.w.toFixed(2)})`);
      assert(fb.w < circBB.w * 0.5, `GAPPY+NESTED tri-fill width ${fb.w.toFixed(2)} << circle ${circBB.w.toFixed(2)} — filled the TRIANGLE`);
      assert(fb.w <= triBB.w * 1.5 && fb.w >= triBB.w * 0.5, `GAPPY+NESTED tri-fill width ${fb.w.toFixed(2)} ≈ triangle ${triBB.w.toFixed(2)}`);
    }
  }

  // ════ (3) NO-BLEED: fill never crosses to the outer side of the ink ════
  console.log('\n(3) NO-BLEED — no fill cell on the outer side of the original ink:');
  {
    // use the donut ring (the wide case) as the no-bleed subject.
    const strokes = [circle(0, 0, 3), circle(0, 0, 1.2)];
    const gapClosePx = 0.4;
    const mask = rasterInkMask(strokes, { inkRadius, resolution, maxResolution: resolution, gapClosePx });
    assert(mask !== null, 'rasterInkMask returns a mask');
    const { grid, w, h, originX, originY, cell } = mask;

    // Reproduce the trapped-ball pick the way the export does, so we can grab
    // the fill mask and test it in raster space. We scan the descending ladder,
    // keep the largest bounded flood at the ring seed (0, 2.1).
    const topGapCells = Math.max(0, Math.round(gapClosePx / cell));
    const ladder = [];
    for (let g = topGapCells; g > 0; g = Math.floor(g / 2)) {
      if (ladder[ladder.length - 1] !== g) ladder.push(g);
    }
    ladder.push(0);
    const seedCol = Math.floor((0 - originX) / cell);
    const seedRow = Math.floor((2.1 - originY) / cell);
    let bestRegion = null, bestArea = 0, bestGap = 0;
    for (const gCells of ladder) {
      const closed = gCells > 0 ? closeGaps(grid, w, h, gCells) : grid;
      let sc = seedCol, sr = seedRow;
      if (closed[sr * w + sc] !== 0) {
        let found = false;
        for (let rad = 1; rad <= 2 && !found; rad++)
          for (let dr = -rad; dr <= rad && !found; dr++)
            for (let dc = -rad; dc <= rad && !found; dc++) {
              const nc = seedCol + dc, nr = seedRow + dr;
              if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
              if (closed[nr * w + nc] === 0) { sc = nc; sr = nr; found = true; }
            }
        if (!found) continue;
      }
      const region = spanFlood(closed, w, h, sc, sr);
      if (!region) continue;
      let area = 0;
      for (let i = 0; i < region.length; i++) if (region[i]) area++;
      if (area > bestArea) { bestArea = area; bestRegion = region; bestGap = gCells; }
    }
    assert(bestRegion !== null, 'trapped-ball pick found a bounded ring region');
    const fillMask = growUnderInk(bestRegion, grid, w, h, bestGap);

    // (3a) the fill never occupies an ORIGINAL-ink cell.
    let onInk = 0;
    for (let i = 0; i < fillMask.length; i++) if (fillMask[i] && grid[i]) onInk++;
    assert(onInk === 0, '3a: no fill cell lies ON original ink (clip-to-NOT-ink holds)');

    // (3b) the fill mask is DISJOINT from the EXTERIOR flood (outside the big
    // circle) — no bleed past the outer wall.
    const ext = floodExterior(grid, w, h);
    let overlap = 0;
    for (let i = 0; i < fillMask.length; i++) if (fillMask[i] && ext[i]) overlap++;
    assert(overlap === 0, '3b: fill mask DISJOINT from the exterior flood (no bleed past the outer wall)');

    // (3c) every fill cell sits within the outer circle's envelope (r <= 3 +
    // a couple cells of ink/grow slack). A bleed would land beyond r ≈ 3.
    let beyond = 0;
    const rMax = 3 + inkRadius + 3 * cell;
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        if (!fillMask[r * w + c]) continue;
        const x = originX + c * cell, y = originY + r * cell;
        if (Math.hypot(x, y) > rMax) beyond++;
      }
    assert(beyond === 0, `3c: no fill cell lies beyond the outer circle envelope (r<=${rMax.toFixed(2)})`);
  }

  console.log(`\n──── ${passes} passed, ${failures} failed ────`);
  if (failures > 0) process.exit(1);
}

// 4-connected flood of the EXTERIOR (paper reachable from the grid border).
function floodExterior(mask, w, h) {
  const ext = new Uint8Array(w * h);
  const stack = [];
  for (let c = 0; c < w; c++) {
    if (mask[c] === 0) { stack.push(c); ext[c] = 1; }
    const b = (h - 1) * w + c;
    if (mask[b] === 0 && !ext[b]) { stack.push(b); ext[b] = 1; }
  }
  for (let r = 0; r < h; r++) {
    const l = r * w;
    if (mask[l] === 0 && !ext[l]) { stack.push(l); ext[l] = 1; }
    const rr = r * w + (w - 1);
    if (mask[rr] === 0 && !ext[rr]) { stack.push(rr); ext[rr] = 1; }
  }
  while (stack.length) {
    const idx = stack.pop();
    const r = (idx / w) | 0;
    const c = idx - r * w;
    const nbrs = [
      c > 0 ? idx - 1 : -1,
      c < w - 1 ? idx + 1 : -1,
      r > 0 ? idx - w : -1,
      r < h - 1 ? idx + w : -1,
    ];
    for (const n of nbrs) {
      if (n < 0) continue;
      if (mask[n] === 0 && !ext[n]) { ext[n] = 1; stack.push(n); }
    }
  }
  return ext;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
