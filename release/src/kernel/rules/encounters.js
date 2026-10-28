// Encounters — the act-1 enemy roster and the deterministic intent selector (ADR-4).
//
// Enemies are data, not code: a fixed move list plus an intent rule. Intents are
// chosen at the START of the player's turn and stored in state, so the observation
// can show what is coming — that is what makes the fight a decision instead of a
// coin flip. No wall clock, no Math.random: every choice is a function of rngDraws.

import { intAt } from '../rng.js';
import { NODE_TYPES } from './map.js';

/** Act-1 enemy definitions. `moves[].damage` is the printed intent number. */
export const ENEMIES = {
  jaw_worm: {
    id: 'jaw_worm',
    name: 'Cinder Maw',
    // Copied into run state and therefore into the content hash. Do not edit.
    stateName: 'Jaw Worm',
    maxHp: [40, 44],
    moves: [
      { id: 'chomp', label: 'A11', kind: 'attack', damage: 11 },
      { id: 'thrash', label: 'A7 B5', kind: 'attack', damage: 7, block: 5 },
      { id: 'bellow', label: 'PWR3 B6', kind: 'buff', strength: 3, block: 6 },
    ],
    noRepeat: 2,
  },
  cultist: {
    id: 'cultist',
    name: 'Ash Cantor',
    stateName: 'Cultist',
    maxHp: [48, 54],
    moves: [
      { id: 'incantation', label: 'PWR3', kind: 'buff', strength: 3 },
      { id: 'dark_strike', label: 'A6', kind: 'attack', damage: 6 },
    ],
    // The cultist always opens with its buff — that opening is the whole fight's shape.
    script: ['incantation', 'dark_strike', 'dark_strike', 'dark_strike'],
  },
  red_louse: {
    id: 'red_louse',
    name: 'Kiln Mite',
    stateName: 'Red Louse',
    maxHp: [10, 15],
    moves: [
      { id: 'bite', label: 'A6', kind: 'attack', damage: 6 },
      { id: 'grow', label: 'PWR2', kind: 'buff', strength: 2 },
    ],
    noRepeat: 2,
  },
  acid_slime: {
    id: 'acid_slime',
    name: 'Slag Ooze',
    stateName: 'Acid Slime',
    maxHp: [28, 32],
    moves: [
      { id: 'tackle', label: 'A10', kind: 'attack', damage: 10 },
      { id: 'lick', label: 'WK1', kind: 'debuff', weak: 1 },
    ],
  },
  gremlin_nob: {
    id: 'gremlin_nob',
    name: 'Cinder Brute',
    stateName: 'Gremlin Nob',
    maxHp: [82, 86],
    elite: true,
    moves: [
      { id: 'rush', label: 'A14', kind: 'attack', damage: 14 },
      { id: 'skull_bash', label: 'A6 VULN2', kind: 'attack', damage: 6, vulnerable: 2 },
      { id: 'enrage', label: 'PWR3', kind: 'buff', strength: 3 },
    ],
  },
  the_guardian: {
    id: 'the_guardian',
    name: 'Slag Warden',
    stateName: 'The Guardian',
    maxHp: [110, 110],
    boss: true,
    moves: [
      { id: 'charging_up', label: 'B20', kind: 'block', block: 20 },
      { id: 'fierce_bash', label: 'A32', kind: 'attack', damage: 32 },
      { id: 'vent_steam', label: 'VULN2 WK2', kind: 'debuff', vulnerable: 2, weak: 2 },
      { id: 'whirlwind', label: 'A5x3', kind: 'attack', damage: 5, hits: 3 },
    ],
    // Opens by armouring up; then alternates pressure and defence.
    script: ['charging_up', 'fierce_bash', 'whirlwind', 'vent_steam', 'fierce_bash', 'whirlwind'],
  },

  // ---- B5 The Cinder Mines (opt-in biome). Only a `biome: 'mines'` run spawns these. ----
  slag_crawler: {
    id: 'slag_crawler',
    name: 'Slag Crawler',
    maxHp: [32, 36],
    // A shell that hardens, then a pincer flurry: hit it on the turns it is not armoured.
    moves: [
      { id: 'harden', label: 'B9', kind: 'block', block: 9 },
      { id: 'pincers', label: 'A4x2', kind: 'attack', damage: 4, hits: 2 },
      { id: 'ram', label: 'A10', kind: 'attack', damage: 10 },
    ],
    noRepeat: 2,
  },
  ash_wraith: {
    id: 'ash_wraith',
    name: 'Ash Wraith',
    maxHp: [24, 28],
    // Fragile but sapping: it always opens by weakening you, then drains.
    moves: [
      { id: 'wail', label: 'WK2', kind: 'debuff', weak: 2 },
      { id: 'drain', label: 'A8', kind: 'attack', damage: 8 },
      { id: 'drift', label: 'PWR1 B6', kind: 'buff', strength: 1, block: 6 },
    ],
    script: ['wail'],
    noRepeat: 2,
  },
  ash_wraith_elite: {
    id: 'ash_wraith_elite',
    name: 'Ash Matriarch',
    maxHp: [74, 78],
    elite: true,
    // A fixed rhythm the player can learn: shroud, double strike, curse, reap.
    moves: [
      { id: 'shroud', label: 'PWR2 B12', kind: 'buff', strength: 2, block: 12 },
      { id: 'soulfire', label: 'A7x2', kind: 'attack', damage: 7, hits: 2 },
      { id: 'grief', label: 'VULN2 WK2', kind: 'debuff', vulnerable: 2, weak: 2 },
      { id: 'reap', label: 'A14', kind: 'attack', damage: 14 },
    ],
    script: ['shroud', 'soulfire', 'grief', 'reap', 'shroud', 'soulfire', 'grief', 'reap'],
  },
  cinder_foreman: {
    id: 'cinder_foreman',
    name: 'Cinder Foreman',
    maxHp: [125, 125],
    boss: true,
    // Surveys (armour + Strength), swings twice, then brings the roof down.
    moves: [
      { id: 'survey', label: 'PWR2 B14', kind: 'buff', strength: 2, block: 14 },
      { id: 'pick_swing', label: 'A9x2', kind: 'attack', damage: 9, hits: 2 },
      { id: 'cave_in', label: 'A26', kind: 'attack', damage: 26 },
      { id: 'choke_dust', label: 'WK2 VULN1', kind: 'debuff', weak: 2, vulnerable: 1 },
    ],
    script: ['survey', 'pick_swing', 'choke_dust', 'cave_in', 'survey', 'pick_swing', 'choke_dust', 'cave_in'],
  },
};

