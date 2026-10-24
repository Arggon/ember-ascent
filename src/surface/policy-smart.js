// The `smart` policy's VALUE MODEL — what a card is worth, with no decision in it.
//
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
// STRUCTURE, because the fix has to stay checkable (one concern per export):
//   effectProfile()  — card data -> a neutral description of what it does (no board)
//                      [policy-read.js]
//   scoreSmartCard() — that description + THIS board  -> a combat score   [this file]
//   smartRewardScore() — that description + THIS deck -> a reward score  [this file]
// policies.js then runs a small loop over the legal actions, and nothing else decides.
//
// DETERMINISM: pure functions of the observation — legal actions, state, and the
// rendered dump the harness already produced.
import { CONTENT, effectProfile, enemyThreats } from './policy-read.js';

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
export const SKIP_SCORE = 18;
/** ...and a thinner deck always takes the best of what it is offered. ARBITRARY. */
export const SKIP_DECK_SIZE = 18;

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
    playerStrength: ctx.playerStrength ?? 0,
    playerDexterity: ctx.playerDexterity ?? 0,
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
    const p = effectProfile(def);
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
  const p = effectProfile(def);
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
