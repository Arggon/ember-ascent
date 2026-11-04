// Observation — the agent-facing text surface, rendered INSIDE the kernel (R4, R1).
//
// Why here and not in the CLI: if a GUI could render state the CLI cannot, the two
// surfaces would diverge and R1 would be a promise rather than a property. Every
// visible character a player sees is produced by this file; surfaces only transport it.
//
// Card definitions are resolved from content at render time. State stores compact
// instances ({uid, cardId, perPlay}) only, so a save never duplicates content and
// two runs on the same content stay byte-identical.
//
// Budget: the dump is designed to stay under 250 tokens (worst of o200k/cl100k) and
// every action line under 8 — enforced by tests/budget.test.js on measured counts.
import { ENEMIES, BIOMES, currentBiome, startBiomeIds } from './rules/encounters.js';
import { availableNodes, NODE_TYPES } from './rules/map.js';
import { defaultContent, draftPoolFrom } from './content.js';
import { actions as legalActions } from './actions.js';
import { intentLabel, intentDamage, REST_HEAL } from './rules/act.js';
import { BOONS, boonText } from './rules/kindling.js';
import { RELICS, relicId, relicList, relicDef } from './rules/relics.js';
import { TEMPERS, temperEffects, temperHpCost } from './rules/tempers.js';
import { QUESTS } from './rules/quests.js';
import { REMOVAL_PRICE } from './rules/shop.js';
import { POTION_SLOTS, potionDef } from './rules/potions.js';
import { eventDef, offerEventChoices, renderEventLines, temperOfferOpen } from './rules/events.js';
// The plain-English layer. Declared AFTER the frozen compact one on purpose: the strings
// in this file are the budgeted payload and may not move, so they stay the single source
// of the abbreviations that describe.js explains.
import {
  describeCard,
  describeIntent,
  describePlayability,
  describePower,
  describeStatus,
  cardChips,
  chipsCover,
  chipVerbLabel,
  statusName,
  glossary,
  glossarySections,
  helpTopics,
  typeLabel,
  CARD_TYPE_LABEL,
  CARD_TYPE_LABEL_ES,
} from './describe.js';

/* ------------------------------------------------------------------ I18N-1 language
 *
 * `snapshot(state, { lang })` (and `cardPool({ lang })`) localize the PLAYER-FACING
 * derived strings — card sentences, status/power text, intent sentences, glossary/help
 * rows, and the code-owned relic/potion/temper/event words via their `_es` twins. The
 * language is a SURFACE choice that rides the opts and lands nowhere else: it never
 * enters run state, the save format, the action log, or the compact dump (`observe()`
 * and `observeActions()` below are English-only by contract, pinned by the goldens).
 * 'en' is the default, and exactly 'es' selects Spanish — anything else reads English.
 */
const langOf = (opts) => (opts && opts.lang === 'es' ? 'es' : 'en');

/**
 * A code-owned table's field in the requested language: the `_es` twin when the table
 * carries one AND the lang asks for it, the English field otherwise — the honest
 * fallback (a not-yet-swept string renders in English, never a key name, never empty).
 * @param {any} def a code-owned definition (relic/potion/temper/event/card)
 * @param {string} key the field name, e.g. 'name', 'text', 'story'
 * @param {string} lang the resolved language
 * @returns {string}
 */
function fieldFor(def, key, lang) {
  if (!def) return '';
  if (lang === 'es') {
    const es = def[`${key}_es`];
    if (typeof es === 'string' && es.length > 0) return es;
  }
  return def[key] ?? '';
}

/** Compact status label for the header, e.g. PWR2 VULN1. Exported so the plain-English
 * layer (describe.js) can derive its glossary from these tables instead of copying them. */
export const STATUS_ABBREV = {
  strength: 'PWR',
  vulnerable: 'VULN',
  weak: 'WK',
  dexterity: 'DEX',
  metallicize: 'METAL',
};

/** One-line summaries for the exotic cards (they cannot be derived from data).
 * Exported for the same reason as STATUS_ABBREV: describe.js derives its glossary from
 * this table, so a new exotic card is never left unexplained in the compact form. */
export const CUSTOM_SUMMARY = {
  bloodletting: 'HP3 E2',
  hemokinesis: 'A15 HP2',
  reaper: 'A4xall HP+',
  limit_break: 'PWRx2',
  offering: 'HP6 E2 D3',
  combust: 'PWR+',
  dark_embrace: 'PWR+',
  feel_no_pain: 'PWR+',
  rupture: 'PWR+',
  entrench: 'BLKx2',
  rampage: 'A8+5',
};

/**
 * Compact token per effect verb — the closed vocabulary, one row each, next to the
 * abbreviation tables above. A verb with no row renders `?`, same as before.
 * @type {Record<string, (e: any) => string>}
 */
const SUMMARY_OF_VERB = {
  damage: (e) => (e.hits && e.hits > 1 ? `A${e.amount}x${e.hits}` : `A${e.amount}`),
  block: (e) => `B${e.amount}`,
  draw: (e) => `D${e.amount}`,
  energy: (e) => `E${e.amount}`,
  status: (e) => `${STATUS_ABBREV[e.status] ?? e.status.toUpperCase()}+${e.amount}`,
  discard: (e) => `d${e.amount}`,
  exhaust: () => 'EXH',
  heal: (e) => `H${e.amount}`,
  retain: () => 'RTN',
  custom: (e) => CUSTOM_SUMMARY[e.handler] ?? '?',
};

/**
 * Short effect summary for a card definition, used in hand lines and action lines.
 * Every extra character here is paid on every turn, so it is deliberately terse.
 * @param {any} def card definition
 * @returns {string}
 */
export function effectSummary(def) {
  const parts = [];
  for (const e of def.effects) {
    const fmt = SUMMARY_OF_VERB[e.verb];
    parts.push(fmt ? fmt(e) : '?');
  }
  return parts.join(' ');
}

const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

/** Render the status labels for a combatant, e.g. "PWR2 VULN1". */
function statusLine(statuses) {
  const keys = Object.keys(statuses ?? {}).filter((k) => (statuses[k] ?? 0) > 0);
  if (keys.length === 0) return '';
  return keys.map((k) => `${STATUS_ABBREV[k] ?? k.toUpperCase()}${statuses[k]}`).join(' ');
}

/** The id of a bare-id-or-instance value — the ONE id extractor here, shared by the
 *  strict lookup below and the tolerant fallback beside it (POLISH round nit: the
 *  extraction used to live twice). */
const cardIdOf = (cardOrId) => (typeof cardOrId === 'string' ? cardOrId : cardOrId.cardId);

/** Live card definition lookup. Single place where an instance (or bare id) becomes renderable. */
let CARD_DEFS = null;
/** @param {any} content */
export function _setContentForObservation(content) {
  CARD_DEFS = content.cards;
}
/** The definition of a hand instance OR a bare card id — one lookup, one error message. */
function defOf(cardOrId) {
  if (CARD_DEFS === null) CARD_DEFS = defaultContent().cards;
  const id = cardIdOf(cardOrId);
  const def = CARD_DEFS.get(id);
  if (!def) throw new Error(`observation: unknown card "${id}"`);
  return def;
}

/**
 * The TOLERANT lookup, for ids that arrive from persisted state (deck, piles, reward and
 * rest offers): a stale save after a rename, or a typo'd id pushed in through the save /
 * load lever (validateSave never checks cardIds), must degrade to a placeholder instead
 * of throwing out of snapshot() in any phase. This is exactly the two-step lookup the
 * text dump's rewardBody has always done; the snapshot builders share it now.
 * @param {any} cardOrId a card id or an instance ({cardId})
 * @returns {any|null} the definition, or null when the content does not know the id
 */
function defOrNull(cardOrId) {
  if (CARD_DEFS === null) CARD_DEFS = defaultContent().cards;
  return CARD_DEFS.get(cardIdOf(cardOrId)) ?? defaultContent().cards.get(cardIdOf(cardOrId)) ?? null;
}

/**
 * ONE helper for "the card this temper lands on, as the TEMPERED copy plays": the
 * synthetic def (rules/tempers.js temperEffects) rendered through the describe layer
 * into the row shape every tempered tile consumes — the resolved beat's card refs
 * (beatCards) and BOTH surfaces' temper OFFERS (the smith's event modal and the rest
 * site's forge list). snapshotDeck's rows derive the same fields through temperedView
 * (its own pre-existing path over the same synthetic def). Every number and word is
 * kernel wording
 * (B2: the tempered copy's own face, never the base card's); the temper's name and
 * rules sentence ride beside them. Tolerant like defOrNull: an id the content no longer
 * knows (or a temper the table lost) yields the identity fields WITHOUT a face —
 * callers degrade to their raw-id shapes, never a throw.
 * @param {string} cardId
 * @param {string} temper a TEMPERS key (callers gate on TEMPERS[temper] where it matters)
 * @param {string} lang
 * @returns {{cardId: string, temper: string, temperName: string, temperText: string,
 *            name?: string, cost?: number, type?: string, typeLabel?: string,
 *            description?: string, chips?: any[], chipsComplete?: boolean}}
 */
function temperedCardRow(cardId, temper, lang) {
  const def = defOrNull(cardId);
  const row = {
    cardId,
    temper,
    temperName: fieldFor(TEMPERS[temper], 'name', lang) || temper,
    temperText: fieldFor(TEMPERS[temper], 'text', lang),
  };
  if (!def) return row;
  const temperedDef = { ...def, effects: temperEffects(def.effects, temper) };
  return {
    ...row,
    name: fieldFor(def, 'name', lang),
    cost: def.cost,
    type: def.type,
    typeLabel: typeLabel(def.type, lang),
    description: describeCard(temperedDef, {}, lang),
    chips: cardChips(temperedDef, lang),
    chipsComplete: chipsCover(temperedDef),
  };
}

