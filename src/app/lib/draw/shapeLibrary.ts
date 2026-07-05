// ─── shapeLibrary — pure parametric shape generators (Rock: more primitives) ──
// No-regret groundwork for the "more drawing primitives" feature. PURE and
// node-runnable like shapeFit.ts / strokeTo3d.ts: no React, no DOM, no
// wall-clock, NO Math.random. Deterministic in, deterministic out.
//
// CONTRACT (mirrors shapeFit.ts's applyCandidate convention):
//   Each generate(bbox) returns an ordered outline tracing the shape, FILLING
//   the given bbox (the user drags out a bbox; the shape scales to fit it).
//   - CURVED shapes (heart, cloud, speech-bubble, crescent, teardrop) emit a
//     DENSE outline verbatim (~48-64 pts) — just like circlePoints / fitEllipse
//     return a 48/64-pt outline that applyCandidate emits as-is for curves.
//   - CORNERED shapes (diamond, pentagon, hexagon, octagon, lightning, arrow,
//     star-5) emit just the CORNER VERTICES; the draw pipeline densifies them
//     downstream (densifyVertexChain).
//   The outline is a closed loop's ordered boundary (caller closes / welds it),
//   point type is [number, number] exactly (defined inline — no app-type import).
//
// All shapes are authored in a canonical UNIT box [0..1]×[0..1] (x right, y
// DOWN — screen/SVG convention) then affine-mapped into the target bbox. This
// keeps each generator's math readable and the bbox-fit logic in one place.

/** A 2D point. Matches shapeFit.ts's FitPoint exactly — defined inline so this
 *  file stays self-contained (no app-type import). */
export type Pt = [number, number];

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShapeLibraryEntry {
  /** Stable key (UI + persistence). */
  kind: string;
  /** Human label for the picker. */
  label: string;
  /** Whether the outline is a dense curve (emit verbatim) or a corner chain
   *  (densified downstream). Informational — the points are the contract. */
  curved: boolean;
  /** Returns an ordered outline filling bbox. Pure + deterministic. */
  generate(bbox: BBox): Pt[];
}

// ─── unit-box → bbox mapping ─────────────────────────────────────────────────

/** Map a list of unit-box points ([0..1]²) into the target bbox. */
function mapUnit(unit: Pt[], b: BBox): Pt[] {
  return unit.map(([ux, uy]): Pt => [b.x + ux * b.w, b.y + uy * b.h]);
}

const TAU = Math.PI * 2;

// ─── normalization helpers ───────────────────────────────────────────────────

/** Normalize a point list so its bbox exactly spans [0,1]². */
function normalizeUnit(pts: Pt[]): Pt[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const sx = maxX - minX || 1, sy = maxY - minY || 1;
  return pts.map(([x, y]): Pt => [(x - minX) / sx, (y - minY) / sy]);
}

/** Normalize + flip Y (math-up authored → screen-down). */
function normalizeUnitFlipY(pts: Pt[]): Pt[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const sx = maxX - minX || 1, sy = maxY - minY || 1;
  return pts.map(([x, y]): Pt => [(x - minX) / sx, 1 - (y - minY) / sy]);
}

// ─── regular polygon family (diamond / pentagon / hexagon / octagon) ─────────

/** A regular n-gon inscribed in the unit circle. `startDeg` orients the first
 *  vertex, measured clockwise from straight-UP (screen convention, y-down). */
function regularPolygonUnit(n: number, startDeg: number): Pt[] {
  const start = (startDeg * Math.PI) / 180;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * TAU;        // angle measured from up, clockwise
    const ux = 0.5 + 0.5 * Math.sin(a);     // sin → x (right at +90°)
    const uy = 0.5 - 0.5 * Math.cos(a);     // -cos → y (up at 0°, screen y-down)
    out.push([ux, uy]);
  }
  return out;
}

/** A regular n-gon whose extremes span the FULL unit box. */
function regularPolygonFilledUnit(n: number, startDeg: number): Pt[] {
  return normalizeUnit(regularPolygonUnit(n, startDeg));
}

