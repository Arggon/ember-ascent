// tests/kernel/card-fold-preview.test.js — the hand's card face speaks the LIVE numbers.
//
// WHAT IS PINNED HERE:
//   * snapshotHand derives a fold context from the live combat state (player Strength /
//     Weak / Dexterity, and `vuln` only when exactly ONE enemy is alive and Vulnerable)
//     and passes it to describeCard, so a combat-phase hand tile prints the folded number
//     as an explicit em-dash rider AFTER the printed one — never silently.
//   * The fold's math is the engine's own: playerStrike (Strength added, then Weak ×3/4
//     floored), vulnerableAmplify (×3/2 floored), blockGain (printed + Dexterity). The
//     three custom handlers that fold Strength by hand (blood_hammer, ash_harvest, climbing_heat)
//     carry the same rider, and AOE claims the Vulnerable clause only when the
//     amplification is unambiguous: a lone vulnerable body every hit lands on.
//   * A clean state renders byte-identically to the printed card, in both languages.
//   * THE STRONGEST PIN: the previewed number EQUALS the `raw` the engine actually lands
//     when the play is driven through step() — not a re-derivation that agrees by luck.
import test from 'node:test';
import assert from 'node:assert/strict';
import { combatState, makeEnemy, loadKernel, loadEncounters } from '../helpers/harness.mjs';

const K = await loadKernel();
const { ENEMIES } = await loadEncounters();

/** The description of slot p1 in a combat state. */
const p1 = (state, opts) => K.snapshot(state, opts).hand[0].description;

/** The first damage event the player's play produced. */
async function land(state, slot = 'p1') {
  const action = K.actions(state).find((a) => a.kind === 'play' && a.id.startsWith(slot));
  assert.ok(action, `no play action for ${slot}; got ${JSON.stringify(K.actions(state).map((a) => a.id))}`);
  const out = K.step(state, action.id);
  assert.equal(out.error ?? null, null, `the play was rejected: ${JSON.stringify(out.error)}`);
  return out.events.find((e) => e.t === 'damage' && e.source === 'player');
}

test('Strength folds into an attack, printed number first (EN)', async () => {
  const s = await combatState('hammerfall', { statuses: { strength: 3 } });
  assert.equal(p1(s), 'Deal 6 damage to the enemy — 9 with Strength 3.');
});

test('Strength folds in Spanish through the same template', async () => {
  const s = await combatState('hammerfall', { statuses: { strength: 2 } });
  assert.equal(p1(s, { lang: 'es' }), 'Infliges 6 de daño al enemigo — 8 con Fuerza 2.');
});

test('Weak folds as ×3/4 floored, and names itself', async () => {
  const s = await combatState('hammerfall', { statuses: { weak: 1 } });
  assert.equal(p1(s), 'Deal 6 damage to the enemy — 4 with Weak.');
});

test('a single alive Vulnerable target gets the ×3/2 clause', async () => {
  const s = await combatState('anvil_blow', {
    enemies: [makeEnemy(ENEMIES.cinder_maw, { statuses: { vulnerable: 2 } })],
  });
  // Anvil Blow's second sentence (the Vulnerable it applies) follows, so the damage clause
  // is pinned by its shape rather than by end-of-string.
  assert.match(p1(s), /^Deal 8 damage to the enemy — 12 against Vulnerable\./);
});

test('a clean state is byte-identical to the printed card', async () => {
  assert.equal(p1(await combatState('hammerfall')), 'Deal 6 damage to the enemy.');
  assert.equal(p1(await combatState('quench')), 'Gain 5 Block.');
});

test('Dexterity folds into Block as a parenthesised number', async () => {
  const s = await combatState('quench', { statuses: { dexterity: 2 } });
  assert.equal(p1(s), 'Gain 5 (7) Block.');
});

test('a multi-hit card folds per hit and says so', async () => {
  const s = await combatState('anvil_rain', { statuses: { strength: 2 } });
  assert.equal(p1(s), 'Deal 6 damage to the enemy 3 times — 8 with Strength 2 per hit.');
});

