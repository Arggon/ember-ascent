// UX-7 — attack-damage status folding, both sides of a fight, announced AND resolved.
//
// THE REPORT THAT OPENED THIS SLICE: "Enemies buff are not working. If an enemy will
// deal 9 of dmg and has +2 strength his attack should be 11 but it's hitting only 9."
//
// The investigation's verdict first, because the pins below guard BOTH halves of it:
//
//   * The enemy side was ALREADY correct — rules/act.js strikeDamage() folds the enemy's
//     live Strength into every hit and into intentDamage()'s announced number, and both
//     the intent chips and the intent sentence read that folded value (an exhaustive sweep:
//     7043 resolved attacks and 5315 announced intents across every enemy × 120 seeds,
//     zero disagreements). The user's exact measurement could not be reproduced from any
//     build in the repo. These pins exist to keep it that way.
//
//   * The MIRROR side was broken — the player's Weak was folded NOWHERE: the `damage`
//     verb added Strength but ignored Weak, and the three exotic handlers (blood_hammer,
//     ash_harvest, climbing_heat) re-derived their Strength line by hand the same way. An enemy's
//     Weak applied to its own attacks (strikeDamage) while the hero's never did, so the
//     status text's own promise — "Weak — your attacks deal 25% less damage" — was a lie
//     whenever an enemy debuffed the hero. Fixed here with ONE shared helper
//     (rules/vocabulary.js playerStrike) used by all four sites.
//
//   * A move that buffs itself before striking had no resolution path: one runner per
//     move kind meant a combined "gain N Strength, then attack" could never land the
//     buff on its own strike. StS rules the buff applies BEFORE the strike in the same
//     move sequence — the attack runner now applies `move.strength` first (its
//     enemy_status event leads, the printed order is the event order) and the strike
//     reads the updated statuses; intentDamage folds the pending buff so the ANNOUNCED
//     number is the post-buff number. No shipped enemy uses the shape yet — the pin
//     holds it open with a temporary probe row (cleaned up in finally).
//
// Also pinned while in there (the brief's one-line audit, "held" outcomes):
//   * the hero's Vulnerable amplifies ENEMY attacks at the hero (×3/2, floored) — held;
//   * an enemy status chip in the snapshot speaks the ENEMY variant of the meaning
//     ("its attacks deal N more damage"), not the player's wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { combatState, content, loadKernel, loadStateMod, loadEncounters } from '../helpers/harness.mjs';
import { intentDamage } from '../../src/kernel/rules/act.js';
import { ENEMIES } from '../../src/kernel/rules/encounters.js';

const { step, snapshot } = await loadKernel();
const { freezeDeep } = await loadStateMod();
await content();

const endTurn = (state) => step(state, 'e1');

/* ---------------------------------------------- the enemy side: announce AND resolve */

test('an enemy with +2 Strength announcing 9 hits for 11 — the printed number is not the dealt number', async () => {
  // The Cinder Foreman's pick_swing is the only move printed as 9 (label A9x2); its
  // survey gives exactly +2 Strength — the user's report numbers, as a pin.
  const state = freezeDeep(await combatState('quench', {
    enemyId: 'cinder_foreman',
    enemyOver: { moveIndex: 1, statuses: { strength: 2 } },
  }));

  // The ANNOUNCEMENT folds the buff: 9 + 2 = 11 per hit, 22 over the two hits.
  const snap = snapshot(state);
  assert.equal(snap.enemies[0].intent.label, 'A9x2', 'the label stays the move name');
  assert.equal(snap.enemies[0].intent.damage, 22, 'the announced total is (9+2)×2');
  assert.equal(snap.enemies[0].intent.hits, 2);
  assert.match(snap.enemies[0].intent.text, /11/, 'the sentence reads the per-hit number');

  // The RESOLUTION lands the same number: one raw 11 per hit, in the event, each
  // reporting the hero HP AFTER that hit.
  const res = endTurn(state);
  const attacks = res.events.filter((e) => e.t === 'enemy_attack');
  assert.equal(attacks.length, 2, 'two hits');
  attacks.forEach((ev, h) => {
    assert.equal(ev.raw, 11, 'raw carries the buffed per-hit damage');
    assert.equal(ev.dealt, 11, 'no block: dealt equals raw');
    assert.equal(ev.blocked, 0);
    assert.equal(ev.hp, 60 - 11 * (h + 1), 'the event reports the hero HP after the hit');
  });
});

