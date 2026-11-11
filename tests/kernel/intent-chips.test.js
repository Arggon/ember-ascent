// INTENT + STATUS CHIPS for the character readouts (feature: enemies and heroes speak in
// chips). The defect this file guards: the enemy card printed its intent as a full
// sentence ("Will attack for 7 and block 5.") and its statuses as sentence pills — long
// text where the player wants an icon and a number. The web must never parse the intent
// label or re-derive a move's numbers, so:
//
//   * the enemy ROW carries the STRUCTURED facts (`intent.block`, `intent.statuses`)
//     beside the sentence, kernel-side;
//   * intentChips() turns those facts into the same chip shape a card face carries, with
//     the describeIntent sentence as every chip's explain — one click says the whole move;
//   * the numbers are the engine's own (intentDamage), so a chip and the intent
//     sentence can never disagree.
//
// Pins: thrash → attack 7 + block 5; a debuff move → a status chip; a buff move → a
// self Strength chip and its block; the ES rows word the same chips in Spanish.

import test from 'node:test';
import assert from 'node:assert/strict';
import { combatState, makeEnemy, loadKernel, loadEncounters } from '../helpers/harness.mjs';

const K = await loadKernel();
const { ENEMIES } = await loadEncounters();

/** The snapshot's first enemy row. */
const enemy0 = (state, opts) => K.snapshot(state, opts).enemies[0];

test('the enemy row carries the structured intent facts beside its sentence', async () => {
  // jaw_worm's thrash (moveIndex 1): attack 7 AND block 5 — the both-facts shape.
  const s = await combatState('strike', { enemyId: 'jaw_worm', enemyOver: { moveIndex: 1 } });
  const e = enemy0(s);
  assert.equal(e.intent.kind, 'attack');
  assert.equal(e.intent.damage, 7, 'the damage fact is the engine intentDamage');
  assert.equal(e.intent.block, 5, 'the block fact rides the row, unparsed');
  assert.deepEqual(e.intent.statuses, [], 'a plain attack applies no status');
  assert.match(e.intent.text, /Will attack for 7 and block 5/, 'the sentence rides beside the facts');
});

test('intentChips: thrash reads as attack 7 + block 5', async () => {
  const s = await combatState('strike', { enemyId: 'jaw_worm', enemyOver: { moveIndex: 1 } });
  const chips = K.intentChips(enemy0(s));
  assert.deepEqual(chips.map((c) => [c.verb, c.num]), [['attack', '7'], ['block', '5']],
    'one chip per fact, in move order');
  for (const chip of chips) {
    assert.equal(chip.explain, 'Will attack for 7 and block 5.',
      'every chip explains the WHOLE move with the kernel sentence');
    assert.ok(chip.label.length > 0, 'each chip titles itself');
  }
  // A multi-hit attack reads per-hit × hits, the row's own convention.
  const multi = K.intentChips({
    intent: { kind: 'attack', damage: 12, hits: 3, text: 'Will attack for 4 damage 3 times' },
  });
  assert.equal(multi[0].num, '4×3', 'the total splits onto the chip per-hit × hits');
});

test('intentChips: a debuff move yields a status chip; a buff yields self Strength and block', async () => {
  const debuff = await combatState('strike', { enemyId: 'acid_slime', enemyOver: { moveIndex: 1 } });
  const dchips = K.intentChips(enemy0(debuff));
  assert.deepEqual(dchips.map((c) => [c.verb, c.status, c.num]), [['status', 'weak', '+1']],
    'the applied status is a chip, stacks and all');
  assert.match(dchips[0].explain, /Will apply 1 Weak to you/, 'the explain is the intent sentence');

  const buff = await combatState('strike', { enemyId: 'jaw_worm', enemyOver: { moveIndex: 2 } });
  const bchips = K.intentChips(enemy0(buff));
  assert.deepEqual(bchips.map((c) => [c.verb, c.status ?? null, c.num]),
    [['status', 'strength', '+3'], ['block', null, '6']],
    'a buff chips its self Strength and its block, in its sentence\u2019s clause order');
  assert.equal(bchips[0].status, 'strength');
});

