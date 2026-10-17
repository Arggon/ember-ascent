// B2 Tempers: one permanent modifier per card instance, offered at rest sites.
//
// Pins: default runs untouched; a tempers run's rest offers 3 seeded (card, temper) pairs
// as t1..t3 next to heal/leave; each temper changes what the card resolves; the log
// header carries the flag and replay matches a pinned golden hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel } from '../helpers/harness.mjs';
import { begin, submit, legal, renderLog, parseLog, assertReplay, runHash } from '../../src/surface/session.js';
import { temperEffects } from '../../src/kernel/rules/tempers.js';

const K = await loadKernel();
const { newRun, step, hash } = K;

/** Greedy driver to the first rest site of a tempers run. */
function toFirstRest(seed) {
  let s = begin({ seed, tempers: true });
  for (let g = 0; g < 300 && s.state.phase !== 'ended'; g += 1) {
    if (s.state.phase === 'rest') return s;
    const L = legal(s).map((a) => a.id);
    const pick = L.find((i) => /^p\d+(_1)?$/.test(i)) || L.find((i) => i === 'e1') || L.find((i) => /^n/.test(i)) || L.find((i) => i === 's1') || L[0];
    s = submit(s, pick).session;
  }
  return null;
}

test('default run has no tempers and an unchanged hash', () => {
  const a = newRun({ seed: 3 });
  assert.equal('tempers' in a, false);
  assert.equal(hash(a), hash(newRun({ seed: 3, tempers: false })));
});

test('a tempers rest offers t1..t3 beside heal and leave, and tempering is permanent', () => {
  const s = toFirstRest(1);
  assert.ok(s, 'seed 1 reaches a rest site');
  assert.deepEqual(legal(s).map((a) => a.id), ['c', 'e1', 't1', 't2', 't3']);
  const offer = legal(s).find((a) => a.id === 't1').offer;
  const after = submit(s, 't1').session;
  assert.equal(after.state.phase, 'map');
  assert.equal(after.state.tempers[offer.uid], offer.temper);
  assert.equal(after.state.temperOffers, null);
});

test('temper effect lists', () => {
  const strike = [{ verb: 'damage', amount: 6 }];
  assert.deepEqual(temperEffects(strike, undefined), strike);
  assert.deepEqual(temperEffects(strike, 'quenched'), [...strike, { verb: 'block', amount: 3 }]);
  assert.deepEqual(temperEffects(strike, 'redhot'), [{ verb: 'damage', amount: 9 }]);
  assert.deepEqual(temperEffects(strike, 'balanced'), [...strike, { verb: 'draw', amount: 1 }, { verb: 'exhaust' }]);
});

test('a Red-hot Hammerfall deals 9 and costs 2 HP in a real fight', () => {
  const base = newRun({ seed: 2, tempers: true });
  const strikes = base.deck.filter((c) => c.cardId === 'strike').map((c) => c.uid);
  const tempered = { ...base, tempers: Object.fromEntries(strikes.map((u) => [u, 'redhot'])) };
  let s = step(tempered, 'n1').state;
  const slot = s.combat.hand.findIndex((c) => c.cardId === 'strike');
  assert.ok(slot >= 0, 'a Hammerfall is in the opening hand');
  const hp0 = s.player.hp;
  const enemyHp0 = s.combat.enemies[0].hp;
  s = step(s, `p${slot + 1}`).state;
  assert.equal(s.player.hp, hp0 - 2);
  const dealt = enemyHp0 - s.combat.enemies[0].hp;
  assert.ok(dealt >= 9 || s.combat.enemies[0].dead, `dealt ${dealt}`);
});

test('log header carries the flag and replay matches the golden hash', () => {
  let s = toFirstRest(1);
  s = submit(s, 't3').session;
  const parsed = parseLog(renderLog(s));
  assert.equal(parsed.header.tempers, true);
  assert.equal(assertReplay(parsed).ok, true);
  assert.equal(runHash(s), GOLDEN);
});

