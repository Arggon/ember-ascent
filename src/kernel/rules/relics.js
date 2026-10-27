// Relics (S7) — passive treasures with real effect hooks, one table, no string matching.
//
// A hero definition names its starting relic by id (`startingRelic` in content/cards.json);
// this table says what each relic id DOES and what it is called. The act/steps rules read
// effect numbers through the named accessors below and never compare relic names, so a new
// relic is one table row, and Iron Skin's `relicOff` switches off whichever relic the hero
// STARTED with (relics[0]) — never one gained later.
//
// STATE. `state.relics` is the array of held relic ids IN ACQUISITION ORDER, and the order
// is part of the format (it decides event order and which row is the hero's own). relics[0]
// is the character's starting relic. A relic can never drop twice: every drop/offer table
// filters the held ids, so duplicates are impossible through play — validateSave REFUSES a
// duplicate (a state the engine can never produce, the S5 over-capacity belt ruling).
//
// LEGACY SAVES. A pre-S7 save has no `relics` field: the B4-era singular `state.relic`
// (Bellows runs) or nothing (Ashwright runs). Every read goes through relicList(), which
// falls back to `[state.relic ?? DEFAULT_RELIC]`, so an old save carries exactly its
// starting relic and nothing else. Unknown ids (a stale save after a rename) are TOLERATED
// everywhere: they read as a relic with no hooks, and surfaces show the raw id — the
// defOrNull/potionDef degrade ruling, never a load-time throw.
//
// HOOKS — the closed menu, one named accessor each (NO string-matching dispatch):
//   on-combat-start  firstTurnEnergy (+Energy turn 1) · combatStartBlock (+Block turn 1)
//                    · combatStartStrength (+Strength turn 1) · firstTurnDraw (+1 card turn 1)
//   on-victory       healAfterFight (HP after each won fight) · goldAfterFight (+gold per fight)
//   on-rest          restHealBonus (extra HP when resting)
//   on-potion-quaff  quaffBlock (+Block whenever a potion is quaffed)
//   passive          maxHpBonus (+max HP once, at acquisition — gainRelic applies it)
// COEXISTENCE: relics are unique by id, but two relics sharing a hook CAN coexist and both
// fire — the accessors apply each held relic's contribution in ACQUISITION ORDER (its own
// event where the stream has a verb), so Cyan Lantern + Slag Crown is +2 Energy on turn 1.
// NO hook consumes a draw at read time: every relic number is fixed, exactly like a potion's.
//
// DROPS (rules/act.js resolveVictory calls these; the per-victory draw order is documented
// THERE — the one fixed chain):
//   * ELITE: guaranteed (StS parity). ONE tier roll — intAt 100, `ELITE_COMMON_BAND` = the
//     LOWEST 70 values pick COMMON, the remaining 30 UNCOMMON — then ONE uniform pick over
//     the not-held pool of that tier. Exactly 2 draws. A tier whose not-held pool is empty
//     falls to the other tier (still 1 pick draw); only when BOTH pools are empty —
//     impossible through play, reachable through a torn save — is nothing granted, and the
//     suppressed roll costs NOTHING (the potions ruling: "impossible" is free).
//   * BOSS: THREE offers from the not-held RARE pool (pickAt 3 — min(3, pool) draws;
//     five rares exist and each boss takes at most one, so both bosses of a two-act
//     climb offer three; fewer picks only if a torn save already held rares, never
//     more). The player picks 1 (action `r<n>`) or skips (`s0`, StS lets you walk
//     away). The roll
//     happens at VICTORY time, like the card offer it replaces; the pick itself is a
//     choice, not a roll — zero draws.
//
// Pure: no Date, no Math.random, no I/O; the only entropy is (seed, drawIndex), counted.
import { intAt, pickAt } from '../rng.js';

/** HP restored by the Kindled Heart relic (id `burning_blood`) after each combat. */
export const RELIC_HEAL = 6;
/** Extra first-turn Energy from the Cyan Lantern relic (B4, Bellows Keeper). */
export const LANTERN_ENERGY = 1;
/** Block granted at combat start by Forge Iron. */
export const FORGE_IRON_BLOCK = 4;
/** Strength granted at combat start by Whetted Edge. */
export const WHETTED_EDGE_STRENGTH = 1;
/** Extra HP a rest site's hearth heals, when Kindled Coals is held. */
export const HEARTH_HEAL = 8;
/** Max HP gained (and healed) the moment Ember Heart is acquired. */
export const EMBER_HEART_HP = 12;
/** Gold added after every won fight by Gold Vein. */
export const GOLD_VEIN_GAIN = 10;
/** Block gained whenever a potion is quaffed, with Flask Grip held. */
export const FLASK_GRIP_BLOCK = 2;
/** Extra cards drawn on the first turn of each combat, with Deep Well held. */
export const DEEP_WELL_DRAW = 1;
/** The Ash Crown's smaller per-fight heal (it stacks with any Kindled Heart). */
export const ASH_CROWN_HEAL = 3;
/** Slag Crown's Strength at combat start (its Energy row is LANTERN_ENERGY-sized). */
export const SLAG_CROWN_STRENGTH = 2;
export const CINDER_WARD_BLOCK = 6;
export const ASH_LEDGER_GAIN = 20;

