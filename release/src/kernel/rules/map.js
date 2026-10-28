// The climb's maps — a short branching path with real choices (ADR-4, S9 two acts).
//
// The map is generated ONCE — at `newRun` for act 1, at the act transition for act 2
// (rules/act.js beginNextAct) — from the seed and then stored in state, so re-adding a
// node never re-rolls anything and replay stays exact. Node types are the decision the
// player actually makes: fight something weak, risk an elite for a better reward, or
// rest for HP. Each act keeps its OWN layout facts (placed shop/events, row pools);
// the generator and the node vocabulary are shared, and act 1's facts are frozen
// byte-for-byte — only act 2 is new here.

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
// S9: the gold row above is ACT 1's band table. Act 2 pays +30% through ACT2_GOLD, and
// every reader goes through goldBand(nodeType, act) — never through NODE_TYPES directly.
// (NODE_TYPES keeps its gold rows because the table doubles as the act-1 fact sheet and
// the tier/reward vocabulary both rules and surfaces read.)

/** Rows per act, including the entry row and the boss row (S9: BOTH acts share the
 *  8-row shape — the act is the climb's chapter, not a different geometry). */
export const ROWS = 8;

/** S9: how many acts a fresh run will climb. `state.acts` carries this number so the
 *  boss pick knows whether the run is over: an act-1 boss in a two-act run CONTINUES
 *  (rules/act.js beginNextAct), the act-2 boss ENDS it. Legacy saves predate the field
 *  and read as a one-act run at every `?? 1` — their boss still ends the run in victory. */
export const ACT_COUNT = 2;

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

/** S9: act 2's placed slots — the same promise ("one shop, two events, never luck"),
 *  at this act's own coordinates. The shop sits at row 4's middle slot: a shop BEFORE
 *  the act's elite push (act 1's shop sat after its own), so the second act's spending
 *  decision comes one row earlier. The events sit at row 3's rightmost slot and row 5's
 *  rightmost slot — one per half of the act, NEITHER ever a row's first node (the same
 *  deterministic-walker ruling as act 1: a walker that takes the first travel walks
 *  past the wayside instead of being forced into it, while full-row linking keeps it
 *  reachable from every approach). */
export const ACT2_SHOP_ROW = 4;
export const ACT2_SHOP_SLOT = 1;
export const ACT2_EVENT_NODES = Object.freeze([
  Object.freeze({ row: 3, slot: 1 }),
  Object.freeze({ row: 5, slot: 2 }),
]);

/**
 * S9: the per-act gold bands. Act 2 pays +30% (rounded to whole coins — the rounding
 * is part of the format, computed once here and pinned by tests, never re-derived).
 * The flat tiers stay flat (the act-2 boss pays 130 to every seed, so still ZERO draws)
 * and the ranged tiers stay one draw. `rules/act.js` resolveVictory reads the band for
 * the state's CURRENT act through goldBand(); act-1 runs read NODE_TYPES unchanged.
 */
export const ACT2_GOLD = Object.freeze({
  combat_weak: Object.freeze([13, 22]),
  combat_strong: Object.freeze([33, 46]),
  elite: Object.freeze([65, 91]),
  boss: Object.freeze([130, 130]),
});

/**
 * The gold band for one node type in one act (S9). Act 1 is the NODE_TYPES table
 * itself; act 2 (and any later act) reads the escalation table. Unknown node types
 * (rest/shop/event) have no band in either act — null, as before.
 * @param {string} nodeType
 * @param {number} act the state's current act (a legacy save reads as 1)
 * @returns {[number, number] | null}
 */
export function goldBand(nodeType, act) {
  if ((act ?? 1) >= 2) return ACT2_GOLD[nodeType] ?? null;
  return NODE_TYPES[nodeType]?.gold ?? null;
}

/** The per-act layout facts: the row pools and the placed shop/events coordinates.
 *  Act 1's row is the ORIGINAL data, byte-for-byte (same pools, same placed slots) —
 *  S9 must not move a single act-1 fact. Act 2's row is this slice's new content,
 *  documented exactly like act 1's: more elite-weighted pools (four rows offer an
 *  elite against act 1's three) and a rest in the back half of both halves, so the
 *  longer, harder climb still has its breathing room. */