test('a Red-hot temper folds from the tempered base, not the printed one', async () => {
  const s = await combatState('hammerfall', { statuses: { strength: 3 } });
  s.tempers = { HAND: 'redhot' };
  const desc = p1(s);
  assert.match(desc, /^Deal 9 damage to the enemy — 12 with Strength 3\./);
  assert.match(desc, /Lose 2 HP when played\.$/);
});

test('the custom handlers carry the same rider; a mixed AOE set never claims Vulnerable', async () => {
  const hemo = await combatState('blood_hammer', { statuses: { strength: 3 } });
  assert.equal(p1(hemo), 'Lose 2 HP. Deal 15 damage — 18 with Strength 3.');

  const ash_harvest = await combatState('ash_harvest', {
    statuses: { strength: 3 },
    enemies: [makeEnemy(ENEMIES.cinder_maw), makeEnemy(ENEMIES.cinder_maw, { statuses: { vulnerable: 2 } })],
  });
  const desc = p1(ash_harvest);
  assert.equal(desc, 'Deal 4 damage to ALL enemies — 7 with Strength 3 each.');
  assert.doesNotMatch(desc, /Vulnerable/, 'one AOE number cannot speak for a mixed target set');
});

test('AOE over ONE vulnerable body claims the clause: every hit lands on that body', async () => {
  const storm = await combatState('cinder_storm', {
    enemies: [makeEnemy(ENEMIES.cinder_maw, { statuses: { vulnerable: 2 } })],
  });
  assert.equal(p1(storm), 'Deal 3 damage to ALL enemies 4 times — 4 against Vulnerable per hit.');
  const hit = await land(storm);
  assert.equal(hit.raw, 4, 'the previewed 4 is the raw each hit lands (3 × 3/2 floored)');

  const ash_harvest = await combatState('ash_harvest', {
    statuses: { strength: 3 },
    enemies: [makeEnemy(ENEMIES.cinder_maw, { statuses: { vulnerable: 2 } })],
  });
  assert.equal(p1(ash_harvest), 'Deal 4 damage to ALL enemies — 7 with Strength 3, 10 against Vulnerable each.');
  const swing = await land(ash_harvest);
  assert.equal(swing.raw, 10, 'the previewed 10 is the raw the engine lands (7 × 3/2 floored)');
});

test('a played Climbing Heat keeps the rider: grown sentence plus the Strength fold', async () => {
  const s = await combatState('climbing_heat', { statuses: { strength: 3 }, perPlay: 5 });
  assert.equal(p1(s), 'Deal 13 damage (+5 more each time you play it) — 16 with Strength 3.');
  const hit = await land(s);
  assert.equal(hit.raw, 16, 'the previewed 16 is the raw the engine lands (13 + Strength 3)');
});

test('the previewed number equals the damage the engine lands', async () => {
  const strike = await combatState('hammerfall', { statuses: { strength: 3 } });
  const shown = Number(/— (\d+) with Strength 3\./.exec(p1(strike))[1]);
  const hit = await land(strike);
  assert.equal(shown, 9);
  assert.equal(hit.raw, shown, 'Hammerfall previewed 9 and must land 9');

  const anvil_blow = await combatState('anvil_blow', {
    enemies: [makeEnemy(ENEMIES.cinder_maw, { statuses: { vulnerable: 2 } })],
  });
  const shownVuln = Number(/— (\d+) against Vulnerable\./.exec(p1(anvil_blow))[1]);
  const amplified = await land(anvil_blow);
  assert.equal(shownVuln, 12);
  assert.equal(amplified.raw, shownVuln, 'Anvil Blow previewed 12 and must land 12');
});

/* ------------------------------------------------------- PARITY-2b: the chip fold */
//
// The CHIP ROW follows the same fold: on a fully chip-covered card the sentence is
// hidden, so the aimed variant must move the icon's number too — through the SAME
// resolvers (playerStrike / vulnerableAmplify / blockGain), keyed exactly like
// descriptionsByTarget, and published ONLY where a variant actually differs.

const hand0 = (state, opts) => K.snapshot(state, opts).hand[0];

