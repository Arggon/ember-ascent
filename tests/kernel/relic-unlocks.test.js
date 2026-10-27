// Relic meta-unlocks (S10) — the win-gated pool, the gated drops, the legacy read.
//
// Pins:
//   - RELIC_UNLOCK_TABLE covers EVERY shipped relic exactly once, rows ascend from 0,
//     tiers never regress (commons, then uncommons, rares last), and row 0 carries both
//     starters. The anchors: a 5-win profile sees 8 relics, a 15-win profile sees all 13.
//   - The pool is DERIVED, never rolled: relicPoolFor is pure, newRun's derivation
//     consumes zero draws, and a profile-less run carries NO relicPool field at all —
//     byte-identical states for the harness paths (the golden generator's proof is that
//     tests/golden/logs.jsonl regenerates byte-for-byte).
//   - Drops and offers respect the pool: a fresh profile's elite can NEVER roll an
//     unlocked-later relic (200 seeds), its warden offers NOTHING at zero draws, a
//     7-win pool offers two, a 10-win pool three. The pick guards the pool too (the
//     resolver refuses a known, not-held id the pool excludes — torn saves only).
//   - LEGACY: an absent/torn relicPool reads as the FULL table at every drop read —
//     one rule covering the pre-S10 save and the profile-less run alike.
//   - A pool-gated run replays hash-for-hash: the log header carries the pool verbatim
//     (the win count is not recoverable from the pool it made), replay passes it back.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELICS,
  RELIC_TOTAL,
} from '../../src/kernel/rules/relics.js';
import { resolveVictory } from '../../src/kernel/rules/act.js';
import {
  RELIC_UNLOCK_TABLE,
  relicPoolFor,
  evaluateRelicUnlocks,
  fullyUnlockedProfile,
} from '../../src/kernel/unlocks.js';
import { begin, submit, legal, renderLog, parseLog, assertReplay, runHash } from '../../src/surface/session.js';
import { makePolicy } from '../../src/surface/policies.js';

const K = await (await import('../helpers/harness.mjs')).loadKernel();
const { newRun, actions, step, snapshot, observe, hash, validateSave } = K;
const {
  dropPool, rollEliteRelicDrop, rollBossRelicOffers, bossOfferOpen, relicPoolList, relicDef,
} = await import('../../src/kernel/rules/relics.js');

const TIERS = Object.freeze({ common: 0, uncommon: 1, rare: 2 });

/** A staged post-combat state, the relics.test fixture shape, with a pool override. */
function wonState(over = {}) {
  const base = newRun({ seed: over.seed ?? 7, character: over.character ?? 'ironclad' });
  const s = {
    ...base,
    ...(over.relics ? { relics: over.relics } : {}),
    ...(over.relicPool ? { relicPool: over.relicPool } : {}),
    potions: ['stone_skin', 'ash_salts', 'bellows_fuel'],
    rngDraws: over.rngDraws ?? 500,
    player: { ...base.player, ...(over.player ?? {}) },
    combat: {
      ...base.combat,
      active: true,
      nodeId: over.nodeId ?? 'r0n0',
      nodeType: over.nodeType ?? 'combat_weak',
      turn: 3,
      enemies: [],
    },
    map: { ...base.map, encounterTable: { ...base.map.encounterTable, [over.nodeId ?? 'r0n0']: { ...base.map.encounterTable[over.nodeId ?? 'r0n0'], reward: over.rewardOverride ?? 'heal' } } },
  };
  return s;
}

/* --------------------------------------------------------------------- the table -- */

test('RELIC_UNLOCK_TABLE covers every shipped relic exactly once, ascending, tier-ordered', () => {
  const seen = [];
  let lastAt = -1;
  let lastTier = -1;
  for (const row of RELIC_UNLOCK_TABLE) {
    assert.ok(Number.isInteger(row.at) && row.at >= 0, 'thresholds are non-negative integers');
    assert.ok(row.at > lastAt, `rows ascend strictly (${lastAt} -> ${row.at})`);
    lastAt = row.at;
    for (const id of row.ids) {
      assert.ok(RELICS[id], `${id} is a real relic`);
      assert.ok(!seen.includes(id), `${id} appears exactly once across the table`);
      seen.push(id);
    }
    const tierRank = Math.min(...row.ids.map((id) => TIERS[RELICS[id].tier]));
    assert.ok(tierRank >= lastTier, 'tiers never regress across milestones: commons, uncommons, rares LAST');
    lastTier = tierRank;
  }
  assert.deepEqual(seen.sort(), Object.keys(RELICS).sort(), 'the table is the WHOLE table — a relic without a milestone can never unlock');
  const firstRow = RELIC_UNLOCK_TABLE[0];
  assert.ok(firstRow.ids.includes('burning_blood') && firstRow.ids.includes('cyan_lantern'), 'row 0 carries BOTH starters');
  assert.ok(firstRow.ids.every((id) => RELICS[id].tier === 'common'), 'row 0 is the common tier only — the act-1 basics');
  assert.equal(RELIC_TOTAL, 13);
});

