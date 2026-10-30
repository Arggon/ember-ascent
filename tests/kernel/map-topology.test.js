// UX-5 Part A — the REAL path topology: the band edge rule and its guarantees.
//
// The map's edge rule (rules/map.js generateMap): node i of row r connects to the
// band j ∈ {i−1, i, i+1} ∩ next-row width — the classic StS ladder. "Choosing one
// step still allows the player to choose ALL the next steps" was the complaint; the
// band is what makes a row's rewards mutually exclusive per run, which is the point.
// This file pins the guarantees the rule must keep, per seed, over BOTH acts:
//   * the band shape itself (no edge leaves the ±1 ladder; every edge lands in the
//     real next row);
//   * reachability from the ENTRY composes: every node of every row is reachable
//     from some node of the row before it, the entry row is offered whole at the
//     start, therefore EVERY placed node (act 1's shop r5n1, events r2n1/r6n1; act
//     2's shop r4n1, events r3n1/r5n2) is reachable on every seed — the map view
//     and availableNodes walk the stored edges, so an unreachable node would be a
//     dead promise the player could never collect;
//   * the boss is reachable from the row before it (no impossible climb — a hard
//     fail, not a soft warning);
//   * no dead ends: every non-boss node has at least one outgoing edge;
//   * the kernel's own action list (legalActions → availableNodes) offers exactly
//     the current node's band — the player is never offered a node the edges do
//     not reach, and the first-travel walker still passes the waysides (neither
//     placed slot is its row's first node, and no band forces the event);
//   * a LEGACY save carries its own full-linked map and keeps offering the whole
//     next row — the stored edges are read, no new field, nothing relinked.
// 60 seeds × 2 acts, asserted with the seed named in every message.
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateMap, findNode, ROWS } from '../../src/kernel/rules/map.js';
import { newRun, step } from '../../src/kernel/index.js';
import { beginNextAct } from '../../src/kernel/rules/act.js';
import { actions as legalActions } from '../../src/kernel/actions.js';

const SEEDS = 60;

/** The band shape: every edge of every node is a real ±1 ladder edge into the next
 *  row — except the documented SUMMIT CONVERGENCE into a 1-wide row (the boss), which
 *  links from every slot, because slot 2's band {1,2,3} ∩ {0} would otherwise strand
 *  the rightmost node a step below the warden. */
function assertBandShape(rows, act, seed) {
  for (let r = 0; r + 1 < rows.length; r += 1) {
    const nextRow = rows[r + 1];
    rows[r].forEach((node, k) => {
      assert.ok(node.next.length >= 1, `act ${act} seed ${seed}: ${node.id} has an outgoing edge (no dead ends)`);
      for (const id of node.next) {
        const j = nextRow.findIndex((n) => n.id === id);
        assert.ok(j !== -1, `act ${act} seed ${seed}: ${node.id} -> ${id} lands in the real next row`);
        if (nextRow.length === 1) {
          assert.equal(id, nextRow[0].id, `act ${act} seed ${seed}: ${node.id} converges on the single summit node`);
        } else {
          assert.ok(Math.abs(j - k) <= 1, `act ${act} seed ${seed}: ${node.id} (slot ${k}) -> ${id} (slot ${j}) stays in the ±1 band`);
        }
      }
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

test('the band rule: ±1 ladder edges, no dead ends, over 60 seeds x both acts', () => {
  for (let act = 1; act <= 2; act += 1) {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const { rows } = generateMap(seed, 0, act);
      assert.equal(rows.length, ROWS, `act ${act} seed ${seed}: the row count is the format's`);
      assertBandShape(rows, act, seed);
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
    }
  }
});

test('the kernel offers exactly the current node band, and no band forces a wayside', () => {
  for (let act = 1; act <= 2; act += 1) {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const { rows } = generateMap(seed, 0, act);
      for (let r = 0; r + 1 < rows.length; r += 1) {
        for (const node of rows[r]) {
          const state = standingOn(seed, act, node.id);
          const travels = legalActions(state).filter((a) => a.kind === 'travel');
          assert.deepEqual(travels.map((a) => a.nodeId).sort(), [...node.next].sort(),
            `act ${act} seed ${seed}: at ${node.id} the kernel offers exactly the stored band`);
          assert.ok(!(travels.length === 1 && travels[0].nodeType === 'event'),
            `act ${act} seed ${seed}: a walker at ${node.id} is never forced into a wayside`);
          // Every offered id is a legal step: the first one travels without error.
          const out = step(state, travels[0].id);
          assert.equal(out.error, null, `act ${act} seed ${seed}: the band's first travel is a legal step at ${node.id}`);
        }
      }
    }
  }
});

test('a legacy save carries its own full-linked map and keeps offering the whole next row', () => {
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
