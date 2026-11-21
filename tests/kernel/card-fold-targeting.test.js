// tests/kernel/card-fold-targeting.test.js — the per-target fold of a hand tile.
//
// WHAT IS PINNED HERE:
//   * With SEVERAL enemies alive the aimed card's own `description` keeps the honest
//     no-vuln print: the target is the player's choice, so no single sentence may claim
//     the ×3/2. The Vulnerable fold moves into `descriptionsByTarget` instead — one
//     sentence per LIVING enemy, keyed '1', '2', ... by living position: the SAME key as
//     the aim actions (`p1_1`, `p1_2`, whose targetEnemyIndex is k) and the GUI's `aimed`.
//   * Each variant is the FULL sentence for that enemy, so a healthy neighbour prints the
//     resting face byte-for-byte and a Vulnerable one adds `— N against Vulnerable.` The
//     player-status riders (Strength here) compose per variant exactly as they do on the
//     single-target face — `', '`-joined, printed number first.
//   * A clean field costs zero payload: no variant differs, so `descriptionsByTarget` stays
//     null and the renderer keeps falling back to `description`.
//   * Skills (no aim actions) and AOE (`target: 'all'`) never carry variants, and over a
//     mixed field never claim a Vulnerable clause — one AOE number cannot speak for a set
//     that amplifies differently. A dead enemy holds no slot: the keys re-index to the
//     surviving living positions, the same k the re-numbered aim actions carry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { combatState, makeEnemy, loadKernel, loadEncounters } from '../helpers/harness.mjs';

const K = await loadKernel();
const { ENEMIES } = await loadEncounters();

/** A Cinder Maw; `over` carries the per-enemy statuses a case needs. */
const worm = (over = {}) => makeEnemy(ENEMIES.cinder_maw, over);

/** Slot p1's tile in a combat state. */
const tile = (state) => K.snapshot(state).hand[0];

const VULN = { vulnerable: 2 };
const PLAIN = 'Deal 6 damage to the enemy.';
const VULN_9 = 'Deal 6 damage to the enemy — 9 against Vulnerable.';

test('2 alive, the SECOND Vulnerable: resting face on top, folded variant keyed 2', async () => {
  const s = await combatState('hammerfall', { enemies: [worm(), worm({ statuses: VULN })] });
  const card = tile(s);

  // The top-level sentence is the honest no-vuln print — the player picks the target.
  assert.equal(card.description, PLAIN);

  // Keys are the 1-based LIVING positions, the same k the aim actions carry.
  assert.deepEqual(Object.keys(card.descriptionsByTarget).sort(), ['1', '2']);
  assert.equal(card.descriptionsByTarget['1'], PLAIN, 'the healthy neighbour prints the resting face');
  assert.equal(card.descriptionsByTarget['2'], VULN_9, 'the Vulnerable enemy speaks its own amplified number');

  // ...and those keys really are the aim actions': p1_k aims at living index k-1.
  assert.deepEqual(card.targets, [
    { index: 1, actionId: 'p1_1' },
    { index: 2, actionId: 'p1_2' },
  ]);
  const aims = K.actions(s).filter((a) => a.kind === 'play' && a.id.startsWith('p1_'));
  assert.deepEqual(aims.map((a) => [a.id, a.targetEnemyIndex]), [['p1_1', 0], ['p1_2', 1]]);
});

test('2 alive, the FIRST Vulnerable: the mirror case keys the fold to 1', async () => {
  const s = await combatState('hammerfall', { enemies: [worm({ statuses: VULN }), worm()] });
  const card = tile(s);

  assert.equal(card.description, PLAIN);
  assert.equal(card.descriptionsByTarget['1'], VULN_9);
  assert.equal(card.descriptionsByTarget['2'], PLAIN);
  assert.doesNotMatch(card.descriptionsByTarget['2'], /Vulnerable/);
});

test('Strength composes inside each variant, printed number first', async () => {
  const s = await combatState('hammerfall', {
    statuses: { strength: 3 },
    enemies: [worm(), worm({ statuses: VULN })],
  });
  const card = tile(s);

  // playerStrike(6, Strength 3) = 9; vulnerableAmplify(9) = 13.
  assert.equal(card.description, 'Deal 6 damage to the enemy — 9 with Strength 3.');
  assert.equal(card.descriptionsByTarget['1'], 'Deal 6 damage to the enemy — 9 with Strength 3.');
  assert.equal(
    card.descriptionsByTarget['2'],
    'Deal 6 damage to the enemy — 9 with Strength 3, 13 against Vulnerable.',
    'the riders compose with ", ", the Vulnerable clause last',
  );
});

test('a clean field adds zero payload: null, and the resting face', async () => {
  const s = await combatState('hammerfall', { enemies: [worm(), worm()] });
  const card = tile(s);

  assert.equal(card.descriptionsByTarget, null);
  assert.equal(card.description, PLAIN);
});

test('a dead middle enemy re-indexes the rows: keys follow the surviving aim slots', async () => {
  const s = await combatState('hammerfall', {
    enemies: [worm(), worm({ dead: true }), worm({ statuses: VULN })],
  });
  const card = tile(s);

  // The dead worm holds no slot: keys are the 1-based LIVING positions, and the
  // surviving rows are the healthy one (the resting face) and the Vulnerable one.
  assert.deepEqual(Object.keys(card.descriptionsByTarget).sort(), ['1', '2']);
  assert.equal(card.descriptionsByTarget['1'], PLAIN, 'the healthy survivor prints the resting face');
  assert.equal(card.descriptionsByTarget['2'], VULN_9, 'the Vulnerable survivor speaks its own amplified number');

  // ...and the aim actions re-index the same way: p1_k aims at living index k-1, so the
  // key a sentence is keyed by is the key the GUI's aimed state resolves the play with.
  assert.deepEqual(card.targets, [
    { index: 1, actionId: 'p1_1' },
    { index: 2, actionId: 'p1_2' },
  ]);
  const aims = K.actions(s).filter((a) => a.kind === 'play' && a.id.startsWith('p1_'));
  assert.deepEqual(aims.map((a) => [a.id, a.targetEnemyIndex]), [['p1_1', 0], ['p1_2', 1]]);
});

test('skills and AOE never carry variants and never claim Vulnerable', async () => {
  const field = [worm(), worm({ statuses: VULN })];

  const quench = tile(await combatState('quench', { enemies: field }));
  assert.equal(quench.descriptionsByTarget, null, 'a skill has no aim actions, so no per-target face');
  assert.deepEqual(quench.targets, []);
  assert.equal(quench.description, 'Gain 5 Block.');
  assert.doesNotMatch(quench.description, /Vulnerable/);

  const storm = tile(await combatState('cinder_storm', { enemies: field }));
  assert.equal(storm.descriptionsByTarget, null, 'one AOE number cannot speak for a mixed target set');
  assert.deepEqual(storm.targets, []);
  assert.equal(storm.description, 'Deal 3 damage to ALL enemies 4 times.');
  assert.doesNotMatch(storm.description, /Vulnerable/);
});
