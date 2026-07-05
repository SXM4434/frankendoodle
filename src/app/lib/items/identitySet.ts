// F3 Core Identity Set (CIS) — single source of truth for the subjects that
// represent Sebs's identity on F3 hero surfaces.
//
// Per user direction 2026-05-31: "same person, two surfaces" — each subject is
// an identity beat (Elara, running, punk rock, etc.) that gets expressed in a
// concept-appropriate FORM (sketchbook on Pegboard vs framed sketch on Trophy
// Wall). The toggle architecture: every subject has an 'off' option + N form
// variants; user switches between them per concept.
//
// This file = data only (no JSX). SVG shape rendering lives in the concept
// component (F3_B_Pegboard_Path2.tsx PegToolShape switch).
//
// Subject order in F3_PEGBOARD_SUBJECTS is also TOP→BOTTOM layout order per
// research §I8 ("TOP = most identity-bearing tool; BOTTOM = supporting").

export type F3SubjectId =
  // Daily work practice — trait register, NOT project register.
  // These represent HOW Sebs works (sketches on paper, MacBook as main rig),
  // not the case studies themselves. Click actions can still hidden-link to
  // case studies as a delight, but labels read trait-first.
  | 'sketching'
  | 'work-rig'
  // Fandoms / passions
  | 'punk'
  | 'movies'
  | 'wwe'
  | 'pokemon'
  | 'nintendo'
  | 'sony'
  // Life / relationships
  | 'gf'
  | 'roots'      // Colombia / USA
  | 'travel'
  // Daily traits
  | 'running'
  | 'fidget'
  | 'seltzer';

export type F3SubjectAction =
  | { kind: 'case-study'; slug: string }
  | { kind: 'about'; anchor: string }
  | { kind: 'external'; href: string }
  | { kind: 'easter-egg'; label: string };

// Every concrete shape rendered on Pegboard. Each subject has 1+ forms; each
// form picks a shape from this union. Off state lives in the context state,
// not here.
export type F3PegboardShapeId =
  // Sketching
  | 'sketchbook'
  | 'draftingPen'
  | 'xacto'
  | 'mechanicalPencil'
  | 'capPen'
  | 'brushPen'
  | 'chiselMarker'
  | 'eraserBlock'
  | 'triangleRuler'
  // Work-rig
  | 'macbook'
  | 'monitor'
  | 'stylus'
  | 'laptopSideProfile'
  | 'mxMouse'
  | 'mechKeyboard'
  | 'overEarHeadphones'
  | 'usbCCable'
  | 'fieldNotes'
  // Punk
  | 'vinyl'
  | 'guitarPedal'
  | 'drumsticks'
  | 'electricGuitar'
  | 'bassGuitar'
  | 'guitarPick'
  | 'ampCombo'
  // Movies
  | 'vhs'
  | 'dvdSpine'
  | 'popcornBucket'
  | 'filmCanister'
  | 'filmReel'
  | 'clapperboard'
  | 'boomMic'
  | 'filmStrip'
  | 'homeProjector'
  // WWE
  | 'beltMini'
  | 'actionFigure'
  | 'mic'
  | 'foldingChair'
  | 'wrestlingBoot'
  | 'kendoStick'
  | 'megaphone'
  // Pokémon
  | 'pokeball'
  | 'pokemonFigure'
  | 'cardSleeve'
  | 'cardBinder'
  | 'boosterPack'
  | 'playmat'
  // Nintendo
  | 'switch'
  | 'gameBoy'
  | 'nesCartridge'
  | 'marioHat'
  | 'nesController'
  | 'snesController'
  | 'n64Controller'
  | 'joyConSingle'
  | 'powerGlove'
  // Sony
  | 'ps5Controller'
  | 'walkman'
  | 'vita'
  | 'dualShockController'
  | 'discman'
  | 'ps1MemoryCard'
  | 'miniDisc'
  | 'psp'
  // GF
  | 'ring'
  | 'keychain'
  | 'pairedMug'
  | 'cookingTool'
  | 'instaxCamera'
  // Roots
  | 'flagPin'
  | 'arepaPan'
  | 'ruanaCloth'
  | 'mokaPotGreca'
  | 'coladorTela'
  | 'carriel'
  | 'dominoTiles'
  | 'maracasGuacharaca'
  // Travel
  | 'passport'
  | 'luggageTag'
  | 'carryOnBackpack'
  | 'rollerSuitcase'
  | 'travelCamera'
  | 'packingCubes'
  | 'nalgeneBottle'
  // Running
  | 'shoe'
  | 'gpsWatch'
  | 'medal'
  | 'handheldBottle'
  | 'foamRoller'
  | 'splitShorts'
  | 'bibSafetyPins'
  // Daily traits
  | 'fidget'
  | 'seltzer'
  | 'begleri'
  | 'fidgetCube'
  | 'worryStone'
  | 'monkeyNoodle'
  | 'tangleToy'
  | 'sodaStreamCarbonator'
  | 'co2Canister'
  | 'seltzerCan'
  | 'glassBottleTopo'
  | 'glassWithBubbles'
  | 'bottleOpener';

export type F3PegboardForm = {
  shape: F3PegboardShapeId;
  label: string;
  caption: string;
  action: F3SubjectAction;
};

export type F3PegboardSubjectDef = {
  id: F3SubjectId;
  displayName: string;          // For chrome dropdown header
  pegCol: 0 | 1 | 2 | 3 | 4;    // 5-column peg grid (Pegboard)
  top: number;                  // px from top of pegboard surface
  tilt: number;                 // baseline tilt (deg), scaled by F3TiltRange
  forms: F3PegboardForm[];      // First entry = fallback default if defaultForm not set
  defaultForm?: F3PegboardShapeId; // Optional override for which form loads first
};

