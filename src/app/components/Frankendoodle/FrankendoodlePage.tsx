import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DrawSurface,
  strokesToObjectMarkup,
  SHADE_TOOL_DEFAULT,
  type Stroke,
  type ShadeToolState,
  type ShapeSnapApi,
} from '../DeskDoodles/DrawSurface';
import { DrawToolbar } from '../DeskDoodles/DrawToolbar';
import { ShapeStrip } from '../DeskDoodles/ShapeStrip';
import { SurfaceControls } from '../DeskDoodles/ObjectSurface';
import { Live3DMount } from '../DeskDoodles/DeskObject3DMount';
import { Canvas3DChrome } from '../chrome/Canvas3DChrome';
import { Canvas3DProvider } from '../../state/Canvas3DContext';
import { smartPickFromMarkup } from '../../lib/smart/smartPick';
import { SvgStyleTransform, applyStylePreset } from '../canvas/SvgStyleTransform';
import { DeskObject3DMount } from '../DeskDoodles/DeskObject3DMount';
import {
  F3SvgStyleProvider,
  useF3SvgStyle,
  type F3SvgStyle,
} from '../../state/F3SvgStyleContext';
import {
  F3RoughModifiersProvider,
  useF3RoughModifiers,
  DEFAULT_MODIFIERS,
  type F3ModifiersState,
} from '../../state/F3RoughModifiersContext';
import type { ToneFill } from '../../lib/toneMask';
import type { SnapAction } from '../../lib/draw/shapeFit';
import { IS } from '../../lib/typography';
import { FdDoodle, type DoodleName } from './FdDoodle';
import { StyleScope } from './StyleScope';
import { FdPhysics } from './FdPhysics';
import {
  pieceMarkup,
  panelLayout,
  composeViewBox,
  panel3DStrokes,
  placedStrokes,
  composeMarkup,
  seamPeekMarkup,
  saveCompositePng,
  SEAM_FRAC,
  type FdPanel,
  type PieceStyle,
} from '../../lib/frankendoodle/compose';
import { autoRig, rigDebugSvg } from '../../lib/frankendoodle/autoRig';
import {
  useGameRoom,
  makeRoomCode,
  TOTAL_PANELS,
  PANEL_LABELS,
  PANEL_HINTS,
} from '../../lib/frankendoodle/room';

const ink = 'var(--dir-text-primary)';
const paper = 'var(--dir-bg)';
const PART_ICON: DoodleName[] = ['head', 'body', 'legs'];
// One 8-based spacing rhythm across every screen (tight within a group, one bigger gap between).
const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
// Text fields read as RECESSED (filled + inset shadow) so they never get mistaken for buttons.
const fieldStyle: React.CSSProperties = {
  fontFamily: IS,
  fontSize: 16, // ≥16px so iOS doesn't zoom on focus (raunofreiberg)
  borderRadius: 999,
  border: `1.5px solid color-mix(in srgb, ${ink} 22%, transparent)`,
  background: paper, // no muddy grey fill — recessed via the inset shadow instead
  boxShadow: `inset 0 2px 4px color-mix(in srgb, ${ink} 9%, transparent)`,
  color: ink,
  textAlign: 'center',
};
type StyleCfg = { svgStyle: F3SvgStyle; mods: F3ModifiersState };
const defaultCfg = (): StyleCfg => ({ svgStyle: 'rough-handdrawn', mods: DEFAULT_MODIFIERS });

// ---------------------------------------------------------------------------
// Room + role resolution
// ---------------------------------------------------------------------------

function resolveRoom(): { code: string; myIndex: 0 | 1 } {
  const params = new URLSearchParams(window.location.search);
  let code = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const hostKey = (c: string) => `fd:host:${c}`;
  if (!code) {
    code = makeRoomCode(Math.floor(Math.random() * 1e9));
    try {
      sessionStorage.setItem(hostKey(code), '1');
    } catch {
      /* private mode */
    }
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    window.history.replaceState({}, '', url.toString());
    return { code, myIndex: 0 };
  }
  let iAmHost = false;
  try {
    iAmHost = sessionStorage.getItem(hostKey(code)) === '1';
  } catch {
    /* ignore */
  }
  return { code, myIndex: iAmHost ? 0 : 1 };
}

// ---------------------------------------------------------------------------
// Shared UI
// ---------------------------------------------------------------------------

function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: paper,
        color: ink,
        fontFamily: IS,
        WebkitFontSmoothing: 'antialiased',
        textRendering: 'optimizeLegibility',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 18px',
        gap: 14,
        textAlign: 'center',
        overscrollBehavior: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <style>{`
        .fd-press{ transition: transform .12s cubic-bezier(0.16,1,0.3,1), opacity .12s ease; }
        .fd-press:active:not(:disabled){ transform: scale(0.96); }
        .fd-press:focus-visible, .fd-input:focus-visible{ outline: none; box-shadow: 0 0 0 2px var(--dir-bg), 0 0 0 4px var(--dir-text-primary); }
        .fd-input{ outline: none; }
        @keyframes fd-fade-up{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:translateY(0)}}
        @media (prefers-reduced-motion: reduce){ [class*="fd-"], [style*="animation"]{ animation-duration:.01ms!important; animation-iteration-count:1!important; } }
      `}</style>
      {children}
    </div>
  );
}

function Wordmark({ small }: { small?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: small ? 2 : 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', transform: `translateY(${small ? -1 : -2}px)` }}>
          <FdDoodle name="monster" size={small ? 22 : 34} />
        </span>
        <span style={{ fontSize: small ? 17 : 27, fontWeight: 700, letterSpacing: '-0.015em' }}>Frankendoodle</span>
      </div>
      <span style={{ fontSize: small ? 11 : 13, opacity: 0.5, letterSpacing: '0.01em' }}>draw a monster together</span>
    </div>
  );
}

