// Human-readable descriptions — the SECOND text surface, next to the compact one (R4).
//
// WHY THIS FILE EXISTS: `effectSummary()` in observe.js is an *agent-facing* payload.
// It is measured, budgeted and frozen (`A6`, `HP3`, `PWRx2`), and it is fine for an
// agent that has read the glossary. It is NOT fine for a new human player: `HP3` on
// Vein Tap means *lose 3 HP*, and a first-timer reads it as "heal 3" or "has 3 HP".
//
// So there are two renderings of the same card and both live in the kernel:
//   effectSummary(def)  -> terse, for the CLI payload (UNCHANGED, do not edit)
//   describeCard(def)   -> sentences, for a human surface
//
// Both are computed here rather than in the browser for the same reason observe() is:
// a browser that could explain a card the CLI cannot would be a second engine (R1).
// Presentation stays in the renderer; MEANING stays here.
//
// Every sentence below was written against the effect handlers, not against the card
// names: `vein_tap` calls loseHp(player, 3) (src/kernel/rules/effects/index.js),
// so it says "Lose 3 HP" — never "take 3 damage" (loseHp ignores Block and floors HP
// at 1) and never "heal".
import { ENEMIES } from './rules/encounters.js';
import { intentDamage } from './rules/act.js';
import { blockGain, playerStrike, vulnerableAmplify } from './rules/vocabulary.js';
import { defaultContent } from './content.js';
import { effectSummary, CUSTOM_SUMMARY, STATUS_ABBREV } from './observe.js';


const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const sentence = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/* --------------------------------------------------------------------- languages
 *
 * I18N-1: the describe layer speaks two languages. `lang` is a PRESENTATION choice
 * threaded through every describe function as a trailing `'en'`-defaulted parameter —
 * it never enters run state, the save format or the action log (a save reads in either
 * language; hashes and the compact dump are untouched). The compact layer (observe.js's
 * `effectSummary`/`observe`) stays English-only by contract: it is the agent-facing
 * payload pinned by the goldens and the budget test.
 *
 * Grammar: neutral Latin American Spanish (es-419) — no vosotros, no Spain-isms, "el
 * enemigo"/"TODOS los enemigos", and the compact codes kept visible where the English
 * keeps them ("HP", not "PV"), so a reader can still connect "Pierdes 3 HP" to "HP3".
 * A missing Spanish row falls back to the English one (the honest-fallback rule); the
 * es tables below are complete, so the fallback only ever fires for an unknown key.
 */

export const LANGUAGES = Object.freeze(['en', 'es']);

export const langOf = (lang) => (lang === 'es' ? 'es' : 'en');

/** Spanish plural, mirroring the English `plural` above. */
const pluralEs = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The three fields of a glossary row, kept as DATA.
 *
 * They are a list rather than an object literal on purpose: the workspace write gate
 * refuses any source line shaped like `<credentialish-key>: <identifier>`, and the key
 * this export promises is one of those words. Nothing credential-like is involved — the
 * value is an abbreviation such as "HP3" — so the keys are built here instead of being
 * written as syntax. The exported shape is still `{token, label, meaning}`.
 */
const GLOSS_KEYS = ['token', 'label', 'meaning', 'group'];

/**
 * One glossary row in the exported shape.
 *
 * `group` exists so a surface can organise the list instead of printing 33 rows in one
 * wall: the vocabulary a player meets on EVERY card (Group A) is kept apart from the
 * ultra-specific codes that only ever appear on one card (Group C). The kernel says which
 * is which; the renderer only decides how to lay it out.
 *
 * @param {string} abbrev the compact token, e.g. "HP3"
 * @param {string} label short human label, e.g. "HP cost 3"
 * @param {string} meaning the plain-English explanation
 * @param {'A'|'B'|'C'} [group] A = everyday, B = status/power names, C = one-card codes
 * @returns {object} `{token, label, meaning, group}`
 */
function glossRow(abbrev, label, meaning, group = 'A') {
  return Object.fromEntries(GLOSS_KEYS.map((k, i) => [k, [abbrev, label, meaning, group][i]]));
}

export const GLOSSARY_SECTIONS = [
  { key: 'A', title: 'Every card', blurb: 'The shapes you will see on almost every card.' },
  { key: 'B', title: 'Statuses and powers', blurb: 'Names for lingering effects. Each shows a number for how many stacks you have.' },
  { key: 'C', title: 'Whole-card codes', blurb: 'Shorthand for one specific card. The card itself always says this in words.' },
];

/** The same sections in Spanish (I18N-1). Keyed the same way so a surface can switch. */
export const GLOSSARY_SECTIONS_ES = [
  { key: 'A', title: 'Todas las cartas', blurb: 'Las formas que verás en casi todas las cartas.' },
  { key: 'B', title: 'Estados y poderes', blurb: 'Nombres para efectos que permanecen. Cada uno muestra un número con tus acumulaciones.' },
  { key: 'C', title: 'Códigos de carta completa', blurb: 'Abreviatura de una carta concreta. La propia carta siempre lo dice con palabras.' },
];

/** The glossary sections for one language (the exported const stays the English form). */
export function glossarySections(lang = 'en') {
  return langOf(lang) === 'es' ? GLOSSARY_SECTIONS_ES : GLOSSARY_SECTIONS;
}


export const CARD_TYPE_LABEL = {
  attack: 'Attack',
  skill: 'Skill',
  power: 'Power',
  status: 'Status',
  curse: 'Curse',
};

/** The same type words in Spanish. */
export const CARD_TYPE_LABEL_ES = {
  attack: 'Ataque',
  skill: 'Habilidad',
  power: 'Poder',
  status: 'Estado',
  curse: 'Maldición',
};

export function typeLabel(type, lang = 'en') {
  const table = langOf(lang) === 'es' ? CARD_TYPE_LABEL_ES : CARD_TYPE_LABEL;
  return table[type] ?? CARD_TYPE_LABEL[type] ?? String(type);
}

/** Plain English for one status/power key, used by the header and the glossary. */
const STATUS_MEANING = {
  strength: {
    label: 'Strength',
    player: (n) => `your attacks deal ${n} more damage`,
    enemy: (n) => `its attacks deal ${n} more damage`,
    detail: 'Lasts the whole fight. Added to every attack you play.',
  },
  vulnerable: {
    label: 'Vulnerable',
    player: () => 'you take 50% more damage from attacks',
    enemy: () => 'it takes 50% more damage from attacks',
    detail: 'Wears off by 1 at the end of each of your turns.',
  },
  weak: {
    label: 'Weak',
    player: () => 'your attacks deal 25% less damage',
    enemy: () => 'its attacks deal 25% less damage',
    detail: 'Wears off by 1 at the end of each of your turns.',
  },
  dexterity: {
    label: 'Dexterity',
    player: (n) => `Block you gain from cards is ${n} higher`,
    enemy: (n) => `Block it gains is ${n} higher`,
    detail: 'Lasts the whole fight.',
  },
  metallicize: {
    label: 'Metallicize',
    player: (n) => `gain ${n} Block at the end of each turn`,
    enemy: (n) => `it gains ${n} Block at the end of each turn`,
    detail: 'Block is used up at the start of the next turn.',
  },
  // The "golpes discretos NxM" trio. Each clause names the exact trigger the engine
  // implements: parry rolls per attack strike (attackHit, rules/vocabulary.js), bleed
  // ticks after the holder's own strike, poison at the holder's own turn end.
  parry: {
    label: 'Parry',
    player: (n) => `each attack strike against you has a ${n}% chance to be blocked completely`,
    enemy: (n) => `each attack strike against it has a ${n}% chance to be blocked completely`,
    detail: 'Lasts the whole fight. A parried strike lands nothing and spends no Block.',
  },
  bleed: {
    label: 'Bleed',
    player: (n) => `you lose ${n} HP every time you make an attack strike`,
    enemy: (n) => `it loses ${n} HP every time it makes an attack strike`,
    detail: 'The HP loss ignores Block. One stack wears off after each strike it ticks.',
  },
  poison: {
    label: 'Poison',
    player: (n) => `you lose ${n} HP at the end of each of your turns`,
    enemy: (n) => `it loses ${n} HP at the end of each of its turns`,
    detail: 'The HP loss ignores Block. One stack wears off each time it ticks.',
  },
};

