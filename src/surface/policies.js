// Built-in self-play policies (R7 default: "Built-in heuristics first; LLM policy is
// opt-in and never default").
//
// These are HEURISTICS, not a claim about human play. Everything they produce is
// labelled `heuristic` provenance so no report can mistake it for player behaviour
// (R10 binding rule).
//
// Determinism: a policy may only read the kernel's public output — legal actions,
// state, and the events a step returned. No clocks, no Math.random, no I/O. Two runs
// on the same seed and policy take exactly the same decisions, which is what makes
// `sim` replayable and thereofore auditable.
import { loadContent } from '../kernel/index.js';

/** Ship-time card definitions, read once. Content is the kernel's public data. */
const CONTENT = loadContent();

/** Cost/benefit of the fixed self-damage cards, which no data field carries. */
const SELF_DAMAGE = { bloodletting: 3, hemokinesis: 2, offering: 6 };

/** Damage an intent label will deal, e.g. "A11" -> 11, "A5x3" -> 15, "B20" -> 0. */
export function intentDamageFromLabel(label) {
  if (typeof label !== 'string') return 0;
  const m = /A(\d+)(?:x(\d+))?/.exec(label);
  if (!m) return 0;
  return Number(m[1]) * (m[2] ? Number(m[2]) : 1);
}

/**
 * Estimate a card's worth in the current combat.
 *
 * Deliberately computed from the card's declarative effects rather than hard-coded
 * per card, so adding cards to content does not silently weaken the policy.
 * @param {any} def card definition
 * @param {{state: any, card: any, liveEnemies: any[], incoming: number, lethalAnywhere: boolean}} ctx
 * @returns {{score: number, damage: number, block: number, selfDamage: number}}
 */
export function scoreCard(def, ctx) {
  const p = ctx.state.player;
  const live = ctx.liveEnemies;
  let damage = 0;
  let aoe = 0;
  let block = 0;
  let draw = 0;
  let energy = 0;
  let strength = 0;
  let vulnerable = 0;
  let weak = 0;
  let power = 0;
  let selfDamage = 0;

  for (const e of def.effects) {
    switch (e.verb) {
      case 'damage': {
        const total = e.amount * (e.hits ?? 1);
        if (e.target === 'all_enemies') aoe += total * Math.max(1, live.length) * 0.6;
        else damage += total;
        break;
      }
      case 'block':
        block += e.amount;
        break;
      case 'draw':
        draw += e.amount;
        break;
      case 'energy':
        energy += e.amount;
        break;
      case 'status':
        if (e.status === 'strength') strength += e.amount;
        else if (e.status === 'vulnerable') vulnerable += e.amount;
        else if (e.status === 'weak') weak += e.amount;
        else power += e.amount;
        break;
      case 'custom': {
        const h = e.handler;
        selfDamage += SELF_DAMAGE[h] ?? 0;
        if (h === 'hemokinesis') damage += 15;
        else if (h === 'reaper') aoe += 4 * Math.max(1, live.length);
        else if (h === 'limit_break') strength += 2 * (p.statuses?.strength ?? 0);
        else if (h === 'rampage') damage += 8 + 5 * (ctx.card?.perPlay ?? 0);
        else if (h === 'offering') {
          draw += 3;
          energy += 2;
        } else power += 4;
        break;
      }
      default:
        break;
    }
  }

  const totalDamage = damage + aoe;
  const need = Math.max(0, ctx.incoming - p.block);
  const lethal = need >= p.hp;

  // BLOCK IS WORTH WHAT IT SAVES, NOT WHAT IT PRINTS.
  // The first version scored raw block at 1.9x whenever damage was incoming, which
  // made the policy dump every energy into 5-damage Defends against a 240 HP boss
  // and lose the damage race 20/30 times. Block beyond the incoming attack prevents
  // nothing, so only the covering portion is credited — and covering a *lethal* hit
  // is credited as survival, which is a different and much larger thing.
  const effectiveBlock = Math.min(block, need);

  let score = totalDamage * (ctx.lethalAnywhere ? 2 : 1);
  score += effectiveBlock * 1.5;
  if (lethal && effectiveBlock >= need) score += 25;
  else if (lethal) score -= 8;
  score += strength * 4 + vulnerable * 3 + weak * 2.5 + power * 2;
  score += draw * 1.5 + energy * 2.5;
  score -= selfDamage * (p.hp < 20 ? 4 : 1);
  return { score, damage: totalDamage, block, selfDamage };
}

/**
 * Build a policy by name.
 * @param {string} name
 * @returns {{name: string, choose: (ctx: any) => {id: string, memory: any}}}
 */
export function makePolicy(name) {
  if (name === 'random') return randomPolicy();
  if (name === 'greedy') return greedyPolicy();
  if (name === 'smart') return smartPolicy();
  throw Object.assign(new Error(`unknown policy "${name}" (expected: greedy, random, smart)`), { code: 3 });
}

/** Deterministic pseudo-choice: no RNG state, so replay of sim runs is exact. */
function randomPolicy() {
  return {
    name: 'random',
    choose(ctx) {
      const acts = ctx.legal;
      if (acts.length === 0) return { id: null, memory: ctx.memory };
      // Hash-free deterministic index mixing seed, step and choice count.
      const mixed = (ctx.session.state.seed * 2654435761 + ctx.session.state.rngDraws * 40503 + ctx.stepIndex * 97) >>> 0;
      return { id: acts[mixed % acts.length].id, memory: ctx.memory };
    },
  };
}

