// tests/kernel/kernel.test.js — RNG determinism, canonical serialization, hashing,
// and save-schema validation. These are the properties replay (R3) rests on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, loadStateMod, loadRng, content } from '../helpers/harness.mjs';

const { newRun, hash, canonical, toSave, validateSave } = await loadKernel();
const { FORMAT_VERSION } = await loadStateMod();
const { u64At, intAt, shuffleAt, pickAt } = await loadRng();

// --- RNG determinism -------------------------------------------------------------

test('same seed + draw index yields the identical value; different seeds differ', () => {
  assert.equal(u64At(7, 3), u64At(7, 3), 'pure function of (seed, index)');
  assert.equal(intAt(7, 40, 6), intAt(7, 40, 6));
  assert.notEqual(u64At(7, 3), u64At(8, 3), 'seed 7 and 8 diverge at the same index');
  assert.notEqual(u64At(7, 3), u64At(7, 4), 'index matters');
});

test('intAt returns an in-range integer and rejects a non-positive bound', () => {
  for (let i = 0; i < 200; i += 1) {
    const v = intAt(11, i, 5);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 5, `intAt in range, got ${v}`);
  }
  assert.throws(() => intAt(11, 0, 0), /bound must be a positive integer/);
});

test('shuffle is seed-deterministic, consumes exactly n-1 draws, and does not mutate its input', () => {
  const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
  const a = shuffleAt(3, 100, input);
  const b = shuffleAt(3, 100, input);
  assert.deepEqual(a.items, b.items, 'same seed => same permutation');
  assert.equal(a.draws, input.length - 1, 'Fisher-Yates draws exactly n-1 values');
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8], 'frozen input is untouched');
  const c = shuffleAt(4, 100, input);
  assert.notDeepEqual(a.items, c.items, 'a different seed permutes differently');
});

test('pickAt returns distinct items and consumes exactly `count` draws', () => {
  const pool = Object.freeze(['a', 'b', 'c', 'd', 'e']);
  const r = pickAt(9, 50, pool, 3);
  assert.equal(r.draws, 3);
  assert.equal(r.picked.length, 3);
  assert.equal(new Set(r.picked).size, 3, 'picks are distinct');
  assert.deepEqual(pickAt(9, 50, pool, 3).picked, r.picked, 'deterministic');
  assert.deepEqual(pool, ['a', 'b', 'c', 'd', 'e'], 'pool untouched');
});

// --- canonical serialization -----------------------------------------------------

test('canonical is key-order independent and stable across calls', () => {
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
  assert.equal(canonical([1, [2, { z: 3, a: 4 }]]), canonical([1, [2, { a: 4, z: 3 }]]));
  const s = newRun({ seed: 7 });
  assert.equal(canonical(s), canonical(s), 'repeated serialization is byte-identical');
});

test('canonical rejects every value that would break cross-platform replay', () => {
  assert.throws(() => canonical({ x: 1.5 }), /non-integer/, 'fixed-point integers only');
  assert.throws(() => canonical({ x: 'a\rb' }), /CR in string/, 'LF only');
  assert.throws(() => canonical({ x: undefined }), /undefined/, 'no undefined holes');
  assert.throws(() => canonical({ x: Infinity }), /non-finite/);
  assert.throws(() => canonical({ x: new Date(0) }), /only plain objects/);
  assert.throws(() => canonical({ x: () => 1 }), /unsupported type/);
});

// --- hash sensitivity ------------------------------------------------------------

test('hash() is content-addressed and sensitive to stepIndex, rngDraws and contentVersion', async () => {
  const s = newRun({ seed: 7 });
  assert.match(hash(s), /^sha256:[0-9a-f]{64}$/);
  assert.equal(hash(s), hash(newRun({ seed: 7 })), 'same inputs => same hash');

  const bumpedStep = { ...s, stepIndex: s.stepIndex + 1 };
  const bumpedDraws = { ...s, rngDraws: s.rngDraws + 1 };
  const bumpedContent = { ...s, contentVersion: 'other' };
  assert.notEqual(hash(bumpedStep), hash(s), 'stepIndex is part of run identity');
  assert.notEqual(hash(bumpedDraws), hash(s), 'rngDraws is part of run identity');
  assert.notEqual(hash(bumpedContent), hash(s), 'contentVersion is part of run identity');
  assert.notEqual(hash(newRun({ seed: 8 })), hash(s), 'seed is part of run identity');
  void (await content());
});

// --- save schema -----------------------------------------------------------------

test('a well-formed save validates clean and round-trips through canonical text', async () => {
  const s = newRun({ seed: 7 });
  const save = toSave(s, [{ act: 'n1' }, { reject: 'zz9' }]);
  assert.deepEqual(validateSave(save), [], 'a legitimate save has no problems');
  assert.equal(FORMAT_VERSION, 1);
  assert.equal(save.formatVersion, FORMAT_VERSION);
  assert.equal(canonical(save), canonical(save));
});

test('a corrupt save is REFUSED with named problems, never repaired', () => {
  const s = newRun({ seed: 7 });
  const good = toSave(s, []);

  const missing = { ...good };
  delete missing.seed;
  assert.ok(validateSave(missing).some((p) => p.includes('missing field "seed"')), 'missing field named');

  const wrongType = { ...good, seed: 'seven' };
  assert.ok(validateSave(wrongType).some((p) => p.includes('"seed" must be an integer')));

  const badVersion = { ...good, formatVersion: 99 };
  assert.ok(
    validateSave(badVersion).some((p) => p.includes('version-incompatible')),
    'a newer formatVersion is refused, not silently accepted',
  );

  const brokenState = { ...good, state: { phase: 'map' } };
  const problems = validateSave(brokenState);
  for (const key of ['stepIndex', 'rngDraws', 'contentVersion', 'player', 'act', 'floor']) {
    assert.ok(problems.some((p) => p.includes(`save.state: missing field "${key}"`)), `state.${key} required`);
  }

  assert.deepEqual(validateSave(null), ['save: not a JSON object']);
  assert.deepEqual(validateSave([]), ['save: not a JSON object']);
  assert.ok(validateSave({ ...good, actions: 'nope' }).some((p) => p.includes('"actions" must be an array')));
});