/**
 * B2: the definition a tempered instance actually plays — the same card with the effect
 * list the kernel resolves (rules/tempers.js temperEffects), so every rendering of it
 * (CLI hand line, GUI sentence, compact summary) shows the tempered numbers. An
 * untempered instance, or a run without tempers, gets the shared definition untouched.
 * @param {any} state
 * @param {any} card hand instance
 * @param {any} def its content definition
 * @returns {{def: any, temper: string | null}}
 */
export function temperedView(state, card, def) {
  const temper = state.tempers?.[card.uid] ?? null;
  if (!temper || !TEMPERS[temper]) return { def, temper: null };
  return { def: { ...def, effects: temperEffects(def.effects, temper) }, temper };
}

/**
 * The R4 state dump. Shape fixed by the requirement:
 *   T3 | HP 42/60 | EN 3/3 | BLK 0 | draw5 disc3 | PWR2 VULN1
 *   HAND
 *    1 Hammerfall  A6
 *   ENEMY
 *    Cinder Maw  HP 44/44  A12
 * @param {any} state
 * @param {{verbose?: boolean}} [opts]
 * @returns {string}
 */
export function observe(state, opts = {}) {
  return [...header(state), ...body(state, opts)].join('\n');
}

function header(state) {
  const p = state.player;
  const statuses = statusLine(p.statuses);
  const head = [
    `T${state.stepIndex}`,
    `HP ${p.hp}/${p.maxHp}`,
    `EN ${p.energy}/${state.energyPerTurn ?? 3}`,
    `BLK ${p.block}`,
    // S3 gold: the purse sits in the header beside HP/EN/BLK so every phase shows it.
    // `?? 0` is the legacy-save tolerance (validateSave keeps the field optional).
    `GOLD ${p.gold ?? 0}`,
    // S5 potions: the belt count in every phase's header — the belt is carried across
    // the run even though its q/d actions only exist in combat. `?? []` is the
    // legacy-save tolerance (absent field = empty belt).
    `POTIONS ${(state.potions ?? []).length}/${POTION_SLOTS}`,
    // S7 relics: the held count in every phase's header, like the belt. The NAMES live
    // in the snapshot's `relics` rows (and the verbose map body) — the header stays a
    // count, the same compact ruling the GOLD/POTIONS chips keep.
    `RELICS ${relicList(state).length}`,
    `draw${state.combat?.draw?.length ?? 0} disc${state.combat?.discard?.length ?? 0}`,
    statuses,
  ].filter(Boolean);
  return [head.join(' | ')];
}

function body(state, opts) {
  switch (state.phase) {
    case 'combat':
      return combatBody(state, opts);
    case 'reward':
      return rewardBody(state);
    case 'rest':
      return restBody(state);
    case 'shop':
      return shopBody(state);
    case 'event':
      return eventBody(state);
    case 'map':
      return mapBody(state, opts);
    case 'kindling':
      return kindlingBody(state);
    case 'ended':
      return [
        // S7: the relic count joins the summary — what the run carried, beside the purse.
        // S9: an act beyond the first is named, so "floor 8" cannot be mistaken for the
        // act-1 summit. A legacy save (act 1, no field) prints the line unchanged.
        `GAME OVER — ${state.outcome === 'win' ? 'VICTORY' : 'DEFEAT'} | floor ${state.floor + 1} | steps ${state.stepIndex} | gold ${state.player.gold ?? 0} | relics ${relicList(state).length}${(state.act ?? 1) > 1 ? ` | act ${state.act}` : ''}`,
      ];
    default:
      return [`phase ${state.phase}`];
  }
}

function combatBody(state, opts) {
  const lines = ['HAND'];
  if (state.combat.hand.length === 0) lines.push(' (empty)');
  state.combat.hand.forEach((card, i) => {
    const view = temperedView(state, card, defOf(card));
    // A tempered card shows the numbers it really plays plus its temper tag, e.g.
    // ` 1 Hammerfall   A9 [RH]`. Untempered lines are byte-identical to before.
    const tag = view.temper ? ` [${TEMPERS[view.temper].label}]` : '';
    lines.push(` ${i + 1} ${pad(view.def.name, 12)} ${effectSummary(view.def)}${tag}`);
  });
  lines.push('ENEMY');
  const live = state.combat.enemies.filter((e) => !e.dead);
  if (live.length === 0) lines.push(' (none)');
  for (const e of live) {
    const def = ENEMIES[e.id];
    const move = def.moves[e.moveIndex] ?? def.moves[0];
    const st = statusLine(e.statuses);
    // `def.name` is the player-facing name. `e.name` is the hashed state string.
    const shown = def?.name || e.name;
    lines.push(` ${shown}  HP ${e.hp}/${e.maxHp}${e.block > 0 ? ` B${e.block}` : ''}  ${move.label}${st ? ` ${st}` : ''}`);
  }
  if (opts.verbose) {
    lines.push('PILES');
    lines.push(` draw: ${pileNames(state.combat.draw)}`);
    lines.push(` disc: ${pileNames(state.combat.discard)}`);
    lines.push(` exh:  ${state.combat.exhaust.length > 0 ? state.combat.exhaust.map((c) => defOf(c).name).join(', ') : '-'}`);
    lines.push(` deck: ${state.deck.length} cards`);
  }
  lines.push(...beltBody(state));
  return lines;
}

/**
 * S5: the belt, rendered in COMBAT only (the one phase its q/d actions exist in).
 * Empty slots are not drawn — the header's `POTIONS n/3` already counts them — and an
 * unknown belt id renders as its raw id with no effect text (the stale-save degrade,
 * never a throw). The discard id is the slot's own; the QUAFF half comes from the LEGAL
 * list (the same computation snapshotBelt does), because the slot's existence alone
 * hints ids the kernel refuses: a stale id gets no quaff (S4.1), and an aimed potion at
 * 2+ living enemies offers q<n>_<k>, never the bare q<n>. Slot 1 of a two-enemy fight
 * reads `(quaff q1_1/q1_2, discard d1)`; a refused quaff leaves only `(discard d<n>)`
 * (S5 review P3, fixed in the POLISH round). The AIMED forms stay one line each here —
 * the per-enemy split remains the action lines' job.
 * @param {any} state
 * @returns {string[]}
 */
function beltBody(state) {
  const belt = state.potions ?? [];
  if (belt.length === 0) return [];
  const quaffs = new Map();
  for (const a of legalActions(state)) {
    if (a.kind !== 'quaff') continue;
    if (!quaffs.has(a.index)) quaffs.set(a.index, []);
    quaffs.get(a.index).push(a.id);
  }
  const lines = ['BELT'];
  belt.forEach((potionId, i) => {
    const def = potionDef(potionId);
    const name = def ? def.name : potionId;
    const summary = def ? `  ${def.summary}` : '';
    const ids = quaffs.get(i) ?? [];
    const hint = ids.length > 0 ? `quaff ${ids.join('/')}, discard d${i + 1}` : `discard d${i + 1}`;
    lines.push(` ${i + 1} ${name}${summary}  (${hint})`);
  });
  return lines;
}

// Pile renderings tolerate an unknown id the way rewardBody does: the raw id stands in
// for the name instead of a throw (defOrNull above).
const pileNames = (pile) => (pile.length === 0 ? '-' : pile.map((c) => defOrNull(c)?.name ?? cardIdOf(c)).join(', '));
// I18N-2: the snapshot's pile viewer takes the language; the compact dump's pileNames above does not.
const pileCardNames = (pile, lang = 'en') => (pile ?? []).map((c) => fieldFor(defOrNull(c), 'name', lang) || cardIdOf(c));

function rewardBody(state) {
  // S7: the BOSS reward — the warden's relic offers replace the cards (StS
  // parity), so the header and the lines name relics. Tolerant like the card rows
  // (defOrNull's policy): an id the relic table no longer knows renders as its raw id
  // with no text, and offers no r-id will ever enumerate (the R6 mirror).
  const offers = Array.isArray(state.reward.relicOffers) ? state.reward.relicOffers : [];
  // S10: an EMPTY boss offer is a real state — UX-1 down-tiered the vault (rules/
  // relics.js), so empty no longer means "the rare tier is locked" (a gated pool now
  // offers down-tier commons); it means EVERY pool relic is held — the exhausted
  // vault. "Pick one" over nothing would be a lie, so the header says what is true.
  const boss = Boolean(state.reward.boss);
  const lines = [offers.length > 0
    ? 'REWARD — claim the warden\u2019s relic'
    : boss ? 'REWARD — the warden offers nothing' : 'REWARD — pick one'];
  offers.forEach((id, i) => {
    const def = relicDef(id);
    lines.push(` r${i + 1} ${def ? def.name : id}${def ? `  ${def.summary}` : ''}`);
  });
  state.reward.cards.forEach((id) => {
    // Tolerant on purpose (unlike defOf): a reward id the content no longer knows
    // still renders, as the raw id, instead of killing the whole dump. This inline
    // lookup IS defOrNull; it stays spelled out here as the precedent's home.
    const def = defOrNull(id);
    lines.push(` s${state.reward.cards.indexOf(id) + 1} ${def ? def.name : id} ${def ? effectSummary(def) : ''}`);
  });
  lines.push(` s0 ${offers.length > 0 ? 'walk away' : 'skip'} (HP ${state.player.hp}/${state.player.maxHp})`);
  // S3: what this fight just paid and what the purse holds now. Only when the reward
  // carries the grant: a legacy save's reward predates the field, and printing "+0"
  // for a spoils the engine never computed would be a lie, not a default.
  if (typeof state.reward.gold === 'number') {
    lines.push(` spoils +${state.reward.gold} gold (purse ${state.player.gold ?? 0})`);
  }
  // S7: an elite's GUARANTEED drop, named like the gold beside it. Only when the reward
  // carries it — a pre-S7 reward (or a fight that dropped nothing) prints no relic line.
  if (typeof state.reward.relic === 'string') {
    const def = relicDef(state.reward.relic);
    lines.push(` spoils relic: ${def ? def.name : state.reward.relic}${def ? ` (${def.summary})` : ''}`);
  }
  return lines;
}