/** A state with no `relic` field carries this one (Ashwright runs keep their old hashes). */
export const DEFAULT_RELIC = 'burning_blood';

/** Rarity tiers, matching the card system's three (the codex order). */
export const RELIC_TIERS = Object.freeze(['common', 'uncommon', 'rare']);

/** The elite drop's tier split: the LOWEST 70 of a d100 pick COMMON, the rest UNCOMMON. */
export const ELITE_COMMON_BAND = 70;

/**
 * The relic table — id -> {name, tier, summary, text, offText?, ...hooks}. Order below is
 * the codex order (tier, then table order); the DROP pools are derived from it by tier.
 * `summary` is the compact CLI form; `text` is the describe-layer sentence a human surface
 * shows verbatim — both live HERE, kernel-side, so no surface re-derives words.
 * `offText` completes "Your <relic> ..." for the Iron Skin boon and is only meaningful on
 * a relic a hero can start with.
 */
export const RELICS = Object.freeze({
  // --- the two starting relics (B4) -------------------------------------------------
  burning_blood: {
    tier: 'common', name: 'Kindled Heart',
    summary: `HP+${RELIC_HEAL}/fight`, text: `After each combat, restore ${RELIC_HEAL} HP.`,
    offText: 'no longer heals after fights',
    healAfterFight: RELIC_HEAL,
  },
  cyan_lantern: {
    tier: 'common', name: 'Cyan Lantern',
    summary: `E+${LANTERN_ENERGY} turn 1`, text: `On the first turn of each combat, gain ${LANTERN_ENERGY} Energy.`,
    offText: 'no longer gives Energy on the first turn of each fight',
    firstTurnEnergy: LANTERN_ENERGY,
  },
  // --- common drops -----------------------------------------------------------------
  forge_iron: {
    tier: 'common', name: 'Forge Iron',
    summary: `B${FORGE_IRON_BLOCK} turn 1`, text: `At the start of each combat, gain ${FORGE_IRON_BLOCK} Block.`,
    combatStartBlock: FORGE_IRON_BLOCK,
  },
  whetted_edge: {
    tier: 'common', name: 'Whetted Edge',
    summary: `PWR+${WHETTED_EDGE_STRENGTH} turn 1`, text: `At the start of each combat, gain ${WHETTED_EDGE_STRENGTH} Strength.`,
    combatStartStrength: WHETTED_EDGE_STRENGTH,
  },
  hearth_ash: {
    tier: 'common', name: 'Hearth Ash',
    summary: `rest HP+${HEARTH_HEAL}`, text: `When you rest, heal ${HEARTH_HEAL} additional HP.`,
    restHealBonus: HEARTH_HEAL,
  },
  // --- uncommon drops ---------------------------------------------------------------
  ember_heart: {
    tier: 'uncommon', name: 'Ember Heart',
    summary: `MAXHP+${EMBER_HEART_HP}`, text: `When you acquire it, gain ${EMBER_HEART_HP} max HP (and heal that much).`,
    maxHpBonus: EMBER_HEART_HP,
  },
  gold_vein: {
    tier: 'uncommon', name: 'Gold Vein',
    summary: `GOLD+${GOLD_VEIN_GAIN}/fight`, text: `After each combat, gain ${GOLD_VEIN_GAIN} gold.`,
    goldAfterFight: GOLD_VEIN_GAIN,
  },
  flask_grip: {
    tier: 'uncommon', name: 'Flask Grip',
    summary: `B${FLASK_GRIP_BLOCK}/quaff`, text: `Whenever you quaff a potion, gain ${FLASK_GRIP_BLOCK} Block.`,
    quaffBlock: FLASK_GRIP_BLOCK,
  },
  // --- rare drops (the boss offers three of these) -----------------------------------
  deep_well: {
    tier: 'rare', name: 'Deep Well',
    summary: `D+${DEEP_WELL_DRAW} turn 1`, text: `Draw ${DEEP_WELL_DRAW} additional card on the first turn of each combat.`,
    firstTurnDraw: DEEP_WELL_DRAW,
  },
  ash_crown: {
    tier: 'rare', name: 'Ash Crown',
    summary: `HP+${ASH_CROWN_HEAL}/fight rest+${HEARTH_HEAL}`,
    text: `After each combat, restore ${ASH_CROWN_HEAL} HP. When you rest, heal ${HEARTH_HEAL} additional HP.`,
    healAfterFight: ASH_CROWN_HEAL, restHealBonus: HEARTH_HEAL,
  },
  slag_crown: {
    tier: 'rare', name: 'Slag Crown',
    summary: `E+1 turn 1 PWR+${SLAG_CROWN_STRENGTH}`,
    text: `On the first turn of each combat, gain ${LANTERN_ENERGY} Energy and ${SLAG_CROWN_STRENGTH} Strength.`,
    firstTurnEnergy: LANTERN_ENERGY, combatStartStrength: SLAG_CROWN_STRENGTH,
  },
  // S9: two more rares so the ACT-2 warden's offer is a real three-choice — the rare
  // pool must outlive act 1's pick (5 rares, one taken per boss, two bosses). Both
  // compose existing hooks; no new mechanics, no new draws.
  cinder_ward: {
    tier: 'rare', name: 'Cinder Ward',
    summary: `B${CINDER_WARD_BLOCK} turn 1`,
    text: `At the start of each combat, gain ${CINDER_WARD_BLOCK} Block.`,
    combatStartBlock: CINDER_WARD_BLOCK,
  },
  ash_ledger: {
    tier: 'rare', name: 'Ash Ledger',
    summary: `GOLD+${ASH_LEDGER_GAIN}/fight`,
    text: `After each combat, gain ${ASH_LEDGER_GAIN} gold.`,
    goldAfterFight: ASH_LEDGER_GAIN,
  },
});

