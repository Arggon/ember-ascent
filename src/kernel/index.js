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
import { generateMap, ROWS } from './rules/map.js';
import { buildEncounterTable, BIOMES, DEFAULT_BIOME } from './rules/encounters.js';
import { DEFAULT_RELIC } from './rules/relics.js';
import { actions as legalActions } from './actions.js';
import { _setCardDefs, BASE_ENERGY, HAND_SIZE, REST_HEAL, REWARD_CHOICES } from './rules/act.js';
import { offerBoons } from './rules/kindling.js';
import { rollQuests, advanceQuests } from './rules/quests.js';
// One row per action kind: what step() dispatches to (the mechanics live in rules).
import { STEP_HANDLERS } from './rules/steps.js';
import './rules/effects/index.js'; // registers the exotic handlers exactly once
import { observe as observeState, observeActions, snapshot as snapshotState, cardPool } from './observe.js';
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
// B5: the one biome table, for surfaces (GUI picker, Act I card, CLI).
export { BIOMES, DEFAULT_BIOME };
export { observeState as observe, observeActions, snapshotState as snapshot };
// S2 card codex: the draft pool, enriched through the describe layer. Exported as a
// FUNCTION, not a snapshot field, on purpose — the pool is content-derived and
// phase-independent, so no action repaint should carry 39 descriptions it did not ask for.
export { cardPool };
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
  const biome = opts.biome ?? DEFAULT_BIOME;
  if (!Object.hasOwn(BIOMES, biome)) {
    throw Object.assign(new Error(`unknown biome "${biome}" (known: ${Object.keys(BIOMES).join(', ')})`), { code: 3 });
  }
  const byType = BIOMES[biome].byType;

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
  const deck = character.startingDeck.map((cardId, i) => ({ uid: `c${i}`, cardId }));
  // Deck order is fixed by the character definition, so only its LENGTH advances the
  // stream; the encounter table then rolls per node (rules/encounters.js).
  const { table: encounterTable, draws } = buildEncounterTable(seed, mapGen.draws + deck.length, mapGen.rows, byType);

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
      // S3 gold economy: the run's purse, part of run state and therefore of the hash.
      // Starts at 99 — Slay the Spire's own opening purse — and only ever grows here:
      // every combat victory pays by node tier (rules/map.js NODE_TYPES gold ranges, via
      // rules/act.js resolveVictory). Inert until the shop slice gives it a spender.
      // Legacy saves from before this field default to 0 at every read (`?? 0`), so no
      // format bump; validateSave keeps it optional.
      gold: 99,
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
    // S4 shop: null everywhere except inside the shop phase, where it carries the
    // inventory, the removal-service state and the removal flag (rules/shop.js).
    // Leaving nulls it again; the offers themselves roll at ENTRY time (the travel
    // step), so nothing is pre-rolled for a shop the run never visits. Legacy saves
    // predate the field entirely — validateSave keeps it optional and every read is
    // null-tolerant.
    shop: null,
    // S5 potions: the belt, empty at run start (StS parity). It fills only from
    // seeded victory drops (rules/potions.js rollPotionDrop, called by the victory
    // path in rules/act.js) and empties only by quaffing or discarding — both
    // combat-only steps. Legacy saves predate the field: validateSave keeps it
    // optional and every read is `?? []`-tolerant (absent = empty belt).
    potions: [],
  };

  // B5 alternate biome: recorded only when not the default, so foundry hashes are unchanged.
  if (biome !== DEFAULT_BIOME) state.biome = biome;
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
 *
 * The facade owns the CONTRACT (validate against the legal list, bump stepIndex,
 * run ONE handler, fold quests, freeze); WHAT each action kind does lives in the
 * STEP_HANDLERS registry (rules/steps.js), so this function never grows a branch.
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
  const run = STEP_HANDLERS[match.kind];
  if (!run) {
    return { state, events: [], error: { code: 1, error: 'internal', id: String(id) } };
  }

  const bumped = { ...state, stepIndex: state.stepIndex + 1 };
  let result = run(bumped, match, content);

  if (bumped.quests && result.state.phase !== 'ended') {
    const q = advanceQuests(result.state, { events: result.events, played: match.kind === 'play', nodeType: bumped.combat?.nodeType ?? null });
    result = { state: q.state, events: [...result.events, ...q.events] };
  }
  return { state: freezeDeep(result.state), events: result.events, error: null };
}

export { HAND_SIZE, REST_HEAL, REWARD_CHOICES, ROWS, generateMap };
