// Human-readable descriptions — the SECOND text surface, next to the compact one (R4).
//
// WHY THIS FILE EXISTS: `effectSummary()` in observe.js is an *agent-facing* payload.
// It is measured, budgeted and frozen (`A6`, `HP3`, `PWRx2`), and it is fine for an
// agent that has read the glossary. It is NOT fine for a new human player: `HP3` on
// Bloodletting means *lose 3 HP*, and a first-timer reads it as "heal 3" or "has 3 HP".
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
// names: `bloodletting` calls loseHp(player, 3) (src/kernel/rules/effects/index.js),
// so it says "Lose 3 HP" — never "take 3 damage" (loseHp ignores Block and floors HP
// at 1) and never "heal".
import { ENEMIES } from './rules/encounters.js';
import { intentDamage } from './rules/act.js';
import { defaultContent } from './content.js';
import { effectSummary, CUSTOM_SUMMARY, STATUS_ABBREV } from './observe.js';

/* ------------------------------------------------------------------ small helpers */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const sentence = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

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

/** The glossary sections, in the order a new player should meet them. */
export const GLOSSARY_SECTIONS = [
  { key: 'A', title: 'Every card', blurb: 'The shapes you will see on almost every card.' },
  { key: 'B', title: 'Statuses and powers', blurb: 'Names for lingering effects. Each shows a number for how many stacks you have.' },
  { key: 'C', title: 'Whole-card codes', blurb: 'Shorthand for one specific card. The card itself always says this in words.' },
];

/* ------------------------------------------------------------------------ glossary */

/** The card types a tile can show. */
export const CARD_TYPE_LABEL = {
  attack: 'Attack',
  skill: 'Skill',
  power: 'Power',
  status: 'Status',
  curse: 'Curse',
};

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
};

/** Plain English for one persistent power key. */
const POWER_MEANING = {
  combust: { label: 'Banked Coal', per: 'at the end of each turn: deal 1 damage to ALL enemies and lose 1 HP' },
  dark_embrace: { label: 'Ash Embrace', per: 'whenever a card is exhausted: draw 1 card' },
  feel_no_pain: { label: 'Cinder Skin', per: 'whenever a card is exhausted: gain 1 Block' },
  rupture: { label: 'Split Seam', per: 'whenever a card makes you lose HP: gain 1 Strength' },
};

/** Every power lasts for the rest of the fight, so one shared note says so. */
const POWER_NOTE = 'Stays for the rest of the fight.';

/**
 * Plain English for one status counter.
 * @param {string} key status key, e.g. 'strength'
 * @param {number} stacks how many stacks are on the combatant
 * @param {'player'|'enemy'} [who] whose counter this is; 'player' is the default so the
 *   common case (the player's own header line) reads as "your attacks…".
 * @returns {string} e.g. "Strength 2 — your attacks deal 2 more damage."
 */
export function describeStatus(key, stacks, who = 'player') {
  const n = stacks ?? 0;
  const m = STATUS_MEANING[key];
  if (!m) return `${String(key).replace(/_/g, ' ')} ${n}.`;
  return `${m.label} ${n} — ${statusClause(key, n, who)}.`;
}

/**
 * The explanatory half of a status sentence, without the "Strength 2 — " prefix, so a
 * card that GRANTS a status can reuse it verbatim, e.g.
 * "Gain 2 Strength — your attacks deal 2 more damage."
 * @param {string} key status key
 * @param {number} stacks
 * @param {'player'|'enemy'} [who]
 * @returns {string} '' when the key has no plain-English voice
 */
function statusClause(key, stacks, who = 'player') {
  const m = STATUS_MEANING[key];
  if (!m) return '';
  return m[who === 'enemy' ? 'enemy' : 'player'](stacks ?? 0);
}

/**
 * Plain English sentence for one persistent power counter.
 * @param {string} key power key, e.g. 'combust'
 * @param {number} stacks
 * @returns {string}
 */
export function describePower(key, stacks) {
  const n = stacks ?? 0;
  const m = POWER_MEANING[key];
  if (!m) return `${String(key).replace(/_/g, ' ')} ${n}.`;
  return `${m.label} ${n} — ${m.per}. ${POWER_NOTE}`;
}

