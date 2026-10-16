// tests/kernel/sha256-parity.test.js — the pure-JS sha256 must equal node:crypto.
//
// The kernel's hash() no longer uses node:crypto (it must run in a browser), so the
// ONLY thing keeping run identity stable is that src/kernel/sha256.js produces the
// exact same bytes as the implementation it replaced. node:crypto is the reference
// oracle here — it is allowed in a TEST, it is forbidden in the kernel.
//
// This test drives 20+ DISTINCT REAL STATES through both implementations and asserts
// equality of the full canonical-hash string, then checks a spread of raw byte
// lengths so a padding bug cannot hide behind the shape of game states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../../src/kernel/sha256.js';
import { newRun, hash, canonical, actions, step } from '../../src/kernel/index.js';
import { makePolicy } from '../../src/surface/policies.js';

/** node:crypto reference digest. */
const ref = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

test('sha256Hex equals node:crypto on known vectors and every length 0..200', () => {
  const vectors = [
    '',
    'abc',
    'The quick brown fox jumps over the lazy dog',
    'dlb-0.3.0-act1',
    '{"a":1,"b":[1,2,3]}',
    'héllo — unicode ünïcödé ✓ 漢字',
  ];
  for (const v of vectors) {
    assert.equal(sha256Hex(v), ref(v), `vector mismatch: ${JSON.stringify(v)}`);
  }
  for (let n = 0; n <= 200; n += 1) {
    const s = `${'z'.repeat(n)}${n}`;
    assert.equal(sha256Hex(s), ref(s), `length-sweep mismatch at ${s.length}`);
  }
});

test('hash() of 20+ DISTINCT real states is byte-identical to a node:crypto recompute', () => {
  // Walk one real run with a built-in policy and hash after every accepted step, so
  // the states are genuinely different (different phase, HP, piles, rngDraws, ...).
  const policy = makePolicy('greedy');
  let session = { state: newRun({ seed: 3 }), submitted: [] };
  const seen = new Map(); // hash string -> canonical text
  let steps = 0;

  // Seed the sample with the opening state, then 40 further states (or until the run ends).
  for (let i = 0; ; i += 1) {
    const h = hash(session.state);
    const body = canonical(session.state);
    if (!seen.has(h)) seen.set(h, body);
    if (session.state.phase === 'ended' || steps >= 40) break;
    const choice = policy.choose({
      session,
      state: session.state,
      legal: actions(session.state),
      stepIndex: session.state.stepIndex,
      memory: {},
    });
    if (choice.id === null) break;
    const out = step(session.state, choice.id);
    session = { state: out.state, submitted: session.submitted };
    steps += 1;
  }

  const distinct = [...seen.entries()].filter(([, body]) => body.length > 0);
  assert.ok(
    distinct.length >= 20,
    `need 20+ distinct states to compare, collected ${distinct.length}`,
  );

  let compared = 0;
  for (const [kernelHash, body] of distinct) {
    // Recompute the digest the OLD way, with node:crypto, over the same canonical text
    // the kernel actually hashed — and require the identical hex.
    const cryptoHash = `sha256:${ref(body)}`;
    assert.equal(kernelHash, cryptoHash, `state hash drifted from node:crypto: ${body.slice(0, 80)}…`);
    compared += 1;
  }
  assert.ok(compared >= 20, `compared ${compared} distinct states (need >=20)`);
  // Report the count so a future runner can see the sample size in the test log.
  process.stdout.write(`  sha256 parity: ${compared} distinct states matched node:crypto exactly\n`);
});
