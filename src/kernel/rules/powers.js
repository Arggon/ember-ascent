// Powers — persistent per-run hooks (ADR-3).
//
// A power is a registered counter on state.powers with a hook into the turn cycle.
// Every hook is pure and returns a fresh state. Stack counts are finite integers, so
// a run cannot grow unbounded state.
import { addStatus, damageEnemy, loseHp } from './vocabulary.js';
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
  /** Combust: at end of turn, deal `stacks` damage to all enemies and lose `stacks` HP. */
  combust: {
    end_of_turn(state, stacks) {
      const events = [];
      const enemies = state.combat.enemies.map((e, i) => {
        if (e.dead) return e;
        const out = damageEnemy(e, stacks);
        events.push({ t: 'damage', source: 'power', target: i, raw: out.raw, dealt: out.dealt, blocked: out.blocked, hp: out.enemy.hp });
        return out.enemy;
      });
      const player = loseHp(state.player, stacks);
      events.push({ t: 'self_damage', amount: stacks, source: 'combust' });
      return { state: { ...state, player, combat: { ...state.combat, enemies } }, events };
    },
  },
  /** Dark Embrace: draw `stacks` whenever a card is exhausted. */
  dark_embrace: {
    on_exhaust(state, stacks, ctx) {
      // ctx.rng-bound shuffle, like the `draw` verb (rules/draw.js explains the
      // callback): the old inline loop's stream semantics, preserved exactly.
      const out = drawIntoHand(state, stacks, (_s, items) => ctx.rng.shuffle(items));
      return {
        state: out.state,
        // `reshuffles: 0` is LITERAL, on purpose: the historical event reported 0 even
        // when a reshuffle happened. A behavior-preserving refactor keeps the quirk;
        // the real count is available as out.reshuffles if a fix is ever ruled on.
        events: [{ t: 'draw', count: out.drawn.length, uids: out.drawn.map((c) => c.uid), reshuffles: 0, source: 'dark_embrace' }],
      };
    },
  },
  /** Feel No Pain: gain `stacks` block whenever a card is exhausted. */
  feel_no_pain: {
    on_exhaust(state, stacks) {
      return {
        state: { ...state, player: { ...state.player, block: state.player.block + stacks } },
        events: [{ t: 'block', who: 'player', amount: stacks, source: 'feel_no_pain' }],
      };
    },
  },
  /** Rupture: gain `stacks` Strength whenever you lose HP from a card. */
  rupture: {
    on_self_damage(state, stacks) {
      return {
        state: { ...state, player: addStatus(state.player, 'strength', stacks) },
        events: [{ t: 'status', who: 'player', status: 'strength', stacks, source: 'rupture' }],
      };
    },
  },
};

/** Apply end-of-turn status behaviour: Metallicize grants block, then decay debuffs. */
export function endOfTurnStatuses(state) {
  const events = [];
  let next = state;
  const metal = next.player.statuses?.metallicize ?? 0;
  if (metal > 0) {
    next = { ...next, player: { ...next.player, block: next.player.block + metal } };
    events.push({ t: 'block', who: 'player', amount: metal, source: 'metallicize' });
  }
  return { state: next, events };
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
