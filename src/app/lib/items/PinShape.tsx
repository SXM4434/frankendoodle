// PinShape — SVG renderer for ~30 Trophy Wall item shapes.
// Extracted from F3_B_TrophyWall_Path2.tsx pre-strip; no Hero context dependencies.
// Each case returns a self-contained <svg> for the named F3TrophyWallShapeId.
import { IS } from '../typography';
import type { F3TrophyWallShapeId } from './identitySet';

const STROKE = 'var(--dir-text-primary)';
const WASH = 'color-mix(in oklab, var(--dir-text-primary) 8%, transparent)';
const BG = 'var(--dir-bg)';

export function PinShape({ shape }: { shape: F3TrophyWallShapeId }) {
  switch (shape) {
    // ── Elara ──────────────────────────────────────────────────────────────
    case 'framedSketch':
      return (
        <svg viewBox="0 0 100 75" width="92" height="69" aria-hidden>
          <rect x="3" y="3" width="94" height="69" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <rect x="12" y="12" width="76" height="51" fill="transparent" stroke={STROKE} strokeWidth="1" strokeDasharray="2 3" />
        </svg>
      );
    case 'processPrint':
      return (
        <svg viewBox="0 0 100 75" width="92" height="69" aria-hidden>
          <rect x="3" y="3" width="94" height="69" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {[15, 25, 35, 45, 55, 65].map((y) => (
            <line key={y} x1="12" y1={y} x2="88" y2={y} stroke={STROKE} strokeWidth="0.5" />
          ))}
          {[20, 40, 60, 80].map((x) => (
            <line key={x} x1={x} y1="12" x2={x} y2="68" stroke={STROKE} strokeWidth="0.5" />
          ))}
        </svg>
      );

    // ── Ion ────────────────────────────────────────────────────────────────
    case 'screenshotPrint':
      return (
        <svg viewBox="0 0 110 75" width="98" height="67" aria-hidden>
          <rect x="3" y="3" width="104" height="69" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Browser chrome */}
          <line x1="3" y1="14" x2="107" y2="14" stroke={STROKE} strokeWidth="0.9" />
          <circle cx="9" cy="9" r="1.4" fill={STROKE} />
          <circle cx="14" cy="9" r="1.4" fill={STROKE} />
          <circle cx="19" cy="9" r="1.4" fill={STROKE} />
          {/* Window content */}
          <rect x="12" y="22" width="44" height="6" fill={STROKE} />
          <rect x="12" y="34" width="86" height="3" fill={WASH} stroke={STROKE} strokeWidth="0.4" />
          <rect x="12" y="42" width="86" height="3" fill={WASH} stroke={STROKE} strokeWidth="0.4" />
          <rect x="12" y="50" width="62" height="3" fill={WASH} stroke={STROKE} strokeWidth="0.4" />
          <rect x="76" y="58" width="22" height="8" fill={STROKE} />
        </svg>
      );
    case 'pitchDeckCover':
      return (
        <svg viewBox="0 0 100 75" width="90" height="68" aria-hidden>
          <rect x="3" y="3" width="94" height="69" fill={STROKE} />
          <text x="50" y="32" textAnchor="middle" fontFamily={IS} fontSize="10" fontWeight="500" fill={BG}>
            ION
          </text>
          <text x="50" y="46" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={BG} letterSpacing="0.2em">
            YC W24
          </text>
          <line x1="36" y1="54" x2="64" y2="54" stroke={BG} strokeWidth="0.8" />
        </svg>
      );

    // ── Punk ───────────────────────────────────────────────────────────────
    case 'gigTicket':
      return (
        <svg viewBox="0 0 110 50" width="98" height="44" aria-hidden>
          <path d="M3 3 L107 3 L107 47 L3 47 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <line x1="82" y1="3" x2="82" y2="47" stroke={STROKE} strokeWidth="0.9" strokeDasharray="2 2" />
          <text x="10" y="22" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE}>ADMIT ONE</text>
          <text x="10" y="36" fontFamily={IS} fontSize="6" fill={STROKE}>GIG · STAGE A</text>
          <text x="94" y="29" textAnchor="middle" fontFamily={IS} fontSize="11" fontWeight="500" fill={STROKE}>
            #
          </text>
        </svg>
      );
    case 'framedFlyer':
      return (
        <svg viewBox="0 0 80 100" width="72" height="90" aria-hidden>
          <rect x="3" y="3" width="74" height="94" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Bold band text */}
          <rect x="12" y="14" width="56" height="14" fill={STROKE} />
          <text x="40" y="24" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={BG} letterSpacing="0.05em">
            PUNK
          </text>
          {/* Spiky decoration */}
          <path d="M12 40 L20 36 L20 44 L28 38 L28 46 L36 38 L36 46 L44 38 L44 46 L52 38 L52 46 L60 36 L68 40" fill="none" stroke={STROKE} strokeWidth="1" />
          <line x1="14" y1="60" x2="66" y2="60" stroke={STROKE} strokeWidth="0.5" />
          <line x1="14" y1="68" x2="60" y2="68" stroke={STROKE} strokeWidth="0.5" />
          <line x1="14" y1="76" x2="56" y2="76" stroke={STROKE} strokeWidth="0.5" />
          <text x="40" y="92" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE}>FREE</text>
        </svg>
      );
    case 'bandPatch':
      return (
        <svg viewBox="0 0 80 80" width="64" height="64" aria-hidden>
          {/* Irregular patch shape — sewn corners */}
          <path
            d="M8 14 Q8 8 14 8 L66 8 Q72 8 72 14 L72 66 Q72 72 66 72 L14 72 Q8 72 8 66 Z"
            fill={WASH}
            stroke={STROKE}
            strokeWidth="1.6"
          />
          {/* Stitch dashes around perimeter */}
          <rect x="12" y="12" width="56" height="56" fill="transparent" stroke={STROKE} strokeWidth="0.6" strokeDasharray="2 2" />
          {/* Band initial */}
          <text x="40" y="48" textAnchor="middle" fontFamily={IS} fontSize="22" fontWeight="500" fill={STROKE}>
            ✻
          </text>
        </svg>
      );

    // ── Nintendo ───────────────────────────────────────────────────────────
    case 'framedMarioPoster':
      return (
        <svg viewBox="0 0 70 100" width="60" height="86" aria-hidden>
          <rect x="3" y="3" width="64" height="94" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Mario hat shape inside */}
          <path d="M14 36 Q22 18 35 18 Q48 18 56 36 Z" fill={STROKE} stroke={STROKE} strokeWidth="0.8" />
          <rect x="12" y="36" width="46" height="6" fill={STROKE} />
          <circle cx="35" cy="28" r="6" fill={BG} stroke={STROKE} strokeWidth="0.8" />
          <text x="35" y="31" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE}>M</text>
          <text x="35" y="62" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE} letterSpacing="0.08em">SUPER</text>
          <text x="35" y="72" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE} letterSpacing="0.08em">MARIO</text>
        </svg>
      );
    case 'zeldaMap':
      return (
        <svg viewBox="0 0 110 80" width="98" height="71" aria-hidden>
          <rect x="3" y="3" width="104" height="74" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Topographic contour lines */}
          <path d="M12 30 Q40 18 70 28 Q96 36 100 50" fill="none" stroke={STROKE} strokeWidth="0.7" />
          <path d="M16 42 Q42 32 70 42 Q92 50 96 60" fill="none" stroke={STROKE} strokeWidth="0.6" />
          <path d="M20 56 Q44 50 70 56 Q88 60 92 68" fill="none" stroke={STROKE} strokeWidth="0.5" />
          {/* Compass star + X */}
          <text x="22" y="22" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE}>N</text>
          <text x="76" y="64" fontFamily={IS} fontSize="11" fontWeight="500" fill={STROKE}>✕</text>
        </svg>
      );
    case 'cartShadowBox':
      return (
        <svg viewBox="0 0 90 90" width="80" height="80" aria-hidden>
          <rect x="3" y="3" width="84" height="84" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Cartridge inside the shadow box */}
          <rect x="20" y="28" width="50" height="40" fill={BG} stroke={STROKE} strokeWidth="1.2" />
          <rect x="26" y="34" width="38" height="14" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
          <text x="45" y="44" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE}>NES</text>
          {[54, 60].map((y) => (
            <line key={y} x1="26" y1={y} x2="64" y2={y} stroke={STROKE} strokeWidth="0.5" />
          ))}
        </svg>
      );

    // ── Movies ─────────────────────────────────────────────────────────────
    case 'premiereTicket':
      return (
        <svg viewBox="0 0 110 50" width="98" height="44" aria-hidden>
          <path d="M3 3 L107 3 L107 47 L3 47 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <line x1="82" y1="3" x2="82" y2="47" stroke={STROKE} strokeWidth="0.9" strokeDasharray="2 2" />
          <text x="10" y="22" fontFamily={IS} fontSize="8" fontWeight="500" fill={STROKE}>PREMIERE</text>
          <text x="10" y="36" fontFamily={IS} fontSize="6" fill={STROKE}>ROW G · SEAT 12</text>
          <text x="94" y="26" textAnchor="middle" fontFamily={IS} fontSize="8" fontWeight="500" fill={STROKE}>G12</text>
          <text x="94" y="38" textAnchor="middle" fontFamily={IS} fontSize="5" fill={STROKE}>2024</text>
        </svg>
      );
    case 'framedMoviePoster':
      return (
        <svg viewBox="0 0 70 100" width="60" height="86" aria-hidden>
          <rect x="3" y="3" width="64" height="94" fill={STROKE} />
          <rect x="10" y="14" width="50" height="56" fill={BG} stroke={BG} />
          <text x="35" y="32" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.15em">FILM</text>
          <line x1="22" y1="40" x2="48" y2="40" stroke={STROKE} strokeWidth="0.6" />
          <text x="35" y="84" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG} letterSpacing="0.1em">A FILM BY</text>
        </svg>
      );
    case 'criterionSpine':
      return (
        <svg viewBox="0 0 28 120" width="22" height="98" aria-hidden>
          <rect x="4" y="4" width="20" height="112" rx="1" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <text x="14" y="60" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE} transform="rotate(-90 14 60)">
            CRITERION
          </text>
          <line x1="6" y1="100" x2="22" y2="100" stroke={STROKE} strokeWidth="0.6" />
          <text x="14" y="110" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE}>#247</text>
        </svg>
      );

    // ── Pokémon ────────────────────────────────────────────────────────────
    case 'tradingCard':
      return (
        <svg viewBox="0 0 70 100" width="58" height="82" aria-hidden>
          <rect x="3" y="3" width="64" height="94" rx="4" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <circle cx="35" cy="35" r="16" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <text x="35" y="40" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE}>★</text>
          <text x="35" y="68" textAnchor="middle" fontFamily={IS} fontSize="8" fontWeight="500" fill={STROKE}>HP 60</text>
        </svg>
      );
    case 'pinnedFigurePhoto':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          <rect x="3" y="3" width="74" height="94" fill={BG} stroke={STROKE} strokeWidth="1.5" />
          <rect x="8" y="8" width="64" height="64" fill={WASH} stroke={STROKE} strokeWidth="1" />
          {/* Hint of figure */}
          <circle cx="40" cy="32" r="10" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <rect x="32" y="42" width="16" height="22" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <text x="40" y="86" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.1em">SHELF · '24</text>
        </svg>
      );

    // ── Sony ───────────────────────────────────────────────────────────────
    case 'psPoster':
      return (
        <svg viewBox="0 0 70 100" width="60" height="86" aria-hidden>
          <rect x="3" y="3" width="64" height="94" fill={STROKE} />
          <text x="35" y="50" textAnchor="middle" fontFamily={IS} fontSize="14" fontWeight="500" fill={BG} letterSpacing="0.1em">PS</text>
          <line x1="22" y1="58" x2="48" y2="58" stroke={BG} strokeWidth="1" />
          <text x="35" y="74" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={BG} letterSpacing="0.15em">EXCLUSIVE</text>
        </svg>
      );
    case 'controllerShadowBox':
      return (
        <svg viewBox="0 0 100 80" width="86" height="69" aria-hidden>
          <rect x="3" y="3" width="94" height="74" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Controller silhouette inside */}
          <path d="M28 30 Q18 30 18 42 Q18 58 32 58 Q44 58 48 50 L62 50 Q66 58 78 58 Q92 58 92 42 Q92 30 82 30 Q72 30 68 38 L42 38 Q38 30 28 30 Z" fill={BG} stroke={STROKE} strokeWidth="1.2" />
          <circle cx="32" cy="42" r="3" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
          <circle cx="78" cy="46" r="3" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
        </svg>
      );

    // ── WWE ────────────────────────────────────────────────────────────────
    case 'ringsideTicket':
      return (
        <svg viewBox="0 0 110 50" width="98" height="44" aria-hidden>
          <path d="M3 3 L107 3 L107 47 L3 47 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <line x1="82" y1="3" x2="82" y2="47" stroke={STROKE} strokeWidth="0.9" strokeDasharray="2 2" />
          <text x="10" y="22" fontFamily={IS} fontSize="8" fontWeight="500" fill={STROKE}>RINGSIDE</text>
          <text x="10" y="36" fontFamily={IS} fontSize="6" fill={STROKE}>RAW · MSG</text>
          <text x="94" y="29" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE}>R</text>
        </svg>
      );
    case 'signedPhoto':
      return (
        <svg viewBox="0 0 90 70" width="82" height="64" aria-hidden>
          <rect x="3" y="3" width="84" height="64" fill={BG} stroke={STROKE} strokeWidth="1.5" />
          <rect x="8" y="8" width="74" height="44" fill={WASH} stroke={STROKE} strokeWidth="0.6" />
          {/* Figure silhouette */}
          <circle cx="45" cy="22" r="6" fill={STROKE} />
          <path d="M36 30 L54 30 L52 48 L38 48 Z" fill={STROKE} />
          {/* Signature swoosh */}
          <path d="M14 60 Q26 54 36 60 Q48 64 60 56 Q72 50 82 60" fill="none" stroke={STROKE} strokeWidth="1" />
        </svg>
      );

    // ── Travel ─────────────────────────────────────────────────────────────
    case 'boardingPassTW':
      return (
        <svg viewBox="0 0 130 55" width="110" height="46" aria-hidden>
          <rect x="3" y="3" width="124" height="49" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <line x1="88" y1="3" x2="88" y2="52" stroke={STROKE} strokeWidth="0.8" strokeDasharray="2 2" />
          <text x="10" y="22" fontFamily={IS} fontSize="10" fontWeight="500" fill={STROKE}>BOG → JFK</text>
          <text x="10" y="40" fontFamily={IS} fontSize="8" fill={STROKE}>SEAT 14A</text>
        </svg>
      );
    case 'stampedPassport':
      return (
        <svg viewBox="0 0 100 80" width="90" height="72" aria-hidden>
          <rect x="3" y="3" width="94" height="74" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <line x1="50" y1="3" x2="50" y2="77" stroke={STROKE} strokeWidth="0.7" />
          {/* Stamps */}
          <circle cx="25" cy="22" r="11" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <text x="25" y="25" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE}>BOG</text>
          <circle cx="75" cy="32" r="11" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <text x="75" y="35" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE}>JFK</text>
          <circle cx="30" cy="56" r="9" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <text x="30" y="59" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE}>NRT</text>
          <circle cx="72" cy="60" r="9" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <text x="72" y="63" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE}>CDG</text>
        </svg>
      );

    // ── GF ─────────────────────────────────────────────────────────────────
    case 'polaroid':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          <rect x="3" y="3" width="74" height="94" fill={BG} stroke={STROKE} strokeWidth="1.5" />
          <rect x="8" y="8" width="64" height="70" fill={WASH} stroke={STROKE} strokeWidth="1" />
        </svg>
      );
    case 'loveLetter':
      return (
        <svg viewBox="0 0 80 90" width="72" height="82" aria-hidden>
          <path d="M5 5 L75 5 L75 85 L5 85 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {[22, 33, 44, 55].map((y, i) => (
            <line key={y} x1="13" y1={y} x2={[65, 68, 60, 63][i]} y2={y} stroke={STROKE} strokeWidth="0.8" />
          ))}
          {/* Heart at bottom */}
          <path d="M32 72 Q28 68 28 64 Q28 60 32 60 Q36 60 40 64 Q44 60 48 60 Q52 60 52 64 Q52 68 48 72 Q40 80 40 80 Q40 80 32 72 Z" fill={STROKE} />
        </svg>
      );
    case 'pairedPhotoStrip':
      return (
        <svg viewBox="0 0 36 130" width="30" height="106" aria-hidden>
          <rect x="3" y="3" width="30" height="124" fill={BG} stroke={STROKE} strokeWidth="1.4" />
          {[10, 38, 66, 94].map((y) => (
            <rect key={y} x="6" y={y} width="24" height="24" fill={WASH} stroke={STROKE} strokeWidth="0.8" />
          ))}
        </svg>
      );

    // ── Running ────────────────────────────────────────────────────────────
    case 'raceMedal':
      return (
        <svg viewBox="0 0 90 40" width="80" height="36" aria-hidden>
          <ellipse cx="45" cy="22" rx="40" ry="14" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <ellipse cx="45" cy="22" rx="22" ry="7" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          <text x="45" y="25" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE}>5K</text>
        </svg>
      );
    case 'raceBib':
      return (
        <svg viewBox="0 0 90 70" width="80" height="62" aria-hidden>
          <rect x="3" y="3" width="84" height="64" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Pin holes corners */}
          <circle cx="11" cy="11" r="2" fill={STROKE} />
          <circle cx="79" cy="11" r="2" fill={STROKE} />
          <circle cx="11" cy="59" r="2" fill={STROKE} />
          <circle cx="79" cy="59" r="2" fill={STROKE} />
          <text x="45" y="42" textAnchor="middle" fontFamily={IS} fontSize="22" fontWeight="500" fill={STROKE}>247</text>
          <text x="45" y="58" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE} letterSpacing="0.15em">FINISHER</text>
        </svg>
      );

    // ── Roots ──────────────────────────────────────────────────────────────
    case 'postcard':
      return (
        <svg viewBox="0 0 110 72" width="96" height="63" aria-hidden>
          <rect x="3" y="3" width="104" height="66" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <line x1="55" y1="6" x2="55" y2="66" stroke={STROKE} strokeWidth="0.8" strokeDasharray="2 2" />
          <rect x="86" y="11" width="16" height="20" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          <line x1="62" y1="20" x2="78" y2="20" stroke={STROKE} strokeWidth="0.6" />
          <line x1="62" y1="30" x2="80" y2="30" stroke={STROKE} strokeWidth="0.6" />
          <text x="29" y="22" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE}>CARTAGENA</text>
          <line x1="10" y1="40" x2="48" y2="40" stroke={STROKE} strokeWidth="0.5" />
          <line x1="10" y1="48" x2="44" y2="48" stroke={STROKE} strokeWidth="0.5" />
          <line x1="10" y1="56" x2="40" y2="56" stroke={STROKE} strokeWidth="0.5" />
        </svg>
      );
    case 'flagPanel':
      return (
        <svg viewBox="0 0 100 70" width="88" height="62" aria-hidden>
          {/* Left half = Colombia (yellow/blue/red horizontal) */}
          <rect x="3" y="3" width="47" height="32" fill={STROKE} />
          <rect x="3" y="35" width="47" height="16" fill={WASH} />
          <rect x="3" y="51" width="47" height="16" fill={STROKE} />
          {/* Right half = USA (stripes) */}
          <rect x="50" y="3" width="47" height="64" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          {[3, 11, 19, 27, 35, 43, 51, 59].map((y) => (
            <line key={y} x1="50" y1={y + 4} x2="97" y2={y + 4} stroke={STROKE} strokeWidth="1" />
          ))}
          <rect x="50" y="3" width="20" height="22" fill={STROKE} />
        </svg>
      );

    // ── Sketching (extended 2026-05-31) ─────────────────────────────────────
    case 'stackedSketchbooks':
      return (
        <svg viewBox="0 0 90 80" width="80" height="71" aria-hidden>
          {/* Four stacked sketchbook spines */}
          {[
            { y: 4, h: 16, fill: STROKE },
            { y: 22, h: 14, fill: WASH },
            { y: 38, h: 18, fill: STROKE },
            { y: 58, h: 16, fill: WASH },
          ].map((b, i) => (
            <g key={i}>
              <rect x="6" y={b.y} width="78" height={b.h} fill={b.fill} stroke={STROKE} strokeWidth="1.3" />
              {/* Elastic band */}
              <line x1="20" y1={b.y} x2="20" y2={b.y + b.h} stroke={i % 2 ? STROKE : WASH} strokeWidth="2" />
            </g>
          ))}
        </svg>
      );
    case 'singleSketchbookClosed':
      return (
        <svg viewBox="0 0 80 100" width="70" height="88" aria-hidden>
          <rect x="3" y="3" width="74" height="94" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Elastic band */}
          <line x1="60" y1="3" x2="60" y2="97" stroke={STROKE} strokeWidth="2.4" />
          {/* Slight battered corners */}
          <path d="M3 12 L8 6" stroke={STROKE} strokeWidth="0.6" />
          <path d="M77 88 L72 94" stroke={STROKE} strokeWidth="0.6" />
          {/* Embossed badge */}
          <rect x="14" y="44" width="34" height="10" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
          <text x="31" y="52" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.15em">VOL · 12</text>
        </svg>
      );
    case 'framedSketchPage':
      return (
        <svg viewBox="0 0 80 100" width="72" height="90" aria-hidden>
          <rect x="3" y="3" width="74" height="94" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Inner mat */}
          <rect x="12" y="14" width="56" height="72" fill={BG} stroke={STROKE} strokeWidth="0.6" />
          {/* Pinned page with torn corner suggestion */}
          <path d="M18 22 L62 22 L62 70 L24 70 L18 64 Z" fill={WASH} stroke={STROKE} strokeWidth="0.7" />
          {/* Sketch suggestion lines */}
          <path d="M24 36 Q34 30 44 38 Q52 42 58 32" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
          <path d="M26 50 Q36 46 46 52 Q52 56 58 50" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );
    case 'pencilStubJar':
      return (
        <svg viewBox="0 0 80 90" width="68" height="76" aria-hidden>
          {/* Jar */}
          <path d="M14 30 L66 30 L62 84 L18 84 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Rim */}
          <line x1="12" y1="30" x2="68" y2="30" stroke={STROKE} strokeWidth="0.8" />
          {/* Pencil stubs sticking up */}
          {[24, 32, 40, 48, 56].map((x, i) => (
            <g key={x}>
              <rect x={x - 2} y={10 + (i % 3) * 4} width="5" height={20 - (i % 3) * 4} fill={WASH} stroke={STROKE} strokeWidth="0.9" />
              <polygon points={`${x - 2},${10 + (i % 3) * 4} ${x + 3},${10 + (i % 3) * 4} ${x + 0.5},${4 + (i % 3) * 4}`} fill={STROKE} />
            </g>
          ))}
        </svg>
      );
    case 'inktoberCard':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          <rect x="3" y="3" width="74" height="94" fill={BG} stroke={STROKE} strokeWidth="1.5" />
          {/* Ink sketch suggestion — abstract figure */}
          <path d="M22 30 Q40 14 56 32 Q62 50 50 64 Q40 74 30 64 Q18 50 22 30 Z" fill="transparent" stroke={STROKE} strokeWidth="1.4" />
          <line x1="32" y1="42" x2="48" y2="42" stroke={STROKE} strokeWidth="0.7" />
          {/* Date stamp in corner */}
          <text x="64" y="92" textAnchor="end" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.1em">OCT · 14</text>
        </svg>
      );

    // ── Work-rig (extended 2026-05-31) ──────────────────────────────────────
    case 'stickeredLaptopLid':
      return (
        <svg viewBox="0 0 110 80" width="98" height="73" aria-hidden>
          <rect x="3" y="3" width="104" height="74" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Faint apple logo center */}
          <circle cx="55" cy="40" r="4" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
          {/* Sticker collage */}
          <rect x="10" y="10" width="18" height="10" fill={STROKE} />
          <text x="19" y="17" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG} letterSpacing="0.1em">CONFIG</text>
          <circle cx="40" cy="14" r="7" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <polygon points="80,8 96,8 92,22 84,22" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <rect x="12" y="58" width="22" height="12" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <rect x="38" y="62" width="14" height="10" fill={STROKE} />
          <circle cx="76" cy="60" r="8" fill={STROKE} />
          <text x="76" y="63" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG}>V</text>
          <polygon points="90,52 100,52 100,68 90,68" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <line x1="90" y1="52" x2="100" y2="68" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );
    case 'conferenceLanyard':
      return (
        <svg viewBox="0 0 60 110" width="52" height="96" aria-hidden>
          {/* Lanyard strap forming a loop */}
          <path d="M22 4 Q30 22 14 36 L14 64" fill="transparent" stroke={STROKE} strokeWidth="3" />
          <path d="M38 4 Q30 22 46 36 L46 64" fill="transparent" stroke={STROKE} strokeWidth="3" />
          {/* Clip */}
          <rect x="26" y="60" width="8" height="6" fill={STROKE} />
          {/* Badge */}
          <rect x="6" y="66" width="48" height="40" fill={BG} stroke={STROKE} strokeWidth="1.4" />
          <text x="30" y="80" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE} letterSpacing="0.12em">CONFIG</text>
          <line x1="14" y1="86" x2="46" y2="86" stroke={STROKE} strokeWidth="0.5" />
          <text x="30" y="98" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE}>SEBS · 24</text>
        </svg>
      );
    case 'stickerStack':
      return (
        <svg viewBox="0 0 80 80" width="68" height="68" aria-hidden>
          {/* Stack of die-cut stickers, slight rotations */}
          <g transform="rotate(-6 40 40)">
            <rect x="10" y="10" width="60" height="60" rx="6" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          </g>
          <g transform="rotate(4 40 40)">
            <rect x="14" y="14" width="56" height="56" rx="6" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          </g>
          <g transform="rotate(-2 40 40)">
            <rect x="16" y="16" width="50" height="50" rx="4" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
            <text x="40" y="46" textAnchor="middle" fontFamily={IS} fontSize="14" fontWeight="500" fill={STROKE}>★</text>
          </g>
        </svg>
      );
    case 'externalSsdArchive':
      return (
        <svg viewBox="0 0 80 60" width="68" height="51" aria-hidden>
          <rect x="3" y="6" width="74" height="48" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Status LED */}
          <circle cx="68" cy="14" r="1.6" fill={STROKE} />
          {/* Hand-labeled tape strip */}
          <rect x="10" y="22" width="60" height="22" fill={BG} stroke={STROKE} strokeWidth="0.8" />
          <text x="40" y="38" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE} letterSpacing="0.15em">ARCHIVE</text>
        </svg>
      );
    case 'framedDribbble':
      return (
        <svg viewBox="0 0 100 80" width="88" height="70" aria-hidden>
          <rect x="3" y="3" width="94" height="74" fill={STROKE} />
          {/* Inner UI shot */}
          <rect x="10" y="10" width="80" height="60" fill={BG} />
          {/* App chrome bar */}
          <rect x="10" y="10" width="80" height="6" fill={STROKE} />
          {/* UI blocks */}
          <rect x="14" y="22" width="22" height="22" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
          <rect x="40" y="22" width="22" height="22" fill={STROKE} />
          <rect x="66" y="22" width="20" height="22" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
          <line x1="14" y1="50" x2="86" y2="50" stroke={STROKE} strokeWidth="0.5" />
          <line x1="14" y1="58" x2="70" y2="58" stroke={STROKE} strokeWidth="0.5" />
          <line x1="14" y1="64" x2="60" y2="64" stroke={STROKE} strokeWidth="0.5" />
        </svg>
      );
    case 'awwwardsStatue':
      return (
        <svg viewBox="0 0 60 100" width="48" height="80" aria-hidden>
          {/* Trophy shape */}
          <path d="M16 8 L44 8 L40 50 Q40 56 30 56 Q20 56 20 50 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Handles */}
          <path d="M16 14 Q4 14 4 26 Q4 38 16 38" fill="transparent" stroke={STROKE} strokeWidth="1.4" />
          <path d="M44 14 Q56 14 56 26 Q56 38 44 38" fill="transparent" stroke={STROKE} strokeWidth="1.4" />
          {/* Stem */}
          <rect x="26" y="56" width="8" height="18" fill={STROKE} />
          {/* Base */}
          <rect x="14" y="74" width="32" height="14" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <text x="30" y="84" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE} letterSpacing="0.15em">SOTD</text>
        </svg>
      );

    // ── Punk (extended 2026-05-31) ──────────────────────────────────────────
    case 'vinylLpSleeve':
      return (
        <svg viewBox="0 0 100 100" width="88" height="88" aria-hidden>
          <defs>
            <clipPath id="vinyl-peek-clip">
              {/* Reveal only the right half of the disc — peeking out of the sleeve right edge */}
              <rect x="76" y="6" width="40" height="88" />
            </clipPath>
          </defs>
          {/* LP square sleeve */}
          <rect x="3" y="3" width="94" height="94" fill={STROKE} />
          {/* Cover art block */}
          <rect x="14" y="14" width="62" height="72" fill={BG} />
          <line x1="14" y1="50" x2="76" y2="50" stroke={STROKE} strokeWidth="1.2" />
          <text x="45" y="40" textAnchor="middle" fontFamily={IS} fontSize="8" fontWeight="500" fill={STROKE} letterSpacing="0.18em">PUNK</text>
          <text x="45" y="68" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.12em">SIDE A</text>
          {/* Corner of vinyl disc peeking out — clipped to the right of the sleeve */}
          <g clipPath="url(#vinyl-peek-clip)">
            <circle cx="78" cy="50" r="26" fill={STROKE} stroke={STROKE} strokeWidth="0.5" />
            <circle cx="78" cy="50" r="18" fill="transparent" stroke={BG} strokeWidth="0.4" />
            <circle cx="78" cy="50" r="5" fill={BG} />
          </g>
        </svg>
      );
    case 'bandTshirt':
      return (
        <svg viewBox="0 0 100 90" width="86" height="78" aria-hidden>
          {/* Folded T-shirt square */}
          <rect x="6" y="6" width="88" height="80" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Neckline suggestion */}
          <path d="M40 6 Q50 18 60 6" fill="transparent" stroke={STROKE} strokeWidth="1" />
          {/* Band logo on chest */}
          <text x="50" y="50" textAnchor="middle" fontFamily={IS} fontSize="14" fontWeight="500" fill={STROKE} letterSpacing="0.2em">PUNK</text>
          <line x1="22" y1="56" x2="78" y2="56" stroke={STROKE} strokeWidth="1" />
          {/* Fold lines */}
          <line x1="6" y1="36" x2="94" y2="36" stroke={STROKE} strokeWidth="0.4" strokeDasharray="2 3" />
          <line x1="6" y1="66" x2="94" y2="66" stroke={STROKE} strokeWidth="0.4" strokeDasharray="2 3" />
        </svg>
      );
    case 'setlistHandwritten':
      return (
        <svg viewBox="0 0 80 110" width="68" height="92" aria-hidden>
          <rect x="3" y="3" width="74" height="104" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Tape strips at corners */}
          <rect x="-2" y="6" width="20" height="6" fill={STROKE} transform="rotate(-12 8 9)" />
          <rect x="60" y="6" width="20" height="6" fill={STROKE} transform="rotate(8 70 9)" />
          <text x="40" y="24" textAnchor="middle" fontFamily={IS} fontSize="8" fontWeight="500" fill={STROKE} letterSpacing="0.15em">SETLIST</text>
          <line x1="14" y1="30" x2="66" y2="30" stroke={STROKE} strokeWidth="0.5" />
          {/* Handwritten-feel song list */}
          {['1. INTRO', '2. RIOT', '3. FAST', '4. SLOW', '5. CLOSER'].map((t, i) => (
            <text key={t} x="14" y={42 + i * 12} fontFamily={IS} fontSize="7" fill={STROKE}>{t}</text>
          ))}
        </svg>
      );

    // ── Nintendo (extended 2026-05-31) ──────────────────────────────────────
    case 'boxedGameCartridge':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          <rect x="3" y="3" width="74" height="94" fill={STROKE} />
          {/* Art panel */}
          <rect x="10" y="14" width="60" height="56" fill={BG} />
          <text x="40" y="36" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE} letterSpacing="0.18em">NES</text>
          <text x="40" y="48" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE} letterSpacing="0.06em">SUPER</text>
          <text x="40" y="58" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE} letterSpacing="0.06em">MARIO</text>
          {/* Bottom strip */}
          <rect x="10" y="74" width="60" height="14" fill={STROKE} stroke={BG} strokeWidth="0.5" />
          <text x="40" y="84" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG} letterSpacing="0.15em">ENTERTAINMENT</text>
        </svg>
      );
    case 'amiiboFigure':
      return (
        <svg viewBox="0 0 60 80" width="52" height="70" aria-hidden>
          {/* Clear disc base */}
          <ellipse cx="30" cy="68" rx="22" ry="6" fill="transparent" stroke={STROKE} strokeWidth="1.3" />
          {/* Character figure on top */}
          <circle cx="30" cy="22" r="11" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <circle cx="26" cy="20" r="1.4" fill={STROKE} />
          <circle cx="34" cy="20" r="1.4" fill={STROKE} />
          <path d="M26 26 Q30 28 34 26" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          {/* Body */}
          <path d="M20 32 L40 32 L42 58 L30 62 L18 58 Z" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
        </svg>
      );
    case 'looseCartridge':
      return (
        <svg viewBox="0 0 100 70" width="86" height="60" aria-hidden>
          <rect x="4" y="4" width="92" height="62" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Label */}
          <rect x="12" y="12" width="76" height="32" fill={STROKE} />
          <text x="50" y="26" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={BG} letterSpacing="0.18em">NES</text>
          <text x="50" y="38" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={BG} letterSpacing="0.08em">ZELDA</text>
          {/* Connector pins */}
          <line x1="14" y1="52" x2="86" y2="52" stroke={STROKE} strokeWidth="0.6" />
          <line x1="14" y1="58" x2="86" y2="58" stroke={STROKE} strokeWidth="0.6" />
          {[18, 26, 34, 42, 50, 58, 66, 74, 82].map((x) => (
            <line key={x} x1={x} y1="52" x2={x} y2="62" stroke={STROKE} strokeWidth="0.5" />
          ))}
        </svg>
      );
    case 'strategyGuide':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          <rect x="3" y="3" width="74" height="94" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Spiral binding */}
          {[10, 18, 26, 34, 42, 50, 58, 66, 74, 82, 90].map((y) => (
            <circle key={y} cx="8" cy={y} r="1.6" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          ))}
          <text x="46" y="30" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE} letterSpacing="0.1em">OFFICIAL</text>
          <line x1="18" y1="36" x2="74" y2="36" stroke={STROKE} strokeWidth="0.6" />
          <text x="46" y="52" textAnchor="middle" fontFamily={IS} fontSize="10" fontWeight="500" fill={STROKE}>GUIDE</text>
          <rect x="18" y="60" width="56" height="28" fill={STROKE} />
        </svg>
      );
    case 'nintendoPowerMag':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          <rect x="3" y="3" width="74" height="94" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Masthead */}
          <rect x="3" y="3" width="74" height="22" fill={STROKE} />
          <text x="40" y="12" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={BG} letterSpacing="0.15em">NINTENDO</text>
          <text x="40" y="22" textAnchor="middle" fontFamily={IS} fontSize="10" fontWeight="500" fill={BG} letterSpacing="0.1em">POWER</text>
          {/* Cover art block */}
          <rect x="10" y="32" width="60" height="50" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          <circle cx="40" cy="56" r="14" fill={STROKE} />
          <text x="40" y="92" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE} letterSpacing="0.1em">ISSUE 42</text>
        </svg>
      );
    case 'nintendoPlush':
      return (
        <svg viewBox="0 0 70 80" width="58" height="66" aria-hidden>
          {/* Round plush body */}
          <circle cx="35" cy="44" r="28" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Pointed ears (Pikachu-ish silhouette) */}
          <polygon points="14,28 10,4 24,18" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <polygon points="56,28 60,4 46,18" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <polygon points="14,18 11,8 18,12" fill={STROKE} />
          <polygon points="56,18 59,8 52,12" fill={STROKE} />
          {/* Eyes */}
          <circle cx="26" cy="40" r="2.4" fill={STROKE} />
          <circle cx="44" cy="40" r="2.4" fill={STROKE} />
          {/* Cheek blush */}
          <circle cx="18" cy="50" r="2.4" fill={STROKE} />
          <circle cx="52" cy="50" r="2.4" fill={STROKE} />
          {/* Mouth */}
          <path d="M30 54 Q35 58 40 54" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
        </svg>
      );

    // ── Movies (extended 2026-05-31) ────────────────────────────────────────
    case 'vhsClamshell':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          <rect x="3" y="3" width="74" height="94" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Slipcase outer band */}
          <rect x="6" y="14" width="68" height="74" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
          {/* Title strip */}
          <rect x="10" y="22" width="60" height="14" fill={STROKE} />
          <text x="40" y="32" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={BG} letterSpacing="0.18em">VIDEO</text>
          {/* Cover image */}
          <rect x="14" y="44" width="52" height="36" fill={STROKE} />
          <text x="40" y="62" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG}>VHS</text>
          {/* Spine top */}
          <line x1="3" y1="6" x2="77" y2="6" stroke={STROKE} strokeWidth="1" />
        </svg>
      );
    case 'letterboxdCard':
      return (
        <svg viewBox="0 0 90 90" width="78" height="78" aria-hidden>
          <rect x="3" y="3" width="84" height="84" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* "Year in review" header */}
          <text x="45" y="16" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.18em">2024 · MY YEAR</text>
          {/* Mini poster grid 4x2 */}
          {[0, 1, 2, 3].map((c) =>
            [0, 1].map((r) => (
              <rect
                key={`${c}-${r}`}
                x={8 + c * 20}
                y={24 + r * 26}
                width="16"
                height="22"
                fill={STROKE}
              />
            ))
          )}
          <text x="45" y="84" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE} letterSpacing="0.15em">FILMS · 142</text>
        </svg>
      );
    case 'mondoPrintTube':
      return (
        <svg viewBox="0 0 30 120" width="26" height="104" aria-hidden>
          {/* Poster tube */}
          <rect x="6" y="6" width="18" height="108" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* End caps */}
          <rect x="4" y="6" width="22" height="6" fill={STROKE} />
          <rect x="4" y="108" width="22" height="6" fill={STROKE} />
          {/* Label */}
          <rect x="6" y="46" width="18" height="28" fill={STROKE} />
          <text x="15" y="58" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG} transform="rotate(-90 15 58)" letterSpacing="0.15em">MONDO</text>
        </svg>
      );

    // ── Pokémon (extended 2026-05-31) ───────────────────────────────────────
    case 'psaSlab':
      return (
        <svg viewBox="0 0 80 110" width="68" height="94" aria-hidden>
          {/* Outer slab */}
          <rect x="3" y="3" width="74" height="104" rx="2" fill="transparent" stroke={STROKE} strokeWidth="1.5" />
          {/* Top grade label */}
          <rect x="6" y="6" width="68" height="18" fill={STROKE} />
          <text x="40" y="14" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG} letterSpacing="0.15em">PSA · MINT</text>
          <text x="40" y="22" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={BG} letterSpacing="0.08em">10</text>
          {/* Card inside */}
          <rect x="14" y="32" width="52" height="68" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <circle cx="40" cy="56" r="14" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <text x="40" y="60" textAnchor="middle" fontFamily={IS} fontSize="11" fontWeight="500" fill={STROKE}>★</text>
          <text x="40" y="88" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE} letterSpacing="0.1em">CHARIZARD</text>
        </svg>
      );
    case 'cardBinderClosed':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          <rect x="3" y="3" width="74" height="94" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Spine */}
          <rect x="3" y="3" width="10" height="94" fill={STROKE} />
          {/* Ring binder rings on spine */}
          {[24, 50, 76].map((y) => (
            <circle key={y} cx="8" cy={y} r="2" fill={BG} />
          ))}
          {/* Embossed logo */}
          <text x="45" y="46" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE} letterSpacing="0.15em">PKMN</text>
          <line x1="22" y1="52" x2="68" y2="52" stroke={STROKE} strokeWidth="0.6" />
          <text x="45" y="64" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.1em">COLLECTION</text>
        </svg>
      );
    case 'pokemonPlush':
      return (
        <svg viewBox="0 0 80 80" width="68" height="68" aria-hidden>
          {/* Round chubby plush */}
          <circle cx="40" cy="44" r="30" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Ears */}
          <polygon points="20,18 14,4 28,12" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <polygon points="60,18 66,4 52,12" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          {/* Eyes */}
          <circle cx="30" cy="40" r="3" fill={STROKE} />
          <circle cx="50" cy="40" r="3" fill={STROKE} />
          {/* Mouth */}
          <path d="M32 54 Q40 60 48 54" fill="transparent" stroke={STROKE} strokeWidth="1" />
          {/* Tag on ear */}
          <rect x="62" y="14" width="6" height="4" fill={STROKE} />
        </svg>
      );
    case 'sealedBoosterBox':
      return (
        <svg viewBox="0 0 90 80" width="76" height="68" aria-hidden>
          <rect x="3" y="6" width="84" height="68" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Top art band */}
          <rect x="3" y="6" width="84" height="22" fill={STROKE} />
          <text x="45" y="22" textAnchor="middle" fontFamily={IS} fontSize="8" fontWeight="500" fill={BG} letterSpacing="0.2em">BOOSTER BOX</text>
          {/* Window suggestion showing packs */}
          {[12, 24, 36, 48, 60, 72].map((x) => (
            <line key={x} x1={x} y1="32" x2={x} y2="70" stroke={STROKE} strokeWidth="0.5" />
          ))}
          <text x="45" y="60" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE} letterSpacing="0.18em">36 PACKS</text>
        </svg>
      );
    case 'collectorTin':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          {/* Tin body */}
          <rect x="6" y="20" width="68" height="76" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Lid */}
          <rect x="4" y="14" width="72" height="10" rx="2" fill={STROKE} />
          {/* Embossed card on lid */}
          <rect x="22" y="32" width="36" height="50" fill={STROKE} />
          <circle cx="40" cy="50" r="9" fill={BG} />
          <text x="40" y="54" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE}>★</text>
          <line x1="22" y1="68" x2="58" y2="68" stroke={BG} strokeWidth="0.5" />
          <text x="40" y="78" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG}>TIN ED.</text>
        </svg>
      );

    // ── Sony (extended 2026-05-31) ──────────────────────────────────────────
    case 'ps1JewelCase':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          <rect x="3" y="3" width="74" height="94" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Top white band */}
          <rect x="3" y="3" width="74" height="14" fill={BG} stroke={STROKE} strokeWidth="0.6" />
          <text x="40" y="13" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.15em">PlayStation</text>
          {/* Black-bottom (cover art region) */}
          <rect x="3" y="17" width="74" height="68" fill={STROKE} />
          <text x="40" y="50" textAnchor="middle" fontFamily={IS} fontSize="10" fontWeight="500" fill={BG} letterSpacing="0.08em">FINAL</text>
          <text x="40" y="62" textAnchor="middle" fontFamily={IS} fontSize="10" fontWeight="500" fill={BG} letterSpacing="0.08em">FANTASY</text>
          {/* Bottom barcode strip */}
          <rect x="3" y="85" width="74" height="12" fill={BG} stroke={STROKE} strokeWidth="0.5" />
          {[8, 14, 20, 26, 32, 38, 44, 50, 56, 62, 68].map((x) => (
            <line key={x} x1={x} y1="88" x2={x} y2="94" stroke={STROKE} strokeWidth={x % 12 === 0 ? 1 : 0.5} />
          ))}
        </svg>
      );
    case 'walkmanMixtape':
      return (
        <svg viewBox="0 0 110 70" width="98" height="62" aria-hidden>
          <rect x="3" y="3" width="104" height="64" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Hand-labeled spine across top */}
          <rect x="10" y="10" width="90" height="10" fill={BG} stroke={STROKE} strokeWidth="0.6" />
          <text x="55" y="18" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.12em">FOR M · MIX 04</text>
          {/* Two cassette spools */}
          <circle cx="35" cy="44" r="9" fill={BG} stroke={STROKE} strokeWidth="1" />
          <circle cx="75" cy="44" r="9" fill={BG} stroke={STROKE} strokeWidth="1" />
          <circle cx="35" cy="44" r="3" fill={STROKE} />
          <circle cx="75" cy="44" r="3" fill={STROKE} />
          {/* Tape window */}
          <rect x="24" y="40" width="62" height="8" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
        </svg>
      );
    case 'playstationMag':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          <rect x="3" y="3" width="74" height="94" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* PS Mag masthead */}
          <rect x="3" y="3" width="74" height="16" fill={STROKE} />
          <text x="40" y="14" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={BG} letterSpacing="0.15em">PS · MAG</text>
          {/* Disc + sleeve illustration */}
          <circle cx="28" cy="50" r="16" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <circle cx="28" cy="50" r="5" fill={STROKE} />
          <rect x="46" y="34" width="28" height="32" fill={STROKE} />
          <text x="60" y="50" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG}>DEMO</text>
          {/* Cover-line strip */}
          <line x1="10" y1="78" x2="70" y2="78" stroke={STROKE} strokeWidth="0.6" />
          <line x1="10" y1="86" x2="60" y2="86" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );
    case 'trinitronTv':
      return (
        <svg viewBox="0 0 100 80" width="86" height="68" aria-hidden>
          {/* CRT body */}
          <path d="M8 14 L92 14 L88 64 L12 64 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Screen */}
          <rect x="18" y="22" width="64" height="34" rx="2" fill={STROKE} />
          {/* Scanlines */}
          {[26, 30, 34, 38, 42, 46, 50].map((y) => (
            <line key={y} x1="20" y1={y} x2="80" y2={y} stroke={BG} strokeWidth="0.2" opacity="0.6" />
          ))}
          {/* Sony logo strip */}
          <text x="50" y="74" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE} letterSpacing="0.2em">TRINITRON</text>
        </svg>
      );
    case 'ps1ConsoleDisplay':
      return (
        <svg viewBox="0 0 110 60" width="98" height="54" aria-hidden>
          <rect x="3" y="6" width="104" height="48" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Disc lid */}
          <circle cx="55" cy="30" r="18" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <rect x="38" y="28" width="34" height="4" fill={STROKE} />
          {/* Buttons */}
          <rect x="86" y="22" width="14" height="3" fill={STROKE} />
          <rect x="86" y="30" width="14" height="3" fill={STROKE} />
          <rect x="86" y="38" width="14" height="3" fill={STROKE} />
          {/* Label */}
          <text x="20" y="36" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.15em">PS</text>
        </svg>
      );
    case 'sonyKeychain':
      return (
        <svg viewBox="0 0 60 80" width="48" height="64" aria-hidden>
          {/* Ring */}
          <circle cx="30" cy="14" r="9" fill="transparent" stroke={STROKE} strokeWidth="1.6" />
          {/* Chain */}
          <line x1="30" y1="23" x2="30" y2="36" stroke={STROKE} strokeWidth="1.2" />
          {/* Pendant — PS controller silhouette */}
          <path d="M14 40 Q6 40 6 50 Q6 62 18 62 Q24 62 26 58 L34 58 Q36 62 42 62 Q54 62 54 50 Q54 40 46 40 Q40 40 38 44 L22 44 Q20 40 14 40 Z" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <circle cx="16" cy="51" r="1.6" fill={STROKE} />
          <circle cx="44" cy="51" r="1.6" fill={STROKE} />
        </svg>
      );

    // ── WWE (extended 2026-05-31) ───────────────────────────────────────────
    case 'replicaBelt':
      return (
        <svg viewBox="0 0 140 80" width="116" height="66" aria-hidden>
          {/* Strap left + right */}
          <rect x="6" y="32" width="36" height="16" rx="6" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <rect x="98" y="32" width="36" height="16" rx="6" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Main plate */}
          <ellipse cx="70" cy="40" rx="34" ry="28" fill={STROKE} />
          <ellipse cx="70" cy="40" rx="26" ry="20" fill="transparent" stroke={BG} strokeWidth="1" />
          {/* Center logo */}
          <text x="70" y="44" textAnchor="middle" fontFamily={IS} fontSize="13" fontWeight="500" fill={BG}>W</text>
          {/* Side plates */}
          <circle cx="36" cy="40" r="8" fill={STROKE} />
          <text x="36" y="44" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={BG}>★</text>
          <circle cx="104" cy="40" r="8" fill={STROKE} />
          <text x="104" y="44" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={BG}>★</text>
        </svg>
      );
    case 'wrestlingFigure':
      return (
        <svg viewBox="0 0 70 110" width="58" height="92" aria-hidden>
          {/* Boxed action figure */}
          <rect x="3" y="3" width="64" height="104" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Window cutout */}
          <rect x="10" y="20" width="50" height="74" fill={BG} stroke={STROKE} strokeWidth="0.7" />
          {/* Figure inside */}
          <circle cx="35" cy="32" r="6" fill={STROKE} />
          <rect x="28" y="38" width="14" height="22" fill={STROKE} />
          <line x1="22" y1="42" x2="28" y2="56" stroke={STROKE} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="48" y1="42" x2="42" y2="56" stroke={STROKE} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="30" y1="60" x2="26" y2="86" stroke={STROKE} strokeWidth="3" strokeLinecap="round" />
          <line x1="40" y1="60" x2="44" y2="86" stroke={STROKE} strokeWidth="3" strokeLinecap="round" />
          {/* Top brand band */}
          <rect x="3" y="3" width="64" height="14" fill={STROKE} />
          <text x="35" y="13" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={BG} letterSpacing="0.18em">WWE</text>
          <text x="35" y="104" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE} letterSpacing="0.12em">SERIES 47</text>
        </svg>
      );
    case 'ppvPoster':
      return (
        <svg viewBox="0 0 70 100" width="60" height="86" aria-hidden>
          <rect x="3" y="3" width="64" height="94" fill={STROKE} />
          <text x="35" y="32" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={BG} letterSpacing="0.12em">WRESTLE</text>
          <text x="35" y="46" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={BG} letterSpacing="0.12em">MANIA</text>
          <line x1="14" y1="54" x2="56" y2="54" stroke={BG} strokeWidth="1.2" />
          {/* Roman numeral */}
          <text x="35" y="78" textAnchor="middle" fontFamily={IS} fontSize="16" fontWeight="500" fill={BG} letterSpacing="0.1em">XL</text>
          <text x="35" y="92" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG} letterSpacing="0.18em">APRIL 7</text>
        </svg>
      );
    case 'luchaMask':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          {/* Mask outline */}
          <path d="M12 30 Q12 6 40 6 Q68 6 68 30 L66 70 Q60 90 40 90 Q20 90 14 70 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Eye holes */}
          <ellipse cx="28" cy="44" rx="6" ry="4" fill={STROKE} />
          <ellipse cx="52" cy="44" rx="6" ry="4" fill={STROKE} />
          {/* Mouth slit */}
          <line x1="32" y1="68" x2="48" y2="68" stroke={STROKE} strokeWidth="1.5" />
          {/* Decorative pattern */}
          <path d="M22 22 L40 32 L58 22" fill="transparent" stroke={STROKE} strokeWidth="1.2" />
          <path d="M20 56 L40 60 L60 56" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          {/* Lace at top */}
          <line x1="36" y1="2" x2="44" y2="2" stroke={STROKE} strokeWidth="2" />
        </svg>
      );
    case 'wrestlingCard':
      return (
        <svg viewBox="0 0 70 100" width="60" height="86" aria-hidden>
          <rect x="3" y="3" width="64" height="94" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Top band — TOPPS WWE style */}
          <rect x="3" y="3" width="64" height="12" fill={STROKE} />
          <text x="35" y="11" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG} letterSpacing="0.18em">TOPPS · WWE</text>
          {/* Wrestler photo block */}
          <rect x="10" y="20" width="50" height="56" fill={STROKE} />
          {/* Silhouette */}
          <circle cx="35" cy="38" r="5" fill={BG} />
          <path d="M28 46 L42 46 L40 64 L30 64 Z" fill={BG} />
          {/* Name plate */}
          <rect x="10" y="80" width="50" height="14" fill={WASH} stroke={STROKE} strokeWidth="0.6" />
          <text x="35" y="90" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE} letterSpacing="0.1em">CHAMP</text>
        </svg>
      );

    // ── Travel (extended 2026-05-31) ────────────────────────────────────────
    case 'travelPatch':
      return (
        <svg viewBox="0 0 80 80" width="68" height="68" aria-hidden>
          {/* National Parks shield-ish patch */}
          <path d="M40 6 L70 18 Q74 24 70 50 Q62 70 40 74 Q18 70 10 50 Q6 24 10 18 Z" fill={WASH} stroke={STROKE} strokeWidth="1.6" />
          {/* Stitch dashes */}
          <path d="M40 10 L66 21 Q70 26 66 48 Q60 66 40 70 Q20 66 14 48 Q10 26 14 21 Z" fill="transparent" stroke={STROKE} strokeWidth="0.5" strokeDasharray="2 2" />
          {/* Mountain peak inside */}
          <path d="M20 56 L32 36 L40 48 L50 28 L60 56 Z" fill={STROKE} />
          <text x="40" y="22" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE} letterSpacing="0.15em">NPS</text>
        </svg>
      );
    case 'foldedMap':
      return (
        <svg viewBox="0 0 100 90" width="86" height="78" aria-hidden>
          {/* Folded paper map — accordion creases */}
          <rect x="3" y="6" width="94" height="78" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Crease lines */}
          {[27, 53, 79].map((x) => (
            <line key={x} x1={x} y1="6" x2={x} y2="84" stroke={STROKE} strokeWidth="0.6" strokeDasharray="3 2" />
          ))}
          <line x1="3" y1="42" x2="97" y2="42" stroke={STROKE} strokeWidth="0.6" strokeDasharray="3 2" />
          {/* Map content — abstract paths */}
          <path d="M10 16 Q30 24 50 14 Q70 6 90 16" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
          <path d="M10 60 Q40 50 70 64 Q85 70 92 64" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
          {/* Marked X */}
          <text x="62" y="34" textAnchor="middle" fontFamily={IS} fontSize="12" fontWeight="500" fill={STROKE}>✕</text>
          {/* Pinhole */}
          <circle cx="62" cy="32" r="1.2" fill={STROKE} />
        </svg>
      );
    case 'souvenirMagnet':
      return (
        <svg viewBox="0 0 80 70" width="68" height="60" aria-hidden>
          {/* Magnet body — landscape shape */}
          <rect x="3" y="3" width="74" height="64" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Place name banner */}
          <rect x="6" y="6" width="68" height="14" fill={STROKE} />
          <text x="40" y="16" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={BG} letterSpacing="0.18em">CARTAGENA</text>
          {/* Cartoon skyline */}
          <path d="M6 60 L14 50 L20 56 L26 44 L34 52 L40 38 L46 50 L54 42 L60 54 L68 46 L74 60 Z" fill={STROKE} />
        </svg>
      );
    case 'luggageTagWorn':
      return (
        <svg viewBox="0 0 60 100" width="50" height="86" aria-hidden>
          {/* String loop */}
          <circle cx="30" cy="10" r="3" fill="transparent" stroke={STROKE} strokeWidth="1.3" />
          <path d="M30 13 Q22 18 30 24" fill="transparent" stroke={STROKE} strokeWidth="1.1" />
          {/* Tag body */}
          <path d="M10 24 Q10 22 12 22 L48 22 Q50 22 50 24 L50 90 Q50 94 46 94 L14 94 Q10 94 10 90 Z" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          {/* Corner scuffs */}
          <line x1="10" y1="34" x2="14" y2="30" stroke={STROKE} strokeWidth="0.5" />
          <line x1="50" y1="86" x2="46" y2="90" stroke={STROKE} strokeWidth="0.5" />
          {/* Airport code box */}
          <rect x="14" y="34" width="32" height="20" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          <text x="30" y="48" textAnchor="middle" fontFamily={IS} fontSize="10" fontWeight="500" fill={STROKE} letterSpacing="0.18em">BOG</text>
          {/* Name line */}
          <line x1="14" y1="64" x2="46" y2="64" stroke={STROKE} strokeWidth="0.5" />
          <line x1="14" y1="74" x2="42" y2="74" stroke={STROKE} strokeWidth="0.5" />
          <line x1="14" y1="84" x2="38" y2="84" stroke={STROKE} strokeWidth="0.5" />
        </svg>
      );

    // ── GF (extended 2026-05-31) ────────────────────────────────────────────
    case 'eventTicketPair':
      return (
        <svg viewBox="0 0 110 80" width="98" height="72" aria-hidden>
          {/* First ticket */}
          <g transform="rotate(-4 35 40)">
            <path d="M4 14 L66 14 L66 50 L4 50 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
            <line x1="50" y1="14" x2="50" y2="50" stroke={STROKE} strokeWidth="0.7" strokeDasharray="2 2" />
            <text x="12" y="28" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE}>ROW B</text>
            <text x="12" y="42" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE}>FIRST DATE</text>
          </g>
          {/* Second ticket — overlapping, slight rotation */}
          <g transform="rotate(6 70 50)">
            <path d="M44 30 L106 30 L106 66 L44 66 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
            <line x1="90" y1="30" x2="90" y2="66" stroke={STROKE} strokeWidth="0.7" strokeDasharray="2 2" />
            <text x="52" y="44" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE}>ROW B</text>
            <text x="52" y="58" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE}>FIRST DATE</text>
          </g>
        </svg>
      );
    case 'friendshipBracelet':
      return (
        <svg viewBox="0 0 100 50" width="86" height="42" aria-hidden>
          {/* Two paired bracelets */}
          {[14, 30].map((y, i) => (
            <g key={y}>
              {/* String backbone */}
              <line x1="10" y1={y} x2="90" y2={y} stroke={STROKE} strokeWidth="0.9" />
              {/* Beads */}
              {[14, 22, 30, 38, 46, 54, 62, 70, 78, 86].map((x, idx) => (
                <circle
                  key={x}
                  cx={x}
                  cy={y}
                  r="3"
                  fill={(idx + i) % 2 === 0 ? STROKE : WASH}
                  stroke={STROKE}
                  strokeWidth="0.7"
                />
              ))}
            </g>
          ))}
        </svg>
      );
    case 'sharedHouseplant':
      return (
        <svg viewBox="0 0 70 100" width="60" height="86" aria-hidden>
          {/* Pot */}
          <path d="M16 60 L54 60 L50 96 L20 96 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Rim */}
          <line x1="14" y1="60" x2="56" y2="60" stroke={STROKE} strokeWidth="0.9" />
          {/* Vines and leaves trailing */}
          <path d="M35 60 Q35 40 22 30 Q14 22 12 14" fill="transparent" stroke={STROKE} strokeWidth="1.2" />
          <path d="M35 60 Q35 38 48 28 Q56 22 58 14" fill="transparent" stroke={STROKE} strokeWidth="1.2" />
          {/* Leaves */}
          {[
            [14, 18],
            [20, 30],
            [12, 26],
            [56, 18],
            [50, 28],
            [58, 26],
            [28, 38],
            [42, 42],
            [34, 52],
          ].map(([cx, cy], i) => (
            <ellipse key={i} cx={cx} cy={cy} rx="4" ry="2.5" fill={STROKE} transform={`rotate(${(i * 32) % 90 - 30} ${cx} ${cy})`} />
          ))}
        </svg>
      );

    // ── Running (extended 2026-05-31) ───────────────────────────────────────
    case 'finisherShirt':
      return (
        <svg viewBox="0 0 100 90" width="86" height="78" aria-hidden>
          <rect x="6" y="6" width="88" height="80" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Neckline */}
          <path d="M40 6 Q50 16 60 6" fill="transparent" stroke={STROKE} strokeWidth="1" />
          {/* Logo banner */}
          <text x="50" y="40" textAnchor="middle" fontFamily={IS} fontSize="10" fontWeight="500" fill={STROKE} letterSpacing="0.15em">5K</text>
          <line x1="22" y1="46" x2="78" y2="46" stroke={STROKE} strokeWidth="1" />
          <text x="50" y="60" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.18em">FINISHER</text>
          {/* Fold lines */}
          <line x1="6" y1="36" x2="94" y2="36" stroke={STROKE} strokeWidth="0.4" strokeDasharray="2 3" />
          <line x1="6" y1="66" x2="94" y2="66" stroke={STROKE} strokeWidth="0.4" strokeDasharray="2 3" />
        </svg>
      );
    case 'multiMedalHanger':
      return (
        <svg viewBox="0 0 130 90" width="110" height="76" aria-hidden>
          {/* Wall bar */}
          <rect x="4" y="6" width="122" height="6" fill={STROKE} />
          {/* Hanging medals — 4 of them at varying heights */}
          {[
            { x: 22, y: 42 },
            { x: 50, y: 50 },
            { x: 78, y: 44 },
            { x: 106, y: 52 },
          ].map((m, i) => (
            <g key={i}>
              <line x1={m.x} y1="12" x2={m.x} y2={m.y - 10} stroke={STROKE} strokeWidth="1" />
              <circle cx={m.x} cy={m.y} r="10" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
              <circle cx={m.x} cy={m.y} r="6" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
            </g>
          ))}
          {/* Wall hooks */}
          {[22, 50, 78, 106].map((x) => (
            <rect key={x} x={x - 2} y="12" width="4" height="2" fill={STROKE} />
          ))}
        </svg>
      );
    case 'framedRacePhoto':
      return (
        <svg viewBox="0 0 110 80" width="96" height="70" aria-hidden>
          <rect x="3" y="3" width="104" height="74" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Inner photo */}
          <rect x="10" y="10" width="90" height="60" fill={STROKE} />
          {/* Finish line banner */}
          <rect x="10" y="14" width="90" height="6" fill={BG} />
          <text x="55" y="19" textAnchor="middle" fontFamily={IS} fontSize="4" fontWeight="500" fill={STROKE} letterSpacing="0.18em">FINISH</text>
          {/* Runner silhouette */}
          <circle cx="50" cy="32" r="3" fill={BG} />
          <path d="M44 34 L56 34 L58 50 L52 52 L48 50 L46 52 L42 50 Z" fill={BG} />
          <line x1="42" y1="52" x2="38" y2="60" stroke={BG} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="58" y1="52" x2="62" y2="60" stroke={BG} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'agePodiumPlaque':
      return (
        <svg viewBox="0 0 90 100" width="76" height="86" aria-hidden>
          {/* Acrylic body */}
          <path d="M14 14 L76 14 L70 80 L20 80 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Inner engraving block */}
          <rect x="22" y="22" width="46" height="50" fill="transparent" stroke={STROKE} strokeWidth="0.6" strokeDasharray="2 2" />
          <text x="45" y="40" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.15em">AGE 30-34</text>
          <text x="45" y="58" textAnchor="middle" fontFamily={IS} fontSize="14" fontWeight="500" fill={STROKE}>3rd</text>
          {/* Stand */}
          <rect x="24" y="80" width="42" height="14" fill={STROKE} />
        </svg>
      );

    // ── Roots (extended 2026-05-31) ─────────────────────────────────────────
    case 'sombreroVueltiao':
      return (
        <svg viewBox="0 0 110 70" width="96" height="62" aria-hidden>
          {/* Brim */}
          <ellipse cx="55" cy="50" rx="50" ry="14" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Crown */}
          <ellipse cx="55" cy="32" rx="22" ry="20" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Decorative band rings (vueltas) */}
          {[24, 28, 32, 36, 40].map((y) => (
            <ellipse key={y} cx="55" cy={y} rx="22" ry="2" fill="transparent" stroke={STROKE} strokeWidth="0.7" strokeDasharray="3 2" />
          ))}
          {/* Brim decorative stripe */}
          <ellipse cx="55" cy="50" rx="50" ry="14" fill="transparent" stroke={STROKE} strokeWidth="0.5" />
          <path d="M10 50 Q30 56 50 52 Q80 48 100 54" fill="transparent" stroke={STROKE} strokeWidth="0.5" />
        </svg>
      );
    case 'mochilaWayuu':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          {/* Strap loop */}
          <path d="M20 32 Q20 6 40 6 Q60 6 60 32" fill="transparent" stroke={STROKE} strokeWidth="2" />
          {/* Bag body — rounded */}
          <path d="M14 30 L66 30 Q72 56 60 80 Q50 96 40 96 Q30 96 20 80 Q8 56 14 30 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Geometric Wayuu pattern bands */}
          {[40, 56, 72].map((y) => (
            <g key={y}>
              <line x1="14" y1={y} x2="66" y2={y} stroke={STROKE} strokeWidth="0.6" />
              {[20, 30, 40, 50, 60].map((x) => (
                <polygon key={x} points={`${x - 3},${y + 2} ${x},${y - 2} ${x + 3},${y + 2}`} fill={STROKE} />
              ))}
            </g>
          ))}
          {/* Bottom tassel */}
          <line x1="40" y1="96" x2="40" y2="106" stroke={STROKE} strokeWidth="2" />
        </svg>
      );
    case 'colombianFlagFolded':
      return (
        <svg viewBox="0 0 80 70" width="68" height="60" aria-hidden>
          {/* Folded flag — triangle / accordion fold */}
          <path d="M4 60 L76 60 L40 8 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Color stripe bands — folded look */}
          <path d="M16 38 L40 8 L64 38 Z" fill={STROKE} />
          <path d="M22 46 L40 18 L58 46 Z" fill={WASH} stroke={STROKE} strokeWidth="0.7" />
          <path d="M14 58 L40 22 L66 58 Z" fill={STROKE} clipPath="inset(0 0 0 0 round 0)" opacity="0.25" />
          {/* Fold creases */}
          <line x1="4" y1="60" x2="40" y2="8" stroke={STROKE} strokeWidth="0.5" />
          <line x1="76" y1="60" x2="40" y2="8" stroke={STROKE} strokeWidth="0.5" />
        </svg>
      );
    case 'boteroFigurine':
      return (
        <svg viewBox="0 0 70 100" width="58" height="84" aria-hidden>
          {/* Round Botero-style figure */}
          {/* Head */}
          <circle cx="35" cy="20" r="11" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Plump torso */}
          <ellipse cx="35" cy="50" rx="22" ry="18" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Plump legs */}
          <ellipse cx="24" cy="76" rx="9" ry="14" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <ellipse cx="46" cy="76" rx="9" ry="14" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          {/* Base plate */}
          <ellipse cx="35" cy="94" rx="24" ry="4" fill={STROKE} />
          {/* Face hint */}
          <circle cx="32" cy="20" r="0.9" fill={STROKE} />
          <circle cx="38" cy="20" r="0.9" fill={STROKE} />
        </svg>
      );
    case 'passportDocument':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          {/* Two stacked passports — CO + US */}
          <g transform="rotate(-4 40 50)">
            <rect x="6" y="14" width="60" height="78" fill={STROKE} />
            <text x="36" y="36" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG} letterSpacing="0.15em">REPÚBLICA DE</text>
            <text x="36" y="46" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={BG} letterSpacing="0.15em">COLOMBIA</text>
            <circle cx="36" cy="64" r="10" fill="transparent" stroke={BG} strokeWidth="0.9" />
          </g>
          <g transform="rotate(6 50 50)">
            <rect x="20" y="22" width="60" height="78" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
            <text x="50" y="42" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.15em">UNITED STATES</text>
            <text x="50" y="54" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.15em">OF AMERICA</text>
            <circle cx="50" cy="74" r="10" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          </g>
        </svg>
      );

    // ── Fidget (extended 2026-05-31) ────────────────────────────────────────
    case 'fidgetCollectionTray':
      return (
        <svg viewBox="0 0 110 80" width="96" height="70" aria-hidden>
          {/* Shallow display tray */}
          <rect x="3" y="6" width="104" height="68" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Slots — 5 fidget objects */}
          {/* Spinner */}
          <g transform="translate(22 26)">
            <circle cx="0" cy="0" r="3" fill={WASH} stroke={STROKE} strokeWidth="0.9" />
            <circle cx="-8" cy="6" r="5" fill={WASH} stroke={STROKE} strokeWidth="0.9" />
            <circle cx="8" cy="6" r="5" fill={WASH} stroke={STROKE} strokeWidth="0.9" />
            <circle cx="0" cy="-8" r="5" fill={WASH} stroke={STROKE} strokeWidth="0.9" />
          </g>
          {/* Cube */}
          <rect x="44" y="20" width="16" height="16" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <circle cx="49" cy="25" r="1.4" fill={STROKE} />
          <rect x="54" y="28" width="4" height="3" fill={STROKE} />
          {/* Worry stone oval */}
          <ellipse cx="80" cy="30" rx="12" ry="8" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <ellipse cx="80" cy="30" rx="5" ry="3" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
          {/* Begleri */}
          <g transform="translate(30 56)">
            <circle cx="0" cy="0" r="5" fill={WASH} stroke={STROKE} strokeWidth="0.9" />
            <circle cx="22" cy="0" r="5" fill={WASH} stroke={STROKE} strokeWidth="0.9" />
            <line x1="5" y1="0" x2="17" y2="0" stroke={STROKE} strokeWidth="0.9" />
          </g>
          {/* Tangle */}
          <path d="M70 52 Q80 46 90 52 Q98 60 90 66 Q80 70 70 66 Q62 60 70 52 Z" fill="transparent" stroke={STROKE} strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      );
    case 'wornFidgetCube':
      return (
        <svg viewBox="0 0 70 70" width="60" height="60" aria-hidden>
          {/* Cube with rounded worn corners (more pronounced) */}
          <rect x="6" y="6" width="58" height="58" rx="10" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Wear scuffs on corners */}
          <path d="M8 14 Q10 8 16 8" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
          <path d="M54 8 Q60 8 62 14" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
          <path d="M8 56 Q10 62 16 62" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
          <path d="M54 62 Q60 62 62 56" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
          {/* Faded buttons */}
          <circle cx="20" cy="22" r="3.5" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <rect x="36" y="18" width="14" height="6" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <rect x="14" y="38" width="14" height="6" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <circle cx="42" cy="42" r="4" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          {/* Use-marks */}
          <line x1="14" y1="50" x2="22" y2="56" stroke={STROKE} strokeWidth="0.4" />
          <line x1="50" y1="50" x2="58" y2="56" stroke={STROKE} strokeWidth="0.4" />
        </svg>
      );
    case 'begleriDisplay':
      return (
        <svg viewBox="0 0 70 100" width="58" height="86" aria-hidden>
          {/* Display stand vertical pole */}
          <rect x="32" y="6" width="6" height="80" fill={STROKE} />
          {/* Top hook */}
          <path d="M35 6 Q42 0 42 12" fill="transparent" stroke={STROKE} strokeWidth="1.4" />
          {/* Begleri hanging — two beads + cord */}
          <line x1="42" y1="12" x2="42" y2="36" stroke={STROKE} strokeWidth="0.8" />
          <circle cx="34" cy="50" r="8" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <circle cx="50" cy="50" r="8" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <path d="M42 36 Q38 44 34 50" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          <path d="M42 36 Q46 44 50 50" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          {/* Base */}
          <ellipse cx="35" cy="92" rx="22" ry="4" fill={STROKE} />
        </svg>
      );
    case 'komboloi':
      return (
        <svg viewBox="0 0 80 110" width="68" height="92" aria-hidden>
          {/* Komboloi — string of worry beads with tassel */}
          {/* Top knot */}
          <circle cx="40" cy="8" r="3" fill={STROKE} />
          {/* Two strands of beads forming loop */}
          {[14, 22, 30, 38, 46, 54, 62].map((y) => (
            <circle key={`l-${y}`} cx={28 - (y - 14) * 0.1} cy={y} r="3.4" fill={WASH} stroke={STROKE} strokeWidth="1" />
          ))}
          {[14, 22, 30, 38, 46, 54, 62].map((y) => (
            <circle key={`r-${y}`} cx={52 + (y - 14) * 0.1} cy={y} r="3.4" fill={WASH} stroke={STROKE} strokeWidth="1" />
          ))}
          {/* Bottom join */}
          <line x1="28" y1="62" x2="40" y2="72" stroke={STROKE} strokeWidth="0.9" />
          <line x1="52" y1="62" x2="40" y2="72" stroke={STROKE} strokeWidth="0.9" />
          <circle cx="40" cy="74" r="3" fill={STROKE} />
          {/* Tassel */}
          {[36, 38, 40, 42, 44].map((x) => (
            <line key={x} x1={x} y1="78" x2={x + (x - 40) * 0.2} y2="104" stroke={STROKE} strokeWidth="0.8" />
          ))}
        </svg>
      );
    case 'sealedKickstarterFidget':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          <rect x="3" y="3" width="74" height="94" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* "KS Edition" sticker */}
          <rect x="6" y="6" width="32" height="10" fill={STROKE} />
          <text x="22" y="13" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={BG} letterSpacing="0.15em">KICKSTARTER</text>
          {/* Window with cube inside */}
          <rect x="14" y="22" width="52" height="48" fill={BG} stroke={STROKE} strokeWidth="0.7" />
          <rect x="22" y="30" width="36" height="32" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Mini-cube buttons */}
          <circle cx="30" cy="38" r="2" fill={STROKE} />
          <rect x="38" y="36" width="8" height="3" fill={STROKE} />
          <rect x="26" y="50" width="8" height="3" fill={STROKE} />
          <circle cx="46" cy="52" r="2" fill={STROKE} />
          {/* Bottom label */}
          <text x="40" y="84" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE} letterSpacing="0.2em">ANTSY LABS</text>
        </svg>
      );

    // ── Seltzer (extended 2026-05-31) ───────────────────────────────────────
    case 'lacroixCan':
      return (
        <svg viewBox="0 0 60 110" width="50" height="92" aria-hidden>
          {/* Can body */}
          <rect x="8" y="10" width="44" height="92" rx="4" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Top rim */}
          <ellipse cx="30" cy="10" rx="22" ry="3" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Tab */}
          <ellipse cx="30" cy="8" rx="8" ry="2.5" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          {/* Brand wordmark */}
          <text x="30" y="48" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE} letterSpacing="0.2em">LACROIX</text>
          {/* Flavor strip */}
          <text x="30" y="62" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE} letterSpacing="0.18em">PAMPLEMOUSSE</text>
          {/* Pattern dots characteristic of LaCroix pastel */}
          {[
            [14, 70],
            [22, 76],
            [32, 72],
            [42, 80],
            [16, 86],
            [28, 90],
            [40, 88],
            [46, 76],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="1.6" fill={STROKE} />
          ))}
        </svg>
      );
    case 'topoChicoBottle':
      return (
        <svg viewBox="0 0 40 130" width="32" height="104" aria-hidden>
          {/* Long-neck glass bottle */}
          <path d="M16 4 L24 4 L24 30 Q34 38 34 60 L34 118 Q34 124 28 124 L12 124 Q6 124 6 118 L6 60 Q6 38 16 30 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Crown cap */}
          <rect x="14" y="2" width="12" height="6" fill={STROKE} />
          {/* Mountain logo on label */}
          <rect x="8" y="74" width="24" height="32" fill={BG} stroke={STROKE} strokeWidth="0.7" />
          <path d="M11 100 L17 86 L21 94 L26 80 L30 100 Z" fill={STROKE} />
          <text x="20" y="80" textAnchor="middle" fontFamily={IS} fontSize="4" fontWeight="500" fill={STROKE} letterSpacing="0.18em">TOPO CHICO</text>
        </svg>
      );
    case 'lacroixRack':
      return (
        <svg viewBox="0 0 110 90" width="96" height="78" aria-hidden>
          {/* Pyramid of cans — bottom row 4 */}
          {[0, 1, 2, 3].map((i) => (
            <g key={`b-${i}`} transform={`translate(${10 + i * 22} 60)`}>
              <rect x="0" y="0" width="20" height="28" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
              <rect x="2" y="10" width="16" height="6" fill={STROKE} />
            </g>
          ))}
          {/* Middle row 3 */}
          {[0, 1, 2].map((i) => (
            <g key={`m-${i}`} transform={`translate(${21 + i * 22} 32)`}>
              <rect x="0" y="0" width="20" height="28" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
              <rect x="2" y="10" width="16" height="6" fill={STROKE} />
            </g>
          ))}
          {/* Top row 2 */}
          {[0, 1].map((i) => (
            <g key={`t-${i}`} transform={`translate(${32 + i * 22} 4)`}>
              <rect x="0" y="0" width="20" height="28" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
              <rect x="2" y="10" width="16" height="6" fill={STROKE} />
            </g>
          ))}
        </svg>
      );
    case 'seltzerTshirt':
      return (
        <svg viewBox="0 0 100 90" width="86" height="78" aria-hidden>
          {/* Folded tee */}
          <rect x="6" y="6" width="88" height="80" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <path d="M40 6 Q50 16 60 6" fill="transparent" stroke={STROKE} strokeWidth="1" />
          {/* Branded text */}
          <text x="50" y="42" textAnchor="middle" fontFamily={IS} fontSize="11" fontWeight="500" fill={STROKE} letterSpacing="0.15em">LACROIX</text>
          <line x1="24" y1="48" x2="76" y2="48" stroke={STROKE} strokeWidth="0.8" />
          <text x="50" y="62" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE} letterSpacing="0.18em">PAMPLEMOUSSE</text>
          {/* Fold creases */}
          <line x1="6" y1="36" x2="94" y2="36" stroke={STROKE} strokeWidth="0.4" strokeDasharray="2 3" />
          <line x1="6" y1="66" x2="94" y2="66" stroke={STROKE} strokeWidth="0.4" strokeDasharray="2 3" />
        </svg>
      );
    case 'perrierPoster':
      return (
        <svg viewBox="0 0 70 100" width="60" height="86" aria-hidden>
          {/* Frame */}
          <rect x="3" y="3" width="64" height="94" fill={STROKE} />
          {/* Cream / vintage poster body */}
          <rect x="10" y="10" width="50" height="80" fill={BG} />
          {/* Vintage bottle suggestion */}
          <path d="M30 20 L40 20 L40 32 Q44 36 44 44 L44 72 Q44 76 40 76 L30 76 Q26 76 26 72 L26 44 Q26 36 30 32 Z" fill={STROKE} />
          <rect x="32" y="18" width="6" height="4" fill={STROKE} />
          {/* Brand text */}
          <text x="35" y="86" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE} letterSpacing="0.25em">PERRIER</text>
          {/* Designer footer */}
          <text x="35" y="93" textAnchor="middle" fontFamily={IS} fontSize="4" fontWeight="500" fill={STROKE} letterSpacing="0.15em">VILLEMOT · 1978</text>
        </svg>
      );
  }
}