function Pill({
  children,
  onClick,
  disabled,
  tone = 'solid',
  small,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'solid' | 'ghost';
  small?: boolean;
}) {
  return (
    <button
      className="fd-press"
      onClick={onClick}
      disabled={disabled}
      style={{
        appearance: 'none',
        border: '1.5px solid',
        borderColor: disabled ? `color-mix(in srgb, ${ink} 30%, transparent)` : ink,
        background: disabled ? 'transparent' : tone === 'solid' ? ink : 'transparent',
        color: disabled ? `color-mix(in srgb, ${ink} 42%, transparent)` : tone === 'solid' ? paper : ink,
        fontFamily: IS,
        fontSize: small ? 12.5 : 14,
        fontWeight: 600,
        padding: small ? '6px 14px' : '11px 20px',
        borderRadius: 999,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: small ? 30 : 40,
        whiteSpace: 'nowrap',
        touchAction: 'manipulation',
      }}
    >
      {children}
    </button>
  );
}

function PartProgress({ done, active }: { done: number; active: number }) {
  return (
    <div style={{ display: 'flex', gap: 16, justifyContent: 'center', alignItems: 'center' }}>
      {PART_ICON.map((part, i) => {
        const state = i < done ? 'done' : i === active ? 'active' : 'todo';
        return (
          <span
            key={part}
            title={PANEL_LABELS[i]}
            style={{
              color: ink,
              opacity: state === 'done' ? 1 : state === 'active' ? 0.85 : 0.24,
              transform: state === 'active' ? 'scale(1.15)' : 'scale(1)',
              transition: 'all 0.25s ease',
              animation: state === 'active' ? 'fd-bob 1.6s ease-in-out infinite' : undefined,
            }}
          >
            <FdDoodle name={part} size={24} strokeWidth={state === 'done' ? 6 : 4} />
          </span>
        );
      })}
    </div>
  );
}

/** True when the viewport is wide enough for a side-by-side canvas + panel. */
function useWide(bp = 1000) {
  const [wide, setWide] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= bp : false));
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= bp);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [bp]);
  return wide;
}

/** The real SurfaceControls in a bordered box, always visible (side column). */
function StyleControlsBox({
  svgStyle,
  mods,
  onStyle,
  onMod,
  onReset,
  onSmart,
  height,
}: {
  svgStyle: F3SvgStyle;
  mods: F3ModifiersState;
  onStyle: (s: F3SvgStyle) => void;
  onMod: <K extends keyof F3ModifiersState>(k: K, v: F3ModifiersState[K]) => void;
  onReset: () => void;
  onSmart?: () => 'applied' | 'abstained' | void;
  height: number | string;
}) {
  return (
    <div
      style={{
        width: 300,
        height,
        overflowY: 'auto',
        border: `1.5px solid ${ink}`,
        borderRadius: 16,
        padding: '12px 14px',
        textAlign: 'left',
        WebkitOverflowScrolling: 'touch',
        background: paper,
      }}
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', opacity: 0.45, marginBottom: 8 }}>
        Style controls
      </div>
      <SurfaceControls svgStyle={svgStyle} mods={mods} onStyle={onStyle} onMod={onMod} onReset={onReset} onSmart={onSmart} />
    </div>
  );
}