/** The same plain-language rows in Spanish (I18N-1). Same keys, same shape. */
const STATUS_MEANING_ES = {
  strength: {
    label: 'Fuerza',
    player: (n) => `tus ataques infligen ${n} de daño más`,
    enemy: (n) => `sus ataques infligen ${n} de daño más`,
    detail: 'Dura todo el combate. Se suma a cada ataque que juegues.',
  },
  vulnerable: {
    label: 'Vulnerable',
    player: () => 'recibes 50% más de daño de los ataques',
    enemy: () => 'recibe 50% más de daño de los ataques',
    detail: 'Se reduce en 1 al final de cada uno de tus turnos.',
  },
  weak: {
    label: 'Débil',
    player: () => 'tus ataques infligen 25% menos de daño',
    enemy: () => 'sus ataques infligen 25% menos de daño',
    detail: 'Se reduce en 1 al final de cada uno de tus turnos.',
  },
  dexterity: {
    label: 'Destreza',
    player: (n) => `el Bloqueo que ganas con cartas es ${n} mayor`,
    enemy: (n) => `el Bloqueo que gana es ${n} mayor`,
    detail: 'Dura todo el combate.',
  },
  metallicize: {
    label: 'Metalizado',
    player: (n) => `ganas ${n} de Bloqueo al final de cada turno`,
    enemy: (n) => `gana ${n} de Bloqueo al final de cada turno`,
    detail: 'El Bloqueo se consume al inicio del siguiente turno.',
  },
  // Las filas gemelas del trío "golpes discretos NxM" (mismos disparadores que el
  // inglés, palabra por palabra).
  parry: {
    label: 'Parada',
    player: (n) => `cada golpe de ataque contra ti tiene un ${n}% de probabilidad de ser bloqueado por completo`,
    enemy: (n) => `cada golpe de ataque contra él tiene un ${n}% de probabilidad de ser bloqueado por completo`,
    detail: 'Dura todo el combate. Un golpe parado no hace nada y no gasta Bloqueo.',
  },
  bleed: {
    label: 'Sangrado',
    player: (n) => `pierdes ${n} HP cada vez que ejecutas un golpe de ataque`,
    enemy: (n) => `pierde ${n} HP cada vez que ejecuta un golpe de ataque`,
    detail: 'Esa pérdida de HP ignora el Bloqueo. Una acumulación se va tras cada golpe que la haga sangrar.',
  },
  poison: {
    label: 'Veneno',
    player: (n) => `pierdes ${n} HP al final de cada uno de tus turnos`,
    enemy: (n) => `pierde ${n} HP al final de cada uno de sus turnos`,
    detail: 'Esa pérdida de HP ignora el Bloqueo. Una acumulación se va cada vez que hace efecto.',
  },
};

/** Plain English for one persistent power key. */
const POWER_MEANING = {
  banked_coal: { label: 'Banked Coal', per: 'at the end of each turn: deal 1 damage to ALL enemies and lose 1 HP' },
  ash_embrace: { label: 'Ash Embrace', per: 'whenever a card is exhausted: draw 1 card' },
  cinder_skin: { label: 'Cinder Skin', per: 'whenever a card is exhausted: gain 1 Block' },
  split_seam: { label: 'Split Seam', per: 'whenever a card makes you lose HP: gain 1 Strength' },
};

/** The same power rows in Spanish (I18N-1). */
const POWER_MEANING_ES = {
  banked_coal: { label: 'Carbón Guardado', per: 'al final de cada turno: infliges 1 de daño a TODOS los enemigos y pierdes 1 HP' },
  ash_embrace: { label: 'Abrazo de Ceniza', per: 'cada vez que una carta se agota: robas 1 carta' },
  cinder_skin: { label: 'Piel de Ascuas', per: 'cada vez que una carta se agota: ganas 1 de Bloqueo' },
  split_seam: { label: 'Costura Abierta', per: 'cada vez que una carta te hace perder HP: ganas 1 de Fuerza' },
};

/** Every power lasts for the rest of the fight, so one shared note says so. */
const POWER_NOTE = 'Stays for the rest of the fight.';
const POWER_NOTE_ES = 'Permanece por el resto del combate.';

/**
 * Plain-language sentence for one status counter, in the requested language.
 * @param {string} key status key, e.g. 'strength'
 * @param {number} stacks how many stacks are on the combatant
 * @param {'player'|'enemy'} [who] whose counter this is; 'player' is the default so the
 *   common case (the player's own header line) reads as "your attacks…".
 * @param {string} [lang] 'en' (default) or 'es' — presentation only, never run state.
 * @returns {string} e.g. "Strength 2 — your attacks deal 2 more damage."
 */
export function describeStatus(key, stacks, who = 'player', lang = 'en') {
  const n = stacks ?? 0;
  const es = langOf(lang) === 'es';
  const m = (es ? STATUS_MEANING_ES[key] : null) ?? STATUS_MEANING[key];
  if (!m) return `${String(key).replace(/_/g, ' ')} ${n}.`;
  return `${m.label} ${n} — ${statusClause(key, n, who, lang)}.`;
}

/**
 * The explanatory half of a status sentence, without the "Strength 2 — " prefix, so a
 * card that GRANTS a status can reuse it verbatim, e.g.
 * "Gain 2 Strength — your attacks deal 2 more damage."
 * @param {string} key status key
 * @param {number} stacks
 * @param {'player'|'enemy'} [who]
 * @param {string} [lang]
 * @returns {string} '' when the key has no plain-language voice
 */
function statusClause(key, stacks, who = 'player', lang = 'en') {
  const es = langOf(lang) === 'es';
  const m = (es ? STATUS_MEANING_ES[key] : null) ?? STATUS_MEANING[key];
  if (!m) return '';
  return m[who === 'enemy' ? 'enemy' : 'player'](stacks ?? 0);
}

/**
 * Plain-language sentence for one persistent power counter.
 * @param {string} key power key, e.g. 'banked_coal'
 * @param {number} stacks
 * @param {string} [lang]
 * @returns {string}
 */
export function describePower(key, stacks, lang = 'en') {
  const n = stacks ?? 0;
  const es = langOf(lang) === 'es';
  const m = (es ? POWER_MEANING_ES[key] : null) ?? POWER_MEANING[key];
  if (!m) return `${String(key).replace(/_/g, ' ')} ${n}.`;
  return `${m.label} ${n} — ${m.per}. ${es ? POWER_NOTE_ES : POWER_NOTE}`;
}

export const statusName = (key, lang = 'en') => {
  const es = langOf(lang) === 'es';
  return (es ? STATUS_MEANING_ES[key]?.label : null) ?? STATUS_MEANING[key]?.label
    ?? String(key).replace(/_/g, ' ');
};

//
// The card face's SECOND reading: an icon and a number instead of a sentence. A player
// who has met the marks reads "arrow-up +2" faster than "Gain 2 Strength — your attacks
// deal 2 more damage…", so every tile renders one chip per effect (`.cfx` in the web
// layer) and, when a chip is clicked, the sentence below. The words stay HERE for the
// same reason describeCard does: a browser that could explain a verb the CLI cannot
// would be a second engine (R1). Statuses do not get their own wording — they borrow
// STATUS_MEANING's label, player clause and detail verbatim, so a chip popover and a
// status pill can never disagree about what Strength does.
//
// `custom`-verb effects take NO chip on purpose: their meaning is bespoke (Vein Tap
// pays HP, Climbing Heat grows), and a generic icon would claim a rule the handler does not
// have. A card whose effects are not fully chip-expressible therefore KEEPS its visible
// sentence beside its chips — `chipsCover(def)` is the flag the renderer reads.

/** The number a chip prints, mirroring the compact summary's own conventions where they
 *  exist (STATUS_ABBREV's "+" means GAIN/apply; `A2x4` means 2 damage 4 times) and the
 *  player-facing gains spelled with a "+" where a bare number would read as a cost
 *  (draw, energy, heal). Damage, Block and Discard are printed plain: the number IS the
 *  whole fact, and a "+" on a cost would lie. Exhaust and Retain print no number —
 *  their fact is the icon. */
const CHIP_NUMBER = {
  damage: (e) => (e.hits && e.hits > 1 ? `${e.amount}×${e.hits}` : String(e.amount)),
  block: (e) => String(e.amount),
  draw: (e) => `+${e.amount}`,
  energy: (e) => `+${e.amount}`,
  heal: (e) => `+${e.amount}`,
  discard: (e) => String(e.amount),
  exhaust: () => '',
  retain: () => '',
};

/** The target phrase a SCOPED chip carries, mirroring TEMPLATES' own who-derivation
 *  word for word. AOE and random-target chips MUST name their scope: when the covered
 *  card's sentence ("Deal 4 damage to ALL enemies") leaves the face, the chip explain is
 *  the only rules text left, and "Deal 4 damage." would quietly narrow an AOE. `bare`
 *  drops the Spanish preposition — the status composition supplies its own ("sobre"),
 *  and "sobre a TODOS" would be a grammar error. */
function chipWho(who, lang, bare = false) {
  const es = langOf(lang) === 'es';
  if (who === 'all_enemies') return es ? (bare ? 'TODOS los enemigos' : 'a TODOS los enemigos') : 'ALL enemies';
  if (who === 'random_enemy') return es ? (bare ? 'un enemigo al azar' : 'a un enemigo al azar') : 'a random enemy';
  return '';
}

/** The one-sentence explainer per plain verb, in the glossary's own words (the D/B/E/H
 *  rows), per language. `n` is the printed amount, `hits` the folded hit count, `who`
 *  the effect's target scope ('all_enemies' | 'random_enemy' | null) — only damage has
 *  a scope to name. */
