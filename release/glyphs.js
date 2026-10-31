// src/web/glyphs.js — every inline-SVG mark, and the tables that map kernel names to them.
//
// Every mark is inline SVG built from the static table below and injected into a span.
// Two deliberate properties worth stating:
//   * the markup is 100% constant — no kernel value and no user input is ever
//     interpolated into it, which is what makes innerHTML safe here;
//   * the <svg> element carries no `xmlns` attribute, because the HTML parser places
//     it in the SVG namespace on its own. That keeps this file free of any URL-shaped
//     string at all, so an "no external asset" grep over src/web/ can be trusted.
// Anything unknown falls back to a rune, so a new enemy or node type in the kernel
// renders as a generic shape rather than an empty box.
//
// The table is named MARKS (not GLYPHS) because src/web/stage-art.js keeps its own
// private intent-glyph table of that name — the two must stay distinct when tests
// concatenate the web modules into one scope.

import { el } from './dom.js';

/* ------------------------------------------------------------------------ glyphs */
//
// Every mark is inline SVG built from the static table below and injected into a span.
// Two deliberate properties worth stating:
//   * the markup is 100% constant — no kernel value and no user input is ever
//     interpolated into it, which is what makes innerHTML safe here;
//   * the <svg> element carries no `xmlns` attribute, because the HTML parser places
//     it in the SVG namespace on its own. That keeps this file free of any URL-shaped
//     string at all, so an "no external asset" grep over src/web/ can be trusted.
// Anything unknown falls back to a rune, so a new enemy or node type in the kernel
// renders as a generic shape rather than an empty box.

