// Kernel public entry — the ONLY exported surface of the game (R1).
//
// Five functions, one per requirement:
//   newRun(opts)          -> fresh frozen state
//   actions(state)        -> legal actions, short stable ids (R5)
//   step(state, id)       -> {state, events, error}; the ONLY way state ever changes (R1)
//   observe(state, opts)  -> compact text dump (R4)
//   hash(state)           -> content-addressed run identity (R3)
//
// No globals, no daemon, no hidden mutable state: a save file holds the entire run.
import { freezeDeep, hash as hashState, canonical } from './state.js';
import { loadContent, defaultContent, draftPoolFrom } from './content.js';
// Imported as a VALUE as well as re-exported below: `contentForProfile` calls it.
import { poolSelection } from './unlocks.js';
import { generateMap, availableNodes, findNode, NODE_TYPES, ROWS } from './rules/map.js';
import { ENCOUNTERS, ENEMIES } from './rules/encounters.js';
import { VOCABULARY } from './rules/vocabulary.js';
import { DEFAULT_RELIC } from './rules/relics.js';
import { intAt, shuffleAt, pickAt } from './rng.js';
import { actions as legalActions, parsePlayId } from './actions.js';
import {
  startCombat,
  endTurn,
  resolveVictory,
  _setCardDefs,
  BASE_ENERGY,
  HAND_SIZE,
  REST_HEAL,
  REWARD_CHOICES,
} from './rules/act.js';
import { fireHook } from './rules/powers.js';
import { offerBoons, applyBoon } from './rules/kindling.js';
import { rollQuests, advanceQuests } from './rules/quests.js';
import { offerTempers, temperEffects, temperHpCost } from './rules/tempers.js';
import './rules/effects/index.js'; // registers the exotic handlers exactly once
import { observe as observeState, observeActions, snapshot as snapshotState } from './observe.js';
import {
  describeCard as describeCardDef,
  describeEffect,
  describeStatus,
  describePower,
  describeIntent,
  describeCardType,
  describePlayability,
  describeTile,
  GLOSSARY_SECTIONS,
  glossary,
  helpTopics,
} from './describe.js';

// Rules never import content (R1). Fresh-state hand cards carry `cost` only, so the
// one shared definitions map is injected here, once, at module load.
_setCardDefs(defaultContent().cards);

export { hashState as hash, canonical };
export { observeState as observe, observeActions, snapshotState as snapshot };
// The plain-English layer (R4's second rendering). Exported so every surface reaches it
// through the ONE public entry point; a surface may not import kernel internals (R1).
export {
  describeCardDef as describeCard,
  describeEffect,
  describeStatus,
  describePower,
  describeIntent,
  describeCardType,
  describePlayability,
  describeTile,
  glossary,
  helpTopics,
};
export { actions } from './actions.js';
export { FORMAT_VERSION, ENGINE_VERSION, validateSave, toSave, serializeSave } from './state.js';
export { loadContent } from './content.js';

// The run-record layer (DR-1, DR-3, DR-6, DR-7) and the unlock layer (DR-4, DR-5).
//
// These are re-exported through the ONE public entry point on purpose: a surface may
// not import kernel internals (R1), and `package.json`'s `exports` map is frozen to
// exactly ["./kernel/index.js"], so a second entry point is not available even if a
// surface wanted one. Every symbol below therefore has to be reachable from here or it
// is unreachable in the browser (which resolves the same single entry).
//
// The record builder living IN the kernel is what makes AC-6.5 (the CLI and the GUI
// agree on the record) a property instead of a promise: both call this one function.
export {
  RECORD_VERSION,
  RETAIN,
  SCORE_TABLE,
  deriveCounts,
  scoreRun,
  buildRunRecord,
  emptyAgg,
  aggregate,
  aggScoreMean,
  pruneRuns,
  isLegacyRecord,
} from './record.js';
export {
  GRANT_KEYS,
  FRESH_SIZE,
  TYPE_RATIO,
  SHIPPED_CARDS,
  UNLOCK_CATALOG,
  BADGE_CATALOG,
  unlocksFor,
  badgesForRun,
  evaluateUnlocks,
  poolPlan,
  poolSelection,
  fullyUnlockedProfile,
} from './unlocks.js';

