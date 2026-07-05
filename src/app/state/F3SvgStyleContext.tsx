import { createContext, useContext, useState, type ReactNode } from 'react';

// F3 SVG style toggle — cross-path render-treatment dimension.
//
// Per F3-toggle-architecture.md (2026-06-01): every Style option must have
// BOTH an SVG implementation AND a 3D implementation (same Style value, same
// register, different implementation per path). 3D versions come in Phase 3.

export type F3SvgStyle =
  | 'clean'
  | 'outline-only'
  | 'rough-handdrawn'
  | 'sketchy'
  | 'bold-ink'
  | 'wet-ink'
  | 'stipple'
  | 'charcoal'
  | 'risograph'
  | 'newsprint'
  // REBUILT FOR REAL (Rock Y 2026-06-12, Sebs: "build it fr real" — overrides
  // the Rock B stub removal): wireframe is now a true schematic register —
  // every path/shape renders as its TRUE GEOMETRY in uniform hairline strokes
  // (fills become their outline boundary, no hand-feel jitter, ink black).
  // Implementation: applyWireframeSchematic in SvgStyleTransform.tsx. The old
  // bounding-box stub (replaced children with bbox rects) is the explicit
  // anti-fixture — never reintroduce it. Persisted legacy 'wireframe'
  // render_configs now parse as wireframe again and get the real treatment.
  | 'wireframe';

export type F3SvgStyleMeta = {
  id: F3SvgStyle;
  label: string;
  detail: string;
  /** True if this style uses rough.js-family parameters (modifiers section applies). */
  isRoughFamily: boolean;
};

export const F3_SVG_STYLES: F3SvgStyleMeta[] = [
  { id: 'clean',           label: 'Clean',           detail: 'Source SVG as drawn. Crisp vectors.', isRoughFamily: false },
  { id: 'outline-only',    label: 'Outline only',    detail: 'Strip fills; keep strokes only. Pure line illustration register.', isRoughFamily: false },
  { id: 'rough-handdrawn', label: 'Rough hand-drawn', detail: 'rough.js multi-stroke jittered Bezier. Sibling-coherent with playground.', isRoughFamily: true },
  { id: 'sketchy',         label: 'Sketchy',         detail: 'Gentler rough — lower roughness, fewer strokes. Quick-draft register.', isRoughFamily: true },
  { id: 'bold-ink',        label: 'Bold ink',        detail: 'Heavier strokes (~2.5+), less jitter — confident felt-tip register.', isRoughFamily: true },
  { id: 'wet-ink',         label: 'Wet ink',         detail: 'Soft edges via feGaussianBlur filter — bleeding-paper feel.', isRoughFamily: false },
  { id: 'stipple',         label: 'Stipple',         detail: 'Dot-pattern fills. Pointillist register.', isRoughFamily: true },
  { id: 'charcoal',        label: 'Charcoal',        detail: 'feTurbulence filter overlay on strokes — graphite register.', isRoughFamily: false },
  { id: 'risograph',       label: 'Risograph',       detail: 'Each path duplicated in 2 colors with offset — print-shop register.', isRoughFamily: false },
  { id: 'newsprint',       label: 'Newsprint',       detail: 'Dot-pattern fills via SVG pattern — newspaper register.', isRoughFamily: false },
  // Rock Y 2026-06-12: wireframe RESTORED as a real style (see union note
  // above). Membership here re-enables the dropdown option and makes every
  // render_config parser accept persisted 'wireframe' ids again.
  { id: 'wireframe',       label: 'Wireframe',       detail: 'Uniform hairline schematic — contours only. True geometry, no hand-feel.', isRoughFamily: false },
];

type Ctx = {
  state: F3SvgStyle;
  setState: (v: F3SvgStyle) => void;
};

const F3SvgStyleCtx = createContext<Ctx | null>(null);

export function F3SvgStyleProvider({ children }: { children: ReactNode }) {
  // Default = the engine's signature look — first-time visitors (and judges
  // clicking the Make link) see Smart Hachure working without touching a
  // single control (Q-8 decision, Sebs 2026-06-10: "do what u feel best").
  const [state, setState] = useState<F3SvgStyle>('rough-handdrawn');
  return <F3SvgStyleCtx.Provider value={{ state, setState }}>{children}</F3SvgStyleCtx.Provider>;
}

export function useF3SvgStyle(): Ctx {
  const v = useContext(F3SvgStyleCtx);
  if (!v) throw new Error('useF3SvgStyle must be used inside F3SvgStyleProvider');
  return v;
}

export function isRoughFamilyStyle(s: F3SvgStyle): boolean {
  return F3_SVG_STYLES.find((m) => m.id === s)?.isRoughFamily ?? false;
}
