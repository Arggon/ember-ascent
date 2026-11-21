// Powers — persistent per-run hooks (ADR-3).
//
// A power is a registered counter on state.powers with a hook into the turn cycle.
// Every hook is pure and returns a fresh state. Stack counts are finite integers, so
// a run cannot grow unbounded state.
import { addStatus, consumeStack, damageEnemy, loseHp } from './vocabulary.js';
import { drawIntoHand } from './draw.js';

/** When the hook fires. */
export const HOOKS = ['end_of_turn', 'on_exhaust', 'on_self_damage'];

/**
 * Fire one hook for every power that implements it.
 * @param {any} state
 * @param {string} hook
 * @param {any} ctx
 * @returns {{state: any, events: any[]}}
 */
export function fireHook(state, hook, ctx) {
  let next = state;
  const events = [];
  for (const [power, stacks] of Object.entries(state.powers ?? {})) {
    if (stacks <= 0) continue;
    const impl = IMPL[power];
    if (!impl?.[hook]) continue;
    const out = impl[hook](next, stacks, ctx);
    next = out.state;
    events.push(...out.events);
  }
  return { state: next, events };
}

const IMPL = {
  /** Banked Coal: at end of turn, deal `stacks` damage to all enemies and lose `stacks` HP. */
  banked_coal: {
    end_of_turn(state, stacks) {
      const events = [];
      const enemies = state.combat.enemies.map((e, i) => {
        if (e.dead) return e;
        const out = damageEnemy(e, stacks);
        events.push({ t: 'damage', source: 'power', target: i, raw: out.raw, dealt: out.dealt, blocked: out.blocked, hp: out.enemy.hp });
        return out.enemy;
      });
      const player = loseHp(state.player, stacks);
      events.push({ t: 'self_damage', amount: stacks, source: 'banked_coal' });
      return { state: { ...state, player, combat: { ...state.combat, enemies } }, events };
    },
  },
  /** Ash Embrace: draw `stacks` whenever a card is exhausted. */
  ash_embrace: {
    on_exhaust(state, stacks, ctx) {
      // ctx.rng-bound shuffle, like the `draw` verb (rules/draw.js explains the
      // callback): the old inline loop's stream semantics, preserved exactly.
      const out = drawIntoHand(state, stacks, (_s, items) => ctx.rng.shuffle(items));
      return {
        state: out.state,
        // `reshuffles: 0` is LITERAL, on purpose: the historical event reported 0 even
        // when a reshuffle happened. A behavior-preserving refactor keeps the quirk;
        // the real count is available as out.reshuffles if a fix is ever ruled on.
        events: [{ t: 'draw', count: out.drawn.length, uids: out.drawn.map((c) => c.uid), reshuffles: 0, source: 'ash_embrace' }],
      };
    },
  },
  /** Cinder Skin: gain `stacks` block whenever a card is exhausted. */
  cinder_skin: {
    on_exhaust(state, stacks) {
      return {
        state: { ...state, player: { ...state.player, block: state.player.block + stacks } },
        events: [{ t: 'block', who: 'player', amount: stacks, source: 'cinder_skin' }],
      };
    },
  },
  /** Split Seam: gain `stacks` Strength whenever you lose HP from a card. */
  split_seam: {
    on_self_damage(state, stacks) {
      return {
        state: { ...state, player: addStatus(state.player, 'strength', stacks) },
        events: [{ t: 'status', who: 'player', status: 'strength', stacks, source: 'split_seam' }],
      };
    },
  },
};

/**
 * One POISON tick of one combatant: StS style — at the end of the holder's OWN turn it
 * loses `stacks` HP straight off (Block does not absorb a tick, no parry applies to
 * one), then one stack falls off, gone at zero. Zero draws — nothing rolls, the number
 * is the stacks themselves.
 *
 * `floor` is the death ruling per side: the HERO floors at 1 HP (the loseHp convention
 * — no DoT kills the hero in v1) and carries no `dead` flag; an ENEMY floors at 0 and
 * IS dead at it, exactly like any other death.
 *
 * @param {any} who the combatant
 * @param {number} floor the HP floor for this side (1 hero, 0 enemy)
 * @returns {{who: any, event: any|null}} event is null when there was nothing to tick
 */
function poisonTick(who, floor) {
  const stacks = who.statuses?.poison ?? 0;
  if (stacks <= 0) return { who, event: null };
  const hp = Math.max(floor, who.hp - stacks);
  const ticked = consumeStack(
    floor === 0 ? { ...who, hp, dead: hp <= 0 } : { ...who, hp },
    'poison',
  );
  return {
    who: ticked,
    event: { t: 'poison_tick', amount: stacks, hp, remaining: stacks - 1 },
  };
}

/**
 * Apply end-of-turn status behaviour: Metallicize grants block, then the hero's POISON
 * ticks, and the caller (rules/act.js endTurn) runs the debuff decay after — the
 * contract's order for the hero's own close: tick beside endOfTurnStatuses, BEFORE the
 * decay sweep. The tick floors at 1 HP: a poisoned hero at 1 stays at 1.
 */
export function endOfTurnStatuses(state) {
  const events = [];
  let next = state;
  const metal = next.player.statuses?.metallicize ?? 0;
  if (metal > 0) {
    next = { ...next, player: { ...next.player, block: next.player.block + metal } };
    events.push({ t: 'block', who: 'player', amount: metal, source: 'metallicize' });
  }
  const poison = poisonTick(next.player, 1);
  if (poison.event) {
    next = { ...next, player: poison.who };
    events.push({ who: 'player', ...poison.event });
  }
  return { state: next, events };
}

/**
 * The ENEMIES' poison ticks, at the close of THEIR own turn (rules/act.js endTurn calls
 * this right before the decay sweep — the symmetric placement of the hero's tick
 * above). One tick per LIVING enemy, each event index-stamped; a foe its own poison
 * felled is dead like any other death, and the turn's all-dead settle runs after.
 * Zero draws.
 * @param {any} state
 * @returns {{state: any, events: any[]}}
 */
export function poisonTickEnemies(state) {
  const events = [];
  const enemies = state.combat.enemies.map((e, i) => {
    if (e.dead) return e;
    const ticked = poisonTick(e, 0);
    if (!ticked.event) return e;
    events.push({ who: 'enemy', index: i, ...ticked.event });
    return ticked.who;
  });
  return { state: { ...state, combat: { ...state.combat, enemies } }, events };
}

/**
 * Decay time-limited debuffs on one combatant at the end of its own turn.
 * Strength/Dexterity/Metallicize are permanent for the fight; Vulnerable/Weak are not.
 * @param {any} who
 * @returns {any}
 */
export function decayStatuses(who) {
  const s = { ...(who.statuses ?? {}) };
  for (const key of ['vulnerable', 'weak']) {
    if ((s[key] ?? 0) > 0) s[key] = s[key] - 1;
    if ((s[key] ?? 0) === 0) delete s[key];
  }
  return { ...who, statuses: s };
}
