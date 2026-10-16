// RNG — counter-based splitmix64 (ADR-2, R3).
//
// Determinism contract: every random value is a pure function of (seed, drawIndex).
// There is NO mutable RNG object anywhere in the process. `state.rngDraws` is the
// only RNG state that exists, and it is an integer count of consumed u64 values.
// Replaying `seed + ordered action log` therefore reproduces every draw exactly,
// across processes and across machines.
//
// Forbidden in this file (enforced by tools/check-architecture.mjs): Date, Math.random,
// node:perf_hooks, and every I/O import.

/** 64-bit mask for wrapping arithmetic on BigInt. */
export const MASK64 = (1n << 64n) - 1n;
/** splitmix64 golden gamma. */
export const GAMMA = 0x9e3779b97f4a7c15n;

/**
 * One splitmix64 finalizer.
 * @param {bigint} z
 * @returns {bigint} mixed 64-bit value
 */
export function mix64(z) {
  let x = z & MASK64;
  x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (x ^ (x >> 31n)) & MASK64;
}

/**
 * The i-th u64 of the run's stream. Pure: same (seed, i) => same value, always.
 * @param {number} seed integer seed
 * @param {number} i zero-based draw index
 * @returns {bigint}
 */
export function u64At(seed, i) {
  return mix64(BigInt(seed) + BigInt(i) * GAMMA);
}

/**
 * Uniform integer in [0, bound) from the i-th draw. Modulo reduction is acceptable
 * here: the modulo bias is ~2^-40 for realistic bounds, i.e. far below anything a
 * balance measurement could resolve, and using it keeps the draw count exactly 1.
 * @param {number} seed
 * @param {number} i
 * @param {number} bound exclusive, must be a positive integer
 * @returns {number}
 */
export function intAt(seed, i, bound) {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new Error(`intAt: bound must be a positive integer, got ${bound}`);
  }
  return Number(u64At(seed, i) % BigInt(bound));
}

/**
 * Fisher-Yates shuffle. Consumes exactly (n - 1) draws, so the draw count is a
 * function of the input length alone — not of the values, not of the platform.
 * @param {number} seed
 * @param {number} startDraw first unconsumed draw index
 * @param {readonly any[]} items
 * @returns {{items: any[], draws: number}} draws = total consumable count after the shuffle
 */
export function shuffleAt(seed, startDraw, items) {
  const out = items.slice();
  let i = startDraw;
  for (let k = out.length - 1; k > 0; k -= 1) {
    const j = intAt(seed, i, k + 1);
    i += 1;
    const tmp = out[k];
    out[k] = out[j];
    out[j] = tmp;
  }
  return { items: out, draws: i - startDraw };
}

/**
 * Pick `count` distinct items (deterministic, consumes count*? draws proportional
 * to the number of swaps performed: exactly `count` draws when count <= items.length).
 * @param {number} seed
 * @param {number} startDraw
 * @param {readonly any[]} items
 * @param {number} count
 * @returns {{picked: any[], draws: number}}
 */
export function pickAt(seed, startDraw, items, count) {
  const pool = items.slice();
  const picked = [];
  let i = startDraw;
  const n = Math.min(count, pool.length);
  for (let k = 0; k < n; k += 1) {
    const j = intAt(seed, i, pool.length - k) ;
    i += 1;
    picked.push(pool[j]);
    pool[j] = pool[pool.length - 1 - k];
  }
  return { picked, draws: i - startDraw };
}
