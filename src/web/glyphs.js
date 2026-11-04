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
  // --- effect chips: the card face's icon row. New marks only where no existing one
  //     reads honestly (see EFFECT_GLYPH below for the borrowings). ---
  // Two fanned cards: the draw pile answering.
  draw: { box: '0 0 20 20', body: '<path class="m" d="M7.5 3.5 H16.5 V15 H7.5 Z"/><path class="m" d="M3.5 6.5 V17 H12.5"/>' },
  // A card released downward: away from the hand, into the discard.
  discard: { box: '0 0 20 20', body: '<path class="m" d="M5 3.5 H15 V10.5 H5 Z"/><path class="m" d="M10 12.5 V17.5 M6.8 14.3 L10 17.7 L13.2 14.3"/>' },
  // A crossed-out card: gone from the fight for good.
  exhaust: { box: '0 0 20 20', body: '<path class="m" d="M5.5 3.5 H14.5 V16.5 H5.5 Z"/><path class="m" d="M7.5 6.5 L12.5 13.5 M12.5 6.5 L7.5 13.5"/>' },
  // A kindled heart with its cross — distinct mark from the relic's, same shape language.
  heal: { box: '0 0 20 20', body: '<path class="m" d="M10 17 C4.6 13.2 3 9.8 5.1 7.4 C6.9 5.5 9.2 6.3 10 8.1 C10.8 6.3 13.1 5.5 14.9 7.4 C17 9.8 15.4 13.2 10 17 Z"/><path class="m" d="M10 8.6 V12.6 M8 10.6 H12"/>' },
  // The plain up-arrow: a Strength chip's "+2" sits under an arrow, not a buff chevron
  // (the wide intent marks are sized for the enemy lane, not a 20-box chip).
  strength: { box: '0 0 20 20', body: '<path class="m" d="M10 17 V5.5"/><path class="m" d="M5 10.5 L10 5 L15 10.5"/>' },
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

  // --- relic art (per-id): forged-iron woodcut, the enemy-mark language in miniature —
  //     `.b` iron body, `.r` rim light, `.g` ember glow, `.gr` ground stroke. One mark per
  //     relic id; the boss offer tiles wear it LARGE (.boon-art) and the elite chip wears
  //     the SAME mark restyled to strokes at chip size (.boon-glyph). The one cool accent
  //     (`.cb` cold flame) is the Cyan Lantern's — the quenched-temper cold blue
  //     precedent (the card temper class ships #8fd0f2). Constant
  //     markup, no interpolation; an unknown relic id falls back per RELIC_GLYPH below. ---
  'r-burning_blood': { box: '0 0 100 100', body: '<path class="b" d="M50 84 C22 62 15 40 29 28 C40 19 50 27 50 38 C50 27 60 19 71 28 C85 40 78 62 50 84 Z"/><path class="r" d="M50 84 C22 62 15 40 29 28 C40 19 50 27 50 38"/><path class="r" d="M50 44 L46 52 L53 59 L48 67"/><circle class="g" cx="44" cy="40" r="3.4"/><circle class="g" cx="57" cy="35" r="2.4"/><path class="g" d="M62 80 C65 84.5 66 87.5 64.6 89.8 C63.2 92 59.8 92 58.8 89.8 C57.8 87.5 59.4 84.5 62 80 Z"/><path class="gr" d="M8 95 H92"/>' },
  'r-cyan_lantern': { box: '0 0 100 100', body: '<path class="b" d="M38 14 H62 L58 24 H42 Z"/><path class="b" d="M42 78 H58 V86 H42 Z"/><path class="cb" d="M50 32 C56 40 58.5 46 58.5 52 C58.5 58.5 54.8 62.5 50 62.5 C45.2 62.5 41.5 58.5 41.5 52 C41.5 46 44 40 50 32 Z"/><path class="r" d="M50 5 V14"/><path class="r" d="M42 24 L38.5 64 C38.5 73 43.5 78 50 78 C56.5 78 61.5 73 61.5 64 L58 24"/><path class="r" d="M45 26 L43.5 77 M55 26 L56.5 77 M39 34 H61"/>' },
  'r-forge_iron': { box: '0 0 100 100', body: '<path class="b" d="M20 42 H80 L88 64 H12 Z"/><path class="r" d="M20 42 H80"/><path class="r" d="M12 64 L20 42"/><circle class="r" cx="30" cy="53" r="2.6"/><circle class="r" cx="50" cy="53" r="2.6"/><circle class="r" cx="70" cy="53" r="2.6"/><path class="g" d="M36 64 H64 L62 68 H38 Z"/><path class="gr" d="M8 92 H92"/>' },
  'r-whetted_edge': { box: '0 0 100 100', body: '<path class="b" d="M14 62 H86 L80 82 H20 Z"/><path class="r" d="M14 62 H86"/><path class="b" d="M16 56 L82 22 L86 28 L22 62 Z"/><path class="r" d="M22 62 L86 28"/><path class="g" d="M88 14 l4 3 -4 2z"/><path class="g" d="M76 8 l3.5 2.5 -3.5 2z"/><path class="g" d="M92 34 l3 2 -3 2z"/><path class="gr" d="M8 90 H92"/>' },
  'r-hearth_ash': { box: '0 0 100 100', body: '<path class="b" fill-rule="evenodd" d="M20 82 C18 52 32 32 50 32 C68 32 82 52 80 82 Z M30 82 C29 60 38 46 50 46 C62 46 71 60 70 82 Z"/><path class="r" d="M35 39 L38 52 M50 32 V45 M65 39 L62 52"/><path class="r" d="M20 82 H80"/><path class="g" d="M41 74 h6 l-2.5 4z"/><path class="g" d="M53 72 h7 l-2.5 5z"/><circle class="g" cx="48" cy="79" r="2.2"/><path class="gr" d="M10 92 H90"/>' },
  'r-ember_heart': { box: '0 0 100 100', body: '<path class="b" d="M50 84 L22 62 L15 40 L30 27 L44 34 L50 26 L56 34 L70 27 L85 40 L78 62 Z"/><path class="r" d="M50 26 L44 34 L30 27 L15 40"/><path class="g" d="M49 36 L54 46 L47 56 L53 68 L48 78 L44 78 L49 67 L43 55 L50 45 L46 36 Z"/><circle class="g" cx="59" cy="47" r="2.4"/><circle class="g" cx="40" cy="58" r="2"/><path class="gr" d="M10 92 H90"/>' },
  'r-gold_vein': { box: '0 0 100 100', body: '<path class="b" d="M22 80 L16 46 L34 20 L64 16 L84 40 L80 80 Z"/><path class="r" d="M34 20 L64 16"/><path class="r" d="M34 20 L46 46 M46 46 L64 16 M46 46 L80 40 M46 46 L22 80"/><path class="g" d="M44 46 H50 L48 57 L53 67 L49 80 H44 L48 68 L43 57 Z"/><path class="g" d="M72 19 L74 25 L80 26 L74 27 L72 33 L70 27 L64 26 L70 25 Z"/><path class="gr" d="M10 90 H90"/>' },
  'r-flask_grip': { box: '0 0 100 100', body: '<path class="b" fill-rule="evenodd" d="M50 12 A38 38 0 1 0 50 88 A38 38 0 1 0 50 12 Z M50 25 A25 25 0 1 1 50 75 A25 25 0 1 1 50 25 Z"/><path class="b" d="M45 33 H55 V40 C60.5 45.5 63 51 63 56.5 C63 64.5 57.5 69.5 50 69.5 C42.5 69.5 37 64.5 37 56.5 C37 51 39.5 45.5 45 40 Z"/><path class="r" d="M44 27.5 H56 M45 27.5 V33 M55 27.5 V33"/><path class="r" d="M14.3 37 A38 38 0 0 1 37 14.3"/><path class="g" d="M44 57 C46 52.5 54 52.5 56 57 C58 61.5 54 65.5 50 65.5 C46 65.5 42 61.5 44 57 Z"/><path class="gr" d="M10 92 H90"/>' },
  'r-deep_well': { box: '0 0 100 100', body: '<path class="b" fill-rule="evenodd" d="M12 58 A38 15 0 1 0 88 58 A38 15 0 1 0 12 58 Z M26 59 A24 9 0 1 1 74 59 A24 9 0 1 1 26 59 Z"/><path class="b" d="M18 60 L22 79 H78 L82 60 Z"/><path class="r" d="M14 55 A38 15 0 0 1 86 55"/><path class="r" d="M30 47 L31 55 M50 44 V53 M70 47 L69 55"/><path class="g" d="M46 18 C48 24 46.5 28 48 33 C42.5 29 43.5 23 46 18 Z"/><path class="g" d="M56 22 C58 27 56.5 31 57.5 36 C62 32 61 26 56 22 Z"/><circle class="g" cx="51" cy="38" r="2.4"/><path class="gr" d="M8 88 H92"/>' },
  'r-ash_crown': { box: '0 0 100 100', body: '<path class="b" d="M24 62 L22 40 L35 58 L41 28 L52 56 L60 34 L70 58 L78 42 L76 62 Z"/><path class="b" d="M24 62 H76 L72 76 H28 Z"/><path class="r" d="M24 62 H76 M28 76 H72"/><path class="r" d="M41 28 L35 58 M60 34 L70 58"/><circle class="g" cx="41" cy="27" r="2.2"/><circle class="g" cx="60" cy="33" r="2"/><path class="g" d="M33 18 l4 2.5 -4 2.5z"/><path class="g" d="M70 20 l4 2 -4 3z"/><path class="r" d="M28 14 L30 17 M52 12 L53 15.5 M82 14 L80 17"/><path class="gr" d="M14 86 H86"/>' },
  'r-slag_crown': { box: '0 0 100 100', body: '<path class="b" d="M22 64 V34 L35 50 L50 26 L65 50 L78 34 V64 Z"/><path class="b" d="M22 64 H78 L74 78 H26 Z"/><path class="r" d="M22 34 L35 50 L50 26 L65 50 L78 34"/><path class="r" d="M22 64 H78"/><path class="g" d="M22 64 H78 L77 68 H23 Z"/><path class="g" d="M34 68 C34 74 31.5 75 31.5 79 C31.5 83 37 83 37 79 C37 75 34 74 34 68 Z"/><path class="g" d="M50 68 C50 77 47 78 47 83 C47 87.5 53 87.5 53 83 C53 78 50 77 50 68 Z"/><path class="g" d="M65 68 C65 73 63 74 63 77.5 C63 81 68 81 68 77.5 C68 74 65 73 65 68 Z"/><path class="gr" d="M12 94 H88"/>' },
  'r-cinder_ward': { box: '0 0 100 100', body: '<path class="b" d="M50 10 L84 22 C84 54 72 78 50 90 C28 78 16 54 16 22 Z"/><path class="r" d="M50 20 L75.5 29 C75.5 53 66 71 50 80 C34 71 24.5 53 24.5 29 Z"/><path class="g" d="M49 28 L54 38 L47 48 L55 60 L49 72 L45.5 72 L51.5 60 L44.5 48 L51 38 L46 28 Z"/><path class="g" d="M33 38 L39 46 L35 54 L41 61 L38 62.5 L32 54 L36 46 L30 38.5 Z"/>' },
  'r-ash_ledger': { box: '0 0 100 100', body: '<path class="b" d="M62 24 L70 27 V75 L62 78 Z"/><path class="b" d="M28 20 H62 C70 20 74 25 74 32 V70 C74 77 70 82 62 82 H28 Z"/><path class="r" d="M34 20 V82"/><path class="r" d="M40 36 H60 M40 44 H60 M40 52 H56"/><path class="r" d="M58 44 H71 M58 56 H68"/><circle class="g" cx="71.5" cy="50" r="2.4"/><path class="g" d="M42 12 l4 2.5 -4 2.5z"/><path class="g" d="M56 14 l3.5 2 -3.5 2.5z"/><path class="gr" d="M18 90 H82"/>' },
  'r-unknown': { box: '0 0 100 100', body: '<path class="b" d="M32 16 H68 C73 16 76 19 76 24 V72 C76 77 73 80 68 80 H32 C27 80 24 77 24 72 V24 C24 19 27 16 32 16 Z"/><path class="r" d="M31 25 H69 V71 H31 Z"/><circle class="r" cx="28.5" cy="20.5" r="1.8"/><circle class="r" cx="71.5" cy="20.5" r="1.8"/><circle class="r" cx="28.5" cy="75.5" r="1.8"/><circle class="r" cx="71.5" cy="75.5" r="1.8"/><path class="g" d="M50 36 L60 48 L50 60 L40 48 Z"/><path class="gr" d="M14 90 H86"/>' },

  // --- kindling boon chips (b-*): the kindling buttons' small marks — single-stroke
  //     `.m`/`.mf`, the coin/flask family. Constant markup, no interpolation. ---
  'b-bellows': { box: '0 0 20 20', body: '<path class="m" d="M4 7.5 C2.3 9 2.3 11 4 12.5 L11.5 11.2 V8.8 Z"/><path class="m" d="M11.5 10 H14.8"/><circle class="mf" cx="16.8" cy="7.4" r="0.9"/><circle class="mf" cx="17.6" cy="10" r="1"/><circle class="mf" cx="16.6" cy="12.6" r="0.8"/>' },
  'b-ironskin': { box: '0 0 20 20', body: '<path class="m" d="M10 3 L16.5 6 V11 C16.5 14.6 13.9 16.9 10 17.6 C6.1 16.9 3.5 14.6 3.5 11 V6 Z"/><path class="m" d="M7 5.8 L10 7.8 L13 5.8"/><circle class="mf" cx="6.3" cy="9.4" r="0.8"/><circle class="mf" cx="13.7" cy="9.4" r="0.8"/>' },
  'b-sparkfall': { box: '0 0 20 20', body: '<path class="m" d="M5.5 13.5 L10 17.5 L14.5 13.5"/><path class="mf" d="M6 4.5 L7.2 6.1 L6 7.7 L4.8 6.1 Z"/><path class="mf" d="M11 7 L12.2 8.6 L11 10.2 L9.8 8.6 Z"/><path class="mf" d="M14.8 3 L15.9 4.5 L14.8 6 L13.7 4.5 Z"/>' },
  'b-purge': { box: '0 0 20 20', body: '<path class="m" d="M5 3.5 H12.5 V8 H5 Z"/><path class="m" d="M8.75 8 V17"/><path class="m" d="M3.5 3.5 L16.5 16.5 M16.5 3.5 L3.5 16.5"/>' },
  'b-stoke': { box: '0 0 20 20', body: '<path class="m" d="M10 17.5 C5.8 14.6 7.7 11.2 9.7 8.4 C10.3 10.8 12.9 10.6 12.1 7.6 C15.3 10.4 15.6 14.7 10 17.5 Z"/><circle class="mf" cx="12.4" cy="6.2" r="1.3"/><path class="m" d="M15.2 2.2 L12.8 5.4 M18.6 3.6 L13.9 6"/>' },

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

