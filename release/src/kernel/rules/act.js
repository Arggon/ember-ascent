// Act 1 flow — combat, rewards, rest, map traversal, end states (ADR-4/ADR-5).
//
// Pure: every function takes a state and returns {state, events}. The seed stream is
// the ONLY entropy, and every draw is counted into rngDraws, so replay is exact.
//
// stepIndex is owned by the top-level step() in kernel/index.js. Nothing in this
// file mutates it, so one submitted action always means exactly one step increment.
import { VOCABULARY, damagePlayer } from './vocabulary.js';
import { instantiate, setCardDefs, cardDefMap } from './card-instance.js';
import { ENEMIES, chooseIntent } from './encounters.js';
import { NODE_TYPES, ROWS } from './map.js';
import { fireHook, endOfTurnStatuses, decayStatuses } from './powers.js';
import { shuffleAt, pickAt } from '../rng.js';

/** Hand size at the start of each turn. */
export const HAND_SIZE = 5;
/** Energy refreshed each turn. */
export const BASE_ENERGY = 3;
/** HP restored at a rest site. */
export const REST_HEAL = 8;
/** HP restored by the Burning Blood relic after each combat. */
export const RELIC_HEAL = 6;
/** Reward choice count after a normal fight; elites offer one more. */
export const REWARD_CHOICES = 3;


/** Strip a runtime hand card back to its compact deck-instance form. */
const toInstance = (c) => ({ uid: c.uid, cardId: c.cardId, perPlay: c.perPlay ?? 0 });

/** Draw `n` cards into the hand, reshuffling the discard pile as needed. Pure. */
function drawCards(state, n) {
  let next = state;
  const uids = [];
  let reshuffles = 0;
  for (let k = 0; k < n; k += 1) {
    if (next.combat.draw.length === 0) {
      if (next.combat.discard.length === 0) break;
      const sh = shuffleAt(next.seed, next.rngDraws, next.combat.discard);
      reshuffles += 1;
      next = { ...next, rngDraws: next.rngDraws + sh.draws, combat: { ...next.combat, draw: sh.items, discard: [] } };
    }
    // Deck instances are stored compactly; the hand copy is decorated with cost so
    // legality checks and rendering never need to re-read content mid-turn.
    const head = instantiate(next.combat.draw[0]);
    const room = next.combat.hand.length < 10;
    uids.push(head.uid);
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
  return { state: next, uids, reshuffles };
}

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
      name: def.name,
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
    player: { ...state.player, block: 0, energy: BASE_ENERGY, statuses: {} },
  };

  const turn = beginTurn(base, cardDefs);
  return {
    state: turn.state,
    events: [
      { t: 'combat_start', node: node.id, encounter: encounter.id, enemies: enemies.map((e) => ({ id: e.id, hp: e.hp })) },
      ...turn.events,
    ],
  };
}

/** The printed intent text for one enemy, e.g. "A11" or "PWR3 B6". */
export function intentLabel(enemy) {
  const def = ENEMIES[enemy.id];
  const move = def.moves[enemy.moveIndex] ?? def.moves[0];
  return move.label;
}

/** Damage the enemy's current intent will deal to the player, before player block. */
export function intentDamage(enemy) {
  const def = ENEMIES[enemy.id];
  const move = def.moves[enemy.moveIndex] ?? def.moves[0];
  if (move.kind !== 'attack') return 0;
  const strength = enemy.statuses?.strength ?? 0;
  let dmg = move.damage + strength;
  if ((enemy.statuses?.weak ?? 0) > 0) dmg = Math.floor(dmg * 3 / 4);
  return dmg * (move.hits ?? 1);
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
    player: { ...state.player, block: 0, energy: BASE_ENERGY },
  };

  const drawn = drawCards(next, HAND_SIZE);
  next = drawn.state;
  events.push({ t: 'turn_start', turn: next.combat.turn, drawn: drawn.uids, reshuffles: drawn.reshuffles });

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

/** Resolve the enemy turn using each enemy's already-chosen intent. */
export function enemyTurn(state) {
  let next = state;
  const events = [];

  // Enemy block decays at the START of its own turn, so block gained last turn
  // covered the player's turn — which is what makes the Guardian's B20 meaningful.
  next = { ...next, combat: { ...next.combat, enemies: next.combat.enemies.map((e) => ({ ...e, block: 0 })) } };


  for (let i = 0; i < next.combat.enemies.length; i += 1) {
    const enemy = next.combat.enemies[i];
    if (enemy.dead) continue;
    const def = ENEMIES[enemy.id];
    const move = def.moves[enemy.moveIndex] ?? def.moves[0];
    const strength = enemy.statuses?.strength ?? 0;
    const weak = (enemy.statuses?.weak ?? 0) > 0;

    if (move.kind === 'attack') {
      let dmg = move.damage + strength;
      if (weak) dmg = Math.floor(dmg * 3 / 4);
      const hits = move.hits ?? 1;
      for (let h = 0; h < hits; h += 1) {
        const out = damagePlayer(next.player, dmg);
        next = { ...next, player: out.player };
        events.push({ t: 'enemy_attack', enemy: i, raw: dmg, dealt: out.dealt, blocked: out.blocked, hp: next.player.hp });
        if (next.player.hp <= 0) break;
      }
    } else if (move.kind === 'block') {
      const block = move.block ?? 0;
      next = { ...next, combat: { ...next.combat, enemies: next.combat.enemies.map((e, j) => (j === i ? { ...e, block: e.block + block } : e)) } };
      events.push({ t: 'enemy_block', enemy: i, amount: block });
    } else if (move.kind === 'buff') {
      if (move.strength) {
        next = { ...next, combat: { ...next.combat, enemies: next.combat.enemies.map((e, j) => (j === i ? { ...e, statuses: { ...e.statuses, strength: (e.statuses.strength ?? 0) + move.strength } } : e)) } };
        events.push({ t: 'enemy_status', enemy: i, status: 'strength', stacks: move.strength });
      }
      if (move.block) {
        next = { ...next, combat: { ...next.combat, enemies: next.combat.enemies.map((e, j) => (j === i ? { ...e, block: e.block + move.block } : e)) } };
        events.push({ t: 'enemy_block', enemy: i, amount: move.block });
      }
    } else if (move.kind === 'debuff') {
      if (move.vulnerable) {
        next = { ...next, player: { ...next.player, statuses: { ...next.player.statuses, vulnerable: (next.player.statuses?.vulnerable ?? 0) + move.vulnerable } } };
        events.push({ t: 'player_status', status: 'vulnerable', stacks: move.vulnerable });
      }
      if (move.weak) {
        next = { ...next, player: { ...next.player, statuses: { ...next.player.statuses, weak: (next.player.statuses?.weak ?? 0) + move.weak } } };
        events.push({ t: 'player_status', status: 'weak', stacks: move.weak });
      }
    }

    next = {
      ...next,
      combat: { ...next.combat, enemies: next.combat.enemies.map((e, j) => (j === i ? { ...e, moveHistory: [...e.moveHistory, e.moveIndex] } : e)) },
    };
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

  const healed = Math.min(state.player.maxHp - state.player.hp, RELIC_HEAL);
  if (healed > 0) {
    next = { ...next, player: { ...next.player, hp: next.player.hp + healed } };
    events.push({ t: 'heal', who: 'player', amount: healed, source: 'burning_blood' });
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
