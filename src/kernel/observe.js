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
import { ENEMIES, BIOMES, DEFAULT_BIOME } from './rules/encounters.js';
import { availableNodes, NODE_TYPES } from './rules/map.js';
import { defaultContent, draftPoolFrom } from './content.js';
import { actions as legalActions } from './actions.js';
import { intentLabel, intentDamage, REST_HEAL } from './rules/act.js';
import { BOONS, boonText } from './rules/kindling.js';
import { RELICS, relicId } from './rules/relics.js';
import { TEMPERS, temperEffects, temperHpCost } from './rules/tempers.js';
import { QUESTS } from './rules/quests.js';
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

/** Live card definition lookup. Single place where an instance (or bare id) becomes renderable. */
let CARD_DEFS = null;
/** @param {any} content */
export function _setContentForObservation(content) {
  CARD_DEFS = content.cards;
}
/** The definition of a hand instance OR a bare card id — one lookup, one error message. */
function defOf(cardOrId) {
  if (CARD_DEFS === null) CARD_DEFS = defaultContent().cards;
  const id = typeof cardOrId === 'string' ? cardOrId : cardOrId.cardId;
  const def = CARD_DEFS.get(id);
  if (!def) throw new Error(`observation: unknown card "${id}"`);
  return def;
}

/** The id of a bare-id-or-instance value, for the tolerant lookup's fallback text. */
const cardIdOf = (cardOrId) => (typeof cardOrId === 'string' ? cardOrId : cardOrId.cardId);

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
    case 'map':
      return mapBody(state, opts);
    case 'kindling':
      return kindlingBody(state);
    case 'ended':
      return [
        `GAME OVER — ${state.outcome === 'win' ? 'VICTORY' : 'DEFEAT'} | floor ${state.floor + 1} | steps ${state.stepIndex} | gold ${state.player.gold ?? 0}`,
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
  return lines;
}

// Pile renderings tolerate an unknown id the way rewardBody does: the raw id stands in
// for the name instead of a throw (defOrNull above).
const pileNames = (pile) => (pile.length === 0 ? '-' : pile.map((c) => defOrNull(c)?.name ?? cardIdOf(c)).join(', '));
const pileCardNames = (pile) => (pile ?? []).map((c) => defOrNull(c)?.name ?? cardIdOf(c));

function rewardBody(state) {
  const lines = ['REWARD — pick one'];
  state.reward.cards.forEach((id) => {
    // Tolerant on purpose (unlike defOf): a reward id the content no longer knows
    // still renders, as the raw id, instead of killing the whole dump. This inline
    // lookup IS defOrNull; it stays spelled out here as the precedent's home.
    const def = defOrNull(id);
    lines.push(` s${state.reward.cards.indexOf(id) + 1} ${def ? def.name : id} ${def ? effectSummary(def) : ''}`);
  });
  lines.push(` s0 skip (HP ${state.player.hp}/${state.player.maxHp})`);
  // S3: what this fight just paid and what the purse holds now. Only when the reward
  // carries the grant: a legacy save's reward predates the field, and printing "+0"
  // for a spoils the engine never computed would be a lie, not a default.
  if (typeof state.reward.gold === 'number') {
    lines.push(` spoils +${state.reward.gold} gold (purse ${state.player.gold ?? 0})`);
  }
  return lines;
}

function restBody(state) {
  const lines = ['REST — heal or move on', ` HP ${state.player.hp}/${state.player.maxHp}`];
  if (state.temperOffers && state.temperOffers.length > 0) {
    lines.push('TEMPER (instead of healing)');
    state.temperOffers.forEach((o, i) => lines.push(` t${i + 1} ${o.cardId} ${TEMPERS[o.temper].label}`));
  }
  return lines;
}

function kindlingBody(state) {
  return ['KINDLING — take one boon (upside and cost)',
    ...state.kindling.offers.map((id, i) => ` k${i + 1} ${id} ${BOONS[id].label}`)];
}

function mapBody(state, opts) {
  const lines = [`MAP — floor ${state.floor + 1}/${state.map.rows.length}`];
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
  return {
    canSkip: legal.some((a) => a.kind === 'skip'),
    skipId: legal.find((a) => a.kind === 'skip')?.id ?? null,
    // S3: the spoils THIS victory paid (`state.reward.gold`, set by the victory path)
    // and the purse it landed in. null marks "no grant on record" — a legacy save's
    // reward predates the field — so a surface hides the line instead of printing +0.
    goldGained: typeof state.reward.gold === 'number' ? state.reward.gold : null,
    purse: state.player.gold ?? 0,
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
    biome: state.biome ?? DEFAULT_BIOME,
    biomeName: BIOMES[state.biome ?? DEFAULT_BIOME].name,
    biomes: Object.entries(BIOMES).map(([id, b]) => ({ id, name: b.name })),
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
    map: snapshotMap(state, legal),
    reward: snapshotReward(state, legal),
    rest: snapshotRest(state, legal),
    kindling: snapshotKindling(state),
    quests: state.quests
      ? state.quests.map((q) => ({ id: q.id, name: QUESTS[q.id].name, text: QUESTS[q.id].text, goal: QUESTS[q.id].goal, progress: q.progress, done: q.done, rewardText: QUESTS[q.id].rewardText }))
      : null,
    ended: state.phase === 'ended' ? { outcome: state.outcome, floor: state.floor + 1, steps: state.stepIndex } : null,
    // The plain-English layer, computed from this same state. A human surface paints
    // `description` / `text` / `glossary`; the compact fields above stay untouched for
    // the CLI. One state, two renderings, one place that knows the rules.
    cardTypes: CARD_TYPE_LABEL,
    glossary: glossary(),
    glossarySections: GLOSSARY_SECTIONS,
    help: helpTopics(),
    // Legal actions, verbatim from the kernel, so a view can label its buttons without
    // inventing an id. Includes the R5 line text for parity with the CLI surface.
    actions: legal.map((a) => ({ id: a.id, kind: a.kind, cardId: a.cardId ?? null, nodeType: a.nodeType ?? null, nodeId: a.nodeId ?? null })),
    actionLines: observeActions(state),
    text: observe(state),
  };
}