/** id -> definition. The ONE lookup; unknown ids yield undefined (never a throw). */
const RELIC_DEFS = new Map(Object.entries(RELICS));

/** The hook keys the table is allowed to carry — the closed menu, pinned by tests. */
export const RELIC_HOOKS = Object.freeze([
  'healAfterFight', 'firstTurnEnergy', 'combatStartBlock', 'combatStartStrength',
  'firstTurnDraw', 'restHealBonus', 'goldAfterFight', 'quaffBlock', 'maxHpBonus',
]);

/** A tolerant definition lookup for ids that arrive from persisted state: a stale save
 *  after a rename yields undefined, and every caller degrades (raw id as the name) —
 *  the potionDef precedent. */
export function relicDef(id) {
  return RELIC_DEFS.get(id);
}

/**
 * The held relic ids, in acquisition order. THE one read: a pre-S7 save (no `relics`
 * field) reads as exactly its B4-era singular relic, or the default; a torn non-array
 * degrades the same way. Never throws.
 * @param {any} state
 * @returns {string[]}
 */
export function relicList(state) {
  if (Array.isArray(state?.relics)) return state.relics;
  const legacy = typeof state?.relic === 'string' ? state.relic : DEFAULT_RELIC;
  return [legacy];
}

/** The relic id a state STARTED with — relics[0] (the kindling Iron Skin text's "{relic}"). */
export const relicId = (state) => relicList(state)[0] ?? DEFAULT_RELIC;

/**
 * The hero's own relic is the one relicOff switches off: the kindling boon reads
 * "Your <relic> <offText>" and means the STARTER, never a relic gained later. So the
 * active set is every held relic except relics[0] while the flag stands.
 * @param {any} state
 * @returns {Array<{id: string, def: any}>} the working relics, acquisition order
 */
export function activeRelicDefs(state) {
  const list = relicList(state);
  const skipFirst = Boolean(state?.relicOff);
  return list
    .map((id, i) => ({ id, def: RELIC_DEFS.get(id) ?? null, index: i }))
    .filter((r) => r.def && !(skipFirst && r.index === 0));
}

/**
 * Sum one hook over the working relics (acquisition order does not matter for a sum).
 * Unknown ids contribute nothing — a torn save degrades to "no effect", never a throw.
 * @param {any} state
 * @param {string} hook a RELIC_HOOKS key
 * @returns {number}
 */
export function relicSum(state, hook) {
  return activeRelicDefs(state).reduce((n, r) => n + (r.def[hook] ?? 0), 0);
}

