// web/stage-art.js — original woodcut figures for the combat stage.
//
// Woodcut layer system (all colour lives in style.css, so pose/state can retint):
//   `.sh` ground shadow, `.b` iron silhouette, `.m` gouged mid-tone (lit planes),
//   `.h` hatch cuts, `.r` rim cut (currentColor), `.k` hot highlight, `.g` ember,
//   `.e` eyes. Parts are classed (`.part-head`, `.part-body`, `.part-arm`,
//   `.part-legs`, `.part-weapon`) so CSS can pose them. Constant markup only: no
//   kernel value is interpolated, so innerHTML stays safe. No ids, no xmlns, no
//   external asset. Decoration only.

const svg = (body, box = '0 0 120 160') =>
  `<svg viewBox="${box}" aria-hidden="true" focusable="false">${body}</svg>`;

const shadow = (rx = 34, cx = 60) => `<ellipse class="sh" cx="${cx}" cy="152" rx="${rx}" ry="5.5"/>`;

/** The Ashwright: hooded smith with a forge hammer, facing the enemies. */
export function heroMarkup() {
  return svg(`
    ${shadow(30, 58)}
    <g class="part-cape">
      <path class="b" d="M38 50 C26 74 22 108 26 140 L36 134 L40 146 L48 132 L50 92 Z"/>
      <path class="h" d="M30 92 L40 88 M28 104 L42 100 M28 116 L44 112 M30 128 L44 124"/>
      <path class="r" d="M38 50 C26 74 22 108 26 140 L36 134 L40 146"/>
    </g>
    <g class="part-legs">
      <path class="b" d="M46 108 L38 146 L54 148 L58 112 Z M64 108 L74 144 L90 148 L78 106 Z"/>
      <path class="m" d="M47 116 L42 142 L46 142 L50 118 Z M67 116 L76 142 L80 142 L71 114 Z"/>
      <path class="r" d="M38 146 L54 148 M74 144 L90 148"/>
      <path class="h" d="M50 128 L56 126 M74 126 L80 124"/>
    </g>
    <g class="part-body">
      <path class="b" d="M42 52 C34 70 38 98 46 114 H80 C88 96 90 72 82 52 L70 44 H52 Z"/>
      <path class="m" d="M44 60 C40 76 42 96 48 110 L54 110 C50 94 48 76 50 62 Z"/>
      <path class="ap" d="M52 66 H76 L80 112 H48 Z"/>
      <path class="h" d="M66 72 L76 70 M68 80 L78 78 M68 88 L78 86 M68 96 L79 94 M68 104 L79 102"/>
      <path class="r apron" d="M52 66 H76 L80 112 H48"/>
      <path class="g" d="M58 80 L62 74 L66 82 L62 92 L56 88 Z"/>
      <path class="k" d="M61 79 L62 76 L63 82 L61 86 Z"/>
    </g>
    <g class="part-head">
      <path class="b" d="M44 36 C42 18 58 8 72 12 C84 16 88 30 84 42 L80 52 H50 Z"/>
      <path class="m" d="M48 34 C48 22 56 15 64 14 C56 20 52 28 52 40 Z"/>
      <path class="b" d="M62 26 C70 24 80 28 82 38 C78 44 68 46 62 42 Z"/>
      <path class="e" d="M70 33 L78 32 L77 35 L70 35.5 Z"/>
      <path class="r" d="M44 36 C42 18 58 8 72 12 C84 16 88 30 84 42"/>
      <path class="h" d="M48 44 L56 46 M50 48 L58 50"/>
    </g>
    <g class="part-arm">
      <path class="b" d="M70 56 C80 54 90 50 96 42 L104 48 C98 60 86 68 74 70 Z"/>
      <path class="m" d="M74 58 C82 57 90 52 95 46 L97 48 C92 55 84 60 75 62 Z"/>
      <path class="b" d="M96 38 L106 42 L104 52 L94 50 Z"/>
      <path class="r" d="M104 48 C98 60 86 68 74 70"/>
    </g>
    <g class="part-weapon">
      <path class="b" d="M99 46 L106 4 L111 5 L104 47 Z"/>
      <path class="b" d="M92 2 L122 8 L119 26 L89 20 Z"/>
      <path class="m" d="M93 5 L120 10 L119 14 L92 9 Z"/>
      <path class="h" d="M96 14 L95 19 M102 15 L101 21 M108 16 L107 22 M114 17 L113 23"/>
      <path class="r" d="M92 2 L122 8 L119 26 L89 20 Z"/>
      <path class="g" d="M118 10 L116 24"/>
    </g>
  `);
}