/**
 * The heuristic the balance data is generated with.
 *
 * Priority order, in plain terms: take a kill when one exists; block only as much
 * as the incoming attack actually requires; otherwise build damage and value. The
 * "only as much as required" part is what separates a competent player from a
 * card-cycling bot, and it is why this policy can finish a run.
 */
function greedyPolicy() {
  return {
    name: 'greedy',
    choose(ctx) {
      const { state, legal: acts, memory } = ctx;
      if (acts.length === 0) return { id: null, memory };

      if (state.phase === 'ended') return { id: null, memory };

      if (state.phase === 'reward') {
        const picks = acts.filter((a) => a.kind === 'pick');
        const skip = acts.find((a) => a.kind === 'skip');
        if (picks.length === 0) return { id: skip?.id ?? acts[0].id, memory };
        const ranked = picks
          .map((a) => ({ a, s: rewardWorth(CONTENT.cards.get(a.cardId)) }))
          .sort((x, y) => y.s - x.s);
        const best = ranked[0];
        // A thin deck is the most common way to lose this act: with 3 energy a turn,
        // what matters is average damage per energy, and 10 starter cards supply ~6.
        // Refusing cards therefore has to clear a high bar, not a low one.
        const deckIsFat = state.deck.length >= 24;
        const floor = deckIsFat ? 22 : 0;
        if (best.s < floor && skip) return { id: skip.id, memory };
        return { id: best.a.id, memory };
      }

      if (state.phase === 'rest') {
        const heal = acts.find((a) => a.kind === 'rest_heal');
        // Heal whenever it is not wasted: an act-1 boss is a 240 HP damage race, so
        // HP is the resource that decides whether the run reaches it at all.
        if (heal && state.player.hp < state.player.maxHp - 2) return { id: heal.id, memory };
        return { id: acts.find((a) => a.kind === 'rest_leave')?.id ?? acts[0].id, memory };
      }

      if (state.phase === 'map') {
        const order = routePreference(state);
        const best = acts
          .filter((a) => a.kind === 'travel')
          .sort((x, y) => (order.indexOf(x.nodeType) + 1 || 99) - (order.indexOf(y.nodeType) + 1 || 99))[0];
        return { id: best?.id ?? acts[0].id, memory };
      }

      // Combat.
      const live = state.combat.enemies.filter((e) => !e.dead);
      const incoming = memory.incoming ?? 0;
      const plays = acts.filter((a) => a.kind === 'play');
      if (plays.length === 0) {
        const end = acts.find((a) => a.kind === 'end_turn');
        return { id: end?.id ?? acts[0].id, memory };
      }

      const hpSum = live.reduce((s, e) => s + e.hp, 0);
      const scored = plays
        .map((a) => {
          const def = CONTENT.cards.get(a.cardId);
          const card = state.combat.hand[Number(a.id.slice(1)) - 1];
          const s = scoreCard(def, { state, card, liveEnemies: live, incoming, lethalAnywhere: hpSum <= 14 });
          // Prefer the cheapest card that reaches the same score: energy is the
          // scarce resource, and a 2-cost card that overkills wastes a whole turn.
          return { a, def, card, ...s, key: s.score - (a.cost ?? 0) * 1.2 };
        })
        .sort((x, y) => y.key - x.key);

      const top = scored[0];
      const end = acts.find((a) => a.kind === 'end_turn');

      // Every card is actively bad here (e.g. only self-damage at 5 HP left): stop.
      if (top.score <= 0 && end) return { id: end.id, memory };

      // SURVIVAL OVERRIDE. If the incoming hit kills us and a block card can change
      // that, take block regardless of damage — a dead player deals no damage, and
      // the per-card score cannot see that because it scores one card at a time.
      if (end) {
        const lethal = incoming >= state.player.hp;
        if (lethal) {
          const blockers = scored.filter((s) => s.block > 0).sort((x, y) => y.block - x.block);
          const cover = blockers.reduce((sum, s) => sum + s.block, 0) + state.player.block;
          if (blockers.length > 0 && cover >= incoming) return { id: blockers[0].a.id, memory };
          // Cannot survive even blocking: maximise damage and hope for a kill.
          if (blockers.length === 0) return { id: top.a.id, memory };
        }
      }

      // If we cannot meaningfully dent the enemy and nothing is incoming, stop
      // wasting cards on a fight we are losing slowly.
      if (!end) return { id: top.a.id, memory };
      const deadHand = incoming === 0 && top.damage === 0 && top.block === 0 && top.score < 6;
      if (deadHand) return { id: end.id, memory };

      return { id: top.a.id, memory };
    },
  };
}

// ---------------------------------------------------------------------------
// TASK 1 — `smart`: a policy that values what a card actually DOES.
//
// WHY THIS EXISTS. `greedy` reads one number per card and that number was wrong in
// two ways that mattered more than anything else in the balance data:
//
//   1. Block was credited as min(block, incoming - player.block), and the reward
//      branch asked for a valuation with incoming = 0. Every defensive card in the
//      game therefore scored exactly 0 when offered: `impervious` (30 Block, 2
//      Energy, the best defensive card in the slice) was offered 742 times and
//      picked 0 times. `bludgeon`, the biggest raw damage number, was picked 100%.
//   2. Nothing consulted the deck. `rewardWorth()` scored a card against a
//      hard-coded fake board, so a deck with one attack and no defence and a deck
//      with the reverse made the same choice.
//
// STRUCTURE, because the fix has to stay checkable:
//   effectProfile()  — card data -> a neutral description of what it does (no board)
//   scoreSmartCard() — that description + THIS board  -> a combat score
//   smartRewardScore() — that description + THIS deck -> a reward score
// Choose is then a small loop over the legal actions, and nothing else decides.
//
// DETERMINISM. Pure functions of the observation: legal actions, state, and the
// rendered dump the harness already produced. No clocks, no Math.random, no I/O, no
// import of rules/** (the architecture gate forbids a surface reaching in there, so
// the two numbers a card needs but data does not carry — what a `custom` handler
// does, and what an announced intent will deal — are read from the handler NAME and
// from the rendered intent label, exactly as observe.js already does for rendering).
// ---------------------------------------------------------------------------