test('the rider moves chip their hexes: soulfire is attack 7×2 + Bleed +2, spur_set is Parry +20', async () => {
  // The Ash Matriarch's soulfire ("A7x2 BLEED2"): the attack chip stays per-hit × hits,
  // and the bleed rider is a status chip ON YOU, after the attack in resolution order.
  const matriarch = await combatState('strike', { enemyId: 'ash_wraith_elite', enemyOver: { moveIndex: 1 } });
  const mrow = enemy0(matriarch);
  assert.equal(mrow.intent.label, 'A7x2 BLEED2', 'the label is honest about the rider');
  assert.equal(mrow.intent.damage, 14, 'intentDamage keeps announcing the TOTAL (7×2)');
  assert.deepEqual(mrow.intent.statuses, [{ status: 'bleed', stacks: 2 }]);
  const mchips = K.intentChips(mrow);
  assert.deepEqual(mchips.map((c) => [c.verb, c.status ?? null, c.num]), [['attack', null, '7×2'], ['status', 'bleed', '+2']]);
  assert.match(mchips[0].explain, /Will attack for 7 damage 2 times, and leave 2 Bleed on you/);

  // The Slag Crawler's spur_set ("PARRY20"): a self-buff chips its Parry like its
  // Strength does, `to: 'self'` stamped.
  const crawler = await combatState('strike', { enemyId: 'slag_crawler', enemyOver: { moveIndex: 3 } });
  const crow = enemy0(crawler);
  assert.equal(crow.intent.label, 'PARRY20');
  assert.deepEqual(crow.intent.statuses, [{ status: 'parry', stacks: 20, to: 'self' }]);
  const cchips = K.intentChips(crow);
  assert.deepEqual(cchips.map((c) => [c.verb, c.status, c.num]), [['status', 'parry', '+20']]);
  assert.equal(cchips[0].label, 'Parry');
  assert.match(cchips[0].explain, /Will power up: gain 20 Parry/);
});

test('the rider sentences word themselves in Spanish too', async () => {
  const matriarch = await combatState('strike', { enemyId: 'ash_wraith_elite', enemyOver: { moveIndex: 1 } });
  const mrow = enemy0(matriarch, { lang: 'es' });
  const mchips = K.intentChips(mrow, 'es');
  assert.match(mchips[0].explain, /Atacará 2 veces con 7 de daño, y te dejará 2 de Sangrado/);
  assert.equal(mchips[1].label, 'Sangrado');

  const crawler = await combatState('strike', { enemyId: 'slag_crawler', enemyOver: { moveIndex: 3 } });
  const crow = enemy0(crawler, { lang: 'es' });
  const cchips = K.intentChips(crow, 'es');
  assert.match(cchips[0].explain, /Se potenciará: ganará 20 de Parada/);
  assert.equal(cchips[0].label, 'Parada');
});

test('the intent facts and chips word themselves in Spanish too', async () => {
  const s = await combatState('strike', { enemyId: 'jaw_worm', enemyOver: { moveIndex: 1 } });
  const e = enemy0(s, { lang: 'es' });
  assert.equal(e.intent.block, 5, 'the facts are language-free');
  const chips = K.intentChips(e, 'es');
  assert.equal(chips[0].label, 'Ataque');
  assert.equal(chips[1].label, 'Bloqueo');
  assert.match(chips[0].explain, /Atacará con 7 de daño y se cubrirá con 5 de Bloqueo/,
    'the ES explain is the ES intent sentence');
});

test('an intent with no chip-expressible facts yields no chips — never a guess', () => {
  assert.deepEqual(K.intentChips(null), []);
  assert.deepEqual(K.intentChips({ intent: { kind: 'unknown', label: 'Stare' } }), []);
});
