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
import { eventDef, offerEventChoices, temperOfferOpen } from './rules/events.js';
// The plain-English layer. Declared AFTER the frozen compact one on purpose: the strings
// in this file are the budgeted payload and may not move, so they stay the single source
// of the abbreviations that describe.js explains.
import {
  describeCard,
  describeIntent,
  describePlayability,
  describePower,
  describeStatus,
  GLOSSARY_SECTIONS,
  glossary,
  helpTopics,
  CARD_TYPE_LABEL,
} from './describe.js';

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
const pileCardNames = (pile) => (pile ?? []).map((c) => defOrNull(c)?.name ?? cardIdOf(c));

function rewardBody(state) {
  // S7: the BOSS reward — the warden's three relic offers replace the cards (StS
  // parity), so the header and the lines name relics. Tolerant like the card rows
  // (defOrNull's policy): an id the relic table no longer knows renders as its raw id
  // with no text, and offers no r-id will ever enumerate (the R6 mirror).
  const offers = Array.isArray(state.reward.relicOffers) ? state.reward.relicOffers : [];
  const lines = [offers.length > 0 ? 'REWARD — claim the warden\u2019s relic' : 'REWARD — pick one'];
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
    const beat = Array.isArray(ev.resolved?.lines) ? ev.resolved.lines : [];
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

/** Status labels for the structured snapshot (same abbreviations as the text dump). */
function statusPairs(statuses) {
  return Object.entries(statuses ?? {})
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([key, stacks]) => ({
      key,
      stacks,
      // Compact form for the CLI and for anyone who has read the glossary.
      label: `${STATUS_ABBREV[key] ?? key.toUpperCase()}${stacks}`,
      // The same fact in words, for a reader meeting it for the first time. Derived
      // here, in the kernel, so no surface can invent its own wording.
      text: `${describeStatus(key, stacks).replace(/\.$/, '')}`,
      explain: describeStatus(key, stacks),
    }));
}

/** The hero's relic name and switched-off text, for relic-off boon text. */
function heroRelic(state) {
  return {
    name: defaultContent().characters.get(state.character)?.relicName ?? 'relic',
    offText: RELICS[relicId(state)]?.offText ?? 'stops working',
  };
}

/**
 * S7: the held-relics rows, published in EVERY phase (the relics are run state and the
 * HUD chip shows them everywhere). Row facts mirror the belt's: `known: false` marks an
 * id the relic table no longer knows (a torn save) — it still renders, the raw id is
 * its own name, and it contributes no hooks (relicSum skips it). `text` is the kernel
 * table's own sentence, verbatim; `tier` feeds the codex-style hue a surface may paint.
 * @param {any} state
 */
