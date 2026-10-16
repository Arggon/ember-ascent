// tests/cards/cards.test.js — per-card behaviour for every shipped card id.
//
// Each row is {id, givenState, action, expect}. Inputs are deep-frozen before the step,
// so any accidental write inside rules throws instead of silently diverging (R1/R3).
//
// Numbers below are OBSERVED outputs of the shipped build with a pinned fixture
// (seed 5, stepIndex 10, rngDraws 90, 60/60 HP, 5 energy, Jaw Worm 40/44, five-card
// dummy draw pile) — not hand-derived. A change in any of them is a real behaviour change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { combatState, content, dummyPile, loadKernel, loadStateMod } from '../helpers/harness.mjs';
import { newRun } from '../../src/kernel/index.js';
// DEF-1: the shipped card count is DERIVED from the content bundle, never written as a
// literal here. A hardcoded 42 is a trap: adding a 43rd card to content would fail this
// file for the wrong reason (a stale test) instead of the right one (the behaviour of the
// new card is untested). `tests/content/bundle-drift.test.js` is what keeps the bundle and
// cards.json honest with each other, so this file can simply trust the bundle's length —
// and it still fails if the two disagree, because loadContent() validates the bundle.
import { cardsBundle } from '../../src/kernel/content/cards.bundle.js';

const { step, hash } = await loadKernel();
const { freezeDeep } = await loadStateMod();
const C = await content();

/** How many cards the shipped bundle actually declares. */
const SHIPPED_CARDS = cardsBundle.cards.length;

/** Play the single card in hand against a pinned Jaw Worm and return the state. */
async function playCard(cardId, over = {}) {
  const state = freezeDeep(await combatState(cardId, over));
  const res = step(state, 'p1');
  assert.equal(res.error, null, `${cardId}: play must not be rejected`);
  return res;
}

/** Assert a subset of the pinned deltas for one card. */
function expectCard(res, cardId, e) {
  const s = res.state;
  if (e.energy !== undefined) assert.equal(s.player.energy, e.energy, `${cardId}: energy`);
  if (e.hp !== undefined) assert.equal(s.player.hp, e.hp, `${cardId}: player HP`);
  if (e.block !== undefined) assert.equal(s.player.block, e.block, `${cardId}: block`);
  if (e.statuses) assert.deepEqual(s.player.statuses, e.statuses, `${cardId}: player statuses`);
  if (e.enemyHp !== undefined) assert.deepEqual(s.combat.enemies.map((x) => x.hp), e.enemyHp, `${cardId}: enemy HP`);
  if (e.enemyStatuses) assert.deepEqual(s.combat.enemies.map((x) => x.statuses), e.enemyStatuses, `${cardId}: enemy statuses`);
  if (e.hand !== undefined) assert.equal(s.combat.hand.length, e.hand, `${cardId}: hand size`);
  if (e.discard !== undefined) assert.equal(s.combat.discard.length, e.discard, `${cardId}: discard size`);
  if (e.exhaust !== undefined) assert.equal(s.combat.exhaust.length, e.exhaust, `${cardId}: exhaust size`);
  if (e.powers) assert.deepEqual(s.powers, e.powers, `${cardId}: powers`);
  if (e.events) assert.deepEqual(res.events.map((x) => x.t), e.events, `${cardId}: event stream`);
}

// --- named exemplars required by the brief: plain damage / block / draw / multi-hit / exhaust ---

test('strike — plain damage card', async () => {
  const res = await playCard('strike');
  expectCard(res, 'strike', { energy: 4, enemyHp: [34], discard: 1, events: ['damage'] });
});

test('defend — block card', async () => {
  const res = await playCard('defend');
  expectCard(res, 'defend', { energy: 4, block: 5, enemyHp: [40], discard: 1, events: ['block'] });
});

test('pommel — damage + draw card', async () => {
  const res = await playCard('pommel');
  expectCard(res, 'pommel', { energy: 4, enemyHp: [31], hand: 1, events: ['damage', 'draw'] });
});

test('twin_strike — multi-hit card (two separate hits)', async () => {
  const res = await playCard('twin_strike');
  expectCard(res, 'twin_strike', { energy: 4, enemyHp: [30], events: ['damage', 'damage'] });
});

test('pummel — multi-hit card that then exhausts', async () => {
  const res = await playCard('pummel');
  expectCard(res, 'pummel', { energy: 4, enemyHp: [32], exhaust: 1, discard: 0 });
  assert.equal(res.state.combat.exhaust[0].cardId, 'pummel', 'exhausted card is the played one');
});