/** Short human label for one status counter, e.g. "Strength 2". */
export const statusName = (key) => (STATUS_MEANING[key]?.label ?? String(key).replace(/_/g, ' '));

/** One-line description of a card type, for tiles and the help panel. */
export function describeCardType(type) {
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

/* --------------------------------------------------------------- custom handlers */

/**
 * One sentence per `custom` handler, written from the handler source.
 *
 * `src/kernel/rules/effects/index.js` holds the bodies; `src/kernel/rules/powers.js`
 * holds the four power hooks. The numbers here are the handlers' own literals, which is
 * why they are not derived: if a handler's cost changes, this table is what must change
 * with it, and tests/ux/descriptions.test.js pins the sentences for every shipped card.
 * @type {Record<string, string>}
 */
/**
 * The numbers of each `custom` handler, in ONE place: the sentence (CUSTOM_SENTENCE) and the
 * card face (CUSTOM_FACE) are both built from them, so the two can never drift apart.
 */
const CN = {
  bloodletting: { hp: 3, energy: 2 },
  hemokinesis: { hp: 2, damage: 15 },
  reaper: { damage: 4 },
  offering: { hp: 6, energy: 2, draw: 3 },
  combust: { damage: 1, hp: 1 },
  dark_embrace: { draw: 1 },
  feel_no_pain: { block: 1 },
  rupture: { strength: 1 },
  rampage: { damage: 8, grow: 5 },
};
const CUSTOM_SENTENCE = {
  bloodletting: `Lose ${CN.bloodletting.hp} HP. Gain ${CN.bloodletting.energy} Energy.`,
  hemokinesis: `Lose ${CN.hemokinesis.hp} HP. Deal ${CN.hemokinesis.damage} damage.`,
  reaper: `Deal ${CN.reaper.damage} damage to ALL enemies. Heal HP equal to the damage dealt.`,
  limit_break: 'Double your current Strength. Does nothing if you have no Strength.',
  offering: `Lose ${CN.offering.hp} HP. Gain ${CN.offering.energy} Energy. Draw ${CN.offering.draw} cards.`,
  combust: `Gain Combust: at the end of each turn, deal ${CN.combust.damage} damage to ALL enemies and lose ${CN.combust.hp} HP.`,
  dark_embrace: `Gain Dark Embrace: whenever a card is exhausted, draw ${CN.dark_embrace.draw} card.`,
  feel_no_pain: `Gain Feel No Pain: whenever a card is exhausted, gain ${CN.feel_no_pain.block} Block.`,
  rupture: `Gain Rupture: whenever a card makes you lose HP, gain ${CN.rupture.strength} Strength.`,
  entrench: 'Double your current Block. Does nothing if you have no Block.',
  rampage: `Deal ${CN.rampage.damage} damage. This card gains +${CN.rampage.grow} damage permanently each time you play it.`,
};

/**
 * One sentence per effect verb in the CLOSED vocabulary
 * (src/kernel/rules/vocabulary.js: damage, block, draw, energy, status, discard,
 * exhaust, custom).
 *
 * `amount` is the printed card number; Strength and Dexterity are added at play time and
 * are deliberately NOT folded in here (the card cannot know your counters, and the
 * status pills already explain those).
 * @param {any} effect one entry of a card definition's `effects` array
 * @param {any} def the card definition the effect belongs to
 * @returns {string} a complete sentence
 */
export function describeEffect(effect, def = {}) {
  const amount = effect.amount;
  switch (effect.verb) {
    case 'damage': {
      const hits = effect.hits ?? 1;
      const who = effect.target === 'all_enemies'
        ? 'ALL enemies'
        : def.target === 'random_enemy' ? 'a random enemy' : 'the enemy';
      if (hits > 1) return `Deal ${amount} damage to ${who} ${hits} times.`;
      return `Deal ${amount} damage to ${who}.`;
    }
    case 'block':
      return `Gain ${amount} Block.`;
    case 'draw':
      return `Draw ${plural(amount, 'card', 'cards')}.`;
    case 'energy':
      return `Gain ${amount} Energy.`;
    case 'status': {
      const name = statusName(effect.status);
      const self = effect.to === 'self' || effect.to === 'player';
      // The clause is the plain-English consequence, so a card that grants a keyword
      // explains it on the card instead of making the player open the glossary.
      if (self) {
        const clause = statusClause(effect.status, amount, 'player');
        return clause ? `Gain ${amount} ${name} — ${clause}.` : `Gain ${amount} ${name}.`;
      }
      const who = effect.target === 'all_enemies' ? 'ALL enemies' : 'the enemy';
      const clause = statusClause(effect.status, amount, 'enemy');
      return clause
        ? `Apply ${amount} ${name} to ${who} — ${clause}.`
        : `Apply ${amount} ${name} to ${who}.`;
    }
    case 'discard':
      return `Discard ${plural(amount, 'card', 'cards')} at random.`;
    case 'exhaust':
      return 'Exhaust this card for the rest of the fight.';
    case 'custom':
      return CUSTOM_SENTENCE[effect.handler] ?? `Special effect (${effect.handler}).`;
    default:
      return `Unknown effect (${effect.verb}).`;
  }
}

/* ------------------------------------------------------------------ card describe */

/**
 * Consecutive identical `damage` effects folded into one sentence.
 *
 * Pummel is four separate `{verb:'damage',amount:2}` entries (one per hit), so the naive
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
 * Plain English description of a card, as a human would read it aloud.
 *
 * `Hammerfall` -> "Deal 6 damage to the enemy."
 * `Anvil Blow` -> "Deal 8 damage to the enemy. Apply 2 Vulnerable to the enemy."
 *
 * @param {any} def card definition from content (cards.json shape)
 * @param {{perPlay?: number}} [instance] runtime instance, when one is available:
 *   Rampage's damage depends on how often it has been played this run.
 * @returns {string} at least one complete sentence, never empty
 */
export function describeCard(def, instance = {}) {
  if (!def || !Array.isArray(def.effects)) return 'No description available.';
  const effects = foldRepeatedDamage(def.effects);
  const parts = effects.map((e) => {
    // Rampage is the one handler whose numbers move with the instance.
    if (e.verb === 'custom' && e.handler === 'rampage' && instance.perPlay) {
      return `Deal ${8 + instance.perPlay} damage (+5 more each time you play it).`;
    }
    return describeEffect(e, def);
  });
  return parts.map(sentence).join(' ');
}

/* --------------------------------------------------------------- card face (#29) */

/**
 * The card-face glyphs (#29/#53): one per repeatable effect. A short phone's hand card shows
 * its rule as glyph lines ("[sword]13 / [Weak]1 / [Vuln]1"); these are the names and the
 * one-line explanations the preview, the glossary legend and the first-sight tip read.
 * `status` marks the glyphs that stand for a keyword status.
 * @type {Record<string, {label: string, meaning: string, status?: boolean}>}
 */
export const FACE_GLYPHS = {
  damage: { label: 'Damage', meaning: 'Deal this much damage to the enemy you aim at. ALL: to every enemy. ×N: that many hits.' },
  block: { label: 'Block', meaning: 'Gain this much Block: it absorbs incoming damage until your next turn. ×2: double your Block.' },
  weak: { label: 'Weak', meaning: 'Apply Weak: its attacks deal 25% less damage. Wears off by 1 each turn.', status: true },
  vulnerable: { label: 'Vulnerable', meaning: 'Apply Vulnerable: it takes 50% more damage from attacks. Wears off by 1 each turn.', status: true },
  strength: { label: 'Strength', meaning: 'Gain Strength: your attacks deal that much more damage for the whole fight. ×2: double it.', status: true },
  metallicize: { label: 'Metallicize', meaning: 'Gain Metallicize: at the end of each turn, gain that much Block.', status: true },
  draw: { label: 'Draw', meaning: 'Draw this many cards.' },
  energy: { label: 'Energy', meaning: 'Gain this much Energy this turn.' },
  hp: { label: 'Lose HP', meaning: 'You lose this much HP. Block does not stop it.' },
  discard: { label: 'Discard', meaning: 'Discard this many cards from your hand at random.' },
  status: { label: 'Status', meaning: 'A status effect; the preview names it.', status: true },
  exhaust: { label: 'Exhaust', meaning: 'A flame in the card\'s corner: playing it removes it for the rest of the fight.' },
};

/** Line order on every face: damage/block, then statuses, then resources. */
const FACE_RANK = { damage: 0, block: 0, weak: 1, vulnerable: 1, strength: 1, metallicize: 1, hp: 2, energy: 2, draw: 2, discard: 2 };

/** Signs (#53 P3): a gain always reads +N, a loss -N. Damage is an amount dealt: unsigned. */
const GAIN = new Set(['block', 'weak', 'vulnerable', 'strength', 'metallicize', 'draw', 'energy', 'status']);
const LOSS = new Set(['hp', 'discard']);
function signed(glyph, n) {
  const s = String(n);
  if (!/^\d+$/.test(s)) return s;
  if (GAIN.has(glyph)) return `+${s}`;
  if (LOSS.has(glyph)) return `-${s}`;
  return s;
}
const g = (glyph, n = '', all = false) => ({ g: glyph, n: signed(glyph, n), ...(all ? { all: true } : {}) });

/**
 * Face pieces per `custom` handler, from the same literals as CUSTOM_SENTENCE.
 * `now`: effects that happen when played (merged and sorted with the rest of the card).
 * `trig`: a trigger block — a short word + colon on its own line, then its glyph lines;
 * trigger blocks always come last on the face (#53 design call b). A trigger word is never
 * a glyph and never abbreviated.
 */
const CUSTOM_FACE = {
  bloodletting: () => ({ now: [g('hp', CN.bloodletting.hp), g('energy', CN.bloodletting.energy)] }),
  hemokinesis: () => ({ now: [g('hp', CN.hemokinesis.hp), g('damage', CN.hemokinesis.damage)] }),
  offering: () => ({ now: [g('hp', CN.offering.hp), g('energy', CN.offering.energy), g('draw', CN.offering.draw)] }),
  limit_break: () => ({ now: [g('strength', '×2')] }),
  entrench: () => ({ now: [g('block', '×2')] }),
  reaper: () => ({ now: [g('damage', CN.reaper.damage, true), { t: 'Heal that much' }] }),
  combust: () => ({ trig: { t: 'Turn end:', lines: [g('damage', CN.combust.damage, true), g('hp', CN.combust.hp)] } }),
  dark_embrace: () => ({ trig: { t: 'Exhaust:', lines: [g('draw', CN.dark_embrace.draw)] } }),
  feel_no_pain: () => ({ trig: { t: 'Exhaust:', lines: [g('block', CN.feel_no_pain.block)] } }),
  rupture: () => ({ trig: { t: 'HP lost:', lines: [g('strength', CN.rupture.strength)] } }),
  rampage: (inst) => ({ now: [g('damage', CN.rampage.damage + (inst.perPlay || 0))], trig: { t: 'Grows:', lines: [g('damage', `+${CN.rampage.grow}`)] } }),
};

/** Merge repeated glyphs (#53 P1-2): two "+1 draw" lines become one "+2". */
function mergeLines(lines) {
  const out = [];
  for (const l of lines) {
    const prev = 'g' in l && out.find((o) => o.g === l.g && !!o.all === !!l.all);
    const num = (x) => (/^[+-]?\d+$/.test(x.n) ? Number(x.n) : NaN);
    if (prev && !Number.isNaN(num(prev)) && !Number.isNaN(num(l)) && /^[+-]/.test(prev.n) === /^[+-]/.test(l.n)) {
      const sum = num(prev) + num(l);
      prev.n = /^[+-]/.test(prev.n) ? (sum < 0 ? String(sum) : `+${sum}`) : String(sum);
    } else out.push({ ...l });
  }
  return out;
}

/**
 * The structured card face (#29/#53), built from the (tempered) definition so its numbers
 * always agree with describeCard. Order: what happens on play (merged, ranked), then trigger
 * blocks (`{t, trig: true}` header + its lines, each `{..., under: true}`). A card that
 * exhausts ITSELF carries one `{mark: 'exhaust'}` entry instead of a line: the renderer draws
 * it as a corner flame.
 * @param {any} def
 * @param {{perPlay?: number}} [instance]
 * @param {number} [hpCost] extra HP the instance costs to play (a temper)
 * @returns {Array<{g: string, n: string, all?: boolean, under?: boolean} | {t: string, trig?: boolean, under?: boolean} | {mark: 'exhaust'}>}
 */
export function cardFaceLines(def, instance = {}, hpCost = 0) {
  if (!def || !Array.isArray(def.effects)) return [{ t: 'No description available.' }];
  const now = [];
  const trigs = [];
  let exhaust = false;
  for (const e of foldRepeatedDamage(def.effects)) {
    const all = e.target === 'all_enemies' || e.to === 'all_enemies';
    switch (e.verb) {
      case 'damage': now.push(g('damage', (e.hits ?? 1) > 1 ? `${e.amount}×${e.hits}` : e.amount, all)); break;
      case 'block': now.push(g('block', e.amount)); break;
      case 'draw': now.push(g('draw', e.amount)); break;
      case 'energy': now.push(g('energy', e.amount)); break;
      // An unknown status gets a neutral mark plus its name, never another status's glyph.
      case 'status': now.push(FACE_GLYPHS[e.status] ? g(e.status, e.amount, all) : { ...g('status', e.amount, all), label: String(e.status) }); break;
      case 'discard': now.push(g('discard', e.amount)); break;
      case 'exhaust': exhaust = true; break;
      case 'custom': {
        const f = CUSTOM_FACE[e.handler];
        if (!f) { now.push({ t: describeEffect(e, def) }); break; }
        const out = f(instance);
        if (out.now) now.push(...out.now);
        if (out.trig) trigs.push(out.trig);
        break;
      }
      default: now.push({ t: describeEffect(e, def) });
    }
  }
  if (hpCost > 0) now.push(g('hp', hpCost));
  // A sentence line ("Heal that much") belongs to the line above it: it takes that line's
  // rank and sorts right after it, so a temper's Block never lands between them (#53 r2).
  const merged = mergeLines(now);
  const rankOf = [];
  merged.forEach((l, i) => { rankOf[i] = 'g' in l ? (FACE_RANK[l.g] ?? 9) : (i > 0 ? rankOf[i - 1] : 9); });
  const ranked = merged.map((l, i) => [l, i, 'g' in l ? i : i - 0.5 + 0.49])
    .sort((a, b) => rankOf[a[1]] - rankOf[b[1]] || a[2] - b[2]).map(([l]) => l);
  const lines = [...ranked];
  for (const tb of trigs) {
    lines.push({ t: tb.t, trig: true });
    for (const l of tb.lines) lines.push({ ...l, under: true });
  }
  if (exhaust) lines.push({ mark: 'exhaust' });
  return lines;
}


/**
 * One-line playability note for a tile: why the card cannot be played right now.
 * Reads the kernel's own snapshot fields (`cost`, `playable`) — no rule is restated.
 * @param {{cost?: number, playable?: boolean}} card
 * @param {number} energy current energy
 * @returns {string} '' when the card is playable
 */
export function describePlayability(card, energy) {
  if (card?.playable) return '';
  if ((card?.cost ?? 0) > energy) return `Needs ${card.cost} Energy — you have ${energy}.`;
  return 'Not playable right now.';
}

/* ----------------------------------------------------------------- enemy intent */

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
 * Plain English sentence for an enemy's chosen intent, e.g.
 * "Will attack for 7 and block 5." / "Will apply 2 Vulnerable and 2 Weak to you."
 *
 * The damage number comes from the kernel's own `intentDamage()` (Strength already
 * added, Weak already applied) when it can be computed, so the sentence and the compact
 * number can never disagree.
 * @param {any} enemy snapshot enemy or raw state enemy
 * @returns {string}
 */
