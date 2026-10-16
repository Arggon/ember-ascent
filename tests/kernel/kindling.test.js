// B1 Kindling: opt-in act-start boons with a cost.
//
// Pins: (1) a default run is untouched (no phase, no fields, same hash as before);
// (2) an opted-in run opens on a mandatory 3-boon offer drawn from the seed, with no skip;
// (3) each boon applies its upside AND its cost; (4) the log header carries the flag so
// replay reproduces the run hash-for-hash; (5) a pinned golden hash for one scripted run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel } from '../helpers/harness.mjs';
import { begin, submit, renderLog, parseLog, assertReplay, runHash } from '../../src/surface/session.js';

const K = await loadKernel();
const { newRun, actions, step, hash } = K;

test('default run is unchanged by the Kindling option', () => {
  const a = newRun({ seed: 7 });
  assert.equal(a.phase, 'map');
  assert.equal('kindling' in a, false);
  assert.equal('relicOff' in a, false);
  assert.equal(hash(a), hash(newRun({ seed: 7, kindling: false })));
});

test('opted-in run offers 3 distinct seeded boons and no skip', () => {
  const s = newRun({ seed: 5, kindling: true });
  assert.equal(s.phase, 'kindling');
  const acts = actions(s);
  assert.deepEqual(acts.map((a) => a.id), ['k1', 'k2', 'k3']);
  assert.equal(new Set(acts.map((a) => a.boon)).size, 3);
  assert.deepEqual(newRun({ seed: 5, kindling: true }).kindling.offers, s.kindling.offers);
  assert.equal(step(s, 'n1').error.error, 'illegal_action');
});

test('every boon applies its upside and its cost', () => {
  const seen = new Set();
  for (let seed = 0; seed < 60 && seen.size < 5; seed += 1) {
    const s = newRun({ seed, kindling: true });
    for (const a of actions(s)) {
      if (seen.has(a.boon)) continue;
      seen.add(a.boon);
      const t = step(s, a.id).state;
      assert.equal(t.phase, 'map');
      const count = (st, id) => st.deck.filter((c) => c.cardId === id).length;
      switch (a.boon) {
        case 'bellows': assert.equal(t.energyPerTurn, 4); assert.equal(t.player.maxHp, 48); break;
        case 'ironskin': assert.equal(t.player.maxHp, 75); assert.equal(t.player.hp, 75); assert.equal(t.relicOff, true); break;
        case 'sparkfall': assert.equal(count(t, 'anger'), 2); assert.equal(t.player.hp, 54); break;
        case 'purge': assert.equal(count(t, 'strike'), count(s, 'strike') - 2); assert.equal(t.player.maxHp, 54); break;
        case 'stoke': assert.equal(count(t, 'inflame'), 1); assert.equal(t.player.hp, 45); break;
        default: assert.fail(`unknown boon ${a.boon}`);
      }
    }
  }
  assert.equal(seen.size, 5);
});

test('Bellows energy reaches combat; Iron Skin switches off the relic heal', () => {
  const pickBoon = (st, boon) => actions(st).find((a) => a.boon === boon)?.id;
  for (let seed = 0; seed < 60; seed += 1) {
    const r = newRun({ seed, kindling: true });
    const id = pickBoon(r, 'bellows');
    if (!id) continue;
    const fight = step(step(r, id).state, 'n1').state;
    assert.equal(fight.phase, 'combat');
    assert.equal(fight.player.energy, 4);
    return;
  }
  assert.fail('no seed offered bellows');
});

test('log header carries the flag and replay matches hash-for-hash (golden)', () => {
  let session = begin({ seed: 5, kindling: true });
  for (const id of ['k2', 'n1', 'p1', 'p1', 'p1', 'e1']) session = submit(session, id).session;
  const parsed = parseLog(renderLog(session));
  assert.equal(parsed.header.kindling, true);
  const out = assertReplay(parsed);
  assert.equal(out.ok, true);
  // Golden: pinned so any change to the offer draw or boon effects is a visible diff.
  assert.equal(runHash(session), GOLDEN);
});

const GOLDEN = 'sha256:331c99ab656d374d0efaf65850171602655214a6829eb185cb2948b0998bd912';