function restBody(state) {
  const lines = ['REST — heal or move on', ` HP ${state.player.hp}/${state.player.maxHp}`];
  if (state.temperOffers && state.temperOffers.length > 0) {
    lines.push('TEMPER (instead of healing)');
    // Tolerant like snapshotRest beside which it renders (S2.1 review P3, closed in the
    // POLISH round): an unknown temper key — a stale save, or an offer the table no
    // longer knows — renders the raw key instead of throwing out of the dump.
    state.temperOffers.forEach((o, i) => lines.push(` t${i + 1} ${o.cardId} ${TEMPERS[o.temper]?.label ?? o.temper}`));
  }
  return lines;
}

/**
 * S4: the shop dump. Shelf lines carry the price (the action lines deliberately do not —
 * the same ruling that kept costs out of the combat action lines, and prices gate
 * legality exactly like Energy does). The removal step lists the whole deck: the pick is
 * uid-precise, so the list is the offer.
 */
function shopBody(state) {
  const shop = state.shop ?? { offers: [], removal: {} };
  const lines = ['SHOP — spend or move on'];
  (shop.offers ?? []).forEach((o, i) => {
    // Tolerant like rewardBody (defOrNull): an id the content no longer knows renders
    // as its raw id instead of killing the dump.
    const def = defOrNull(o.cardId);
    lines.push(` b${i + 1} ${def ? def.name : o.cardId} ${o.price}g${o.sold ? ' SOLD' : ''}`);
  });
  const rem = shop.removal ?? {};
  if (shop.removing) {
    lines.push('REMOVE — pick the card that leaves (already paid)');
    (state.deck ?? []).forEach((c, i) => {
      const def = defOrNull(c.cardId);
      lines.push(` x${i + 1} ${def ? def.name : c.cardId}`);
    });
  } else if (!rem.done) {
    lines.push(` x remove a card — ${rem.price ?? REMOVAL_PRICE}g`);
  }
  lines.push(` l leave (purse ${state.player.gold ?? 0})`);
  return lines;
}

function kindlingBody(state) {
  return ['KINDLING — take one boon (upside and cost)',
    ...state.kindling.offers.map((id, i) => ` k${i + 1} ${id} ${BOONS[id].label}`)];
}

/**
 * S6: the event dump. The story and every choice (with its cost and, when unmet, the
 * REQUIREMENT reason — the same dimmed-but-visible contract the shop's inert shelves
 * keep) render here; the resolved beat lists the concrete results and the continue.
 * A story id the roster no longer knows (a torn save) degrades: the raw id stands in
 * for the name, no story, and the continue line is the whole body — never a throw.
 */
function eventBody(state) {
  const ev = state.event ?? null;
  const def = eventDef(ev?.id);
  const lines = [`EVENT — ${def ? def.name : (ev?.id ?? 'the wayside')}`];
  if (!def) {
    lines.push(` v0 continue (HP ${state.player.hp}/${state.player.maxHp}, purse ${state.player.gold ?? 0})`);
    return lines;
  }
  if (ev?.tempering) {
    // The smith's modal: same rendering the rest site's temper list keeps. Elements are
    // coalesced through the kernel's own enumeration guard (S6.1 review P2: a
    // validate-accepted save may carry null/garbage offer elements, and this loop used
    // to read `o.cardId` straight out of them) — so the t-numbers rendered here are
    // exactly the ids actions() enumerates, and a corrupt element is simply absent,
    // never a throw and never a refused id hinted at.
    lines.push('TEMPER (pick one; the choice is committed)');
    (Array.isArray(ev.offers) ? ev.offers : []).forEach((o, i) => {
      if (!temperOfferOpen(o, state)) return;
      lines.push(` t${i + 1} ${o.cardId} ${TEMPERS[o.temper]?.label ?? o.temper}`);
    });
    return lines;
  }
  lines.push(` "${def.story}"`);
  if (ev?.resolved) {
    lines.push('RESOLVED');
    // Array.isArray, not `?? []`: a torn resolved beat (lines = 42, or a string) is
    // validateSave-accepted and used to throw straight out of observe() (S6.1 review P2).
    // I18N-2: the stored beat is structured slugs now; the dump renders their ENGLISH
    // column (byte-identical to the pre-I18N-2 baked sentences) — the agent contract.
    const beat = renderEventLines(ev.resolved?.lines, 'en', CARD_DEFS ?? defaultContent().cards);
    beat.forEach((l) => lines.push(` ${l}`));
    lines.push(` v0 continue (HP ${state.player.hp}/${state.player.maxHp}, purse ${state.player.gold ?? 0})`);
    return lines;
  }
  offerEventChoices(state, CARD_DEFS ?? defaultContent().cards).forEach((c) => {
    const cost = [
      c.cost !== null ? `${c.cost}g` : null,
      c.hpLoss !== null ? `${c.hpLoss} HP` : null,
    ].filter(Boolean).join(' ');
    // Unmet requirements render, dimmed by the surface, with the WHY; they carry no id.
    const tag = c.offered ? '' : ` [${c.reason}]`;
    lines.push(` v${c.index + 1} ${c.label}${cost ? ` — ${cost}` : ''}${tag}`);
  });
  return lines;
}

function mapBody(state, opts) {
  const lines = [`MAP — floor ${state.floor + 1}/${state.map.rows.length}`];
  // S9: from act 2 on, the map names its act — the dump must say WHICH climb the
  // floors belong to now that the run outlives its first summit.
  if ((state.act ?? 1) > 1) lines.splice(0, 1, `MAP — act ${state.act} — floor ${state.floor + 1}/${state.map.rows.length}`);
  if (state.quests) lines.push(`QUESTS ${state.quests.map((q) => `${q.id} ${q.done ? 'DONE' : `${q.progress}/${QUESTS[q.id].goal}`}`).join(' | ')}`);
  lines.push('NEXT');
  availableNodes(state).forEach((n, i) => {
    lines.push(` n${i + 1} ${NODE_TYPES[n.type].label}`);
  });
  if (opts.verbose) {
    const row = state.floor >= 0 ? state.map.rows[state.floor] : [];
    lines.push('PATH');
    lines.push(` at: ${row.length > 0 ? row.map((n) => n.id).join(', ') : 'start'}`);
    lines.push(` hp: ${state.player.hp}/${state.player.maxHp} deck: ${state.deck.length}`);
  }
  return lines;
}

/**
 * Render the legal actions, one per line, as `<id> <verb>` (R5).
 * Produced in the kernel for the same reason observe() is: a surface must never be
 * able to show (or accept) an action the other surface cannot.
 *
 * CARD LINES ARE `<p-slot> <cardId>`, e.g. `p1 bash`. Two deliberate omissions:
 *
 *   - No cost. The PM ruling froze the 8-token ceiling ahead of the illustrative
 *     `3 bash A8+V2 EN2` line; cost stays in the R4 hand dump and still gates
 *     legality, so nothing is hidden, it is just not paid for twice.
 *   - No effect summary. Measured: `<slot> <name> <summary>` overran the ceiling on
 *     12 of 40 cards (worst 15 tokens, `p3 pummel A2 A2 A2 A2 EXH`). Effects are
 *     already in the hand dump the agent reads to decide; repeating them per action
 *     would be the single largest avoidable cost in the interface.
 *
 * Measured worst across all 42 content ids: 7 tokens (`p1 sword_boomerang`). Unlike
 * a name+summary scheme, this form is bounded BY CONSTRUCTION as content grows —
 * the only input is the slot and the card's stable id — and tests/budget.test.js
 * fails CI if any shipped id ever breaks the ceiling.
 * @param {any} state
 * @returns {string}
 */
export function observeActions(state) {
  const lines = [];
  for (const a of legalActions(state)) {
    switch (a.kind) {
      case 'play':
        lines.push(`${a.id} ${a.cardId}`);
        break;
      case 'end_turn':
        lines.push(`${a.id} end`);
        break;
      case 'travel':
        lines.push(`${a.id} ${NODE_TYPES[a.nodeType].label}`);
        break;
      case 'pick':
        lines.push(`${a.id} ${a.cardId}`);
        break;
      case 'skip':
        lines.push(`${a.id} skip`);
        break;
      case 'rest_heal':
        lines.push(`${a.id} heal`);
        break;
      case 'rest_leave':
        lines.push(`${a.id} leave`);
        break;
      case 'boon':
        lines.push(`${a.id} ${a.boon}`);
        break;
      case 'temper':
        lines.push(`${a.id} temper ${a.offer.cardId} ${a.offer.temper}`);
        break;
      // S4 shop lines carry NO price, on the same ruling that keeps Energy costs out of
      // combat lines: the price sits in the SHOP dump above each shelf and it is the
      // price that gates legality, so the line stays a pure id + name (bounded by
      // construction as content grows, tests/budget.test.js).
      case 'shop_buy':
        lines.push(`${a.id} ${a.cardId}`);
        break;
      case 'shop_removal':
        lines.push(`${a.id} remove_card`);
        break;
      case 'shop_remove_pick':
        lines.push(`${a.id} ${a.cardId}`);
        break;
      case 'shop_leave':
        lines.push(`${a.id} leave`);
        break;
      // S5 belt lines carry the potion id, name-only like every other action line
      // (the effect text lives in the BELT dump above, the same ruling that keeps
      // Energy costs out of combat lines). Bounded by construction: the only input
      // is the slot index and the stable potion id.
      case 'quaff':
        lines.push(`${a.id} ${a.potionId}`);
        break;
      case 'discard_potion':
        lines.push(`${a.id} discard ${a.potionId}`);
        break;
      // S6 event lines: id + the choice's stable slug (bounded by construction, the
      // same ruling as every other line — costs and requirements live in the EVENT
      // dump above, and they gate legality exactly like Energy does).
      case 'event_choice':
        lines.push(`${a.id} ${a.slug}`);
        break;
      case 'event_temper':
        lines.push(`${a.id} temper ${a.offer.cardId} ${a.offer.temper}`);
        break;
      case 'event_continue':
        lines.push(`${a.id} continue`);
        break;
      // S7 relic lines: id + the stable relic id (name-only, the same ruling as every
      // other action line — the offer's words live in the REWARD dump above).
      case 'relic_pick':
        lines.push(`${a.id} ${a.relicId}`);
        break;
      default:
        lines.push(`${a.id} ?`);
    }
  }
  return lines.join('\n');
}

