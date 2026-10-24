// Act 1 flow — combat, rewards, rest, map traversal, end states (ADR-4/ADR-5).
//
// Pure: every function takes a state and returns {state, events}. The seed stream is
// the ONLY entropy, and every draw is counted into rngDraws, so replay is exact.
//
// stepIndex is owned by the top-level step() in kernel/index.js. Nothing in this
// file mutates it, so one submitted action always means exactly one step increment.
import { VOCABULARY, damagePlayer } from './vocabulary.js';
import { setCardDefs } from './card-instance.js';
import { drawIntoHand } from './draw.js';
import { ENEMIES, chooseIntent } from './encounters.js';
import { NODE_TYPES, ROWS } from './map.js';
import { fireHook, endOfTurnStatuses, decayStatuses } from './powers.js';
import { shuffleAt, pickAt } from '../rng.js';
import { activeRelic, relicId } from './relics.js';

/** Hand size at the start of each turn. */
export const HAND_SIZE = 5;
/** Energy refreshed each turn. */
export const BASE_ENERGY = 3;
/** HP restored at a rest site. */
export const REST_HEAL = 8;
/** Relic numbers live with the relic table; re-exported here for existing importers. */
export { RELIC_HEAL, LANTERN_ENERGY } from './relics.js';
/** Reward choice count after a normal fight; elites offer one more. */
export const REWARD_CHOICES = 3;


/** Strip a runtime hand card back to its compact deck-instance form. */
const toInstance = (c) => ({ uid: c.uid, cardId: c.cardId, perPlay: c.perPlay ?? 0 });

/** Card definitions, injected once by the kernel entry so rules never import content. */

/** @param {Map<string, any>} defs */
export function _setCardDefs(defs) { setCardDefs(defs); }

/**
 * Enter a combat node: build the draw pile and the enemy list.
 * @param {any} state
 * @param {any} node
 * @param {Map<string, any>} cardDefs
 * @returns {{state: any, events: any[]}}
 */
export function startCombat(state, node, cardDefs) {
  const encounter = state.map.encounterTable[node.id];
  if (!encounter) throw new Error(`no encounter for node "${node.id}"`);

  const insts = state.deck.map((c) => ({ uid: c.uid, cardId: c.cardId, perPlay: c.perPlay ?? 0 }));
  const shuffled = shuffleAt(state.seed, state.rngDraws, insts);

  const enemies = encounter.spawn.map((s, i) => {
    const def = ENEMIES[s.id];
    return {
      id: s.id,
      index: i,
      name: def.stateName ?? def.name,
      hp: s.hp,
      maxHp: s.hp,
      block: 0,
      statuses: {},
      moveIndex: 0,
      moveHistory: [],
      intentStep: 0,
      dead: false,
    };
  });

  const base = {
    ...state,
    rngDraws: state.rngDraws + shuffled.draws,
    phase: 'combat',
    combat: {
      ...state.combat,
      active: true,
      nodeId: node.id,
      nodeType: node.type,
      turn: 0,
      enemies,
      draw: shuffled.items,
      hand: [],
      discard: [],
      exhaust: [],
    },
    // Combat-only statuses (Strength, Dexterity, Weak, Vulnerable, Metallicize) must NOT
    // carry between fights. The game prints them as "Lasts the whole fight", but leaving
    // them on the player made Strength accumulate for the whole RUN: an Inflame taken at
    // floor 2 compounded into unbounded damage, producing three straight wins with Strength
    // 34 at the boss. Enemy statuses were already reset per spawn; the player's were not.
    // NOTE: beginTurn deliberately does NOT do this — a buff must survive the turns within
    // one fight, and only be cleared when a new fight begins.
    player: { ...state.player, block: 0, energy: state.energyPerTurn ?? BASE_ENERGY, statuses: {} },
  };

  const turn = beginTurn(base, cardDefs);
  // A first-turn Energy relic (B4 Cyan Lantern): extra Energy on the first turn of every fight.
  const lantern = activeRelic(state)?.firstTurnEnergy ?? 0;
  if (lantern > 0) {
    turn.state = { ...turn.state, player: { ...turn.state.player, energy: turn.state.player.energy + lantern } };
    turn.events.push({ t: 'energy', who: 'player', amount: lantern, source: relicId(state) });
  }
  return {
    state: turn.state,
    events: [
      { t: 'combat_start', node: node.id, encounter: encounter.id, enemies: enemies.map((e) => ({ id: e.id, hp: e.hp })) },
      ...turn.events,
    ],
  };
}

