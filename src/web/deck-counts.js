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
