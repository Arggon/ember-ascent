// Shop — the act's single vendor (S4). Entering a shop node opens a phase that persists
// until the player leaves; leaving is final (the node is consumed like a fight — every
// node sits in exactly one row, and travel always moves to the NEXT row, so a left shop
// is never reachable again).
//
// Draw accounting — a deliberate decision, part of the format:
//   * The shop's existence is decided at MAP GENERATION (rules/map.js: the placed
//     SHOP_ROW/SHOP_SLOT node) and consumes no draw.
//   * The INVENTORY AND PRICES roll at ENTRY time, from the live counter — the same
//     convention as a rest site's temper offers. Entry happens through exactly one
//     action (the travel that opens the node), and re-entry is impossible, so the
//     counter the rolls read is reproducible from the action log forever.
//   * A full inventory consumes exactly 10 draws in ONE fixed order: the 5 `pickAt`
//     picks first, THEN 5 price rolls — 2 per offer, but not interleaved per offer.
//     The order is part of the format (a replay reads the counter positionally); a run
//     whose narrowed draft pool holds fewer than 5 cards consumes 2 per actual offer.
//     A card whose price would depend on the branch taken would break that count, so
//     each price is always ONE `intAt` regardless of rarity (the band only changes the
//     range, never the draw count).
//   * The removal service is a FLAT price (StS parity: 75), so buying it consumes no
//     draw; picking which card leaves is a choice, not a roll — zero draws.
//
// Pure: no Date, no Math.random, no I/O; every draw is counted and returned.
import { intAt, pickAt } from '../rng.js';

/** How many card offers a shop opens with. */
export const SHOP_OFFERS = 5;

/** The card-removal service: one per visit, one flat price (StS parity). */
export const REMOVAL_PRICE = 75;

/** Price bands by rarity, inclusive [min, max] — StS-like ranges. One draw lands the
 *  spot inside the band, exactly like the victory gold grant (rules/act.js). An unknown
 *  rarity is priced on the common band: never overcharge for a card the bands don't
 *  describe. */
export const PRICE_BANDS = Object.freeze({
  common: [45, 60],
  uncommon: [68, 82],
  rare: [135, 165],
});

/**
 * The price of one card: one seeded draw inside its rarity band.
 * @param {string} rarity
 * @param {number} seed
 * @param {number} drawIndex the counter position this roll reads
 * @returns {number}
 */
export function priceFor(rarity, seed, drawIndex) {
  const [lo, hi] = PRICE_BANDS[rarity] ?? PRICE_BANDS.common;
  return lo + intAt(seed, drawIndex, hi - lo + 1);
}

/**
 * Roll a shop's inventory from the run's own narrowed draft pool (the S2 codex lesson:
 * the offers must come from `state.draftPool`, never from the full content — a profile
 * that narrowed the pool makes the shelves shorter, never longer). No duplicates
 * (`pickAt` picks distinct entries), starters excluded (they are not in the pool).
 *
 * Tolerant like the observation layer: a pool id the content no longer knows is
 * filtered out rather than crashing the entry — a shelf of known cards is the honest
 * degradation for a stale save, and the draw count stays `2 x offers`.
 * @param {any} state
 * @param {Map<string, any>} defs card definitions (injected; rules never import content)
 * @returns {{offers: Array<{cardId: string, price: number, sold: boolean}>, draws: number}}
 */
export function rollShopInventory(state, defs) {
  const pool = (Array.isArray(state.draftPool) ? state.draftPool : []).filter((id) => defs.has(id));
  const pick = pickAt(state.seed, state.rngDraws, pool, SHOP_OFFERS);
  let draws = pick.draws;
  const offers = pick.picked.map((cardId) => {
    const price = priceFor(defs.get(cardId).rarity, state.seed, state.rngDraws + draws);
    draws += 1;
    return { cardId, price, sold: false };
  });
  return { offers, draws };
}
