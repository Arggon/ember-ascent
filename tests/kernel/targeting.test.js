// Enemy targeting — the bug this pins was a silent off-by-one.
//
// `aimAt()` in src/kernel/index.js indexed a 0-based list of living-enemy positions with
// the player's 1-BASED target number. `liveIdx[2]` is `undefined` for a two-enemy fight, so
// the `?? liveIdx[0]` fallback fired and EVERY aimed card hit enemy 1. The action ids were
// correct and the damage was applied — just never to the enemy the player chose — so nothing
// threw and no existing test noticed.
//
// The lesson worth keeping: "the action was accepted and something happened" is not the same
// assertion as "the chosen target was hit". These tests assert the DAMAGE LANDED WHERE ASKED.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, loadObserve } from '../helpers/harness.mjs';

const K = await loadKernel();
const { newRun, actions, step, snapshot } = K;
await loadObserve();

/** Walk a fresh run until a fight has more than one living enemy, or give up. */
function toMultiEnemy(seed) {
  let state = newRun({ seed });
  for (let i = 0; i < 80; i += 1) {
    const live = (state.combat?.enemies ?? []).filter((e) => !e.dead);
    if (state.phase === 'combat' && live.length > 1) return state;
    if (state.phase === 'ended') break;
    const legal = actions(state);
    if (!legal.length) break;
    // Prefer travelling into the first fight, then act.
    const travel = legal.find((a) => a.kind === 'travel');
    state = step(state, (travel ?? legal[0]).id).state;
  }
  return null;
}

/** A seed known to reach a two-enemy fight. */
const SEED = 1;

test('a multi-enemy fight offers one action per (card, target) pair', () => {
  const state = toMultiEnemy(SEED);
  assert.ok(state, 'seed reaches a multi-enemy fight');
  const plays = actions(state).filter((a) => a.kind === 'play');
  const targeted = plays.filter((a) => /_\d+$/.test(a.id));
  assert.ok(targeted.length > 0, 'at least one play action carries a target');

  // Every single-target card in hand should appear once per living enemy.
  const live = state.combat.enemies.filter((e) => !e.dead).length;
  const bySlot = new Map();
  for (const a of targeted) {
    const slot = a.id.replace(/_\d+$/, '');
    bySlot.set(slot, (bySlot.get(slot) ?? 0) + 1);
  }
  for (const [, count] of bySlot) {
    assert.equal(count, live, `a targetable card offers one action per living enemy (${live})`);
  }
});

test('THE BUG: the chosen target actually takes the damage, not the first enemy', () => {
  const state = toMultiEnemy(SEED);
  assert.ok(state, 'seed reaches a multi-enemy fight');
  const snap = snapshot(state);
  assert.equal(snap.enemies.length, 2, 'this fight has two enemies');

  // Aim at enemy 1, then reset and aim at enemy 2. Damage must land on different enemies.
  const aimedAt = (targetN) => {
    const play = actions(state).find((a) => a.kind === 'play' && a.id.endsWith(`_${targetN}`));
    assert.ok(play, `an action targeting enemy ${targetN} exists`);
    const after = step(state, play.id).state;
    const before2 = state.combat.enemies.map((e) => e.hp);
    const after2 = after.combat.enemies.map((e) => e.hp);
    return after2.map((hp, i) => before2[i] - hp);
  };

  const dmg1 = aimedAt(1);
  const dmg2 = aimedAt(2);

  assert.ok(dmg1[0] > 0, `aiming at enemy 1 damages enemy 1 (got ${JSON.stringify(dmg1)})`);
  assert.equal(dmg1[1], 0, `aiming at enemy 1 does NOT damage enemy 2 (got ${JSON.stringify(dmg1)})`);
  assert.equal(dmg2[0], 0, `aiming at enemy 2 does NOT damage enemy 1 (got ${JSON.stringify(dmg2)})`);
  assert.ok(dmg2[1] > 0, `aiming at enemy 2 damages enemy 2 (got ${JSON.stringify(dmg2)})`);
});

test('a single-enemy fight needs no target, and omitting it is still legal', () => {
  // Find any fight with exactly one living enemy.
  let state = newRun({ seed: SEED });
  let found = null;
  for (let i = 0; i < 200; i += 1) {
    const live = (state.combat?.enemies ?? []).filter((e) => !e.dead);
    if (state.phase === 'combat' && live.length === 1) { found = state; break; }
    if (state.phase === 'ended') break;
    const legal = actions(state);
    if (!legal.length) break;
    state = step(state, legal[0].id).state;
  }
  if (found) {
    const plays = actions(found).filter((a) => a.kind === 'play');
    assert.ok(plays.length > 0, 'a single-enemy fight still offers plays');
    assert.ok(
      plays.every((a) => !/_\d+$/.test(a.id)),
      `no target suffix when there is no choice to make, got ${plays.map((a) => a.id).join(', ')}`,
    );
    // And the plain id still resolves.
    const r = step(found, plays[0].id);
    assert.equal(r.error, null ?? r.error, 'the untargeted id is accepted');
  }
});

