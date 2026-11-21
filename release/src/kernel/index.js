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
import { HERO_ALIASES } from './legacy-ids.js';
// Imported as a VALUE as well as re-exported below: `contentForProfile` calls it.
import { poolSelection, relicPoolFor } from './unlocks.js';
import { generateMap, ROWS, ACT_COUNT } from './rules/map.js';
import { buildEncounterTable, BIOMES, DEFAULT_BIOME } from './rules/encounters.js';
import { DEFAULT_RELIC } from './rules/relics.js';
import { actions as legalActions } from './actions.js';import { _setCardDefs, BASE_ENERGY, HAND_SIZE, REST_HEAL, REWARD_CHOICES } from './rules/act.js';
import { offerBoons } from './rules/kindling.js';
import { rollQuests, advanceQuests } from './rules/quests.js';
// One row per action kind: what step() dispatches to (the mechanics live in rules).
import { STEP_HANDLERS } from './rules/steps.js';
import './rules/effects/index.js'; // registers the exotic handlers exactly once
import { observe as observeState, observeActions, snapshot as snapshotState, cardPool, intentChips } from './observe.js';
import {
  describeCard as describeCardDef,
  describeEffect,
  describeStatus,
  describePower,
  describeIntent,
  describeCardType,
  describePlayability,
  describeTile,
  describeVerbChip,
  cardChips,
  chipsCover,
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
export { observeState as observe, observeActions, snapshotState as snapshot, intentChips };
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
  // The effect-chip layer (the card faces' icon row): the per-chip explainer sentence,
  // the chip list of one definition, and the "fully covered" flag a tile reads before it
  // drops the visible sentence. Kernel-owned for the same reason every other sentence is.
  describeVerbChip,
  cardChips,
  chipsCover,
  glossary,
  helpTopics,
};
export { actions } from './actions.js';
export { FORMAT_VERSION, ENGINE_VERSION, validateSave, toSave, serializeSave } from './state.js';
// The DE-STS rename shim: legacy ids -> Ember ids at load time (the NAMES.md
// compatibility break). Surfaces reach it through this ONE entry point (R1).
export { LEGACY_ID_MAP, migrateLegacySave, HERO_ALIASES } from './legacy-ids.js';
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
  // S10 relic meta-unlocks: the documented milestone table, the pool it derives, and
  // the pure before/after verdict the run-summary narration reads. The PROFILE reaches
  // the rules only as these pools (DR-4, relic-shaped) — nothing below newRun ever
  // sees a win count.
  RELIC_UNLOCK_TABLE,
  relicPoolFor,
  evaluateRelicUnlocks,
} from './unlocks.js';
// S10: the relic describe/count helpers a surface may need for the narration — through
// the ONE entry point (R1), never rules/relics.js directly.
export { relicDef, RELIC_TOTAL } from './rules/relics.js';

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
 * @param {{seed?: number, character?: string, difficulty?: number, content?: any,
 *          wins?: number, relicPool?: string[]}} [opts]
 *        `wins` — the profile's lifetime win count; the run's relic pool is derived
 *        from it (S10). `relicPool` — an explicit pool, the log-replay form; it wins
 *        over `wins`. Neither: no pool field, the full relic table (harness/legacy).
 * @returns {any} frozen state
 */