test('the resting chip folds the live Strength, and the explain re-words the landed number', async () => {
  const s = await combatState('hammerfall', { statuses: { strength: 3 } });
  const chip = hand0(s).chips[0];
  assert.equal(chip.num, '9', 'the damage chip says the number the play lands, not the print');
  assert.equal(chip.explain, 'Deal 9 damage.');
  // The math is the engine's own: 6 + Strength 3 through playerStrike.
  const hit = await land(s);
  assert.equal(hit.raw, Number(chip.num), 'the chip previewed the raw the play lands');
  // A clean state stays byte-identical to the printed card.
  const clean = hand0(await combatState('hammerfall')).chips[0];
  assert.equal(clean.num, '6');
  assert.equal(clean.explain, 'Deal 6 damage.');
});

test('chipsByTarget: aiming at the Vulnerable enemy swaps the chip to the amplified number', async () => {
  const s = await combatState('hammerfall', {
    enemies: [makeEnemy(ENEMIES.cinder_maw), makeEnemy(ENEMIES.cinder_maw, { statuses: { vulnerable: 2 } })],
  });
  const row = hand0(s);
  // Keyed EXACTLY like descriptionsByTarget: the 1-based living slots, the same filter.
  assert.ok(row.descriptionsByTarget, 'the sentence variants exist for this field');
  assert.equal(row.chipsByTarget['2'][0].num, '9', 'the Vulnerable enemy\u2019s chip says 9 (6 × 3/2 floored)');
  assert.equal(row.chipsByTarget['2'][0].explain, 'Deal 9 damage.');
  // The healthy neighbour gets NO key: its variant is the resting face, byte-identical.
  assert.equal(row.chipsByTarget['1'], undefined, 'a clean enemy publishes no key');
  assert.equal(row.chips[0].num, '6', 'the base row keeps the resting 6');
});

test('chipsByTarget publishes nothing when no enemy is Vulnerable', async () => {
  const s = await combatState('hammerfall', {
    enemies: [makeEnemy(ENEMIES.cinder_maw), makeEnemy(ENEMIES.cinder_maw)],
  });
  const row = hand0(s);
  assert.equal(row.chipsByTarget, null, 'a clean field adds zero payload');
  assert.equal(row.chips[0].num, '6');
});

test('a block chip folds Dexterity through blockGain', async () => {
  const s = await combatState('quench', { statuses: { dexterity: 2 } });
  const chip = hand0(s).chips[0];
  assert.equal(chip.verb, 'block');
  assert.equal(chip.num, '7', 'Quench 5 + Dexterity 2 lands 7');
  assert.equal(chip.explain, 'Gain 7 Block — it soaks damage and is spent at the start of your next turn.');
});

test('the golpes-discretos cards preview their hexes in plain words (EN and ES)', async () => {
  const { combatState: cs } = await import('../helpers/harness.mjs');
  assert.equal(p1(await cs('slag_barb')), 'Deal 4 damage to the enemy. Apply 3 Bleed to the enemy — it loses 3 HP every time it makes an attack strike.');
  assert.equal(p1(await cs('kiln_fume')), 'Apply 4 Poison to the enemy — it loses 4 HP at the end of each of its turns.');
  assert.equal(p1(await cs('anvil_guard')), 'Gain 6 Parry — each attack strike against you has a 6% chance to be blocked completely.');
  assert.equal(p1(await cs('anvil_guard', {}), { lang: 'es' }), 'Ganas 6 de Parada — cada golpe de ataque contra ti tiene un 6% de probabilidad de ser bloqueado por completo.');
});

test('Slag Barb’s previewed number is the raw the play lands (the strongest pin, on the new card)', async () => {
  const { combatState: cs } = await import('../helpers/harness.mjs');
  const s = await cs('slag_barb', { statuses: { strength: 2 } });
  assert.equal(p1(s), 'Deal 4 damage to the enemy — 6 with Strength 2. Apply 3 Bleed to the enemy — it loses 3 HP every time it makes an attack strike.');
  const landed = await land(s);
  assert.equal(landed.raw, 6, 'the rider after the strike never moves the damage fold');
  assert.equal(landed.parried, undefined, 'and the fold runs through attackHit unchanged');
});