/** The enemy's currently shown move: its moveIndex, or the first move as a fallback. */
const currentMove = (enemy) => {
  const def = ENEMIES[enemy.id];
  return def.moves[enemy.moveIndex] ?? def.moves[0];
};

/** One hit of an attack move: Strength added, Weak applied. */
const strikeDamage = (enemy, move) => {
  let dmg = move.damage + (enemy.statuses?.strength ?? 0);
  if ((enemy.statuses?.weak ?? 0) > 0) dmg = Math.floor(dmg * 3 / 4);
  return dmg;
};

/** The printed intent text for one enemy, e.g. "A11" or "PWR3 B6". */
export function intentLabel(enemy) {
  return currentMove(enemy).label;
}

/** Damage the enemy's current intent will deal to the player, before player block. */
export function intentDamage(enemy) {
  const move = currentMove(enemy);
  if (move.kind !== 'attack') return 0;
  return strikeDamage(enemy, move) * (move.hits ?? 1);
}

/**
 * Begin a player turn: refill energy, draw a hand, pick enemy intents.
 * Intents are chosen at the START of the turn so the observation can show them.
 * @param {any} state
 * @param {Map<string, any>} cardDefs
 * @returns {{state: any, events: any[]}}
 */
export function beginTurn(state, cardDefs) {
  const events = [];
  let next = {
    ...state,
    combat: { ...state.combat, turn: state.combat.turn + 1, hand: [] },
    player: { ...state.player, block: 0, energy: state.energyPerTurn ?? BASE_ENERGY },
  };

  // The turn draw reshuffles at the LIVE counter (see rules/draw.js for why the
  // shuffle is a callback): every reshuffle inside one turn reads the draws this
  // loop has already consumed.
  const drawn = drawIntoHand(next, HAND_SIZE, (s, items) => shuffleAt(s.seed, s.rngDraws, items));
  next = drawn.state;
  events.push({ t: 'turn_start', turn: next.combat.turn, drawn: drawn.drawn.map((c) => c.uid), reshuffles: drawn.reshuffles });

  const enemies = next.combat.enemies.map((e) => {
    if (e.dead) return e;
    const def = ENEMIES[e.id];
    if (def.script) {
      const step = Math.min(e.intentStep, def.script.length - 1);
      const moveIndex = def.moves.findIndex((m) => m.id === def.script[step]);
      return { ...e, moveIndex, intentStep: e.intentStep + 1 };
    }
    const chosen = chooseIntent(next.seed, next.rngDraws, e, e.moveHistory, e.intentStep);
    if (chosen.draws > 0) next = { ...next, rngDraws: next.rngDraws + chosen.draws };
    return { ...e, moveIndex: chosen.moveIndex, intentStep: e.intentStep + 1 };
  });
  next = { ...next, combat: { ...next.combat, enemies } };
  events.push({ t: 'intents', intents: enemies.map((e) => (e.dead ? null : intentLabel(e))) });
  void cardDefs;
  return { state: next, events };
}

/** Rebuild the combat with every enemy replaced by `fn(enemy)`. */
const patchEnemies = (state, fn) => ({
  ...state,
  combat: { ...state.combat, enemies: state.combat.enemies.map(fn) },
});

/** Rebuild the combat with ONE enemy (index `i`) replaced by `fn(enemy)`. */
const patchEnemyAt = (state, i, fn) => patchEnemies(state, (e, j) => (j === i ? fn(e) : e));

/**
 * What one enemy does with its chosen move. One runner per move kind, so a new kind
 * is a table row plus a runner — the enemy-turn loop below never changes. Each
 * runner owns its events; the loop only sequences them.
 */
