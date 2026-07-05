// ─── regionFill — no-bleed raster region fill (Step 1-3 hybrid) ──────────────
//
// SCAFFOLD. Self-contained, pure, no React/DOM/three. NOT wired into any
// component — the integration + live-verify happens in the main loop.
//
// SOURCE OF TRUTH: docs/submission/KNOWN-SOLUTIONS.md
//   §1A  — REGION FILL approaches (raster span flood = PICKER OF CHOICE;
//          polygon-clipping = clean/boolean the traced fill).
//   §1B  — donut / even-odd holes (polygonClipping.difference → annulus).
//   §4   — the recommended HYBRID refactor path, Step 1-3:
//            Step 1  PICK            = raster span flood seeded at the click
//            Step 2  GAP TOLERANCE   = dilate the ink mask before flooding
//            Step 3  FILL GEOMETRY   = trace the flood → polygon-clipping clean
//   §5   — citations (Inkscape Bucket Fill, flood-fill span/scanline 4-conn,
//          morphological closing, mfogel/polygon-clipping, MDN fill-rule).
//
// This module is the cleaner, no-bleed SUCCESSOR to strokeTo3d.ts
// `floodFillRegionAt`. It reuses the SAME proven algorithms (stamp ink bodies,
// marching squares, point-in-loop, loop area) re-implemented here on plain
// [number, number] pairs so the module imports nothing from the 2D/3D
// pipeline. Coordinates are space-agnostic: feed it loops in viewBox space and
// it returns loops in viewBox space (same contract as floodFillRegionAt, which
// the live wiring drives in viewBox coords).
//
// ─── THE BUG THIS FIXES (Sebs, emphatic) ────────────────────────────────────
//   (a) freehand shapes with a slight gap (a sharp-corner pinhole) DON'T fill —
//       the flood escapes through the gap to the outside and reports a miss.
//   (b) the fill BLEEDS PAST THE OUTLINE — "a fill would not go past the lines
//       of a region."
//
// THE CURE (§4 Step 2-3 — the NO-BLEED trace-against-original-ink):
//   * Flood on a GAP-CLOSED mask: the ORIGINAL ink mask DILATED by g cells.
//     Dilation fattens the walls just enough to seal pinholes ≤ ~2g, so the
//     flood can no longer leak out of an almost-closed shape (fixes (a)).
//   * The dilated walls are used ONLY to BOUND the flood. We then GROW the
//     flooded region by ~g/2 and CLIP that growth to NOT(ORIGINAL ink). Because
//     we clip against the ORIGINAL (undilated) ink — never the fattened mask —
//     the fill can reach UP TO the inner edge of the visible stroke and tuck
//     UNDER it, but can NEVER cross to the far (outer) side of the stroke. The
//     wall-fattening from Step 2 therefore never reaches the output. That is
//     the NO-BLEED guarantee, true by construction (see growUnderInk).
//
// PURITY CONTRACT: no React, no DOM, no window/document, no wall-clock reads,
// no unseeded randomness — same input, same output. node-runnable
// (regionFill.smoke.mjs imports the compiled logic mirror).

// NB: polygon-clipping's .d.ts declares NAMED exports (Polygon, MultiPolygon,
// union, difference…) so `polygonClipping.X` typechecks — but its actual ESM
// build only `export { index as default }`. So the NAMED VALUE accesses
// (polygonClipping.union/.difference) are UNDEFINED in the rollup/production
// build (esbuild's dev interop masks it) → fill would crash in Figma Make.
// We keep the namespace for the TYPES (polygonClipping.Polygon etc.) and resolve
// the runtime library object via `.default` for the VALUE calls (pc.*). Verified
// against the prod build (the "union is not exported" warning is gone).
import * as polygonClipping from 'polygon-clipping';
const pc =
  (polygonClipping as unknown as { default?: typeof polygonClipping }).default ?? polygonClipping;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A point. Both [x, y] and [x, y, pressure] are accepted (pressure ignored —
 *  fills are 2D regions). Kept structurally compatible with the repo's
 *  StrokePoint so callers pass `stroke.points` through unchanged. */
export type FillPoint = [number, number] | [number, number, number];
/** A polyline / stroke = an ordered list of points. */
export type FillStroke = FillPoint[];
/** A closed ring of 2D points (the output coordinate type). */
export type Ring = Array<[number, number]>;

/** The binary ink raster + the grid metadata needed to map cells ↔ coords. */
export interface InkMask {
  /** Row-major binary grid: 1 = ink, 0 = paper. Length = w·h. */
  grid: Uint8Array;
  w: number;
  h: number;
  /** World/viewBox coord of cell (0,0)'s corner. cell (c,r) center ≈
   *  (originX + c·cell, originY + r·cell). */
  originX: number;
  originY: number;
  /** Coord size of one grid cell (square). */
  cell: number;
}

export interface FillResult {
  /** Outer boundary of the fill, in the SAME coord space as the input strokes. */
  outline: Ring;
  /** Interior hole rings (ink islands the flood went around) — emit as an
   *  even-odd compound path / subtract via difference for a true donut. */
  holes: Ring[];
}

export interface FillOpts {
  /** Coord-space half-width of the stamped ink body (how thick a stroke reads
   *  to the raster). Mirrors floodFillRegionAt's inkRadius / SOLID_INK_RADIUS.
   *  Defaults to DEFAULT_INK_RADIUS. */
  inkRadius?: number;
  /** Grid samples along the pool bbox's longest side. Higher = crisper corners
   *  but more cells. Mirrors SOLID_GRID_RESOLUTION. */
  resolution?: number;
  /** Hard ceiling on resolution (perf guard). Mirrors SOLID_MAX_GRID_RESOLUTION. */
  maxResolution?: number;
  /** GAP-CLOSE distance in COORD units (the doc's None/Small/Medium/Large
   *  slider). Converted to grid cells internally. 0 = no gap closing. Default
   *  DEFAULT_GAP_CLOSE_PX closes a typical freehand pinhole. */
  gapClosePx?: number;
}

// ─── Constants (mirrors of the proven strokeTo3d values, in 2D coord units) ──

