import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { IS } from '../../lib/typography';
import { PILL, CTA, SECTION_LABEL, RAISED_SHADOW } from '../../lib/chromeStyles';
import { ObjectCard } from './ObjectCard';
import { Slider } from '../chrome/Slider';
import { Dropdown } from '../chrome/Dropdown';
import {
  SLIDER_SPECS,
  MODIFIER_SETS_BY_STYLE,
  UNIVERSAL_MODIFIERS,
} from '../chrome/modifierSpecs';
import {
  F3SvgStyleProvider,
  useF3SvgStyle,
  F3_SVG_STYLES,
  type F3SvgStyle,
} from '../../state/F3SvgStyleContext';
import {
  F3RoughModifiersProvider,
  useF3RoughModifiers,
  type F3ModifiersState,
  MULTI_STROKE_STEPS, type MultiStrokeStep,
  FILL_STYLE_STEPS, type FillStyleStep,
  PALETTE_MODE_STEPS, type PaletteModeStep,
  TEXTURE_STEPS, type TextureStep,
  DOT_PATTERN_STEPS, type DotPatternStep,
  ENDPOINT_BEHAVIOR_STEPS, type EndpointBehaviorStep,
  SKETCHING_STYLE_STEPS, type SketchingStyleStep,
  PEN_TIP_STEPS, type PenTipStep,
  DEFAULT_MODIFIERS,
} from '../../state/F3RoughModifiersContext';
import { applyStylePreset, SvgStyleTransform } from '../canvas/SvgStyleTransform';
import { smartPickFromMarkup, logSmartPickOverridden, type SmartPickResult } from '../../lib/smart/smartPick';
import { findDoodleBySvg, updateDoodleConfig, updateDoodleSvg } from '../../lib/publish';
import {
  DrawSurface,
  strokesToObjectMarkup,
  capStrokes,
  capToneFills,
  fitStrokesToFrame,
  prepareBackdrop,
  composeBackdropAndStrokes,
  VIEWBOX_W,
  VIEWBOX_H,
  SHADE_TOOL_DEFAULT,
  type Stroke,
  type StrokePoint,
  type ToneFill,
  type ShadeToolState,
  type ShapeSnapApi,
  type BackdropFrame,
} from './DrawSurface';
import { DrawToolbar } from './DrawToolbar';
import { type ShapeCandidate, type ShapeFitResult, type SnapAction } from '../../lib/draw/shapeFit';
import { SwitchPopover } from './SwitchPopover';
import { ShapeStrip } from './ShapeStrip';
import { buildSwitchSet, type ShapeOverride, type SwitchEntry } from '../../lib/draw/switchSet';
import { generateShape } from '../../lib/draw/shapeLibrary';
import { pushShapeSnapEntry, type ShapeSnapOutcome } from '../../lib/shapeSnapLog';
import { COVERAGE_BANDS } from '../../lib/smart/coverage';
import { normalizeSvgSize } from '../../lib/normalizeInput';
// Save-routing parity (2026-06-21): the owner-edit context offers the same
// "Also save to: Drawer / Shelf" extra-copy the /desk DrawPanel place flow has.
import { stashToDrawer, shareToShelf } from '../../lib/personalSpace';
import { exportDoodleSvg, exportPokemonCardPng, rasterizeMarkupPng, type CardMeta } from '../../lib/exportCard';
import { runMesh, isHardPathEnabled } from '../../lib/hardPath';
import { DeskObject3DMount, Live3DMount } from './DeskObject3DMount';
import { type Geometry3DConfig } from '../../lib/geometry3d/deskRenderMode';
import { svgMarkupToStrokes } from '../../lib/svgToStrokes';
import { svgToParts } from '../../lib/svgToParts';
import { Canvas3DProvider, useCanvas3D } from '../../state/Canvas3DContext';
import { Canvas3DChrome } from '../chrome/Canvas3DChrome';

// ─── ObjectSurface — the one morphing object panel (modes, never nested) ──────
// Per docs/design/object-model-and-desk-architecture.md §"The one object
// surface": ONE component, mode driven by context. Create lives in DrawPanel;
// this is the INSPECT side — click your own object → Edit; click someone
// else's → Sandbox. DeskPage holds a single activeSurface slot so this and
// DrawPanel can never both be open (nesting is structurally impossible).
//
// FULL CONTROL COLUMN (Sebs 2026-06-11, more-toggles-better): both modes show
// the per-style FULL control set — the same spec tables the desk chrome reads
// (MODIFIER_SETS_BY_STYLE + UNIVERSAL_MODIFIERS + SLIDER_SPECS), rendered
// generically like SmartHachureChrome but compact. SmartHachureChrome.tsx is
// the conditional-truth source — its has()/sub-conditional structure is
// mirrored 1:1 in SurfaceControls below; if the chrome gains/changes a row,
// mirror it there AND here.
//
// SCOPED LIVE RESTYLE (both modes): the embedded ObjectCard renders its art
// through SvgStyleTransform, which reads style + modifiers from context. We
// wrap JUST the card in fresh nested F3SvgStyleProvider/F3RoughModifiers-
// Provider instances — the nested providers shadow the app-root ones for the
// card subtree ONLY, so the card re-renders through the IDENTICAL desk render
// path with local values while the desk behind keeps reading the untouched
// global context (it cannot restyle).
//   · SANDBOX (someone else's): viewer config — play, nothing saves, close
//     discards. Local control state dies on unmount.
//   · EDIT (yours): initialized from the OBJECT's render_config (D-6 record;
//     pen fallback for legacy null-config rows); Done persists the edited
//     config onto the record via update_my_doodle_config (schema-v4).

export type ObjectSurfaceMode = 'edit' | 'sandbox';

/** The shape persisted in doodles.render_config (D-6) — mirrors DeskPage's
 *  ObjectRenderConfig (defined there; not imported to avoid a module cycle:
 *  DeskPage already imports ObjectSurface). */
export type SurfaceRenderConfig = {
  svgStyle: F3SvgStyle;
  modifiers: F3ModifiersState;
  /** Extras (e.g. `strokes` — the recorded gesture) pass through every hop
   *  UNTOUCHED (strokes-in-the-record contract): a config save that rebuilt
   *  only {svgStyle, modifiers} would silently destroy the source strokes. */
  [extra: string]: unknown;
};

export type ObjectSurfaceData = {
  svgMarkup: string;
  name?: string | null;
  why?: string | null;
  /** Optional author "by ___" (card features). Usually arrives inside
   *  renderConfig (an extra key); this top-level field lets a caller that
   *  already has it pass it directly. */
  author?: string | null;
  owner?: string | null;
  createdAt?: string | null;
  /** Supabase row id. Optional — when the caller doesn't pass it (DeskPage
   *  today), Edit resolves it itself via findDoodleBySvg (content-hash). */
  id?: string | null;
  /** The object's stored render_config (raw jsonb). Optional — same fallback:
   *  resolved from the row when absent. Parsed defensively either way. */
  renderConfig?: unknown;
};

// ─── render_config parsing (defensive — the column is anon-writable) ─────────
// Local mirror of DeskPage.parseRenderConfig (same key-by-key validation:
// style must be a real F3SvgStyle; numbers must be finite; enum strings are
// checked against their step lists; unknown keys fall back to defaults).

const MODIFIER_ENUMS: Partial<Record<keyof F3ModifiersState, readonly string[]>> = {
  multiStroke: MULTI_STROKE_STEPS,
  fillStyle: FILL_STYLE_STEPS,
  strokePalette: PALETTE_MODE_STEPS,
  fillPalette: PALETTE_MODE_STEPS,
  risoSecondaryColor: PALETTE_MODE_STEPS,
  texture: TEXTURE_STEPS,
  dotPattern: DOT_PATTERN_STEPS,
  endpointBehavior: ENDPOINT_BEHAVIOR_STEPS,
  sketchingStyle: SKETCHING_STYLE_STEPS,
  penTip: PEN_TIP_STEPS,
};

function parseSurfaceConfig(raw: unknown): SurfaceRenderConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const style = rec.svgStyle;
  if (typeof style !== 'string' || !F3_SVG_STYLES.some((s) => s.id === style)) {
    return null;
  }
  const modifiers: F3ModifiersState = { ...DEFAULT_MODIFIERS };
  const rawMods = rec.modifiers;
  if (rawMods && typeof rawMods === 'object') {
    for (const key of Object.keys(DEFAULT_MODIFIERS) as (keyof F3ModifiersState)[]) {
      const v = (rawMods as Record<string, unknown>)[key];
      if (v == null || typeof v !== typeof DEFAULT_MODIFIERS[key]) continue;
      if (typeof v === 'number' && !Number.isFinite(v)) continue;
      const allowed = MODIFIER_ENUMS[key];
      if (typeof v === 'string' && allowed && !allowed.includes(v)) continue;
      (modifiers as Record<string, unknown>)[key] = v;
    }
  }
  // Spread-then-override: extras (strokes etc.) ride through untouched.
  return { ...rec, svgStyle: style as F3SvgStyle, modifiers };
}

/** Sync bridge between ObjectSurface's plain local state and the NESTED
 *  providers wrapping the card. It runs inside the nested scope, so
 *  setState/replace here touch only the card's shadowed context — never the
 *  global one. useLayoutEffect so the sync lands before paint (no flash of
 *  provider-default style on open). The `state !== mods` guard makes the
 *  replace() settle in one pass (replace stores the same object reference,
 *  so the re-run after the state change is a no-op). */