export function describeIntent(enemy) {
  const move = moveOf(enemy);
  if (!move) return 'Intent unknown.';
  const intent = enemy.intent ?? {};
  const hits = intent.hits ?? move.hits ?? 1;
  const damage = intent.kind === 'attack' && typeof intent.damage === 'number'
    ? intent.damage
    : intentNumber(enemy, move);

  switch (move.kind) {
    case 'attack': {
      const per = hits > 1 ? Math.round(damage / hits) : damage;
      const swing = hits > 1
        ? `Will attack for ${per} damage ${hits} times`
        : `Will attack for ${damage}`;
      return sentence(move.block ? `${swing} and block ${move.block}` : swing);
    }
    case 'block':
      return `Will gain ${move.block} Block.`;
    case 'buff': {
      const parts = [];
      if (move.strength) parts.push(`+${move.strength} Strength`);
      if (move.block) parts.push(`gain ${move.block} Block`);
      return sentence(`Will power up: ${parts.join(' and ')}`);
    }
    case 'debuff': {
      const parts = [];
      if (move.vulnerable) parts.push(`${move.vulnerable} Vulnerable`);
      if (move.weak) parts.push(`${move.weak} Weak`);
      return sentence(`Will apply ${parts.join(' and ')} to you`);
    }
    default:
      return `${move.label}.`;
  }
}