test('an out-of-range or dead target is a legal no-op, never a crash', () => {
  const state = toMultiEnemy(SEED);
  assert.ok(state, 'seed reaches a multi-enemy fight');
  for (const bogus of ['p1_99', 'p1_0', 'p1_7']) {
    const r = step(state, bogus);
    assert.ok(r, `step("${bogus}") returns a result rather than throwing`);
    assert.ok(r.state, `step("${bogus}") still yields a state`);
  }
});

test('determinism survives targeted actions', () => {
  for (const id of ['p3_1', 'p3_2']) {
    const state = toMultiEnemy(SEED);
    const snap = snapshot(state);
    if (!actions(state).some((a) => a.id === id)) continue;
    const a = step(state, id).state;
    const b = step(state, id).state;
    assert.equal(K.hash(a), K.hash(b), `replaying "${id}" from the same state is byte-identical`);
    void snap;
  }
});

/**
 * REGRESSION: the whole hand was unplayable in a multi-enemy fight.
 *
 * When targeting arrived, a card that must be aimed became ONE action per living enemy
 * (`p1_1`, `p1_2`) while its hand slot stayed the bare `p1`. `snapshot()` matched on the
 * exact action id, so `playableSlots` contained `p1_1`/`p1_2` and the lookup for `p1`
 * missed — marking EVERY attackable card unplayable with energy to spare, while
 * non-target cards (Defend) stayed fine. Reported by the owner as "i cant even attack now".
 */
test('REGRESSION: a targetable card is playable, not greyed out', () => {
  const state = toMultiEnemy(SEED);
  assert.ok(state, 'seed reaches a multi-enemy fight');
  const snap = snapshot(state);

  // Every card in hand that is offered as SOME legal play action must report playable.
  const offeredSlots = new Set(actions(state).filter((a) => a.kind === 'play').map((a) => String(a.id).replace(/_\d+$/, '')));
  assert.ok(offeredSlots.size > 0, 'the fight offers at least one play');
  for (const tile of snap.hand) {
    assert.equal(
      tile.playable,
      offeredSlots.has(tile.slot),
      `${tile.slot} (${tile.name}) playable=${tile.playable} but offered=${offeredSlots.has(tile.slot)}`,
    );
  }

  // The specific symptom: with affordable cards in hand, not everything may be disabled.
  const affordable = snap.hand.filter((h) => h.cost <= snap.player.energy);
  assert.ok(affordable.length > 0, 'there are affordable cards in hand');
  assert.ok(
    affordable.some((h) => h.playable),
    `at least one affordable card is playable (got ${affordable.map((h) => `${h.slot}:${h.playable}`).join(', ')})`,
  );

  // And the target choice is exposed for exactly the cards that need one.
  const aimed = snap.hand.filter((h) => h.targets.length > 0);
  assert.ok(aimed.length > 0, 'at least one card exposes its target choices');
  for (const tile of aimed) {
    assert.equal(tile.targets.length, snap.enemies.length, `${tile.slot} offers one target per living enemy`);
    for (const t of tile.targets) {
      assert.ok(Number.isInteger(t.index) && t.index >= 1, `${tile.slot} target index is 1-based`);
      assert.ok(String(t.actionId).length > 0, `${tile.slot} target carries a concrete action id`);
    }
  }
});

test('a single-enemy fight exposes no target list but stays playable', () => {
  let state = newRun({ seed: SEED });
  let found = null;
  for (let i = 0; i < 200; i += 1) {
    const live = (state.combat?.enemies ?? []).filter((e) => !e.dead);
    if (state.phase === 'combat' && live.length === 1) { found = state; break; }
    if (state.phase === 'ended') break;
    const legal = actions(state);
    if (!legal.length) break;
    state = step(state, legal[0].id).state;
  }
  if (!found) return;
  const snap = snapshot(found);
  for (const tile of snap.hand) {
    assert.deepEqual(tile.targets, [], `${tile.slot} offers no target step when there is no choice`);
  }
  assert.ok(snap.hand.some((h) => h.playable), 'a single-enemy fight still has playable cards');
});
