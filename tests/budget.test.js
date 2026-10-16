// tests/budget.test.js — R9a payload-token ceilings, enforced automatically.
//
// The ceiling is a bound on the worst SINGLE payload an agent must read, so this test
// measures per-item maxima across every shipped card id, in the worst of both
// encodings (o200k_base / cl100k_base). It is designed to FAIL the moment content or
// the action-line format grows past a ceiling — that failure is the point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { combatState, content, loadObserve, loadTokens } from './helpers/harness.mjs';
import { newRun } from '../src/kernel/index.js';
// DEF-1: the floor of "one action line per card" is the bundle's own length, not a
// literal 42. The bound still bites exactly as hard (every card must yield a line) while
// no longer going stale the day content grows.
import { cardsBundle } from '../src/kernel/content/cards.bundle.js';

const SHIPPED_CARDS = cardsBundle.cards.length;

const { observe, observeActions } = await loadObserve();
const { countWorst } = await loadTokens();

/** Both frozen ceilings (R9a). Kept here so the test owns its own contract. */
const CEILINGS = { stateDump: 250, actionLine: 8 };

test('every state dump fits the 250-token ceiling (worst of both encodings)', async () => {
  const C = await content();
  let worst = { id: null, n: 0, o: 0, c: 0 };
  for (const id of C.cards.keys()) {
    const dump = observe(await combatState(id));
    const n = countWorst(dump);
    if (n.worst > worst.n) worst = { id, n: n.worst, o: n.o200k_base, c: n.cl100k_base };
  }
  // The verbose dump (pile lists, deck count) is the real worst case; measure it too.
  const verbose = observe(await combatState('pummel'), { verbose: true });
  const vn = countWorst(verbose);
  if (vn.worst > worst.n) worst = { id: 'pummel --verbose', n: vn.worst, o: vn.o200k_base, c: vn.cl100k_base };

  assert.ok(
    worst.n <= CEILINGS.stateDump,
    `worst state dump is ${worst.n} tokens (${worst.id}); ceiling ${CEILINGS.stateDump}`,
  );
});

test('every action line fits the 8-token ceiling (worst of both encodings)', async () => {
  const C = await content();
  let worst = { id: null, line: '', n: 0, o: 0, c: 0 };
  let linesMeasured = 0;
  for (const id of C.cards.keys()) {
    const lines = observeActions(await combatState(id)).split('\n').filter(Boolean);
    for (const line of lines) {
      const n = countWorst(line);
      linesMeasured += 1;
      if (n.worst > worst.n) worst = { id, line, n: n.worst, o: n.o200k_base, c: n.cl100k_base };
    }
  }
  assert.ok(
    linesMeasured >= SHIPPED_CARDS,
    `measured at least one line per card (${SHIPPED_CARDS} cards), got ${linesMeasured}`,
  );
  assert.ok(
    worst.n <= CEILINGS.actionLine,
    `worst action line ${JSON.stringify(worst.line)} is ${worst.n} tokens; ceiling ${CEILINGS.actionLine}`,
  );
});

test('the ceiling really does bite: a line one token over is rejected by the same check', async () => {
  // Guards against a test that passes because the measurement is inert.
  const over = 'p1 sword_boomerang extra_words_that_do_not_belong_here_at_all';
  const n = countWorst(over);
  assert.ok(n.worst > CEILINGS.actionLine, `injected line must breach the ceiling, got ${n.worst}`);
});

test('state dump tokens are stable for a fixed fixture (regression pin)', async () => {
  const dump = observe(newRun({ seed: 7 }));
  const a = countWorst(dump);
  const b = countWorst(observe(newRun({ seed: 7 })));
  assert.deepEqual(a, b, 'same state => same measured token count');
});
