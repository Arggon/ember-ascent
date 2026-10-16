// Card runtime instances — the ONE place a deck instance becomes a hand card.
//
// WHY THIS MODULE EXISTS
// Deck instances are stored compactly (`{uid, cardId, perPlay}`) so a save never duplicates
// content definitions. A card in the HAND additionally needs `cost`, because legality
// checks and rendering both read it and neither should re-read content mid-turn.
//
// The defect this fixes: three of the four draw sites pushed the raw instance straight into
// the hand, so `card.cost` was `undefined`. The browser rendered a literal "undefined" in
// the cost gem and the card was unusable, because its cost could not be compared against
// the player's energy. There were three copies of the same mistake because there was no
// single place to call.
//
// This module sits BELOW act.js and vocabulary.js in the import graph on purpose: act.js
// already imports vocabulary.js, so vocabulary.js cannot import act.js without a cycle.
// Both of them, and the effect handlers, import this instead.
//
// Purity: a pure function of its inputs. No I/O, no clock, no randomness, no mutation.

/** @type {Map<string, any> | null} */
let CARD_DEFS = null;

/**
 * Register the card definitions for the current content set. Called once at kernel load.
 * @param {Map<string, any>} defs
 */
export function setCardDefs(defs) {
  CARD_DEFS = defs;
}

/**
 * The registered card definitions. Throws rather than returning null: a null here would
 * resurface as the same silent `undefined` cost this module exists to prevent.
 * @returns {Map<string, any>}
 */
export function cardDefMap() {
  if (CARD_DEFS === null) {
    throw new Error('card defs not initialised: call setCardDefs before instantiating cards');
  }
  return CARD_DEFS;
}

/**
 * Decorate a compact deck instance into a runtime hand card.
 *
 * Throws on an unknown card id and on a missing/non-numeric cost. Both were silent before:
 * the unknown id produced a card with no name, and the missing cost produced a card that
 * rendered "undefined" and could not be played.
 *
 * @param {{uid: string, cardId: string, perPlay?: number}} inst
 * @param {Map<string, any>} [cardDefs] defaults to the registered definitions
 * @returns {{uid: string, cardId: string, cost: number, perPlay: number}}
 */
export function instantiate(inst, cardDefs = cardDefMap()) {
  const def = cardDefs.get(inst.cardId);
  if (!def) throw new Error(`unknown card id "${inst.cardId}"`);
  if (typeof def.cost !== 'number' || !Number.isFinite(def.cost)) {
    throw new Error(`card "${inst.cardId}" has no numeric cost (got ${JSON.stringify(def.cost)})`);
  }
  return { uid: inst.uid, cardId: inst.cardId, cost: def.cost, perPlay: inst.perPlay ?? 0 };
}