test('an intent built AFTER a strength buff shows the buffed number — intents re-read live statuses', async () => {
  // The Ash Cantor opens with its buff (script), so turn 2's intent is the first one
  // built after Strength 3 has landed: hex_strike printed 6 must announce 9. The state
  // stands where a real fight's SECOND turn begins — the opening intent already chosen
  // (intentStep 1), the buff move still to be resolved.
  let state = freezeDeep(await combatState('quench', { enemyId: 'ash_cantor', enemyOver: { moveIndex: 0, intentStep: 1 } }));

  const buffTurn = endTurn(state);
  assert.deepEqual(
    buffTurn.events.find((e) => e.t === 'enemy_status'),
    { t: 'enemy_status', enemy: 0, status: 'strength', stacks: 3 },
    'the buff lands on the enemy turn',
  );
  state = buffTurn.state;
  assert.equal(state.combat.enemies[0].statuses.strength, 3, 'the stacks are live state');

  // The NEXT intent was built after the buff: the announced number is the buffed one,
  // and the chip row and the sentence cannot disagree (they read intentDamage()).
  const snap = snapshot(state);
  assert.equal(snap.enemies[0].intent.damage, 9, '6 printed + 3 Strength announced as 9');
  assert.match(snap.enemies[0].intent.text, /9/);

  // And the strike lands exactly what was announced.
  const res = endTurn(state);
  const attack = res.events.find((e) => e.t === 'enemy_attack');
  assert.equal(attack.raw, 9);
  assert.equal(attack.dealt, 9);
});

test('an enemy with Weak deals less — add Strength, THEN multiply by 3/4, floored', async () => {
  // Chomp printed 11, Weak 1: floor(11 × 3/4) = 8. With Strength 2 too, the order pin:
  // add first (13), then floor(13 × 3/4) = 9 — multiplying the printed damage first
  // would give 8 + 2 = 10 instead.
  const weakOnly = endTurn(await combatState('quench', {
    enemyId: 'cinder_maw', enemyOver: { moveIndex: 0, statuses: { weak: 1 } },
  }));
  assert.equal(weakOnly.events.find((e) => e.t === 'enemy_attack').raw, 8);

  const weakAndStrong = endTurn(await combatState('quench', {
    enemyId: 'cinder_maw', enemyOver: { moveIndex: 0, statuses: { weak: 1, strength: 2 } },
  }));
  assert.equal(weakAndStrong.events.find((e) => e.t === 'enemy_attack').raw, 9, 'add, then multiply');
});

test('the enemy_attack event carries the block split honestly', async () => {
  // 5 Block against the Cantor's buffed 9: the event must say raw 9, blocked 5, dealt 4,
  // and the hero's HP must move by exactly dealt. The block is placed AFTER the Cantor's
  // opening buff turn (a new turn resets the hero's block to 0 before the fight starts).
  const state = freezeDeep(await combatState('quench', { enemyId: 'ash_cantor', enemyOver: { moveIndex: 0, intentStep: 1 } }));
  const afterBuff = endTurn(state).state;
  const armed = freezeDeep({ ...afterBuff, player: { ...afterBuff.player, block: 5 } });
  const res = endTurn(armed);
  const attack = res.events.find((e) => e.t === 'enemy_attack');
  assert.equal(attack.raw, 9);
  assert.equal(attack.blocked, 5);
  assert.equal(attack.dealt, 4);
});

/* --------------------------------------------------- the same-move buff, then strike */