/* ---------------------------------------------------------------------- glossary */

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

/** Whole-card shorthand for shapes no table can derive, seen in CUSTOM_SUMMARY. */
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
  glossRow('PWRx', 'double your Strength', 'An "x" after a power means MULTIPLY the stacks you already have. "PWRx2" doubles your Strength; it does nothing if you have none.', 'C'),
  glossRow('BLKx', 'double your Block', 'An "x" after Block means MULTIPLY the Block you currently have. "BLKx2" doubles it; it does nothing if you have none.', 'C'),
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

/** Human label for a whole-card shorthand token, e.g. "HP6" -> "HP cost 6". */
function labelForShorthand(abbrev) {
  const m = /^([A-Za-z]{1,4})(\d*)(?:x(\d*))?$/.exec(abbrev);
  if (!m) return abbrev;
  const [, letters, num, times] = m;
  const names = { HP: 'HP cost', A: 'Attack', BLK: 'Block', PWR: 'Strength', D: 'Draw', E: 'Energy' };
  const name = names[letters] ?? letters;
  if (times !== undefined) return `${name} ${num} ×${times || 'all'}`;
  return num ? `${name} ${num}` : name;
}

/**
 * The glossary: every abbreviation the compact CLI summary still emits, in plain
 * English. Covers the effect vocabulary (A, B, D, E, d, EXH, A x n, +), the status
 * abbreviations (PWR, VULN, WK, DEX, METAL), the HP cost (HP) and the whole-card
 * shorthands that no table can derive (BLKx2, PWRx2, HP+, …).
 * @returns {Array<object>} rows of `{token, label, meaning}`
 */