/**
 * Combat weights. A point of damage that lands is a point; a point of Block that
 * actually prevents damage is a point. Everything else is a judgement call and says
 * so, so a later reader can argue with a number instead of guessing at it.
 */
const W = {
  /** 1 point of damage that is actually dealt (never overkill). */
  damage: 1.0,
  /** 1 point of Block that is actually needed this turn (never surplus). */
  block: 1.0,
  /**
   * Reward-time value of one point of PRINTED Block, per Energy, discounted below
   * the in-combat 1.0 for `block`.
   *
   * WHY DISCOUNTED, and why this is the over-correction the 2000-run data caught:
   * a reward is kept for the whole run, and the act-1 boss is a pure damage race —
   * it deals a fixed number of damage per turn, so the only way to take less damage
   * is to END THE FIGHT SOONER. Block reduces damage per turn; it never wins. The
   * first `smart` priced a printed Block point at 1.0 x blockNeed, which made
   * `impervious` (2 Energy, 30 Block) out-score `bludgeon` (3 Energy, 32 damage) and
   * built decks of 44 Block / 77 attack that reached the boss and then could not
   * kill it (19.2% boss kill rate vs greedy's 34.6%). Damage is priced by what it
   * contributes to the kill (`throughput` below); Block is priced lower so that a
   * deck only ever carries the Block it can actually spend. ARBITRARY value.
   */
  rewardBlock: 0.5,
  /**
   * Extra reward credit for RAW damage, on top of `damageNeed`, because the marginal
   * point of damage is worth more than an average point: it is the last points that
   * end the fight, and every boss turn not taken is 19-32 damage not suffered.
   * Expressed as a multiplier on concentrated damage only, so a 32-damage `bludgeon`
   * is valued ABOVE four 8-damage hits (which a Block-heavy boss fight may never
   * live long enough to land). ARBITRARY value; the ordering it produces is pinned
   * by tests/policy.test.js rather than trusted to the number.
   */
  throughput: 0.45,
  /**
   * Reward-time horizon for a persistent power, in turns of its own effect. Longer
   * than the in-combat `power` horizon because a reward is kept for many fights.
   * ARBITRARY.
   */
  rewardPowerTurns: 6,
  /** Extra credit when that Block is the difference between living and dying. */
  lethalBlock: 2.5,
  /** Uncovered lethal damage: how bad it is to still be facing it after this card. */
  uncoveredLethal: 1.0,
  /** A dead enemy deals no damage next turn (requirement 3). */
  kill: 6,
  /** ...and the bigger the attack it was announcing, the more the kill is worth. */
  killThreat: 0.5,
  /** Killing the LAST enemy ends the combat outright. */
  finish: 40,
  /** One point of Strength is worth roughly one attack's worth of damage. ARBITRARY. */
  strength: 3,
  /** One point of Vulnerable is worth 50% of a follow-up attack. ARBITRARY. */
  vulnerable: 2,
  /** One point of Weak cuts one incoming attack by a quarter. ARBITRARY. */
  weak: 2,
  /** A persistent power is worth several turns of its effect: 3 is the assumed horizon. */
  power: 4,
  /** Block-per-turn statuses (Metallicize) are worth this many turns of Block. ARBITRARY. */
  metallicizeTurns: 3,
  /** Drawing is only worth something if there is a pile to draw from. */
  draw: 2,
  /** Energy is only worth something if there is something left to spend it on. */
  energyGain: 3,
  /** Healing is worth HP, and HP is what decides whether the run reaches the boss. */
  heal: 1.0,
  /** HP spent for tempo while comfortable. ARBITRARY. */
  selfDamageBold: 1.2,
  /** ...and while not comfortable, spending HP to gain nothing is suicide. ARBITRARY. */
  selfDamageDesperate: 6,
  /** Per-Energy selection penalty in combat: energy is the scarce resource. ARBITRARY. */
  energyCost: 2.0,
  /**
   * RACE AWARENESS. Turns of survival at or below which the fight counts as a lost
   * race and damage is preferred over Block. The act-1 boss is a fixed damage race:
   * it deals 19-32 every turn and has a large pool, so the only way to take LESS damage
   * is to END THE FIGHT SOONER. Block buys a turn the deck cannot convert; damage is
   * damage prevention. The 2000-run boss probe measured the failure directly: `smart`
   * gained 1906 Block inside boss fights and still took MORE damage per turn than
   * `greedy` (3.88 vs 3.57) while dealing less (49.2 vs 54.4 per fight). Gated on
   * near-term danger so ordinary fights still block normally. ARBITRARY thresholds.
   */
  raceDangerTurns: 3,
  /** ...and while losing the race, damage counts this much more. ARBITRARY. */
  raceDamage: 1.8,
  /** ...and Block, which only delays a race the deck loses, counts this much less. ARBITRARY. */
  raceBlock: 0.25,
};