function SurfaceRenderScope({
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

// ─── SurfaceControls — the FULL per-style control set, compact ───────────────
// Generic render off the SAME spec tables the desk chrome uses. Structure +
// every sub-conditional mirrors SmartHachureChrome.tsx (the source of truth
// for which control shows when); only the layout is compact (mini headers,
// no collapsible clusters — the column scrolls instead). Per
// feedback_more_toggles_better: full ranges, full steps, nothing trimmed.

type NumericModKey = keyof typeof SLIDER_SPECS & keyof F3ModifiersState;

const MINI_HEADER: CSSProperties = {
  ...SECTION_LABEL,
  marginTop: 6,
  paddingTop: 10,
  borderTop: '1px solid var(--dir-border)',
};

export function SurfaceControls({
  svgStyle,
  mods,
  onStyle,
  onMod,
  onReset,
  onSmart,
  smartActive,
}: {
  svgStyle: F3SvgStyle;
  mods: F3ModifiersState;
  onStyle: (s: F3SvgStyle) => void;
  onMod: <K extends keyof F3ModifiersState>(key: K, value: F3ModifiersState[K]) => void;
  onReset: () => void;
  /** "Smart" one-tap auto-style: the host analyzes this doodle and sets style +
   *  fillStyle + sliders to a tasteful config (routes through the same apply path as a
   *  manual change, so the dropdowns reflect it + stay overridable — I-1). Returns
   *  'abstained' when the engine had no confident pick (honest — pen left alone) so the
   *  pill can acknowledge it instead of a silent no-op; 'applied' / void otherwise.
   *  Omitted ⇒ pill hidden. */
  onSmart?: () => 'applied' | 'abstained' | void;
  smartActive?: boolean;
}) {
  // Transient acknowledgment when Smart ABSTAINS (no confident pick): a tap that
  // changes nothing would read as broken, so the pill clearly says it looked and
  // found nothing to change — honest (abstain = no confident pick, NOT an
  // endorsement of the current style) and legible (filled chip, held ~2s so it
  // reads). Same flash on both surfaces via this shared component.
  const [smartFlash, setSmartFlash] = useState(false);
  const smartFlashTimer = useRef<number | null>(null);
  useEffect(() => () => { if (smartFlashTimer.current) window.clearTimeout(smartFlashTimer.current); }, []);
  const handleSmartClick = () => {
    const outcome = onSmart?.();
    if (outcome === 'abstained') {
      setSmartFlash(true);
      if (smartFlashTimer.current) window.clearTimeout(smartFlashTimer.current);
      smartFlashTimer.current = window.setTimeout(() => setSmartFlash(false), 2000);
    } else if (smartFlash) {
      setSmartFlash(false);
    }
  };
  const declared = MODIFIER_SETS_BY_STYLE[svgStyle] ?? UNIVERSAL_MODIFIERS;
  const has = (k: string) => declared.includes(k);

  // Compact numeric row — same SLIDER_SPECS min/max/step as the desk chrome.
  const num = (
    key: NumericModKey,
    label: string,
    opts: { unit?: string; title?: string } = {},
  ) => (
    <Slider
      key={key}
      label={label}
      value={mods[key] as number}
      min={SLIDER_SPECS[key].min}
      max={SLIDER_SPECS[key].max}
      step={SLIDER_SPECS[key].step}
      unit={opts.unit}
      title={opts.title}
      onChange={(v) => onMod(key, v as F3ModifiersState[NumericModKey])}
    />
  );

  // Cluster presence — same grouping logic as the chrome (I-13 clusters).
  const hasStrokeBlock =
    has('wobble') || has('jaggedness') || has('simplification') ||
    has('bowing') || has('strokeWidth') ||
    has('curveDamp') || has('multiStroke') || has('endpointBehavior') ||
    has('sketchingStyle') || has('penTip');
  const hasShadingBlock =
    has('fillStyle') || has('hachureGap') || has('hachureAngle') || has('fillDensity');
  const hasSurfaceBlock =
    has('blurAmount') || has('bleed') || has('dotSize') || has('dotSpacing') ||
    has('dotScatter') || has('dotPattern') || has('grainIntensity') || has('smudgeAmount') ||
    has('pressureVariance') || has('offsetDistance') || has('offsetAngle') ||
    has('colorShift') || has('registrationError');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* SMART — one tap auto-styles the whole doodle (style + fillStyle + sliders);
          the dropdowns below update to show exactly what it chose, fully overridable. */}
      {onSmart && (
        <button
          type="button"
          onClick={handleSmartClick}
          title={
            smartFlash
              ? 'Smart looked at this doodle and found no confident change to make — your style is unchanged.'
              : 'Smart — auto-style the whole doodle (you can still tweak everything below)'
          }
          aria-pressed={!!smartActive}
          aria-live="polite"
          style={{
            ...PILL,
            width: '100%',
            justifyContent: 'center',
            padding: '8px 12px',
            fontWeight: 600,
            cursor: 'pointer',
            // Three distinct states: 'on' = applied (dark fill); 'flash' = abstained
            // ack (filled tint + dark readable text, clearly says nothing changed —
            // visible but NOT the dark applied look); resting = the affordance.
            border: smartActive
              ? '1px solid var(--dir-text-primary)'
              : smartFlash
                ? '1px solid var(--dir-text-primary)'
                : (PILL.border as string),
            background: smartActive
              ? 'var(--dir-text-primary)'
              : smartFlash
                ? 'var(--dir-border)'
                : (PILL.background as string),
            color: smartActive ? 'var(--dir-bg)' : smartFlash ? 'var(--dir-text-primary)' : 'var(--dir-text-body)',
            transition: 'color 0.18s ease, background-color 0.18s ease, border-color 0.18s ease',
          }}
        >
          ✦ Smart{smartActive ? ' · on' : smartFlash ? ' · looked — nothing to change' : ' — auto-style everything'}
        </button>
      )}
      {/* STYLE — always visible (the master pick). */}
      <Dropdown
        label="SVG style"
        value={svgStyle}
        sections={[{
          heading: 'SVG render style',
          options: F3_SVG_STYLES.map((s) => ({ value: s.id, label: s.label, detail: s.detail })),
        }]}
        onChange={(v) => onStyle(v as F3SvgStyle)}
        popoverWidth={360}
      />

      {/* MULTI-STROKE — Cluster 1 per I-13 */}
      {hasStrokeBlock && (
        <>
          <div style={MINI_HEADER}>Multi-stroke</div>
          {has('multiStroke') && (
            <Dropdown
              label="Multi-stroke"
              value={mods.multiStroke}
              sections={[{
                heading: 'Multi-stroke',
                options: MULTI_STROKE_STEPS.map((s) => ({ value: s, label: s })),
              }]}
              onChange={(v) => onMod('multiStroke', v as MultiStrokeStep)}
              popoverWidth={220}
            />
          )}
          {has('endpointBehavior') && (
            <Dropdown
              label="Endpoint"
              value={mods.endpointBehavior}
              sections={[{
                heading: 'Endpoint behavior (playground)',
                options: ENDPOINT_BEHAVIOR_STEPS.map((s) => ({
                  value: s, label: s,
                  detail: s === 'clean' ? 'Sharp corners at vertices'
                    : s === 'protrude' ? 'Slight overshoot at corners'
                    : s === 'long-overshoot' ? 'Heavy overshoot — sketchbook look'
                    : 'Kinked corners (random angle)',
                })),
              }]}
              onChange={(v) => onMod('endpointBehavior', v as EndpointBehaviorStep)}
              popoverWidth={320}
            />
          )}
          {has('sketchingStyle') && mods.multiStroke !== 'off' && mods.multiStroke !== 'single' && (
            <Dropdown
              label="Sketching style"
              value={mods.sketchingStyle}
              sections={[{
                heading: 'Layered-stroke pacing (playground)',
                options: SKETCHING_STYLE_STEPS.map((s) => ({
                  value: s, label: s,
                  detail: s === 'single-pass' ? 'Layers stack on same path'
                    : s === 'loose-overlap' ? 'Layers offset along segment'
                    : s === 'parallel-pass' ? 'Concentric outward layers'
                    : 'Crisscross rotation per layer',
                })),
              }]}
              onChange={(v) => onMod('sketchingStyle', v as SketchingStyleStep)}
              popoverWidth={340}
            />
          )}
          {has('penTip') && (
            <Dropdown
              label="Pen tip"
              value={mods.penTip}
              sections={[{
                heading: 'Pen-tip preset (perfect-freehand)',
                options: PEN_TIP_STEPS.map((s) => ({
                  value: s,
                  label: s,
                  detail:
                    s === 'plain' ? 'Plain stroke — uniform width, no taper'
                    : s === 'ballpoint' ? 'Clean uniform stroke, slight endpoint thinning'
                    : s === 'fineliner' ? 'Thin uniform stroke, hard caps'
                    : s === 'pencil-hb' ? 'Mild width variation, light grain'
                    : s === 'pencil-2b' ? 'Stronger width variation, heavier grain'
                    : s === 'felt-tip' ? 'Thicker uniform stroke, soft caps'
                    : s === 'chisel' ? 'Strong width variation, calligraphic'
                    : 'Heavy variable width, edge-jittered grain',
                })),
              }]}
              onChange={(v) => onMod('penTip', v as PenTipStep)}
              popoverWidth={360}
            />
          )}
          {has('wobble') &&
            num('wobble', mods.wobble > 1.4 ? 'Wobble ⚠ Excalidraw zone' : 'Wobble')}
          {has('jaggedness') && num('jaggedness', 'Jaggedness')}
          {has('simplification') &&
            num('simplification', 'Simplify', {
              title:
                "Geometry fidelity on drawn/uploaded paths: low = faithful (keeps every wiggle), high = essential (smooths to clean lines). 1.0 = today's baseline.",
            })}
          {has('bowing') && num('bowing', 'Bowing')}
          {has('strokeWidth') && num('strokeWidth', 'Stroke width')}
          {has('curveDamp') &&
            num('curveDamp', 'Curve', {
              title: 'Above ~0.8 straightens curves enough that Bowing reads as off (spec §6.7)',
            })}
        </>
      )}

      {/* SHADING — Cluster 3 per I-13 */}
      {hasShadingBlock && (
        <>
          <div style={MINI_HEADER}>Shading</div>
          {has('fillStyle') && (
            <Dropdown
              label="Fill style"
              value={mods.fillStyle}
              sections={[{
                heading: 'Fill style',
                options: FILL_STYLE_STEPS.map((s) => ({ value: s, label: s })),
              }]}
              onChange={(v) => onMod('fillStyle', v as FillStyleStep)}
              popoverWidth={240}
            />
          )}
          {has('hachureGap') && (mods.fillStyle === 'hachure' || mods.fillStyle === 'cross-hatch' || mods.fillStyle === 'zigzag-line' || mods.fillStyle === 'zigzag' || mods.fillStyle === 'dashed') &&
            num('hachureGap', 'Hachure gap', { unit: 'px' })}
          {has('hachureAngle') && (mods.fillStyle === 'hachure' || mods.fillStyle === 'cross-hatch' || mods.fillStyle === 'dashed' || mods.fillStyle === 'zigzag-line') &&
            num('hachureAngle', 'Hachure angle', { unit: '°' })}
          {has('fillDensity') && mods.fillStyle !== 'none' && num('fillDensity', 'Fill density')}
        </>
      )}

      {/* SURFACE TEXTURE — Cluster 4 per I-13 */}
      {hasSurfaceBlock && (
        <>
          <div style={MINI_HEADER}>Surface texture</div>
          {has('blurAmount') && num('blurAmount', 'Blur amount')}
          {has('bleed') && num('bleed', 'Bleed')}
          {has('dotSize') && num('dotSize', 'Dot size')}
          {has('dotSpacing') && num('dotSpacing', 'Dot spacing', { unit: 'px' })}
          {has('dotScatter') && num('dotScatter', 'Dot scatter')}
          {has('dotPattern') && (
            <Dropdown
              label="Dot pattern"
              value={mods.dotPattern}
              sections={[{ heading: 'Dot pattern', options: DOT_PATTERN_STEPS.map((s) => ({ value: s, label: s })) }]}
              onChange={(v) => onMod('dotPattern', v as DotPatternStep)}
              popoverWidth={220}
            />
          )}
          {has('grainIntensity') && num('grainIntensity', 'Grain')}
          {has('smudgeAmount') && num('smudgeAmount', 'Smudge')}
          {has('pressureVariance') && num('pressureVariance', 'Pressure variance')}
          {has('offsetDistance') && num('offsetDistance', 'Offset distance', { unit: 'px' })}
          {has('offsetAngle') && num('offsetAngle', 'Offset angle', { unit: '°' })}
          {has('colorShift') && num('colorShift', 'Color shift')}
          {has('risoSecondaryColor') && (
            <Dropdown
              label="Riso secondary color"
              value={mods.risoSecondaryColor}
              sections={[{
                heading: 'Risograph secondary-layer color',
                options: PALETTE_MODE_STEPS.map((s) => ({
                  value: s, label: s,
                  detail: s === 'source' ? 'Falls back to accent' : `Renders in var(--dir-${s === 'neutral' ? 'text-body' : s})`,
                })),
              }]}
              onChange={(v) => onMod('risoSecondaryColor', v as PaletteModeStep)}
              popoverWidth={340}
            />
          )}
          {has('registrationError') && num('registrationError', 'Registration error')}
        </>
      )}

      {/* COLOR / PALETTE — Cluster 5 per I-13 (universal — always present) */}
      <div style={MINI_HEADER}>Color / palette</div>
      {has('inkIntensity') && num('inkIntensity', 'Ink intensity')}
      {has('fillOpacity') && num('fillOpacity', 'Fill opacity')}
      {has('strokePalette') && (
        <>
          <Dropdown
            label="Stroke palette"
            value={mods.strokePalette}
            sections={[{
              heading: 'Stroke (outline) color',
              options: PALETTE_MODE_STEPS.map((s) => ({
                value: s, label: s,
                detail: s === 'source' ? 'Use the SVG source colors (default)' : `Override ALL strokes to var(--dir-${s === 'neutral' ? 'text-body' : s})`,
              })),
            }]}
            onChange={(v) => onMod('strokePalette', v as PaletteModeStep)}
            popoverWidth={320}
          />
          <Dropdown
            label="Fill palette"
            value={mods.fillPalette}
            sections={[{
              heading: 'Fill color',
              options: PALETTE_MODE_STEPS.map((s) => ({
                value: s, label: s,
                detail: s === 'source' ? 'Use the SVG source fills (default)' : `Override ALL fills to var(--dir-${s === 'neutral' ? 'text-body-soft' : s})`,
              })),
            }]}
            onChange={(v) => onMod('fillPalette', v as PaletteModeStep)}
            popoverWidth={320}
          />
        </>
      )}
      {has('texture') && svgStyle !== 'wet-ink' && svgStyle !== 'charcoal' && (
        <Dropdown
          label="Texture"
          value={mods.texture}
          sections={[{ heading: 'Texture', options: TEXTURE_STEPS.map((s) => ({ value: s, label: s })) }]}
          onChange={(v) => onMod('texture', v as TextureStep)}
          popoverWidth={260}
        />
      )}
      {has('textureIntensity') && (mods.texture !== 'none' || svgStyle === 'wet-ink' || svgStyle === 'charcoal') &&
        num('textureIntensity', 'Texture intensity')}

      {/* Reset — same semantics as the chrome: DEFAULT baseline + style preset. */}
      <button
        onClick={onReset}
        title={`Reset controls to the ${svgStyle} style preset`}
        style={{ ...PILL, width: '100%', marginTop: 6, padding: '8px 14px', background: 'var(--dir-bg)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--dir-raised)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--dir-bg)')}
      >
        Reset to {svgStyle} preset
      </button>
    </div>
  );
}

/** One row in the Export ▾ menu — bold label + format sublabel, hover tint. */
function ExportMenuItem({
  label,
  sub,
  busy,
  onClick,
}: {
  label: string;
  sub: string;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={busy}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 1,
        width: '100%',
        textAlign: 'left',
        padding: '7px 10px',
        borderRadius: 8,
        border: 'none',
        background: 'transparent',
        cursor: busy ? 'default' : 'pointer',
        fontFamily: IS,
        color: 'var(--dir-text-primary)',
        opacity: busy ? 0.6 : 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--dir-bg)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ fontSize: 13 }}>{busy ? 'Saving…' : label}</span>
      <span style={{ fontSize: 10, color: 'var(--dir-text-body-soft)' }}>{sub}</span>
    </button>
  );
}

/** Tiny effect bridge: ObjectSurface holds hardMeshUrl OUTSIDE the
 *  Canvas3DProvider, so this child (rendered INSIDE it) mirrors "a mesh exists"
 *  into the 3D context → the chrome's AI-mesh material toggle only appears after
 *  the user generates the mesh (Sebs 2026-06-16), not always. */
function AiMeshActiveSync({ active }: { active: boolean }) {
  const { setAiMeshActive } = useCanvas3D();
  useEffect(() => {
    setAiMeshActive(active);
  }, [active, setAiMeshActive]);
  return null;
}

