// TEMPORARY DIAGNOSTIC — empty-poster bug (psPoster/pitchDeckCover/ppvPoster/
// framedMoviePoster render as empty outline under rough/bold/sketchy).
// Mounts the EXACT poster markup, runs the REAL signals + classifier per region,
// dumps to window.__dd_posterDiag. Delete after diagnosis. NOT a product route.
import { useEffect, useRef } from 'react';
import { extractSignals } from '../../lib/smartHachure/signals';
import { classify, ruleEngineProvider, RULE_REGISTRY } from '../../lib/smartHachure/classifier';
import { getRenderableChildren } from '../../lib/smartHachure/signals';
import { renderSmartHachure } from '../../lib/smartHachure';
import { DEFAULT_MODIFIERS } from '../../state/F3RoughModifiersContext';
import { applyStylePreset } from '../canvas/SvgStyleTransform';
import type { SmartHachureStyle } from '../../lib/smartHachure/techniqueMap';
import type { F3SvgStyle } from '../../state/F3SvgStyleContext';

const RENDER_STYLES: SmartHachureStyle[] = ['rough-handdrawn', 'bold-ink', 'sketchy'];

const STROKE = 'var(--dir-text-primary)';
const WASH = 'color-mix(in oklab, var(--dir-text-primary) 8%, transparent)';
const BG = 'var(--dir-bg)';
const IS = 'system-ui';

// Exact markup copied verbatim from PinShape.tsx for the 4 broken posters
// + 3 LIGHT wash-bordered cards (the no-regression control set).
const FIXTURES: { id: string; klass: 'poster' | 'light-card'; vb: string; svg: string }[] = [
  {
    id: 'pitchDeckCover',
    klass: 'poster',
    vb: '0 0 100 75',
    svg: `<rect x="3" y="3" width="94" height="69" fill="${STROKE}" />
      <text x="50" y="32" text-anchor="middle" font-family="${IS}" font-size="10" font-weight="500" fill="${BG}">ION</text>
      <text x="50" y="46" text-anchor="middle" font-family="${IS}" font-size="6" font-weight="500" fill="${BG}" letter-spacing="0.2em">YC W24</text>
      <line x1="36" y1="54" x2="64" y2="54" stroke="${BG}" stroke-width="0.8" />`,
  },
  {
    id: 'framedMoviePoster',
    klass: 'poster',
    vb: '0 0 70 100',
    svg: `<rect x="3" y="3" width="64" height="94" fill="${STROKE}" />
      <rect x="10" y="14" width="50" height="56" fill="${BG}" stroke="${BG}" />
      <text x="35" y="32" text-anchor="middle" font-family="${IS}" font-size="6" font-weight="500" fill="${STROKE}" letter-spacing="0.15em">FILM</text>
      <line x1="22" y1="40" x2="48" y2="40" stroke="${STROKE}" stroke-width="0.6" />
      <text x="35" y="84" text-anchor="middle" font-family="${IS}" font-size="5" font-weight="500" fill="${BG}" letter-spacing="0.1em">A FILM BY</text>`,
  },
  {
    id: 'psPoster',
    klass: 'poster',
    vb: '0 0 70 100',
    svg: `<rect x="3" y="3" width="64" height="94" fill="${STROKE}" />
      <text x="35" y="50" text-anchor="middle" font-family="${IS}" font-size="14" font-weight="500" fill="${BG}" letter-spacing="0.1em">PS</text>
      <line x1="22" y1="58" x2="48" y2="58" stroke="${BG}" stroke-width="1" />
      <text x="35" y="74" text-anchor="middle" font-family="${IS}" font-size="6" font-weight="500" fill="${BG}" letter-spacing="0.15em">EXCLUSIVE</text>`,
  },
  {
    id: 'ppvPoster',
    klass: 'poster',
    vb: '0 0 70 100',
    svg: `<rect x="3" y="3" width="64" height="94" fill="${STROKE}" />
      <text x="35" y="32" text-anchor="middle" font-family="${IS}" font-size="9" font-weight="500" fill="${BG}" letter-spacing="0.12em">WRESTLE</text>
      <text x="35" y="46" text-anchor="middle" font-family="${IS}" font-size="9" font-weight="500" fill="${BG}" letter-spacing="0.12em">MANIA</text>
      <line x1="14" y1="54" x2="56" y2="54" stroke="${BG}" stroke-width="1.2" />
      <text x="35" y="78" text-anchor="middle" font-family="${IS}" font-size="16" font-weight="500" fill="${BG}" letter-spacing="0.1em">XL</text>
      <text x="35" y="92" text-anchor="middle" font-family="${IS}" font-size="5" font-weight="500" fill="${BG}" letter-spacing="0.18em">APRIL 7</text>`,
  },
  // LIGHT wash-bordered cards — these MUST stay structural-frame (no regression)
  {
    id: 'tradingCard',
    klass: 'light-card',
    vb: '0 0 70 100',
    svg: `<rect x="3" y="3" width="64" height="94" rx="4" fill="${WASH}" stroke="${STROKE}" stroke-width="1.5" />
      <circle cx="35" cy="35" r="16" fill="transparent" stroke="${STROKE}" stroke-width="1" />
      <text x="35" y="40" text-anchor="middle" font-family="${IS}" font-size="9" font-weight="500" fill="${STROKE}">★</text>
      <text x="35" y="68" text-anchor="middle" font-family="${IS}" font-size="8" font-weight="500" fill="${STROKE}">HP 60</text>`,
  },
  {
    id: 'framedFlyer',
    klass: 'light-card',
    vb: '0 0 80 100',
    svg: `<rect x="3" y="3" width="74" height="94" fill="${WASH}" stroke="${STROKE}" stroke-width="1.5" />
      <rect x="12" y="14" width="56" height="14" fill="${STROKE}" />
      <text x="40" y="24" text-anchor="middle" font-family="${IS}" font-size="9" font-weight="500" fill="${BG}" letter-spacing="0.05em">PUNK</text>
      <line x1="14" y1="60" x2="66" y2="60" stroke="${STROKE}" stroke-width="0.5" />
      <line x1="14" y1="68" x2="60" y2="68" stroke="${STROKE}" stroke-width="0.5" />
      <line x1="14" y1="76" x2="56" y2="76" stroke="${STROKE}" stroke-width="0.5" />
      <text x="40" y="92" text-anchor="middle" font-family="${IS}" font-size="6" font-weight="500" fill="${STROKE}">FREE</text>`,
  },
  {
    id: 'controllerShadowBox',
    klass: 'light-card',
    vb: '0 0 100 80',
    svg: `<rect x="3" y="3" width="94" height="74" fill="${WASH}" stroke="${STROKE}" stroke-width="1.5" />
      <path d="M28 30 Q18 30 18 42 Q18 58 32 58 Q44 58 48 50 L62 50 Q66 58 78 58 Q92 58 92 42 Q92 30 82 30 Q72 30 68 38 L42 38 Q38 30 28 30 Z" fill="${BG}" stroke="${STROKE}" stroke-width="1.2" />
      <circle cx="32" cy="42" r="3" fill="transparent" stroke="${STROKE}" stroke-width="0.7" />
      <circle cx="78" cy="46" r="3" fill="transparent" stroke="${STROKE}" stroke-width="0.7" />`,
  },
];

