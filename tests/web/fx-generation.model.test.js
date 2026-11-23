import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSource, explore, verify } from '../../scripts/verify-fx-generation.mjs';

test('the shipped effect queue follows the one-generation protocol', () => {
  const { violations } = checkSource();
  assert.deepEqual(violations, []);
});

test('the model accepts the shipped protocol', () => {
  const result = explore('current');
  assert.equal(result.ok, true, result.violation);
  assert.ok(result.explored > 100);
});

test('the model replays bfa7bf7: per-timer generations cancel every delayed beat', () => {
  const result = explore('per-timer-generation');
  assert.equal(result.ok, false);
  assert.match(result.violation, /never fired/);
});

test('the model replays a stale beat firing after a newer action retires it', () => {
  const result = explore('unguarded-fire');
  assert.equal(result.ok, false);
  assert.match(result.violation, /generation retired/);
});

test('the verifier is green only when source and both historical bugs agree', () => {
  assert.equal(verify().ok, true);
});