/**
 * Status labels for the structured snapshot (same abbreviations as the text dump).
 * `side` picks whose fact the words state: the hero's Strength says "your attacks deal
 * N more damage", an ENEMY's says "its attacks deal N more damage" — the same counters
 * mean different things per side, and a chip that borrowed the player's wording on an
 * enemy told the reader the buff was theirs.
 * @param {any} statuses
 * @param {string} [lang]
 * @param {'player'|'enemy'} [side]
 */
function statusPairs(statuses, lang = 'en', side = 'player') {
  return Object.entries(statuses ?? {})
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([key, stacks]) => ({
      key,
      stacks,
      // Compact form for the CLI and for anyone who has read the glossary.
      label: `${STATUS_ABBREV[key] ?? key.toUpperCase()}${stacks}`,
      // The human word for the status ("Strength"), for the chip popovers: the compact
      // `label` is the agent-facing token, never a popover title.
      name: statusName(key, lang),
      // The same fact in words, for a reader meeting it for the first time. Derived
      // here, in the kernel, so no surface can invent its own wording.
      text: `${describeStatus(key, stacks, side, lang).replace(/\.$/, '')}`,
      explain: describeStatus(key, stacks, side, lang),
    }));
}

/** The hero's relic name and switched-off text, for relic-off boon text. */
function heroRelic(state, lang = 'en') {
  const es = lang === 'es';
  const ch = defaultContent().characters.get(state.character);
  const def = RELICS[relicId(state)];
  return {
    name: (es ? ch?.relicName_es : null) || ch?.relicName || 'relic',
    name_es: ch?.relicName_es,
    offText: (es ? def?.offText_es : null) || def?.offText || 'stops working',
    offText_es: def?.offText_es,
  };
}

/**
 * S7: the held-relics rows, published in EVERY phase (the relics are run state and the
 * HUD chip shows them everywhere). Row facts mirror the belt's: `known: false` marks an
 * id the relic table no longer knows (a torn save) — it still renders, the raw id is
 * its own name, and it contributes no hooks (relicSum skips it). `text` is the kernel
 * table's own sentence (in the snapshot's language, via the relic table's `_es` twins);
 * `tier` feeds the codex-style hue a surface may paint. `summary` stays the compact CLI
 * form — English-only, like the dump it came from.
 * @param {any} state
 * @param {string} [lang]
 */
function relicRows(state, lang = 'en') {
  return relicList(state).map((id, i) => {
    const def = relicDef(id);
    return {
      slot: i + 1,
      relicId: id,
      known: Boolean(def),
      name: def ? fieldFor(def, 'name', lang) : id,
      summary: def ? def.summary : '',
      text: def ? fieldFor(def, 'text', lang) : '',
      tier: def ? def.tier : 'unknown',
      // relics[0] is the starter the kindling Iron Skin boon can switch off.
      starting: i === 0,
    };
  });
}

/**
 * Legal play actions, grouped the way the hand needs them: which slots are playable
 * at all, and the aim choices per slot.
 *
 * A card that needs a target is offered as ONE action per living enemy (`p1_1`, `p1_2`),
 * while its hand slot is the bare `p1`. Matching on the exact action id therefore marked
 * every attackable card unplayable — the whole hand greyed out with energy to spare. The
 * slot prefix is what a hand tile is playable by, so match on that.
 */
function playTargets(legal) {
  const playableSlots = new Set(
    legal.filter((a) => a.kind === 'play').map((a) => String(a.id).replace(/_\d+$/, '')),
  );
  // Actions per slot, so a view can offer the target choice without re-deriving legality.
  const targetsBySlot = new Map();
  for (const a of legal) {
    if (a.kind !== 'play') continue;
    const m = /^p(\d+)_(\d+)$/.exec(String(a.id));
    if (!m) continue;
    const slotKey = `p${m[1]}`;
    if (!targetsBySlot.has(slotKey)) targetsBySlot.set(slotKey, []);
    targetsBySlot.get(slotKey).push({ index: Number(m[2]), actionId: a.id });
  }
  return { playableSlots, targetsBySlot };
}

/** The hand section of a snapshot: one tile's worth of facts per card. */
function snapshotHand(state, legal, lang = 'en') {
  const { playableSlots, targetsBySlot } = playTargets(legal);
  // PARITY: the hand tile speaks the numbers the engine will actually land, not the
  // printed ones. The fold context reads the LIVE combat state and its math goes through
  // the SAME resolvers the rules use (playerStrike / vulnerableAmplify / blockGain), so
  // a card face cannot disagree with what playing it will do. `vuln` is resolved PER
  // TARGET: with exactly one enemy alive the aimed card's target is unambiguous and its
  // Vulnerable folds straight into `description`; with several alive the top-level
  // sentence keeps the honest no-vuln print (the target is the player's choice) and each
  // living enemy's variant rides in `descriptionsByTarget` for the aiming UI to swap in
  // live. AOE folds Vulnerable only when it is unambiguous — exactly one alive body and
  // it is Vulnerable (every hit lands on the same ×3/2); over a mixed field it never
  // claims it, the amplification is not one number.
  // Collection surfaces (codex, deck sheet, shop, reward) call describeCard WITHOUT the
  // fold and keep the printed card: with no combat to read, there is nothing to fold.
  const inCombat = state.phase === 'combat' && state.combat?.active;
  const alive = inCombat ? state.combat.enemies.filter((e) => !e.dead) : [];
  const foldBase = inCombat ? {
    strength: state.player.statuses?.strength ?? 0,
    weak: state.player.statuses?.weak ?? 0,
    dexterity: state.player.statuses?.dexterity ?? 0,
  } : null;
  const fold = foldBase ? { ...foldBase, vuln: alive.length === 1 && (alive[0].statuses?.vulnerable ?? 0) > 0 } : null;
  return (state.combat?.hand ?? []).map((card, i) => {
    const { def, temper } = temperedView(state, card, defOf(card));
    const hpCost = temperHpCost(temper);
    const slot = `p${i + 1}`;
    const playable = playableSlots.has(slot);
    const targets = targetsBySlot.get(slot) ?? [];
    // PARITY-2: one sentence variant per LIVING enemy, keyed by the SAME 1-based
    // living-enemy slot the `targets` aim actions use. Only target-needing cards in a
    // multi-enemy field carry it; null when no variant differs from `description`, so a
    // clean field adds zero payload and the renderer falls back to the resting face.
    let descriptionsByTarget = null;
    // PARITY-2b: the same swap for the CHIP ROW. On a fully chip-covered card the
    // sentence is hidden, so the folded number would be invisible exactly when aiming —
    // the crosshair's whole point. Each living enemy gets its chips re-derived through
    // the fold with ITS OWN Vulnerable (the same resolvers the sentence rider runs), and
    // a key is published ONLY when that enemy's variant actually differs from the base
    // row — a clean field adds zero payload, like the sentence variants above.
    let chipsByTarget = null;
    if (foldBase && targets.length > 0) {
      const restingChips = cardChips(def, lang, { ...foldBase, vuln: false });
      const chipVariants = alive.map((enemy, j) => cardChips(def, lang, { ...foldBase, vuln: (enemy.statuses?.vulnerable ?? 0) > 0 }));
      chipVariants.forEach((v, j) => {
        if (JSON.stringify(v) !== JSON.stringify(restingChips)) {
          chipsByTarget ??= {};
          chipsByTarget[j + 1] = v;
        }
      });
    }
    if (foldBase && targets.length > 0) {
      const variants = alive.map((enemy, j) => describeCard(def, card, lang, { ...foldBase, vuln: (enemy.statuses?.vulnerable ?? 0) > 0 })
        + (hpCost > 0 ? (lang === 'es' ? ` Pierdes ${hpCost} HP al jugarla.` : ` Lose ${hpCost} HP when played.`) : ''));
      const resting = describeCard(def, card, lang, { ...foldBase, vuln: false })
        + (hpCost > 0 ? (lang === 'es' ? ` Pierdes ${hpCost} HP al jugarla.` : ` Lose ${hpCost} HP when played.`) : '');
      if (variants.some((s) => s !== resting)) {
        descriptionsByTarget = {};
        variants.forEach((s, j) => { descriptionsByTarget[j + 1] = s; });
      }
    }
    return {
      slot,
      cardId: card.cardId,
      // A `name_es` twin in cards.json renders when the lang asks for it (I18N-2's
      // content sweep fills the field in; until then every card falls back honestly).
      name: fieldFor(def, 'name', lang),
      flavor: fieldFor(def, 'flavor', lang),
      cost: card.cost,
      type: def.type,
      rarity: def.rarity,
      // B2: the instance's temper (null when untempered or the run has none).
      temper,
      temperName: temper ? fieldFor(TEMPERS[temper], 'name', lang) : '',
      temperText: temper ? fieldFor(TEMPERS[temper], 'text', lang) : '',
      // Same card, second rendering. `summary` stays the CLI's compact form (frozen by
      // tests/budget.test.js); `description` is the sentence a human reads instead.
      typeLabel: typeLabel(def.type, lang),
      // Both read the TEMPERED definition, so a Red-hot Hammerfall says "Deal 9 damage."
      // In combat the hand's sentence carries the status fold (PARITY above); the other
      // surfaces read the same builder WITHOUT the fold — the printed card.
      summary: effectSummary(def),
      description: describeCard(def, card, lang, fold)
        + (hpCost > 0 ? (lang === 'es' ? ` Pierdes ${hpCost} HP al jugarla.` : ` Lose ${hpCost} HP when played.`) : ''),
      // PARITY-2 per-target variants (null when none differs), keyed by the 1-based
      // living-enemy slot — the same k the aim actions and the GUI's `aimed` use.
      descriptionsByTarget,
      // The EFFECT CHIPS (the tile's icon row): one `{verb, status?, amount, num, label,
      // explain}` per effect, worded kernel-side so a tile prints and never derives. Read
      // off the TEMPERED definition, like `summary`/`description` above, so a Red-hot
      // Hammerfall's chip says 9×1 — and through the SAME live fold the sentence rides,
      // so the icon's number is the number the play lands. `chipsComplete` is the tile's
      // licence to drop the visible sentence: true only when every effect carries a chip
      // (a `custom` verb keeps the sentence — its meaning is bespoke and no icon claims
      // it) AND the tempered play carries no HP rider — a "Lose 2 HP when played." tail
      // has no chip to speak for it, so the sentence STAYS on the face beside the icons.
      chips: cardChips(def, lang, fold),
      chipsComplete: chipsCover(def) && hpCost === 0,
      // PARITY-2b per-target chip variants (null when none differs from the base row),
      // keyed by the 1-based living-enemy slot — the same k `descriptionsByTarget` and
      // the aim actions use, so the renderer swaps both faces with one lookup.
      chipsByTarget,
      playable,
      // The engine's own answer to "may this card be aimed?" — so a renderer never has to
      // infer it from the card type (Defend is type 'skill', Bash is 'attack', but the
      // rule belongs here, in the kernel).
      target: def.target ?? 'self',
      // Non-empty only when the player actually has a choice to make: more than one living
      // enemy AND a card that must be aimed. Empty means "one click plays it".
      targets: targets.length > 1 ? targets : [],
      hint: describePlayability({ cost: card.cost, playable }, state.player.energy, lang),
    };
  });
}