// 14 subjects in identity-weight order TOP→BOTTOM per research §I8.
// Position math: pegboard height 700 ÷ 14 subjects = ~50px per slot, but
// items have visual mass so layout uses ~70-100px row spacing PER COLUMN
// to avoid overlap. With 5 columns spreading 14 items, each column gets
// ~2-3 items at ~220px vertical gap (clearable for 60-100px-tall shapes).
//
// Top row (row 1): sketching · work-rig — daily work practice (trait, NOT project)
// Row 2:           punk · nintendo · movies
// Row 3:           pokemon · sony · wwe
// Row 4:           travel · gf
// Row 5:           running · roots
// Row 6:           fidget · seltzer    — daily traits, supporting
export const F3_PEGBOARD_SUBJECTS: F3PegboardSubjectDef[] = [
  {
    id: 'sketching',
    displayName: 'Sketching',
    pegCol: 1, top: 30, tilt: -2,
    defaultForm: 'mechanicalPencil',
    forms: [
      { shape: 'sketchbook',       label: 'Sketchbook',        caption: 'always on the desk',     action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'draftingPen',      label: 'Drafting pen',       caption: 'fineliner of choice',   action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'xacto',            label: 'X-acto knife',       caption: 'for precision cuts',    action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'mechanicalPencil', label: 'Mechanical pencil',  caption: 'designer pencil of choice', action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'capPen',           label: 'Cap pen',            caption: 'sketchbook fineliner',  action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'brushPen',         label: 'Brush pen',          caption: 'quick gestural lines',  action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'chiselMarker',     label: 'Chisel marker',      caption: 'concept-art convention', action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'eraserBlock',      label: 'Eraser block',       caption: 'undo, made physical',   action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'triangleRuler',    label: 'Triangle ruler',     caption: 'draws measured',        action: { kind: 'case-study', slug: 'elara' } },
    ],
  },
  {
    id: 'work-rig',
    displayName: 'Work rig',
    pegCol: 3, top: 50, tilt: 3,
    defaultForm: 'laptopSideProfile',
    forms: [
      { shape: 'macbook',            label: 'MacBook',            caption: 'main work tool',           action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'monitor',            label: 'Monitor',            caption: 'desk setup',                action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'stylus',             label: 'Stylus',             caption: 'iPad work',                 action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'laptopSideProfile',  label: 'Laptop, side profile', caption: 'closed, ready to travel', action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'mxMouse',            label: 'MX Master mouse',    caption: 'designer mouse of choice',  action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'mechKeyboard',       label: 'Mech keyboard',      caption: 'HHKB · clack',              action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'overEarHeadphones',  label: 'Headphones',         caption: 'focus mode',                action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'usbCCable',          label: 'USB-C cable',        caption: 'always tethered',           action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'fieldNotes',         label: 'Field Notes',        caption: 'beside the keyboard',       action: { kind: 'case-study', slug: 'ion' } },
    ],
  },
  {
    id: 'punk',
    displayName: 'Punk rock',
    pegCol: 0, top: 200, tilt: -3,
    defaultForm: 'electricGuitar',
    forms: [
      { shape: 'vinyl',          label: 'Vinyl',          caption: 'punk · spins on weekends', action: { kind: 'about', anchor: 'punk' } },
      { shape: 'guitarPedal',    label: 'Guitar pedal',   caption: 'punk · gear nerd',         action: { kind: 'about', anchor: 'punk' } },
      { shape: 'drumsticks',     label: 'Drumsticks',     caption: 'punk · noise complaint',   action: { kind: 'about', anchor: 'punk' } },
      { shape: 'electricGuitar', label: 'Electric guitar', caption: 'punk · Jaguar cutaway',   action: { kind: 'about', anchor: 'punk' } },
      { shape: 'bassGuitar',     label: 'Bass guitar',    caption: 'punk · P-bass shape',      action: { kind: 'about', anchor: 'punk' } },
      { shape: 'guitarPick',     label: 'Guitar pick',    caption: 'punk · edge-worn plectrum', action: { kind: 'about', anchor: 'punk' } },
      { shape: 'ampCombo',       label: 'Amp combo',      caption: 'punk · small loud box',    action: { kind: 'about', anchor: 'punk' } },
    ],
  },
  {
    id: 'nintendo',
    displayName: 'Nintendo',
    pegCol: 2, top: 200, tilt: 2,
    defaultForm: 'nesController',
    forms: [
      { shape: 'switch',         label: 'Switch',         caption: 'Nintendo · main rig',     action: { kind: 'about', anchor: 'games' } },
      { shape: 'gameBoy',        label: 'Game Boy',       caption: 'Nintendo · childhood',    action: { kind: 'about', anchor: 'games' } },
      { shape: 'nesCartridge',   label: 'NES cartridge',  caption: 'Nintendo · the start',    action: { kind: 'about', anchor: 'games' } },
      { shape: 'marioHat',       label: 'Mario hat',      caption: 'Nintendo · it me',        action: { kind: 'about', anchor: 'games' } },
      { shape: 'nesController',  label: 'NES controller', caption: 'Nintendo · gray brick',   action: { kind: 'about', anchor: 'games' } },
      { shape: 'snesController', label: 'SNES controller', caption: 'Nintendo · dog-bone',    action: { kind: 'about', anchor: 'games' } },
      { shape: 'n64Controller',  label: 'N64 controller', caption: 'Nintendo · three-prong',  action: { kind: 'about', anchor: 'games' } },
      { shape: 'joyConSingle',   label: 'Joy-Con',        caption: 'Nintendo · half a Switch', action: { kind: 'about', anchor: 'games' } },
      { shape: 'powerGlove',     label: 'Power Glove',    caption: 'Nintendo · 1989 wearable', action: { kind: 'about', anchor: 'games' } },
    ],
  },
  {
    id: 'movies',
    displayName: 'Movies',
    pegCol: 4, top: 220, tilt: -2,
    defaultForm: 'filmReel',
    forms: [
      { shape: 'vhs',           label: 'VHS tape',       caption: 'movies · fan',          action: { kind: 'about', anchor: 'movies' } },
      { shape: 'dvdSpine',      label: 'DVD spine',      caption: 'movies · Criterion',    action: { kind: 'about', anchor: 'movies' } },
      { shape: 'popcornBucket', label: 'Popcorn bucket', caption: 'movies · the theater',  action: { kind: 'about', anchor: 'movies' } },
      { shape: 'filmCanister',  label: 'Film canister',  caption: 'movies · 35mm',         action: { kind: 'about', anchor: 'movies' } },
      { shape: 'filmReel',      label: 'Film reel',      caption: 'movies · cinephile tool', action: { kind: 'about', anchor: 'movies' } },
      { shape: 'clapperboard',  label: 'Clapperboard',   caption: 'movies · slate',        action: { kind: 'about', anchor: 'movies' } },
      { shape: 'boomMic',       label: 'Boom mic',       caption: 'movies · production-side', action: { kind: 'about', anchor: 'movies' } },
      { shape: 'filmStrip',     label: 'Film strip',     caption: 'movies · 35mm sprockets', action: { kind: 'about', anchor: 'movies' } },
      { shape: 'homeProjector', label: 'Home projector', caption: 'movies · 16mm at home', action: { kind: 'about', anchor: 'movies' } },
    ],
  },
  {
    id: 'pokemon',
    displayName: 'Pokémon',
    pegCol: 1, top: 280, tilt: 1,
    defaultForm: 'pokeball',
    forms: [
      { shape: 'pokeball',      label: 'Pokéball',       caption: 'Pokémon · inner child',   action: { kind: 'easter-egg', label: 'pokemon' } },
      { shape: 'pokemonFigure', label: 'Pokémon figure', caption: 'Pokémon · inner child',   action: { kind: 'easter-egg', label: 'pokemon' } },
      { shape: 'cardSleeve',    label: 'Card sleeve',    caption: 'Pokémon · TCG deck box',  action: { kind: 'easter-egg', label: 'pokemon' } },
      { shape: 'cardBinder',    label: 'Card binder',    caption: 'Pokémon · sleeve pages',  action: { kind: 'easter-egg', label: 'pokemon' } },
      { shape: 'boosterPack',   label: 'Booster pack',   caption: 'Pokémon · sealed foil',   action: { kind: 'easter-egg', label: 'pokemon' } },
      { shape: 'playmat',       label: 'Playmat',        caption: 'Pokémon · tournament rubber', action: { kind: 'easter-egg', label: 'pokemon' } },
    ],
  },
  {
    id: 'sony',
    displayName: 'Sony',
    pegCol: 3, top: 290, tilt: -1,
    defaultForm: 'dualShockController',
    forms: [
      { shape: 'ps5Controller',       label: 'PS5 controller',     caption: 'Sony · current gen',    action: { kind: 'about', anchor: 'games' } },
      { shape: 'walkman',             label: 'Walkman',            caption: 'Sony · throwback',      action: { kind: 'about', anchor: 'games' } },
      { shape: 'vita',                label: 'PS Vita',            caption: 'Sony · cult device',    action: { kind: 'about', anchor: 'games' } },
      { shape: 'dualShockController', label: 'DualShock',          caption: 'Sony · nostalgic pad',  action: { kind: 'about', anchor: 'games' } },
      { shape: 'discman',             label: 'Discman',            caption: 'Sony · late-90s puck',  action: { kind: 'about', anchor: 'games' } },
      { shape: 'ps1MemoryCard',       label: 'PS1 memory card',    caption: 'Sony · save state',     action: { kind: 'about', anchor: 'games' } },
      { shape: 'miniDisc',            label: 'MiniDisc',           caption: 'Sony · flagship format', action: { kind: 'about', anchor: 'games' } },
      { shape: 'psp',                 label: 'PSP',                caption: 'Sony · 2004 handheld',  action: { kind: 'about', anchor: 'games' } },
    ],
  },
  {
    id: 'wwe',
    displayName: 'WWE',
    pegCol: 0, top: 370, tilt: 3,
    defaultForm: 'foldingChair',
    forms: [
      { shape: 'beltMini',       label: 'Championship belt', caption: 'WWE · the chase',     action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'actionFigure',   label: 'Action figure',     caption: 'WWE · roster',        action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'mic',            label: 'Microphone',        caption: 'WWE · cut a promo',   action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'foldingChair',   label: 'Folding chair',     caption: 'WWE · the weapon',    action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'wrestlingBoot',  label: 'Wrestling boot',    caption: 'WWE · high-laced',    action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'kendoStick',     label: 'Kendo stick',       caption: 'WWE · ECW hardcore',  action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'megaphone',      label: 'Megaphone',         caption: 'WWE · manager prop',  action: { kind: 'about', anchor: 'wwe' } },
    ],
  },
  {
    id: 'travel',
    displayName: 'Travel',
    pegCol: 2, top: 400, tilt: -2,
    defaultForm: 'carryOnBackpack',
    forms: [
      { shape: 'passport',         label: 'Passport',         caption: 'travel · stamp count',    action: { kind: 'about', anchor: 'travel' } },
      { shape: 'luggageTag',       label: 'Luggage tag',      caption: 'travel · in motion',      action: { kind: 'about', anchor: 'travel' } },
      { shape: 'carryOnBackpack',  label: 'Carry-on backpack', caption: 'travel · one-bag rig',    action: { kind: 'about', anchor: 'travel' } },
      { shape: 'rollerSuitcase',   label: 'Roller suitcase',  caption: 'travel · four-wheeler',   action: { kind: 'about', anchor: 'travel' } },
      { shape: 'travelCamera',     label: 'Travel camera',    caption: 'travel · X100 compact',   action: { kind: 'about', anchor: 'travel' } },
      { shape: 'packingCubes',     label: 'Packing cubes',    caption: 'travel · one-bag prep',   action: { kind: 'about', anchor: 'travel' } },
      { shape: 'nalgeneBottle',    label: 'Nalgene',          caption: 'travel · stickered bottle', action: { kind: 'about', anchor: 'travel' } },
    ],
  },
  {
    id: 'gf',
    displayName: 'GF',
    pegCol: 4, top: 410, tilt: 2,
    defaultForm: 'pairedMug',
    forms: [
      { shape: 'ring',         label: 'Ring',         caption: 'her',                  action: { kind: 'easter-egg', label: 'gf' } },
      { shape: 'keychain',     label: 'Keychain',     caption: 'her · paired keys',    action: { kind: 'easter-egg', label: 'gf' } },
      { shape: 'pairedMug',    label: 'Paired mugs',  caption: 'her · morning ritual', action: { kind: 'easter-egg', label: 'gf' } },
      { shape: 'cookingTool',  label: 'Cooking tool', caption: 'her · shared kitchen', action: { kind: 'easter-egg', label: 'gf' } },
      { shape: 'instaxCamera', label: 'Instax camera', caption: 'her · instant photos', action: { kind: 'easter-egg', label: 'gf' } },
    ],
  },
  {
    id: 'running',
    displayName: 'Running',
    pegCol: 1, top: 490, tilt: -3,
    defaultForm: 'shoe',
    forms: [
      { shape: 'shoe',           label: 'Running shoe',   caption: 'Strava · weekend runs', action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'gpsWatch',       label: 'GPS watch',      caption: 'Strava · weekend runs', action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'medal',          label: 'Race medal',     caption: 'Strava · weekend runs', action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'handheldBottle', label: 'Handheld bottle', caption: 'trail-running flask',  action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'foamRoller',     label: 'Foam roller',    caption: 'recovery cylinder',     action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'splitShorts',    label: 'Split shorts',   caption: 'race-day kit',          action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'bibSafetyPins',  label: 'Bib safety pins', caption: 'race-day ritual',     action: { kind: 'external', href: 'https://strava.com' } },
    ],
  },
  {
    id: 'roots',
    displayName: 'Roots (CO / US)',
    pegCol: 3, top: 480, tilt: 2,
    defaultForm: 'mokaPotGreca',
    forms: [
      { shape: 'flagPin',           label: 'Flag pin',     caption: 'roots · Colombia + USA',   action: { kind: 'about', anchor: 'roots' } },
      { shape: 'arepaPan',          label: 'Arepa pan',    caption: 'roots · Sunday breakfast', action: { kind: 'about', anchor: 'roots' } },
      { shape: 'ruanaCloth',        label: 'Ruana',         caption: 'roots · winter wrap',      action: { kind: 'about', anchor: 'roots' } },
      { shape: 'mokaPotGreca',      label: 'Greca / Moka pot', caption: 'roots · daily coffee ritual', action: { kind: 'about', anchor: 'roots' } },
      { shape: 'coladorTela',       label: 'Colador de tela', caption: 'roots · cloth coffee strainer', action: { kind: 'about', anchor: 'roots' } },
      { shape: 'carriel',           label: 'Carriel',       caption: 'roots · Antioquian satchel', action: { kind: 'about', anchor: 'roots' } },
      { shape: 'dominoTiles',       label: 'Dominoes',      caption: 'roots · Caribbean game',   action: { kind: 'about', anchor: 'roots' } },
      { shape: 'maracasGuacharaca', label: 'Maracas',       caption: 'roots · vallenato percussion', action: { kind: 'about', anchor: 'roots' } },
    ],
  },
  {
    id: 'fidget',
    displayName: 'Fidget',
    pegCol: 0, top: 570, tilt: -1,
    defaultForm: 'begleri',
    forms: [
      { shape: 'fidget',       label: 'Fidget spinner', caption: 'always in hand',     action: { kind: 'about', anchor: 'fidgets' } },
      { shape: 'begleri',      label: 'Begleri',        caption: 'two beads on a cord', action: { kind: 'about', anchor: 'fidgets' } },
      { shape: 'fidgetCube',   label: 'Fidget cube',    caption: 'six-faced EDC',      action: { kind: 'about', anchor: 'fidgets' } },
      { shape: 'worryStone',   label: 'Worry stone',    caption: 'thumb-divot pocket stone', action: { kind: 'about', anchor: 'fidgets' } },
      { shape: 'monkeyNoodle', label: 'Monkey noodle',  caption: 'stretchy tube fidget', action: { kind: 'about', anchor: 'fidgets' } },
      { shape: 'tangleToy',    label: 'Tangle',         caption: 'interlocking segments', action: { kind: 'about', anchor: 'fidgets' } },
    ],
  },
  {
    id: 'seltzer',
    displayName: 'Seltzer',
    pegCol: 4, top: 580, tilt: 2,
    defaultForm: 'sodaStreamCarbonator',
    forms: [
      { shape: 'seltzer',              label: 'Seltzer (baby juice)', caption: 'GF calls it that',         action: { kind: 'easter-egg', label: 'seltzer' } },
      { shape: 'sodaStreamCarbonator', label: 'SodaStream',           caption: 'home carbonation rig',     action: { kind: 'easter-egg', label: 'seltzer' } },
      { shape: 'co2Canister',          label: 'CO2 canister',         caption: 'the consumable',           action: { kind: 'easter-egg', label: 'seltzer' } },
      { shape: 'seltzerCan',           label: 'Seltzer can',          caption: 'LaCroix / Spindrift',      action: { kind: 'easter-egg', label: 'seltzer' } },
      { shape: 'glassBottleTopo',      label: 'Topo Chico bottle',    caption: 'cult mineral water',       action: { kind: 'easter-egg', label: 'seltzer' } },
      { shape: 'glassWithBubbles',     label: 'Bubbly glass',         caption: 'simple rocks glass',       action: { kind: 'easter-egg', label: 'seltzer' } },
      { shape: 'bottleOpener',         label: 'Bottle opener',        caption: 'for crown caps',           action: { kind: 'easter-egg', label: 'seltzer' } },
    ],
  },
];

