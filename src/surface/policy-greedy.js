// The `greedy` policy's value model — one score per card, kept EXACTLY as it was.
//
// This is the heuristic the historical balance data was generated with, so its
// arithmetic is pinned: `dlb replay` logs and every recorded run that `greedy` drove
// were produced by these numbers. Refactors may move this code but may not change
// what it scores — a "smarter greedy" is a different policy, not an edit here.
//
// The self-damage costs are read from CUSTOM_READING (policy-read.js) — the one table
// of what a `custom` handler does — so greedy and smart cannot drift apart on what a
// card costs to play. Everything else here is greedy's own judgement.
import { CUSTOM_READING } from './policy-read.js';

/** Cost/benefit of the fixed self-damage cards, which no data field carries. */
const SELF_DAMAGE = Object.fromEntries(
  Object.entries(CUSTOM_READING)
    .filter(([, reading]) => typeof reading.selfDamage === 'number')
    .map(([handler, reading]) => [handler, reading.selfDamage]),
);

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
        if (h === 'blood_hammer') damage += 15;
        else if (h === 'ash_harvest') aoe += 4 * Math.max(1, live.length);
        else if (h === 'overtemper') strength += 2 * (p.statuses?.strength ?? 0);
        else if (h === 'climbing_heat') damage += 8 + 5 * (ctx.card?.perPlay ?? 0);
        else if (h === 'blood_tithe') {
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
 * Static worth of an offered card, used only to rank a reward offer against
 * alternatives. Reuses the same value model as combat scoring.
 */
export function rewardWorth(def) {
  if (!def) return 0;
  const fake = {
    player: { hp: 60, maxHp: 60, block: 0, statuses: {} },
    combat: { enemies: [{ hp: 40, dead: false }] },
  };
  return scoreCard(def, { state: fake, card: { perPlay: 0 }, liveEnemies: fake.combat.enemies, incoming: 0, lethalAnywhere: false }).score;
}
