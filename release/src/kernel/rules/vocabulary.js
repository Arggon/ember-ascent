// Effect vocabulary — the CLOSED set of verbs a card can use (ADR-3).
//
// Every verb has the signature (state, ctx, params) -> {state, events} and is
// contractually PURE: no Date, no Math.random, no I/O, no mutation of its inputs.
// Randomness enters ONLY through ctx.rng (bound to state.rngDraws), never a global.
// Tests deep-freeze inputs, so an accidental write throws instead of diverging.
//
// Cards cannot invent mechanics this file does not know: exotic cards reference a
// handler in rules/effects/<id>.js through the one `custom` verb.

import { drawIntoHand } from './draw.js';
import { intAt } from '../rng.js';

/** @typedef {{state: any, events: any[]}} EffectResult */
/** @typedef {{rng: {shuffle: Function, pick: Function, int: Function}, card: any, source: string, target: any, targetEnemyIndex: number}} EffectCtx */

/** Debuff/buff counters the engine understands.
 *
 * The slice "golpes discretos NxM" grew the table by three, all of them REACTIVE
 * statuses that ride the discrete strike (the parry roll, the bleed tick), or the
 * turn's own end (the poison tick):
 *
 *   parry  — each stack is a 1% chance to block one attack STRIKE completely. Rolled
 *            per golpe, only when the defender holds stacks (attackHit below).
 *   bleed  — the holder loses `stacks` HP every time IT executes an attack strike,
 *            one stack per tick, gone at zero (attackHit below).
 *   poison — StS style: the holder loses `stacks` HP at the end of its OWN turn, then
 *            one stack falls off (rules/powers.js poisonTick*). Zero interaction with
 *            the multi-golpe loop.
 */
export const STATUSES = ['strength', 'vulnerable', 'weak', 'dexterity', 'metallicize', 'parry', 'bleed', 'poison'];

/**
 * The ONE classification of that table (S5 review P3, single-sourced in the POLISH
 * round): which counters are BUFFS the player wants to keep and which are DEBUFFS a
 * Purge Flask clears. Every STATUSES member must appear here — a new status ('frail',
 * say) is a broken row in this table until it is classified, which is what keeps it
 * from silently surviving the purge. rules/potions.js derives POTION_DEBUFFS from the
 * debuff half instead of carrying its own copy of the list.
 */
export const STATUS_KINDS = Object.freeze({
  strength: 'buff',
  dexterity: 'buff',
  metallicize: 'buff',
  vulnerable: 'debuff',
  weak: 'debuff',
  parry: 'buff',
  bleed: 'debuff',
  poison: 'debuff',
});