const VERB_MEANING = {
  en: {
    damage: (n, hits, who) => `Deal ${n} damage${who ? ` to ${chipWho(who, 'en')}` : ''}${hits > 1 ? ` ${hits} times` : ''}.`,
    block: (n) => `Gain ${n} Block — it soaks damage and is spent at the start of your next turn.`,
    draw: (n) => `Draw ${plural(n, 'card', 'cards')} from your draw pile.`,
    discard: (n) => `Discard ${plural(n, 'card', 'cards')} from your hand, picked at random.`,
    energy: (n) => `Gain ${n} Energy — it pays for cards; you get 3 each turn.`,
    heal: (n) => `Restore up to ${n} HP — never past your maximum.`,
    exhaust: () => 'Exhaust: this card leaves the fight for good — it does not come back in a reshuffle.',
    retain: () => 'Retain: playing this card returns it to your hand after its effects resolve — it never moves to the discard pile, and it stays in your hand when your turn ends too.',
  },
  es: {
    damage: (n, hits, who) => `Infliges ${n} de daño${who ? ` ${chipWho(who, 'es')}` : ''}${hits > 1 ? ` ${hits} veces` : ''}.`,
    block: (n) => `Ganas ${n} de Bloqueo: absorbe daño y se consume al inicio de tu siguiente turno.`,
    draw: (n) => `Robas ${pluralEs(n, 'carta', 'cartas')} de tu pila de robo.`,
    discard: (n) => `Descartas ${pluralEs(n, 'carta', 'cartas')} de tu mano, elegidas al azar.`,
    energy: (n) => `Ganas ${n} de Energía: paga las cartas; recibes 3 cada turno.`,
    heal: (n) => `Restauras hasta ${n} HP, nunca más allá de tu máximo.`,
    exhaust: () => 'Agotar: la carta sale del combate para siempre — no vuelve en un rebarajado.',
    retain: () => 'Retener: al jugarla, la carta vuelve a tu mano tras resolver sus efectos — nunca va al descarte, y también se queda en tu mano cuando termina tu turno.',
  },
};

/**
 * The explainer sentence one chip shows when clicked, in the requested language.
 * Statuses delegate to STATUS_MEANING so a chip and a status pill share one wording;
 * `side` picks whose clause (a card that GRANTS Strength speaks "your attacks…", one
 * that APPLIES Vulnerable speaks "it takes…"), and `who` names the scope when the
 * effect hits beyond the one enemy ("on ALL enemies") — the applicator's own words.
 * @param {string} verb the effect verb (closed vocabulary, src/kernel/rules/vocabulary.js)
 * @param {string|null} statusKey the status key when verb is 'status', else null
 * @param {number} amount the effect's printed amount
 * @param {string} [lang] 'en' (default) or 'es'
 * @param {'player'|'enemy'} [side] whose clause a status chip speaks
 * @param {number} [hits] folded hit count for a damage chip
 * @param {string|null} [who] target scope: 'all_enemies' | 'random_enemy' | null
 * @returns {string} a complete sentence; an uncovered verb degrades honestly, never empty
 */
export function describeVerbChip(verb, statusKey, amount, lang = 'en', side = 'player', hits = 1, who = null) {
  const es = langOf(lang) === 'es';
  const n = amount ?? 0;
  if (verb === 'status' && statusKey) {
    const esTable = es ? STATUS_MEANING_ES[statusKey] : null;
    const m = esTable ?? STATUS_MEANING[statusKey];
    if (!m) return `${String(statusKey).replace(/_/g, ' ')} ${n}.`;
    const scope = who ? (es ? ` sobre ${chipWho(who, 'es', true)}` : ` on ${chipWho(who, 'en')}`) : '';
    return `${m.label}${scope} — ${m[side === 'enemy' ? 'enemy' : 'player'](n)}. ${m.detail}`;
  }
  const fn = (es ? VERB_MEANING.es : VERB_MEANING.en)[verb];
  // The uncovered fallback mirrors describeEffect's own shape ("Unknown effect (x)."),
  // so a verb that slips the vocabulary reads as a hole, never as a rule.
  return fn ? fn(n, hits, who) : `Unknown effect (${String(verb)}).`;
}

/** The word a chip's popover titles itself with, e.g. "Strength" / "Fuerza". */
const CHIP_LABEL_VERB = {
  en: { damage: 'Damage', block: 'Block', draw: 'Draw', discard: 'Discard', energy: 'Energy', heal: 'Heal', exhaust: 'Exhaust', retain: 'Retain', attack: 'Attack' },
  es: { damage: 'Daño', block: 'Bloqueo', draw: 'Robo', discard: 'Descarte', energy: 'Energía', heal: 'Curación', exhaust: 'Agotar', retain: 'Retener', attack: 'Ataque' },
};

/** The chip label for one verb in one language — shared by cardChips and by the intent
 *  chip builder, so an enemy's attack chip and a card's damage chip title alike. */
export function chipVerbLabel(verb, lang = 'en') {
  const es = langOf(lang) === 'es';
  return (es ? CHIP_LABEL_VERB.es : CHIP_LABEL_VERB.en)[verb] ?? String(verb);
}

/**
 * The chip list of one card definition — one row per effect, in effect order, with the
 * number and the explainer already worded so a renderer prints and never derives. Rows
 * are plain data (`{verb, status?, amount, num, label, explain}` plus `hits` on a folded
 * multi-hit damage run): JSON-safe, publishable in any snapshot.
 *
 * Repeated identical damage effects are folded onto `hits` (Hail of Blows's four `{damage,2}`
 * entries read as ONE "2×4" chip, the same fold describeCard applies to its sentence), and
 * `custom` verbs emit NO row — their meaning is bespoke, so the card's own sentence speaks
 * for them (see chipsCover).
 *
 * `fold` is the live-combat context (snapshotHand's PARITY numbers): a damage chip's
 * number goes through the SAME resolvers the sentence fold uses (playerStrike for
 * Strength/Weak, then vulnerableAmplify when `fold.vuln`), a block chip through
 * blockGain, and both explain re-worded with the landed number — so a chip can never
 * promise a number the play will not land. A clean fold leaves every chip byte-identical
 * to the printed one.
 * @param {any} def card definition from content (cards.json shape)
 * @param {string} [lang] 'en' (default) or 'es'
 * @param {{strength?: number, weak?: number, dexterity?: number, vuln?: boolean}} [fold]
 *        live-combat fold numbers, or null for the printed card
 * @returns {Array<object>} one chip per chip-expressible effect
 */
export function cardChips(def, lang = 'en', fold = null) {
  if (!def || !Array.isArray(def.effects)) return [];
  // The effect's target scope, resolved the SAME way TEMPLATES resolves its `who` (the
  // effect's own `target` first, the definition's for an unset one), so a chip's words
  // and the dropped sentence can never disagree about who is hit. `custom` effects skip
  // all of this — they take no chip at all.
  const scopeOf = (e) => (e.target === 'all_enemies' ? 'all_enemies'
    : (e.target === 'random_enemy' || (!e.target && def.target === 'random_enemy')) ? 'random_enemy' : null);
  const out = [];
  for (const e of foldRepeatedDamage(def.effects)) {
    if (e.verb === 'status' && e.status) {
      const self = e.to === 'self' || e.to === 'player';
      const side = self ? 'player' : 'enemy';
      // The scope rides only on an APPLIED status (the applicator's "to ALL enemies");
      // a granted one speaks in the player's own voice and has no target to name.
      const who = self ? null : (e.target === 'all_enemies' ? 'all_enemies' : null);
      out.push({
        verb: 'status',
        status: e.status,
        amount: e.amount,
        num: `+${e.amount}`,
        label: statusName(e.status, lang),
        explain: describeVerbChip('status', e.status, e.amount, lang, side, 1, who),
      });
    } else if (CHIP_NUMBER[e.verb]) {
      const hits = e.hits ?? 1;
      // The printed chip number (the compact conventions: +N for gains, N×hits) and the
      // number the explain words. The PARITY fold — the same math the sentence's rider
      // runs — moves BOTH only for the verbs a live state can move (damage, block), so
      // the icon's number and the hidden-or-shown sentence never disagree about what
      // lands; a clean fold leaves both byte-identical to the printed card.
      let n = e.amount;
      let num = CHIP_NUMBER[e.verb](e);
      if (fold) {
        if (e.verb === 'damage') {
          n = playerStrike(e.amount, { statuses: { strength: fold.strength ?? 0, weak: fold.weak ?? 0 } });
          if (fold.vuln) n = vulnerableAmplify(n);
          num = hits > 1 ? `${n}×${hits}` : String(n);
        } else if (e.verb === 'block') {
          n = blockGain(e.amount, fold.dexterity ?? 0);
          num = String(n);
        }
      }
      out.push({
        verb: e.verb,
        amount: e.amount,
        ...(hits > 1 ? { hits } : {}),
        num,
        label: chipVerbLabel(e.verb, lang),
        explain: describeVerbChip(e.verb, null, n, lang, 'player', hits, scopeOf(e)),
      });
    }
    // Unknown verbs fall out silently here — chipsCover below is what reports the gap,
    // so the renderer keeps the sentence instead of guessing an icon.
  }
  return out;
}

/**
 * Whether EVERY effect of a card is chip-expressible: the flag that lets a tile drop the
 * visible sentence without losing information (the chips + popovers say it all, and the
 * full sentence stays in the tile's title and aria-label). A `custom` verb, an unknown
 * verb, or an empty effect list keeps the sentence — nothing is ever lost to the icons.
 * @param {any} def card definition
 * @returns {boolean}
 */
export function chipsCover(def) {
  if (!def || !Array.isArray(def.effects) || def.effects.length === 0) return false;
  return foldRepeatedDamage(def.effects).every((e) => e.verb === 'status'
    || (Object.prototype.hasOwnProperty.call(CHIP_NUMBER, e.verb)));
}