export const F3_PEGBOARD_HEIGHT = 700;
export const F3_PEGBOARD_COLS = 5;
export const F3_PEGBOARD_PEG_SPACING = 22;
export const F3_PEGBOARD_PEG_RADIUS = 1.4;

// ──────────────────────────────────────────────────────────────────────────
// TROPHY WALL — memorabilia register (parallel to Pegboard's tool register)
// ──────────────────────────────────────────────────────────────────────────
//
// Same 14 CIS subjects, expressed as MEMORABILIA forms (framed sketch, ticket
// stubs, signed photos, polaroids). Trophy Wall layout = messy scatter
// (leftPct + top), not the Pegboard grid. fidget + seltzer default OFF on
// Trophy Wall because memorabilia register doesn't naturally express
// "carries fidget" / "drinks seltzer" — they're traits not objects worth
// pinning. User can flip them ON via toggle if a form exists.

export type F3TrophyWallShapeId =
  // Sketching
  | 'framedSketch'
  | 'processPrint'
  | 'stackedSketchbooks'
  | 'singleSketchbookClosed'
  | 'framedSketchPage'
  | 'pencilStubJar'
  | 'inktoberCard'
  // Work-rig
  | 'screenshotPrint'
  | 'pitchDeckCover'
  | 'stickeredLaptopLid'
  | 'conferenceLanyard'
  | 'stickerStack'
  | 'externalSsdArchive'
  | 'framedDribbble'
  | 'awwwardsStatue'
  // Punk
  | 'gigTicket'
  | 'framedFlyer'
  | 'bandPatch'
  | 'vinylLpSleeve'
  | 'bandTshirt'
  | 'setlistHandwritten'
  // Nintendo
  | 'framedMarioPoster'
  | 'zeldaMap'
  | 'cartShadowBox'
  | 'boxedGameCartridge'
  | 'amiiboFigure'
  | 'looseCartridge'
  | 'strategyGuide'
  | 'nintendoPowerMag'
  | 'nintendoPlush'
  // Movies
  | 'premiereTicket'
  | 'framedMoviePoster'
  | 'criterionSpine'
  | 'vhsClamshell'
  | 'letterboxdCard'
  | 'mondoPrintTube'
  // Pokémon
  | 'tradingCard'
  | 'pinnedFigurePhoto'
  | 'psaSlab'
  | 'cardBinderClosed'
  | 'pokemonPlush'
  | 'sealedBoosterBox'
  | 'collectorTin'
  // Sony
  | 'psPoster'
  | 'controllerShadowBox'
  | 'ps1JewelCase'
  | 'walkmanMixtape'
  | 'playstationMag'
  | 'trinitronTv'
  | 'ps1ConsoleDisplay'
  | 'sonyKeychain'
  // WWE
  | 'ringsideTicket'
  | 'signedPhoto'
  | 'replicaBelt'
  | 'wrestlingFigure'
  | 'ppvPoster'
  | 'luchaMask'
  | 'wrestlingCard'
  // Travel
  | 'boardingPassTW'
  | 'stampedPassport'
  | 'travelPatch'
  | 'foldedMap'
  | 'souvenirMagnet'
  | 'luggageTagWorn'
  // GF
  | 'polaroid'
  | 'loveLetter'
  | 'pairedPhotoStrip'
  | 'eventTicketPair'
  | 'friendshipBracelet'
  | 'sharedHouseplant'
  // Running
  | 'raceMedal'
  | 'raceBib'
  | 'finisherShirt'
  | 'multiMedalHanger'
  | 'framedRacePhoto'
  | 'agePodiumPlaque'
  // Roots
  | 'postcard'
  | 'flagPanel'
  | 'sombreroVueltiao'
  | 'mochilaWayuu'
  | 'colombianFlagFolded'
  | 'boteroFigurine'
  | 'passportDocument'
  // Fidget
  | 'fidgetCollectionTray'
  | 'wornFidgetCube'
  | 'begleriDisplay'
  | 'komboloi'
  | 'sealedKickstarterFidget'
  // Seltzer
  | 'lacroixCan'
  | 'topoChicoBottle'
  | 'lacroixRack'
  | 'seltzerTshirt'
  | 'perrierPoster';

