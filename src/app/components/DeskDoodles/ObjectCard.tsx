import { type CSSProperties, type ReactNode } from 'react';
import { IS, ISe } from '../../lib/typography';
import { SECTION_LABEL, RAISED_SHADOW } from '../../lib/chromeStyles';
import { PAPER_GRAIN, WARM_POOL } from '../../lib/deskCraft';
import { getSessionId } from '../../lib/session';
import { SvgStyleTransform } from '../canvas/SvgStyleTransform';

// ─── ObjectCard — the collectible read-view of one doodle record ─────────────
// Per docs/design/object-model-and-desk-architecture.md §"The object card":
// one component, used at three moments — the create-reveal (name your fresh
// doodle), the inspect/sandbox panel, and the drawer (mini density). It is a
// VIEW of the record (name / why / owner / render); never a settings panel.
//
// Craft bar (feedback_no_cheap_polish): TCG-tall, the doodle IS the art on a
// warm paper well, a graphite name-banner, a quiet why-line, an owner footer.
// Simple but beautiful — one render, restraint over ornament.

export type ObjectCardProps = {
  svgMarkup: string;
  name?: string | null;
  why?: string | null;
  /** When provided, the art well renders THIS instead of the SVG (e.g. the 3D
   *  mount) — the 2D/3D toggle on the surface swaps it in. Keeps the card chrome
   *  (name/why/footer) and the framed well; only the art inside changes. */
  artOverride?: ReactNode;
  /** Owner handle, or null/undefined for an anonymous maker. */
  owner?: string | null;
  /** When set, the owner label becomes a button (click → that maker's public
   *  shelf). Only pass for OTHER people's cards, never your own. */
  onOwnerClick?: () => void;
  /** ISO timestamp; shown as a quiet date in the footer if present. */
  createdAt?: string | null;
  /** Mini density for the drawer/binder grid — the TCG frame at small scale:
   *  name banner + the one marks stat + art well. Drops why/footer. Width is
   *  100% so the grid cell owns sizing. */
  mini?: boolean;
  /** Plain art injection — the art well renders the given markup AS-IS
   *  (caller sanitizes + sizes it) instead of through the live
   *  SvgStyleTransform pen pipeline. The drawer's mini cards use this:
   *  deterministic + cheap, and the binder never re-renders on pen tweaks
   *  (records rule, D-7). Desk/popup cards keep the live pipeline. */
  plainArt?: boolean;
  /** Embedded — drop the card's own shell because it already lives inside a
   *  card-like container (e.g. the ObjectSurface modal IS the card). Prevents
   *  a card-inside-a-card. The art well stays (it's the doodle's frame). */
  embedded?: boolean;
  /** Editable mode (Create/Edit) — name + why become inputs. */
  editable?: boolean;
  onNameChange?: (v: string) => void;
  onWhyChange?: (v: string) => void;
};

const CARD_W = 300;

