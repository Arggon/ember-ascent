// S2 Card codex: kernel.cardPool() is the describe-layer LOOKUP TABLE, and each run's
// truth is snapshot.draftPool — the ids its rewards actually roll from. The surface's
// "in deck" chip sums the kernel's own deck rows.
//
// Pins: the table IS draftPoolFrom(shipped content) (68 ids, starters excluded, 24/31/13
// by rarity after the "golpes discretos NxM" slice grew the table 70 → 73: Slag Barb and
// Kiln Fume are commons, Anvil Guard an uncommon); every row carries the definition's own
// name/cost/type/rarity and a non-empty description that is the describe layer's sentence
// verbatim; rows sort deterministically (rarity tier → cost → face name → card id);
// snapshot() publishes the RUN'S draftPool (narrowed profiles make it shorter than the
// table; a state that predates the field publishes null), and every run id is covered by
// a table row so the per-run filter can only ever shrink it; the in-deck tally sums the
// kernel's aggregated deck rows per cardId, so a tempered copy counts toward its cardId
// total.
import test from 'node:test';
import assert from 'node:assert/strict';
import { content, loadDescribe, loadKernel } from '../helpers/harness.mjs';
import { inDeckCounts } from '../../src/web/deck-counts.js';

const K = await loadKernel();
const { cardPool, contentForProfile, fullyUnlockedProfile, newRun, snapshot } = K;
const C = await content();
const { CARD_TYPE_LABEL, describeCard } = await loadDescribe();

test('cardPool is exactly the draft pool: draftPoolFrom ids, starters excluded', () => {
  const pool = cardPool();
  // Built independently from the shipped content, so the codex cannot drift from what
  // the reward deck can offer.
  const expected = C.cardList.filter((c) => c.rarity !== 'starter').map((c) => c.id).sort();
  assert.equal(pool.length, 68);
  // Same id SET (the pool's own order is rarity tier → cost → name → id, pinned below).
  assert.deepEqual(pool.map((r) => r.cardId).sort(), expected);
  // The starters are no one's reward: none of them may appear in the sheet.
  const starters = new Set(C.cardList.filter((c) => c.rarity === 'starter').map((c) => c.id));
  for (const row of pool) assert.ok(!starters.has(row.cardId), `${row.cardId} is a starter`);
});

test('the pool splits 24 common / 31 uncommon / 13 rare (golpes discretos: 70 → 73 cards)', () => {
  const counts = { common: 0, uncommon: 0, rare: 0 };
  for (const row of cardPool()) counts[row.rarity] += 1;
  assert.deepEqual(counts, { common: 24, uncommon: 31, rare: 13 });
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

test('snapshot publishes the RUN\'S draftPool — the full table only for an unnarrowed run', () => {
  // The default content: the run's pool IS the whole shipped draft pool.
  const full = snapshot(newRun({ seed: 7 }));
  assert.deepEqual(full.draftPool, C.cardList.filter((c) => c.rarity !== 'starter').map((c) => c.id).sort());
  assert.equal(full.draftPool.length, 68);
  // A state that predates the field (validateSave never required draftPool) publishes
  // null — "pool unknown", NOT an empty pool — so a surface can fall back to the table
  // instead of lying about an empty codex.
  const { draftPool: _absent, ...legacy } = newRun({ seed: 7 });
  assert.equal(snapshot(legacy).draftPool, null);
});

test('a narrowed run publishes its own pool, and the lookup table covers every id of it', () => {
  // A fresh profile narrows the content (unlocks.js poolSelection), and rewards roll from
  // exactly that narrowed set — this is the truth the codex must show, not the table.
  for (const profile of [null, fullyUnlockedProfile()]) {
    const narrowed = contentForProfile(profile);
    const state = newRun({ seed: 7, content: narrowed });
    const expected = narrowed.cardList.filter((c) => c.rarity !== 'starter').map((c) => c.id).sort();
    const ids = snapshot(state).draftPool;
    assert.deepEqual(ids, expected, `${profile === null ? 'fresh' : 'fully unlocked'} profile: snapshot.draftPool must be the run content's own pool`);
    if (profile === null) {
      assert.ok(ids.length < 65, `the fresh profile is genuinely narrowed (${ids.length} of 65)`);
    } else {
      // S8: the top unlock tier is sized to hold EVERY card (AC-9.4 — the whole pool is
      // reachable), so the fully-unlocked run's pool legitimately EQUALS the table.
      assert.equal(ids.length, 65, 'the fully-unlocked pool covers the whole table');
    }
    // The web's filter: cached cardPool() rows kept when their cardId is in the run's
    // set. It can only shrink the table if — and only if — every run id HAS a row.
    const tableIds = new Set(cardPool().map((r) => r.cardId));
    for (const id of ids) assert.ok(tableIds.has(id), `${id} is offerable this run but has no codex row`);
    assert.equal(cardPool().filter((r) => tableIds.has(r.cardId) && new Set(ids).has(r.cardId)).length, ids.length,
      'filtering the table to the run ids yields exactly the run ids');
  }
});

test('the in-deck tally sums the kernel\'s deck rows per cardId (tempered copies included)', () => {
  // A doctored deck: the ashwright start (5 strikes, 4 defends, 1 anvil_blow) plus two more
  // strikes and one Maul, with one original strike tempered red-hot. The kernel's rows
  // split the tempered copy onto its own row; the tally is what merges it back.
  const base = newRun({ seed: 2, tempers: true });
  const strike = base.deck.find((c) => c.cardId === 'hammerfall');
  const state = {
    ...base,
    deck: [...base.deck,
      { uid: 'x1', cardId: 'hammerfall' },
      { uid: 'x2', cardId: 'hammerfall' },
      { uid: 'x3', cardId: 'maul' }],
    tempers: { [strike.uid]: 'redhot' },
  };
  const snap = snapshot(state);
  assert.deepEqual(
    snap.deckCards.filter((r) => r.cardId === 'hammerfall').map((r) => [r.tempered, r.count]),
    [[false, 6], [true, 1]],
    'the kernel keeps the tempered copy on its own row',
  );

  const tally = inDeckCounts(snap.deckCards);
  assert.equal(tally.get('hammerfall'), 7, 'five starter strikes + two injected, tempered copy included');
  assert.equal(tally.get('quench'), 4);
  assert.equal(tally.get('anvil_blow'), 1);
  assert.equal(tally.get('maul'), 1, 'a draft-pool card the deck owns shows one copy');
  assert.equal(tally.get('slag_surge') ?? 0, 0, 'a pool card the deck does not own counts as no chip');
});

test('the tally of an empty or absent deck rows list is empty, never a crash', () => {
  assert.equal(inDeckCounts().size, 0);
  assert.equal(inDeckCounts([]).size, 0);
  assert.equal(inDeckCounts(null).size, 0);
});