export type F3TrophyWallForm = {
  shape: F3TrophyWallShapeId;
  label: string;
  caption: string;
  action: F3SubjectAction;
};

export type F3TrophyWallSubjectDef = {
  id: F3SubjectId;
  displayName: string;
  leftPct: number;     // % from left edge of column (0–100)
  top: number;         // px from top of scatter area
  tilt: number;        // baseline tilt (deg)
  defaultOff?: boolean; // If true, default form choice = 'off'
  defaultForm?: F3TrophyWallShapeId; // Optional override for which form loads first
  forms: F3TrophyWallForm[];
};

// 12 subjects with positions; fidget + seltzer included with defaultOff.
// Positions preserve existing F3B_PINS placements where they map cleanly
// (elara → elaraSketch coords, etc.) and add new positions for new subjects.
export const F3_TROPHY_WALL_SUBJECTS: F3TrophyWallSubjectDef[] = [
  {
    id: 'sketching',
    displayName: 'Sketching',
    leftPct: 4, top: 25, tilt: -5,
    defaultForm: 'stackedSketchbooks',
    forms: [
      { shape: 'framedSketch',           label: 'Framed sketch',      caption: 'pages from my notebook',  action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'processPrint',           label: 'Process print',      caption: 'process print, framed',    action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'stackedSketchbooks',     label: 'Stacked sketchbooks', caption: 'wall of finished books',  action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'singleSketchbookClosed', label: 'Closed sketchbook',  caption: 'finished volume, banded',  action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'framedSketchPage',       label: 'Framed loose page',  caption: 'urban sketcher symposium', action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'pencilStubJar',          label: 'Pencil stub jar',    caption: 'I drew this much',         action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'inktoberCard',           label: 'Inktober card',      caption: 'dated daily ink',          action: { kind: 'case-study', slug: 'elara' } },
    ],
  },
  {
    id: 'work-rig',
    displayName: 'Work rig',
    leftPct: 72, top: 25, tilt: 4,
    defaultForm: 'stickeredLaptopLid',
    forms: [
      { shape: 'screenshotPrint',     label: 'Screenshot print',     caption: 'work output, framed',     action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'pitchDeckCover',      label: 'Pitch deck cover',     caption: 'deck I worked on',        action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'stickeredLaptopLid',  label: 'Stickered laptop lid', caption: 'the lid is the ledger',   action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'conferenceLanyard',   label: 'Conference lanyard',   caption: 'Config · I was there',    action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'stickerStack',        label: 'Sticker stack',        caption: 'still-to-apply pile',     action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'externalSsdArchive',  label: 'ARCHIVE SSD',          caption: 'the work lives here',     action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'framedDribbble',      label: 'Framed Dribbble shot', caption: 'agency studio convention', action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'awwwardsStatue',      label: 'Awwwards statue',      caption: 'shipped-something trophy', action: { kind: 'case-study', slug: 'ion' } },
    ],
  },
  {
    id: 'punk',
    displayName: 'Punk rock',
    leftPct: 14, top: 150, tilt: -3,
    defaultForm: 'vinylLpSleeve',
    forms: [
      { shape: 'gigTicket',          label: 'Gig ticket stub', caption: 'punk · gig night',      action: { kind: 'about', anchor: 'punk' } },
      { shape: 'framedFlyer',        label: 'Framed flyer',    caption: 'punk · pinned poster',  action: { kind: 'about', anchor: 'punk' } },
      { shape: 'bandPatch',          label: 'Band patch',      caption: 'punk · sewn on jacket', action: { kind: 'about', anchor: 'punk' } },
      { shape: 'vinylLpSleeve',      label: 'Vinyl LP sleeve', caption: 'punk · 12" record',     action: { kind: 'about', anchor: 'punk' } },
      { shape: 'bandTshirt',         label: 'Band T-shirt',    caption: 'punk · folded merch',   action: { kind: 'about', anchor: 'punk' } },
      { shape: 'setlistHandwritten', label: 'Setlist',         caption: 'punk · taped stagehand', action: { kind: 'about', anchor: 'punk' } },
    ],
  },
  {
    id: 'nintendo',
    displayName: 'Nintendo',
    leftPct: 56, top: 170, tilt: 2,
    defaultForm: 'boxedGameCartridge',
    forms: [
      { shape: 'framedMarioPoster',  label: 'Framed Mario poster', caption: 'Nintendo · childhood',    action: { kind: 'about', anchor: 'games' } },
      { shape: 'zeldaMap',           label: 'Zelda map',            caption: 'Nintendo · adventure',    action: { kind: 'about', anchor: 'games' } },
      { shape: 'cartShadowBox',      label: 'Cartridge box',        caption: 'Nintendo · framed cart',  action: { kind: 'about', anchor: 'games' } },
      { shape: 'boxedGameCartridge', label: 'Boxed cartridge',      caption: 'Nintendo · CIB front view', action: { kind: 'about', anchor: 'games' } },
      { shape: 'amiiboFigure',       label: 'Amiibo figure',        caption: 'Nintendo · NFC on a disc', action: { kind: 'about', anchor: 'games' } },
      { shape: 'looseCartridge',     label: 'Loose cartridge',      caption: 'Nintendo · label art',    action: { kind: 'about', anchor: 'games' } },
      { shape: 'strategyGuide',      label: 'Strategy guide',       caption: 'Nintendo · Power-era guide', action: { kind: 'about', anchor: 'games' } },
      { shape: 'nintendoPowerMag',   label: 'Nintendo Power',       caption: 'Nintendo · back-issue stash', action: { kind: 'about', anchor: 'games' } },
      { shape: 'nintendoPlush',      label: 'Plush',                caption: 'Nintendo · character plush', action: { kind: 'about', anchor: 'games' } },
    ],
  },
  {
    id: 'running',
    displayName: 'Running',
    leftPct: 80, top: 220, tilt: 6,
    defaultForm: 'raceMedal',
    forms: [
      { shape: 'raceMedal',        label: 'Race medal',         caption: 'Strava · on profile →',    action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'raceBib',          label: 'Race bib',           caption: 'Strava · 5K finisher',     action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'finisherShirt',    label: 'Finisher T-shirt',   caption: 'post-race trophy',         action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'multiMedalHanger', label: 'Medal hanger',       caption: 'wall of finishes',         action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'framedRacePhoto',  label: 'Framed race photo',  caption: 'MarathonFoto finish line', action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'agePodiumPlaque',  label: 'Age-group plaque',   caption: 'acrylic podium',           action: { kind: 'external', href: 'https://strava.com' } },
    ],
  },
  {
    id: 'gf',
    displayName: 'GF',
    leftPct: 26, top: 260, tilt: -10,
    defaultForm: 'polaroid',
    forms: [
      { shape: 'polaroid',           label: 'Polaroid',           caption: 'with M · road trip',     action: { kind: 'easter-egg', label: 'gf' } },
      { shape: 'loveLetter',         label: 'Love letter',        caption: 'for her',                 action: { kind: 'easter-egg', label: 'gf' } },
      { shape: 'pairedPhotoStrip',   label: 'Paired photo strip', caption: 'photobooth · 4-up',      action: { kind: 'easter-egg', label: 'gf' } },
      { shape: 'eventTicketPair',    label: 'Ticket pair',         caption: 'first-show stubs',       action: { kind: 'easter-egg', label: 'gf' } },
      { shape: 'friendshipBracelet', label: 'Friendship bracelet', caption: 'paired beads',           action: { kind: 'easter-egg', label: 'gf' } },
      { shape: 'sharedHouseplant',   label: 'Shared houseplant',   caption: 'pothos as metaphor',     action: { kind: 'easter-egg', label: 'gf' } },
    ],
  },
  {
    id: 'movies',
    displayName: 'Movies',
    leftPct: 40, top: 320, tilt: 3,
    defaultForm: 'framedMoviePoster',
    forms: [
      { shape: 'premiereTicket',    label: 'Premiere ticket',  caption: 'movies · opening night',   action: { kind: 'about', anchor: 'movies' } },
      { shape: 'framedMoviePoster', label: 'Framed poster',    caption: 'movies · favorite film',   action: { kind: 'about', anchor: 'movies' } },
      { shape: 'criterionSpine',    label: 'Criterion spine',  caption: 'movies · Criterion shelf', action: { kind: 'about', anchor: 'movies' } },
      { shape: 'vhsClamshell',      label: 'VHS clamshell',    caption: 'movies · retro clamshell', action: { kind: 'about', anchor: 'movies' } },
      { shape: 'letterboxdCard',    label: 'Letterboxd card',  caption: 'movies · year-in-review',  action: { kind: 'about', anchor: 'movies' } },
      { shape: 'mondoPrintTube',    label: 'Mondo print tube', caption: 'movies · still in tube',   action: { kind: 'about', anchor: 'movies' } },
    ],
  },
  {
    id: 'sony',
    displayName: 'Sony',
    leftPct: 8, top: 380, tilt: -4,
    defaultForm: 'ps1JewelCase',
    forms: [
      { shape: 'psPoster',            label: 'PS poster',           caption: 'Sony · favorite franchise', action: { kind: 'about', anchor: 'games' } },
      { shape: 'controllerShadowBox', label: 'Controller box',      caption: 'Sony · framed controller',  action: { kind: 'about', anchor: 'games' } },
      { shape: 'ps1JewelCase',        label: 'PS1 jewel case',      caption: 'Sony · black-bottom case',  action: { kind: 'about', anchor: 'games' } },
      { shape: 'walkmanMixtape',      label: 'Mixtape cassette',    caption: 'Sony · hand-labeled spine', action: { kind: 'about', anchor: 'games' } },
      { shape: 'playstationMag',      label: 'PlayStation magazine', caption: 'Sony · demo disc + sleeve', action: { kind: 'about', anchor: 'games' } },
      { shape: 'trinitronTv',         label: 'Trinitron TV',         caption: 'Sony · design-canon CRT',   action: { kind: 'about', anchor: 'games' } },
      { shape: 'ps1ConsoleDisplay',   label: 'PS1 console',          caption: 'Sony · kept on shelf',      action: { kind: 'about', anchor: 'games' } },
      { shape: 'sonyKeychain',        label: 'Sony keychain',        caption: 'Sony · launch-day merch',   action: { kind: 'about', anchor: 'games' } },
    ],
  },
  {
    id: 'pokemon',
    displayName: 'Pokémon',
    leftPct: 68, top: 400, tilt: 7,
    defaultForm: 'psaSlab',
    forms: [
      { shape: 'tradingCard',       label: 'Trading card',         caption: 'Pokémon · inner child',      action: { kind: 'easter-egg', label: 'pokemon' } },
      { shape: 'pinnedFigurePhoto', label: 'Pinned figure photo',  caption: 'Pokémon · shelf collection', action: { kind: 'easter-egg', label: 'pokemon' } },
      { shape: 'psaSlab',           label: 'PSA slab',             caption: 'Pokémon · graded plastic',   action: { kind: 'easter-egg', label: 'pokemon' } },
      { shape: 'cardBinderClosed',  label: 'Card binder',          caption: 'Pokémon · 3-ring binder',    action: { kind: 'easter-egg', label: 'pokemon' } },
      { shape: 'pokemonPlush',      label: 'Pokémon plush',        caption: 'Pokémon · Center plush',     action: { kind: 'easter-egg', label: 'pokemon' } },
      { shape: 'sealedBoosterBox',  label: 'Booster box',          caption: 'Pokémon · 36-pack sealed',   action: { kind: 'easter-egg', label: 'pokemon' } },
      { shape: 'collectorTin',      label: 'Collector tin',        caption: 'Pokémon · metal tin',        action: { kind: 'easter-egg', label: 'pokemon' } },
    ],
  },
  {
    id: 'roots',
    displayName: 'Roots (CO / US)',
    leftPct: 8, top: 480, tilt: -3,
    defaultForm: 'colombianFlagFolded',
    forms: [
      { shape: 'postcard',            label: 'Postcard · Cartagena', caption: 'roots · Colombia + USA',  action: { kind: 'about', anchor: 'roots' } },
      { shape: 'flagPanel',           label: 'Flag panel',            caption: 'roots · CO + US',         action: { kind: 'about', anchor: 'roots' } },
      { shape: 'colombianFlagFolded', label: 'Colombian flag · folded', caption: 'roots · diaspora trophy', action: { kind: 'about', anchor: 'roots' } },
      { shape: 'sombreroVueltiao',    label: 'Sombrero vueltiao',     caption: 'roots · CO national symbol', action: { kind: 'about', anchor: 'roots' } },
      { shape: 'mochilaWayuu',        label: 'Mochila wayuu',         caption: 'roots · La Guajira weave', action: { kind: 'about', anchor: 'roots' } },
      { shape: 'boteroFigurine',      label: 'Botero figurine',       caption: 'roots · CO export art',   action: { kind: 'about', anchor: 'roots' } },
      { shape: 'passportDocument',    label: 'Dual passport',         caption: 'roots · CO + US stacked', action: { kind: 'about', anchor: 'roots' } },
    ],
  },
  {
    id: 'wwe',
    displayName: 'WWE',
    leftPct: 70, top: 560, tilt: 4,
    defaultForm: 'replicaBelt',
    forms: [
      { shape: 'ringsideTicket', label: 'Ringside ticket', caption: 'WWE · live event',     action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'signedPhoto',    label: 'Signed photo',    caption: 'WWE · signed roster',  action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'replicaBelt',    label: 'Replica belt',    caption: 'WWE · wall-mounted',   action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'wrestlingFigure', label: 'Wrestler figure', caption: 'WWE · Mattel boxed',  action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'ppvPoster',      label: 'PPV poster',      caption: 'WWE · WrestleMania',   action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'luchaMask',      label: 'Lucha mask',      caption: 'WWE · CMLL on a hook', action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'wrestlingCard',  label: 'Wrestling card',  caption: 'WWE · Topps single',   action: { kind: 'about', anchor: 'wwe' } },
    ],
  },
  {
    id: 'travel',
    displayName: 'Travel',
    leftPct: 42, top: 740, tilt: -6,
    defaultForm: 'stampedPassport',
    forms: [
      { shape: 'boardingPassTW',  label: 'Boarding pass',   caption: 'BOG → JFK · trip reveal', action: { kind: 'easter-egg', label: 'boarding-pass' } },
      { shape: 'stampedPassport', label: 'Stamped passport', caption: 'travel · stamp count',   action: { kind: 'about', anchor: 'travel' } },
      { shape: 'travelPatch',     label: 'National Parks patch', caption: 'travel · sewn-on souvenir', action: { kind: 'about', anchor: 'travel' } },
      { shape: 'foldedMap',       label: 'Folded map',       caption: 'travel · pinholes + creases', action: { kind: 'about', anchor: 'travel' } },
      { shape: 'souvenirMagnet',  label: 'Souvenir magnet',  caption: 'travel · kitsch fridge',  action: { kind: 'about', anchor: 'travel' } },
      { shape: 'luggageTagWorn',  label: 'Luggage tag (worn)', caption: 'travel · well-traveled bag', action: { kind: 'about', anchor: 'travel' } },
    ],
  },
  // fidget + seltzer now default ON 2026-05-31 — research surfaced proper
  // memorabilia forms (fidget collection tray, komboloi worry beads, LaCroix
  // can-as-decor, Topo Chico bottle, Perrier poster). The Polaroid-of-X
  // placeholder forms remain available but a real memorabilia form is now the
  // default per the F3 subject-forms research doc.
  {
    id: 'fidget',
    displayName: 'Fidget',
    leftPct: 18, top: 620, tilt: 2,
    defaultForm: 'fidgetCollectionTray',
    forms: [
      { shape: 'polaroid',                label: 'Polaroid of fidget',     caption: 'always in hand · captured', action: { kind: 'about', anchor: 'fidgets' } },
      { shape: 'fidgetCollectionTray',    label: 'Fidget collection',      caption: 'the tray of fidgets',       action: { kind: 'about', anchor: 'fidgets' } },
      { shape: 'wornFidgetCube',          label: 'Worn fidget cube',       caption: 'used to death',             action: { kind: 'about', anchor: 'fidgets' } },
      { shape: 'begleriDisplay',          label: 'Begleri on display',     caption: 'hung by its loop',          action: { kind: 'about', anchor: 'fidgets' } },
      { shape: 'komboloi',                label: 'Komboloi',               caption: 'Greek worry beads',         action: { kind: 'about', anchor: 'fidgets' } },
      { shape: 'sealedKickstarterFidget', label: 'Sealed Kickstarter cube', caption: 'collector unopened',       action: { kind: 'about', anchor: 'fidgets' } },
    ],
  },
  {
    id: 'seltzer',
    displayName: 'Seltzer',
    leftPct: 88, top: 660, tilt: -5,
    defaultForm: 'lacroixCan',
    forms: [
      { shape: 'polaroid',         label: 'Polaroid of seltzer', caption: 'baby juice · sealed',  action: { kind: 'easter-egg', label: 'seltzer' } },
      { shape: 'lacroixCan',       label: 'LaCroix can',          caption: 'pastel-pattern decor', action: { kind: 'easter-egg', label: 'seltzer' } },
      { shape: 'topoChicoBottle',  label: 'Topo Chico bottle',    caption: 'green glass, kept',    action: { kind: 'easter-egg', label: 'seltzer' } },
      { shape: 'lacroixRack',      label: 'LaCroix pyramid',      caption: 'pyramid of cans',      action: { kind: 'easter-egg', label: 'seltzer' } },
      { shape: 'seltzerTshirt',    label: 'Pamplemousse tee',     caption: 'novelty merch · folded', action: { kind: 'easter-egg', label: 'seltzer' } },
      { shape: 'perrierPoster',    label: 'Vintage Perrier poster', caption: 'Villemot 1970s print', action: { kind: 'easter-egg', label: 'seltzer' } },
    ],
  },
];

