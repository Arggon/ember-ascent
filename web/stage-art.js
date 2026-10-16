// web/stage-art.js — original woodcut figures for the combat stage.
//
// Same three-layer system as the cards: `.b` iron body, `.r` rim (currentColor),
// `.g` ember. Parts are classed (`.part-head`, `.part-body`, `.part-arm`,
// `.part-legs`, `.part-weapon`) so CSS can pose them. Constant markup only: no
// kernel value is interpolated, so innerHTML stays safe. No xmlns, no external
// asset. Decoration only.

const svg = (body, box = '0 0 120 160') =>
  `<svg viewBox="${box}" aria-hidden="true" focusable="false">${body}</svg>`;

/** The Ashwright, side view, facing the enemies. */
export function heroMarkup() {
  return svg(`
    <g class="part-legs">
      <path class="b" d="M46 108 L40 148 H52 L56 112 Z"/>
      <path class="b" d="M62 108 L70 146 H84 L72 108 Z"/>
      <path class="r" d="M46 108 L40 148 H52 L56 112 Z M62 108 L70 146 H84 L72 108 Z"/>
    </g>
    <g class="part-body">
      <path class="b" d="M40 58 C38 78 42 100 50 112 H74 C86 98 88 74 82 56 L70 48 H48 Z"/>
      <path class="r" d="M40 58 C38 78 42 100 50 112 H74 C86 98 88 74 82 56 L70 48 H48 Z M48 78 H78"/>
      <path class="g" d="M58 70 L64 86 L54 92"/>
    </g>
    <g class="part-head">
      <path class="b" d="M48 28 C48 14 78 12 82 30 C86 44 74 52 60 50 C48 48 46 38 48 28 Z"/>
      <path class="r" d="M48 28 C48 14 78 12 82 30 C86 44 74 52 60 50 C48 48 46 38 48 28 Z M56 34 H76"/>
      <path class="g" d="M70 32 H78"/>
    </g>
    <g class="part-arm">
      <path class="b" d="M74 62 L98 54 L104 64 L80 74 Z"/>
      <path class="r" d="M74 62 L98 54 L104 64 L80 74 Z"/>
    </g>
    <g class="part-weapon">
      <path class="b" d="M96 28 H118 V48 H96 Z"/>
      <path class="r" d="M96 28 H118 V48 H96 Z M104 48 V64"/>
      <path class="g" d="M100 34 H114"/>
    </g>
  `);
}