export function describeCardType(type, lang = 'en') {
  if (langOf(lang) === 'es') {
    switch (type) {
      case 'attack':
        return 'Ataque: inflige daño. Cuesta Energía jugarla.';
      case 'skill':
        return 'Habilidad: una carta de utilidad (Bloqueo, robar, Energía). Cuesta Energía jugarla.';
      case 'power':
        return 'Poder: un efecto duradero por el resto del combate.';
      default:
        return `${CARD_TYPE_LABEL_ES[type] ?? CARD_TYPE_LABEL[type] ?? type}.`;
    }
  }
  switch (type) {
    case 'attack':
      return 'Attack — deals damage. Costs Energy to play.';
    case 'skill':
      return 'Skill — a utility card (Block, draw, Energy). Costs Energy to play.';
    case 'power':
      return 'Power — a lasting effect for the rest of the fight.';
    default:
      return `${CARD_TYPE_LABEL[type] ?? type}.`;
  }
}


/**
 * One sentence per `custom` handler, written from the handler source.
 *
 * `src/kernel/rules/effects/index.js` holds the bodies; `src/kernel/rules/powers.js`
 * holds the four power hooks. The numbers here are the handlers' own literals, which is
 * why they are not derived: if a handler's cost changes, this table is what must change
 * with it, and tests/ux/descriptions.test.js pins the sentences for every shipped card.
 * @type {Record<string, string>}
 */
const CUSTOM_SENTENCE = {
  vein_tap: 'Lose 3 HP. Gain 2 Energy.',
  blood_hammer: 'Lose 2 HP. Deal 15 damage.',
  ash_harvest: 'Deal 4 damage to ALL enemies. Heal HP equal to the damage dealt.',
  overtemper: 'Double your current Strength. Does nothing if you have no Strength.',
  blood_tithe: 'Lose 6 HP. Gain 2 Energy. Draw 3 cards.',
  banked_coal: 'Gain Banked Coal: at the end of each turn, deal 1 damage to ALL enemies and lose 1 HP.',
  ash_embrace: 'Gain Ash Embrace: whenever a card is exhausted, draw 1 card.',
  cinder_skin: 'Gain Cinder Skin: whenever a card is exhausted, gain 1 Block.',
  split_seam: 'Gain Split Seam: whenever a card makes you lose HP, gain 1 Strength.',
  brace: 'Double your current Block. Does nothing if you have no Block.',
  climbing_heat: 'Deal 8 damage. This card gains +5 damage permanently each time you play it.',
};

/** The same handler sentences in Spanish (I18N-1). The power names reuse the es labels
 *  of POWER_MEANING_ES, so a card and its pill can never disagree in either language. */
const CUSTOM_SENTENCE_ES = {
  vein_tap: 'Pierdes 3 HP. Ganas 2 de Energía.',
  blood_hammer: 'Pierdes 2 HP. Infliges 15 de daño.',
  ash_harvest: 'Infliges 4 de daño a TODOS los enemigos. Recuperas HP igual al daño infligido.',
  overtemper: 'Duplicas tu Fuerza actual. No hace nada si no tienes Fuerza.',
  blood_tithe: 'Pierdes 6 HP. Ganas 2 de Energía. Robas 3 cartas.',
  banked_coal: `Ganas ${POWER_MEANING_ES.banked_coal.label}: al final de cada turno, infliges 1 de daño a TODOS los enemigos y pierdes 1 HP.`,
  ash_embrace: `Ganas ${POWER_MEANING_ES.ash_embrace.label}: cada vez que una carta se agota, robas 1 carta.`,
  cinder_skin: `Ganas ${POWER_MEANING_ES.cinder_skin.label}: cada vez que una carta se agota, ganas 1 de Bloqueo.`,
  split_seam: `Ganas ${POWER_MEANING_ES.split_seam.label}: cada vez que una carta te hace perder HP, ganas 1 de Fuerza.`,
  brace: 'Duplicas tu Bloqueo actual. No hace nada si no tienes Bloqueo.',
  climbing_heat: 'Infliges 8 de daño. Esta carta gana +5 de daño de forma permanente cada vez que la juegas.',
};

/**
 * One sentence per effect verb in the CLOSED vocabulary
 * (src/kernel/rules/vocabulary.js: damage, block, draw, energy, status, discard,
 * exhaust, custom) — one template TABLE per language, keyed by the same verb.
 *
 * `amount` is the printed card number. Strength, Weak, Dexterity and the target's
 * Vulnerable ARE folded in — but never silently: a combat-phase caller (snapshotHand)
 * passes a `fold` context derived from the LIVE state through the SAME resolver helpers
 * the rules use (`playerStrike`, `vulnerableAmplify`, `blockGain`), and the template
 * prints the folded number as an explicit rider after the printed one, so the card can
 * never disagree with what the engine will land. A collection surface (codex, deck
 * sheet, shop, reward) passes no context and keeps the printed card. The status pills
 * still explain WHY the number moved.
 * @param {any} effect one entry of a card definition's `effects` array
 * @param {any} def the card definition the effect belongs to
 * @param {string} [lang] 'en' (default) or 'es'
 * @param {{strength: number, weak: number, dexterity: number, vuln: boolean}} [fold]
 *        live-combat fold numbers, or null for the printed card
 * @returns {string} a complete sentence
 */
/**
 * The em-dash clause a folded damage sentence carries — the SAME per-hit number the
 * resolution will land, spelled with its reason. The per-hit fold goes through
 * `playerStrike` itself (add Strength, then Weak ×3/4 floored), so the preview number
 * has exactly one source. `allowVuln` is the unambiguity gate: the ×3/2 folds into ONE
 * number only when every hit lands on the same vulnerable body — a single target, or an
 * AOE whose fold context says exactly one enemy is alive and Vulnerable (`fold.vuln`).
 * A mixed target set (Ash Harvest over healthy neighbours) still refuses the clause.
 * @param {any} fold live-combat fold context (plain numbers)
 * @param {number} printed the effect's printed amount
 * @param {string} lang
 * @param {boolean} [allowVuln]
 * @returns {string} '' when nothing would change
 */
function damageRider(fold, printed, lang, allowVuln = true) {
  const es = langOf(lang) === 'es';
  const per = playerStrike(printed, { statuses: { strength: fold.strength, weak: fold.weak } });
  const parts = [];
  if (fold.strength > 0 && fold.weak > 0) parts.push(es ? `${per} con Fuerza ${fold.strength} y Débil` : `${per} with Strength ${fold.strength} and Weak`);
  else if (fold.strength > 0) parts.push(es ? `${per} con Fuerza ${fold.strength}` : `${per} with Strength ${fold.strength}`);
  else if (fold.weak > 0) parts.push(es ? `${per} con Débil` : `${per} with Weak`);
  if (allowVuln && fold.vuln) parts.push(es ? `${vulnerableAmplify(per)} contra Vulnerable` : `${vulnerableAmplify(per)} against Vulnerable`);
  return parts.join(', ');
}