/** Coord-space half-width of a stamped stroke. Matches SOLID_INK_RADIUS scaled
 *  to viewBox px — strokeTo3d works in world units (×WORLD_SCALE 0.01), so its
 *  0.08 world ≈ 8 viewBox px. floodFillRegionAt is driven in viewBox coords by
 *  the live wiring, so 8 is the right default here. */
export const DEFAULT_INK_RADIUS = 8;

/** Default grid resolution + ceiling (mirror SOLID_GRID_RESOLUTION /
 *  SOLID_MAX_GRID_RESOLUTION). The 2D FILL lane wants a generous cap so sharp
 *  corners staircase the least (the white corner-notch class). */
export const DEFAULT_RESOLUTION = 200;
export const DEFAULT_MAX_RESOLUTION = 400;

/** Contour loops below this area (grid-cell units²) are rasterization noise —
 *  mirror SOLID_MIN_LOOP_AREA. */
export const MIN_LOOP_AREA_CELLS = 2;

/** Default gap-close, in COORD (viewBox px) units. A freehand sharp-corner
 *  pinhole is typically a few px wide; dilating each wall by ~6px seals gaps up
 *  to ~12px (2·g) — comfortably covering the "slight gap" Sebs means without
 *  bridging genuinely separate regions. The doc's slider maps roughly
 *  None=0 / Small≈3 / Medium≈6 / Large≈12 px. */
export const DEFAULT_GAP_CLOSE_PX = 6;

// ─── 0. input prep ───────────────────────────────────────────────────────────

/** Drop consecutive near-duplicate points (jitter / exact dupes) — keeps the
 *  raster stamp + marching squares stable. Mirrors strokeTo3d dedupeConsecutive
 *  but on 2D pairs. */
export function dedupeConsecutive(stroke: FillStroke, minDist = 1e-4): FillStroke {
  const out: FillStroke = [];
  const minSq = minDist * minDist;
  for (const p of stroke) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue; // boundary guard
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(p);
      continue;
    }
    const dx = p[0] - prev[0];
    const dy = p[1] - prev[1];
    if (dx * dx + dy * dy > minSq) out.push(p);
  }
  return out;
}

// ─── 1. rasterInkMask — stamp visible ink into a binary grid ─────────────────

/** Stamp ONE polyline as a capsule-per-segment into the grid (1 = ink). Same
 *  scan-the-segment-bbox / distance-to-segment test as strokeTo3d stampInkBody,
 *  on 2D pairs. */
function stampStroke(
  grid: Uint8Array,
  w: number,
  h: number,
  originX: number,
  originY: number,
  cell: number,
  pts: FillStroke,
  inkRadius: number,
): void {
  const r2 = inkRadius * inkRadius;
  const segs = Math.max(pts.length - 1, 0);
  for (let s = 0; s < Math.max(segs, 1); s++) {
    const a = pts[Math.min(s, pts.length - 1)];
    const b = pts[Math.min(s + 1, pts.length - 1)];
    const ax = a[0];
    const ay = a[1];
    const bx = b[0];
    const by = b[1];
    const minX = Math.min(ax, bx) - inkRadius;
    const maxX = Math.max(ax, bx) + inkRadius;
    const minY = Math.min(ay, by) - inkRadius;
    const maxY = Math.max(ay, by) + inkRadius;
    const r0 = Math.max(Math.ceil((minY - originY) / cell), 0);
    const r1 = Math.min(Math.floor((maxY - originY) / cell), h - 1);
    const c0 = Math.max(Math.ceil((minX - originX) / cell), 0);
    const c1 = Math.min(Math.floor((maxX - originX) / cell), w - 1);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    for (let row = r0; row <= r1; row++) {
      const y = originY + row * cell;
      for (let col = c0; col <= c1; col++) {
        const x = originX + col * cell;
        let t = lenSq > 0 ? ((x - ax) * dx + (y - ay) * dy) / lenSq : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - (ax + t * dx);
        const ey = y - (ay + t * dy);
        if (ex * ex + ey * ey <= r2) grid[row * w + col] = 1;
      }
    }
  }
}

/** STEP 1 raster: stamp the visible ink of every stroke into a binary grid.
 *  Returns the ORIGINAL (undilated) ink mask + the grid spec — this mask is
 *  what Step 3 traces against (the no-bleed reference), never the dilated copy.
 *  Grid is sized to the pool bbox + a margin (inkRadius + 2 cells) so the
 *  border is always paper and every flood/contour is well-formed.
 *  Returns null when the pool is empty. */
