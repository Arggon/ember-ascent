// Dev-only probe: quantify the reward-table bias for representative cards.
import { loadContent } from '../../src/kernel/index.js';
import { newRun } from '../../src/kernel/index.js';
import { smartRewardScore, deckNeeds, effectProfile } from '../../src/surface/policies.js';

const c = loadContent();
const state = newRun({ seed: 1 });
const needs = deckNeeds(state.deck);
const comp = needs.composition;
console.log(`starter deck: ${comp.cards} cards, blockPoints ${comp.block} (${(comp.block / comp.cards).toFixed(1)}/card), damagePoints ${comp.damage} (${(comp.damage / comp.cards).toFixed(1)}/card)`);
console.log(`needs: blockNeed ${needs.blockNeed.toFixed(3)}  damageNeed ${needs.damageNeed.toFixed(3)}  <-- block multiplier is permanently larger`);
console.log('');
console.log('card             cost  type    block  dmg   score    key    perEnergy');
for (const id of ['strike', 'defend', 'bash', 'impervious', 'ghostly_armor', 'shrug_it_off', 'bludgeon', 'uppercut', 'twin_strike', 'cleave', 'pommel_strike', 'inflame', 'flex', 'shockwave']) {
  const def = c.cards.get(id);
  if (!def) continue;
  const s = smartRewardScore(def, state);
  const p = effectProfile(def, { liveCount: 1 });
  console.log(`${id.padEnd(16)} ${String(def.cost).padEnd(5)} ${String(def.type).padEnd(7)} ${String(p.block).padEnd(6)} ${String(p.damage + p.aoePerTarget).padEnd(5)} ${s.score.toFixed(2).padEnd(8)} ${s.key.toFixed(2).padEnd(7)} ${s.perEnergy.toFixed(2)}`);
}