/**
 * Shipped content narrowed to one profile's card pool (DR-4, DR-5).
 *
 * WHY THIS IS IN THE KERNEL AND NOT IN A SURFACE: narrowing a pool means re-validating
 * content, and `cards.bundle.js` is a kernel module — a surface that reached for it
 * directly would be reaching past the one public entry point. This is a pure filter
 * over data (no I/O, no clock, no randomness), so the browser can call it too.
 *
 * The direction of dependency is the point: the profile decides WHICH CARDS EXIST for
 * this run, and nothing in the rules ever reads the profile. A run built from a narrowed
 * pool is therefore a strictly different deck-building game, never a stronger one —
 * starting HP, energy, hand size and every card's numbers are untouched (AC-9.3).
 * @param {any} [profile] a lifetime-counter profile (see surface/runs.js profileFor);
 *                        omitted/null means the fresh, unlock-free pool.
 * @returns {ReturnType<typeof loadContent>}
 */
export function contentForProfile(profile = null) {
  const full = defaultContent();
  const ids = new Set(poolSelection(full, profile).ids);
  return loadContent(
    JSON.stringify({
      contentVersion: full.contentVersion,
      // Hero-only starters (B4) are outside the selection but every run may need them.
      cards: full.cardList.filter((c) => ids.has(c.id) || c.hero),
      characters: Object.fromEntries(full.characters),
      statuses: full.statuses,
    }),
  );
}

/** Encounter ids that may spawn at a given node type (excluding the boss). */
const ENCOUNTER_BY_TYPE = {
  combat_weak: ['weak_1', 'weak_2', 'weak_3', 'weak_4'],
  combat_strong: ['strong_1', 'strong_2', 'strong_3'],
  elite: ['elite_1'],
  boss: ['boss_1'],
};
/** B5: the Cinder Mines' encounter pools (opt-in with `biome: 'mines'`). */
const MINES_BY_TYPE = {
  combat_weak: ['mines_weak_1', 'mines_weak_2', 'mines_weak_3'],
  combat_strong: ['mines_strong_1', 'mines_strong_2'],
  elite: ['mines_elite_1'],
  boss: ['mines_boss_1'],
};

/**
 * Start a run.
 * @param {{seed?: number, character?: string, difficulty?: number, content?: any}} [opts]
 * @returns {any} frozen state
 */