function relicRows(state) {
  return relicList(state).map((id, i) => {
    const def = relicDef(id);
    return {
      slot: i + 1,
      relicId: id,
      known: Boolean(def),
      name: def ? def.name : id,
      summary: def ? def.summary : '',
      text: def ? def.text : '',
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
function snapshotHand(state, legal) {
  const { playableSlots, targetsBySlot } = playTargets(legal);
  return (state.combat?.hand ?? []).map((card, i) => {
    const { def, temper } = temperedView(state, card, defOf(card));
    const hpCost = temperHpCost(temper);
    const slot = `p${i + 1}`;
    const playable = playableSlots.has(slot);
    const targets = targetsBySlot.get(slot) ?? [];
    return {
      slot,
      cardId: card.cardId,
      name: def.name,
      flavor: typeof def.flavor === 'string' ? def.flavor : '',
      cost: card.cost,
      type: def.type,
      rarity: def.rarity,
      // B2: the instance's temper (null when untempered or the run has none).
      temper,
      temperName: temper ? TEMPERS[temper].name : '',
      temperText: temper ? TEMPERS[temper].text : '',
      // Same card, second rendering. `summary` stays the CLI's compact form (frozen by
      // tests/budget.test.js); `description` is the sentence a human reads instead.
      typeLabel: CARD_TYPE_LABEL[def.type] ?? def.type,
      // Both read the TEMPERED definition, so a Red-hot Hammerfall says "Deal 9 damage."
      summary: effectSummary(def),
      description: describeCard(def, card) + (hpCost > 0 ? ` Lose ${hpCost} HP when played.` : ''),
      playable,
      // The engine's own answer to "may this card be aimed?" — so a renderer never has to
      // infer it from the card type (Defend is type 'skill', Bash is 'attack', but the
      // rule belongs here, in the kernel).
      target: def.target ?? 'self',
      // Non-empty only when the player actually has a choice to make: more than one living
      // enemy AND a card that must be aimed. Empty means "one click plays it".
      targets: targets.length > 1 ? targets : [],
      hint: describePlayability({ cost: card.cost, playable }, state.player.energy),
    };
  });
}

/** The enemies section of a snapshot: intent included, dead enemies omitted. */
function snapshotEnemies(state) {
  return (state.combat?.enemies ?? [])
    .filter((e) => !e.dead)
    .map((e) => {
      const def = ENEMIES[e.id];
      const move = def.moves[e.moveIndex] ?? def.moves[0];
      return {
        index: e.index,
        id: e.id,
        name: def.name,
        hp: e.hp,
        maxHp: e.maxHp,
        block: e.block,
        statuses: statusPairs(e.statuses),
        intent: {
          label: intentLabel(e),
          kind: move.kind,
          damage: intentDamage(e),
          hits: move.hits ?? 1,
          // The sentence for the SAME intent, from the same rules, so the compact number
          // and the readable line can never disagree.
          text: describeIntent(e),
        },
      };
    });
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
    // here, not guessed by the renderer.
    rows: state.map.rows.map((row, r) =>
      row.map((n) => ({
        id: n.id,
        type: n.type,
        label: NODE_TYPES[n.type].label,
        row: r,
        current: r === state.floor && n.id === state.mapNodeId,
        available: nextNodes.some((a) => a.id === n.id),
        actionId: travel.get(n.id) ?? null,
      })),
    ),
    currentRow: currentRow.map((n) => n.id),
  };
}

/** The reward section of a snapshot, or null when no reward is open. */
function snapshotReward(state, legal) {
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
        name: def ? def.name : id,
        summary: def ? def.summary : '',
        text: def ? def.text : '',
        tier: def ? def.tier : 'unknown',
        affordable: relicPicks.has(i),
      };
    }),
    // An elite's GUARANTEED drop, the spoils line's fact — null when this fight
    // dropped nothing (or the reward predates the field), so a surface hides the chip.
    relicGained: typeof state.reward.relic === 'string'
      ? (() => {
        const def = relicDef(state.reward.relic);
        return { relicId: state.reward.relic, known: Boolean(def), name: def ? def.name : state.reward.relic, summary: def ? def.summary : '', text: def ? def.text : '' };
      })()
      : null,
    cards: state.reward.cards.map((id) => {
      // Tolerant like rewardBody above (defOrNull): an unknown reward id — a stale save
      // after a rename — renders as a placeholder row (raw id, cost 0, type "unknown")
      // instead of throwing the whole snapshot away. It stays VISIBLE, not dropped.
      const def = defOrNull(id);
      return {
        cardId: id,
        name: def?.name ?? id,
        flavor: typeof def?.flavor === 'string' ? def.flavor : '',
        cost: def?.cost ?? 0,
        type: def?.type ?? 'unknown',
        typeLabel: def ? (CARD_TYPE_LABEL[def.type] ?? def.type) : 'unknown',
        summary: def ? effectSummary(def) : '',
        description: def ? describeCard(def) : '',
        actionId: pick.get(id) ?? null,
      };
    }),
  };
}

/** The rest-site section of a snapshot, or null when the player is not resting. */
function snapshotRest(state, legal) {
  if (state.phase !== 'rest') return null;
  return {
    healId: legal.find((a) => a.kind === 'rest_heal')?.id ?? null,
    leaveId: legal.find((a) => a.kind === 'rest_leave')?.id ?? null,
    heal: REST_HEAL,
    tempers: (state.temperOffers ?? []).map((o, i) => ({
      // Tolerant like rewardBody (defOrNull): an unknown offer id shows its raw id.
      actionId: `t${i + 1}`, cardId: o.cardId, cardName: defOrNull(o.cardId)?.name ?? o.cardId,
      temper: o.temper, temperName: TEMPERS[o.temper]?.name ?? o.temper, text: TEMPERS[o.temper]?.text ?? '',
    })),
  };
}