/** The enemies section of a snapshot: intent included, dead enemies omitted. */
function snapshotEnemies(state, lang = 'en') {
  return (state.combat?.enemies ?? [])
    .filter((e) => !e.dead)
    .map((e) => {
      const def = ENEMIES[e.id];
      const move = def.moves[e.moveIndex] ?? def.moves[0];
      return {
        index: e.index,
        id: e.id,
        // I18N-2: the display twin renders in the snapshot's language; the state's own
        // `name` (stateName) stays English — the hash never moves for a language choice.
        name: fieldFor(def, 'name', lang),
        hp: e.hp,
        maxHp: e.maxHp,
        block: e.block,
        statuses: statusPairs(e.statuses, lang, 'enemy'),
        intent: {
          label: intentLabel(e),
          kind: move.kind,
          damage: intentDamage(e),
          hits: move.hits ?? 1,
          // The STRUCTURED chip facts (feature: enemies speak in chips): what the move
          // does, as data, so a renderer never parses the label string to build a chip.
          // `block` when the move guards (an attack-and-block move carries both), and
          // every status the move applies — debuff stacks onto the player, a buff's
          // Strength onto itself (`to: 'self'`), the same split the status pills keep.
          block: move.block ?? null,
          statuses: [
            ...(move.vulnerable ? [{ status: 'vulnerable', stacks: move.vulnerable }] : []),
            ...(move.weak ? [{ status: 'weak', stacks: move.weak }] : []),
            ...(move.kind === 'buff' && move.strength ? [{ status: 'strength', stacks: move.strength, to: 'self' }] : []),
          ],
          // The sentence for the SAME intent, from the same rules, so the compact number
          // and the readable line can never disagree. The enemy NAME stays English until
          // I18N-2 sweeps the encounter tables.
          text: describeIntent(e, lang),
        },
      };
    });
}

/**
 * The INTENT CHIP row of one snapshot enemy row (feature: enemies speak in chips): what
 * the announced move does, as the same chip shape a card face carries — an attack chip,
 * a block chip when the move guards, and one chip per status the move applies (debuffs
 * onto the player, a buff's Strength onto itself). Every chip's `explain` is the
 * intent's OWN describeIntent sentence, so clicking any of them explains the whole move
 * in kernel wording, and no renderer parses the label string to learn any of it.
 *
 * Numbers come from the snapshot's own facts (`intent.damage` is the engine's
 * intentDamage — Strength already added, Weak already applied; `hits` the move's), so a
 * chip and the compact badge can never disagree. A move kind the shape does not cover
 * yields no chips and the renderer falls back to the sentence — never a guess.
 * @param {any} enemy a snapshot enemy row (its `intent` carries the facts)
 * @param {string} [lang] 'en' (default) or 'es'
 * @returns {Array<object>} chips of `{verb, amount?, hits?, status?, num, label, explain}`
 */
export function intentChips(enemy, lang = 'en') {
  const intent = enemy?.intent ?? {};
  const explain = intent.text || intent.label || '';
  const out = [];
  const push = (chip) => out.push({ ...chip, explain });
  if (intent.kind === 'attack' && typeof intent.damage === 'number' && intent.damage > 0) {
    const hits = intent.hits ?? 1;
    // The badge's own convention: the per-hit number × hits (intent.damage is the TOTAL).
    push({
      verb: 'attack',
      amount: intent.damage,
      ...(hits > 1 ? { hits } : {}),
      num: hits > 1 ? `${Math.round(intent.damage / hits)}×${hits}` : String(intent.damage),
      label: chipVerbLabel('attack', lang),
    });
  }
  // Statuses before the block chip, so each move's chip order mirrors its sentence's
  // clause order: "attack for 7 and block 5", "power up: +3 Strength and gain 6 Block".
  for (const s of intent.statuses ?? []) {
    push({
      verb: 'status',
      status: s.status,
      amount: s.stacks,
      num: `+${s.stacks}`,
      label: statusName(s.status, lang),
    });
  }
  if ((intent.block ?? 0) > 0) {
    push({ verb: 'block', amount: intent.block, num: String(intent.block), label: chipVerbLabel('block', lang) });
  }
  return out;
}

/** The map section of a snapshot: every node, with availability decided here. */
function snapshotMap(state, legal) {
  const travel = new Map(legal.filter((a) => a.kind === 'travel').map((a) => [a.nodeId, a.id]));
  const currentRow = state.floor >= 0 ? state.map.rows[state.floor] : [];
  const nextNodes = availableNodes(state);
  return {
    floor: state.floor,
    floorCount: state.map.rows.length,
    current: state.mapNodeId,
    // Every node, grouped by row, with flags the view can paint: `available` (a legal
    // destination) and `current` (where the player stands). Availability is decided
    // here, not guessed by the renderer. `next` is the node's OWN stored edge list —
    // the band the edge rule generated (a legacy save's full row) — so the map view
    // draws the real branches instead of assuming a lattice.
    rows: state.map.rows.map((row, r) =>
      row.map((n) => ({
        id: n.id,
        type: n.type,
        label: NODE_TYPES[n.type].label,
        row: r,
        next: n.next ?? [],
        current: r === state.floor && n.id === state.mapNodeId,
        available: nextNodes.some((a) => a.id === n.id),
        actionId: travel.get(n.id) ?? null,
      })),
    ),
    currentRow: currentRow.map((n) => n.id),
  };
}

/** The reward section of a snapshot, or null when no reward is open. */
function snapshotReward(state, legal, lang = 'en') {
  if (!state.reward) return null;
  const pick = new Map(legal.filter((a) => a.kind === 'pick').map((a) => [a.cardId, a.id]));
  // S7: the boss's relic offers. The r-ids resolve here from the SAME legal list the
  // dump reads, so an offer the kernel refuses (unknown id, already held — unreachable
  // through play) carries `actionId: null` and a surface greys it out for the same
  // reason a shop shelf greys out; `known: false` marks a torn id rendering as itself.
  const relicPicks = new Map(legal.filter((a) => a.kind === 'relic_pick').map((a) => [a.index, a.id]));
  return {
    canSkip: legal.some((a) => a.kind === 'skip'),
    skipId: legal.find((a) => a.kind === 'skip')?.id ?? null,
    // S3: the spoils THIS victory paid (`state.reward.gold`, set by the victory path)
    // and the purse it landed in. null marks "no grant on record" — a legacy save's
    // reward predates the field — so a surface hides the line instead of printing +0.
    goldGained: typeof state.reward.gold === 'number' ? state.reward.gold : null,
    purse: state.player.gold ?? 0,
    // S7 boss: the offer rows, the phase flag the view heads with, and the pick that
    // ends the run. null offers (a card reward, or a legacy save) degrade to [].
    boss: Boolean(state.reward.boss),
    relicOffers: (Array.isArray(state.reward.relicOffers) ? state.reward.relicOffers : []).map((id, i) => {
      const def = relicDef(id);
      return {
        index: i,
        actionId: relicPicks.get(i) ?? null,
        relicId: id,
        known: Boolean(def),
        name: def ? fieldFor(def, 'name', lang) : id,
        summary: def ? def.summary : '',
        text: def ? fieldFor(def, 'text', lang) : '',
        tier: def ? def.tier : 'unknown',
        affordable: relicPicks.has(i),
      };
    }),
    // An elite's GUARANTEED drop, the spoils line's fact — null when this fight
    // dropped nothing (or the reward predates the field), so a surface hides the chip.
    relicGained: typeof state.reward.relic === 'string'
      ? (() => {
        const def = relicDef(state.reward.relic);
        return { relicId: state.reward.relic, known: Boolean(def), name: def ? fieldFor(def, 'name', lang) : state.reward.relic, summary: def ? def.summary : '', text: def ? fieldFor(def, 'text', lang) : '' };
      })()
      : null,
    cards: state.reward.cards.map((id) => {
      // Tolerant like rewardBody above (defOrNull): an unknown reward id — a stale save
      // after a rename — renders as a placeholder row (raw id, cost 0, type "unknown")
      // instead of throwing the whole snapshot away. It stays VISIBLE, not dropped.
      const def = defOrNull(id);
      return {
        cardId: id,
        name: def ? fieldFor(def, 'name', lang) : id,
        flavor: fieldFor(def, 'flavor', lang),
        cost: def?.cost ?? 0,
        type: def?.type ?? 'unknown',
        typeLabel: def ? typeLabel(def.type, lang) : 'unknown',
        summary: def ? effectSummary(def) : '',
        description: def ? describeCard(def, {}, lang) : '',
        // The reward tiles render the same chip row as the hand (kernel-worded, so a
        // card picked from a reward and the same card drawn in a fight cannot disagree).
        chips: def ? cardChips(def, lang) : [],
        chipsComplete: def ? chipsCover(def) : false,
        actionId: pick.get(id) ?? null,
      };
    }),
  };
}