/** Reports up to ObjectSurface whether the active 3D SURFACE is the engraving
 *  (svg-port) — for a mesh shown as itself, or a stroke form. The engraving is
 *  the object's DRAWING carved in, so its controls = the 2D Restyle set (which
 *  drives svgPortStyled live). ObjectSurface mounts those under the 3D chrome when
 *  this is true (Sebs 2026-06-27: "i click svg port and no toggles appear"). */
function EngraveStyleSync({ onChange }: { onChange: (active: boolean) => void }) {
  const { style3d, geometryMode, aiMeshMaterialMode, aiMeshActive } = useCanvas3D();
  const meshShown = aiMeshActive && (geometryMode === 'ai-mesh' || geometryMode === 'auto');
  const active = meshShown ? aiMeshMaterialMode === 'svg-port' : style3d === 'svg-port';
  useEffect(() => { onChange(active); }, [active, onChange]);
  return null;
}

type AiMeshLook = { materialMode: 'greyscale' | 'og-pbr' | 'hatch' | 'native' | 'svg-port'; dark: number; contrast: number; autoSpin: boolean };

/** Bridges the AI-mesh look (Material/Darkness/Auto-spin) between the object's
 *  saved render_config and the shared 3D context (Sebs 2026-06-16: "the ai-mesh
 *  toggles don't save / don't show on the desk"). Runs INSIDE the modal's
 *  Canvas3DProvider: (1) seeds the context from the saved look once on open so the
 *  controls + preview reflect it; (2) mirrors the live look into a ref the body's
 *  handleDone reads to persist render_config.aiMesh; (3) flags the config dirty on
 *  any post-seed change so Save fires even when ONLY a mesh toggle moved. */
function AiMeshLookSync({
  initial,
  lookRef,
  onDirty,
}: {
  initial?: Partial<AiMeshLook>;
  lookRef: { current: AiMeshLook | null };
  onDirty: () => void;
}) {
  const { aiMeshMaterialMode, setAiMeshMaterialMode, aiMeshDark, setAiMeshDark, aiMeshContrast, setAiMeshContrast, aiMeshAutoSpin, setAiMeshAutoSpin } = useCanvas3D();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (!initial) return;
    if (initial.materialMode) setAiMeshMaterialMode(initial.materialMode);
    if (typeof initial.dark === 'number') setAiMeshDark(initial.dark);
    if (typeof initial.contrast === 'number') setAiMeshContrast(initial.contrast);
    if (typeof initial.autoSpin === 'boolean') setAiMeshAutoSpin(initial.autoSpin);
  }, [initial, setAiMeshMaterialMode, setAiMeshDark, setAiMeshContrast, setAiMeshAutoSpin]);
  // Mirror current → ref every render (read at Save).
  lookRef.current = { materialMode: aiMeshMaterialMode, dark: aiMeshDark, contrast: aiMeshContrast, autoSpin: aiMeshAutoSpin };
  // Flag dirty on a post-seed change (so a toggle-only edit still saves).
  const prev = useRef<string>('');
  const cur = `${aiMeshMaterialMode}|${aiMeshDark}|${aiMeshContrast}|${aiMeshAutoSpin}`;
  useEffect(() => {
    if (!seeded.current) return;
    if (prev.current && prev.current !== cur) onDirty();
    prev.current = cur;
  }, [cur, onDirty]);
  return null;
}

/** Same bridge for the LOCAL 3D look (geometry mode / style / material / native
 *  dials / hatch / per-mode params) — so a NORMAL (non-AI-mesh) 3D object saves
 *  its look and the desk/drawer render it per-object (Sebs 2026-06-16: "3d edits
 *  don't appear for normal 3d objects"). Seeds the context from the saved
 *  geometry3d on open (so reopening shows the saved look, never clobbers it with
 *  defaults), mirrors the live look into a ref for handleDone, flags dirty on a
 *  post-seed change. */
