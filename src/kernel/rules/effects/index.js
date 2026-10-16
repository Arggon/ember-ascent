// Exotic card handlers — rules/effects/<id>.js (ADR-3).
//
// Each handler is the implementation behind a card's single `custom` verb and obeys
// the same purity contract as the closed vocabulary: (state, ctx, params) -> {state, events},
// no Date, no Math.random, no I/O, no input mutation. Importing this module registers
// every handler exactly once; the architecture gate checks the purity of all of them.
import { registerEffect, damageEnemy, addStatus, addPower, loseHp } from '../vocabulary.js';
import { instantiate } from '../card-instance.js';

/** Bloodletting: pay 3 HP, gain 2 energy. */
registerEffect('bloodletting', (state, _ctx, _params) => {
  const player = { ...loseHp(state.player, 3), energy: state.player.energy + 2 };
  return { state: { ...state, player }, events: [{ t: 'self_damage', amount: 3 }, { t: 'energy', amount: 2 }] };
});

/** Hemokinesis: pay 2 HP, deal 15 damage. */
registerEffect('hemokinesis', (state, ctx, _params) => {
  const player = loseHp(state.player, 2);
  const idx = ctx.targetEnemyIndex ?? 0;
  const target = state.combat.enemies[idx];
  if (!target || target.dead) {
    return { state: { ...state, player }, events: [{ t: 'self_damage', amount: 2 }] };
  }
  const strength = player.statuses?.strength ?? 0;
  const out = damageEnemy(target, 15 + strength);
  return {
    state: {
      ...state,
      player,
      combat: { ...state.combat, enemies: state.combat.enemies.map((e, i) => (i === idx ? out.enemy : e)) },
    },
    events: [{ t: 'self_damage', amount: 2 }, { t: 'damage', source: 'player', target: idx, raw: out.raw, dealt: out.dealt, blocked: out.blocked, hp: out.enemy.hp }],
  };
});

/** Reaper: deal 4 damage to ALL enemies, heal HP equal to unblocked damage dealt. */
registerEffect('reaper', (state, ctx, _params) => {
  const strength = state.player.statuses?.strength ?? 0;
  let healed = 0;
  const events = [];
  const enemies = state.combat.enemies.map((e, i) => {
    if (e.dead) return e;
    const out = damageEnemy(e, 4 + strength);
    healed += out.dealt;
    events.push({ t: 'damage', source: 'player', target: i, raw: out.raw, dealt: out.dealt, blocked: out.blocked, hp: out.enemy.hp });
    return out.enemy;
  });
  const player = { ...state.player, hp: Math.min(state.player.maxHp, state.player.hp + healed) };
  if (healed > 0) events.push({ t: 'heal', who: 'player', amount: healed });
  return { state: { ...state, player, combat: { ...state.combat, enemies } }, events };
});

/** Limit Break: double current Strength (no-op without Strength). */
registerEffect('limit_break', (state, _ctx, _params) => {
  const cur = state.player.statuses?.strength ?? 0;
  if (cur <= 0) return { state, events: [{ t: 'noop', reason: 'no_strength' }] };
  return {
    state: { ...state, player: addStatus(state.player, 'strength', cur) },
    events: [{ t: 'status', who: 'player', status: 'strength', stacks: cur }],
  };
});

/** Offering: pay 6 HP, gain 2 energy, draw 3. */
registerEffect('offering', (state, ctx, _params) => {
  const player = { ...loseHp(state.player, 6), energy: state.player.energy + 2 };
  let next = { ...state, player };
  const drawn = [];
  let reshuffles = 0;
  for (let i = 0; i < 3; i += 1) {
    if (next.combat.draw.length === 0) {
      if (next.combat.discard.length === 0) break;
      const shuffled = ctx.rng.shuffle(next.combat.discard);
      reshuffles += 1;
      next = { ...next, rngDraws: next.rngDraws + shuffled.draws, combat: { ...next.combat, draw: shuffled.items, discard: [] } };
    }
    // The hand copy must carry `cost`, or the tile renders "undefined" and is unusable.
    const head = instantiate(next.combat.draw[0]);
    const room = next.combat.hand.length < 10;
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
  return {
    state: next,
    events: [
      { t: 'self_damage', amount: 6 },
      { t: 'energy', amount: 2 },
      { t: 'draw', count: drawn.length, uids: drawn.map((c) => c.uid), reshuffles },
    ],
  };
});

/** Combust: gain the Combust power (damage at end of turn, self-damage each turn). */
registerEffect('combust', (state, _ctx, _params) => {
  return { state: addPower(state, 'combust', 1), events: [{ t: 'power', power: 'combust', stacks: 1 }] };
});

/** Dark Embrace: gain the Dark Embrace power (draw when a card is exhausted). */
registerEffect('dark_embrace', (state, _ctx, _params) => {
  return { state: addPower(state, 'dark_embrace', 1), events: [{ t: 'power', power: 'dark_embrace', stacks: 1 }] };
});

/** Feel No Pain: gain the Feel No Pain power (block when a card is exhausted). */
registerEffect('feel_no_pain', (state, _ctx, _params) => {
  return { state: addPower(state, 'feel_no_pain', 1), events: [{ t: 'power', power: 'feel_no_pain', stacks: 1 }] };
});

/** Rupture: gain the Rupture power (Strength whenever you lose HP from a card). */
registerEffect('rupture', (state, _ctx, _params) => {
  return { state: addPower(state, 'rupture', 1), events: [{ t: 'power', power: 'rupture', stacks: 1 }] };
});

/**
 * Entrench: double current block.
 * Implemented here rather than as a verb because doubling is a card-unique shape.
 */
registerEffect('entrench', (state, _ctx, _params) => {
  const gain = state.player.block;
  if (gain <= 0) return { state, events: [{ t: 'noop', reason: 'no_block' }] };
  return {
    state: { ...state, player: { ...state.player, block: state.player.block + gain } },
    events: [{ t: 'block', who: 'player', amount: gain }],
  };
});

/**
 * Rampage: deal 8 + `perPlay` bonus, and this card permanently gains +5 for the run.
 * The bonus lives on the card INSTANCE in the deck, so it survives reshuffles —
 * that persistent growth is the entire point of the card.
 */
registerEffect('rampage', (state, ctx, _params) => {
  const idx = ctx.targetEnemyIndex ?? 0;
  const target = state.combat.enemies[idx];
  const bonus = ctx.card?.perPlay ?? 0;
  const amount = 8 + bonus + (state.player.statuses?.strength ?? 0);
  if (!target || target.dead) return { state, events: [] };

  const out = damageEnemy(target, amount);
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
