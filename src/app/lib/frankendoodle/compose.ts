// Frankendoodle — panel compositing.
//
// Each panel is drawn on a DrawSurface whose capture space is a fixed
// 800×600 viewBox. A finished creature stacks the panels head → body → legs.
// Rather than fixed 600px bands (which leaves big gaps when people draw
// small), we COMPACT: each panel is centered and butted directly under the
// previous one by its own tight bbox, so the parts actually connect.

import { strokesToObjectMarkup, type Stroke, type StrokePoint } from '../../components/DeskDoodles/DrawSurface';
import type { ToneFill } from '../toneMask';
import type { F3SvgStyle } from '../../state/F3SvgStyleContext';
import type { F3ModifiersState } from '../../state/F3RoughModifiersContext';

export const PANEL_W = 800;
export const PANEL_H = 600;

/** Fraction of the previous panel's bottom shown as the "seam" guide. */
export const SEAM_FRAC = 0.16;

/** The full Desk-Doodles style config a piece was drawn (or restyled) in. */
export interface PieceStyle {
  svgStyle: F3SvgStyle;
  mods: F3ModifiersState;
  toneFills: ToneFill[];
  /** whether this part was made 3D while drawing — carried to the reveal. */
  view?: '2d' | '3d';
}

export interface FdPanel {
  by: 0 | 1;
  strokes: Stroke[];
  svgStyle: F3SvgStyle;
  mods: F3ModifiersState;
  toneFills: ToneFill[];
  /** '3d' if the drawer popped this part into 3D; defaults to '2d'. */
  view?: '2d' | '3d';
}

/** One panel as its own tightly-cropped SVG string, WITH its shade/tone fills
 * (the real DD marks). Rendered through SvgStyleTransform under the piece's
 * style config for the exact look. */
export function pieceMarkup(panel: FdPanel): string {
  return strokesToObjectMarkup(panel.strokes, panel.toneFills);
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
interface Placement {
  dx: number;
  dy: number;
}
export interface Layout {
  placements: Placement[];
  viewBox: { x: number; y: number; w: number; h: number };
}

function bboxOf(p: FdPanel): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  p.strokes.forEach((s) =>
    s.points.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }),
  );
  if (!Number.isFinite(minX)) return { minX: 300, minY: 250, maxX: 500, maxY: 350 };
  return { minX, minY, maxX, maxY };
}

/** Center each panel horizontally and stack them tight, top to bottom. */
export function layoutPanels(panels: FdPanel[]): Layout {
  const gap = 18;
  const centerX = PANEL_W / 2;
  const placements: Placement[] = [];
  let yCursor = 0;
  let contentMinX = Infinity;
  let contentMaxX = -Infinity;
  panels.forEach((p) => {
    const b = bboxOf(p);
    const cx = (b.minX + b.maxX) / 2;
    const dx = centerX - cx;
    const dy = yCursor - b.minY;
    placements.push({ dx, dy });
    contentMinX = Math.min(contentMinX, b.minX + dx);
    contentMaxX = Math.max(contentMaxX, b.maxX + dx);
    yCursor += b.maxY - b.minY + gap;
  });
  if (!Number.isFinite(contentMinX)) {
    contentMinX = 300;
    contentMaxX = 500;
  }
  const totalH = Math.max(1, yCursor - gap);
  const pad = 36;
  return {
    placements,
    viewBox: {
      x: contentMinX - pad,
      y: -pad,
      w: contentMaxX - contentMinX + pad * 2,
      h: totalH + pad * 2,
    },
  };
}

function strokeToPath(points: StrokePoint[], dx: number, dy: number, color = 'var(--dir-text-primary)', width = 4): string {
  if (points.length === 0) return '';
  const d = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)}`)
    .join(' ');
  return `<path fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`;
}

/** The whole creature as one self-contained SVG string. */
export function composeMarkup(panels: FdPanel[], color?: string): string {
  const { placements, viewBox } = layoutPanels(panels);
  const body = panels
    .map((p, i) => p.strokes.map((s) => strokeToPath(s.points, placements[i].dx, placements[i].dy, color)).join(''))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}">${body}</svg>`;
}

