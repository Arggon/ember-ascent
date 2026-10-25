// Legal actions — the single source of truth for what a player may do (R5, R6).
//
// Kept separate from index.js so the observation module can render action lines
// without importing the entry point (which would be a cycle). The action-id scheme
// is frozen by the requirements:
//   p<n> play hand slot n · e1 end turn · c continue · s<n> reward pick · n<n> map node
//   k<n> kindling boon (opt-in runs only; additive, no existing id changes)
//   t<n> temper a card at a rest site (opt-in runs only; additive)
//   b<n> buy shop offer n (S4; additive — the offer list is state.shop.offers, 1-based)
//   x    buy the card-removal service at a shop (S4; additive — one per visit, flat
//        price, moves the shop into its removal step)
//   x<n> during a shop's removal step: remove the n-th deck INSTANCE, 1-based in deck
//        order (S4; additive — uid-precise because every deck slot is a distinct
//        instance; three Hammerfalls are three separate choices, listed by uid order)
//   l    leave the shop — final; the node is consumed like a fight (S4; additive)
//   q<n>    quaff the n-th BELT slot, 1-based (S5; additive — combat ONLY; both belt
//        actions exist nowhere else: the belt is display-only on the map, in the shop
//        and at rest). Consumes the slot; zero draws (rules/potions.js).
//   q<n>_<k> the AIMED form, exactly the p<n>_<k> convention: a potion whose content
//        declares `target: "enemy"` (Ember Draught) must be aimed when more than one
//        enemy is alive; k is the 1-BASED LIVING enemy in state order. With one enemy
//        alive the plain q<n> is used, and `all`/`self` potions never ask.
//   d<n>    discard the n-th belt slot (S5; additive — combat ONLY). A free action:
//        the slot frees, nothing else moves, zero draws. Offered for EVERY belt slot
//        including one carrying a stale id, so a torn save's corrupt slot can be
//        cleared; a quaff is offered ONLY for ids the potion table still knows (the
//        handler would refuse — enumeration mirrors the guard, the S4.1 ruling).
//
// TARGETED PLAYS (PM Document revision 5). A card whose content declares
// `target: "enemy"` must be aimed by the player when the choice is real, i.e. when
// more than one enemy is alive. The id carries the target so the action is fully
// self-describing:
//   p<n>        slot n, unaimed  — always used when exactly one enemy lives (there is
//                                 no choice to make, and existing logs stay readable),
//                                 and used by `all` / `self` cards in any fight
//   p<n>_<k>    slot n aimed at the k-th LIVING enemy, 1-based, in the order the state
//                                 dump prints them
//
// WHY '_' AND NOT A SPACE. The shipped id is ASCII and the observation layer renders it
// as `p<n> <k>` (a space, per the frozen contract). The separator is '_' because the
// action id is also a save/log token and must stay a single whitespace-free word: the
// CLI splits it out of argv, and JSONL logs must not depend on shell quoting. It costs
// no interface tokens either way — measured with the repo's own countWorst, `p2 1` and
// `p2_1` are both 4 tokens, over the full census:
//   $ node scripts/dev/measure-action-shapes.mjs
//   7 PASS "p10 sword_boomerang"   <- current single-enemy line, unchanged
//   ...
//
// A DEAD OR OUT-OF-RANGE TARGET IS NEVER EMITTED. That is what makes rule 2 hold without
// a special case in the kernel: the action simply does not exist, so `step` rejects it
// through the one existing R6 path (legal no-op, exit 2, counted in the malformed rate)
// exactly like any other unknown id. A dead enemy is not in the list and can never be
// enumerated here.
import { availableNodes } from './rules/map.js';
import { REMOVAL_PRICE } from './rules/shop.js';
import { potionDef } from './rules/potions.js';
import { cardDefMap } from './rules/card-instance.js';

/** Card definitions are injected once at kernel load (rules never import content, R1). */
function cardDefs() {
  try {
    return cardDefMap();
  } catch {
    // Defensive: a caller that reaches actions() before kernel init gets the unaimed
    // behaviour rather than a throw. The kernel always initialises first in practice.
    return null;
  }
}

/** The living enemies, in state order — the ONE ordering every index refers to. */
function livingEnemies(state) {
  return state.combat.enemies.filter((e) => !e.dead);
}

/**
 * Does this card take an aim at a single enemy?
 *
 * Content decides (`target: "enemy"`), not the caller: `all` and `self` cards must never
 * accept or require a target (rule 3), and an unknown card id is treated as unaimed so a
 * broken content entry degrades to the old behaviour instead of crashing a fight.
 * @param {any} cardId
 * @returns {boolean}
 */
function isSingleTargetCard(cardId) {
  const def = cardDefs()?.get(cardId);
  return def?.target === 'enemy';
}

/**
 * Legal actions for the current state, with short stable ids.
 * @param {any} state
 * @returns {Array<{id: string, kind: string, cardId?: string, cost?: number, targetEnemyIndex?: number, cardTargets?: boolean, nodeType?: string, nodeId?: string}>}
 */
