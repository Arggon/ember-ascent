// tests/kernel/hero-alias.test.js — the DE-STS hero-id alias (?hero= / --character).
//
// The canonical hero ids are the characters table's own keys ('ashwright',
// 'bellows_keeper'). The renamed pre-0.5.0 ids ('ironclad', 'bellows') resolve through
// the kernel's HERO_ALIASES map BEFORE validation, so old links, old scripts and old
// seeds keep booting the same heroes — the mapping is the kernel's own resolver rule
// (newRun applies it before the characters lookup; the web ?hero= resolver and the CLI
// inherit it through the same map).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRun, HERO_ALIASES } from '../../src/kernel/index.js';

test('HERO_ALIASES maps the renamed ids onto the canonical ones', () => {
  assert.deepEqual(HERO_ALIASES, { ironclad: 'ashwright', bellows: 'bellows_keeper' });
});

test('?hero=bellows (the legacy alias) yields character bellows_keeper', () => {
  const legacy = newRun({ seed: 1, character: 'bellows' });
  assert.equal(legacy.character, 'bellows_keeper', 'the alias resolves BEFORE validation');
  assert.equal(newRun({ seed: 1, character: 'bellows_keeper' }).character, 'bellows_keeper', 'the canonical id is unchanged');
});

test('?hero=ironclad (the legacy alias) yields character ashwright; the default stays ashwright', () => {
  assert.equal(newRun({ seed: 1, character: 'ironclad' }).character, 'ashwright');
  assert.equal(newRun({ seed: 1 }).character, 'ashwright', 'no-param default stays the Ashwright hero');
  assert.equal(newRun({ seed: 1, character: 'ashwright' }).character, 'ashwright');
});
