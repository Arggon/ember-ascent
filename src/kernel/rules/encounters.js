// Encounters — the act-1 enemy roster and the deterministic intent selector (ADR-4).
//
// Enemies are data, not code: a fixed move list plus an intent rule. Intents are
// chosen at the START of the player's turn and stored in state, so the observation
// can show what is coming — that is what makes the fight a decision instead of a
// coin flip. No wall clock, no Math.random: every choice is a function of rngDraws.

import { intAt } from '../rng.js';

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
};

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