/** Just one panel, self-contained (used for the staggered reveal). */
export function panelMarkup(panels: FdPanel[], index: number, color?: string): string {
  const { placements, viewBox } = layoutPanels(panels);
  const p = panels[index];
  const body = p ? p.strokes.map((s) => strokeToPath(s.points, placements[index].dx, placements[index].dy, color)).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}">${body}</svg>`;
}

/** The creature as stacked stroke points normalized to [0,w]×[0,h]. */
export function compose3DStrokes(panels: FdPanel[]): StrokePoint[][] {
  const { placements, viewBox } = layoutPanels(panels);
  const out: StrokePoint[][] = [];
  panels.forEach((p, i) => {
    const { dx, dy } = placements[i];
    p.strokes.forEach((s) => {
      if (s.points.length < 2) return;
      out.push(s.points.map(([x, y, pr]) => [x + dx - viewBox.x, y + dy - viewBox.y, pr] as StrokePoint));
    });
  });
  return out;
}

/** viewBox for the 3D mount (matches the normalized stroke space). */
export function composeViewBox(panels: FdPanel[]): { w: number; h: number } {
  const { viewBox } = layoutPanels(panels);
  return { w: viewBox.w, h: viewBox.h };
}

/** ONE panel's strokes normalized to its own tight box — for a per-piece 3D
 * mount (each part can be independently 2D or 3D). Mirrors the tight bbox
 * that panelLayout() uses to position the 2D piece, so 3D and 2D pieces line
 * up in the same stage slot. */
export function panel3DStrokes(panel: FdPanel): { strokes: StrokePoint[][]; viewBox: { w: number; h: number } } {
  const b = bboxOf(panel);
  const pad = 14;
  const x0 = b.minX - pad;
  const y0 = b.minY - pad;
  const w = b.maxX - b.minX + pad * 2;
  const h = b.maxY - b.minY + pad * 2;
  const strokes: StrokePoint[][] = [];
  panel.strokes.forEach((s) => {
    if (s.points.length < 2) return;
    strokes.push(s.points.map(([x, y, pr]) => [x - x0, y - y0, pr] as StrokePoint));
  });
  return { strokes, viewBox: { w, h } };
}

/** Per-panel placed centers + sizes (layout space) + the overall viewBox. */
export function panelLayout(panels: FdPanel[]): {
  boxes: { cx: number; cy: number; w: number; h: number }[];
  viewBox: { x: number; y: number; w: number; h: number };
} {
  const { placements, viewBox } = layoutPanels(panels);
  const boxes = panels.map((p, i) => {
    const b = bboxOf(p);
    const { dx, dy } = placements[i];
    return { cx: (b.minX + b.maxX) / 2 + dx, cy: (b.minY + b.maxY) / 2 + dy, w: b.maxX - b.minX, h: b.maxY - b.minY };
  });
  return { boxes, viewBox };
}

/** One panel as its OWN tightly-cropped SVG (for independent physics bodies). */
export function singlePanelTightMarkup(panel: FdPanel, color?: string): string {
  const b = bboxOf(panel);
  const pad = 14;
  const body = panel.strokes.map((s) => strokeToPath(s.points, 0, 0, color)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}">${body}</svg>`;
}

/** The faint bottom-strip of the previous panel, for the seam guide. */
export function seamPeekMarkup(prev: FdPanel | undefined): string | null {
  if (!prev || prev.strokes.length === 0) return null;
  const stripY = PANEL_H * (1 - SEAM_FRAC);
  const stripH = PANEL_H * SEAM_FRAC;
  const body = prev.strokes.map((s) => strokeToPath(s.points, 0, 0)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${stripY} ${PANEL_W} ${stripH}" preserveAspectRatio="none">${body}</svg>`;
}

/** Rasterize the creature to a PNG and trigger a download (a keepsake). */
export async function saveCompositePng(panels: FdPanel[], filename = 'our-frankendoodle.png'): Promise<void> {
  const markup = composeMarkup(panels, '#211c16');
  const m = /viewBox="([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/.exec(markup);
  const vw = m ? parseFloat(m[3]) : 800;
  const vh = m ? parseFloat(m[4]) : 1800;
  const scale = Math.min(3, 1400 / Math.max(vw, vh));
  const W = Math.round(vw * scale);
  const H = Math.round(vh * scale);
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('img'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#faf7f0';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    await new Promise<void>((res) =>
      canvas.toBlob((b) => {
        if (b) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = filename;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }
        res();
      }, 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