/**
 * Encounter table. Each entry spawns a fixed set of enemies.
 * `tier` orders them by difficulty inside an act.
 */
export const ENCOUNTERS = {
  weak_1: { id: 'weak_1', name: 'Cinder Maw', stateName: 'Jaw Worm', tier: 1, enemies: ['jaw_worm'] },
  weak_2: { id: 'weak_2', name: 'Ash Cantor', stateName: 'Cultist', tier: 1, enemies: ['cultist'] },
  weak_3: { id: 'weak_3', name: 'Twin Mites', stateName: 'Two Lice', tier: 1, enemies: ['red_louse', 'red_louse'] },
  weak_4: { id: 'weak_4', name: 'Slag Ooze', stateName: 'Acid Slime', tier: 1, enemies: ['acid_slime'] },
  strong_1: { id: 'strong_1', name: 'Mite and Ooze', stateName: 'Louse + Slime', tier: 2, enemies: ['red_louse', 'acid_slime'] },
  strong_2: { id: 'strong_2', name: 'Maw and Mite', stateName: 'Jaw Worm + Louse', tier: 2, enemies: ['jaw_worm', 'red_louse'] },
  strong_3: { id: 'strong_3', name: 'Cantor and Ooze', stateName: 'Cultist + Slime', tier: 2, enemies: ['cultist', 'acid_slime'] },
  elite_1: { id: 'elite_1', name: 'Cinder Brute', stateName: 'Gremlin Nob', tier: 3, elite: true, enemies: ['gremlin_nob'] },
  boss_1: { id: 'boss_1', name: 'Slag Warden', stateName: 'The Guardian', tier: 4, boss: true, enemies: ['the_guardian'] },
  // B5 The Cinder Mines.
  mines_weak_1: { id: 'mines_weak_1', name: 'Slag Crawler', tier: 1, enemies: ['slag_crawler'] },
  mines_weak_2: { id: 'mines_weak_2', name: 'Ash Wraith', tier: 1, enemies: ['ash_wraith'] },
  mines_weak_3: { id: 'mines_weak_3', name: 'Two Wraiths', tier: 1, enemies: ['ash_wraith', 'ash_wraith'] },
  mines_strong_1: { id: 'mines_strong_1', name: 'Crawler and Wraith', tier: 2, enemies: ['slag_crawler', 'ash_wraith'] },
  mines_strong_2: { id: 'mines_strong_2', name: 'Two Crawlers', tier: 2, enemies: ['slag_crawler', 'slag_crawler'] },
  mines_elite_1: { id: 'mines_elite_1', name: 'Ash Matriarch', tier: 3, elite: true, enemies: ['ash_wraith_elite'] },
  mines_boss_1: { id: 'mines_boss_1', name: 'Cinder Foreman', tier: 4, boss: true, enemies: ['cinder_foreman'] },

  // ---- S9 The Kiln Deeps (act 2). No new enemies: every row re-mixes the EXISTING
  // roster into bigger, harder pools — the act-1 opener (Jaw Worm) returns as a BASELINE
  // fight, singles become pairs and trios, and the elite fights are PAIRS (an act-1
  // elite plus a tag-along). The boss is the Cinder Foreman — the mines boss elevated
  // to the second act's summit. Spawn HP rolls exactly as everywhere else; the
  // difficulty comes from the mixes and their bigger total HP pools.
  kiln_weak_1: { id: 'kiln_weak_1', name: 'Cinder Maw', stateName: 'Jaw Worm', tier: 1, enemies: ['jaw_worm'] },
  kiln_weak_2: { id: 'kiln_weak_2', name: 'Slag Crawler', tier: 1, enemies: ['slag_crawler'] },
  kiln_weak_3: { id: 'kiln_weak_3', name: 'Ooze and Mite', stateName: 'Slime + Louse', tier: 1, enemies: ['acid_slime', 'red_louse'] },
  kiln_strong_1: { id: 'kiln_strong_1', name: 'Maw and Ooze', stateName: 'Jaw Worm + Slime', tier: 2, enemies: ['jaw_worm', 'acid_slime'] },
  kiln_strong_2: { id: 'kiln_strong_2', name: 'Cantor and Crawler', stateName: 'Cultist + Crawler', tier: 2, enemies: ['cultist', 'slag_crawler'] },
  kiln_strong_3: { id: 'kiln_strong_3', name: 'The Wraith Pack', stateName: 'Two Wraiths + Slime', tier: 2, enemies: ['ash_wraith', 'ash_wraith', 'acid_slime'] },
  kiln_elite_1: { id: 'kiln_elite_1', name: 'Brute and Mite', stateName: 'Gremlin Nob + Louse', tier: 3, elite: true, enemies: ['gremlin_nob', 'red_louse'] },
  kiln_elite_2: { id: 'kiln_elite_2', name: 'Matriarch and Wraith', stateName: 'Ash Matriarch + Wraith', tier: 3, elite: true, enemies: ['ash_wraith_elite', 'ash_wraith'] },
  kiln_boss_1: { id: 'kiln_boss_1', name: 'Cinder Foreman', stateName: 'Cinder Foreman', tier: 4, boss: true, enemies: ['cinder_foreman'] },
};