/** The rest-site section of a snapshot, or null when the player is not resting. */
function snapshotRest(state, legal, lang = 'en') {
  if (state.phase !== 'rest') return null;
  return {
    healId: legal.find((a) => a.kind === 'rest_heal')?.id ?? null,
    leaveId: legal.find((a) => a.kind === 'rest_leave')?.id ?? null,
    heal: REST_HEAL,
    tempers: (state.temperOffers ?? []).map((o, i) => ({
      // Tolerant like rewardBody (defOrNull): an unknown offer id shows its raw id.
      // The TEMPERED FACE rides the offer (temperedCardRow — the same helper the smith's
      // event modal and the resolved beat's refs publish), so the forge's pick tiles show
      // the numbers the tempered copy will actually play. Both surfaces read ONE publisher.
      actionId: `t${i + 1}`,
      ...temperedCardRow(o.cardId, o.temper, lang),
      cardName: fieldFor(defOrNull(o.cardId), 'name', lang) || o.cardId,
      text: fieldFor(TEMPERS[o.temper], 'text', lang),
    })),
  };
}

/** The kindling section of a snapshot, or null when no boon is being chosen. */
function snapshotKindling(state, lang = 'en') {
  if (state.phase !== 'kindling') return null;
  return {
    boons: state.kindling.offers.map((id, i) => ({
      id,
      // I18N-2: the boon's display twin; `label` stays the compact agent-facing token.
      name: fieldFor(BOONS[id], 'name', lang),
      text: boonText(id, heroRelic(state, lang), lang),
      label: BOONS[id].label,
      actionId: `k${i + 1}`,
    })),
  };
}

/**
 * S5: the potion belt. Published in EVERY phase (the belt is run state and the HUD
 * shows it everywhere), while its actions only ever exist in combat — so the action
 * ids below are resolved from the phase's own legal list and are simply empty outside
 * combat. Row facts:
 *   - `known: false` marks a belt id the potion table no longer knows (a torn save).
 *     It still renders — the raw id is its own name — and offers a DISCARD (so the
 *     corrupt slot can be cleared) but never a quaff: the handler would refuse it,
 *     and a refused id is never offered (S4.1).
 *   - `quaffIds` holds ONE id (q<n>) or one per living enemy (q<n>_1, q<n>_2) when the
 *     potion must be aimed, in living-enemy order — the same list shape the hand's
 *     `targets` field uses, so a renderer can drive the choice without re-deriving it.
 *   - `summary`/`text` are the kernel table's own words (the text in the snapshot's
 *     language, via the `_es` twins), verbatim: no surface re-derives what a potion does.
 * @param {any} state
 * @param {any[]} legal
 * @param {string} [lang]
 */
function snapshotBelt(state, legal, lang = 'en') {
  const quaffs = new Map();
  const discards = new Map();
  for (const a of legal) {
    if (a.kind === 'quaff') {
      if (!quaffs.has(a.index)) quaffs.set(a.index, []);
      quaffs.get(a.index).push(a.id);
    } else if (a.kind === 'discard_potion') {
      discards.set(a.index, a.id);
    }
  }
  return (Array.isArray(state.potions) ? state.potions : []).map((potionId, i) => {
    // Tolerant like rewardBody (defOrNull's policy): an unknown id shows itself.
    const def = potionDef(potionId);
    return {
      slot: i + 1,
      potionId,
      known: Boolean(def),
      name: def ? fieldFor(def, 'name', lang) : potionId,
      summary: def ? def.summary : '',
      text: def ? fieldFor(def, 'text', lang) : '',
      target: def ? def.target : 'none',
      quaffIds: quaffs.get(i) ?? [],
      discardId: discards.get(i) ?? null,
    };
  });
}

/**
 * S4: the shop section of a snapshot, or null outside the shop phase.
 *
 * Everything a shelf tile or the service button needs is decided HERE: `actionId` is
 * null exactly when the kernel offers no action (sold out, or the purse cannot cover
 * the price — R6's afford-filter), so a renderer greys a tile out for the same reason
 * a hand tile greys out for missing Energy, and can never paint a buyable button the
 * kernel would reject. `affordable`/`sold` are kept as separate facts so the view can
 * say WHY a tile is inert.
 *
 * The removal step lists deck INSTANCES (uid-precise): copies of one card are distinct
 * choices, distinguished by `copy`/`copies` — the 1-based position of this instance
 * among the deck's same-cardId-same-temper copies, in deck order (deterministic). The
 * pick's `index` is the deck position the kernel's `x<n>` action removes.
 * @param {any} state
 * @param {any[]} legal
 * @param {string} [lang]
 */
function snapshotShop(state, legal, lang = 'en') {
  if (state.phase !== 'shop') return null;
  const shop = state.shop ?? { offers: [], removal: {}, removing: false };
  const buys = new Map(legal.filter((a) => a.kind === 'shop_buy').map((a) => [a.index, a.id]));
  const picks = legal.filter((a) => a.kind === 'shop_remove_pick');
  const purse = state.player.gold ?? 0;
  const rem = shop.removal ?? {};

  // Copy census for the removal list: count occurrences per (cardId, temper) key, then
  // walk the deck again to give each instance its 1-based copy number in deck order.
  const census = new Map();
  for (const inst of state.deck ?? []) {
    const key = `${inst.cardId}|${state.tempers?.[inst.uid] ?? ''}`;
    census.set(key, (census.get(key) ?? 0) + 1);
  }
  const seen = new Map();
  const deckInstances = (state.deck ?? []).map((inst, i) => {
    const def = defOrNull(inst.cardId);
    const temper = state.tempers?.[inst.uid] ?? null;
    const { def: temperedDef } = def ? temperedView(state, inst, def) : { def: null };
    const key = `${inst.cardId}|${temper ?? ''}`;
    const copy = (seen.get(key) ?? 0) + 1;
    seen.set(key, copy);
    return {
      index: i,
      actionId: picks[i]?.id ?? null,
      cardId: inst.cardId,
      uid: inst.uid,
      name: fieldFor(def, 'name', lang) || inst.cardId,
      cost: def?.cost ?? 0,
      temper,
      temperName: temper ? fieldFor(TEMPERS[temper], 'name', lang) || temper : '',
      // The TEMPERED describe sentence, the deck sheet's own new rule: the removal
      // modal's tile must not print the base number under a temper stamp either.
      description: def ? describeCard(temperedDef, inst, lang) : '',
      // The TEMPERED chip list, same rule: a Red-hot Hammerfall's damage chip says 9.
      chips: temperedDef ? cardChips(temperedDef, lang) : [],
      chipsComplete: temperedDef ? chipsCover(temperedDef) : false,
      copy,
      copies: census.get(key) ?? 1,
    };
  });

  return {
    purse,
    offers: (shop.offers ?? []).map((o, i) => {
      // Tolerant like rewardBody (defOrNull): an unknown shelf id still shows, as a
      // placeholder row, rather than throwing the whole snapshot away.
      const def = defOrNull(o.cardId);
      const actionId = buys.get(i) ?? null;
      return {
        index: i,
        actionId,
        cardId: o.cardId,
        name: def ? fieldFor(def, 'name', lang) : o.cardId,
        flavor: fieldFor(def, 'flavor', lang),
        cost: def?.cost ?? 0,
        type: def?.type ?? 'unknown',
        typeLabel: def ? typeLabel(def.type, lang) : 'unknown',
        rarity: def?.rarity ?? 'unknown',
        summary: def ? effectSummary(def) : '',
        description: def ? describeCard(def, {}, lang) : '',
        // Shop shelves wear the same chips as every other tile (kernel-worded).
        chips: def ? cardChips(def, lang) : [],
        chipsComplete: def ? chipsCover(def) : false,
        price: o.price,
        sold: Boolean(o.sold),
        affordable: actionId !== null,
      };
    }),
    removal: {
      price: rem.price ?? REMOVAL_PRICE,
      sold: Boolean(rem.sold),
      done: Boolean(rem.done),
      // Non-null only when the service can be bought right now (unused, deck > 1,
      // purse covers it) — same contract as an offer tile's actionId.
      actionId: legal.find((a) => a.kind === 'shop_removal')?.id ?? null,
    },
    removing: Boolean(shop.removing),
    // Only meaningful while `removing`, but always published: the modal list is just
    // this array, and an empty array outside the step is no less true.
    deckInstances,
    leaveId: legal.find((a) => a.kind === 'shop_leave')?.id ?? null,
  };
}

/**
 * The resolved beat's CARD REFS, one entry per line and null when the line names no
 * card — the parallel array the event screen renders its card tiles from. The refs are
 * the KERNEL's own: the stored beat lines carry `cardId` (card_joined, card_bought,
 * card_sold) and, for the smith's temper beat, the temper id beside it, and a surface
 * never derives a card from a sentence. A temper entry is a deck-sheet row in miniature
 * (snapshotDeck's shape): the temper's own name and rules sentence, PLUS the TEMPERED
 * face — synthetic def, describeCard/cardChips off it — so the event tile shows the
 * numbers the tempered copy actually plays (B2's "every rendering shows the tempered
 * numbers"; a Quenched Bulwark says Gain 5 Block. Gain 3 Block. here too). A plain card
 * line publishes just the ref: the tile's resting face comes from the describe layer,
 * which reads the plain definition. A legacy save's plain-string lines, an unknown
 * temper id or card id, and every non-card beat degrade — null, or a bare ref with no
 * face — never a throw, and the sentence still carries the whole story.
 * @param {any} lines the stored `resolved.lines`
 * @param {string} lang
 * @returns {Array<object|null>}
 */
