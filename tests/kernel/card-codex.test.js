// S2 Card codex: kernel.cardPool() exposes the draft pool, enriched through the describe
// layer, and the surface's "in deck" chip sums the kernel's own deck rows.
//
// Pins: the pool IS draftPoolFrom(content) (39 ids, starters excluded, 16/18/5 by
// rarity); every row carries the definition's own name/cost/type/rarity and a non-empty
// description that is the describe layer's sentence verbatim; rows sort deterministically
// (rarity tier → cost → face name → card id); the in-deck tally sums the kernel's
// aggregated deck rows per cardId, so a tempered copy counts toward its cardId total.
import test from 'node:test';
import assert from 'node:assert/strict';
import { content, loadDescribe, loadKernel } from '../helpers/harness.mjs';
import { inDeckCounts } from '../../src/web/deck-counts.js';

const K = await loadKernel();
const { cardPool, newRun, snapshot } = K;
const C = await content();
const { CARD_TYPE_LABEL, describeCard } = await loadDescribe();

test('cardPool is exactly the draft pool: draftPoolFrom ids, starters excluded', () => {
  const pool = cardPool();
  // Built independently from the shipped content, so the codex cannot drift from what
  // the reward deck can offer.
  const expected = C.cardList.filter((c) => c.rarity !== 'starter').map((c) => c.id).sort();
  assert.equal(pool.length, 39);
  // Same id SET (the pool's own order is rarity tier → cost → name → id, pinned below).
  assert.deepEqual(pool.map((r) => r.cardId).sort(), expected);
  // The starters are no one's reward: none of them may appear in the sheet.
  const starters = new Set(C.cardList.filter((c) => c.rarity === 'starter').map((c) => c.id));
  for (const row of pool) assert.ok(!starters.has(row.cardId), `${row.cardId} is a starter`);
});

test('the pool splits 16 common / 18 uncommon / 5 rare', () => {
  const counts = { common: 0, uncommon: 0, rare: 0 };
  for (const row of cardPool()) counts[row.rarity] += 1;
  assert.deepEqual(counts, { common: 16, uncommon: 18, rare: 5 });
});

test('every row carries the definition\'s own facts and a non-empty description', () => {
  for (const row of cardPool()) {
    const def = C.cards.get(row.cardId);
    assert.equal(row.name, def.name, `${row.cardId}: face name`);
    assert.equal(row.cost, def.cost, `${row.cardId}: cost`);
    assert.equal(row.type, def.type, `${row.cardId}: type`);
    assert.equal(row.rarity, def.rarity, `${row.cardId}: rarity`);
    assert.equal(row.typeLabel, CARD_TYPE_LABEL[def.type] ?? def.type, `${row.cardId}: type word`);
    assert.equal(typeof row.description, 'string', `${row.cardId}: description is a string`);
    assert.ok(row.description.trim().length > 0, `${row.cardId}: description is non-empty`);
    // The codex text must BE the describe layer's sentence, not a second wording.
    assert.equal(row.description, describeCard(def), `${row.cardId}: description`);
  }
});

test('rows sort deterministically: rarity tier, then cost, then face name, then card id', () => {
  const pool = cardPool();
  const tier = { common: 0, uncommon: 1, rare: 2 };
  /** True when row a must not come after row b (tier, then cost, then name, then id). */
  const inOrder = (a, b) =>
    (tier[a.rarity] ?? 9) < (tier[b.rarity] ?? 9) ? true
      : (tier[a.rarity] ?? 9) > (tier[b.rarity] ?? 9) ? false
        : a.cost < b.cost ? true
          : a.cost > b.cost ? false
            : a.name < b.name ? true
              : a.name > b.name ? false
                : a.cardId <= b.cardId;
  for (let i = 1; i < pool.length; i += 1) {
    assert.ok(inOrder(pool[i - 1], pool[i]),
      `rows out of order at ${i}: ${pool[i - 1].cardId} then ${pool[i].cardId}`);
  }
  // Same call, same rows: the order is a pure function of the content.
  assert.deepEqual(cardPool(), pool);
});

test('the in-deck tally sums the kernel\'s deck rows per cardId (tempered copies included)', () => {
  // A doctored deck: the ironclad start (5 strikes, 4 defends, 1 bash) plus two more
  // strikes and one Maul, with one original strike tempered red-hot. The kernel's rows
  // split the tempered copy onto its own row; the tally is what merges it back.
  const base = newRun({ seed: 2, tempers: true });
  const strike = base.deck.find((c) => c.cardId === 'strike');
  const state = {
    ...base,
    deck: [...base.deck,
      { uid: 'x1', cardId: 'strike' },
      { uid: 'x2', cardId: 'strike' },
      { uid: 'x3', cardId: 'bludgeon' }],
    tempers: { [strike.uid]: 'redhot' },
  };
  const snap = snapshot(state);
  assert.deepEqual(
    snap.deckCards.filter((r) => r.cardId === 'strike').map((r) => [r.tempered, r.count]),
    [[false, 6], [true, 1]],
    'the kernel keeps the tempered copy on its own row',
  );

  const tally = inDeckCounts(snap.deckCards);
  assert.equal(tally.get('strike'), 7, 'five starter strikes + two injected, tempered copy included');
  assert.equal(tally.get('defend'), 4);
  assert.equal(tally.get('bash'), 1);
  assert.equal(tally.get('bludgeon'), 1, 'a draft-pool card the deck owns shows one copy');
  assert.equal(tally.get('ironwave') ?? 0, 0, 'a pool card the deck does not own counts as no chip');
});

test('the tally of an empty or absent deck rows list is empty, never a crash', () => {
  assert.equal(inDeckCounts().size, 0);
  assert.equal(inDeckCounts([]).size, 0);
  assert.equal(inDeckCounts(null).size, 0);
});
