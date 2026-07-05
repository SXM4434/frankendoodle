// SmartHachureChrome — restyled for Desk Doodles vertical right-panel context.
//
// PRESERVES verbatim from Hero8Shell.tsx (the functional truth):
//   - Cluster groupings per 09-LOCKED-MODEL.md I-13
//   - has() conditional reveal per MODIFIER_SETS_BY_STYLE
//   - sub-conditionals (hachureGap only if fillStyle hachure-family,
//     sketchingStyle only if multiStroke != off/single, etc.)
//   - All modifier wirings via setMod
//   - applyStylePreset for Reset
//
// CHANGES from Hero8 for app-context:
//   - Vertical sections (Hero8 was horizontal cluster rows that worked in a top
//     toolbar but broke in a vertical side panel)
//   - Each control on its own row, full-width-ish
//   - Section headers as visible H labels per cluster
//   - Sliders show label + value inline, full-width track below
//   - Reset to preset = bottom of panel, full-width button
//   - Cluster sections collapse/expand from the header row (persisted via
//     usePanelOpen); the Style master dropdown stays always visible (21 §9)
import { type CSSProperties, type ReactNode } from 'react';
import { IS } from '../../lib/typography';
import { PILL, SECTION_LABEL } from '../../lib/chromeStyles';
import { Dropdown } from './Dropdown';
import { Slider } from './Slider';
import { usePanelOpen } from './CollapsiblePanel';
import { useF3SvgStyle, F3_SVG_STYLES } from '../../state/F3SvgStyleContext';
import {
  useF3RoughModifiers,
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
import { applyStylePreset } from '../canvas/SvgStyleTransform';
import { SLIDER_SPECS, MODIFIER_SETS_BY_STYLE, UNIVERSAL_MODIFIERS } from './modifierSpecs';

const SECTION_NOTE: CSSProperties = {
  fontFamily: IS,
  fontSize: 10,
  color: 'var(--dir-text-body-soft)',
  margin: 0,
  fontStyle: 'italic',
};

function Section({ title, note, collapseKey, defaultOpen = true, children }: {
  title: string;
  note?: string;
  /** When set, the header row toggles the body (persisted via usePanelOpen).
   *  Omit to pin the section always-open — the Style master control. */
  collapseKey?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  // Hook is called unconditionally (rules of hooks); pinned sections ignore it.
  const [open, toggle] = usePanelOpen(collapseKey ?? 'shc.cluster.style', defaultOpen);
  const expanded = !collapseKey || open;
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '18px 18px',
        borderBottom: '1px solid var(--dir-border)',
      }}
    >
      {collapseKey ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
            width: '100%',
            margin: 0,
            padding: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={SECTION_LABEL}>{title}</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            {note && <span style={SECTION_NOTE}>{note}</span>}
            <span aria-hidden style={SECTION_LABEL}>{open ? '▾' : '▸'}</span>
          </span>
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={SECTION_LABEL}>{title}</h3>
          {note && <span style={SECTION_NOTE}>{note}</span>}
        </div>
      )}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
      )}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        // Override Dropdown width — fill row.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any}
    >
      {children}
    </div>
  );
}

