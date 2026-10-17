// Dev-only probe (NOT shipped): measure what each policy DOES inside the boss fight,
// so a diagnosis is measured rather than guessed. Reads only public kernel output.
//
// Run: node scripts/dev/probe-boss-race.mjs <policy> <seedStart> <runs>
import { begin, submit, legal, view } from '../../src/surface/session.js';
import { makePolicy } from '../../src/surface/policies.js';

const policyName = process.argv[2] ?? 'smart';
const seedStart = Number(process.argv[3] ?? 1);
const runs = Number(process.argv[4] ?? 200);
const policy = makePolicy(policyName);

const agg = {
  runs: 0, reached: 0, wins: 0, bossTurns: 0, dmgDealt: 0, blockGained: 0,
  selfHpLost: 0, plays: 0, turnsWithEnergyLeft: 0, blockPlays: 0, attackPlays: 0, otherPlays: 0,
};

const sumHp = (st) => st.phase === 'combat'
  ? st.combat.enemies.filter((e) => !e.dead).reduce((s, e) => s + e.hp, 0)
  : 0;

for (let seed = seedStart; seed < seedStart + runs; seed += 1) {
  let session = begin({ seed });
  const memory = {};
  let steps = 0;
  let inBoss = false;
  let bossTurns = 0;
  let dmg = 0;
  let block = 0;
  let hpLost = 0;
  let wins = false;

  while (session.state.phase !== 'ended' && steps < 5000) {
    const state = session.state;
    const dump = view(session);
    if (state.phase === 'combat' && state.combat.nodeType === 'boss' && !inBoss) {
      inBoss = true;
      agg.reached += 1;
    }
    const acts = legal(session);
    const choice = policy.choose({ session, state, legal: acts, stepIndex: state.stepIndex, memory, dump });
    if (choice.id === null) break;

    const beforeEnemyHp = sumHp(state);
    const beforeBlock = state.phase === 'combat' ? state.player.block : 0;
    const act = acts.find((a) => a.id === choice.id);
    const res = submit(session, choice.id);
    session = res.session;
    const after = session.state;

    if (inBoss && state.phase === 'combat' && act?.kind === 'play') {
      agg.plays += 1;
      dmg += Math.max(0, beforeEnemyHp - sumHp(after));
      block += Math.max(0, after.player.block - beforeBlock);
      const cardId = act.cardId ?? '';
      if (/impervious|defend|true_grit|ghostly|armaments|flame_barrier|entrench|shrug/.test(cardId)) agg.blockPlays += 1;
      else if (/strike|bash|bludgeon|uppercut|cleave|pummel|twin|flex|shockwave|reaper|hemokinesis|rampage|limit_break|whirlwind|heavy/.test(cardId)) agg.attackPlays += 1;
      else agg.otherPlays += 1;
    }
    if (inBoss && act?.kind === 'end_turn' && after.player.energy > 0) agg.turnsWithEnergyLeft += 1;
    if (inBoss && state.phase === 'combat') {
      bossTurns += 1;
      if (after.player.hp < state.player.hp) hpLost += state.player.hp - after.player.hp;
    }
    if (after.phase === 'ended' && (after.outcome === 'win' || after.result === 'win')) wins = true;
    steps += 1;
  }

  agg.runs += 1;
  if (wins) agg.wins += 1;
  agg.bossTurns += bossTurns;
  agg.dmgDealt += dmg;
  agg.blockGained += block;
  agg.selfHpLost += hpLost;
}

const p = (a, b) => (b > 0 ? (a / b).toFixed(2) : 'n/a');
console.log(`probe-boss-race | policy ${policyName} | seeds ${seedStart}..${seedStart + runs - 1}`);
console.log(`runs ${agg.runs} | reached boss ${agg.reached} | wins ${agg.wins}`);
console.log(`boss-fight plays ${agg.plays} | block-card plays ${agg.blockPlays} | attack-card plays ${agg.attackPlays} | other ${agg.otherPlays}`);
console.log(`damage dealt to boss total ${agg.dmgDealt} | block gained total ${agg.blockGained}`);
console.log(`per boss-fight: turns ${p(agg.bossTurns, agg.reached)} | dmg/play ${p(agg.dmgDealt, agg.plays)} | block/play ${p(agg.blockGained, agg.plays)} | hpLost/turn ${p(agg.selfHpLost, agg.bossTurns)}`);
console.log(`turns ended with energy left over (boss only): ${agg.turnsWithEnergyLeft}`);
