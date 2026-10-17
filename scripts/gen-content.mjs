#!/usr/bin/env node
// scripts/gen-content.mjs — regenerate src/kernel/content/cards.bundle.js.
//
// cards.json stays the SINGLE SOURCE OF TRUTH for card data. The kernel cannot read
// it with node:fs (it must run in a browser), so this tool embeds the parsed object
// as an ES module. The bundle is DERIVED, never hand-edited: run
//   node scripts/gen-content.mjs
// after any content change. tests/content/bundle-drift.test.js re-reads cards.json in
// Node and deep-compares the two, so a stale bundle is a test failure, not a mystery.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const JSON_PATH = resolve(ROOT, 'src/kernel/content/cards.json');
const OUT_PATH = resolve(ROOT, 'src/kernel/content/cards.bundle.js');

const raw = readFileSync(JSON_PATH, 'utf8');
// Parse here rather than copying text: invalid JSON fails the generator loudly.
const parsed = JSON.parse(raw);
if (typeof parsed.contentVersion !== 'string') {
  throw new Error(`cards.json has no contentVersion string`);
}
if (!Array.isArray(parsed.cards) || parsed.cards.length === 0) {
  throw new Error(`cards.json has no cards array`);
}

const banner = `// GENERATED FILE — do not edit by hand. Run: node scripts/gen-content.mjs
//
// Source of truth: src/kernel/content/cards.json (the single source of card data).
// This module exists so the kernel can carry NO node:* builtin and therefore run
// unchanged in a browser. tests/content/bundle-drift.test.js re-reads cards.json in
// Node and deep-compares it against this object, so the two can never silently drift.

/** Parsed contents of src/kernel/content/cards.json. */
export const cardsBundle = `;

const body = `${JSON.stringify(parsed, null, 2)};\n`;
writeFileSync(OUT_PATH, `${banner}${body}`);
process.stdout.write(
  `wrote ${OUT_PATH}\n  from ${JSON_PATH}\n  ${parsed.cards.length} cards, contentVersion ${parsed.contentVersion}\n`,
);
