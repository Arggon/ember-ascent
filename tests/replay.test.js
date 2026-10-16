// tests/replay.test.js — save/load round-trip equality and action-log replay identity.
//
// The save file IS the run (R1): if save -> load -> hash can differ, the run is not
// reconstructible and the whole R3 contract is a promise rather than a property.
import test from 'node:test';
import assert from 'node:assert/strict';
import { header, loadKernel, loadSession, play } from './helpers/harness.mjs';

const { hash } = await loadKernel();
const { begin, submit, saveText, saveObject, loadObject, renderLog, parseLog, assertReplay, replay, runHash } =
  await loadSession();

/** A scripted action list valid from seed 0, including a deliberate rejection. */
const SCRIPT = [{ act: 'n1' }, { act: 'p1' }, { act: 'e1' }, { act: 'p1' }, { reject: 'zz9' }, { act: 'p1' }];

/** Drive a session live, exactly as the CLI does. */
function drive(h, entries) {
  let session = begin({ seed: h.seed, character: h.character, difficulty: h.difficulty });
  for (const e of entries) session = submit(session, 'reject' in e ? e.reject : e.act).session;
  return session;
}

test('replay is deterministic: the same log yields identical per-step hashes', async () => {
  const h = header();
  const a = await play(h, SCRIPT);
  const b = await play(h, SCRIPT);
  assert.deepEqual(
    a.steps.map((s) => s.hash),
    b.steps.map((s) => s.hash),
    'each step hash is reproducible',
  );
  assert.equal(hash(a.state), hash(b.state), 'final state hash matches');
});

test('live play and replay of its own log agree on the final hash', async () => {
  const h = header();
  const live = drive(h, SCRIPT);
  const replayed = await play(h, SCRIPT);
  assert.equal(runHash(replayed.session), runHash(live), 'replay reproduces the live run');
});

test('save -> load -> save round-trips to byte-identical canonical text', () => {
  const h = header();
  const live = drive(h, SCRIPT);
  const text = saveText(live);

  const parsed = JSON.parse(text);
  const res = loadObject(parsed);
  assert.equal(res.ok, true, `a legitimate save must load: ${JSON.stringify(res.problems ?? [])}`);

  assert.equal(runHash(res.session), runHash(live), 'restored session has the same run identity');
  assert.equal(saveText(res.session), text, 're-serializing a loaded run is byte-identical');
  assert.deepEqual(
    res.session.submitted.map((e) => ('act' in e ? e.act : `!${e.reject}`)),
    live.submitted.map((e) => ('act' in e ? e.act : `!${e.reject}`)),
    'the submitted history survives the round-trip, rejections included',
  );
});

test('the rendered action log replays cleanly under --assert', () => {
  const h = header();
  const live = drive(h, SCRIPT);
  const log = renderLog(live);
  const parsed = parseLog(log);
  assert.equal(parsed.ok, true, `log must parse: ${JSON.stringify(parsed.problems ?? [])}`);
  const result = assertReplay(parsed);
  assert.equal(result.ok, true, `no hash mismatches: ${JSON.stringify(result.mismatches)}`);
  assert.equal(result.checked, SCRIPT.length, 'every logged step carries a checked hash');
  assert.equal(result.finalHash, parsed.footer.finalHash, 'footer hash matches the replay');
});

test('assertReplay detects a tampered log instead of passing it', () => {
  const live = drive(header(), SCRIPT);
  const parsed = parseLog(renderLog(live));
  parsed.entries[1] = { ...parsed.entries[1], h: 'sha256:' + '0'.repeat(64) };
  const result = assertReplay(parsed);
  assert.equal(result.ok, false, 'a corrupted step hash must not verify');
  assert.ok(result.mismatches.length >= 1, 'the mismatch is reported with its step');
});

test('loadObject refuses a save whose action entries are the wrong shape', () => {
  const good = saveObject(drive(header(), SCRIPT));
  const bad = { ...good, actions: [{ nonsense: true }] };
  const res = loadObject(bad);
  assert.equal(res.ok, false, 'a malformed action entry is refused, not repaired');
  assert.ok(res.problems.some((p) => p.includes('entry must be')), `names the bad entry: ${res.problems.join('; ')}`);
});

test('replay of an empty log is the freshly-begun run', () => {
  const h = header();
  const empty = replay(h, []);
  const fresh = begin({ seed: h.seed, character: h.character, difficulty: h.difficulty });
  assert.equal(runHash(empty.session), runHash(fresh), 'zero actions => initial state');
});