// ─── star-5 (regular {5/2}-ish star polygon) ─────────────────────────────────

/** A 5-point star: 10 alternating tip/notch vertices on two concentric circles.
 *  innerRatio = notch radius / tip radius. The exact {5/2} pentagram inner
 *  radius is sin(18°)/sin(54°) ≈ 0.382 of the outer; a slightly larger notch
 *  (0.40) reads as a friendlier drawn star. Normalized to fill the box,
 *  first tip pointing straight up. */
function star5Unit(points = 5, innerRatio = 0.40): Pt[] {
  const out: Pt[] = [];
  const total = points * 2;
  for (let i = 0; i < total; i++) {
    const isTip = i % 2 === 0;
    const r = isTip ? 0.5 : 0.5 * innerRatio;
    const a = -Math.PI / 2 + (i / total) * TAU; // first tip up
    out.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  return normalizeUnit(out);
}

// ─── heart (the standard parametric heart curve) ─────────────────────────────

/** The classic closed-form heart:
 *    x = 16 sin³t
 *    y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t   (t ∈ [0, 2π))
 *  Authored in math-y-UP coords with the cusp (dimple) at TOP and the point at
 *  BOTTOM — exactly the dimple-up orientation we want. Sampled densely, then its
 *  bbox is normalized into the unit box with y flipped to screen-down. */
function heartUnit(n = 64): Pt[] {
  const raw: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    raw.push([x, y]);
  }
  return normalizeUnitFlipY(raw); // flip: math-up dimple-top → screen-down
}

// ─── arc helpers (compose curved shapes from circular / elliptical arcs) ─────

/** Sample a circular arc centered (cx,cy), radius r, from a0 to a1 (radians,
 *  screen y-down). Endpoint inclusive. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

// ─── cloud (overlapping circular lobes on a flat base) ───────────────────────

/** A cloud: the UNION silhouette of overlapping circles, traced as a fluffy
 *  top over a flat base. Lobes share a common centre-y so their union is a
 *  smooth bumpy ridge with SHALLOW valleys (each lobe's visible arc runs only
 *  between where it rises above its left neighbour and where its right
 *  neighbour overtakes it — so the trace never dives back to the baseline
 *  between bumps). The bottom is flat. Dense curve. */
function cloudUnit(): Pt[] {
  const cy = 0.62;       // common lobe centre-y (bumps rise above this)
  const base = 0.98;     // flat bottom
  // (cx, r) lobes — heavy overlap so the union's valleys stay shallow.
  const lobes: Array<[number, number]> = [
    [0.20, 0.20], // left
    [0.42, 0.27], // tall left-center
    [0.65, 0.29], // tallest center-right
    [0.84, 0.21], // right
  ];
  // Upper-circle intersection x of two same-cy circles (cx0,r0)&(cx1,r1):
  // solve (x-cx0)^2 = r0^2 - (y-cy)^2 and same for circle1 at the crossing.
  // For equal cy, the crossing x satisfies a linear equation:
  //   (x-cx0)^2 + (y-cy)^2 = r0^2 ; (x-cx1)^2 + (y-cy)^2 = r1^2
  //   subtract → -2x(cx0-cx1) + (cx0^2-cx1^2) = r0^2 - r1^2
  const crossX = (cx0: number, r0: number, cx1: number, r1: number): number =>
    ((cx0 * cx0 - cx1 * cx1) - (r0 * r0 - r1 * r1)) / (2 * (cx0 - cx1));
  // angle (screen y-down) on a lobe for a given x on its UPPER arc.
  const angAt = (cx: number, r: number, x: number): number => {
    const cosA = Math.max(-1, Math.min(1, (x - cx) / r));
    // upper arc → angle in (π, 2π); use -acos mapped into that range.
    return TAU - Math.acos(cosA);
  };
  const out: Pt[] = [];
  for (let i = 0; i < lobes.length; i++) {
    const [cx, r] = lobes[i];
    // Visible span: from the crossing with the LEFT neighbour (or left foot for
    // the first lobe) to the crossing with the RIGHT neighbour (or right foot).
    let xStart = cx - r;
    let xEnd = cx + r;
    if (i > 0) {
      const [pcx, pr] = lobes[i - 1];
      xStart = crossX(pcx, pr, cx, r);
    }
    if (i < lobes.length - 1) {
      const [ncx, nr] = lobes[i + 1];
      xEnd = crossX(cx, r, ncx, nr);
    }
    // Sweep this lobe's upper arc from xStart (left) over the top to xEnd.
    // angAt gives angles in (π,2π); left x → angle near π, right x → near 2π.
    const aStart = angAt(cx, r, xStart);
    const aEnd = angAt(cx, r, xEnd);
    out.push(...arc(cx, cy, r, aStart, aEnd, 16));
  }
  // Close along the flat base, right → left.
  const rightX = out[out.length - 1][0];
  const leftX = out[0][0];
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    out.push([rightX + (leftX - rightX) * t, base]);
  }
  return normalizeUnit(out);
}