/**
 * Blend for a reward offer: total long-run value vs value per Energy (requirement 1:
 * energy efficiency is a first-class term, not an afterthought). A card is kept
 * forever but costs Energy every time it is played, so both terms are real.
 * ARBITRARY split; the ordering it produces is checked by tests/policy.test.js.
 */
const REWARD_MIX = { total: 0.7, perEnergy: 0.3 };

/**
 * What a balanced act-1 deck looks like per card. Used as the reference point for
 * "is this deck short on defence?", not as a target to hit exactly. ARBITRARY, and
 * calibrated from the starter deck (10 cards: 20 Block, 38 damage) plus what the
 * act-1 boss demands (240 HP behind a 32-damage swing).
 */
const DECK_TARGET = { blockPerCard: 9, damagePerCard: 7 };

/**
 * A reward worth at least this much is taken even by an already-fat deck. ARBITRARY:
 * scaled to the reward scale above — a plain attack lands near `damagePerCard`
 * (7) x `damageNeed` (~1.45) x the throughput bonus (~1.35), so ~14 is "a normal
 * damage card", and only an offer weaker than that is refused when the deck is fat.
 * It sat at 14 before the throughput bonus existed and would otherwise have started
 * silently skipping ordinary attacks.
 */
const SKIP_SCORE = 18;
/** ...and a thinner deck always takes the best of what it is offered. ARBITRARY. */
const SKIP_DECK_SIZE = 18;

/**
 * What each `custom` handler does, in policy terms.
 *
 * WHY A TABLE: the `custom` verb carries only a handler NAME — the numbers live in
 * src/kernel/rules/effects/*.js, which a surface may not import (architecture gate,
 * R1a). observe.js keeps CUSTOM_SUMMARY for exactly the same reason. A card whose
 * handler is missing from this table is flagged (`handlerUnknown`) rather than
 * quietly scored at zero, so a new exotic card shows up as a hole instead of as
 * "this card is worthless".
 */
const CUSTOM_READING = {
  bloodletting: { selfDamage: 3, energy: 2 },
  hemokinesis: { selfDamage: 2, damage: 15 },
  offering: { selfDamage: 6, energy: 2, draw: 3 },
  reaper: { aoePerTarget: 4, healPerDamage: 1 },
  limit_break: { doublesStrength: true },
  entrench: { doublesBlock: true },
  combust: { power: 1 },
  dark_embrace: { power: 1 },
  feel_no_pain: { power: 1 },
  rupture: { power: 1 },
  rampage: { damage: 8, growsBy: 5 },
};

/** Damage an intent label will deal per enemy turn, hits included. */
function hitsFromLabel(label) {
  const m = /A\d+(?:x(\d+))?/.exec(typeof label === 'string' ? label : '');
  return m && m[1] ? Number(m[1]) : 1;
}

/**
 * Per-living-enemy estimate of this turn's incoming damage, in the order the
 * observation lists the enemies (which is the order `state.combat.enemies` keeps).
 *
 * WHY THE DUMP AND NOT THE STATE: what a player can see is the printed intent label.
 * Reading it keeps the policy honest about its information. Two corrections greedy
 * did not make, both from fields the player can also see, are applied on top:
 * announced damage is per hit, so enemy Strength multiplies it by the hit count, and
 * a Vulnerable player takes 50% more. Greedy ignored both, which understated the
 * incoming attack exactly when the bot was most likely to die.
 * @param {any} state
 * @param {string|null} dump rendered observation, or null when unavailable
 * @returns {number[]}
 */
export function enemyThreats(state, dump) {
  const live = (state.combat?.enemies ?? []).filter((e) => !e.dead);
  const labels = intentLabelsFromDump(dump);
  const vulnerable = (state.player.statuses?.vulnerable ?? 0) > 0;
  return live.map((e, i) => {
    const label = labels[i] ?? '';
    const base = intentDamageFromLabel(label);
    const hits = hitsFromLabel(label);
    let dmg = base + (e.statuses?.strength ?? 0) * hits;
    if (vulnerable) dmg = Math.floor((dmg * 3) / 2);
    return dmg;
  });
}

/**
 * Intent labels of the live enemies, in listing order, from a rendered dump.
 * The enemy row is ` <name>  HP x/y[ Bn]  <intent label>[ statuses]`, so the label is
 * whatever is left after the name, the HP field and an optional Block field.
 * @param {string|null|undefined} dump
 * @returns {string[]}
 */
export function intentLabelsFromDump(dump) {
  if (typeof dump !== 'string') return [];
  const rows = dump.split('\n');
  const at = rows.indexOf('ENEMY');
  if (at === -1) return [];
  const out = [];
  for (let i = at + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.trim() === '' || /^[A-Z]+\b/.test(row)) break;
    const parts = row.trim().split(/\s{2,}/);
    const rest = parts.slice(1).filter((p) => !/^HP\s+\d+\/\d+$/.test(p) && !/^B\d+$/.test(p));
    out.push(rest.join(' ').trim());
  }
  return out;
}

/**
 * Read a card definition into a neutral profile of what it does, independent of any
 * board. Every field is in the card's own printed terms (damage, Block, cards drawn,
 * Energy) so the two consumers below can weight the same numbers differently.
 * @param {any} def card definition from content
 * @param {{liveCount?: number, playerStrength?: number, playerDexterity?: number, perPlay?: number}} [env]
 * @returns {any} profile
 */
