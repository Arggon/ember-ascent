// Act 1 map — a short branching path with real choices (ADR-4).
//
// The map is generated ONCE at `newRun` from the seed and then stored in state,
// so re-adding a node never re-rolls anything and replay stays exact. Node types
// are the decision the player actually makes: fight something weak, risk an elite
// for a better reward, or rest for HP.

import { intAt } from '../rng.js';

/** Node kinds and their meaning. `gold` is the inclusive [min, max] the victory path
 *  pays (rules/act.js resolveVictory): the tier decides the range, the seed decides the
 *  spot inside it. A rest node never fights, so it carries no gold row. A shop node
 *  (S4) neither fights nor pays — it is where gold is SPENT (rules/shop.js), so it too
 *  carries no gold row. */
export const NODE_TYPES = {
  combat_weak: { id: 'combat_weak', label: 'fight', tier: 1, reward: 'card', gold: [10, 17] },
  combat_strong: { id: 'combat_strong', label: 'fight+', tier: 2, reward: 'card', gold: [25, 35] },
  elite: { id: 'elite', label: 'elite', tier: 3, reward: 'card', gold: [50, 70] },
  rest: { id: 'rest', label: 'rest', tier: 0, reward: 'heal' },
  shop: { id: 'shop', label: 'shop', tier: 0, reward: 'shop' },
  // S6: a wayside story. It neither fights nor pays by tier — it is where gold, HP,
  // cards and potions change hands by CHOICE (rules/events.js), so it carries no gold
  // row and its encounter-table entry spawns nothing.
  event: { id: 'event', label: 'event', tier: 0, reward: 'event' },
  boss: { id: 'boss', label: 'boss', tier: 4, reward: 'end', gold: [100, 100] },
};

/** Rows in act 1, including the entry row and the boss row. */
export const ROWS = 8;

/** S4: where the act's ONE shop sits. The middle slot of row 5 — between the rest rows
 *  and the elite push, so a player who wants the wares must decide whether to arrive
 *  hurt. Placed, not rolled: a seeded pool entry the draw could miss would leave some
 *  runs shopless, and "one shop per act" is a promise about the FORMAT, not about luck. */
export const SHOP_ROW = 5;
export const SHOP_SLOT = 1;

/** S6: where the act's TWO events sit. Row 2's rightmost slot and row 6's middle slot
 *  (mirroring the shop's placed-middle precedent). Placed, not rolled: a seeded pool
 *  entry the draw could miss would leave some runs eventless, and "two events per act"
 *  is a promise about the FORMAT, not about luck — the same ruling the shop's placement
 *  made. NEITHER slot is its row's first node: a deterministic walker that takes the
 *  first travel (the built-in policies rank the event last, exactly like the shop; the
 *  test drivers do the same by construction) walks past the wayside instead of being
 *  forced into it, while full-row linking keeps it reachable from every approach. */
export const EVENT_NODES = Object.freeze([
  Object.freeze({ row: 2, slot: 1 }),
  Object.freeze({ row: 6, slot: 1 }),
]);

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
    ['combat_weak', 'combat_weak', 'combat_strong'], // row 2: slot 1 IS the first event (EVENT_NODES)
    ['combat_strong', 'combat_strong', 'elite'],
    ['combat_strong', 'elite', 'rest'],
    ['combat_strong', 'combat_strong', 'rest'], // row 5: the middle slot IS the shop (SHOP_ROW/SHOP_SLOT)
    ['rest', 'rest', 'elite'], // row 6: the middle slot IS the second event (EVENT_NODES)
    null, // row 7 fixed boss
  ];

  for (let row = 1; row < ROWS - 1; row += 1) {
    const pool = poolByRow[row];
    const width = row <= 3 ? 2 : 3;
    const nodes = [];
    for (let k = 0; k < width; k += 1) {
      // S6: each of the act's two events takes its placed slot outright — the pool
      // entry that would have fed this one choice is given over to it (row 2 has only
      // two slots, so its leftmost is the event; row 6 mirrors the shop's middle).
      // Nothing is random about an event's EXISTENCE, so it consumes NO pool draw
      // (same policy as the fixed opener, the boss and the shop: randomness is only
      // spent on content that needs it). WHICH event it holds rolls later, at ENTRY
      // time (rules/events.js), so a run that never visits pays nothing from the stream.
      const placed = EVENT_NODES.find((e) => e.row === row && e.slot === k);
      if (placed) {
        nodes.push({ id: `r${row}n${k}`, type: 'event', next: [] });
        continue;
      }
      // S4: the act's single shop takes row 5's middle slot outright — the pool entry
      // that would have fed this one choice is given over to it. Nothing is random
      // about the shop's existence, so it consumes NO pool draw (same policy as the
      // fixed opener and boss rows: randomness is only spent on content that needs
      // it). Its inventory and prices roll later, at ENTRY time (rules/shop.js), so
      // a run that never visits pays nothing from the stream.
      if (row === SHOP_ROW && k === SHOP_SLOT) {
        nodes.push({ id: `r${row}n${k}`, type: 'shop', next: [] });
        continue;
      }
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
