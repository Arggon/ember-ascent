// Observation tolerance: an id the content does not know must degrade, never throw.
//
// THE DEFECT CLASS THIS PINS: persisted state carries cardIds (deck, piles, reward and
// rest offers) and validateSave never checks them, so a stale save after a rename — or a
// typo'd id pushed in through the e2e save/load lever — used to throw out of defOf() and
// kill the whole snapshot in any phase. snapshotDeck degraded first (7992e84, citing the
// text dump's rewardBody as the precedent); this file pins the REST of the surfaces that
// read persisted ids: the reward offer, the rest-site offer, and the pile name lists.
// The rule everywhere is the same: the unknown id stays VISIBLE as its own placeholder,
// nothing is dropped, and no count changes shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel } from '../helpers/harness.mjs';

const K = await loadKernel();
const { newRun, observe, snapshot } = K;
const UNKNOWN = 'no_such_card';

test('a reward offer with an unknown id snapshots as a placeholder row beside real ones', () => {
  const base = newRun({ seed: 7 });
  const snap = snapshot({ ...base, reward: { cards: ['slag_surge', UNKNOWN] } });
  assert.equal(snap.reward.cards.length, 2, 'no reward row is dropped');
  const real = snap.reward.cards[0];
  assert.equal(real.cardId, 'slag_surge');
  assert.equal(real.name, 'Slag Surge');
  assert.equal(real.summary, 'B5 A5');
  const ghost = snap.reward.cards[1];
  assert.equal(ghost.cardId, UNKNOWN);
  assert.equal(ghost.name, UNKNOWN, 'the raw id is its own name, the placeholder stays visible');
  assert.equal(ghost.cost, 0, 'neutral cost, like snapshotDeck\'s placeholder row');
  assert.equal(ghost.type, 'unknown');
  assert.equal(ghost.typeLabel, 'unknown');
  assert.equal(ghost.summary, '');
  assert.equal(ghost.description, '');
  assert.equal(ghost.actionId, null, 'no legal action can reference an unknown id');
  // The text dump renders the same reward tolerantly, as it always has (its own phase).
  assert.match(observe({ ...base, phase: 'reward', reward: { cards: [UNKNOWN] } }), new RegExp(`s1 ${UNKNOWN}`));
});

test('a rest-site offer with an unknown id shows its raw id instead of throwing', () => {
  const base = newRun({ seed: 7, tempers: true });
  const snap = snapshot({ ...base, phase: 'rest', temperOffers: [{ cardId: UNKNOWN, temper: 'redhot' }] });
  assert.equal(snap.rest.tempers.length, 1);
  const offer = snap.rest.tempers[0];
  assert.equal(offer.cardId, UNKNOWN);
  assert.equal(offer.cardName, UNKNOWN, 'the raw id stands in for the name');
  assert.equal(offer.temper, 'redhot', 'a KNOWN temper key still renders fully');
  assert.equal(offer.temperName, 'Red-hot');
  assert.match(offer.text, /Lose 2 HP when played/);
});

test('a rest offer with an unknown TEMPER key renders in both dump and snapshot (POLISH round)', () => {
  // The S2.1-era snapshotRest degraded with `?.` fallbacks that were unreachable
  // through snapshot() because restBody — the dump beside which it renders — threw on
  // the same state (the backlog note). Both renderings now tolerate the raw key.
  const base = newRun({ seed: 7, tempers: true });
  const state = { ...base, phase: 'rest', temperOffers: [{ cardId: 'hammerfall', temper: 'no_such_temper' }] };
  const snap = snapshot(state);
  assert.equal(snap.rest.tempers.length, 1);
  assert.equal(snap.rest.tempers[0].temper, 'no_such_temper', 'the raw key stays visible');
  assert.equal(snap.rest.tempers[0].temperName, 'no_such_temper', 'the raw key is its own name');
  assert.equal(snap.rest.tempers[0].text, '');
  const dump = observe(state);
  assert.match(dump, /TEMPER \(instead of healing\)/);
  assert.match(dump, new RegExp(`t1 hammerfall no_such_temper`), 'the dump renders the raw key where the label would sit');
  assert.doesNotThrow(() => snapshot(state), 'the snapshot never throws on a stale temper key');
});

test('an unknown id in a pile renders by name-slot without throwing, counts intact', () => {
  const base = newRun({ seed: 7 });
  const combat = {
    ...base,
    phase: 'combat',
    combat: {
      ...base.combat,
      active: true,
      hand: [],
      draw: [{ uid: 'z1', cardId: UNKNOWN }, { uid: 'z2', cardId: 'hammerfall' }],
      discard: [],
      exhaust: [],
    },
  };
  const snap = snapshot(combat);
  assert.equal(snap.piles.draw, 2, 'the count is unchanged by the unknown id');
  assert.deepEqual(snap.piles.drawCards, [UNKNOWN, 'Hammerfall'],
    'the unknown id stands in for its own name; the known card is untouched');
  // The verbose text dump's pile lines share the tolerant lookup.
  const lines = observe(combat, { verbose: true }).split('\n').filter((l) => l.startsWith(' draw:'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0], ` draw: ${UNKNOWN}, Hammerfall`);
});
