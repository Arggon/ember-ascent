// src/web/deck-counts.js — how many copies of each card the run deck holds.
//
// The codex (S2) marks every pool card the deck already owns with an "in deck ×N" chip.
// The kernel publishes the deck as AGGREGATED rows (snapshot.deckCards: one row per
// cardId+temper with its count), so the chip's number is a plain sum of those counts per
// cardId — the deck is never counted a second time, and a tempered copy counts toward its
// cardId for the same reason the rows already carry the cardId. DOM-free on purpose, so a
// Node test can pin the arithmetic without a fake browser.

/**
 * Sum the kernel's deck rows per cardId.
 * @param {Array<{cardId: string, count: number}>} [rows] snapshot.deckCards; omitted = empty
 * @returns {Map<string, number>} cardId → total copies owned (tempered copies included)
 */
export function inDeckCounts(rows = []) {
  const tally = new Map();
  for (const row of rows || []) {
    tally.set(row.cardId, (tally.get(row.cardId) ?? 0) + (row.count ?? 0));
  }
  return tally;
}
