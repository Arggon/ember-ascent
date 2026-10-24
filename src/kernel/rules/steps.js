// Step handlers — one home per action kind (the mechanics behind step()).
//
// The kernel entry (index.js) owns the step CONTRACT — match the id against the legal
// list, bump stepIndex, run exactly one handler, fold quests, freeze — and this table
// owns WHAT EACH KIND DOES. Adding an action kind is one registry row plus its
// function; the facade never grows a new branch.
//
// Every handler has the same signature as a vocabulary verb,
//   (bumped, match, content) -> {state, events},
// operates on the stepIndex-bumped state, and returns a fresh state. Purity contract
// unchanged: no Date, no Math.random, no I/O, no input mutation; randomness only
// through the seed stream with every draw counted into rngDraws.
import { parsePlayId } from '../actions.js';
import { VOCABULARY } from './vocabulary.js';
import { startCombat, endTurn, resolveVictory, REST_HEAL } from './act.js';
import { fireHook } from './powers.js';
import { applyBoon } from './kindling.js';
import { offerTempers, temperEffects, temperHpCost } from './tempers.js';
import { findNode } from './map.js';
import { shuffleAt, pickAt } from '../rng.js';

/** Play one card from hand and settle the combat if it ended. */
function playCard(state, action, content) {
  const parsed = parsePlayId(action.id);
  if (!parsed) return { state, events: [] };
  const idx = parsed.slot - 1;
  const target = parsed.target;
  const card = state.combat.hand[idx];
  if (!card) return { state, events: [] };

  const def = content.cards.get(card.cardId);
  if (!def) return { state, events: [] };

  // Resolve the aim against the LIVING enemies in state order — the same list, in the
  // same order, that actions.js enumerated when it offered this id (rule 2).
  //
  // A dead or out-of-range target cannot reach here: `step` matched the id against the
  // legal list, and that list never contains one. So the only way to arrive with a dead
  // aim is for an effect of THIS card to have killed it mid-card (rule 5) — which is
  // re-checked per effect inside the loop below.
  const aimAt = (s) => {
    const liveIdx = s.combat.enemies.map((e, i) => (!e.dead ? i : -1)).filter((i) => i !== -1);
    if (target === null) return liveIdx[0] ?? 0;
    // `target` is 1-BASED (the index the player and the action id use); `liveIdx` is a
    // 0-based list of living enemy positions. Indexing it with the raw 1-based number was
    // an off-by-one that silently fell back to enemy 1 for every choice — the player aimed
    // at enemy 2 and always hit enemy 1. `target - 1` is the correct mapping.
    const chosen = liveIdx[target - 1];
    return chosen ?? liveIdx[0] ?? 0;
  };

  let next = {
    ...state,
    player: { ...state.player, energy: state.player.energy - card.cost },
    combat: { ...state.combat, hand: state.combat.hand.filter((_, i) => i !== idx) },
  };

  const rng = {
    shuffle: (items) => shuffleAt(state.seed, next.rngDraws, items),
    pick: (items, n) => pickAt(state.seed, next.rngDraws, items, n),
  };

  const events = [];
  // B2: a tempered instance resolves its modified effect list (looked up by uid).
  const temper = state.tempers ? state.tempers[card.uid] : undefined;
  const effects = temper ? temperEffects(def.effects, temper) : def.effects;
  const exhausted = effects.some((e) => e.verb === 'exhaust');
  const hpCost = temperHpCost(temper);
  if (hpCost > 0) {
    const paid = Math.min(hpCost, next.player.hp - 1);
    next = { ...next, player: { ...next.player, hp: next.player.hp - paid } };
    events.push({ t: 'hp_cost', amount: paid, source: 'temper' });
  }

  for (const effect of effects) {
    // Re-resolved per effect, not hoisted: if an earlier effect killed the aimed enemy,
    // the remaining effects of the SAME card must land somewhere legal rather than
    // write to a corpse (rule 5). Re-resolution is what makes that a property instead of
    // a promise, and it costs nothing when the aim is still alive.
    const ctx = {
      rng,
      card,
      source: 'player',
      target: null,
      targetEnemyIndex: aimAt(next),
      aimed: target !== null,
    };
    const fn = VOCABULARY[effect.verb];
    const out = fn(next, ctx, effect);
    next = out.state;
    events.push(...out.events);
  }

  // Load the spent card into discard, unless it exhausted itself.
  const alreadyExhausted = next.combat.exhaust.some((e) => e.uid === card.uid);
  if (!exhausted && !alreadyExhausted) {
    next = {
      ...next,
      combat: { ...next.combat, discard: [...next.combat.discard, { uid: card.uid, cardId: card.cardId, perPlay: card.perPlay }] },
    };
  } else if (exhausted && !alreadyExhausted) {
    // Only when the `exhaust` verb did not already file it: otherwise the card is
    // pushed twice and the exhaust pile claims two copies of a one-copy card.
    next = { ...next, combat: { ...next.combat, exhaust: [...next.combat.exhaust, { uid: card.uid, cardId: card.cardId }] } };
  }

  // Exhaust hooks (Feel No Pain / Dark Embrace) fire per exhausted card.
  if (exhausted) {
    const hook = fireHook(next, 'on_exhaust', { rng });
    next = hook.state;
    events.push(...hook.events);
  }

  // One enemy left alive on the field? Then the combat continues; if all are dead
  // we settle victory immediately rather than making the player press end turn.
  if (next.combat.active && next.combat.enemies.every((e) => e.dead)) {
    const won = resolveVictory(next, content.cards);
    // Same event shape as the end-turn path (rules/act.js): a combat won by a card must
    // also emit `combat_won`, or elite/boss points are never awarded (DR-6).
    return { state: won.state, events: [...events, { t: 'combat_won' }, ...won.events] };
  }
  if (next.combat.enemies.some((e) => e.dead)) {
    next = { ...next, combat: { ...next.combat, enemies: next.combat.enemies.map((e) => (e.dead ? e : { ...e, index: e.index })) } };
  }
  return { state: next, events };
}

