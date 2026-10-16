// tests/golden/dual-surface.test.js — the R1 proof, over 35 recorded runs.
//
// Claim under test: the CLI adapter and the DOM-free GUI controller are two
// presentations of ONE engine, so after every single step they must agree on the run
// identity. Each golden log is replayed three ways — against its own recorded hashes,
// through surface/cli, and through surface/gui/controller — and all three must match
// step for step. Divergence is a phase-3 failure here, not a phase-6 rewrite.
//
// A fourth pass runs the whole thing with the renderer module unresolvable, because
// "the GUI works without a renderer" is a requirement, not a fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCli, loadGhost, loadSession, REPO } from '../helpers/harness.mjs';
import { buildRunRecord } from '../../src/kernel/index.js';

const { run } = await loadCli();
const { createController, resolveRenderer } = await loadGhost();
const { begin } = await loadSession();

const LOGS = readFileSync(join(REPO, 'tests', 'golden', 'logs.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

assert.ok(LOGS.length >= 20, `golden file must hold >=20 logs, holds ${LOGS.length}`);

/** One isolated working file for this test process; overwritten per log. */
const WORK = mkdtempSync(join(tmpdir(), 'dlb-dual-'));
const RUN_FILE = join(WORK, 'run.json');

/** Call the CLI in-process, capturing both streams exactly as the process would. */
async function cli(cmd, argv) {
  let out = '';
  let err = '';
  const code = await run(cmd, argv, { write: (s) => (out += s), writeErr: (s) => (err += s) });
  return { code, out, err };
}

/** The run identity the CLI reports for the file it just wrote. */
async function cliHash() {
  const r = await cli('state', ['--run', RUN_FILE, '--json']);
  assert.equal(r.code, 0, `state --json must succeed: ${r.err}`);
  return JSON.parse(r.out).hash;
}

/** One action through the CLI, returning the resulting run identity. */
async function cliStep(id) {
  const r = await cli('play', [id, '--run', RUN_FILE]);
  if (r.code === 2) {
    const e = JSON.parse(r.err);
    assert.equal(e.code, 2, `rejection carries the illegal_action class, got ${r.err}`);
  } else {
    assert.equal(r.code, 0, `play ${id} must not fail with code ${r.code}: ${r.err}`);
  }
  return cliHash();
}

test(`each of ${LOGS.length} golden logs replays to its own recorded hashes`, async () => {
  const { replay } = await loadSession();
  for (const log of LOGS) {
    const out = replay(log.header, log.entries);
    assert.equal(
      out.steps.length,
      log.entries.length,
      `${log.name}: step count must match the log (${out.steps.length} vs ${log.entries.length})`,
    );
    for (let i = 0; i < out.steps.length; i += 1) {
      assert.equal(out.steps[i].hash, log.hashes[i], `${log.name}: step ${i + 1} hash drift`);
    }
    assert.equal(out.session.state.outcome, log.outcome ?? null, `${log.name}: outcome drift`);
  }
});

test('CLI adapter and GUI controller agree after EVERY step, over every golden log', async () => {
  for (const log of LOGS) {
    // Surface A: the CLI, driving the file-based run exactly as an agent would.
    await cli('new', ['--seed', String(log.header.seed), '--run', RUN_FILE]);
    const startCli = await cliHash();

    // Surface B: the DOM-free controller, in memory.
    const ctl = createController({ run: { seed: log.header.seed } });

    // The freshly-created run must already agree before any action is taken.
    assert.equal(ctl.hash(), startCli, 'step-0 hash mismatch between cli and controller');
    let prev = startCli;

    for (const [i, entry] of log.entries.entries()) {
      const id = 'act' in entry ? entry.act : entry.reject;

      const cliAfter = await cliStep(id);
      const ctlAfter = (() => {
        ctl.dispatch(id);
        return ctl.hash();
      })();

      assert.equal(ctlAfter, cliAfter, `${log.name}: step ${i + 1} (${id}) — surfaces diverged`);
      assert.equal(cliAfter, log.hashes[i], `${log.name}: step ${i + 1} (${id}) — CLI drifted from the recorded log`);
      assert.notEqual(prev, null);
      prev = cliAfter;
    }

    assert.equal(prev, log.finalHash, `${log.name}: final identity must be the logged finalHash`);
    assert.equal(ctl.hash(), log.finalHash, `${log.name}: controller final identity must match`);
  }
});

test('the controller renders kernel text unchanged, with and without a renderer', async () => {
  const log = LOGS[0];
  const ctl = createController({ run: { seed: log.header.seed } });
  const text = ctl.render();
  assert.equal(typeof text, 'string');
  assert.ok(text.startsWith('T0'), `controller dump is the kernel R4 dump, got: ${text.split('\n')[0]}`);

  // A renderer receives data and can return nothing; attaching one must not change
  // the hash or the text. Renderers are sinks, never sources.
  const seen = [];
  ctl.attach({ render: (payload) => seen.push(payload) });
  assert.equal(ctl.hasRenderer(), true);
  const withRenderer = ctl.render();
  assert.equal(withRenderer, text, 'attaching a renderer must not alter the dump');
  assert.equal(seen.length, 1, 'the renderer was handed the payload exactly once');
  assert.equal(seen[0].text, text);
  assert.equal(ctl.hash(), createController({ run: { seed: log.header.seed } }).hash(), 'renderer cannot affect identity');
});

test('the whole engine is usable with the renderer module unresolvable', async () => {
  // src/surface/gui/renderer.js does not exist; absence must be a normal null, not a throw.
  const renderer = await resolveRenderer();
  assert.equal(renderer, null, 'an absent renderer resolves to null rather than throwing');

  const log = LOGS[1];
  const ctl = createController({ run: { seed: log.header.seed }, renderer: null });
  assert.equal(ctl.hasRenderer(), false, 'controller is headless by default');

  await cli('new', ['--seed', String(log.header.seed), '--run', RUN_FILE]);
  for (const [i, entry] of log.entries.entries()) {
    const id = 'act' in entry ? entry.act : entry.reject;
    const cliAfter = await cliStep(id);
    ctl.dispatch(id);
    ctl.render(); // exercising the headless render path every step
    assert.equal(ctl.hash(), cliAfter, `headless pass: step ${i + 1} (${id}) diverged`);
    assert.equal(ctl.hash(), log.hashes[i], `headless pass: step ${i + 1} drifted from the log`);
  }
  assert.equal(ctl.hash(), log.finalHash);
  assert.equal(ctl.save().length > 0, true, 'controller can serialize the run it just played');
});

test('a rejection is a no-op on both surfaces, and it is not silently swallowed', async () => {
  await cli('new', ['--seed', '0', '--run', RUN_FILE]);
  const before = await cliHash();
  const ctl = createController({ run: { seed: 0 } });
  const beforeCtl = ctl.hash();

  const r = await cli('play', ['zz9', '--run', RUN_FILE]);
  assert.equal(r.code, 2, 'an illegal id is the illegal_action exit class');
  assert.match(r.err, /"error":"illegal_action"/, `structured error on stderr, got ${r.err}`);
  const ctlResult = ctl.dispatch('zz9');
  assert.equal(ctlResult.error.code, 2, 'controller reports the same class');
  assert.equal(ctlResult.changed, false, 'and the same no-op semantics');

  assert.equal(await cliHash(), before, 'a rejected action does not move the CLI run');
  assert.equal(ctl.hash(), beforeCtl, 'a rejected action does not move the controller run');
  assert.equal(await cliHash(), beforeCtl, 'both surfaces agree the run is unchanged');
});

// --- AC-6.5: the two surfaces must agree on the RUN RECORD, not merely on the hash ---
//
// The hashes above prove the two surfaces present one engine. This proves the thing a
// history screen actually reads: that a run recorded through the CLI's own replay path
// and the same run played through the GUI controller produce ONE record — same identity,
// same outcome, same floor, and a byte-identical itemised score (AC-6.5 + AC-7.2).
test('both surfaces produce the SAME run record for the same run (AC-6.5)', async () => {
  // The busiest golden log: the most steps is the most chances to diverge.
  const log = LOGS.reduce((a, b) => (b.entries.length > a.entries.length ? b : a));
  const { replay } = await loadSession();

  // Surface A — the CLI's replay path. `dlb replay` executes exactly this function.
  const cliOut = replay(log.header, log.entries);
  const cliRecord = buildRunRecord({
    state: cliOut.session.state,
    submitted: cliOut.session.submitted,
    events: cliOut.session.events,
    policy: 'human',
    provenance: 'human',
  });

  // Surface B — the DOM-free GUI controller, dispatching the same ids in the same order.
  const ctl = createController({
    run: { seed: log.header.seed, character: log.header.character, difficulty: log.header.difficulty },
  });
  const ctlEvents = [];
  const ctlSubmitted = [];
  for (const entry of log.entries) {
    const id = 'act' in entry ? entry.act : entry.reject;
    const res = ctl.dispatch(id);
    ctlSubmitted.push('act' in entry ? { act: entry.act } : { reject: entry.reject });
    if (Array.isArray(res.events)) ctlEvents.push(...res.events);
  }
  const ctlRecord = buildRunRecord({
    state: ctl.state,
    submitted: ctlSubmitted,
    events: ctlEvents,
    policy: 'human',
    provenance: 'human',
  });

  assert.deepEqual(ctlRecord.actions, cliRecord.actions, 'the two surfaces must log the same actions');
  assert.equal(ctlRecord.steps, cliRecord.steps, 'steps must agree');
  assert.equal(ctlRecord.rejected, cliRecord.rejected, 'the rejection count must agree');
  assert.equal(ctlRecord.id, cliRecord.id, 'the two surfaces must agree on the record id');
  assert.equal(ctlRecord.hash, cliRecord.hash, 'and on the compatibility alias');
  assert.equal(ctlRecord.outcome, cliRecord.outcome, 'outcome must agree');
  assert.equal(ctlRecord.floor, cliRecord.floor, 'floor must agree');
  assert.equal(ctlRecord.hp, cliRecord.hp, 'hp must agree');
  assert.equal(ctlRecord.deckSize, cliRecord.deckSize, 'deck size must agree');
  assert.deepEqual(ctlRecord.events, cliRecord.events, 'the accumulated event stream must agree event for event');
  assert.deepEqual(ctlRecord.score, cliRecord.score, 'the itemised score must agree');
  assert.equal(
    JSON.stringify(ctlRecord.score),
    JSON.stringify(cliRecord.score),
    'the serialized score bytes must agree (AC-7.2)',
  );
});

// Keeps the temp run file deterministic across repeated local runs without deleting it.
test.after(() => {
  writeFileSync(RUN_FILE, '');
});