// ─── speech bubble (rounded-rect body + downward tail) ───────────────────────

/** A speech bubble: a rounded-rectangle body with a triangular tail pointing
 *  down-left from the bottom edge. Rounded corners are arcs → dense curve.
 *  Authored to fill the unit box (tail reaches the bottom). */
function speechBubbleUnit(): Pt[] {
  const top = 0.04, bot = 0.66, left = 0.04, right = 0.96, r = 0.16;
  const seg = 6;
  const out: Pt[] = [];
  // Clockwise (screen y-down) starting after the top-left corner.
  out.push([left + r, top]);
  out.push([right - r, top]);                                  // top edge
  out.push(...arc(right - r, top + r, r, -Math.PI / 2, 0, seg)); // TR corner
  out.push([right, bot - r]);                                  // right edge
  out.push(...arc(right - r, bot - r, r, 0, Math.PI / 2, seg)); // BR corner
  // Bottom edge with tail (attaches between x=0.26..0.46, tip down-left).
  out.push([0.46, bot]);
  out.push([0.16, 0.98]); // tail tip
  out.push([0.26, bot]);
  out.push([left + r, bot]);
  out.push(...arc(left + r, bot - r, r, Math.PI / 2, Math.PI, seg)); // BL corner
  out.push([left, top + r]);                                        // left edge
  out.push(...arc(left + r, top + r, r, Math.PI, Math.PI * 1.5, seg)); // TL corner
  return normalizeUnit(out);
}

// ─── crescent (moon — area between two offset circles) ───────────────────────

/** A crescent moon: the lune between an outer circle and an inner circle offset
 *  toward the right, so the crescent opens to the right. Outline = outer back
 *  (left) arc + inner bite arc. Cusps where the circles intersect. Dense curve.*/
function crescentUnit(): Pt[] {
  const outerC: Pt = [0.42, 0.5];
  const outerR = 0.46;
  const innerC: Pt = [0.66, 0.5];
  const innerR = 0.40;
  // Two-circle intersection → the cusp points.
  const dx = innerC[0] - outerC[0];
  const dy = innerC[1] - outerC[1];
  const d = Math.hypot(dx, dy);
  const a = (outerR * outerR - innerR * innerR + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, outerR * outerR - a * a));
  const px = outerC[0] + (a * dx) / d;
  const py = outerC[1] + (a * dy) / d;
  const ixLow: Pt = [px + (h * dy) / d, py - (h * dx) / d]; // larger-y cusp
  const ixHigh: Pt = [px - (h * dy) / d, py + (h * dx) / d]; // smaller-y cusp
  const angOuterLow = Math.atan2(ixLow[1] - outerC[1], ixLow[0] - outerC[0]);
  let angOuterHigh = Math.atan2(ixHigh[1] - outerC[1], ixHigh[0] - outerC[0]);
  const angInnerHigh = Math.atan2(ixHigh[1] - innerC[1], ixHigh[0] - innerC[0]);
  let angInnerLow = Math.atan2(ixLow[1] - innerC[1], ixLow[0] - innerC[0]);
  const out: Pt[] = [];
  // Outer arc the LONG way around the LEFT (through angle π) from low → high.
  if (angOuterHigh < angOuterLow) angOuterHigh += TAU;
  out.push(...arc(outerC[0], outerC[1], outerR, angOuterLow, angOuterHigh, 26));
  // Inner arc back from high → low along the inner circle's LEFT bulge (the
  // bite), going the short way through ≈π.
  if (angInnerLow > angInnerHigh) angInnerLow -= TAU;
  out.push(...arc(innerC[0], innerC[1], innerR, angInnerHigh, angInnerLow, 22));
  return normalizeUnit(out);
}