/** Enter the chosen map node. */
function travel(state, action, content) {
  const node = findNode(state.map.rows, action.nodeId);
  if (!node) return { state, events: [] };
  const floor = state.map.rows.findIndex((row) => row.some((n) => n.id === node.id));
  const at = { ...state, floor, mapNodeId: node.id };

  if (node.type === 'boss' || node.type.startsWith('combat') || node.type === 'elite') {
    return startCombat(at, node, content.cards);
  }
  if (node.type === 'rest') {
    if (at.tempers) {
      const offer = offerTempers(at, content.cards);
      return {
        state: { ...at, phase: 'rest', rngDraws: at.rngDraws + offer.draws, temperOffers: offer.offers },
        events: [{ t: 'rest_ready', node: node.id }],
      };
    }
    return { state: { ...at, phase: 'rest' }, events: [{ t: 'rest_ready', node: node.id }] };
  }
  throw new Error(`unhandled node type "${node.type}"`);
}

/** Take one card from the reward offer. */
function pickReward(state, action) {
  const idx = Number(action.id.slice(1)) - 1;
  const cardId = action.cardId;
  if (!cardId || idx < 0) return { state, events: [] };
  const uid = `c${state.deck.length}_${state.stepIndex}`;
  return {
    state: { ...state, deck: [...state.deck, { uid, cardId }], phase: 'map', reward: null },
    events: [{ t: 'card_taken', cardId, uid }],
  };
}

/**
 * The registry: action kind -> runner. `step` looks the matched action's kind up here;
 * a kind with no row is the internal-error path (code 1), never a silent no-op.
 * Runners receive the stepIndex-bumped state, the matched action, and the content.
 */
export const STEP_HANDLERS = Object.freeze({
  play: playCard,
  end_turn: (state, _match, content) => endTurn(state, content.cards),
  travel,
  pick: pickReward,
  skip: (state) => ({ state: { ...state, phase: 'map', reward: null }, events: [{ t: 'reward_skipped' }] }),
  rest_heal: (state) => {
    const healed = Math.min(REST_HEAL, state.player.maxHp - state.player.hp);
    return {
      state: { ...state, player: { ...state.player, hp: state.player.hp + healed }, phase: 'map', ...(state.tempers ? { temperOffers: null } : {}) },
      events: [{ t: 'heal', who: 'player', amount: healed, source: 'rest' }],
    };
  },
  temper: (state, match) => {
    const o = match.offer;
    return {
      state: { ...state, tempers: { ...state.tempers, [o.uid]: o.temper }, temperOffers: null, phase: 'map' },
      events: [{ t: 'card_tempered', uid: o.uid, cardId: o.cardId, temper: o.temper }],
    };
  },
  boon: (state, match) => applyBoon(state, match.boon),
  rest_leave: (state) => ({ state: { ...state, phase: 'map', ...(state.tempers ? { temperOffers: null } : {}) }, events: [{ t: 'rest_left' }] }),
});