export function newRun(opts = {}) {
  const content = opts.content ?? defaultContent();
  const seed = opts.seed ?? 0;
  // Legacy hero ids resolve through the alias map BEFORE validation, so a pre-rename
  // ?hero= / --character value keeps starting runs (the NAMES.md compatibility rule).
  const characterId = HERO_ALIASES[opts.character] ?? opts.character ?? 'ashwright';
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
  // S10 relic pool, form 1 — the PROFILE form: a lifetime WIN count the entry itself
  // turns into the run's relic pool through unlocks.js (RELIC_UNLOCK_TABLE). Optional:
  // absent means "no profile was declared", and the run gets NO relicPool field — it
  // draws from the full table at every drop read (rules/relics.js), which is also what
  // a pre-S10 save reads. That keeps every profile-less harness path — the golden
  // generator, the sim, the policy suite — byte-identical to before this slice, while
  // the surfaces (which always have a ledger) opt in by passing the count.
  let wins = null;
  if (opts.wins !== undefined) {
    if (!Number.isInteger(opts.wins) || opts.wins < 0) {
      throw Object.assign(new Error(`wins must be a non-negative integer, got ${opts.wins}`), { code: 3 });
    }
    wins = opts.wins;
  }
  // Form 2 — the EXACT form: a verbatim pool, the log-replay door. The replay must
  // reproduce the original state byte-for-byte, and the pool it carried is the state's
  // own fact (the win count that produced it is not recoverable from the pool), so the
  // header carries the pool and replay hands it back un-derived. Shape-checked only:
  // an array of strings, no more — unknown ids are tolerated everywhere downstream.
  let relicPool = null;
  if (opts.relicPool !== undefined) {
    if (!Array.isArray(opts.relicPool) || opts.relicPool.some((id) => typeof id !== 'string')) {
      throw Object.assign(new Error('relicPool must be an array of relic-id strings'), { code: 3 });
    }
    relicPool = opts.relicPool;
  }

  // Map generation consumes the first draws of the stream, then the deck is built.
  // Order matters and is part of the format: do not reorder these two blocks.
  // (S9: only ACT 1's map is generated here. Act 2's map rolls later, at the act
  // transition, from the live counter — rules/act.js beginNextAct documents the draws.)
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
    // S9: the run climbs TWO acts. `act` is where the run is standing; `acts` is the
    // declared length of the climb — the field the boss pick reads to decide between
    // the act transition (rules/act.js beginNextAct) and the ended win. A legacy save
    // predates `acts` and reads as a one-act run at every `?? 1`, so its act-1 boss
    // still ends it in victory (validateSave keeps the field optional).
    act: 1,
    acts: ACT_COUNT,
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
    // S6 events: null everywhere except inside the event phase, where it carries the
    // drawn story id, the modal temper state and the resolved beat's lines
    // (rules/events.js). The WHICH-event draw happens at ENTRY time (the travel
    // step), so nothing is pre-rolled for an event the run never visits. Legacy
    // saves predate the field — validateSave keeps it optional and every read is
    // null-tolerant (an unknown story id degrades to a continue-only phase).
    event: null,
  };

  // B5 alternate biome: recorded only when not the default, so foundry hashes are unchanged.
  if (biome !== DEFAULT_BIOME) state.biome = biome;
  // S7 RELICS: every run carries its held relics as an ARRAY in acquisition order —
  // relics[0] is the character's starting relic (the kindling Iron Skin boon's "{relic}").
  // The B4-era singular `state.relic` field is GONE from fresh states: every read goes
  // through rules/relics.js relicList(), which tolerates a legacy save by falling back
  // to `[state.relic ?? DEFAULT_RELIC]`. A relic gained later (the elite drop, the boss
  // pick) appends; the order is part of the format. The field is unconditionally present
  // on fresh states — a deliberate format change, exactly like S3's gold — so every S7
  // hash differs from S6's, and the goldens are regenerated against the new format.
  state.relics = [character.startingRelic ?? DEFAULT_RELIC];
  // S10 RELIC POOL: present exactly when a profile was declared — `wins` derives the
  // pool through the unlock table (the run's own starter always leads, then unlock
  // order), an explicit `relicPool` is taken verbatim (the replay form wins, being the
  // exact fact). Like draftPool, the pool is RUN STATE and hash input: two runs built
  // for different profiles are different runs. Absent (no profile declared, or a
  // pre-S10 save) reads as the full table at every drop read — rules/relics.js
  // documents the one-rule fallback. Zero draws either way: the pool is derived, never
  // rolled, so the RNG stream — and therefore every hash-relevant draw — is untouched
  // by the derivation itself.
  if (relicPool !== null) {
    state.relicPool = [...relicPool];
  } else if (wins !== null) {
    state.relicPool = relicPoolFor({ wins }, state.relics[0]);
  }
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
