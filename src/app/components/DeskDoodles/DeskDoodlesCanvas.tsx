import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { NavLink } from 'react-router';
import { IS, ISe } from '../../lib/typography';
import { PILL, CTA, SECTION_LABEL } from '../../lib/chromeStyles';
import { Canvas3DProvider, useCanvas3D } from '../../state/Canvas3DContext';
import { useF3RoughModifiers } from '../../state/F3RoughModifiersContext';
import { useF3SvgStyle } from '../../state/F3SvgStyleContext';
// Type-only import — erased at compile, keeps three out of the main chunk.
import type { HatchInputs } from '../canvas3d/hatchMaterial';

// CTA mixes PILL's `border` shorthand with a `borderColor` longhand — React
// dev warns when such conflicting styles diff across renders. Collapse to a
// single shorthand at this call site (chromeStyles is shared, owned elsewhere).
const { borderColor: _ctaBorderColor, ...CTA_REST } = CTA;
const CTA_PILL: CSSProperties = { ...CTA_REST, border: `1px solid ${String(_ctaBorderColor)}` };
import { SmartHachureChrome } from '../chrome/SmartHachureChrome';
import { Canvas3DChrome } from '../chrome/Canvas3DChrome';
import {
  CollapsiblePanel,
  PanelToggle,
  useMinimizeUi,
  usePanelOpen,
} from '../chrome/CollapsiblePanel';
// DrawSurface + stroke helpers extracted to DrawSurface.tsx 2026-06-11
// (mechanical move — also hosted by the /desk DrawPanel popup).
import {
  DrawSurface,
  strokesToObjectMarkup,
  SHADE_TOOL_DEFAULT,
  type CanvasMode,
  type InputMode,
  type Stroke,
  type StrokePoint,
  type ToneFill,
  type ShadeToolState,
  type ShapeSnapApi,
} from './DrawSurface';
import { DrawToolbar } from './DrawToolbar';
import { type ShapeCandidate, type ShapeFitResult, type SnapAction } from '../../lib/draw/shapeFit';
import { SwitchPopover } from './SwitchPopover';
import { ShapeStrip } from './ShapeStrip';
import { buildSwitchSet, type ShapeOverride, type SwitchEntry } from '../../lib/draw/switchSet';
import { generateShape } from '../../lib/draw/shapeLibrary';
import { pushShapeSnapEntry, type ShapeSnapOutcome } from '../../lib/shapeSnapLog';
import { COVERAGE_BANDS } from '../../lib/smart/coverage';
import { svgMarkupToStrokes } from '../../lib/svgToStrokes';
// svg-port 3D: the offscreen REAL 2D render whose styled <svg> the form wears.
// Already in the main chunk (DrawSurface imports it) — no extra cost.
import { SvgStyleTransform } from '../canvas/SvgStyleTransform';

// ─── 3D wiring (plan §2.3) ───────────────────────────────────────────────────
// React.lazy keeps three + drei (~600KB gz) out of the main chunk — /desk and
// 2D-only sessions never pay it. NOTHING ELSE in this file may import from
// canvas3d/ or geometry3d/ at module level (a static value import would pull
// three back into the main chunk). Make watch item: lazy chunks are standard
// Vite output but unverified in Make preview — fallback = static import.
const Stroke3DSceneLazy = lazy(() => import('../canvas3d'));

/** Mirror of canvas3d/Stroke3DScene MAX_STROKES_3D — keep in sync by hand
 *  (importing the real constant would defeat the lazy chunk, see above). */
const MAX_STROKES_3D = 60;

/** Honest in-frame note (same register as DrawSurface's GATE_STYLE copy). */
function FrameNote({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontFamily: IS,
        fontSize: 11,
        color: 'var(--dir-text-secondary)',
        letterSpacing: '0.04em',
        textAlign: 'center',
      }}
    >
      <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>{title}</span>
      <span>{body}</span>
    </div>
  );
}

// (SnapChip moved into the shared DrawToolbar — Phase 0 extraction.)

/** Provider shell — the 3D control state lives page-wide so the header pills
 *  (chrome) and the canvas overlay read the same values, and so DrawSurface
 *  can read useCanvas3D() directly once the main thread swaps its honesty
 *  gate (plan §2.4 — provider here instead of App.tsx keeps /desk untouched;
 *  useCanvas3D falls back to defaults when unprovided). */