/** The kindling section of a snapshot, or null when no boon is being chosen. */
function snapshotKindling(state) {
  if (state.phase !== 'kindling') return null;
  return {
    boons: state.kindling.offers.map((id, i) => ({
      id, name: BOONS[id].name, text: boonText(id, heroRelic(state)), label: BOONS[id].label, actionId: `k${i + 1}`,
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
 *   - `summary`/`text` are the kernel table's own words, verbatim: no surface
 *     re-derives what a potion does.
 * @param {any} state
 * @param {any[]} legal
 */
function snapshotBelt(state, legal) {
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
      name: def ? def.name : potionId,
      summary: def ? def.summary : '',
      text: def ? def.text : '',
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
 */
function snapshotShop(state, legal) {
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
    const key = `${inst.cardId}|${temper ?? ''}`;
    const copy = (seen.get(key) ?? 0) + 1;
    seen.set(key, copy);
    return {
      index: i,
      actionId: picks[i]?.id ?? null,
      cardId: inst.cardId,
      uid: inst.uid,
      name: def?.name ?? inst.cardId,
      cost: def?.cost ?? 0,
      temper,
      temperName: temper ? TEMPERS[temper]?.name ?? temper : '',
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
        name: def?.name ?? o.cardId,
        flavor: typeof def?.flavor === 'string' ? def.flavor : '',
        cost: def?.cost ?? 0,
        type: def?.type ?? 'unknown',
        typeLabel: def ? (CARD_TYPE_LABEL[def.type] ?? def.type) : 'unknown',
        rarity: def?.rarity ?? 'unknown',
        summary: def ? effectSummary(def) : '',
        description: def ? describeCard(def) : '',
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
 * S6: the event section of a snapshot, or null outside the event phase.
 *
 * The ONE offer table (rules/events.js offerEventChoices) decides everything a choice
 * button needs: `actionId` is null exactly when the kernel offers no action (an unmet
 * requirement — the same afford-filter contract as a shop shelf), `reason` is the
 * WHY the dimmed button shows, and `cost`/`hpLoss` are the price chips' facts. The
 * resolved beat carries the kernel's own result lines; the temper modal's offers ride
 * beside them. A torn save (unknown story id, or the field null) degrades: `known`
 * is false, the story is empty, no choices, and `continueId` is still the way out.
 * @param {any} state
 * @param {any[]} legal
 */
function snapshotEvent(state, legal) {
  if (state.phase !== 'event') return null;
  const ev = state.event ?? null;
  const def = eventDef(ev?.id);
  const choices = new Map(legal.filter((a) => a.kind === 'event_choice').map((a) => [a.index, a.id]));
  const temperPicks = new Map(legal.filter((a) => a.kind === 'event_temper').map((a) => [a.index, a.id]));
  const evald = def ? offerEventChoices(state, CARD_DEFS ?? defaultContent().cards) : [];
  return {
    eventId: def ? def.id : (ev?.id ?? null),
    known: Boolean(def),
    name: def ? def.name : (ev?.id ?? 'the wayside'),
    story: def ? def.story : '',
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
      .map((o, i) => (temperOfferOpen(o, state) ? {
        actionId: temperPicks.get(i) ?? null,
        cardId: o.cardId,
        cardName: defOrNull(o.cardId)?.name ?? o.cardId,
        temper: o.temper,
        temperName: TEMPERS[o.temper]?.name ?? o.temper,
        text: TEMPERS[o.temper]?.text ?? '',
      } : null))
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
    resolved: ev?.resolved
      ? { choice: ev.resolved.choice, lines: Array.isArray(ev.resolved?.lines) ? ev.resolved.lines : [] }
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
 * @returns {Array<{cardId: string, name: string, cost: number, type: string, typeLabel: string, tempered: boolean, temper: string | null, temperName: string, temperText: string, count: number}>}
 */
function snapshotDeck(state) {
  const rows = new Map();
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
    const { temper } = temperedView(state, inst, def);
    const key = `${inst.cardId}|${temper ?? ''}`;
    const row = rows.get(key);
    if (row) { row.count += 1; continue; }
    rows.set(key, {
      cardId: inst.cardId,
      name: def.name,
      cost: def.cost,
      type: def.type,
      typeLabel: CARD_TYPE_LABEL[def.type] ?? def.type,
      tempered: temper !== null,
      temper,
      temperName: temper ? TEMPERS[temper].name : '',
      temperText: temper ? TEMPERS[temper].text : '',
      count: 1,
    });
  }
  return [...rows.values()].sort((a, b) =>
    (a.cost - b.cost) || byStr(a.name, b.name) || byStr(a.cardId, b.cardId) || byStr(a.temper ?? '', b.temper ?? ''));
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
export function cardPool() {
  const content = defaultContent();
  return draftPoolFrom(content)
    .map((id) => content.cards.get(id))
    .map((def) => ({
      cardId: def.id,
      rarity: def.rarity,
      name: def.name,
      cost: def.cost,
      type: def.type,
      typeLabel: CARD_TYPE_LABEL[def.type] ?? def.type,
      // Both renderings, as on the hand tiles: `summary` is the CLI's compact form,
      // `description` the sentence a human reads.
      summary: effectSummary(def),
      description: describeCard(def),
    }))
    .sort((a, b) =>
      ((RARITY_TIER[a.rarity] ?? 9) - (RARITY_TIER[b.rarity] ?? 9))
      || (a.cost - b.cost)
      || byStr(a.name, b.name)
      || byStr(a.cardId, b.cardId));
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
 * @param {{verbose?: boolean}} [opts]
 * @returns {object} JSON-safe value model
 */
export function snapshot(state) {
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
    biomeName: BIOMES[currentBiome(state)].name,
    // S9: the START paths — every biome but the act-2 one (rules/encounters.js
    // startBiomeIds). The kindling picker renders these; the full table (including the
    // Deeps) stays in the public BIOMES export.
    biomes: startBiomeIds().map((id) => ({ id, name: BIOMES[id].name })),
    characterName: defaultContent().characters.get(state.character)?.name ?? state.character,
    relicName: defaultContent().characters.get(state.character)?.relicName ?? '',
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
      statuses: statusPairs(state.player.statuses),
      powers: Object.entries(state.powers ?? {})
        .filter(([, v]) => v > 0)
        .map(([key, stacks]) => ({
          key,
          stacks,
          label: `${STATUS_ABBREV[key] ?? key.toUpperCase()}`,
          text: `${describePower(key, stacks).replace(/\.$/, '')}`,
          explain: describePower(key, stacks),
        })),
    },
    hand: snapshotHand(state, legal),
    piles: {
      draw: state.combat?.draw?.length ?? 0,
      discard: state.combat?.discard?.length ?? 0,
      exhaust: state.combat?.exhaust?.length ?? 0,
      // Names only, for the pile viewer. Counts above stay the compact facts.
      drawCards: pileCardNames(state.combat?.draw),
      discardCards: pileCardNames(state.combat?.discard),
      exhaustCards: pileCardNames(state.combat?.exhaust),
    },
    // S1 master-deck viewer: the whole run deck, aggregated and sorted (snapshotDeck
    // above). `deckCount` is the fact the HUD badge shows; the rows carry the rest.
    deckCount: (state.deck ?? []).length,
    deckCards: snapshotDeck(state),
    // S2 card codex: the ids THIS run's rewards actually roll from (rules/act.js
    // rollReward picks from state.draftPool, which newRun narrowed to the profile's
    // content). Bare ids only — the describe-layer rows live behind the cardPool()
    // export, and a surface filters those to this set. null (not []) marks a state that
    // predates the field (validateSave never required it), so a surface can tell
    // "legacy state, pool unknown" apart from "legitimately empty pool" and degrade to
    // the full lookup table instead of lying about an empty pool.
    draftPool: Array.isArray(state.draftPool) ? [...state.draftPool] : null,
    enemies: snapshotEnemies(state),
    // S5 potion belt: every phase (run state), with the combat-only q/d ids resolved
    // here so a renderer greys nothing it would have to guess at.
    belt: snapshotBelt(state, legal),
    beltSlots: POTION_SLOTS,
    // S7 relics: every phase (run state) — the held rows with names, tiers and the
    // kernel's own effect sentences; the HUD chip and any relic readout paints these.
    relics: relicRows(state),
    map: snapshotMap(state, legal),
    reward: snapshotReward(state, legal),
    rest: snapshotRest(state, legal),
    kindling: snapshotKindling(state),
    shop: snapshotShop(state, legal),
    // S6 event: null outside the phase; the wayside story, its choice table, and the
    // resolved beat inside it.
    event: snapshotEvent(state, legal),
    quests: state.quests
      ? state.quests.map((q) => ({ id: q.id, name: QUESTS[q.id].name, text: QUESTS[q.id].text, goal: QUESTS[q.id].goal, progress: q.progress, done: q.done, rewardText: QUESTS[q.id].rewardText }))
      : null,
    // S7: the summary gains the relic count — what the run carried to its end. S9:
    // beside them, the act the run ended in (the climb's last chapter, for the end
    // screen's flavor; a legacy save reads as act 1).
    ended: state.phase === 'ended' ? { outcome: state.outcome, floor: state.floor + 1, steps: state.stepIndex, relics: relicList(state).length, act: state.act ?? 1 } : null,
    // The plain-English layer, computed from this same state. A human surface paints
    // `description` / `text` / `glossary`; the compact fields above stay untouched for
    // the CLI. One state, two renderings, one place that knows the rules.
    cardTypes: CARD_TYPE_LABEL,
    glossary: glossary(),
    glossarySections: GLOSSARY_SECTIONS,
    help: helpTopics(),
    // Legal actions, verbatim from the kernel, so a view can label its buttons without
    // inventing an id. Includes the R5 line text for parity with the CLI surface.
    actions: legal.map((a) => ({ id: a.id, kind: a.kind, cardId: a.cardId ?? null, nodeType: a.nodeType ?? null, nodeId: a.nodeId ?? null, potionId: a.potionId ?? null })),
    actionLines: observeActions(state),
    text: observe(state),
  };
}