const MARKS = {
  // --- card types: crossed blades / shield / star / hourglass / skull ---
  // --- decorative art-band outlines (design rev 2): no gameplay meaning, so no TYPE_GLYPH ---
  cleave: { box: '0 0 20 20', body: '<path class="m" d="M3 3 L17 17"/><path class="m" d="M14 3 L17 3 L17 6"/><path class="m" d="M3 14 L3 17 L6 17"/>' },
  sweep: { box: '0 0 20 20', body: '<path class="m" d="M3 16 C6 10 14 10 17 4"/><path class="m" d="M3 11 C6 6 12 6 14 3"/>' },
  ward: { box: '0 0 20 20', body: '<circle class="m" cx="10" cy="10" r="6"/><path class="m" d="M10 1 V5"/><path class="m" d="M10 15 V19"/>' },
  blade: { box: '0 0 20 20', body: '<path class="m" d="M4 16 L15 5"/><path class="m" d="M11 4 L16 4 L16 9"/><path class="m" d="M3 17 L6 14"/>' },
  shield: { box: '0 0 20 20', body: '<path class="m" d="M10 2 L17 5 V11 C17 15 14 17.4 10 18.6 C6 17.4 3 15 3 11 V5 Z"/><path class="m" d="M10 7 V13"/>' },
  star: { box: '0 0 20 20', body: '<path class="m" d="M10 2 L11.9 8.1 L18 10 L11.9 11.9 L10 18 L8.1 11.9 L2 10 L8.1 8.1 Z"/>' },
  hourglass: { box: '0 0 20 20', body: '<path class="m" d="M5 3 H15 M5 17 H15 M6.5 3 V6 L10 10 L13.5 6 V3 M6.5 17 V14 L10 10 L13.5 14 V17"/>' },
  skull: { box: '0 0 20 20', body: '<path class="m" d="M10 2 C13.9 2 17 5 17 8.6 C17 11 15.6 12.6 14.2 13.6 V16.4 H5.8 V13.6 C4.4 12.6 3 11 3 8.6 C3 5 6.1 2 10 2 Z"/><circle class="mf" cx="7.4" cy="9" r="1.5"/><circle class="mf" cx="12.6" cy="9" r="1.5"/>' },
  rune: { box: '0 0 20 20', body: '<path class="m" d="M10 2 L18 10 L10 18 L2 10 Z"/><circle class="m" cx="10" cy="10" r="3.2"/>' },

  // --- intent kinds: strike bar / shield / chevrons up / chevrons down ---
  strike: { box: '0 0 40 30', body: '<path class="strike" d="M5 15 H26" stroke-width="5" stroke-linecap="round"/><path class="strike" d="M25 7 L35 15 L25 23" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  shieldWide: { box: '0 0 40 30', body: '<path class="shld" d="M20 3.5 L33 8 V16 C33 21.6 27 24.6 20 27.4 C13 24.6 7 21.6 7 16 V8 Z"/><path class="shld" d="M20 10 V21"/>' },
  chevUp: { box: '0 0 40 30', body: '<path class="chev" d="M8 21 L20 10 L32 21"/><path class="chev" d="M8 29 L20 18 L32 29"/>' },
  chevDown: { box: '0 0 40 30', body: '<path class="chev" d="M8 9 L20 20 L32 9"/><path class="chev" d="M8 17 L20 28 L32 17"/>' },

  // --- map node silhouettes ---
  sword: { box: '0 0 26 26', body: '<path class="m" d="M5 21 L18 8"/><path class="m" d="M13 5 L21 13"/>' },
  swords: { box: '0 0 26 26', body: '<path class="m" d="M5 5 L21 21"/><path class="m" d="M21 5 L5 21"/>' },
  spikes: { box: '0 0 26 26', body: '<path class="m" d="M4 19 L13 5 L22 19"/><path class="m" d="M4 23 H22"/>' },
  flame: { box: '0 0 26 26', body: '<path class="m" d="M13 22 C7 18 9.5 13 12 9 C13 12.5 16.5 12 15.5 7.5 C20 12 20.5 18 13 22 Z"/><path class="m" d="M5 23 H21"/>' },
  horns: { box: '0 0 26 26', body: '<path class="m" d="M9 9 C5 6 4 3 4 2 C7 3 9 5 10 7"/><path class="m" d="M17 9 C21 6 22 3 22 2 C19 3 17 5 16 7"/><path class="m" d="M13 6 C17.4 6 20 9 20 12.6 C20 15 18.6 16.6 17.2 17.6 V21.4 H8.8 V17.6 C7.4 16.6 6 15 6 12.6 C6 9 8.6 6 13 6 Z"/><circle class="mf" cx="10" cy="12" r="1.5"/><circle class="mf" cx="16" cy="12" r="1.5"/>' },
  route: { box: '0 0 26 26', body: '<path class="m" d="M5 21 C12 21 8 5 21 5"/><circle class="mf" cx="5" cy="21" r="2.2"/><circle class="mf" cx="21" cy="5" r="2.2"/>' },
  crown: { box: '0 0 26 26', body: '<path class="m" d="M4 19 L4 8 L9 13 L13 5 L17 13 L22 8 L22 19 Z"/><path class="m" d="M4 22 H22"/>' },
  // --- temper stamps (B2): struck into a tempered card's plate. Same woodcut stroke as the
  //     node marks; the hue comes from the temper class (cold blue / ember / brass). ---
  't-quench': { box: '0 0 20 20', body: '<path class="m" d="M10 2.5 C13 6.5 14.6 9 14.6 11.4 C14.6 14 12.6 15.8 10 15.8 C7.4 15.8 5.4 14 5.4 11.4 C5.4 9 7 6.5 10 2.5 Z"/><path class="m" d="M2.5 18 C5 16.6 7.5 19.4 10 18 C12.5 16.6 15 19.4 17.5 18"/>' },
  't-redhot': { box: '0 0 20 20', body: '<path class="m" d="M10 18 C5 15 6.6 10.6 8.8 7.4 C9.6 10 12.4 9.8 11.8 6 C15.4 9.4 15.8 15 10 18 Z"/><path class="mf" d="M10 15.6 C8.4 14.4 8.8 12.6 9.8 11.4 C10.4 12.6 11.8 12.8 11.6 11.6 C12.6 13 12.2 14.8 10 15.6 Z"/>' },
  't-balance': { box: '0 0 20 20', body: '<path class="m" d="M10 3 V17 M6 17 H14 M3.5 6 H16.5"/><path class="m" d="M3.5 6 L1.8 11 H5.2 Z"/><path class="m" d="M16.5 6 L14.8 11 H18.2 Z"/>' },
  // --- gold (S3): a struck coin, same woodcut stroke family as the marks above ---
  coin: { box: '0 0 20 20', body: '<circle class="m" cx="10" cy="10" r="6.6"/><path class="m" d="M10 6.7 V13.3"/>' },
  broken: { box: '0 0 26 26', body: '<path class="m" d="M12 3 L15 11"/><path class="m" d="M14 15 L8 23"/><path class="m" d="M18 5 L21 12"/>' },
  // --- potions (S5): a stoppered flask and a drop, same woodcut stroke family. The belt
  //     reuses existing marks where the shape reads (flame for the draught, the ward for
  //     stone skin, the blade for the whetstone, the star for energy); an EMPTY slot and
  //     an unknown potion id both fall back through the flask / rune respectively. ---
  flask: { box: '0 0 20 20', body: '<path class="m" d="M8 2.5 H12 M9 2.5 V7 L5.5 14.5 C4.8 16.4 6 18 8 18 H12 C14 18 15.2 16.4 14.5 14.5 L11 7 V2.5"/><path class="m" d="M7 12.5 H13"/>' },
  droplet: { box: '0 0 20 20', body: '<path class="m" d="M10 2.5 C13.2 7 15.5 10.4 15.5 13 A5.5 5.5 0 0 1 4.5 13 C4.5 10.4 6.8 7 10 2.5 Z"/><path class="m" d="M7.4 13 A2.6 2.6 0 0 0 10 15.6"/>' },
  // --- relics (S7): a kindled heart, same woodcut stroke family. The HUD's relic chip
  //     wears it; every relic uses the one mark (a relic's identity is its NAME, which
  //     always rides beside the mark) — an unknown relic id falls back through the rune
  //     inside glyphBox, never an empty box. ---
  relic: { box: '0 0 20 20', body: '<path class="m" d="M10 16.5 C4.2 12.4 2.8 8.4 5.4 6 C7.4 4.2 9.4 5.1 10 6.8 C10.6 5.1 12.6 4.2 14.6 6 C17.2 8.4 15.8 12.4 10 16.5 Z"/><path class="m" d="M10 8.2 V12.4 M8 10.2 H12"/>' },

  // --- enemy illustrations (art-direction rev): forged-iron woodcut. Three layers per
  //     creature: `.b` body (near-black iron), `.r` rim light (currentColor = the creature's
  //     tint), `.g` ember glow (eyes, cores, cracks). Constant markup, no interpolation. ---
  'e-worm': { box: '0 0 100 100', body: '<path class="b" d="M10 92 C8 70 14 52 30 44 C42 38 56 40 64 30 C70 22 80 20 88 26 L84 36 C78 32 72 34 68 40 C60 52 46 54 38 60 C28 68 26 80 30 92 Z"/><path class="r" d="M10 92 C8 70 14 52 30 44 C42 38 56 40 64 30 C70 22 80 20 88 26"/><path class="r" d="M18 72 L28 76 M22 60 L32 66 M34 50 L40 58 M48 44 L50 52"/><path class="b" d="M66 30 L92 18 L84 34 L94 40 L70 42 Z"/><path class="r" d="M66 30 L92 18 L84 34 L94 40 L70 42"/><path class="g" d="M84 24 l3 3 -3 1z M74 36 l3 0 -1 3z"/><circle class="g" cx="76" cy="26" r="2.6"/><path class="gr" d="M4 94 H96"/>' },
  'e-louse': { box: '0 0 100 100', body: '<path class="r" d="M26 56 L8 46 M26 66 L6 70 M30 76 L14 88 M74 56 L92 46 M74 66 L94 70 M70 76 L86 88"/><ellipse class="b" cx="50" cy="62" rx="28" ry="24"/><path class="r" d="M22 62 C22 48 34 38 50 38 C66 38 78 48 78 62 C78 76 66 86 50 86 C34 86 22 76 22 62 Z"/><path class="r" d="M28 54 C40 48 60 48 72 54 M26 66 C40 60 60 60 74 66 M30 77 C42 72 58 72 70 77"/><path class="b" d="M38 40 C38 30 62 30 62 40 Z"/><path class="r" d="M38 40 C38 30 62 30 62 40 M42 32 L32 14 M58 32 L68 14"/><circle class="g" cx="44" cy="36" r="2.6"/><circle class="g" cx="56" cy="36" r="2.6"/>' },
  'e-slime': { box: '0 0 100 100', body: '<path class="b" d="M12 88 C12 66 20 50 30 40 C38 32 44 22 50 14 C56 22 62 32 70 40 C80 50 88 66 88 88 Z"/><path class="r" d="M12 88 C12 66 20 50 30 40 C38 32 44 22 50 14 C56 22 62 32 70 40 C80 50 88 66 88 88"/><path class="r" d="M30 88 C30 94 26 96 24 92 M64 88 C64 96 70 97 70 91"/><circle class="r" cx="62" cy="56" r="5"/><circle class="r" cx="34" cy="70" r="3.4"/><circle class="r" cx="56" cy="76" r="2.4"/><path class="g" d="M38 54 l8 4 -8 3z M62 66 l-8 -4 8 -3z" transform="translate(0 -6)"/><path class="gr" d="M6 89 H94"/>' },
  'e-cultist': { box: '0 0 100 100', body: '<path class="b" d="M50 10 C64 12 70 28 68 42 L80 92 H20 L32 42 C30 28 36 12 50 10 Z"/><path class="r" d="M50 10 C64 12 70 28 68 42 L80 92 H20 L32 42 C30 28 36 12 50 10 Z"/><path class="b" d="M40 30 C40 22 60 22 60 30 L58 44 H42 Z"/><path class="r" d="M50 44 V92 M34 60 C42 56 58 56 66 60"/><circle class="g" cx="45" cy="34" r="2.3"/><circle class="g" cx="55" cy="34" r="2.3"/><path class="r" d="M80 92 L86 20"/><path class="g" d="M86 8 C90 14 90 18 86 20 C82 18 82 14 86 8 Z"/>' },
  'e-brute': { box: '0 0 100 100', body: '<path class="b" d="M50 22 C70 22 84 34 86 52 L90 92 H10 L14 52 C16 34 30 22 50 22 Z"/><path class="r" d="M50 22 C70 22 84 34 86 52 L90 92 H10 L14 52 C16 34 30 22 50 22 Z"/><path class="r" d="M34 26 C24 18 20 8 22 2 C30 6 36 14 40 22 M66 26 C76 18 80 8 78 2 C70 6 64 14 60 22"/><path class="r" d="M30 50 C40 46 60 46 70 50 M38 62 L50 70 L62 62"/><path class="g" d="M36 40 l8 3 -8 2z M64 40 l-8 3 8 2z"/><path class="gc" d="M22 70 L30 78 L26 88 M78 70 L72 80 L76 88"/>' },
  'e-sentinel': { box: '0 0 100 100', body: '<path class="b" d="M50 4 L84 16 L90 50 C86 72 70 86 50 96 C30 86 14 72 10 50 L16 16 Z"/><path class="r" d="M50 4 L84 16 L90 50 C86 72 70 86 50 96 C30 86 14 72 10 50 L16 16 Z"/><path class="r" d="M50 14 L74 24 L78 50 C74 66 64 76 50 84 C36 76 26 66 22 50 L26 24 Z"/><path class="r" d="M30 40 H70 M50 14 V30 M50 64 V84"/><path class="gc" d="M36 30 L42 36 L38 40 M64 30 L58 36 L62 40 M22 60 L30 62 M78 60 L70 62"/><circle class="g" cx="50" cy="52" r="8"/><circle class="r" cx="50" cy="52" r="12"/>' },
  'e-rune': { box: '0 0 100 100', body: '<path class="b" d="M50 12 L86 50 L50 88 L14 50 Z"/><path class="r" d="M50 12 L86 50 L50 88 L14 50 Z"/><circle class="g" cx="50" cy="50" r="7"/><circle class="r" cx="50" cy="50" r="14"/>' },
};

/**
 * Static SVG markup for a named mark. Unknown names fall back to a rune so a new
 * kernel type still renders as a shape rather than nothing.
 * @param {string} name
 * @returns {string}
 */
export function glyphMarkup(name) {
  const spec = MARKS[name] || MARKS.rune;
  return `<svg viewBox="${spec.box}" aria-hidden="true" focusable="false">${spec.body}</svg>`;
}

/**
 * Wrap a mark in a classed span so the CSS can size and colour it. Decorative: every
 * mark is `aria-hidden`, because each one sits beside its own words (a type word, an
 * intent sentence, a node label).
 * @param {string} name key in MARKS
 * @param {string} cls the wrapper's class
 * @returns {HTMLElement}
 */
export function glyphBox(name, cls) {
  const box = el('span', { cls });
  box.innerHTML = glyphMarkup(name);
  return box;
}

/** Card type -> its mark. The three cues are hue, mark and the type word. */
/** Temper id -> its stamp. */
export const TEMPER_GLYPH = { quenched: 't-quench', redhot: 't-redhot', balanced: 't-balance' };

/** Potion id -> its belt mark (S5). Presentation only: the belt chip's glyph is chosen
 *  here from the snapshot's own `potionId`; an unknown id falls back to the generic
 *  flask in the belt's own code and the rune inside glyphBox, never an empty box. */
export const POTION_GLYPH = {
  ember_draught: 'flame',
  stone_skin: 'ward',
  ash_salts: 'droplet',
  bellows_fuel: 'star',
  whetstone: 'blade',
  purge_flask: 'flask',
};

export const TYPE_GLYPH = { attack: 'blade', skill: 'shield', power: 'star', status: 'hourglass', curse: 'skull' };

/** Intent kind -> its mark. */
export const INTENT_GLYPH = { attack: 'strike', block: 'shieldWide', buff: 'chevUp', debuff: 'chevDown' };

/** Node type (after stripping the `combat_` prefix) -> its silhouette. The shop (S4)
 *  wears the coin — it is the one node that never fights and only trades. The event
 *  (S6) wears the rune — the wayside story nobody can name from the road. */
export const NODE_GLYPH = { weak: 'sword', strong: 'swords', elite: 'spikes', rest: 'flame', boss: 'horns', shop: 'coin', event: 'rune' };

/** Node type -> the words a player reads on the map. Presentation only: the kernel's
 *  own label ("fight", "fight+") still drives the title and the travel banner. The second
 *  line states only what the kernel's NODE_TYPES.reward says (card, heal or shop).
 *  I18N-1: these are UI chrome, so the map view resolves them as i18n keys
 *  (`map.node.<type>` / `map.node.<type>.sub`) at paint time; this table is the English
 *  reference and the fallback for a type the i18n table does not name. */
export const NODE_WORDS = {
  weak: ['Skirmish', 'card reward'], strong: ['Hard fight', 'card reward'], elite: ['Elite', 'card reward'],
  rest: ['Campfire', 'heal'], boss: ['Slag Warden', 'final fight'], shop: ['Shop', 'buy · remove'],
  event: ['Wayside', 'a choice'],
};

/**
 * Pick a silhouette, boss/elite framing and a rim tint from the enemy's NAME. The
 * snapshot carries the name; nothing here reads a rule or a stat.
 * @param {string} name
 * @returns {{art: string, boss: boolean, elite: boolean, hue: number}}
 */
export function enemyLook(id) {
  const table = {
    jaw_worm: { art: 'e-worm', hue: 1 },
    cultist: { art: 'e-cultist', hue: 4 },
    red_louse: { art: 'e-louse', hue: 1 },
    acid_slime: { art: 'e-slime', hue: 3 },
    gremlin_nob: { art: 'e-brute', elite: true, hue: 2 },
    the_guardian: { art: 'e-sentinel', boss: true, hue: 1 },
  };
  const hit = table[id];
  if (hit) return { art: hit.art, boss: Boolean(hit.boss), elite: Boolean(hit.elite), hue: hit.hue };
  return { art: 'e-rune', boss: false, elite: false, hue: 0 };
}
