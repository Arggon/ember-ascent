// S5 potions: the belt, the seeded drops, the quaff/discard actions, and the accounting
// around them.
//
// Pins:
//   - The roster is 6 fixed potions; exactly one targets (Ember Draught, aimed q<n>_<k>
//     when 2+ enemies live, mirroring p<n>_<k>); every other potion is unaimed.
//   - The drop rolls ONCE per won fight (weak/strong/elite; never the boss), by the
//     band convention: the drop hits iff intAt(seed, counter, 100) < DROP_CHANCE[tier] —
//     the LOWEST `chance` of 100 equally likely values. A hit picks the potion id with
//     ONE more uniform draw over the roster.
//   - Draw accounting: miss = exactly 1 draw, hit = exactly 2, FULL BELT = 0 (the roll
//     is suppressed — a 4th potion is impossible and free), boss = 0, quaff = 0,
//     discard = 0. The reward offer reads the counter AFTER the drop.
//   - Quaff effects are exact per potion, through the shared verbs (Vulnerable
//     amplifies Ember Draught, Dexterity boosts Stone Skin, the energy event is THE
//     energy event); both slot actions consume exactly the slot and nothing else.
//   - Belt actions exist in `phase === 'combat'` ONLY; forcing their ids elsewhere is
//     the one R6 rejection.
//   - A stale belt id (validateSave never checks potion ids) degrades: raw id as the
//     name, a discard offered, never a quaff (the S4.1 enumeration-mirrors-guard rule),
//     nothing throws. A legacy save without the field reads as an empty belt.
//   - A real run that drops a potion and quaffs it replays hash-for-hash through the
//     same log machinery every other run does (the S4 precedent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, content as contentFixture } from '../helpers/harness.mjs';
import { begin, submit, legal, renderLog, parseLog, assertReplay, runHash } from '../../src/surface/session.js';
import { makePolicy } from '../../src/surface/policies.js';
import {
  POTIONS, POTION_DEFS, POTION_SLOTS, DROP_CHANCE, potionDef, rollPotionDrop,
} from '../../src/kernel/rules/potions.js';
import { resolveVictory } from '../../src/kernel/rules/act.js';
import { intAt, pickAt } from '../../src/kernel/rng.js';

const K = await loadKernel();
const { newRun, step, actions, observe, snapshot, hash, validateSave } = K;
const C = await contentFixture();

/* ------------------------------------------------------------------ fixtures -- */

