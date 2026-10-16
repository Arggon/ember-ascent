// Content loading + validation (ADR-6).
//
// cards.json is the single source of card data. It is validated STRUCTURALLY at
// load time: an unknown verb, a missing field, or a `custom` handler with no
// registered implementation is a hard error, not a silent no-op. That keeps the
// effect vocabulary closed in fact and not just in comment.
//
// WHY A GENERATED BUNDLE: the kernel must run unchanged in a browser, where
// node:fs does not exist. `cards.bundle.js` is a thin generated ES module that
// exports the parsed JSON object, so the kernel depends on NO node:* builtin.
// `cards.json` remains the single source of truth: it is generated from it by
// tools/gen-content.mjs, and tests/content/bundle-drift.test.js re-reads the JSON
// in Node and deep-compares, so the two can never silently drift.
import { VERBS } from './rules/vocabulary.js';
import { registeredEffects } from './rules/vocabulary.js';
import { cardsBundle } from './content/cards.bundle.js';

const REQUIRED_CARD_FIELDS = ['id', 'name', 'cost', 'type', 'rarity', 'target', 'effects'];
const CARD_TYPES = ['attack', 'skill', 'power', 'status', 'curse'];
const TARGETS = ['enemy', 'all', 'self', 'none', 'random_enemy'];

/**
 * Parse and validate content.
 *
 * `input` is either the parsed content object (the browser path: cards.bundle.js),
 * a JSON string (a Node caller that read the file itself), or omitted to use the
 * shipped bundle. The kernel does NO file I/O; every caller supplies its content.
 * @param {object|string} [input] parsed content object or its JSON text
 * @returns {{contentVersion: string, characters: Map<string,any>, cards: Map<string,any>, cardList: any[], statuses: any}}
 */
export function loadContent(input = cardsBundle) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  const problems = [];

  if (typeof raw.contentVersion !== 'string' || raw.contentVersion.length === 0) {
    problems.push('content.contentVersion missing');
  }
  if (!raw.cards || !Array.isArray(raw.cards)) {
    problems.push('content.cards missing or not an array');
  }
  if (!raw.characters || typeof raw.characters !== 'object') {
    problems.push('content.characters missing');
  }
  if (problems.length > 0) {
    throw new Error(`invalid content: ${problems.join('; ')}`);
  }

  const known = new Set(registeredEffects());
  const cards = new Map();
  for (const card of raw.cards) {
    for (const field of REQUIRED_CARD_FIELDS) {
      if (card[field] === undefined) problems.push(`card "${card.id ?? '?'}": missing "${field}"`);
    }
    if (cards.has(card.id)) problems.push(`card "${card.id}": duplicate id`);
    if (!CARD_TYPES.includes(card.type)) problems.push(`card "${card.id}": unknown type "${card.type}"`);
    if (!TARGETS.includes(card.target)) problems.push(`card "${card.id}": unknown target "${card.target}"`);
    if (!Number.isInteger(card.cost) || card.cost < 0) problems.push(`card "${card.id}": cost must be a non-negative integer`);
    if (!Array.isArray(card.effects) || card.effects.length === 0) {
      problems.push(`card "${card.id}": needs at least one effect`);
      continue;
    }
    for (const e of card.effects) {
      if (!VERBS.includes(e.verb)) problems.push(`card "${card.id}": unknown verb "${e.verb}"`);
      if (e.verb === 'custom' && !known.has(e.handler)) {
        problems.push(`card "${card.id}": custom handler "${e.handler}" has no rules/effects implementation`);
      }
      if (e.verb === 'custom' && !e.handler) problems.push(`card "${card.id}": custom effect needs a handler`);
    }
    if (!problems.some((p) => p.startsWith(`card "${card.id}"`))) cards.set(card.id, Object.freeze({ ...card }));
  }

  const characters = new Map();
  for (const [id, ch] of Object.entries(raw.characters)) {
    for (const cardId of ch.startingDeck) {
      if (!cards.has(cardId)) problems.push(`character "${id}": starting deck references unknown card "${cardId}"`);
    }
    characters.set(id, Object.freeze({ ...ch, id }));
  }

  if (problems.length > 0) throw new Error(`invalid content:\n - ${problems.join('\n - ')}`);

  return {
    contentVersion: raw.contentVersion,
    characters,
    cards,
    cardList: raw.cards,
    statuses: raw.statuses ?? {},
  };
}

/** The shipped content object (the same data cards.json holds). */
export const SHIPPED_CONTENT = cardsBundle;

/** Default content, loaded once and shared (read-only, so sharing is safe). */
let DEFAULT_CONTENT = null;
/** @returns {ReturnType<typeof loadContent>} */
export function defaultContent() {
  if (DEFAULT_CONTENT === null) DEFAULT_CONTENT = loadContent();
  return DEFAULT_CONTENT;
}

/** Card ids that may appear as combat rewards (starters excluded). */
export function draftPoolFrom(content) {
  return content.cardList.filter((c) => c.rarity !== 'starter').map((c) => c.id).sort();
}
