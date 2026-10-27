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
import { ENEMIES, chooseIntent, buildEncounterTable, BIOMES, ACT2_BIOME } from './encounters.js';
import { generateMap, goldBand } from './map.js';
import { fireHook, endOfTurnStatuses, decayStatuses } from './powers.js';
import { shuffleAt, pickAt, intAt } from '../rng.js';
import {
  activeRelicDefs, relicId, firstTurnDrawOf, rollEliteRelicDrop, rollBossRelicOffers, gainRelic,
} from './relics.js';
import { rollPotionDrop } from './potions.js';

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
/** S9: max HP gained on entering act 2 (with the full heal that follows it). */
export const ACT_HP_BONUS = 5;


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
  // S7 RELIC OPENING — after the opening hand is drawn, every working relic fires its
  // combat-start hook ONCE, in ACQUISITION ORDER (a fixed order, part of the format):
  // per relic, Block, then Strength, then Energy. Each contribution carries its own
  // event (the relic's id as the source, where the verb takes one), so two relics
  // sharing a hook — Cyan Lantern + Slag Crown is +2 Energy on turn 1 — both land,
  // visibly and deterministically. Zero draws: every relic number is fixed. Iron Skin's
  // relicOff excludes relics[0] only (activeRelicDefs).
  let events = turn.events;
  let after = turn.state;
  for (const { id, def } of activeRelicDefs(state)) {
    if (def.combatStartBlock > 0) {
      after = { ...after, player: { ...after.player, block: after.player.block + def.combatStartBlock } };
      events = [...events, { t: 'block', who: 'player', amount: def.combatStartBlock, source: id }];
    }
    if (def.combatStartStrength > 0) {
      after = {
        ...after,
        player: { ...after.player, statuses: { ...after.player.statuses, strength: (after.player.statuses.strength ?? 0) + def.combatStartStrength } },
      };
      events = [...events, { t: 'player_status', status: 'strength', stacks: def.combatStartStrength, source: id }];
    }
    if (def.firstTurnEnergy > 0) {
      after = { ...after, player: { ...after.player, energy: after.player.energy + def.firstTurnEnergy } };
      events = [...events, { t: 'energy', who: 'player', amount: def.firstTurnEnergy, source: id }];
    }
  }
  return {
    state: after,
    events: [
      { t: 'combat_start', node: node.id, encounter: encounter.id, enemies: enemies.map((e) => ({ id: e.id, hp: e.hp })) },
      ...events,
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
  // S7 Deep Well: +1 card on the FIRST turn of each combat only (turn 1 is the one
  // beginTurn is producing here — startCombat calls it on the fresh combat). The extra
  // card rides the ordinary draw, so its reshuffles consume exactly the draws it needs
  // (rules/draw.js); no relic hook ever draws outside this call.
  const handSize = HAND_SIZE + (state.combat.turn === 0 ? firstTurnDrawOf(state) : 0);
  let next = {
    ...state,
    combat: { ...state.combat, turn: state.combat.turn + 1, hand: [] },
    player: { ...state.player, block: 0, energy: state.energyPerTurn ?? BASE_ENERGY },
  };

  // The turn draw reshuffles at the LIVE counter (see rules/draw.js for why the
  // shuffle is a callback): every reshuffle inside one turn reads the draws this
  // loop has already consumed.
  const drawn = drawIntoHand(next, handSize, (s, items) => shuffleAt(s.seed, s.rngDraws, items));
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
 * After a won combat — THE FIXED PER-VICTORY ORDER (part of the format; every roll reads
 * the counter the stage before it left behind, so the whole chain is reproducible from
 * the action log forever):
 *
 *   1. RELIC HEAL      per working relic, acquisition order, each clamped by the HP the
 *                      relics before it left; per-relic `heal` events. 0 draws.
 *   2. TIER GOLD       the node tier's spoils (S3), at the CURRENT act's band (S9:
 *                      goldBand(nodeType, act) — act 1 is the NODE_TYPES table, act 2
 *                      pays +30%). 0 draws flat (a boss pays its act's flat purse), 1
 *                      ranged.
 *   3. RELIC GOLD      per working relic, acquisition order (Gold Vein). 0 draws.
 *   4. BOSS BRANCH     the warden's relic OFFER replaces the card reward (StS parity:
 *                      no cards on the boss). The offers roll NOW — pickAt pays exactly
 *                      min(3, pool) draws over the not-held rare pool. Five rares exist
 *                      (S9 grew the tier), each boss takes at most one, so BOTH bosses
 *                      of a two-act climb offer a real three (4 remain for act 2 after
 *                      act 1's pick). Fewer picks only if a torn save already holds
 *                      rares — never padded, never thrown. The phase opens as `reward`;
 *                      the run's fate is sealed at the pick (`r<n>`) or the skip (`s0`)
 *                      in rules/steps.js, NOT here. Never reaches stages 5-7.
 *   4b. ACT TRANSITION (S9, at the pick/skip — rules/steps.js settleBossVictory):
 *                      the LAST act's boss ends the run in victory; an earlier act's
 *                      boss CLIMBS ON through beginNextAct — act +1, +5 max HP, a full
 *                      heal into the new max, and a fresh map for the next biome. Deck,
 *                      gold, potions, relics and every opt-in (kindling, tempers,
 *                      quests) persist untouched; the offer, the combat and the finished
 *                      act's map are left behind. Draw accounting is documented on
 *                      beginNextAct below.
 *   5. POTION DROP     S5's roll. 0..2 draws (0 when the belt is full).
 *   6. ELITE RELIC DROP  elite fights only, GUARANTEED (StS parity): exactly 2 draws —
 *                      one d100 band (lowest 70 common, rest uncommon) + one uniform pick
 *                      over that tier's not-held pool — 0 only when both pools are empty
 *                      (impossible through play, free by the potions ruling). Acquisition
 *                      goes through gainRelic, the ONE path, so acquisition passives
 *                      (Ember Heart's max HP) fire here exactly as on the boss pick.
 *   7. REWARD ROLL     the card offer (S3's convention: read the counter everything
 *                      above left behind). 3 draws, 4 on an elite — 5 on an ACT-2 elite
 *                      (S9's escalation: the deeper act's elites pay one extra choice).
 *
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

  // 1. RELIC HEAL (S7): every working relic's healAfterFight, in acquisition order.
  //    Per-relic events keep the B4 shape (one relic held = byte-identical to before);
  //    a Kindled Heart + Ash Crown run heals 6 then 3, each clamped by what is left.
  //    Iron Skin's relicOff excludes relics[0] only (activeRelicDefs).
  for (const { id, def } of activeRelicDefs(state)) {
    const healed = Math.min(def.healAfterFight ?? 0, next.player.maxHp - next.player.hp);
    if (healed > 0) {
      next = { ...next, player: { ...next.player, hp: next.player.hp + healed } };
      events.push({ t: 'heal', who: 'player', amount: healed, source: id });
    }
  }

  // 2. S3 GOLD — the spoils, granted exactly ONCE per won fight. Both callers (steps.js
  // playCard and endTurn here) reach victory through this one function, and it flips the
  // phase away from `combat` in the same breath (reward / rest / ended), so a re-observe
  // of the post-victory state can never re-enter it: there is no gold grant action, and
  // observe/snapshot are read-only. The grant amount travels into `state.reward.gold` when
  // a reward opens, so the reward screen and the text dump can say "+N gold" without
  // re-deriving anything.
  //
  // S9: the band is the CURRENT act's (rules/map.js goldBand) — act 1 pays the NODE_TYPES
  // table, act 2 pays +30%. `?? 1` is the legacy-save read (no `act` field = act 1).
  //
  // RNG ACCOUNTING: exactly ONE u64 draw for a ranged tier (intAt over the inclusive
  // range), ZERO draws for a flat tier — a boss pays its act's flat purse to every seed,
  // so there is nothing to roll. `rngDraws` advances by exactly `goldDraws`.
  const nodeType = state.combat.nodeType;
  const goldRange = goldBand(nodeType, state.act ?? 1);
  let goldGained = null;
  if (goldRange) {
    const [lo, hi] = goldRange;
    const goldDraws = hi > lo ? 1 : 0;
    goldGained = lo + (goldDraws ? intAt(state.seed, state.rngDraws, hi - lo + 1) : 0);
    next = {
      ...next,
      rngDraws: next.rngDraws + goldDraws,
      player: { ...next.player, gold: (next.player.gold ?? 0) + goldGained },
    };
    events.push({ t: 'gold', who: 'player', amount: goldGained, source: nodeType });
  }

  // 3. RELIC GOLD (S7): Gold Vein's after-fight gold, per working relic in acquisition
  //    order, right after the tier spoils — both gold grants read as one purse update
  //    sequence. Zero draws; the event is the gold verb with the relic id as its source.
  for (const { id, def } of activeRelicDefs(state)) {
    const gain = def.goldAfterFight ?? 0;
    if (gain > 0) {
      next = { ...next, player: { ...next.player, gold: (next.player.gold ?? 0) + gain } };
      events.push({ t: 'gold', who: 'player', amount: gain, source: id });
    }
  }

  // 4. BOSS BRANCH (S7) — the offer, rolled at victory time exactly like the card offer
  //    it replaces; the run's fate (act transition 4b, or the ended win) moves to the
  //    pick/skip step (rules/steps.js settleBossVictory). The reward carries `boss: true`
  //    and the flat tier's gold; cards are omitted. S9: the offers roll from the
  //    not-held rare pool exactly as before — the act-2 boss therefore offers 2 rares
  //    when the act-1 boss relic was TAKEN (3 when it was skipped): pickAt pays only
  //    for the picks it makes, the documented tolerance, now reachable through play.
  if (nodeType === 'boss') {
    const offer = rollBossRelicOffers(next);
    next = {
      ...next,
      rngDraws: next.rngDraws + offer.draws,
      phase: 'reward',
      reward: { cards: [], relicOffers: offer.offers, taken: null, gold: goldGained, boss: true },
    };
    events.push({ t: 'reward_offered', cards: [], relics: offer.offers });
    void cardDefs;
    return { state: next, events };
  }

  // 5. S5 POTIONS — the drop, rolled exactly once per won fight, AFTER the gold grants
  // and BEFORE the reward offer (stage 7 reads the counter the drop left behind). A full
  // belt suppresses the roll entirely — ZERO draws (rules/potions.js), which is what
  // makes a 4th potion impossible without stealing from the stream.
  const drop = rollPotionDrop(next, nodeType);
  if (drop.potion) {
    next = { ...next, rngDraws: next.rngDraws + drop.draws, potions: drop.belt };
    events.push({ t: 'potion_drop', potion: drop.potion, beltSize: drop.belt.length, source: nodeType });
  } else if (drop.draws > 0) {
    // A miss: the draw is still spent (the roll happened), only the belt is untouched.
    next = { ...next, rngDraws: next.rngDraws + drop.draws };
  }
  // draws === 0 with no potion is the suppressed-full-belt (or no-chance-tier) path:
  // nothing consumed, nothing changed.

  // 6. ELITE RELIC DROP (S7) — guaranteed, 2 draws, AFTER the potion drop (the brief's
  //    fixed position; the reward roll below then reads the counter it left behind).
  //    The gained relic rides the reward as `relic` so the spoils line can name it.
  let relicGained = null;
  if (nodeType === 'elite') {
    const roll = rollEliteRelicDrop(next);
    next = { ...next, rngDraws: next.rngDraws + roll.draws };
    if (roll.relic) {
      const got = gainRelic(next, roll.relic, 'elite');
      next = got.state;
      events.push(...got.events);
      relicGained = roll.relic;
    }
  }

  const reward = next.map.encounterTable[state.combat.nodeId]?.reward ?? 'card';
  if (reward === 'heal') {
    return { state: { ...next, phase: 'rest' }, events: [...events, { t: 'rest_ready' }] };
  }

  // 7. Roll the reward offer: REWARD_CHOICES distinct cards, one more on an elite — and
  //    one more again on an ACT-2 elite (S9's escalation; a legacy save reads as act 1).
  const elites = nodeType === 'elite' ? 1 : 0;
  const deepElites = (state.act ?? 1) >= 2 && nodeType === 'elite' ? 1 : 0;
  const offer = rollReward(next, REWARD_CHOICES + elites + deepElites);
  next = {
    ...next,
    rngDraws: next.rngDraws + offer.draws,
    phase: 'reward',
    reward: {
      cards: offer.ids,
      taken: null,
      gold: goldGained,
      // Present exactly when this elite dropped one — the spoils line's fact, like
      // `gold` above; a legacy save's reward predates the field and stays null-gated.
      ...(relicGained ? { relic: relicGained } : {}),
    },
  };
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

/* ------------------------------------------------------------------ S9: the climb --
 * The act transition. Called by rules/steps.js settleBossVictory when the boss relic
 * pick/skip lands on a run with acts left (state.acts > state.act): a LEGACY save has
 * no `acts` field and reads as a one-act run at the `?? 1` below, so its act-1 boss
 * still ends in victory exactly as before S9 — the back-compat branch is this
 * comparison and nothing else.
 *
 * WHAT CHANGES: the act number, the hero (max HP +5, then a FULL heal into the new
 * max — StS's between-acts gift), and the map (a fresh walk in the next act's biome).
 * WHAT PERSISTS UNTOUCHED: deck, gold, potions, relics, draft pool, energyPerTurn,
 * powers, and every opt-in (kindling, tempers, quests) — the whole point of the
 * longer climb is that the run is a build-around. The finished act's map, the boss's
 * reward and the combat are simply left behind: state.map holds the CURRENT act only.
 *
 * EVENT ORDER (part of the format): act_advance, then the max_hp grant, then the
 * heal — the flip is announced before the gift that rides it, and the heal reads the
 * NEW max, so a relic-worn hero heals exactly (old max + 5) - hp, always positive.
 *
 * DRAW ACCOUNTING — the generation draws at the transition, from the LIVE counter, in
 * the same style and order as newRun's act-1 generation (rules/encounters.js
 * buildEncounterTable): (a) the act-2 map layout rolls first (generateMap — one draw
 * per rolled node; the fixed opener, the boss and the placed shop/events consume
 * nothing), then (b) the same +deck.length spacer newRun keeps between its own map
 * and encounter rolls — a format spacer with no consumer, mirrored so the two sites
 * read alike — then (c) the encounter table rolls per node in row order: ONE draw for
 * the encounter pick, ONE per spawned enemy's HP roll. The counter the rolls read is
 * whatever the whole act-1 victory chain left behind, reproducible from the action
 * log forever; a replay that reaches the same pick re-derives the same act-2 map.
 *
 * Pure: returns a fresh state; the only entropy is the seed stream, counted. */
export function beginNextAct(state) {
  const nextAct = (state.act ?? 1) + 1;
  const byType = BIOMES[ACT2_BIOME].byType;
  const gen = generateMap(state.seed, state.rngDraws, nextAct);
  const { table: encounterTable, draws } = buildEncounterTable(state.seed, state.rngDraws + gen.draws + (state.deck?.length ?? 0), gen.rows, byType);

  const maxHp = state.player.maxHp + ACT_HP_BONUS;
  const healed = Math.max(0, maxHp - state.player.hp);
  const events = [
    { t: 'act_advance', act: nextAct },
    { t: 'max_hp', who: 'player', amount: ACT_HP_BONUS, source: 'act_transition' },
    ...(healed > 0 ? [{ t: 'heal', who: 'player', amount: healed, source: 'act_transition' }] : []),
  ];
  return {
    state: {
      ...state,
      // `draws` is buildEncounterTable's ABSOLUTE final index (it starts from the
      // startDraw it was handed) — the new counter is that value alone. Re-summing
      // state.rngDraws here double-counted the whole pre-transition stream (S9 review
      // P1: 500-in became 1070-out); newRun mirrors this with the same bare value.
      rngDraws: draws,
      act: nextAct,
      phase: 'map',
      outcome: null,
      floor: -1,
      mapNodeId: null,
      map: { rows: gen.rows, encounterTable },
      reward: null,
      event: null,
      shop: null,
      player: { ...state.player, maxHp, hp: maxHp },
    },
    events,
  };
}