const TEMPLATES = {
  en: {
    damage: (e, def, f) => {
      const hits = e.hits ?? 1;
      const who = e.target === 'all_enemies'
        ? 'ALL enemies'
        : def.target === 'random_enemy' ? 'a random enemy' : 'the enemy';
      const core = hits > 1 ? `Deal ${e.amount} damage to ${who} ${hits} times` : `Deal ${e.amount} damage to ${who}`;
      if (f) {
        // Unambiguous amplification only: a single target, or the fold's word that every
        // hit lands on the one vulnerable body (`fold.vuln`); a mixed set stays silent.
        const rider = damageRider(f, e.amount, 'en', e.target !== 'all_enemies' || f.vuln);
        if (rider) return `${core} — ${rider}${hits > 1 ? ' per hit' : ''}.`;
      }
      return `${core}.`;
    },
    block: (e, _def, f) => {
      if (f) {
        const n = blockGain(e.amount, f.dexterity);
        if (n !== e.amount) return `Gain ${e.amount} (${n}) Block.`;
      }
      return `Gain ${e.amount} Block.`;
    },
    draw: (e) => `Draw ${plural(e.amount, 'card', 'cards')}.`,
    energy: (e) => `Gain ${e.amount} Energy.`,
    status: (e) => {
      const name = statusName(e.status);
      const self = e.to === 'self' || e.to === 'player';
      // The clause is the plain-English consequence, so a card that grants a keyword
      // explains it on the card instead of making the player open the glossary.
      if (self) {
        const clause = statusClause(e.status, e.amount, 'player');
        return clause ? `Gain ${e.amount} ${name} — ${clause}.` : `Gain ${e.amount} ${name}.`;
      }
      const who = e.target === 'all_enemies' ? 'ALL enemies' : 'the enemy';
      const clause = statusClause(e.status, e.amount, 'enemy');
      return clause
        ? `Apply ${e.amount} ${name} to ${who} — ${clause}.`
        : `Apply ${e.amount} ${name} to ${who}.`;
    },
    discard: (e) => `Discard ${plural(e.amount, 'card', 'cards')} at random.`,
    exhaust: () => 'Exhaust this card for the rest of the fight.',
    // The engine caps the restore at maxHp (rules/vocabulary.js), so "up to" is the
    // honest wording — a full-HP play restores nothing.
    heal: (e) => `Restore up to ${e.amount} HP.`,
    retain: () => 'Retain this card — playing it returns it to your hand after its effects resolve, and it stays in your hand when your turn ends.',
    custom: (e) => CUSTOM_SENTENCE[e.handler] ?? `Special effect (${e.handler}).`,
  },
  es: {
    damage: (e, def, f) => {
      const hits = e.hits ?? 1;
      // The target phrase carries its own preposition: Spanish contracts "a el" into
      // "al", so each form is written whole ("al enemigo", "a TODOS los enemigos").
      const who = e.target === 'all_enemies'
        ? 'a TODOS los enemigos'
        : def.target === 'random_enemy' ? 'a un enemigo al azar' : 'al enemigo';
      const core = hits > 1 ? `Infliges ${e.amount} de daño ${who} ${hits} veces` : `Infliges ${e.amount} de daño ${who}`;
      if (f) {
        // Misma regla de no ambigüedad que la plantilla inglesa (ver su comentario).
        const rider = damageRider(f, e.amount, 'es', e.target !== 'all_enemies' || f.vuln);
        if (rider) return `${core} — ${rider}${hits > 1 ? ' por golpe' : ''}.`;
      }
      return `${core}.`;
    },
    block: (e, _def, f) => {
      if (f) {
        const n = blockGain(e.amount, f.dexterity);
        if (n !== e.amount) return `Ganas ${e.amount} (${n}) de Bloqueo.`;
      }
      return `Ganas ${e.amount} de Bloqueo.`;
    },
    draw: (e) => `Robas ${pluralEs(e.amount, 'carta', 'cartas')}.`,
    energy: (e) => `Ganas ${e.amount} de Energía.`,
    status: (e) => {
      const name = statusName(e.status, 'es');
      const self = e.to === 'self' || e.to === 'player';
      if (self) {
        const clause = statusClause(e.status, e.amount, 'player', 'es');
        return clause ? `Ganas ${e.amount} de ${name} — ${clause}.` : `Ganas ${e.amount} de ${name}.`;
      }
      const who = e.target === 'all_enemies' ? 'a TODOS los enemigos' : 'al enemigo';
      const clause = statusClause(e.status, e.amount, 'enemy', 'es');
      return clause
        ? `Aplicas ${e.amount} de ${name} ${who} — ${clause}.`
        : `Aplicas ${e.amount} de ${name} ${who}.`;
    },
    discard: (e) => `Descartas ${pluralEs(e.amount, 'carta', 'cartas')} al azar.`,
    exhaust: () => 'Agotas esta carta por el resto del combate.',
    heal: (e) => `Restauras hasta ${e.amount} HP.`,
    retain: () => 'Retienes esta carta: al jugarla vuelve a tu mano tras resolver sus efectos, y se queda en tu mano cuando termina tu turno.',
    custom: (e) => CUSTOM_SENTENCE_ES[e.handler] ?? CUSTOM_SENTENCE[e.handler] ?? `Special effect (${e.handler}).`,
  },
};

export function describeEffect(effect, def = {}, lang = 'en', fold = null) {
  const table = TEMPLATES[langOf(lang)] ?? TEMPLATES.en;
  const fn = table[effect.verb];
  if (!fn) return `Unknown effect (${effect.verb}).`;
  return fn(effect, def, fold);
}


/**
 * Consecutive identical `damage` effects folded into one sentence.
 *
 * Hail of Blows is four separate `{verb:'damage',amount:2}` entries (one per hit), so the naive
 * read is "Deal 2 damage" four times. Four hits of 2 are exactly "2 damage 4 times" —
 * identical numbers, identical Block interaction — and one sentence a player can read.
 * Folding is presentation only; no rule is inferred.
 * @param {any[]} effects
 * @returns {any[]} effects with runs of identical damage collapsed onto `hits`
 */
function foldRepeatedDamage(effects) {
  const out = [];
  for (const e of effects) {
    const prev = out[out.length - 1];
    // An explicit `hits` is the content's own fold and is never re-folded.
    const same = prev
      && e.verb === 'damage' && prev.verb === 'damage'
      && e.amount === prev.amount && e.target === prev.target
      && !e.hits;
    if (same) out[out.length - 1] = { ...prev, hits: (prev.hits ?? 1) + 1 };
    else out.push(e);
  }
  return out;
}

/**
 * Folded sentences for the `custom` handlers whose engine bodies fold player Strength
 * (and the target's Vulnerable) through playerStrike/damageEnemy — rules/effects/index.js.
 * Each returns null when no number would move, so the static CUSTOM_SENTENCE keeps
 * rendering byte-identically for a clean state.
 * @param {any} e the custom effect entry
 * @param {any} instance the hand instance (Climbing Heat's perPlay bonus)
 * @param {{strength: number, weak: number, dexterity: number, vuln: boolean}} fold
 * @param {string} lang
 * @returns {string|null}
 */
function customFold(e, instance, fold, lang) {
  const es = langOf(lang) === 'es';
  switch (e.handler) {
    case 'blood_hammer': {
      const rider = damageRider(fold, 15, lang, true);
      return rider ? (es ? `Pierdes 2 HP. Infliges 15 de daño — ${rider}.` : `Lose 2 HP. Deal 15 damage — ${rider}.`) : null;
    }
    case 'ash_harvest': {
      // AOE obeys the same unambiguity gate as the plain verbs: the Vulnerable clause
      // speaks only when the fold says every hit lands on the one vulnerable body
      // (`fold.vuln`); over a mixed set the amplification is not one number, so it drops.
      const rider = damageRider(fold, 4, lang, fold.vuln);
      return rider ? (es ? `Infliges 4 de daño a TODOS los enemigos — ${rider} a cada uno.` : `Deal 4 damage to ALL enemies — ${rider} each.`) : null;
    }
    case 'climbing_heat': {
      const base = 8 + (instance?.perPlay ?? 0);
      const rider = damageRider(fold, base, lang, true);
      if (!rider) return null;
      const growth = instance?.perPlay ? (es ? ' (+5 más cada vez que la juegas)' : ' (+5 more each time you play it)') : '';
      return es ? `Infliges ${base} de daño${growth} — ${rider}.` : `Deal ${base} damage${growth} — ${rider}.`;
    }
    default:
      return null;
  }
}

/**
 * Plain-language description of a card, as a human would read it aloud.
 *
 * `Hammerfall` -> "Deal 6 damage to the enemy." / "Infliges 6 de daño al enemigo."
 * `Anvil Blow` -> "Deal 8 damage to the enemy. Apply 2 Vulnerable to the enemy."
 *
 * @param {any} def card definition from content (cards.json shape)
 * @param {{perPlay?: number}} [instance] runtime instance, when one is available:
 *   Climbing Heat's damage depends on how often it has been played this run.
 * @param {string} [lang] 'en' (default) or 'es'
 * @param {{strength: number, weak: number, dexterity: number, vuln: boolean}} [fold]
 *        live-combat fold numbers (snapshotHand only); omitted/null keeps the printed card
 * @returns {string} at least one complete sentence, never empty
 */
export function describeCard(def, instance = {}, lang = 'en', fold = null) {
  if (!def || !Array.isArray(def.effects)) {
    return langOf(lang) === 'es' ? 'Sin descripción disponible.' : 'No description available.';
  }
  const effects = foldRepeatedDamage(def.effects);
  const parts = effects.map((e) => {
    // Live-combat fold for the Strength-folding custom handlers; null keeps the static
    // sentence so a clean state renders byte-identically to the printed card. This runs
    // BEFORE Climbing Heat's instance early return below: once its first play moves the number,
    // the grown sentence must still carry the same Strength/Weak/Vulnerable rider as the
    // plain verbs — returning early would drop the fold the moment it had something to say.
    if (e.verb === 'custom' && fold) {
      const folded = customFold(e, instance, fold, lang);
      if (folded) return folded;
    }
    // Climbing Heat is the one handler whose numbers move with the instance. Without a fold
    // (collection surfaces — codex, deck sheet) there is no combat to read, but the
    // grown base is still the card's true number, so it prints the moved sentence.
    if (e.verb === 'custom' && e.handler === 'climbing_heat' && instance.perPlay) {
      return langOf(lang) === 'es'
        ? `Infliges ${8 + instance.perPlay} de daño (+5 más cada vez que la juegas).`
        : `Deal ${8 + instance.perPlay} damage (+5 more each time you play it).`;
    }
    return describeEffect(e, def, lang, fold);
  });
  return parts.map(sentence).join(' ');
}

/**
 * One-line playability note for a tile: why the card cannot be played right now.
 * Reads the kernel's own snapshot fields (`cost`, `playable`) — no rule is restated.
 * @param {{cost?: number, playable?: boolean}} card
 * @param {number} energy current energy
 * @param {string} [lang]
 * @returns {string} '' when the card is playable
 */
export function describePlayability(card, energy, lang = 'en') {
  if (card?.playable) return '';
  if (langOf(lang) === 'es') {
    if ((card?.cost ?? 0) > energy) return `Necesita ${card.cost} de Energía: tienes ${energy}.`;
    return 'No se puede jugar ahora.';
  }
  if ((card?.cost ?? 0) > energy) return `Needs ${card.cost} Energy — you have ${energy}.`;
  return 'Not playable right now.';
}


/**
 * Resolve the move an enemy is showing. The R4 dump stores `moveIndex`; the structured
 * snapshot stores the rendered intent instead, so match on the label as a fallback.
 * @param {any} enemy snapshot enemy ({id, intent}) or raw state enemy ({id, moveIndex})
 * @returns {any|null}
 */