function Geometry3DSync({
  initial,
  lookRef,
  onDirty,
}: {
  initial?: Geometry3DConfig;
  lookRef: { current: Geometry3DConfig | null };
  onDirty: () => void;
}) {
  const c = useCanvas3D();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (!initial) return;
    if (initial.geometryMode) c.setGeometryMode(initial.geometryMode);
    if (initial.style3d) c.setStyle3d(initial.style3d);
    if (initial.materialPreset) c.setMaterialPreset(initial.materialPreset);
    if (initial.nativeProps) c.setNativeProps(initial.nativeProps);
    if (initial.hatchGrammar) c.setHatchGrammar(initial.hatchGrammar);
    if (initial.hatchDirection) c.setHatchDirection(initial.hatchDirection);
    if (initial.modeParams) {
      if (initial.modeParams.rod) c.setRodParams(initial.modeParams.rod);
      if (initial.modeParams.extrude) c.setExtrudeParams(initial.modeParams.extrude);
      if (initial.modeParams.inflate) c.setInflateParams(initial.modeParams.inflate);
      if (initial.modeParams.solid) c.setSolidParams(initial.modeParams.solid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  lookRef.current = {
    geometryMode: c.geometryMode,
    style3d: c.style3d,
    materialPreset: c.materialPreset,
    nativeProps: c.nativeProps,
    hatchGrammar: c.hatchGrammar,
    hatchDirection: c.hatchDirection,
    modeParams: c.modeParams,
  };
  const prev = useRef<string>('');
  const cur = `${c.geometryMode}|${c.style3d}|${c.materialPreset}|${JSON.stringify(c.nativeProps)}|${c.hatchGrammar}|${c.hatchDirection}|${JSON.stringify(c.modeParams)}`;
  useEffect(() => {
    if (!seeded.current) return;
    if (prev.current && prev.current !== cur) onDirty();
    prev.current = cur;
  }, [cur, onDirty]);
  return null;
}

export function ObjectSurface({
  mode,
  object,
  onClose,
  onDelete,
  onObjectUpdate,
  onSave,
  onConfigSave,
  rightInset = 0,
  leftInset = 0,
  onOwnerClick,
  allowDrawer = false,
  origin,
}: {
  mode: ObjectSurfaceMode;
  object: ObjectSurfaceData;
  onClose: () => void;
  /** Edit mode only — delete this (your own) object. */
  onDelete?: () => void;
  /** Edit mode only — persist the edited name/why (called on Done). */
  onSave?: (name: string | null, why: string | null) => void;
  /** Edit mode only (Re-draw) — hands the regenerated svg + config back so
   *  the desk object updates in place (persistence runs in the surface). */
  onObjectUpdate?: (svgMarkup: string, config: SurfaceRenderConfig) => void;
  /** Edit mode only — the optimistic local config update at Done: lets the
   *  caller (DeskPage) re-pin the desk object to the edited config without a
   *  reload. Fired BEFORE the persist resolves, and regardless of its result
   *  (the popup's note covers the not-persisted case honestly). */
  onConfigSave?: (config: SurfaceRenderConfig) => void;
  /** px width of the desk's open right controls panel. The scrim reserves this
   *  much padding on the right so the modal centers over the DESK working area,
   *  not behind the open panel. 0 (default) = center over the raw viewport. */
  rightInset?: number;
  /** px width of the desk's open LEFT drawer — rightInset's mirror (UX-audit
   *  fix 4): the scrim reserves the drawer's width on the left so the modal
   *  centers over the VISIBLE desk. Same narrow-viewport clamp. Default 0. */
  leftInset?: number;
  /** When set, the owner footer label becomes a button → that maker's public
   *  shelf (only passed for OTHER people's objects). */
  onOwnerClick?: () => void;
  /** Owner-edit context only (your own object on your own desk + personal space
   *  ready): offer the SAME "Also save to: Drawer / Shelf" extra-copy multi-select
   *  the /desk DrawPanel place flow has (save-routing parity). Off everywhere else
   *  (public desk, sandbox, drawer-edit — where a drawer copy would be redundant). */
  allowDrawer?: boolean;
  /** FOCUS-MODE LIFT: the screen point the user tapped (the doodle's spot). The
   *  card scales+translates FROM here on open and back on close, so editing reads
   *  as focusing on the doodle in place, not a box appearing at center. Omitted
   *  (e.g. back-nav / 3D-tap) → a plain center scale. */
  origin?: { x: number; y: number };
}) {
  const isSandbox = mode === 'sandbox';
  // Local editable copy of name/why for Edit mode.
  const [name, setName] = useState(object.name ?? '');
  const [why, setWhy] = useState(object.why ?? '');

  // ── Baseline — what the controls OPEN at, and what divergence is measured
  // against. Priority: the object's own render_config (prop, then row lookup
  // below) → the global pen values (legacy null-config rows; also the first
  // paint while a lookup is in flight). Reading the global context here is
  // read-only — this surface never writes back to it.
  const globalStyleCtx = useF3SvgStyle();
  const globalModsCtx = useF3RoughModifiers();
  const propConfig = useMemo(
    () => parseSurfaceConfig(object.renderConfig),
    [object.renderConfig],
  );
  const [baseline, setBaseline] = useState<SurfaceRenderConfig>(() =>
    propConfig ?? { svgStyle: globalStyleCtx.state, modifiers: globalModsCtx.state },
  );

  // Surface-local control state — plain useState, scoped to this popup.
  // Unmount (close) discards everything; reopen re-derives the baseline.
  const [surfStyle, setSurfStyle] = useState<F3SvgStyle>(baseline.svgStyle);
  const [surfMods, setSurfMods] = useState<F3ModifiersState>(baseline.modifiers);
  // Lit while the Smart auto-style is the live config; any manual move clears it.
  const [smartOn, setSmartOn] = useState(false);
  // Last applied Smart pick — kept so a manual move AFTER it logs the
  // 'overridden' correction signal (parity with DrawPanel; feeds the ML
  // dataset per feedback_keep_feeding_smart_ml). Null = nothing to override.
  const lastSmartResultRef = useRef<SmartPickResult | null>(null);
  /** Drop the live-Smart truth. If the user is moving a control while a Smart
   *  pick is still active, that's an 'overridden' correction — log it once. */
  const clearSmartPick = () => {
    if (lastSmartResultRef.current) {
      logSmartPickOverridden(lastSmartResultRef.current);
      lastSmartResultRef.current = null;
    }
    setSmartOn(false);
  };
  // True once the user touched any control — gates the async baseline swap
  // (never clobber in-progress play) and Edit's Done persist (untouched
  // controls keep the exact legacy name/why-only Done behavior).
  const dirtyRef = useRef(false);
  const [, forceDirtyPaint] = useState(false);

  // Optional author "by ___" (card features, Sebs 2026-06-13). The author rides
  // INSIDE render_config (an extra key the parser preserves untouched), so it
  // persists through the EXISTING config-save writer (updateDoodleConfig) — no
  // new column, no new RPC, no live DB writer invented. Seeded from the caller's
  // field if present, else the stored config's author key; re-seeded by the
  // async row lookup below (only while the author input is untouched).
  const configAuthor = (cfg: SurfaceRenderConfig | null | undefined): string => {
    const a = (cfg as Record<string, unknown> | null | undefined)?.author;
    return typeof a === 'string' ? a : '';
  };
  const [author, setAuthor] = useState<string>(
    () => (object.author ?? '') || configAuthor(propConfig),
  );
  // Author edits must persist even when the render controls are untouched, so
  // they get their own dirty flag (the controls' dirtyRef gates the config-only
  // case; author-only edits still need a config write at Done).
  const authorDirtyRef = useRef(false);

  // The row id used by Edit's Done persist — from props when the caller has
  // it; otherwise recovered by the lookup below.
  const [rowId, setRowId] = useState<string | null>(object.id ?? null);

  // ── Row lookup (once, on open) — recovers id + stored render_config when
  // the caller didn't pass them (DeskPage today). Edit scopes to YOUR rows;
  // Sandbox matches any maker so its baseline is the object's real desk look
  // (post-D-7 objects render from their own record, not the pen). Best-effort:
  // a miss leaves the pen-values baseline.
  useEffect(() => {
    if (object.id && propConfig) return; // caller passed everything — no lookup
    let cancelled = false;
    findDoodleBySvg(object.svgMarkup, isSandbox ? 'any' : 'mine')
      .then((row) => {
        if (cancelled || !row) return;
        setRowId((prev) => prev ?? row.id);
        if (propConfig) return; // prop config wins over the row's
        const cfg = parseSurfaceConfig(row.render_config);
        if (cfg && !dirtyRef.current) {
          setBaseline(cfg);
          setSurfStyle(cfg.svgStyle);
          setSurfMods(cfg.modifiers);
        }
        // Re-seed the author from the looked-up config (rides as a config
        // extra), but never clobber an author the user is already typing.
        if (cfg && !authorDirtyRef.current && !object.author) {
          setAuthor(configAuthor(cfg));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Open-time snapshot by design — the popup unmounts between opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markDirty = () => {
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      forceDirtyPaint(true); // divergence note may need a paint
    }
  };

  const setSurfMod = <K extends keyof F3ModifiersState>(key: K, value: F3ModifiersState[K]) => {
    markDirty();
    clearSmartPick();
    setSurfMods((prev) => ({ ...prev, [key]: value }));
  };

  /** Author input — flags its own dirty bit so Done writes the config even if
   *  the render controls are untouched (an author-only edit still needs to
   *  reach the record). */
  const handleAuthorChange = (v: string) => {
    authorDirtyRef.current = true;
    setAuthor(v);
  };

  /** Style switch — desk-chrome semantics (SmartHachureChrome onChange):
   *  apply the new style's preset onto the CURRENT modifier state, so picking
   *  "Bold ink" actually reads as bold ink and the visible rows snap to the
   *  style's own calibration. */
  const handleStyle = (next: F3SvgStyle) => {
    markDirty();
    clearSmartPick();
    setSurfStyle(next);
    setSurfMods((prev) => applyStylePreset(prev, next));
  };

  /** Reset — chrome semantics: DEFAULT baseline + this style's preset (true
   *  per-style baseline, including keys presets don't carry). */
  const handleReset = () => {
    markDirty();
    clearSmartPick();
    setSurfMods(applyStylePreset(DEFAULT_MODIFIERS, surfStyle));
  };

  /** Smart — one tap re-runs the shared smart-pick on THIS object's markup and
   *  applies it the same way a manual style switch + slider moves would (style
   *  preset snap, then confident secondary axes on top). User-initiated, so it
   *  stays fully overridable afterward (I-1: the dropdowns reflect it and the
   *  user can still change anything). Same applySmartPick math as DrawPanel. */
  const runSmartPick = (): 'applied' | 'abstained' => {
    const result = smartPickFromMarkup(artMarkup, storedStrokes ? 'draw' : 'upload-svg');
    const pick = result?.pick;
    if (!pick || !result) return 'abstained';
    markDirty();
    lastSmartResultRef.current = result;
    setSmartOn(true);
    setSurfStyle(pick.axes.svgStyle);
    setSurfMods((prev) => {
      const snapped = applyStylePreset(prev, pick.axes.svgStyle);
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

  // Quiet divergence affordance — true once any control left the baseline.
  const diverged =
    surfStyle !== baseline.svgStyle ||
    (Object.keys(DEFAULT_MODIFIERS) as (keyof F3ModifiersState)[]).some(
      (k) => surfMods[k] !== baseline.modifiers[k],
    );

  // ── Edit Done — name/why save (unchanged) + the config persist (v4) ───────
  const [saving, setSaving] = useState(false);
  // True after a persist came back false (RPC absent / row not ours / no row
  // id) — the quiet "saved locally" note. The next Done just closes: the
  // config is already applied optimistically and re-firing would loop.
  const [configNote, setConfigNote] = useState(false);

  const handleDone = async () => {
    // Read the config-building state from the per-render ref (not this closure) so
    // an async config swap / mesh-gen landing mid-edit can't persist stale values.
    const s = saveStateRef.current;
    // EXTRA SAVES (save-routing parity with DrawPanel's "Also save to"): tick
    // Drawer/Shelf → stash a COPY of THIS object's current look to your personal
    // space. Independent of the dirty check below (you can stash without changing a
    // control) and best-effort — never blocks the edit save. One drawer row covers
    // both (the shelf is the public face of a drawer item — shareToShelf flips it).
    if (allowDrawer && (saveDrawer || saveShelf)) {
      const stashConfig: SurfaceRenderConfig = { ...s.baseline, svgStyle: s.surfStyle, modifiers: s.surfMods };
      const stashSvg = normalizeSvgSize(artMarkup, 180);
      const stashName = s.name.trim() || null;
      const stashWhy = s.why.trim() || null;
      void (async () => {
        const row = await stashToDrawer({ svg: stashSvg, name: stashName, why: stashWhy, renderConfig: stashConfig });
        if (row && saveShelf) await shareToShelf(row.id);
      })().catch((err) => console.warn('[object-surface] also-save (drawer/shelf) failed:', err?.message ?? err));
      // One-shot: clear so a second Done doesn't double-stash.
      setSaveDrawer(false);
      setSaveShelf(false);
    }
    // Persist the edited name/why exactly as before. Empty → null.
    onSave?.(s.name.trim() || null, s.why.trim() || null);

    // Controls AND author both untouched → legacy behavior: nothing config-
    // related to do. An author-only edit still needs a config write (it rides
    // in render_config), so authorDirtyRef opens the same persist path.
    if (!dirtyRef.current && !authorDirtyRef.current) {
      requestClose();
      return;
    }

    // Author rides in render_config as an extra key (empty → drop the key so a
    // cleared author doesn't persist as ""). Built on the same {svgStyle,
    // modifiers} config the controls produce; extras (strokes) ride untouched.
    const trimmedAuthor = s.author.trim();
    const config: SurfaceRenderConfig = { ...s.baseline, svgStyle: s.surfStyle, modifiers: s.surfMods };
    // Persist the 2D/3D choice PER OBJECT (Sebs 2026-06-16: "the 3d just doesn't
    // save anywhere" / "treats each object as its own") → the desk renders THIS
    // object in 3D on its own (force3dIds) regardless of the global desk lens.
    if (can3d && s.view3d) {
      config.is3d = true;
      // STATIC 3D THUMBNAIL for the side-panel preview — a LIVE 3D canvas can't
      // render in the panel (drei's shared <View> tunnel collides with the desk's
      // canvas → bleed; per-card canvases hit the WebGL context limit → crash, the
      // reason the shared canvas exists). So capture the modal's 3D render ONCE,
      // downscaled, and the panel shows that image (Sebs 2026-06-17: "I want the 3d
      // preview to show in the panel"). Captured at 160px → a few KB.
      const cv = artRoot()?.querySelector('canvas') as HTMLCanvasElement | null;
      if (cv) {
        try {
          const off = document.createElement('canvas');
          off.width = 160;
          off.height = 160;
          const g = off.getContext('2d');
          if (g) {
            g.drawImage(cv, 0, 0, 160, 160);
            config.thumb3d = off.toDataURL('image/png');
          }
        } catch {
          /* capture blocked — panel falls back to the 2D preview */
        }
      }
    } else {
      delete (config as Record<string, unknown>).is3d;
      delete (config as Record<string, unknown>).thumb3d;
    }
    // Persist the AI-mesh GLB url itself (Sebs 2026-06-19): a mesh GENERATED in
    // this edit modal set local `hardMeshUrl` but it was never written back —
    // config only carried a mesh that was ALREADY in baseline, so a modal-gen mesh
    // regenerated on reload instead of loading the cached GLB. Write it when set;
    // DELETE it when cleared so a revert-to-local (mesh → off) also persists.
    if (s.hardMeshUrl) config.hardMeshUrl = s.hardMeshUrl;
    else delete (config as Record<string, unknown>).hardMeshUrl;
    // Persist the AI-mesh look (Material/Darkness/Auto-spin) so the placed mesh
    // keeps it on the desk/drawer (Sebs 2026-06-16: "3d edits don't save/show").
    if (s.hardMeshUrl && aiMeshLookRef.current) config.aiMesh = aiMeshLookRef.current;
    // Persist the LOCAL 3D look — geometry/material/style — for ANY 3D-capable
    // object, INCLUDING a mesh (Sebs 2026-06-27 FORM × SURFACE): a mesh now also
    // carries a FORM choice (geometry3d.geometryMode = 'ai-mesh' default, or a
    // stroke form that rebuilds from its Quiver SVG). Saving it lets the desk
    // honor a mesh converted to Extrude/etc. The render gate keys the GLB on
    // geometryMode ∈ {ai-mesh, auto}, so a mesh at the default still shows the GLB.
    if (can3d && geometry3dLookRef.current) config.geometry3d = geometry3dLookRef.current;
    if (trimmedAuthor) config.author = trimmedAuthor;
    else delete (config as Record<string, unknown>).author;
    // Optimistic local update — ALWAYS (the caller re-pins the desk object;
    // the note below covers the not-persisted case honestly).
    onConfigSave?.(config);

    if (configNote) {
      // Already noted "saved locally" — second Done is just a close.
      requestClose();
      return;
    }

    let persisted = false;
    if (rowId) {
      setSaving(true);
      persisted = await updateDoodleConfig(rowId, config).catch(() => false);
      setSaving(false);
    }
    if (persisted) requestClose();
    else setConfigNote(true); // quiet one-liner, stays open so it's seen
  };

  // ── RE-DRAW (round 4): reopen the recorded gesture, modify, save back ────
  // The record keeps the hand: render_config.strokes (written at Done by the
  // create flow) reload into the draw canvas, editable; Done re-runs the same
  // markup path the create flow uses and persists svg + config in one v5 RPC.
  const [redrawing, setRedrawing] = useState(false);
  const [redrawMode, setRedrawMode] = useState<'draw' | 'style'>('draw');
  const redrawStrokesRef = useRef<Stroke[]>([]);
  // Latest EDITED parts SVG (moves/restyle/delete baked) from the part editor —
  // saved at Done even with no drawn strokes (Slice 2d). Reset after save.
  const editedPartsRef = useRef<string | null>(null);
  const [redrawCount, setRedrawCount] = useState(0);
  // True once a PART was moved/restyled/deleted — lets Done save even with no
  // drawn strokes (Slice 2d). Reset on save.
  const [partsEdited, setPartsEdited] = useState(false);

  // ── RE-DRAW draw-tool state (Phase 0: RE-DRAW becomes a third host of the
  // shared DrawToolbar — the Ink|Shade register, tone cluster, and Snap/
  // Straighten shape-assist that the create flow + /canvas already have).
  const [redrawRegister, setRedrawRegister] = useState<'ink' | 'shade' | 'erase'>('ink');
  const [redrawEraseMode, setRedrawEraseMode] = useState<'object' | 'pixel'>('object');
  const [redrawShadeTool, setRedrawShadeTool] = useState<ShadeToolState>(SHADE_TOOL_DEFAULT);
  // Live tone-patch mirror — preloaded from the object's stored toneFills (so a
  // re-draw of a toned doodle keeps its tone) and re-captured at Done.
  const redrawToneRef = useRef<ToneFill[]>([]);
  // FIT STROKES + TONE TOGETHER (one shared transform) into the draw frame so the
  // whole doodle — ink AND shading — loads centered with a margin, never cut off
  // (Sebs 2026-06-16: "object gets cropped in the redraw"). The old path fit only
  // the strokes (fitStrokesToFrame) and left tone at raw coords, so tone painted
  // near the original edges spilled past the 800×600 viewBox and got clipped, and
  // strokes↔tone drifted apart. Save re-derives a tight bbox at Done, so this only
  // affects the editing view, never the persisted markup.
  const redrawFitted = useMemo<{ strokes: StrokePoint[][]; tone: ToneFill[] } | null>(() => {
    const rawS = (baseline as Record<string, unknown>).strokes;
    if (!Array.isArray(rawS) || rawS.length === 0) return null;
    const okS = rawS.every(
      (st) =>
        Array.isArray(st) &&
        st.length >= 2 &&
        st.every((pt) => Array.isArray(pt) && pt.length === 3 && pt.every((n) => Number.isFinite(n))),
    );
    if (!okS) return null;
    const strokes = rawS as StrokePoint[][];
    const rawT = (baseline as Record<string, unknown>).toneFills;
    const tone = Array.isArray(rawT) ? (rawT as ToneFill[]) : [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const see = (x: number, y: number) => {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    };
    for (const s of strokes) for (const [x, y] of s) see(x, y);
    for (const f of tone) {
      for (const [x, y] of f.points) see(x, y);
      if (f.holes) for (const h of f.holes) for (const [x, y] of h) see(x, y);
    }
    const sw = maxX - minX, sh = maxY - minY;
    if (!(sw > 0) && !(sh > 0)) return { strokes, tone };
    const pad = 56; // a touch more breathing room than the stroke-only default
    const availW = VIEWBOX_W - pad * 2, availH = VIEWBOX_H - pad * 2;
    const scale = Math.min(availW / (sw || 1), availH / (sh || 1));
    const offX = pad + (availW - sw * scale) / 2 - minX * scale;
    const offY = pad + (availH - sh * scale) / 2 - minY * scale;
    const tx = (x: number) => x * scale + offX;
    const ty = (y: number) => y * scale + offY;
    return {
      strokes: strokes.map((s) => s.map(([x, y, p]): StrokePoint => [tx(x), ty(y), p ?? 0.5])),
      tone: tone.map((f) => ({
        ...f,
        points: f.points.map(([x, y]): [number, number] => [tx(x), ty(y)]),
        holes: f.holes?.map((h) => h.map(([x, y]): [number, number] => [tx(x), ty(y)])),
      })),
    };
  }, [baseline]);
  const redrawInitialTone = redrawFitted?.tone;
  // The shape-snap API the redraw DrawSurface hands up (same contract as the
  // other two hosts — fit/apply/cycle the last stroke imperatively).
  const redrawSnapApiRef = useRef<ShapeSnapApi | null>(null);
  // SNAP SWITCHER (Sebs 2026-06-15 — the ONE snap UI) for RE-DRAW. No auto-offer,
  // no cycle chip: the SNAP button applies the best shape + opens this switcher.
  const [redrawOverride, setRedrawOverride] = useState<ShapeOverride | null>(null);
  const [redrawSwitchAllOpen, setRedrawSwitchAllOpen] = useState(false);
  // SHAPE INSERT (Phase 2) for RE-DRAW — armed shape (null = Freehand).
  const [redrawArmedShape, setRedrawArmedShape] = useState<string | null>(null);
  const armRedrawShape = (kind: string | null) => {
    setRedrawArmedShape(kind);
    if (kind) {
      setRedrawRegister('ink');
      setRedrawOverride(null);
    }
  };
  // Honest-miss caption channel for the redraw toolbar.
  const [redrawFillNote, setRedrawFillNote] = useState<string | null>(null);
  const redrawFillNoteTimer = useRef<number | null>(null);
  const showRedrawFillNote = (note: string) => {
    setRedrawFillNote(note);
    if (redrawFillNoteTimer.current) window.clearTimeout(redrawFillNoteTimer.current);
    redrawFillNoteTimer.current = window.setTimeout(() => {
      setRedrawFillNote(null);
      redrawFillNoteTimer.current = null;
    }, 3200);
  };

  /** Log one redraw shape-snap act into the unified decision log (training
   *  flywheel — identical to the create flow's logSnap). */
  const logRedrawSnap = (
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
      candidates: result.candidates.map((c) => ({ kind: c.kind, normErr: c.normErr, score: c.score })),
      chosen,
      margin,
    });
  };

  /** Tap SNAP / STRAIGHTEN in the redraw toolbar: fit the last stroke, apply the
   *  best candidate (or refuse honestly), raise the chip. */
  const runRedrawSnap = (action: SnapAction) => {
    const api = redrawSnapApiRef.current;
    if (!api) return;
    const last = api.lastStroke();
    if (!last) {
      showRedrawFillNote('nothing to snap — draw a stroke first');
      return;
    }
    const fit = api.fitLast(action);
    if (!fit) {
      showRedrawFillNote('that stroke is too small to snap');
      return;
    }
    const { strokeId, result } = fit;
    const real = result.candidates.filter((c) => c.kind !== 'original');
    const margin = real.length >= 2 ? real[0].score - real[1].score : real.length === 1 ? 1 : 0;
    if (!result.accepted) {
      logRedrawSnap(action, 'evaluate', strokeId, result, 'original', 0);
      showRedrawFillNote(
        action === 'snap'
          ? "didn't read as one clean shape — try Straighten"
          : "couldn't straighten that — it reads as a scribble",
      );
      return;
    }
    // Apply the best candidate (the snap) then OPEN the switcher — the ONE snap
    // path; replaces the old cycle chip AND the auto-offer (Sebs 2026-06-15).
    const best = result.candidates[0];
    api.applyToStroke(strokeId, best, last.points);
    logRedrawSnap(action, 'evaluate', strokeId, result, best.kind, margin);
    const switchSet = buildSwitchSet(result, last.points);
    const appliedIndex = Math.max(
      0,
      switchSet.findIndex((e) => e.source === 'recognized' && e.kind === best.kind),
    );
    setRedrawOverride({ strokeId, appliedKind: best.kind, switchSet, appliedIndex, originalPoints: last.points });
    setRedrawSwitchAllOpen(true);
  };

  /** Apply one switch entry to the redraw override's stroke (recognized → fitted
   *  candidate; library → generate at bbox; original → restore). Mirrors DrawPanel. */
  const applyRedrawOverrideEntry = (entry: SwitchEntry, index: number) => {
    const api = redrawSnapApiRef.current;
    if (!api || !redrawOverride) return;
    if (entry.source === 'recognized' && entry.candidate) {
      api.applyToStroke(redrawOverride.strokeId, entry.candidate, redrawOverride.originalPoints);
    } else if (entry.source === 'library') {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of redrawOverride.originalPoints) {
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
        api.applyToStroke(redrawOverride.strokeId, cand, redrawOverride.originalPoints);
      }
    } else {
      const cand: ShapeCandidate = {
        kind: 'original',
        points: redrawOverride.originalPoints as unknown as ShapeCandidate['points'],
        normErr: 0,
        score: 0,
        closed: false,
        label: 'Original',
      };
      api.applyToStroke(redrawOverride.strokeId, cand, redrawOverride.originalPoints);
    }
    setRedrawOverride({ ...redrawOverride, appliedIndex: index, appliedKind: entry.kind });
    setRedrawSwitchAllOpen(false);
  };

  // Local art override so the card refreshes instantly after a re-draw save.
  const [artMarkup, setArtMarkup] = useState(object.svgMarkup);
  // svg-port 3D wears the LIVE STYLED 2D render — so changing the style/toggles
  // re-styles the 3D form (Sebs 2026-06-20: "the svg-port style toggles don't
  // change shit"). The old code fed the STATIC artMarkup straight to the mount,
  // so svg-port never re-styled. An offscreen SvgStyleTransform inside the card's
  // SurfaceRenderScope re-renders artMarkup through surfStyle/surfMods and hands
  // the serialized styled <svg> here (same pattern /canvas uses). null until first
  // render → fall back to artMarkup.
  const [svgPortStyled, setSvgPortStyled] = useState<string | null>(null);
  // Stable child + deduped setter so the offscreen SvgStyleTransform's onRender
  // effect fires only when the STYLE changes, not every render (else it serializes
  // per-frame during 3D rotation → lag, the desk version of this bit Sebs).
  const setSvgPortStyledDedup = useCallback(
    (s: string | null) => setSvgPortStyled((prev) => (prev === s ? prev : s)),
    [],
  );
  const svgPortChild = useMemo(
    () => <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: artMarkup }} />,
    [artMarkup],
  );
  // Per-style carve PROFILE for the modal's svg-port 3D (Sebs 2026-06-20 "improve
  // the differences"): the active style routes to its own relief so clean/rough/
  // bold-ink/stipple read as distinct surfaces here too. Stable ref (memo) so the
  // 3D mount's memo doesn't churn.
  const modalSvgPortBuild = useMemo(() => ({ styleId: surfStyle }), [surfStyle]);
  // The fit strokes (shared transform with the tone above) drive BOTH the re-draw
  // canvas and the 3D derive — so ink + shading stay aligned and the whole doodle
  // fits the frame. (Falls back to fitStrokesToFrame's stroke-only fit only if the
  // combined memo bailed, which it won't when strokes are valid.)
  const storedStrokes = redrawFitted?.strokes ?? null;
  // RE-DRAW OVER (Sebs 2026-06-16/21): an object with NO recorded strokes — an
  // UPLOADED SVG (Quiver) or a legacy pre-re-edit doodle — can't re-draw its
  // strokes (there are none). Instead it offers a BACKDROP draw-over: the current
  // art rides behind the canvas as a backdrop and you draw NEW ink/tone ON it
  // (the same `backdrop` path the create flow uses for uploads). null when the
  // object has real strokes (then it's the normal stroke re-draw) or the markup
  // doesn't parse into a backdrop frame.
  const redrawBackdrop = useMemo<BackdropFrame | null>(
    () => (storedStrokes ? null : prepareBackdrop(artMarkup)),
    [storedStrokes, artMarkup],
  );
  // LOSSLESS PART EDITOR (2026-06-24, Slice 2a): for an editable object with NO
  // recorded strokes (upload / legacy), decompose its art into selectable SVG-shape
  // PARTS (fills intact) so the edit surface can grab any part — not just draw over.
  // null (→ no part layer, backdrop draw-over as before) when it has strokes, no
  // geometry, or >60 parts (too many to edit). Slice 2a = select+highlight only;
  // move/restyle/delete/save land in later slices, so Done is unchanged for now.
  const editableParts = useMemo(
    () => (storedStrokes ? null : svgToParts(artMarkup)),
    [storedStrokes, artMarkup],
  );

  // 2D / 3D view toggle (Sebs 2026-06-14: "add them in the main panel… not just
  // canvas"). Only offered when the doodle has flippable strokes (uploads stay
  // 2D). The 3D mount renders the SAME Stroke3DScene the desk + /canvas use,
  // sourced from this doodle's own render_config. Chips suppressed (preview).
  // Open reflecting the object's SAVED 2D/3D state (render_config.is3d) so a
  // doodle saved in 3D opens IN 3D — and the save round-trips visibly (Sebs
  // 2026-06-16: "some objects still don't save as 3d" — they did save, but the
  // modal always opened in 2D so it looked unsaved). Reconciled to 2D below if
  // the object can't actually flip.
  const [view3d, setView3d] = useState(() => (baseline as Record<string, unknown>).is3d === true);
  // True while the active 3D SURFACE is the engraving (svg-port) — drives showing
  // the 2D Restyle controls under the 3D chrome (the engraving's "what's carved in"
  // toggles), set by EngraveStyleSync inside the Canvas3DProvider.
  const [engraveActive, setEngraveActive] = useState(false);
  // Flip strokes: recorded if present, else DERIVED from the SVG so EVERY doodle
  // flips to 3D (Sebs: "some objects just don't turn 3D"). storedStrokes
  // (recorded only) still drives RE-DRAW; this drives the 3D mount + the toggle.
  const flip3dStrokes = useMemo<StrokePoint[][] | null>(() => {
    if (storedStrokes) return storedStrokes;
    const derived = svgMarkupToStrokes(artMarkup);
    return derived.length > 0 ? derived : null;
  }, [storedStrokes, artMarkup]);
  // An UPLOADED image (render_config.sourceImage) with NO AI mesh does NOT flip to
  // 3D — a native rebuild from a traced photo outline reads rough, so it stays 2D
  // (Sebs 2026-06-16: an upload should not go 3D without a mesh). With a mesh it
  // flips to that mesh. Drawn doodles (no sourceImage) flip natively as before.
  const isUploadObject = typeof (baseline as Record<string, unknown>).sourceImage === 'string';
  const hasSavedMesh = typeof (baseline as Record<string, unknown>).hardMeshUrl === 'string';
  // An uploaded image has no local 3D strokes — but WITH the hard path on it can
  // still go 3D via an AI mesh. So let it enter 3D (toggle shows, view3d allowed)
  // and surface the "Generate AI 3D" button (Sebs 2026-06-17 "wire it"). Drawn
  // doodles flip natively as before; a placed object with a saved mesh wears it.
  const canHardMesh = isUploadObject && isHardPathEnabled();
  const can3d =
    (flip3dStrokes != null && flip3dStrokes.length > 0 && !isUploadObject) || hasSavedMesh || canHardMesh;
  const geometry3d = useMemo<Geometry3DConfig | null>(() => {
    const raw = (baseline as Record<string, unknown>).geometry3d;
    return raw && typeof raw === 'object' ? (raw as Geometry3DConfig) : null;
  }, [baseline]);
  // Never strand the view in 3D when the doodle can't flip (config swap / row
  // lookup may arrive after first paint).
  useEffect(() => {
    if (!can3d && view3d) setView3d(false);
  }, [can3d, view3d]);

  // ── HARD PATH (AI mesh, opt-in) — modal-only ────────────────────────────────
  // The "✨ Generate AI 3D" chip rasterizes THIS doodle's markup → fal/TRELLIS
  // (via runMesh → our Edge fn) → a real GLB the 3D view wears IN PLACE of the
  // local form (Stroke3DScene's hardMeshUrl branch). Opt-in + async (~30–90s) +
  // costs a gen; default 3D stays the instant local engine. Gated on
  // isHardPathEnabled() (off unless VITE_HARD_PATH_ENABLED=1 + the Edge fn is up).
  // Re-load a persisted AI mesh (DrawPanel/this surface wrote render_config.hardMeshUrl)
  // so reopening a placed AI-mesh object shows it again without regenerating.
  const [hardMeshUrl, setHardMeshUrl] = useState<string | null>(
    typeof baseline.hardMeshUrl === 'string' ? baseline.hardMeshUrl : null,
  );
  const [meshStatus, setMeshStatus] = useState<string | null>(null);
  // SVG-PORT defaults to the HAND-DRAWN register (Sebs 2026-06-28 "two sliders" / "it
  // ports over ALL the SVG stuff"). The svg-port surface's whole point is the
  // hand-drawn line FEELING on the mesh's own form — but the SVG style defaults to
  // 'clean', which (exactly like the 2D pen) exposes only Ink/Fill-opacity → it READ
  // as "only two sliders / broken". When svg-port first activates on a MESH from the
  // bare 'clean' default, promote to 'rough-handdrawn' so the full pen set (wobble /
  // stroke width / hachure / fill style …) is visible AND the mesh reads hand-drawn.
  // One-shot (ref-guarded) so a later manual 'clean' pick STICKS — never fights the user.
  const svgPortAutoStyledRef = useRef(false);
  useEffect(() => {
    if (engraveActive && hardMeshUrl && !svgPortAutoStyledRef.current && surfStyle === 'clean') {
      svgPortAutoStyledRef.current = true;
      setSurfStyle('rough-handdrawn');
      setSurfMods((prev) => applyStylePreset(prev, 'rough-handdrawn'));
    }
  }, [engraveActive, hardMeshUrl, surfStyle]);
  // SAVE-PATH LATEST SNAPSHOT (debt-paydown 2026-06-21): handleDone/handleRedrawDone
  // are async (they await updateDoodle*). Building the persisted config from THIS
  // per-render ref instead of each handler's own closure guarantees the write uses
  // the latest values even if the handler closure is stale (a config swap or an
  // async AI-mesh-gen landing mid-edit). `disabled={saving}` already blocks
  // re-entry during the await; this closes the latent stale-config window
  // architecturally (read from refs at write time). Assigned every render — a
  // plain "latest value" ref, no re-render, no effect needed.
  const saveStateRef = useRef({ name, why, author, surfStyle, surfMods, view3d, hardMeshUrl, baseline });
  saveStateRef.current = { name, why, author, surfStyle, surfMods, view3d, hardMeshUrl, baseline };
  // "Also save to: Drawer / Shelf" extra-copy toggles (owner-edit parity with
  // DrawPanel). Independent — tick either, both, or neither; stashed best-effort
  // on Done. Only rendered when allowDrawer (owner-edit context).
  const [saveDrawer, setSaveDrawer] = useState(false);
  const [saveShelf, setSaveShelf] = useState(false);
  const hardPathOn = isHardPathEnabled();
  // Saved AI-mesh look (Material/Darkness/Auto-spin) → seeds the context on open
  // (AiMeshLookSync) and the ref the Save path reads to persist render_config.aiMesh.
  const savedAiMesh = useMemo<Partial<AiMeshLook> | undefined>(() => {
    const v = (baseline as Record<string, unknown>).aiMesh;
    return v && typeof v === 'object' ? (v as Partial<AiMeshLook>) : undefined;
  }, [baseline]);
  const aiMeshLookRef = useRef<AiMeshLook | null>(null);
  // The captured local-3D look (geometry/material/...) for a NORMAL 3D object,
  // read at Save → render_config.geometry3d.
  const geometry3dLookRef = useRef<Geometry3DConfig | null>(null);
  // The ORIGINAL photo, when this object came from a traced image upload (rides
  // render_config.sourceImage — DrawPanel.handlePlace). TRELLIS makes a GOOD mesh
  // from a real photo and a BLOB from flat doodle art (Sebs 2026-06-16), so the
  // hard path sends the photo when we have it, else falls back to the doodle.
  const sourceImage = typeof baseline.sourceImage === 'string' ? baseline.sourceImage : null;
  const generateAiMesh = useCallback(async () => {
    if (meshStatus === 'working') return;
    setMeshStatus('working');
    try {
      const imageUrl = sourceImage ?? (await rasterizeMarkupPng(artMarkup));
      if (!imageUrl) { setMeshStatus('failed'); return; }
      const mesh = await runMesh(
        { imageUrl, contentHash: rowId ?? undefined, provider: 'auto' },
        { onStatus: (j) => setMeshStatus(j.status) },
      );
      if (mesh?.glbUrl) { setHardMeshUrl(mesh.glbUrl); setMeshStatus('done'); }
      else setMeshStatus('failed');
    } catch {
      setMeshStatus('failed');
    }
  }, [artMarkup, rowId, meshStatus, sourceImage]);

  const handleRedrawDone = async () => {
    const drawn = redrawStrokesRef.current;
    const edited = editedPartsRef.current;
    // Save if EITHER strokes were drawn OR parts were edited (move/restyle/delete).
    if (drawn.length === 0 && !edited) return;
    // Latest config-building state from the ref (not this async closure).
    const s = saveStateRef.current;
    // Carry any tone painted (or preloaded) during the re-draw, mirroring the
    // create flow's strokesToObjectMarkup(strokes, tone) + render_config.toneFills.
    const tone = redrawToneRef.current;
    let markup: string;
    let config: SurfaceRenderConfig;
    if (edited) {
      // PART EDITOR (Slice 2d): the edited parts ARE the new art (moves/restyle/
      // delete baked into the markup). Compose any drawn ink/tone on top (parts as
      // backdrop). No stored strokes — the edits live in the markup and re-open as
      // editable parts again (repeatable).
      const partsBackdrop = drawn.length > 0 ? prepareBackdrop(edited) : null;
      markup = partsBackdrop
        ? normalizeSvgSize(composeBackdropAndStrokes(partsBackdrop, drawn, { tight: true, toneFills: tone }), 180)
        : normalizeSvgSize(edited, 180);
      config = { ...s.baseline, svgStyle: s.surfStyle, modifiers: s.surfMods };
    } else {
      // BACKDROP DRAW-OVER (upload/legacy) or stroke re-draw — unchanged.
      markup = redrawBackdrop
        ? normalizeSvgSize(composeBackdropAndStrokes(redrawBackdrop, drawn, { tight: true, toneFills: tone }), 180)
        : normalizeSvgSize(strokesToObjectMarkup(drawn, tone), 180);
      config = redrawBackdrop
        ? { ...s.baseline, svgStyle: s.surfStyle, modifiers: s.surfMods }
        : {
            ...s.baseline,
            svgStyle: s.surfStyle,
            modifiers: s.surfMods,
            strokes: capStrokes(drawn),
            toneFills: tone.length > 0 ? capToneFills(tone) : undefined,
          };
    }
    editedPartsRef.current = null;
    setPartsEdited(false);
    // Optimistic everywhere: the card + the desk object update immediately.
    setArtMarkup(markup);
    setBaseline(config);
    onObjectUpdate?.(markup, config);
    setRedrawing(false);
    let persisted = false;
    if (rowId) {
      setSaving(true);
      persisted = await updateDoodleSvg(rowId, markup, config).catch(() => false);
      setSaving(false);
    }
    if (!persisted) setConfigNote(true); // honest local-save note (needs v5)
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Card column ref — used by the export helpers to find the live card art well.
  // (The control column no longer caps to the card's height: it FILLS the panel
  // and scrolls internally, so the full restyle set is reachable instead of
  // crammed into the short card — Sebs 2026-06-27 "the property panel is cut off".)
  const cardColRef = useRef<HTMLDivElement | null>(null);

  // ── EXPORT (card features — Sebs 2026-06-13) ──────────────────────────────
  // The card detail modal is the PRIMARY export spot (RESTYLE/RE-DRAW/DELETE
  // row). Both buttons capture the LIVE-rendered doodle out of the art well
  // (exportCard.ts walks [data-dd-card-art] → the visible <svg> → bakes the
  // computed cascade into a self-contained file), so the export matches exactly
  // what the surface shows (current style + restyle edits in progress). Scoped
  // to the card column so it never grabs the re-draw canvas's <svg>.
  const [exportNote, setExportNote] = useState<string | null>(null);
  const exportNoteTimer = useRef<number | null>(null);
  const [exportingPng, setExportingPng] = useState(false);
  const flashExportNote = (msg: string) => {
    setExportNote(msg);
    if (exportNoteTimer.current) window.clearTimeout(exportNoteTimer.current);
    exportNoteTimer.current = window.setTimeout(() => {
      setExportNote(null);
      exportNoteTimer.current = null;
    }, 4000);
  };
  useEffect(
    () => () => {
      if (exportNoteTimer.current) window.clearTimeout(exportNoteTimer.current);
    },
    [],
  );
  const exportFileName = (isSandbox ? object.name : name) || null;
  const artRoot = () => cardColRef.current?.querySelector('[data-dd-card-art]') ?? null;
  const handleExportSvg = () => {
    // Raw doodle SVG (frame-less, transparent) — "just the svg" (Sebs).
    const res = exportDoodleSvg(artRoot(), exportFileName);
    flashExportNote(res.ok ? 'saved SVG' : res.error);
  };
  const handleExportPng = async () => {
    if (exportingPng) return;
    setExportingPng(true);
    // Pokémon-style card: frame + name + info + art (Sebs 2026-06-15).
    const styleId = (object as { svgStyle?: string }).svgStyle;
    const styleLabel = F3_SVG_STYLES.find((s) => s.id === styleId)?.label ?? styleId ?? null;
    const strokesRaw = (object as { strokes?: unknown }).strokes;
    const strokeCount = Array.isArray(strokesRaw) ? strokesRaw.length : null;
    const meta: CardMeta = {
      name: exportFileName,
      style: styleLabel,
      handle: object.owner ?? null,
      createdAt: object.createdAt ?? null,
      strokeCount,
    };
    // 3D VIEW → put the 3D RENDER on the card (Sebs 2026-06-16: "export card
    // doesn't export the 3d on the card, just the 3d as a png"). Snapshot the
    // WebGL canvas (preserveDrawingBuffer is on) → pass it as the card's art
    // image so the SAME framed Pokémon card carries the mesh/3D you're looking
    // at instead of the hidden 2D SVG. If capture is blocked the card falls back
    // to the 2D art (artImageDataUrl stays undefined).
    if (view3d) {
      const canvas = artRoot()?.querySelector('canvas') as HTMLCanvasElement | null;
      if (canvas) {
        try {
          meta.artImageDataUrl = canvas.toDataURL('image/png');
          meta.mode = hardMeshUrl ? 'AI mesh' : '3D';
        } catch {
          /* capture blocked — card falls back to the 2D art below */
        }
      }
    }
    const res = await exportPokemonCardPng(artRoot(), meta);
    setExportingPng(false);
    flashExportNote(res.ok ? 'saved card PNG' : res.error);
  };
  // 3D MODEL (.glb) export (Sebs 2026-06-14: "one to just export the 3d model").
  // Lazy-imports exportGlb so three/GLTFExporter never enter the main chunk;
  // builds the SAME watertight mass the 3D view shows from the doodle's strokes.
  const [exportingGlb, setExportingGlb] = useState(false);
  // Single Export ▾ menu (Sebs 2026-06-14: "3 export buttons = clutter — one
  // clean way to switch what to export, like Figma's dropdown"). One button, a
  // menu of the formats so the options are discoverable; picking one exports
  // directly (no select-then-export two-step).
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const handleExportGlb = async () => {
    if (exportingGlb || !flip3dStrokes) return;
    setExportingGlb(true);
    try {
      const { exportObjectGlb } = await import('../../lib/exportGlb');
      const res = await exportObjectGlb(flip3dStrokes as never, exportFileName);
      flashExportNote(res.ok ? 'saved 3D model (.glb)' : (res.reason ?? 'GLB export failed'));
    } catch {
      flashExportNote('GLB export failed');
    } finally {
      setExportingGlb(false);
    }
  };

  // ── FOCUS-MODE LIFT motion ────────────────────────────────────────────────
  // The card scales + translates FROM the tapped doodle's spot on open and back
  // on close, so editing reads as FOCUSING on the doodle in place, not a box
  // popping at center. ONE CSS transition driven by three phases: 'enter' (small,
  // AT the origin, pre-paint) → 'in' (full, centered) → 'exit' (reverse to the
  // origin, then unmount). Honors prefers-reduced-motion (no transform, instant).
  const reduceMotion =
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [liftPhase, setLiftPhase] = useState<'enter' | 'in' | 'exit'>(reduceMotion ? 'in' : 'enter');
  useEffect(() => {
    if (reduceMotion) return;
    // double-rAF so the 'enter' (collapsed) frame paints before the transition.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setLiftPhase('in')); });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [reduceMotion]);
  // Play the settle-back, THEN actually close (so the exit is seen, not cut).
  const requestClose = useCallback(() => {
    if (reduceMotion) { onClose(); return; }
    setLiftPhase('exit');
    window.setTimeout(onClose, 280); // matches the (now quicker) exit transform so the settle-back is seen
  }, [onClose, reduceMotion]);
  const lift: CSSProperties = useMemo(() => {
    if (reduceMotion) return {};
    if (liftPhase === 'in') return { transform: 'translate(0px,0px) scale(1)', opacity: 1 };
    // collapsed at the origin: shift the card's center to the tapped point + shrink.
    const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
    const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
    const ox = origin?.x ?? cx, oy = origin?.y ?? cy;
    return {
      // Start as a VISIBLE chip at the tapped doodle (0.3, not a 0.16 dot) so the
      // spotlight reads as "the editor emanates from this doodle" — opacity ramps fast
      // (below) so you see it WHILE it's still small at the origin, then it grows.
      transform: `translate(${Math.round(ox - cx)}px, ${Math.round(oy - cy)}px) scale(0.3)`,
      opacity: 0,
    };
  }, [reduceMotion, liftPhase, origin]);

  const scrim: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 300,
    background: 'color-mix(in srgb, var(--dir-text-primary) 28%, transparent)',
    // Fade the desk-dimming scrim in/out with the card so the focus reads as one
    // gesture (dim ↔ undim), not a hard cut.
    opacity: reduceMotion ? 1 : liftPhase === 'in' ? 1 : 0,
    transition: reduceMotion ? undefined : 'opacity 0.26s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    // When the desk's right controls panel is open, reserve its width so flex-
    // centering happens in the remaining desk area (modal stops feeling shoved
    // left). Default 0 leaves the base 32px padding untouched. The inner min()
    // CLAMPS the reservation on narrow viewports: an unclamped 32+360px right
    // pad at ~420px wide left NEGATIVE space and crushed the popup to a sliver
    // (caught by playwright 2026-06-11) — the popup keeps ≥~352px and slides
    // under the panel instead, which wins on small screens.
    paddingRight:
      rightInset > 0
        ? `max(32px, min(${32 + rightInset}px, calc(100vw - 384px)))`
        : 32,
    // The drawer's mirror (UX-audit fix 4) — same clamp, so drawer + controls
    // open together still leave the popup its ~352px floor.
    paddingLeft:
      leftInset > 0
        ? `max(32px, min(${32 + leftInset}px, calc(100vw - 384px)))`
        : 32,
  };

  const panel: CSSProperties = {
    position: 'relative',
    background: 'var(--dir-raised)',
    border: '1px solid var(--dir-border)',
    // Sandbox gets a distinct dashed edge so it never reads as "your editable
    // object" (read-only-vs-ephemeral signposting).
    borderStyle: isSandbox ? 'dashed' : 'solid',
    borderRadius: 16,
    boxShadow: RAISED_SHADOW,
    padding: 20,
    // FOCUS-MODE LIFT — grow from the tapped spot / settle back. Expo-out ease
    // (premium, no bounce); transformOrigin center so the scale grows symmetric.
    ...lift,
    transformOrigin: 'center center',
    // Opacity ramps FAST (0.15s) so the card is solid while still small at the doodle
    // — that's what makes the grow-from-the-doodle actually visible (was 0.34s, which
    // kept it near-transparent through the whole travel → looked like nothing). Scale
    // grows over 0.44s with a gentler ease (was easeOutExpo, too front-loaded).
    transition: reduceMotion ? undefined : 'transform 0.34s cubic-bezier(0.33, 1, 0.68, 1), opacity 0.13s ease-out',
    willChange: reduceMotion ? undefined : 'transform, opacity',
    // MINI DESK in both modes now (Sebs 2026-06-11): art beside the FULL
    // control column, the same side-by-side grammar as the big desk.
    // SIZE MATCHES the create-a-doodle popup (DrawPanel) — Sebs 2026-06-16: "the
    // pop needs to be bigger, closer to the create-a-doodle page size" / "the
    // panel should always be full". A tall minHeight keeps the card + control
    // column roomy even for a simple doodle, so the panel never reads cramped.
    width: 'min(1180px, calc(100vw - 48px))',
    minHeight: 'min(660px, calc(100vh - 48px))',
    // The popup itself must NOT grow past the viewport — internal scrolling
    // (the controls column, then the panel itself) absorbs overflow.
    maxHeight: 'calc(100vh - 48px)',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    fontFamily: IS,
  };

  // The embedded card — the modal panel IS the card; no card-inside-a-card.
  // BOTH modes wrap it in the nested-provider scope so it re-renders live
  // through the surface-local values: Sandbox = viewer config (discarded),
  // Edit = the object's config being edited (persisted on Done). The desk
  // behind keeps reading the untouched global context either way.
  const card = (
    <F3SvgStyleProvider>
      <F3RoughModifiersProvider>
        <SurfaceRenderScope svgStyle={surfStyle} mods={surfMods}>
          <ObjectCard
            svgMarkup={artMarkup}
            name={isSandbox ? object.name : name}
            why={isSandbox ? object.why : why}
            // 3D view swaps the art well for the live 3D mount (chips off — this
            // is a preview, closure edits happen in re-draw). 2D = the SVG.
            artOverride={
              view3d && (flip3dStrokes || hardMeshUrl) ? (
                // Live3DMount = driven by the panel's Canvas3DChrome (3D controls),
                // transparent (no box/ground), interactive (rotate), chips off.
                // flip3dStrokes = recorded OR SVG-derived so stroke-less flip too.
                // hardMeshUrl alone (no strokes) = an uploaded image's AI mesh —
                // mount with empty strokes so the GLB still renders (Sebs "wire it").
                <Live3DMount strokes={flip3dStrokes ?? []} svgPortMarkup={svgPortStyled ?? artMarkup} svgPortBuild={modalSvgPortBuild} hardMeshUrl={hardMeshUrl ?? undefined} transparent interactive showChips={false} />
              ) : undefined
            }
            owner={object.owner}
            onOwnerClick={onOwnerClick}
            createdAt={object.createdAt}
            embedded
            editable={!isSandbox}
            onNameChange={setName}
            onWhyChange={setWhy}
          />
          {/* svg-port 3D reactive source: re-style artMarkup through the LIVE
              surfStyle/surfMods (this is INSIDE SurfaceRenderScope, which sets
              those contexts) and hand the serialized styled <svg> to the mount
              above — so changing the style/toggles re-styles the svg-port form
              (Sebs 2026-06-20). Offscreen, mounted only while flipping 3D. */}
          {view3d && (flip3dStrokes || hardMeshUrl) && (
            // MESH TOO (Sebs 2026-06-28 "none of the svg-port options work — it just
            // places the clean style"): this offscreen transform produces the STYLED
            // markup the svg-port engraving reads. It was gated on flip3dStrokes only,
            // so a mesh object with no derived strokes never computed it → the mesh
            // engraving was frozen on the RAW (clean) drawing regardless of the SVG
            // STYLE picked. Mount it for any hard-mesh object so the carve restyles.
            <div aria-hidden style={{ position: 'absolute', left: -99999, top: 0, width: 800, height: 600, opacity: 0, pointerEvents: 'none' }}>
              <SvgStyleTransform wrapperOverride={{ display: 'block', width: '100%', height: '100%' }} onRender={setSvgPortStyledDedup}>
                {svgPortChild}
              </SvgStyleTransform>
            </div>
          )}
        </SurfaceRenderScope>
      </F3RoughModifiersProvider>
    </F3SvgStyleProvider>
  );

  return (
    // Canvas3DProvider — shared 3D state so the panel's Canvas3DChrome drives the
    // Live3DMount when view3d (the modal's 3D controls). Cheap; 2D never reads it.
    <Canvas3DProvider>
    <AiMeshActiveSync active={!!hardMeshUrl} />
    <EngraveStyleSync onChange={setEngraveActive} />
    <AiMeshLookSync initial={savedAiMesh} lookRef={aiMeshLookRef} onDirty={markDirty} />
    <Geometry3DSync initial={geometry3d ?? undefined} lookRef={geometry3dLookRef} onDirty={markDirty} />
    <div onClick={requestClose} style={scrim}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isSandbox ? 'Explore doodle' : 'Edit doodle'}
        onClick={(e) => e.stopPropagation()}
        style={panel}
      >
        {/* Sandbox banner — the why of the unsaved scope, persistent. */}
        {isSandbox && (
          <div
            style={{
              ...SECTION_LABEL,
              color: 'var(--dir-text-body-soft)',
              textTransform: 'none',
              letterSpacing: 0,
              fontSize: 11,
              fontWeight: 500,
              lineHeight: 1.4,
            }}
          >
            Sandbox — play with someone else’s doodle. Nothing here saves.
          </div>
        )}

        {/* MINI-DESK ROW (Sebs 2026-06-11): card on the left, controls on the
            right — the same side-by-side grammar as the big desk, so the
            surface reads as a miniature of it instead of a scrolling stack.
            flexWrap lets narrow viewports fall back to stacked. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'stretch', flex: '1 1 auto', minHeight: 0 }}>
          <div ref={cardColRef} style={{ flex: '1 1 300px', minWidth: 280, alignSelf: 'flex-start' }}>
            {card}
          </div>

          {/* The FULL control column (both modes) — header pinned, controls
              scroll internally when taller than the card. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              flex: '1 1 260px',
              minWidth: 240,
              borderLeft: '1px solid var(--dir-border)',
              paddingLeft: 18,
              // FILL the panel (Sebs 2026-06-27 "the property panel is cut off"):
              // the row stretches to the panel's height and this column fills it,
              // so the inner controls scroller gets the full height instead of the
              // short card's. The panel's own maxHeight (100vh-48) is the outer
              // guard; the inner scroller (below) absorbs any remaining overflow.
              minHeight: 0,
            }}
          >
            {/* 2D / 3D — flip THIS doodle to form, the same toggle the desk +
                restyle gallery use. Only when the doodle has flippable strokes
                (uploads stay 2D). Hidden during re-draw (you're editing the 2D
                strokes then). */}
            {can3d && !redrawing && (
              <div
                role="tablist"
                aria-label="2D and 3D"
                style={{
                  display: 'inline-flex',
                  alignSelf: 'flex-start',
                  gap: 4,
                  padding: 4,
                  borderRadius: 999,
                  border: '1px solid var(--dir-border)',
                  background: 'var(--dir-raised)',
                  flexShrink: 0,
                }}
              >
                {(['2d', '3d'] as const).map((m) => {
                  const active = (m === '3d') === view3d;
                  return (
                    <button
                      key={m}
                      onClick={() => {
                        const next = m === '3d';
                        // The 2D/3D choice is SAVEABLE (persists render_config.is3d
                        // → the desk places this object 3D on its own). Mark dirty
                        // so Done/Save actually writes it — without this the toggle
                        // left dirtyRef false and Save early-returned (Sebs
                        // 2026-06-16: "the 3d just doesn't save anywhere").
                        if (next !== (baseline.is3d === true)) markDirty();
                        setView3d(next);
                      }}
                      style={{
                        ...PILL,
                        padding: '4px 14px',
                        fontSize: 11,
                        border: 'none',
                        ...(active
                          ? { background: 'var(--dir-text-primary)', color: 'var(--dir-bg)' }
                          : { background: 'transparent' }),
                      }}
                    >
                      {m.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            )}
            {/* AI-mesh (hard path) — opt-in, modal-only. Generates a real GLB from
                this drawing (fal/TRELLIS) that the 3D view wears in place of the
                local form. Only when in 3D + the hard path is configured. */}
            {/* The Generate/Regenerate button lives ONLY in the add-doodle popup
                (Sebs 2026-06-16) — NEVER in the edit modal. The AI mesh's look
                toggles (AiMeshControlsEdit) still show below for an existing mesh. */}
            {view3d && hardPathOn && can3d && sourceImage && (
              <button
                onClick={generateAiMesh}
                disabled={meshStatus === 'working' || meshStatus === 'queued' || meshStatus === 'running'}
                title="Generate a real 3D mesh from this drawing (AI · ~1 min · uses a credit)"
                style={{ ...PILL, padding: '5px 14px', fontSize: 11, alignSelf: 'flex-start', flexShrink: 0 }}
              >
                {meshStatus === 'working' || meshStatus === 'queued' || meshStatus === 'running'
                  ? `✨ Generating…${meshStatus === 'queued' || meshStatus === 'running' ? ` (${meshStatus})` : ''}`
                  : hardMeshUrl
                    ? '✨ AI mesh ✓ — regenerate'
                    : meshStatus === 'failed'
                      ? '✨ Couldn’t generate — retry'
                      : '✨ Generate AI 3D'}
              </button>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 8,
                flexShrink: 0,
              }}
            >
              <span style={SECTION_LABEL}>{view3d ? '3D controls' : 'Restyle'}</span>
              {/* Quiet divergence note — Sandbox ONLY (nothing saves there).
                  Fixed slot (opacity, not mount) so the strip never jumps. */}
              {isSandbox && (
                <span
                  aria-hidden={!diverged}
                  style={{
                    fontFamily: IS,
                    fontSize: 10,
                    fontStyle: 'italic',
                    color: 'var(--dir-text-body-soft)',
                    whiteSpace: 'nowrap',
                    opacity: diverged ? 1 : 0,
                    transition: 'opacity 0.25s',
                  }}
                >
                  restyled locally — nothing saves
                </span>
              )}
            </div>

            <div
              style={{
                flex: '1 1 auto',
                minHeight: 0,
                overflowY: 'auto',
                paddingRight: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {/* In 3D the control column becomes the full 3D control set
                  (Canvas3DChrome — geometry / material / style), driving the
                  Live3DMount via Canvas3DProvider (Sebs: "add the 3d toggles
                  everywhere it's missing"). 2D = the per-style restyle set. */}
              {view3d ? (
                // UNIFIED 3D CONTROLS (Sebs 2026-06-27): mesh + non-mesh objects
                // get the SAME Canvas3DChrome — a GEOMETRY/FORM dropdown (the 'AI
                // mesh' form appears when a GLB exists; stroke forms rebuild from
                // the Quiver SVG) + a 3D STYLE / SURFACE picker. No more separate
                // "Look" dropdown or mesh-only panel; the AI mesh is its own FORM,
                // its default surface = Material (native). docs/submission/
                // AI-MESH-UNIFY-PLAN.md.
                <>
                  <Canvas3DChrome />
                  {/* SVG-PORT ports over the FULL 2D pen system (Sebs 2026-06-28 "svg
                      port PORTS OVER ALL THE SVG STUFF"). The same SurfaceControls the
                      2D restyle uses appear under the SVG-port surface, and their
                      style/wobble/weight/ink drive how the MESH'S OWN FORM is inked
                      (the line FEELING) — never the 2D drawing stamped on (the core
                      rule). The 3D engine reads these mods via the F3 context. */}
                  {engraveActive && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--dir-border)', paddingTop: 12, marginTop: 4 }}>
                      <span style={SECTION_LABEL}>SVG-port pen — the line feeling</span>
                      <SurfaceControls
                        svgStyle={surfStyle}
                        mods={surfMods}
                        onStyle={handleStyle}
                        onMod={setSurfMod}
                        onReset={handleReset}
                        onSmart={runSmartPick}
                        smartActive={smartOn}
                      />
                    </div>
                  )}
                </>
              ) : (
                <SurfaceControls
                  svgStyle={surfStyle}
                  mods={surfMods}
                  onStyle={handleStyle}
                  onMod={setSurfMod}
                  onReset={handleReset}
                  onSmart={runSmartPick}
                  smartActive={smartOn}
                />
              )}
            </div>
          </div>
        </div>

        {/* Quiet persist-fallback note (Edit) — shown when the config could
            not be written to the record (schema-v4 RPC absent / row not
            reachable). Honest: the restyle DID apply locally via onConfigSave. */}
        {!isSandbox && configNote && (
          <div
            style={{
              fontFamily: IS,
              fontSize: 10,
              fontStyle: 'italic',
              color: 'var(--dir-text-body-soft)',
            }}
          >
            saved locally — couldn’t reach the desk record (schema v4/v5)
          </div>
        )}

        {/* RE-DRAW STAGE — covers the card UI; the recorded gesture reloads
            into the live-styled canvas (rendered under THIS object's current
            edit-state config via the same nested-provider scope), editable.
            Done re-runs the create flow's markup path + persists via v5. */}
        {redrawing && (storedStrokes || redrawBackdrop) && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 5,
              background: 'var(--dir-raised)',
              borderRadius: 16,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={SECTION_LABEL}>{redrawBackdrop ? 'Draw over — add ink + shading on top; style stays on the right' : 'Re-draw — edit your strokes; style stays on the right'}</span>
              {/* NO Sketch/Style toggle (Sebs 2026-06-16, decided: keep redraw as
                  a stage rather than unify it into the create popup → the toggle is
                  redundant, the style controls already live in the main column).
                  redrawMode stays 'draw'. */}
            </div>
            {/* SHAPE INSERT quick-pick (Phase 2) — arm a shape → drag to place. */}
            {redrawMode === 'draw' && redrawRegister === 'ink' && (
              <div style={{ marginBottom: 8 }}>
                <ShapeStrip armedShape={redrawArmedShape} onArmShape={armRedrawShape} collapsed />
              </div>
            )}
            {/* DRAW-TOOL ROW — RE-DRAW is the third host of the shared
                DrawToolbar (Phase 0). Brings the Ink|Shade register, tone
                cluster, and Snap|Straighten shape-assist the create flow +
                /canvas already had — the "RE-DRAW missing tools" gap. */}
            <DrawToolbar
              variant="redraw"
              register={redrawRegister}
              eraseMode={redrawEraseMode}
              onEraseModeChange={setRedrawEraseMode}
              onRegisterChange={setRedrawRegister}
              registerDisabled={redrawMode === 'style'}
              registerDisabledTitle="Flip back to Sketch to keep working"
              shadeTool={redrawShadeTool}
              onShadeToolChange={setRedrawShadeTool}
              showSnap={redrawMode === 'draw'}
              snapEnabled={redrawRegister === 'ink' && redrawCount > 0}
              onSnapAction={runRedrawSnap}
              snapTitle={(act) =>
                redrawRegister === 'shade'
                  ? 'Snap works on ink — flip to Ink'
                  : redrawCount === 0
                    ? 'Draw a stroke first'
                    : act === 'snap'
                      ? 'Snap the last stroke to a clean shape'
                      : 'Crisp the last stroke’s edges (keeps your proportions)'
              }
              snapSwitcher={
                redrawOverride ? (
                  <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--dir-accent)' }} />
                    <button
                      style={{ ...PILL, fontFamily: IS, fontSize: 11, padding: '5px 12px', cursor: 'pointer', background: redrawSwitchAllOpen ? 'var(--dir-text-primary)' : 'var(--dir-bg)', color: redrawSwitchAllOpen ? 'var(--dir-bg)' : 'var(--dir-text-body)', border: '1px solid var(--dir-border)' }}
                      onClick={() => setRedrawSwitchAllOpen((v) => !v)}
                      title="Switch to another shape"
                    >
                      Snapped to {redrawOverride.switchSet[redrawOverride.appliedIndex]?.label ?? 'shape'} ▾
                    </button>
                    <button
                      style={{ ...PILL, fontFamily: IS, fontSize: 11, padding: '5px 10px', cursor: 'pointer', background: 'var(--dir-bg)', color: 'var(--dir-text-body-soft)', border: '1px solid var(--dir-border)' }}
                      onClick={() => setRedrawOverride(null)}
                      title="Done"
                    >
                      ✕
                    </button>
                    {redrawSwitchAllOpen && (
                      <SwitchPopover override={redrawOverride} onSwitchTo={applyRedrawOverrideEntry} onClose={() => setRedrawSwitchAllOpen(false)} />
                    )}
                  </div>
                ) : null
              }
              captionAlert={!!redrawFillNote}
              captionText={
                redrawFillNote ??
                (redrawMode === 'draw'
                  ? redrawRegister === 'shade'
                    ? redrawShadeTool.tool === 'fill'
                      ? redrawShadeTool.erase
                        ? 'erase fill — tap a region to lift its tone'
                        : 'tap inside a region to fill it — hold, then drag sideways to scrub Gap'
                      : redrawShadeTool.tool === 'lasso'
                        ? redrawShadeTool.erase
                          ? 'lasso erase — loop an area to lift its tone'
                          : 'lasso — draw a loop, it closes on release and fills'
                        : redrawShadeTool.erase
                          ? 'erasing tone — brush carves it back to paper'
                          : `brushing ${COVERAGE_BANDS[redrawShadeTool.band]?.name ?? 'mid'} tone — flat grey under your ink`
                    : 'raw ink — keep sketching'
                  : 'styled — play with the pen, flip back to keep drawing')
              }
            />
            {/* Center an ASPECT-LOCKED canvas (4:3, the 800×600 draw frame) — NOT
                a stretched fill. The wider popup made the fill-mode canvas
                landscape, so the 4:3 doodle read CROPPED/cut off (Sebs 2026-06-16:
                "object gets cropped off in the redraw"). Dropping `fill` uses
                DrawSurface's aspect-locked branch (maxWidth 920, 4:3), centered. */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <F3SvgStyleProvider>
                <F3RoughModifiersProvider>
                  <SurfaceRenderScope svgStyle={surfStyle} mods={surfMods}>
                    <DrawSurface
                      mode="svg"
                      input="draw"
                      hideActions
                      styled={redrawMode === 'style'}
                      initialStrokes={storedStrokes ?? []}
                      backdrop={redrawBackdrop}
                      editableParts={editableParts}
                      onEditedParts={(svg) => { editedPartsRef.current = svg; setPartsEdited(true); }}
                      initialToneFills={redrawInitialTone}
                      onStrokesChange={(st) => { redrawStrokesRef.current = st; setRedrawCount(st.length); }}
                      onToneFillsChange={(tf) => { redrawToneRef.current = tf; }}
                      shade={{
                        active: redrawMode === 'draw' && (redrawRegister === 'shade' || redrawRegister === 'erase'),
                        tool: redrawRegister === 'erase' ? 'brush' : redrawShadeTool.tool,
                        band: redrawRegister === 'erase' ? 0 : redrawShadeTool.band,
                        radius: redrawShadeTool.radius,
                        erase: redrawRegister === 'erase' ? true : redrawShadeTool.erase,
                        gap: redrawShadeTool.gap,
                      }}
                      eraseStrokes={redrawMode === 'draw' && redrawRegister === 'erase'}
                      eraseMode={redrawEraseMode}
                      onGapChange={(gap) => setRedrawShadeTool((prev) => (prev.gap === gap ? prev : { ...prev, gap }))}
                      onFillNote={showRedrawFillNote}
                      onSnapApi={(api) => { redrawSnapApiRef.current = api; }}
                      onSelectionChange={(id) => { if (id === null) setRedrawOverride(null); }}
                      armedShape={redrawArmedShape}
                      onShapeInserted={() => { setRedrawOverride(null); setRedrawArmedShape(null); }}
                    />
                  </SurfaceRenderScope>
                </F3RoughModifiersProvider>
              </F3SvgStyleProvider>
            </div>
            <footer style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button onClick={() => setRedrawing(false)} style={PILL}>Back</button>
              <button
                onClick={() => void handleRedrawDone()}
                disabled={(redrawCount === 0 && !partsEdited) || saving}
                style={{ ...CTA, opacity: (redrawCount === 0 && !partsEdited) || saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving…' : 'Done'}
              </button>
            </footer>
          </div>
        )}

        {/* EXPORT row (card features — Sebs 2026-06-13): the card detail modal
            is the PRIMARY export spot. SVG + PNG share-buttons for whatever the
            card currently shows; the transient note is the saved/fell-back
            receipt. Hidden while re-drawing (the card UI is covered then). */}
        {!redrawing && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderTop: '1px solid var(--dir-border)',
              paddingTop: 12,
            }}
          >
            <span style={SECTION_LABEL}>Export</span>
            {/* ONE Export ▾ button → a menu of formats (Sebs: no button clutter,
                Figma-style; the caret + menu makes the multi-options obvious).
                Opens UPWARD (the footer sits just below this row). */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setExportMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
                title="Export this doodle — card, SVG, or 3D model"
                style={{ ...PILL, padding: '6px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                Export <span aria-hidden style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
              </button>
              {exportMenuOpen && (
                <>
                  {/* click-away backdrop */}
                  <div
                    onClick={() => setExportMenuOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 5 }}
                  />
                  <div
                    role="menu"
                    style={{
                      position: 'absolute',
                      bottom: 'calc(100% + 6px)',
                      left: 0,
                      zIndex: 6,
                      minWidth: 210,
                      background: 'var(--dir-raised)',
                      border: '1px solid var(--dir-border)',
                      borderRadius: 12,
                      boxShadow: RAISED_SHADOW,
                      padding: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    <ExportMenuItem
                      label="Card image"
                      sub="PNG — framed card"
                      busy={exportingPng}
                      onClick={() => {
                        setExportMenuOpen(false);
                        void handleExportPng();
                      }}
                    />
                    <ExportMenuItem
                      label="Doodle"
                      sub="SVG — just the drawing"
                      onClick={() => {
                        setExportMenuOpen(false);
                        handleExportSvg();
                      }}
                    />
                    {can3d && (
                      <ExportMenuItem
                        label="3D model"
                        sub="GLB — opens in Blender, etc."
                        busy={exportingGlb}
                        onClick={() => {
                          setExportMenuOpen(false);
                          void handleExportGlb();
                        }}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
            {exportNote && (
              <span
                role="status"
                style={{
                  fontFamily: IS,
                  fontSize: 10,
                  fontStyle: 'italic',
                  color: 'var(--dir-text-body-soft)',
                  marginLeft: 'auto',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                }}
              >
                {exportNote}
              </span>
            )}
          </div>
        )}

        {/* ALSO SAVE TO (save-routing parity): owner-edit only. Saving the edit
            always writes back to THIS object; ticking Drawer/Shelf ALSO stashes a
            copy to your personal space. Multi-select — both, either, or neither.
            Mirrors the /desk DrawPanel place flow. Hidden while re-drawing. */}
        {allowDrawer && !isSandbox && !redrawing && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              borderTop: '1px solid var(--dir-border)',
              paddingTop: 12,
            }}
          >
            <span style={SECTION_LABEL}>Also save to</span>
            <div
              style={{
                display: 'inline-flex',
                gap: 4,
                padding: 4,
                borderRadius: 999,
                border: '1px solid var(--dir-border)',
                background: 'var(--dir-raised)',
              }}
            >
              <button
                type="button"
                aria-pressed={saveDrawer}
                onClick={() => setSaveDrawer((v) => !v)}
                style={{
                  ...PILL,
                  padding: '4px 14px',
                  fontSize: 12,
                  border: 'none',
                  ...(saveDrawer
                    ? { background: 'var(--dir-text-primary)', color: 'var(--dir-bg)' }
                    : { background: 'transparent' }),
                }}
              >
                Drawer
              </button>
              <button
                type="button"
                aria-pressed={saveShelf}
                onClick={() => setSaveShelf((v) => !v)}
                style={{
                  ...PILL,
                  padding: '4px 14px',
                  fontSize: 12,
                  border: 'none',
                  ...(saveShelf
                    ? { background: 'var(--dir-text-primary)', color: 'var(--dir-bg)' }
                    : { background: 'transparent' }),
                }}
              >
                Shelf
              </button>
            </div>
          </div>
        )}

        <footer style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          {isSandbox ? (
            // Just Close in Sandbox for now. The "Remix as mine" button returns
            // when the fork-into-new-owned-object write lands (no greyed stub).
            <button onClick={requestClose} style={PILL}>Close</button>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={onDelete}
                  disabled={!onDelete}
                  title="Remove this doodle from the desk"
                  style={{ ...PILL, borderColor: 'var(--dir-border)', color: 'var(--dir-text-body-soft)' }}
                >
                  Delete
                </button>
                {(storedStrokes || redrawBackdrop) ? (
                  <button
                    onClick={() => {
                      redrawStrokesRef.current = [];
                      setRedrawCount(0);
                      setRedrawMode('draw');
                      // Reset the shared-toolbar tool state for a clean re-draw
                      // session (register/snap/tone start fresh; tone reseeds
                      // from the object's stored fills via initialToneFills).
                      setRedrawRegister('ink');
                      setRedrawShadeTool(SHADE_TOOL_DEFAULT);
                      setRedrawOverride(null);
                      setRedrawSwitchAllOpen(false);
                      setRedrawFillNote(null);
                      // Stroke re-draw reseeds the object's tone; backdrop draw-over
                      // (upload/legacy) starts with a clean tone layer over the art.
                      redrawToneRef.current = storedStrokes ? (redrawInitialTone ?? []) : [];
                      setRedrawing(true);
                    }}
                    disabled={saving}
                    title={storedStrokes ? 'Reopen the drawing with your original strokes' : 'Draw new ink + shading over this'}
                    style={PILL}
                  >
                    {storedStrokes ? 'Re-draw' : 'Draw over'}
                  </button>
                ) : (
                  <span
                    style={{
                      fontFamily: IS,
                      fontSize: 10,
                      fontStyle: 'italic',
                      color: 'var(--dir-text-body-soft)',
                    }}
                  >
                    can’t re-edit this one
                  </span>
                )}
              </div>
              <button
                onClick={() => void handleDone()}
                disabled={saving}
                title="Save your edits — restyle, name, or re-draw — back to this doodle"
                style={{ ...CTA, opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
    </Canvas3DProvider>
  );
}