const ACT_LAYOUTS = {
  1: {
    shopRow: SHOP_ROW,
    shopSlot: SHOP_SLOT,
    events: EVENT_NODES,
    pools: [
      null, // row 0 fixed
      ['combat_weak', 'combat_weak', 'combat_strong'],
      ['combat_weak', 'combat_weak', 'combat_strong'], // row 2: slot 1 IS the first event (EVENT_NODES)
      ['combat_strong', 'combat_strong', 'elite'],
      ['combat_strong', 'elite', 'rest'],
      ['combat_strong', 'combat_strong', 'rest'], // row 5: the middle slot IS the shop (SHOP_ROW/SHOP_SLOT)
      ['rest', 'rest', 'elite'], // row 6: the middle slot IS the second event (EVENT_NODES)
      null, // row 7 fixed boss
    ],
  },
  2: {
    shopRow: ACT2_SHOP_ROW,
    shopSlot: ACT2_SHOP_SLOT,
    events: ACT2_EVENT_NODES,
    pools: [
      null, // row 0 fixed
      ['combat_weak', 'combat_strong'],
      ['combat_weak', 'combat_strong', 'elite'],
      ['combat_strong', 'combat_strong', 'elite'], // row 3: slot 1 IS the first event (ACT2_EVENT_NODES)
      ['combat_strong', 'combat_strong', 'rest'], // row 4: the middle slot IS the shop (ACT2_SHOP_ROW/ACT2_SHOP_SLOT)
      ['combat_strong', 'elite', 'rest'], // row 5: the rightmost slot IS the second event (ACT2_EVENT_NODES)
      ['rest', 'combat_strong', 'elite'],
      null, // row 7 fixed boss
    ],
  },
};

/**
 * Generate an act's path graph. Deterministic given (seed, starting draw index, act).
 * The act chooses the LAYOUT (row pools + placed shop/events coordinates) and nothing
 * else: the generator loop, the width rule and the no-twin-rests rule are shared, so
 * both acts are one mechanic with two fact tables. `act` defaults to 1, which is why
 * every pre-S9 caller (and every act-1 hash) is untouched.
 * @param {number} seed
 * @param {number} startDraw
 * @param {number} [act] which act's layout to lay out (1 or 2)
 * @returns {{rows: any[][], draws: number}}
 */
export function generateMap(seed, startDraw, act = 1) {
  const layout = ACT_LAYOUTS[act];
  if (!layout) throw new Error(`generateMap: unknown act ${act} (known: 1, 2)`);
  let i = startDraw;
  const rows = [];

  // Row 0 — a single fixed opener so every run starts with the same readable fight.
  rows.push([{ id: 'r0n0', type: 'combat_weak', next: [] }]);

  const { events, shopRow, shopSlot } = layout;
  const poolByRow = layout.pools;

  for (let row = 1; row < ROWS - 1; row += 1) {
    const pool = poolByRow[row];
    const width = row <= 3 ? 2 : 3;
    const nodes = [];
    for (let k = 0; k < width; k += 1) {
      // S6: each of the act's two events takes its placed slot outright — the pool
      // entry that would have fed this one choice is given over to it (a 2-wide row's
      // rightmost, or the mirroring middle). Nothing is random about an event's
      // EXISTENCE, so it consumes NO pool draw (same policy as the fixed opener, the
      // boss and the shop: randomness is only spent on content that needs it). WHICH
      // event it holds rolls later, at ENTRY time (rules/events.js), so a run that
      // never visits pays nothing from the stream.
      const placed = events.find((e) => e.row === row && e.slot === k);
      if (placed) {
        nodes.push({ id: `r${row}n${k}`, type: 'event', next: [] });
        continue;
      }
      // S4: the act's single shop takes its placed slot outright — the pool entry that
      // would have fed this one choice is given over to it. Nothing is random about
      // the shop's existence, so it consumes NO pool draw (same policy as the fixed
      // opener and boss rows: randomness is only spent on content that needs it). Its
      // inventory and prices roll later, at ENTRY time (rules/shop.js), so a run that
      // never visits pays nothing from the stream. S9: the coordinates are per-act
      // (act 1 row 5 middle, act 2 row 4 middle).
      if (row === shopRow && k === shopSlot) {
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
