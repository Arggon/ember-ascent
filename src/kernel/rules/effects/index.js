// Exotic card handlers — rules/effects/<id>.js (ADR-3).
//
// Each handler is the implementation behind a card's single `custom` verb and obeys
// the same purity contract as the closed vocabulary: (state, ctx, params) -> {state, events},
// no Date, no Math.random, no I/O, no input mutation. Importing this module registers
// every handler exactly once; the architecture gate checks the purity of all of them.
import { registerEffect, damageEnemy, playerStrike, addStatus, addPower, loseHp } from '../vocabulary.js';
import { drawIntoHand } from '../draw.js';

/** Vein Tap: pay 3 HP, gain 2 energy. */
registerEffect('vein_tap', (state, _ctx, _params) => {
  const player = { ...loseHp(state.player, 3), energy: state.player.energy + 2 };
  return { state: { ...state, player }, events: [{ t: 'self_damage', amount: 3 }, { t: 'energy', amount: 2 }] };
});

/** Blood Hammer: pay 2 HP, deal 15 damage. */
registerEffect('blood_hammer', (state, ctx, _params) => {
  const player = loseHp(state.player, 2);
  const idx = ctx.targetEnemyIndex ?? 0;
  const target = state.combat.enemies[idx];
  if (!target || target.dead) {
    return { state: { ...state, player }, events: [{ t: 'self_damage', amount: 2 }] };
  }
  const out = damageEnemy(target, playerStrike(15, player));
  return {
    state: {
      ...state,
      player,
      combat: { ...state.combat, enemies: state.combat.enemies.map((e, i) => (i === idx ? out.enemy : e)) },
    },
    events: [{ t: 'self_damage', amount: 2 }, { t: 'damage', source: 'player', target: idx, raw: out.raw, dealt: out.dealt, blocked: out.blocked, hp: out.enemy.hp }],
  };
});

/** Ash Harvest: deal 4 damage to ALL enemies, heal HP equal to unblocked damage dealt. */
registerEffect('ash_harvest', (state, ctx, _params) => {
  let healed = 0;
  const events = [];
  const enemies = state.combat.enemies.map((e, i) => {
    if (e.dead) return e;
    const out = damageEnemy(e, playerStrike(4, state.player));
    healed += out.dealt;
    events.push({ t: 'damage', source: 'player', target: i, raw: out.raw, dealt: out.dealt, blocked: out.blocked, hp: out.enemy.hp });
    return out.enemy;
  });
  const player = { ...state.player, hp: Math.min(state.player.maxHp, state.player.hp + healed) };
  if (healed > 0) events.push({ t: 'heal', who: 'player', amount: healed });
  return { state: { ...state, player, combat: { ...state.combat, enemies } }, events };
});

/** Overtemper: double current Strength (no-op without Strength). */
registerEffect('overtemper', (state, _ctx, _params) => {
  const cur = state.player.statuses?.strength ?? 0;
  if (cur <= 0) return { state, events: [{ t: 'noop', reason: 'no_strength' }] };
  return {
    state: { ...state, player: addStatus(state.player, 'strength', cur) },
    events: [{ t: 'status', who: 'player', status: 'strength', stacks: cur }],
  };
});

/** Blood Tithe: pay 6 HP, gain 2 energy, draw 3. */
registerEffect('blood_tithe', (state, ctx, _params) => {
  const player = { ...loseHp(state.player, 6), energy: state.player.energy + 2 };
  // Same ctx.rng-bound shuffle as the `draw` verb (see rules/draw.js): the stream
  // semantics of the old inline loop are preserved exactly.
  const out = drawIntoHand({ ...state, player }, 3, (_s, items) => ctx.rng.shuffle(items));
  return {
    state: out.state,
    events: [
      { t: 'self_damage', amount: 6 },
      { t: 'energy', amount: 2 },
      { t: 'draw', count: out.drawn.length, uids: out.drawn.map((c) => c.uid), reshuffles: out.reshuffles },
    ],
  };
});

/** Banked Coal: gain the Banked Coal power (damage at end of turn, self-damage each turn). */
registerEffect('banked_coal', (state, _ctx, _params) => {
  return { state: addPower(state, 'banked_coal', 1), events: [{ t: 'power', power: 'banked_coal', stacks: 1 }] };
});

/** Ash Embrace: gain the Ash Embrace power (draw when a card is exhausted). */
registerEffect('ash_embrace', (state, _ctx, _params) => {
  return { state: addPower(state, 'ash_embrace', 1), events: [{ t: 'power', power: 'ash_embrace', stacks: 1 }] };
});

/** Cinder Skin: gain the Cinder Skin power (block when a card is exhausted). */
registerEffect('cinder_skin', (state, _ctx, _params) => {
  return { state: addPower(state, 'cinder_skin', 1), events: [{ t: 'power', power: 'cinder_skin', stacks: 1 }] };
});

/** Split Seam: gain the Split Seam power (Strength whenever you lose HP from a card). */
registerEffect('split_seam', (state, _ctx, _params) => {
  return { state: addPower(state, 'split_seam', 1), events: [{ t: 'power', power: 'split_seam', stacks: 1 }] };
});

/**
 * Brace: double current block.
 * Implemented here rather than as a verb because doubling is a card-unique shape.
 */
registerEffect('brace', (state, _ctx, _params) => {
  const gain = state.player.block;
  if (gain <= 0) return { state, events: [{ t: 'noop', reason: 'no_block' }] };
  return {
    state: { ...state, player: { ...state.player, block: state.player.block + gain } },
    events: [{ t: 'block', who: 'player', amount: gain }],
  };
});

/**
 * Climbing Heat: deal 8 + `perPlay` bonus, and this card permanently gains +5 for the run.
 * The bonus lives on the card INSTANCE in the deck, so it survives reshuffles —
 * that persistent growth is the entire point of the card.
 */
registerEffect('climbing_heat', (state, ctx, _params) => {
  const idx = ctx.targetEnemyIndex ?? 0;
  const target = state.combat.enemies[idx];
  const bonus = ctx.card?.perPlay ?? 0;
  const amount = 8 + bonus;
  if (!target || target.dead) return { state, events: [] };

  const out = damageEnemy(target, playerStrike(amount, state.player));
  // The played card has already left `hand` by the time this handler runs, so the
  // deck — which holds every card instance for the run — is what proves presence.
  // Omitting it silently disabled the persistent growth this card exists for.
  const allCards = [...state.deck, ...state.combat.hand, ...state.combat.draw, ...state.combat.discard, ...state.combat.exhaust];
  const grown = allCards.some((c) => c.uid === ctx.card.uid)
    ? { deck: state.deck.map((c) => (c.uid === ctx.card.uid ? { ...c, perPlay: bonus + 5 } : c)) }
    : { deck: state.deck };

  return {
    state: {
      ...state,
      deck: grown.deck,
      combat: { ...state.combat, enemies: state.combat.enemies.map((e, i) => (i === idx ? out.enemy : e)) },
    },
    events: [{ t: 'damage', source: 'player', target: idx, raw: out.raw, dealt: out.dealt, blocked: out.blocked, hp: out.enemy.hp }, { t: 'grow', card: ctx.card.uid, to: bonus + 5 }],
  };
});