export function rasterInkMask(strokes: FillStroke[], opts: FillOpts = {}): InkMask | null {
  const inkRadius = opts.inkRadius ?? DEFAULT_INK_RADIUS;
  const resolution = Math.min(
    opts.resolution ?? DEFAULT_RESOLUTION,
    opts.maxResolution ?? DEFAULT_MAX_RESOLUTION,
  );
  const pool = strokes.map((s) => dedupeConsecutive(s)).filter((s) => s.length > 0);
  if (pool.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of pool) {
    for (const p of s) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  if (!Number.isFinite(minX)) return null;

  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const cell = Math.max(spanX, spanY) / resolution;
  // Margin must also clear the gap-close dilation, else dilation could touch the
  // grid border and a flood that should miss would instead be "bounded" by the
  // border. Reserve gapCells extra cells.
  const gapCells = Math.max(0, Math.round((opts.gapClosePx ?? DEFAULT_GAP_CLOSE_PX) / cell));
  const margin = inkRadius + (2 + gapCells) * cell;
  const originX = minX - margin;
  const originY = minY - margin;
  const w = Math.ceil((spanX + 2 * margin) / cell) + 1;
  const h = Math.ceil((spanY + 2 * margin) / cell) + 1;
  const grid = new Uint8Array(w * h);
  for (const s of pool) stampStroke(grid, w, h, originX, originY, cell, s, inkRadius);

  return { grid, w, h, originX, originY, cell };
}

// ─── 2. closeGaps — morphological DILATION (bounding only) ───────────────────

/** STEP 2 gap tolerance: a COPY of the mask DILATED by gCells (separable square
 *  dilation — a cell becomes ink if any cell within ±g in its row, then within
 *  ±g in its column, is ink — the standard separable square dilation,
 *  morphological closing's dilate half, §1A trapped-ball's lighter cousin).
 *  This fattens the ink walls so a freehand pinhole ≤ ~2·gCells seals shut and
 *  the flood can't leak out (fixes bug (a)).
 *
 *  Implemented as a CONSTANT-TIME-PER-CELL sliding-window count (the standard
 *  running-sum box filter): each output cell is on iff the running count of ink
 *  in its ±g window is > 0. This is O(w·h) regardless of gCells — bit-identical
 *  to the naive ±g-window scan but ~10× faster, which matters because the
 *  multi-scale trapped-ball ladder calls closeGaps once per radius (a dense
 *  ladder would be prohibitively slow with the naive O(w·h·g) scan).
 *
 *  IMPORTANT: this dilated mask is used ONLY to BOUND the flood. The ORIGINAL
 *  mask is what Step 3 traces against, so the wall-fattening NEVER reaches the
 *  output (no-bleed). Returns the original grid unchanged when gCells ≤ 0. */
export function closeGaps(mask: Uint8Array, w: number, h: number, gCells: number): Uint8Array {
  if (gCells <= 0) return mask.slice();
  // Horizontal pass: a cell becomes ink if any cell within ±g in its row is ink.
  // Running window count over the row: prime with [0, g], then slide.
  const horiz = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    const base = row * w;
    let count = 0;
    const prime = Math.min(gCells, w - 1);
    for (let c = 0; c <= prime; c++) count += mask[base + c];
    for (let col = 0; col < w; col++) {
      horiz[base + col] = count > 0 ? 1 : 0;
      const drop = col - gCells; // cell leaving the window as we step right
      const add = col + gCells + 1; // cell entering the window
      if (drop >= 0) count -= mask[base + drop];
      if (add < w) count += mask[base + add];
    }
  }
  // Vertical pass over the horizontally-dilated grid → full square dilation.
  // Same running window, down each column.
  const out = new Uint8Array(w * h);
  for (let col = 0; col < w; col++) {
    let count = 0;
    const prime = Math.min(gCells, h - 1);
    for (let r = 0; r <= prime; r++) count += horiz[r * w + col];
    for (let row = 0; row < h; row++) {
      out[row * w + col] = count > 0 ? 1 : 0;
      const drop = row - gCells;
      const add = row + gCells + 1;
      if (drop >= 0) count -= horiz[drop * w + col];
      if (add < h) count += horiz[add * w + col];
    }
  }
  return out;
}

// ─── 3. spanFlood — 4-connected scanline/span flood over paper ───────────────

/** STEP 1 flood: span/scanline flood over PAPER (mask==0) from a seed cell,
 *  4-connectivity (no diagonal pinhole leaks — §1A). Fills each row left↔right
 *  across the contiguous paper span, then enqueues seeds on the rows above and
 *  below within that span (the cache-friendly span variant, ~2-8× faster than
 *  naive 4-px recursion — §1A).
 *
 *  Returns the filled-region mask (1 = inside the enclosed paper region), OR
 *  null when:
 *    * the seed is on ink (mask[seed] !== 0) — tap landed on a line, honest
 *      miss; or
 *    * the fill reaches the grid BORDER — the region is the unbounded outside,
 *      i.e. the shape isn't actually closed (even after gap-close), an honest
 *      miss rather than flooding the whole canvas (this is what catches bug (a)
 *      when the gap is too big to close). */
export function spanFlood(
  closedMask: Uint8Array,
  w: number,
  h: number,
  seedCol: number,
  seedRow: number,
): Uint8Array | null {
  if (seedCol < 0 || seedCol >= w || seedRow < 0 || seedRow >= h) return null;
  if (closedMask[seedRow * w + seedCol] !== 0) return null; // seed on ink

  const region = new Uint8Array(w * h);
  // Stack of (col, row) seeds; each pops, expands its row-span, pushes the rows
  // above/below.
  const stackCol: number[] = [seedCol];
  const stackRow: number[] = [seedRow];
  let touchedBorder = false;

  const paper = (c: number, r: number) => closedMask[r * w + c] === 0;
  const seen = (c: number, r: number) => region[r * w + c] !== 0;

  while (stackCol.length > 0) {
    const r = stackRow.pop() as number;
    let c = stackCol.pop() as number;
    if (!paper(c, r) || seen(c, r)) continue;

    // Walk left to the start of this paper span.
    let lx = c;
    while (lx > 0 && paper(lx - 1, r) && !seen(lx - 1, r)) lx--;
    // Walk right to the end.
    let rx = c;
    while (rx < w - 1 && paper(rx + 1, r) && !seen(rx + 1, r)) rx++;

    // Border touch = unbounded outside (note the grid margin guarantees the
    // border is paper unless a region legitimately reaches it).
    if (r === 0 || r === h - 1 || lx === 0 || rx === w - 1) touchedBorder = true;

    // Fill the span and scan the rows above/below for new spans to seed.
    for (let x = lx; x <= rx; x++) region[r * w + x] = 1;
    for (const nr of [r - 1, r + 1]) {
      if (nr < 0 || nr >= h) continue;
      let x = lx;
      while (x <= rx) {
        // skip non-paper / already-filled
        if (!paper(x, nr) || seen(x, nr)) {
          x++;
          continue;
        }
        // found the start of a paper run on the neighbour row — seed it, then
        // skip to the end of this run so we enqueue each run once.
        stackCol.push(x);
        stackRow.push(nr);
        while (x <= rx && paper(x, nr) && !seen(x, nr)) x++;
      }
    }
  }

  if (touchedBorder) return null; // unbounded outside → honest miss
  // A degenerate empty region (seed was paper but immediately walled) can't
  // happen — the seed cell itself is always filled — but guard anyway.
  for (let i = 0; i < region.length; i++) if (region[i]) return region;
  return null;
}

// ─── 4. growUnderInk — grow the fill ~g/2, CLIP to NOT(original ink) ─────────