test('relicPoolFor: the documented milestones (5 wins -> 8 relics, 15 -> all 13)', () => {
  const size = (wins) => relicPoolFor({ wins }).length;
  assert.equal(size(0), 5, 'a fresh profile holds the five commons');
  assert.equal(size(1), 6, 'the first win opens Ember Heart');
  assert.equal(size(3), 8, 'three wins complete the uncommon tier');
  assert.equal(size(5), 8, 'ANCHOR: a 5-win player sees 8 relics');
  assert.equal(size(7), 10, 'seven wins open the rare tier (the first warden offer)');
  assert.equal(size(10), 12);
  assert.equal(size(15), 13, 'ANCHOR: a 15-win player sees all 13');
  assert.equal(size(99), 13, 'beyond the last milestone nothing new exists');
  // The run's own starter ALWAYS leads, whatever the table does later.
  const ash = relicPoolFor({ wins: 0 }, 'burning_blood');
  const bel = relicPoolFor({ wins: 0 }, 'cyan_lantern');
  assert.equal(ash[0], 'burning_blood');
  assert.equal(bel[0], 'cyan_lantern');
  // Deterministic: the pool is a function of its arguments alone.
  assert.deepEqual(relicPoolFor({ wins: 7 }, 'burning_blood'), relicPoolFor({ wins: 7 }, 'burning_blood'));
  // Garbage wins degrade to the fresh pool; the profile's other fields are unread.
  assert.deepEqual(relicPoolFor(null), relicPoolFor({ wins: 0 }));
  assert.deepEqual(relicPoolFor({ wins: -4 }), relicPoolFor({ wins: 0 }));
  assert.deepEqual(relicPoolFor({ wins: 'many' }), relicPoolFor({ wins: 0 }));
  assert.deepEqual(relicPoolFor({ wins: 15, scoreTotal: 999999 }), relicPoolFor({ wins: 15 }), 'wins is the ONLY profile field the relic pool reads');
});

test('fullyUnlockedProfile carries the relic milestones, derived from the table', () => {
  const full = fullyUnlockedProfile();
  assert.equal(full.wins, Math.max(...RELIC_UNLOCK_TABLE.map((r) => r.at)));
  assert.deepEqual(relicPoolFor(full, 'burning_blood'), relicPoolFor({ wins: full.wins }, 'burning_blood'));
  assert.equal(relicPoolFor(full).length, RELIC_TOTAL, '?pool=full still means FULL');
});

/* ---------------------------------------------------------------------- newRun -- */

test('newRun({wins}) derives the pool: starter first, unlock order, zero draws, frozen', () => {
  const gated = newRun({ seed: 7, wins: 0 });
  assert.deepEqual(gated.relicPool, ['burning_blood', 'cyan_lantern', 'forge_iron', 'whetted_edge', 'hearth_ash']);
  const plain = newRun({ seed: 7 });
  assert.equal(gated.rngDraws, plain.rngDraws, 'the derivation consumes NO draws — profile-derived, not rolled');
  const bel = newRun({ seed: 7, character: 'bellows', wins: 0 });
  assert.equal(bel.relicPool[0], 'cyan_lantern', 'each hero\u2019s own starter leads its pool');
  assert.ok(Object.isFrozen(gated) && Object.isFrozen(gated.relicPool), 'the pool is frozen with the state');
  // A veteran's pool is exactly what the table says at that count.
  assert.equal(newRun({ seed: 7, wins: 10 }).relicPool.length, 12);
  // A replay's verbatim pool is taken VERBATIM (the exact form wins over derivation).
  const exact = newRun({ seed: 7, relicPool: ['ghost_relic', 'deep_well'] });
  assert.deepEqual(exact.relicPool, ['ghost_relic', 'deep_well'], 'the replay door does not re-derive or pad');
  // Refusals (the difficulty precedent): shape errors are code 3, never a silent gate.
  assert.throws(() => newRun({ seed: 7, wins: -1 }), (e) => e.code === 3);
  assert.throws(() => newRun({ seed: 7, wins: 1.5 }), (e) => e.code === 3);
  assert.throws(() => newRun({ seed: 7, relicPool: 'burning_blood' }), (e) => e.code === 3);
  assert.throws(() => newRun({ seed: 7, relicPool: [42] }), (e) => e.code === 3);
});

