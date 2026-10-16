// web/stage-art.js — original woodcut figures for the combat stage.
//
// Figures are illustrated woodcut sprites (local WebP in web/assets/sprites/, no
// network). The backdrop and intent glyphs stay SVG with `.b` iron / `.r` rim / `.g`
// ember classes. Constant markup only: no kernel value is interpolated, so innerHTML
// stays safe. No ids, no xmlns, no external asset. Decoration only.

const svg = (body, box = '0 0 120 160') =>
  `<svg viewBox="${box}" aria-hidden="true" focusable="false">${body}</svg>`;

const shadow = (rx = 34, cx = 60) => `<ellipse class="sh" cx="${cx}" cy="152" rx="${rx}" ry="5.5"/>`;

/* Illustrated sprites (local WebP under web/assets/sprites/, keyed by stable encounter
   id). Constant markup only: the id is looked up in a fixed table, never interpolated
   raw, so innerHTML stays safe. Decoration only (alt=""). */
const SPRITES = {
  hero: 'hero', jaw_worm: 'jaw_worm', cultist: 'cultist', red_louse: 'red_louse',
  acid_slime: 'acid_slime', gremlin_nob: 'gremlin_nob', the_guardian: 'the_guardian',
};

const sprite = (key) =>
  `<span class="sh" aria-hidden="true"></span>` +
  `<img class="spr spr-${key}" src="assets/sprites/${key}.webp" alt="" draggable="false" decoding="async">`;

/** The Ashwright: hooded smith with a forge hammer, facing the enemies. */
export function heroMarkup() {
  return sprite(SPRITES.hero);
}

/** Enemy figure markup keyed by stable encounter id. */
export function enemyMarkup(id) {
  return sprite(SPRITES[id] && id !== 'hero' ? SPRITES[id] : SPRITES.jaw_worm);
}

/** Act backdrop. Only act 1 exists; the foundry is the whole climb. */
export function backdropMarkup() {
  return svg(`
    <path class="sky" d="M0 0 H800 V400 H0 Z"/>
    <path class="wall" d="M0 80 L80 40 H160 L200 70 H320 L360 30 H520 L560 64 H700 L800 28 V400 H0 Z"/>
    <path class="beam" d="M0 64 L800 40 L800 52 L0 76 Z"/>
    <path class="brick" d="M0 140 H800 M0 190 H800 M0 240 H800 M60 90 V140 M180 90 V140 M300 90 V140 M420 90 V140 M540 90 V140 M660 90 V140 M120 140 V190 M240 140 V190 M360 140 V190 M480 140 V190 M600 140 V190 M720 140 V190 M60 190 V240 M300 190 V240 M540 190 V240 M780 190 V240"/>
    <path class="chain" d="M120 0 V90 M124 0 V90 M400 0 V70 M404 0 V70 M640 0 V100"/>
    <path class="hook" d="M122 90 C116 96 118 104 126 104 M402 70 C396 76 398 84 406 84"/>
    <path class="furnace" d="M30 150 C30 120 190 120 190 150 V306 H30 Z"/>
    <path class="glow" d="M56 170 C56 152 164 152 164 170 V290 H56 Z"/>
    <path class="glow-core" d="M80 214 C96 196 124 196 140 214 V290 H80 Z"/>
    <path class="bars" d="M78 166 V290 M110 160 V290 M142 166 V290"/>
    <path class="spire" d="M690 300 L706 110 L742 110 L758 300 Z"/>
    <path class="spire-cut" d="M714 130 V290 M732 130 V290"/>
    <path class="floor" d="M0 318 C160 300 280 336 400 312 C540 286 660 330 800 304 V400 H0 Z"/>
    <path class="floor-cut" d="M40 340 L120 334 M200 346 L300 342 M460 330 L560 326 M620 344 L720 338 M80 370 L180 366 M380 372 L500 368 M600 376 L740 370"/>
    <path class="lava" d="M0 360 C120 348 200 372 320 356 C460 338 600 374 800 350"/>
  `, '0 0 800 400');
}

const GLYPHS = {
  dagger: '<path class="r" d="M16 4 L20 28 H12 Z M16 28 V40 M10 34 H22"/>',
  axe: '<path class="b" d="M8 6 H28 L24 22 H8 Z"/><path class="r" d="M8 6 H28 L24 22 H8 Z M18 22 V42"/>',
  meteor: '<circle class="b" cx="18" cy="16" r="10"/><path class="g" d="M10 14 H26"/><path class="r" d="M8 28 L14 22 M18 32 L22 22 M28 30 L24 20"/>',
  shield: '<path class="b" d="M16 4 L28 10 V20 C28 30 22 36 16 40 C10 36 4 30 4 20 V10 Z"/><path class="r" d="M16 4 L28 10 V20 C28 30 22 36 16 40 C10 36 4 30 4 20 V10 Z"/>',
  up: '<path class="r" d="M8 26 L16 10 L24 26 M10 16 L16 8 L22 16"/>',
  down: '<path class="r" d="M8 12 L16 28 L24 12 M10 22 L16 30 L22 22"/>',
  buff: '<path class="r" d="M6 28 L16 8 L26 28"/>',
};

/** Compact intent mark. `which` is dagger | axe | meteor | shield | up | down | buff. */
export function intentGlyph(which) {
  return svg(GLYPHS[which] || GLYPHS.dagger, '0 0 32 44');
}

/** Damage bracket for an attack intent. 1 dagger, 2 axe, 3 meteor. */
export function attackTier(damage) {
  const n = Number(damage) || 0;
  if (n >= 16) return 3;
  if (n >= 8) return 2;
  return 1;
}