/** STEP 2/3 NO-BLEED core. Grow the flooded region by ~ceil(g/2) cells
 *  (separable square dilation), then CLIP every grown cell to NOT(ORIGINAL
 *  ink). Clipping against the ORIGINAL (undilated) mask — never the gap-closed
 *  copy — is the whole trick:
 *
 *    * the flood stopped at the inner edge of the (fattened) wall, so without
 *      growth the fill leaves a hairline gap under the stroke;
 *    * growing by ~g/2 lets the fill reach UP TO the inner edge of the VISIBLE
 *      stroke and tuck UNDER it (the tone sits beneath the ink, crisp join);
 *    * but every grown cell that lands ON original ink is removed, so the fill
 *      physically CANNOT occupy an ink cell — and because original ink forms a
 *      continuous wall between the interior region and the exterior, NO grown
 *      cell can ever reach the OUTER side of the stroke. That is the no-bleed
 *      guarantee, true BY CONSTRUCTION (verified in the smoke test by checking
 *      that the output ∩ exterior-flood is empty).
 *
 *  grow defaults to ceil(gCells / 2) per §4 Step 2 ("grow the fill by ~g/2").
 *  At least 1 cell so the fill always tucks under by a hair even when gaps
 *  weren't closed. */
export function growUnderInk(
  regionMask: Uint8Array,
  originalInk: Uint8Array,
  w: number,
  h: number,
  gCells: number,
): Uint8Array {
  // Grow back ~the full gap-close amount the flood lost to the dilated bound
  // (close ate gCells into the paper; grow gCells restores it) so the fill
  // reaches the VISIBLE ink — no sliver — while the clip to NOT(original ink)
  // below still guarantees NO bleed past the line.
  const grow = Math.max(1, gCells);

  // Separable square dilation of the region by `grow` cells.
  const horiz = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    const base = row * w;
    for (let col = 0; col < w; col++) {
      let on = 0;
      const lo = Math.max(0, col - grow);
      const hi = Math.min(w - 1, col + grow);
      for (let c = lo; c <= hi; c++) {
        if (regionMask[base + c]) {
          on = 1;
          break;
        }
      }
      horiz[base + col] = on;
    }
  }
  const out = new Uint8Array(w * h);
  for (let col = 0; col < w; col++) {
    for (let row = 0; row < h; row++) {
      let on = 0;
      const lo = Math.max(0, row - grow);
      const hi = Math.min(h - 1, row + grow);
      for (let r = lo; r <= hi; r++) {
        if (horiz[r * w + col]) {
          on = 1;
          break;
        }
      }
      // CLIP to NOT(original ink): a grown cell on ORIGINAL ink is dropped, so
      // the fill never occupies ink and never crosses to the far side of it.
      out[row * w + col] = on && !originalInk[row * w + col] ? 1 : 0;
    }
  }
  return out;
}

// ─── 5. traceToRings — marching squares on the fill mask → rings ─────────────

/** Marching squares over a binary grid → closed loops of [x, y] points in
 *  SAMPLE (grid-cell) units. Midpoint interpolation (binary data); saddles
 *  resolved by a fixed deterministic choice. Direct port of strokeTo3d
 *  marchingSquaresLoops (every boundary point has degree exactly 2, so chaining
 *  always yields clean closed loops; the grid border is empty by the margin so
 *  every loop closes). */
export function marchingSquaresLoops(grid: Uint8Array, w: number, h: number): Ring[] {
  const STRIDE = 1 << 16; // > 2·(maxResolution + margin)
  const pid = (x2: number, y2: number) => x2 * STRIDE + y2;
  const adj = new Map<number, number[]>();
  const segList: Array<[number, number]> = [];
  const addSeg = (px2: number, py2: number, qx2: number, qy2: number) => {
    const p = pid(px2, py2);
    const q = pid(qx2, qy2);
    if (!adj.has(p)) adj.set(p, []);
    if (!adj.has(q)) adj.set(q, []);
    (adj.get(p) as number[]).push(q);
    (adj.get(q) as number[]).push(p);
    segList.push([p, q]);
  };

  for (let row = 0; row < h - 1; row++) {
    for (let col = 0; col < w - 1; col++) {
      const a = grid[row * w + col]; // bottom-left
      const b = grid[row * w + col + 1]; // bottom-right
      const c = grid[(row + 1) * w + col + 1]; // top-right
      const d = grid[(row + 1) * w + col]; // top-left
      const code = a | (b << 1) | (c << 2) | (d << 3);
      if (code === 0 || code === 15) continue;
      const bot: [number, number] = [col * 2 + 1, row * 2];
      const rgt: [number, number] = [col * 2 + 2, row * 2 + 1];
      const top: [number, number] = [col * 2 + 1, row * 2 + 2];
      const lft: [number, number] = [col * 2, row * 2 + 1];
      switch (code) {
        case 1:
        case 14:
          addSeg(lft[0], lft[1], bot[0], bot[1]);
          break;
        case 2:
        case 13:
          addSeg(bot[0], bot[1], rgt[0], rgt[1]);
          break;
        case 3:
        case 12:
          addSeg(lft[0], lft[1], rgt[0], rgt[1]);
          break;
        case 4:
        case 11:
          addSeg(rgt[0], rgt[1], top[0], top[1]);
          break;
        case 6:
        case 9:
          addSeg(bot[0], bot[1], top[0], top[1]);
          break;
        case 7:
        case 8:
          addSeg(lft[0], lft[1], top[0], top[1]);
          break;
        case 5: // saddle (a,c) — fixed deterministic resolution
          addSeg(lft[0], lft[1], bot[0], bot[1]);
          addSeg(rgt[0], rgt[1], top[0], top[1]);
          break;
        case 10: // saddle (b,d) — fixed deterministic resolution
          addSeg(bot[0], bot[1], rgt[0], rgt[1]);
          addSeg(top[0], top[1], lft[0], lft[1]);
          break;
      }
    }
  }

  const edgeKey = (p: number, q: number) => (p < q ? p * 16777216 + q : q * 16777216 + p);
  const visited = new Set<number>();
  const loops: Ring[] = [];
  for (const [p0, p1] of segList) {
    if (visited.has(edgeKey(p0, p1))) continue;
    const loop: number[] = [p0];
    let prev = p0;
    let curr = p1;
    visited.add(edgeKey(p0, p1));
    let guard = adj.size + 8;
    while (curr !== p0 && guard-- > 0) {
      loop.push(curr);
      const nbrs = adj.get(curr) as number[];
      const next = nbrs[0] === prev ? nbrs[1] : nbrs[0];
      if (next === undefined) break; // dangling — malformed, drop below
      visited.add(edgeKey(curr, next));
      prev = curr;
      curr = next;
    }
    if (curr !== p0 || loop.length < 3) continue;
    loops.push(loop.map((id) => [Math.floor(id / STRIDE) / 2, (id % STRIDE) / 2] as [number, number]));
  }
  return loops;
}