test('a profile-less run carries NO relicPool field — the harness states stay byte-stable', () => {
  const s = newRun({ seed: 7 });
  assert.equal('relicPool' in s, false, 'absent is the pre-S10 shape: the golden generator\u2019s runs are untouched');
  assert.equal(hash(s), hash(newRun({ seed: 7 })), 'same seed, same hash, as always');
  // And the surface tells the two states apart (null = full table, never an empty pool).
  assert.equal(snapshot(s).relicPool, null);
  assert.deepEqual(snapshot(newRun({ seed: 7, wins: 3 })).relicPool.length, 8);
});

/* ----------------------------------------------------------------------- drops -- */

test('a fresh profile\u2019s elite CANNOT drop an unlocked-later relic — 200 seeds', () => {
  const commons = RELIC_UNLOCK_TABLE[0].ids;
  let sawCommon = 0;
  for (let seed = 0; seed < 200; seed += 1) {
    const s = wonState({ seed, nodeType: 'elite', relicPool: relicPoolFor({ wins: 0 }, 'burning_blood') });
    assert.deepEqual(dropPool(s, 'uncommon'), [], `seed ${seed}: the gated uncommon pool is empty`);
    const roll = rollEliteRelicDrop(s);
    assert.equal(roll.draws, 2, `seed ${seed}: the exhausted tier falls to common at no extra draw`);
    assert.ok(commons.includes(roll.relic), `seed ${seed}: ${roll.relic} is a row-0 common, never an unlocked-later relic`);
    if (RELICS[roll.relic].tier === 'common') sawCommon += 1;
  }
  assert.equal(sawCommon, 200, 'every gated drop landed in the unlocked tier');
  // Control: the SAME seeds without the pool field still reach the uncommon tier.
  const controlUncommons = [];
  for (let seed = 0; seed < 200; seed += 1) {
    const roll = rollEliteRelicDrop(wonState({ seed, nodeType: 'elite' }));
    if (RELICS[roll.relic].tier === 'uncommon') controlUncommons.push(roll.relic);
  }
  assert.ok(controlUncommons.length > 20, `the full-table control still drops uncommons (${controlUncommons.length}/200) — the gate, not the roll, changed`);
});

test('the gated boss offer: fresh = NONE at zero draws; 7 wins = two; 10 wins = three', () => {
  // Fresh pool: the warden's vault is empty. The branch still opens the reward phase;
  // the skip is the way out; the roll cost nothing.
  for (let seed = 0; seed < 20; seed += 1) {
    const s = wonState({ seed, nodeType: 'boss', relicPool: relicPoolFor({ wins: 0 }) });
    const out = resolveVictory(s, null);
    assert.equal(out.state.phase, 'reward');
    assert.deepEqual(out.state.reward.relicOffers, [], `seed ${seed}: the honest zero`);
    assert.equal(out.state.reward.boss, true);
    assert.equal(out.state.rngDraws, s.rngDraws, `seed ${seed}: an empty vault costs no draw`);
    assert.deepEqual(actions(out.state).map((a) => a.id), ['s0'], 'the skip is offered — never a softlock');
    assert.match(observe(out.state), /REWARD — the warden offers nothing/, 'the dump says what is true');
    const climb = step(out.state, 's0');
    assert.equal(climb.state.phase, 'map', 'walking away climbs on (the vault is the reason to come back)');
  }
  // 7 wins: two rares in the pool — the offer is min(3, pool) = two, two draws.
  const seven = wonState({ nodeType: 'boss', relicPool: relicPoolFor({ wins: 7 }) });
  const sevenOut = resolveVictory(seven, null);
  assert.equal(sevenOut.state.reward.relicOffers.length, 2);
  assert.ok(sevenOut.state.reward.relicOffers.every((id) => RELICS[id].tier === 'rare'));
  assert.equal(sevenOut.state.rngDraws, seven.rngDraws + 2, 'exactly the picks it made');
  // 10 wins: four rares — a real three, and every offer is INSIDE the pool.
  const ten = wonState({ nodeType: 'boss', relicPool: relicPoolFor({ wins: 10 }) });
  const tenOut = resolveVictory(ten, null);
  assert.equal(tenOut.state.reward.relicOffers.length, 3);
  const tenPool = new Set(ten.relicPool);
  assert.ok(tenOut.state.reward.relicOffers.every((id) => tenPool.has(id)), 'offers come from the run\u2019s own pool, never the full table');
  assert.equal(new Set(tenOut.state.reward.relicOffers).size, 3, 'no dupes');
});