/** The debuff half of the table, in STATUSES order. Derived, never maintained twice. */
export const DEBUFFS = Object.freeze(
  STATUSES.filter((s) => STATUS_KINDS[s] === 'debuff'),
);

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
 * One hit of a PLAYER attack: Strength added, then Weak applied (×3/4, floored) — the
 * exact mirror of the enemy's own strikeDamage (rules/act.js), so both sides of a fight
 * resolve attack damage by the same add-then-multiply order. The floor at 0 keeps a
 * Weakened 1-damage hit from going negative — player-side only by convention: the
 * enemy's strikeDamage stops at `Math.max(0, dmg - 2)` and never floors its multiplier.
 *
 * WHY A HELPER: the fold used to live only inside the `damage` verb, and the exotic
 * handlers (hemokinesis, reaper, rampage) re-derived their Strength line by hand — the
 * player's Weak was never applied anywhere, so the status text's promise ("your attacks
 * deal 25% less damage") was a lie whenever an enemy debuffed the hero. One helper, one
 * order, every player attack through it.
 * @param {number} base the move's printed damage (before statuses)
 * @param {any} player the attacking player (status carrier)
 * @returns {number} damage per hit, statuses folded
 */
export function playerStrike(base, player) {
  let dmg = base + (player.statuses?.strength ?? 0);
  if ((player.statuses?.weak ?? 0) > 0) dmg = Math.floor(dmg * 3 / 4);
  return Math.max(0, dmg);
}

/**
 * The vulnerable amplification exactly as damageEnemy applies it — ONE fold, one home.
 * describe.js reuses this so a card's preview number cannot disagree with the resolution.
 * @param {number} amount pre-modifier damage
 * @returns {number}
 */
export function vulnerableAmplify(amount) {
  return Math.floor(amount * 3 / 2);
}

/**
 * Block one block-granting effect lands: printed amount plus Dexterity, floored at 0 —
 * the exact fold the `block` verb applies. Exported for the same reason as
 * vulnerableAmplify: the card preview reads the resolver, never a re-derivation.
 * @param {number} amount printed block
 * @param {number} dexterity the combatant's Dexterity stacks
 * @returns {number}
 */
export function blockGain(amount, dexterity = 0) {
  return Math.max(0, amount + dexterity);
}

/**
 * Deal damage to one enemy: block absorbs first, then Vulnerable amplifies by 50%.
 * @param {any} enemy
 * @param {number} amount pre-modifier damage
 * @returns {{enemy: any, dealt: number, blocked: number, raw: number}}
 */
export function damageEnemy(enemy, amount) {
  const raw = (enemy.statuses?.vulnerable ?? 0) > 0 ? vulnerableAmplify(amount) : amount;
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
  const raw = (player.statuses?.vulnerable ?? 0) > 0 ? vulnerableAmplify(amount) : amount;
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
 * Take ONE stack of `status` off a combatant, deleting the key at zero — the shared
 * decrement of every tick-shaped status (bleed falls off one charge per strike it
 * ticks, poison one per turn-end tick). A status the combatant does not hold is a
 * no-op, never a throw.
 * @param {any} who
 * @param {string} status
 * @returns {any}
 */
export function consumeStack(who, status) {
  const left = (who.statuses?.[status] ?? 0) - 1;
  const statuses = { ...(who.statuses ?? {}) };
  if (left > 0) statuses[status] = left;
  else delete statuses[status];
  return { ...who, statuses };
}

/**
 * attackHit — ONE discrete strike of an attack, both sides of a fight. The two canonical
 * attack loops (the `damage` verb, single and all_enemies branches, and MOVE_RUNNERS.attack
 * in rules/act.js) resolve every golpe through this one fold:
 *
 *   [parry roll] -> [damage] -> [the attacker's bleed tick]
 *
 * 1. PARRY — the defender's `parry` stacks are a whole-strike dodge: each charge is a 1%
 *    chance to refuse the strike outright. The roll exists ONLY when the defender holds
 *    charges — exactly ONE u64 draw per defended strike, `intAt(seed, LIVE rngDraws, 100)`,
 *    a proc is `roll < charges` — and the returned state advances rngDraws by exactly the
 *    draws thrown (one per defended strike). A defender WITHOUT parry consumes ZERO draws:
 *    every parry-free fight's streams and hashes are byte-identical to the pre-parry
 *    engine, and the parry is the FIRST consumer of RNG on the damage path, so any later
 *    roll inside the same play reads the counter it left behind. A proc lands NOTHING:
 *    dealt 0, blocked = raw, the defender's block pool NOT consumed, HP untouched — the
 *    strike event carries `parried: true` so a presentation can decorate the riposte.
 *    Parry is a chance, not a pool: nothing is spent on a proc, and it never decays
 *    (decayStatuses touches vulnerable/weak only). Symmetric — the hero's parry covers
 *    the enemy loop's golpes, an enemy's covers the hero's.
 *
 * 2. DAMAGE — the ordinary fold (Vulnerable amplifies, Block soaks); skipped entirely on
 *    a proc because the strike never arrived.
 *
 * 3. BLEED TICK — the ATTACKER's own bleed resolves once per strike it executes, AFTER
 *    the strike landed (a parried strike was still executed — it ticks; rule 4 of the
 *    slice: the parry only covers attack golpes, never ticks). `stacks` HP straight off
 *    the attacker — Block does not absorb a tick and no parry applies to one — then one
 *    charge falls off, gone at zero. The hero's tick floors at 1 HP (the loseHp
 *    convention: no DoT kills the hero in v1); an enemy CAN bleed out — its ticked copy
 *    carries the `dead` flag in STATE (the tick event stays the contract's shape: who,
 *    index?, amount, hp, remaining) — and this function's `attackerDied` lets the caller
 *    cancel the golpes it has left. Ticks consume ZERO draws.
 *
 * Pure: fresh state in, fresh state out; the only entropy is the seed stream, counted.
 *
 * @param {any} state
 * @param {{attacker: 'player'|'enemy', raw: number, defenderIndex?: number, attackerIndex?: number}} args
 *        attacker 'player' -> the golpe flies at the enemy at `defenderIndex`; events are
 *        the `damage` shape. attacker 'enemy' -> the golpe flies at the HERO from the
 *        enemy at `attackerIndex`; events are the `enemy_attack` shape. Exactly these two
 *        shapes exist: an attack always crosses the aisle.
 * @returns {{state: any, events: any[], parried: boolean, defenderDied: boolean, attackerDied: boolean}}
 */
export function attackHit(state, args) {
  const events = [];
  const playerAttacks = args.attacker === 'player';
  const defender = playerAttacks ? state.combat.enemies[args.defenderIndex] : state.player;
  const attacker = playerAttacks ? state.player : state.combat.enemies[args.attackerIndex];

  // 1. THE PARRY ROLL — one draw when the defender holds charges, zero otherwise. The
  //    counter read is LIVE (this strike sees every draw the play has spent so far).
  let rngDraws = state.rngDraws;
  let parried = false;
  const charges = defender.statuses?.parry ?? 0;
  if (charges > 0) {
    parried = intAt(state.seed, rngDraws, 100) < charges;
    rngDraws += 1;
  }

  // 2. THE DAMAGE — the ordinary fold, or the whole strike refused. `raw` keeps each
  //    side's historical meaning: on a player strike it is the target-Vulnerable-folded
  //    number damageEnemy reports; on an enemy strike it is the strike itself (the
  //    hero's Vulnerable shows up in `dealt`, exactly as the pre-slice runner printed).
  let raw = args.raw;
  let dealt = 0;
  let blocked = 0;
  let after = defender;
  if (parried) {
    blocked = args.raw; // bookkeeping only — the pool itself is not touched
  } else if (playerAttacks) {
    const out = damageEnemy(defender, args.raw);
    raw = out.raw;
    dealt = out.dealt;
    blocked = out.blocked;
    after = out.enemy;
  } else {
    const out = damagePlayer(defender, args.raw);
    dealt = out.dealt;
    blocked = out.blocked;
    after = out.player;
  }
  events.push(playerAttacks
    ? { t: 'damage', source: 'player', target: args.defenderIndex, raw, dealt, blocked, hp: after.hp, ...(parried ? { parried: true } : {}) }
    : { t: 'enemy_attack', enemy: args.attackerIndex, raw, dealt, blocked, hp: after.hp, ...(parried ? { parried: true } : {}) });
  let next = playerAttacks
    ? { ...state, combat: { ...state.combat, enemies: state.combat.enemies.map((e, i) => (i === args.defenderIndex ? after : e)) } }
    : { ...state, player: after };

  // 3. THE ATTACKER'S BLEED TICK — after the golpe, zero draws, one charge per tick.
  const bleed = attacker.statuses?.bleed ?? 0;
  let attackerBledOut = false;
  if (bleed > 0) {
    if (playerAttacks) {
      const bled = consumeStack(loseHp(attacker, bleed), 'bleed');
      next = { ...next, player: bled, rngDraws };
      events.push({ t: 'bleed_tick', who: 'player', amount: bleed, hp: bled.hp, remaining: bleed - 1 });
    } else {
      const hp = Math.max(0, attacker.hp - bleed);
      attackerBledOut = hp <= 0;
      const bled = consumeStack({ ...attacker, hp, dead: hp <= 0 }, 'bleed');
      next = {
        ...next,
        rngDraws,
        combat: { ...next.combat, enemies: next.combat.enemies.map((e, i) => (i === args.attackerIndex ? bled : e)) },
      };
      events.push({ t: 'bleed_tick', who: 'enemy', index: args.attackerIndex, amount: bleed, hp, remaining: bleed - 1 });
    }
  } else {
    next = { ...next, rngDraws };
  }

  return {
    state: next,
    events,
    parried,
    defenderDied: playerAttacks ? Boolean(after.dead) : next.player.hp <= 0,
    // The hero's own bleed can never fell him (the loseHp floor at 1), so the player
    // side of this flag is false by construction; the enemy side reads the tick.
    attackerDied: playerAttacks ? false : (bleed > 0 ? attackerBledOut : Boolean(attacker.dead)),
  };
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
  /** damage — deal `amount` (plus Strength, then Weak-reduced) to the target, `hits` times.
   *  THE ATTACK FOLD, deliberately shared: every card attack resolves through
   *  playerStrike, and potions deliberately do NOT (potion_damage, rules/potions.js —
   *  a potion is not an attack; its printed number is the number).
   *
   *  GOLPES DISCRETOS: M hits are M discrete strikes, each resolved through attackHit
   *  (the shared fold [parry roll] -> [damage] -> [the hero's bleed tick]) — an
   *  all_enemies hit across E living bodies is M×E golpes, each one defended (and bled)
   *  on its own. A strike the target's parry refused still executed: the hero's bleed
   *  ticks after it, exactly as after a landed one. */
  damage(state, ctx, params) {
    const perHit = playerStrike(params.amount, state.player);
    const hits = params.hits ?? 1;

    if (params.target === 'all_enemies') {
      let next = state;
      const events = [];
      for (let h = 0; h < hits; h += 1) {
        for (let i = 0; i < next.combat.enemies.length; i += 1) {
          if (next.combat.enemies[i].dead) continue;
          const out = attackHit(next, { attacker: 'player', defenderIndex: i, raw: perHit });
          next = out.state;
          events.push(...out.events);
        }
      }
      return { state: next, events };
    }

    const idx = ctx.targetEnemyIndex ?? 0;
    let next = state;
    const events = [];
    for (let hit = 0; hit < hits; hit += 1) {
      const target = next.combat.enemies[idx];
      if (!target || target.dead) break;
      const out = attackHit(next, { attacker: 'player', defenderIndex: idx, raw: perHit });
      next = out.state;
      events.push(...out.events);
    }
    return { state: next, events };
  },

  /** block — gain `amount` (plus Dexterity) block. */
  block(state, _ctx, params) {
    const amount = Math.max(0, params.amount + (state.player.statuses?.dexterity ?? 0));
    const player = { ...state.player, block: state.player.block + amount };
    return { state: { ...state, player }, events: [{ t: 'block', who: 'player', amount }] };
  },

  /** draw — draw `amount` cards, reshuffling the discard pile when the draw pile empties. */
  draw(state, ctx, params) {
    // The shuffle deliberately ignores the state the loop passes it and goes through
    // ctx.rng instead: that closure binds the draw index the enclosing play held when
    // the effect started, which is the exact stream the inline loop used to consume
    // (rules/draw.js documents why the callback exists at all).
    const out = drawIntoHand(state, params.amount, (_s, items) => ctx.rng.shuffle(items));
    return {
      state: out.state,
      events: [{ t: 'draw', count: out.drawn.length, uids: out.drawn.map((c) => c.uid), reshuffles: out.reshuffles }],
    };
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

  /**
   * heal — restore `amount` HP to the player, capped at maxHp. Like loseHp this ignores
   * Block and other statuses entirely; unlike loseHp it has no floor game — the event
   * carries the HP ACTUALLY restored, so an overheal reads as a smaller number and no
   * consumer can mistake the printed value for the delta.
   *
   * DRAW ACCOUNTING: zero draws — the amount is fixed, no roll decides it.
   */
  heal(state, _ctx, params) {
    const amount = Math.max(0, Math.min(params.amount, state.player.maxHp - state.player.hp));
    if (amount === 0) return { state, events: [{ t: 'heal', who: 'player', amount: 0 }] };
    return {
      state: { ...state, player: { ...state.player, hp: state.player.hp + amount } },
      events: [{ t: 'heal', who: 'player', amount }],
    };
  },

  /**
   * retain — a MARKER verb: it emits nothing here, and two phases consume the marker
   * by reading the DEFINITION (never a one-shot flag, so a tempered copy keeps the
   * behavior). (1) THE PLAY PATH (rules/steps.js playCard): a played retain card
   * never moves to the discard pile — after its effects resolve, the played instance
   * RETURNS to the hand as its decorated self (cost included, perPlay preserved, the
   * same decorated-instance rule endTurn documents) and a `{ t: 'retain', uids }`
   * event marks the return, keeping the stream honest beside the play it follows.
   * Replaying it the same turn is legal whenever its cost is payable again. (2) THE
   * END-OF-TURN DISCARD PHASE (rules/act.js endTurn): a hand card whose definition
   * carries this verb stays in the hand instead of discarding, turn after turn.
   * Zero draws at play, at the return, AND at the discard phase: nothing rolls, the
   * card simply does not move.
   */
  retain(state, _ctx, _params) {
    return { state, events: [] };
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