export function effectProfile(def, env = {}) {
  const liveCount = Math.max(1, env.liveCount ?? 1);
  const strength = env.playerStrength ?? 0;
  const dexterity = env.playerDexterity ?? 0;
  const p = {
    id: def.id,
    name: def.name,
    cost: def.cost,
    type: def.type,
    damage: 0,
    aoePerTarget: 0,
    block: 0,
    blockPerTurn: 0,
    doublesBlock: false,
    doublesStrength: false,
    draw: 0,
    discard: 0,
    energy: 0,
    selfDamage: 0,
    strengthGain: 0,
    vulnerable: 0,
    weak: 0,
    power: 0,
    healPerDamage: 0,
    growsBy: 0,
    exhausts: false,
    handlerUnknown: false,
  };
  void liveCount;

  for (const e of def.effects) {
    switch (e.verb) {
      case 'damage': {
        // Strength is added per hit by the engine, so it scales with the hit count.
        const total = (e.amount + strength) * (e.hits ?? 1);
        if (e.target === 'all_enemies') p.aoePerTarget += total;
        else p.damage += total;
        break;
      }
      case 'block':
        p.block += e.amount + dexterity;
        break;
      case 'draw':
        p.draw += e.amount;
        break;
      case 'discard':
        p.discard += e.amount;
        break;
      case 'energy':
        p.energy += e.amount;
        break;
      case 'exhaust':
        p.exhausts = true;
        break;
      case 'status':
        if (e.status === 'strength') p.strengthGain += e.amount;
        else if (e.status === 'vulnerable') p.vulnerable += e.amount;
        else if (e.status === 'weak') p.weak += e.amount;
        else if (e.status === 'metallicize') p.blockPerTurn += e.amount;
        else p.power += e.amount;
        break;
      case 'custom': {
        const r = CUSTOM_READING[e.handler];
        if (!r) {
          p.handlerUnknown = true;
          break;
        }
        p.damage += r.damage ?? 0;
        p.aoePerTarget += r.aoePerTarget ?? 0;
        p.block += r.block ?? 0;
        p.draw += r.draw ?? 0;
        p.energy += r.energy ?? 0;
        p.selfDamage += r.selfDamage ?? 0;
        p.healPerDamage += r.healPerDamage ?? 0;
        p.growsBy += r.growsBy ?? 0;
        p.power += r.power ?? 0;
        if (r.doublesBlock) p.doublesBlock = true;
        if (r.doublesStrength) p.doublesStrength = true;
        break;
      }
      default:
        break;
    }
  }
  return p;
}

/** Total damage a profile deals across the whole field. */
export function profileDamage(p, liveCount) {
  return p.damage + p.aoePerTarget * Math.max(1, liveCount);
}

/**
 * Score ONE card against THIS board. The two terms that `greedy` got wrong are the
 * reason this exists: Block is credited only up to what the incoming attack actually
 * needs, damage only up to what the enemies actually have left, and both are then
 * judged against the alternative of doing nothing.
 *
 * @param {any} def card definition
 * @param {any} ctx see combatContext(): built from the live state by the chooser
 * @returns {{score: number, key: number, perEnergy: number, detail: any}}
 */
export function scoreSmartCard(def, ctx) {
  const live = ctx.liveEnemies ?? [];
  const liveCount = Math.max(1, live.length);
  const p = effectProfile(def, {
    liveCount,
    playerStrength: ctx.playerStrength ?? 0,
    playerDexterity: ctx.playerDexterity ?? 0,
    perPlay: ctx.perPlay ?? 0,
  });

  const raw = profileDamage(p, liveCount);
  // Overkill is worth nothing: damage beyond the enemies' remaining HP+Block does not
  // exist. Centring the valuation on the durable board is what stops the bot from
  // always preferring the biggest printed number.
  const enemyPool = ctx.enemyHpRemaining + ctx.enemyBlockRemaining;
  const capped = Math.min(raw, Math.max(0, enemyPool));

  // Block is worth what it SAVES. `need` is the damage still uncovered this turn, so
  // Block with nothing incoming is worth zero (requirement 4) and Block that closes
  // a lethal gap is worth survival (requirement 2).
  const need = Math.max(0, ctx.incoming - ctx.playerBlock);
  const blockGiven = p.block + (p.doublesBlock ? ctx.playerBlock * 2 : 0);
  const effBlock = Math.min(blockGiven, need);
  const lethalIncoming = need >= ctx.playerHp;

  const focus = live[0] ?? null;
  const focusPool = focus ? focus.hp + focus.block : 0;
  const killsFocus = focus !== null && raw >= focusPool; // raw, not capped: a kill is a kill
  const finishes = focus !== null && raw >= enemyPool;

  // Follow-up credit: Strength and Vulnerable only matter if something hits afterwards.
  const followUps = ctx.followUpAttacks ?? 0;
  const canFollowUp = followUps > 0 && ctx.energyLeft > 0;

  let score = capped * W.damage + effBlock * W.block;
  // In a lost damage race, ending the fight is the only damage prevention left: damage
  // counts for more and Block for less (see W.race*). Damage is still capped at the
  // enemies' live pool, so the overshoot the cap exists to prevent is unaffected.
  if (ctx.raceLoss === true) {
    score += capped * (W.raceDamage - 1) * W.damage;
    score += effBlock * (W.block * (W.raceBlock - 1));
  }
  if (lethalIncoming) {
    score += effBlock * W.lethalBlock; // survival is a different and larger thing
    score -= Math.max(0, need - blockGiven) * W.uncoveredLethal;
  }
  if (killsFocus) score += W.kill + (focus?.incoming ?? 0) * W.killThreat;
  if (finishes) score += W.finish;
  if (p.strengthGain > 0) score += p.strengthGain * W.strength * (canFollowUp ? Math.min(3, followUps) : 0);
  if (p.doublesStrength) score += ctx.playerStrength * W.strength * (canFollowUp ? 1 : 0);
  if (p.vulnerable > 0) score += p.vulnerable * W.vulnerable * (canFollowUp ? 1 : 0);
  if (p.weak > 0) score += p.weak * W.weak;
  score += p.power * W.power;
  score += p.blockPerTurn * W.metallicizeTurns * W.block;
  // Drawing and Energy are only worth something if there is anything left to use
  // them on — the same "do not spend a card on nothing" rule as Block above.
  if (ctx.drawableInPiles) score += p.draw * W.draw - p.discard * W.draw * 0.5;
  if (ctx.drawableInPiles || ctx.playableInHand > 1) score += p.energy * W.energyGain;
  if (p.healPerDamage > 0) {
    score += Math.min(capped, Math.max(0, ctx.playerMaxHp - ctx.playerHp)) * p.healPerDamage * W.heal;
  }
  // Self-damage is priced by how much HP is left to spend. The engine floors self-
  // damage at 1 HP, so this is a valuation, not a safety check.
  if (p.selfDamage > 0) {
    const rate = ctx.playerHp <= p.selfDamage + 5 ? W.selfDamageDesperate : W.selfDamageBold;
    score -= p.selfDamage * rate;
  }

  const perEnergy = score / Math.max(1, p.cost);
  return {
    score,
    key: score - p.cost * W.energyCost,
    perEnergy,
    detail: {
      cost: p.cost,
      damage: capped,
      rawDamage: raw,
      block: effBlock,
      blockGiven,
      killsFocus,
      finishes,
      need,
      lethalIncoming,
      selfDamage: p.selfDamage,
      handlerUnknown: p.handlerUnknown,
      exhausts: p.exhausts,
      type: p.type,
    },
  };
}

