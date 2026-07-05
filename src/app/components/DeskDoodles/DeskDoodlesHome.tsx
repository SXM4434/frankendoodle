import {
  Component,
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { NavLink } from 'react-router';
import { IS, ISe } from '../../lib/typography';
import { CTA, SECTION_LABEL, CHIP } from '../../lib/chromeStyles';
import { PAPER_GRAIN, WARM_POOL, OBJECT_SIT_SHADOW } from '../../lib/deskCraft';
import { isPersonalSpaceEnabled, getIdentityId, getLocalHandle } from '../../lib/personalSpace';
import { handleFromId, displayHandle } from '../../lib/handle';
import { PegToolShape } from '../../lib/items/PegToolShape';
import type { F3PegboardShapeId } from '../../lib/items/identitySet';
import { F3SvgStyleProvider, useF3SvgStyle, type F3SvgStyle } from '../../state/F3SvgStyleContext';
import {
  F3RoughModifiersProvider,
  useF3RoughModifiers,
  DEFAULT_MODIFIERS,
  type F3ModifiersState,
} from '../../state/F3RoughModifiersContext';
import { applyStylePreset, SvgStyleTransform } from '../canvas/SvgStyleTransform';
import { Object3DSlot, Shared3DOverlay } from './DeskObject3DMount';
import { type Geometry3DConfig } from '../../lib/geometry3d/deskRenderMode';
import { svgMarkupToStrokes } from '../../lib/svgToStrokes';
import type { StrokeInputPoint } from '../../lib/geometry3d/strokeTo3d';

// ─── HOMEPAGE = "the living desk" + a SHOWCASE of the engine ─────────────────
// The hero IS the product. It uses the app's OWN AUDIT CATALOG objects (real,
// recognizable little things — a Game Boy, a pokéball, a mug, a record — not
// random scribbles), strewn on warm paper like a real creative's desk. The fun
// twist (Sebs 2026-06-14): EACH object renders in a DIFFERENT F3 SVG style, and
// each behaves differently —
//   · 'flip'    — auto-cycles 2D ⇄ 3D on a timer (and the 3D is ROTATABLE),
//   · '3d-only' — always shown in interactive 3D,
//   · '2d-only' — stays a flat styled doodle.
// So one glance shows the style range AND the 2D↔3D wedge. The 3D mounts are
// `transparent interactive` so you can actually grab and rotate them on the
// homepage (Sebs: "I can't interact with the 3D on the homepage").
//
// prefers-reduced-motion: no auto-flip — flip objects stay 2D (3d-only objects
// still mount, but orbit is user-driven, never animated).

// ── The catalog objects, each its own style + behavior ───────────────────────
type HeroBehavior = 'flip' | '3d-only' | '2d-only';

interface HeroObject {
  /** A real catalog shape id — PegToolShape renders the 2D face. */
  shape: F3PegboardShapeId;
  /** Human label for the title attr / a11y. */
  name: string;
  /** The F3 SVG style this object showcases (distinct per object). */
  style: F3SvgStyle;
  /** How this object behaves: auto-flip, always-3D, or stay-2D. */
  behavior: HeroBehavior;
  /** DISTINCT 3D look for flip / 3d-only objects (Sebs: "different 3d styles,
   *  some that feel closest to the SVG"). geometryMode + style3d + material vary
   *  per object: native materials (clay/gel/glossy/rubber/signal) for solid
   *  reads, 'hatch' for the hand-drawn-on-form look closest to the 2D. */
  geo3d?: Geometry3DConfig;
}

// 13 hero objects — ORIGINAL composition (Sebs: "homepage before was right —
// some 3d, some 2d, some that switch"). 4 flip · 2 3d-only · 7 2d-only. Each 3D
// look differs by GEOMETRY + style3d; everything stays ink-black (the body color
// is always inkColor — material presets only change how LIGHT sits, never hue).
// R10 distinct-fix (Sebs "nothing repeats"): among the SIX that show 3D the only
// collisions were extrude (gameBoy+medal) and inflate (pairedMug+shoe) — broken
// by moving medal→solid and shoe→rod, NO color/behavior change. Game Boy carves
// its detail via svg-port (engraving), still black.
const HERO_OBJECTS: HeroObject[] = [
  // ── the four that FLIP (2D ⇄ 3D, rotatable in 3D) — each a DISTINCT 3D look ──
  { shape: 'pokeball',  name: 'Pokéball',     style: 'rough-handdrawn', behavior: 'flip',
    geo3d: { geometryMode: 'solid',   style3d: 'native', materialPreset: 'glossyPlastic' } }, // #1 GLOSSY black ball (carved band/button glints)
  { shape: 'flagPin',           name: 'Flag pin',   style: 'clean',        behavior: '2d-only' }, // (swapped here from bottom-right — Sebs)
  { shape: 'pairedMug', name: 'Paired mugs',  style: 'charcoal',        behavior: 'flip',
    geo3d: { geometryMode: 'inflate', style3d: 'native', materialPreset: 'softGel' } },        // puffy gel
  { shape: 'medal',     name: 'Race medal',   style: 'sketchy',         behavior: 'flip',
    geo3d: { geometryMode: 'solid',   style3d: 'hatch' } },                                    // hatched fused mass (was extrude — breaks the extrude repeat)
  // ── the two that stay ALWAYS-3D (interactive) ──
  { shape: 'switch',    name: 'Switch',       style: 'clean',           behavior: '3d-only',
    geo3d: { geometryMode: 'rod',     style3d: 'native', materialPreset: 'signal' } },         // metallic tube
  { shape: 'shoe',      name: 'Running shoe', style: 'wireframe',       behavior: '3d-only',
    geo3d: { geometryMode: 'rod',     style3d: 'hatch' } },                                    // hatched wire (was inflate — breaks the inflate repeat)
  // ── the seven that stay 2D — the style range on display ──
  { shape: 'vinyl',             name: 'Vinyl',      style: 'stipple',      behavior: '2d-only' },
  { shape: 'overEarHeadphones', name: 'Headphones', style: 'outline-only', behavior: '2d-only' },
  { shape: 'filmReel',          name: 'Film reel',  style: 'newsprint',    behavior: '2d-only' },
  { shape: 'marioHat',          name: 'Mario hat',  style: 'wet-ink',      behavior: '2d-only' },
  { shape: 'ps5Controller',     name: 'Controller', style: 'risograph',    behavior: '2d-only' },
  { shape: 'gameBoy',   name: 'Game Boy',     style: 'bold-ink',        behavior: 'flip',
    geo3d: { geometryMode: 'extrude', style3d: 'native', materialPreset: 'rubber' } },         // moved to bottom-right (slot s12) — etched satin slab
  { shape: 'instaxCamera',      name: 'Instax',     style: 'wet-ink',      behavior: '2d-only' },
];

// ── Per-object resolved modifier state (style preset applied) ────────────────
// applyStylePreset folds the chosen style's calibrated modifier preset onto the
// DEFAULT baseline, so each object reads as a genuine instance of its style
// (the same thing the desk chrome's style-switch does), not the default look.
function modsForStyle(style: F3SvgStyle): F3ModifiersState {
  return applyStylePreset(DEFAULT_MODIFIERS, style);
}

// ── Strokes for the 3D mount ─────────────────────────────────────────────────
// The 3D engine needs StrokeInputPoint[][]. We DERIVE them from the catalog
// shape's own static SVG. MAKE-SAFE (2026-06-15): Figma Make's react-dom-server
// shim does NOT export renderToStaticMarkup (it crashed the whole bundle → blank
// pages). So instead of server-render-to-string, we render <PegToolShape> into a
// detached offscreen DOM node via react-dom/client + flushSync (synchronous, so
// the SVG exists immediately), read its outerHTML, then unmount. Browser-only
// (guarded), called from an effect (flushSync is allowed there, never in render).
function shapeMarkupAsync(shape: F3PegboardShapeId): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve('');
      return;
    }
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden';
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(<PegToolShape shape={shape} />);
    // POLL for the committed <svg> across a few frames (createRoot is async — one
    // frame isn't always enough for it to commit). Reading happens OUTSIDE React's
    // render phase, so no flushSync / "called while rendering" warning. Give up
    // after ~20 frames → '' (object stays 2D, graceful).
    let tries = 0;
    const tick = () => {
      const svg = host.querySelector('svg');
      if (svg || tries >= 20) {
        let markup = svg ? svg.outerHTML : ''; // browser serializes SVG WITH its xmlns
        try { root.unmount(); } catch { /* ignore */ }
        host.remove();
        if (markup && /^\s*<svg[\s>]/.test(markup) && !/\sxmlns=/.test(markup)) {
          markup = markup.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        resolve(markup);
        return;
      }
      tries++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Derive 3D strokes for a catalog shape from its OWN static SVG. Returns null
 *  on the server, before mount, OR if the shape yields no usable geometry — in
 *  which case the caller keeps the styled 2D face (the object stays 2D). It must
 *  NEVER substitute a generic placeholder form (Sebs: "never the dumb 3D star"):
 *  a flip/3d object either shows its REAL extruded silhouette or stays flat.
 *  With the `shapeMarkup` xmlns fix every hero shape now derives real strokes,
 *  so this empty path is a last-resort guard, not the normal route. */
async function deriveStrokes(shape: F3PegboardShapeId): Promise<StrokeInputPoint[][] | null> {
  if (typeof document === 'undefined') return null;
  const markup = await shapeMarkupAsync(shape);
  if (!markup) return null;
  const derived = svgMarkupToStrokes(markup) as StrokeInputPoint[][];
  return derived.length > 0 ? derived : null;
}

// ─── Canvas3DBoundary — self-healing 3D fence (auto-retry → 2D fallback) ───────
// The 2D⇄3D hero layer goes through react-three-fiber, which needs a WebGL context.
// In Make's sandboxed editor-preview iframe, acquiring that context is a COLD-LOAD
// RACE (same family as the Rapier finding): the first mount can lose the race and
// R3F throws while building the scene (`reading 'fg'` at createInstance) — which,
// unfenced, bubbles to React Router and white-screens the WHOLE page. The published
// site warms up fine; the preview is the flaky one.
//
// So this fence does two things instead of giving up:
//   1. AUTO-RETRY — on a 3D throw it shows the 2D `fallback`, waits a short backoff
//      (150ms → 400ms → 1s), then REMOUNTS the 3D (fresh key). The retry usually
//      lands on a now-warm context, so 3D appears on its own — no reload, no
//      babysitting. This is the closest to "guaranteed 3D" an iframe allows.
//   2. GRACEFUL FALLBACK — only after the retries are exhausted does it stay on the
//      2D `fallback` (the flat doodles). Never a white-screen.
// Ships as APP code, so it works regardless of Make's deps cache.
const CANVAS3D_BACKOFFS_MS = [150, 400, 1000];
class Canvas3DBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { down: boolean; attempt: number }
> {
  state = { down: false, attempt: 0 };
  private timer: number | undefined;
  static getDerivedStateFromError() {
    return { down: true };
  }
  componentDidCatch() {
    // Schedule a remount on backoff while we still have attempts left; otherwise
    // stay down (the 2D fallback is now permanent for this session).
    if (this.state.attempt < CANVAS3D_BACKOFFS_MS.length) {
      this.timer = window.setTimeout(() => {
        this.setState((s) => ({ down: false, attempt: s.attempt + 1 }));
      }, CANVAS3D_BACKOFFS_MS[this.state.attempt]);
    }
  }
  componentWillUnmount() {
    if (this.timer) window.clearTimeout(this.timer);
  }
  render() {
    if (this.state.down) return <>{this.props.fallback}</>;
    // Keyed so each retry mounts a FRESH 3D subtree (new context attempt).
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}

export function DeskDoodlesHome() {
  const personalOn = isPersonalSpaceEnabled();
  // Silent session handle — deterministic, no DB read. Invitational, never demanded.
  const handle = personalOn ? getLocalHandle() ?? handleFromId(getIdentityId()) : null;

  // The desk section owns the ONE shared WebGL canvas (Shared3DOverlay): every
  // hero object that flips/stays 3D draws into it via a drei <View>, so the page
  // holds a SINGLE GL context no matter how many objects are 3D at once. (Was N
  // independent <Canvas> mounts → fine locally but over Make's iframe context cap
  // → "Context Lost" crash.) The slots track their own on-screen rects, so the
  // canvas is just an absolute overlay inside this relative section.
  const deskRef = useRef<HTMLElement | null>(null);

  // Respect reduced motion — flip objects stay 2D, drift stops.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Pair each hero object with a fixed desk slot (12 objects ↔ 12 slots).
  const placed = useMemo(
    () => SLOTS.map((slot, i) => ({ slot, obj: HERO_OBJECTS[i % HERO_OBJECTS.length] })),
    [],
  );

  return (
    <div
      style={{
        position: 'relative',
        // Fixed viewport height + no scroll (Sebs: "homepage shouldn't scroll").
        // The desk section flexes to fill between the header and the doors row.
        height: '100vh',
        background: 'var(--dir-bg)',
        backgroundImage: `${PAPER_GRAIN}, ${WARM_POOL}`,
        color: 'var(--dir-text-primary)',
        fontFamily: IS,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <style>{HOME_CSS}</style>

      <header
        style={{
          position: 'relative',
          zIndex: 3,
          padding: '24px clamp(24px, 5vw, 56px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontFamily: ISe,
              fontSize: 22,
              letterSpacing: '-0.01em',
              fontVariationSettings: '"SOFT" 60, "WONK" 1',
            }}
          >
            Desk Doodles
          </span>
          <UnderlineScribble width={132} />
        </div>
        {handle && (
          <NavLink to="/your-space" style={{ ...CHIP, textDecoration: 'none' }} title="Your space">
            {displayHandle(handle)}
          </NavLink>
        )}
      </header>

      {/* ── THE LIVING DESK ── the hero IS the product: real catalog objects,
          each in a different style, some flipping 2D↔3D, some always-3D
          (rotatable), some flat — a showcase of what the app does. ─────────── */}
      <main
        style={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <section
          ref={deskRef}
          className="dd-desk"
          aria-label="A desk strewn with doodles, each in a different style"
        >
          {/* The 3D layer auto-retries on a cold-load context race, and shows the
              flat-2D desk (same slots, force2d) as the fallback during retries /
              if it ultimately can't get a context — never a white-screen. */}
          <Canvas3DBoundary
            fallback={placed.map(({ slot, obj }) => (
              <DeskItem key={slot.key} slot={slot} obj={obj} reduceMotion={reduceMotion} force2d />
            ))}
          >
            {/* The single shared 3D canvas for the whole desk (one GL context).
                It's an absolute, pointer-transparent overlay; every Object3DSlot
                below tunnels its 3D into it. First child so it sits BEHIND the
                slots' 2D faces (which reveal the 3D beneath as they flip). */}
            <Shared3DOverlay containerRef={deskRef} />
            {placed.map(({ slot, obj }) => (
              <DeskItem key={slot.key} slot={slot} obj={obj} reduceMotion={reduceMotion} />
            ))}
          </Canvas3DBoundary>

          {/* The cleared pocket — the words live in real negative space, lifted
              above the doodle layer so they're never crowded. */}
          <div className="dd-pocket">
            <span style={{ ...SECTION_LABEL, color: 'var(--dir-text-body-soft)' }}>
              A desk you doodle on
            </span>
            <h1
              style={{
                fontFamily: ISe,
                fontSize: 'clamp(38px, 6.2vw, 66px)',
                lineHeight: 1.02,
                letterSpacing: '-0.025em',
                fontVariationSettings: '"SOFT" 40, "WONK" 1',
                margin: '14px 0 0',
              }}
            >
              Doodle what's on your{' '}
              <span style={{ position: 'relative', whiteSpace: 'nowrap' }}>
                desk.
                <span style={{ position: 'absolute', left: 0, right: '-2%', bottom: '-0.28em' }}>
                  <UnderlineScribble width={170} strong />
                </span>
              </span>
            </h1>
            <p
              style={{
                fontFamily: IS,
                fontSize: 'clamp(15px, 1.6vw, 17px)',
                lineHeight: 1.55,
                color: 'var(--dir-text-body)',
                margin: '22px auto 0',
                maxWidth: 440,
              }}
            >
              Sketch your mug, your headphones, the dumb little trinkets — restyle them a dozen
              ways, flip them between 2D and 3D, and drop them onto a living wall of everyone
              else's desk.
            </p>
            <div
              style={{
                display: 'inline-flex',
                gap: 16,
                marginTop: 30,
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <NavLink
                to="/desk"
                className="dd-cta"
                style={{ ...CTA, padding: '14px 24px', fontSize: 12, textDecoration: 'none' }}
              >
                Start doodling →
              </NavLink>
              <NavLink
                to="/desks"
                className="dd-quiet"
                style={{
                  fontFamily: IS,
                  fontSize: 13,
                  color: 'var(--dir-text-body-soft)',
                  textDecoration: 'none',
                }}
              >
                or peek at the wall →
              </NavLink>
            </div>
            {/* The wedge, named — quiet caption that earns the styled, flipping
                doodles around it. */}
            <span
              style={{
                display: 'block',
                marginTop: 22,
                fontFamily: IS,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--dir-text-secondary)',
              }}
            >
              every doodle, any style · 2D ⇄ 3D · grab the 3D to spin it
            </span>
          </div>
        </section>

        {/* ── The destinations, demoted to a slim restrained row below the desk ── */}
        <nav className="dd-doors" aria-label="Where to go">
          <DoorLink to="/desk" label="Start a doodle" hint="No sign-up — just draw" primary />
          <DoorLink to="/desks" label="Browse the wall" hint="Everyone's shared desks" />
          {personalOn ? (
            <DoorLink to="/your-space" label="Your space" hint="Private desks + your drawer" />
          ) : (
            <DoorLink to="/canvas" label="Try the engine" hint="The 2D↔3D playground" />
          )}
        </nav>

        <footer
          style={{
            padding: '8px clamp(24px, 5vw, 56px) 28px',
            textAlign: 'center',
          }}
        >
          <span
            style={{
              fontFamily: IS,
              fontSize: 11,
              color: 'var(--dir-text-secondary)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Built in public · github.com/SXM4434/desk-doodles
          </span>
        </footer>
      </main>
    </div>
  );
}

// ─── Slot layout ──────────────────────────────────────────────────────────────
// Hand-placed absolute slots (% of the desk box) around a cleared CENTER pocket
// where the headline sits. Varied rotation + scale + the odd overlap = a real
// creative's desk, not a grid. 12 slots ↔ the 12 hero objects, off-pocket on
// purpose. `drift` = a gentle alive animation variant.
interface Slot {
  key: string;
  left: string;
  top: string;
  size: number; // px footprint at desktop
  rot: number; // deg
  z: number;
  drift?: 'a' | 'b' | 'c';
  hideNarrow?: boolean; // dropped on narrow widths to keep the desk uncrowded
}

// Spread across the WHOLE canvas — all four corners, both side-rails, and the
// top/bottom bands — while the center column (left ~34–66%, top ~26–72%) stays
// CLEAR for the headline pocket (Sebs: objects "all over the place without being
// too close" + never covering the content). Full-bleed desk (max-width:none) so
// these % reach the real screen edges, not a centered 1280 band.
// ORGANIC scatter (Sebs: "too uniform… fill the random gaps"): VARIED distance
// from the edges — some hug the rails, some sit in the inner band near the pocket
// — and staggered tops/sizes so it never reads as a ring. Inset (left ≤ 80%, top
// ≤ 79%) so nothing clips. The center pocket box (~left 34–66%, top 26–72%) stays
// clear. The inner-band slots (s6, s8) + the bottom slots fill the gaps circled.
const SLOTS: Slot[] = [
  { key: 's1', left: '4%', top: '9%', size: 156, rot: -8, z: 2, drift: 'a' },
  { key: 's2', left: '24%', top: '4%', size: 120, rot: 6, z: 1, drift: 'c', hideNarrow: true },
  { key: 's3', left: '49%', top: '3%', size: 130, rot: -5, z: 2, drift: 'b' },
  { key: 's4', left: '72%', top: '7%', size: 140, rot: 8, z: 3, drift: 'c' },
  { key: 's5', left: '2%', top: '43%', size: 148, rot: 5, z: 2, drift: 'b' },
  { key: 's6', left: '23%', top: '52%', size: 116, rot: -9, z: 1, drift: 'a', hideNarrow: true }, // inner-left gap
  { key: 's7', left: '80%', top: '27%', size: 144, rot: -6, z: 3, drift: 'c' },
  { key: 's8', left: '73%', top: '57%', size: 126, rot: 10, z: 2, drift: 'b', hideNarrow: true }, // inner-right gap
  { key: 's9', left: '7%', top: '74%', size: 152, rot: 9, z: 3, drift: 'a' },
  { key: 's10', left: '33%', top: '79%', size: 122, rot: -7, z: 2, drift: 'c', hideNarrow: true }, // bottom gap
  { key: 's11', left: '55%', top: '81%', size: 134, rot: 5, z: 2, drift: 'b' },
  { key: 's12', left: '78%', top: '75%', size: 140, rot: -10, z: 3, drift: 'a' }, // bottom-right gap
  { key: 's13', left: '2%', top: '82%', size: 146, rot: 8, z: 3, drift: 'c' },    // bottom-LEFT corner (Sebs)
];

// ─── DeskItem — one catalog object sitting on the desk ───────────────────────
// A bare object (no frame box): the styled ink sits directly on the paper with
// OBJECT_SIT_SHADOW so it lifts off, gently drifting. Its BEHAVIOR decides what
// renders inside — a flat styled face, an always-3D mount, or a face that flips.
function DeskItem({
  slot,
  obj,
  reduceMotion,
  force2d,
}: {
  slot: Slot;
  obj: HeroObject;
  reduceMotion: boolean;
  /** 3D fenced off (Canvas3DBoundary tripped) — render every object as its flat
   *  styled face regardless of behavior, so the desk survives without WebGL. */
  force2d?: boolean;
}) {
  return (
    <div
      className={`dd-item${slot.hideNarrow ? ' dd-item--narrowhide' : ''}`}
      style={
        {
          position: 'absolute',
          left: slot.left,
          top: slot.top,
          width: slot.size,
          height: slot.size,
          zIndex: slot.z,
          ['--rot' as string]: `${slot.rot}deg`,
          transform: `rotate(${slot.rot}deg)`,
          animation:
            slot.drift && !reduceMotion
              ? `dd-drift-${slot.drift} ${7 + slot.z}s ease-in-out infinite`
              : undefined,
        } as CSSProperties
      }
      title={`${obj.name} · ${obj.style}`}
    >
      {force2d ? (
        <StyledFace obj={obj} />
      ) : obj.behavior === 'flip' ? (
        <FlipObject obj={obj} reduceMotion={reduceMotion} />
      ) : obj.behavior === '3d-only' ? (
        <ThreeDObject obj={obj} />
      ) : (
        <StyledFace obj={obj} />
      )}
    </div>
  );
}

// ─── StyledFace — the 2D catalog object rendered through one F3 style ─────────
// PegToolShape wrapped in fresh nested F3 providers + a SurfaceRenderScope that
// pins THIS object's style + modifiers — the IDENTICAL render path the desk +
// object surface use, so each hero object is a true instance of its style.
function StyledFace({ obj }: { obj: HeroObject }) {
  const mods = useMemo(() => modsForStyle(obj.style), [obj.style]);
  return (
    <div className="dd-styledface" style={{ width: '100%', height: '100%', filter: OBJECT_SIT_SHADOW }}>
      <ScopedShape shape={obj.shape} style={obj.style} mods={mods} />
    </div>
  );
}

/** Sync bridge — replica of ObjectSurface's (private) SurfaceRenderScope. Runs
 *  INSIDE the nested providers, so it pins this object's style + modifiers onto
 *  the SHADOWED context for the wrapped subtree only — the app-root context is
 *  never touched. useLayoutEffect so the values land before paint (no flash of
 *  provider-default style). */
function RenderScope({
  svgStyle,
  mods,
  children,
}: {
  svgStyle: F3SvgStyle;
  mods: F3ModifiersState;
  children: ReactNode;
}) {
  const styleCtx = useF3SvgStyle();
  const modsCtx = useF3RoughModifiers();
  useLayoutEffect(() => {
    if (styleCtx.state !== svgStyle) styleCtx.setState(svgStyle);
  }, [styleCtx, svgStyle]);
  useLayoutEffect(() => {
    if (modsCtx.state !== mods) modsCtx.replace(mods);
  }, [modsCtx, mods]);
  return <>{children}</>;
}

/** PegToolShape under nested style providers, scaled to fill its slot box. */
function ScopedShape({
  shape,
  style,
  mods,
}: {
  shape: F3PegboardShapeId;
  style: F3SvgStyle;
  mods: F3ModifiersState;
}): ReactNode {
  return (
    <F3SvgStyleProvider>
      <F3RoughModifiersProvider>
        <RenderScope svgStyle={style} mods={mods}>
          {/* BUG FIX: RenderScope only PINS the F3 style/modifier context — it does
              not render the style. The component that actually applies the style is
              <SvgStyleTransform> (the same wrap DeskDoodlesAudit uses). Without it,
              every object rendered as the raw clean PegToolShape SVG ("they all just
              look like clean SVG"). Wrapping here — INSIDE the providers + scope —
              transforms the 2D face through THIS object's pinned style, so each hero
              object reads as a genuine instance of its assigned style. */}
          <SvgStyleTransform wrapperOverride={{ display: 'block', width: '100%', height: '100%' }}>
            <div className="dd-shapefit">
              <PegToolShape shape={shape} />
            </div>
          </SvgStyleTransform>
        </RenderScope>
      </F3RoughModifiersProvider>
    </F3SvgStyleProvider>
  );
}

// ─── ThreeDObject — an always-3D, rotatable catalog object ───────────────────
// Draws into the desk's SHARED canvas via an Object3DSlot (drei <View>) — one GL
// context for the whole page (the per-object <Canvas> path crashed Make's iframe
// at the context cap). interactive = grab + spin. Strokes derive from the shape's
// own SVG; while they derive (browser-only) we hold the styled 2D face so there's
// never an empty footprint.
function ThreeDObject({ obj }: { obj: HeroObject }) {
  const strokes = useDerivedStrokes(obj.shape);
  if (!strokes) return <StyledFace obj={obj} />;
  return (
    <Object3DSlot
      strokes={strokes}
      config={obj.geo3d ?? null}
      interactive
      style={{ width: '100%', height: '100%' }}
    />
  );
}

// ─── FlipObject — the wedge, live ────────────────────────────────────────────
// Auto-cycles the styled 2D face ⇄ the real interactive 3D form on a timer. The
// 3D is the SAME DeskObject3DMount the desk/surface use (the demo IS the
// product), transparent + interactive so it can be grabbed mid-cycle. Each flip
// object is staggered so they don't pulse in unison. prefers-reduced-motion →
// stays 2D (no auto-flip).
const FLIP_MS = 540; // total card-turn; face swaps at the edge-on midpoint
function FlipObject({ obj, reduceMotion }: { obj: HeroObject; reduceMotion: boolean }) {
  const strokes = useDerivedStrokes(obj.shape);
  const [is3d, setIs3d] = useState(false); // the TARGET face (toggled on a timer)
  const [face, setFace] = useState<'2d' | '3d'>('2d'); // the face actually shown
  const [flipping, setFlipping] = useState(false);
  // Mount the 3D layer once (first flip up) and KEEP it — display-toggled, not
  // unmounted — so re-flips don't rebuild geometry (jank) and the shared-canvas
  // <View> is culled (display:none → empty rect) while 2D shows, so it never
  // bleeds around the 2D shape. ONE face is ever display:block at a time, so the
  // 2D and 3D can never co-exist (the double-image/pop bug); the card-flip's
  // edge-on midpoint hides the instant of swap.
  const [mounted3d, setMounted3d] = useState(false);

  useEffect(() => {
    if (reduceMotion || !strokes) return;
    // Stagger the first flip (per-object jitter) so they don't flip in lockstep,
    // then a steady, unhurried cadence — long enough to READ.
    const jitter = 2200 + Math.floor(Math.random() * 2600);
    const first = window.setTimeout(() => setIs3d(true), jitter);
    const loop = window.setInterval(() => setIs3d((v) => !v), 7000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(loop);
    };
  }, [reduceMotion, strokes]);

  // Drive the card-flip whenever the target diverges from the shown face.
  useEffect(() => {
    const target: '2d' | '3d' = is3d ? '3d' : '2d';
    if (target === face) return;
    if (target === '3d') setMounted3d(true); // build it (hidden) before the reveal
    setFlipping(true);
    const swap = window.setTimeout(() => setFace(target), FLIP_MS / 2); // commit at edge-on
    const done = window.setTimeout(() => setFlipping(false), FLIP_MS);
    return () => {
      window.clearTimeout(swap);
      window.clearTimeout(done);
    };
  }, [is3d, face]);

  return (
    <div
      className="dd-flipwrap"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        animation: flipping ? `dd-cardflip ${FLIP_MS}ms cubic-bezier(0.45,0,0.2,1) both` : undefined,
        // Only the settled 3D face takes pointer events (grab + spin).
        pointerEvents: face === '3d' && !flipping ? 'auto' : 'none',
      }}
    >
      {/* 2D styled face — shown unless the 3D face is up. */}
      <div data-flipface="2d" style={{ position: 'absolute', inset: 0, display: face === '2d' ? 'block' : 'none' }}>
        <StyledFace obj={obj} />
      </div>
      {/* 3D face — a drei <View> into the desk's shared canvas. Kept mounted once
          built; display:none culls it (no paint, no bleed) while 2D shows. */}
      {mounted3d && strokes && (
        <div data-flipface="3d" style={{ position: 'absolute', inset: 0, display: face === '3d' ? 'block' : 'none' }}>
          <Object3DSlot
            strokes={strokes}
            config={obj.geo3d ?? null}
            interactive
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      )}
    </div>
  );
}

// ─── StyleTag — the quiet per-object label (style + 2D/3D capability) ─────────
// Earns the variety: a tiny pill naming each object's style, and whether it
// flips / is 3D. Never shouts.
function StyleTag({ obj }: { obj: HeroObject }) {
  const badge =
    obj.behavior === 'flip' ? '2D⇄3D' : obj.behavior === '3d-only' ? '3D' : '2D';
  return (
    <span
      style={{
        position: 'absolute',
        bottom: -7,
        right: -2,
        display: 'inline-flex',
        gap: 5,
        alignItems: 'center',
        fontFamily: IS,
        fontSize: 8.5,
        fontWeight: 700,
        letterSpacing: '0.08em',
        color: 'var(--dir-text-secondary)',
        background: 'color-mix(in srgb, var(--dir-bg) 80%, transparent)',
        padding: '2px 7px',
        borderRadius: 999,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        textTransform: 'uppercase',
      }}
    >
      <span>{obj.style}</span>
      <span style={{ opacity: 0.55 }}>·</span>
      <span style={{ color: 'var(--dir-text-body)' }}>{badge}</span>
    </span>
  );
}

// ─── useDerivedStrokes — lazily derive 3D strokes for a catalog shape ─────────
// Browser-only (svgMarkupToStrokes mounts offscreen), so we run it in an effect
// and return null until it resolves — callers hold the 2D face meanwhile. The
// derive is cheap + cached per shape across the page.
// Cache holds `null` for shapes that derived nothing usable, so we don't re-run
// the (browser-only) derive on every effect pass — and so those objects stay 2D
// rather than ever flipping to a placeholder form.
const STROKE_CACHE = new Map<F3PegboardShapeId, StrokeInputPoint[][] | null>();
function useDerivedStrokes(shape: F3PegboardShapeId): StrokeInputPoint[][] | null {
  const [strokes, setStrokes] = useState<StrokeInputPoint[][] | null>(
    () => STROKE_CACHE.get(shape) ?? null,
  );
  useEffect(() => {
    if (STROKE_CACHE.has(shape)) {
      setStrokes(STROKE_CACHE.get(shape) ?? null);
      return;
    }
    let cancelled = false;
    void deriveStrokes(shape).then((derived) => {
      if (cancelled) return;
      STROKE_CACHE.set(shape, derived);
      setStrokes(derived);
    });
    return () => {
      cancelled = true;
    };
  }, [shape]);
  return strokes;
}

// ─── DoorLink — a slim demoted destination row entry ─────────────────────────
function DoorLink({
  to,
  label,
  hint,
  primary,
}: {
  to: string;
  label: string;
  hint: string;
  primary?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className="dd-door"
      style={
        {
          position: 'relative',
          overflow: 'hidden',
          textDecoration: 'none',
          background: primary ? 'color-mix(in srgb, var(--dir-raised) 60%, var(--dir-bg))' : 'transparent',
          border: '1px solid var(--dir-border)',
          borderRadius: 14,
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          transition: 'transform 180ms cubic-bezier(0.2,0.7,0.2,1), box-shadow 180ms ease, background 180ms ease',
        } as CSSProperties
      }
    >
      <span
        style={{
          fontFamily: ISe,
          fontSize: 17,
          letterSpacing: '-0.01em',
          fontVariationSettings: '"SOFT" 55, "WONK" 1',
          color: 'var(--dir-text-primary)',
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: IS, fontSize: 12.5, color: 'var(--dir-text-body-soft)' }}>
        {hint} →
      </span>
    </NavLink>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const HOME_CSS = `
  .dd-desk {
    position: relative;
    /* flex:1 + min-height:0 → the desk fills the leftover between header and the
       doors row, so the whole page fits ONE viewport with no scroll (Sebs).
       Objects are %-positioned, so they scale with this height. */
    flex: 1;
    min-height: 0;
    width: 100%;
    /* Full-bleed so objects use the WHOLE canvas, not a centered 1280 band that
       left huge empty margins on wide screens. */
    max-width: none;
    margin-inline: 0;
    padding: clamp(10px, 2vw, 28px) clamp(24px, 4vw, 72px);
    box-sizing: border-box;
  }
  /* Each catalog shape carries its own intrinsic width/height; this fits it to
     the slot box so the styled object scales cleanly. */
  .dd-shapefit { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  .dd-shapefit > svg { width: 100%; height: 100%; }
  /* SvgStyleTransform hosts the styled render in a wrapper <div> with two inner
     host divs (clean + fx). For DOM-clone styles (rough/sketchy/bold-ink/charcoal/
     stipple/outline/newsprint/wet-ink/risograph/wireframe) the transformed <svg>
     is appended directly to the fx host (no .dd-shapefit wrap), so size the host
     divs + every styled <svg> here. This fills the slot box for EVERY style +
     behavior, keeping each object's distinct styled face visible (not collapsed to
     intrinsic size in a corner). object-fit:contain preserves aspect ratio. */
  .dd-styledface > div { width: 100%; height: 100%; }
  .dd-styledface > div > div { width: 100%; height: 100%; box-sizing: border-box; }
  .dd-styledface svg { width: 100%; height: 100%; object-fit: contain; }
  /* The cleared pocket — centered words floating above the doodle layer. */
  .dd-pocket {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 5;
    width: min(560px, 86vw);
    text-align: center;
    /* A soft warm clearing so words never sit directly on top of ink. */
    padding: 18px 22px;
  }
  .dd-pocket::before {
    content: '';
    position: absolute;
    inset: -8% -14%;
    background: radial-gradient(ellipse 60% 58% at 50% 50%,
      var(--dir-bg) 0%,
      color-mix(in srgb, var(--dir-bg) 78%, transparent) 58%,
      transparent 80%);
    z-index: -1;
    pointer-events: none;
  }
  .dd-item { will-change: transform; }
  .dd-cta:hover { filter: brightness(0.96); transform: translateY(-1px); }
  .dd-quiet:hover { color: var(--dir-text-body) !important; }

  /* Gentle alive drift — three offset variants so nothing pulses in unison.
     Composes with the slot rotation via the --rot custom prop. */
  @keyframes dd-drift-a {
    0%,100% { transform: rotate(var(--rot)) translate(0,0); }
    50%     { transform: rotate(calc(var(--rot) + 1.5deg)) translate(0,-7px); }
  }
  @keyframes dd-drift-b {
    0%,100% { transform: rotate(var(--rot)) translate(0,0); }
    50%     { transform: rotate(calc(var(--rot) - 1.2deg)) translate(4px,-5px); }
  }
  @keyframes dd-drift-c {
    0%,100% { transform: rotate(var(--rot)) translate(0,0); }
    50%     { transform: rotate(calc(var(--rot) + 1deg)) translate(-4px,-6px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .dd-item { animation: none !important; }
  }
  /* The 2D⇄3D flip — a horizontal card turn. The face is HARD-SWAPPED at the
     edge-on midpoint (scaleX≈0) so the 2D and 3D never co-exist on screen (the
     3D lives in the shared canvas, a sibling layer that can't CSS cross-fade —
     overlapping them looked like a double-image + pop). A touch of brightness
     dip at the turn sells the "page lifting" read. */
  @keyframes dd-cardflip {
    0%   { transform: scaleX(1);    filter: brightness(1); }
    48%  { transform: scaleX(0.04); filter: brightness(0.94); }
    52%  { transform: scaleX(0.04); filter: brightness(0.94); }
    100% { transform: scaleX(1);    filter: brightness(1); }
  }

  /* The demoted destinations row. */
  .dd-doors {
    position: relative;
    z-index: 2;
    width: 100%;
    max-width: 880px;
    margin: clamp(8px, 2vw, 24px) auto 8px;
    padding: 0 clamp(20px, 5vw, 56px);
    box-sizing: border-box;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  .dd-door:hover {
    transform: translateY(-2px);
    background: var(--dir-raised);
    box-shadow: 0 12px 30px color-mix(in srgb, var(--dir-text-primary) 10%, transparent),
                0 2px 8px color-mix(in srgb, var(--dir-text-primary) 6%, transparent);
  }

  /* ── responsive ── progressively thin the desk + stack the doors ─────────── */
  @media (max-width: 760px) {
    .dd-item--narrowhide { display: none; }
    .dd-doors { grid-template-columns: 1fr; max-width: 420px; }
    .dd-pocket { width: min(440px, 90vw); }
  }
  @media (max-width: 520px) {
    .dd-desk { min-height: 620px; }
  }
`;

// A short hand-drawn underline stroke — the one repeated brand mark.
function UnderlineScribble({ width, strong }: { width: number; strong?: boolean }) {
  return (
    <svg
      viewBox="0 0 200 12"
      width={width}
      height={width * (12 / 200)}
      aria-hidden="true"
      style={{ display: 'block', color: strong ? 'var(--dir-text-primary)' : 'var(--dir-text-body-soft)' }}
    >
      <path
        d="M3 8 Q44 3 86 6 T168 5 Q186 4 197 9"
        fill="none"
        stroke="currentColor"
        strokeWidth={strong ? 4 : 2.5}
        strokeLinecap="round"
      />
    </svg>
  );
}
