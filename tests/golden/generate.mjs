// tests/golden/generate.mjs — regenerate tests/golden/logs.jsonl.
//
// The golden file is DERIVED, never hand-edited: every entry records the run's own
// per-step hashes as recomputed during generation, so a golden file that disagrees with
// the engine is a regeneration away from correct. Run:
//   node tests/golden/generate.mjs
//
// Two sources, as the brief requires:
//   - scripted corners: short, hand-picked action lists that touch each phase edge
//   - heuristic sim seeds: full greedy/random self-play runs from real seeds
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { begin, submit, runHash } from '../../src/surface/session.js';
import { makePolicy } from '../../src/surface/policies.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'logs.jsonl');

const HEADER = () => ({
  format: 'dlb-log',
  v: 1,
  seed: 0,
  contentVersion: 'dlb-0.3.0-act1',
  character: 'ironclad',
  difficulty: 0,
});

/** Drive a session live and record the run identity. */
function drive(seed, entries) {
  let session = begin({ seed, character: 'ironclad', difficulty: 0 });
  const hashes = [];
  for (const e of entries) {
    session = submit(session, 'reject' in e ? e.reject : e.act).session;
    hashes.push(runHash(session));
  }
  return { session, hashes };
}

/** Play one full run with a built-in policy, capturing the submitted action list. */
function selfPlay(seed, policyName) {
  const policy = makePolicy(policyName);
  let session = begin({ seed, character: 'ironclad', difficulty: 0 });
  const memory = {};
  let steps = 0;
  while (session.state.phase !== 'ended' && steps < 5000) {
    const choice = policy.choose({ session, state: session.state, legal: requireLegal(session), stepIndex: session.state.stepIndex, memory });
    if (choice.id === null) break;
    session = submit(session, choice.id).session;
    steps += 1;
  }
  return { session, steps };
}

/** Local import shim so this file stays a plain script (no top-level await needed). */
let _legal = null;
function requireLegal(session) {
  return _legal(session);
}

async function main() {
  const sessionMod = await import('../../src/surface/session.js');
  _legal = sessionMod.legal;

  const logs = [];

  // --- scripted corners (seed 0) -------------------------------------------------
  const corners = [
    ['corner-open-map', [{ act: 'n1' }]],
    ['corner-rejected-noop', [{ reject: 'zz9' }, { reject: '' }, { act: 'n1' }]],
    ['corner-all-rejects', [{ reject: 'nope' }, { reject: 'zz9' }, { reject: 'p99' }]],
    ['corner-combat-end-turn', [{ act: 'n1' }, { act: 'e1' }]],
    ['corner-combat-play', [{ act: 'n1' }, { act: 'p1' }]],
    ['corner-combat-two-plays', [{ act: 'n1' }, { act: 'p1' }, { act: 'p1' }]],
    ['corner-combat-three-turns', [{ act: 'n1' }, { act: 'e1' }, { act: 'e1' }, { act: 'e1' }]],
    ['corner-interleaved-reject', [{ act: 'n1' }, { act: 'p1' }, { reject: 'zz9' }, { act: 'e1' }, { act: 'p1' }]],
    ['corner-drain-hand', [{ act: 'n1' }, { act: 'p1' }, { act: 'p1' }, { act: 'p1' }, { act: 'p1' }, { act: 'p1' }]],
    ['corner-long-attrition', [{ act: 'n1' }, ...Array.from({ length: 12 }, () => ({ act: 'e1' }))]],
  ];
  for (const [name, entries] of corners) {
    const { session, hashes } = drive(0, entries);
    logs.push({ name, source: 'scripted', header: HEADER(), entries, hashes, finalHash: runHash(session), outcome: session.state.outcome });
  }

  // --- heuristic sim seeds -------------------------------------------------------
  for (let seed = 1; seed <= 20; seed += 1) {
    const { session } = selfPlay(seed, 'greedy');
    const entries = session.submitted.map((e) => ('act' in e ? { act: e.act } : { reject: e.reject }));
    const { hashes } = drive(seed, entries);
    logs.push({
      name: `heuristic-greedy-seed-${seed}`,
      source: 'heuristic',
      header: { ...HEADER(), seed },
      entries,
      hashes,
      finalHash: runHash(session),
      outcome: session.state.outcome,
    });
  }
  for (let seed = 1; seed <= 5; seed += 1) {
    const { session } = selfPlay(seed, 'random');
    const entries = session.submitted.map((e) => ('act' in e ? { act: e.act } : { reject: e.reject }));
    const { hashes } = drive(seed, entries);
    logs.push({
      name: `heuristic-random-seed-${seed}`,
      source: 'heuristic',
      header: { ...HEADER(), seed },
      entries,
      hashes,
      finalHash: runHash(session),
      outcome: session.state.outcome,
    });
  }

  // Every log must carry steps and one hash per step. Only the deliberately all-rejected
  // corner is allowed to contain no accepted action (it exists to prove a run of
  // rejections replays as a run of no-ops).
  for (const l of logs) {
    if (l.entries.length === 0) throw new Error(`${l.name}: empty log`);
    if (l.hashes.length !== l.entries.length) throw new Error(`${l.name}: hash/entry length mismatch`);
    if (l.name !== 'corner-all-rejects' && !l.entries.some((e) => 'act' in e)) {
      throw new Error(`${l.name}: no accepted action`);
    }
  }

  writeFileSync(OUT, `${logs.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const ended = logs.filter((l) => l.outcome).length;
  process.stdout.write(`wrote ${logs.length} golden logs to ${OUT}\n`);
  process.stdout.write(`  scripted ${logs.filter((l) => l.source === 'scripted').length}, heuristic ${logs.filter((l) => l.source === 'heuristic').length}\n`);
  process.stdout.write(`  runs that reached an end state: ${ended}\n`);
  process.stdout.write(`  longest log: ${Math.max(...logs.map((l) => l.entries.length))} steps\n`);
}

main();
