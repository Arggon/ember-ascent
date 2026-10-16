// B3 Ember quests: three seeded side goals per run, folded from step events.
//
// Pins: default runs untouched; a quests run rolls 3 distinct quests (counted draws);
// progress follows events and pays out exactly once; all three flags compose; the log
// header carries the flag and replay matches a pinned golden hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel } from '../helpers/harness.mjs';
import { begin, submit, legal, renderLog, parseLog, assertReplay, runHash } from '../../src/surface/session.js';
import { QUESTS, QUEST_IDS, advanceQuests } from '../../src/kernel/rules/quests.js';

const K = await loadKernel();
const { newRun, hash } = K;

/** Greedy driver: play cards, take the first reward/node/heal; stop after `n` steps. */
function drive(opts, n) {
  let s = begin(opts);
  for (let g = 0; g < n && s.state.phase !== 'ended'; g += 1) {
    const L = legal(s).map((a) => a.id);
    const pick = L.find((i) => /^k\d$/.test(i)) || L.find((i) => /^p\d+(_1)?$/.test(i)) || L.find((i) => i === 'c') || L.find((i) => /^n/.test(i)) || L.find((i) => i === 's1') || L[0];
    s = submit(s, pick).session;
  }
  return s;
}

test('default run has no quests and an unchanged hash', () => {
  const a = newRun({ seed: 3 });
  assert.equal('quests' in a, false);
  assert.equal(hash(a), hash(newRun({ seed: 3, quests: false })));
});

test('a quests run rolls three distinct known quests and counts its draws', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = newRun({ seed, quests: true });
    assert.equal(r.quests.length, 3);
    assert.equal(new Set(r.quests.map((q) => q.id)).size, 3);
    for (const q of r.quests) assert.ok(QUEST_IDS.includes(q.id));
    assert.equal(r.rngDraws, newRun({ seed }).rngDraws + 3);
  }
});

test('progress follows events and a quest pays out exactly once', () => {
  const base = { player: { hp: 50, maxHp: 80 }, quests: [{ id: 'wall', progress: 55, done: false }, { id: 'smith', progress: 0, done: false }] };
  const one = advanceQuests(base, { events: [{ t: 'block', who: 'player', amount: 8 }], played: true, nodeType: 'monster' });
  assert.deepEqual(one.state.quests[0], { id: 'wall', progress: 60, done: true });
  assert.equal(one.state.quests[1].progress, 1);
  assert.equal(one.state.player.maxHp, 80 + QUESTS.wall.reward.maxHp);
  assert.equal(one.state.player.hp, 50 + QUESTS.wall.reward.maxHp);
  assert.deepEqual(one.events.map((e) => e.quest), ['wall']);
  const two = advanceQuests(one.state, { events: [{ t: 'block', who: 'player', amount: 8 }], played: false, nodeType: 'monster' });
  assert.equal(two.events.length, 0);
  assert.equal(two.state.player.maxHp, one.state.player.maxHp);
});

test('a real quests run advances and composes with kindling and tempers', () => {
  const s = drive({ seed: 1, quests: true, kindling: true, tempers: true }, 60);
  assert.ok(s.state.quests.some((q) => q.progress > 0), JSON.stringify(s.state.quests));
  assert.ok(s.state.kindling && s.state.tempers);
});

test('log header carries the flag and replay matches the golden hash', () => {
  const s = drive({ seed: 1, quests: true }, 120);
  const parsed = parseLog(renderLog(s));
  assert.equal(parsed.header.quests, true);
  assert.equal(s.events.filter((e) => e.t === 'quest_done').length, 2, 'the golden run finishes two quests');
  assert.equal(assertReplay(parsed).ok, true);
  assert.equal(runHash(s), GOLDEN);
});

const GOLDEN = 'sha256:bd85d0a3673e021a0756905c2c4d112306974009eabc5509fe10640d72eaac33';
