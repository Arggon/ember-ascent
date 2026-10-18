// Effect vocabulary — the CLOSED set of verbs a card can use (ADR-3).
//
// Every verb has the signature (state, ctx, params) -> {state, events} and is
// contractually PURE: no Date, no Math.random, no I/O, no mutation of its inputs.
// Randomness enters ONLY through ctx.rng (bound to state.rngDraws), never a global.
// Tests deep-freeze inputs, so an accidental write throws instead of diverging.
//
// Cards cannot invent mechanics this file does not know: exotic cards reference a
// handler in rules/effects/<id>.js through the one `custom` verb.

import { instantiate } from './card-instance.js';

/** @typedef {{state: any, events: any[]}} EffectResult */
/** @typedef {{rng: {shuffle: Function, pick: Function, int: Function}, card: any, source: string, target: any, targetEnemyIndex: number}} EffectCtx */

/** Debuff/buff counters the engine understands. */
export const STATUSES = ['strength', 'vulnerable', 'weak', 'dexterity', 'metallicize'];

/** Persistent powers, each with finite stacks, fired from hooks in rules/powers.js. */
export const POWERS = ['combust', 'dark_embrace', 'feel_no_pain', 'rupture'];

/** Registry of custom handlers, filled by rules/effects/*.js via registerEffect(). */
const CUSTOM = new Map();

/**
 * Register an exotic per-card handler (called once at module load).
 * @param {string} id
 * @param {(state: any, ctx: EffectCtx, params: any) => EffectResult} fn
 */
export function registerEffect(id, fn) {
  if (CUSTOM.has(id)) throw new Error(`effect "${id}" already registered`);
  CUSTOM.set(id, fn);
}

/** @returns {string[]} registered custom ids, sorted (so reports are stable) */
export function registeredEffects() {
  return [...CUSTOM.keys()].sort();
}

const clamp = (v, max) => Math.max(0, Math.min(v, max));

/**
 * Deal damage to one enemy: block absorbs first, then Vulnerable amplifies by 50%.
 * @param {any} enemy
 * @param {number} amount pre-modifier damage
 * @returns {{enemy: any, dealt: number, blocked: number, raw: number}}
 */
export function damageEnemy(enemy, amount) {
  const raw = (enemy.statuses?.vulnerable ?? 0) > 0 ? Math.floor(amount * 3 / 2) : amount;
  const blocked = Math.min(enemy.block, raw);
  const dealt = raw - blocked;
  const hp = clamp(enemy.hp - dealt, enemy.maxHp);
  return { enemy: { ...enemy, block: enemy.block - blocked, hp, dead: hp <= 0 }, dealt, blocked, raw };
}

/**
 * Deal damage to the player: block absorbs first, Vulnerable on the player amplifies.
 * @param {any} player
 * @param {number} amount
 * @returns {{player: any, dealt: number, blocked: number}}
 */
export function damagePlayer(player, amount) {
  const raw = (player.statuses?.vulnerable ?? 0) > 0 ? Math.floor(amount * 3 / 2) : amount;
  const blocked = Math.min(player.block, raw);
  const dealt = raw - blocked;
  return { player: { ...player, block: player.block - blocked, hp: clamp(player.hp - dealt, player.maxHp) }, dealt, blocked };
}

/**
 * Lose HP directly, ignoring block (self-inflicted costs). Never reduces below 1 HP
 * so a self-damage card cannot silently kill the player outside the enemy's turn.
 * @param {any} player
 * @param {number} amount
 * @returns {any} player
 */
export function loseHp(player, amount) {
  return { ...player, hp: Math.max(1, player.hp - amount) };
}

/**
 * Add status stacks.
 * @param {any} who
 * @param {string} status
 * @param {number} stacks
 * @returns {any}
 */
export function addStatus(who, status, stacks) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}"`);
  return { ...who, statuses: { ...(who.statuses ?? {}), [status]: (who.statuses?.[status] ?? 0) + stacks } };
}

/**
 * Add power stacks.
 * @param {any} state
 * @param {string} power
 * @param {number} stacks
 * @returns {any} state
 */
export function addPower(state, power, stacks) {
  if (!POWERS.includes(power)) throw new Error(`unknown power "${power}"`);
  return { ...state, powers: { ...(state.powers ?? {}), [power]: (state.powers?.[power] ?? 0) + stacks } };
}