/**
 * Biomes (B5): the ONE list of biomes. 'foundry' is the default act; 'mines' is the opt-in
 * alternate. `byType` is the encounter pool per node type;
 * `backdrop` is the art key src/web/stage-art.js draws behind the stage. newRun validates against this
 * table, the snapshot names the biome from it, and the GUI picker, Act I card and CLI read
 * it through the public entry, so a new biome is one row here.
 */
export const BIOMES = Object.freeze({
  foundry: {
    name: 'The Foundry',
    backdrop: 'forge',
    byType: { combat_weak: ['weak_1', 'weak_2', 'weak_3', 'weak_4'], combat_strong: ['strong_1', 'strong_2', 'strong_3'], elite: ['elite_1'], boss: ['boss_1'] },
  },
  mines: {
    name: 'The Cinder Mines',
    backdrop: 'tunnel',
    byType: { combat_weak: ['mines_weak_1', 'mines_weak_2', 'mines_weak_3'], combat_strong: ['mines_strong_1', 'mines_strong_2'], elite: ['mines_elite_1'], boss: ['mines_boss_1'] },
  },
  // S9: act 2's own biome — the deep shafts below both act-1 paths. It is NOT an act-1
  // choice (rules/act.js beginNextAct walks every two-act run into it after the act-1
  // boss) and it is harder than both act-1 tables: every pool re-mixes the existing
  // roster into bigger groups with bigger total HP. It reuses the tunnel backdrop.
  kiln: {
    name: 'The Kiln Deeps',
    backdrop: 'tunnel',
    byType: { combat_weak: ['kiln_weak_1', 'kiln_weak_2', 'kiln_weak_3'], combat_strong: ['kiln_strong_1', 'kiln_strong_2', 'kiln_strong_3'], elite: ['kiln_elite_1', 'kiln_elite_2'], boss: ['kiln_boss_1'] },
  },
});

/** The biome a run without `biome` plays (its state carries no `biome` field). */
export const DEFAULT_BIOME = 'foundry';