const MOVE_RUNNERS = {
  /** attack: hit the player `hits` times for Strength-added, Weak-reduced damage. */
  attack(state, i, move) {
    const enemy = state.combat.enemies[i];
    const dmg = strikeDamage(enemy, move);
    const events = [];
    let next = state;
    const hits = move.hits ?? 1;
    for (let h = 0; h < hits; h += 1) {
      const out = damagePlayer(next.player, dmg);
      next = { ...next, player: out.player };
      events.push({ t: 'enemy_attack', enemy: i, raw: dmg, dealt: out.dealt, blocked: out.blocked, hp: next.player.hp });
      if (next.player.hp <= 0) break;
    }
    return { state: next, events };
  },

  /** block: gain the printed Block. */
  block(state, i, move) {
    const amount = move.block ?? 0;
    return {
      state: patchEnemyAt(state, i, (e) => ({ ...e, block: e.block + amount })),
      events: [{ t: 'enemy_block', enemy: i, amount }],
    };
  },

  /** buff: Strength first, then Block — the printed order is the event order. */
  buff(state, i, move) {
    let next = state;
    const events = [];
    if (move.strength) {
      next = patchEnemyAt(next, i, (e) => ({ ...e, statuses: { ...e.statuses, strength: (e.statuses.strength ?? 0) + move.strength } }));
      events.push({ t: 'enemy_status', enemy: i, status: 'strength', stacks: move.strength });
    }
    if (move.block) {
      next = patchEnemyAt(next, i, (e) => ({ ...e, block: e.block + move.block }));
      events.push({ t: 'enemy_block', enemy: i, amount: move.block });
    }
    return { state: next, events };
  },

  /** debuff: apply Vulnerable and Weak to the player. */
  debuff(state, i, move) {
    let next = state;
    const events = [];
    if (move.vulnerable) {
      next = { ...next, player: { ...next.player, statuses: { ...next.player.statuses, vulnerable: (next.player.statuses?.vulnerable ?? 0) + move.vulnerable } } };
      events.push({ t: 'player_status', status: 'vulnerable', stacks: move.vulnerable });
    }
    if (move.weak) {
      next = { ...next, player: { ...next.player, statuses: { ...next.player.statuses, weak: (next.player.statuses?.weak ?? 0) + move.weak } } };
      events.push({ t: 'player_status', status: 'weak', stacks: move.weak });
    }
    return { state: next, events };
  },
};

/** Resolve the enemy turn using each enemy's already-chosen intent. */
export function enemyTurn(state) {
  let next = state;
  const events = [];

  // Enemy block decays at the START of its own turn, so block gained last turn
  // covered the player's turn — which is what makes the Guardian's B20 meaningful.
  next = patchEnemies(next, (e) => ({ ...e, block: 0 }));

  for (let i = 0; i < next.combat.enemies.length; i += 1) {
    const enemy = next.combat.enemies[i];
    if (enemy.dead) continue;
    const move = currentMove(enemy);
    const run = MOVE_RUNNERS[move.kind];
    if (run) {
      const out = run(next, i, move);
      next = out.state;
      events.push(...out.events);
    }

    next = patchEnemyAt(next, i, (e) => ({ ...e, moveHistory: [...e.moveHistory, e.moveIndex] }));
    if (next.player.hp <= 0) break;
  }
  return { state: next, events };
}

/**
 * End the player turn: discard hand, fire end-of-turn hooks, run the enemy turn,
 * then either end the run, finish the combat, or begin the next turn.
 * @param {any} state
 * @param {Map<string, any>} cardDefs
 * @returns {{state: any, events: any[]}}
 */
