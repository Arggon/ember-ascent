// Act 1 map — a short branching path with real choices (ADR-4).
//
// The map is generated ONCE at `newRun` from the seed and then stored in state,
// so re-adding a node never re-rolls anything and replay stays exact. Node types
// are the decision the player actually makes: fight something weak, risk an elite
// for a better reward, or rest for HP.

import { intAt } from '../rng.js';

/** Node kinds and their meaning. */
export const NODE_TYPES = {
  combat_weak: { id: 'combat_weak', label: 'fight', tier: 1, reward: 'card' },
  combat_strong: { id: 'combat_strong', label: 'fight+', tier: 2, reward: 'card' },
  elite: { id: 'elite', label: 'elite', tier: 3, reward: 'card' },
  rest: { id: 'rest', label: 'rest', tier: 0, reward: 'heal' },
  boss: { id: 'boss', label: 'boss', tier: 4, reward: 'end' },
};

/** Rows in act 1, including the entry row and the boss row. */
export const ROWS = 8;

/**
 * Generate the act-1 path graph. Deterministic given (seed, starting draw index).
 * @param {number} seed
 * @param {number} startDraw
 * @returns {{rows: any[][], draws: number}}
 */
export function generateMap(seed, startDraw) {
  let i = startDraw;
  const rows = [];

  // Row 0 — a single fixed opener so every run starts with the same readable fight.
  rows.push([{ id: 'r0n0', type: 'combat_weak', next: [] }]);

  const poolByRow = [
    null, // row 0 fixed
    ['combat_weak', 'combat_weak', 'combat_strong'],
    ['combat_weak', 'combat_strong', 'combat_strong'],
    ['combat_strong', 'combat_strong', 'elite'],
    ['combat_strong', 'elite', 'rest'],
    ['combat_strong', 'combat_strong', 'rest'],
    ['rest', 'rest', 'elite'],
    null, // row 7 fixed boss
  ];

  for (let row = 1; row < ROWS - 1; row += 1) {
    const pool = poolByRow[row];
    const width = row <= 3 ? 2 : 3;
    const nodes = [];
    for (let k = 0; k < width; k += 1) {
      const pick = intAt(seed, i, pool.length);
      i += 1;
      let type = pool[pick];
      // Never offer two identical 'rest' nodes side by side: a choice between
      // two identical options is not a choice.
      if (k === 1 && type === 'rest' && nodes[0].type === 'rest') type = 'combat_strong';
      nodes.push({ id: `r${row}n${k}`, type, next: [] });
    }
    rows.push(nodes);
  }

  rows.push([{ id: `r${ROWS - 1}n0`, type: 'boss', next: [] }]);

  // Link every node to every node of the following row.
  for (let row = 0; row < rows.length - 1; row += 1) {
    for (const node of rows[row]) {
      node.next = rows[row + 1].map((n) => n.id);
    }
  }
  return { rows, draws: i - startDraw };
}

/**
 * Look up a node by id.
 * @param {any[][]} rows
 * @param {string} id
 * @returns {any|undefined}
 */
export function findNode(rows, id) {
  for (const row of rows) {
    const hit = row.find((n) => n.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Legal moves from the current position: every node of the NEXT row (the current
 * row's outgoing links), or the whole first row at the start.
 * @param {any} state
 * @returns {any[]} node descriptors
 */
export function availableNodes(state) {
  const { rows } = state.map;
  if (state.floor < 0) return rows[0];
  const current = rows[state.floor]?.find((n) => n.id === state.mapNodeId);
  if (!current) return [];
  return rows[state.floor + 1] ?? [];
}