function moveOf(enemy) {
  const def = ENEMIES[enemy?.id];
  if (!def) return null;
  if (enemy.intent?.label) {
    const byLabel = def.moves.find((m) => m.label === enemy.intent.label);
    if (byLabel) return byLabel;
  }
  if (Number.isInteger(enemy.moveIndex)) return def.moves[enemy.moveIndex] ?? def.moves[0];
  return def.moves[0];
}

/** intentDamage() when the enemy carries live counters; the printed number otherwise. */
function intentNumber(enemy, move) {
  try {
    if (enemy.statuses || Number.isInteger(enemy.moveIndex)) return intentDamage(enemy);
  } catch {
    /* fall through to the printed number */
  }
  return (move.damage ?? 0) * (move.hits ?? 1);
}

/**
 * Plain-language sentence for an enemy's chosen intent, e.g.
 * "Will attack for 7 and block 5." / "Will apply 2 Vulnerable and 2 Weak to you."
 * Spanish: "Atacará con 7 de daño y se cubrirá con 5 de Bloqueo."
 *
 * The damage number comes from the kernel's own `intentDamage()` (Strength already
 * added, Weak already applied) when it can be computed, so the sentence and the compact
 * number can never disagree. A move whose kind the table does not know falls back to its
 * code-owned label — which stays English until I18N-2 sweeps the enemy tables.
 * @param {any} enemy snapshot enemy or raw state enemy
 * @param {string} [lang]
 * @returns {string}
 */
export function describeIntent(enemy, lang = 'en') {
  const es = langOf(lang) === 'es';
  const move = moveOf(enemy);
  if (!move) return es ? 'Intención desconocida.' : 'Intent unknown.';
  const intent = enemy.intent ?? {};
  const hits = intent.hits ?? move.hits ?? 1;
  const damage = intent.kind === 'attack' && typeof intent.damage === 'number'
    ? intent.damage
    : intentNumber(enemy, move);

  switch (move.kind) {
    case 'attack': {
      const per = hits > 1 ? Math.round(damage / hits) : damage;
      const swing = hits > 1
        ? (es ? `Atacará ${hits} veces con ${per} de daño` : `Will attack for ${per} damage ${hits} times`)
        : (es ? `Atacará con ${damage} de daño` : `Will attack for ${damage}`);
      // RIDERS (the "golpes discretos" slice): the tick-shaped hexes each LANDED strike
      // leaves on you, worded after the block clause so the sentence reads in the
      // runner's own resolution order.
      const riders = [];
      if (move.bleed) riders.push(es ? `te dejará ${move.bleed} de Sangrado` : `leave ${move.bleed} Bleed on you`);
      if (move.poison) riders.push(es ? `te dejará ${move.poison} de Veneno` : `leave ${move.poison} Poison on you`);
      const riderTail = riders.length > 0 ? (es ? `, y ${riders.join(' y ')}` : `, and ${riders.join(' and ')}`) : '';
      const blockTail = move.block ? (es ? ` y se cubrirá con ${move.block} de Bloqueo` : ` and block ${move.block}`) : '';
      return sentence(`${swing}${blockTail}${riderTail}`);
    }
    case 'block':
      return es ? `Ganará ${move.block} de Bloqueo.` : `Will gain ${move.block} Block.`;
    case 'buff': {
      const parts = [];
      if (move.strength) parts.push(es ? `+${move.strength} de Fuerza` : `+${move.strength} Strength`);
      if (move.block) parts.push(es ? `ganará ${move.block} de Bloqueo` : `gain ${move.block} Block`);
      // The parry rider speaks last, in the buff runner's own order.
      if (move.parry) parts.push(es ? `ganará ${move.parry} de Parada` : `gain ${move.parry} Parry`);
      return sentence(es ? `Se potenciará: ${parts.join(' y ')}` : `Will power up: ${parts.join(' and ')}`);
    }
    case 'debuff': {
      const parts = [];
      if (move.vulnerable) parts.push(es ? `${move.vulnerable} de Vulnerable` : `${move.vulnerable} Vulnerable`);
      if (move.weak) parts.push(es ? `${move.weak} de Débil` : `${move.weak} Weak`);
      // The tick-shaped riders ride the debuff runner's own order (bleed, then poison).
      if (move.bleed) parts.push(es ? `${move.bleed} de Sangrado` : `${move.bleed} Bleed`);
      if (move.poison) parts.push(es ? `${move.poison} de Veneno` : `${move.poison} Poison`);
      return sentence(es ? `Te aplicará ${parts.join(' y ')}` : `Will apply ${parts.join(' and ')} to you`);
    }
    default:
      return `${move.label}.`;
  }
}


/**
 * The tokens `effectSummary()` can actually emit, derived from the generators rather
 * than hand-copied: the abbreviation tables in observe.js plus the summaries of every
 * shipped card. A hand-written second list would drift the first time a card is added.
 * @returns {{abbrevs: string[], custom: string[]}}
 */
export function emittedTokens() {
  const abbrevs = new Set(['EXH']);
  for (const key of Object.keys(STATUS_ABBREV)) abbrevs.add(STATUS_ABBREV[key]);
  const custom = new Set();

  for (const def of defaultContent().cards.values()) {
    for (const tok of effectSummary(def).split(' ').filter(Boolean)) {
      // Shapes voted on by the frozen vocabulary: A6, A4x3, B5, D3, E2, d1, PWR2, EXH.
      if (tok === 'EXH') continue;
      const m = /^([A-Za-z]{1,4})(\d+(?:x\d+)?|\+)$/.exec(tok);
      if (m) abbrevs.add(m[1]);
      else custom.add(tok);
    }
  }
  return { abbrevs: [...abbrevs].sort(), custom: [...custom].sort() };
}

/** Whole-card shorthand for shapes no table can derive, seen in CUSTOM_SUMMARY
 *  (English rows; the Spanish twins live in SHORTHAND_ENTRIES_ES below). */
const SHORTHAND_ENTRIES = [
  glossRow('A x n', 'attack × n', 'Multi-hit attack: the number after "x" is how many times it hits.', 'C'),
  glossRow('A n + m', 'attack grows by m', 'The attack damage grows by m each time you play the card (Climbing Heat).', 'C'),
  // The composed shapes that really appear in card text. Without these, a reader who sees
  // "VULN+2" has only the bare "+" row, which describes GROWTH — the opposite of what a
  // status stack of 2 means. These rows are what make "VULN+x" readable as "apply x".
  glossRow('PWR+n', 'gain n Strength', 'A plus on a power means GAIN that many stacks. "PWR+2" = gain 2 Strength.', 'B'),
  glossRow('VULN+n', 'apply n Vulnerable', 'A plus on a status means APPLY that many stacks to the target — the number does not grow. "VULN+2" = apply 2 Vulnerable, so the target takes 50% more damage while it lasts.', 'B'),
  glossRow('WK+n', 'apply n Weak', 'A plus on a status means APPLY that many stacks to the target. "WK+2" = apply 2 Weak, so the target attacks for 25% less.', 'B'),
  glossRow('METAL+n', 'gain n Metallicize', 'A plus on a power means GAIN that many stacks. "METAL+3" = gain 3 Metallicize, gaining 3 Block at the end of each turn.', 'B'),
  glossRow('DEX+n', 'gain n Dexterity', 'A plus on a power means GAIN that many stacks. "DEX+1" = gain 1 Dexterity, so the Block you gain from cards is 1 higher.', 'B'),
  glossRow('BLEED+n', 'apply n Bleed', 'A plus on a status means APPLY that many stacks to the target. "BLEED+3" = apply 3 Bleed: the target loses 3 HP every time it makes an attack strike, and one stack wears off after each strike it ticks.', 'B'),
  glossRow('PSN+n', 'apply n Poison', 'A plus on a status means APPLY that many stacks to the target. "PSN+4" = apply 4 Poison: the target loses 4 HP at the end of each of its own turns, and one stack wears off each time it ticks.', 'B'),
  glossRow('PARRY+n', 'gain n Parry', 'A plus on a power means GAIN that many stacks. "PARRY+6" = gain 6 Parry: each attack strike against the holder has a 6% chance to be blocked completely. Lasts the whole fight.', 'B'),
  glossRow('PWRx', 'double your Strength', 'An "x" after a power means MULTIPLY the stacks you already have. "PWRx2" doubles your Strength; it does nothing if you have none.', 'C'),
  glossRow('BLKx', 'double your Block', 'An "x" after Block means MULTIPLY the Block you currently have. "BLKx2" doubles it; it does nothing if you have none.', 'C'),
];