export function newRun(opts = {}) {
  const content = opts.content ?? defaultContent();
  const seed = opts.seed ?? 0;
  const characterId = opts.character ?? 'ironclad';
  const difficulty = opts.difficulty ?? 0;
  const biome = opts.biome ?? 'foundry';
  if (biome !== 'foundry' && biome !== 'mines') {
    throw Object.assign(new Error(`unknown biome "${biome}"`), { code: 3 });
  }
  const byType = biome === 'mines' ? MINES_BY_TYPE : ENCOUNTER_BY_TYPE;

  if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32) {
    throw Object.assign(new Error(`seed must be an integer in [0, 2^32], got ${opts.seed}`), { code: 3 });
  }
  const character = content.characters.get(characterId);
  if (!character) {
    throw Object.assign(new Error(`unknown character "${characterId}"`), { code: 3 });
  }
  if (!Number.isInteger(difficulty) || difficulty < 0) {
    throw Object.assign(new Error(`difficulty must be a non-negative integer, got ${opts.difficulty}`), { code: 3 });
  }

  // Map generation consumes the first draws of the stream, then the deck is built.
  // Order matters and is part of the format: do not reorder these two blocks.
  const mapGen = generateMap(seed, 0);
  let draws = mapGen.draws;

  const deck = character.startingDeck.map((cardId, i) => ({ uid: `c${i}`, cardId }));
  draws += deck.length; // deck order is fixed by the character definition

  const encounterTable = {};
  for (const row of mapGen.rows) {
    for (const node of row) {
      const pool = byType[node.type];
      if (!pool) {
        // Non-combat node (rest): no enemies, no draws consumed. Skipping the draw
        // keeps the stream aligned to *content that needs randomness*; rest nodes
        // are fully determined by the map, which is itself seed-derived.
        encounterTable[node.id] = {
          id: node.id,
          name: NODE_TYPES[node.type].label,
          tier: NODE_TYPES[node.type].tier,
          reward: NODE_TYPES[node.type].reward,
          elite: false,
          boss: false,
          spawn: [],
        };
        continue;
      }
      const pick = intAt(seed, draws, pool.length);
      draws += 1;
      const enc = ENCOUNTERS[pool[pick]];
      const spawn = enc.enemies.map((enemyId) => {
        const def = ENEMIES[enemyId];
        const hpRoll = intAt(seed, draws, def.maxHp[1] - def.maxHp[0] + 1);
        draws += 1;
        return { id: enemyId, hp: def.maxHp[0] + hpRoll };
      });
      encounterTable[node.id] = {
        id: enc.id,
        name: enc.stateName ?? enc.name,
        tier: enc.tier,
        reward: NODE_TYPES[node.type].reward,
        elite: Boolean(enc.elite),
        boss: Boolean(enc.boss),
        spawn,
      };
    }
  }

  const state = {
    contentVersion: content.contentVersion,
    seed,
    character: characterId,
    difficulty,
    stepIndex: 0,
    rngDraws: draws,
    // Single act in the slice (requirements §7.1), but the field is real from day one:
    // validateSave() checks it, and R10's per-act metrics anchor on it.
    act: 1,
    phase: 'map',
    outcome: null,
    floor: -1,
    mapNodeId: null,
    map: { rows: mapGen.rows, encounterTable },
    deck,
    draftPool: draftPoolFrom(content),
    energyPerTurn: BASE_ENERGY,
    powers: {},
    player: {
      hp: character.maxHp,
      maxHp: character.maxHp,
      block: 0,
      energy: 0,
      statuses: {},
    },
    combat: {
      active: false,
      nodeId: null,
      nodeType: null,
      turn: 0,
      enemies: [],
      draw: [],
      hand: [],
      discard: [],
      exhaust: [],
    },
    reward: null,
  };

  // B5 alternate biome: recorded only when not the default, so foundry hashes are unchanged.
  if (biome !== 'foundry') state.biome = biome;
  // B4 second hero: a character whose relic is not the Kindled Heart records it, so the
  // default (Ashwright) state keeps no new field and every existing hash is unchanged.
  if (character.startingRelic && character.startingRelic !== DEFAULT_RELIC) state.relic = character.startingRelic;
  // B1 Kindling (opt-in). Only an opted-in run gains the extra fields and draws, so the
  // default state — and every existing golden hash — is byte-identical to before.
  if (opts.kindling === true) {
    const offer = offerBoons(seed, state.rngDraws);
    state.rngDraws += offer.draws;
    state.phase = 'kindling';
    state.kindling = { offers: offer.ids, taken: null };
    state.relicOff = false;
  }
  // B2 Tempers (opt-in): the same rule — absent unless asked for.
  if (opts.tempers === true) {
    state.tempers = {};
    state.temperOffers = null;
  }
  // B3 Ember quests (opt-in): three seeded side goals, rolled after any Kindling draws.
  if (opts.quests === true) {
    const roll = rollQuests(seed, state.rngDraws);
    state.rngDraws += roll.draws;
    state.quests = roll.quests;
  }

  return freezeDeep(state);
}

/** Local alias used by step(); the public `actions` export lives in ./actions.js. */
void legalActions;

/**
 * Apply one action. This is the ONLY function that returns a new state (R1).
 * Illegal, unknown or unparseable actions are a legal NO-OP plus a structured
 * error (R6) — never a crash, never a retry.
 * @param {any} state
 * @param {string} id
 * @returns {{state: any, events: any[], error: null | {code: number, error: string, id: string}}}
 */
