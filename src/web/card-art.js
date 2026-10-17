// src/web/card-art.js — one woodcut illustration per card id (42), drawn in the same
// three-layer system as the enemies: `.b` iron body, `.r` rim line (currentColor =
// card-type hue), `.g` ember glow, `.gc` glowing crack. viewBox 0 0 60 40.
// Constant markup only: no kernel value or user input is ever interpolated, so it is
// safe for innerHTML. Decoration only — no rule, number or legality lives here.
// No xmlns attribute on purpose (the HTML parser namespaces inline <svg> itself).

const blade = (x, y, a) => `<g transform="translate(${x} ${y}) rotate(${a})"><path class="b" d="M-2 6 L-1.6 -18 L0 -22 L1.6 -18 L2 6 Z"/><path class="r" d="M-2 6 L-1.6 -18 L0 -22 L1.6 -18 L2 6 Z M-6 6 H6 M0 6 V12"/><circle class="g" cx="0" cy="13" r="1.4"/></g>`;
const shield = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path class="b" d="M0 -14 L11 -10 V0 C11 7 6 11 0 14 C-6 11 -11 7 -11 0 V-10 Z"/><path class="r" d="M0 -14 L11 -10 V0 C11 7 6 11 0 14 C-6 11 -11 7 -11 0 V-10 Z M0 -9 V10 M-7 -2 H7"/></g>`;
const fist = (x, y, a = 0) => `<g transform="translate(${x} ${y}) rotate(${a})"><path class="b" d="M-8 -6 H6 C9 -6 9 6 6 6 H-8 Z"/><path class="r" d="M-8 -6 H6 C9 -6 9 6 6 6 H-8 Z M-3 -6 V0 M1 -6 V0 M-8 -2 H-12 M-8 3 H-14"/></g>`;
const flame = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path class="b" d="M0 10 C-8 6 -6 -2 -1 -10 C0 -4 4 -4 3 -9 C9 -3 9 6 0 10 Z"/><path class="r" d="M0 10 C-8 6 -6 -2 -1 -10 C0 -4 4 -4 3 -9 C9 -3 9 6 0 10 Z"/><path class="g" d="M0 8 C-3 5 -2 1 0 -3 C1 1 4 3 0 8 Z"/></g>`;
const heart = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path class="b" d="M0 9 C-12 0 -9 -10 -3 -9 C-1 -9 0 -7 0 -6 C0 -7 1 -9 3 -9 C9 -10 12 0 0 9 Z"/><path class="r" d="M0 9 C-12 0 -9 -10 -3 -9 C-1 -9 0 -7 0 -6 C0 -7 1 -9 3 -9 C9 -10 12 0 0 9 Z"/></g>`;
const ground = '<path class="r" d="M4 36 H56" opacity="0.5"/>';
const sparks = (pts) => pts.map(([x, y]) => `<circle class="g" cx="${x}" cy="${y}" r="1"/>`).join('');
const rays = (x, y, r1, r2, n, off = 0) => { let d = ''; for (let i = 0; i < n; i++) { const t = off + (i * Math.PI * 2) / n; d += `M${(x + r1 * Math.cos(t)).toFixed(1)} ${(y + r1 * Math.sin(t)).toFixed(1)} L${(x + r2 * Math.cos(t)).toFixed(1)} ${(y + r2 * Math.sin(t)).toFixed(1)} `; } return `<path class="r" d="${d}"/>`; };

export const CARD_ART = {
  strike: blade(30, 24, 35) + '<path class="gc" d="M14 30 L44 8"/>',
  defend: shield(30, 20, 1.1) + ground,
  bash: '<path class="b" d="M18 8 H34 V20 H18 Z"/><path class="r" d="M18 8 H34 V20 H18 Z M26 20 V36"/>' + rays(42, 26, 4, 10, 6) + '<path class="gc" d="M38 30 L44 24 L41 22 L48 18"/>',
  anger: '<path class="b" d="M14 30 L22 10 L30 22 L38 8 L46 30 Z"/><path class="r" d="M14 30 L22 10 L30 22 L38 8 L46 30 Z"/><path class="g" d="M22 24 l5 2 -5 2z M38 24 l-5 2 5 2z"/>' + ground,
  cleave: '<path class="b" d="M10 20 C20 6 40 6 50 20 C40 14 20 14 10 20 Z"/><path class="r" d="M10 20 C20 6 40 6 50 20 C40 14 20 14 10 20 Z"/><path class="gc" d="M8 26 C22 16 38 16 52 26"/>' + sparks([[10, 30], [50, 30], [30, 32]]),
  clothesline: '<path class="r" d="M6 22 H54"/>' + fist(30, 22) + '<path class="gc" d="M8 16 H20 M8 28 H20"/>',
  headbutt: '<circle class="b" cx="22" cy="20" r="10"/><circle class="r" cx="22" cy="20" r="10"/><path class="r" d="M34 8 V32"/>' + rays(33, 20, 3, 8, 5, -1.2) + '<circle class="g" cx="19" cy="18" r="1.5"/>',
  ironwave: shield(20, 20, 0.85) + '<path class="r" d="M30 26 C36 18 42 34 48 24 C52 18 54 22 56 20"/><path class="gc" d="M30 30 C36 22 42 38 48 28"/>',
  pommel: blade(30, 26, 180) + '<circle class="g" cx="30" cy="12" r="3"/>' + rays(30, 12, 5, 9, 6),
  sword_boomerang: '<path class="r" d="M10 30 C10 6 50 6 50 30" stroke-dasharray="3 3"/>' + blade(14, 26, -30) + blade(30, 14, 45) + blade(46, 26, 120),
  thunderclap: '<path class="b" d="M28 4 L20 20 H28 L22 36 L40 16 H31 L36 4 Z"/><path class="r" d="M28 4 L20 20 H28 L22 36 L40 16 H31 L36 4 Z"/><path class="r" d="M8 30 C12 26 16 26 18 30 M42 30 C46 26 50 26 52 30"/>',
  twin_strike: blade(24, 24, 25) + blade(36, 24, -25) + sparks([[30, 6]]),
  wild_strike: blade(30, 24, 60) + '<path class="gc" d="M10 10 L20 16 L14 20 L26 28 M42 8 L48 14 M44 30 L52 26"/>',
  flex: '<path class="b" d="M14 32 C14 20 20 14 28 16 C30 10 38 8 42 14 C46 20 40 26 34 24 L30 32 Z"/><path class="r" d="M14 32 C14 20 20 14 28 16 C30 10 38 8 42 14 C46 20 40 26 34 24 L30 32 Z"/><path class="r" d="M46 8 L50 4 M48 14 H54"/>',
  shrug: shield(30, 22, 0.9) + '<path class="r" d="M10 14 C14 8 18 8 20 12 M50 14 C46 8 42 8 40 12"/>' + sparks([[12, 26], [48, 26]]),
  true_grit: '<path class="b" d="M14 34 L20 14 L30 22 L40 10 L46 34 Z"/><path class="r" d="M14 34 L20 14 L30 22 L40 10 L46 34 Z"/><path class="gc" d="M24 34 L28 26 L32 30 L36 22"/>',
  warcry: '<path class="b" d="M12 16 H20 L30 8 V32 L20 24 H12 Z"/><path class="r" d="M12 16 H20 L30 8 V32 L20 24 H12 Z"/><path class="r" d="M36 14 C40 18 40 22 36 26 M42 10 C48 16 48 24 42 30 M48 6 C56 14 56 26 48 34"/>',
  armaments: '<path class="b" d="M14 28 H46 L42 34 H18 Z"/><path class="r" d="M14 28 H46 L42 34 H18 Z M30 28 V20"/>' + '<path class="b" d="M24 12 H38 V20 H24 Z"/><path class="r" d="M24 12 H38 V20 H24 Z M38 14 L44 10"/>' + sparks([[18, 22], [44, 20], [48, 24]]),
  havoc: '<rect class="b" x="18" y="8" width="16" height="22" rx="2" transform="rotate(-12 26 19)"/><rect class="r" x="18" y="8" width="16" height="22" rx="2" transform="rotate(-12 26 19)"/><rect class="b" x="28" y="10" width="16" height="22" rx="2" transform="rotate(14 36 21)"/><rect class="r" x="28" y="10" width="16" height="22" rx="2" transform="rotate(14 36 21)"/>' + flame(36, 21, 0.6),
  battle_trance: '<circle class="r" cx="30" cy="20" r="14"/><circle class="r" cx="30" cy="20" r="8"/><circle class="g" cx="30" cy="20" r="3"/><path class="r" d="M30 2 V6 M30 34 V38 M12 20 H16 M44 20 H48"/>',
  bloodletting: '<path class="b" d="M30 6 C38 18 40 24 40 28 C40 34 35 37 30 37 C25 37 20 34 20 28 C20 24 22 18 30 6 Z"/><path class="r" d="M30 6 C38 18 40 24 40 28 C40 34 35 37 30 37 C25 37 20 34 20 28 C20 24 22 18 30 6 Z"/><path class="g" d="M26 28 C26 25 28 22 30 20 C30 24 33 26 30 31 Z"/>' + blade(46, 22, -40),
  carnage: blade(20, 24, -20) + blade(40, 24, 20) + '<path class="gc" d="M8 34 L18 28 M52 34 L42 28 M30 36 V30"/>' + sparks([[30, 6], [24, 10], [36, 10]]),
  combust: flame(30, 20, 1.5) + rays(30, 20, 15, 19, 8),
  dark_embrace: '<path class="b" d="M8 30 C14 10 46 10 52 30 C44 22 16 22 8 30 Z"/><path class="r" d="M8 30 C14 10 46 10 52 30 C44 22 16 22 8 30 Z"/><circle class="g" cx="30" cy="24" r="3"/><path class="r" d="M22 32 C26 28 34 28 38 32"/>',
  dropkick: '<path class="b" d="M12 12 L30 22 L44 20 L48 26 L30 28 L10 18 Z"/><path class="r" d="M12 12 L30 22 L44 20 L48 26 L30 28 L10 18 Z"/>' + rays(50, 24, 3, 8, 5, -1.5),
  entrench: '<path class="b" d="M8 34 V24 L16 20 V14 H24 V20 H36 V14 H44 V20 L52 24 V34 Z"/><path class="r" d="M8 34 V24 L16 20 V14 H24 V20 H36 V14 H44 V20 L52 24 V34 Z M8 28 H52"/>',
  feel_no_pain: heart(30, 20, 1.3) + '<path class="r" d="M14 8 L46 32" opacity="0.6"/>' + '<path class="gc" d="M24 18 L28 22 L34 16"/>',
  flame_barrier: shield(30, 22, 0.9) + flame(14, 22, 0.8) + flame(46, 22, 0.8) + flame(30, 6, 0.6),
  ghostly_armor: '<path class="b" d="M18 36 V16 C18 8 42 8 42 16 V36 L37 32 L33 36 L30 32 L27 36 L23 32 Z" opacity="0.7"/><path class="r" d="M18 36 V16 C18 8 42 8 42 16 V36 L37 32 L33 36 L30 32 L27 36 L23 32 Z" stroke-dasharray="2 2"/><circle class="g" cx="25" cy="18" r="1.6"/><circle class="g" cx="35" cy="18" r="1.6"/>',
  hemokinesis: heart(22, 20, 0.9) + '<path class="gc" d="M32 20 C38 14 44 26 52 18"/><path class="r" d="M48 14 L53 18 L48 22"/>',
  inflame: flame(30, 22, 1.2) + '<path class="r" d="M18 34 H42"/>' + sparks([[18, 10], [42, 8], [46, 16]]),
  metallicize: '<path class="b" d="M14 10 H46 V30 H14 Z"/><path class="r" d="M14 10 H46 V30 H14 Z M14 20 H46 M30 10 V30"/><circle class="g" cx="18" cy="14" r="1.2"/><circle class="g" cx="42" cy="14" r="1.2"/><circle class="g" cx="18" cy="26" r="1.2"/><circle class="g" cx="42" cy="26" r="1.2"/>',
  pummel: fist(18, 12) + fist(24, 22) + fist(30, 32, 0) + rays(44, 22, 3, 9, 5, -1.4),
  rampage: '<path class="b" d="M8 30 C10 18 18 14 26 16 L34 10 L38 18 C46 18 52 24 52 30 Z"/><path class="r" d="M8 30 C10 18 18 14 26 16 L34 10 L38 18 C46 18 52 24 52 30 Z M26 16 L22 8 M34 10 L38 4"/><circle class="g" cx="42" cy="24" r="1.6"/><path class="gc" d="M4 36 H56"/>',
  rupture: '<path class="b" d="M14 6 H46 V34 H14 Z"/><path class="r" d="M14 6 H46 V34 H14 Z"/><path class="gc" d="M30 6 L26 14 L34 20 L28 28 L32 34"/>' + sparks([[22, 20], [40, 14]]),
  shockwave: '<circle class="g" cx="30" cy="22" r="3"/><path class="r" d="M22 22 A8 8 0 0 1 38 22 M16 22 A14 14 0 0 1 44 22 M10 22 A20 20 0 0 1 50 22"/>' + ground,
  uppercut: fist(30, 26, -90) + '<path class="r" d="M30 14 V4 M24 10 L30 4 L36 10"/>' + sparks([[22, 6], [38, 6]]),
  bludgeon: '<path class="b" d="M18 6 H42 V18 H18 Z"/><path class="r" d="M18 6 H42 V18 H18 Z M30 18 V30 M22 6 V18 M38 6 V18"/><path class="gc" d="M10 36 L20 30 L30 36 L40 30 L50 36"/>',
  impervious: shield(30, 20, 1.3) + '<path class="r" d="M8 20 H14 M46 20 H52"/><circle class="g" cx="30" cy="20" r="2"/>',
  limit_break: '<path class="b" d="M20 34 V14 H40 V34 Z"/><path class="r" d="M20 34 V14 H40 V34 M14 14 H46"/><path class="gc" d="M30 34 V6 M24 12 L30 6 L36 12"/>' + rays(30, 6, 3, 7, 6),
  offering: '<path class="b" d="M16 26 H44 L40 34 H20 Z"/><path class="r" d="M16 26 H44 L40 34 H20 Z"/>' + heart(30, 16, 0.7) + rays(30, 16, 9, 13, 6, -1.57),
  reaper: '<path class="r" d="M18 36 L36 4"/><path class="b" d="M36 4 C48 6 52 16 48 22 C46 14 40 10 33 10 Z"/><path class="r" d="M36 4 C48 6 52 16 48 22 C46 14 40 10 33 10 Z"/><path class="gc" d="M10 20 C16 24 22 24 26 20"/>' + sparks([[14, 30], [24, 30]]),
};

/** Markup for a card id, or null when the id has no drawing (renderer falls back). */
export function cardArtMarkup(id) {
  const body = CARD_ART[id];
  return body ? `<svg viewBox="0 0 60 40" aria-hidden="true" focusable="false">${body}</svg>` : null;
}
