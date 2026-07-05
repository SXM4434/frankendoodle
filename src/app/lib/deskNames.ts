// Desk name generator — deterministic, index-seeded, semi-authored.
//
// Each public desk gets a warm/silly/characterful name so the "wall of walls"
// is browsable and fun. DETERMINISTIC: deskName(i) always returns the same
// name for index i (no unseeded randomness — names must be stable across
// reloads and across every client).
//
// Built from the foundational naming kit (ChatGPT, 2026-06-11) per its
// "semi-authored, not free-combinational" recommendation: curated pools +
// weighted templates + compatibility-by-construction + injected hero names.
// Tone target: warm object + slightly-official container; one whimsical word
// max; ~50% warm / 25% silly-institutional / 15% poetic / 10% bilingual.

// ─── HERO NAMES — guaranteed bangers, injected at intervals ─────────────────
const HERO_NAMES = [
  'The Coffee-Ring Bureau',
  'Pencil Crumb Committee',
  'The Graphite Orchard',
  'Cafecito Margin',
  'The Little Medal Drawer',
  'The Porchlight Sketch Society',
  'The Warm Eraser Union',
  'La Mesa de Papelitos',
  'The Tiny Detail Cabinet',
  'Rincón No. 12',
  'The Sidewalk Sketch Archive',
  'The Kitchen Table Guild',
  'The Doodle Weather Bureau',
  'The Thumbprint Archive',
];

// ─── CURATED POOLS (the strong words only — quality over coverage) ──────────

// Textural / object first-halves that pair well with an institution suffix.
const TEXTURAL = [
  'Coffee-Ring', 'Pencil Crumb', 'Graphite', 'Thumbprint', 'Smudged Tape',
  'Loose-Leaf', 'Paper Trail', 'Sidewalk Sketch', 'Porchlight', 'Inky',
  'Folded Paper', 'Crooked Ruler', 'Wobbly Pencil', 'Margin', 'Stipple',
];

// Slightly-official containers (the dry-humor suffix). High reuse value.
const INSTITUTION = [
  'Bureau', 'Committee', 'Society', 'Club', 'Union', 'Guild', 'Archive',
  'Cabinet', 'Corner', 'Drawer', 'Shelf', 'Nook', 'Department', 'League',
];

// Soft adjectives — one per name, max.
const ADJECTIVE = [
  'Soft', 'Warm', 'Little', 'Tiny', 'Sleepy', 'Quiet', 'Humble', 'Gentle',
  'Sunny', 'Loose', 'Folded', 'Scuffed', 'Crooked', 'Wonky',
];

// Desk / craft objects.
const OBJECT = [
  'Pencil', 'Eraser', 'Notebook', 'Clipboard', 'Mug', 'Sketchbook', 'Ruler',
  'Sticky Note', 'Ink Dish', 'Tape Roll', 'Coaster', 'Paperclip', 'Stamp',
];

// Light place words for "The [Adjective] [Object] [Place]".
const PLACE = ['Corner', 'Shelf', 'Drawer', 'Nook', 'Room', 'Tray', 'Cabinet'];

// Communal craft groups for the domestic template.
const CRAFT_GROUP = ['Sketch Club', 'Guild', 'Society', 'Doodle Room', 'Committee'];

// Warm domestic places.
const DOMESTIC = ['Kitchen Table', 'Window-Sill', 'Porch', 'Stoop', 'Pantry'];

// Bilingual touches — sprinkle, never overload.
const SPANISH = ['Cafecito', 'Rincón', 'Papelito', 'Sobremesa', 'La Mesa de'];
const DRAWING_NOUN = ['Margin', 'Sketch', 'Doodle', 'Hatch', 'Line', 'Scribble'];

// Single poetic compounds (rare).
const POETIC = [
  'The Graphite Orchard', 'The Margin Meadow', 'The Ink-Wash Courtyard',
  'The Paper Porch', 'The Soft Grid Garden', 'The Little Line Orchard',
];

// ─── DETERMINISTIC PICKING ──────────────────────────────────────────────────

// FNV-1a 32-bit over (index + salt) — gives independent, stable streams per
// salt so two pools in one name don't move together.
function streamHash(index: number, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  const s = String(index) + ':' + String(salt);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick<T>(pool: T[], index: number, salt: number): T {
  return pool[streamHash(index, salt) % pool.length];
}

// Pattern weights (cumulative out of 100), per the kit:
//   35 textural+institution · 20 adj+obj+place · 15 obj+institution
//   10 domestic+craft · 10 spanish+drawing · 5 No.# · 5 poetic
const PATTERN_CUME = [35, 55, 70, 80, 90, 95, 100];

/**
 * Deterministic, stable name for a public desk by its index (0-based).
 * Every ~12th desk gets a curated hero name so the wall always has bangers.
 */
export function deskName(index: number): string {
  // Every desk where (index mod 12 === 7) gets a curated hero name, so the
  // wall always has guaranteed bangers scattered through the generated ones.
  if (index % 12 === 7) {
    return HERO_NAMES[streamHash(index, 7) % HERO_NAMES.length];
  }

  const roll = streamHash(index, 1) % 100;
  let pattern = 0;
  while (pattern < PATTERN_CUME.length && roll >= PATTERN_CUME[pattern]) pattern++;

  switch (pattern) {
    case 0: // The [Textural] [Institution]
      return `The ${pick(TEXTURAL, index, 2)} ${pick(INSTITUTION, index, 3)}`;
    case 1: // The [Adjective] [Object] [Place]
      return `The ${pick(ADJECTIVE, index, 2)} ${pick(OBJECT, index, 3)} ${pick(PLACE, index, 4)}`;
    case 2: // [Object] [Institution]  (e.g. "Eraser Union")
      return `The ${pick(OBJECT, index, 2)} ${pick(INSTITUTION, index, 3)}`;
    case 3: // The [Domestic] [Craft Group]
      return `The ${pick(DOMESTIC, index, 2)} ${pick(CRAFT_GROUP, index, 3)}`;
    case 4: // [Spanish] [Drawing Noun]
      return `${pick(SPANISH, index, 2)} ${pick(DRAWING_NOUN, index, 3)}`;
    case 5: // [Object] No. [Number]
      return `${pick(OBJECT, index, 2)} No. ${(streamHash(index, 5) % 89) + 1}`;
    default: // Single poetic compound
      return pick(POETIC, index, 2);
  }
}