function beatCards(lines, lang) {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => {
    if (!line || typeof line !== 'object' || typeof line.cardId !== 'string') return null;
    const temper = typeof line.temper === 'string' && TEMPERS[line.temper] ? line.temper : null;
    // The tempered face is the ONE helper's row (temperedCardRow above) — the same
    // shape the smith's offers and the rest site's forge list publish, so the resolved
    // tile can never disagree with the offer tile it came from.
    return temper ? temperedCardRow(line.cardId, temper, lang) : { cardId: line.cardId };
  });
}

/**
 * S6: the event section of a snapshot, or null outside the event phase.
 *
 * The ONE offer table (rules/events.js offerEventChoices) decides everything a choice
 * button needs: `actionId` is null exactly when the kernel offers no action (an unmet
 * requirement — the same afford-filter contract as a shop shelf), `reason` is the
 * WHY the dimmed button shows, and `cost`/`hpLoss` are the price chips' facts. The
 * resolved beat carries the kernel's own result lines with their card refs beside them
 * (beatCards above); the temper modal's offers ride beside them. A torn save (unknown
 * story id, or the field null) degrades: `known` is false, the story is empty, no
 * choices, and `continueId` is still the way out.
 * @param {any} state
 * @param {any[]} legal
 * @param {string} [lang]
 */
function snapshotEvent(state, legal, lang = 'en') {
  if (state.phase !== 'event') return null;
  const ev = state.event ?? null;
  const def = eventDef(ev?.id);
  const choices = new Map(legal.filter((a) => a.kind === 'event_choice').map((a) => [a.index, a.id]));
  const temperPicks = new Map(legal.filter((a) => a.kind === 'event_temper').map((a) => [a.index, a.id]));
  const evald = def ? offerEventChoices(state, CARD_DEFS ?? defaultContent().cards, lang) : [];
  return {
    eventId: def ? def.id : (ev?.id ?? null),
    known: Boolean(def),
    name: def ? fieldFor(def, 'name', lang) : (ev?.id ?? (lang === 'es' ? 'el camino' : 'the wayside')),
    story: def ? fieldFor(def, 'story', lang) : '',
    purse: state.player.gold ?? 0,
    hp: state.player.hp,
    maxHp: state.player.maxHp,
    tempering: Boolean(ev?.tempering),
    // Only meaningful while `tempering`; published always, like the shop's deck list.
    // Elements are coalesced through the kernel's own enumeration guard (S6.1 review
    // P2: a validate-accepted save may carry null/garbage offer elements, and `.map`
    // used to read `o.cardId` straight out of them). The map runs over the ORIGINAL
    // indices — so the surviving rows still resolve their `t<n>` actionId from the
    // same number actions() enumerates — and a refused element emits no row at all:
    // the view renders only picks the kernel actually offers (S4.1/S5 ruling).
    offers: (Array.isArray(ev?.offers) ? ev.offers : [])
      .map((o, i) => (temperOfferOpen(o, state) ? ({
        actionId: temperPicks.get(i) ?? null,
        // The TEMPERED FACE rides the offer (temperedCardRow — the same helper the
        // resolved beat's refs and the rest site's forge list use): the pick tile shows
        // the numbers the tempered copy will actually play, never the base card's.
        ...temperedCardRow(o.cardId, o.temper, lang),
        // The pre-face fields keep their names: `cardName` is the aria contract's card
        // word, `text` the temper's own sentence ("Quenched: also gain 3 Block.").
        cardName: fieldFor(defOrNull(o.cardId), 'name', lang) || o.cardId,
        text: fieldFor(TEMPERS[o.temper], 'text', lang),
      }) : null))
      .filter(Boolean),
    choices: evald.map((c) => ({
      index: c.index,
      actionId: choices.get(c.index) ?? null,
      slug: c.slug,
      label: c.label,
      effect: c.effect,
      cost: c.cost,
      hpLoss: c.hpLoss,
      offered: c.offered,
      reason: c.reason,
    })),
    // Array.isArray, not a spread default: a torn beat (lines = 42, or a string) is
    // validateSave-accepted and `[...(lines ?? [])]` threw straight out of snapshot()
    // (S6.1 review P2) — the same guard the dump applies to the same field.
    // I18N-2: the beat renders in the snapshot's language from its structured slugs
    // (rules/events.js renderEventLines); a legacy save's baked English sentence
    // strings pass through verbatim — the honest degrade, documented in PLAYING.md.
    // `cards` runs PARALLEL to `lines` (same index, null where the line names no card):
    // the beat's own card refs, so the event screen can show the card instead of only
    // naming it — the same kernel-publishes / surface-sinks ruling as every tile.
    resolved: ev?.resolved
      ? {
          choice: ev.resolved.choice,
          lines: renderEventLines(ev.resolved?.lines, lang, CARD_DEFS ?? defaultContent().cards),
          cards: beatCards(ev.resolved?.lines, lang),
        }
      : null,
    continueId: legal.find((a) => a.kind === 'event_continue')?.id ?? null,
  };
}

/** Code-unit comparison, not localeCompare: the sort must be byte-identical everywhere. */
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The master-deck section of a snapshot (S1): every card the run owns, duplicates
 * aggregated under one row, sorted deterministically by cost, then face name, then card
 * id, then temper key — the same row list from every surface on every machine.
 *
 * Names, costs, type words and temper effects all come from this file's describe layer
 * (`defOf` / `temperedView` / `CARD_TYPE_LABEL`), so a deck row can never disagree with
 * the hand tile or the CLI dump about what a card is or what a tempered copy plays.
 * The ONE exception is an id the content no longer knows: it becomes a placeholder row
 * (name = the raw id, type "unknown") instead of a throw — see the comment in the body.
 * Read-only by construction: it reads `state.deck` and `state.tempers` and allocates
 * fresh rows, so the frozen state is never touched.
 * @param {any} state
 * @param {string} [lang]
 * @returns {Array<{cardId: string, name: string, cost: number, type: string, typeLabel: string, tempered: boolean, temper: string | null, temperName: string, temperText: string, count: number}>}
 */
function snapshotDeck(state, lang = 'en') {
  const rows = new Map();
  // The English face name per row key: the sheet's SORT key stays language-independent
  // (cost, then English name, then id, then temper) while the row's `name` renders in
  // the snapshot's language — an es sheet and an en one read the same rows in the same
  // order, worded differently.
  const enNames = new Map();
  for (const inst of state.deck ?? []) {
    // Tolerant on purpose (rewardBody's policy — the text dump's tolerant lookup, shared
    // as defOrNull above): a deck id the content no longer knows — a stale save after a
    // rename, or a typo'd id pushed in through the save/load lever (validateSave never
    // checks cardIds) — must not kill the page now that every phase's snapshot reads the
    // deck. The unknown id still emits a row, carrying the raw id as its own name and
    // "unknown" as its type word, so the broken entry stays VISIBLE instead of being
    // silently dropped, and the rows-sum === deckCount invariant holds because nothing
    // is skipped. Its neutral cost (0) is a sort key, not a claim.
    const def = defOrNull(inst.cardId);
    if (!def) {
      enNames.set(`${inst.cardId}|`, inst.cardId);
      const key = `${inst.cardId}|`;
      const row = rows.get(key);
      if (row) { row.count += 1; continue; }
      rows.set(key, {
        cardId: inst.cardId,
        name: inst.cardId,
        cost: 0,
        type: 'unknown',
        typeLabel: 'unknown',
        tempered: false,
        temper: null,
        temperName: '',
        temperText: '',
        count: 1,
      });
      continue;
    }
    const { def: temperedDef, temper } = temperedView(state, inst, def);
    const key = `${inst.cardId}|${temper ?? ''}`;
    enNames.set(key, def.name);
    const row = rows.get(key);
    if (row) { row.count += 1; continue; }
    rows.set(key, {
      cardId: inst.cardId,
      name: fieldFor(def, 'name', lang),
      cost: def.cost,
      type: def.type,
      typeLabel: typeLabel(def.type, lang),
      tempered: temper !== null,
      temper,
      temperName: temper ? fieldFor(TEMPERS[temper], 'name', lang) : '',
      temperText: temper ? fieldFor(TEMPERS[temper], 'text', lang) : '',
      // The TEMPERED describe sentence, same rule the hand tile follows (B2): a Red-hot
      // Hammerfall says "Deal 9 damage" here too, so the deck sheet can never disagree
      // with the hand about one card. The hand adds its HP-cost rider on top; the deck
      // sheet's row carries the plain sentence (the stamp's tooltip has the temper's).
      description: def ? describeCard(temperedDef, inst, lang) : '',
      // The TEMPERED chip list, same rule: the deck sheet's tiles paint the icons the
      // hand would.
      chips: cardChips(temperedDef, lang),
      chipsComplete: chipsCover(temperedDef),
      count: 1,
    });
  }
  return [...rows.values()]
    .map((row) => ({ row, sortName: enNames.get(`${row.cardId}|${row.temper ?? ''}`) ?? row.name }))
    .sort((a, b) =>
      (a.row.cost - b.row.cost)
      || byStr(a.sortName, b.sortName)
      || byStr(a.row.cardId, b.row.cardId)
      || byStr(a.row.temper ?? '', b.row.temper ?? ''))
    .map(({ row }) => row);
}

/** Rarity tiers in codex order; anything unknown sorts last, so a new tier cannot crash the sheet. */
const RARITY_TIER = { common: 0, uncommon: 1, rare: 2 };