export function endTurn(state, cardDefs) {
  const events = [];
  let next = state;

  const discarded = next.combat.hand.map(toInstance);
  next = { ...next, combat: { ...next.combat, discard: [...next.combat.discard, ...discarded], hand: [] } };
  if (discarded.length > 0) events.push({ t: 'discard_hand', uids: discarded.map((c) => c.uid) });

  const hooks = fireHook(next, 'end_of_turn', { cardDefs });
  next = hooks.state;
  events.push(...hooks.events);

  const statuses = endOfTurnStatuses(next);
  next = statuses.state;
  events.push(...statuses.events);
  next = { ...next, player: decayStatuses(next.player) };

  const enemy = enemyTurn(next);
  next = enemy.state;
  events.push(...enemy.events);

  // Decay the enemies' time-limited debuffs at the END of their own turn — symmetric with
  // the player, who is decayed just above. Without this an enemy's Vulnerable/Weak never
  // ticked down at all: Bash applied Vulnerable 2 and it displayed "Vulnerable 2" on every
  // turn of the fight, so the number shown to the player was a lie and Shockwave's whole
  // premise (a longer debuff) was meaningless. Owner report: "when i attack that number at
  // vulnerable do not decrease and stays for all the fight."
  // Placed after the enemy acts so the stacks the player SEES during their turn are the ones
  // that will apply to their attacks: Vulnerable 3 gives three turns of +50%, then expires.
  next = {
    ...next,
    combat: {
      ...next.combat,
      enemies: next.combat.enemies.map((e) => (e.dead ? e : decayStatuses(e))),
    },
  };

  if (next.player.hp <= 0) {
    return { state: { ...next, phase: 'ended', outcome: 'loss' }, events: [...events, { t: 'run_end', outcome: 'loss' }] };
  }
  // The last enemy can die during the ENEMY turn (Combust's end-of-turn damage), not
  // only from a card. Returning `combat_won` here without settling left the state in
  // `phase: 'combat'` with every enemy dead and an empty hand — `actions` then offered
  // only `e1` forever, and a self-play run span until the harness step cap. Victory
  // settlement has exactly one implementation; call it rather than describing it.
  if (next.combat.enemies.every((e) => e.dead)) {
    const won = resolveVictory(next, cardDefs);
    return { state: won.state, events: [...events, { t: 'combat_won' }, ...won.events] };
  }
  const turn = beginTurn(next, cardDefs);
  return { state: turn.state, events: [...events, ...turn.events] };
}

/**
 * After a won combat: heal via relic, then decide the next phase
 * (card reward for fights, or back to the map for a rest node).
 * @param {any} state
 * @param {Map<string, any>} cardDefs
 * @returns {{state: any, events: any[]}}
 */
export function resolveVictory(state, cardDefs) {
  const events = [];
  // Clear combat-only statuses the moment the fight is over. Resetting them at the NEXT
  // combat's start (also done) is not enough: a leftover Weak/Strength would sit on the
  // player through the reward and map screens, shown in the HUD, contradicting the
  // documented rule that they last only the fight. Caught by tests/kernel/status-reset.test.js.
  let next = { ...state, combat: { ...state.combat, active: false, enemies: [] }, player: { ...state.player, statuses: {} } };

  // Only a relic with a post-fight heal (the Kindled Heart) heals; Iron Skin switches it off.
  const healed = Math.min(state.player.maxHp - state.player.hp, activeRelic(state)?.healAfterFight ?? 0);
  if (healed > 0) {
    next = { ...next, player: { ...next.player, hp: next.player.hp + healed } };
    events.push({ t: 'heal', who: 'player', amount: healed, source: relicId(state) });
  }

  const nodeType = state.combat.nodeType;
  if (nodeType === 'boss') {
    return { state: { ...next, phase: 'ended', outcome: 'win' }, events: [...events, { t: 'run_end', outcome: 'win' }] };
  }

  const reward = next.map.encounterTable[state.combat.nodeId]?.reward ?? 'card';
  if (reward === 'heal') {
    return { state: { ...next, phase: 'rest' }, events: [...events, { t: 'rest_ready' }] };
  }

  // Roll the reward offer: REWARD_CHOICES distinct cards.
  const elites = nodeType === 'elite' ? 1 : 0;
  const offer = rollReward(next, REWARD_CHOICES + elites);
  next = { ...next, rngDraws: next.rngDraws + offer.draws, phase: 'reward', reward: { cards: offer.ids, taken: null } };
  events.push({ t: 'reward_offered', cards: offer.ids });
  void cardDefs;
  return { state: next, events };
}

/**
 * Roll `count` distinct card ids from the draft pool (starter cards excluded).
 * @param {any} state
 * @param {number} count
 * @returns {{ids: string[], draws: number}}
 */
function rollReward(state, count) {
  const picked = pickAt(state.seed, state.rngDraws, state.draftPool, count);
  return { ids: picked.picked, draws: picked.draws };
}
