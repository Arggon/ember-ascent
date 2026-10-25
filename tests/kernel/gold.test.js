// S3 gold economy: the purse, the per-tier victory grants, and the accounting around them.
//
// Pins:
//   - newRun starts the purse at 99 (StS parity) and gold is run state (it is hash input).
//   - Every combat tier pays inside its range, from ONE seeded draw (flat boss pays 100
//     and consumes ZERO draws); rngDraws advances by exactly the draws consumed.
//   - Same seed + tier => same gold; different seeds spread across the range.
//   - The grant happens exactly ONCE per victory — the victory path runs once, and a
//     re-observe of the reward/map state can never re-enter it.
//   - A pre-gold save (no player.gold) loads cleanly and reads as an empty purse; when
//     gold IS present it must be an integer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel } from '../helpers/harness.mjs';
import { begin, submit, legal, runHash, saveObject, loadObject } from '../../src/surface/session.js';
import { resolveVictory, REWARD_CHOICES } from '../../src/kernel/rules/act.js';
import { NODE_TYPES } from '../../src/kernel/rules/map.js';
import { intAt, pickAt } from '../../src/kernel/rng.js';

const K = await loadKernel();
const { newRun, step, observe, snapshot, hash, validateSave } = K;

/** A minimal won-combat state for resolveVictory: enough map for the reward lookup.
 *  `rewardOverride` swaps the node's table reward (the 'heal' branch returns BEFORE the
 *  card-reward roll, which is what isolates the gold draw from the offer's draws). */
function wonState(over = {}) {
  const base = newRun({ seed: over.seed ?? 7 });
  const reward = over.rewardOverride ?? 'card';
  return {
    ...base,
    rngDraws: over.rngDraws ?? 500,
    player: { ...base.player, ...(over.player ?? {}) },
    combat: {
      ...base.combat,
      active: true,
      nodeId: 'r0n0',
      nodeType: over.nodeType ?? 'combat_weak',
      turn: 3,
      enemies: [],
    },
    map: { ...base.map, encounterTable: { ...base.map.encounterTable, r0n0: { ...base.map.encounterTable.r0n0, reward } } },
  };
}

test('a new run opens with 99 gold and the purse is run state (hash input)', () => {
  const s = newRun({ seed: 7 });
  assert.equal(s.player.gold, 99);
  assert.ok(Number.isInteger(s.player.gold));
  // Same construction => same hash; a different purse => a different run identity.
  assert.equal(hash(s), hash(newRun({ seed: 7 })));
  const richer = { ...s, player: { ...s.player, gold: 150 } };
  assert.notEqual(hash(richer), hash(s), 'gold is part of the hashed state');
  // The header and the snapshot both publish it.
  assert.match(observe(s), /\bGOLD 99\b/);
  assert.equal(snapshot(s).player.gold, 99);
});

test('each combat tier pays inside its range from exactly one seeded draw', () => {
  const cases = [
    ['combat_weak', NODE_TYPES.combat_weak.gold],
    ['combat_strong', NODE_TYPES.combat_strong.gold],
    ['elite', NODE_TYPES.elite.gold],
  ];
  for (const [tier, [lo, hi]] of cases) {
    const s = wonState({ nodeType: tier });
    const out = resolveVictory(s, null);
    const gold = out.events.find((e) => e.t === 'gold');
    assert.ok(gold, `${tier}: a gold event is emitted`);
    assert.deepEqual(
      { who: gold.who, source: gold.source, amount: gold.amount },
      { who: 'player', source: tier, amount: out.state.player.gold - s.player.gold },
      `${tier}: the event names the payer and the exact amount`,
    );
    assert.ok(gold.amount >= lo && gold.amount <= hi, `${tier}: ${gold.amount} within [${lo}, ${hi}]`);
    // The grant IS the seeded draw it claims to be: value == lo + intAt(seed, counter, span).
    assert.equal(gold.amount, lo + intAt(s.seed, s.rngDraws, hi - lo + 1),
      `${tier}: the amount is intAt at the pre-grant counter`);
    // Isolated accounting: the 'heal' branch returns BEFORE the card-reward roll, so the
    // whole rngDraws delta there is the gold draw alone — exactly one.
    const restOnly = resolveVictory(wonState({ nodeType: tier, rewardOverride: 'heal' }), null);
    assert.equal(restOnly.state.rngDraws - s.rngDraws, 1, `${tier}: exactly one draw consumed`);
    // And the card reward rolls from the counter AFTER the grant, so the grant is part
    // of the format the offer is reproducible from. Elites draw one extra card, exactly
    // as resolveVictory computes the offer size.
    assert.equal(out.state.phase, 'reward', `${tier}: the fight hands over to the reward`);
    assert.equal(out.state.reward.gold, gold.amount, `${tier}: the reward carries the spoils for the "+N" line`);
    const offerCount = REWARD_CHOICES + (tier === 'elite' ? 1 : 0);
    assert.deepEqual(
      out.state.reward.cards,
      pickAt(s.seed, s.rngDraws + 1, s.draftPool, offerCount).picked,
      `${tier}: the offer reads the post-grant counter`,
    );
    assert.match(observe(out.state), new RegExp(`spoils \\+${gold.amount} gold \\(purse ${out.state.player.gold}\\)`));
  }
});