/**
 * How much Block and how much damage the deck actually carries PER CARD.
 * @param {any[]} deck deck instances ({uid, cardId})
 * @returns {{cards: number, attacks: number, skills: number, powers: number, block: number, damage: number}}
 */
export function deckComposition(deck) {
  const out = { cards: 0, attacks: 0, skills: 0, powers: 0, block: 0, damage: 0 };
  for (const inst of deck ?? []) {
    const def = CONTENT.cards.get(inst.cardId);
    if (!def) continue;
    out.cards += 1;
    if (def.type === 'attack') out.attacks += 1;
    else if (def.type === 'skill') out.skills += 1;
    else if (def.type === 'power') out.powers += 1;
    const p = effectProfile(def, { liveCount: 1 });
    out.block += p.block;
    out.damage += p.damage + p.aoePerTarget;
  }
  return out;
}

/**
 * What the deck is SHORT of, as multipliers on the two terms a reward is judged by.
 * A deficit in a category scales that category up; a surplus scales it down. This is
 * the part of requirement 5 that needs no card ids: it is a property of the deck.
 * @param {any[]} deck
 * @returns {{composition: any, blockNeed: number, damageNeed: number}}
 */
export function deckNeeds(deck) {
  const c = deckComposition(deck);
  const perCard = Math.max(1, c.cards);
  const blockPerCard = c.block / perCard;
  const damagePerCard = c.damage / perCard;
  const clamp = (v) => Math.max(0.5, Math.min(2, v));
  return {
    composition: c,
    blockNeed: clamp(1 + (DECK_TARGET.blockPerCard - blockPerCard) / DECK_TARGET.blockPerCard),
    damageNeed: clamp(1 + (DECK_TARGET.damagePerCard - damagePerCard) / DECK_TARGET.damagePerCard),
  };
}

/**
 * Score ONE offered card against THIS deck (requirement 5).
 *
 * The card's printed worth is computed with `effectProfile` and NO board at all —
 * that is deliberate: at a reward you have no enemy in front of you, and that is
 * precisely the situation in which `greedy` valued every Block card at zero. Here a
 * Block card is worth its Block, scaled by how short the deck is on defence.
 * @param {any} def card definition
 * @param {any} state run state (its `deck` is the thing being judged)
 * @returns {{score: number, key: number, perEnergy: number, needs: any, detail: any}}
 */