/** @type {Record<string, (state: any, ctx: EffectCtx, params: any) => EffectResult>} */
export const VOCABULARY = {
  /** damage — deal `amount` (plus Strength) to the target, `hits` times. */
  damage(state, ctx, params) {
    const strength = state.player.statuses?.strength ?? 0;
    const perHit = Math.max(0, params.amount + strength);
    const hits = params.hits ?? 1;

    if (params.target === 'all_enemies') {
      let enemies = state.combat.enemies;
      const events = [];
      for (let h = 0; h < hits; h += 1) {
        enemies = enemies.map((e, i) => {
          if (e.dead) return e;
          const out = damageEnemy(e, perHit);
          events.push({ t: 'damage', source: 'player', target: i, raw: out.raw, dealt: out.dealt, blocked: out.blocked, hp: out.enemy.hp });
          return out.enemy;
        });
      }
      return { state: { ...state, combat: { ...state.combat, enemies } }, events };
    }

    const idx = ctx.targetEnemyIndex ?? 0;
    let enemies = state.combat.enemies;
    const events = [];
    let hit = 0;
    for (; hit < hits; hit += 1) {
      const target = enemies[idx];
      if (!target || target.dead) break;
      const out = damageEnemy(target, perHit);
      enemies = enemies.map((e, i) => (i === idx ? out.enemy : e));
      events.push({ t: 'damage', source: 'player', target: idx, raw: out.raw, dealt: out.dealt, blocked: out.blocked, hp: out.enemy.hp });
    }
    return { state: { ...state, combat: { ...state.combat, enemies } }, events };
  },

  /** block — gain `amount` (plus Dexterity) block. */
  block(state, _ctx, params) {
    const amount = Math.max(0, params.amount + (state.player.statuses?.dexterity ?? 0));
    const player = { ...state.player, block: state.player.block + amount };
    return { state: { ...state, player }, events: [{ t: 'block', who: 'player', amount }] };
  },

  /** draw — draw `amount` cards, reshuffling the discard pile when the draw pile empties. */
  draw(state, ctx, params) {
    let next = state;
    const drawn = [];
    let reshuffles = 0;
    for (let i = 0; i < params.amount; i += 1) {
      if (next.combat.draw.length === 0) {
        if (next.combat.discard.length === 0) break;
        const shuffled = ctx.rng.shuffle(next.combat.discard);
        reshuffles += 1;
        next = { ...next, rngDraws: next.rngDraws + shuffled.draws, combat: { ...next.combat, draw: shuffled.items, discard: [] } };
      }
      // The hand copy must carry `cost`, or the tile renders "undefined" and is unusable.
      const head = instantiate(next.combat.draw[0]);
      const rest = next.combat.draw.slice(1);
      const room = next.combat.hand.length < 10;
      drawn.push(head);
      next = {
        ...next,
        combat: {
          ...next.combat,
          draw: rest,
          hand: room ? [...next.combat.hand, head] : next.combat.hand,
          discard: room ? next.combat.discard : [...next.combat.discard, head],
        },
      };
    }
    return { state: next, events: [{ t: 'draw', count: drawn.length, uids: drawn.map((c) => c.uid), reshuffles }] };
  },

  /** energy — gain `amount` energy immediately. */
  energy(state, _ctx, params) {
    return {
      state: { ...state, player: { ...state.player, energy: state.player.energy + params.amount } },
      events: [{ t: 'energy', amount: params.amount }],
    };
  },

  /** status — apply `amount` stacks of `status` to self or to the target enemy. */
  status(state, ctx, params) {
    const who = params.to ?? 'enemy';
    if (who === 'self' || who === 'player') {
      return {
        state: { ...state, player: addStatus(state.player, params.status, params.amount) },
        events: [{ t: 'status', who: 'player', status: params.status, stacks: params.amount }],
      };
    }
    const idx = ctx.targetEnemyIndex ?? 0;
    const enemies = state.combat.enemies;
    if (params.to === 'all_enemies') {
      const out = enemies.map((e) => (e.dead ? e : addStatus(e, params.status, params.amount)));
      return {
        state: { ...state, combat: { ...state.combat, enemies: out } },
        events: [{ t: 'status', who: 'enemies', status: params.status, stacks: params.amount }],
      };
    }
    if (!enemies[idx]) return { state, events: [] };
    // A status never lands on a dead enemy (a stale target index, or enemy 0 already slain).
    if (enemies[idx].dead) return { state, events: [] };
    return {
      state: { ...state, combat: { ...state.combat, enemies: enemies.map((e, i) => (i === idx ? addStatus(e, params.status, params.amount) : e)) } },
      events: [{ t: 'status', who: 'enemy', index: idx, status: params.status, stacks: params.amount }],
    };
  },

  /** discard — discard `amount` cards chosen deterministically from the hand. */
  discard(state, ctx, params) {
    const n = Math.min(params.amount, state.combat.hand.length);
    if (n === 0) return { state, events: [] };
    const picked = ctx.rng.pick(state.combat.hand, n);
    const uids = new Set(picked.picked.map((c) => c.uid));
    const hand = state.combat.hand.filter((c) => !uids.has(c.uid));
    return {
      state: {
        ...state,
        rngDraws: state.rngDraws + picked.draws,
        combat: { ...state.combat, hand, discard: [...state.combat.discard, ...picked.picked] },
      },
      events: [{ t: 'discard', uids: picked.picked.map((c) => c.uid) }],
    };
  },

  /** exhaust — the card that produced this effect leaves the fight for the exhaust pile. */
  exhaust(state, ctx) {
    const uid = ctx.card?.uid;
    if (!uid) return { state, events: [] };
    return {
      state: { ...state, combat: { ...state.combat, exhaust: [...state.combat.exhaust, { uid, cardId: ctx.card.cardId }] } },
      events: [{ t: 'exhaust', uid, cardId: ctx.card.cardId }],
    };
  },

  /** custom — dispatch to a registered rules/effects/<id>.js handler. */
  custom(state, ctx, params) {
    const fn = CUSTOM.get(params.handler);
    if (!fn) throw new Error(`custom effect "${params.handler}" is not registered`);
    return fn(state, ctx, params);
  },
};

/** The frozen list of verb names, for the architecture gate and content validation. */
export const VERBS = Object.freeze(Object.keys(VOCABULARY));