// ─── teardrop (round bottom bulb, sharp point at top) ────────────────────────

/** A teardrop / water-drop via the classic curve:
 *    x = sin t,  y = cos t · sin^m(t/2)
 *  giving a round bottom and a cusp at the top as m grows. Point is at top.
 *  Dense curve, normalized + y-flipped so the cusp sits at the TOP of the box. */
function teardropUnit(m = 2): Pt[] {
  const n = 60;
  const raw: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TAU;
    const x = Math.sin(t);
    const y = Math.cos(t) * Math.pow(Math.sin(t / 2), m);
    raw.push([x, y]);
  }
  // raw point (cusp) is at math-up max-y; flip so it lands at the top.
  return normalizeUnitFlipY(raw);
}

// ─── diamond / lightning / arrow-block (corner vertex chains) ────────────────

/** Diamond (rhombus): the 4 mid-edge points of the bbox. Cornered. */
function diamondUnit(): Pt[] {
  return [
    [0.5, 0.0], // top
    [1.0, 0.5], // right
    [0.5, 1.0], // bottom
    [0.0, 0.5], // left
  ];
}

/** Lightning bolt vertices — a recognizable zig-zag bolt as a closed outline.
 *  Down the left diagonal, notch, to the bottom tip, back up the right edge
 *  with a notch, to the top. Cornered. Normalized to fill the box. */
function lightningVerts(): Pt[] {
  return [
    [0.62, 0.00], // top
    [0.18, 0.52], // long diagonal down-left
    [0.46, 0.52], // notch in (kick right)
    [0.22, 1.00], // bottom tip (down-left)
    [0.86, 0.40], // back up the right side
    [0.52, 0.40], // inner notch
  ];
}

/** Arrow-block: a solid block arrow pointing RIGHT (shaft + triangular head).
 *  7 corner vertices, cornered, filling the box. */
function arrowBlockUnit(): Pt[] {
  const shaftTop = 0.32, shaftBot = 0.68;
  const headTop = 0.06, headBot = 0.94;
  const headBaseX = 0.55;
  return [
    [0.0, shaftTop],       // shaft top-left
    [headBaseX, shaftTop], // shaft top-right
    [headBaseX, headTop],  // head top (barb)
    [1.0, 0.5],            // tip
    [headBaseX, headBot],  // head bottom (barb)
    [headBaseX, shaftBot], // shaft bottom-right
    [0.0, shaftBot],       // shaft bottom-left
  ];
}

// ─── basic primitives (rectangle / circle / triangle / rounded-rect) ─────────

/** Unit ELLIPSE filling [0,1]² — dense curve outline (fills the bbox = circle when
 *  the bbox is square). */
function ellipseUnit(n = 64): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
  }
  return out;
}

/** Unit ROUNDED RECTANGLE filling [0,1]². `r` = corner radius as a fraction of the
 *  unit box (clamped to 0.5); each corner is a sampled quarter-arc (clockwise,
 *  y-down screen convention) so the outline reads smooth. */