export function smartRewardScore(def, state) {
  const needs = deckNeeds(state.deck ?? []);
  const p = effectProfile(def, { liveCount: 1 });
  // Area damage is real but this slice is mostly single-enemy fights, so an
  // all-enemies hit is counted at 1.5 targets here. ARBITRARY.
  //
  // DAMAGE is what ENDS a fight, and ending a fight is damage prevention that no
  // amount of Block can replace: the act-1 boss deals a fixed rate per turn (19-32),
  // so every turn not spent killing it is another hit taken. Concentrated damage
  // therefore carries the `throughput` bonus on top of `damageNeed` — see
  // W.throughput. This is the half the first `smart` was missing.
  const offense = (p.damage * (1 + W.throughput) + p.aoePerTarget * 1.5) * needs.damageNeed;
  // BLOCK reduces incoming damage; it does not win. Still priced — the defect this
  // policy exists to fix was pricing every Block card at exactly ZERO — but below
  // damage, at W.rewardBlock per printed point. See W.rewardBlock for the measured
  // reason the first `smart` over-corrected into a deck that could not kill the boss.
  const defence = p.block * W.rewardBlock * needs.blockNeed;
  // Utility: consistency and tempo. Exhaust thins the deck; a thinner deck draws its
  // best cards more often, which is what "value exhaust/energy/draw for consistency"
  // means in policy terms.
  //
  // UTILITY is where a card does not hit or block but SHORTENS THE FIGHT. The 2000-run
  // data is blunt about what mattered: greedy's boss decks carried more `uppercut`,
  // `shockwave`, `twin_strike` and `flex` than smart's, i.e. damage AMPLIFICATION and
  // cheap efficient attacks, and they killed the boss with decks that were also less
  // Block-heavy. So Strength and Vulnerable are priced on the DAMAGE side (they are
  // multipliers on every future attack) and persistent powers are valued over a
  // horizon of turns rather than as a one-off. See W.rewardPowerTurns.
  const utility =
    p.draw * W.draw +
    p.discard * (-W.draw * 0.5) +
    p.energy * W.energyGain +
    p.power * W.power * W.rewardPowerTurns +
    p.strengthGain * W.strength * 2 +
    p.doublesStrength * W.strength * 2 +
    p.vulnerable * W.vulnerable * 1.5 +
    p.weak * W.weak +
    p.blockPerTurn * W.metallicizeTurns * W.rewardBlock +
    (p.exhausts ? 2 : 0) + // ARBITRARY: deck-thinning bonus
    p.growsBy * 0.5;
  const score = offense + defence + utility;
  const perEnergy = score / Math.max(1, p.cost);
  return {
    score,
    key: score * REWARD_MIX.total + perEnergy * REWARD_MIX.perEnergy,
    perEnergy,
    needs,
    detail: { offense, defence, utility, cost: p.cost, exhausts: p.exhausts, handlerUnknown: p.handlerUnknown, type: p.type },
  };
}

/**
 * Everything the combat scorer needs, assembled from the live state plus the rendered
 * intent labels. One builder, so the chooser and the tests judge cards against
 * identical boards.
 * @param {any} state
 * @param {string|null} dump rendered observation (or null)
 * @param {number|null} incomingOverride explicit total, when the caller knows better
 * @returns {any}
 */
export function combatContext(state, dump, incomingOverride = null, playerHpEstimate = null) {
  const live = state.combat.enemies.filter((e) => !e.dead);
  const threats = enemyThreats(state, dump);
  const incoming = incomingOverride ?? threats.reduce((a, b) => a + b, 0);
  const handDefs = state.combat.hand.map((c) => CONTENT.cards.get(c.cardId));
  const attacksInHand = handDefs.filter((d) => d && (d.type === 'attack' || d.effects.some((e) => e.verb === 'damage'))).length;
  // TURNS-TO-KILL. When the announced rate would end the player within W.raceDangerTurns
  // even counting Block already banked, surviving is no longer a strategy: the fight is
  // a race the deck is losing, and the only damage prevention left is a faster kill.
  // Callers may pass a smaller `playerHpEstimate` (the chooser does) so the branch is
  // reachable in a unit test with the same rule the sim uses.
  const estHp = playerHpEstimate ?? state.player.hp;
  const turnsToLive = incoming > 0 ? (estHp + state.player.block) / incoming : Number.POSITIVE_INFINITY;
  const raceLoss = turnsToLive <= W.raceDangerTurns;
  return {
    liveEnemies: live.map((e, i) => ({ hp: e.hp, block: e.block, incoming: threats[i] ?? 0, dead: false })),
    incoming,
    raceLoss,
    turnsToLive,
    playerHp: state.player.hp,
    playerMaxHp: state.player.maxHp,
    playerBlock: state.player.block,
    playerStrength: state.player.statuses?.strength ?? 0,
    playerDexterity: state.player.statuses?.dexterity ?? 0,
    energyLeft: state.player.energy,
    enemyHpRemaining: live.reduce((s, e) => s + e.hp, 0),
    enemyBlockRemaining: live.reduce((s, e) => s + e.block, 0),
    drawPileSize: state.combat.draw.length,
    discardSize: state.combat.discard.length,
    drawableInPiles: state.combat.draw.length + state.combat.discard.length > 0,
    playableInHand: legalPlays(state).length,
    attacksInHand,
  };
}

/** Play actions that are legal right now (energy already accounted for by the kernel). */
function legalPlays(state) {
  const out = [];
  state.combat.hand.forEach((card, i) => {
    if (card.cost <= state.player.energy) out.push({ id: `p${i + 1}`, cardId: card.cardId, cost: card.cost });
  });
  return out;
}

/** Where to go next, best first. Rest when hurt; otherwise take the safe fight. */
function routePreference(state) {
  const hpFrac = state.player.hp / state.player.maxHp;
  if (hpFrac < 0.55) return ['rest', 'combat_weak', 'combat_strong', 'elite'];
  if (hpFrac > 0.85) return ['combat_strong', 'combat_weak', 'rest', 'elite'];
  return ['combat_weak', 'combat_strong', 'rest', 'elite'];
}

/**
 * The `smart` policy: score every legal action, take the best, repeat.
 *
 * Same contract as every other policy — `choose(ctx)` returns `{id, memory}` and reads
 * only public observation. The action space carries no target parameter (the kernel
 * always aims a single-target card at the first living enemy), so "hit the most
 * dangerous enemy" is expressed as "play the card that kills or covers the threat",
 * which is the part of requirement 6 the interface can actually express.
 */
