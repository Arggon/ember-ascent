// Drawing cards — the ONE implementation of "move cards from the draw pile to a hand".
//
// The loop below (reshuffle the discard when the draw pile empties, decorate the
// instance, cap the hand at 10 and overflow to the discard) used to exist in FOUR
// places: the turn draw (act.js), the `draw` verb (vocabulary.js), Blood Tithe
// (rules/effects/index.js) and Ash Embrace (rules/powers.js). card-instance.js had
// already fixed one defect that bred in those copies (hand cards without `cost`);
// this module finishes the job by making the LOOP itself single-sourced, so the
// reshuffle rule and the hand cap each have exactly one home.
//
// THE SHUFFLE CALLBACK. Callers pass `shuffle(state, items) -> {items, draws}` rather
// than a bare rng object, because the two call sites families differ in WHICH draw
// index a reshuffle consumes, and a behavior-preserving extraction must keep both:
//   - the turn draw (act.js) reshuffles at the LIVE counter, reading the state this
//     loop has produced so far;
//   - the card-driven sites (vocabulary.js `draw`, Blood Tithe, Ash Embrace) reshuffle
//     through ctx.rng, whose closure binds the draw index the enclosing play held
//     when the effect started.
// Both are exact; passing the current state to the callback lets each caller encode
// its own rule without this module guessing.
//
// Purity: a pure function of its inputs. No I/O, no clock, no randomness of its own.

import { instantiate } from './card-instance.js';

/** Hand size ceiling: a card drawn onto a full hand is routed to the discard instead. */
export const HAND_LIMIT = 10;

/**
 * Draw up to `count` cards into the hand, reshuffling the discard pile whenever the
 * draw pile empties. Stops early only when both piles run out.
 * @param {any} state run state (reads seed/rngDraws/combat piles)
 * @param {number} count how many cards to draw
 * @param {(state: any, items: any[]) => {items: any[], draws: number}} shuffle
 * @returns {{state: any, drawn: any[], reshuffles: number}} `drawn` holds the hand
 *   cards (or would-be hand cards, when the hand was full) in draw order
 */
export function drawIntoHand(state, count, shuffle) {
  let next = state;
  const drawn = [];
  let reshuffles = 0;
  for (let k = 0; k < count; k += 1) {
    if (next.combat.draw.length === 0) {
      if (next.combat.discard.length === 0) break;
      const sh = shuffle(next, next.combat.discard);
      reshuffles += 1;
      next = { ...next, rngDraws: next.rngDraws + sh.draws, combat: { ...next.combat, draw: sh.items, discard: [] } };
    }
    // Deck instances are stored compactly; the hand copy is decorated with cost so
    // legality checks and rendering never need to re-read content mid-turn.
    const head = instantiate(next.combat.draw[0]);
    const room = next.combat.hand.length < HAND_LIMIT;
    drawn.push(head);
    next = {
      ...next,
      combat: {
        ...next.combat,
        draw: next.combat.draw.slice(1),
        hand: room ? [...next.combat.hand, head] : next.combat.hand,
        discard: room ? next.combat.discard : [...next.combat.discard, head],
      },
    };
  }
  return { state: next, drawn, reshuffles };
}