/** S9: the biome every act >= 2 walks into. State carries the ACT-1 biome (`state.biome`,
 *  unchanged from B5 — the log header and the record still mean "where the run STARTED"),
 *  so the CURRENT act's biome is derived here: the ONE place that maps acts to biomes.
 *  A legacy save (no `act` field) reads as act 1. */
export const ACT2_BIOME = 'kiln';

/**
 * The biome the run is standing in RIGHT NOW (S9): the act-2 biome from act 2 on,
 * the run's own biome before that. Surfaces read this (through the snapshot's
 * `biome`/`biomeName`), never the raw state field — the state field stays the
 * starting biome so replay/log headers keep their meaning.
 * @param {any} state
 * @returns {string} a BIOMES key
 */
export function currentBiome(state) {
  if ((state?.act ?? 1) >= 2) return ACT2_BIOME;
  return state?.biome ?? DEFAULT_BIOME;
}

/**
 * The act-1 START paths (S9): every biome EXCEPT the act-2 one. The kindling screen's
 * Path picker renders THIS list — the Deeps are where the climb goes, not where it
 * begins — and the choice lives here, kernel-side, so no surface curates its own list
 * (the B5 ruling). The CLI keeps accepting any BIOMES key; this is the picker's list.
 * @returns {string[]}
 */
export function startBiomeIds() {
  return Object.keys(BIOMES).filter((id) => id !== ACT2_BIOME);
}

/**
 * Choose the next intent for one enemy. Deterministic, and avoids repeating the
 * same move more than `noRepeat` times in a row so fights keep a readable rhythm.
 * @param {number} seed
 * @param {number} drawIndex
 * @param {any} enemy spawn descriptor with moveCount
 * @param {number[]} history most recent move indices, oldest first
 * @param {number} scriptStep how many intents this enemy has already chosen
 * @returns {{moveIndex: number, draws: number}}
 */
export function chooseIntent(seed, drawIndex, enemy, history, scriptStep) {
  const def = ENEMIES[enemy.id];
  if (def.script && scriptStep < def.script.length) {
    const idx = def.moves.findIndex((m) => m.id === def.script[scriptStep]);
    return { moveIndex: idx, draws: 0 };
  }
  if (def.moves.length === 1) return { moveIndex: 0, draws: 0 };

  const noRepeat = def.noRepeat ?? 0;
  const eligible = def.moves
    .map((_, i) => i)
    .filter((i) => {
      if (noRepeat === 0) return true;
      const tail = history.slice(-noRepeat);
      return !(tail.length === noRepeat && tail.every((h) => h === i));
    });
  const pool = eligible.length > 0 ? eligible : def.moves.map((_, i) => i);

  // Weight: prefer an attack when the enemy did not attack last turn, so enemies
  // do not stand idle; this is a heuristic, but it is a *deterministic* one.
  const lastMove = history.length > 0 ? def.moves[history[history.length - 1]] : null;
  const attacks = pool.filter((i) => def.moves[i].kind === 'attack');
  const preferred = lastMove && lastMove.kind === 'attack' && attacks.length > 0 ? attacks : pool;
  // Still one rng draw regardless, so draw counts never depend on the branch taken.
  const r = intAt(seed, drawIndex, preferred.length);
  return { moveIndex: preferred[r], draws: 1 };
}

/**
 * Roll the per-node encounter table for a generated map: which encounter each combat
 * node holds, and the HP roll of every enemy it spawns. Moved out of the kernel entry
 * so the facade builds state and this module owns everything encounter-shaped.
 *
 * Draw order is part of the save format (do not reorder): map rows top to bottom,
 * nodes left to right; one draw for the encounter pick, then one per spawned enemy's
 * HP. Rest nodes consume nothing — they are fully determined by the map.
 *
 * @param {number} seed
 * @param {number} startDraw first unconsumed draw index
 * @param {any[][]} rows map rows (rules/map.js generateMap)
 * @param {Record<string, string[]>} byType encounter pool per node type (BIOMES[biome].byType)
 * @returns {{table: Record<string, any>, draws: number}} draws = total consumed
 */
export function buildEncounterTable(seed, startDraw, rows, byType) {
  let draws = startDraw;
  const table = {};
  for (const row of rows) {
    for (const node of row) {
      const pool = byType[node.type];
      if (!pool) {
        // Non-combat node (rest): no enemies, no draws consumed. Skipping the draw
        // keeps the stream aligned to *content that needs randomness*; rest nodes
        // are fully determined by the map, which is itself seed-derived.
        table[node.id] = {
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
      table[node.id] = {
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
  return { table, draws };
}