export function PosterDiag() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const out: Record<string, unknown>[] = [];

    for (const fx of FIXTURES) {
      const svg = host.querySelector(`svg[data-fx="${fx.id}"]`) as SVGSVGElement | null;
      if (!svg) continue;
      const vb = svg.viewBox.baseVal;
      const rootParentBBox =
        vb && vb.width > 0 ? { x: vb.x, y: vb.y, w: vb.width, h: vb.height } : null;
      const children = getRenderableChildren(svg);
      children.forEach((child, i) => {
        const signals = extractSignals(child, {
          parentBBox: rootParentBBox,
          siblings: children,
          zIndex: i,
        });
        const ctx = {
          svgHash: fx.id,
          regionPath: `${child.tagName.toLowerCase()}[${i}]`,
          parentClassification: null,
          confidenceThreshold: 0.7,
        };
        const result = classify(signals, ctx, [ruleEngineProvider], {
          get: () => undefined,
        } as unknown as Parameters<typeof classify>[3]);
        // Inspect EVERY rule's firing (id → role/confidence or null) so we can
        // see exactly which rule won and which dark-gate branch did/didn't fire.
        const firings = RULE_REGISTRY.map((rule) => {
          const f = rule.evaluate(signals, ctx);
          return { id: rule.id, fired: f ? { role: f.role, confidence: f.confidence } : null };
        }).filter((r) => r.fired !== null);
        out.push({
          fixture: fx.id,
          klass: fx.klass,
          region: ctx.regionPath,
          tag: signals.tag,
          zIndex: signals.zIndex,
          darknessL: Number(signals.darknessL.toFixed(3)),
          fill: signals.fill,
          stroke: signals.stroke,
          areaFractionOfParent: Number(signals.areaFractionOfParent.toFixed(3)),
          enclosesSiblingCount: signals.enclosesSiblingCount,
          containedInZIndex: signals.containedInZIndex,
          aspectRatio: Number(signals.aspectRatio.toFixed(2)),
          area: Number(signals.area.toFixed(1)),
          role: result.role,
          confidence: Number(result.confidence.toFixed(2)),
          firedRules: result.firedRules,
          allFirings: firings,
        });
      });
    }

    // ── RENDER-SIDE PASS — run the FULL renderSmartHachure pipeline on a
    //    visible clone of each fixture under all 3 styles. Inspect the output
    //    DOM: how many fill marks the dark rect[0] produced, their fillStyle +
    //    coverage receipts. THIS is where the empty-poster bug must surface if
    //    it's downstream of classification.
    const renderOut: Record<string, unknown>[] = [];
    const renderHost = host.querySelector('[data-render-host]') as HTMLDivElement;
    const CELL = 170;
    for (const fx of FIXTURES) {
      // One labeled row per fixture: [Clean] [rough] [bold] [sketchy].
      const row = document.createElement('div');
      row.setAttribute('data-fx-row', fx.id);
      row.style.cssText =
        'display:flex; align-items:flex-start; gap:10px; margin-bottom:6px; border-bottom:1px solid #e7e2d8; padding-bottom:6px;';
      const rowLabel = document.createElement('div');
      rowLabel.style.cssText =
        'width:120px; font:11px system-ui; color:#444; padding-top:60px;';
      rowLabel.textContent = `${fx.id}\n(${fx.klass})`;
      rowLabel.style.whiteSpace = 'pre';
      row.appendChild(rowLabel);

      const makeCell = (label: string) => {
        const cell = document.createElement('div');
        cell.style.cssText = `width:${CELL}px; text-align:center;`;
        const cap = document.createElement('div');
        cap.style.cssText = 'font:10px system-ui; color:#888; margin-bottom:2px;';
        cap.textContent = label;
        cell.appendChild(cap);
        return cell;
      };

      // CLEAN reference — source markup untransformed.
      {
        const cleanCell = makeCell('Clean');
        const cleanSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        cleanSvg.setAttribute('viewBox', fx.vb);
        cleanSvg.setAttribute('width', String(CELL));
        cleanSvg.setAttribute('height', String(CELL));
        cleanSvg.style.cssText = 'background:#FDFCF9; border:1px solid #ddd;';
        cleanSvg.innerHTML = fx.svg;
        cleanCell.appendChild(cleanSvg);
        row.appendChild(cleanCell);
      }

      for (const style of RENDER_STYLES) {
        const cell = makeCell(style);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', fx.vb);
        svg.setAttribute('width', String(CELL));
        svg.setAttribute('height', String(CELL));
        svg.style.cssText = 'background:#FDFCF9; border:1px solid #ddd;';
        svg.innerHTML = fx.svg;
        cell.appendChild(svg);
        row.appendChild(cell);
        renderHost.appendChild(row);
        const mods = applyStylePreset(DEFAULT_MODIFIERS, style as unknown as F3SvgStyle);
        renderSmartHachure(svg, mods, {
          styleChoice: style,
          inkColor: '#1a1a1a',
          surface: 'audit',
        });
        // Inspect: every smart-hachure fill group + its receipts.
        const fillGroups = Array.from(svg.querySelectorAll('[data-smart-hachure]'));
        const darkRoleGroups = fillGroups.filter(
          (g) => g.getAttribute('data-smart-role') === 'dense-tonal',
        );
        // Count actual rendered path segments inside the dark groups (rough.js
        // emits <path> children; empty group = no marks = empty poster).
        let darkPathCount = 0;
        for (const g of darkRoleGroups) {
          darkPathCount += g.querySelectorAll('path').length;
        }
        const receipts = darkRoleGroups.map((g) => ({
          fillStyle: g.getAttribute('data-smart-fill-style'),
          gap: g.getAttribute('data-smart-gap'),
          weight: g.getAttribute('data-smart-weight'),
          coverage: g.getAttribute('data-smart-coverage'),
          band: g.getAttribute('data-smart-band'),
          opacity: g.getAttribute('opacity'),
          innerPaths: g.querySelectorAll('path').length,
          tag: g.tagName.toLowerCase(),
        }));
        renderOut.push({
          fixture: fx.id,
          klass: fx.klass,
          style,
          totalSmartGroups: fillGroups.length,
          darkRoleGroupCount: darkRoleGroups.length,
          darkPathCount,
          receipts,
        });
      }
    }

    (window as unknown as { __dd_posterDiag: unknown }).__dd_posterDiag = out;
    (window as unknown as { __dd_posterRender: unknown }).__dd_posterRender = renderOut;
    // eslint-disable-next-line no-console
    console.log('POSTER_DIAG_READY', JSON.stringify({ classify: out, render: renderOut }));
    host.setAttribute('data-diag-ready', '1');
  }, []);

  return (
    <div ref={hostRef} data-poster-diag style={{ padding: 20, background: '#fff' }}>
      {FIXTURES.map((fx) => (
        <svg
          key={fx.id}
          data-fx={fx.id}
          viewBox={fx.vb}
          width={120}
          height={120}
          style={{ position: 'absolute', left: -9999, top: -9999 }}
          dangerouslySetInnerHTML={{ __html: fx.svg }}
        />
      ))}
      <div data-render-host style={{ display: 'flex', flexDirection: 'column', gap: 0 }} />
      <div>poster diag mounted</div>
    </div>
  );
}
