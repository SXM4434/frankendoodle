// PegToolShape — SVG renderer for 104 Pegboard layout items (Hero-8-Lab port).
// Ported 2026-06-08 per `feedback_fork_a_lab_means_port_everything` — the
// original desk-doodles fork left these behind. Same STROKE/WASH conventions
// as PinShape.tsx, no Hero-8 context dependencies.
import { IS } from '../typography';
import type { F3PegboardShapeId } from './identitySet';

const STROKE = 'var(--dir-text-primary)';
const WASH = 'color-mix(in oklab, var(--dir-text-primary) 8%, transparent)';
const BG_INK_FOR_PEGBOARD = 'var(--dir-bg)';

export function PegToolShape({ shape }: { shape: F3PegboardShapeId }) {
  switch (shape) {
    // ── Elara ──────────────────────────────────────────────────────────────
    case 'sketchbook':
      return (
        <svg viewBox="0 0 88 110" width="78" height="98" aria-hidden>
          <rect x="8" y="6" width="74" height="98" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {[20, 35, 50, 65, 80, 95].map((y) => (
            <circle key={y} cx="14" cy={y} r="1.6" fill={STROKE} />
          ))}
          <path d="M28 45 Q42 32 56 48 T78 56" fill="none" stroke={STROKE} strokeWidth="0.9" />
        </svg>
      );
    case 'draftingPen':
      return (
        <svg viewBox="0 0 28 110" width="22" height="86" aria-hidden>
          <rect x="9" y="6" width="10" height="90" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <polygon points="9,96 19,96 14,108" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <rect x="11" y="20" width="6" height="14" fill={STROKE} />
          <line x1="14" y1="36" x2="14" y2="80" stroke={STROKE} strokeWidth="0.7" />
        </svg>
      );
    case 'xacto':
      return (
        <svg viewBox="0 0 24 116" width="20" height="96" aria-hidden>
          <rect x="8" y="20" width="8" height="80" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <polygon points="8,6 16,6 12,20" fill={STROKE} />
          <line x1="12" y1="6" x2="12" y2="20" stroke={STROKE} strokeWidth="1" />
          {[35, 50, 65, 80].map((y) => (
            <line key={y} x1="8" y1={y} x2="16" y2={y} stroke={STROKE} strokeWidth="0.6" />
          ))}
        </svg>
      );

    // ── Ion ────────────────────────────────────────────────────────────────
    case 'macbook':
      return (
        <svg viewBox="0 0 120 80" width="100" height="67" aria-hidden>
          <rect x="6" y="8" width="108" height="60" rx="4" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <line x1="6" y1="64" x2="114" y2="64" stroke={STROKE} strokeWidth="0.9" />
          <circle cx="60" cy="36" r="6" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
        </svg>
      );
    case 'monitor':
      return (
        <svg viewBox="0 0 130 110" width="104" height="88" aria-hidden>
          <rect x="6" y="6" width="118" height="74" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <rect x="14" y="14" width="102" height="58" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          <rect x="58" y="82" width="14" height="14" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <rect x="40" y="98" width="50" height="6" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
        </svg>
      );
    case 'stylus':
      return (
        <svg viewBox="0 0 22 116" width="18" height="98" aria-hidden>
          <rect x="6" y="10" width="10" height="96" rx="5" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <polygon points="6,10 16,10 11,2" fill={STROKE} />
          <line x1="6" y1="40" x2="16" y2="40" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );

    // ── Punk ───────────────────────────────────────────────────────────────
    case 'vinyl':
      return (
        <svg viewBox="0 0 84 84" width="74" height="74" aria-hidden>
          <circle cx="42" cy="42" r="40" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <circle cx="42" cy="42" r="32" fill="transparent" stroke={STROKE} strokeWidth="0.5" />
          <circle cx="42" cy="42" r="26" fill="transparent" stroke={STROKE} strokeWidth="0.5" />
          <circle cx="42" cy="42" r="14" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <circle cx="42" cy="42" r="2" fill={STROKE} />
        </svg>
      );
    case 'guitarPedal':
      return (
        <svg viewBox="0 0 90 80" width="78" height="70" aria-hidden>
          <rect x="6" y="6" width="78" height="68" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <circle cx="28" cy="30" r="10" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <line x1="28" y1="22" x2="28" y2="30" stroke={STROKE} strokeWidth="1.2" />
          <circle cx="62" cy="30" r="10" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <line x1="62" y1="22" x2="68" y2="26" stroke={STROKE} strokeWidth="1.2" />
          <rect x="22" y="56" width="46" height="10" rx="3" fill={STROKE} />
        </svg>
      );
    case 'drumsticks':
      return (
        <svg viewBox="0 0 90 90" width="80" height="80" aria-hidden>
          <line x1="8" y1="82" x2="80" y2="10" stroke={STROKE} strokeWidth="3" strokeLinecap="round" />
          <circle cx="80" cy="10" r="4" fill={STROKE} />
          <line x1="10" y1="10" x2="82" y2="82" stroke={STROKE} strokeWidth="3" strokeLinecap="round" />
          <circle cx="10" cy="10" r="4" fill={STROKE} />
        </svg>
      );

    // ── Movies ─────────────────────────────────────────────────────────────
    case 'vhs':
      return (
        <svg viewBox="0 0 110 72" width="94" height="62" aria-hidden>
          <rect x="4" y="4" width="102" height="64" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <rect x="12" y="18" width="86" height="32" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <circle cx="34" cy="34" r="9" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <circle cx="76" cy="34" r="9" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <line x1="12" y1="60" x2="98" y2="60" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );
    case 'dvdSpine':
      return (
        <svg viewBox="0 0 28 120" width="22" height="98" aria-hidden>
          <rect x="4" y="4" width="20" height="112" rx="1" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <text x="14" y="64" textAnchor="middle" fontFamily={IS} fontSize="8" fontWeight="500" fill={STROKE} transform="rotate(-90 14 64)">
            FILM
          </text>
        </svg>
      );
    case 'popcornBucket':
      return (
        <svg viewBox="0 0 90 96" width="78" height="84" aria-hidden>
          <path d="M14 28 L76 28 L70 92 L20 92 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {[24, 36, 48, 60].map((x) => (
            <line key={x} x1={x} y1="34" x2={x} y2="88" stroke={STROKE} strokeWidth="0.6" />
          ))}
          <circle cx="26" cy="22" r="6" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <circle cx="42" cy="18" r="6" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <circle cx="58" cy="22" r="6" fill={WASH} stroke={STROKE} strokeWidth="1" />
        </svg>
      );
    case 'filmCanister':
      return (
        <svg viewBox="0 0 80 80" width="68" height="68" aria-hidden>
          <circle cx="40" cy="40" r="36" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <circle cx="40" cy="40" r="28" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
          <text x="40" y="44" textAnchor="middle" fontFamily={IS} fontSize="10" fontWeight="500" fill={STROKE}>
            35mm
          </text>
        </svg>
      );

    // ── WWE ────────────────────────────────────────────────────────────────
    case 'beltMini':
      return (
        <svg viewBox="0 0 130 60" width="106" height="49" aria-hidden>
          <rect x="6" y="22" width="118" height="16" rx="6" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <ellipse cx="65" cy="30" rx="26" ry="22" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <text x="65" y="34" textAnchor="middle" fontFamily={IS} fontSize="10" fontWeight="500" fill={STROKE}>
            ★
          </text>
        </svg>
      );
    case 'actionFigure':
      return (
        <svg viewBox="0 0 56 110" width="44" height="86" aria-hidden>
          <circle cx="28" cy="12" r="8" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <rect x="18" y="22" width="20" height="34" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <line x1="18" y1="30" x2="6" y2="48" stroke={STROKE} strokeWidth="3" strokeLinecap="round" />
          <line x1="38" y1="30" x2="50" y2="48" stroke={STROKE} strokeWidth="3" strokeLinecap="round" />
          <line x1="22" y1="56" x2="18" y2="92" stroke={STROKE} strokeWidth="3.5" strokeLinecap="round" />
          <line x1="34" y1="56" x2="38" y2="92" stroke={STROKE} strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      );
    case 'mic':
      return (
        <svg viewBox="0 0 48 110" width="38" height="88" aria-hidden>
          <ellipse cx="24" cy="22" rx="14" ry="18" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          {[12, 16, 20, 24, 28].map((y) => (
            <line key={y} x1="14" y1={y} x2="34" y2={y} stroke={STROKE} strokeWidth="0.6" />
          ))}
          <rect x="20" y="40" width="8" height="56" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <rect x="14" y="96" width="20" height="6" rx="2" fill={STROKE} />
        </svg>
      );

    // ── Pokémon ────────────────────────────────────────────────────────────
    case 'pokeball':
      return (
        <svg viewBox="0 0 70 70" width="58" height="58" aria-hidden>
          <circle cx="35" cy="35" r="30" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <line x1="5" y1="35" x2="65" y2="35" stroke={STROKE} strokeWidth="1.5" />
          <circle cx="35" cy="35" r="8" fill="var(--dir-bg)" stroke={STROKE} strokeWidth="1.5" />
          <circle cx="35" cy="35" r="3.5" fill={STROKE} />
        </svg>
      );
    case 'pokemonFigure':
      return (
        <svg viewBox="0 0 64 80" width="52" height="64" aria-hidden>
          <ellipse cx="32" cy="22" rx="20" ry="18" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <polygon points="14,12 4,2 18,8" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <polygon points="50,12 60,2 46,8" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <circle cx="24" cy="22" r="2" fill={STROKE} />
          <circle cx="40" cy="22" r="2" fill={STROKE} />
          <ellipse cx="32" cy="56" rx="22" ry="18" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
        </svg>
      );

    // ── Nintendo ───────────────────────────────────────────────────────────
    case 'switch':
      return (
        <svg viewBox="0 0 140 70" width="108" height="54" aria-hidden>
          <rect x="2" y="6" width="44" height="58" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <circle cx="14" cy="20" r="2" fill={STROKE} />
          <circle cx="14" cy="48" r="6" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <rect x="48" y="10" width="44" height="50" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <rect x="94" y="6" width="44" height="58" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <circle cx="126" cy="20" r="2" fill={STROKE} />
          {[18, 30, 42].map((y) => (
            <circle key={y} cx="126" cy={y} r="2" fill={STROKE} />
          ))}
        </svg>
      );
    case 'gameBoy':
      return (
        <svg viewBox="0 0 64 100" width="50" height="78" aria-hidden>
          <rect x="4" y="4" width="56" height="92" rx="6" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <rect x="12" y="14" width="40" height="32" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <line x1="20" y1="56" x2="20" y2="68" stroke={STROKE} strokeWidth="2.4" />
          <line x1="14" y1="62" x2="26" y2="62" stroke={STROKE} strokeWidth="2.4" />
          <circle cx="44" cy="62" r="3" fill={STROKE} />
          <circle cx="52" cy="68" r="3" fill={STROKE} />
          <line x1="22" y1="84" x2="42" y2="84" stroke={STROKE} strokeWidth="1.6" />
        </svg>
      );
    case 'nesCartridge':
      return (
        <svg viewBox="0 0 100 70" width="84" height="59" aria-hidden>
          <rect x="4" y="4" width="92" height="62" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <rect x="14" y="14" width="72" height="20" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <text x="50" y="28" textAnchor="middle" fontFamily={IS} fontSize="10" fontWeight="500" fill={STROKE}>
            NES
          </text>
          <line x1="14" y1="42" x2="86" y2="42" stroke={STROKE} strokeWidth="0.6" />
          <line x1="14" y1="50" x2="86" y2="50" stroke={STROKE} strokeWidth="0.6" />
          <line x1="14" y1="58" x2="86" y2="58" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );
    case 'marioHat':
      return (
        <svg viewBox="0 0 100 70" width="84" height="59" aria-hidden>
          <path d="M8 50 Q20 18 50 18 Q80 18 92 50 Z" fill={WASH} stroke={STROKE} strokeWidth="1.6" />
          <rect x="6" y="48" width="88" height="10" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <circle cx="50" cy="34" r="11" fill="var(--dir-bg)" stroke={STROKE} strokeWidth="1.4" />
          <text x="50" y="38" textAnchor="middle" fontFamily={IS} fontSize="13" fontWeight="500" fill={STROKE}>
            M
          </text>
        </svg>
      );

    // ── Sony ───────────────────────────────────────────────────────────────
    case 'ps5Controller':
      return (
        <svg viewBox="0 0 130 80" width="106" height="65" aria-hidden>
          <path d="M22 12 Q4 12 4 36 Q4 68 26 68 Q44 68 50 56 L80 56 Q86 68 104 68 Q126 68 126 36 Q126 12 108 12 Q92 12 84 22 L46 22 Q38 12 22 12 Z" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <circle cx="26" cy="36" r="5" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <circle cx="104" cy="44" r="5" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <circle cx="92" cy="28" r="3" fill={STROKE} />
          <circle cx="100" cy="36" r="3" fill={STROKE} />
        </svg>
      );
    case 'walkman':
      return (
        <svg viewBox="0 0 80 100" width="62" height="78" aria-hidden>
          <rect x="4" y="4" width="72" height="92" rx="4" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <rect x="12" y="14" width="56" height="32" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <circle cx="26" cy="30" r="6" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <circle cx="54" cy="30" r="6" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <rect x="14" y="58" width="52" height="6" rx="2" fill={STROKE} />
          {[72, 82].map((y) => (
            <rect key={y} x="14" y={y} width="52" height="3" fill={STROKE} />
          ))}
        </svg>
      );
    case 'vita':
      return (
        <svg viewBox="0 0 140 60" width="110" height="47" aria-hidden>
          <rect x="2" y="6" width="136" height="48" rx="6" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <rect x="30" y="12" width="80" height="36" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <line x1="14" y1="22" x2="22" y2="22" stroke={STROKE} strokeWidth="2" />
          <line x1="18" y1="18" x2="18" y2="26" stroke={STROKE} strokeWidth="2" />
          <circle cx="120" cy="22" r="2.4" fill={STROKE} />
          <circle cx="128" cy="22" r="2.4" fill={STROKE} />
          <circle cx="120" cy="38" r="2.4" fill={STROKE} />
          <circle cx="128" cy="38" r="2.4" fill={STROKE} />
        </svg>
      );

    // ── GF ─────────────────────────────────────────────────────────────────
    case 'ring':
      return (
        <svg viewBox="0 0 60 60" width="48" height="48" aria-hidden>
          <circle cx="30" cy="38" r="18" fill="transparent" stroke={STROKE} strokeWidth="2.5" />
          <polygon points="22,18 38,18 30,4" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
        </svg>
      );
    case 'keychain':
      return (
        <svg viewBox="0 0 80 100" width="62" height="78" aria-hidden>
          <circle cx="40" cy="14" r="10" fill="transparent" stroke={STROKE} strokeWidth="1.6" />
          <line x1="40" y1="24" x2="40" y2="40" stroke={STROKE} strokeWidth="1.4" />
          {/* Two paired keys hanging */}
          <path d="M30 48 L30 88 L36 92 L36 80 L32 80" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <path d="M50 48 L50 90 L44 94 L44 82 L48 82" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
        </svg>
      );
    case 'pairedMug':
      return (
        <svg viewBox="0 0 110 70" width="94" height="60" aria-hidden>
          <rect x="6" y="14" width="34" height="44" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <path d="M40 22 Q50 22 50 32 Q50 42 40 42" fill="transparent" stroke={STROKE} strokeWidth="1.4" />
          <rect x="64" y="14" width="34" height="44" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <path d="M98 22 Q108 22 108 32 Q108 42 98 42" fill="transparent" stroke={STROKE} strokeWidth="1.4" />
        </svg>
      );

    // ── Roots ──────────────────────────────────────────────────────────────
    case 'flagPin':
      return (
        <svg viewBox="0 0 60 60" width="46" height="46" aria-hidden>
          <circle cx="30" cy="30" r="24" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <path d="M6 22 L54 22" stroke={STROKE} strokeWidth="3" />
          <path d="M6 30 L54 30" stroke={STROKE} strokeWidth="2" strokeDasharray="3 3" />
          <path d="M6 38 L54 38" stroke={STROKE} strokeWidth="3" />
          <circle cx="30" cy="30" r="3" fill={STROKE} />
        </svg>
      );
    case 'arepaPan':
      return (
        <svg viewBox="0 0 130 60" width="108" height="50" aria-hidden>
          <circle cx="40" cy="30" r="26" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <circle cx="40" cy="30" r="20" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          <rect x="66" y="26" width="58" height="8" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
        </svg>
      );
    case 'ruanaCloth':
      return (
        <svg viewBox="0 0 90 80" width="74" height="66" aria-hidden>
          <path d="M8 8 L82 8 L74 72 L16 72 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {[20, 30, 40, 50, 60].map((y) => (
            <line key={y} x1="14" y1={y} x2="76" y2={y} stroke={STROKE} strokeWidth="0.5" />
          ))}
          <line x1="45" y1="8" x2="45" y2="72" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );

    // ── Travel ─────────────────────────────────────────────────────────────
    case 'passport':
      return (
        <svg viewBox="0 0 70 90" width="56" height="72" aria-hidden>
          <rect x="4" y="4" width="62" height="82" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <circle cx="35" cy="40" r="14" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <text x="35" y="44" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={STROKE}>
            ◇
          </text>
          <text x="35" y="68" textAnchor="middle" fontFamily={IS} fontSize="8" fontWeight="500" fill={STROKE}>
            PASSPORT
          </text>
        </svg>
      );
    case 'luggageTag':
      return (
        <svg viewBox="0 0 70 110" width="56" height="88" aria-hidden>
          <circle cx="35" cy="10" r="4" fill="transparent" stroke={STROKE} strokeWidth="1.3" />
          <line x1="35" y1="14" x2="35" y2="24" stroke={STROKE} strokeWidth="1" />
          <rect x="8" y="24" width="54" height="78" rx="4" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <line x1="14" y1="42" x2="56" y2="42" stroke={STROKE} strokeWidth="0.7" />
          <line x1="14" y1="54" x2="56" y2="54" stroke={STROKE} strokeWidth="0.7" />
          <line x1="14" y1="66" x2="44" y2="66" stroke={STROKE} strokeWidth="0.7" />
        </svg>
      );

    // ── Running ────────────────────────────────────────────────────────────
    case 'shoe':
      return (
        <svg viewBox="0 0 130 70" width="100" height="54" aria-hidden>
          <path
            d="M8 50 Q8 38 22 36 Q34 34 46 38 Q60 32 76 30 Q96 28 110 38 Q122 44 122 54 L122 60 Q122 64 116 64 L14 64 Q8 64 8 58 Z"
            fill={WASH}
            stroke={STROKE}
            strokeWidth="1.5"
          />
          <line x1="58" y1="36" x2="62" y2="44" stroke={STROKE} strokeWidth="0.9" />
          <line x1="66" y1="34" x2="70" y2="44" stroke={STROKE} strokeWidth="0.9" />
          <line x1="74" y1="33" x2="78" y2="44" stroke={STROKE} strokeWidth="0.9" />
          <line x1="8" y1="55" x2="122" y2="55" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );
    case 'gpsWatch':
      return (
        <svg viewBox="0 0 70 90" width="56" height="72" aria-hidden>
          <rect x="20" y="2" width="30" height="10" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <rect x="6" y="12" width="58" height="66" rx="6" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <rect x="14" y="22" width="42" height="46" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <text x="35" y="44" textAnchor="middle" fontFamily={IS} fontSize="8" fontWeight="500" fill={STROKE}>5K</text>
          <text x="35" y="58" textAnchor="middle" fontFamily={IS} fontSize="7" fill={STROKE}>21:43</text>
          <rect x="20" y="78" width="30" height="10" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
        </svg>
      );
    case 'medal':
      return (
        <svg viewBox="0 0 70 90" width="52" height="68" aria-hidden>
          <path d="M22 6 L48 6 L42 36 L28 36 Z" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <circle cx="35" cy="60" r="22" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <circle cx="35" cy="60" r="14" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <text x="35" y="64" textAnchor="middle" fontFamily={IS} fontSize="11" fontWeight="500" fill={STROKE}>S</text>
        </svg>
      );

    // ── Daily traits ───────────────────────────────────────────────────────
    case 'fidget':
      return (
        <svg viewBox="0 0 80 80" width="56" height="56" aria-hidden>
          <circle cx="40" cy="40" r="9" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <circle cx="40" cy="14" r="8" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <circle cx="62" cy="52" r="8" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <circle cx="18" cy="52" r="8" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <line x1="40" y1="32" x2="40" y2="22" stroke={STROKE} strokeWidth="1" />
          <line x1="48" y1="44" x2="55" y2="50" stroke={STROKE} strokeWidth="1" />
          <line x1="32" y1="44" x2="25" y2="50" stroke={STROKE} strokeWidth="1" />
        </svg>
      );
    case 'seltzer':
      return (
        <svg viewBox="0 0 50 110" width="40" height="88" aria-hidden>
          <rect x="8" y="10" width="34" height="92" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <line x1="8" y1="18" x2="42" y2="18" stroke={STROKE} strokeWidth="0.9" />
          <circle cx="25" cy="14" r="2.2" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          <line x1="11" y1="56" x2="39" y2="56" stroke={STROKE} strokeWidth="0.7" />
          <line x1="11" y1="64" x2="39" y2="64" stroke={STROKE} strokeWidth="0.7" />
        </svg>
      );

    // ── Sketching (extended 2026-05-31) ─────────────────────────────────────
    case 'mechanicalPencil':
      return (
        <svg viewBox="0 0 22 110" width="18" height="92" aria-hidden>
          <rect x="6" y="14" width="10" height="80" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Knurled section */}
          {[24, 28, 32, 36, 40].map((y) => (
            <line key={y} x1="6" y1={y} x2="16" y2={y} stroke={STROKE} strokeWidth="0.4" />
          ))}
          {/* Metal clip */}
          <line x1="14" y1="18" x2="14" y2="56" stroke={STROKE} strokeWidth="1.2" />
          {/* Lead sleeve cone */}
          <polygon points="6,94 16,94 14,102 8,102" fill={WASH} stroke={STROKE} strokeWidth="1.1" />
          <line x1="11" y1="102" x2="11" y2="108" stroke={STROKE} strokeWidth="1" />
          {/* Push button cap */}
          <rect x="8" y="6" width="6" height="8" fill={STROKE} />
        </svg>
      );
    case 'capPen':
      return (
        <svg viewBox="0 0 22 110" width="18" height="92" aria-hidden>
          <rect x="6" y="40" width="10" height="62" rx="1" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Cap */}
          <rect x="5" y="4" width="12" height="40" rx="1" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Clip on cap */}
          <line x1="14" y1="8" x2="14" y2="36" stroke={STROKE} strokeWidth="1.4" />
          <circle cx="14" cy="34" r="1.4" fill={STROKE} />
          {/* Cap-body seam */}
          <line x1="5" y1="44" x2="17" y2="44" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );
    case 'brushPen':
      return (
        <svg viewBox="0 0 24 110" width="20" height="92" aria-hidden>
          <rect x="7" y="20" width="10" height="62" rx="1" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Tapered brush nib */}
          <path d="M7 82 L17 82 L14 104 Q12 108 12 108 Q12 108 10 104 Z" fill={STROKE} />
          {/* Cap top */}
          <rect x="8" y="6" width="8" height="14" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <line x1="7" y1="20" x2="17" y2="20" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );
    case 'chiselMarker':
      return (
        <svg viewBox="0 0 26 110" width="22" height="92" aria-hidden>
          {/* Bullet body */}
          <rect x="5" y="10" width="16" height="72" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Body label band */}
          <rect x="5" y="40" width="16" height="10" fill={STROKE} />
          {/* Chisel nib */}
          <polygon points="5,82 21,82 17,104 9,104" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <line x1="9" y1="104" x2="17" y2="104" stroke={STROKE} strokeWidth="1.6" />
        </svg>
      );
    case 'eraserBlock':
      return (
        <svg viewBox="0 0 64 36" width="56" height="32" aria-hidden>
          <rect x="3" y="3" width="58" height="30" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          {/* Paper sleeve */}
          <rect x="3" y="14" width="58" height="12" fill={STROKE} />
          <text x="32" y="23" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={BG_INK_FOR_PEGBOARD} letterSpacing="0.06em">MARS</text>
        </svg>
      );
    case 'triangleRuler':
      return (
        <svg viewBox="0 0 90 90" width="74" height="74" aria-hidden>
          <polygon points="6,82 84,82 6,8" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          {/* Tick marks along hypotenuse */}
          {[14, 24, 34, 44, 54, 64, 74].map((d) => (
            <line key={d} x1={d} y1="82" x2={d} y2="78" stroke={STROKE} strokeWidth="0.7" />
          ))}
          {/* Tick marks along vertical */}
          {[16, 26, 36, 46, 56, 66, 76].map((d) => (
            <line key={d} x1="6" y1={d} x2="10" y2={d} stroke={STROKE} strokeWidth="0.7" />
          ))}
          <text x="14" y="76" fontFamily={IS} fontSize="6" fontWeight="500" fill={STROKE}>30 · 60 · 90</text>
        </svg>
      );

    // ── Work-rig (extended 2026-05-31) ──────────────────────────────────────
    case 'laptopSideProfile':
      return (
        <svg viewBox="0 0 120 30" width="100" height="25" aria-hidden>
          {/* Closed laptop seen from the side — thin slab */}
          <rect x="4" y="10" width="112" height="10" rx="1.5" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Apple monogram suggestion */}
          <circle cx="60" cy="15" r="1.6" fill={STROKE} />
          {/* Lid/deck seam */}
          <line x1="4" y1="15" x2="116" y2="15" stroke={STROKE} strokeWidth="0.5" />
        </svg>
      );
    case 'mxMouse':
      return (
        <svg viewBox="0 0 70 100" width="56" height="80" aria-hidden>
          {/* Asymmetric MX Master contour */}
          <path d="M14 12 Q34 4 50 14 Q60 22 60 50 Q60 86 36 92 Q14 92 10 70 Q6 40 14 12 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Thumb rest indent */}
          <path d="M14 38 Q4 44 4 56 Q4 66 12 72" fill="transparent" stroke={STROKE} strokeWidth="1" />
          {/* Scroll wheel */}
          <rect x="32" y="22" width="6" height="14" rx="2" fill={STROKE} />
          {/* Buttons gap */}
          <line x1="34" y1="14" x2="34" y2="22" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );
    case 'mechKeyboard':
      return (
        <svg viewBox="0 0 130 50" width="106" height="41" aria-hidden>
          <rect x="4" y="4" width="122" height="42" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Two rows of keycaps */}
          {[12, 24].map((y) =>
            [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110].map((x) => (
              <rect key={`${y}-${x}`} x={x} y={y} width="8" height="8" fill={WASH} stroke={STROKE} strokeWidth="0.5" />
            ))
          )}
          {/* Spacebar */}
          <rect x="30" y="36" width="70" height="6" fill={WASH} stroke={STROKE} strokeWidth="0.5" />
        </svg>
      );
    case 'overEarHeadphones':
      return (
        <svg viewBox="0 0 100 90" width="84" height="76" aria-hidden>
          {/* Headband arc */}
          <path d="M14 50 Q14 12 50 12 Q86 12 86 50" fill="transparent" stroke={STROKE} strokeWidth="2" />
          {/* Left ear cup */}
          <ellipse cx="14" cy="60" rx="11" ry="16" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Right ear cup */}
          <ellipse cx="86" cy="60" rx="11" ry="16" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Cup grilles */}
          <circle cx="14" cy="60" r="6" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
          <circle cx="86" cy="60" r="6" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );
    case 'usbCCable':
      return (
        <svg viewBox="0 0 80 80" width="64" height="64" aria-hidden>
          {/* Coiled cable */}
          <circle cx="40" cy="40" r="32" fill="transparent" stroke={STROKE} strokeWidth="1.8" />
          <circle cx="40" cy="40" r="24" fill="transparent" stroke={STROKE} strokeWidth="1.5" />
          <circle cx="40" cy="40" r="16" fill="transparent" stroke={STROKE} strokeWidth="1.2" />
          {/* USB-C tip */}
          <rect x="34" y="2" width="12" height="6" rx="2" fill={STROKE} />
        </svg>
      );
    case 'fieldNotes':
      return (
        <svg viewBox="0 0 60 90" width="50" height="76" aria-hidden>
          <rect x="4" y="6" width="52" height="80" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Staple binding */}
          <line x1="14" y1="14" x2="14" y2="20" stroke={STROKE} strokeWidth="1.4" />
          <line x1="46" y1="14" x2="46" y2="20" stroke={STROKE} strokeWidth="1.4" />
          {/* Title band */}
          <rect x="10" y="26" width="40" height="14" fill={STROKE} />
          <text x="30" y="36" textAnchor="middle" fontFamily={IS} fontSize="6" fontWeight="500" fill={BG_INK_FOR_PEGBOARD} letterSpacing="0.12em">FIELD</text>
          <line x1="10" y1="52" x2="50" y2="52" stroke={STROKE} strokeWidth="0.5" />
          <line x1="10" y1="60" x2="50" y2="60" stroke={STROKE} strokeWidth="0.5" />
          <line x1="10" y1="68" x2="46" y2="68" stroke={STROKE} strokeWidth="0.5" />
          <line x1="10" y1="76" x2="44" y2="76" stroke={STROKE} strokeWidth="0.5" />
        </svg>
      );

    // ── Punk (extended 2026-05-31) ──────────────────────────────────────────
    case 'electricGuitar':
      return (
        <svg viewBox="0 0 70 120" width="56" height="96" aria-hidden>
          {/* Headstock */}
          <polygon points="20,4 50,4 46,18 24,18" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Tuning pegs */}
          {[8, 14].map((y) => (
            <circle key={`l-${y}`} cx="22" cy={y} r="1.2" fill={STROKE} />
          ))}
          {[8, 14].map((y) => (
            <circle key={`r-${y}`} cx="48" cy={y} r="1.2" fill={STROKE} />
          ))}
          {/* Neck */}
          <rect x="30" y="18" width="10" height="48" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Frets */}
          {[26, 34, 42, 50, 58].map((y) => (
            <line key={y} x1="30" y1={y} x2="40" y2={y} stroke={STROKE} strokeWidth="0.5" />
          ))}
          {/* Body — offset cutaway shape (Jaguar/Mustang inspired) */}
          <path d="M14 66 Q6 70 8 88 Q10 110 28 114 Q42 116 52 110 Q66 102 64 84 Q62 70 56 66 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Pickups */}
          <rect x="30" y="76" width="10" height="4" fill={STROKE} />
          <rect x="30" y="90" width="10" height="4" fill={STROKE} />
          {/* Bridge */}
          <rect x="28" y="100" width="14" height="3" fill={STROKE} />
        </svg>
      );
    case 'bassGuitar':
      return (
        <svg viewBox="0 0 70 130" width="56" height="104" aria-hidden>
          <polygon points="20,4 50,4 46,18 24,18" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <circle cx="22" cy="8" r="1.2" fill={STROKE} />
          <circle cx="22" cy="14" r="1.2" fill={STROKE} />
          <circle cx="48" cy="8" r="1.2" fill={STROKE} />
          <circle cx="48" cy="14" r="1.2" fill={STROKE} />
          {/* Long bass neck */}
          <rect x="30" y="18" width="10" height="60" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {[26, 34, 42, 50, 58, 66, 74].map((y) => (
            <line key={y} x1="30" y1={y} x2="40" y2={y} stroke={STROKE} strokeWidth="0.5" />
          ))}
          {/* P-bass body */}
          <path d="M14 78 Q4 84 8 102 Q14 124 32 126 Q50 126 60 116 Q66 100 62 86 Q56 78 50 78 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Split-coil pickup */}
          <rect x="20" y="92" width="12" height="4" fill={STROKE} />
          <rect x="38" y="100" width="12" height="4" fill={STROKE} />
        </svg>
      );
    case 'guitarPick':
      return (
        <svg viewBox="0 0 40 50" width="34" height="42" aria-hidden>
          <path d="M20 4 Q34 6 34 22 Q34 36 20 46 Q6 36 6 22 Q6 6 20 4 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Edge wear */}
          <path d="M14 40 Q18 38 22 40" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
        </svg>
      );
    case 'ampCombo':
      return (
        <svg viewBox="0 0 100 80" width="84" height="68" aria-hidden>
          <rect x="4" y="6" width="92" height="68" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Control panel strip */}
          <rect x="10" y="12" width="80" height="10" fill={STROKE} />
          {/* Knobs */}
          {[20, 32, 44, 56, 68, 80].map((x) => (
            <circle key={x} cx={x} cy="17" r="1.6" fill={WASH} />
          ))}
          {/* Speaker grille */}
          <rect x="14" y="28" width="72" height="40" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          {[36, 44, 52, 60].map((y) => (
            <line key={y} x1="14" y1={y} x2="86" y2={y} stroke={STROKE} strokeWidth="0.4" />
          ))}
        </svg>
      );

    // ── Movies (extended 2026-05-31) ────────────────────────────────────────
    case 'filmReel':
      return (
        <svg viewBox="0 0 90 90" width="78" height="78" aria-hidden>
          <circle cx="45" cy="45" r="42" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <circle cx="45" cy="45" r="32" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          {/* Sprocket holes */}
          {[0, 60, 120, 180, 240, 300].map((deg) => {
            const r = 24;
            const rad = (deg * Math.PI) / 180;
            const cx = 45 + r * Math.cos(rad);
            const cy = 45 + r * Math.sin(rad);
            return <circle key={deg} cx={cx} cy={cy} r="4" fill="transparent" stroke={STROKE} strokeWidth="0.9" />;
          })}
          <circle cx="45" cy="45" r="4" fill={STROKE} />
        </svg>
      );
    case 'clapperboard':
      return (
        <svg viewBox="0 0 100 80" width="86" height="68" aria-hidden>
          {/* Body */}
          <rect x="4" y="22" width="92" height="54" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Top clapper bar */}
          <rect x="4" y="6" width="92" height="14" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Diagonal stripes */}
          {[0, 14, 28, 42, 56, 70].map((x) => (
            <polygon key={x} points={`${x + 4},6 ${x + 14},6 ${x + 8},20 ${x + 4 - 2},20`} fill={STROKE} />
          ))}
          {/* Slate scribbles */}
          <line x1="14" y1="36" x2="60" y2="36" stroke={STROKE} strokeWidth="0.7" />
          <line x1="14" y1="46" x2="80" y2="46" stroke={STROKE} strokeWidth="0.7" />
          <line x1="14" y1="56" x2="44" y2="56" stroke={STROKE} strokeWidth="0.7" />
        </svg>
      );
    case 'boomMic':
      return (
        <svg viewBox="0 0 30 130" width="24" height="104" aria-hidden>
          {/* Boom pole */}
          <line x1="15" y1="36" x2="15" y2="128" stroke={STROKE} strokeWidth="2" />
          {/* Mic shotgun body */}
          <rect x="10" y="14" width="10" height="22" rx="1" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Mic windscreen / dead cat fluff suggestion */}
          <ellipse cx="15" cy="10" rx="9" ry="8" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {[6, 9, 12].map((y) => (
            <line key={y} x1="8" y1={y} x2="22" y2={y} stroke={STROKE} strokeWidth="0.4" />
          ))}
        </svg>
      );
    case 'filmStrip':
      return (
        <svg viewBox="0 0 40 110" width="32" height="92" aria-hidden>
          <rect x="4" y="4" width="32" height="102" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Sprocket holes left + right */}
          {[10, 22, 34, 46, 58, 70, 82, 94].map((y) => (
            <rect key={`l-${y}`} x="6" y={y} width="3" height="6" fill={BG_INK_FOR_PEGBOARD} stroke={STROKE} strokeWidth="0.4" />
          ))}
          {[10, 22, 34, 46, 58, 70, 82, 94].map((y) => (
            <rect key={`r-${y}`} x="31" y={y} width="3" height="6" fill={BG_INK_FOR_PEGBOARD} stroke={STROKE} strokeWidth="0.4" />
          ))}
          {/* Frame divisions */}
          {[14, 42, 70, 98].map((y) => (
            <line key={y} x1="11" y1={y} x2="29" y2={y} stroke={STROKE} strokeWidth="0.5" />
          ))}
        </svg>
      );
    case 'homeProjector':
      return (
        <svg viewBox="0 0 100 70" width="86" height="60" aria-hidden>
          {/* Body */}
          <rect x="14" y="22" width="54" height="34" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Lens barrel */}
          <rect x="68" y="32" width="14" height="14" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <circle cx="82" cy="39" r="6" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Two reels on top */}
          <circle cx="26" cy="14" r="10" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <circle cx="26" cy="14" r="4" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
          <circle cx="56" cy="14" r="10" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <circle cx="56" cy="14" r="4" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
        </svg>
      );

    // ── Pokémon (extended 2026-05-31) ───────────────────────────────────────
    case 'cardSleeve':
      return (
        <svg viewBox="0 0 60 80" width="50" height="66" aria-hidden>
          <rect x="4" y="4" width="52" height="72" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Inner sleeve card outline */}
          <rect x="10" y="10" width="40" height="60" rx="1" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
          <text x="30" y="44" textAnchor="middle" fontFamily={IS} fontSize="10" fontWeight="500" fill={STROKE}>★</text>
        </svg>
      );
    case 'cardBinder':
      return (
        <svg viewBox="0 0 80 100" width="68" height="86" aria-hidden>
          <rect x="4" y="4" width="72" height="92" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Three ring binder dots on spine */}
          {[20, 50, 80].map((y) => (
            <circle key={y} cx="10" cy={y} r="2" fill={STROKE} />
          ))}
          {/* 3x3 grid for sleeve pages */}
          {[18, 36, 54].map((x) => (
            [18, 44, 70].map((y) => (
              <rect key={`${x}-${y}`} x={x} y={y} width="14" height="20" fill="transparent" stroke={STROKE} strokeWidth="0.6" />
            ))
          ))}
        </svg>
      );
    case 'boosterPack':
      return (
        <svg viewBox="0 0 60 100" width="48" height="80" aria-hidden>
          <rect x="4" y="4" width="52" height="92" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Foil-effect diagonal strips */}
          {[16, 26, 36, 46].map((y) => (
            <line key={y} x1="4" y1={y} x2="56" y2={y} stroke={STROKE} strokeWidth="0.4" />
          ))}
          {/* Booster art badge */}
          <rect x="14" y="56" width="32" height="20" fill={STROKE} />
          <text x="30" y="70" textAnchor="middle" fontFamily={IS} fontSize="8" fontWeight="500" fill={BG_INK_FOR_PEGBOARD} letterSpacing="0.1em">PKMN</text>
          {/* Tear notch */}
          <line x1="4" y1="12" x2="56" y2="12" stroke={STROKE} strokeWidth="0.6" strokeDasharray="2 2" />
        </svg>
      );
    case 'playmat':
      return (
        <svg viewBox="0 0 130 80" width="106" height="65" aria-hidden>
          <rect x="3" y="3" width="124" height="74" rx="4" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Two card play zones */}
          <rect x="14" y="14" width="40" height="20" fill="transparent" stroke={STROKE} strokeWidth="0.7" strokeDasharray="2 2" />
          <rect x="14" y="44" width="40" height="20" fill="transparent" stroke={STROKE} strokeWidth="0.7" strokeDasharray="2 2" />
          {/* Art zone */}
          <circle cx="92" cy="40" r="20" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <text x="92" y="44" textAnchor="middle" fontFamily={IS} fontSize="10" fontWeight="500" fill={STROKE}>★</text>
        </svg>
      );

    // ── Nintendo (extended 2026-05-31) ──────────────────────────────────────
    case 'nesController':
      return (
        <svg viewBox="0 0 140 56" width="110" height="44" aria-hidden>
          <rect x="3" y="3" width="134" height="50" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* D-pad */}
          <line x1="14" y1="28" x2="32" y2="28" stroke={STROKE} strokeWidth="4" />
          <line x1="23" y1="18" x2="23" y2="38" stroke={STROKE} strokeWidth="4" />
          {/* Select/Start */}
          <rect x="54" y="26" width="10" height="4" fill={STROKE} />
          <rect x="70" y="26" width="10" height="4" fill={STROKE} />
          {/* A / B buttons */}
          <circle cx="100" cy="28" r="6" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <circle cx="120" cy="28" r="6" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <text x="100" y="32" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE}>B</text>
          <text x="120" y="32" textAnchor="middle" fontFamily={IS} fontSize="7" fontWeight="500" fill={STROKE}>A</text>
        </svg>
      );
    case 'snesController':
      return (
        <svg viewBox="0 0 140 70" width="110" height="55" aria-hidden>
          {/* Dog-bone body */}
          <path d="M28 14 Q14 14 14 30 Q14 56 38 56 L102 56 Q126 56 126 30 Q126 14 112 14 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* D-pad */}
          <line x1="26" y1="34" x2="44" y2="34" stroke={STROKE} strokeWidth="3.5" />
          <line x1="35" y1="24" x2="35" y2="44" stroke={STROKE} strokeWidth="3.5" />
          {/* 4 face buttons in diamond */}
          <circle cx="106" cy="24" r="3.4" fill={STROKE} />
          <circle cx="106" cy="44" r="3.4" fill={STROKE} />
          <circle cx="96" cy="34" r="3.4" fill={STROKE} />
          <circle cx="116" cy="34" r="3.4" fill={STROKE} />
          {/* Select / Start */}
          <rect x="60" y="32" width="8" height="3" fill={STROKE} />
          <rect x="74" y="32" width="8" height="3" fill={STROKE} />
        </svg>
      );
    case 'n64Controller':
      return (
        <svg viewBox="0 0 120 100" width="98" height="82" aria-hidden>
          {/* Three-prong trident — middle prong, left prong, right prong */}
          {/* Left prong */}
          <path d="M6 32 Q6 22 16 22 L40 22 L40 60 Q40 86 28 86 Q18 86 12 76 Q6 60 6 32 Z" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          {/* Middle prong (analog stick) */}
          <path d="M40 22 L80 22 L80 70 Q80 84 70 84 L50 84 Q40 84 40 70 Z" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <circle cx="60" cy="48" r="7" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <circle cx="60" cy="48" r="2" fill={STROKE} />
          {/* Right prong */}
          <path d="M80 22 L104 22 Q114 22 114 32 Q114 60 108 76 Q102 86 92 86 Q80 86 80 60 Z" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          {/* C-buttons cluster */}
          {[
            [98, 36],
            [108, 44],
            [98, 52],
            [88, 44],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill={STROKE} />
          ))}
        </svg>
      );
    case 'joyConSingle':
      return (
        <svg viewBox="0 0 40 100" width="32" height="80" aria-hidden>
          <rect x="4" y="4" width="32" height="92" rx="6" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Analog stick */}
          <circle cx="20" cy="20" r="6" fill={WASH} stroke={STROKE} strokeWidth="1.1" />
          <circle cx="20" cy="20" r="2" fill={STROKE} />
          {/* Face buttons */}
          {[
            [13, 50],
            [27, 50],
            [20, 43],
            [20, 57],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill={STROKE} />
          ))}
          {/* Capture/home buttons */}
          <rect x="16" y="76" width="8" height="3" fill={STROKE} />
          <rect x="16" y="84" width="8" height="3" fill={STROKE} />
        </svg>
      );
    case 'powerGlove':
      return (
        <svg viewBox="0 0 80 110" width="64" height="88" aria-hidden>
          {/* Glove silhouette */}
          <path d="M14 30 L14 90 Q14 104 28 104 L60 104 Q70 104 70 92 L70 60 L66 30 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Fingers */}
          <rect x="20" y="6" width="6" height="26" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <rect x="30" y="2" width="6" height="30" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <rect x="40" y="4" width="6" height="28" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <rect x="50" y="8" width="6" height="24" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          {/* Control panel on wrist */}
          <rect x="22" y="60" width="36" height="22" fill={STROKE} />
          {/* 3x3 button grid hint */}
          {[28, 36, 44].map((y) =>
            [28, 38, 48].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y + 32} r="1.2" fill={WASH} />)
          )}
        </svg>
      );

    // ── Sony (extended 2026-05-31) ──────────────────────────────────────────
    case 'dualShockController':
      return (
        <svg viewBox="0 0 130 80" width="106" height="65" aria-hidden>
          {/* Classic DualShock — symmetric */}
          <path d="M22 14 Q4 14 4 38 Q4 70 26 70 Q44 70 50 58 L80 58 Q86 70 104 70 Q126 70 126 38 Q126 14 108 14 Q92 14 86 24 L44 24 Q38 14 22 14 Z" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          {/* Twin sticks */}
          <circle cx="44" cy="46" r="5" fill={WASH} stroke={STROKE} strokeWidth="1" />
          <circle cx="86" cy="46" r="5" fill={WASH} stroke={STROKE} strokeWidth="1" />
          {/* D-pad */}
          <line x1="22" y1="36" x2="34" y2="36" stroke={STROKE} strokeWidth="3" />
          <line x1="28" y1="30" x2="28" y2="42" stroke={STROKE} strokeWidth="3" />
          {/* Face buttons diamond */}
          <circle cx="106" cy="30" r="2.4" fill={STROKE} />
          <circle cx="106" cy="42" r="2.4" fill={STROKE} />
          <circle cx="100" cy="36" r="2.4" fill={STROKE} />
          <circle cx="112" cy="36" r="2.4" fill={STROKE} />
        </svg>
      );
    case 'discman':
      return (
        <svg viewBox="0 0 100 100" width="80" height="80" aria-hidden>
          <rect x="4" y="14" width="92" height="80" rx="6" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Lid edge */}
          <line x1="4" y1="22" x2="96" y2="22" stroke={STROKE} strokeWidth="0.7" />
          {/* CD beneath */}
          <circle cx="50" cy="58" r="30" fill="transparent" stroke={STROKE} strokeWidth="1.1" />
          <circle cx="50" cy="58" r="22" fill="transparent" stroke={STROKE} strokeWidth="0.5" />
          <circle cx="50" cy="58" r="6" fill={WASH} stroke={STROKE} strokeWidth="0.9" />
          {/* Button strip on side */}
          <rect x="10" y="88" width="80" height="4" fill={STROKE} />
        </svg>
      );
    case 'ps1MemoryCard':
      return (
        <svg viewBox="0 0 70 50" width="60" height="42" aria-hidden>
          <rect x="3" y="3" width="64" height="44" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          {/* Label slot */}
          <rect x="10" y="10" width="50" height="14" fill={STROKE} />
          {/* Connector edge */}
          <line x1="3" y1="34" x2="67" y2="34" stroke={STROKE} strokeWidth="0.5" />
          {[10, 18, 26, 34, 42, 50, 58].map((x) => (
            <line key={x} x1={x} y1="36" x2={x} y2="44" stroke={STROKE} strokeWidth="0.7" />
          ))}
        </svg>
      );
    case 'miniDisc':
      return (
        <svg viewBox="0 0 80 80" width="64" height="64" aria-hidden>
          <rect x="4" y="4" width="72" height="72" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Inner disc circle */}
          <circle cx="40" cy="40" r="22" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          {/* Sliding shutter */}
          <rect x="22" y="30" width="36" height="20" fill={WASH} stroke={STROKE} strokeWidth="0.9" />
          {/* Hub */}
          <circle cx="40" cy="40" r="5" fill={STROKE} />
        </svg>
      );
    case 'psp':
      return (
        <svg viewBox="0 0 160 70" width="120" height="52" aria-hidden>
          <rect x="3" y="3" width="154" height="64" rx="8" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Wide screen */}
          <rect x="40" y="14" width="80" height="42" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          {/* Analog nub */}
          <circle cx="20" cy="44" r="4" fill={WASH} stroke={STROKE} strokeWidth="1" />
          {/* D-pad */}
          <line x1="14" y1="22" x2="26" y2="22" stroke={STROKE} strokeWidth="2" />
          <line x1="20" y1="16" x2="20" y2="28" stroke={STROKE} strokeWidth="2" />
          {/* Face buttons */}
          {[
            [134, 18],
            [134, 30],
            [128, 24],
            [140, 24],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" fill={STROKE} />
          ))}
        </svg>
      );

    // ── WWE (extended 2026-05-31) ───────────────────────────────────────────
    case 'foldingChair':
      return (
        <svg viewBox="0 0 80 110" width="62" height="86" aria-hidden>
          {/* Seat */}
          <rect x="10" y="52" width="60" height="6" fill={STROKE} />
          {/* Backrest */}
          <rect x="14" y="6" width="52" height="50" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Backrest slats */}
          {[14, 22, 30, 38, 46].map((y) => (
            <line key={y} x1="18" y1={y + 2} x2="62" y2={y + 2} stroke={STROKE} strokeWidth="0.5" />
          ))}
          {/* Front legs */}
          <line x1="16" y1="58" x2="10" y2="104" stroke={STROKE} strokeWidth="2.5" />
          <line x1="64" y1="58" x2="70" y2="104" stroke={STROKE} strokeWidth="2.5" />
          {/* Cross brace */}
          <line x1="14" y1="82" x2="66" y2="82" stroke={STROKE} strokeWidth="1.2" />
        </svg>
      );
    case 'wrestlingBoot':
      return (
        <svg viewBox="0 0 80 110" width="62" height="86" aria-hidden>
          {/* High-laced wrestling boot */}
          <path d="M14 14 L46 14 L52 30 L66 32 Q72 40 70 60 Q68 80 60 96 L18 96 Q12 86 12 60 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Lace eyelets running up the shaft */}
          {[20, 30, 40, 50, 60, 70, 80].map((y) => (
            <circle key={`l-${y}`} cx="22" cy={y} r="1.2" fill={STROKE} />
          ))}
          {[20, 30, 40, 50, 60, 70, 80].map((y) => (
            <circle key={`r-${y}`} cx="36" cy={y} r="1.2" fill={STROKE} />
          ))}
          {/* Cross-laces */}
          {[24, 36, 48, 60, 72].map((y) => (
            <line key={`x-${y}`} x1="22" y1={y - 2} x2="36" y2={y + 4} stroke={STROKE} strokeWidth="0.7" />
          ))}
          {/* Sole */}
          <line x1="12" y1="96" x2="70" y2="96" stroke={STROKE} strokeWidth="2" />
        </svg>
      );
    case 'kendoStick':
      return (
        <svg viewBox="0 0 24 130" width="20" height="108" aria-hidden>
          {/* Bamboo cane shaft */}
          <rect x="8" y="6" width="8" height="118" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Bamboo node bands */}
          {[18, 32, 46, 60, 74, 88, 102, 116].map((y) => (
            <line key={y} x1="6" y1={y} x2="18" y2={y} stroke={STROKE} strokeWidth="0.9" />
          ))}
          {/* Grip wrap */}
          <rect x="6" y="100" width="12" height="22" fill={STROKE} />
        </svg>
      );
    case 'megaphone':
      return (
        <svg viewBox="0 0 100 60" width="84" height="50" aria-hidden>
          {/* Cone */}
          <polygon points="44,10 92,2 92,58 44,50" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Handle / body */}
          <rect x="14" y="22" width="30" height="16" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          {/* Trigger */}
          <path d="M22 38 L22 50 L30 50 L30 40" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          {/* Speaker grille suggestion */}
          {[16, 26, 36, 46].map((y) => (
            <line key={y} x1="48" y1={y} x2="88" y2={y} stroke={STROKE} strokeWidth="0.5" />
          ))}
        </svg>
      );

    // ── GF (extended 2026-05-31) ────────────────────────────────────────────
    case 'cookingTool':
      return (
        <svg viewBox="0 0 30 110" width="24" height="92" aria-hidden>
          {/* Whisk handle */}
          <rect x="11" y="4" width="8" height="50" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Whisk wires */}
          <path d="M8 56 Q15 72 8 92" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <path d="M15 56 Q15 72 15 96" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <path d="M22 56 Q15 72 22 92" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <path d="M11 56 Q15 76 11 96" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <path d="M19 56 Q15 76 19 96" fill="transparent" stroke={STROKE} strokeWidth="1" />
          {/* Bottom collar */}
          <ellipse cx="15" cy="96" rx="8" ry="3" fill={WASH} stroke={STROKE} strokeWidth="1" />
        </svg>
      );
    case 'instaxCamera':
      return (
        <svg viewBox="0 0 110 80" width="92" height="68" aria-hidden>
          <rect x="4" y="4" width="102" height="72" rx="6" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Lens barrel */}
          <circle cx="40" cy="40" r="18" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <circle cx="40" cy="40" r="11" fill="transparent" stroke={STROKE} strokeWidth="0.9" />
          <circle cx="40" cy="40" r="5" fill={STROKE} />
          {/* Viewfinder */}
          <rect x="68" y="14" width="14" height="10" fill={WASH} stroke={STROKE} strokeWidth="1" />
          {/* Shutter button */}
          <circle cx="92" cy="20" r="3" fill={STROKE} />
          {/* Film slot */}
          <line x1="14" y1="68" x2="96" y2="68" stroke={STROKE} strokeWidth="0.8" />
        </svg>
      );

    // ── Roots (extended 2026-05-31) ─────────────────────────────────────────
    case 'mokaPotGreca':
      return (
        <svg viewBox="0 0 80 110" width="64" height="92" aria-hidden>
          {/* Top vessel (octagonal Bialetti-style) */}
          <polygon points="22,8 58,8 64,30 58,52 22,52 16,30" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Knob */}
          <circle cx="40" cy="6" r="3" fill={STROKE} />
          {/* Spout */}
          <polygon points="58,16 70,12 64,22" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          {/* Waist / seam */}
          <line x1="16" y1="52" x2="64" y2="52" stroke={STROKE} strokeWidth="0.9" />
          {/* Bottom vessel */}
          <polygon points="22,52 58,52 64,82 56,100 24,100 16,82" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Handle */}
          <path d="M16 60 Q4 70 16 90" fill="transparent" stroke={STROKE} strokeWidth="1.5" />
        </svg>
      );
    case 'coladorTela':
      return (
        <svg viewBox="0 0 80 110" width="64" height="92" aria-hidden>
          {/* Wooden frame ring at top */}
          <ellipse cx="40" cy="14" rx="28" ry="6" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          {/* Handle */}
          <line x1="68" y1="14" x2="76" y2="32" stroke={STROKE} strokeWidth="2.5" />
          {/* Cloth sock hanging */}
          <path d="M14 18 Q14 60 30 86 Q40 100 50 86 Q66 60 66 18" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Drip suggestion */}
          <circle cx="40" cy="104" r="1.4" fill={STROKE} />
        </svg>
      );
    case 'carriel':
      return (
        <svg viewBox="0 0 90 100" width="74" height="82" aria-hidden>
          {/* Satchel body */}
          <path d="M14 30 L76 30 L80 90 L10 90 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Flap */}
          <path d="M14 30 L76 30 L70 60 L20 60 Z" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          {/* Strap arch */}
          <path d="M20 30 Q20 8 45 8 Q70 8 70 30" fill="transparent" stroke={STROKE} strokeWidth="2" />
          {/* Buckle on flap */}
          <rect x="40" y="54" width="10" height="6" fill={STROKE} />
        </svg>
      );
    case 'dominoTiles':
      return (
        <svg viewBox="0 0 80 110" width="64" height="88" aria-hidden>
          {/* Stack of three domino tiles */}
          {[12, 44, 76].map((y, i) => (
            <g key={y} transform={`translate(0 ${y}) rotate(${(i - 1) * 2} 40 16)`}>
              <rect x="8" y="0" width="64" height="22" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
              <line x1="40" y1="2" x2="40" y2="20" stroke={STROKE} strokeWidth="0.7" />
              {/* Pip dots */}
              <circle cx="20" cy="8" r="1.2" fill={STROKE} />
              <circle cx="28" cy="14" r="1.2" fill={STROKE} />
              <circle cx="52" cy="6" r="1.2" fill={STROKE} />
              <circle cx="60" cy="14" r="1.2" fill={STROKE} />
              <circle cx="52" cy="14" r="1.2" fill={STROKE} />
            </g>
          ))}
        </svg>
      );
    case 'maracasGuacharaca':
      return (
        <svg viewBox="0 0 90 110" width="74" height="92" aria-hidden>
          {/* Two crossed maracas */}
          {/* Left maraca */}
          <ellipse cx="28" cy="34" rx="14" ry="18" fill={WASH} stroke={STROKE} strokeWidth="1.4" transform="rotate(-14 28 34)" />
          <rect x="26" y="50" width="6" height="46" fill={WASH} stroke={STROKE} strokeWidth="1.2" transform="rotate(-14 28 34)" />
          {/* Right maraca */}
          <ellipse cx="62" cy="42" rx="14" ry="18" fill={WASH} stroke={STROKE} strokeWidth="1.4" transform="rotate(16 62 42)" />
          <rect x="60" y="58" width="6" height="46" fill={WASH} stroke={STROKE} strokeWidth="1.2" transform="rotate(16 62 42)" />
          {/* Speckle pattern on heads */}
          {[20, 28, 36].map((y) => (
            <circle key={`lp-${y}`} cx="26" cy={y} r="0.8" fill={STROKE} />
          ))}
          {[28, 36, 44].map((y) => (
            <circle key={`rp-${y}`} cx="60" cy={y} r="0.8" fill={STROKE} />
          ))}
        </svg>
      );

    // ── Travel (extended 2026-05-31) ────────────────────────────────────────
    case 'carryOnBackpack':
      return (
        <svg viewBox="0 0 80 110" width="64" height="88" aria-hidden>
          {/* Backpack body */}
          <path d="M14 26 Q14 18 24 18 L56 18 Q66 18 66 26 L66 96 Q66 104 58 104 L22 104 Q14 104 14 96 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Top handle */}
          <path d="M30 18 Q30 8 40 8 Q50 8 50 18" fill="transparent" stroke={STROKE} strokeWidth="1.5" />
          {/* Strap shoulder loop hint */}
          <path d="M14 26 Q4 40 8 60" fill="transparent" stroke={STROKE} strokeWidth="1.2" />
          {/* Front pocket */}
          <rect x="22" y="60" width="36" height="24" fill="transparent" stroke={STROKE} strokeWidth="1" />
          {/* Zipper */}
          <line x1="22" y1="40" x2="58" y2="40" stroke={STROKE} strokeWidth="0.7" strokeDasharray="2 2" />
        </svg>
      );
    case 'rollerSuitcase':
      return (
        <svg viewBox="0 0 80 110" width="64" height="88" aria-hidden>
          {/* Body */}
          <rect x="10" y="14" width="60" height="80" rx="4" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Telescoping handle */}
          <line x1="30" y1="14" x2="30" y2="4" stroke={STROKE} strokeWidth="1.5" />
          <line x1="50" y1="14" x2="50" y2="4" stroke={STROKE} strokeWidth="1.5" />
          <line x1="30" y1="4" x2="50" y2="4" stroke={STROKE} strokeWidth="1.5" />
          {/* Zipper down the middle */}
          <line x1="40" y1="14" x2="40" y2="94" stroke={STROKE} strokeWidth="0.6" strokeDasharray="2 2" />
          {/* Wheels */}
          <circle cx="20" cy="100" r="5" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          <circle cx="60" cy="100" r="5" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          {/* Side carry handle */}
          <rect x="36" y="22" width="8" height="3" fill={STROKE} />
        </svg>
      );
    case 'travelCamera':
      return (
        <svg viewBox="0 0 100 70" width="84" height="58" aria-hidden>
          <rect x="4" y="14" width="92" height="50" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Top viewfinder bump */}
          <rect x="14" y="4" width="20" height="14" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Lens */}
          <circle cx="60" cy="40" r="16" fill={WASH} stroke={STROKE} strokeWidth="1.4" />
          <circle cx="60" cy="40" r="10" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          <circle cx="60" cy="40" r="4" fill={STROKE} />
          {/* Shutter button */}
          <circle cx="86" cy="22" r="3" fill={STROKE} />
          {/* Dial */}
          <circle cx="26" cy="24" r="4" fill={WASH} stroke={STROKE} strokeWidth="0.9" />
        </svg>
      );
    case 'packingCubes':
      return (
        <svg viewBox="0 0 100 80" width="84" height="68" aria-hidden>
          {/* Lower cube */}
          <rect x="4" y="42" width="92" height="32" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Mesh suggestion */}
          {[48, 54, 60, 66].map((y) => (
            <line key={`bm-${y}`} x1="10" y1={y} x2="90" y2={y} stroke={STROKE} strokeWidth="0.4" />
          ))}
          {/* Top cube — stacked, offset */}
          <rect x="14" y="10" width="74" height="30" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {[18, 24, 30, 36].map((y) => (
            <line key={`tm-${y}`} x1="20" y1={y} x2="82" y2={y} stroke={STROKE} strokeWidth="0.4" />
          ))}
          {/* Zipper pull */}
          <circle cx="86" cy="56" r="1.8" fill={STROKE} />
          <circle cx="80" cy="24" r="1.6" fill={STROKE} />
        </svg>
      );
    case 'nalgeneBottle':
      return (
        <svg viewBox="0 0 60 110" width="48" height="92" aria-hidden>
          {/* Bottle body */}
          <rect x="10" y="22" width="40" height="80" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Lid + neck */}
          <rect x="18" y="6" width="24" height="10" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <rect x="14" y="16" width="32" height="8" fill={STROKE} />
          {/* Stickers on body */}
          <rect x="16" y="36" width="14" height="10" fill={STROKE} />
          <rect x="32" y="42" width="12" height="10" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <circle cx="26" cy="70" r="6" fill="transparent" stroke={STROKE} strokeWidth="1" />
          <rect x="18" y="84" width="18" height="6" fill={STROKE} />
          {/* Volume marks */}
          {[60, 76, 90].map((y) => (
            <line key={y} x1="44" y1={y} x2="50" y2={y} stroke={STROKE} strokeWidth="0.5" />
          ))}
        </svg>
      );

    // ── Running (extended 2026-05-31) ───────────────────────────────────────
    case 'handheldBottle':
      return (
        <svg viewBox="0 0 60 110" width="48" height="92" aria-hidden>
          {/* Soft flask shape */}
          <path d="M14 16 Q14 8 22 8 L38 8 Q46 8 46 16 L48 90 Q48 102 38 102 L22 102 Q12 102 12 90 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Strap loop */}
          <rect x="22" y="2" width="16" height="6" rx="2" fill={WASH} stroke={STROKE} strokeWidth="1.2" />
          {/* Hand strap */}
          <path d="M14 50 Q4 60 4 76 Q4 90 14 90" fill="transparent" stroke={STROKE} strokeWidth="1.4" />
          {/* Soft cap nozzle */}
          <circle cx="30" cy="6" r="3" fill={STROKE} />
        </svg>
      );
    case 'foamRoller':
      return (
        <svg viewBox="0 0 130 50" width="106" height="42" aria-hidden>
          {/* Cylinder */}
          <ellipse cx="14" cy="25" rx="9" ry="20" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <rect x="14" y="5" width="100" height="40" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <ellipse cx="114" cy="25" rx="9" ry="20" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Bumpy texture rows */}
          {[14, 22, 30, 38].map((y) => (
            <line key={y} x1="18" y1={y} x2="110" y2={y} stroke={STROKE} strokeWidth="0.5" strokeDasharray="3 4" />
          ))}
        </svg>
      );
    case 'splitShorts':
      return (
        <svg viewBox="0 0 80 80" width="64" height="64" aria-hidden>
          {/* Waistband */}
          <rect x="8" y="6" width="64" height="10" fill={STROKE} />
          {/* Shorts body */}
          <path d="M8 16 L72 16 L66 60 L46 60 L40 30 L34 60 L14 60 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Side split */}
          <path d="M14 30 Q10 40 14 60" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
          <path d="M66 30 Q70 40 66 60" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
          {/* Drawstring */}
          <line x1="36" y1="6" x2="36" y2="14" stroke={STROKE} strokeWidth="0.8" />
          <line x1="44" y1="6" x2="44" y2="14" stroke={STROKE} strokeWidth="0.8" />
        </svg>
      );
    case 'bibSafetyPins':
      return (
        <svg viewBox="0 0 80 60" width="64" height="48" aria-hidden>
          {/* 2x2 grid of safety pins */}
          {[
            [18, 16],
            [50, 16],
            [18, 44],
            [50, 44],
          ].map(([cx, cy]) => (
            <g key={`${cx}-${cy}`}>
              {/* Pin loop top */}
              <circle cx={cx + 12} cy={cy - 4} r="3" fill="transparent" stroke={STROKE} strokeWidth="1.2" />
              {/* Pin arc */}
              <path d={`M ${cx + 12} ${cy - 1} Q ${cx} ${cy + 4} ${cx - 4} ${cy + 4}`} fill="transparent" stroke={STROKE} strokeWidth="1.2" />
              {/* Pin shaft */}
              <line x1={cx - 4} y1={cy + 4} x2={cx + 16} y2={cy + 6} stroke={STROKE} strokeWidth="1.2" />
              {/* Clasp */}
              <rect x={cx + 14} y={cy + 4} width="4" height="3" fill={STROKE} />
            </g>
          ))}
        </svg>
      );

    // ── Fidget (extended 2026-05-31) ────────────────────────────────────────
    case 'begleri':
      return (
        <svg viewBox="0 0 90 50" width="74" height="42" aria-hidden>
          {/* Two beads on cord */}
          <circle cx="20" cy="25" r="11" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <circle cx="70" cy="25" r="11" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Cord between */}
          <path d="M31 25 Q45 18 59 25" fill="transparent" stroke={STROKE} strokeWidth="1.4" />
          {/* Slight bead detail */}
          <circle cx="20" cy="25" r="5" fill="transparent" stroke={STROKE} strokeWidth="0.5" />
          <circle cx="70" cy="25" r="5" fill="transparent" stroke={STROKE} strokeWidth="0.5" />
        </svg>
      );
    case 'fidgetCube':
      return (
        <svg viewBox="0 0 70 70" width="58" height="58" aria-hidden>
          <rect x="6" y="6" width="58" height="58" rx="4" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Buttons on face */}
          <circle cx="20" cy="20" r="3.5" fill={STROKE} />
          <rect x="36" y="16" width="14" height="6" fill={STROKE} />
          <rect x="14" y="36" width="14" height="6" fill="transparent" stroke={STROKE} strokeWidth="1.2" />
          <circle cx="42" cy="42" r="4" fill="transparent" stroke={STROKE} strokeWidth="1.2" />
          {/* Click switch */}
          <rect x="50" y="38" width="8" height="14" fill={STROKE} />
        </svg>
      );
    case 'worryStone':
      return (
        <svg viewBox="0 0 80 60" width="64" height="48" aria-hidden>
          {/* Flat oval polished stone */}
          <ellipse cx="40" cy="30" rx="32" ry="20" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Thumb divot */}
          <ellipse cx="40" cy="30" rx="14" ry="8" fill="transparent" stroke={STROKE} strokeWidth="1" />
          {/* Sheen highlight */}
          <path d="M16 18 Q32 14 50 18" fill="transparent" stroke={STROKE} strokeWidth="0.5" />
        </svg>
      );
    case 'monkeyNoodle':
      return (
        <svg viewBox="0 0 110 50" width="92" height="42" aria-hidden>
          {/* Knotted stretchy tube */}
          <path d="M6 30 Q22 10 38 30 Q50 50 56 30 Q60 14 70 26 Q76 36 90 28 Q104 18 104 30" fill="transparent" stroke={STROKE} strokeWidth="6" strokeLinecap="round" />
          <path d="M6 30 Q22 10 38 30 Q50 50 56 30 Q60 14 70 26 Q76 36 90 28 Q104 18 104 30" fill="transparent" stroke={WASH} strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      );
    case 'tangleToy':
      return (
        <svg viewBox="0 0 90 90" width="74" height="74" aria-hidden>
          {/* Interlocking curved segments forming a loop */}
          <path d="M20 20 Q40 0 60 20 Q80 40 60 60 Q40 80 20 60 Q0 40 20 20 Z" fill="transparent" stroke={STROKE} strokeWidth="4" strokeLinejoin="round" />
          {/* Joint marks at corners */}
          <circle cx="40" cy="6" r="2" fill={STROKE} />
          <circle cx="74" cy="40" r="2" fill={STROKE} />
          <circle cx="40" cy="74" r="2" fill={STROKE} />
          <circle cx="6" cy="40" r="2" fill={STROKE} />
        </svg>
      );

    // ── Seltzer (extended 2026-05-31) ───────────────────────────────────────
    case 'sodaStreamCarbonator':
      return (
        <svg viewBox="0 0 70 130" width="56" height="106" aria-hidden>
          {/* Tall body */}
          <rect x="14" y="20" width="42" height="80" rx="4" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Top button */}
          <rect x="20" y="6" width="30" height="16" rx="4" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          <circle cx="35" cy="14" r="3" fill={STROKE} />
          {/* Bottle screwed into base */}
          <path d="M22 100 L48 100 L46 124 L24 124 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Bottle neck */}
          <rect x="28" y="96" width="14" height="6" fill={WASH} stroke={STROKE} strokeWidth="1" />
        </svg>
      );
    case 'co2Canister':
      return (
        <svg viewBox="0 0 50 120" width="40" height="96" aria-hidden>
          {/* Cylindrical CO2 tank */}
          <rect x="8" y="14" width="34" height="98" rx="6" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Threaded neck */}
          <rect x="18" y="4" width="14" height="12" fill={WASH} stroke={STROKE} strokeWidth="1.3" />
          {/* Label */}
          <rect x="10" y="46" width="30" height="22" fill={STROKE} />
          <text x="25" y="60" textAnchor="middle" fontFamily={IS} fontSize="9" fontWeight="500" fill={BG_INK_FOR_PEGBOARD}>CO₂</text>
        </svg>
      );
    case 'seltzerCan':
      return (
        <svg viewBox="0 0 50 110" width="40" height="88" aria-hidden>
          <rect x="8" y="10" width="34" height="92" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Brand band */}
          <rect x="8" y="42" width="34" height="22" fill={STROKE} />
          <text x="25" y="56" textAnchor="middle" fontFamily={IS} fontSize="8" fontWeight="500" fill={BG_INK_FOR_PEGBOARD} letterSpacing="0.1em">LACROIX</text>
          {/* Tab */}
          <ellipse cx="25" cy="10" rx="6" ry="2.5" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          {/* Pattern dots */}
          <circle cx="14" cy="76" r="1.4" fill={STROKE} />
          <circle cx="22" cy="80" r="1.4" fill={STROKE} />
          <circle cx="36" cy="76" r="1.4" fill={STROKE} />
          <circle cx="20" cy="92" r="1.4" fill={STROKE} />
          <circle cx="32" cy="94" r="1.4" fill={STROKE} />
        </svg>
      );
    case 'glassBottleTopo':
      return (
        <svg viewBox="0 0 40 130" width="32" height="104" aria-hidden>
          {/* Long-neck glass bottle */}
          <path d="M16 4 L24 4 L24 30 Q34 38 34 60 L34 118 Q34 124 28 124 L12 124 Q6 124 6 118 L6 60 Q6 38 16 30 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Crown cap */}
          <rect x="14" y="2" width="12" height="6" fill={STROKE} />
          {/* Embossed mountain logo suggestion */}
          <path d="M14 72 L18 64 L22 72 L26 66 L30 72" fill="transparent" stroke={STROKE} strokeWidth="0.8" />
          {/* Label */}
          <rect x="10" y="80" width="20" height="20" fill="transparent" stroke={STROKE} strokeWidth="0.7" />
          <text x="20" y="94" textAnchor="middle" fontFamily={IS} fontSize="5" fontWeight="500" fill={STROKE} letterSpacing="0.1em">TOPO</text>
        </svg>
      );
    case 'glassWithBubbles':
      return (
        <svg viewBox="0 0 60 80" width="50" height="68" aria-hidden>
          {/* Rocks glass */}
          <path d="M10 10 L50 10 L46 74 L14 74 Z" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Bubbles rising */}
          {[
            [22, 60],
            [30, 50],
            [38, 56],
            [26, 40],
            [34, 34],
            [22, 24],
            [40, 20],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={i % 2 ? 1.5 : 2.2} fill="transparent" stroke={STROKE} strokeWidth="0.7" />
          ))}
          {/* Liquid line */}
          <line x1="11" y1="20" x2="49" y2="20" stroke={STROKE} strokeWidth="0.5" />
        </svg>
      );
    case 'bottleOpener':
      return (
        <svg viewBox="0 0 110 50" width="92" height="42" aria-hidden>
          {/* Handle */}
          <rect x="6" y="18" width="68" height="14" rx="3" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          {/* Bottle opener head */}
          <ellipse cx="86" cy="25" rx="18" ry="13" fill={WASH} stroke={STROKE} strokeWidth="1.5" />
          <path d="M82 18 L96 18 L96 32 L82 32 Z" fill={WASH} stroke={STROKE} strokeWidth="1" />
          {/* Tooth notch */}
          <polygon points="86,22 92,22 89,28" fill={STROKE} />
          {/* Lanyard hole */}
          <circle cx="14" cy="25" r="3" fill="transparent" stroke={STROKE} strokeWidth="1" />
        </svg>
      );
  }
}