export function DeskDoodlesCanvas() {
  return (
    <Canvas3DProvider>
      <DeskDoodlesCanvasPage />
    </Canvas3DProvider>
  );
}

function DeskDoodlesCanvasPage() {
  const [mode, setMode] = useState<CanvasMode>('svg');
  const [input, setInput] = useState<InputMode>('draw');
  // FITTED uploaded-SVG markup, mirrored up from DrawSurface, flattened into
  // strokes for the easy svg→3D bridge (svgToStrokes).
  const [uploadedSvgMarkup, setUploadedSvgMarkup] = useState<string | null>(null);
  // CURRENT stroke pool, lifted out of DrawSurface via its onStrokesChange
  // mirror (DrawSurface keeps ownership of capture; this is a read-only copy
  // — the 3D scene is fed the SAME strokes the 2D surface holds, so flipping
  // the mode tab converts exactly what's drawn).
  const [strokes3d, setStrokes3d] = useState<Stroke[]>([]);
  // Live mirror of the TONE-PATCH pool (the shade register's output) — same
  // stable-setState contract as strokes3d. Read-only here; the commit lives in
  // DrawSurface (its in-frame Done picks up tone alongside strokes).
  const [tone, setTone] = useState<ToneFill[]>([]);
  // Inspection mirror (the __dd_toneFills idiom, mirrored from DrawPanel): lets
  // verification tooling read the live tone record without driving a commit.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).__dd_toneFills = tone;
  }, [tone]);

  // ── DRAW-TOOL GAMBIT (parity with the /desk DrawPanel popup) ─────────────
  // INK | SHADE register — which tool the pointer wields while sketching
  // (round 7). Ink = strokes; Shade = the tone-fill brush. Only meaningful in
  // 2D draw mode; the chrome that surfaces it is gated on mode/input below.
  const [penRegister, setPenRegister] = useState<'ink' | 'shade' | 'erase'>('ink');
  const [eraseMode, setEraseMode] = useState<'object' | 'pixel'>('object');
  const [shadeTool, setShadeTool] = useState<ShadeToolState>(SHADE_TOOL_DEFAULT);

  // FILL-TOOL NOTE — the honest-miss one-liner ("no closed region here…")
  // rides a self-clearing caption slot under the canvas (DrawPanel idiom).
  const [fillNote, setFillNote] = useState<string | null>(null);
  const fillNoteTimer = useRef<number | null>(null);
  const showFillNote = useCallback((note: string) => {
    setFillNote(note);
    if (fillNoteTimer.current) window.clearTimeout(fillNoteTimer.current);
    fillNoteTimer.current = window.setTimeout(() => {
      setFillNote(null);
      fillNoteTimer.current = null;
    }, 4000);
  }, []);
  useEffect(
    () => () => {
      if (fillNoteTimer.current) window.clearTimeout(fillNoteTimer.current);
    },
    [],
  );

  // ── SHAPE ASSIST (Rock F3) — SNAP / STRAIGHTEN action pills ───────────────
  // Freehand is the DEFAULT; SNAP / STRAIGHTEN are action VERBS on the LAST
  // stroke when tapped. DrawSurface owns the strokes + the apply; this page
  // owns the pills + the chip. Mirrors DrawPanel.tsx exactly (the reference).
  const snapApiRef = useRef<ShapeSnapApi | null>(null);
  const handleSnapApi = useCallback((api: ShapeSnapApi) => {
    snapApiRef.current = api;
  }, []);
  // ── SNAP SWITCHER (Sebs 2026-06-15 — the ONE snap UI, mirrors DrawPanel) ────
  // No auto-offer on pen-up, no click-through cycle chip. The SNAP button fits
  // the last stroke, applies the best shape, and opens THIS switcher (recognized
  // ∪ 12 library ∪ Original). ✕ dismisses (applied shape stays; pick Original to
  // revert).
  const [override, setOverride] = useState<ShapeOverride | null>(null);
  const [switchAllOpen, setSwitchAllOpen] = useState(false);
  // SHAPE INSERT (Phase 2) — armed library/primitive shape (null = Freehand).
  const [armedShape, setArmedShape] = useState<string | null>(null);
  const armShape = useCallback((kind: string | null) => {
    setArmedShape(kind);
    if (kind) {
      setPenRegister('ink');
      setOverride(null);
    }
  }, []);
  /** Log one shape-snap act into the unified decision log (training flywheel,
   *  spec §2.5/§8) — identical to DrawPanel's logSnap. */
  const logSnap = useCallback(
    (
      action: SnapAction,
      outcome: ShapeSnapOutcome,
      strokeId: string,
      result: ShapeFitResult,
      chosen: ShapeCandidate['kind'],
      margin: number,
    ) => {
      pushShapeSnapEntry({
        entryType: 'shape-snap',
        surface: 'shape-snap',
        action,
        outcome,
        strokeId,
        accepted: result.accepted,
        refusedReason: result.refusedReason,
        candidates: result.candidates.map((c) => ({
          kind: c.kind,
          normErr: c.normErr,
          score: c.score,
        })),
        chosen,
        margin,
      });
    },
    [],
  );

  /** Tap SNAP or STRAIGHTEN: fit the last stroke, apply the best candidate (or
   *  refuse honestly), raise the chip. Mirrors DrawPanel.tsx's runSnap. */
  const runSnap = useCallback(
    (action: SnapAction) => {
      const api = snapApiRef.current;
      if (!api) return;
      const last = api.lastStroke();
      if (!last) {
        showFillNote('nothing to snap — draw a stroke first');
        return;
      }
      const fit = api.fitLast(action);
      if (!fit) {
        showFillNote('that stroke is too small to snap');
        return;
      }
      const { strokeId, result } = fit;
      const real = result.candidates.filter((c) => c.kind !== 'original');
      const margin = real.length >= 2 ? real[0].score - real[1].score : real.length === 1 ? 1 : 0;
      if (!result.accepted) {
        logSnap(action, 'evaluate', strokeId, result, 'original', 0);
        showFillNote(
          action === 'snap'
            ? "didn't read as one clean shape — try Straighten"
            : "couldn't straighten that — it reads as a scribble",
        );
        return;
      }
      // Apply the best candidate (the snap) then OPEN the switcher — the ONE
      // snap path; replaces the old cycle chip AND the auto-offer (Sebs 2026-06-15).
      const best = result.candidates[0];
      api.applyToStroke(strokeId, best, last.points);
      logSnap(action, 'evaluate', strokeId, result, best.kind, margin);
      const switchSet = buildSwitchSet(result, last.points);
      const appliedIndex = Math.max(
        0,
        switchSet.findIndex((e) => e.source === 'recognized' && e.kind === best.kind),
      );
      setOverride({ strokeId, appliedKind: best.kind, switchSet, appliedIndex, originalPoints: last.points });
      setSwitchAllOpen(true);
    },
    [logSnap, showFillNote],
  );

  /** Apply one switch entry to the override's stroke (recognized → fitted
   *  candidate; library → generate at bbox; original → restore). Mirrors DrawPanel. */
  const applyOverrideEntry = useCallback(
    (entry: SwitchEntry, index: number) => {
      const api = snapApiRef.current;
      if (!api || !override) return;
      if (entry.source === 'recognized' && entry.candidate) {
        api.applyToStroke(override.strokeId, entry.candidate, override.originalPoints);
      } else if (entry.source === 'library') {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of override.originalPoints) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        const outline = generateShape(
          entry.kind as Parameters<typeof generateShape>[0],
          { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        );
        if (outline) {
          const cand: ShapeCandidate = {
            kind: 'polygon',
            points: outline as unknown as ShapeCandidate['points'],
            normErr: 0,
            score: 1,
            closed: true,
            label: entry.label,
            notes: `library:${entry.kind}`,
          };
          api.applyToStroke(override.strokeId, cand, override.originalPoints);
        }
      } else {
        const cand: ShapeCandidate = {
          kind: 'original',
          points: override.originalPoints as unknown as ShapeCandidate['points'],
          normErr: 0,
          score: 0,
          closed: false,
          label: 'Original',
        };
        api.applyToStroke(override.strokeId, cand, override.originalPoints);
      }
      setOverride({ ...override, appliedIndex: index, appliedKind: entry.kind });
      setSwitchAllOpen(false);
    },
    [override],
  );

  /** Dismiss the snap switcher (keep whatever shape is applied). */
  const dismissSnapChip = useCallback(() => {
    setOverride(null);
    setSwitchAllOpen(false);
  }, []);

  // Gap scrub → slider sync (DrawSurface fires once per ladder step; the
  // scrubbed value persists in the shared tool state — spec D-RF3).
  const handleGapChange = useCallback((gap: number) => {
    setShadeTool((prev) => (prev.gap === gap ? prev : { ...prev, gap }));
  }, []);

  // The draw-tool gambit only applies on the 2D drawing surface (mode svg +
  // draw input). In 3D or upload modes there are no live ink/tone strokes to
  // shade or snap, so the chrome and the shade prop are gated off there.
  const drawToolsActive = mode === 'svg' && input === 'draw';
  // SHADE only runs in the Ink|Shade register's Shade position AND only when
  // the draw tools are live (DrawSurface's own shade gate also checks
  // !styled/input/mode, but gating here keeps the chrome honest).
  const shadeActive = drawToolsActive && penRegister === 'shade';

  // SHAPE-ASSIST chip dismissal (spec §3): the chip's claim is about the prior
  // stroke, so it dismisses when a NEW stroke arrives, the register changes, or
  // the mode/input switches — DrawPanel's exact lifecycle. A key gates the
  // effect so it fires only on genuine change.
  const snapDismissKey = `${strokes3d.length}|${penRegister}|${mode}|${input}`;
  const prevSnapDismissKey = useRef(snapDismissKey);
  useEffect(() => {
    if (prevSnapDismissKey.current !== snapDismissKey) {
      prevSnapDismissKey.current = snapDismissKey;
      dismissSnapChip();
    }
  }, [snapDismissKey, dismissSnapChip]);

  const { geometryMode, style3d, materialPreset, nativeProps, hatchGrammar, hatchDirection, modeParams,
    reliefDepth, reliefCsg, setStyle3d, setGeometryMode } =
    useCanvas3D();
  const { state: mods, set: setMod } = useF3RoughModifiers();
  const { state: svgStyle, setState: setSvgStyle } = useF3SvgStyle();

  // DEV-only test seam: drive 3D + SVG style + modifiers programmatically
  // (verification harnesses set these instead of clicking dropdown popovers —
  // the chrome dropdowns are fiddly to drive headlessly). setMod(key, value)
  // sets any F3 modifier (e.g. multiStroke, fillStyle, penTip). Stripped in prod
  // builds (import.meta.env.DEV guard).
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).__ddSet = {
      setMode, setStyle3d, setGeometryMode, setSvgStyle, setMod,
    };
  }, [setStyle3d, setGeometryMode, setSvgStyle, setMod]);
  // EASY svg→3D bridge: an uploaded SVG never enters the stroke pool (it renders
  // as 2D-only markup), so 3D used to say "nothing to convert". Flatten the
  // FITTED upload markup into strokes (svgToStrokes) and use them when there are
  // no drawn strokes — the SAME strokeTo3d engine then converts them (rod /
  // extrude / solid). Complex raster→GLB stays the R10 hard path.
  const uploadStrokes = useMemo(
    () => (uploadedSvgMarkup ? svgMarkupToStrokes(uploadedSvgMarkup) : []),
    [uploadedSvgMarkup],
  );
  const drawnStrokePoints = useMemo(() => strokes3d.map((s) => s.points), [strokes3d]);
  // Drawn strokes win; uploaded-SVG strokes are the fallback so a pure upload
  // still converts to 3D.
  const strokePoints = drawnStrokePoints.length > 0 ? drawnStrokePoints : uploadStrokes;

  // ── svg-port 3D: feed the scene the REAL styled 2D render ──────────────────
  // When style3d is svg-port, mount the actual SvgStyleTransform OFFSCREEN on
  // the current strokes (same source markup the 2D commit layer uses) and let
  // its onRender seam hand us the serialized styled <svg>. The 3D form then
  // wears that EXACT render (project_f3_shading_port_to_3d — real pipeline, not
  // a parallel shader). Re-renders live as strokes/style/Shading sliders change.
  const svgPortActive = mode === '3d' && style3d === 'svg-port' && strokePoints.length > 0;
  const [svgPortMarkup, setSvgPortMarkup] = useState<string | null>(null);
  // TONE→3D (Sebs 2026-06-15, shading-research Approach 1): thread the painted
  // tone bands into the svg-port markup so dark shaded regions reach
  // buildSvgPortTexture's luminance→relief+emissive pass and READ DARK on the 3D
  // form. Was dropped here (tone arg omitted → '' tone markup → 3D saw only the
  // fill="none" stroke lines). No tone painted → toneFillsMarkup([]) = '' →
  // byte-identical to before (zero regression). Stays ink-black: value comes from
  // the existing texture's carved relief + emissive under light, not grey albedo.
  const svgPortSource = useMemo(
    () => (svgPortActive ? strokesToObjectMarkup(strokes3d, tone) : null),
    [svgPortActive, strokes3d, tone],
  );
  // Stable per-style carve-profile bundle (memo so 3D-rotation re-renders don't
  // churn the build effect). styleId → the active svg-style's relief profile.
  const canvasSvgPortBuild = useMemo(() => ({ styleId: svgStyle, reliefDepth, reliefCsg }), [svgStyle, reliefDepth, reliefCsg]);
  // Live 2D Shading values → hatch/svg-port uniforms (one math, four
  // renderers): the SAME F3RoughModifiers state the 2D pen reads + the Hatch
  // STYLE toggles (grammar/direction, symmetry-law gap cell §1). Memo keyed on
  // the consumed fields only, so unrelated 2D toggles don't churn the prop.
  const hatchInputs = useMemo<HatchInputs>(
    () => ({
      hachureGap: mods.hachureGap,
      hachureAngle: mods.hachureAngle,
      strokeWidth: mods.strokeWidth,
      inkIntensity: mods.inkIntensity,
      fillStyle: mods.fillStyle,
      wobble: mods.wobble,
      fillOpacity: mods.fillOpacity,
      grammar: hatchGrammar,
      direction: hatchDirection,
    }),
    [
      mods.hachureGap,
      mods.hachureAngle,
      mods.strokeWidth,
      mods.inkIntensity,
      mods.fillStyle,
      mods.wobble,
      mods.fillOpacity,
      hatchGrammar,
      hatchDirection,
    ],
  );
  const [leftOpen, toggleLeft, setLeftOpen] = usePanelOpen('canvas.left');
  const [rightOpen, toggleRight, setRightOpen] = usePanelOpen('canvas.right');
  useMinimizeUi([
    { open: leftOpen, setOpen: setLeftOpen },
    { open: rightOpen, setOpen: setRightOpen },
  ]);

  // SNAP SWITCHER receipt — rendered INLINE next to the SNAP/STRAIGHTEN pills via
  // DrawToolbar's snapSwitcher slot (Sebs 2026-06-15: "appear next to the snap").
  const snapSwitcherNode = override ? (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--dir-accent)' }} />
      <button
        style={{ ...PILL, fontFamily: IS, fontSize: 11, padding: '5px 12px', cursor: 'pointer', background: switchAllOpen ? 'var(--dir-text-primary)' : 'var(--dir-bg)', color: switchAllOpen ? 'var(--dir-bg)' : 'var(--dir-text-body)', border: '1px solid var(--dir-border)' }}
        onClick={() => setSwitchAllOpen((v) => !v)}
        title="Switch to another shape"
      >
        Snapped to {override.switchSet[override.appliedIndex]?.label ?? 'shape'} ▾
      </button>
      <button
        style={{ ...PILL, fontFamily: IS, fontSize: 11, padding: '5px 10px', cursor: 'pointer', background: 'var(--dir-bg)', color: 'var(--dir-text-body-soft)', border: '1px solid var(--dir-border)' }}
        onClick={() => setOverride(null)}
        title="Done"
      >
        ✕
      </button>
      {switchAllOpen && (
        <SwitchPopover override={override} onSwitchTo={applyOverrideEntry} onClose={() => setSwitchAllOpen(false)} />
      )}
    </div>
  ) : null;

  return (
    <div
      style={{
        // Definite height (not min-height) so the canvas frame's maxHeight
        // chain resolves — the page never scrolls; the frame fits the
        // leftover space the flex layout measures, no estimated pixels.
        height: '100vh',
        background: 'var(--dir-bg)',
        color: 'var(--dir-text-primary)',
        fontFamily: IS,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top chrome — brand left, mode toggle center, publish right */}
      <header
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--dir-border)',
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 24,
          background: 'var(--dir-bg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <NavLink
            to="/"
            style={{
              fontFamily: ISe,
              fontSize: 18,
              letterSpacing: '-0.01em',
              color: 'var(--dir-text-primary)',
              textDecoration: 'none',
            }}
          >
            Desk Doodles
          </NavLink>
          <PanelToggle
            side="left"
            open={leftOpen}
            label="Input"
            onToggle={toggleLeft}
            controlsId="canvas-left-panel"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            role="tablist"
            aria-label="Canvas mode"
            style={{
              display: 'inline-flex',
              border: '1px solid var(--dir-border)',
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            {(['svg', '3d'] as CanvasMode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                style={{
                  ...PILL,
                  border: 'none',
                  borderRadius: 0,
                  background: mode === m ? 'var(--dir-accent)' : 'transparent',
                  color: mode === m ? 'var(--dir-bg)' : 'var(--dir-text-body)',
                }}
              >
                {m === 'svg' ? '2D' : '3D'}
              </button>
            ))}
          </div>
          {/* Round-7 chrome split (3d-mode-controls-spec §5): the geometry
              control moved from header pills into the right panel's GEOMETRY
              cluster (Canvas3DChrome) — still shell chrome per
              feedback_toggles_always_in_chrome, now beside its full per-mode
              param set. Only the 2D|3D MODE pair stays in the header. */}
        </div>

        <div style={{ justifySelf: 'end', display: 'flex', gap: 8, alignItems: 'center' }}>
          <PanelToggle
            side="right"
            open={rightOpen}
            label="Controls"
            onToggle={toggleRight}
            controlsId="canvas-right-panel"
          />
          <button
            disabled
            title="Publishing lives on /desk — this page is the test surface"
            style={{
              ...CTA_PILL,
              cursor: 'not-allowed',
              opacity: 0.5,
            }}
          >
            Publish
          </button>
        </div>
      </header>

      {/* Body — left dock + main canvas + right Smart Hachure chrome */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left dock */}
        <CollapsiblePanel
          side="left"
          open={leftOpen}
          width={280}
          id="canvas-left-panel"
          style={{
            borderRight: '1px solid var(--dir-border)',
            background: 'var(--dir-raised)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Input section */}
          <section style={{ padding: 24, borderBottom: '1px solid var(--dir-border)' }}>
            <h2 style={{ ...SECTION_LABEL, margin: '0 0 16px 0' }}>
              Input
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(
                [
                  ['draw', 'Draw'],
                  ['upload-svg', 'Upload SVG'],
                  ['upload-image', 'Upload image'],
                ] as [InputMode, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setInput(key)}
                  // Intentional PILL override — sentence-case 13/400 type for the dock (locked 2026-06-10).
                  style={{
                    ...PILL,
                    width: '100%',
                    textAlign: 'center',
                    textTransform: 'none',
                    letterSpacing: 'normal',
                    fontSize: 13,
                    fontWeight: 400,
                    padding: '10px 14px',
                    background: input === key ? 'var(--dir-bg)' : 'transparent',
                    color: 'var(--dir-text-primary)',
                    // Full shorthand (not borderColor) so the selected-state
                    // swap never mixes shorthand + longhand (React dev warning).
                    border: input === key ? '1px solid var(--dir-accent)' : '1px solid var(--dir-border)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Settings section */}
          <section style={{ padding: 24, flex: 1 }}>
            <h2 style={{ ...SECTION_LABEL, margin: '0 0 16px 0' }}>
              Settings
            </h2>
            <p
              style={{
                fontFamily: IS,
                fontSize: 13,
                color: 'var(--dir-text-body-soft)',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              Style + Smart Hachure controls live in the Controls panel on the right.
            </p>
          </section>
        </CollapsiblePanel>

        {/* Main canvas area */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            padding: 48,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            background: 'var(--dir-bg)',
          }}
        >
          {/* DRAW-TOOL GAMBIT row (parity with the /desk DrawPanel popup,
              mirrored 2026-06-13): the Ink|Shade register pair, the Snap +
              Straighten action pills (+ the candidate-cycling chip), and the
              honest-miss caption. Only on the 2D drawing surface — gone in 3D
              and upload modes (no live ink/tone there). Caps the canvas width
              (920) so the toolbar lines up over the frame. */}
          {drawToolsActive && (
            <div style={{ width: '100%', maxWidth: 920, marginBottom: 12, flexShrink: 0 }}>
              {/* SHAPE INSERT quick-pick (Phase 2) — arm a shape → drag to place. */}
              {penRegister === 'ink' && (
                <div style={{ marginBottom: 8 }}>
                  <ShapeStrip armedShape={armedShape} onArmShape={armShape} collapsed />
                </div>
              )}
              <DrawToolbar
                variant="canvas"
                register={penRegister}
                onRegisterChange={setPenRegister}
                eraseMode={eraseMode}
                onEraseModeChange={setEraseMode}
                shadeTool={shadeTool}
                onShadeToolChange={setShadeTool}
                snapEnabled={penRegister === 'ink' && strokes3d.length > 0}
                onSnapAction={runSnap}
                snapTitle={(act) =>
                  penRegister === 'shade'
                    ? 'Snap works on ink — flip to Ink'
                    : strokes3d.length === 0
                      ? 'Draw a stroke first'
                      : act === 'snap'
                        ? 'Snap the last stroke to a clean shape'
                        : 'Crisp the last stroke’s edges (keeps your proportions)'
                }
                snapSwitcher={snapSwitcherNode}
                captionAlert={!!fillNote}
                captionText={
                  fillNote ??
                  (penRegister === 'shade'
                    ? shadeTool.tool === 'fill'
                      ? shadeTool.erase
                        ? 'erase fill — tap a region to lift its tone'
                        : 'tap inside a region to fill it — hold, then drag sideways to scrub Gap'
                      : shadeTool.tool === 'lasso'
                        ? shadeTool.erase
                          ? 'lasso erase — loop an area to lift its tone'
                          : 'lasso — draw a loop, it closes on release and fills'
                        : shadeTool.erase
                          ? 'erasing tone — brush carves it back to paper'
                          : `brushing ${COVERAGE_BANDS[shadeTool.band]?.name ?? 'mid'} tone — flat grey under your ink`
                    : 'raw ink — keep sketching')
                }
              />
            </div>
          )}

          {/* Sizing wrapper duplicates DrawSurface's own frame constraints
              (920 max / 4:3) so the 3D overlay can sit EXACTLY over the frame
              without editing DrawSurface — its internal honesty gate stays
              underneath until the main thread swaps it (plan §2.3). */}
          <div
            style={{
              width: '100%',
              maxWidth: 920,
              maxHeight: '100%',
              aspectRatio: '800 / 600',
              position: 'relative',
            }}
          >
            <DrawSurface
              mode={mode}
              input={input}
              onStrokesChange={setStrokes3d}
              shade={
                drawToolsActive
                  ? {
                      // Erase register rides the tone-brush gesture (band-0 lifter)
                      // and eraseStrokes below makes the same drag rub out ink too.
                      active: penRegister === 'shade' || penRegister === 'erase',
                      tool: penRegister === 'erase' ? 'brush' : shadeTool.tool,
                      band: penRegister === 'erase' ? 0 : shadeTool.band,
                      radius: shadeTool.radius,
                      erase: penRegister === 'erase' ? true : shadeTool.erase,
                      gap: shadeTool.gap,
                      fullFill: shadeTool.fullFill,
                    }
                  : null
              }
              eraseStrokes={drawToolsActive && penRegister === 'erase'}
              eraseMode={eraseMode}
              onToneFillsChange={setTone}
              onGapChange={handleGapChange}
              onFillNote={showFillNote}
              onSnapApi={handleSnapApi}
              onUploadedSvgChange={(m) => {
                setUploadedSvgMarkup(m);
                // Uploads default to CLEAN — our baseline (Sebs 2026-06-16). The
                // default hachure fillStyle drew faint cross-lines across line-art.
                if (m) setSvgStyle('clean');
              }}
              onSelectionChange={(id) => { if (id === null) setOverride(null); }}
              armedShape={armedShape}
              onShapeInserted={() => { setOverride(null); setArmedShape(null); }}
            />
            {mode === '3d' && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 6,
                  overflow: 'hidden',
                  border: '1px solid var(--dir-border)',
                  background: 'var(--dir-bg)',
                }}
              >
                {strokePoints.length > 0 ? (
                  <Suspense fallback={<FrameNote title="Loading 3D" body="Fetching the geometry engine…" />}>
                    <Stroke3DSceneLazy
                      strokes={strokePoints}
                      toneFills={tone}
                      geometryMode={geometryMode}
                      style3d={style3d}
                      materialPreset={materialPreset}
                      nativeProps={nativeProps}
                      modeParams={modeParams}
                      hatchInputs={hatchInputs}
                      svgPortMarkup={svgPortMarkup ?? undefined}
                      // Per-style carve PROFILE so /canvas svg-port also reads
                      // distinct per style (full res — one big object, no burst).
                      svgPortBuild={canvasSvgPortBuild}
                      style={{ width: '100%', height: '100%' }}
                    />
                  </Suspense>
                ) : (
                  <FrameNote
                    title="Nothing to convert yet"
                    body={
                      input === 'upload-svg' ? (
                        <>
                          Upload an SVG — its paths convert straight to 3D.
                          <br />
                          (If nothing appears, the SVG had no usable vector shapes.)
                        </>
                      ) : input === 'upload-image' ? (
                        <>
                          Pick a photo — it’s traced to a clean sketch, then that
                          converts to 3D like any drawing.
                          <br />
                          (Switch to 2D to pick the image first.)
                        </>
                      ) : (
                        <>Draw strokes in 2D first — then flip back to 3D.</>
                      )
                    }
                  />
                )}
                {strokePoints.length > MAX_STROKES_3D && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 10,
                      left: 10,
                      fontFamily: IS,
                      fontSize: 10,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: 'var(--dir-text-body-soft)',
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: 'var(--dir-raised)',
                      border: '1px solid var(--dir-border)',
                    }}
                  >
                    First {MAX_STROKES_3D} of {strokePoints.length} strokes shown
                  </span>
                )}
              </div>
            )}
          </div>
        </main>
        {/* Right chrome — THE ROUND-7 SPLIT (3d-mode-controls-spec §0.1, locked):
            2D mode → the 2D SVG chrome; 3D mode → 3D controls ONLY. The 2D
            chrome reappears in 3D solely under Canvas3DChrome's SVG-port
            style, where it drives the ported treatment. */}
        <CollapsiblePanel
          side="right"
          open={rightOpen}
          width={360}
          id="canvas-right-panel"
          style={{
            borderLeft: '1px solid var(--dir-border)',
            background: 'var(--dir-raised)',
            overflowY: 'auto',
          }}
        >
          {mode === '3d' ? <Canvas3DChrome /> : <SmartHachureChrome />}
        </CollapsiblePanel>
      </div>

      {/* svg-port 3D offscreen render — the REAL SvgStyleTransform on the
          current strokes, sized to the viewBox so getBBox resolves (NOT
          display:none, which would zero it). Its onRender hands the scene the
          serialized styled <svg> to wear. Mounted only while svg-port 3D is
          active. */}
      {svgPortActive && svgPortSource && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: -99999,
            top: 0,
            width: 800,
            height: 600,
            opacity: 0,
            pointerEvents: 'none',
          }}
        >
          <SvgStyleTransform
            wrapperOverride={{ display: 'block', width: '100%', height: '100%' }}
            onRender={setSvgPortMarkup}
          >
            <div
              style={{ width: '100%', height: '100%' }}
              dangerouslySetInnerHTML={{ __html: svgPortSource }}
            />
          </SvgStyleTransform>
        </div>
      )}
    </div>
  );
}
