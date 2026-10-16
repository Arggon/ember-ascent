// Time-limited debuffs must tick down on BOTH sides of a fight.
//
// THE BUG THIS PINS (owner report): "when i attack that number at vulnerable do not
// decrease and stays for all the fight."
//
// Cause: `endTurn` decayed `next.player` only. `enemyTurn` reset each enemy's BLOCK but
// never its `statuses`, so an enemy's Vulnerable/Weak never ticked down. Bash applied
// Vulnerable 2 and the enemy displayed "Vulnerable 2" on every turn of the fight.
//
// This mattered beyond the display: the number shown to the player is the number of turns
// the debuff will apply, so a never-decaying debuff was strictly stronger than the card
// text implied, and Shockwave's entire premise (a LONGER debuff) was meaningless.
//
// Semantics pinned here, mirroring the player side exactly:
//   * the player is decayed at the end of the PLAYER turn
//   * an enemy is decayed at the end of the ENEMY turn
//   * so Vulnerable 2 survives the player's current turn and the next one, then expires
//   * Strength/Dexterity/Metallicize are permanent for the fight and must NOT decay
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, loadObserve, loadPower } from '../helpers/harness.mjs';

const K = await loadKernel();
const { newRun, actions, step, snapshot } = K;
await loadObserve();
const P = await loadPower();

const stacksOf = (combatant, key) =>
  (combatant.statuses ?? []).find((s) => s.key === key)?.stacks ?? 0;

/** Walk a run until a card that applies a named status is playable, then play it. */
function playStatusCard(seed, cardRe) {
  let state = newRun({ seed });
  for (let i = 0; i < 400; i += 1) {
    const snap = snapshot(state);
    if (snap.phase === 'combat') {
      const play = actions(state).find((a) => a.kind === 'play' && cardRe.test(a.cardId || ''));
      if (play) {
        const applied = snapshot(state).enemies.some((e) => e.statuses.length > 0);
        void applied;
        return { state: step(state, play.id).state, card: play.cardId };
      }
    }
    if (snap.phase === 'ended') break;
    const legal = actions(state);
    if (!legal.length) break;
    state = step(state, legal[0].id).state;
  }
  return null;
}

const endTurn = (state) => {
  const a = actions(state).find((x) => x.kind === 'end_turn');
  assert.ok(a, 'the turn can be ended');
  return step(state, a.id).state;
};

test('an ENEMY debuff ticks down each turn instead of lasting the whole fight', () => {
  const got = playStatusCard(1, /bash|shockwave|thunderclap|uppercut/);
  assert.ok(got, 'a debuff card was played in some run');

  const applied = snapshot(got.state).enemies.filter((e) => e.hp > 0);
  const target = applied.find((e) => e.statuses.length > 0);
  if (!target) return; // the card in this seed applied nothing to a survivor

  const key = target.statuses.find((s) => s.key === 'vulnerable' || s.key === 'weak').key;
  const first = stacksOf(target, key);
  assert.ok(first > 0, `the enemy starts with some ${key} (got ${first})`);

  // Over the next few turns the count must strictly decrease and reach zero.
  const seen = [first];
  let state = got.state;
  for (let t = 0; t < first + 2; t += 1) {
    if (snapshot(state).phase !== 'combat') break;
    state = endTurn(state);
    if (snapshot(state).phase !== 'combat') break;
    const live = snapshot(state).enemies.filter((e) => e.hp > 0);
    const same = live.find((e) => e.statuses.some((s) => s.key === key));
    seen.push(same ? stacksOf(same, key) : 0);
  }
  assert.ok(
    seen[seen.length - 1] < first,
    `the ${key} count must decrease across turns (saw ${seen.join(' -> ')})`,
  );
  assert.equal(
    seen[seen.length - 1],
    0,
    `the ${key} must expire rather than last the fight (saw ${seen.join(' -> ')})`,
  );
});

test('a PERMANENT status (Strength) does NOT decay on the enemy', () => {
  // Strength is documented as lasting the whole fight; the fix must not have changed that.
  const enemy = { statuses: { strength: 3, vulnerable: 2, weak: 1 } };
  const after = P.decayStatuses(enemy);
  assert.equal(after.statuses.strength, 3, 'Strength is untouched by decay');
  assert.equal(after.statuses.vulnerable, 1, 'Vulnerable ticks down by 1');
  // A spent debuff is REMOVED, not left at 0 — the app checks `> 0`, and a lingering 0 would
  // show a "Weak 0" pill to the player and keep the status in the state dump.
  assert.ok(!('weak' in after.statuses), `a spent Weak is removed, got ${JSON.stringify(after.statuses)}`);
});

test('the player still decays too, so the two sides stay symmetric', () => {
  const player = { statuses: { vulnerable: 2, weak: 3 } };
  const after = P.decayStatuses(player);
  assert.equal(after.statuses.vulnerable, 1);
  assert.equal(after.statuses.weak, 2);
});

test('a debuff still APPLIES on the turn it is played and the turn after', () => {
  // The decrease must come after the debuff has been useful, not before. Applied Vulnerable 2
  // should give two turns of +50%: the current turn and the next.
  const got = playStatusCard(1, /bash|shockwave|thunderclap|uppercut/);
  assert.ok(got, 'a debuff card was played');
  const before = snapshot(got.state).enemies.filter((e) => e.hp > 0);
  const target = before.find((e) => e.statuses.some((s) => s.key === 'vulnerable'));
  if (!target) return;
  const n = stacksOf(target, 'vulnerable');
  assert.ok(n >= 1, `Vulnerable was applied (got ${n})`);

  // End the turn: the enemy acts, then decays. One stack should remain if n > 1.
  const after = endTurn(got.state);
  if (snapshot(after).phase !== 'combat') return;
  const live = snapshot(after).enemies.filter((e) => e.hp > 0);
  const still = live.find((e) => e.statuses.some((s) => s.key === 'vulnerable'));
  const remaining = still ? stacksOf(still, 'vulnerable') : 0;
  assert.equal(
    remaining,
    Math.max(0, n - 1),
    `Vulnerable ${n} should become ${Math.max(0, n - 1)} after one enemy turn (got ${remaining})`,
  );
});
