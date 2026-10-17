// B4 second hero: the Bellows Keeper, chosen at run start with `character: 'bellows'`.
//
// Pins: Ashwright runs untouched; the Keeper starts with his own HP, deck and relic; the
// Cyan Lantern adds 1 Energy on each fight's first turn and never heals; his starters stay
// out of the shared draft pool; the header carries the hero and replay matches a golden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel } from '../helpers/harness.mjs';
import { begin, submit, legal, renderLog, parseLog, assertReplay, runHash } from '../../src/surface/session.js';
import { contentForProfile } from '../../src/kernel/index.js';

const K = await loadKernel();
const { newRun, step, hash } = K;

function drive(opts, n) {
  let s = begin(opts);
  for (let g = 0; g < n && s.state.phase !== 'ended'; g += 1) {
    const L = legal(s).map((a) => a.id);
    const pick = L.find((i) => /^p\d+(_1)?$/.test(i)) || L.find((i) => i === 'c') || L.find((i) => /^n/.test(i)) || L.find((i) => i === 's1') || L[0];
    s = submit(s, pick).session;
  }
  return s;
}

test('an Ashwright run carries no relic field and keeps its hash', () => {
  const a = newRun({ seed: 4 });
  assert.equal('relic' in a, false);
  assert.equal(hash(a), hash(newRun({ seed: 4, character: 'ironclad' })));
});

test('the Bellows Keeper starts with 54 HP, his deck and the Cyan Lantern', () => {
  const r = newRun({ seed: 4, character: 'bellows' });
  assert.equal(r.player.maxHp, 54);
  assert.equal(r.relic, 'cyan_lantern');
  const ids = r.deck.map((c) => c.cardId);
  assert.equal(ids.length, 10);
  assert.ok(ids.includes('gust') && ids.includes('fan_flames'));
  assert.equal(ids.includes('bash'), false);
});

test('Cyan Lantern: +1 Energy on turn 1, base Energy on turn 2, no post-fight heal', () => {
  let s = step(newRun({ seed: 4, character: 'bellows' }), 'n1').state;
  assert.equal(s.player.energy, s.energyPerTurn + 1);
  s = step(s, 'e1').state;
  assert.equal(s.phase, 'combat');
  assert.equal(s.combat.turn, 2);
  assert.equal(s.player.energy, s.energyPerTurn);
  const won = drive({ seed: 4, character: 'bellows' }, 200);
  const heals = won.events.filter((e) => e.t === 'heal' && e.source === 'burning_blood');
  assert.equal(heals.length, 0);
});

test('Fan the Flames and Bellows Gust resolve, and stay out of the draft pool', () => {
  const r = newRun({ seed: 4, character: 'bellows' });
  assert.equal(r.draftPool.includes('gust') || r.draftPool.includes('fan_flames'), false);
  const fresh = contentForProfile(null);
  assert.ok(fresh.cards.has('gust') && fresh.cards.has('fan_flames'), 'the fresh content still resolves his deck');
  // play a Fan the Flames from an opening hand (search a few seeds)
  for (let seed = 1; seed < 30; seed += 1) {
    const s = step(newRun({ seed, character: 'bellows' }), 'n1').state;
    const slot = s.combat.hand.findIndex((c) => c.cardId === 'fan_flames');
    if (slot < 0) continue;
    const after = step(s, `p${slot + 1}`).state;
    assert.equal(after.player.energy, s.player.energy + 1);
    assert.ok(after.combat.exhaust.some((c) => c.cardId === 'fan_flames'));
    return;
  }
  assert.fail('no opening hand with Fan the Flames in 30 seeds');
});

test('log header carries the hero and replay matches the golden hash', () => {
  const s = drive({ seed: 1, character: 'bellows', kindling: true, tempers: true, quests: true }, 120);
  const parsed = parseLog(renderLog(s));
  assert.equal(parsed.header.character, 'bellows');
  assert.equal(assertReplay(parsed).ok, true);
  assert.equal(runHash(s), GOLDEN);
});

const GOLDEN = 'sha256:9abc6ca838874b075ab9d8059ecaf53799f6a286061756859b22e2a8f257bf62';
