// Combat-only statuses must not survive a fight.
//
// THE BUG THIS PINS (owner report): "The cards that gave you strength are too powerful
// because they accumulate to the entire game. if you get one of it after the first fights
// you can start staking it and each attack deal tons of dmg." Reported alongside a victory
// screenshot showing Strength 34 and three straight wins.
//
// Cause: `startCombat()` reset the player's block and energy but CARRIED `statuses` forward,
// while every enemy's statuses were (correctly) reset per spawn. The game's own glossary
// says Strength "Lasts the whole fight", so the accumulation contradicted the documented
// rule and turned one early Inflame into unbounded damage for the rest of the run.
//
// The fix resets `player.statuses` when a combat STARTS. `beginTurn` must NOT do this —
// a buff has to survive the turns within one fight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, loadDescribe } from '../helpers/harness.mjs';

const K = await loadKernel();
const { newRun, actions, step, snapshot } = K;
await loadDescribe();

/** Walk a run, recording the player's Strength at the start of every combat. */
function strengthByCombat(seed) {
  const out = [];
  let state = newRun({ seed });
  let lastCombatKey = null;
  for (let i = 0; i < 500; i += 1) {
    const snap = snapshot(state);
    if (snap.phase === 'combat') {
      const key = `${snap.floor}:${state.combat?.nodeId ?? 'x'}`;
      if (key !== lastCombatKey) {
        lastCombatKey = key;
        out.push({
          floor: snap.floor,
          strength: snap.player.statuses.find((s) => s.key === 'strength')?.stacks ?? 0,
        });
      }
    }
    if (snap.phase === 'ended') break;
    const legal = actions(state);
    if (!legal.length) break;
    state = step(state, legal[0].id).state;
  }
  return out;
}

test('a fight BEGINS with no carry-over Strength, however the last fight ended', () => {
  // Every combat must start clean. Any non-zero opening Strength is the accumulation bug.
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
    const combats = strengthByCombat(seed);
    for (const c of combats) {
      assert.equal(
        c.strength,
        0,
        `seed ${seed}: combat at floor ${c.floor} began with Strength ${c.strength} (must be 0)`,
      );
    }
  }
});

test('no player status survives into the map phase', () => {
  // After a won fight the player returns to the map. Nothing combat-only may be left on them.
  for (const seed of [1, 2, 3, 5, 8]) {
    let state = newRun({ seed });
    for (let i = 0; i < 400; i += 1) {
      const snap = snapshot(state);
      if (snap.phase === 'map' && snap.floor >= 0) {
        const carried = snap.player.statuses.filter((s) => s.stacks > 0);
        assert.deepEqual(
          carried.map((s) => `${s.key}:${s.stacks}`),
          [],
          `seed ${seed}: combat statuses survived onto the map (${JSON.stringify(carried)})`,
        );
      }
      if (snap.phase === 'ended') break;
      const legal = actions(state);
      if (!legal.length) break;
      state = step(state, legal[0].id).state;
    }
  }
});

test('Strength gained DURING a fight still applies for the rest of that fight', () => {
  // The complement of the fix: resetting at combat start must not break the buff itself.
  // Find a fight, apply Strength directly through a real card if one is in hand, and assert
  // it is still present on the following player turn.
  let found = null;
  for (const seed of [1, 2, 3, 5, 8, 13]) {
    let state = newRun({ seed });
    for (let i = 0; i < 400; i += 1) {
      const snap = snapshot(state);
      if (snap.phase === 'combat') {
        const play = actions(state).find((a) => a.kind === 'play' && /flex|inflame/.test(a.cardId || ''));
        if (play) {
          const after = step(state, play.id).state;
          const gained = snapshot(after).player.statuses.find((s) => s.key === 'strength')?.stacks ?? 0;
          if (gained > 0) { found = { seed, before: state, after, gained }; break; }
        }
      }
      if (snap.phase === 'ended') break;
      const legal = actions(state);
      if (!legal.length) break;
      state = step(state, legal[0].id).state;
    }
    if (found) break;
  }
  assert.ok(found, 'a Strength card was played in some run');

  // End the turn: the buff must survive into the next turn of the SAME fight.
  const endTurn = actions(found.after).find((a) => a.kind === 'end_turn');
  assert.ok(endTurn, 'the turn can be ended');
  const nextTurn = step(found.after, endTurn.id).state;
  const still = snapshot(nextTurn).player.statuses.find((s) => s.key === 'strength')?.stacks ?? 0;
  assert.ok(
    still > 0,
    `seed ${found.seed}: Strength ${found.gained} did not survive to the next turn of the fight (got ${still})`,
  );
});