export function step(state, id) {
  const content = defaultContent();
  const legal = legalActions(state);
  const match = legal.find((a) => a.id === id);

  if (typeof id !== 'string' || id.length === 0 || !match) {
    return {
      state,
      events: [{ t: 'rejected', raw: id }],
      error: { code: 2, error: 'illegal_action', id: String(id) },
    };
  }

  const bumped = { ...state, stepIndex: state.stepIndex + 1 };
  let result;
  switch (match.kind) {
    case 'play':
      result = playCard(bumped, match, content);
      break;
    case 'end_turn':
      result = endTurn(bumped, content.cards);
      break;
    case 'travel':
      result = travel(bumped, match, content);
      break;
    case 'pick':
      result = pickReward(bumped, match);
      break;
    case 'skip':
      result = { state: { ...bumped, phase: 'map', reward: null }, events: [{ t: 'reward_skipped' }] };
      break;
    case 'rest_heal': {
      const healed = Math.min(REST_HEAL, bumped.player.maxHp - bumped.player.hp);
      result = {
        state: { ...bumped, player: { ...bumped.player, hp: bumped.player.hp + healed }, phase: 'map', ...(bumped.tempers ? { temperOffers: null } : {}) },
        events: [{ t: 'heal', who: 'player', amount: healed, source: 'rest' }],
      };
      break;
    }
    case 'temper': {
      const o = match.offer;
      result = {
        state: { ...bumped, tempers: { ...bumped.tempers, [o.uid]: o.temper }, temperOffers: null, phase: 'map' },
        events: [{ t: 'card_tempered', uid: o.uid, cardId: o.cardId, temper: o.temper }],
      };
      break;
    }
    case 'boon':
      result = applyBoon(bumped, match.boon);
      break;
    case 'rest_leave':
      result = { state: { ...bumped, phase: 'map', ...(bumped.tempers ? { temperOffers: null } : {}) }, events: [{ t: 'rest_left' }] };
      break;
    default:
      return { state, events: [], error: { code: 1, error: 'internal', id: String(id) } };
  }

  if (bumped.quests && result.state.phase !== 'ended') {
    const q = advanceQuests(result.state, { events: result.events, played: match.kind === 'play', nodeType: bumped.combat?.nodeType ?? null });
    result = { state: q.state, events: [...result.events, ...q.events] };
  }
  return { state: freezeDeep(result.state), events: result.events, error: null };
}

