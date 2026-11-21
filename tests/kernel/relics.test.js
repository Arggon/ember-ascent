// Relics (S7) — the grown table, the real hooks, the drops, and the accounting.
//
// Pins:
//   - The table is 11 relics across the card system's 3 tiers; every row names itself
//     (name/summary/text kernel-side), carries only CLOSED hook keys, and the two heroes'
//     starting relics keep their content names (the kindling Iron Skin text reads them).
//   - `state.relics` is an ARRAY in acquisition order; relics[0] is the starter. A legacy
//     save (B4 singular `state.relic`, or no field at all) reads as exactly its one relic.
//     validateSave: optional, strings, NO duplicates (a relic can never drop twice); the
//     id strings are never checked — unknown ids degrade everywhere, never throw.
//   - The hooks are real mechanics through NAMED accessors (no string matching), applied
//     per relic in acquisition order with each contribution carrying its own event, so
//     two relics sharing a hook both fire (Cyan Lantern + Slag Crown = +2 turn-1 Energy).
//     Iron Skin's relicOff switches off relics[0] ONLY.
//   - The drops: an elite is a GUARANTEED 70/30 common/uncommon roll (1 band draw + 1
//     pick draw, exactly 2; 0 only when both pools are empty — impossible through play);
//     the boss offers THREE distinct offers, highest tier first (UX-1 down-tier: the
//     full table covers them from rares — 3 draws; a short pool fills from uncommons,
//     then commons), pick r<n> or skip s0, and
//     the run ends at that step, not at the victory. Acquisition always goes through
//     gainRelic — Ember Heart's max-HP passive fires on the elite drop exactly as on the
//     boss pick.
//   - A real run through an elite drop and a boss pick replays hash-for-hash through the
//     same log machinery every other run does (the S4/S5 precedent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, REPO } from '../helpers/harness.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentForProfile } from '../../src/kernel/index.js';
import {
  RELICS, RELIC_HOOKS, RELIC_TIERS, ELITE_COMMON_BAND, relicList, relicDef, relicSum,
  activeRelicDefs, dropPool, rollEliteRelicDrop, rollBossRelicOffers, gainRelic,
  RELIC_HEAL, LANTERN_ENERGY, FORGE_IRON_BLOCK, WHETTED_EDGE_STRENGTH, HEARTH_HEAL,
  EMBER_HEART_HP, GOLD_VEIN_GAIN, FLASK_GRIP_BLOCK, DEEP_WELL_DRAW, ASH_CROWN_HEAL, SLAG_CROWN_STRENGTH,
} from '../../src/kernel/rules/relics.js';
import { resolveVictory } from '../../src/kernel/rules/act.js';
import { intAt, pickAt } from '../../src/kernel/rng.js';
import { begin, submit, legal, renderLog, parseLog, assertReplay, runHash } from '../../src/surface/session.js';
import { makePolicy } from '../../src/surface/policies.js';

const K = await loadKernel();
const { newRun, actions, step, snapshot, observe, hash, validateSave } = K;

function ironSkinRun(character) {
  for (let seed = 0; seed < 80; seed += 1) {
    const r = newRun({ seed, character, kindling: true });
    const a = actions(r).find((x) => x.boon === 'ironskin');
    if (a) return { r, id: a.id };
  }
  throw new Error('no seed offers Iron Skin');
}

/** A won-combat state for resolveVictory, the gold.test fixture: FULL belt (the potion
 *  drop is suppressed at 0 draws) so the victory chain's draws stay readable. */
function wonState(over = {}) {
  const base = newRun({ seed: over.seed ?? 7, character: over.character ?? 'ashwright' });
  const reward = over.rewardOverride ?? 'card';
  const s = {
    ...base,
    ...(over.relics ? { relics: over.relics } : {}),
    ...(over.relicOff ? { relicOff: true } : {}),
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
    map: { ...base.map, encounterTable: { ...base.map.encounterTable, [over.nodeId ?? 'r0n0']: { ...base.map.encounterTable[over.nodeId ?? 'r0n0'], reward } } },
  };
  return s;
}

/** A staged combat with a controlled held-relic list and belt. */
function relicCombat(relics, over = {}) {
  const base = newRun({ seed: over.seed ?? 5 });
  return {
    ...base,
    relics,
    ...(over.relicOff ? { relicOff: true } : {}),
    phase: 'combat',
    potions: over.belt ?? [],
    player: { ...base.player, hp: over.hp ?? 40, maxHp: over.maxHp ?? 60, energy: over.energy ?? 3, block: 0, statuses: { ...(over.statuses ?? {}) } },
    combat: {
      ...base.combat,
      active: true,
      nodeId: 'r0n0',
      nodeType: over.nodeType ?? 'combat_weak',
      turn: over.turn ?? 1,
      enemies: (over.hps ?? [40]).map((hp, i) => ({
        id: 'cinder_maw', index: i, name: `Worm ${i}`, hp, maxHp: 44,
        block: 0, statuses: {}, moveIndex: 0, moveHistory: [], intentStep: 0, dead: false,
      })),
      draw: [], hand: [], discard: [], exhaust: [],
    },
  };
}