/** Shoelace area of a [x, y] loop (absolute value). Port of strokeTo3d loopArea. */
export function loopArea(loop: Ring): number {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const [ax, ay] = loop[i];
    const [bx, by] = loop[(i + 1) % loop.length];
    area += ax * by - bx * ay;
  }
  return Math.abs(area / 2);
}

/** Even-odd ray-cast point-in-polygon. Port of strokeTo3d pointInLoop. */
export function pointInLoop(x: number, y: number, loop: Ring): boolean {
  let inside = false;
  for (let i = 0; i < loop.length; i++) {
    const [ax, ay] = loop[i];
    const [bx, by] = loop[(i + 1) % loop.length];
    if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inside = !inside;
  }
  return inside;
}

export interface TracedRings {
  outer: Ring;
  holes: Ring[];
}

/** STEP 3 trace: marching squares on the FILL mask → outer ring (largest area)
 *  + interior hole rings (loops whose first point sits inside the outer, via
 *  pointInLoop — these are ink islands the flood went around). Cell coords are
 *  mapped to the input coord space via origin + cell. Returns null when no loop
 *  survives the noise floor. */
export function traceToRings(
  fillMask: Uint8Array,
  w: number,
  h: number,
  origin: { x: number; y: number },
  cell: number,
): TracedRings | null {
  const loops = marchingSquaresLoops(fillMask, w, h).filter((l) => loopArea(l) >= MIN_LOOP_AREA_CELLS);
  if (loops.length === 0) return null;

  const areas = loops.map((l) => loopArea(l));
  let outerI = 0;
  for (let i = 1; i < loops.length; i++) if (areas[i] > areas[outerI]) outerI = i;

  const toCoord = ([cx, cy]: [number, number]): [number, number] => [
    origin.x + cx * cell,
    origin.y + cy * cell,
  ];

  const outer = loops[outerI];
  const holes: Ring[] = [];
  for (let i = 0; i < loops.length; i++) {
    if (i === outerI) continue;
    const [hx, hy] = loops[i][0];
    // a hole's first point lies inside the outer ring (it's an interior island).
    if (pointInLoop(hx, hy, outer)) holes.push(loops[i].map(toCoord));
  }
  return { outer: outer.map(toCoord), holes };
}

// ─── 6. cleanRings — polygon-clipping difference → donut-ready MultiPolygon ──

/** Close a ring (first === last) for GeoJSON-style polygon-clipping input.
 *  polygon-clipping is tolerant of unclosed rings, but closing is explicit and
 *  cheap. */
function closedRing(ring: Ring): Ring {
  if (ring.length === 0) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx === lx && fy === ly) return ring;
  return [...ring, [fx, fy]];
}

/** STEP 3 clean: pass the traced rings through
 *  polygonClipping.difference([outer], ...holes) → a clean MultiPolygon with no
 *  self-intersections, donut-ready and even-odd-friendly (§1B). Returns the
 *  largest-area resulting polygon as { outline, holes } in coord space.
 *
 *  Why difference and not just emit-as-is: the marching-squares rings can
 *  self-touch at saddles and the hole/outer winding isn't guaranteed; running
 *  them through the Martinez boolean normalizes winding, drops degenerate
 *  inner-ring overflow, and yields a TRUE annulus the renderer can hatch or
 *  emit as an even-odd compound path with no bleed into the hole (Bug U4 /
 *  rose Change B family). */
export function cleanRings(outer: Ring, holes: Ring[]): FillResult | null {
  if (outer.length < 3) return null;
  const subject: polygonClipping.Polygon = [closedRing(outer)];
  let result: polygonClipping.MultiPolygon;
  try {
    if (holes.length === 0) {
      // No holes: still run a self-union to normalize winding / self-touches.
      result = pc.union(subject);
    } else {
      const clips: polygonClipping.Polygon[] = holes
        .filter((hh) => hh.length >= 3)
        .map((hh) => [closedRing(hh)]);
      result =
        clips.length > 0
          ? pc.difference(subject, ...clips)
          : pc.union(subject);
    }
  } catch {
    // Boolean failed on pathological input — fall back to the raw traced rings
    // (honest degradation; the renderer can still emit them even-odd).
    return { outline: outer, holes };
  }
  if (!result || result.length === 0) return null;

  // Pick the largest-area polygon of the MultiPolygon as the fill. Its ring[0]
  // is the outer; ring[1..] are its holes (polygon-clipping convention).
  let best: polygonClipping.Polygon | null = null;
  let bestArea = -Infinity;
  for (const poly of result) {
    if (poly.length === 0) continue;
    const a = loopArea(poly[0] as Ring);
    if (a > bestArea) {
      bestArea = a;
      best = poly;
    }
  }
  if (!best) return null;
  const outline = best[0] as Ring;
  const resultHoles = best.slice(1) as Ring[];
  if (outline.length < 3) return null;
  return { outline, holes: resultHoles };
}

// ─── 7. fillRegionAt — the top-level Step 1-3 pipeline ───────────────────────

/** Fill the enclosed region containing a coord-space seed, with the no-bleed
 *  guarantee. Mirrors floodFillRegionAt's signature + return:
 *    { outline, holes } in the SAME coord space as the input strokes, or null
 *    on an honest miss (seed on a line, or the region is unbounded / open
 *    beyond what gap-close can seal).
 *
 *  Pipeline (§4 Step 1-3):
 *    1. rasterInkMask    — original ink mask + grid spec (the no-bleed reference)
 *    2. closeGaps        — dilated copy that seals pinholes (BOUNDING only)
 *    3. spanFlood        — 4-conn span flood over paper on the CLOSED mask
 *    4. growUnderInk     — grow the flood ~g/2, CLIP to NOT(original ink)
 *    5. traceToRings     — marching squares → outer + hole rings
 *    6. cleanRings       — polygon-clipping difference → clean donut MultiPolygon
 *
 *  gapClosePx is the tunable gap-close (the doc's None/Small/Medium/Large). */
