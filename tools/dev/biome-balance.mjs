// Biome balance probe: win rate / floor reached for greedy+smart over N seeds, every biome in the kernel BIOMES table.
// Usage: node tools/dev/biome-balance.mjs [N=200]
import { playRun } from '../../src/surface/sim.js';
import { BIOMES, DEFAULT_BIOME } from '../../src/kernel/index.js';
const N = +process.argv[2] || 200; const out = {};
for (const policy of ['greedy', 'smart']) for (const biome of Object.keys(BIOMES)) {
  let wins = 0, floors = 0, boss = 0; const hist = {};
  for (let s = 1; s <= N; s++) {
    const r = await playRun({ seed: s, policy, biome: biome === DEFAULT_BIOME ? undefined : biome });
    // The run record's schema (src/kernel/record.js): outcome is 'win'|'loss'|'unfinished', floor is required.
    wins += r.outcome === 'win' ? 1 : 0; const f = r.floor; floors += f; hist[f] = (hist[f] || 0) + 1;
    if (r.bossArrival) boss++;
  }
  out[`${policy}/${biome}`] = { winRate: +(wins / N * 100).toFixed(1), avgFloor: +(floors / N).toFixed(2), reachedBoss: +(boss / N * 100).toFixed(1), hist };
}
console.log(JSON.stringify(out, null, 1));