test('the boss pays a flat 100 before the run ends, consuming no draw', () => {
  const s = wonState({ nodeType: 'boss', player: { gold: 42 } });
  const out = resolveVictory(s, null);
  const gold = out.events.find((e) => e.t === 'gold');
  assert.deepEqual(gold, { t: 'gold', who: 'player', amount: 100, source: 'boss' });
  assert.equal(out.state.player.gold, 142, 'the grant lands on the purse');
  assert.equal(out.state.rngDraws, s.rngDraws, 'a flat tier rolls nothing: zero draws consumed');
  assert.equal(out.state.phase, 'ended', 'the boss grant happens BEFORE the flip to ended');
  assert.equal(out.state.outcome, 'win');
  assert.match(observe(out.state), /gold 142/);
  assert.equal(snapshot(out.state).player.gold, 142);
});

test('same seed and tier pay the same gold; different seeds spread the range', () => {
  const grant = (seed, rngDraws) => {
    // The 'heal' branch returns before the card-reward roll, so `draws` is the gold
    // draw alone.
    const out = resolveVictory(wonState({ seed, rngDraws, rewardOverride: 'heal' }), null);
    return { amount: out.state.player.gold - 99, draws: out.state.rngDraws - rngDraws };
  };
  for (const rngDraws of [100, 900]) {
    assert.deepEqual(grant(7, rngDraws), grant(7, rngDraws), 'same seed => same grant');
  }
  const [lo, hi] = NODE_TYPES.combat_weak.gold;
  const seen = new Set();
  for (let seed = 0; seed < 40; seed += 1) {
    const g = grant(seed, 12345);
    assert.equal(g.draws, 1, 'every ranged grant consumes exactly one draw');
    assert.ok(g.amount >= lo && g.amount <= hi);
    seen.add(g.amount);
  }
  assert.ok(seen.size >= 3, `40 seeds must spread across [${lo}, ${hi}] (saw ${[...seen].join(', ')})`);
});

test('a real fight grants gold exactly once across the victory transition', () => {
  // Greedy drive into the first fight and win it through the public step(): the grant
  // is emitted by the SAME step that flips combat->reward, and nothing after it —
  // re-observes, rejections, the skip, the next travel — can add a second one.
  let s = begin({ seed: 7 });
  const before = s.state.player.gold;
  let goldEvents = 0;
  for (let g = 0; g < 80 && s.state.phase !== 'reward'; g += 1) {
    const L = legal(s).map((a) => a.id);
    const pick = L.find((i) => /^p\d+(_1)?$/.test(i)) || L.find((i) => i === 'e1') || L.find((i) => /^n/.test(i)) || L[0];
    s = submit(s, pick).session;
    goldEvents += (s.events || []).filter((e) => e.t === 'gold').length;
  }
  assert.equal(s.state.phase, 'reward', 'seed 7 reaches its first reward');
  assert.equal(goldEvents, 1, 'exactly one gold event across the whole transition');
  assert.equal(s.state.reward.gold, s.state.player.gold - before, 'the reward carries the grant');
  assert.ok(s.state.player.gold > before, 'the purse grew');

  const settled = runHash(s);
  // Re-observing the same state (what a second `state` command does) neither moves the
  // run nor pays again.
  observe(s.state);
  snapshot(s.state);
  assert.equal(runHash(s), settled, 'a re-observe is read-only');

  // Skip the reward and travel on: the purse only moves at the NEXT victory.
  s = submit(s, 's0').session;
  assert.equal(s.state.phase, 'map');
  const purse = s.state.player.gold;
  const travel = submit(s, 'n1');
  s = travel.session;
  assert.equal(s.state.phase, 'combat');
  assert.equal(s.state.player.gold, purse, 'entering a fight pays nothing');
  // The travel step's OWN events (the session's stream accumulates the victory's grant).
  assert.ok(!travel.events.some((e) => e.t === 'gold'), 'no gold event outside the victory path');
});