/** A collapsible wrapper around the real Desk Doodles SurfaceControls panel. */
function StylePanel({
  label,
  svgStyle,
  mods,
  onStyle,
  onMod,
  onReset,
  onSmart,
  open,
  onToggle,
}: {
  label: string;
  svgStyle: F3SvgStyle;
  mods: F3ModifiersState;
  onStyle: (s: F3SvgStyle) => void;
  onMod: <K extends keyof F3ModifiersState>(k: K, v: F3ModifiersState[K]) => void;
  onReset: () => void;
  onSmart?: () => 'applied' | 'abstained' | void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ width: 'min(92vw, 500px)', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <button
        onClick={onToggle}
        style={{
          appearance: 'none',
          border: `1.5px solid ${ink}`,
          background: open ? ink : 'transparent',
          color: open ? paper : ink,
          fontFamily: IS,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          padding: '8px 14px',
          borderRadius: 999,
          cursor: 'pointer',
          alignSelf: 'center',
          touchAction: 'manipulation',
        }}
      >
        {label} {open ? '▲' : '▾'}
      </button>
      {open && (
        <div
          style={{
            maxHeight: 'min(38dvh, 320px)',
            overflowY: 'auto',
            border: `1.5px solid ${ink}`,
            borderRadius: 14,
            padding: '10px 12px',
            textAlign: 'left',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <SurfaceControls svgStyle={svgStyle} mods={mods} onStyle={onStyle} onMod={onMod} onReset={onReset} onSmart={onSmart} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draw turn — the full Desk Doodles draw + style chrome
// ---------------------------------------------------------------------------

function DrawTurn(props: { panelIndex: number; prevPanel: FdPanel | undefined; onDone: (s: Stroke[], cfg: PieceStyle) => void }) {
  return (
    <F3SvgStyleProvider>
      <F3RoughModifiersProvider>
        <Canvas3DProvider>
          <DrawTurnInner {...props} />
        </Canvas3DProvider>
      </F3RoughModifiersProvider>
    </F3SvgStyleProvider>
  );
}

function DrawTurnInner({
  panelIndex,
  prevPanel,
  onDone,
}: {
  panelIndex: number;
  prevPanel: FdPanel | undefined;
  onDone: (s: Stroke[], cfg: PieceStyle) => void;
}) {
  const [svgStyle, setSvgStyle] = useState<F3SvgStyle>('rough-handdrawn');
  const [mods, setMods] = useState<F3ModifiersState>(DEFAULT_MODIFIERS);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tone, setTone] = useState<ToneFill[]>([]);
  const [register, setRegister] = useState<'ink' | 'shade' | 'erase'>('ink');
  const [eraseMode, setEraseMode] = useState<'object' | 'pixel'>('object');
  const [shadeTool, setShadeTool] = useState<ShadeToolState>(SHADE_TOOL_DEFAULT);
  const [composeMode, setComposeMode] = useState<'draw' | 'style'>('draw');
  const [styleOpen, setStyleOpen] = useState(false);
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [sent, setSent] = useState(false);
  const wide = useWide();
  const [armedShape, setArmedShape] = useState<string | null>(null);
  const snapApiRef = useRef<ShapeSnapApi | null>(null);
  const tumbleRef = useRef({ az: 0, el: -0.1 });

  // push my config into this turn's fresh providers so the live "Style" preview reflects it
  const sctx = useF3SvgStyle();
  const mctx = useF3RoughModifiers();
  useLayoutEffect(() => {
    sctx.setState(svgStyle);
  }, [svgStyle, sctx]);
  useLayoutEffect(() => {
    mctx.replace(mods);
  }, [mods, mctx]);

  useEffect(() => {
    if (view !== '3d') return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      tumbleRef.current.az += dt * 0.5;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view]);

  const setMod = <K extends keyof F3ModifiersState>(k: K, v: F3ModifiersState[K]) => setMods((p) => ({ ...p, [k]: v }));
  const pickStyle = (next: F3SvgStyle) => {
    setSvgStyle(next);
    setMods((m) => applyStylePreset(m, next));
  };
  const runSnap = (a: SnapAction) => {
    const api = snapApiRef.current;
    if (!api) return;
    const fit = api.fitLast(a);
    if (!fit || !fit.result.accepted) return;
    const best = fit.result.candidates[0];
    api.applyToStroke(fit.strokeId, best, api.lastStroke()?.points ?? []);
  };

  // SMART / auto-detect — analyze the current doodle and pick style + modifiers.
  const onSmart = (): 'applied' | 'abstained' => {
    if (strokes.length === 0) return 'abstained';
    const result = smartPickFromMarkup(strokesToObjectMarkup(strokes, tone), 'draw');
    const pick = result?.pick;
    if (!pick) return 'abstained';
    setSvgStyle(pick.axes.svgStyle);
    setMods((m) => {
      const snapped = applyStylePreset(m, pick.axes.svgStyle);
      return {
        ...snapped,
        ...(pick.axes.fillStyle !== undefined && { fillStyle: pick.axes.fillStyle }),
        ...(pick.axes.texture !== undefined && { texture: pick.axes.texture }),
        ...(pick.axes.penTip !== undefined && { penTip: pick.axes.penTip }),
        ...(pick.axes.multiStroke !== undefined && { multiStroke: pick.axes.multiStroke }),
        ...(pick.axes.sketchingStyle !== undefined && { sketchingStyle: pick.axes.sketchingStyle }),
      };
    });
    return 'applied';
  };

  const peek = seamPeekMarkup(prevPanel);
  const done = () => {
    if (strokes.length === 0 || sent) return;
    setSent(true);
    onDone(strokes, { svgStyle, mods, toneFills: tone, view });
  };

  const seg = (on: boolean, dim = false): React.CSSProperties => ({
    appearance: 'none',
    border: `1.5px solid ${ink}`,
    background: on ? ink : 'transparent',
    color: on ? paper : ink,
    opacity: dim ? 0.3 : on ? 1 : 0.55,
    fontFamily: IS,
    fontSize: 12.5,
    fontWeight: 600,
    padding: '6px 16px',
    borderRadius: 999,
    cursor: dim ? 'default' : 'pointer',
    touchAction: 'manipulation',
  });
  const strokes3d = strokes.map((s) => s.points);
  const panelH = wide ? 'min(74dvh, 640px)' : ('auto' as const);
  const panelBox: React.CSSProperties = {
    width: wide ? 250 : 'min(92vw, 500px)',
    height: panelH,
    maxHeight: wide ? undefined : 'min(40dvh, 320px)',
    overflowY: 'auto',
    border: `1.5px solid ${ink}`,
    borderRadius: 16,
    padding: '12px 14px',
    background: paper,
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    flex: '0 0 auto',
  };
  const eyebrow: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', opacity: 0.45 };

  return (
    <>
      <div>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', opacity: 0.5 }}>
          Panel {panelIndex + 1} of {TOTAL_PANELS} · your turn
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: S.xs }}>
          <span style={{ display: 'inline-flex', transform: 'translateY(-1px)' }}>
            <FdDoodle name={PART_ICON[panelIndex]} size={26} />
          </span>
          <div style={{ fontSize: 23, fontWeight: 600, textWrap: 'balance' } as React.CSSProperties}>Draw {PANEL_LABELS[panelIndex]}</div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2, maxWidth: 400 }}>{PANEL_HINTS[panelIndex]}</div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 8 }}>
          <button className="fd-press" onClick={() => setView('2d')} style={seg(view === '2d')}>2D</button>
          <button className="fd-press" onClick={() => strokes.length > 0 && setView('3d')} disabled={strokes.length === 0} style={seg(view === '3d', strokes.length === 0)}>3D</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center', alignItems: 'flex-start', width: '100%' }}>
        {/* LEFT — draw controls (vertical panel; hugs content so it isn't a half-empty box) */}
        <div style={{ order: wide ? 0 : 2 }}>
          <div style={{ ...panelBox, height: 'auto', maxHeight: wide ? 'min(74dvh, 640px)' : 'min(40dvh, 320px)' }}>
            <div style={eyebrow}>Draw controls</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['draw', 'style'] as const).map((m) => (
                <button key={m} className="fd-press" aria-pressed={composeMode === m} onClick={() => setComposeMode(m)} style={{ ...seg(composeMode === m), fontSize: 12, padding: '6px 12px' }}>
                  {m === 'draw' ? 'Sketch' : 'Preview'}
                </button>
              ))}
            </div>
            <DrawToolbar
              variant="panel"
              register={register}
              onRegisterChange={setRegister}
              eraseMode={eraseMode}
              onEraseModeChange={setEraseMode}
              registerDisabled={composeMode === 'style'}
              shadeTool={shadeTool}
              onShadeToolChange={setShadeTool}
              showSnap={composeMode === 'draw'}
              snapEnabled={register === 'ink' && strokes.length > 0}
              onSnapAction={runSnap}
              snapTitle={(a) => (a === 'snap' ? 'Snap the last stroke to the shape you drew' : 'Straighten the last stroke')}
              captionText=""
            />
            <ShapeStrip armedShape={armedShape} onArmShape={setArmedShape} collapsed />
          </div>
        </div>

        {/* CENTER — canvas + done */}
        <div style={{ order: 1, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', flex: wide ? '1 1 340px' : '0 1 auto', minWidth: wide ? 320 : undefined, maxWidth: wide ? 600 : undefined }}>
          <div
            data-fd="canvas"
            style={{
              position: 'relative',
              width: wide ? '100%' : 'min(92vw, 500px)',
              aspectRatio: '4 / 3',
              maxHeight: panelH,
              border: `1.5px solid ${ink}`,
              borderRadius: 16,
              overflow: 'hidden',
              background: paper,
              boxShadow: '0 8px 34px rgba(0,0,0,0.10)',
              touchAction: 'none',
            }}
          >
            <div style={{ position: 'absolute', inset: 0, visibility: view === '3d' ? 'hidden' : 'visible' }}>
              <DrawSurface
                mode="svg"
                input="draw"
                fill
                hideActions
                styled={composeMode === 'style'}
                onStrokesChange={setStrokes}
                onToneFillsChange={setTone}
                armedShape={armedShape}
                onShapeInserted={() => setArmedShape(null)}
                shade={{
                  active: composeMode === 'draw' && (register === 'shade' || register === 'erase'),
                  tool: register === 'erase' ? 'brush' : shadeTool.tool,
                  band: register === 'erase' ? 0 : shadeTool.band,
                  radius: shadeTool.radius,
                  erase: register === 'erase' ? true : shadeTool.erase,
                  gap: shadeTool.gap,
                  fullFill: shadeTool.fullFill,
                }}
                eraseStrokes={composeMode === 'draw' && register === 'erase'}
                eraseMode={eraseMode}
                onSnapApi={(api) => {
                  snapApiRef.current = api;
                }}
              />
              {peek && (
                <>
                  <div
                    aria-hidden
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${SEAM_FRAC * 100}%`, pointerEvents: 'none', color: ink, opacity: 0.24, borderBottom: `1.5px dashed ${ink}`, maskImage: 'linear-gradient(to bottom, black 35%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 35%, transparent 100%)' }}
                    dangerouslySetInnerHTML={{ __html: peek }}
                  />
                  <div style={{ position: 'absolute', top: `calc(${SEAM_FRAC * 100}% + 5px)`, left: 12, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.42, pointerEvents: 'none' }}>
                    connect to these
                  </div>
                </>
              )}
            </div>
            {view === '3d' && strokes.length > 0 && (
              <div style={{ position: 'absolute', inset: 0, background: paper }}>
                <Live3DMount strokes={strokes3d} viewBox={{ w: 800, h: 600 }} interactive transparent tumbleRef={tumbleRef} style={{ width: '100%', height: '100%' }} />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Pill tone="ghost" onClick={() => setStrokes([])} disabled={strokes.length === 0 || sent}>
              Clear
            </Pill>
            <Pill onClick={done} disabled={strokes.length === 0 || sent}>
              {sent ? 'Sent' : 'Done — pass it on'}
              {!sent && <FdDoodle name="arrow" size={16} engine={false} />}
            </Pill>
          </div>
        </div>

        {/* RIGHT — styles (2D) / full 3D chrome (3D) */}
        <div style={{ order: wide ? 2 : 3 }}>
          {view === '3d' ? (
            <div style={{ ...panelBox, width: wide ? 290 : 'min(92vw, 500px)' }}>
              <div style={eyebrow}>3D style</div>
              <Canvas3DChrome />
            </div>
          ) : wide ? (
            <StyleControlsBox svgStyle={svgStyle} mods={mods} onStyle={pickStyle} onMod={setMod} onReset={() => setMods(applyStylePreset(DEFAULT_MODIFIERS, svgStyle))} onSmart={onSmart} height={panelH} />
          ) : (
            <StylePanel label="Style panel" svgStyle={svgStyle} mods={mods} onStyle={pickStyle} onMod={setMod} onReset={() => setMods(applyStylePreset(DEFAULT_MODIFIERS, svgStyle))} onSmart={onSmart} open={styleOpen} onToggle={() => setStyleOpen((v) => !v)} />
          )}
        </div>
      </div>

      <PartProgress done={panelIndex} active={panelIndex} />
      <style>{`@keyframes fd-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
    </>
  );
}

// ---------------------------------------------------------------------------
// Waiting
// ---------------------------------------------------------------------------

function WaitTurn({ who, panelIndex }: { who: string; panelIndex: number }) {
  return (
    <>
      <Wordmark small />
      <div style={{ color: ink, animation: 'fd-sway 1.8s ease-in-out infinite', margin: '8px 0' }}>
        <FdDoodle name="pencil" size={52} />
      </div>
      <div style={{ fontSize: 21, fontWeight: 600 }}>
        {who} is drawing {PANEL_LABELS[panelIndex]}…
      </div>
      <div style={{ fontSize: 13, opacity: 0.55, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <FdDoodle name="peek" size={18} /> No peeking — the reveal is worth it.
      </div>
      <PartProgress done={panelIndex} active={panelIndex} />
      <style>{`@keyframes fd-sway{0%,100%{transform:rotate(-7deg) translateY(0)}50%{transform:rotate(7deg) translateY(-6px)}}`}</style>
    </>
  );
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

type GeoMode = 'inflate' | 'rod' | 'extrude';
type Target = 'all' | 0 | 1 | 2;
type Mode = '2d' | '3d';

function InkConfetti() {
  const pieces = Array.from({ length: 16 });
  const marks: DoodleName[] = ['spark', 'arrow', 'check', 'link'];
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }} aria-hidden>
      {pieces.map((_, i) => {
        const angle = (i / pieces.length) * Math.PI * 2;
        const dist = 120 + (i % 4) * 26;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist * 0.9 - 30;
        const cstyle = {
          position: 'absolute',
          left: '50%',
          top: '42%',
          color: ink,
          opacity: 0,
          '--tx': `${tx}px`,
          '--ty': `${ty}px`,
          '--rot': `${(i % 2 ? 1 : -1) * (120 + i * 12)}deg`,
          animation: `fd-confetti 1100ms cubic-bezier(0.2,0.7,0.3,1) ${i * 28}ms forwards`,
        } as unknown as React.CSSProperties;
        return (
          <span key={i} style={cstyle}>
            <FdDoodle name={marks[i % marks.length]} size={12 + (i % 3) * 4} strokeWidth={6} engine={false} />
          </span>
        );
      })}
      <style>{`@keyframes fd-confetti{0%{opacity:0;transform:translate(-50%,-50%) scale(0.3) rotate(0)}25%{opacity:1}100%{opacity:0;transform:translate(calc(-50% + var(--tx)),calc(-50% + var(--ty))) scale(1) rotate(var(--rot))}}`}</style>
    </div>
  );
}

// One part rendered in 3D, in its OWN Canvas3DProvider so its geometry/style
// is independent of the other parts. When this part is the active restyle
// target, it portals its 3D chrome into the side-panel slot — the chrome then
// drives THIS provider only (portals keep React context from their call site).
function Piece3D({ panel, portalChrome, slotEl }: { panel: FdPanel; portalChrome: boolean; slotEl: HTMLElement | null }) {
  const { strokes, viewBox } = useMemo(() => panel3DStrokes(panel), [panel]);
  const tumbleRef = useRef({ az: 0, el: -0.1 });
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      tumbleRef.current.az += dt * 0.5;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <Canvas3DProvider>
      <Live3DMount strokes={strokes} viewBox={viewBox} interactive transparent tumbleRef={tumbleRef} style={{ width: '100%', height: '100%' }} />
      {portalChrome && slotEl
        ? createPortal(
            <>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', opacity: 0.45, marginBottom: 8 }}>3D style · this part</div>
              <Canvas3DChrome />
            </>,
            slotEl,
          )
        : null}
    </Canvas3DProvider>
  );
}

// The signature: hand-drawn X-sutures where the exquisite-corpse parts meet.
// Every Frankendoodle wears its seams — it's literally stitched together.
function Sutures({ panels, delay }: { panels: FdPanel[]; delay: number }) {
  const { boxes, viewBox: vb } = panelLayout(panels);
  const d: string[] = [];
  for (let i = 0; i < boxes.length - 1; i++) {
    const a = boxes[i];
    const b = boxes[i + 1];
    const seamY = (a.cy + a.h / 2 + (b.cy - b.h / 2)) / 2;
    const cx = (a.cx + b.cx) / 2;
    const span = Math.min(a.w, b.w) * 0.6;
    const n = Math.max(3, Math.min(6, Math.round(span / 48)));
    for (let k = 0; k < n; k++) {
      const x = cx - span / 2 + (span * (k + 0.5)) / n;
      const y = seamY + Math.sin((i * 5 + k) * 1.7) * 2.2; // deterministic hand-wobble
      const s = 8 * (0.82 + ((i * 3 + k * 7) % 5) / 12);
      d.push(`M${(x - s).toFixed(1)} ${(y - s).toFixed(1)} L${(x + s).toFixed(1)} ${(y + s).toFixed(1)}`);
      d.push(`M${(x - s).toFixed(1)} ${(y + s).toFixed(1)} L${(x + s).toFixed(1)} ${(y - s).toFixed(1)}`);
    }
  }
  if (!d.length) return null;
  return (
    <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="none" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      <path d={d.join(' ')} fill="none" stroke={ink} strokeWidth={3.2} strokeLinecap="round" style={{ opacity: 0, animation: `fd-stitch 520ms cubic-bezier(0.2,0.8,0.25,1) ${delay}ms forwards` }} />
      <style>{`@keyframes fd-stitch{0%{opacity:0;transform:scale(0.92)}60%{opacity:1}100%{opacity:1;transform:scale(1)}}`}</style>
    </svg>
  );
}

// The reveal stage: every part positioned in the composed creature, each part
// independently 2D (styled SVG) or 3D (its own mount). Mirrors panelLayout so
// 2D and 3D parts share the same slot geometry.
function RevealCreatureStage({
  panels,
  configs,
  modes,
  target,
  slotEl,
}: {
  panels: FdPanel[];
  configs: StyleCfg[];
  modes: Mode[];
  target: Target;
  slotEl: HTMLElement | null;
}) {
  const { boxes, viewBox: vb } = panelLayout(panels);
  return (
    <>
      {panels.map((p, i) => {
        const b = boxes[i];
        const is3d = modes[i] === '3d';
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${((b.cx - b.w / 2 - vb.x) / vb.w) * 100}%`,
              top: `${((b.cy - b.h / 2 - vb.y) / vb.h) * 100}%`,
              width: `${(b.w / vb.w) * 100}%`,
              height: `${(b.h / vb.h) * 100}%`,
              opacity: 0,
              animation: `fd-panel-in 620ms cubic-bezier(0.2,0.8,0.25,1) ${240 + i * 460}ms forwards`,
              // a 3D part gets breathing room so its depth isn't clipped
              overflow: 'visible',
            }}
          >
            {is3d ? (
              <Piece3D panel={p} portalChrome={target === i} slotEl={slotEl} />
            ) : (
              <StyleScope svgStyle={configs[i].svgStyle} mods={configs[i].mods}>
                <SvgStyleTransform wrapperOverride={{ display: 'block', width: '100%', height: '100%' }}>
                  <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: pieceMarkup(p) }} />
                </SvgStyleTransform>
              </StyleScope>
            )}
          </div>
        );
      })}
      <style>{`@keyframes fd-panel-in{0%{opacity:0;transform:translateY(-14px)}100%{opacity:1;transform:translateY(0)}}`}</style>
    </>
  );
}

function Reveal(props: { panels: FdPanel[]; partnerName: string | null; onRestart: () => void }) {
  return (
    <Canvas3DProvider>
      <RevealInner {...props} />
    </Canvas3DProvider>
  );
}

// Debug: shows the skeleton the auto-rig extracted from the actual drawing —
// bones (red), joints (blue), limb tips (green) — overlaid on the faint linework.
function RigDebug({ panels }: { panels: FdPanel[] }) {
  const { viewBox: vb } = panelLayout(panels);
  const rig = useMemo(() => autoRig(placedStrokes(panels)), [panels]);
  const drawing = composeMarkup(panels, '#241f18').replace('<svg ', '<svg style="width:100%;height:100%;display:block" ');
  const overlay = rigDebugSvg(rig, undefined, vb);
  const joints = rig.nodes.filter((n) => n.kind === 'joint').length;
  const tips = rig.nodes.filter((n) => n.kind === 'tip').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: S.md }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', opacity: 0.5 }}>Auto-rig · skeleton read from the drawing</div>
      <div style={{ position: 'relative', aspectRatio: `${vb.w} / ${vb.h}`, height: 'min(66dvh, 560px)', maxWidth: '84vw', border: `1.5px solid ${ink}`, borderRadius: 16, background: paper, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.38 }} dangerouslySetInnerHTML={{ __html: drawing }} />
        <div style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: overlay }} />
      </div>
      <div style={{ fontSize: 12.5, opacity: 0.62, fontVariantNumeric: 'tabular-nums' }}>
        {rig.bones.length} bones · {joints} joints · {tips} tips · {rig.ok ? 'structure found' : 'best-effort stub'}
      </div>
    </div>
  );
}

function RevealInner({
  panels,
  partnerName,
  onRestart,
}: {
  panels: FdPanel[];
  partnerName: string | null;
  onRestart: () => void;
}) {
  const wide = useWide();
  const [alive, setAlive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [configs, setConfigs] = useState<StyleCfg[]>(() => panels.map((p) => ({ svgStyle: p.svgStyle ?? 'rough-handdrawn', mods: p.mods ?? DEFAULT_MODIFIERS })));
  // Each part is independently 2D or 3D — seeded from the choice made while
  // drawing it, so a part built in 3D during the game shows in 3D at the reveal.
  const [modes, setModes] = useState<Mode[]>(() => panels.map((p) => (p.view === '3d' ? '3d' : '2d')));
  const [target, setTarget] = useState<Target>(0);
  const [styleOpen, setStyleOpen] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const vb = composeViewBox(panels);
  const revealDoneAt = 240 + panels.length * 460;

  useEffect(() => {
    const t = setTimeout(() => setShowConfetti(true), revealDoneAt);
    return () => clearTimeout(t);
  }, [revealDoneAt]);

  const hits = (i: number) => target === 'all' || target === i;
  const applyStyleTo = (s: F3SvgStyle) => setConfigs((prev) => prev.map((c, i) => (hits(i) ? { svgStyle: s, mods: applyStylePreset(c.mods, s) } : c)));
  const applyModTo = <K extends keyof F3ModifiersState>(k: K, v: F3ModifiersState[K]) => setConfigs((prev) => prev.map((c, i) => (hits(i) ? { ...c, mods: { ...c.mods, [k]: v } } : c)));
  const resetTarget = () => setConfigs((prev) => prev.map((c, i) => (hits(i) ? { ...c, mods: applyStylePreset(DEFAULT_MODIFIERS, c.svgStyle) } : c)));
  const setModeTo = (m: Mode) => setModes((prev) => prev.map((cur, i) => (hits(i) ? m : cur)));
  const targetCfg = target === 'all' ? configs[0] : configs[target as number];
  const targetIs3d = target !== 'all' && modes[target as number] === '3d';
  const allTargetMode: Mode | 'mixed' = hits(0) && hits(1) && hits(2) ? (modes.every((m) => m === modes[0]) ? modes[0] : 'mixed') : targetIs3d ? '3d' : '2d';

  const save = async () => {
    setSaving(true);
    try {
      await saveCompositePng(panels);
    } finally {
      setSaving(false);
    }
  };

  // "Bring it to life" = the living, roaming, reactive creature (full screen).
  if (alive) return <FdPhysics panels={panels} configs={configs} onExit={() => setAlive(false)} />;

  const panelBoxR: React.CSSProperties = {
    width: wide ? 290 : 'min(92vw, 460px)',
    height: wide ? 'min(62dvh, 540px)' : 'auto',
    maxHeight: wide ? undefined : 'min(38dvh, 320px)',
    overflowY: 'auto',
    border: `1.5px solid ${ink}`,
    borderRadius: 16,
    padding: '12px 14px',
    background: paper,
    textAlign: 'left',
  };

  const partName = (t: Target) => (t === 'all' ? 'All' : t === 0 ? 'Head' : t === 1 ? 'Body' : 'Legs');
  return (
    <>
      <div>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', opacity: 0.5 }}>Your creature</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 1 }}>
          <span style={{ display: 'inline-flex', transform: 'translateY(-1px)' }}>
            <FdDoodle name="spark" size={22} />
          </span>
          <div style={{ fontSize: 28, fontWeight: 700, textWrap: 'balance' } as React.CSSProperties}>It’s alive!</div>
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.6, marginTop: 2 }}>Made by you {partnerName ? `& ${partnerName}` : '& your partner'}</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, justifyContent: 'center', alignItems: 'flex-start', width: '100%' }}>
        <div style={{ order: 1, position: 'relative' }}>
          <div
            data-fd="stage"
            style={{
              position: 'relative',
              aspectRatio: `${vb.w} / ${vb.h}`,
              height: 'min(58dvh, 470px)',
              maxWidth: '72vw',
              border: `1.5px solid ${ink}`,
              borderRadius: 16,
              overflow: 'hidden',
              background: paper,
              boxShadow: '0 12px 44px rgba(0,0,0,0.14)',
              animation: 'fd-pop 0.5s cubic-bezier(0.2,0.9,0.25,1.1)',
            }}
          >
            <RevealCreatureStage panels={panels} configs={configs} modes={modes} target={target} slotEl={slotEl} />
          </div>
          {showConfetti && modes.some((m) => m === '2d') && <InkConfetti />}
        </div>

        <div
          style={{
            order: wide ? 2 : 3,
            display: 'flex',
            flexDirection: 'column',
            gap: S.md,
            alignItems: 'stretch',
            animation: `fd-fade-up 460ms cubic-bezier(0.2,0.8,0.25,1) ${revealDoneAt}ms both`,
          }}
        >
          {/* which part */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', opacity: 0.45 }}>Part</span>
            {(['all', 0, 1, 2] as Target[]).map((t) => (
              <Pill key={String(t)} small tone={target === t ? 'solid' : 'ghost'} onClick={() => setTarget(t)}>
                {partName(t)}
              </Pill>
            ))}
          </div>
          {/* its look — same pill language as Part */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-start' }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', opacity: 0.45 }}>Look</span>
            <Pill small tone={allTargetMode === '2d' ? 'solid' : 'ghost'} onClick={() => setModeTo('2d')}>2D</Pill>
            <Pill small tone={allTargetMode === '3d' ? 'solid' : 'ghost'} onClick={() => setModeTo('3d')}>3D</Pill>
          </div>

          {targetIs3d ? (
            <div style={panelBoxR}>
              {/* the active 3D part portals its own Canvas3DChrome in here */}
              <div ref={setSlotEl} />
              {!slotEl && <div style={{ fontSize: 12, opacity: 0.5 }}>Loading 3D controls…</div>}
            </div>
          ) : (
            <>
              {target === 'all' && modes.some((m) => m === '3d') && (
                <div style={{ fontSize: 11.5, opacity: 0.5, maxWidth: 260, textAlign: 'center' }}>
                  Pick a single part to fine-tune its 3D look.
                </div>
              )}
              {wide ? (
                <StyleControlsBox svgStyle={targetCfg.svgStyle} mods={targetCfg.mods} onStyle={applyStyleTo} onMod={applyModTo} onReset={resetTarget} height={'min(52dvh, 440px)'} />
              ) : (
                <StylePanel label="Style panel" svgStyle={targetCfg.svgStyle} mods={targetCfg.mods} onStyle={applyStyleTo} onMod={applyModTo} onReset={resetTarget} open={styleOpen} onToggle={() => setStyleOpen((v) => !v)} />
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', animation: `fd-fade-up 460ms cubic-bezier(0.2,0.8,0.25,1) ${revealDoneAt + 120}ms both` }}>
        <Pill onClick={() => setAlive(true)}>
          Bring it to life <FdDoodle name="spark" size={15} engine={false} />
        </Pill>
        <Pill tone="ghost" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save it'}
        </Pill>
        <Pill tone="ghost" onClick={onRestart}>
          Play again
        </Pill>
      </div>
      <style>{`@keyframes fd-pop{0%{transform:scale(0.72);opacity:0}100%{transform:scale(1);opacity:1}}`}</style>
    </>
  );
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

function Lobby({
  code,
  myIndex,
  name,
  setName,
  partnerHere,
}: {
  code: string;
  myIndex: 0 | 1;
  name: string;
  setName: (v: string) => void;
  partnerHere: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const link = `${window.location.origin}/play?room=${code}`;
  const doJoin = () => {
    if (joinCode.length === 4) window.location.href = `/play?room=${joinCode}`;
  };

  const copy = useCallback(() => {
    navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {},
    );
  }, [link]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: S.xl }}>
      {/* identity */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: S.md }}>
        <Wordmark />
        <input
          className="fd-input"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 20))}
          placeholder="your name"
          aria-label="your name"
          spellCheck={false}
          autoComplete="off"
          style={{ ...fieldStyle, padding: '11px 18px', width: 210 }}
        />
      </div>
      {myIndex === 0 ? (
        <>
          {/* your code to share */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: S.sm }}>
            <div style={{ fontSize: 13, opacity: 0.6 }}>Send this code to your partner:</div>
            <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: '0.16em', paddingLeft: '0.16em', lineHeight: 1 }}>{code}</div>
            <Pill onClick={copy}>
              {copied ? 'Copied' : 'Copy invite link'}
              {copied && <FdDoodle name="check" size={15} engine={false} />}
            </Pill>
            <div style={{ fontSize: 12, opacity: 0.5, display: 'flex', alignItems: 'center', gap: 8, marginTop: S.xs }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: partnerHere ? '#3aa655' : ink, opacity: partnerHere ? 1 : 0.4 }} />
              {partnerHere ? 'Partner connected — starting…' : 'Waiting for your partner to join…'}
            </div>
          </div>
          {/* or join with a code */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: S.sm }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', opacity: 0.45 }}>Got a code instead?</div>
            <div style={{ display: 'flex', gap: S.sm }}>
              <input
                className="fd-input"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
                onKeyDown={(e) => e.key === 'Enter' && doJoin()}
                placeholder="CODE"
                aria-label="join code"
                spellCheck={false}
                autoComplete="off"
                style={{ ...fieldStyle, fontWeight: 700, letterSpacing: '0.14em', width: 118, padding: '11px 14px' }}
              />
              <Pill small onClick={doJoin} disabled={joinCode.length !== 4}>
                Join
              </Pill>
            </div>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 21, fontWeight: 600 }}>Joining room {code}</div>
          <div style={{ color: ink, animation: 'fd-sway 1.8s ease-in-out infinite' }}>
            <FdDoodle name="link" size={46} />
          </div>
          <div style={{ fontSize: 13, opacity: 0.55 }}>{partnerHere ? 'Connected — starting…' : 'Waiting for the host…'}</div>
          <style>{`@keyframes fd-sway{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}}`}</style>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FrankendoodlePage() {
  const [{ code, myIndex }] = useState(resolveRoom);
  const [name, setName] = useState<string>(() => {
    try {
      return sessionStorage.getItem('fd:name') || '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem('fd:name', name);
    } catch {
      /* ignore */
    }
  }, [name]);
  useEffect(() => {
    document.title = 'Frankendoodle — draw a monster together';
  }, []);

  const room = useGameRoom({ code, myIndex, myName: name });
  const partnerLabel = room.partnerName || 'Your partner';

  useEffect(() => {
    (window as unknown as { __fd?: unknown }).__fd = {
      phase: room.phase,
      isMyTurn: room.isMyTurn,
      activePanel: room.activePanel,
      myIndex,
      connected: room.connected,
      bothPresent: room.bothPresent,
      partnerName: room.partnerName,
      panels: room.state.panels.length,
      submit: (strokes: Stroke[], cfg?: PieceStyle | F3SvgStyle) => {
        const base = defaultCfg();
        const pc: PieceStyle =
          typeof cfg === 'string'
            ? { svgStyle: cfg, mods: DEFAULT_MODIFIERS, toneFills: [] }
            : {
                svgStyle: cfg?.svgStyle ?? base.svgStyle,
                mods: cfg?.mods ?? base.mods ?? DEFAULT_MODIFIERS,
                toneFills: cfg?.toneFills ?? [],
                view: cfg?.view,
              };
        room.submitPanel(strokes, pc);
      },
      restart: room.restart,
    };
  });

  // Demo shortcut: /play?demo drops you straight into the reveal with a sample
  // monster (no partner / drawing needed) so any screen can be seen + felt live.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('demo')) return;
    if (room.state.panels.length > 0) return;
    const mk = (points: [number, number, number][]): Stroke => ({ id: Math.random().toString(36).slice(2), points });
    const ring = (cx: number, cy: number, rx: number, ry: number, n = 30): [number, number, number][] =>
      Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 0.6] as [number, number, number]; });
    const seg = (x1: number, y1: number, x2: number, y2: number): [number, number, number][] => [[x1, y1, 0.6], [x2, y2, 0.6]];
    const head = [mk(ring(400, 160, 120, 128)), mk(ring(358, 150, 15, 18)), mk(ring(444, 150, 15, 18)), mk([[362, 205, 0.6], [400, 224, 0.6], [440, 203, 0.6]])];
    const bodyP = [mk(ring(400, 330, 122, 108)), mk(seg(298, 306, 244, 350)), mk(seg(502, 306, 556, 350))];
    const legs = [mk(seg(358, 436, 336, 566)), mk(seg(442, 436, 464, 566)), mk(seg(336, 566, 308, 578)), mk(seg(464, 566, 492, 578))];
    const cfg: PieceStyle = { svgStyle: 'rough-handdrawn', mods: DEFAULT_MODIFIERS, toneFills: [] };
    room.submitPanel(head, cfg);
    room.submitPanel(bodyP, cfg);
    room.submitPanel(legs, cfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.state.panels.length]);

  let body: ReactNode;
  if (room.phase === 'lobby') {
    body = <Lobby code={code} myIndex={myIndex} name={name} setName={setName} partnerHere={room.bothPresent} />;
  } else if (room.phase === 'reveal') {
    body = new URLSearchParams(window.location.search).has('rig')
      ? <RigDebug panels={room.state.panels} />
      : <Reveal panels={room.state.panels} partnerName={room.partnerName} onRestart={room.restart} />;
  } else if (room.isMyTurn) {
    body = <DrawTurn key={room.activePanel} panelIndex={room.activePanel} prevPanel={room.prevPanel} onDone={room.submitPanel} />;
  } else {
    body = <WaitTurn who={partnerLabel} panelIndex={room.activePanel} />;
  }

  return (
    <Shell>
      {body}
      {room.phase !== 'lobby' && (
        <div style={{ position: 'fixed', bottom: 10, fontSize: 11, opacity: 0.36 }}>
          room {code} · {room.bothPresent ? 'both connected' : 'partner offline'}
        </div>
      )}
    </Shell>
  );
}

export default FrankendoodlePage;