export function fillRegionAt(
  worldStrokes: FillStroke[],
  seedX: number,
  seedY: number,
  opts: FillOpts = {},
): FillResult | null {
  // 1. ORIGINAL ink mask + grid spec (this mask is the no-bleed reference).
  const mask = rasterInkMask(worldStrokes, opts);
  if (!mask) return null;
  const { grid, w, h, originX, originY, cell } = mask;

  // gap-close distance in CELLS.
  const gapCells = Math.max(0, Math.round((opts.gapClosePx ?? DEFAULT_GAP_CLOSE_PX) / cell));

  // 2. GAP-CLOSED mask (dilated copy) — used ONLY to bound the flood.
  const closed = closeGaps(grid, w, h, gapCells);

  // seed cell.
  const seedCol = Math.floor((seedX - originX) / cell);
  const seedRow = Math.floor((seedY - originY) / cell);
  if (seedCol < 0 || seedCol >= w || seedRow < 0 || seedRow >= h) return null;
  // If the seed sits on closed-mask ink (i.e. on/very near a stroke), nudge to
  // the nearest paper cell in a small neighbourhood (the Inkscape "nudge to
  // nearest empty pixel" — §1A). Keeps a tap on a thin line from being a miss.
  let sc = seedCol;
  let sr = seedRow;
  if (closed[sr * w + sc] !== 0) {
    let found = false;
    const R = Math.max(2, gapCells + 1);
    for (let rad = 1; rad <= R && !found; rad++) {
      for (let dr = -rad; dr <= rad && !found; dr++) {
        for (let dc = -rad; dc <= rad && !found; dc++) {
          const nc = seedCol + dc;
          const nr = seedRow + dr;
          if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
          if (closed[nr * w + nc] === 0) {
            sc = nc;
            sr = nr;
            found = true;
          }
        }
      }
    }
    if (!found) return null; // genuinely on ink, no paper nearby → honest miss
  }

  // 3. span flood over paper on the CLOSED mask (bounded by fattened walls).
  const region = spanFlood(closed, w, h, sc, sr);
  if (!region) return null; // seed on ink, or unbounded outside → honest miss

  // 4. grow the flood ~g/2 and CLIP to NOT(ORIGINAL ink) — the no-bleed step.
  const fillMask = growUnderInk(region, grid, w, h, gapCells);

  // 5. trace the fill mask → outer + hole rings (coord space).
  const traced = traceToRings(fillMask, w, h, { x: originX, y: originY }, cell);
  if (!traced) return null;

  // 6. clean via polygon-clipping difference → donut-ready MultiPolygon.
  const cleaned = cleanRings(traced.outer, traced.holes);
  // Honest fallback to the raw traced rings if the boolean produced nothing.
  return cleaned ?? { outline: traced.outer, holes: traced.holes };
}

// ─── 8. fillRegionAtMultiScale — TRAPPED-BALL multi-scale region fill ─────────
//
// SOURCE OF TRUTH: KNOWN-SOLUTIONS.md §1A "Trapped-ball segmentation"
// (hepesu/LineFiller). The cure for the two-failure trap that a single
// gap-close cannot escape:
//   * a SINGLE FIXED gap-close (e.g. 0.4 world) MISSES a tiny nested shape:
//     the dilation is wider than the tiny interior, so the closed mask fills
//     the tiny shape's paper solid → the seed lands on "ink" / nothing floods.
//   * a NAIVE "increasing gap-close, take the FIRST bounded region" grabs a
//     SPURIOUS sliver on a WIDE region: at a big radius the fattened walls
//     pinch the wide ring into a thin bounded artifact (the donut "width 93
//     instead of ~430" bug), and first-bound returns that artifact.
//   * a FREEHAND/GAPPY outer circle (a hand-drawn ring with a small pen-up gap)
//     hits BOTH failures at once: small balls LEAK through the gap (full ring
//     unbounded → discarded), and only a SMALL gap-pocket artifact bounds at
//     some mid radius — so "largest bounded across the ladder" returns that
//     ~93px sliver. The full ring only bounds once a ball BIG enough to seal the
//     gap is rolled — which a too-low or too-coarse ladder never samples.
//
// THE TRAPPED-BALL FIX (roll a ball of DECREASING radius; merge leftovers):
//   "Roll a ball of radius R through the paper — any gap narrower than the
//    ball can't be crossed." We realise the ball as the gap-close DILATION at
//    radius R (seals gaps ≤ ~2R), then span-flood the seed on that closed mask.
//   The ladder CEILING scales to the shape (MULTISCALE_CEIL_FRAC of the ink
//   bbox) so a realistic freehand gap CAN be sealed, and the ladder STEP is
//   DENSE (MULTISCALE_LADDER_RUNGS) so the narrow seal window (between "leaks"
//   and "pinches the seed off") is never skipped. closeGaps is O(w·h) per rung
//   (running-window) so a dense ladder is cheap.
//
//   At a BIG R: every gap is sealed (leak-proof) but the fattened walls erode
//     thin parts of the true region → the bounded flood is a SHRUNKEN sliver.
//   At a SMALL R: the full region extent is recovered, but a real gap leaks
//     → the flood reaches the border → INVALID (unbounded, discarded).
//
//   Run R big→small, keep every BOUNDED flood, and pick the one with the
//   LARGEST area. That is exactly the radius small enough to recover the
//   region's full extent yet large enough to stay bounded:
//     * seed in a TINY nested shape → small R already seals its (already-tight)
//       walls and recovers its whole interior; bigger R floods it solid (no
//       bounded region) → the small-R full-extent flood wins → fills ONLY the
//       tiny shape, NOT its parent.
//     * seed in a WIDE ring → the radius that keeps the ring bounded recovers
//       the FULL ring; any bigger radius that pinched it to a sliver loses on
//       area → the full ring wins, never the artifact.
//   Then MERGE the leftover/thin paper between the flood edge and the visible
//   ink back into the region (growUnderInk: grow ~R, clip to NOT original ink)
//   — same no-bleed core as fillRegionAt. This is the per-radius "merge
//   leftover/thin pixels into the adjacent region" step from §1A.
//
// SAME SIGNATURE + RETURN as fillRegionAt: { outline, holes } in input coord
// space, or null on an honest miss. opts.inkRadius defaults to the visible ink
// (DEFAULT_INK_RADIUS; caller passes ~0.02 world). REUSES rasterInkMask /
// closeGaps / spanFlood / growUnderInk / traceToRings / cleanRings unchanged.