export function SmartHachureChrome() {
  const { state: svgStyle, setState: setSvgStyle } = useF3SvgStyle();
  const { state: mods, set: setMod } = useF3RoughModifiers();

  const declared = MODIFIER_SETS_BY_STYLE[svgStyle] ?? UNIVERSAL_MODIFIERS;
  const has = (k: keyof typeof SLIDER_SPECS | string) => declared.includes(k);

  // For convenient sub-grouping inside Multi-Stroke section
  const hasMultiStrokeBlock =
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        fontFamily: IS,
        color: 'var(--dir-text-body)',
      }}
    >
      {/* STYLE PICKER */}
      <Section title="Style">
        <Dropdown
          label="SVG style"
          value={svgStyle}
          sections={[{
            heading: 'SVG render style',
            options: F3_SVG_STYLES.map((s) => ({ value: s.id, label: s.label, detail: s.detail })),
          }]}
          onChange={(v) => {
            const nextStyle = v as typeof svgStyle;
            setSvgStyle(nextStyle);
            // Auto-snap modifiers to the new style's preset (locked decision
            // 2026-06-02, never landed). Without this, picking newsprint /
            // wet-ink / etc. shows the GLOBAL defaults instead of the style's
            // own calibration, so styles look near-clean until user clicks
            // Reset. Captured by /audit visual scan 2026-06-08.
            const next = applyStylePreset(mods, nextStyle);
            (Object.keys(next) as (keyof typeof next)[]).forEach((k) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              setMod(k, (next as any)[k]);
            });
          }}
          width={undefined}
          popoverWidth={360}
        />
      </Section>

      {/* MULTI-STROKE — Cluster 1 per I-13 */}
      {hasMultiStrokeBlock && (
        <Section title="Multi-stroke" note="Path / motion · cluster 1" collapseKey="shc.cluster.multi-stroke">
          {has('multiStroke') && (
            <Row>
              <Dropdown
                label="Multi-stroke"
                value={mods.multiStroke}
                sections={[{
                  heading: 'Multi-stroke',
                  options: MULTI_STROKE_STEPS.map((s) => ({ value: s, label: s })),
                }]}
                onChange={(v) => setMod('multiStroke', v as MultiStrokeStep)}
                popoverWidth={220}
              />
            </Row>
          )}
          {has('endpointBehavior') && (
            <Row>
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
                onChange={(v) => setMod('endpointBehavior', v as EndpointBehaviorStep)}
                popoverWidth={320}
              />
            </Row>
          )}
          {has('sketchingStyle') && mods.multiStroke !== 'off' && mods.multiStroke !== 'single' && (
            <Row>
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
                onChange={(v) => setMod('sketchingStyle', v as SketchingStyleStep)}
                popoverWidth={340}
              />
            </Row>
          )}
          {has('penTip') && (
            <Row>
              <Dropdown
                label="Pen tip"
                value={mods.penTip}
                sections={[{
                  heading: 'Pen-tip preset (perfect-freehand)',
                  // All 8 presets are REAL — penTipPath (handFeel.ts) feeds the
                  // outline through perfect-freehand getStroke with distinct
                  // per-preset size/thinning/smoothing/taper/pressureJitter
                  // (PEN_TIP_PRESETS, handFeel.ts ~477). Visually verified
                  // distinct 2026-06-11 (playwright stroke-render comparison).
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
                onChange={(v) => setMod('penTip', v as PenTipStep)}
                popoverWidth={360}
              />
            </Row>
          )}
          {has('wobble') && (
            <Slider
              label={mods.wobble > 1.4 ? 'Wobble ⚠ Excalidraw zone' : 'Wobble'}
              value={mods.wobble}
              min={SLIDER_SPECS.wobble.min}
              max={SLIDER_SPECS.wobble.max}
              step={SLIDER_SPECS.wobble.step}
              onChange={(v) => setMod('wobble', v)}
            />
          )}
          {has('jaggedness') && (
            <Slider
              label="Jaggedness"
              value={mods.jaggedness}
              min={SLIDER_SPECS.jaggedness.min}
              max={SLIDER_SPECS.jaggedness.max}
              step={SLIDER_SPECS.jaggedness.step}
              onChange={(v) => setMod('jaggedness', v)}
            />
          )}
          {has('simplification') && (
            <Slider
              label="Simplify"
              title="Geometry fidelity on drawn/uploaded paths: low = faithful (keeps every wiggle), high = essential (smooths to clean lines). 1.0 = today's baseline."
              value={mods.simplification}
              min={SLIDER_SPECS.simplification.min}
              max={SLIDER_SPECS.simplification.max}
              step={SLIDER_SPECS.simplification.step}
              onChange={(v) => setMod('simplification', v)}
            />
          )}
          {has('bowing') && (
            <Slider label="Bowing" value={mods.bowing} min={SLIDER_SPECS.bowing.min} max={SLIDER_SPECS.bowing.max} step={SLIDER_SPECS.bowing.step} onChange={(v) => setMod('bowing', v)} />
          )}
          {has('strokeWidth') && (
            <Slider label="Stroke width" value={mods.strokeWidth} min={SLIDER_SPECS.strokeWidth.min} max={SLIDER_SPECS.strokeWidth.max} step={SLIDER_SPECS.strokeWidth.step} onChange={(v) => setMod('strokeWidth', v)} />
          )}
          {has('curveDamp') && (
            <Slider label="Curve" title="Above ~0.8 straightens curves enough that Bowing reads as off (spec §6.7)" value={mods.curveDamp} min={SLIDER_SPECS.curveDamp.min} max={SLIDER_SPECS.curveDamp.max} step={SLIDER_SPECS.curveDamp.step} onChange={(v) => setMod('curveDamp', v)} />
          )}
        </Section>
      )}

      {/* SHADING — Cluster 3 per I-13 */}
      {hasShadingBlock && (
        <Section title="Shading" note="Fill style + density · cluster 3" collapseKey="shc.cluster.shading">
          {has('fillStyle') && (
            <Row>
              <Dropdown
                label="Fill style"
                value={mods.fillStyle}
                sections={[{
                  heading: 'Fill style',
                  options: FILL_STYLE_STEPS.map((s) => ({ value: s, label: s })),
                }]}
                onChange={(v) => setMod('fillStyle', v as FillStyleStep)}
                popoverWidth={240}
              />
            </Row>
          )}
          {has('hachureGap') && (mods.fillStyle === 'hachure' || mods.fillStyle === 'cross-hatch' || mods.fillStyle === 'zigzag-line' || mods.fillStyle === 'zigzag' || mods.fillStyle === 'dashed') && (
            <Slider label="Hachure gap" value={mods.hachureGap} min={SLIDER_SPECS.hachureGap.min} max={SLIDER_SPECS.hachureGap.max} step={SLIDER_SPECS.hachureGap.step} unit="px" onChange={(v) => setMod('hachureGap', v)} />
          )}
          {has('hachureAngle') && (mods.fillStyle === 'hachure' || mods.fillStyle === 'cross-hatch' || mods.fillStyle === 'dashed' || mods.fillStyle === 'zigzag-line') && (
            <Slider label="Hachure angle" value={mods.hachureAngle} min={SLIDER_SPECS.hachureAngle.min} max={SLIDER_SPECS.hachureAngle.max} step={SLIDER_SPECS.hachureAngle.step} unit="°" onChange={(v) => setMod('hachureAngle', v)} />
          )}
          {has('fillDensity') && mods.fillStyle !== 'none' && (
            <Slider label="Fill density" value={mods.fillDensity} min={SLIDER_SPECS.fillDensity.min} max={SLIDER_SPECS.fillDensity.max} step={SLIDER_SPECS.fillDensity.step} onChange={(v) => setMod('fillDensity', v)} />
          )}
        </Section>
      )}

      {/* SURFACE TEXTURE — Cluster 4 per I-13 */}
      {hasSurfaceBlock && (
        <Section title="Surface texture" note="Substrate / grain / register · cluster 4" collapseKey="shc.cluster.surface-texture" defaultOpen={false}>
          {has('blurAmount') && <Slider label="Blur amount" value={mods.blurAmount} min={SLIDER_SPECS.blurAmount.min} max={SLIDER_SPECS.blurAmount.max} step={SLIDER_SPECS.blurAmount.step} onChange={(v) => setMod('blurAmount', v)} />}
          {has('bleed') && <Slider label="Bleed" value={mods.bleed} min={SLIDER_SPECS.bleed.min} max={SLIDER_SPECS.bleed.max} step={SLIDER_SPECS.bleed.step} onChange={(v) => setMod('bleed', v)} />}
          {has('dotSize') && <Slider label="Dot size" value={mods.dotSize} min={SLIDER_SPECS.dotSize.min} max={SLIDER_SPECS.dotSize.max} step={SLIDER_SPECS.dotSize.step} onChange={(v) => setMod('dotSize', v)} />}
          {has('dotSpacing') && <Slider label="Dot spacing" value={mods.dotSpacing} min={SLIDER_SPECS.dotSpacing.min} max={SLIDER_SPECS.dotSpacing.max} step={SLIDER_SPECS.dotSpacing.step} unit="px" onChange={(v) => setMod('dotSpacing', v)} />}
          {has('dotScatter') && <Slider label="Dot scatter" value={mods.dotScatter} min={SLIDER_SPECS.dotScatter.min} max={SLIDER_SPECS.dotScatter.max} step={SLIDER_SPECS.dotScatter.step} onChange={(v) => setMod('dotScatter', v)} />}
          {has('dotPattern') && (
            <Row>
              <Dropdown
                label="Dot pattern"
                value={mods.dotPattern}
                sections={[{ heading: 'Dot pattern', options: DOT_PATTERN_STEPS.map((s) => ({ value: s, label: s })) }]}
                onChange={(v) => setMod('dotPattern', v as DotPatternStep)}
                popoverWidth={220}
              />
            </Row>
          )}
          {has('grainIntensity') && <Slider label="Grain" value={mods.grainIntensity} min={SLIDER_SPECS.grainIntensity.min} max={SLIDER_SPECS.grainIntensity.max} step={SLIDER_SPECS.grainIntensity.step} onChange={(v) => setMod('grainIntensity', v)} />}
          {has('smudgeAmount') && <Slider label="Smudge" value={mods.smudgeAmount} min={SLIDER_SPECS.smudgeAmount.min} max={SLIDER_SPECS.smudgeAmount.max} step={SLIDER_SPECS.smudgeAmount.step} onChange={(v) => setMod('smudgeAmount', v)} />}
          {has('pressureVariance') && <Slider label="Pressure variance" value={mods.pressureVariance} min={SLIDER_SPECS.pressureVariance.min} max={SLIDER_SPECS.pressureVariance.max} step={SLIDER_SPECS.pressureVariance.step} onChange={(v) => setMod('pressureVariance', v)} />}
          {has('offsetDistance') && <Slider label="Offset distance" value={mods.offsetDistance} min={SLIDER_SPECS.offsetDistance.min} max={SLIDER_SPECS.offsetDistance.max} step={SLIDER_SPECS.offsetDistance.step} unit="px" onChange={(v) => setMod('offsetDistance', v)} />}
          {has('offsetAngle') && <Slider label="Offset angle" value={mods.offsetAngle} min={SLIDER_SPECS.offsetAngle.min} max={SLIDER_SPECS.offsetAngle.max} step={SLIDER_SPECS.offsetAngle.step} unit="°" onChange={(v) => setMod('offsetAngle', v)} />}
          {has('colorShift') && <Slider label="Color shift" value={mods.colorShift} min={SLIDER_SPECS.colorShift.min} max={SLIDER_SPECS.colorShift.max} step={SLIDER_SPECS.colorShift.step} onChange={(v) => setMod('colorShift', v)} />}
          {has('risoSecondaryColor') && (
            <Row>
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
                onChange={(v) => setMod('risoSecondaryColor', v as PaletteModeStep)}
                popoverWidth={340}
              />
            </Row>
          )}
          {has('registrationError') && <Slider label="Registration error" value={mods.registrationError} min={SLIDER_SPECS.registrationError.min} max={SLIDER_SPECS.registrationError.max} step={SLIDER_SPECS.registrationError.step} onChange={(v) => setMod('registrationError', v)} />}
        </Section>
      )}

      {/* COLOR / PALETTE — Cluster 5 per I-13 */}
      <Section title="Color / palette" note="Ink + palette overrides · cluster 5" collapseKey="shc.cluster.color-palette" defaultOpen={false}>
        {has('inkIntensity') && <Slider label="Ink intensity" value={mods.inkIntensity} min={SLIDER_SPECS.inkIntensity.min} max={SLIDER_SPECS.inkIntensity.max} step={SLIDER_SPECS.inkIntensity.step} onChange={(v) => setMod('inkIntensity', v)} />}
        {has('fillOpacity') && <Slider label="Fill opacity" value={mods.fillOpacity} min={SLIDER_SPECS.fillOpacity.min} max={SLIDER_SPECS.fillOpacity.max} step={SLIDER_SPECS.fillOpacity.step} onChange={(v) => setMod('fillOpacity', v)} />}
        {has('strokePalette') && (
          <>
            <Row>
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
                onChange={(v) => setMod('strokePalette', v as PaletteModeStep)}
                popoverWidth={320}
              />
            </Row>
            <Row>
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
                onChange={(v) => setMod('fillPalette', v as PaletteModeStep)}
                popoverWidth={320}
              />
            </Row>
          </>
        )}
        {has('texture') && svgStyle !== 'wet-ink' && svgStyle !== 'charcoal' && (
          <Row>
            <Dropdown
              label="Texture"
              value={mods.texture}
              sections={[{ heading: 'Texture', options: TEXTURE_STEPS.map((s) => ({ value: s, label: s })) }]}
              onChange={(v) => setMod('texture', v as TextureStep)}
              popoverWidth={260}
            />
          </Row>
        )}
        {has('textureIntensity') && (mods.texture !== 'none' || svgStyle === 'wet-ink' || svgStyle === 'charcoal') && (
          <Slider label="Texture intensity" value={mods.textureIntensity} min={SLIDER_SPECS.textureIntensity.min} max={SLIDER_SPECS.textureIntensity.max} step={SLIDER_SPECS.textureIntensity.step} onChange={(v) => setMod('textureIntensity', v)} />
        )}
      </Section>

      {/* Reset — bottom, full-width */}
      <div style={{ padding: '18px' }}>
        <button
          onClick={() => {
            // Reset = DEFAULT baseline + this style's preset — NOT current
            // state + preset. Presets don't carry penTip / endpointBehavior /
            // sketchingStyle / palettes, so merging onto current state left
            // those untouched and Reset visibly "did nothing" after changing
            // them (Sebs 2026-06-11). Building from DEFAULT_MODIFIERS resets
            // every axis to the style's true baseline.
            const next = applyStylePreset(DEFAULT_MODIFIERS, svgStyle);
            Object.keys(next).forEach((k) => {
              const key = k as keyof typeof next;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              setMod(key, (next as any)[key]);
            });
          }}
          title={`Reset modifiers to the ${svgStyle} style preset`}
          style={{
            ...PILL,
            width: '100%',
            padding: '10px 16px',
            background: 'var(--dir-bg)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--dir-raised)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--dir-bg)')}
        >
          Reset to {svgStyle} preset
        </button>
      </div>
    </div>
  );
}
