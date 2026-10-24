// S1 Master-deck viewer: snapshot() exposes the full deck as structured rows.
//
// Pins: at run start deckCards IS the character's starting deck (built independently
// from the shipped content, so the kernel cannot drift from it); the temper flag and the
// plain-English temper text propagate from state.tempers; duplicates aggregate under one
// row; the rows sort deterministically (cost, then face name, then temper); the counts
// sum back to the deck and the frozen state is left untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { content, loadDescribe, loadKernel } from '../helpers/harness.mjs';
import { TEMPERS } from '../../src/kernel/rules/tempers.js';

const K = await loadKernel();
const { newRun, snapshot } = K;
const C = await content();
const { CARD_TYPE_LABEL } = await loadDescribe();

/** The expected row the snapshot must produce for `count` copies of `id`, `temper`ed or not. */
function expectedRow(id, count, temper = null) {
  const def = C.cards.get(id);
  return {
    cardId: id,
    name: def.name,
    cost: def.cost,
    type: def.type,
    typeLabel: CARD_TYPE_LABEL[def.type] ?? def.type,
    tempered: temper !== null,
    temper,
    temperName: temper ? TEMPERS[temper].name : '',
    temperText: temper ? TEMPERS[temper].text : '',
    count,
  };
}

/** The starting deck aggregated independently: one row per cardId, cost-then-name order. */
function expectedStartingDeck(characterId) {
  const tally = new Map();
  for (const id of C.characters.get(characterId).startingDeck) {
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([id, count]) => expectedRow(id, count))
    .sort((a, b) => (a.cost - b.cost) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

test('at run start deckCards is the character\'s starting deck, aggregated and sorted', () => {
  for (const characterId of ['ironclad', 'bellows']) {
    const snap = snapshot(newRun({ seed: 7, character: characterId }));
    assert.equal(snap.deckCount, C.characters.get(characterId).startingDeck.length);
    assert.deepEqual(snap.deckCards, expectedStartingDeck(characterId));
    // The brief's own example, spelled out: the starter strikes render under their FACE
    // name, duplicates counted, nothing tempered.
    const strike = snap.deckCards.find((r) => r.cardId === 'strike');
    assert.equal(strike.name, 'Hammerfall');
    assert.equal(strike.count, C.characters.get(characterId).startingDeck.filter((id) => id === 'strike').length);
    assert.equal(strike.tempered, false);
  }
});

test('the temper flag propagates: tempered copies split into their own row', () => {
  const base = newRun({ seed: 2, tempers: true });
  const strikes = base.deck.filter((c) => c.cardId === 'strike').map((c) => c.uid);
  const tempers = Object.fromEntries(strikes.slice(0, 2).map((u) => [u, 'redhot']));
  const snap = snapshot({ ...base, tempers });

  const rows = snap.deckCards.filter((r) => r.cardId === 'strike');
  assert.deepEqual(rows.map((r) => [r.tempered, r.count]), [[false, 3], [true, 2]]);
  const hot = rows.find((r) => r.tempered);
  assert.equal(hot.temper, 'redhot');
  assert.equal(hot.temperName, 'Red-hot');
  assert.match(hot.temperText, /Lose 2 HP when played/);
  // Untempered copies of the same card carry no temper at all.
  const plain = rows.find((r) => !r.tempered);
  assert.equal(plain.temper, null);
  assert.equal(plain.temperName, '');
});

test('rows sort deterministically: cost, then face name, then temper', () => {
  const base = newRun({ seed: 2, tempers: true });
  const strike = base.deck.find((c) => c.cardId === 'strike');
  const snap = snapshot({ ...base, tempers: { [strike.uid]: 'redhot' } });
  /** True when row a must not come after row b (cost, then name, then temper key). */
  const inOrder = (a, b) =>
    a.cost < b.cost ? true
      : a.cost > b.cost ? false
        : a.name < b.name ? true
          : a.name > b.name ? false
            : (a.temper ?? '') <= (b.temper ?? '');
  for (let i = 1; i < snap.deckCards.length; i += 1) {
    assert.ok(inOrder(snap.deckCards[i - 1], snap.deckCards[i]),
      `rows out of order at ${i}: ${snap.deckCards[i - 1].name} then ${snap.deckCards[i].name}`);
  }
  // A tempered Hammerfall sits after its untempered copies (same cost, same name).
  const rows = snap.deckCards.filter((r) => r.cardId === 'strike');
  assert.deepEqual(rows.map((r) => r.tempered), [false, true]);
  // Same input, same rows: the sort is a pure function of the deck.
  assert.deepEqual(snapshot({ ...base, tempers: { [strike.uid]: 'redhot' } }).deckCards, snap.deckCards);
});

test('counts sum to the deck and the frozen state is left untouched', () => {
  const state = newRun({ seed: 7 });
  const before = JSON.stringify(state.deck);
  const snap = snapshot(state);
  assert.equal(snap.deckCards.reduce((n, r) => n + r.count, 0), snap.deckCount);
  assert.equal(snap.deckCount, state.deck.length);
  assert.equal(JSON.stringify(state.deck), before, 'snapshot() must not mutate the deck');
});
