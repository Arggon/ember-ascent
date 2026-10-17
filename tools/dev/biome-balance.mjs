// Biome balance probe: win rate / floor reached for greedy+smart over N seeds, foundry vs mines.
// Usage: node tools/dev/biome-balance.mjs [N=200]
import { playRun } from '../../src/surface/sim.js';
const N = +process.argv[2] || 200; const out = {};
for (const policy of ['greedy', 'smart']) for (const biome of ['foundry', 'mines']) {
  let wins = 0, floors = 0, boss = 0; const hist = {};
  for (let s = 1; s <= N; s++) {
    const r = await playRun({ seed: s, policy, biome: biome === 'foundry' ? undefined : biome });
    const won = r.outcome === 'win' || r.outcome === 'victory';
    wins += won ? 1 : 0; const f = r.floor ?? r.floorReached ?? 0; floors += f; hist[f] = (hist[f] || 0) + 1;
    if (r.bossArrival || f >= 8) boss++;
  }
  out[`${policy}/${biome}`] = { winRate: +(wins / N * 100).toFixed(1), avgFloor: +(floors / N).toFixed(2), reachedBoss: +(boss / N * 100).toFixed(1), hist };
}
console.log(JSON.stringify(out, null, 1));