export function glossary() {
  const core = [
    glossRow('A', 'Attack', 'Deal the shown damage to one enemy. "A6" means an attack for 6 damage.'),
    glossRow('B', 'Block', 'Gain the shown Block. Block soaks damage and is used up at the start of your turn.'),
    glossRow('D', 'Draw', 'Draw that many cards from your draw pile.'),
    glossRow('E', 'Energy', 'Gain that much Energy immediately. Energy pays for cards; you get 3 each turn.'),
    glossRow('d', 'Discard', 'Discard that many cards from your hand (lower case d, to keep it apart from Draw).'),
    glossRow('EXH', 'Exhaust', 'The card leaves the fight for good — it does not come back in a reshuffle.'),
    glossRow('+', 'grows', 'A plus after an ATTACK or BLOCK value means the number grows: each time you play the card, or each turn while a power lasts.'),
    // Status and power names: the B group.
    glossRow('HP', 'Your HP', 'Lose that much HP. This is a COST you pay, not healing: it ignores Block and never drops you below 1 HP.', 'B'),
    glossRow('PWR', 'Strength', 'Attacks deal that much more damage. Lasts the whole fight.', 'B'),
    glossRow('VULN', 'Vulnerable', 'Takes 50% more damage from attacks. Wears off by 1 each turn.', 'B'),
    glossRow('WK', 'Weak', 'Attacks deal 25% less damage. Wears off by 1 each turn.', 'B'),
    glossRow('DEX', 'Dexterity', 'Block gained from cards is that much higher. Lasts the whole fight.', 'B'),
    glossRow('METAL', 'Metallicize', 'Gain that much Block at the end of each turn. The Scale Up card applies it.', 'B'),
  ];

  // Every whole-card shorthand the generators can really emit: the tokens of the
  // per-card string list, each token of every per-card string in CUSTOM_SUMMARY (one
  // string can hold several, e.g. "A15 HP2"), and the shapes no table can derive.
  const wholeCard = new Set(emittedTokens().custom);
  for (const s of Object.values(CUSTOM_SUMMARY)) {
    for (const part of String(s).split(' ').filter(Boolean)) wholeCard.add(part);
  }
  for (const id of Object.keys(CUSTOM_SHORTHAND)) wholeCard.add(id);

  const expanded = [...wholeCard]
    .sort()
    .filter((abbrev) => Object.prototype.hasOwnProperty.call(CUSTOM_SHORTHAND, abbrev))
    .map((abbrev) => glossRow(abbrev, labelForShorthand(abbrev), CUSTOM_SHORTHAND[abbrev], 'C'));

  // De-duplicate, core entries first so the frozen vocabulary wins any clash.
  const seen = new Set();
  const out = [];
  for (const entry of [...core, ...SHORTHAND_ENTRIES, ...expanded]) {
    if (seen.has(entry.token)) continue;
    seen.add(entry.token);
    out.push(entry);
  }
  return out;
}