/** Named per-hook accessors — the ONLY shapes the act/steps layers call. */
export const firstTurnEnergyOf = (state) => relicSum(state, 'firstTurnEnergy');
export const combatStartBlockOf = (state) => relicSum(state, 'combatStartBlock');
export const combatStartStrengthOf = (state) => relicSum(state, 'combatStartStrength');
export const firstTurnDrawOf = (state) => relicSum(state, 'firstTurnDraw');
export const restHealBonusOf = (state) => relicSum(state, 'restHealBonus');
export const goldAfterFightOf = (state) => relicSum(state, 'goldAfterFight');
export const quaffBlockOf = (state) => relicSum(state, 'quaffBlock');

/**
 * The drop pool: every relic of `tier` the run does NOT already hold (a relic can never
 * drop twice), in TABLE order — the order is part of the format, like the potion roster's.
 * @param {any} state
 * @param {string} tier
 * @returns {string[]}
 */
export function dropPool(state, tier) {
  const held = new Set(relicList(state));
  return Object.keys(RELICS).filter((id) => RELICS[id].tier === tier && !held.has(id));
}

/**
 * The elite's guaranteed drop: common 70 / uncommon 30 by ONE d100 band roll, then ONE
 * uniform pick over the not-held pool of that tier (falling to the other tier when the
 * rolled one is exhausted — never a second roll). Exactly 2 draws through play; 0 when
 * both pools are empty (impossible through play, free by the potions ruling).
 * @param {any} state the post-potion-drop victory state
 * @returns {{relic: string | null, draws: number}}
 */
export function rollEliteRelicDrop(state) {
  const common = dropPool(state, 'common');
  const uncommon = dropPool(state, 'uncommon');
  if (common.length === 0 && uncommon.length === 0) return { relic: null, draws: 0 };
  const wantsCommon = intAt(state.seed, state.rngDraws, 100) < ELITE_COMMON_BAND;
  // The rolled tier first; only an exhausted tier falls to its sibling (never re-rolled).
  const pool = wantsCommon ? (common.length > 0 ? common : uncommon)
    : (uncommon.length > 0 ? uncommon : common);
  if (pool.length === 0) return { relic: null, draws: 1 }; // tier rolled, pick impossible
  return { relic: pool[intAt(state.seed, state.rngDraws + 1, pool.length)], draws: 2 };
}

/**
 * The boss's THREE-offer roll: distinct picks from the not-held RARE pool, no dupes.
 * pickAt consumes exactly `min(3, pool.length)` draws; five rares exist (S9 grew the
 * tier so act 2's warden offers a real three after act 1's pick), rares never drop on
 * elites, and the starter is not rare — through play both bosses offer exactly 3. A
 * run short of rares (a torn save) is offered what exists — never padded, never thrown.
 * @param {any} state the boss-victory state
 * @returns {{offers: string[], draws: number}}
 */
export function rollBossRelicOffers(state) {
  const picked = pickAt(state.seed, state.rngDraws, dropPool(state, 'rare'), 3);
  return { offers: picked.picked, draws: picked.draws };
}

/**
 * Is this boss offer one the resolver will actually accept? The ONE validity guard:
 * actions.js enumerates an `r<n>` only for offers that pass it, and pickRelic re-checks
 * it — the same enumeration-mirrors-guard ruling as temperOfferOpen (a refused id is
 * never offered; an offered id always resolves). A torn offer (an id the table no longer
 * knows, or one the run already holds) degrades to a shorter offer row, never a no-op.
 * @param {any} offer
 * @param {any} state
 * @returns {boolean}
 */
export function bossOfferOpen(offer, state) {
  return Boolean(offer && RELIC_DEFS.get(offer) && !relicList(state).includes(offer));
}

/**
 * Acquire one relic: append it in acquisition order and apply its acquisition-time
 * passive (Ember Heart's max HP — the only hook that fires ONCE, at acquisition, not
 * per event). Gaining max HP heals that much, capped at the new max (StS parity).
 * Zero draws. The ONE path every acquisition takes — the elite drop and the boss pick
 * both call this, so a passive can never be skipped or applied twice.
 * @param {any} state
 * @param {string} id a KNOWN relic id (every caller guards on relicDef first)
 * @param {string} [source] where it came from ('elite' | 'boss') — travels on the event
 * @returns {{state: any, events: any[]}}
 */
export function gainRelic(state, id, source = 'relic') {
  const def = RELIC_DEFS.get(id);
  if (!def) return { state, events: [] };
  let next = { ...state, relics: [...relicList(state), id] };
  const events = [{ t: 'relic_gained', relic: id, source }];
  const bonus = def.maxHpBonus ?? 0;
  if (bonus > 0) {
    const maxHp = next.player.maxHp + bonus;
    const hp = Math.min(maxHp, next.player.hp + bonus);
    next = { ...next, player: { ...next.player, maxHp, hp } };
  }
  return { state: next, events };
}