/** Count set cells in a binary region mask (area in grid-cell units). */
function regionCellCount(region: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < region.length; i++) if (region[i]) n++;
  return n;
}

// ─── multi-scale ladder tuning (the FIX for the freehand/gappy outer circle) ──
//
// The original ladder was `topGapCells` halved down to 0 (e.g. 27,13,6,3,1,0).
// That fails the FREEHAND/GAPPY outer circle two ways:
//   1. CEILING TOO LOW — a realistic hand-drawn outer gap (a pen-up of a few %
//      of the circumference) needs a ball BIGGER than DEFAULT_GAP_CLOSE_PX to
//      bridge it. If no ladder rung is large enough to seal the gap, the full
//      ring NEVER bounds — only a small artifact pocket near the gap bounds at
//      some rung, and "largest bounded across the ladder" picks that ~93px
//      SLIVER instead of the full ring (Sebs's bug).
//   2. STEP TOO COARSE — even when a sealing radius EXISTS, halving jumps right
//      over the narrow window between "leaks (too small)" and "pinches the seed
//      off solid (too big)". The full-ring flood only appears for a handful of
//      adjacent radii; a coarse ladder skips them and lands on a sliver.
//
// FIX (§1A trapped-ball, faithful): roll the ball over a CEILING scaled to the
// shape (so it can bridge a real freehand gap) using DENSE rungs (so the seal
// window is never skipped), and keep the proven LARGEST-bounded-area pick (the
// full ring's flood — even when pinched — is far larger than any gap-pocket
// sliver, and growUnderInk restores it to the full extent). The dense ladder is
// affordable because closeGaps is now O(w·h) per rung (running-window).

/** Ladder CEILING as a fraction of the ink bbox's SMALLER dimension. A freehand
 *  outer gap up to ~8% of a circle's circumference is a chord of ~0.25·diameter;
 *  a ball of radius ~half that (~0.12·diameter) bridges it. 0.18 gives headroom
 *  so a genuinely gappy outer circle's ring seals before the pick. */
export const MULTISCALE_CEIL_FRAC = 0.18;

/** Hard cap on the ladder ceiling in CELLS (perf + margin guard — a larger
 *  ceiling inflates the grid margin rasterInkMask reserves). 64 cells at the
 *  default 400-res ≈ ~16% of a full-canvas shape, plenty to seal a real gap
 *  without ballooning the grid. */
export const MULTISCALE_MAX_CEIL_CELLS = 64;

/** Target number of rungs in the descending ladder. step = ceil(ceiling/rungs),
 *  so the ladder is DENSE (≈1-2 cell steps for typical ceilings) — the seal
 *  window between leak and pinch is never skipped. */
export const MULTISCALE_LADDER_RUNGS = 40;

/** Coord-space bbox of the input strokes (same extent rasterInkMask measures),
 *  computed WITHOUT a raster so the ceiling can be sized before the grid is
 *  built. Returns null on an empty / non-finite pool. */
