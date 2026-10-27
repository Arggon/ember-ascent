// Act 2 (S9) — the climb's own layout, economy bands, and the save rules that keep a
// torn acts field out of beginNextAct. The review's missing tests, promoted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRun, step, snapshot, validateSave } from '../../src/kernel/index.js';
import { FORMAT_VERSION, ENGINE_VERSION } from '../../src/kernel/state.js';
import { generateMap, ACT2_SHOP_ROW, ACT2_SHOP_SLOT, ACT2_EVENT_NODES, ACT_COUNT, ACT2_GOLD } from '../../src/kernel/rules/map.js'

test('act-2 layout: exactly one shop (row 4 slot 1) and two events (rows 3/5), across 60 seeds', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const { rows } = generateMap(seed, 0, 2);
    const flat = rows.flat();
    const shops = flat.filter((n) => n.type === 'shop');
    const events = flat.filter((n) => n.type === 'event');
    assert.equal(shops.length, 1, `seed ${seed}: one act-2 shop`);
    assert.equal(shops[0].id, `r${ACT2_SHOP_ROW}n${ACT2_SHOP_SLOT}`, `seed ${seed}: the shop owns its placed slot`);
    assert.equal(events.length, ACT2_EVENT_NODES.length, `seed ${seed}: two act-2 waysides`);
    for (const ev of events) {
      assert.ok(ACT2_EVENT_NODES.some((p) => p.row === Number(ev.id.slice(1, ev.id.indexOf('n')))), `seed ${seed}: the wayside sits on a documented row`);
    }
    assert.equal(flat.some((n) => n.type === 'boss'), true, `seed ${seed}: the act-2 boss row exists`);
  }
});

test('act-2 gold bands: every tier pays more than act 1, the boss stays flat', () => {
  // The bands are the economy's numbers — pinned directly (they rode golden hashes
  // alone before, which could not say WHY a purse moved).
  assert.deepEqual(ACT2_GOLD.combat_weak, [13, 22], 'weak: +30% over 10-17');
  assert.deepEqual(ACT2_GOLD.combat_strong, [33, 46], 'strong: +30% over 25-35');
  assert.deepEqual(ACT2_GOLD.elite, [65, 91], 'elite: +30% over 50-70');
  assert.deepEqual(ACT2_GOLD.boss, [130, 130], 'act 2 raises the warden to 130');
});

test('torn acts fields are refused at load, never crashed into at the climb', () => {
  const base = newRun({ seed: 7 });
  // The save envelope is FLAT: identity/progress fields at the top, the live state
  // nested under `state` (acts/act live INSIDE that state object).
  const problemsFor = (over) => validateSave({
    formatVersion: FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    contentVersion: base.contentVersion,
    seed: base.seed,
    character: base.character,
    difficulty: base.difficulty,
    stepIndex: base.stepIndex,
    rngDraws: base.rngDraws,
    state: { ...base, ...over },
  });
  // The engine can never produce these (S9 review P2: an acts>=3 save crashed step()).
  for (const bad of [{ acts: 3, act: 2 }, { acts: 0 }, { acts: 'two' }, { act: 3, acts: 2 }]) {
    const problems = problemsFor(bad);
    assert.ok(problems.some((p) => /acts/.test(p)), `acts/act shape ${JSON.stringify(bad)} must be refused: ${JSON.stringify(problems)}`);
  }
  // The legit shapes load clean.
  assert.deepEqual(problemsFor({ acts: 2, act: 1 }), [], 'act 1 of 2 loads');
  assert.deepEqual(problemsFor({ acts: 2, act: 2 }), [], 'act 2 of 2 loads');
  // Legacy: no acts field at all is the one-act run.
  const legacyState = { ...base };
  delete legacyState.acts; // `act` itself has been mandatory since the first save; only `acts` is the S9 optional
  assert.deepEqual(validateSave({
    formatVersion: FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    contentVersion: base.contentVersion,
    seed: base.seed,
    character: base.character,
    difficulty: base.difficulty,
    stepIndex: base.stepIndex,
    rngDraws: base.rngDraws,
    state: legacyState,
  }), [], 'a legacy one-act save loads');
  assert.equal(ACT_COUNT, 2, 'the engine ships two acts');
});

test('the act-2 boss skip ends a two-act run in victory (the review P2 crash is closed)', () => {
  // Stage a run standing at the act-2 boss reward, then skip: before the state.js guard
  // this shape crashed generateMap at the climb.
  const base = newRun({ seed: 7 });
  const s = { ...base, act: 2, phase: 'reward', reward: { cards: [], relicOffers: ['deep_well', 'ash_crown', 'slag_crown'], taken: null, gold: 100, boss: true } };
  const out = step(s, 's0');
  assert.equal(out.state.phase, 'ended', 'the act-2 skip ends the run');
  assert.equal(out.state.outcome, 'win', 'in victory');
});