export function actions(state) {
  const out = [];
  switch (state.phase) {
    case 'combat': {
      const living = livingEnemies(state);
      state.combat.hand.forEach((card, i) => {
        if (card.cost <= state.player.energy) {
          const aimable = isSingleTargetCard(card.cardId) && living.length > 1;
          // `cardTargets` states whether THIS action carries a target, so a consumer
          // never has to re-derive card content to know if it may append one.
          const base = { kind: 'play', cardId: card.cardId, cost: card.cost, cardTargets: aimable };
          if (!aimable) {
            out.push({ ...base, id: `p${i + 1}`, targetEnemyIndex: null });
          } else {
            living.forEach((_enemy, k) => {
              out.push({ ...base, id: `p${i + 1}_${k + 1}`, targetEnemyIndex: k });
            });
          }
        }
      });
      out.push({ id: 'e1', kind: 'end_turn' });
      // S5: the belt. One quaff (aimed per living enemy when the potion targets and the
      // choice is real) and one discard per slot — COMBAT ONLY, so this block sits in
      // the combat case and nowhere else. A stale belt id (a torn save) gets a discard
      // but no quaff: quaffPotion would refuse it, and an offered-but-refused id is
      // the legal-no-op inversion S4.1 ruled out.
      (Array.isArray(state.potions) ? state.potions : []).forEach((potionId, i) => {
        const def = potionDef(potionId);
        if (def && def.target === 'enemy' && living.length > 1) {
          living.forEach((_enemy, k) => {
            out.push({ id: `q${i + 1}_${k + 1}`, kind: 'quaff', index: i, potionId, targetEnemyIndex: k });
          });
        } else if (def) {
          out.push({ id: `q${i + 1}`, kind: 'quaff', index: i, potionId, targetEnemyIndex: null });
        }
        out.push({ id: `d${i + 1}`, kind: 'discard_potion', index: i, potionId });
      });
      break;
    }
    case 'map': {
      availableNodes(state).forEach((n, i) => {
        out.push({ id: `n${i + 1}`, kind: 'travel', nodeType: n.type, nodeId: n.id });
      });
      break;
    }
    case 'reward': {
      state.reward.cards.forEach((id, i) => out.push({ id: `s${i + 1}`, kind: 'pick', cardId: id }));
      out.push({ id: 's0', kind: 'skip' });
      break;
    }
    case 'rest': {
      out.push({ id: 'c', kind: 'rest_heal' });
      out.push({ id: 'e1', kind: 'rest_leave' });
      (state.temperOffers ?? []).forEach((offer, i) => out.push({ id: `t${i + 1}`, kind: 'temper', offer }));
      break;
    }
    case 'kindling': {
      state.kindling.offers.forEach((boon, i) => out.push({ id: `k${i + 1}`, kind: 'boon', boon }));
      break;
    }
    case 'shop': {
      // S4: the shop is a room that stays open until the player leaves. The removal
      // step is MODAL — the service is already paid for, so the only choices that
      // exist are which deck instance goes (no leaving mid-removal, no buying past
      // it), which is what keeps "paid" and "picked" from ever drifting apart.
      const shop = state.shop ?? { offers: [], removal: null };
      if (shop.removing) {
        (state.deck ?? []).forEach((inst, i) => {
          out.push({ id: `x${i + 1}`, kind: 'shop_remove_pick', index: i, cardId: inst.cardId });
        });
        break;
      }
      const purse = state.player.gold ?? 0;
      (shop.offers ?? []).forEach((o, i) => {
        // R6, exactly like an unplayable hand card: an offer the purse cannot cover
        // (or one already sold) is not an action at all. There is no "buy and bounce",
        // so no surface can render a button the kernel would reject.
        if (o.sold || o.price > purse) return;
        out.push({ id: `b${i + 1}`, kind: 'shop_buy', index: i, cardId: o.cardId, price: o.price });
      });
      // The service: one per visit, only while it is unused, the deck still holds more
      // than one card (hard invariant — a deck of exactly 1 is not a deck), and the
      // purse covers the flat price. `rem` is tested for existence, not defaulted: a
      // torn save (shop field absent/null) must not enumerate an `x` the handler's own
      // guard would refuse — that would be a legal no-op, the R6 inversion this file
      // rules out a few lines up (S4.1 review P3).
      const rem = shop.removal;
      if (rem && !rem.sold && !rem.done && (state.deck?.length ?? 0) > 1 && (rem.price ?? REMOVAL_PRICE) <= purse) {
        out.push({ id: 'x', kind: 'shop_removal', price: rem.price ?? REMOVAL_PRICE });
      }
      out.push({ id: 'l', kind: 'shop_leave' });
      break;
    }
    case 'ended':
      break;
    default:
      break;
  }
  return out;
}

/**
 * Parse an action id into its parts. The ONE parser: `step` and the observation layer
 * both go through it, so a form cannot be legal in one and invisible in the other.
 *
 * Accepted shapes: `p3` (slot 3, unaimed) and `p3_2` (slot 3 aimed at the 2nd living
 * enemy). Anything else yields null, which callers turn into the R6 rejection path.
 * @param {unknown} id
 * @returns {{kind: 'play', slot: number, target: number | null} | null}
 */
export function parsePlayId(id) {
  if (typeof id !== 'string') return null;
  const m = /^p(\d{1,2})(?:_(\d{1,2}))?$/.exec(id);
  if (!m) return null;
  const slot = Number(m[1]);
  const target = m[2] === undefined ? null : Number(m[2]);
  if (slot < 1 || (target !== null && target < 1)) return null;
  return { kind: 'play', slot, target };
}