/** Relic id -> its per-id mark (the r-* woodcut table above). Two surfaces share ONE mark
 *  per relic, each styled by its own CSS context: the boss offer tile wears it large
 *  (.boon-art, the full three-layer drawing) and the elite's spoils chip wears the same
 *  silhouette restyled to strokes at chip size (.boon-glyph). The fallbacks differ by
 *  surface and are the CALLER's (an unknown id must never render an empty box):
 *    * offer tile  -> `r-unknown`, the generic riveted reliquary plate;
 *    * spoils chip -> the generic `relic` heart (the pre-art chip mark, unchanged).
 *  Both are the glyphBox/glyphMarkup rune-fallback model: unknown in, known shape out. */
export const RELIC_GLYPH = {
  burning_blood: 'r-burning_blood',
  cyan_lantern: 'r-cyan_lantern',
  forge_iron: 'r-forge_iron',
  whetted_edge: 'r-whetted_edge',
  hearth_ash: 'r-hearth_ash',
  ember_heart: 'r-ember_heart',
  gold_vein: 'r-gold_vein',
  flask_grip: 'r-flask_grip',
  deep_well: 'r-deep_well',
  ash_crown: 'r-ash_crown',
  slag_crown: 'r-slag_crown',
  cinder_ward: 'r-cinder_ward',
  ash_ledger: 'r-ash_ledger',
};

