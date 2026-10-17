// One source of truth for biomes (review of #14).
//
// Pins: (1) the kernel's BIOMES table (rules/encounters.js, re-exported by the public
// entry) carries each biome's name AND its encounter pools, and newRun validates against
// it; (2) the snapshot names the run's biome, so the Act I card shows the Mines on a
// Mines run; (3) no surface or kernel file keeps its own biome list or name; (4) Iron
// Skin costs the Keeper his Cyan Lantern in the Mines too (inherits the #8 fix).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadKernel, REPO } from '../helpers/harness.mjs';

const K = await loadKernel();
const { newRun, actions, step, snapshot } = K;
const src = (rel) => readFileSync(resolve(REPO, rel), 'utf8');

test('the public entry exports the biome table with names and encounter pools', () => {
  assert.ok(K.BIOMES, 'BIOMES is exported from src/kernel/index.js');
  assert.equal(K.DEFAULT_BIOME, 'foundry');
  for (const [id, b] of Object.entries(K.BIOMES)) {
    assert.equal(typeof b.name, 'string', id);
    for (const type of ['combat_weak', 'combat_strong', 'elite', 'boss']) assert.ok(b.byType[type]?.length > 0, `${id} ${type}`);
  }
  assert.throws(() => newRun({ seed: 1, biome: 'moon' }), (e) => e.code === 3);
  assert.throws(() => newRun({ seed: 1, biome: 'toString' }), (e) => e.code === 3);
});

test('the snapshot names the run\'s biome and lists the choices', () => {
  assert.equal(snapshot(newRun({ seed: 1 })).biomeName, 'The Foundry');
  assert.equal(snapshot(newRun({ seed: 1, biome: 'mines' })).biomeName, 'The Cinder Mines');
  assert.deepEqual(snapshot(newRun({ seed: 1 })).biomes.map((b) => b.id), Object.keys(K.BIOMES));
});

test('no other file keeps its own biome list or biome name', () => {
  const app = src('web/app.js');
  assert.doesNotMatch(app, /'The Foundry'|'The Cinder Mines'/, 'web/app.js: Act I card and picker read the kernel table');
  assert.doesNotMatch(app, /===\s*'mines'/, 'web/app.js: ?biome= is checked against the kernel table');
  const index = src('src/kernel/index.js');
  assert.doesNotMatch(index, /MINES_BY_TYPE|'mines'/, 'src/kernel/index.js: pools come from BIOMES');
  assert.doesNotMatch(src('src/surface/cli.js'), /'foundry'/, 'src/surface/cli.js: default comes from DEFAULT_BIOME');
});

test('Iron Skin switches off the Cyan Lantern in the Mines too', () => {
  for (let seed = 0; seed < 80; seed += 1) {
    const r = newRun({ seed, character: 'bellows', biome: 'mines', kindling: true });
    const a = actions(r).find((x) => x.boon === 'ironskin');
    if (!a) continue;
    const fight = step(step(r, a.id).state, 'n1').state;
    assert.equal(fight.phase, 'combat');
    assert.equal(fight.player.energy, fight.energyPerTurn);
    assert.match(snapshot(r).kindling.boons.find((b) => b.id === 'ironskin').text, /Cyan Lantern/);
    return;
  }
  assert.fail('no seed offers Iron Skin');
});