const FIGURES = {
  jaw_worm: `
    <g class="part-body">
      <path class="b" d="M18 96 C10 70 28 40 58 36 C96 30 112 62 104 96 C96 124 40 128 18 96 Z"/>
      <path class="r" d="M18 96 C10 70 28 40 58 36 C96 30 112 62 104 96 C96 124 40 128 18 96 Z"/>
      <path class="g" d="M70 70 C78 78 74 92 62 90 C70 84 66 74 70 70 Z"/>
    </g>
    <g class="part-head">
      <path class="r" d="M28 78 C40 60 62 58 74 74"/>
      <path class="b" d="M34 84 L48 74 L58 86 L42 94 Z"/>
      <path class="r" d="M34 84 L48 74 L58 86 L42 94 Z"/>
    </g>
    <g class="part-legs">
      <path class="r" d="M36 118 L28 146 M58 122 L54 148 M86 116 L96 146"/>
    </g>`,
  cultist: `
    <g class="part-body">
      <path class="b" d="M36 46 L28 128 H92 L80 46 C70 58 48 58 36 46 Z"/>
      <path class="r" d="M36 46 L28 128 H92 L80 46 C70 58 48 58 36 46 Z"/>
    </g>
    <g class="part-head">
      <path class="b" d="M44 28 H76 L82 52 H38 Z"/>
      <path class="r" d="M44 28 H76 L82 52 H38 Z M50 40 H70"/>
      <circle class="g" cx="60" cy="38" r="3"/>
    </g>
    <g class="part-weapon">
      <path class="r" d="M86 70 V130"/>
      <circle class="g" cx="86" cy="64" r="6"/>
    </g>`,
  red_louse: `
    <g class="part-body">
      <path class="b" d="M60 40 C28 40 16 78 22 108 C28 136 92 136 98 108 C104 78 92 40 60 40 Z"/>
      <path class="r" d="M60 40 C28 40 16 78 22 108 C28 136 92 136 98 108 C104 78 92 40 60 40 Z M30 84 H90"/>
      <circle class="g" cx="46" cy="70" r="3"/>
      <circle class="g" cx="74" cy="66" r="2.4"/>
    </g>
    <g class="part-legs">
      <path class="r" d="M34 112 L18 132 M46 124 L40 148 M74 124 L80 148 M90 112 L104 132"/>
    </g>`,
  acid_slime: `
    <g class="part-body">
      <path class="b" d="M24 100 C16 60 36 36 60 40 C92 28 112 64 100 104 C92 136 36 140 24 100 Z"/>
      <path class="r" d="M24 100 C16 60 36 36 60 40 C92 28 112 64 100 104 C92 136 36 140 24 100 Z"/>
      <path class="g" d="M48 78 C58 70 70 78 66 90 C58 84 50 88 48 78 Z"/>
      <path class="r" d="M40 118 C48 128 40 140 34 146 M78 120 C86 132 80 144 88 150"/>
    </g>`,
  gremlin_nob: `
    <g class="part-legs">
      <path class="b" d="M40 108 H54 L50 148 H34 Z M68 108 H84 L92 148 H74 Z"/>
      <path class="r" d="M40 108 H54 L50 148 H34 Z M68 108 H84 L92 148 H74 Z"/>
    </g>
    <g class="part-body">
      <path class="b" d="M32 52 H88 L96 112 H28 Z"/>
      <path class="r" d="M32 52 H88 L96 112 H28 Z M40 74 H84"/>
      <path class="g" d="M48 64 H72"/>
    </g>
    <g class="part-head">
      <path class="b" d="M36 24 H84 L90 52 H30 Z"/>
      <path class="r" d="M36 24 H84 L90 52 H30 Z M28 30 L40 22 M92 30 L80 22"/>
      <path class="g" d="M46 38 H58 M68 38 H78"/>
    </g>
    <g class="part-weapon">
      <path class="b" d="M90 70 H114 V84 H90 Z"/>
      <path class="r" d="M90 70 H114 V84 H90 Z M96 84 V108"/>
    </g>`,
  the_guardian: `
    <g class="part-legs">
      <path class="b" d="M34 112 H52 V150 H30 Z M70 112 H90 V150 H66 Z"/>
      <path class="r" d="M34 112 H52 V150 H30 Z M70 112 H90 V150 H66 Z"/>
    </g>
    <g class="part-body">
      <path class="b" d="M26 48 H96 L104 116 H22 Z"/>
      <path class="r" d="M26 48 H96 L104 116 H22 Z M26 78 H104 M48 48 V116 M74 48 V116"/>
      <path class="g" d="M58 62 H70 L64 78 Z"/>
    </g>
    <g class="part-head">
      <path class="b" d="M34 16 H88 L94 48 H28 Z"/>
      <path class="r" d="M34 16 H88 L94 48 H28 Z M22 22 L36 14 M98 22 L86 14"/>
      <path class="g" d="M44 32 H78"/>
    </g>
    <g class="part-weapon">
      <path class="b" d="M8 58 H30 V100 H8 Z"/>
      <path class="r" d="M8 58 H30 V100 H8 Z M8 72 H30"/>
    </g>`,
};

/** Enemy figure markup keyed by stable encounter id. */
export function enemyMarkup(id) {
  return svg(FIGURES[id] || FIGURES.jaw_worm);
}

/** Act backdrop. Only act 1 exists; the foundry is the whole climb. */
export function backdropMarkup() {
  return svg(`
    <path class="sky" d="M0 0 H800 V400 H0 Z"/>
    <path class="wall" d="M0 80 L80 40 H160 L200 70 H320 L360 30 H520 L560 64 H700 L800 28 V400 H0 Z"/>
    <path class="chain" d="M120 0 V90 M124 0 V90 M400 0 V70 M404 0 V70 M640 0 V100"/>
    <path class="furnace" d="M40 160 H180 V300 H40 Z"/>
    <path class="glow" d="M58 188 H162 V280 H58 Z"/>
    <path class="spire" d="M700 120 L724 40 L748 120 Z"/>
    <path class="floor" d="M0 318 C160 300 280 336 400 312 C540 286 660 330 800 304 V400 H0 Z"/>
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
