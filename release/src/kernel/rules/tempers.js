// Tempers — one permanent modifier per card instance (B2). Opt-in per run
// (`newRun({ tempers: true })`).
//
// A rest site offers three seeded (card, temper) pairs as an alternative to healing.
// Tempers are stored by deck-instance uid in `state.tempers`, so the hand / draw / discard
// copies never need to carry them and every existing copy site stays untouched. A run
// without the option has no `tempers` field, never sees a temper action and keeps its
// stream and hashes byte-identical. Pure; every draw is counted into rngDraws.
import { pickAt, intAt } from '../rng.js';

/** How many (card, temper) pairs a rest site offers. */
export const TEMPER_OFFERS = 3;

export const TEMPERS = Object.freeze({
  quenched: { name: 'Quenched', label: 'Q', text: 'Quenched: also gain 3 Block.' },
  redhot: { name: 'Red-hot', label: 'RH', text: 'Red-hot: +50% damage. Lose 2 HP when played.' },
  balanced: { name: 'Balanced', label: 'BAL', text: 'Balanced: also draw 1 card. Exhausts.' },
});
/** Stable order, part of the format (the seeded roll indexes into it). */
export const TEMPER_IDS = Object.freeze(['quenched', 'redhot', 'balanced']);

/** Which tempers fit a card: Red-hot only on cards that deal damage. */
function fitting(def) {
  const hits = (def.effects ?? []).some((e) => e.verb === 'damage');
  return TEMPER_IDS.filter((t) => t !== 'redhot' || hits);
}

/**
 * Seeded rest offer: up to 3 untempered deck instances, each with a fitting temper.
 * @param {any} state
 * @param {Map<string, any>} defs
 * @returns {{offers: Array<{uid: string, cardId: string, temper: string}>, draws: number}}
 */
export function offerTempers(state, defs) {
  const open = state.deck.filter((c) => !state.tempers[c.uid] && defs.has(c.cardId));
  const pick = pickAt(state.seed, state.rngDraws, open, TEMPER_OFFERS);
  let draws = pick.draws;
  const offers = pick.picked.map((c) => {
    const fits = fitting(defs.get(c.cardId));
    const temper = fits[intAt(state.seed, state.rngDraws + draws, fits.length)];
    draws += 1;
    return { uid: c.uid, cardId: c.cardId, temper };
  });
  return { offers, draws };
}

/**
 * The effect list a tempered card actually resolves.
 * @param {ReadonlyArray<any>} effects
 * @param {string | undefined} temper
 * @returns {any[]}
 */
export function temperEffects(effects, temper) {
  if (!temper) return effects.slice();
  if (temper === 'quenched') return [...effects, { verb: 'block', amount: 3 }];
  if (temper === 'redhot') {
    return effects.map((e) => (e.verb === 'damage' ? { ...e, amount: Math.floor((e.amount * 3) / 2) } : e));
  }
  if (temper === 'balanced') {
    const out = [...effects, { verb: 'draw', amount: 1 }];
    return out.some((e) => e.verb === 'exhaust') ? out : [...out, { verb: 'exhaust' }];
  }
  return effects.slice();
}

/** HP the player pays when a tempered card is played (ignores Block, never below 1). */
export function temperHpCost(temper) {
  return temper === 'redhot' ? 2 : 0;
}