function roundedRectUnit(r = 0.22, perCorner = 8): Pt[] {
  const rr = Math.max(0.001, Math.min(0.5, r));
  const out: Pt[] = [];
  // [centerX, centerY, arc-start-angle] for TL → TR → BR → BL, each sweeping +90°.
  const corners: [number, number, number][] = [
    [rr, rr, Math.PI],          // top-left:     180° → 270°
    [1 - rr, rr, -Math.PI / 2], // top-right:    270° → 360°
    [1 - rr, 1 - rr, 0],        // bottom-right:   0° →  90°
    [rr, 1 - rr, Math.PI / 2],  // bottom-left:   90° → 180°
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 + (i / perCorner) * (Math.PI / 2);
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return out;
}

// ─── library registry ────────────────────────────────────────────────────────

export const SHAPE_LIBRARY: ShapeLibraryEntry[] = [
  // BASICS first (the everyday primitives — a heart was insertable but a square
  // wasn't). Rectangle/triangle are corner chains; circle/rounded-rect are curves.
  {
    kind: 'rectangle',
    label: 'Rectangle',
    curved: false,
    generate: (b) => mapUnit([[0, 0], [1, 0], [1, 1], [0, 1]], b),
  },
  {
    kind: 'circle',
    label: 'Circle',
    curved: true,
    generate: (b) => mapUnit(ellipseUnit(64), b),
  },
  {
    kind: 'triangle',
    label: 'Triangle',
    curved: false,
    // Equilateral, vertex UP, normalized to fill the box (same family as pentagon).
    generate: (b) => mapUnit(regularPolygonFilledUnit(3, 0), b),
  },
  {
    kind: 'rounded-rect',
    label: 'Rounded rect',
    curved: true,
    generate: (b) => mapUnit(roundedRectUnit(0.22, 8), b),
  },
  {
    kind: 'diamond',
    label: 'Diamond',
    curved: false,
    generate: (b) => mapUnit(diamondUnit(), b),
  },
  {
    kind: 'pentagon',
    label: 'Pentagon',
    curved: false,
    generate: (b) => mapUnit(regularPolygonFilledUnit(5, 0), b),
  },
  {
    kind: 'hexagon',
    label: 'Hexagon',
    curved: false,
    // Pointy-top hexagon (vertex up); normalized to fill the box.
    generate: (b) => mapUnit(regularPolygonFilledUnit(6, 0), b),
  },
  {
    kind: 'octagon',
    label: 'Octagon',
    curved: false,
    // Offset half a step → flat top/bottom/sides (the "stop sign" octagon).
    generate: (b) => mapUnit(regularPolygonFilledUnit(8, 180 / 8), b),
  },
  {
    kind: 'heart',
    label: 'Heart',
    curved: true,
    generate: (b) => mapUnit(heartUnit(64), b),
  },
  {
    kind: 'cloud',
    label: 'Cloud',
    curved: true,
    generate: (b) => mapUnit(cloudUnit(), b),
  },
  {
    kind: 'speech-bubble',
    label: 'Speech Bubble',
    curved: true,
    generate: (b) => mapUnit(speechBubbleUnit(), b),
  },
  {
    kind: 'lightning',
    label: 'Lightning',
    curved: false,
    generate: (b) => mapUnit(normalizeUnit(lightningVerts()), b),
  },
  {
    kind: 'crescent',
    label: 'Crescent',
    curved: true,
    generate: (b) => mapUnit(crescentUnit(), b),
  },
  {
    kind: 'teardrop',
    label: 'Teardrop',
    curved: true,
    generate: (b) => mapUnit(teardropUnit(2), b),
  },
  {
    kind: 'arrow-block',
    label: 'Arrow',
    curved: false,
    generate: (b) => mapUnit(arrowBlockUnit(), b),
  },
  {
    kind: 'star-5',
    label: 'Star',
    curved: false,
    generate: (b) => mapUnit(star5Unit(5, 0.40), b),
  },
];

const BY_KIND: Map<string, ShapeLibraryEntry> = new Map(
  SHAPE_LIBRARY.map((e) => [e.kind, e]),
);

/** Generate a shape outline by kind, scaled to bbox. Returns null for an
 *  unknown kind. Pure + deterministic. */
export function generateShape(kind: string, bbox: BBox): Pt[] | null {
  const entry = BY_KIND.get(kind);
  if (!entry) return null;
  return entry.generate(bbox);
}