test('impervious — block card that exhausts, filed exactly once', async () => {
  const res = await playCard('impervious');
  expectCard(res, 'impervious', { energy: 3, block: 30, exhaust: 1, discard: 0 });
  assert.equal(res.state.combat.exhaust[0].cardId, 'impervious');
});

// --- each of the 11 exotic handlers ---

const EXOTICS = [
  ['bloodletting', { statuses: {} }, { energy: 7, hp: 57, events: ['self_damage', 'energy'] }],
  ['hemokinesis', { statuses: {} }, { energy: 4, hp: 58, enemyHp: [25], events: ['self_damage', 'damage'] }],
  ['reaper', { hp: 54 }, { energy: 3, hp: 58, enemyHp: [36], events: ['damage', 'heal'] }],
  ['limit_break', { statuses: { strength: 3 } }, { energy: 4, statuses: { strength: 6 }, events: ['status'] }],
  ['offering', { statuses: {} }, { energy: 7, hp: 54, hand: 3, events: ['self_damage', 'energy', 'draw'] }],
  ['combust', { statuses: {} }, { powers: { combust: 1 }, events: ['power'] }],
  ['dark_embrace', { statuses: {} }, { powers: { dark_embrace: 1 }, events: ['power'] }],
  ['feel_no_pain', { statuses: {} }, { powers: { feel_no_pain: 1 }, events: ['power'] }],
  ['rupture', { statuses: {} }, { powers: { rupture: 1 }, events: ['power'] }],
  ['entrench', { block: 6 }, { energy: 3, block: 12, events: ['block'] }],
  ['rampage', { statuses: {} }, { energy: 4, enemyHp: [32], events: ['damage', 'grow'] }],
];

for (const [id, over, expected] of EXOTICS) {
  test(`exotic handler: ${id}`, async () => {
    const deck =
      id === 'rampage'
        ? [...newRun({ seed: 5 }).deck, { uid: 'HAND', cardId: 'rampage', perPlay: 0 }]
        : undefined;
    const res = await playCard(id, { ...over, deck });
    expectCard(res, id, expected);
    if (id === 'rampage') {
      // The growth is the card's entire identity: it must land on the RUN's deck
      // instance, not merely appear in this step's events.
      const inDeck = res.state.deck.filter((c) => c.cardId === 'rampage');
      assert.deepEqual(inDeck.map((c) => c.perPlay), [5], 'rampage keeps +5 after it is played');
    }
    if (['combust', 'dark_embrace', 'feel_no_pain', 'rupture'].includes(id)) {
      assert.equal(res.state.powers[id], 1, `${id} power gained`);
    }
  });
}

test('entrench is a no-op with no block, and limit_break with no Strength', async () => {
  const noBlock = await playCard('entrench', { block: 0 });
  expectCard(noBlock, 'entrench', { block: 0, events: ['noop'] });
  const noStrength = await playCard('limit_break', { statuses: {} });
  expectCard(noStrength, 'limit_break', { statuses: {}, events: ['noop'] });
});

// --- every shipped card id is playable, deterministic, and mutation-safe ---

test(`all ${SHIPPED_CARDS} shipped card ids play deterministically from deep-frozen input`, async () => {
  const ids = [...C.cards.keys()];
  // Derived from the bundle, not a literal: this file follows content as it grows, so it
  // can only ever fail because a card misbehaves — never because a count went stale.
  assert.equal(ids.length, SHIPPED_CARDS, `content ships ${SHIPPED_CARDS} card ids`);
  assert.ok(SHIPPED_CARDS > 0, 'the bundle must declare cards, or this whole loop proves nothing');
  for (const id of ids) {
    const deck =
      id === 'rampage' ? [...newRun({ seed: 5 }).deck, { uid: 'HAND', cardId: 'rampage', perPlay: 0 }] : undefined;
    const a = await playCard(id, { deck });
    const b = await playCard(id, { deck });
    assert.equal(hash(a.state), hash(b.state), `${id}: same fixture => same state hash`);
  }
});

test('frozen input throws on mutation instead of diverging silently', async () => {
  const c = await content();
  const state = freezeDeep(await combatState('strike', { draw: dummyPile(c) }));
  assert.throws(() => {
    state.player.hp = 1;
  }, 'writes to frozen state must throw in strict mode');
  assert.throws(() => {
    state.combat.hand.push({ uid: 'x' });
  }, 'pushing onto a frozen array must throw');
});