function smartPolicy() {
  return {
    name: 'smart',
    choose(ctx) {
      const { state, legal: acts, memory } = ctx;
      if (acts.length === 0) return { id: null, memory };
      if (state.phase === 'ended') return { id: null, memory };

      if (state.phase === 'reward') return chooseReward(state, acts, memory);
      if (state.phase === 'rest') return chooseRest(state, acts, memory);
      if (state.phase === 'map') return chooseMap(state, acts, memory);
      return chooseCombat(state, acts, memory, ctx);
    },
  };
}

/** Reward: take the card the DECK needs, not the card with the biggest number. */
function chooseReward(state, acts, memory) {
  const picks = acts.filter((a) => a.kind === 'pick');
  const skip = acts.find((a) => a.kind === 'skip');
  if (picks.length === 0) return { id: skip?.id ?? acts[0].id, memory };
  const ranked = picks
    .map((a) => ({ a, s: smartRewardScore(CONTENT.cards.get(a.cardId), state) }))
    .sort((x, y) => y.s.key - x.s.key || y.s.perEnergy - x.s.perEnergy);
  const best = ranked[0];
  // The deck is allowed to stay thin, but only once it is already large and only when
  // the offer is genuinely weak: dilution costs consistency, and a small deck that
  // draws its best card every turn beats a big one. Thresholds are ARBITRARY.
  const fat = state.deck.length >= SKIP_DECK_SIZE;
  if (fat && best.s.key < SKIP_SCORE && skip) return { id: skip.id, memory };
  return { id: best.a.id, memory };
}

/** Rest: healing is free, so the only reason to leave is that there is nothing to heal. */
function chooseRest(state, acts, memory) {
  const heal = acts.find((a) => a.kind === 'rest_heal');
  if (heal && state.player.hp < state.player.maxHp) return { id: heal.id, memory };
  return { id: acts.find((a) => a.kind === 'rest_leave')?.id ?? acts[0].id, memory };
}

/** Map: same routing table as `greedy`. */
function chooseMap(state, acts, memory) {
  const order = routePreference(state);
  const best = acts
    .filter((a) => a.kind === 'travel')
    .sort((x, y) => (order.indexOf(x.nodeType) + 1 || 99) - (order.indexOf(y.nodeType) + 1 || 99))[0];
  return { id: best?.id ?? acts[0].id, memory };
}

/**
 * Combat: reject the lethal line, take the kill, else spend Energy on real value.
 *
 * The loop is the policy: after every play the board changes, so the next decision is
 * made on the new board with the same scoring function. That is what makes "cover only
 * what is needed", "stop blocking once the enemy is dead" and "never leave Energy
 * unspent while a useful card is playable" fall out of one rule instead of three.
 */
function chooseCombat(state, acts, memory, ctx) {
  const plays = acts.filter((a) => a.kind === 'play');
  const end = acts.find((a) => a.kind === 'end_turn');
  if (plays.length === 0) return { id: end?.id ?? acts[0].id, memory };

  const incomingOverride = typeof ctx?.incoming === 'number' ? ctx.incoming : null;
  const base = combatContext(state, ctx?.dump ?? null, incomingOverride);
  const attacksInHand = base.attacksInHand;

  const scored = plays
    .map((a) => {
      const def = CONTENT.cards.get(a.cardId);
      const card = state.combat.hand[Number(a.id.slice(1)) - 1];
      const isAttack = def.type === 'attack' || def.effects.some((e) => e.verb === 'damage');
      const s = scoreSmartCard(def, {
        ...base,
        perPlay: card?.perPlay ?? 0,
        // Follow-up credit counts the OTHER attack cards still in hand.
        followUpAttacks: isAttack ? Math.max(0, attacksInHand - 1) : attacksInHand,
      });
      return { a, s };
    })
    .sort((x, y) => y.s.key - x.s.key || y.s.perEnergy - x.s.perEnergy);

  const top = scored[0];
  // A card whose effect accomplishes nothing scores at or below zero, so the energy
  // is kept rather than spent on an empty play (requirement 4).
  if (top.s.score <= 0) return { id: end?.id ?? acts[0].id, memory };
  // The one position where a bad card is better than the best card: if the incoming
  // attack kills us and no sequence of blocks can change that, race instead of
  // stacking Block that cannot save us.
  if (base.incoming >= base.playerHp) {
    const cover = base.playerBlock + scored.reduce((m, x) => Math.max(m, x.s.detail.blockGiven), 0);
    if (cover < base.incoming) {
      const bestDamage = scored.reduce((best, x) => (x.s.detail.rawDamage > best.s.detail.rawDamage ? x : best), scored[0]);
      if (bestDamage.s.detail.rawDamage > 0) return { id: bestDamage.a.id, memory };
    }
  }
  return { id: top.a.id, memory };
}

/**
 * Static worth of an offered card, used only to rank a reward offer against
 * alternatives. Reuses the same value model as combat scoring.
 */
function rewardWorth(def) {
  if (!def) return 0;
  const fake = {
    player: { hp: 60, maxHp: 60, block: 0, statuses: {} },
    combat: { enemies: [{ hp: 40, dead: false }] },
  };
  return scoreCard(def, { state: fake, card: { perPlay: 0 }, liveEnemies: fake.combat.enemies, incoming: 0, lethalAnywhere: false }).score;
}

export { CONTENT as content };
