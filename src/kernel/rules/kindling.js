// Kindling — act-start boons with a cost (B1). Opt-in per run (`newRun({ kindling: true })`).
//
// At the start of the act the forge offers three boons drawn from BOONS by the seed
// stream. Each has an upside AND a cost; taking one is mandatory (there is no skip
// action). Pure: offers are a seeded pick whose draws are counted into rngDraws, and a
// boon only rewrites deck / HP / energy / flags, so replay stays exact. A run without
// the option never enters this phase and its state, stream and hashes are unchanged.
import { pickAt } from '../rng.js';

/** How many boons the forge offers. */
export const KINDLING_OFFERS = 3;

/**
 * Boon table. `text` is the player-facing sentence (upside, then cost); `label` is the
 * compact R4 token. Effects are data interpreted by applyBoon() below.
 */
export const BOONS = Object.freeze({
  bellows: { name: 'Bellows Breath', label: 'EN+1 MAXHP-12', text: 'Gain 1 Energy every turn. Lose 12 max HP.', energy: 1, maxHp: -12 },
  ironskin: { name: 'Iron Skin', label: 'MAXHP+15 RELIC-OFF', text: 'Gain 15 max HP and heal fully. Your {relic} {relicOff}.', maxHp: 15, fullHeal: true, relicOff: true },
  sparkfall: { name: 'Sparkfall', label: 'ADD 2 Spark HP-6', text: 'Add 2 Spark to your deck. Lose 6 HP.', add: ['anger', 'anger'], hp: -6 },
  purge: { name: 'Ash Purge', label: 'DEL 2 Hammerfall MAXHP-6', text: 'Remove 2 Hammerfall from your deck. Lose 6 max HP.', remove: ['strike', 'strike'], maxHp: -6 },
  stoke: { name: 'Banked Coals', label: 'ADD Stoke HP-15', text: 'Add Stoke to your deck. Lose 15 HP.', add: ['inflame'], hp: -15 },
});

/**
 * Player-facing boon text for one hero. A relic-off boon names that hero's own relic and
 * what it stops doing (`relic` = the hero's relic name, `relicOff` = its RELICS offText).
 * @param {string} id
 * @param {{name: string, offText: string}} relic
 */
export function boonText(id, relic) {
  return BOONS[id].text.replace('{relic}', relic.name).replace('{relicOff}', relic.offText);
}

/** Stable boon order: the pick indexes into this list, so it is part of the format. */
export const BOON_IDS = Object.freeze(['bellows', 'ironskin', 'sparkfall', 'purge', 'stoke']);

/**
 * Seeded offer of KINDLING_OFFERS boon ids.
 * @param {number} seed
 * @param {number} startDraw
 * @returns {{ids: string[], draws: number}}
 */
export function offerBoons(seed, startDraw) {
  const { picked, draws } = pickAt(seed, startDraw, BOON_IDS, KINDLING_OFFERS);
  return { ids: picked, draws };
}

/**
 * Apply one boon and leave the kindling phase for the map. Pure.
 * HP never drops below 1 from a boon cost; max HP never below 10.
 * @param {any} state
 * @param {string} id
 * @returns {{state: any, events: any[]}}
 */
export function applyBoon(state, id) {
  const b = BOONS[id];
  let deck = state.deck.slice();
  for (const cardId of b.remove ?? []) {
    const at = deck.findIndex((c) => c.cardId === cardId);
    if (at >= 0) deck.splice(at, 1);
  }
  (b.add ?? []).forEach((cardId, k) => deck.push({ uid: `k${k}_${cardId}`, cardId }));
  let maxHp = Math.max(10, state.player.maxHp + (b.maxHp ?? 0));
  let hp = Math.min(maxHp, state.player.hp + Math.max(0, b.maxHp ?? 0));
  if (b.fullHeal) hp = maxHp;
  hp = Math.max(1, Math.min(maxHp, hp + (b.hp ?? 0)));
  const next = {
    ...state,
    deck,
    energyPerTurn: (state.energyPerTurn ?? 3) + (b.energy ?? 0),
    relicOff: Boolean(state.relicOff || b.relicOff),
    player: { ...state.player, hp, maxHp },
    phase: 'map',
    kindling: { offers: state.kindling.offers, taken: id },
  };
  return { state: next, events: [{ t: 'boon_taken', boon: id }] };
}
