// UX-6 — the REAL path topology: the PARITY WEAVE edge rule and its guarantees.
//
// The map's edge rule (rules/map.js generateMap): node i of row r connects by its
// lane — a growing or holding next row gives j ∈ {i, i+1}, a contracting one
// j ∈ {i−1, i}, clamped, with a clamped-empty band widening toward the interior.
// "When you win that lvl, no matter which option you chose you can select all options
// at the next lvl" was the complaint: the ±1 band covered the ENTIRE next row whenever
// both rows were 2 wide, so a 2-wide level's pick foreclosed nothing. The weave makes
// every choice block something (from row-1 node 1 the run CANNOT reach row-2 node 0).
// This file pins the guarantees the rule must keep, per seed, over BOTH acts:
//   * the weave shape itself (every edge is the lane's own edge, checked against the
//     worked-shapes table reimplemented here independently of the generator; every
//     edge lands in the real next row);
//   * the structural worked shapes at the format's real transitions (1→2, 2→2, 2→3,
//     3→3, 3→1) — the table in generateMap's doc, pinned literally;
//   * reachability from the ENTRY composes: every node of every row is reachable
//     from some node of the row before it, the entry row is offered whole at the
//     start, therefore EVERY placed node (act 1's shop r5n1, events r2n1/r6n1; act
//     2's shop r4n1, events r3n1/r5n2) is reachable on every seed — the map view
//     and availableNodes walk the stored edges, so an unreachable node would be a
//     dead promise the player could never collect. Reachable, not unavoidable: a
//     placed node offered only from SOME feeder lanes is the point of the weave;
//   * the boss is reachable from EVERY row-6 node (the summit convergence — no
//     impossible climb, a hard fail not a soft warning);
//   * no dead ends: every non-boss node has at least one outgoing edge;
//   * the kernel's own action list (legalActions → availableNodes) offers exactly
//     the current node's band — the player is never offered a node the edges do
//     not reach. The honest cost of genuine blocking is pinned too: a one-edge
//     band can end at a WAYSIDE, and the test names the exact structural
//     singletons (act 1: r1n1→r2n1; act 2: r2n1→r3n1 and r4n2→r5n2) — no others,
//     and no singleton SHOP anywhere;
//   * a LEGACY save carries its own full-linked map and keeps blood_tithe the whole
//     next row — the stored edges are read, no new field, nothing relinked.
// 60 seeds × 2 acts, asserted with the seed named in every message.
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateMap, findNode, ROWS } from '../../src/kernel/rules/map.js';
import { newRun, step } from '../../src/kernel/index.js';
import { beginNextAct } from '../../src/kernel/rules/act.js';
import { actions as legalActions } from '../../src/kernel/actions.js';

const SEEDS = 60;

/** The weave band for node `k` of a row `w` wide into a row `wNext` wide — the
 *  worked-shapes rule, reimplemented here from the DOC (not by calling the
 *  generator), so the test is an independent witness:
 *    grow/hold: j ∈ {k, k+1}; contract: j ∈ {k−1, k}; clamped into range; an
 *    empty clamped band widens downward one lane until in range (the summit). */
function weaveBand(k, w, wNext) {
  const lanes = wNext < w ? [k - 1, k] : [k, k + 1];
  const want = lanes.filter((j) => j >= 0 && j < wNext);
  if (want.length === 0) {
    let j = lanes[0] - 1;
    while (j >= wNext) j -= 1;
    want.push(Math.max(j, 0));
  }
  return want;
}

/** The weave shape: every edge of every node is exactly the lane's own band into the
 *  next row (no dead ends falls out — a band is never empty), and every edge lands in
 *  the real next row. */
function assertWeaveShape(rows, act, seed) {
  for (let r = 0; r + 1 < rows.length; r += 1) {
    const curRow = rows[r];
    const nextRow = rows[r + 1];
    curRow.forEach((node, k) => {
      assert.ok(node.next.length >= 1, `act ${act} seed ${seed}: ${node.id} has an outgoing edge (no dead ends)`);
      const want = weaveBand(k, curRow.length, nextRow.length);
      const got = node.next.map((id) => {
        const j = nextRow.findIndex((n) => n.id === id);
        assert.ok(j !== -1, `act ${act} seed ${seed}: ${node.id} -> ${id} lands in the real next row`);
        return j;
      }).sort((a, b) => a - b);
      assert.deepEqual(got, want,
        `act ${act} seed ${seed}: ${node.id} (slot ${k} of ${curRow.length} into ${nextRow.length}) weaves exactly its lane ${JSON.stringify(want)}`);
      assert.deepEqual(new Set(node.next).size, node.next.length,
        `act ${act} seed ${seed}: ${node.id} carries no duplicate edges`);
    });
  }
}

/** Reachability from the entry, by induction over the rows: the entry row is offered
 *  whole, every later row must be reachable from SOME node of the row before. Returns
 *  the set of reachable node ids. */