/** Play one card from hand and settle the combat if it ended. */
function playCard(state, action, content) {
  const parsed = parsePlayId(action.id);
  if (!parsed) return { state, events: [] };
  const idx = parsed.slot - 1;
  const target = parsed.target;
  const card = state.combat.hand[idx];
  if (!card) return { state, events: [] };

  const def = content.cards.get(card.cardId);
  if (!def) return { state, events: [] };

  // Resolve the aim against the LIVING enemies in state order — the same list, in the
  // same order, that actions.js enumerated when it offered this id (rule 2).
  //
  // A dead or out-of-range target cannot reach here: `step` matched the id against the
  // legal list, and that list never contains one. So the only way to arrive with a dead
  // aim is for an effect of THIS card to have killed it mid-card (rule 5) — which is
  // re-checked per effect inside the loop below.
  const aimAt = (s) => {
    const liveIdx = s.combat.enemies.map((e, i) => (!e.dead ? i : -1)).filter((i) => i !== -1);
    if (target === null) return liveIdx[0] ?? 0;
    // `target` is 1-BASED (the index the player and the action id use); `liveIdx` is a
    // 0-based list of living enemy positions. Indexing it with the raw 1-based number was
    // an off-by-one that silently fell back to enemy 1 for every choice — the player aimed
    // at enemy 2 and always hit enemy 1. `target - 1` is the correct mapping.
    const chosen = liveIdx[target - 1];
    return chosen ?? liveIdx[0] ?? 0;
  };

  let next = {
    ...state,
    player: { ...state.player, energy: state.player.energy - card.cost },
    combat: { ...state.combat, hand: state.combat.hand.filter((_, i) => i !== idx) },
  };

  const rng = {
    shuffle: (items) => shuffleAt(state.seed, next.rngDraws, items),
    pick: (items, n) => pickAt(state.seed, next.rngDraws, items, n),
  };

  const events = [];
  // B2: a tempered instance resolves its modified effect list (looked up by uid).
  const temper = state.tempers ? state.tempers[card.uid] : undefined;
  const effects = temper ? temperEffects(def.effects, temper) : def.effects;
  const exhausted = effects.some((e) => e.verb === 'exhaust');
  const hpCost = temperHpCost(temper);
  if (hpCost > 0) {
    const paid = Math.min(hpCost, next.player.hp - 1);
    next = { ...next, player: { ...next.player, hp: next.player.hp - paid } };
    events.push({ t: 'hp_cost', amount: paid, source: 'temper' });
  }

  for (const effect of effects) {
    // Re-resolved per effect, not hoisted: if an earlier effect killed the aimed enemy,
    // the remaining effects of the SAME card must land somewhere legal rather than
    // write to a corpse (rule 5). Re-resolution is what makes that a property instead of
    // a promise, and it costs nothing when the aim is still alive.
    const ctx = {
      rng,
      card,
      source: 'player',
      target: null,
      targetEnemyIndex: aimAt(next),
      aimed: target !== null,
    };
    const fn = VOCABULARY[effect.verb];
    const out = fn(next, ctx, effect);
    next = out.state;
    events.push(...out.events);
  }

  // Load the spent card into discard, unless it exhausted itself.
  const alreadyExhausted = next.combat.exhaust.some((e) => e.uid === card.uid);
  if (!exhausted && !alreadyExhausted) {
    next = {
      ...next,
      combat: { ...next.combat, discard: [...next.combat.discard, { uid: card.uid, cardId: card.cardId, perPlay: card.perPlay }] },
    };
  } else if (exhausted && !alreadyExhausted) {
    // Only when the `exhaust` verb did not already file it: otherwise the card is
    // pushed twice and the exhaust pile claims two copies of a one-copy card.
    next = { ...next, combat: { ...next.combat, exhaust: [...next.combat.exhaust, { uid: card.uid, cardId: card.cardId }] } };
  }

  // Exhaust hooks (Feel No Pain / Dark Embrace) fire per exhausted card.
  if (exhausted) {
    const hook = fireHook(next, 'on_exhaust', { rng });
    next = hook.state;
    events.push(...hook.events);
  }

  // One enemy left alive on the field? Then the combat continues; if all are dead
  // we settle victory immediately rather than making the player press end turn.
  if (next.combat.active && next.combat.enemies.every((e) => e.dead)) {
    const won = resolveVictory(next, content.cards);
    // Same event shape as the end-turn path (rules/act.js): a combat won by a card must
    // also emit `combat_won`, or elite/boss points are never awarded (DR-6).
    return { state: won.state, events: [...events, { t: 'combat_won' }, ...won.events] };
  }
  if (next.combat.enemies.some((e) => e.dead)) {
    next = { ...next, combat: { ...next.combat, enemies: next.combat.enemies.map((e) => (e.dead ? e : { ...e, index: e.index })) } };
  }
  return { state: next, events };
}

/** Enter the chosen map node. */
function travel(state, action, content) {
  const node = findNode(state.map.rows, action.nodeId);
  if (!node) return { state, events: [] };
  const floor = state.map.rows.findIndex((row) => row.some((n) => n.id === node.id));
  const at = { ...state, floor, mapNodeId: node.id };

  if (node.type === 'boss' || node.type.startsWith('combat') || node.type === 'elite') {
    return startCombat(at, node, content.cards);
  }
  if (node.type === 'rest') {
    if (at.tempers) {
      const offer = offerTempers(at, content.cards);
      return {
        state: { ...at, phase: 'rest', rngDraws: at.rngDraws + offer.draws, temperOffers: offer.offers },
        events: [{ t: 'rest_ready', node: node.id }],
      };
    }
    return { state: { ...at, phase: 'rest' }, events: [{ t: 'rest_ready', node: node.id }] };
  }
  throw new Error(`unhandled node type "${node.type}"`);
}

/** Take one card from the reward offer. */
function pickReward(state, action) {
  const idx = Number(action.id.slice(1)) - 1;
  const cardId = action.cardId;
  if (!cardId || idx < 0) return { state, events: [] };
  const uid = `c${state.deck.length}_${state.stepIndex}`;
  return {
    state: { ...state, deck: [...state.deck, { uid, cardId }], phase: 'map', reward: null },
    events: [{ t: 'card_taken', cardId, uid }],
  };
}

export { HAND_SIZE, REST_HEAL, REWARD_CHOICES, ROWS, generateMap };