export const F3_TROPHY_WALL_HEIGHT = 870;

export function findTrophyWallForm(subjectId: F3SubjectId, shape: F3TrophyWallShapeId): F3TrophyWallForm | undefined {
  const subj = F3_TROPHY_WALL_SUBJECTS.find((s) => s.id === subjectId);
  if (!subj) return undefined;
  return subj.forms.find((f) => f.shape === shape);
}

export function describeF3SubjectAction(a: F3SubjectAction): string {
  switch (a.kind) {
    case 'case-study': return `case-study:${a.slug}`;
    case 'about': return `about:${a.anchor}`;
    case 'external': return `external:${a.href}`;
    case 'easter-egg': return `easter-egg:${a.label}`;
  }
}

export function findPegboardForm(subjectId: F3SubjectId, shape: F3PegboardShapeId): F3PegboardForm | undefined {
  const subj = F3_PEGBOARD_SUBJECTS.find((s) => s.id === subjectId);
  if (!subj) return undefined;
  return subj.forms.find((f) => f.shape === shape);
}

// ──────────────────────────────────────────────────────────────────────────
// F3-A · DESK (horizontal band) — same CIS, same shape catalog, F3-A specific
//   positions / orientations / defaults
// ──────────────────────────────────────────────────────────────────────────
//
// Per the family perceptual frame doc (F3-toggle-architecture.md):
//   - Same OBJECTS as F3-B (shape catalog SHARED via F3PegboardShapeId)
//   - F3-A defaults run DENSER (10-12 items default-on vs F3-B's 6-9)
//   - F3-A composition = arranged / staged moment
//   - F3-A positions are 3D scatter coords on a horizontal desk surface
//
// Note: F3-A uses 3D primitives (R3F), not SVG. The shape ID determines the
// primitive type + size via F3_DESK_3D_SHAPES below. Some shape IDs may not
// have a 3D mapping; those fall back to F3_DESK_3D_FALLBACK (generic small
// flat box). High-quality 3D models replace primitives in the 3D asset
// pipeline phase.