test('the pick guard enforces the pool at the resolver: an out-of-pool offer takes no id', () => {
  const gated = wonState({
    nodeType: 'boss',
    relicPool: relicPoolFor({ wins: 0 }),
  });
  // A torn reward (validateSave never shape-checks it) carrying a KNOWN, not-held rare
  // the pool excludes: the same treatment an unknown id gets — no id, no pick.
  const torn = {
    ...gated,
    phase: 'reward',
    reward: { cards: [], relicOffers: ['deep_well', 'ash_ledger', 'ghost_relic'], gold: 100, boss: true },
  };
  assert.equal(bossOfferOpen('deep_well', torn), false, 'known but locked: refused');
  assert.equal(bossOfferOpen('ghost_relic', torn), false, 'unknown: refused as ever');
  assert.deepEqual(actions(torn).map((a) => a.id), ['s0'], 'the locked vault offers no r-id');
  assert.equal(step(torn, 'r1').error.code, 2, 'forcing it is the legal no-op rejection');
  // The legacy read (no pool field) is unchanged: a known not-held id opens.
  assert.equal(bossOfferOpen('deep_well', wonState({ nodeType: 'boss' })), true);
});

/* ---------------------------------------------------------------------- legacy -- */

test('LEGACY: an absent or torn relicPool reads as the FULL table at every drop read', () => {
  const s = newRun({ seed: 7 });
  assert.deepEqual(relicPoolList(s), Object.keys(RELICS), 'the fallback is the whole table');
  assert.equal(dropPool(s, 'uncommon').length, 3, 'uncommons reachable as always');
  assert.equal(dropPool(s, 'rare').length, 5, 'rares reachable as always');
  assert.deepEqual(relicPoolList({ ...s, relicPool: 'garbage' }), Object.keys(RELICS), 'a torn non-array degrades the same way');
  // A pre-S10 save loads, observes and plays (validateSave keeps the field optional).
  const save = {
    formatVersion: 1, engineVersion: 'x', contentVersion: 'x', seed: 7, character: 'ironclad',
    difficulty: 0, stepIndex: 0, rngDraws: 0,
    state: { ...s, phase: 'map', act: 1, floor: -1, contentVersion: 'x' },
  };
  assert.deepEqual(validateSave(save), []);
  assert.doesNotThrow(() => observe(save.state));
  assert.doesNotThrow(() => snapshot(save.state));
});

test('validateSave: relicPool is an optional array of strings; duplicates are refused', () => {
  const base = newRun({ seed: 4 });
  const save = (relicPool) => ({
    formatVersion: 1, engineVersion: 'x', contentVersion: 'x', seed: 4, character: 'ironclad',
    difficulty: 0, stepIndex: 0, rngDraws: 0,
    state: { ...base, relicPool, phase: 'map', act: 1, floor: -1, contentVersion: 'x' },
  });
  assert.deepEqual(validateSave(save(undefined)), [], 'absent (legacy) is fine');
  assert.deepEqual(validateSave(save(['burning_blood', 'deep_well'])), [], 'a real pool is fine');
  assert.deepEqual(validateSave(save(['ghost_relic'])), [], 'UNKNOWN ids are tolerated (membership-only filtering)');
  assert.ok(validateSave(save('burning_blood')).some((p) => p.includes('"relicPool" must be an array')), 'a non-array is refused');
  assert.ok(validateSave(save([42])).some((p) => p.includes('must be a string')), 'a non-string element is refused');
  assert.ok(validateSave(save(['deep_well', 'deep_well'])).some((p) => p.includes('duplicate')), 'a duplicate is refused — the derivation can never produce one');
});

/* -------------------------------------------------------------- the win verdict -- */