/** Kindling boon id -> its chip mark (the b-* table above). Presentation only: the kindling
 *  buttons resolve it from the snapshot's own `boons[].id`; an unknown id falls back to the
 *  rune inside glyphBox, never an empty box. */
export const BOON_GLYPH = {
  bellows: 'b-bellows',
  ironskin: 'b-ironskin',
  sparkfall: 'b-sparkfall',
  purge: 'b-purge',
  stoke: 'b-stoke',
};

export const TYPE_GLYPH = { attack: 'blade', skill: 'shield', power: 'star', status: 'hourglass', curse: 'skull' };

/** Intent kind -> its mark. */
export const INTENT_GLYPH = { attack: 'strike', block: 'shieldWide', buff: 'chevUp', debuff: 'chevDown' };

/** Effect chip -> its mark (the kernel publishes `{verb, status?}` chips; this table is
 *  purely presentational). Existing marks are borrowed where the shape reads honestly —
 *  the blade for damage, the shield for Block, the star for Energy (the energy potion
 *  already wears it), the hourglass for Retain (the fact IS "stays across the turn") and
 *  the ward for Metallicize (its Block arrives as armour). The debuff chevron serves
 *  Vulnerable and Weak: the enemy-side facts they are. The names must stay inside
 *  MARKS — an unknown key falls back to the rune inside glyphBox, never an empty box. */