export type F3DeskForm = {
  shape: F3PegboardShapeId;
  label: string;
  caption: string;
  action: F3SubjectAction;
};

export type F3DeskSubjectDef = {
  id: F3SubjectId;
  displayName: string;
  position3D: [number, number, number]; // x, y, z on the desk
  tilt: number;                          // baseline rotation around Y (deg)
  defaultOff?: boolean;
  defaultForm?: F3PegboardShapeId;
  forms: F3DeskForm[];                   // subset of subject's Pegboard forms — initially mirrored
};

// 14 CIS subjects with F3-A specific positions. Per family-design language:
// densest defaults — only seltzer + fidget default-off (those daily-trait
// subjects are visually weakest and the desk should feel curated, not random).
//
// Position math: desk surface is roughly x ∈ [-2.5, 2.5], z ∈ [-0.8, 0.8].
// y is small (objects sit ON the surface ~0.05-0.4 depending on item height).
// 14 items spread across the desk with deliberate clustering — staged not random.
//
// Forms initially mirror Pegboard's catalog for parity. Tunable later per family.
export const F3_A_DESK_SUBJECTS: F3DeskSubjectDef[] = [
  {
    id: 'sketching',
    displayName: 'Sketching',
    position3D: [-1.7, 0.06, -0.3], tilt: -5,
    defaultForm: 'sketchbook',
    forms: [
      { shape: 'sketchbook',       label: 'Sketchbook',        caption: 'always on the desk',    action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'mechanicalPencil', label: 'Mechanical pencil',  caption: 'designer pencil',       action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'draftingPen',      label: 'Drafting pen',       caption: 'fineliner of choice',   action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'xacto',            label: 'X-acto knife',       caption: 'precision cuts',        action: { kind: 'case-study', slug: 'elara' } },
      { shape: 'brushPen',         label: 'Brush pen',          caption: 'gestural lines',        action: { kind: 'case-study', slug: 'elara' } },
    ],
  },
  {
    id: 'work-rig',
    displayName: 'Work rig',
    position3D: [0, 0.05, 0], tilt: 8,
    defaultForm: 'macbook',
    forms: [
      { shape: 'macbook',           label: 'MacBook',           caption: 'main work tool',   action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'laptopSideProfile', label: 'Laptop, side',      caption: 'closed, ready',    action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'monitor',           label: 'Monitor',           caption: 'desk setup',       action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'stylus',            label: 'Stylus',            caption: 'iPad work',        action: { kind: 'case-study', slug: 'ion' } },
      { shape: 'mxMouse',           label: 'MX Master mouse',   caption: 'designer mouse',   action: { kind: 'case-study', slug: 'ion' } },
    ],
  },
  {
    id: 'punk',
    displayName: 'Punk rock',
    position3D: [-2.2, 0.05, 0.4], tilt: -7,
    defaultForm: 'vinyl',
    forms: [
      { shape: 'vinyl',         label: 'Vinyl LP',         caption: 'on the desk after a listen', action: { kind: 'about', anchor: 'punk' } },
      { shape: 'guitarPedal',   label: 'Guitar pedal',     caption: 'punk · gear nerd',           action: { kind: 'about', anchor: 'punk' } },
      { shape: 'guitarPick',    label: 'Guitar pick',      caption: 'in the corner',              action: { kind: 'about', anchor: 'punk' } },
    ],
  },
  {
    id: 'movies',
    displayName: 'Movies',
    position3D: [2.0, 0.05, -0.4], tilt: 4,
    defaultForm: 'filmCanister',
    forms: [
      { shape: 'filmCanister',  label: 'Film canister',  caption: '35mm',                action: { kind: 'about', anchor: 'movies' } },
      { shape: 'dvdSpine',      label: 'DVD spine',      caption: 'Criterion shelf',     action: { kind: 'about', anchor: 'movies' } },
      { shape: 'vhs',           label: 'VHS tape',       caption: 'fan',                 action: { kind: 'about', anchor: 'movies' } },
      { shape: 'popcornBucket', label: 'Popcorn bucket', caption: 'the theater',         action: { kind: 'about', anchor: 'movies' } },
    ],
  },
  {
    id: 'wwe',
    displayName: 'WWE',
    position3D: [-1.0, 0.05, 0.5], tilt: -3,
    defaultForm: 'actionFigure',
    forms: [
      { shape: 'actionFigure', label: 'Action figure',     caption: 'roster',            action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'beltMini',     label: 'Championship belt', caption: 'the chase',         action: { kind: 'about', anchor: 'wwe' } },
      { shape: 'mic',          label: 'Microphone',        caption: 'cut a promo',       action: { kind: 'about', anchor: 'wwe' } },
    ],
  },
  {
    id: 'pokemon',
    displayName: 'Pokémon',
    position3D: [1.6, 0.18, -0.5], tilt: -7,
    defaultForm: 'pokeball',
    forms: [
      { shape: 'pokeball',      label: 'Pokéball',       caption: 'Pokémon · inner child',  action: { kind: 'easter-egg', label: 'pokemon' } },
      { shape: 'pokemonFigure', label: 'Pokémon figure', caption: 'Pokémon · inner child',  action: { kind: 'easter-egg', label: 'pokemon' } },
    ],
  },
  {
    id: 'nintendo',
    displayName: 'Nintendo',
    position3D: [-0.5, 0.05, 0.55], tilt: 6,
    defaultForm: 'nesController',
    forms: [
      { shape: 'nesController',  label: 'NES controller',  caption: 'Nintendo · childhood',    action: { kind: 'about', anchor: 'games' } },
      { shape: 'snesController', label: 'SNES controller', caption: 'Nintendo · golden age',   action: { kind: 'about', anchor: 'games' } },
      { shape: 'gameBoy',        label: 'Game Boy',        caption: 'Nintendo · the start',    action: { kind: 'about', anchor: 'games' } },
      { shape: 'switch',         label: 'Switch',          caption: 'Nintendo · main rig',     action: { kind: 'about', anchor: 'games' } },
    ],
  },
  {
    id: 'sony',
    displayName: 'Sony',
    position3D: [0.7, 0.05, 0.6], tilt: -2,
    defaultForm: 'ps5Controller',
    forms: [
      { shape: 'ps5Controller', label: 'PS5 controller', caption: 'Sony · current gen',   action: { kind: 'about', anchor: 'games' } },
      { shape: 'walkman',       label: 'Walkman',        caption: 'Sony · throwback',     action: { kind: 'about', anchor: 'games' } },
      { shape: 'vita',          label: 'PS Vita',        caption: 'Sony · cult device',   action: { kind: 'about', anchor: 'games' } },
    ],
  },
  {
    id: 'gf',
    displayName: 'GF',
    position3D: [-1.3, 0.04, 0.5], tilt: 5,
    defaultForm: 'pairedMug',
    forms: [
      { shape: 'pairedMug', label: 'Paired mugs', caption: 'her · morning ritual',  action: { kind: 'easter-egg', label: 'gf' } },
      { shape: 'ring',      label: 'Ring',        caption: 'her',                   action: { kind: 'easter-egg', label: 'gf' } },
      { shape: 'keychain',  label: 'Keychain',    caption: 'paired keys',           action: { kind: 'easter-egg', label: 'gf' } },
    ],
  },
  {
    id: 'roots',
    displayName: 'Roots (CO / US)',
    position3D: [2.4, 0.18, 0.3], tilt: 8,
    defaultForm: 'flagPin',
    forms: [
      { shape: 'flagPin',    label: 'Flag pin',    caption: 'CO + US',         action: { kind: 'about', anchor: 'roots' } },
      { shape: 'arepaPan',   label: 'Arepa pan',   caption: 'Sunday breakfast', action: { kind: 'about', anchor: 'roots' } },
      { shape: 'mokaPotGreca', label: 'Moka pot',  caption: 'greca · daily',   action: { kind: 'about', anchor: 'roots' } },
    ],
  },
  {
    id: 'travel',
    displayName: 'Travel',
    position3D: [2.2, 0.05, -0.05], tilt: -4,
    defaultForm: 'passport',
    forms: [
      { shape: 'passport',    label: 'Passport',     caption: 'travel · always packed', action: { kind: 'about', anchor: 'travel' } },
      { shape: 'luggageTag',  label: 'Luggage tag',  caption: 'travel · in motion',     action: { kind: 'about', anchor: 'travel' } },
    ],
  },
  {
    id: 'running',
    displayName: 'Running',
    position3D: [0.6, 0.05, -0.7], tilt: -3,
    defaultForm: 'shoe',
    forms: [
      { shape: 'shoe',     label: 'Running shoe', caption: 'Strava · weekend runs',    action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'medal',    label: 'Race medal',   caption: 'Strava · weekend runs',    action: { kind: 'external', href: 'https://strava.com' } },
      { shape: 'gpsWatch', label: 'GPS watch',    caption: 'Strava · weekend runs',    action: { kind: 'external', href: 'https://strava.com' } },
    ],
  },
  {
    id: 'fidget',
    displayName: 'Fidget',
    position3D: [0.4, 0.06, 0.75], tilt: 3,
    defaultOff: true,
    defaultForm: 'fidget',
    forms: [
      { shape: 'fidget',  label: 'Fidget spinner', caption: 'always in hand', action: { kind: 'about', anchor: 'fidgets' } },
      { shape: 'begleri', label: 'Begleri',        caption: 'worry-bead descendant', action: { kind: 'about', anchor: 'fidgets' } },
    ],
  },
  {
    id: 'seltzer',
    displayName: 'Seltzer',
    position3D: [1.2, 0.4, 0.4], tilt: 0,
    defaultOff: true,
    defaultForm: 'seltzer',
    forms: [
      { shape: 'seltzer',    label: 'Seltzer can', caption: 'GF calls it baby juice', action: { kind: 'easter-egg', label: 'seltzer' } },
      { shape: 'seltzerCan', label: 'Seltzer can (LaCroix)', caption: 'design-Twitter cliché', action: { kind: 'easter-egg', label: 'seltzer' } },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────
// F3-A 3D primitive mapping per shape ID. Low-fi placeholders — replaced
// with proper Tripo / Meshy / Blender models in the 3D asset pipeline phase.
// Any shape ID not in this map falls back to F3_DESK_3D_FALLBACK.
// ──────────────────────────────────────────────────────────────────────────

export type F3Desk3DPrimitive = {
  geometry: 'box' | 'cylinder' | 'cone' | 'sphere';
  size: [number, number, number, number?]; // geometry args
};

export const F3_DESK_3D_FALLBACK: F3Desk3DPrimitive = {
  geometry: 'box',
  size: [0.3, 0.05, 0.2],
};

export const F3_DESK_3D_SHAPES: Partial<Record<F3PegboardShapeId, F3Desk3DPrimitive>> = {
  // Sketching
  sketchbook:       { geometry: 'box',      size: [0.9, 0.12, 0.7] },
  draftingPen:      { geometry: 'cylinder', size: [0.04, 0.04, 0.6] },
  mechanicalPencil: { geometry: 'cylinder', size: [0.035, 0.035, 0.55] },
  xacto:            { geometry: 'cylinder', size: [0.04, 0.04, 0.5] },
  capPen:           { geometry: 'cylinder', size: [0.04, 0.04, 0.55] },
  brushPen:         { geometry: 'cylinder', size: [0.04, 0.04, 0.55] },
  chiselMarker:     { geometry: 'cylinder', size: [0.05, 0.05, 0.55] },
  eraserBlock:      { geometry: 'box',      size: [0.18, 0.08, 0.1] },
  triangleRuler:    { geometry: 'box',      size: [0.5, 0.02, 0.5] },

  // Work-rig
  macbook:           { geometry: 'box', size: [1.5, 0.04, 1.0] },
  laptopSideProfile: { geometry: 'box', size: [1.5, 0.04, 1.0] },
  monitor:           { geometry: 'box', size: [1.6, 1.0, 0.08] },
  stylus:            { geometry: 'cylinder', size: [0.04, 0.04, 0.6] },
  mxMouse:           { geometry: 'box', size: [0.16, 0.08, 0.28] },
  mechKeyboard:      { geometry: 'box', size: [0.9, 0.05, 0.3] },
  overEarHeadphones: { geometry: 'cylinder', size: [0.2, 0.2, 0.4] },
  usbCCable:         { geometry: 'cylinder', size: [0.08, 0.08, 0.08] },
  fieldNotes:        { geometry: 'box', size: [0.3, 0.04, 0.5] },

  // Punk
  vinyl:        { geometry: 'cylinder', size: [0.45, 0.45, 0.02] },
  guitarPedal:  { geometry: 'box',      size: [0.3, 0.15, 0.4] },
  drumsticks:   { geometry: 'cylinder', size: [0.04, 0.04, 0.95] },
  electricGuitar: { geometry: 'box', size: [1.2, 0.08, 0.4] },
  bassGuitar:   { geometry: 'box',      size: [1.3, 0.08, 0.4] },
  guitarPick:   { geometry: 'box',      size: [0.06, 0.005, 0.08] },
  ampCombo:     { geometry: 'box',      size: [0.5, 0.4, 0.3] },

  // Movies
  vhs:            { geometry: 'box', size: [0.5, 0.08, 0.32] },
  dvdSpine:       { geometry: 'box', size: [0.16, 0.5, 0.04] },
  popcornBucket:  { geometry: 'cylinder', size: [0.22, 0.18, 0.4] },
  filmCanister:   { geometry: 'cylinder', size: [0.4, 0.4, 0.08] },
  filmReel:       { geometry: 'cylinder', size: [0.45, 0.45, 0.08] },
  clapperboard:   { geometry: 'box', size: [0.6, 0.04, 0.4] },
  boomMic:        { geometry: 'cylinder', size: [0.06, 0.06, 0.9] },
  filmStrip:      { geometry: 'box', size: [0.1, 0.005, 0.8] },
  homeProjector:  { geometry: 'box', size: [0.5, 0.35, 0.4] },

  // WWE
  beltMini:      { geometry: 'box', size: [0.7, 0.04, 0.2] },
  actionFigure:  { geometry: 'box', size: [0.18, 0.4, 0.12] },
  mic:           { geometry: 'cylinder', size: [0.06, 0.06, 0.3] },
  foldingChair:  { geometry: 'box', size: [0.4, 0.04, 0.4] },
  wrestlingBoot: { geometry: 'box', size: [0.3, 0.35, 0.15] },
  kendoStick:    { geometry: 'cylinder', size: [0.03, 0.03, 1.0] },
  megaphone:     { geometry: 'cone', size: [0.2, 0.4, 16] },

  // Pokémon
  pokeball:      { geometry: 'sphere', size: [0.18, 24, 24] },
  pokemonFigure: { geometry: 'cylinder', size: [0.12, 0.18, 0.35] },
  cardSleeve:    { geometry: 'box', size: [0.22, 0.01, 0.32] },
  cardBinder:    { geometry: 'box', size: [0.32, 0.06, 0.42] },
  boosterPack:   { geometry: 'box', size: [0.16, 0.02, 0.25] },
  playmat:       { geometry: 'box', size: [0.8, 0.005, 0.5] },

  // Nintendo
  switch:         { geometry: 'box', size: [0.45, 0.04, 0.18] },
  gameBoy:        { geometry: 'box', size: [0.2, 0.04, 0.32] },
  nesCartridge:   { geometry: 'box', size: [0.28, 0.04, 0.22] },
  marioHat:       { geometry: 'cylinder', size: [0.2, 0.2, 0.15] },
  nesController:  { geometry: 'box', size: [0.32, 0.06, 0.16] },
  snesController: { geometry: 'box', size: [0.38, 0.07, 0.16] },
  n64Controller:  { geometry: 'box', size: [0.4, 0.08, 0.2] },
  joyConSingle:   { geometry: 'box', size: [0.1, 0.04, 0.28] },
  powerGlove:     { geometry: 'box', size: [0.22, 0.18, 0.3] },

  // Sony
  ps5Controller:        { geometry: 'box', size: [0.4, 0.08, 0.22] },
  walkman:              { geometry: 'box', size: [0.25, 0.05, 0.32] },
  vita:                 { geometry: 'box', size: [0.5, 0.04, 0.22] },
  dualShockController:  { geometry: 'box', size: [0.4, 0.08, 0.22] },
  discman:              { geometry: 'cylinder', size: [0.22, 0.22, 0.05] },
  ps1MemoryCard:        { geometry: 'box', size: [0.14, 0.015, 0.08] },
  miniDisc:             { geometry: 'box', size: [0.18, 0.015, 0.2] },
  psp:                  { geometry: 'box', size: [0.5, 0.05, 0.22] },

  // GF
  ring:        { geometry: 'cylinder', size: [0.08, 0.08, 0.04] },
  keychain:    { geometry: 'cylinder', size: [0.1, 0.1, 0.02] },
  pairedMug:   { geometry: 'cylinder', size: [0.15, 0.15, 0.3] },
  cookingTool: { geometry: 'cylinder', size: [0.05, 0.05, 0.6] },
  instaxCamera: { geometry: 'box', size: [0.4, 0.2, 0.18] },

  // Roots
  flagPin:           { geometry: 'cylinder', size: [0.12, 0.12, 0.02] },
  arepaPan:          { geometry: 'cylinder', size: [0.26, 0.26, 0.05] },
  ruanaCloth:        { geometry: 'box', size: [0.4, 0.02, 0.5] },
  mokaPotGreca:      { geometry: 'cylinder', size: [0.15, 0.15, 0.4] },
  coladorTela:       { geometry: 'cone', size: [0.12, 0.2, 16] },
  carriel:           { geometry: 'box', size: [0.32, 0.3, 0.12] },
  dominoTiles:       { geometry: 'box', size: [0.2, 0.06, 0.12] },
  maracasGuacharaca: { geometry: 'cylinder', size: [0.08, 0.08, 0.4] },

  // Travel
  passport:        { geometry: 'box', size: [0.18, 0.04, 0.26] },
  luggageTag:      { geometry: 'box', size: [0.14, 0.02, 0.22] },
  carryOnBackpack: { geometry: 'box', size: [0.45, 0.55, 0.3] },
  rollerSuitcase:  { geometry: 'box', size: [0.4, 0.6, 0.3] },
  travelCamera:    { geometry: 'box', size: [0.18, 0.1, 0.12] },
  packingCubes:    { geometry: 'box', size: [0.3, 0.12, 0.2] },
  nalgeneBottle:   { geometry: 'cylinder', size: [0.1, 0.1, 0.32] },

  // Running
  shoe:            { geometry: 'box', size: [0.7, 0.25, 0.3] },
  gpsWatch:        { geometry: 'cylinder', size: [0.13, 0.13, 0.04] },
  medal:           { geometry: 'cylinder', size: [0.18, 0.18, 0.02] },
  handheldBottle:  { geometry: 'cylinder', size: [0.08, 0.08, 0.28] },
  foamRoller:      { geometry: 'cylinder', size: [0.1, 0.1, 0.6] },
  splitShorts:     { geometry: 'box', size: [0.25, 0.04, 0.32] },
  bibSafetyPins:   { geometry: 'box', size: [0.04, 0.02, 0.04] },

  // Daily traits
  fidget:               { geometry: 'cylinder', size: [0.09, 0.09, 0.03] },
  seltzer:              { geometry: 'cylinder', size: [0.09, 0.09, 0.32] },
  begleri:              { geometry: 'cylinder', size: [0.04, 0.04, 0.12] },
  fidgetCube:           { geometry: 'box',      size: [0.1, 0.1, 0.1] },
  worryStone:           { geometry: 'sphere',   size: [0.06, 12, 12] },
  monkeyNoodle:         { geometry: 'cylinder', size: [0.025, 0.025, 0.25] },
  tangleToy:            { geometry: 'box',      size: [0.12, 0.08, 0.12] },
  sodaStreamCarbonator: { geometry: 'cylinder', size: [0.15, 0.15, 0.6] },
  co2Canister:          { geometry: 'cylinder', size: [0.06, 0.06, 0.4] },
  seltzerCan:           { geometry: 'cylinder', size: [0.09, 0.09, 0.32] },
  glassBottleTopo:      { geometry: 'cylinder', size: [0.08, 0.08, 0.32] },
  glassWithBubbles:     { geometry: 'cylinder', size: [0.08, 0.08, 0.2] },
  bottleOpener:         { geometry: 'box',      size: [0.04, 0.01, 0.2] },
};

export function getDesk3DShape(shapeId: F3PegboardShapeId): F3Desk3DPrimitive {
  return F3_DESK_3D_SHAPES[shapeId] ?? F3_DESK_3D_FALLBACK;
}

export function findDeskForm(subjectId: F3SubjectId, shape: F3PegboardShapeId): F3DeskForm | undefined {
  const subj = F3_A_DESK_SUBJECTS.find((s) => s.id === subjectId);
  if (!subj) return undefined;
  return subj.forms.find((f) => f.shape === shape);
}
