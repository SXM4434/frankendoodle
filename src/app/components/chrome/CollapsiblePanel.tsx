import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { PILL } from '../../lib/chromeStyles';

// Collapse motion: ~260ms ease-out (Material "standard" curve). The inner
// content slides via transform (composite-only) while the outer width
// transition stays under 300ms to bound the layout-reflow cost.
const DURATION = 260;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Measure an element against a width breakpoint via ResizeObserver — returns
 * true while the element's content-box width is at or below `breakpoint`.
 *
 * Why measured, not a window media query (per feedback_no_static_pixels_when_
 * viewport_relative): a page header's available width is NOT the viewport — open
 * side panels eat into it, and the same header renders inside the desk page,
 * the playground and (post-makeathon) embeds at different widths. The header
 * cluster overflow the narrow-viewport fix targets is a function of the
 * HEADER's box, so the header's box is what we watch. Defaults false on the
 * server / before first measure so the desktop (wide) layout is the SSR-safe
 * default and only collapses once a real narrow measurement lands.
 */
export function useElementNarrow(
  ref: RefObject<HTMLElement>,
  breakpoint: number,
): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      // content-box width — the space the header's children actually share.
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setNarrow(w <= breakpoint);
    });
    ro.observe(el);
    // Seed from the current width so the first paint after mount is correct
    // even before the observer's initial callback.
    setNarrow(el.clientWidth <= breakpoint);
    return () => ro.disconnect();
  }, [ref, breakpoint]);
  return narrow;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Persisted panel open state, keyed per page+side in localStorage. */
export function usePanelOpen(
  key: string,
  defaultOpen = true,
): [boolean, () => void, (v: boolean) => void] {
  const storageKey = `dd.panel.${key}`;
  const [open, setOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved === null ? defaultOpen : saved === '1';
  });
  useEffect(() => {
    localStorage.setItem(storageKey, open ? '1' : '0');
  }, [open, storageKey]);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return [open, toggle, setOpen];
}

/**
 * ⌘\ / Ctrl+\ minimizes or restores every registered panel at once
 * (Figma "Minimize UI" convention). The header PanelToggles never collapse,
 * so a visible escape hatch always remains — never shortcut-only recovery.
 */
export function useMinimizeUi(
  panels: Array<{ open: boolean; setOpen: (v: boolean) => void }>,
) {
  const ref = useRef(panels);
  ref.current = panels;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        const anyOpen = ref.current.some((p) => p.open);
        ref.current.forEach((p) => p.setOpen(!anyOpen));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * Fixed-but-collapsible side panel (Figma UI3 model). Place as a direct child
 * of a `display: flex` row next to a `flex: 1` main; the panel keeps layout
 * space while open and releases it when collapsed. Visual styling of the
 * panel surface (bg, borders, padding, overflow) is passed via `style`.
 * When closed the content is visibility-hidden after the slide, removing it
 * from the tab order and accessibility tree (React 18 — no `inert`).
 */
export function CollapsiblePanel({
  side,
  open,
  width,
  id,
  style,
  children,
}: {
  side: 'left' | 'right';
  open: boolean;
  width: number;
  id?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  const outer: CSSProperties = {
    width: open ? width : 0,
    flexShrink: 0,
    overflow: 'hidden',
    transition: reduced ? 'none' : `width ${DURATION}ms ${EASE}`,
  };
  const inner: CSSProperties = {
    width,
    height: '100%',
    boxSizing: 'border-box',
    transform: open
      ? 'translateX(0)'
      : `translateX(${side === 'left' ? -width : width}px)`,
    opacity: open ? 1 : 0,
    visibility: open ? 'visible' : 'hidden',
    transition: reduced
      ? `opacity 150ms linear, visibility 0s linear ${open ? 0 : 150}ms`
      : `transform ${DURATION}ms ${EASE}, opacity ${DURATION}ms ${EASE}, visibility 0s linear ${open ? 0 : DURATION}ms`,
    ...style,
  };
  return (
    <div style={outer} aria-hidden={!open}>
      <aside id={id} style={inner}>
        {children}
      </aside>
    </div>
  );
}

const TOGGLE: CSSProperties = {
  ...PILL,
  padding: '4px 10px',
  fontSize: 10,
};

/**
 * Header pill that toggles a CollapsiblePanel. Lives in the page header
 * chrome (toggles always in chrome, never in the panel/canvas). Chevron
 * points toward the edge the panel collapses into and flips when collapsed.
 */
export function PanelToggle({
  side,
  open,
  label,
  onToggle,
  controlsId,
}: {
  side: 'left' | 'right';
  open: boolean;
  label: string;
  onToggle: () => void;
  controlsId?: string;
}) {
  // Stroked chevron — the SAME mark grammar as the Dropdown chevron (one
  // chevron family app-wide; the old filled ▶/◀ text triangles read as a
  // different, heavier species). Points toward the edge the panel collapses
  // into; flips when collapsed.
  const pointsLeft = side === 'left' ? open : !open;
  const chevron = (
    <svg width="6" height="10" viewBox="0 0 6 10" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d={pointsLeft ? 'M5 1L1 5l4 4' : 'M1 1l4 4-4 4'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
  const isMac =
    typeof navigator !== 'undefined' &&
    navigator.platform.toUpperCase().includes('MAC');
  const shortcut = isMac ? '⌘\\' : 'Ctrl+\\';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controlsId}
      title={`${open ? 'Hide' : 'Show'} ${label} panel (${shortcut})`}
      style={{ ...TOGGLE, display: 'inline-flex', alignItems: 'center', gap: 7 }}
    >
      {pointsLeft && chevron}
      {label}
      {!pointsLeft && chevron}
    </button>
  );
}