const FIGURES = {
  // Cinder Maw: a hunched furnace-worm, a burning gullet for a face.
  jaw_worm: `
    ${shadow(42)}
    <g class="part-body">
      <path class="b" d="M14 104 C6 74 24 42 56 36 C92 30 114 58 108 98 C104 128 74 140 46 136 C30 134 18 122 14 104 Z"/>
      <path class="m" d="M60 42 C84 40 102 58 102 84 C96 66 82 52 60 48 Z"/>
      <path class="h" d="M70 100 L96 92 M72 110 L98 102 M70 120 L94 112 M60 128 L84 124"/>
      <path class="h" d="M78 58 C86 64 90 72 92 80 M66 54 C74 60 80 68 82 78"/>
      <path class="r" d="M108 98 C104 128 74 140 46 136"/>
    </g>
    <g class="part-head">
      <path class="b" d="M8 78 C14 58 40 54 54 70 C50 92 26 104 10 96 Z"/>
      <path class="g" d="M14 80 C22 70 38 70 46 78 C40 88 24 92 14 86 Z"/>
      <path class="k" d="M20 80 C26 76 34 76 38 80 C32 84 26 84 20 82 Z"/>
      <path class="r" d="M14 80 L18 74 L21 81 L25 72 L28 80 L32 71 L35 79 L40 73 L42 80 M16 86 L20 92 L23 86 L27 94 L30 87 L35 93 L37 86"/>
      <path class="e" d="M40 60 L48 58 L46 62 Z"/>
    </g>
    <g class="part-legs">
      <path class="b" d="M30 128 L22 150 H32 L40 132 Z M62 134 L60 152 H70 L72 134 Z M88 122 L100 150 H110 L96 118 Z"/>
      <path class="r" d="M22 150 H32 M60 152 H70 M100 150 H110"/>
    </g>`,
  // Ash Cantor: a robed chanter in a crucible mask, staff crowned with fire.
  cultist: `
    ${shadow(34)}
    <g class="part-body">
      <path class="b" d="M38 46 C30 70 24 104 18 146 H100 C94 104 88 70 82 46 C70 56 50 56 38 46 Z"/>
      <path class="m" d="M40 54 C34 78 30 110 26 142 H34 C36 110 40 80 46 58 Z"/>
      <path class="h" d="M66 70 L66 140 M74 66 L78 140 M82 74 L88 140"/>
      <path class="r" d="M18 146 H100 M60 56 V144"/>
      <path class="g" d="M52 74 L60 66 L68 74 L60 82 Z"/>
    </g>
    <g class="part-head">
      <path class="b" d="M42 14 L60 4 L78 14 L82 50 H38 Z"/>
      <path class="m" d="M45 16 L60 8 L58 46 H42 Z"/>
      <path class="e" d="M48 28 L56 30 L55 33 L48 32 Z M64 30 L72 28 L72 32 L65 33 Z"/>
      <path class="r" d="M42 14 L60 4 L78 14 L82 50 H38 Z M50 40 H70"/>
    </g>
    <g class="part-arm">
      <path class="b" d="M80 60 L96 72 L92 80 L76 70 Z"/>
    </g>
    <g class="part-weapon">
      <path class="b" d="M92 46 L96 46 L98 148 L94 148 Z"/>
      <path class="r" d="M90 50 C86 40 90 32 94 26 C98 32 102 40 98 50 Z"/>
      <path class="g" d="M94 30 C92 36 92 42 94 46 C96 42 97 36 94 30 Z"/>
      <path class="k" d="M94 36 L95 44 L93 44 Z"/>
    </g>`,
  // Kiln Mite: a cracked coal-shell tick, embers between the plates.
  red_louse: `
    ${shadow(38)}
    <g class="part-legs">
      <path class="r" d="M30 108 L12 118 L8 138 M38 118 L26 134 L24 150 M82 118 L94 134 L96 150 M90 108 L108 118 L112 138"/>
    </g>
    <g class="part-body">
      <path class="b" d="M60 44 C26 44 14 80 20 106 C26 132 94 132 100 106 C106 80 94 44 60 44 Z"/>
      <path class="g" d="M40 62 L46 80 L36 98 M60 50 L62 76 L56 104 M80 62 L74 82 L84 98"/>
      <path class="m" d="M30 68 C38 54 50 50 58 50 L40 64 C36 72 32 78 30 86 Z"/>
      <path class="h" d="M70 100 L90 94 M66 110 L88 106 M60 118 L82 116"/>
      <path class="r" d="M20 106 C26 132 94 132 100 106"/>
    </g>
    <g class="part-head">
      <path class="b" d="M42 46 C44 32 76 32 78 46 C70 52 50 52 42 46 Z"/>
      <path class="r" d="M46 38 L36 24 M74 38 L84 24"/>
      <path class="e" d="M50 42 a3 3 0 1 0 0.1 0 Z M70 42 a3 3 0 1 0 0.1 0 Z"/>
    </g>`,
  // Slag Ooze: molten runoff with a crust, dripping and pooling.
  acid_slime: `
    <ellipse class="sh" cx="60" cy="150" rx="46" ry="6"/>
    <g class="part-body">
      <path class="b" d="M14 146 C10 116 20 70 40 52 C54 38 72 36 86 50 C104 68 112 116 106 146 C96 152 84 148 76 150 C66 154 56 148 46 152 C36 154 24 150 14 146 Z"/>
      <path class="g" d="M30 120 C40 104 56 98 66 106 C58 112 54 124 60 136 C48 140 34 134 30 120 Z"/>
      <path class="k" d="M40 120 C46 112 54 110 58 112 C52 116 48 124 50 130 C44 130 40 126 40 120 Z"/>
      <path class="m" d="M42 58 C52 48 66 46 76 52 C64 54 54 60 46 70 Z"/>
      <path class="h" d="M78 74 L98 82 M80 86 L102 94 M82 98 L104 106 M84 110 L104 118"/>
      <path class="r" d="M14 146 C24 150 36 154 46 152 C56 148 66 154 76 150 C84 148 96 152 106 146 M40 52 C54 38 72 36 86 50"/>
      <path class="e" d="M52 74 L60 72 L59 76 Z M70 72 L78 74 L71 76 Z"/>
    </g>`,
  // Cinder Brute (elite): a hulking stoker with a riveted bellows mask and a coal shovel.
  gremlin_nob: `
    ${shadow(44)}
    <g class="part-legs">
      <path class="b" d="M34 110 H54 L52 150 H28 Z M68 110 H88 L96 150 H70 Z"/>
      <path class="m" d="M36 116 L32 146 H38 L41 116 Z M71 116 L74 146 H80 L76 116 Z"/>
      <path class="r" d="M28 150 H52 M70 150 H96"/>
    </g>
    <g class="part-body">
      <path class="b" d="M18 54 C26 40 94 40 102 54 L96 114 H24 Z"/>
      <path class="m" d="M24 56 C30 48 42 46 52 46 L40 60 L32 108 H28 Z"/>
      <path class="h" d="M70 60 L92 56 M70 70 L94 66 M70 80 L94 76 M70 90 L94 86 M70 100 L94 96"/>
      <path class="r" d="M24 114 H96 M44 82 H76"/>
      <circle class="g" cx="44" cy="68" r="2"/><circle class="g" cx="76" cy="68" r="2"/><circle class="g" cx="44" cy="96" r="2"/><circle class="g" cx="76" cy="96" r="2"/>
    </g>
    <g class="part-head">
      <path class="b" d="M38 20 H82 L88 50 H32 Z"/>
      <path class="b" d="M26 26 L40 14 L42 28 Z M94 26 L80 14 L78 28 Z"/>
      <path class="m" d="M40 22 H54 L48 48 H35 Z"/>
      <path class="e" d="M46 32 H56 L55 36 H46 Z M64 32 H74 V36 H65 Z"/>
      <path class="r" d="M38 20 H82 L88 50 H32 Z M50 42 H70 M54 42 V48 M60 42 V48 M66 42 V48"/>
    </g>
    <g class="part-weapon">
      <path class="b" d="M98 50 L104 50 L106 112 L100 112 Z"/>
      <path class="b" d="M92 108 H116 L112 136 H96 Z"/>
      <path class="g" d="M98 120 H110"/>
      <path class="r" d="M92 108 H116 L112 136 H96 Z"/>
    </g>`,
  // Slag Warden (boss): a crowned cauldron-colossus, a furnace door for a heart.
  the_guardian: `
    ${shadow(50)}
    <g class="part-legs">
      <path class="b" d="M28 114 H50 L48 150 H20 Z M70 114 H92 L100 150 H72 Z"/>
      <path class="m" d="M30 120 L24 146 H31 L35 120 Z M73 120 L76 146 H83 L79 120 Z"/>
      <path class="r" d="M20 150 H48 M72 150 H100"/>
    </g>
    <g class="part-weapon">
      <path class="b" d="M2 52 L24 46 L30 104 L6 108 Z"/>
      <path class="m" d="M5 55 L22 50 L23 56 L6 60 Z"/>
      <path class="h" d="M10 70 L26 66 M10 80 L27 76 M11 90 L28 86"/>
      <path class="r" d="M2 52 L24 46 L30 104 L6 108 Z"/>
      <path class="g" d="M14 62 L18 98"/>
    </g>
    <g class="part-body">
      <path class="b" d="M18 50 C24 36 96 36 102 50 L108 118 H12 Z"/>
      <path class="m" d="M22 52 C28 44 40 42 50 42 L34 56 L24 114 H17 Z"/>
      <path class="h" d="M78 54 L100 50 M78 64 L102 60 M80 74 L104 70 M80 84 L104 80 M80 94 L106 90 M80 104 L106 100"/>
      <path class="b" d="M44 62 H76 V100 H44 Z"/>
      <path class="g" d="M48 70 H72 V96 H48 Z"/>
      <path class="k" d="M52 82 C56 76 64 76 68 82 C64 90 56 90 52 82 Z"/>
      <path class="r" d="M44 62 H76 V100 H44 Z M44 76 H76 M54 62 V100 M66 62 V100 M12 118 H108"/>
    </g>
    <g class="part-head">
      <path class="b" d="M38 18 H82 L88 44 H32 Z"/>
      <path class="b" d="M34 18 L38 2 L46 14 L54 0 L60 12 L66 0 L74 14 L82 2 L86 18 Z"/>
      <path class="g" d="M38 2 L46 14 M54 0 L60 12 L66 0 M82 2 L74 14"/>
      <path class="m" d="M40 20 H52 L46 42 H36 Z"/>
      <path class="e" d="M46 28 H58 L56 33 H46 Z M64 28 H76 V33 H66 Z"/>
      <path class="r" d="M38 18 H82 L88 44 H32 Z"/>
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
