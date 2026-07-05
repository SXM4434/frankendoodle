// Frankendoodle — hand-drawn doodle graphics, in Desk Doodles' own ink
// language. No emoji anywhere: every mark here is an authored SVG doodle,
// drawn in the same monochrome hand-drawn register as the game itself.
//
// Marks are stroked with `currentColor` so they inherit the ink of wherever
// they sit. Round caps/joins + a faint per-mark rotation give them the
// hand-made wobble. The hero marks can also be routed through the real
// SvgStyleTransform engine (`engine` prop) for the full rough treatment.

import { SvgStyleTransform } from '../canvas/SvgStyleTransform';
import { StyleScope } from './StyleScope';
import { DEFAULT_MODIFIERS } from '../../state/F3RoughModifiersContext';

export type DoodleName =
  | 'monster'
  | 'pencil'
  | 'peek'
  | 'spark'
  | 'arrow'
  | 'check'
  | 'link'
  | 'head'
  | 'body'
  | 'legs'
  // emotive bubbles for the living creature
  | 'heart'
  | 'excl'
  | 'question'
  | 'zzz';

// viewBox is 0 0 100 100 for every mark. fill:none unless noted.
const S = 'currentColor';
const P = (d: string, extra = '') =>
  `<path d="${d}" fill="none" stroke="${S}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;

const DOT = (cx: number, cy: number, r = 4) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${S}"/>`;

const DOODLES: Record<DoodleName, string> = {
  // the mascot — a wonky one-eyed blob with an antenna and little feet
  monster: [
    P('M26,58 C20,30 40,20 50,20 C62,20 80,30 74,58 C80,78 66,84 50,84 C34,84 20,78 26,58 Z'),
    P('M50,20 C50,12 50,10 50,7'),
    DOT(50, 6, 4),
    // eye
    `<circle cx="47" cy="48" r="11" fill="none" stroke="${S}" stroke-width="5"/>`,
    DOT(49, 49, 4),
    // mouth
    P('M40,66 C45,72 57,72 62,65'),
    // feet
    P('M38,84 C37,90 36,92 35,95'),
    P('M62,84 C63,90 64,92 65,95'),
  ].join(''),

  // a drawing pencil, on the diagonal
  pencil: [
    P('M24,76 L64,36'),
    P('M62,34 L74,22 C77,19 81,23 78,26 L66,38 Z'),
    P('M24,76 L20,80 L32,76 L28,72 Z'),
    P('M58,38 L62,42'),
  ].join(''),

  // a closed, lash-lidded eye — "no peeking"
  peek: [
    P('M20,52 C34,66 66,66 80,52'),
    P('M28,60 L25,68'),
    P('M40,64 L38,73'),
    P('M52,64 L52,74'),
    P('M64,62 L67,71'),
    P('M74,58 L79,66'),
  ].join(''),

  // a little burst of sparkles
  spark: [
    P('M50,20 L50,44 M38,32 L62,32'),
    P('M28,58 L28,74 M20,66 L36,66'),
    P('M70,54 L70,72 M61,63 L79,63'),
  ].join(''),

  // a hand-drawn arrow →
  arrow: [P('M18,50 L78,50'), P('M60,34 L80,50 L60,66')].join(''),

  // a check
  check: [P('M24,52 L44,72 L80,28')].join(''),

  // two interlocking links — connection
  link: [
    `<rect x="20" y="38" width="34" height="24" rx="12" fill="none" stroke="${S}" stroke-width="5"/>`,
    `<rect x="46" y="38" width="34" height="24" rx="12" fill="none" stroke="${S}" stroke-width="5"/>`,
  ].join(''),

  // body-part guides
  head: [
    P('M30,54 C26,30 44,22 50,22 C58,22 76,30 70,56 C74,72 62,78 50,78 C38,78 27,74 30,54 Z'),
    DOT(43, 48, 3),
    DOT(58, 48, 3),
    P('M43,62 C47,66 55,66 59,61'),
  ].join(''),
  body: [
    P('M36,24 C34,44 34,64 38,82'),
    P('M64,24 C66,44 66,64 62,82'),
    P('M36,24 C46,20 56,20 64,24'),
    P('M30,44 L18,58'),
    P('M70,44 L82,58'),
  ].join(''),
  legs: [
    P('M42,20 C40,40 38,58 34,82'),
    P('M58,20 C60,40 62,58 66,82'),
    P('M34,82 L24,86'),
    P('M66,82 L76,86'),
  ].join(''),

  // a filled hand-drawn heart — love / petted / happy
  heart:
    `<path d="M50,80 C24,60 20,38 34,30 C44,24 50,32 50,40 C50,32 56,24 66,30 C80,38 76,60 50,80 Z" fill="${S}" stroke="${S}" stroke-width="3" stroke-linejoin="round"/>`,
  // an exclamation — startled / surprised
  excl: [P('M50,24 L50,58'), DOT(50, 72, 5)].join(''),
  // a question — curious / puzzled
  question: [P('M36,38 C36,24 64,24 64,42 C64,56 50,54 50,66'), DOT(50, 80, 5)].join(''),
  // three sleepy z's — dozing
  zzz: [
    P('M20,72 L34,72 L20,84 L34,84'),
    P('M40,52 L58,52 L40,68 L58,68'),
    P('M64,30 L84,30 L64,50 L84,50'),
  ].join(''),
};

const WOBBLE: Partial<Record<DoodleName, number>> = {
  monster: -3,
  pencil: 0,
  peek: 0,
  spark: 4,
  head: -2,
  body: 2,
  legs: -2,
};

export function FdDoodle({
  name,
  size = 24,
  strokeWidth,
  engine = true,
  style,
}: {
  name: DoodleName;
  size?: number;
  strokeWidth?: number;
  engine?: boolean;
  style?: React.CSSProperties;
}) {
  let inner = DOODLES[name];
  if (strokeWidth) inner = inner.replace(/stroke-width="5"/g, `stroke-width="${strokeWidth}"`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="width:100%;height:100%;display:block;overflow:visible">${inner}</svg>`;

  const box: React.CSSProperties = {
    width: size,
    height: size,
    display: 'inline-block',
    lineHeight: 0,
    transform: `rotate(${WOBBLE[name] ?? 0}deg)`,
    ...style,
  };

  if (engine) {
    // Route through the real Smart-Hachure engine so the mark is genuinely
    // hand-drawn (rough multi-stroke), not a clean vector. Concrete ink so the
    // pipeline has a real colour to process.
    const engineSvg = svg.replace(/currentColor/g, '#241f18');
    return (
      <span style={box} aria-hidden>
        <StyleScope svgStyle="rough-handdrawn" mods={DEFAULT_MODIFIERS}>
          <SvgStyleTransform wrapperOverride={{ display: 'block', width: '100%', height: '100%' }}>
            <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: engineSvg }} />
          </SvgStyleTransform>
        </StyleScope>
      </span>
    );
  }
  return <span style={box} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}
