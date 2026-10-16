// B5 The Cinder Mines: an opt-in alternate biome (`newRun({ biome: 'mines' })`).
//
// Pins: default and explicit-foundry runs are byte-identical (no `biome` field, same hash);
// a mines run only spawns mines foes; the boss is the Cinder Foreman; an unknown biome is a
// code-3 error; the log header carries the biome and replay reproduces a pinned golden hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel } from '../helpers/harness.mjs';
import { begin, submit, legal, renderLog, parseLog, assertReplay, runHash, logHeader } from '../../src/surface/session.js';
import { ENEMIES, ENCOUNTERS, BIOMES } from '../../src/kernel/rules/encounters.js';

const K = await loadKernel();
const { newRun, hash, snapshot } = K;
const MINES_FOES = new Set(['slag_crawler', 'ash_wraith', 'ash_wraith_elite', 'cinder_foreman']);

function drive(opts, n) {
  let s = begin(opts);
  for (let g = 0; g < n && s.state.phase !== 'ended'; g += 1) {
    const L = legal(s).map((a) => a.id);
    const pick = L.find((i) => /^p\d+(_1)?$/.test(i)) || L.find((i) => i === 'c') || L.find((i) => /^n/.test(i)) || L.find((i) => i === 's1') || L[0];
    s = submit(s, pick).session;
  }
  return s;
}
const foesOf = (state) => Object.values(state.map.encounterTable).flatMap((e) => e.spawn.map((x) => x.id));

test('default and explicit foundry runs are unchanged (no biome field, same hash)', () => {
  for (const seed of [1, 7, 42]) {
    const a = newRun({ seed });
    assert.equal('biome' in a, false);
    assert.equal(hash(a), hash(newRun({ seed, biome: 'foundry' })));
  }
});

test('a mines run records the biome and spawns only mines foes', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = newRun({ seed, biome: 'mines' });
    assert.equal(r.biome, 'mines');
    const foes = foesOf(r);
    assert.ok(foes.length > 0);
    for (const f of foes) assert.ok(MINES_FOES.has(f), `unexpected foe ${f}`);
    assert.ok(foes.includes('cinder_foreman'), 'the boss is the Cinder Foreman');
    assert.notEqual(hash(r), hash(newRun({ seed })));
  }
});

test('every mines encounter references a defined enemy with a script or moves', () => {
  for (const enc of Object.values(ENCOUNTERS).filter((e) => e.id.startsWith('mines_'))) {
    for (const id of enc.enemies) assert.ok(ENEMIES[id]?.moves?.length, `${enc.id}: ${id}`);
  }
  assert.equal(BIOMES.mines.name, 'The Cinder Mines');
});

test('unknown biome is rejected with code 3', () => {
  assert.throws(() => newRun({ seed: 1, biome: 'moon' }), (e) => e.code === 3);
});

test('snapshot exposes the biome', () => {
  assert.equal(snapshot(newRun({ seed: 1 })).biome, 'foundry');
  assert.equal(snapshot(newRun({ seed: 1, biome: 'mines' })).biome, 'mines');
});

test('a mines run plays, the header carries the biome, and replay matches the golden hash', () => {
  const s = drive({ seed: 1, biome: 'mines' }, 160);
  assert.equal(logHeader(s).biome, 'mines');
  const parsed = parseLog(renderLog(s));
  assert.equal(parsed.header.biome, 'mines');
  assert.equal(assertReplay(parsed).ok, true);
  const fights = s.events.filter((e) => e.t === 'combat_start');
  assert.ok(fights.length >= 2, 'the golden run fights in the mines');
  for (const f of fights) assert.ok(f.encounter.startsWith('mines_'), f.encounter);
  assert.equal(runHash(s), GOLDEN);
});

const GOLDEN = 'sha256:3a48d89f3ae5017e894c49d6c9356c8ac7bd45b92654bf07bac04bf8c3f51baa';