function reachableFromEntry(rows) {
  const seen = new Set(rows[0].map((n) => n.id));
  for (let r = 1; r < rows.length; r += 1) {
    for (const node of rows[r]) {
      const feeds = rows[r - 1].some((prev) => seen.has(prev.id) && prev.next.includes(node.id));
      if (feeds) seen.add(node.id);
    }
  }
  return seen;
}

/** An act-N run state standing on a mid-map node, phase `map`, with the run's own
 *  generated map — the shape legalActions' travel branch reads. */
function standingOn(seed, act, nodeId) {
  const base = act >= 2 ? beginNextAct(newRun({ seed })).state : newRun({ seed });
  const floor = Number(nodeId.slice(1, nodeId.indexOf('n')));
  return { ...base, phase: 'map', floor, mapNodeId: nodeId };
}

test('the weave rule: lane bands, no dead ends, over 60 seeds x both acts', () => {
  for (let act = 1; act <= 2; act += 1) {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const { rows } = generateMap(seed, 0, act);
      assert.equal(rows.length, ROWS, `act ${act} seed ${seed}: the row count is the format's`);
      assertWeaveShape(rows, act, seed);
    }
  }
});

test('the worked shapes hold structurally at the format\'s real transitions', () => {
  // The doc table in generateMap, pinned literally: these bands come from the WIDTHS
  // (which are format constants), so they are seed-independent — asserted on real
  // generated maps for good measure.
  for (const act of [1, 2]) {
    const { rows } = generateMap(0, 0, act);
    const ids = (r) => rows[r].map((n) => n.id);
    // 1→2 (entry): node 0 → both row-1 slots.
    assert.deepEqual(rows[0][0].next, ids(1), '1→2: the opener offers both row-1 slots');
    // 2→2: node 0 → {0,1}; node 1 → {1} (row-1 node 1 CANNOT reach row-2 node 0).
    assert.deepEqual(rows[1][0].next, [ids(2)[0], ids(2)[1]], '2→2: node 0 weaves {0,1}');
    assert.deepEqual(rows[1][1].next, [ids(2)[1]], '2→2: node 1 weaves {1} — row-2 node 0 is blocked');
    // 2→2 again (rows 2→3).
    assert.deepEqual(rows[2][0].next, [ids(3)[0], ids(3)[1]], '2→2: node 0 weaves {0,1}');
    assert.deepEqual(rows[2][1].next, [ids(3)[1]], '2→2: node 1 weaves {1}');
    // 2→3: node 0 → {0,1}; node 1 → {1,2}.
    assert.deepEqual(rows[3][0].next, [ids(4)[0], ids(4)[1]], '2→3: node 0 weaves {0,1}');
    assert.deepEqual(rows[3][1].next, [ids(4)[1], ids(4)[2]], '2→3: node 1 weaves {1,2}');
    // 3→3: node 0 → {0,1}; node 1 → {1,2}; node 2 → {2}.
    assert.deepEqual(rows[4][0].next, [ids(5)[0], ids(5)[1]], '3→3: node 0 weaves {0,1}');
    assert.deepEqual(rows[4][1].next, [ids(5)[1], ids(5)[2]], '3→3: node 1 weaves {1,2}');
    assert.deepEqual(rows[4][2].next, [ids(5)[2]], '3→3: node 2 weaves {2} — row-5 node 0 is blocked');
    // 3→3 again (rows 5→6).
    assert.deepEqual(rows[5][0].next, [ids(6)[0], ids(6)[1]], '3→3: node 0 weaves {0,1}');
    assert.deepEqual(rows[5][1].next, [ids(6)[1], ids(6)[2]], '3→3: node 1 weaves {1,2}');
    assert.deepEqual(rows[5][2].next, [ids(6)[2]], '3→3: node 2 weaves {2}');
    // 3→1 (the summit convergence): every row-6 node funnels into the warden.
    for (const node of rows[6]) {
      assert.deepEqual(node.next, [ids(7)[0]], `3→1: ${node.id} converges on the boss`);
    }
  }
});

test('every node of every generated map is reachable from the entry, over 60 seeds x both acts', () => {
  for (let act = 1; act <= 2; act += 1) {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const { rows } = generateMap(seed, 0, act);
      const seen = reachableFromEntry(rows);
      const all = rows.flat().map((n) => n.id);
      const unreachable = all.filter((id) => !seen.has(id));
      assert.deepEqual(unreachable, [],
        `act ${act} seed ${seed}: every node is reachable from the entry (unreachable: ${unreachable.join(', ')})`);
    }
  }
});

