// Relics are data, and Iron Skin costs every hero their relic (review of #8).
//
// Pins: (1) every hero's starting relic has an entry in the relic table, and the kernel
// reads relic effects from that table, not from relic names; (2) Iron Skin switches off
// the Bellows Keeper's Cyan Lantern (no first-turn Energy), so the boon has a real cost
// for him too; (3) the Iron Skin offer names the chosen hero's own relic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, REPO } from '../helpers/harness.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentForProfile } from '../../src/kernel/index.js';

const K = await loadKernel();
const { newRun, actions, step, snapshot } = K;

function ironSkinRun(character) {
  for (let seed = 0; seed < 80; seed += 1) {
    const r = newRun({ seed, character, kindling: true });
    const a = actions(r).find((x) => x.boon === 'ironskin');
    if (a) return { r, id: a.id };
  }
  throw new Error('no seed offers Iron Skin');
}

test('every starting relic is in the relic table', async () => {
  const { RELICS } = await import('../../src/kernel/rules/relics.js');
  for (const [id, ch] of contentForProfile(null).characters) {
    assert.ok(RELICS[ch.startingRelic], `${id}: relic ${ch.startingRelic} has no table entry`);
  }
});

test('relic effects are not keyed on relic names in the act rules', () => {
  const src = readFileSync(resolve(REPO, 'src/kernel/rules/act.js'), 'utf8');
  assert.doesNotMatch(src, /state\.relic\s*[!=]==?\s*'/);
});

test('Iron Skin switches off the Cyan Lantern for the Bellows Keeper', () => {
  const { r, id } = ironSkinRun('bellows');
  const t = step(r, id).state;
  assert.equal(t.relicOff, true);
  const fight = step(t, 'n1').state;
  assert.equal(fight.phase, 'combat');
  assert.equal(fight.player.energy, fight.energyPerTurn, 'no Lantern Energy on turn 1 after Iron Skin');
  // control: without Iron Skin the Lantern still fires
  const other = actions(r).find((x) => x.boon !== 'ironskin');
  const f2 = step(step(r, other.id).state, 'n1').state;
  assert.equal(f2.player.energy, f2.energyPerTurn + 1);
});

test('the Iron Skin offer names the hero\'s own relic', () => {
  const keeper = ironSkinRun('bellows');
  const kb = snapshot(keeper.r).kindling.boons.find((b) => b.id === 'ironskin');
  assert.match(kb.text, /Cyan Lantern/);
  assert.doesNotMatch(kb.text, /Kindled Heart/);
  const ash = ironSkinRun('ironclad');
  const ab = snapshot(ash.r).kindling.boons.find((b) => b.id === 'ironskin');
  assert.match(ab.text, /Kindled Heart/);
});
