// tests/content/bundle-drift.test.js — cards.json and the generated bundle must agree.
//
// src/kernel/content/cards.json is the single source of truth for card data. The
// kernel cannot read it with node:fs (it must run in a browser), so it imports the
// generated ES module src/kernel/content/cards.bundle.js instead. This test is the
// ONLY thing standing between "two copies" and "one source of truth": it re-reads
// the JSON in Node and deep-compares against the bundled object, so any edit to the
// JSON without re-running `node tools/gen-content.mjs` fails here.
//
// It also proves the kernel's default content really comes from the bundle — not from
// a stray disk read that would resurrect node:fs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cardsBundle } from '../../src/kernel/content/cards.bundle.js';
// Importing the kernel entry FIRST runs its one-time side effects (registering the
// custom effect handlers, injecting card defs) — the same order the browser entry
// uses. Only then can defaultContent() validate content that has `custom` verbs.
import { newRun } from '../../src/kernel/index.js';
import { loadContent, defaultContent, SHIPPED_CONTENT } from '../../src/kernel/content.js';
import { REPO } from '../helpers/harness.mjs';

const JSON_PATH = resolve(REPO, 'src', 'kernel', 'content', 'cards.json');

test('cards.bundle.js deep-equals cards.json (the bundle is not stale)', () => {
  const fromDisk = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  assert.deepEqual(cardsBundle, fromDisk, 'regenerate with: node tools/gen-content.mjs');
});

test('the JSON file is the bundle reformatted, field-for-field, for every card', () => {
  const fromDisk = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  assert.equal(cardsBundle.contentVersion, fromDisk.contentVersion);
  assert.equal(cardsBundle.cards.length, fromDisk.cards.length);
  for (let i = 0; i < fromDisk.cards.length; i += 1) {
    assert.deepEqual(cardsBundle.cards[i], fromDisk.cards[i], `card ${i} drifted`);
  }
  assert.deepEqual(cardsBundle.characters, fromDisk.characters);
});

test('default content in the kernel comes from the bundle (no disk read survives)', () => {
  // SHIPPED_CONTENT IS the bundle object, and defaultContent() is derived from it.
  assert.equal(SHIPPED_CONTENT, cardsBundle, 'SHIPPED_CONTENT must be the imported bundle');
  const loaded = defaultContent();
  assert.equal(loaded.contentVersion, cardsBundle.contentVersion);
  for (const card of cardsBundle.cards) {
    assert.ok(loaded.cards.has(card.id), `bundle-loaded content is missing "${card.id}"`);
  }
  // loadContent() accepts the same object explicitly (the browser path).
  assert.equal(loadContent(cardsBundle).contentVersion, loaded.contentVersion);
  // ...and a JSON string (a Node caller that did its own I/O, e.g. the generator).
  assert.equal(loadContent(JSON.stringify(cardsBundle)).cards.size, loaded.cards.size);
  // A run built with NO explicit content proves the default path never touched disk.
  assert.equal(newRun({ seed: 1 }).contentVersion, cardsBundle.contentVersion);
});
