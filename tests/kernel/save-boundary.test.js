import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSave, isParsedSave } from '../../src/kernel/index.js';
import { begin, saveText, loadObject, runHash } from '../../src/surface/session.js';

const validSave = () => JSON.parse(saveText(begin({ seed: 7 })).trim());

test('the boundary brands a validated save without freezing the caller object', () => {
  const raw = validSave();
  const result = parseSave(raw);
  assert.equal(result.ok, true);
  assert.equal(isParsedSave(result.save), true);
  assert.equal(isParsedSave(raw), false);
  assert.equal(Object.isFrozen(result.save), true);
  assert.equal(Object.isFrozen(raw.state), false);
  assert.equal(result.save.actions.length, raw.actions.length);
});

test('the boundary refuses every historical torn-save shape', () => {
  const mutations = [
    ['an act beyond the map table', (s) => { s.state.acts = 3; }],
    ['a debt purse', (s) => { s.state.player.gold = -1; }],
    ['an over-capacity potion belt', (s) => { s.state.potions = ['a', 'b', 'c', 'd']; }],
    ['a shop that pays the player', (s) => { s.state.shop = { offers: [{ price: -1 }] }; }],
    ['a malformed action entry', (s) => { s.actions = [{ nope: true }]; }],
    ['a duplicate relic', (s) => { s.state.relics = ['forge_iron', 'forge_iron']; }],
    ['an undefined hole', (s) => { s.state.relics = undefined; }],
    ['a non-integer buried in state', (s) => { s.state.player.gold = 1.5; }],
  ];
  for (const [name, mutate] of mutations) {
    const raw = validSave();
    mutate(raw);
    const parsed = parseSave(raw);
    assert.equal(parsed.ok, false, `${name} must be refused at the boundary`);
    assert.ok(parsed.problems.length > 0, `${name} must name the problem`);
    assert.equal(loadObject(raw).ok, false, `${name} must be refused by the session loader`);
  }
});

test('a real save text round-trips through the boundary to the same run identity', () => {
  const session = begin({ seed: 7 });
  const text = saveText(session);
  const raw = JSON.parse(text.trim());
  assert.equal(parseSave(raw).ok, true);
  const restored = loadObject(raw);
  assert.equal(restored.ok, true);
  assert.equal(runHash(restored.session), runHash(session));
  assert.equal(saveText(restored.session), text);
  assert.deepEqual(restored.session.events, [], 'a restored run has no events it did not observe');
});

test('a valid legacy save without post-v1 fields still crosses the boundary', () => {
  const raw = validSave();
  delete raw.state.relics;
  delete raw.state.potions;
  delete raw.state.event;
  delete raw.state.player.gold;
  assert.equal(parseSave(raw).ok, true);
  assert.equal(loadObject(raw).ok, true);
});