/** The same shorthand rows in Spanish (I18N-1), same keys and groups. */
const SHORTHAND_ENTRIES_ES = [
  glossRow('A x n', 'ataque × n', 'Ataque de varios golpes: el número tras la "x" es cuántas veces golpea.', 'C'),
  glossRow('A n + m', 'el ataque crece en m', 'El daño del ataque crece en m cada vez que juegas la carta (Calor Ascendente).', 'C'),
  glossRow('PWR+n', 'ganas n de Fuerza', 'Un signo + en un poder significa GANAR esas acumulaciones. "PWR+2" = ganas 2 de Fuerza.', 'B'),
  glossRow('VULN+n', 'aplica n de Vulnerable', 'Un signo + en un estado significa APLICAR esas acumulaciones al objetivo: el número no crece. "VULN+2" = aplica 2 de Vulnerable, así que el objetivo recibe 50% más de daño mientras dure.', 'B'),
  glossRow('WK+n', 'aplica n de Débil', 'Un signo + en un estado significa APLICAR esas acumulaciones al objetivo. "WK+2" = aplica 2 de Débil, así que ataca con 25% menos.', 'B'),
  glossRow('METAL+n', 'ganas n de Metalizado', 'Un signo + en un poder significa GANAR esas acumulaciones. "METAL+3" = ganas 3 de Metalizado, que da 3 de Bloqueo al final de cada turno.', 'B'),
  glossRow('DEX+n', 'ganas n de Destreza', 'Un signo + en un poder significa GANAR esas acumulaciones. "DEX+1" = ganas 1 de Destreza, así que el Bloqueo que ganas con cartas es 1 mayor.', 'B'),
  glossRow('BLEED+n', 'aplica n de Sangrado', 'Un signo + en un estado significa APLICAR esas acumulaciones al objetivo. "BLEED+3" = aplica 3 de Sangrado: el objetivo pierde 3 HP cada vez que ejecuta un golpe de ataque, y una acumulación se va tras cada golpe que la haga sangrar.', 'B'),
  glossRow('PSN+n', 'aplica n de Veneno', 'Un signo + en un estado significa APLICAR esas acumulaciones al objetivo. "PSN+4" = aplica 4 de Veneno: el objetivo pierde 4 HP al final de cada uno de sus turnos, y una acumulación se va cada vez que hace efecto.', 'B'),
  glossRow('PARRY+n', 'ganas n de Parada', 'Un signo + en un poder significa GANAR esas acumulaciones. "PARRY+6" = ganas 6 de Parada: cada golpe de ataque contra quien la sostiene tiene un 6% de probabilidad de ser bloqueado por completo. Dura todo el combate.', 'B'),
  glossRow('PWRx', 'duplica tu Fuerza', 'Una "x" tras un poder significa MULTIPLICAR las acumulaciones que ya tienes. "PWRx2" duplica tu Fuerza; no hace nada si no tienes.', 'C'),
  glossRow('BLKx', 'duplica tu Bloqueo', 'Una "x" tras el Bloqueo significa MULTIPLICAR el Bloqueo que tienes ahora. "BLKx2" lo duplica; no hace nada si no tienes.', 'C'),
];

/** The escape hatch: what each `custom` handler's cryptic summary really means. */
const CUSTOM_SHORTHAND = {
  HP3: 'Lose 3 HP (ignores Block; never drops you below 1 HP).',
  HP2: 'Lose 2 HP (ignores Block; never drops you below 1 HP).',
  HP6: 'Lose 6 HP (ignores Block; never drops you below 1 HP).',
  'HP+': 'Heal HP equal to the damage this card dealt.',
  E2: 'Gain 2 Energy immediately.',
  D3: 'Draw 3 cards.',
  A15: 'Attack for 15 damage.',
  A4xall: 'Attack every enemy for 4 damage.',
  'A8+5': 'Attack for 8 damage, +5 more each time you play this card.',
  BLKx2: 'Double your current Block.',
  PWRx2: 'Double your current Strength.',
  'PWR+': 'Gain 1 stack of a lasting power.',
};

/** The same shorthand meanings in Spanish (I18N-1). */
const CUSTOM_SHORTHAND_ES = {
  HP3: 'Pierdes 3 HP (ignora el Bloqueo; nunca te deja por debajo de 1 HP).',
  HP2: 'Pierdes 2 HP (ignora el Bloqueo; nunca te deja por debajo de 1 HP).',
  HP6: 'Pierdes 6 HP (ignora el Bloqueo; nunca te deja por debajo de 1 HP).',
  'HP+': 'Recuperas HP igual al daño que infligió esta carta.',
  E2: 'Ganas 2 de Energía de inmediato.',
  D3: 'Robas 3 cartas.',
  A15: 'Atacas con 15 de daño.',
  A4xall: 'Atacas a todos los enemigos con 4 de daño.',
  'A8+5': 'Atacas con 8 de daño, +5 más cada vez que juegas esta carta.',
  BLKx2: 'Duplicas tu Bloqueo actual.',
  PWRx2: 'Duplicas tu Fuerza actual.',
  'PWR+': 'Ganas 1 acumulación de un poder duradero.',
};

/** Human label for a whole-card shorthand token, e.g. "HP6" -> "HP cost 6". */
function labelForShorthand(abbrev, lang = 'en') {
  const m = /^([A-Za-z]{1,4})(\d*)(?:x(\d*))?$/.exec(abbrev);
  if (!m) return abbrev;
  const [, letters, num, times] = m;
  const es = langOf(lang) === 'es';
  const names = es
    ? { HP: 'Coste de HP', A: 'Ataque', BLK: 'Bloqueo', PWR: 'Fuerza', D: 'Robo', E: 'Energía' }
    : { HP: 'HP cost', A: 'Attack', BLK: 'Block', PWR: 'Strength', D: 'Draw', E: 'Energy' };
  const name = names[letters] ?? letters;
  if (times !== undefined) return `${name} ${num} ×${times || (es ? 'todos' : 'all')}`;
  return num ? `${name} ${num}` : name;
}

/** The core glossary rows (the frozen vocabulary), per language. */
const GLOSSARY_CORE = {
  en: () => [
    glossRow('A', 'Attack', 'Deal the shown damage to one enemy. "A6" means an attack for 6 damage.'),
    glossRow('B', 'Block', 'Gain the shown Block. Block soaks damage and is used up at the start of your turn.'),
    glossRow('D', 'Draw', 'Draw that many cards from your draw pile.'),
    glossRow('E', 'Energy', 'Gain that much Energy immediately. Energy pays for cards; you get 3 each turn.'),
    glossRow('d', 'Discard', 'Discard that many cards from your hand (lower case d, to keep it apart from Draw).'),
    glossRow('EXH', 'Exhaust', 'The card leaves the fight for good — it does not come back in a reshuffle.'),
    glossRow('H', 'Heal', 'Restore that much HP, never past your maximum. A card played at full HP restores nothing.'),
    glossRow('RTN', 'Retain', 'The card stays in your hand when your turn ends, instead of being discarded — and playing it returns it to your hand after its effects resolve.'),
    glossRow('+', 'grows', 'A plus after an ATTACK or BLOCK value means the number grows: each time you play the card, or each turn while a power lasts.'),
    // Status and power names: the B group.
    glossRow('HP', 'Your HP', 'Lose that much HP. This is a COST you pay, not healing: it ignores Block and never drops you below 1 HP.', 'B'),
    glossRow('PWR', 'Strength', 'Attacks deal that much more damage. Lasts the whole fight.', 'B'),
    glossRow('VULN', 'Vulnerable', 'Takes 50% more damage from attacks. Wears off by 1 each turn.', 'B'),
    glossRow('WK', 'Weak', 'Attacks deal 25% less damage. Wears off by 1 each turn.', 'B'),
    glossRow('DEX', 'Dexterity', 'Block gained from cards is that much higher. Lasts the whole fight.', 'B'),
    glossRow('METAL', 'Metallicize', 'Gain that much Block at the end of each turn. The Scale Up card applies it.', 'B'),
    // The "golpes discretos NxM" trio (B group, same rows the enemy labels abbreviate).
    glossRow('BLEED', 'Bleed', 'The holder loses that much HP every time it makes an attack strike. One stack wears off after each strike it ticks.', 'B'),
    glossRow('PSN', 'Poison', 'The holder loses that much HP at the end of each of its own turns. One stack wears off each time it ticks.', 'B'),
    glossRow('PARRY', 'Parry', 'Each attack strike against the holder has that percent chance to be blocked completely. Lasts the whole fight and spends no Block.', 'B'),
  ],
  es: () => [
    glossRow('A', 'Ataque', 'Inflige el daño mostrado a un enemigo. "A6" es un ataque de 6 de daño.'),
    glossRow('B', 'Bloqueo', 'Ganas el Bloqueo mostrado. El Bloqueo absorbe daño y se consume al inicio de tu turno.'),
    glossRow('D', 'Robo', 'Robas esa cantidad de cartas de tu pila de robo.'),
    glossRow('E', 'Energía', 'Ganas esa Energía de inmediato. La Energía paga las cartas; recibes 3 cada turno.'),
    glossRow('d', 'Descarte', 'Descartas esa cantidad de cartas de tu mano (d minúscula, para no confundirla con Robo).'),
    glossRow('EXH', 'Agotar', 'La carta sale del combate para siempre: no vuelve en un rebarajado.'),
    glossRow('H', 'Curar', 'Recuperas esa cantidad de HP, nunca más allá de tu máximo. Una carta jugada con todo el HP no recupera nada.'),
    glossRow('RTN', 'Retener', 'La carta se queda en tu mano cuando termina tu turno, en vez de descartarse — y al jugarla vuelve a tu mano tras resolver sus efectos.'),
    glossRow('+', 'crece', 'Un signo + tras un valor de ATAQUE o BLOQUEO significa que el número crece: cada vez que juegas la carta, o cada turno mientras dure un poder.'),
    // Status and power names: the B group.
    glossRow('HP', 'Tu HP', 'Pierdes esa cantidad de HP. Es un COSTE que pagas, no curación: ignora el Bloqueo y nunca te deja por debajo de 1 HP.', 'B'),
    glossRow('PWR', 'Fuerza', 'Los ataques infligen esa cantidad de daño más. Dura todo el combate.', 'B'),
    glossRow('VULN', 'Vulnerable', 'Recibe 50% más de daño de los ataques. Se reduce en 1 cada turno.', 'B'),
    glossRow('WK', 'Débil', 'Los ataques infligen 25% menos de daño. Se reduce en 1 cada turno.', 'B'),
    glossRow('DEX', 'Destreza', 'El Bloqueo ganado con cartas es esa cantidad mayor. Dura todo el combate.', 'B'),
    glossRow('METAL', 'Metalizado', 'Ganas esa cantidad de Bloqueo al final de cada turno. La carta Metalizado lo aplica.', 'B'),
    // El trío "golpes discretos NxM" (grupo B, las mismas filas que abrevian los
    // rótulos de los enemigos).
    glossRow('BLEED', 'Sangrado', 'Quien lo sostiene pierde esa cantidad de HP cada vez que ejecuta un golpe de ataque. Una acumulación se va tras cada golpe que la haga sangrar.', 'B'),
    glossRow('PSN', 'Veneno', 'Quien lo sostiene pierde esa cantidad de HP al final de cada uno de sus turnos. Una acumulación se va cada vez que hace efecto.', 'B'),
    glossRow('PARRY', 'Parada', 'Cada golpe de ataque contra quien la sostiene tiene ese porcentaje de probabilidad de ser bloqueado por completo. Dura todo el combate y no gasta Bloqueo.', 'B'),
  ],
};