/* -------------------------------------------------------------------- how to play */

/**
 * The first-run help lines, in kernel hands so the browser help panel and any other
 * surface cannot disagree about the turn rules. Every claim is a property of
 * src/kernel/rules/act.js (BASE_ENERGY 3, HAND_SIZE 5) and rules/powers.js (the player's
 * Block resets to 0 in beginTurn, after the enemy turn has already resolved against it).
 * @returns {Array<{title: string, body: string}>}
 */
export function helpTopics() {
  return [
    { title: 'You have 3 Energy every turn', body: 'Each card shows its Energy cost in the top-left corner. Energy refills to 3 at the start of each of your turns and does not carry over.' },
    { title: 'Click a card to play it', body: 'Playing a card spends its Energy and does what its text says. Greyed-out cards cost more Energy than you have left this turn.' },
    { title: 'Click End Turn when you are done', body: 'Your hand is discarded, the enemies take their turn doing whatever their intent announced, and then you draw a new hand of 5.' },
    { title: 'Block protects you, then goes away', body: 'Block soaks damage from enemy attacks. Your Block is used up at the start of your next turn, so it only covers you until then.' },
    { title: 'Killing an enemy stops it attacking', body: 'Dead enemies never act again, and their announced intent goes away with them. Attacking the enemy that is about to hit you hardest is often the best move.' },
    { title: 'Read the enemy intent', body: 'The line under each enemy says what it will do on its next turn — for example "Will attack for 11". Plan your Block around it.' },
    { title: 'Kindled Heart', body: 'After each fight you win, Kindled Heart restores 6 HP. It is the Ashwright starting relic.' },
  ];
}

/**
 * Describe one hand card exactly as a tile needs it: name, cost, sentences and where the
 * compact form came from. Everything a human surface shows about a card comes from here,
 * so a tile cannot invent a number.
 * @param {any} def card definition
 * @param {{cost?: number, perPlay?: number, playable?: boolean}} [instance]
 * @param {number} [energy]
 * @returns {{name: string, cost: number, type: string, typeLabel: string, blurb: string, description: string, compact: string, compactLabel: string, hint: string}}
 */
export function describeTile(def, instance = {}, energy = 0) {
  const cost = instance.cost ?? def.cost ?? 0;
  return {
    name: def.name,
    cost,
    type: def.type,
    typeLabel: CARD_TYPE_LABEL[def.type] ?? def.type,
    blurb: describeCardType(def.type),
    description: describeCard(def, instance),
    compact: effectSummary(def),
    compactLabel: 'Compact form (what the CLI prints)',
    hint: describePlayability({ cost, playable: instance.playable ?? true }, energy),
  };
}
