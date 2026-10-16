// The bug this pins: a card can reach the hand WITHOUT a `cost` field.
//
// Deck instances are stored compactly ({uid, cardId, perPlay}); `instantiate()` decorates
// one with `cost` so legality checks and rendering never re-read content mid-turn. Three of
// the four draw sites pushed the raw instance instead, so `observe.js` read `card.cost`
// as `undefined` and the browser rendered a literal "undefined" in the cost gem, with the
// card unusable because its cost could not be compared against energy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { content, loadKernel, loadObserve, loadDescribe, loadRng } from '../helpers/harness.mjs';

const K = await loadKernel();
const { newRun, actions, step, snapshot } = K;
const { effectSummary } = await loadObserve();
await loadDescribe();
const C = await content();
const rng = await loadRng();

/** Every card in the hand must carry a numeric cost, at every step of a real run. */
test('every card in hand has a numeric cost at every step of a run', () => {
  for (const seed of [1, 2, 3, 7, 11, 42, 97, 1234]) {
    let state = newRun({ seed });
    // Travel into the first fight, then walk the combat.
    const travel = actions(state).find((a) => a.kind === 'travel');
    assert.ok(travel, `seed ${seed}: a travel action exists`);
    state = step(state, travel.id).state;

    for (let i = 0; i < 200; i += 1) {
      const hand = state.combat?.hand ?? [];
      for (const card of hand) {
        assert.equal(
          typeof card.cost,
          'number',
          `seed ${seed} step ${i}: card "${card.cardId}" in hand has cost ${JSON.stringify(card.cost)} (must be a number)`,
        );
        assert.ok(Number.isFinite(card.cost), `seed ${seed} step ${i}: cost of "${card.cardId}" is finite`);
      }
      const snap = snapshot(state);
      for (const tile of snap.hand) {
        assert.equal(
          typeof tile.cost,
          'number',
          `seed ${seed} step ${i}: the rendered hand tile for "${tile.cardId}" has cost ${JSON.stringify(tile.cost)}`,
        );
      }
      if (state.phase === 'ended') break;
      const legal = actions(state);
      if (legal.length === 0) break;
      state = step(state, legal[0].id).state;
    }
  }
});

/** The same rule for cards pushed into the hand by an effect or a power mid-turn. */
test('cards drawn by an effect or power also carry a cost', () => {
  // Play a card that draws, and a power that draws on exhaust, then re-check the hand.
  for (const seed of [3, 5, 8, 13, 21]) {
    let state = newRun({ seed });
    const travel = actions(state).find((a) => a.kind === 'travel');
    state = step(state, travel.id).state;
    for (let i = 0; i < 120; i += 1) {
      const hand = state.combat?.hand ?? [];
      for (const card of hand) {
        assert.equal(typeof card.cost, 'number', `seed ${seed}: "${card.cardId}" lacks a cost after a draw`);
      }
      if (state.phase === 'ended') break;
      const legal = actions(state);
      if (!legal.length) break;
      // Prefer playing a card (exercises draw/exhaust effects) over ending the turn.
      const play = legal.find((a) => a.kind === 'play') ?? legal[0];
      state = step(state, play.id).state;
    }
  }
});

/** A definition's cost and an empty-hand degrade are the only legitimate absences. */
test('cost matches the card definition for every distinct card seen in hand', async () => {
  const seen = new Map();
  for (const seed of [1, 4, 9, 16, 25, 36]) {
    let state = newRun({ seed });
    const travel = actions(state).find((a) => a.kind === 'travel');
    state = step(state, travel.id).state;
    for (let i = 0; i < 120; i += 1) {
      for (const card of state.combat?.hand ?? []) {
        const def = C.cards.get(card.cardId);
        assert.ok(def, `card "${card.cardId}" exists in content`);
        assert.equal(card.cost, def.cost, `"${card.cardId}" carries its definition's cost`);
        seen.set(card.cardId, def.cost);
      }
      if (state.phase === 'ended') break;
      const legal = actions(state);
      if (!legal.length) break;
      state = step(state, legal[0].id).state;
    }
  }
  assert.ok(seen.size >= 5, `saw several distinct cards in hand, got ${seen.size}`);
});