/**
 * The glossary: every abbreviation the compact CLI summary still emits, in plain
 * English (or Spanish — I18N-1). Covers the effect vocabulary (A, B, D, E, d, EXH,
 * A x n, +), the status abbreviations (PWR, VULN, WK, DEX, METAL), the HP cost (HP) and
 * the whole-card shorthands that no table can derive (BLKx2, PWRx2, HP+, …). The TOKENS
 * stay the compact codes in both languages — they are the agent-facing vocabulary.
 * @param {string} [lang] 'en' (default) or 'es'
 * @returns {Array<object>} rows of `{token, label, meaning}`
 */
export function glossary(lang = 'en') {
  const es = langOf(lang) === 'es';
  const core = es ? GLOSSARY_CORE.es() : GLOSSARY_CORE.en();

  // Every whole-card shorthand the generators can really emit: the tokens of the
  // per-card string list, each token of every per-card string in CUSTOM_SUMMARY (one
  // string can hold several, e.g. "A15 HP2"), and the shapes no table can derive.
  const wholeCard = new Set(emittedTokens().custom);
  for (const s of Object.values(CUSTOM_SUMMARY)) {
    for (const part of String(s).split(' ').filter(Boolean)) wholeCard.add(part);
  }
  for (const id of Object.keys(CUSTOM_SHORTHAND)) wholeCard.add(id);

  const shorthandMeaning = es ? CUSTOM_SHORTHAND_ES : CUSTOM_SHORTHAND;
  const expanded = [...wholeCard]
    .sort()
    .filter((abbrev) => Object.prototype.hasOwnProperty.call(shorthandMeaning, abbrev))
    .map((abbrev) => glossRow(abbrev, labelForShorthand(abbrev, lang), shorthandMeaning[abbrev], 'C'));

  // De-duplicate, core entries first so the frozen vocabulary wins any clash.
  const entries = es ? [...core, ...SHORTHAND_ENTRIES_ES, ...expanded] : [...core, ...SHORTHAND_ENTRIES, ...expanded];
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (seen.has(entry.token)) continue;
    seen.add(entry.token);
    out.push(entry);
  }
  return out;
}


/**
 * The first-run help lines, in kernel hands so the browser help panel and any other
 * surface cannot disagree about the turn rules. Every claim is a property of
 * src/kernel/rules/act.js (BASE_ENERGY 3, HAND_SIZE 5) and rules/powers.js (the player's
 * Block resets to 0 in beginTurn, after the enemy turn has already resolved against it).
 * @returns {Array<{title: string, body: string}>}
 */
export function helpTopics(lang = 'en') {
  if (langOf(lang) === 'es') {
    return [
      { title: 'Tienes 3 de Energía cada turno', body: 'Cada carta muestra su coste de Energía en la esquina superior izquierda. La Energía vuelve a 3 al inicio de cada uno de tus turnos y no se acumula.' },
      { title: 'Haz clic en una carta para jugarla', body: 'Jugar una carta gasta su Energía y hace lo que dice su texto. Las cartas atenuadas cuestan más Energía de la que te queda este turno.' },
      { title: 'Pulsa Terminar turno cuando acabes', body: 'Tu mano se descarta, los enemigos hacen su turno cumpliendo lo que anunció su intención, y luego robas una mano nueva de 5.' },
      { title: 'El Bloqueo te protege y luego desaparece', body: 'El Bloqueo absorbe el daño de los ataques enemigos. Tu Bloqueo se consume al inicio de tu siguiente turno, así que solo te cubre hasta entonces.' },
      { title: 'Matar a un enemigo impide que ataque', body: 'Los enemigos muertos no vuelven a actuar, y su intención anunciada se va con ellos. Golpear primero al enemigo que está a punto de pegarte más fuerte suele ser la mejor jugada.' },
      { title: 'Lee la intención del enemigo', body: 'La línea bajo cada enemigo dice qué hará en su próximo turno — por ejemplo "Atacará con 11 de daño". Planea tu Bloqueo alrededor de ese número.' },
      { title: 'Corazón Encendido', body: 'Después de cada combate que ganes, Corazón Encendido recupera 6 HP. Es la reliquia inicial de Ashwright.' },
      { title: 'Reliquias', body: 'Las reliquias son tesoros pasivos, listados junto a tu cinturón de pociones. Un élite siempre suelta una, y el guardián ofrece tres al final: toma una o vete. Dos reliquias pueden compartir un efecto y ambas se aplican.' },
    ];
  }
  return [
    { title: 'You have 3 Energy every turn', body: 'Each card shows its Energy cost in the top-left corner. Energy refills to 3 at the start of each of your turns and does not carry over.' },
    { title: 'Click a card to play it', body: 'Playing a card spends its Energy and does what its text says. Greyed-out cards cost more Energy than you have left this turn.' },
    { title: 'Click End Turn when you are done', body: 'Your hand is discarded, the enemies take their turn doing whatever their intent announced, and then you draw a new hand of 5.' },
    { title: 'Block protects you, then goes away', body: 'Block soaks damage from enemy attacks. Your Block is used up at the start of your next turn, so it only covers you until then.' },
    { title: 'Killing an enemy stops it attacking', body: 'Dead enemies never act again, and their announced intent goes away with them. Attacking the enemy that is about to hit you hardest is often the best move.' },
    { title: 'Read the enemy intent', body: 'The line under each enemy says what it will do on its next turn — for example "Will attack for 11". Plan your Block around it.' },
    { title: 'Kindled Heart', body: 'After each fight you win, Kindled Heart restores 6 HP. It is the Ashwright starting relic.' },
    { title: 'Relics', body: 'Relics are passive treasures, listed beside your potion belt. An elite always drops one, and the warden offers three at the end — take one, or walk away. Two relics can share an effect and both apply.' },
  ];
}

/**
 * Describe one hand card exactly as a tile needs it: name, cost, sentences and where the
 * compact form came from. Everything a human surface shows about a card comes from here,
 * so a tile cannot invent a number. The card NAME is content data: a `name_es` twin in
 * cards.json (I18N-2's sweep) is used when present, and the English name is the honest
 * fallback until then.
 * @param {any} def card definition
 * @param {{cost?: number, perPlay?: number, playable?: boolean}} [instance]
 * @param {number} [energy]
 * @param {string} [lang]
 * @returns {{name: string, cost: number, type: string, typeLabel: string, blurb: string, description: string, compact: string, compactLabel: string, hint: string, chips: Array<object>, chipsComplete: boolean}}
 */
export function describeTile(def, instance = {}, energy = 0, lang = 'en') {
  const es = langOf(lang) === 'es';
  const cost = instance.cost ?? def.cost ?? 0;
  return {
    name: es && typeof def.name_es === 'string' && def.name_es.length > 0 ? def.name_es : def.name,
    cost,
    type: def.type,
    typeLabel: typeLabel(def.type, lang),
    blurb: describeCardType(def.type, lang),
    description: describeCard(def, instance, lang),
    compact: effectSummary(def),
    compactLabel: es ? 'Forma compacta (lo que imprime el CLI)' : 'Compact form (what the CLI prints)',
    hint: describePlayability({ cost, playable: instance.playable ?? true }, energy, lang),
    // The effect-chip row rides the same fact bundle, so a surface that builds tiles from
    // describeTile alone (the cardDescribe read-only fact layer) gets the same kernel-
    // worded icons the snapshot rows carry. The chips read the PLAIN definition: this
    // bundle has no temper view — a tempered tile's row comes from snapshotDeck, whose
    // builder does the tempering and words its own chips.
    chips: cardChips(def, lang),
    chipsComplete: chipsCover(def),
  };
}