/** A minimal won-combat state for resolveVictory, the gold.test fixture with a belt. */
function wonState(over = {}) {
  const base = newRun({ seed: over.seed ?? 7 });
  const reward = over.rewardOverride ?? 'card';
  return {
    ...base,
    ...(over.state ?? {}),
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

/** A staged two-enemy combat with a controlled belt; every number the quaff math reads
 *  is pinned, so each per-potion delta below is a fact rather than an observation. */
function beltCombat(belt, over = {}) {
  const base = newRun({ seed: over.seed ?? 5 });
  const s = {
    ...base,
    phase: 'combat',
    potions: belt,
    player: { ...base.player, hp: over.hp ?? 40, maxHp: over.maxHp ?? 60, energy: over.energy ?? 3, block: 0, statuses: { ...(over.statuses ?? {}) } },
    combat: {
      ...base.combat,
      active: true,
      nodeId: 'r2n0',
      nodeType: over.nodeType ?? 'combat_weak',
      turn: 1,
      enemies: (over.hps ?? [40]).map((hp, i) => ({
        id: 'jaw_worm', index: i, name: `Worm ${i}`, hp, maxHp: 44,
        block: over.enemyBlock ?? 0, statuses: { ...(over.enemyStatuses ?? {}) },
        moveIndex: 0, moveHistory: [], intentStep: 0, dead: false,
      })),
      draw: [], hand: [], discard: [], exhaust: [],
    },
  };
  return s;
}

/* --------------------------------------------------------------------- table -- */

test('the roster: 6 fixed potions, one aimed, documented bands, one constant table', () => {
  assert.equal(POTIONS.length, 6);
  assert.equal(new Set(POTIONS.map((p) => p.id)).size, 6, 'ids are unique');
  for (const p of POTIONS) {
    assert.ok(p.name.length > 0 && p.text.length > 0 && p.summary.length > 0, `${p.id} names and describes itself`);
    assert.ok(POTION_DEFS.get(p.id) === p, 'the lookup resolves every row');
    assert.ok(potionDef(p.id), 'potionDef resolves it too');
  }
  assert.equal(potionDef('no_such_flask'), undefined, 'an unknown id resolves to undefined, never a throw');
  assert.deepEqual(
    POTIONS.filter((p) => p.target === 'enemy').map((p) => p.id),
    ['ember_draught'],
    'exactly one potion takes an aim',
  );
  assert.equal(POTION_SLOTS, 3, 'three slots, StS parity');
  assert.deepEqual({ ...DROP_CHANCE }, { combat_weak: 40, combat_strong: 40, elite: 60 }, 'one tier table, boss absent');
});

/* -------------------------------------------------------------- drop mechanics -- */

test('the band convention: a drop happens iff the d100 lands below the tier chance', () => {
  // The convention IS the pin: for every seed, resolveVictory's drop must be exactly
  // `intAt(seed, counter, 100) < chance`, read at the pre-drop counter. The heal branch
  // isolates the counter (gold 1 draw, then the potion rolls), so the counter here is
  // rngDraws + 1 after the gold grant.
  for (let seed = 0; seed < 120; seed += 1) {
    const s = wonState({ seed, rngDraws: 500 + seed, rewardOverride: 'heal' });
    const out = resolveVictory(s, null);
    const dropped = (out.state.potions ?? []).length > 0;
    const counter = s.rngDraws + 1; // the gold draw sits between the start and the roll
    assert.equal(dropped, intAt(s.seed, counter, 100) < DROP_CHANCE.combat_weak, `seed ${seed}: the band decides`);
  }
});

test('drop rates sit at their tiers across seeds: 40 / 40 / 60 percent, boss never', () => {
  const rates = {};
  for (const tier of ['combat_weak', 'combat_strong', 'elite']) {
    let drops = 0;
    const N = 400;
    for (let seed = 0; seed < N; seed += 1) {
      const out = resolveVictory(wonState({ seed, rngDraws: 500, nodeType: tier, rewardOverride: 'heal' }), null);
      if ((out.state.potions ?? []).length > 0) drops += 1;
    }
    rates[tier] = drops / N;
  }
  // Loose binomial bounds (5-sigma-ish at N=400): the exact convention is pinned above,
  // these only catch a silently wrong constant.
  assert.ok(rates.combat_weak > 0.25 && rates.combat_weak < 0.55, `weak drop rate ${rates.combat_weak} near 40%`);
  assert.ok(rates.combat_strong > 0.25 && rates.combat_strong < 0.55, `strong drop rate ${rates.combat_strong} near 40%`);
  assert.ok(rates.elite > 0.45 && rates.elite < 0.75, `elite drop rate ${rates.elite} near 60%`);
  assert.ok(rates.elite > rates.combat_weak, 'the elite tier outrates the fight tiers');
  // The boss is short-circuited before the drop: no potion, no draw, run ends.
  const boss = resolveVictory(wonState({ nodeType: 'boss' }), null);
  assert.equal(boss.state.phase, 'ended');
  assert.deepEqual(boss.state.potions, [], 'the boss never rolls');
});

test('draw accounting: miss = 1, hit = 2, full belt = 0, and the offer reads the post-drop counter', () => {
  // Split seeds into hits and misses at the isolated heal branch (gold: 1 draw).
  const hit = [];
  const miss = [];
  for (let seed = 0; seed < 60; seed += 1) {
    const s = wonState({ seed, rngDraws: 500, rewardOverride: 'heal' });
    const out = resolveVictory(s, null);
    ((out.state.potions ?? []).length > 0 ? hit : miss).push(seed);
  }
  assert.ok(hit.length > 5 && miss.length > 5, `both bands populated (${hit.length} hits / ${miss.length} misses)`);
  for (const seed of miss) {
    const out = resolveVictory(wonState({ seed, rngDraws: 500, rewardOverride: 'heal' }), null);
    assert.equal(out.state.rngDraws - 500, 1 + 1, `seed ${seed}: gold + one missed drop roll`);
  }
  for (const seed of hit.slice(0, 10)) {
    const out = resolveVictory(wonState({ seed, rngDraws: 500, rewardOverride: 'heal' }), null);
    assert.equal(out.state.rngDraws - 500, 1 + 2, `seed ${seed}: gold + drop roll + pick roll`);
    assert.equal(out.state.potions.length, 1);
    assert.ok(POTION_DEFS.has(out.state.potions[0]), 'the belt holds a known id');
  }

  // FULL BELT: the roll is suppressed — zero draws, no event, belt untouched.
  const full = wonState({ seed: hit[0], rngDraws: 500, rewardOverride: 'heal', state: { potions: ['stone_skin', 'ash_salts', 'bellows_fuel'] } });
  const out = resolveVictory(full, null);
  assert.equal(out.state.rngDraws - 500, 1, 'a full belt consumes nothing beyond the gold');
  assert.deepEqual(out.state.potions, ['stone_skin', 'ash_salts', 'bellows_fuel'], 'the belt is unchanged');
  assert.equal(out.events.some((e) => e.t === 'potion_drop'), false, 'no drop event either');

  // The card offer reads the counter AFTER the drop: gold(1 draw) + potion(0 or 2), the
  // same "the grant is part of the format" ruling the gold test pinned for gold alone.
  const missOut = resolveVictory(wonState({ seed: miss[0], rngDraws: 500 }), null);
  assert.deepEqual(
    missOut.state.reward.cards,
    pickAt(missOut.state.seed, 500 + 1 + 1, missOut.state.draftPool, 3).picked,
    'a missed drop leaves the offer one drop-roll later',
  );
  const hitOut = resolveVictory(wonState({ seed: hit[0], rngDraws: 500 }), null);
  assert.deepEqual(
    hitOut.state.reward.cards,
    pickAt(hitOut.state.seed, 500 + 1 + 2, hitOut.state.draftPool, 3).picked,
    'a landed drop leaves the offer two drop draws later',
  );
});

test('the dropped potion id is a uniform pick over the roster (loose bounds)', () => {
  const counts = new Map(POTIONS.map((p) => [p.id, 0]));
  let hits = 0;
  for (let seed = 0; seed < 600 && hits < 200; seed += 1) {
    const out = resolveVictory(wonState({ seed, rngDraws: 500, rewardOverride: 'heal' }), null);
    const p = (out.state.potions ?? [])[0];
    if (!p) continue;
    counts.set(p, counts.get(p) + 1);
    hits += 1;
  }
  assert.ok(hits >= 100, `enough hits to judge (${hits})`);
  for (const [id, n] of counts) {
    assert.ok(n > 0, `${id} appears at least once (${n}/${hits})`);
    assert.ok(n / hits < 0.4, `${id} share ${n}/${hits} stays loose-bounded below 40%`);
  }
});

test('rollPotionDrop is pure on a legacy state: no potions field reads as an empty belt', () => {
  const base = { ...newRun({ seed: 9 }), potions: undefined };
  const out = rollPotionDrop(base, 'combat_weak');
  assert.ok(Array.isArray(out.belt), 'the belt is an array, not undefined');
  assert.ok([0, 1, 2].includes(out.draws));
  delete base.potions;
  const out2 = rollPotionDrop(base, 'combat_weak');
  assert.deepEqual(out2, out, 'absent field and undefined field agree');
});

/* ------------------------------------------------------------- quaff effects -- */

test('Ember Draught: the damage verb, exactly — 20 raw, Vulnerable amplifies, block absorbs', () => {
  // Plain: 40 -> 20.
  const plain = step(beltCombat(['ember_draught']), 'q1');
  assert.equal(plain.error, null);
  assert.equal(plain.state.combat.enemies[0].hp, 20);
  assert.deepEqual(plain.state.potions, [], 'the slot is consumed');
  const dealt = plain.events.find((e) => e.t === 'damage');
  assert.deepEqual({ raw: dealt.raw, dealt: dealt.dealt, blocked: dealt.blocked }, { raw: 20, dealt: 20, blocked: 0 });
  assert.equal(plain.events.some((e) => e.t === 'potion_quaffed' && e.potion === 'ember_draught'), true);

  // Vulnerable 2 on the enemy: the shared verb amplifies (floor 20 * 3 / 2 = 30).
  const vuln = step(beltCombat(['ember_draught'], { enemyStatuses: { vulnerable: 2 } }), 'q1');
  assert.equal(vuln.state.combat.enemies[0].hp, 10);

  // Enemy block 8: 8 absorbed, 12 through — damageEnemy's own math, unchanged.
  const blocked = step(beltCombat(['ember_draught'], { enemyBlock: 8 }), 'q1');
  assert.equal(blocked.state.combat.enemies[0].hp, 28);
  assert.equal(blocked.state.combat.enemies[0].block, 0);

  // Strength is NOT added: potions are not attacks, the verb reads the PLAYER's
  // strength... it does (the verb is shared) — so pin what the reuse really means:
  // a Whetstone'd player's Ember Draught hits harder, exactly like a card would.
  const strong = step(beltCombat(['ember_draught'], { statuses: { strength: 3 } }), 'q1');
  assert.equal(strong.state.combat.enemies[0].hp, 17, 'player Strength flows through the shared verb');
});

test('Ember Draught aims: q1_2 hits the second LIVING enemy, q1 falls to the first', () => {
  const two = beltCombat(['ember_draught'], { hps: [40, 40] });
  assert.deepEqual(
    actions(two).filter((a) => a.kind === 'quaff').map((a) => a.id),
    ['q1_1', 'q1_2'],
    'two living enemies: the aimed forms are the only quaffs',
  );
  const out = step(two, 'q1_2');
  assert.deepEqual([out.state.combat.enemies[0].hp, out.state.combat.enemies[1].hp], [40, 20], 'the second worm took the hit');

  const one = beltCombat(['ember_draught'], { hps: [40] });
  assert.deepEqual(actions(one).filter((a) => a.kind === 'quaff').map((a) => a.id), ['q1'], 'one living enemy: plain q1');
  assert.equal(step(one, 'q1').state.combat.enemies[0].hp, 20);
});

test('Stone Skin, Bellows Fuel, Whetstone: the shared verbs, numbers exact', () => {
  const s = beltCombat(['stone_skin', 'bellows_fuel', 'whetstone'], { energy: 3 });
  let r = step(s, 'q1');
  assert.equal(r.state.player.block, 12, 'Stone Skin: +12 block, no Dexterity');
  r = step(r.state, 'q1'); // the belt shifted: slot 1 is now Bellows Fuel
  assert.equal(r.state.player.energy, 5, 'Bellows Fuel: +2 energy, THE energy event');
  assert.ok(r.events.some((e) => e.t === 'energy' && e.amount === 2));
  r = step(r.state, 'q1');
  assert.equal(r.state.player.statuses.strength, 2, 'Whetstone: +2 Strength this combat');

  // The verb reuse is real, not cosmetic: Dexterity boosts the potion's block exactly
  // as it boosts a card's, and the strength lasts into the player's attacks.
  const dex = beltCombat(['stone_skin'], { statuses: { dexterity: 2 } });
  assert.equal(step(dex, 'q1').state.player.block, 14, 'Dexterity flows through the shared block verb');
});
test('Ash Salts: 20% of max HP floored, capped at the max, silent at full HP', () => {
  const hurt = step(beltCombat(['ash_salts'], { hp: 40, maxHp: 60 }), 'q1');
  assert.equal(hurt.state.player.hp, 52, 'floor(60 * 0.2) = 12');
  const heal = hurt.events.find((e) => e.t === 'heal');
  assert.deepEqual({ who: heal.who, amount: heal.amount, source: heal.source }, { who: 'player', amount: 12, source: 'potion' });
  // Odd max: 45 * 0.2 = 9 exactly; use 43 -> floor(8.6) = 8.
  const odd = step(beltCombat(['ash_salts'], { hp: 30, maxHp: 43 }), 'q1');
  assert.equal(odd.state.player.hp, 38, 'integers only, rounded down');
  const capped = step(beltCombat(['ash_salts'], { hp: 55, maxHp: 60 }), 'q1');
  assert.equal(capped.state.player.hp, 60, 'never above the max');
  assert.equal(capped.events.filter((e) => e.t === 'heal').length, 1);
  const full = step(beltCombat(['ash_salts'], { hp: 60, maxHp: 60 }), 'q1');
  assert.equal(full.state.player.hp, 60);
  assert.equal(full.events.some((e) => e.t === 'heal'), false, 'healing 0 emits nothing');
});

test('Purge Flask: debuffs go, buffs stay', () => {
  const s = beltCombat(['purge_flask'], { statuses: { vulnerable: 2, weak: 1, strength: 3, dexterity: 1, metallicize: 2 } });
  const out = step(s, 'q1');
  assert.deepEqual(out.state.player.statuses, { strength: 3, dexterity: 1, metallicize: 2 });
  const cleared = out.events.find((e) => e.t === 'status_cleared');
  assert.deepEqual(cleared.statuses, ['vulnerable', 'weak']);
  // Nothing to clear: a clean no-op event, slot still spent.
  const clean = step(beltCombat(['purge_flask']), 'q1');
  assert.equal(clean.events.some((e) => e.t === 'status_cleared'), false);
  assert.deepEqual(clean.state.potions, []);
});

/* --------------------------------------------------- slot economy and settle -- */

test('both slot actions consume exactly the slot; discard moves nothing else, zero draws', () => {
  const s = beltCombat(['ember_draught', 'stone_skin', 'ash_salts']);
  const before = { hp: s.player.hp, energy: s.player.energy, block: s.player.block, rng: s.rngDraws, step: s.stepIndex };
  const d = step(s, 'd2');
  assert.equal(d.error, null);
  assert.deepEqual(d.state.potions, ['ember_draught', 'ash_salts'], 'slot 2 freed, order kept');
  assert.equal(d.state.player.hp, before.hp);
  assert.equal(d.state.player.energy, before.energy);
  assert.equal(d.state.player.block, before.block);
  assert.equal(d.state.rngDraws, before.rng, 'a discard consumes ZERO draws');
  assert.deepEqual(d.events, [{ t: 'potion_discarded', slot: 2, potion: 'stone_skin' }]);

  // The quaff path consumes the slot too — and shifting is honest: after spending slot
  // 1 the belt re-numbers, and a fresh actions() enumerates the new belt.
  let next = step(s, 'q1').state;
  assert.deepEqual(next.potions, ['stone_skin', 'ash_salts']);
  const L = actions(next);
  assert.deepEqual(L.filter((a) => a.kind === 'discard_potion').map((a) => a.id), ['d1', 'd2']);
  assert.equal(L.find((a) => a.id === 'd3'), undefined, 'a 2-slot belt offers no d3');
  assert.equal(next.rngDraws, before.rng, 'a quaff consumes ZERO draws');
});

test('a killing quaff settles victory through the ONE path, drop included, in that order', () => {
  const s = beltCombat(['ember_draught'], { hps: [12] });
  const out = step(s, 'q1');
  assert.equal(out.error, null);
  assert.equal(out.state.phase, 'reward', 'the kill resolved the fight');
  assert.equal(out.events.filter((e) => e.t === 'combat_won').length, 1, 'combat_won emitted (DR-6)');
  // The victory's own drop rolled AFTER the quaff: the same step can end the fight and
  // refill the belt (gold granted too, same fixed per-victory order).
  assert.ok(out.state.potions.length <= 1);
  assert.ok(out.events.some((e) => e.t === 'gold'));
  const drop = out.events.find((e) => e.t === 'potion_drop');
  if (drop) assert.equal(out.state.potions.length, 1);
});

/* ------------------------------------------------------------- combat-only ids -- */

test('belt actions exist in combat ONLY; forcing the ids elsewhere is the R6 rejection', () => {
  const belted = { ...newRun({ seed: 3 }), potions: ['stone_skin', 'ash_salts'] };
  for (const phase of ['map', 'rest', 'ended']) {
    const s = { ...belted, phase };
    assert.equal(actions(s).some((a) => a.kind === 'quaff' || a.kind === 'discard_potion'), false, `${phase}: no belt actions`);
  }
  // The reward phase carries an open offer, as a real one always does.
  const rewardPhase = { ...belted, phase: 'reward', reward: { cards: ['strike'], taken: null, gold: 12 } };
  assert.equal(actions(rewardPhase).some((a) => a.kind === 'quaff' || a.kind === 'discard_potion'), false, 'reward: no belt actions');
  const mapPhase = { ...belted, phase: 'map' };
  const outside = step(mapPhase, 'q1');
  assert.equal(outside.state, mapPhase, 'a rejected q1 does not move the state');
  assert.equal(outside.error?.code, 2);
  assert.equal(outside.error?.error, 'illegal_action');
  const outsideD = step({ ...belted, phase: 'map' }, 'd1');
  assert.equal(outsideD.error?.code, 2);
  // Also through the real session: begin -> (kindling/map has no belt actions).
  const live = legal(begin({ seed: 3 }));
  assert.equal(live.some((a) => a.kind === 'quaff' || a.kind === 'discard_potion'), false);
});

test('the belt never exceeds three slots through the real victory path', () => {
  // Stuff the belt, win fights across seeds: the drop must stay suppressed at 3.
  for (let seed = 0; seed < 40; seed += 1) {
    const out = resolveVictory(wonState({
      seed, rngDraws: 500, nodeType: 'elite', rewardOverride: 'heal',
      state: { potions: ['stone_skin', 'ash_salts', 'bellows_fuel'] },
    }), null);
    assert.ok(out.state.potions.length <= POTION_SLOTS, `seed ${seed}: belt stays within capacity`);
  }
});

/* ---------------------------------------------------- tolerance and validation -- */

test('a stale belt id degrades: raw id as the name, a discard but never a quaff, nothing throws', () => {
  const s = beltCombat(['no_such_flask', 'stone_skin']);
  assert.doesNotThrow(() => observe(s));
  assert.doesNotThrow(() => snapshot(s));
  const snap = snapshot(s);
  assert.equal(snap.belt.length, 2, 'nothing is dropped from the belt');
  const ghost = snap.belt[0];
  assert.equal(ghost.potionId, 'no_such_flask');
  assert.equal(ghost.known, false);
  assert.equal(ghost.name, 'no_such_flask', 'the raw id is its own name');
  assert.equal(ghost.text, '');
  assert.deepEqual(ghost.quaffIds, [], 'an unknown potion is never offered a quaff the handler would refuse');
  assert.equal(ghost.discardId, 'd1', 'a discard is offered so the corrupt slot can be cleared');
  const known = snap.belt[1];
  assert.equal(known.known, true);
  assert.equal(known.name, 'Stone Skin');
  const d = step(s, 'd1');
  assert.equal(d.error, null);
  assert.deepEqual(d.state.potions, ['stone_skin'], 'the corrupt slot clears like any other');
  // Forcing the refused quaff is the R6 rejection, not a legal no-op (S4.1 rule).
  const forced = step(s, 'q1');
  assert.equal(forced.error?.code, 2);
  assert.equal(forced.state, s);
  // The text dump renders the raw id in the BELT section.
  assert.match(observe(s), /BELT/);
  assert.match(observe(s), new RegExp(`1 no_such_flask  \\(quaff q1, discard d1\\)`));
});

test('validateSave: the field is optional, structured, and never id-checked', () => {
  // Legacy: absent field loads.
  const legacy = JSON.parse(JSON.stringify({ save: true }));
  void legacy;
  const baseSave = {
    formatVersion: 1, engineVersion: 'x', contentVersion: 'dlb-0.3.0-act1', seed: 1,
    character: 'ironclad', difficulty: 0, stepIndex: 0, rngDraws: 0,
    state: newRun({ seed: 1 }),
  };
  const noField = JSON.parse(JSON.stringify(baseSave));
  delete noField.state.potions;
  assert.deepEqual(validateSave(noField), [], 'a pre-potion save validates');

  const honest = JSON.parse(JSON.stringify(baseSave));
  honest.state.potions = ['stone_skin'];
  assert.deepEqual(validateSave(honest), [], 'a known id validates');

  const stale = JSON.parse(JSON.stringify(baseSave));
  stale.state.potions = ['no_such_flask'];
  assert.deepEqual(validateSave(stale), [], 'a stale id is TOLERATED (degrades at observation), never refused');

  const long = JSON.parse(JSON.stringify(baseSave));
  long.state.potions = ['a', 'b', 'c', 'd'];
  assert.ok(validateSave(long).some((p) => p.includes('at most 3')), 'a 4-slot belt is refused, not repaired');

  const nonString = JSON.parse(JSON.stringify(baseSave));
  nonString.state.potions = ['stone_skin', 7];
  assert.ok(validateSave(nonString).some((p) => p.includes('potions[1]')), 'a non-string entry names its index');

  const nonArray = JSON.parse(JSON.stringify(baseSave));
  nonArray.state.potions = 'stone_skin';
  assert.ok(validateSave(nonArray).some((p) => p.includes('must be an array')));
});

test('a legacy save (no potions field) plays with an empty belt', () => {
  const base = newRun({ seed: 7 });
  const legacy = { ...JSON.parse(JSON.stringify(base)), potions: undefined };
  delete legacy.potions;
  const snap = snapshot(legacy);
  assert.deepEqual(snap.belt, []);
  assert.equal(snap.beltSlots, 3);
  assert.match(observe({ ...legacy, phase: 'combat', combat: { ...base.combat, active: true, nodeId: 'r0n0', nodeType: 'combat_weak', turn: 1, enemies: base.combat.enemies, draw: [], hand: [], discard: [], exhaust: [] } }), /POTIONS 0\/3/);
  // A real engine run never produced a non-array belt; the tolerant reads keep one from
  // throwing anywhere (beltBody, actions, snapshot, the drop roll).
  assert.deepEqual(snapshot({ ...legacy, potions: null }).belt, []);
});

/* ------------------------------------------------------ snapshot and text dump -- */

test('snapshot belt: every phase publishes the rows; combat resolves the q/d ids', () => {
  const belted = { ...newRun({ seed: 3 }), potions: ['ember_draught', 'stone_skin'] };
  const onMap = snapshot({ ...belted, phase: 'map' });
  assert.equal(onMap.belt.length, 2);
  assert.deepEqual(onMap.belt[0].quaffIds, [], 'no ids off-combat');
  assert.equal(onMap.belt[0].discardId, null);
  assert.equal(onMap.belt[0].name, 'Ember Draught');
  assert.ok(onMap.belt[0].text.includes('20 damage'), 'the kernel table\'s own sentence, verbatim');
  assert.equal(onMap.belt[0].summary, 'A20');

  const two = beltCombat(['ember_draught', 'stone_skin'], { hps: [40, 40] });
  const inCombat = snapshot(two).belt;
  assert.deepEqual(inCombat[0].quaffIds, ['q1_1', 'q1_2'], 'aimed potion: one id per living enemy');
  assert.deepEqual(inCombat[1].quaffIds, ['q2'], 'unaimed potion: one id');
  assert.deepEqual(inCombat.map((r) => r.discardId), ['d1', 'd2']);
  assert.equal(snapshot(two).beltSlots, 3);

  // The aimed quaff ids line up with the living-enemy order the snapshot publishes:
  // quaffIds[k] aims at snapshot.enemies[k] (both are the LIVING list, in state order).
  const inCombatSnap = snapshot(two);
  assert.deepEqual(inCombatSnap.enemies.map((e) => e.index), [0, 1], 'the living list is in state order');
  for (let k = 0; k < inCombatSnap.enemies.length; k += 1) {
    assert.equal(inCombatSnap.belt[0].quaffIds[k], `q1_${k + 1}`, `quaffIds[${k}] aims at living enemy ${k + 1}`);
  }
});

test('the text dump: POTIONS header everywhere, a BELT section in combat, budgeted lines', () => {
  assert.match(observe(newRun({ seed: 7 })), /POTIONS 0\/3/);
  const s = beltCombat(['ember_draught', 'purge_flask'], { hps: [40, 40] });
  const dump = observe(s);
  assert.match(dump, /POTIONS 2\/3/);
  assert.match(dump, /BELT/);
  assert.match(dump, / 1 Ember Draught  A20  \(quaff q1, discard d1\)/);
  assert.match(dump, / 2 Purge Flask  PURGE  \(quaff q2, discard d2\)/);
  // Action lines: name-only like every other line, discard named as the renunciation.
  const dump2 = beltCombat(['ash_salts']);
  assert.match(K.observeActions(dump2), /q1 ash_salts/);
  assert.match(K.observeActions(dump2), /d1 discard ash_salts/);
  // The aimed forms read like the aimed plays they mirror.
  const aimed = beltCombat(['ember_draught'], { hps: [40, 40] });
  assert.match(K.observeActions(aimed), /q1_1 ember_draught/);
  assert.match(K.observeActions(aimed), /q1_2 ember_draught/);
});

/* --------------------------------------------------------- policies and replay -- */

test('greedy and smart ignore the belt: they never choose a quaff or a discard', () => {
  for (const name of ['greedy', 'smart']) {
    const policy = makePolicy(name);
    // A belt full of tempting potions in fights the bot must still play by its cards.
    let s = beltCombat(['ember_draught', 'stone_skin', 'bellows_fuel'], { hps: [44, 30] });
    for (let g = 0; g < 12 && s.phase === 'combat'; g += 1) {
      const L = actions(s);
      const choice = policy.choose({ session: { state: s }, state: s, legal: L, stepIndex: s.stepIndex, memory: {} });
      const chosen = L.find((a) => a.id === choice.id);
      assert.ok(chosen, `${name} chose a legal id`);
      assert.notEqual(chosen.kind, 'quaff', `${name} ignored the belt (chose ${choice.id})`);
      assert.notEqual(chosen.kind, 'discard_potion', `${name} ignored the belt (chose ${choice.id})`);
      const out = step(s, choice.id);
      if (out.error) break;
      s = out.state;
    }
  }
});

test('a real run that drops a potion and quaffs it replays hash-for-hash', () => {
  // greedy everywhere EXCEPT: at the start of each combat with a filled belt, quaff the
  // first offered form. The full action list is legal from a bare begin(), so the log
  // replays through the same machinery every other run does (the S4 precedent).
  const driver = (seed) => {
    const greedy = makePolicy('greedy');
    let session = begin({ seed });
    const memory = {};
    let quaffed = 0;
    for (let guard = 0; guard < 3000; guard += 1) {
      const st = session.state;
      if (st.phase === 'ended') break;
      const L = legal(session);
      let id;
      if (st.phase === 'combat' && (st.potions ?? []).length > 0) {
        id = L.find((a) => a.kind === 'quaff')?.id;
        if (id) quaffed += 1;
      }
      id ??= greedy.choose({ session, state: st, legal: L, stepIndex: st.stepIndex, memory }).id;
      if (id == null) break;
      session = submit(session, id).session;
      if (quaffed >= 1 && session.state.phase !== 'combat') break; // keep the walk small
    }
    return { session, quaffed };
  };
  let picked = null;
  for (let seed = 1; seed <= 60 && !picked; seed += 1) {
    const run = driver(seed);
    const dropped = run.session.events.some((e) => e.t === 'potion_drop');
    if (dropped && run.quaffed >= 1) picked = run.session;
  }
  assert.ok(picked, 'some seed in 1..60 drops a potion and quaffs it');
  const parsed = parseLog(renderLog(picked));
  assert.equal(parsed.ok, true, `log parses: ${JSON.stringify(parsed.problems ?? [])}`);
  const result = assertReplay(parsed);
  assert.equal(result.ok, true, `hash-for-hash: ${JSON.stringify(result.mismatches ?? [])}`);
  assert.equal(runHash(picked), result.finalHash);
  // The event trail carries the whole sequence: a drop, then the quaff of it.
  assert.ok(picked.events.some((e) => e.t === 'potion_drop'));
  assert.ok(picked.events.some((e) => e.t === 'potion_quaffed'));
});

test('same actions, same belt: a quaffed run is deterministic to the hash', () => {
  const drive = () => {
    const s = beltCombat(['stone_skin', 'ash_salts']);
    const hashes = [hash(s)];
    const a = step(s, 'q1').state;
    hashes.push(hash(a));
    const b = step(a, 'd1').state;
    hashes.push(hash(b));
    return hashes;
  };
  assert.deepEqual(drive(), drive());
});