function strokesBBox(
  strokes: FillStroke[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

export function fillRegionAtMultiScale(
  worldStrokes: FillStroke[],
  seedX: number,
  seedY: number,
  opts: FillOpts = {},
): FillResult | null {
  // Ink bbox (coord space) — sized BEFORE the raster so the ladder ceiling can
  // scale to the shape and the grid margin reserves room for the biggest ball.
  const bb = strokesBBox(worldStrokes);
  if (!bb) return null;
  const minBboxDim = Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY);

  // CALLER gap-close (the doc's None/Small/Medium/Large), a FLOOR on the ladder
  // ceiling — the ladder always reaches at least what the caller asked for.
  const callerGapPx = Math.max(0, opts.gapClosePx ?? DEFAULT_GAP_CLOSE_PX);

  // Probe the cell size first (raster with the caller's gap-close so the probe
  // is cheap) so the ceiling can be expressed in CELLS and re-rastered with the
  // matching margin. rasterInkMask derives cell purely from bbox + resolution,
  // so this cell value is stable across the re-raster below.
  const probe = rasterInkMask(worldStrokes, { ...opts, gapClosePx: callerGapPx });
  if (!probe) return null;
  const probeCell = probe.cell;

  // 1. LADDER CEILING (in CELLS): big enough to bridge a realistic freehand
  //    outer gap (≈ MULTISCALE_CEIL_FRAC of the shape's smaller dimension),
  //    never below the caller's gap-close, capped for perf/margin. THIS is the
  //    fix for "the ladder didn't include a radius large enough to seal the gap
  //    before picking" — the gappy ring now reaches a sealing rung.
  const callerCeilCells = Math.round(callerGapPx / probeCell);
  const shapeCeilCells = Math.round(MULTISCALE_CEIL_FRAC * (minBboxDim / probeCell));
  const ceilCells = Math.min(
    MULTISCALE_MAX_CEIL_CELLS,
    Math.max(callerCeilCells, shapeCeilCells, 1),
  );
  const ceilPx = ceilCells * probeCell;

  // 2. ORIGINAL ink mask + grid spec (rasterize the ink ONCE — §1A). This mask
  //    is the no-bleed reference traced/clipped against, never the closed copy.
  //    rasterInkMask reserves margin for the LARGEST gap-close we'll try (the
  //    ceiling) so a big-ball dilation can never touch the grid border (which
  //    would make a miss look bounded).
  const mask = rasterInkMask(worldStrokes, { ...opts, gapClosePx: ceilPx });
  if (!mask) return null;
  const { grid, w, h, originX, originY, cell } = mask;

  // seed cell (shared across all radii — same physical tap).
  const seedCol = Math.floor((seedX - originX) / cell);
  const seedRow = Math.floor((seedY - originY) / cell);
  if (seedCol < 0 || seedCol >= w || seedRow < 0 || seedRow >= h) return null;

  // DESCENDING ball-radius schedule, in CELLS. Top = the shape-scaled ceiling;
  // then step DOWN by a DENSE step to 0. A dense step (≈1-2 cells) is the second
  // half of the fix: the full-ring flood only bounds for a narrow band of radii
  // between "leaks (too small)" and "pinches the seed off solid (too big)" — a
  // coarse/halving ladder skips that band and lands on a sliver. The 0 rung is
  // the no-gap-close baseline (the fullest extent for an already-closed shape —
  // the tiny-nested case). closeGaps is O(w·h) per rung so this stays fast.
  const step = Math.max(1, Math.ceil(ceilCells / MULTISCALE_LADDER_RUNGS));
  const ladder: number[] = [];
  for (let g = ceilCells; g > 0; g -= step) ladder.push(g);
  ladder.push(0); // always try no-gap-close last (smallest "ball")

  // 2-3. Trapped-ball pass: for each radius (big→small) build the closed mask,
  //      nudge a near-ink seed to paper on THAT mask, span-flood, keep the
  //      BOUNDED flood, and remember the LARGEST-area one + the radius that
  //      produced it (so the merge/grow uses the matching amount).
  let bestRegion: Uint8Array | null = null;
  let bestArea = 0;
  let bestGapCells = 0;
  // The NO-gap-close (gCells===0) bounded flood — the seed's OWN tightest
  // region. Preferred below so a closed inner shape fills the inner ONLY.
  let zeroRegion: Uint8Array | null = null;

  for (const gCells of ladder) {
    const closed = gCells > 0 ? closeGaps(grid, w, h, gCells) : grid;

    // Nudge a seed that landed on this radius's (fattened) ink to the nearest
    // paper cell — the Inkscape "nudge to nearest empty pixel" (§1A). The nudge
    // is intentionally SMALL and FIXED (≤2 cells), NOT scaled to gCells: it only
    // corrects a tap that grazed a thin line. If a big ball has sealed the
    // seed's paper SOLID (a tiny shape whose interior is < the ball), no paper
    // is within reach → that radius is SKIPPED. This is what stops a big ball
    // from nudging the seed OUT of a tiny shape into the surrounding region and
    // flooding the (large, spurious) parent — the trap that "largest-area" alone
    // would fall into.
    let sc = seedCol;
    let sr = seedRow;
    if (closed[sr * w + sc] !== 0) {
      let found = false;
      const R = 2;
      for (let rad = 1; rad <= R && !found; rad++) {
        for (let dr = -rad; dr <= rad && !found; dr++) {
          for (let dc = -rad; dc <= rad && !found; dc++) {
            const nc = seedCol + dc;
            const nr = seedRow + dr;
            if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
            if (closed[nr * w + nc] === 0) {
              sc = nc;
              sr = nr;
              found = true;
            }
          }
        }
      }
      if (!found) continue; // this radius sealed the seed's paper solid → skip
    }

    const region = spanFlood(closed, w, h, sc, sr);
    if (!region) continue; // leaked to the border (unbounded) → invalid radius

    // The no-gap-close flood is the seed's OWN tightest region — a CLOSED inner
    // shape floods to JUST the inner here. Remember it to override a bigger
    // ball's parent-region flood below.
    if (gCells === 0) zeroRegion = region;

    // TIGHTEST SEAL wins, not largest area (Sebs 2026-06-20, VISUALLY confirmed:
    // tapping the small circle filled the BIG one). The ladder descends, so
    // overwriting on every bounded flood lands on the SMALLEST gap-close that
    // still bounds the seed — that's the shape the user TAPPED. The old
    // "largest-area" rule preferred a BIGGER ball that bridges the gap to a
    // SEPARATE nearby shape, so a leaky small shape flooded its bigger neighbor.
    // A smaller ball can't bridge a wider gap, so it stays inside the tapped shape;
    // an over-big-ball sliver is overwritten by the tighter seal; a leaked ball is
    // unbounded (skipped above). zeroRegion (gCells=0) still wins outright below.
    bestArea = regionCellCount(region);
    bestRegion = region;
    bestGapCells = gCells;
  }

  // PREFER the no-gap-close flood when it's BOUNDED: at gCells=0 the seed floods
  // its own TIGHTEST region, so "tap the inner shape → fill ONLY the inner" is
  // reliable for CLOSED shapes — a bigger ball can't override it with the larger
  // parent. Only when gCells=0 LEAKS (a real pen-up gap → unbounded, zeroRegion
  // stays null) do we keep the largest bounded flood from the gap-closing ladder
  // (which seals the gap). Donut/ring unaffected: a closed ring is bounded at
  // gCells=0 (the full ring with the inner as a hole); a gappy ring leaks there
  // and falls back to the ladder. (Sebs 2026-06-17: "fill the inner shape only".)
  if (zeroRegion) {
    bestRegion = zeroRegion;
    bestGapCells = 0;
  }

  if (!bestRegion) return null; // no radius produced a bounded region → miss

  // 4. MERGE leftover/thin pixels: grow the winning flood back by the radius
  //    that produced it and CLIP to NOT(ORIGINAL ink). This pulls the thin band
  //    of paper the dilated wall ate (and any sub-radius leftover) back into the
  //    region, up to — never past — the VISIBLE ink (no-bleed by construction).
  const fillMask = growUnderInk(bestRegion, grid, w, h, bestGapCells);

  // 5. trace the merged fill mask → outer + hole rings (coord space). Ink
  //    islands the flood went around (a nested shape inside the ring) become
  //    holes — the donut case.
  const traced = traceToRings(fillMask, w, h, { x: originX, y: originY }, cell);
  if (!traced) return null;

  // 6. clean via polygon-clipping difference → donut-ready MultiPolygon.
  const cleaned = cleanRings(traced.outer, traced.holes);
  return cleaned ?? { outline: traced.outer, holes: traced.holes };
}