test('the placed nodes are reachable on every seed, and the boss closes every climb', () => {
  const PLACED = {
    1: ['r2n1', 'r5n1', 'r6n1'], // the two waysides and the vendor, at their documented slots
    2: ['r3n1', 'r4n1', 'r5n2'],
  };
  for (let act = 1; act <= 2; act += 1) {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const { rows } = generateMap(seed, 0, act);
      const seen = reachableFromEntry(rows);
      for (const id of PLACED[act]) {
        const node = findNode(rows, id);
        assert.ok(node, `act ${act} seed ${seed}: the placed node ${id} exists`);
        assert.ok(seen.has(id), `act ${act} seed ${seed}: the placed node ${id} (${node.type}) is reachable from the entry`);
      }
      const boss = rows[ROWS - 1][0];
      assert.equal(boss.type, 'boss', `act ${act} seed ${seed}: the summit is the boss`);
      assert.ok(seen.has(boss.id), `act ${act} seed ${seed}: the boss is reachable — no impossible climb`);
      // The summit convergence, per node: EVERY row-6 node's own band ends at the
      // warden (not merely via some earlier row) — the climb always closes.
      for (const node of rows[ROWS - 2]) {
        assert.ok(node.next.includes(boss.id), `act ${act} seed ${seed}: ${node.id} links to the boss`);
      }
    }
  }
});

test('the kernel offers exactly the current node band, and the forced-wayside singletons are exactly the structural ones', () => {
  // The honest cost of the weave, pinned: a one-edge band can end at a WAYSIDE. The
  // fixed widths make these STRUCTURAL, not seed luck — exactly one per act-1 lane
  // list and two per act-2's. No other node's band is a singleton wayside, no band
  // anywhere is a singleton SHOP (the vendor is never forced on the player), and
  // every multi-edge band still holds a non-wayside choice.
  const STRUCTURAL = { 1: new Set(['r1n1']), 2: new Set(['r2n1', 'r4n2']) };
  for (let act = 1; act <= 2; act += 1) {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const { rows } = generateMap(seed, 0, act);
      for (let r = 0; r + 1 < rows.length; r += 1) {
        for (const node of rows[r]) {
          const state = standingOn(seed, act, node.id);
          const travels = legalActions(state).filter((a) => a.kind === 'travel');
          assert.deepEqual(travels.map((a) => a.nodeId).sort(), [...node.next].sort(),
            `act ${act} seed ${seed}: at ${node.id} the kernel offers exactly the stored band`);
          if (travels.length === 1 && travels[0].nodeType === 'event') {
            assert.ok(STRUCTURAL[act].has(node.id),
              `act ${act} seed ${seed}: ${node.id} forces a wayside but is not a documented structural singleton`);
          } else if (travels.length === 1) {
            assert.notEqual(travels[0].nodeType, 'shop',
              `act ${act} seed ${seed}: ${node.id} forces the shop — never the format's ruling`);
          } else {
            assert.ok(travels.some((a) => a.nodeType !== 'event'),
              `act ${act} seed ${seed}: every multi-edge band at ${node.id} holds a non-wayside choice`);
          }
          // Every offered id is a legal step: the first one travels without error.
          const out = step(state, travels[0].id);
          assert.equal(out.error, null, `act ${act} seed ${seed}: the band's first travel is a legal step at ${node.id}`);
        }
      }
    }
  }
  // And each documented singleton IS a singleton wayside on every seed (the pin is
  // exhaustive in both directions).
  for (let act = 1; act <= 2; act += 1) {
    for (const id of STRUCTURAL[act]) {
      for (let seed = 0; seed < SEEDS; seed += 1) {
        const { rows } = generateMap(seed, 0, act);
        const node = findNode(rows, id);
        const targets = node.next.map((n) => findNode(rows, n));
        assert.equal(targets.length, 1, `act ${act} seed ${seed}: ${id} has a one-edge band`);
        assert.equal(targets[0].type, 'event', `act ${act} seed ${seed}: ${id}'s only step is the wayside`);
      }
    }
  }
});

test('a legacy save carries its own full-linked map and keeps blood_tithe the whole next row', () => {
  // Rebuild the pre-Part-A map exactly as an old save stores it (a fresh map object —
  // the kernel freezes its states) and read the offers from it: availableNodes walks
  // the STORED edges, so nothing relinks and no new field is needed.
  for (const seed of [0, 1, 7, 11, 59]) {
    const s = newRun({ seed });
    const legacyRows = s.map.rows.map((row, r) =>
      (r + 1 < s.map.rows.length
        ? row.map((n) => ({ ...n, next: s.map.rows[r + 1].map((m) => m.id) }))
        : row.map((n) => ({ ...n, next: [] }))));
    const state = { ...s, phase: 'map', floor: 1, mapNodeId: 'r1n0', map: { rows: legacyRows, encounterTable: s.map.encounterTable } };
    const offered = legalActions(state).filter((a) => a.kind === 'travel').map((a) => a.nodeId).sort();
    const wholeRow = legacyRows[2].map((n) => n.id).sort();
    assert.deepEqual(offered, wholeRow, `seed ${seed}: the full-linked map still offers the whole next row`);
  }
});
