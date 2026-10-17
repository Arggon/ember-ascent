// Legal actions — the single source of truth for what a player may do (R5, R6).
//
// Kept separate from index.js so the observation module can render action lines
// without importing the entry point (which would be a cycle). The action-id scheme
// is frozen by the requirements:
//   p<n> play hand slot n · e1 end turn · c continue · s<n> reward pick · n<n> map node
//   k<n> kindling boon (opt-in runs only; additive, no existing id changes)
//   t<n> temper a card at a rest site (opt-in runs only; additive)
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