/* --------------------------------------------------------------------- table -- */

test('every starting relic is in the relic table', async () => {
  for (const [id, ch] of contentForProfile(null).characters) {
    assert.ok(RELICS[ch.startingRelic], `${id}: relic ${ch.startingRelic} has no table entry`);
  }
});

test('relic effects are not keyed on relic names in the act rules', () => {
  const src = readFileSync(resolve(REPO, 'src/kernel/rules/act.js'), 'utf8');
  assert.doesNotMatch(src, /state\.relic\s*[!=]==?\s*'/);
});

test('the Iron Skin offer names the hero\'s own relic', () => {
  const keeper = ironSkinRun('bellows_keeper');
  const kb = snapshot(keeper.r).kindling.boons.find((b) => b.id === 'ironskin');
  assert.match(kb.text, /Cyan Lantern/);
  assert.doesNotMatch(kb.text, /Kindled Heart/);
  const ash = ironSkinRun('ashwright');
  const ab = snapshot(ash.r).kindling.boons.find((b) => b.id === 'ironskin');
  assert.match(ab.text, /Kindled Heart/);
});

test('the grown table: 13 relics, three full tiers, closed hooks, self-describing rows', () => {
  const ids = Object.keys(RELICS);
  assert.equal(ids.length, 13, `the table grew to 13, holds ${ids.length}`);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  const census = {};
  for (const id of ids) {
    const def = RELICS[id];
    assert.ok(def.name && def.summary && def.text, `${id} names and describes itself`);
    assert.ok(RELIC_TIERS.includes(def.tier), `${id} has a real tier`);
    census[def.tier] = (census[def.tier] ?? 0) + 1;
    const hooks = Object.keys(def).filter((k) => RELIC_HOOKS.includes(k));
    assert.ok(hooks.length >= 1 && hooks.length <= 2, `${id} carries 1-2 real hooks, has ${hooks.length}`);
    for (const h of hooks) {
      assert.ok(Number.isInteger(def[h]) && def[h] > 0, `${id}.${h} is a positive integer`);
    }
    assert.ok(relicDef(id) === def, 'the lookup resolves every row');
    assert.equal(relicDef('no_such_relic'), undefined, 'an unknown id resolves to undefined, never a throw');
  }
  assert.deepEqual(census, { common: 5, uncommon: 3, rare: 5 }, 'the tier census (5/3/5 — five rares, so act 2 offers a real three)');
  // The constants are the rows' numbers — one source, no copy drift.
  assert.equal(RELICS.kindled_heart.healAfterFight, RELIC_HEAL);
  assert.equal(RELICS.cyan_lantern.firstTurnEnergy, LANTERN_ENERGY);
  assert.equal(RELICS.forge_iron.combatStartBlock, FORGE_IRON_BLOCK);
  assert.equal(RELICS.whetted_edge.combatStartStrength, WHETTED_EDGE_STRENGTH);
  assert.equal(RELICS.hearth_ash.restHealBonus, HEARTH_HEAL);
  assert.equal(RELICS.ember_heart.maxHpBonus, EMBER_HEART_HP);
  assert.equal(RELICS.gold_vein.goldAfterFight, GOLD_VEIN_GAIN);
  assert.equal(RELICS.flask_grip.quaffBlock, FLASK_GRIP_BLOCK);
  assert.equal(RELICS.deep_well.firstTurnDraw, DEEP_WELL_DRAW);
  assert.equal(RELICS.ash_crown.healAfterFight, ASH_CROWN_HEAL);
  assert.equal(RELICS.slag_crown.combatStartStrength, SLAG_CROWN_STRENGTH);
  // The starters keep their content names (the kindling text reads them from content).
  const content = contentForProfile(null).characters;
  assert.equal(RELICS[content.get('ashwright').startingRelic].name, content.get('ashwright').relicName);
  assert.equal(RELICS[content.get('bellows_keeper').startingRelic].name, content.get('bellows_keeper').relicName);
});

/* --------------------------------------------------------------------- state -- */

test('newRun carries the starting relic array; the singular relic field is gone', () => {
  const ash = newRun({ seed: 4 });
  assert.deepEqual(ash.relics, ['kindled_heart']);
  const bel = newRun({ seed: 4, character: 'bellows_keeper' });
  assert.deepEqual(bel.relics, ['cyan_lantern']);
  assert.equal('relic' in ash, false, 'the B4 singular field no longer exists on fresh states');
  assert.equal(ash.relics[0], relicList(ash)[0], 'relics[0] is the starter relicId reads');
});

test('legacy saves read as exactly their B4 relic (tolerance, never a throw)', () => {
  // A pre-S7 Bellows save: singular `state.relic`, no `relics` array.
  const legacyBellows = { ...newRun({ seed: 4, character: 'bellows_keeper' }), relic: 'cyan_lantern' };
  delete legacyBellows.relics;
  assert.deepEqual(relicList(legacyBellows), ['cyan_lantern']);
  // A pre-B4 Ashwright save: no relic field at all.
  const ancient = { ...newRun({ seed: 4 }) };
  delete ancient.relics;
  delete ancient.relic;
  assert.deepEqual(relicList(ancient), ['kindled_heart']);
  // Both survive validateSave (the field is optional) and observe/snapshot.
  const save = { formatVersion: 1, engineVersion: 'x', contentVersion: 'x', seed: 4, character: 'bellows_keeper', difficulty: 0, stepIndex: 0, rngDraws: 0, state: { ...legacyBellows, phase: 'map', player: legacyBellows.player, act: 1, floor: -1, contentVersion: 'x' } };
  assert.deepEqual(validateSave(save), []);
  assert.doesNotThrow(() => observe(ancient));
  assert.doesNotThrow(() => snapshot(ancient));
});

test('validateSave: relics is an optional array of strings; duplicates are refused', () => {
  const base = { ...newRun({ seed: 4 }) };
  const save = (relics) => ({
    formatVersion: 1, engineVersion: 'x', contentVersion: 'x', seed: 4, character: 'ashwright',
    difficulty: 0, stepIndex: 0, rngDraws: 0,
    state: { ...base, relics, phase: 'map', act: 1, floor: -1, contentVersion: 'x' },
  });
  assert.deepEqual(validateSave(save(undefined)), [], 'absent (legacy) is fine');
  assert.deepEqual(validateSave(save(['kindled_heart'])), []);
  assert.deepEqual(validateSave(save(['kindled_heart', 'forge_iron'])), [], 'two distinct relics is fine');
  assert.deepEqual(validateSave(save(['ghost_relic'])), [], 'an UNKNOWN id is tolerated (surfaces degrade)');
  assert.ok(validateSave(save('relic')).some((p) => p.includes('"relics" must be an array')), 'a non-array is refused');
  assert.ok(validateSave(save([42])).some((p) => p.includes('must be a string')), 'a non-string element is refused');
  assert.ok(validateSave(save(['forge_iron', 'forge_iron'])).some((p) => p.includes('duplicate')), 'a duplicate is refused — the drop tables can never produce one');
});

/* --------------------------------------------------------------------- hooks -- */

test('Forge Iron: +4 Block at combat start, one block event naming the relic', () => {
  const s = step(newRun({ seed: 5 }).state ?? newRun({ seed: 5 }), 'n1').state; // control below
  void s;
  const control = step(newRun({ seed: 5 }), 'n1');
  const out = step({ ...newRun({ seed: 5 }), relics: ['forge_iron'] }, 'n1');
  assert.equal(out.state.player.block, control.state.player.block + FORGE_IRON_BLOCK);
  assert.deepEqual(out.events.filter((e) => e.t === 'block'), [{ t: 'block', who: 'player', amount: FORGE_IRON_BLOCK, source: 'forge_iron' }]);
  assert.equal(snapshot(out.state).player.block, out.state.player.block);
});

test('Whetted Edge: +1 Strength at combat start, and it is a real combat status', () => {
  const out = step({ ...newRun({ seed: 5 }), relics: ['whetted_edge'] }, 'n1');
  assert.equal(out.state.player.statuses.strength, WHETTED_EDGE_STRENGTH);
  assert.deepEqual(out.events.filter((e) => e.t === 'player_status'),
    [{ t: 'player_status', status: 'strength', stacks: WHETTED_EDGE_STRENGTH, source: 'whetted_edge' }]);
  // The header shows the compact power, the snapshot the sentence — both from the kernel.
  assert.match(observe(out.state), /PWR1/);
});

test('Deep Well: the FIRST turn draws 6, the second back to 5', () => {
  const out = step({ ...newRun({ seed: 5 }), relics: ['deep_well'] }, 'n1');
  assert.equal(out.state.combat.hand.length, 5 + DEEP_WELL_DRAW, 'the opening hand carries the extra card');
  const second = step(out.state, 'e1');
  assert.equal(second.state.combat.turn, 2);
  assert.equal(second.state.combat.hand.length, 5, 'only the first turn draws deep');
  // Control: a Kindled Heart run draws 5 on turn 1.
  const plain = step(newRun({ seed: 5 }), 'n1');
  assert.equal(plain.state.combat.hand.length, 5);
});

test('Slag Crown: BOTH hooks fire — +1 Energy AND +2 Strength on turn 1', () => {
  const out = step({ ...newRun({ seed: 5 }), relics: ['slag_crown'] }, 'n1');
  assert.equal(out.state.player.energy, out.state.energyPerTurn + LANTERN_ENERGY);
  assert.equal(out.state.player.statuses.strength, SLAG_CROWN_STRENGTH);
  const kinds = out.events.filter((e) => ['energy', 'player_status'].includes(e.t));
  assert.deepEqual(kinds.map((e) => [e.t, e.source]), [['player_status', 'slag_crown'], ['energy', 'slag_crown']],
    'the relic opening fires in the fixed per-relic order: Strength, then Energy — both naming the relic');
});

test('coexistence: two Energy relics BOTH fire, in acquisition order; relicOff hits relics[0] only', () => {
  const both = step({ ...newRun({ seed: 5 }), relics: ['cyan_lantern', 'slag_crown'] }, 'n1');
  assert.equal(both.state.player.energy, both.state.energyPerTurn + LANTERN_ENERGY + LANTERN_ENERGY, '+2 Energy on turn 1');
  assert.deepEqual(both.events.filter((e) => e.t === 'energy').map((e) => e.source), ['cyan_lantern', 'slag_crown'],
    'one event per relic, acquisition order');
  // Iron Skin switches off the STARTER (relics[0]) — the later relic keeps working.
  const off = step({ ...newRun({ seed: 5 }), relics: ['cyan_lantern', 'slag_crown'], relicOff: true }, 'n1');
  assert.equal(off.state.player.energy, off.state.energyPerTurn + LANTERN_ENERGY, 'only Slag Crown fires');
  assert.deepEqual(off.events.filter((e) => e.t === 'energy').map((e) => e.source), ['slag_crown']);
  // And with the flag on a later-relic-first list, the starter is STILL the excluded one.
  const offFirst = step({ ...newRun({ seed: 5 }), relics: ['slag_crown', 'cyan_lantern'], relicOff: true }, 'n1');
  assert.deepEqual(offFirst.events.filter((e) => e.t === 'energy').map((e) => e.source), ['cyan_lantern']);
});

test('victory heals stack per relic: Kindled Heart 6 then Ash Crown 3, two events, held order', () => {
  const s = wonState({ relics: ['kindled_heart', 'ash_crown'], player: { hp: 40 }, rewardOverride: 'heal' });
  const out = resolveVictory(s, null);
  const heals = out.events.filter((e) => e.t === 'heal');
  assert.deepEqual(heals.map((e) => [e.source, e.amount]), [['kindled_heart', 6], ['ash_crown', 3]]);
  assert.equal(out.state.player.hp, 49);
  // The clamp still holds: a near-full run heals only what is missing, relic by relic.
  const tight = wonState({ relics: ['kindled_heart', 'ash_crown'], player: { hp: 57 }, rewardOverride: 'heal' });
  const tightOut = resolveVictory(tight, null);
  assert.equal(tightOut.state.player.hp, 60, 'heal 6 then heal 3, clamped at the max');
  assert.deepEqual(tightOut.events.filter((e) => e.t === 'heal').map((e) => e.amount), [3, 0].slice(0, 1), 'only the first relic finds HP to mend');
});

test('Gold Vein: +10 gold after every fight, its own event beside the tier spoils', () => {
  const s = wonState({ relics: ['gold_vein'], rewardOverride: 'heal' });
  const out = resolveVictory(s, null);
  const golds = out.events.filter((e) => e.t === 'gold');
  assert.equal(golds.length, 2, 'the tier spoils and the relic\u2019s');
  assert.equal(golds[1].source, 'gold_vein');
  assert.equal(golds[1].amount, GOLD_VEIN_GAIN);
  assert.equal(out.state.player.gold, 99 + golds[0].amount + GOLD_VEIN_GAIN);
  // relicSum agrees for the accessor contract.
  assert.equal(relicSum(out.state, 'goldAfterFight'), GOLD_VEIN_GAIN);
});

test('Hearth Ash and Ash Crown: the rest bonus stacks (8 + 8) into the ONE rest heal', () => {
  // Walk real runs until one REACHES a rest site (rests live on rows 4-6, so the walk
  // takes a few fights), then heal with both bonuses held.
  let rested = null;
  for (let seed = 0; seed < 40 && !rested; seed += 1) {
    let s = newRun({ seed });
    for (let g = 0; g < 60 && s.phase !== 'ended'; g += 1) {
      if (s.phase === 'rest') { rested = { state: { ...s, relics: ['hearth_ash', 'ash_crown'] }, hp: s.player.hp }; break; }
      const acts = actions(s);
      const a = acts.find((x) => x.kind === 'travel' && x.nodeType === 'rest')
        ?? acts.find((x) => x.kind === 'play') ?? acts.find((x) => x.id === 'e1')
        ?? acts.find((x) => x.kind === 'travel') ?? acts.find((x) => x.kind === 'skip') ?? acts[0];
      if (!a) break;
      s = step(s, a.id).state;
    }
  }
  assert.ok(rested, 'some seed reaches a rest site inside the walk');
  const healed = step(rested.state, 'c');
  assert.equal(healed.state.player.hp, Math.min(rested.hp + 8 + HEARTH_HEAL + HEARTH_HEAL, rested.state.player.maxHp),
    'REST_HEAL 8 + Hearth Ash 8 + Ash Crown 8, one event');
  assert.deepEqual(healed.events.filter((e) => e.t === 'heal'),
    [{ t: 'heal', who: 'player', amount: healed.state.player.hp - rested.hp, source: 'rest' }]);
  // Control: the same site without the relics heals plain REST_HEAL.
  const plain = step({ ...rested.state, relics: ['kindled_heart'] }, 'c');
  assert.equal(plain.state.player.hp, Math.min(rested.hp + 8, plain.state.player.maxHp));
});

test('Flask Grip: quaffing a potion gains 2 Block, AFTER the potion resolves', () => {
  const s = relicCombat(['flask_grip'], { belt: ['stone_skin'] });
  const out = step(s, 'q1');
  assert.equal(out.state.potions.length, 0, 'the slot is consumed');
  assert.equal(out.state.player.block, 12 + FLASK_GRIP_BLOCK, 'Stone Skin\u2019s 12 plus the relic\u2019s 2');
  const blocks = out.events.filter((e) => e.t === 'block');
  assert.equal(blocks.length, 2, 'one block event for the potion, one for the relic');
  assert.equal(blocks[0].amount, 12, 'the potion\u2019s block lands first');
  assert.equal(blocks[0].source, undefined, 'the shared verb\u2019s event carries no source');
  assert.deepEqual(blocks[1], { t: 'block', who: 'player', amount: FLASK_GRIP_BLOCK, source: 'flask_grip' });
  // Zero draws: the hook is a fixed number.
  assert.equal(out.state.rngDraws, s.rngDraws);
});

test('gainRelic is the ONE acquisition path: it appends in order and applies Ember Heart once', () => {
  const s = newRun({ seed: 5 });
  const out = gainRelic(s, 'ember_heart', 'elite');
  assert.deepEqual(out.state.relics, ['kindled_heart', 'ember_heart'], 'appended in acquisition order');
  assert.equal(out.state.player.maxHp, s.player.maxHp + EMBER_HEART_HP, '+12 max HP at acquisition');
  assert.equal(out.state.player.hp, Math.min(out.state.player.maxHp, s.player.hp + EMBER_HEART_HP), 'gaining max HP heals it');
  assert.deepEqual(out.events, [{ t: 'relic_gained', relic: 'ember_heart', source: 'elite' }]);
  // An unknown id is a no-op, never a throw (a torn offer's guard).
  const torn = gainRelic(s, 'ghost_relic');
  assert.deepEqual(torn.state, s);
  assert.deepEqual(torn.events, []);
  // Zero draws.
  assert.equal(out.state.rngDraws, s.rngDraws);
});

/* --------------------------------------------------------------------- drops -- */

test('the elite drop is GUARANTEED and follows the 70/30 band exactly', () => {
  let commons = 0;
  let uncommons = 0;
  for (let seed = 0; seed < 200; seed += 1) {
    const s = wonState({ seed, nodeType: 'elite', rewardOverride: 'heal' });
    const out = resolveVictory(s, null);
    assert.equal(out.state.relics.length, 2, `seed ${seed}: exactly one relic beyond the starter`);
    const id = out.state.relics[1];
    // The band IS the pin: tier = intAt at the post-gold counter (the belt is full, so
    // the potion stage consumed nothing); a hit is the LOWEST 70 of 100.
    const wantsCommon = intAt(s.seed, s.rngDraws + 1, 100) < ELITE_COMMON_BAND;
    assert.equal(RELICS[id].tier, wantsCommon ? 'common' : 'uncommon', `seed ${seed}: the band decides the tier`);
    assert.ok(dropPool(s, wantsCommon ? 'common' : 'uncommon').includes(id), 'the id comes from that tier\u2019s not-held pool');
    if (wantsCommon) commons += 1; else uncommons += 1;
  }
  // Loose binomial bounds at N=200: the exact convention is pinned above per seed.
  assert.ok(commons > 110 && commons < 170, `common share ${commons}/200 near 70%`);
  assert.ok(uncommons > 30 && uncommons < 90, `uncommon share ${uncommons}/200 near 30%`);
});

test('the held relic never drops again: the pool filters, and empty pools are free', () => {
  // Hold every common: the band may still roll common, and the drop falls to uncommon.
  const allCommons = Object.keys(RELICS).filter((id) => RELICS[id].tier === 'common');
  for (let seed = 0; seed < 60; seed += 1) {
    const s = wonState({ seed, nodeType: 'elite', relics: allCommons, rewardOverride: 'heal' });
    const out = resolveVictory(s, null);
    assert.ok(out.state.relics.length === allCommons.length + 1, 'something still dropped');
    assert.equal(RELICS[out.state.relics.at(-1)].tier, 'uncommon', 'the exhausted tier fell to its sibling');
  }
  // Hold every common AND uncommon: both pools empty, the roll is suppressed — 0 draws,
  // nothing granted (impossible through play, free by the potions ruling).
  const held = Object.keys(RELICS).filter((id) => RELICS[id].tier !== 'rare');
  const dry = wonState({ relics: held, nodeType: 'elite', rewardOverride: 'heal' });
  const dryOut = resolveVictory(dry, null);
  assert.equal(dryOut.state.relics.length, held.length, 'nothing dropped');
  assert.equal(dryOut.state.rngDraws, dry.rngDraws + 1, 'gold only — the drop cost nothing');
  assert.equal(rollEliteRelicDrop(dry).draws, 0);
});

test('the boss offer: three DISTINCT not-held rares, exactly 3 draws, never a common (the full table)', () => {
  for (let seed = 0; seed < 80; seed += 1) {
    const s = wonState({ seed, nodeType: 'boss', player: { gold: 0 } });
    const out = resolveVictory(s, null);
    assert.equal(out.state.phase, 'reward', 'the boss victory OPENS the offer (the run ends at the pick)');
    assert.equal(out.state.reward.boss, true);
    assert.deepEqual(out.state.reward.cards, [], 'the boss grants no card (StS parity)');
    const offers = out.state.reward.relicOffers;
    assert.equal(offers.length, 3, `seed ${seed}: three offers`);
    assert.equal(new Set(offers).size, 3, 'no dupes');
    for (const id of offers) {
      assert.equal(RELICS[id].tier, 'rare', `${id} is rare`);
      assert.ok(!s.relics.includes(id), 'never an already-held relic');
    }
    assert.equal(out.state.rngDraws, s.rngDraws + 3, 'gold 0 (flat) + exactly 3 offer draws');
    // The roll is reproducible: pickAt over the not-held rare pool at the post-gold
    // counter. The FULL table covers the offer from rares alone, so the down-tier fill
    // (UX-1) never reaches the uncommon/common tiers and the stream is unchanged.
    assert.deepEqual(offers, pickAt(s.seed, s.rngDraws, dropPool(s, 'rare'), 3).picked);
  }
  // A torn save that already holds rares is offered what exists, DOWN-TIER (UX-1):
  // the 2 not-held rares, then the ONE uncommon fill — 3 real offers, never padded
  // beyond the pool, never an empty vault while anything is available.
  const held = wonState({ relics: Object.keys(RELICS).filter((id) => RELICS[id].tier === 'rare').slice(0, 3), nodeType: 'boss' });
  const short = resolveVictory(held, null);
  assert.deepEqual(short.state.reward.relicOffers.map((id) => RELICS[id].tier), ['rare', 'rare', 'uncommon'],
    'the not-held rares first, then the uncommon fill');
  assert.equal(short.state.rngDraws, held.rngDraws + 3, 'pickAt pays only for the picks it makes');
});

test('the boss pick r<n> settles the victory: a two-act run CLIMBS ON, a legacy one-act run ends', () => {
  const s = wonState({ nodeType: 'boss', rewardOverride: 'card' });
  const out = resolveVictory(s, null);
  const acts = actions(out.state);
  assert.deepEqual(acts.map((a) => a.id), ['r1', 'r2', 'r3', 's0'], 'the offer is exactly r1..r3 plus the skip');
  // Two-act run (newRun sets acts: 2): taking the first offer (the policies' documented
  // choice) does NOT end the run — the hero climbs into act 2 with everything held.
  const take = step(out.state, 'r1');
  assert.equal(take.state.phase, 'map', 'act 2 opens on the map');
  assert.equal(take.state.act, 2, 'the act advanced');
  assert.equal(take.state.outcome, null, 'the run is not over');
  assert.deepEqual(take.state.relics, [...s.relics, out.state.reward.relicOffers[0]], 'the relic is held');
  assert.equal(take.state.reward, null, 'the offer is consumed');
  assert.equal(take.state.player.maxHp, s.player.maxHp + 5, 'the climb bonus');
  assert.equal(take.state.player.hp, out.state.player.hp, 'the climb does NOT heal — the hp the victory left rides over untouched');
  assert.deepEqual(take.state.deck, s.deck, 'the deck carries over');
  assert.deepEqual(take.state.potions, s.potions, 'the belt carries over');
  assert.equal(take.state.player.gold, out.state.player.gold, 'the purse carries over (boss spoils included)');
  assert.equal(take.state.rngDraws > out.state.rngDraws, true, 'the act-2 map rolled at the transition');
  assert.deepEqual(take.events.map((e) => e.t), ['relic_gained', 'act_advance', 'max_hp'], 'the gain, then the climb (no heal — the ruling keeps the wound)');
  assert.equal(take.events[0].source, 'boss');
  // The transition's exact draw account (the chain doc's three terms), pinned as a
  // number for THIS state (seed 7, the pre-transition counter the test staged):
  // 12 act-2 layout draws + the newRun-format spacer (deck.length = 10) + the per-node
  // encounter rolls. A tautology here would have let the S9 review's P1 double-count
  // through — the number is the contract.
  assert.equal(take.state.rngDraws - out.state.rngDraws, 54, 'the transition consumed exactly the documented account');
  // Skip: StS lets you walk away; the climb stands anyway.
  const skip = step(out.state, 's0');
  assert.equal(skip.state.phase, 'map');
  assert.equal(skip.state.act, 2);
  assert.deepEqual(skip.state.relics, s.relics, 'nothing gained');
  assert.deepEqual(skip.events.map((e) => e.t), ['relic_skipped', 'act_advance', 'max_hp']);
  // A LEGACY one-act run (no `acts` field — pre-S9 save): the same pick ENDS in victory.
  const legacy = { ...s, act: undefined, acts: undefined };
  const legacyOut = resolveVictory(legacy, null);
  const legacyTake = step(legacyOut.state, 'r1');
  assert.equal(legacyTake.state.phase, 'ended');
  assert.equal(legacyTake.state.outcome, 'win');
  assert.deepEqual(legacyTake.events.map((e) => e.t), ['relic_gained', 'run_end'], 'the gain, then the run\u2019s end — the pre-S9 shape');
  // The surfaces count the relics both ways (a two-act mid-climb shows the count; the
  // legacy ended summary too).
  assert.equal(snapshot(take.state).relics.length, 2);
  const legacySkip = step(legacyOut.state, 's0');
  assert.match(observe(legacySkip.state), /relics 1/);
  assert.equal(snapshot(legacySkip.state).ended.relics, 1);
});

test('the boss pick applies acquisition passives: a max-HP rare through gainRelic (elite path)', () => {
  // Boss offers are rares only; Ember Heart (max HP) arrives on the ELITE path. Hold
  // every other common+uncommon so the guaranteed drop can only be Ember Heart.
  const held = Object.keys(RELICS).filter((id) => id !== 'ember_heart' && RELICS[id].tier !== 'rare');
  const s = wonState({ relics: held, nodeType: 'elite', rewardOverride: 'heal' });
  const out = resolveVictory(s, null);
  assert.deepEqual(out.state.relics.at(-1), 'ember_heart');
  assert.equal(out.state.player.maxHp, s.player.maxHp + EMBER_HEART_HP, 'the passive fired through the ONE path');
});

test('R6: a torn offer (unknown or held id) emits NO id; forcing a dead r-id is the one rejection', () => {
  // Torn rewards are validateSave-accepted (reward is not shape-checked): garbage offers
  // must never produce an id the resolver would refuse (the S4.1 inversion ruling).
  const torn = {
    ...wonState({ nodeType: 'boss' }),
    phase: 'reward',
    reward: { cards: [], relicOffers: ['ghost_relic', 'deep_well', 'ash_crown'], gold: 100, boss: true },
    relics: ['deep_well'], // index 1 is already held
  };
  assert.deepEqual(actions(torn).map((a) => a.id), ['r3', 's0'],
    'index 0 unknown and index 1 held emit nothing; the valid r3 and the skip remain');
  assert.equal(step(torn, 'r1').error.code, 2, 'forcing the refused id is the legal no-op rejection');
  assert.equal(step(torn, 'r4').error.code, 2, 'out of range too');
  const skipSettled = step(torn, 's0').state;
  assert.equal(skipSettled.reward, null, 'the skip settles the torn run — no softlock (a two-act run climbs: phase map)');
  assert.equal(skipSettled.phase, 'map');
  // And a reward with NO valid offer at all still has the skip.
  const allTorn = { ...torn, relics: ['deep_well', 'ash_crown', 'slag_crown'] };
  assert.deepEqual(actions(allTorn).map((a) => a.id), ['s0']);
  const allSettled = step(allTorn, 's0').state;
  assert.equal(allSettled.reward, null, 'the all-torn skip settles too');
  assert.equal(allSettled.phase, 'map');
});

/* ----------------------------------------------------------------- tolerance -- */

test('a torn held relic degrades everywhere: raw id, no hooks, nothing throws', () => {
  const s = { ...newRun({ seed: 5 }), relics: ['ghost_relic'] };
  assert.doesNotThrow(() => observe(s));
  assert.doesNotThrow(() => snapshot(s));
  assert.doesNotThrow(() => actions(s));
  assert.match(observe(s), /RELICS 1/, 'the header still counts it');
  const rows = snapshot(s).relics;
  assert.equal(rows[0].known, false, 'the row says it is unknown');
  assert.equal(rows[0].name, 'ghost_relic', 'the raw id is its own name');
  assert.equal(rows[0].tier, 'unknown');
  // No hooks: an unknown relic contributes nothing (Cyan Lantern\u2019s energy absent).
  const fight = step({ ...newRun({ seed: 5 }), relics: ['ghost_relic', 'cyan_lantern'] }, 'n1');
  assert.equal(fight.state.player.energy, fight.state.energyPerTurn + LANTERN_ENERGY, 'the ghost is inert, the real relic works');
  assert.equal(relicSum(s, 'firstTurnEnergy'), 0);
  assert.equal(activeRelicDefs(s).length, 0);
  // A non-array relics field (deeper torn shape) falls back to the legacy read.
  assert.deepEqual(relicList({ ...s, relics: 'garbage' }), ['kindled_heart']);
});

test('torn boss offers render without throwing: raw ids stay visible, no ids invented', () => {
  const torn = {
    ...wonState({ nodeType: 'boss' }),
    phase: 'reward',
    reward: { cards: [], relicOffers: 'garbage', gold: 100, boss: true },
  };
  assert.doesNotThrow(() => observe(torn));
  assert.doesNotThrow(() => snapshot(torn));
  assert.deepEqual(actions(torn).map((a) => a.id), ['s0'], 'no offers, but the way out exists');
  const rows = {
    ...wonState({ nodeType: 'boss' }),
    phase: 'reward',
    reward: { cards: [], relicOffers: [null, 'ghost_relic'], gold: 100, boss: true },
  };
  assert.doesNotThrow(() => observe(rows));
  assert.doesNotThrow(() => snapshot(rows));
  assert.deepEqual(actions(rows).map((a) => a.id), ['s0']);
  const snap = snapshot(rows).reward;
  assert.deepEqual(snap.relicOffers.map((o) => [o.known, o.actionId]), [[false, null], [false, null]],
    'both rows visible, neither pickable');
  assert.match(observe(rows), /ghost_relic/, 'the raw id renders');
});

/* ------------------------------------------------------------------ surfaces -- */

test('the surfaces: header count, snapshot rows, boss reward lines, elite spoils line', () => {
  const r = newRun({ seed: 5 });
  assert.match(observe(r), /RELICS 1/);
  assert.equal(snapshot(r).relics.length, 1);
  assert.equal(snapshot(r).relics[0].name, 'Kindled Heart');
  assert.equal(snapshot(r).relics[0].text, RELICS.kindled_heart.text, 'the sentence is the kernel\u2019s, verbatim');
  // Elite spoils line, like the gold one beside it.
  const elite = resolveVictory(wonState({ nodeType: 'elite' }), null);
  const name = RELICS[elite.state.reward.relic].name;
  assert.match(observe(elite.state), new RegExp(`spoils relic: ${name}`));
  assert.equal(snapshot(elite.state).reward.relicGained.relicId, elite.state.reward.relic);
  // The gained relic is IN the held list and the HUD chip counts it.
  assert.equal(snapshot(elite.state).relics.length, 2);
  // Boss offer lines.
  const boss = resolveVictory(wonState({ nodeType: 'boss' }), null);
  const dump = observe(boss.state);
  assert.match(dump, /REWARD — claim the warden\u2019s relic/);
  assert.match(dump, / r1 (Slag Crown|Deep Well|Ash Crown|Cinder Ward|Ash Ledger)/, 'the dump names a rare offer');
  assert.match(dump, / s0 walk away/);
  const bossSnap = snapshot(boss.state).reward;
  assert.equal(bossSnap.relicOffers.length, 3);
  assert.ok(bossSnap.relicOffers.every((o) => o.actionId && o.affordable && o.known));
  // Action lines: id + the stable relic id.
  const lines = K.observeActions ? null : null; void lines;
  const actionText = require0(boss.state);
  assert.match(actionText, /^r1 \w+$/m, 'the relic action line is id + relic id');
});

/** observeActions through the public kernel entry. */
function require0(state) {
  return K.observeActions(state);
}

/* -------------------------------------------------------------------- replay -- */

test('a real run through an elite drop and a boss pick replays hash-for-hash', () => {
  // Greedy everywhere except: at a boss relic offer take the first offered (the policies'
  // documented stance). The walker reaches the boss on some seed; the log replays through
  // the same machinery every other run does (the S4/S5 precedent).
  const driver = (seed) => {
    const greedy = makePolicy('greedy');
    let session = begin({ seed });
    const memory = {};
    for (let guard = 0; guard < 3000; guard += 1) {
      const st = session.state;
      if (st.phase === 'ended') break;
      const L = legal(session);
      let id;
      if (st.phase === 'reward' && st.reward?.relicOffers != null) {
        id = L.find((a) => a.kind === 'relic_pick')?.id;
      }
      id ??= greedy.choose({ session, state: st, legal: L, stepIndex: st.stepIndex, memory }).id;
      if (id == null) break;
      session = submit(session, id).session;
    }
    return session;
  };
  let picked = null;
  for (let seed = 1; seed <= 400 && !picked; seed += 1) {
    const run = driver(seed);
    const eliteDrop = run.events.some((e) => e.t === 'relic_gained' && e.source === 'elite');
    if (eliteDrop && run.state.outcome === 'win') picked = run;
  }
  assert.ok(picked, 'some seed in 1..400 kills an elite, drops its relic, and takes the warden\u2019s');
  const parsed = parseLog(renderLog(picked));
  assert.equal(parsed.ok, true, `log parses: ${JSON.stringify(parsed.problems ?? [])}`);
  const result = assertReplay(parsed);
  assert.equal(result.ok, true, `hash-for-hash: ${JSON.stringify(result.mismatches ?? [])}`);
  assert.equal(runHash(picked), result.finalHash);
  // The event trail carries the whole S7 story: the elite drop and the boss pick.
  assert.ok(picked.events.some((e) => e.t === 'relic_gained' && e.source === 'elite'));
  assert.ok(picked.events.some((e) => e.t === 'relic_gained' && e.source === 'boss'));
  assert.ok(picked.state.relics.length >= 3, 'starter + elite drop + boss pick');
});