test('a pre-gold save loads cleanly and reads as an empty purse', () => {
  const save = JSON.parse(JSON.stringify(saveObject(begin({ seed: 7 }))));
  delete save.state.player.gold; // what a v0.3 pre-S3 save looks like
  assert.deepEqual(validateSave(save), [], 'a save without player.gold still validates');
  const res = loadObject(save);
  assert.equal(res.ok, true, `the legacy save loads: ${JSON.stringify(res.problems ?? [])}`);
  assert.equal(observe(res.session.state).includes('GOLD 0'), true, 'the dump reads an empty purse, not undefined');
  assert.equal(snapshot(res.session.state).player.gold, 0);
  // And the rules tolerate it: a victory on a legacy state grants from zero.
  const out = resolveVictory(wonState({ player: { gold: undefined } }), null);
  const gold = out.events.find((e) => e.t === 'gold');
  assert.equal(out.state.player.gold, gold.amount, 'undefined purse + grant == the grant');
});

test('a save whose gold is not an integer is refused', () => {
  const save = JSON.parse(JSON.stringify(saveObject(begin({ seed: 7 }))));
  save.state.player.gold = 'lots';
  assert.ok(
    validateSave(save).some((p) => p.includes('gold')),
    'validateSave names the bad purse',
  );
});

test('a negative purse is refused (S3 review P3 — spending makes debt a real state)', () => {
  // validateSave names it, and the loader refuses the whole save.
  const save = JSON.parse(JSON.stringify(saveObject(begin({ seed: 7 }))));
  save.state.player.gold = -5;
  assert.ok(
    validateSave(save).some((p) => p.includes('"gold" must not be negative')),
    `validateSave names the debt: ${JSON.stringify(validateSave(save))}`,
  );
  assert.equal(loadObject(save).ok, false, 'a save in debt does not load');
  // The engine can never mint one either: the shop only deducts a price the purse
  // was proven to cover (rules/steps.js buyOffer) — at 10 gold nothing is buyable.
  const base = newRun({ seed: 3 });
  const inShop = step({ ...base, floor: 4, mapNodeId: 'r4n0', player: { ...base.player, gold: 10 } }, 'n2').state;
  assert.equal(inShop.player.gold, 10);
  for (const o of inShop.shop.offers) assert.ok(o.price > inShop.player.gold);
  const forced = step(inShop, 'b1');
  assert.equal(forced.error?.code, 2, 'no b<n> exists at 10 gold — the id is the R6 rejection');
});

test('gold is granted through the public step on the kill, and the grant is in the events stream', () => {
  // A Maul-only deck: the second 32-damage swing ends the opening fight, so a played
  // card wins the combat and the winning step is the step that pays — the same single
  // resolveVictory path the end-turn victory takes. S4 note: the map draw shifted (the
  // shop now owns row 5's middle slot), so seed 2 opens on Twin Mites; every play is
  // aimed at the first living enemy, which is what a real player's clicks do.
  const aim = (st) => (st.combat.enemies.filter((e) => !e.dead).length > 1 ? '_1' : '');
  const base = newRun({ seed: 2 });
  const boosted = { ...base, deck: Array.from({ length: 10 }, (_, i) => ({ uid: `g${i}`, cardId: 'bludgeon' })) };
  let s = step(boosted, 'n1').state;
  const events = [];
  let out = step(s, `p1${aim(s)}`);
  events.push(...out.events);
  s = out.state;
  for (let g = 0; g < 40 && s.phase === 'combat'; g += 1) {
    out = step(s, 'e1');
    events.push(...out.events);
    s = out.state;
    if (s.phase !== 'combat') break;
    const playable = (s.combat.hand ?? []).findIndex((c) => c.cost <= s.player.energy);
    if (playable >= 0) {
      out = step(s, `p${playable + 1}${aim(s)}`);
      events.push(...out.events);
      s = out.state;
    }
  }
  assert.equal(s.phase, 'reward', 'the fight resolves into the reward');
  const gold = events.filter((e) => e.t === 'gold');
  assert.equal(gold.length, 1, 'exactly one grant in the whole event stream');
  assert.equal(s.player.gold, 99 + gold[0].amount, 'the purse holds exactly the grant');
  assert.equal(s.reward.gold, gold[0].amount, 'the reward carries the same spoils');
});