export function ObjectCard({
  svgMarkup,
  name,
  why,
  artOverride,
  owner,
  onOwnerClick,
  createdAt,
  mini = false,
  plainArt = false,
  embedded = false,
  editable = false,
  onNameChange,
  onWhyChange,
}: ObjectCardProps) {
  // Embedded + mini both fill their container (modal panel / drawer grid
  // cell respectively); only the standalone full card carries its own width.
  const width = embedded || mini ? '100%' : CARD_W;

  // Embedded drops the shell (no second card around the modal); standalone
  // keeps the full collectible-card surface (drawer/binder use).
  const shell: CSSProperties = embedded
    ? {
        width: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontFamily: IS,
      }
    : {
        width,
        boxSizing: 'border-box',
        background: 'var(--dir-raised)',
        border: '1px solid var(--dir-border)',
        borderRadius: 16,
        boxShadow: RAISED_SHADOW,
        padding: mini ? 10 : 16,
        display: 'flex',
        flexDirection: 'column',
        gap: mini ? 8 : 12,
        fontFamily: IS,
      };

  // The art well — a warm paper square the doodle sits on, like a framed scrap.
  const artWell: CSSProperties = {
    position: 'relative',
    width: '100%',
    aspectRatio: '1 / 1',
    backgroundColor: 'var(--dir-bg)',
    backgroundImage: `${PAPER_GRAIN}, ${WARM_POOL}`,
    // mini (drawer) cards: NO inner frame — a rounded box inside the card's
    // own rounded frame read as a double-frame (Sebs: "rounded square in a
    // regular square… no craft"). The art sits directly on the card paper.
    border: mini ? 'none' : '1px solid var(--dir-border)',
    borderRadius: mini ? 6 : 10,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const marks = countMarks(svgMarkup);

  return (
    <div style={shell}>
      {/* Name banner + the one stat (marks = stroke count), set like a TCG
          card's HP: name left, stat top-right. One stat, restraint. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        {editable ? (
          <input
            value={name ?? ''}
            onChange={(e) => onNameChange?.(e.target.value)}
            placeholder="Name your doodle"
            aria-label="Doodle name"
            maxLength={60}
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: ISe,
              fontVariationSettings: '"SOFT" 60, "WONK" 1',
              fontSize: mini ? 15 : 20,
              letterSpacing: '-0.01em',
              color: 'var(--dir-text-primary)',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--dir-border)',
              outline: 'none',
              padding: '2px 0',
            }}
          />
        ) : (
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: ISe,
              fontVariationSettings: '"SOFT" 60, "WONK" 1',
              // 13 at mini (on-ladder, and the banner shares its row with the
              // stat in a ~130px grid cell — every character counts).
              fontSize: mini ? 13 : 20,
              letterSpacing: '-0.01em',
              color: name ? 'var(--dir-text-primary)' : 'var(--dir-text-body-soft)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {name || 'Untitled doodle'}
          </div>
        )}
        {marks > 0 && (
          <span
            title="Marks — how many strokes make up this doodle"
            style={{
              flexShrink: 0,
              fontFamily: IS,
              fontSize: mini ? 9 : 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--dir-text-secondary)',
              whiteSpace: 'nowrap',
            }}
          >
            {marks} {marks === 1 ? 'mark' : 'marks'}
          </span>
        )}
      </div>

      {/* The art — the doodle itself, rendered through the live style. When
          the record has no drawable marks (empty/broken markup), a quiet
          dashed-circle placeholder keeps the well from reading as a hole. */}
      {/* data-dd-card-art tags the well so a drag source (the drawer) can use
          the ART as the drag image — the doodle is what lands on the desk. */}
      <div style={{ ...artWell, position: 'relative' }} data-dd-card-art="">
        {/* The 2D SVG ALWAYS renders (export reads it from this well — so SVG/PNG
            export works even while the 3D override is showing — Sebs 2026-06-16
            "card export doesn't export when 3d"). When the 3D override is up it's
            opacity:0 — still in the DOM (exportable, display-chain visible) but not
            visible, so it never BLEEDS through the transparent 3D ("the dot over
            the svg"). The 3D override overlays it. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: artOverride ? 0 : 1,
            pointerEvents: artOverride ? 'none' : undefined,
          }}
        >
        {marks === 0 ? (
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            aria-hidden="true"
            style={{ opacity: 0.7 }}
          >
            <circle
              cx="24"
              cy="24"
              r="18"
              fill="none"
              stroke="var(--dir-text-body-soft)"
              strokeWidth="1.5"
              strokeDasharray="3 6"
              strokeLinecap="round"
            />
          </svg>
        ) : plainArt ? (
          // Plain injection — the record's stored marks, no live pipeline.
          // Caller owns sanitize + sizing (the drawer normalizes + stretches
          // the root svg to 100% so the well box scales it).
          <div
            style={{ width: '76%', height: '76%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        ) : (
          <div style={{ width: '76%', height: '76%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SvgStyleTransform wrapperOverride={{ display: 'block', width: '100%', height: '100%' }}>
              <div
                style={{ width: '100%', height: '100%' }}
                dangerouslySetInnerHTML={{ __html: svgMarkup }}
              />
            </SvgStyleTransform>
          </div>
        )}
        </div>
        {artOverride && (
          // The surface's own art (the 3D mount) — overlays the 2D SVG (which stays
          // mounted behind it so export still finds a rendered doodle).
          <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>{artOverride}</div>
        )}
      </div>

      {/* Mini cards stop here — name banner + the one stat + art is the full
          TCG frame at binder-grid density; why/footer stay full-card only. */}
      {!mini && (
        <>
          {/* Why-line — the maker's one line, the IKEA-effect attachment hook. */}
          {editable ? (
            <input
              value={why ?? ''}
              onChange={(e) => onWhyChange?.(e.target.value)}
              placeholder="Why's this on your desk?"
              aria-label="Why this doodle"
              style={{
                fontFamily: ISe,
                fontSize: 14,
                fontStyle: 'italic',
                color: 'var(--dir-text-body)',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                width: '100%',
              }}
            />
          ) : (
            why && (
              <div
                style={{
                  fontFamily: ISe,
                  fontSize: 14,
                  fontStyle: 'italic',
                  color: 'var(--dir-text-body-soft)',
                  lineHeight: 1.45,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {why}
              </div>
            )
          )}

          {/* (Per-doodle author field removed 2026-06-14 — identity is the ONE
              @handle, shown or anonymous; no different name per doodle.) */}

          {/* Footer — owner + quiet date, divided from the body. The label idiom
              (10/600/0.08em uppercase secondary) is the shared SECTION_LABEL;
              only the row layout + divider are footer-local. */}
          <div
            style={{
              ...SECTION_LABEL,
              marginTop: 2,
              paddingTop: 10,
              borderTop: '1px solid var(--dir-border)',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            {onOwnerClick ? (
              <button
                type="button"
                onClick={onOwnerClick}
                title="See their shelf"
                style={{
                  ...SECTION_LABEL,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textUnderlineOffset: 2,
                  color: 'inherit',
                }}
              >
                {ownerLabel(owner)}
              </button>
            ) : (
              <span>{ownerLabel(owner)}</span>
            )}
            {createdAt && (
              <span style={{ fontWeight: 500, letterSpacing: '0.04em', color: 'var(--dir-text-body-soft)' }}>
                {formatCardDate(createdAt)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Quiet, human date for the card footer (e.g. "Jun 11"; adds the year only
 *  for older cards). Returns null for unparseable input so the span is skipped. */
function formatCardDate(iso: string): string | null {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  } catch {
    return null;
  }
}

/** Count the drawable marks in an SVG — the card's one stat AND the gate that
 *  decides art-vs-placeholder (marks === 0 ⇒ the dashed-circle "empty" well).
 *
 *  Regex over element tags; deterministic, cheap, tolerant of odd markup. The
 *  set MUST include every tag that puts ink on screen, or a doodle made only of
 *  those tags reads as "0 marks" + a blank mini-card even though it has visible
 *  art. Beyond the basic geometry primitives that covers:
 *    • <text>  — text-only doodles (a written word IS the doodle)
 *    • <use>   — instanced art (a <symbol>/<defs> shape referenced by <use> —
 *                the visible mark lives on the <use>, not the inert <defs>)
 *    • <image> — embedded raster (uploaded photo doodles)
 *  <defs>/<symbol>/<g> are deliberately NOT counted: they're containers, not
 *  marks — counting them would inflate the stat and (worse) make a defs-only
 *  blank SVG falsely render as art. The art itself (including any <defs>/<use>
 *  pair) renders verbatim via dangerouslySetInnerHTML once marks > 0, so adding
 *  <use> here is what makes instanced/text doodles actually paint in the well. */
function countMarks(svgMarkup: string): number {
  const m = svgMarkup.match(
    /<(path|line|polyline|circle|rect|ellipse|polygon|text|use|image)\b/gi,
  );
  return m ? m.length : 0;
}

// ─── Friendly owner handle ───────────────────────────────────────────────────
// The owner field carries a raw session UUID (lib/session.ts) — never show it.
// Derive a deterministic warm two-word handle from it instead, in the same
// FNV-1a + curated-pool spirit as lib/deskNames.ts (its streamHash is
// module-private there, so a small local copy lives here). Same uuid → same
// handle, on every client, every reload — no unseeded randomness.

// Soft adjectives + small warm things (critters + desk objects), lowercase —
// "quiet-heron", "inky-paperclip". MUST stay byte-identical (same words, same
// order) to lib/handle.ts ADJ/NOUN so an owner label here == the user's own
// generated handle there. ~50×50 = 2500 combos so handles read DISTINCT, not
// "name-7" (Sebs 2026-06-18: a number suffix is lazy).
const HANDLE_ADJ = [
  'quiet', 'warm', 'little', 'sleepy', 'sunny', 'gentle', 'humble', 'wobbly',
  'inky', 'folded', 'scuffed', 'crooked', 'doodled', 'smudged', 'loose', 'tidy',
  'cozy', 'dusty', 'faded', 'soft', 'rumpled', 'hazy', 'mellow', 'drowsy',
  'plucky', 'nimble', 'tiny', 'rounded', 'speckled', 'dappled', 'woolly', 'fuzzy',
  'dainty', 'lanky', 'bashful', 'chipper', 'snug', 'breezy', 'earthy', 'pale',
  'bright', 'brisk', 'calm', 'curly', 'knotted', 'patched', 'stitched', 'amber',
  'briny', 'sandy',
];
const HANDLE_NOUN = [
  'heron', 'wren', 'finch', 'moth', 'snail', 'otter', 'pebble', 'acorn',
  'maple', 'clover', 'pencil', 'eraser', 'paperclip', 'crayon', 'mug', 'stamp',
  'sparrow', 'robin', 'swallow', 'magpie', 'beetle', 'ladybug', 'cricket', 'minnow',
  'tadpole', 'newt', 'hedgehog', 'dormouse', 'vole', 'marmot', 'teapot', 'kettle',
  'thimble', 'button', 'ribbon', 'marble', 'domino', 'inkwell', 'quill', 'notebook',
  'bookmark', 'postcard', 'lantern', 'walnut', 'chestnut', 'pinecone', 'mushroom', 'fern',
  'moss', 'reed',
];

// FNV-1a 32-bit over (value + salt) — local copy of deskNames.ts's streamHash
// (not exported there). Distinct salts give independent streams per pool so
// the two words of a handle don't move together.
function handleHash(value: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  const s = value + ':' + String(salt);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic warm handle for a session uuid, e.g. "quiet-heron". MUST match
 *  lib/handle.ts handleFromId exactly (same pools/order + same FNV-1a salts) so
 *  an owner label here == the user's own generated handle there. NO number
 *  suffix (Sebs 2026-06-18: lazy) — the ~2500-combo pool keeps deterministic
 *  auto-names distinct; guaranteed uniqueness is enforced at claim time. */
function ownerHandle(sessionId: string): string {
  const adj = HANDLE_ADJ[handleHash(sessionId, 1) % HANDLE_ADJ.length];
  const noun = HANDLE_NOUN[handleHash(sessionId, 2) % HANDLE_NOUN.length];
  return `${adj}-${noun}`;
}

// Session ids are crypto.randomUUID() uuids — detect them so a caller that
// already passes a friendly label (e.g. DeskPage pre-maps 'you') is never
// re-hashed.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Footer label for the owner: "you" for the viewer's own session, a derived
 *  warm handle for any other session uuid, the string as-is when it is already
 *  a friendly label, "Anonymous" when absent. Never the raw UUID. */
function ownerLabel(owner?: string | null): string {
  if (!owner) return 'Anonymous';
  if (owner === 'you') return 'you'; // pre-mapped by the caller (DeskPage)
  let own = false;
  try {
    own = owner === getSessionId();
  } catch {
    // session unavailable — fall through to the handle path
  }
  if (own) return 'you';
  if (UUID_RE.test(owner)) return `@${ownerHandle(owner)}`;
  return `@${owner}`;
}
