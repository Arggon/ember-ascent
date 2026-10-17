// src/web/tokens.js — measure the observation's payload tokens for the on-screen badge.
//
// This exists so a human can SEE the product claim ("the agent-facing observation is
// cheap") next to the game: the same number tests/golden/budget.test.js enforces.
//
// js-tiktoken is a DEV dependency and is imported dynamically and optionally. In a
// plain browser the bare specifier has no import map and the import throws, which is
// caught here so the badge degrades to "n/a" instead of breaking the game — the game
// itself never needs a tokenizer. The count is never fabricated: absent encoder means
// `available:false`.
let cache = null;

/**
 * Worst-case token count for a payload, or null when no encoder is available.
 * @param {string} text
 * @returns {Promise<{o200k_base:number, cl100k_base:number, worst:number}|null>}
 */
export async function measure(text) {
  try {
    if (cache === null) {
      const mod = await import('../surface/tokens.js');
      cache = mod.countWorst;
    }
    if (typeof cache !== 'function') return null;
    const r = await cache(text);
    return r && typeof r.worst === 'number' ? r : null;
  } catch {
    // No tokenizer in this host (the normal browser case): not an error, just absent.
    return null;
  }
}
