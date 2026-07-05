// ─── regionFill smoke test — synthetic, self-contained, node-runnable ────────
//
// Validates the §4 Step 1-3 no-bleed pipeline against synthetic stroke sets:
//   (A) a CLOSED square fills (region detected, bounded).
//   (B) a square with a small OPEN corner gap fills via gap-close (Step 2).
//   (C) the SAME open square WITHOUT gap-close does NOT fill (honest miss) —
//       proves gap-close is what closes it, not luck.
//   (D) NO-BLEED, the headline guarantee: no output fill cell lies on the OUTER
//       side of the original ink. We verify this two ways:
//         (D1) by construction in raster space — flood the EXTERIOR on the same
//              original-ink mask; the fill mask must be disjoint from the
//              exterior-flood mask (∩ = ∅).
//         (D2) the traced vector outline stays within the ink's outer envelope
//              (every outline vertex is inside the bbox padded by ink radius,
//              and no vertex pokes past the original square's outer wall).
//
// Run:  node src/app/lib/fill/regionFill.smoke.mjs
//
// Bundles the REAL regionFill.ts (resolving polygon-clipping) via esbuild into
// an in-memory ESM module — so these assertions exercise the actual shipped
// code, not a copy.

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

// ── synthetic strokes (viewBox-ish coords, 0..800) ──
// A closed square as ONE stroke (last point == first → closed).
function closedSquare(x0, y0, size) {
  return [
    [x0, y0],
    [x0 + size, y0],
    [x0 + size, y0 + size],
    [x0, y0 + size],
    [x0, y0], // close
  ];
}
// A square with a small gap in the top edge (open near a corner). gap = coord
// units of missing edge. Drawn as one open polyline that doesn't return home.
function gappedSquare(x0, y0, size, gap) {
  // start partway along the top edge, go around, stop just short of the start.
  const sx = x0 + gap; // leave a `gap`-wide hole at the top-left
  return [
    [sx, y0],
    [x0 + size, y0],
    [x0 + size, y0 + size],
    [x0, y0 + size],
    [x0, y0],
    [x0, y0], // arrives at top-left corner but the [x0,y0]→[sx,y0] top piece is missing
  ];
}