test('a same-move "gain Strength, then strike" lands the buff on ITS OWN strike', async () => {
  // No shipped enemy uses the combined shape yet; the pin holds the RULE open with a
  // temporary probe row (added to the table, removed in finally — tests run one file
  // per process, so nothing else can see it).
  const probe = '_probe_brat';
  ENEMIES[probe] = {
    id: probe,
    name: 'Probe Brat',
    maxHp: [30, 30],
    moves: [
      { id: 'grow_slam', label: 'PWR2 A9', kind: 'attack', damage: 9, strength: 2 },
      { id: 'sulk', label: 'B4', kind: 'block', block: 4 },
    ],
    noRepeat: 2,
  };
  try {
    // BEFORE the buff lands, the intent already announces the post-buff number:
    // (9 + 2) — the announced number is the number the strike will land.
    const intentState = await combatState('quench', { enemyId: probe, enemyOver: { moveIndex: 0 } });
    assert.equal(intentDamage(intentState.combat.enemies[0]), 11, 'the intent folds the pending buff');
    assert.equal(snapshot(intentState).enemies[0].intent.damage, 11);

    const res = endTurn(intentState);
    assert.deepEqual(
      res.events.map((e) => e.t).filter((t) => t.startsWith('enemy')),
      ['enemy_status', 'enemy_attack'],
      'the buff event LEADS the strike, the printed order is the event order',
    );
    assert.deepEqual(
      res.events.find((e) => e.t === 'enemy_status'),
      { t: 'enemy_status', enemy: 0, status: 'strength', stacks: 2 },
    );
    const attack = res.events.find((e) => e.t === 'enemy_attack');
    assert.equal(attack.raw, 11, '9 printed + 2 self-buffed, on the SAME move');

    // The stacks persist for the NEXT move too (a buff is not consumed by its strike).
    assert.equal(res.state.combat.enemies[0].statuses.strength, 2);
  } finally {
    delete ENEMIES[probe];
  }
});

/* ---------------------------------------- the mirror side: the weakened hero's attacks */

test('a WEAKENED hero attacks for less — the status text\'s own promise, now kept', async () => {
  // Strike printed 6, Weak 1: floor(6 × 3/4) = 4. Before the fix the verb ignored Weak
  // and dealt 6 — the Slag Ooze's WK1, the Warden's WK2 and the Foreman's WK2 were
  // offensive no-ops.
  const res = step(await combatState('hammerfall', { statuses: { weak: 1 } }), 'p1');
  const hit = res.events.find((e) => e.t === 'damage');
  assert.equal(hit.raw, 4, 'the raw number carries the Weak fold');
  assert.equal(hit.dealt, 4);
});

test('the Weak fold applies AFTER Strength — add, then multiply, on the player side too', async () => {
  // Strike 6 + Strength 2 = 8, then floor(8 × 3/4) = 6. Multiplying first would read
  // floor(6 × 3/4) + 2 = 6 — the two orders disagree exactly here, so this pins order.
  const res = step(await combatState('hammerfall', { statuses: { weak: 1, strength: 2 } }), 'p1');
  assert.equal(res.events.find((e) => e.t === 'damage').raw, 6);
});

test('the exotic handlers fold the hero\'s Weak through the same helper — blood_hammer', async () => {
  // 15 printed, Weak 1: floor(15 × 3/4) = 11. The handler used to hand-add Strength and
  // skip Weak entirely.
  const res = step(await combatState('blood_hammer', { statuses: { weak: 1 }, hp: 40 }), 'p1');
  const hit = res.events.find((e) => e.t === 'damage');
  assert.equal(hit.raw, 11);
  assert.equal(res.state.player.hp, 38, 'the 2-HP cost still landed first');
});

/* ------------------------------------- the audit's "held" half, pinned so it stays */

test('an enemy block move folds the enemy\'s own Dexterity, like the player\'s block verb', async () => {
  // No shipped enemy can gain Dexterity yet, so this holds a future shape honest: the
  // status text promises "Block it gains is N higher" — same fold, both sides.
  const probe = '_probe_turtle';
  ENEMIES[probe] = {
    id: probe,
    name: 'Probe Turtle',
    maxHp: [30, 30],
    moves: [
      { id: 'shell_up', label: 'B9', kind: 'block', block: 9 },
      { id: 'wait', label: 'B4', kind: 'block', block: 4 },
    ],
    noRepeat: 2,
  };
  try {
    const res = endTurn(await combatState('quench', {
      enemyId: probe, enemyOver: { moveIndex: 0, statuses: { dexterity: 2 } },
    }));
    assert.deepEqual(
      res.events.find((e) => e.t === 'enemy_block'),
      { t: 'enemy_block', enemy: 0, amount: 11 },
      '9 printed + 2 Dexterity',
    );
    assert.equal(res.state.combat.enemies[0].block, 11);
  } finally {
    delete ENEMIES[probe];
  }
});