/**
 * The card codex LOOKUP TABLE: every card the shipped content could ever offer, one row
 * each, enriched through the plain-English describe layer — the same sentences the hand
 * tiles and the reward screen render.
 *
 * THE TRUTH CONTRACT: what a given RUN can actually be offered is `state.draftPool`
 * (newRun narrows it to the profile's content, and rules/act.js rollReward picks from
 * exactly that field), which every snapshot() now publishes as bare ids. A surface
 * filters THESE rows to that id set, per run; it must never present the unfiltered table
 * as a run's offerable pool — a narrowed profile makes the truth SHORTER than this
 * table, never longer. WHY A FUNCTION AND NOT A SNAPSHOT FIELD: the describe work is
 * content-derived and phase-independent, so it is paid once per surface load, not once
 * per action repaint.
 *
 * Rows sort deterministically: rarity tier (common → uncommon → rare), then cost, then
 * face name, then card id — the same row list from every surface on every machine.
 * Read-only: it reads the shipped content and allocates fresh rows, never the run state.
 * @returns {Array<{cardId: string, rarity: string, name: string, cost: number, type: string, typeLabel: string, summary: string, description: string}>}
 */
export function cardPool(opts = {}) {
  const lang = langOf(opts);
  const content = defaultContent();
  // Sort on the DEFINITIONS (whose `name` is the English face name) BEFORE the rows
  // are worded: the row order is language-independent, so an es surface and an en one
  // show the same list order while each renders its own names.
  return draftPoolFrom(content)
    .map((id) => content.cards.get(id))
    .sort((a, b) =>
      ((RARITY_TIER[a.rarity] ?? 9) - (RARITY_TIER[b.rarity] ?? 9))
      || (a.cost - b.cost)
      || byStr(a.name, b.name)
      || byStr(a.id, b.id))
    .map((def) => ({
      cardId: def.id,
      rarity: def.rarity,
      name: fieldFor(def, 'name', lang),
      cost: def.cost,
      type: def.type,
      typeLabel: typeLabel(def.type, lang),
      // Both renderings, as on the hand tiles: `summary` is the CLI's compact form,
      // `description` the sentence a human reads — and the chip list the codex gallery's
      // tiles paint, worded exactly as a hand tile's would be.
      summary: effectSummary(def),
      description: describeCard(def, {}, lang),
      chips: cardChips(def, lang),
      chipsComplete: chipsCover(def),
    }));
}

/**
 * A DOM-free STRUCTURED view of the state, for renderers that must not reimplement
 * a rule. Every derived fact a screen needs (card name/cost/effect text, enemy
 * intent and its damage, which cards are playable, which nodes are reachable) is
 * computed here, in the kernel, which is the only place allowed to know the rules.
 *
 * The R4 text dump and this snapshot are two renderings of ONE state: a browser view
 * built on snapshots therefore cannot show something the CLI cannot. Purely
 * presentational data (colors, layout) stays in the renderer; anything a player
 * could use to decide stays here.
 *
 * Assembly only: each section has its own builder above, so a new screen section is
 * one builder plus one line in the return — the shape of the whole snapshot stays
 * readable at a glance.
 * @param {any} state
 * @param {{verbose?: boolean, lang?: string}} [opts] `lang` — I18N-1: the PRESENTATION
 *   language for the player-facing derived strings ('en' default, 'es' Spanish). It is
 *   a surface choice carried in the opts and nowhere else: no state field, no hash
 *   input, no log change, and the compact `text` dump stays English in either language.
 * @returns {object} JSON-safe value model
 */
export function snapshot(state, opts = {}) {
  const lang = langOf(opts);
  const legal = legalActions(state);

  return {
    phase: state.phase,
    outcome: state.outcome,
    stepIndex: state.stepIndex,
    floor: state.floor,
    turn: state.combat?.turn ?? 0,
    energyPerTurn: state.energyPerTurn ?? 3,
    character: state.character,
    // S9: which act the run is standing in, and how long the climb is. `acts` is null
    // on a legacy save (the field postdates S9) so a surface can tell the runs apart.
    act: state.act ?? 1,
    acts: state.acts ?? null,
    // The CURRENT act's biome (S9): the run's own biome in act 1, the deep act-2 biome
    // after the transition — derived kernel-side (rules/encounters.js currentBiome),
    // because state.biome stays the STARTING biome (the log header's meaning).
    biome: currentBiome(state),
    // I18N-2: the biome's display twin renders with the snapshot's language.
    biomeName: fieldFor(BIOMES[currentBiome(state)], 'name', lang),
    // S9: the START paths — every biome but the act-2 one (rules/encounters.js
    // startBiomeIds). The kindling picker renders these; the full table (including the
    // Deeps) stays in the public BIOMES export.
    biomes: startBiomeIds().map((id) => ({ id, name: fieldFor(BIOMES[id], 'name', lang) })),
    // I18N-2: the hero's display name. Ashwright is a proper noun and carries no twin
    // (it renders identically in either language); the Bellows Keeper's title localizes.
    characterName: fieldFor(defaultContent().characters.get(state.character), 'name', lang) || state.character,
    relicName: fieldFor(defaultContent().characters.get(state.character), 'relicName', lang),
    difficulty: state.difficulty,
    seed: state.seed,
    player: {
      hp: state.player.hp,
      maxHp: state.player.maxHp,
      block: state.player.block,
      energy: state.player.energy,
      // S3 gold economy: the run's purse. `?? 0` keeps a pre-gold legacy save reading
      // as an empty purse instead of undefined leaking into a renderer.
      gold: state.player.gold ?? 0,
      statuses: statusPairs(state.player.statuses, lang),
      powers: Object.entries(state.powers ?? {})
        .filter(([, v]) => v > 0)
        .map(([key, stacks]) => ({
          key,
          stacks,
          label: `${STATUS_ABBREV[key] ?? key.toUpperCase()}`,
          text: `${describePower(key, stacks, lang).replace(/\.$/, '')}`,
          explain: describePower(key, stacks, lang),
        })),
    },
    hand: snapshotHand(state, legal, lang),
    piles: {
      draw: state.combat?.draw?.length ?? 0,
      discard: state.combat?.discard?.length ?? 0,
      exhaust: state.combat?.exhaust?.length ?? 0,
      // Names only, for the pile viewer. Counts above stay the compact facts.
      // I18N-2: the viewer's names render in the snapshot's language; the compact
      // dump's pile line (pileNames) stays English — the agent-facing contract.
      drawCards: pileCardNames(state.combat?.draw, lang),
      discardCards: pileCardNames(state.combat?.discard, lang),
      exhaustCards: pileCardNames(state.combat?.exhaust, lang),
    },
    // S1 master-deck viewer: the whole run deck, aggregated and sorted (snapshotDeck
    // above). `deckCount` is the fact the HUD badge shows; the rows carry the rest.
    deckCount: (state.deck ?? []).length,
    deckCards: snapshotDeck(state, lang),
    // S2 card codex: the ids THIS run's rewards actually roll from (rules/act.js
    // rollReward picks from state.draftPool, which newRun narrowed to the profile's
    // content). Bare ids only — the describe-layer rows live behind the cardPool()
    // export, and a surface filters those to this set. null (not []) marks a state that
    // predates the field (validateSave never required it), so a surface can tell
    // "legacy state, pool unknown" apart from "legitimately empty pool" and degrade to
    // the full lookup table instead of lying about an empty pool.
    draftPool: Array.isArray(state.draftPool) ? [...state.draftPool] : null,
    // S10 relic pool: the ids THIS run's drops and offers actually roll from — the
    // same bare-id convention as draftPool above (the describe rows live behind the
    // relicDef export). null (not []) marks a state that predates the field or was
    // begun without profile info: such a run draws from the FULL table, and a surface
    // must show the full table rather than lie about an empty pool.
    relicPool: Array.isArray(state.relicPool) ? [...state.relicPool] : null,
    enemies: snapshotEnemies(state, lang),
    // S5 potion belt: every phase (run state), with the combat-only q/d ids resolved
    // here so a renderer greys nothing it would have to guess at.
    belt: snapshotBelt(state, legal, lang),
    beltSlots: POTION_SLOTS,
    // S7 relics: every phase (run state) — the held rows with names, tiers and the
    // kernel's own effect sentences; the HUD chip and any relic readout paints these.
    relics: relicRows(state, lang),
    map: snapshotMap(state, legal),
    reward: snapshotReward(state, legal, lang),
    rest: snapshotRest(state, legal, lang),
    kindling: snapshotKindling(state, lang),
    shop: snapshotShop(state, legal, lang),
    // S6 event: null outside the phase; the wayside story, its choice table, and the
    // resolved beat inside it.
    event: snapshotEvent(state, legal, lang),
    quests: state.quests
      ? state.quests.map((q) => ({
          id: q.id,
          name: fieldFor(QUESTS[q.id], 'name', lang),
          text: fieldFor(QUESTS[q.id], 'text', lang),
          goal: QUESTS[q.id].goal,
          progress: q.progress,
          done: q.done,
          rewardText: fieldFor(QUESTS[q.id], 'rewardText', lang),
        }))
      : null,
    // S7: the summary gains the relic count — what the run carried to its end. S9:
    // beside them, the act the run ended in (the climb's last chapter, for the end
    // screen's flavor; a legacy save reads as act 1).
    ended: state.phase === 'ended' ? { outcome: state.outcome, floor: state.floor + 1, steps: state.stepIndex, relics: relicList(state).length, act: state.act ?? 1 } : null,
    // The plain-language layer, computed from this same state — in the requested
    // language (I18N-1). A human surface paints `description` / `text` / `glossary`;
    // the compact fields above stay untouched for the CLI. One state, two renderings,
    // one place that knows the rules.
    cardTypes: lang === 'es' ? CARD_TYPE_LABEL_ES : CARD_TYPE_LABEL,
    glossary: glossary(lang),
    glossarySections: glossarySections(lang),
    help: helpTopics(lang),
    // Legal actions, verbatim from the kernel, so a view can label its buttons without
    // inventing an id. Includes the R5 line text for parity with the CLI surface.
    actions: legal.map((a) => ({ id: a.id, kind: a.kind, cardId: a.cardId ?? null, nodeType: a.nodeType ?? null, nodeId: a.nodeId ?? null, potionId: a.potionId ?? null })),
    actionLines: observeActions(state),
    text: observe(state),
  };
}
