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
import { rollShopInventory, REMOVAL_PRICE } from './shop.js';
import { rollEventAt, resolveChoice, resolveTemper, continueEvent } from './events.js';
import { potionDef, quaffEffects } from './potions.js';
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
  // S4: the shop's wares roll HERE, at entry, from the live counter (rules/shop.js for
  // the full draw accounting — a full inventory is exactly 10 draws). Entry happens
  // through this one step and re-entry is impossible, so the counter the rolls read is
  // reproducible from the action log forever; nothing is pre-rolled at map generation,
  // so a run that never visits pays nothing from the stream.
  if (node.type === 'shop') {
    const inv = rollShopInventory(at, content.cards);
    return {
      state: {
        ...at,
        phase: 'shop',
        rngDraws: at.rngDraws + inv.draws,
        shop: {
          offers: inv.offers,
          removal: { price: REMOVAL_PRICE, sold: false, done: false },
          removing: false,
        },
      },
      events: [{ t: 'shop_open', node: node.id }],
    };
  }
  // S6: the event's STORY rolls HERE, at entry, from the live counter — exactly ONE
  // draw (which event the wayside holds; rules/events.js for the full accounting).
  // The same convention as the shop's inventory: entry happens through this one step,
  // re-entry is impossible, and a run that never visits pays nothing from the stream.
  if (node.type === 'event') {
    const roll = rollEventAt(at);
    return {
      state: {
        ...at,
        phase: 'event',
        rngDraws: at.rngDraws + roll.draws,
        event: { id: roll.id, nodeId: node.id, resolved: null, tempering: false, offers: null },
      },
      events: [{ t: 'event_open', node: node.id, event: roll.id }],
    };
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

/* --------------------------------------------------------------- S4: the shop --
 * Four handlers, one per shop action kind. The id was matched against the legal list
 * by step() before any of these run, so affordability and mode are already guaranteed:
 * an unaffordable offer never produced an id, and a `shop_remove_pick` only exists in
 * the paid removal step. Each handler still degrades to a no-op on a stale match
 * rather than throwing — the same defensive shape playCard keeps. */

/** Buy one shelf offer: deduct the price, add the card instance, mark the slot sold. */
function buyOffer(state, match) {
  const offer = state.shop?.offers?.[match.index];
  if (!offer || offer.sold) return { state, events: [] };
  const uid = `c${state.deck.length}_${state.stepIndex}`;
  return {
    state: {
      ...state,
      // `?? 0` — validateSave keeps player.gold optional, so a pre-gold save standing in
      // a shop (S4.1 review P2) deducts from an empty purse: `undefined - 0` was NaN,
      // which made canonical() — and therefore hash() and every save — throw.
      player: { ...state.player, gold: (state.player.gold ?? 0) - offer.price },
      deck: [...state.deck, { uid, cardId: offer.cardId }],
      shop: { ...state.shop, offers: state.shop.offers.map((o, i) => (i === match.index ? { ...o, sold: true } : o)) },
    },
    events: [
      { t: 'gold_spent', amount: offer.price, what: 'card', cardId: offer.cardId },
      { t: 'card_bought', cardId: offer.cardId, uid, price: offer.price },
    ],
  };
}

/** Buy the removal service: deduct the flat price and open the removal step. */
function buyRemoval(state) {
  const rem = state.shop?.removal;
  if (!rem || rem.sold || rem.done) return { state, events: [] };
  return {
    state: {
      ...state,
      // Same purse floor as buyOffer above (S4.1 review P2): the field is optional on
      // every save validateSave accepts, so the deduction must not read it bare.
      player: { ...state.player, gold: (state.player.gold ?? 0) - rem.price },
      shop: { ...state.shop, removal: { ...rem, sold: true }, removing: true },
    },
    events: [
      { t: 'gold_spent', amount: rem.price, what: 'removal' },
      { t: 'removal_paid', price: rem.price },
    ],
  };
}

/** The removal step's pick: exactly one deck INSTANCE (uid-precise) leaves the deck. */
function pickRemoval(state, match) {
  const inst = state.deck?.[match.index];
  // Hard invariant: a deck of exactly one card cannot shrink further. Unreachable
  // through legal ids (the service is not sold at deck length 1), guarded here because
  // the handler is the one place the deck actually shrinks.
  if (!inst || state.deck.length <= 1) return { state, events: [] };
  return {
    state: {
      ...state,
      deck: state.deck.filter((_, i) => i !== match.index),
      shop: { ...state.shop, removing: false, removal: { ...state.shop.removal, done: true } },
    },
    events: [{ t: 'card_removed', uid: inst.uid, cardId: inst.cardId }],
  };
}

/** Leave the shop — final: the phase closes, the room is consumed with the node. */
function leaveShop(state) {
  return { state: { ...state, phase: 'map', shop: null }, events: [{ t: 'shop_left' }] };
}

/* ------------------------------------------------------------ S6: the event wayside --
 * Three registry rows; the mechanics live in rules/events.js (the same shape the shop
 * keeps: handlers here stay thin, the domain module owns the numbers). The id was
 * matched against the legal list by step() before any of these run, so a chosen choice
 * was offered, its guards held, and a temper pick only exists inside the open modal.
 * Each handler still degrades to a no-op on a stale match rather than throwing.
 *
 * DRAW ACCOUNTING (rules/events.js header): the choice resolution draws happen inside
 * resolveChoice/openTemper, which advance the counter themselves; the continue and the
 * modal's pick are choices, not rolls — zero draws. */

/* ------------------------------------------------------------- S5: the potion belt --
 * Two handlers, one per belt action kind. The id was matched against the legal list by
 * step() before either runs, so the slot index is in range, the phase is `combat`
 * (actions() offers belt ids nowhere else) and — for a quaff — the potion id is one
 * the table still knows (an unknown belt id is offered a discard, never a quaff, the
 * same enumeration-mirrors-guard ruling as the S4.1 torn shop). Each handler still
 * degrades to a no-op on a stale match rather than throwing — the same defensive
 * shape every handler here keeps.
 *
 * DRAW ACCOUNTING (rules/potions.js header): NEITHER action consumes a draw. A quaff's
 * numbers are all fixed; a discard changes nothing but the belt. */

/** Quaff belt slot `match.index` (0-based): the potion leaves the belt and resolves. */
function quaffPotion(state, match) {
  const belt = Array.isArray(state.potions) ? state.potions : [];
  const idx = match.index;
  const potionId = belt[idx];
  // No slot, or a slot whose id the table no longer knows: nothing to resolve. A
  // stale id can only reach here through a torn save — its quaff was never offered.
  if (potionId === undefined || !potionDef(potionId)) return { state, events: [] };
  const def = potionDef(potionId);

  // Resolve the aim exactly like playCard: the LIVING enemies in state order. The
  // aimed form (q<n>_<k>) carries `targetEnemyIndex` = the 0-based LIVING position the
  // enumeration used — the same field a play action carries. `q<n>` unaimed is null
  // and falls to the first living enemy; a dead/out-of-range value (impossible through
  // legal ids — the enumeration only offers living ks) falls the same way.
  const liveIdx = state.combat.enemies.map((e, i) => (!e.dead ? i : -1)).filter((i) => i !== -1);
  const aimed = match.targetEnemyIndex !== null && liveIdx[match.targetEnemyIndex] !== undefined
    ? match.targetEnemyIndex
    : liveIdx[0] ?? 0;

  // The slot is consumed BEFORE the effect resolves: a potion cannot quaff itself
  // twice, and the belt the victory path (a killing Ember Draught) reads afterwards
  // is the post-quaff belt.
  const spent = {
    ...state,
    potions: belt.filter((_, i) => i !== idx),
  };
  const out = quaffEffects(spent, potionId, aimed);
  let next = out.state;
  const events = [{ t: 'potion_quaffed', slot: idx + 1, potion: potionId, name: def.name }, ...out.events];

  // The same settle-as-playCard tail: an Ember Draught that kills the last enemy must
  // resolve victory through the ONE implementation, combat_won included (DR-6), or
  // the fight would hang on an all-dead field with only `e1` left to press.
  if (next.combat.active && next.combat.enemies.every((e) => e.dead)) {
    const won = resolveVictory(next, null);
    return { state: won.state, events: [...events, { t: 'combat_won' }, ...won.events] };
  }
  return { state: next, events };
}

/** Discard belt slot `match.index` (0-based): the slot frees, nothing else moves. */
function discardPotion(state, match) {
  const belt = Array.isArray(state.potions) ? state.potions : [];
  const idx = match.index;
  if (belt[idx] === undefined) return { state, events: [] };
  const potionId = belt[idx];
  return {
    state: { ...state, potions: belt.filter((_, i) => i !== idx) },
    // Known potion or stale id alike: the dump names what left, by id — the describe
    // layer's job to render, and a stale id renders as itself (never a throw).
    events: [{ t: 'potion_discarded', slot: idx + 1, potion: potionId }],
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
  shop_buy: buyOffer,
  shop_removal: buyRemoval,
  shop_remove_pick: pickRemoval,
  shop_leave: leaveShop,
  event_choice: (state, match, content) => resolveChoice(state, match, content.cards),
  event_temper: (state, match) => resolveTemper(state, match),
  event_continue: continueEvent,
  quaff: quaffPotion,
  discard_potion: discardPotion,
});