const GOLDEN = 'sha256:51ba6d87e88ba5ff74b4a94801a1d04df0b361f717ee104fff74d0fd41258ba6';

// ---------------------------------------------------------------------------
// Visible tempers: every rendering of a tempered card shows what it really plays.
// ---------------------------------------------------------------------------

/** Seed-2 opening hand with one Red-hot Hammerfall and one Balanced Quench. */
function temperedOpening() {
  const base = newRun({ seed: 2, tempers: true });
  const strikes = base.deck.filter((c) => c.cardId === 'strike');
  const defend = base.deck.find((c) => c.cardId === 'defend');
  const tempers = {};
  for (const c of strikes) tempers[c.uid] = 'redhot';
  tempers[defend.uid] = 'balanced';
  const s = step({ ...base, tempers }, 'n1').state;
  assert.equal(s.phase, 'combat');
  return s;
}

test('CLI HAND dump shows the tempered numbers and a temper tag', () => {
  const s = temperedOpening();
  const hand = K.observe(s).split('\n');
  const lines = s.combat.hand.map((c, i) => hand.find((l) => l.startsWith(` ${i + 1} `)));
  s.combat.hand.forEach((c, i) => {
    const t = s.tempers[c.uid];
    if (c.cardId === 'strike') assert.match(lines[i], /Hammerfall +A9 \[RH\]$/, `a Red-hot Hammerfall reads A9 [RH], got "${lines[i]}"`);
    else if (t === 'balanced') assert.match(lines[i], /B5 D1 EXH \[BAL\]$/, `a Balanced Quench reads B5 D1 EXH [BAL], got "${lines[i]}"`);
    else assert.doesNotMatch(lines[i], /\[/, 'an untempered card carries no tag');
  });
  assert.ok(lines.some((l) => /\[RH\]/.test(l)), 'the opening hand holds a Red-hot Hammerfall');
});

test('a default run renders the hand exactly as before (no tags, base numbers)', () => {
  const s = step(newRun({ seed: 2 }), 'n1').state;
  const dump = K.observe(s);
  assert.doesNotMatch(dump, /\[(RH|Q|BAL)\]/);
  assert.match(dump, /Hammerfall +A6$/m);
});

test('GUI snapshot: a Red-hot Hammerfall says Deal 9 and names its temper and HP cost', () => {
  const s = temperedOpening();
  const hand = K.snapshot(s).hand;
  const hot = hand.find((c) => c.cardId === 'strike');
  assert.equal(hot.temper, 'redhot');
  assert.equal(hot.temperName, 'Red-hot');
  assert.equal(hot.summary, 'A9');
  assert.match(hot.description, /Deal 9 damage/);
  assert.doesNotMatch(hot.description, /Deal 6 damage/);
  assert.match(hot.description, /Lose 2 HP when played\.$/);
  const bal = hand.find((c) => c.temper === 'balanced');
  assert.ok(bal, 'the Balanced Quench is in hand');
  assert.equal(bal.temperName, 'Balanced');
  assert.match(bal.description, /Gain 5 Block\. Draw 1 card\. Exhaust/);
  const plain = hand.find((c) => c.cardId === 'defend' && c.temper === null);
  if (plain) assert.equal(plain.description, 'Gain 5 Block.');
});

test('what the card says is what the card does: shown damage equals dealt damage', () => {
  const s = temperedOpening();
  const slot = s.combat.hand.findIndex((c) => c.cardId === 'strike');
  const shown = Number(/Deal (\d+) damage/.exec(K.snapshot(s).hand[slot].description)[1]);
  const before = s.combat.enemies[0].hp + s.combat.enemies[0].block;
  const after = step(s, `p${slot + 1}`).state.combat.enemies[0];
  assert.equal(before - (after.hp + after.block), shown);
});