test('the hero\'s Vulnerable amplifies ENEMY attacks at the hero (×3/2, floored)', async () => {
  // Vulnerable 2, not 1: the shipped decay semantics tick the hero's debuffs at the END
  // of the hero's own turn — BEFORE the enemy acts — so the first swing after the debuff
  // lands sees one stack remaining and amplifies off it.
  const res = endTurn(await combatState('quench', {
    enemyId: 'cinder_maw', enemyOver: { moveIndex: 0 }, statuses: { vulnerable: 2 },
  }));
  const attack = res.events.find((e) => e.t === 'enemy_attack');
  assert.equal(attack.raw, 11, 'the enemy\'s own buffs fold first');
  assert.equal(attack.dealt, 16, 'floor(11 × 3/2) through the hero\'s Vulnerable');
});

test('an ENEMY status chip speaks the enemy variant of the meaning, not the player\'s', async () => {
  const en = await combatState('quench', { enemyId: 'ash_cantor', enemyOver: { moveIndex: 0, statuses: { strength: 3 } } });
  assert.equal(snapshot(en).enemies[0].statuses[0].text, 'Strength 3 — its attacks deal 3 more damage');
  const es = await combatState('quench', { enemyId: 'ash_cantor', enemyOver: { moveIndex: 0, statuses: { strength: 3 } } });
  assert.equal(snapshot(es, { lang: 'es' }).enemies[0].statuses[0].text, 'Fuerza 3 — sus ataques infligen 3 de daño más');
});

test('each snapshot status row publishes its kind (the one buff/debuff classification, from STATUS_KINDS)', async () => {
  // The web splits the enemy card into an ABOVE-the-art buffs row and a foot debuffs
  // row off this field — a surface must never string-match status keys, so the kernel's
  // own table (rules/vocabulary.js STATUS_KINDS, the same source the Purge Flask list
  // derives from) is what the row carries. Additive metadata only: every existing field is
  // untouched, and the compact dump reads statuses through statusLine, so no dump byte
  // moves (the goldens pin that separately).
  const st = await combatState('quench', {
    enemyId: 'cinder_maw', enemyOver: { moveIndex: 0, statuses: { strength: 2, dexterity: 1, metallicize: 3, vulnerable: 2, weak: 1, parry: 6, bleed: 3, poison: 4 } },
  });
  const kinds = Object.fromEntries(snapshot(st).enemies[0].statuses.map((r) => [r.key, r.kind]));
  assert.deepEqual(kinds, {
    strength: 'buff', dexterity: 'buff', metallicize: 'buff', parry: 'buff',
    vulnerable: 'debuff', weak: 'debuff', bleed: 'debuff', poison: 'debuff',
  }, 'the golpes-discretos trio is classified once, in the ONE table');
});

test('a BLEED-RIDER strike keeps its damage fold — the Ash Matriarch\u2019s ember_soulfire (A7x2 BLEED2)', async () => {
  // The rider is additive to the golpe, not a replacement of its fold: the strike still
  // folds Strength/Weak into `raw`, and each LANDED strike leaves the hero Bleeding.
  const res = endTurn(await combatState('quench', {
    enemyId: 'ash_wraith_elite', enemyOver: { moveIndex: 1, intentStep: 1, statuses: { strength: 1 } },
  }));
  const hits = res.events.filter((e) => e.t === 'enemy_attack');
  assert.deepEqual(hits.map((h) => h.raw), [8, 8], '7 printed + 1 Strength per golpe — the fold is untouched');
  assert.deepEqual(
    res.events.filter((e) => e.t === 'player_status'),
    [{ t: 'player_status', enemy: 0, status: 'bleed', stacks: 2 }, { t: 'player_status', enemy: 0, status: 'bleed', stacks: 2 }],
    'one rider per LANDED golpe, exactly as the honest label "A7x2 BLEED2" promises',
  );
  assert.equal(res.state.player.statuses.bleed, 4);
  assert.equal(res.state.player.hp, 60 - 16, '16 damage landed before the hex');
});