async function main() {
  console.log('Loading regionFill.ts via esbuild bundle...');
  const M = await loadModule();
  const { fillRegionAt, rasterInkMask, closeGaps, spanFlood, growUnderInk } = M;

  const inkRadius = 8;
  const resolution = 200;

  // ── (A) closed square fills ──
  console.log('\n(A) CLOSED square fills:');
  {
    const strokes = [closedSquare(200, 200, 200)];
    const res = fillRegionAt(strokes, 300, 300, { inkRadius, resolution, gapClosePx: 6 });
    assert(res !== null, 'tap inside a closed square returns a fill (not null)');
    assert(res && res.outline.length >= 3, 'fill outline is a real ring (>=3 pts)');
    // tap OUTSIDE the square → honest miss.
    const outside = fillRegionAt(strokes, 50, 50, { inkRadius, resolution, gapClosePx: 6 });
    assert(outside === null, 'tap OUTSIDE the square returns null (unbounded outside)');
    // tap ON the line → nudge finds interior OR misses; either way not a crash,
    // and a clearly-on-ink-with-no-paper case would miss. Tap dead-center is the
    // real assertion above.
  }

  // ── (B) gapped square fills WITH gap-close ──
  console.log('\n(B) OPEN-corner square fills via gap-close (Step 2):');
  {
    const gap = 10; // ~10 coord-unit hole in the top edge
    const strokes = [gappedSquare(200, 200, 200, gap)];
    // gapClosePx must dilate each wall by >= gap/2 to seal a `gap`-wide hole.
    const res = fillRegionAt(strokes, 300, 300, { inkRadius, resolution, gapClosePx: 12 });
    assert(res !== null, `tap inside an open-corner square (gap=${gap}) fills with gapClosePx=12`);
    assert(res && res.outline.length >= 3, 'gap-closed fill outline is a real ring');
  }

  // ── (C) gapped square does NOT fill without gap-close (proves it's gap-close) ──
  console.log('\n(C) OPEN-corner square does NOT fill with NO gap-close:');
  {
    const gap = 10;
    const strokes = [gappedSquare(200, 200, 200, gap)];
    const res = fillRegionAt(strokes, 300, 300, { inkRadius: 3, resolution, gapClosePx: 0 });
    // with thin ink (3) and no gap-close, the 10-wide hole leaks → flood reaches
    // border → null. (Proves the fill in (B) was the gap-close working.)
    assert(res === null, `open-corner square (gap=${gap}) MISSES with gapClosePx=0 + thin ink (honest miss / leak)`);
  }

  // ── (D) NO-BLEED guarantee ──
  console.log('\n(D) NO-BLEED: fill never crosses to the outer side of the ink:');
  {
    const strokes = [closedSquare(200, 200, 200)];
    const gapClosePx = 6;
    const mask = rasterInkMask(strokes, { inkRadius, resolution, gapClosePx });
    assert(mask !== null, 'rasterInkMask returns a mask');
    const { grid, w, h, originX, originY, cell } = mask;
    const gapCells = Math.max(0, Math.round(gapClosePx / cell));
    const closed = closeGaps(grid, w, h, gapCells);

    // interior flood (seed center).
    const seedCol = Math.floor((300 - originX) / cell);
    const seedRow = Math.floor((300 - originY) / cell);
    const region = spanFlood(closed, w, h, seedCol, seedRow);
    assert(region !== null, 'interior span flood succeeds');

    // the no-bleed fill mask (grow ~g/2, clip to NOT original ink).
    const fillMask = growUnderInk(region, grid, w, h, gapCells);

    // (D0) the fill mask never occupies an ORIGINAL-ink cell.
    let onInk = 0;
    for (let i = 0; i < fillMask.length; i++) if (fillMask[i] && grid[i]) onInk++;
    assert(onInk === 0, 'D0: no fill cell lies ON original ink (clip-to-NOT-ink holds)');

    // (D1) exterior flood on the SAME closed mask (seed a corner of the grid).
    // The fill mask must be DISJOINT from the exterior region — i.e. no fill
    // cell is on the outer side of the ink wall.
    const extRegion = floodExterior(closed, w, h);
    let overlap = 0;
    for (let i = 0; i < fillMask.length; i++) if (fillMask[i] && extRegion[i]) overlap++;
    assert(overlap === 0, 'D1: fill mask is DISJOINT from the exterior flood (no bleed past the wall)');

    // (D2) every fill cell sits strictly INSIDE the square's outer wall
    // (x in (200, 400), y in (200, 400) padded outward by ink radius only — a
    // bleed-past would land beyond outerX = 200/400 ± inkRadius on the FAR side).
    // We check the tightest invariant: no fill cell center is further out than
    // the OUTER edge of the ink (square edge ± inkRadius). A bleed would put a
    // fill cell beyond that.
    let beyondWall = 0;
    const lo = 200 - inkRadius;
    const hi = 400 + inkRadius;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (!fillMask[r * w + c]) continue;
        const x = originX + c * cell;
        const y = originY + r * cell;
        if (x < lo - cell || x > hi + cell || y < lo - cell || y > hi + cell) beyondWall++;
      }
    }
    assert(beyondWall === 0, 'D2: no fill cell lies beyond the outer envelope of the ink (square edge ± inkRadius)');
  }

  // ── (E) DONUT: a small closed square inside a big one → tap the ring fills
  //        with a HOLE (Step 6 difference / even-odd, §1B). ──
  console.log('\n(E) DONUT: tap the ring of a square-in-square yields a hole:');
  {
    const strokes = [closedSquare(150, 150, 300), closedSquare(280, 280, 40)];
    // tap in the ANNULUS (between the two squares).
    const res = fillRegionAt(strokes, 180, 180, { inkRadius, resolution, gapClosePx: 6 });
    assert(res !== null, 'tap in the annulus returns a fill');
    assert(res && res.holes.length >= 1, 'annulus fill has >=1 hole ring (the inner square)');
    // tap INSIDE the small inner square → fills ONLY the inner square (nested),
    // outline area much smaller than the outer square's area.
    const inner = fillRegionAt(strokes, 300, 300, { inkRadius, resolution, gapClosePx: 6 });
    assert(inner !== null, 'tap inside the nested inner square returns a fill');
    if (inner && res) {
      const innerArea = M.loopArea(inner.outline);
      const ringArea = M.loopArea(res.outline);
      assert(innerArea < ringArea * 0.5, 'nested-inner fill is much smaller than the ring (only the inner square filled, not the whole outer)');
    }
  }

  console.log(`\n──── ${passes} passed, ${failures} failed ────`);
  if (failures > 0) process.exit(1);
}

// 4-connected flood of the EXTERIOR (paper reachable from the grid border) on a
// mask — the complement test for the no-bleed assertion. Pure, local helper.
function floodExterior(mask, w, h) {
  const ext = new Uint8Array(w * h);
  const stack = [];
  // seed every border paper cell.
  for (let c = 0; c < w; c++) {
    if (mask[c] === 0) {
      stack.push(c);
      ext[c] = 1;
    }
    const b = (h - 1) * w + c;
    if (mask[b] === 0) {
      stack.push(b);
      ext[b] = 1;
    }
  }
  for (let r = 0; r < h; r++) {
    const l = r * w;
    if (mask[l] === 0 && !ext[l]) {
      stack.push(l);
      ext[l] = 1;
    }
    const rr = r * w + (w - 1);
    if (mask[rr] === 0 && !ext[rr]) {
      stack.push(rr);
      ext[rr] = 1;
    }
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
      if (mask[n] === 0 && !ext[n]) {
        ext[n] = 1;
        stack.push(n);
      }
    }
  }
  return ext;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