test('evaluateRelicUnlocks: the milestone crossing is the pool difference, pure', () => {
  assert.deepEqual(evaluateRelicUnlocks(0, 1).newly, ['ember_heart'], 'the first win opens the first uncommon');
  assert.deepEqual(evaluateRelicUnlocks(6, 7).newly, ['deep_well', 'ash_crown'], 'one win can open several relics at once');
  assert.deepEqual(evaluateRelicUnlocks(5, 6).newly, [], 'a win inside a gap opens nothing');
  assert.deepEqual(evaluateRelicUnlocks(4, 4).newly, [], 'a LOSS opens nothing — winning is what grows the pool');
  assert.deepEqual(evaluateRelicUnlocks(14, 15).newly, ['ash_ledger'], 'the table completes at 15');
  // The verdict is the pool difference by construction, and pure.
  for (const [a, b] of [[0, 1], [6, 7], [5, 5], [14, 15]]) {
    const v = evaluateRelicUnlocks(a, b);
    const had = new Set(v.before);
    assert.deepEqual(v.newly, v.after.filter((id) => !had.has(id)));
    assert.deepEqual(evaluateRelicUnlocks(a, b).newly, v.newly, 'same inputs, same verdict');
  }
});

/* ---------------------------------------------------------------------- replay -- */

test('a pool-gated run replays hash-for-hash; the log header carries the pool verbatim', () => {
  // Greedy everywhere except: take the first boss offer (the policies' documented stance).
  const driver = (seed) => {
    const greedy = makePolicy('greedy');
    let session = begin({ seed, wins: 0 });
    for (let guard = 0; guard < 3000; guard += 1) {
      const st = session.state;
      if (st.phase === 'ended') break;
      const L = legal(session);
      let id;
      if (st.phase === 'reward' && st.reward?.relicOffers != null) {
        id = L.find((a) => a.kind === 'relic_pick')?.id;
      }
      id ??= greedy.choose({ session, state: st, legal: L, stepIndex: st.stepIndex, memory: {} }).id;
      if (id == null) break;
      session = submit(session, id).session;
    }
    return session;
  };
  let picked = null;
  for (let seed = 1; seed <= 200 && !picked; seed += 1) {
    const run = driver(seed);
    // The gated elite only drops commons — the event trail must agree with the pool.
    const eliteDrops = run.events.filter((e) => e.t === 'relic_gained' && e.source === 'elite');
    const allCommon = eliteDrops.every((e) => RELIC_UNLOCK_TABLE[0].ids.includes(e.relic));
    if (eliteDrops.length > 0 && allCommon && run.state.outcome === 'win') picked = run;
  }
  assert.ok(picked, 'some seed kills an elite under the gate, drops a common, and wins');
  const gatedRelics = picked.events.filter((e) => e.t === 'relic_gained').map((e) => e.relic);
  assert.ok(gatedRelics.every((id) => picked.state.relicPool.includes(id)), 'every gained relic came from the run\u2019s pool');
  assert.ok(gatedRelics.every((id) => id !== 'ash_ledger'), 'the 15-win relic never appears under a fresh gate');
  const header = JSON.parse(renderLog(picked).split('\n')[0]);
  assert.deepEqual(header.relicPool, picked.state.relicPool, 'the header records the exact pool');
  const parsed = parseLog(renderLog(picked));
  assert.equal(parsed.ok, true, `log parses: ${JSON.stringify(parsed.problems ?? [])}`);
  const result = assertReplay(parsed);
  assert.equal(result.ok, true, `hash-for-hash: ${JSON.stringify(result.mismatches ?? [])}`);
  assert.equal(runHash(picked), result.finalHash);
});

/* -------------------------------------------------------------------- surfaces -- */

test('the snapshot publishes the pool beside the draft pool, bare ids, null for absent', () => {
  const gated = snapshot(newRun({ seed: 7, wins: 0 }));
  assert.deepEqual(gated.relicPool, RELIC_UNLOCK_TABLE[0].ids);
  assert.equal(typeof gated.draftPool, 'object', 'the draft pool sits beside it, same convention');
  const names = gated.relicPool.map((id) => relicDef(id)?.name ?? id);
  assert.deepEqual(names, ['Kindled Heart', 'Cyan Lantern', 'Forge Iron', 'Whetted Edge', 'Hearth Ash'], 'the ids resolve through the kernel describe layer');
});