export const EFFECT_GLYPH = {
  damage: 'blade',
  attack: 'blade',
  block: 'shield',
  draw: 'draw',
  discard: 'discard',
  energy: 'star',
  heal: 'heal',
  exhaust: 'exhaust',
  retain: 'hourglass',
  strength: 'strength',
  vulnerable: 'chevDown',
  weak: 'chevDown',
  dexterity: 'chevUp',
  metallicize: 'ward',
};

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
 * Pick a silhouette, boss/elite framing and a rim tint from the enemy's encounter ID. The
 * snapshot carries the id; nothing here reads a rule or a stat.
 * @param {string} id the kernel's stable encounter id (e.g. `cinder_foreman`)
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
    // UX-9 D2: the Cinder Mines roster. The `boss`/`elite` flags are what drive the framing
    // (border + boss name font); the sprites resolve by `e.id` in stage-art.js, so no glyph
    // class is invented here for the unused `art` field.
    slag_crawler: { hue: 3 },
    ash_wraith: { hue: 0 },
    ash_wraith_elite: { elite: true, hue: 4 },
    cinder_foreman: { boss: true, hue: 2 },
  };
  const hit = table[id];
  if (hit) {
    return { art: hit.art || 'e-rune', boss: Boolean(hit.boss), elite: Boolean(hit.elite), hue: hit.hue };
  }
  return { art: 'e-rune', boss: false, elite: false, hue: 0 };
}
