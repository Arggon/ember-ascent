// Batch self-play — thousands of games, zero API calls (R2, R4, R9a, R10).
//
// `sim` exists to make balance volume cost nothing: every run here is CPU and disk.
// Runs are distributed across worker threads, each worker owning a disjoint seed
// range, so throughput scales linearly and results are independent of thread count.
//
// Each worker emits one JSONL record per run. `stats` reads those records, which is
// why the format is append-only and self-describing: a balance report can be rebuilt
// from a directory of records without re-running the simulation.
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { begin, submit, legal, view, actionLines, malformed, eventsOf } from './session.js';
import { makePolicy, deckComposition } from './policies.js';
import { measureRun } from './tokens.js';
// The record builder lives in the KERNEL and is reached through its one public entry
// (R1). `sim` no longer composes a record field-by-field: it hands the finished session
// to the same function the GUI controller uses, which is what makes AC-6.5 — the two
// surfaces produce the SAME record — true by construction rather than by inspection.
// `--pool fresh` narrows the card pool to the unlock-free 24; the kernel owns that
// filter, so the flag never makes the rules aware of a profile (DR-4, DR-5).
import { buildRunRecord, contentForProfile, fullyUnlockedProfile } from '../kernel/index.js';

/** Hard stop so a pathological interaction cannot spin forever inside a worker. */
const MAX_STEPS = 5000;

/**
 * Play one complete run with a built-in policy.
 *
 * The policy reads only public kernel output. `incoming` is carried in memory from
 * the observation text rather than from state, because the printed intent label is
 * exactly what a human or an LLM player sees — using it keeps the heuristic honest
 * about the information a player actually has.
 * @param {{seed: number, character?: string, difficulty?: number, policy?: string, collect?: boolean,
 *          profile?: 'full'|'fresh'|string}} opts
 * @returns {Promise<any>} record
 */
export async function playRun(opts) {
  const policy = makePolicy(opts.policy ?? 'greedy');
  // DR-5: the pool is decided ONCE, here, and reaches the engine as content. The kernel
  // never sees the flag or the profile, so no rule can branch on how much has been
  // unlocked (AC-9.3). `full` means the whole shipped pool — no unlock is withheld from
  // an offline batch run, because withholding one is a product decision, not a sim one.
  const content = opts.profile === 'fresh' ? contentForProfile(null) : contentForProfile(fullyUnlockedProfile());
  let session = begin({ seed: opts.seed, character: opts.character, difficulty: opts.difficulty, content });
  const memory = {};
  const samples = [];
  const offered = [];
  const taken = [];
  let steps = 0;
  let malformedAtEnd = { rejected: 0 };

  // BOSS-FLOOR DIAGNOSTICS. The floor histogram says how many runs REACH the boss,
  // but nothing about what they arrive with. These fields make "is the boss too
  // strong?" a question the data can answer: arrival HP, arrival deck composition,
  // and — when the run ends in that fight — how much of the boss was still standing.
  // Recorded once, on the turn the boss fight starts, so "at the boss" means
  // "on arrival".
  let bossArrival = null;
  let bossHpRemaining = null;

  while (session.state.phase !== 'ended' && steps < MAX_STEPS) {
    // One render per step; the same text feeds the token sample and the policy's
    // view of incoming damage. Rendering twice would also double the cost of sim.
    const dump = view(session);
    const lines = actionLines(session).split('\n').filter(Boolean);
    if (opts.collect) samples.push({ dump, actionLines: lines });
    if (session.state.phase === 'combat') {
      memory.incoming = incomingFromDump(dump);
      memory.dump = dump;
      if (session.state.combat.nodeType === 'boss' && bossArrival === null) {
        const comp = deckComposition(session.state.deck);
        bossArrival = {
          hp: session.state.player.hp,
          maxHp: session.state.player.maxHp,
          deckSize: session.state.deck.length,
          attacks: comp.attacks,
          skills: comp.skills,
          powers: comp.powers,
          blockPoints: comp.block,
        };
      }
    }
    const choice = policy.choose({ session, state: session.state, legal: legal(session), stepIndex: session.state.stepIndex, memory, dump });
    if (choice.id === null) break;
    const before = session.state;
    if (before.phase === 'reward' && before.reward) {
      for (const id of before.reward.cards) offered.push(id);
    }
    const res = submit(session, choice.id);
    session = res.session;
    if (res.changed && before.phase === 'reward' && before.reward) {
      const prize = choice.id === 's0' ? null : before.reward.cards[Number(choice.id.slice(1)) - 1];
      if (prize) taken.push(prize);
    }
    steps += 1;
  }

  const m = malformed(session);
  malformedAtEnd = m;
  // Boss HP still standing when the run ended in the boss fight. Read before the
  // state is reduced to the record: an enemy that is absent (not a boss fight, or the
  // boss already dead) yields null rather than a misleading 0.
  if (bossArrival !== null && session.state.combat?.nodeType === 'boss') {
    const seen = session.state.combat.enemies.filter((e) => e.id === 'the_guardian');
    if (seen.length > 0) {
      bossHpRemaining = seen.reduce((s, e) => s + Math.max(0, e.hp), 0);
      bossArrival.bossMaxHp = seen.reduce((s, e) => s + e.maxHp, 0);
    }
  }
  const record = buildRunRecord({
    state: session.state,
    submitted: session.submitted,
    // DR-6: the accumulated kernel event stream is the ONLY source of kill / elite /
    // boss counts, because snapshot() carries no such counters. `session` accumulates
    // it in submit(); dropping it here would silently score every run zero kills.
    events: eventsOf(session),
    policy: policy.name,
    provenance: 'heuristic',
    // AC-9.6 compares fresh-pool runs against full-pool runs, so which pool a run was
    // played with has to travel with the record when it is not the default.
    profile: opts.profile ?? 'full',
    offered,
    taken,
    collect: Boolean(opts.collect),
    payloadTokens: undefined,
    samples: samples.length,
    bossArrival,
    bossHpRemaining,
  });
  if (opts.collect) {
    // Async only because the tokenizer is loaded lazily; awaiting here keeps the
    // worker's postMessage payload a plain structured-cloneable object.
    const t = await measureRun(samples);
    record.payloadTokens = t;
    record.samples = samples.length;
  }
  void malformedAtEnd;
  return record;
}

/**
 * Total incoming damage, read from the ENEMY block of a rendered dump.
 *
 * Reading the rendered text rather than state internals is deliberate: the printed
 * intent is exactly the information a player has, so the heuristic cannot quietly
 * use numbers no observation exposes. "A5x3" contributes 15; "B20"/"PWR3" contribute 0.
 * @param {string} dump
 * @returns {number}
 */
function incomingFromDump(dump) {
  const rows = dump.split('\n');
  const at = rows.indexOf('ENEMY');
  if (at === -1) return 0;
  let total = 0;
  for (let i = at + 1; i < rows.length; i += 1) {
    const m = /A(\d+)(?:x(\d+))?/.exec(rows[i]);
    if (m) total += Number(m[1]) * (m[2] ? Number(m[2]) : 1);
  }
  return total;
}

/**
 * Run a batch of games across worker threads.
 *
 * Seeds are assigned round-robin-free: worker w gets the contiguous block
 * [seedStart + w*chunk, ...). Contiguous blocks make each worker's output directory
 * browsable by seed, and make worker count irrelevant to the set of games played.
 * @param {{runs: number, seedStart: number, policy: string, threads: number, outDir?: string|null, profile?: string, onProgress?: Function|null}} opts
 * @returns {Promise<any>}
 */
export async function simulate(opts) {
  const runs = opts.runs;
  const threads = Math.max(1, Math.min(opts.threads ?? 1, availableParallelism(), runs));
  if (!Number.isInteger(runs) || runs <= 0) {
    throw Object.assign(new Error(`--runs must be a positive integer, got ${opts.runs}`), { code: 3 });
  }
  if (!Number.isInteger(opts.seedStart) || opts.seedStart < 0) {
    throw Object.assign(new Error(`--seed-start must be a non-negative integer, got ${opts.seedStart}`), { code: 3 });
  }

  const dir = opts.outDir ?? null;
  if (dir) mkdirSync(dir, { recursive: true });
  const start = process.hrtime.bigint();

  const chunks = [];
  const per = Math.ceil(runs / threads);
  for (let t = 0; t < threads; t += 1) {
    const from = opts.seedStart + t * per;
    const count = Math.max(0, Math.min(per, runs - t * per));
    if (count > 0) chunks.push({ from, count });
  }

  const records = [];
  await Promise.all(
    chunks.map(
      (chunk, i) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(fileURLToPath(import.meta.url), {
            workerData: { chunk, policy: opts.policy, collect: i === 0, outDir: dir, profile: opts.profile },
          });
          worker.on('message', (msg) => {
            if (msg?.error) reject(new Error(msg.error));
            else {
              records.push(...msg.records);
              resolve();
            }
          });
          worker.on('error', reject);
          worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`sim worker exited with code ${code}`));
          });
        }),
    ),
  );

  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  records.sort((a, b) => a.seed - b.seed);

  const wins = records.filter((r) => r.outcome === 'win').length;
  const losses = records.filter((r) => r.outcome === 'loss').length;
  const unfinished = records.filter((r) => r.outcome === 'unfinished').length;
  const stepsTotal = records.reduce((s, r) => s + r.steps, 0);
  const rejectedTotal = records.reduce((s, r) => s + r.rejected, 0);
  const submissionsTotal = stepsTotal + rejectedTotal;
  const floors = records.map((r) => r.floor);
  // BOSS FLOOR, measured rather than inferred. `bossArrival` is written on the turn the
  // boss fight starts, so bossRuns is exactly the set of runs that reached it — the
  // number that hides inside a raw floor histogram. bossKillRate is the rate the brief
  // cares about: of the runs that got there, how many actually won.
  const bossRuns = records.filter((r) => r.bossArrival);
  const bossWins = bossRuns.filter((r) => r.outcome === 'win');
  const bossDeaths = bossRuns.filter((r) => typeof r.bossHpRemaining === 'number' && r.outcome !== 'win');
  const avg = (xs) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const fmt = (v, d = 1) => (v === null ? 'n/a' : v.toFixed(d));
  const bossSummary = {
    reached: bossRuns.length,
    reachedRate: records.length ? bossRuns.length / records.length : 0,
    kills: bossWins.length,
    killRate: bossRuns.length ? bossWins.length / bossRuns.length : 0,
    meanArrivalHp: avg(bossRuns.map((r) => r.bossArrival.hp)),
    meanArrivalHpFrac: avg(bossRuns.map((r) => r.bossArrival.hp / r.bossArrival.maxHp)),
    meanArrivalDeckSize: avg(bossRuns.map((r) => r.bossArrival.deckSize)),
    meanArrivalAttacks: avg(bossRuns.map((r) => r.bossArrival.attacks)),
    meanArrivalSkills: avg(bossRuns.map((r) => r.bossArrival.skills)),
    meanArrivalPowers: avg(bossRuns.map((r) => r.bossArrival.powers)),
    meanArrivalBlockPoints: avg(bossRuns.map((r) => r.bossArrival.blockPoints)),
    // Only over runs that DIED in the boss fight: a run that killed the boss has no
    // "HP remaining" to average, and folding a 0 in would understate the boss.
    meanBossHpRemaining: avg(bossDeaths.map((r) => r.bossHpRemaining)),
    meanBossHpRemainingPct: avg(bossDeaths.map((r) => r.bossHpRemaining / (r.bossArrival.bossMaxHp || 240))),
    deathsCounted: bossDeaths.length,
  };
  const tokens = records.find((r) => r.payloadTokens)?.payloadTokens ?? null;

  const report = [
    `sim ${records.length} runs | policy ${opts.policy} | threads ${threads} | seeds ${opts.seedStart}..${opts.seedStart + records.length - 1}`,
    `win ${wins} (${pct(wins, records.length)}) loss ${losses} (${pct(losses, records.length)}) unfinished ${unfinished}`,
    `steps total ${stepsTotal} mean ${(stepsTotal / records.length).toFixed(1)} | floors max ${Math.max(...floors)} mean ${(floors.reduce((a, b) => a + b, 0) / floors.length).toFixed(2)}`,
    `malformed ${rejectedTotal}/${submissionsTotal} (${pct(rejectedTotal, submissionsTotal)})`,
    `boss reached ${bossSummary.reached}/${records.length} (${(bossSummary.reachedRate * 100).toFixed(1)}%) | kills ${bossSummary.kills} (${(bossSummary.killRate * 100).toFixed(1)}% of those that reached)`,
    `boss arrival: HP ${fmt(bossSummary.meanArrivalHp)}/${records.find((r) => r.bossArrival)?.bossArrival.maxHp ?? 60} (${(100 * (bossSummary.meanArrivalHpFrac ?? 0)).toFixed(0)}%) | deck ${fmt(bossSummary.meanArrivalDeckSize)} (atk ${fmt(bossSummary.meanArrivalAttacks)} blk ${fmt(bossSummary.meanArrivalSkills)} pow ${fmt(bossSummary.meanArrivalPowers)}) | block points in deck ${fmt(bossSummary.meanArrivalBlockPoints)}`,
    `boss at death: mean HP remaining ${fmt(bossSummary.meanBossHpRemaining)}/${records.find((r) => r.bossArrival)?.bossArrival.bossMaxHp ?? 240} (${fmt(100 * (bossSummary.meanBossHpRemainingPct ?? 0), 0)}%) over ${bossSummary.deathsCounted} boss deaths`,
    `elapsed ${elapsedMs.toFixed(0)}ms | ${(records.length / (elapsedMs / 1000)).toFixed(1)} runs/sec`,
  ];
  if (tokens?.available) {
    report.push(
      `payload tokens: dump worst ${tokens.stateDump.worst}/${tokens.stateDump.ceiling} ${tokens.stateDump.pass ? 'PASS' : 'FAIL'}` +
        ` | action line worst ${tokens.actionLine.worst}/${tokens.actionLine.ceiling} ${tokens.actionLine.pass ? 'PASS' : 'FAIL'}` +
        ` (${tokens.actionLine.linesMeasured} lines measured)`,
    );
  } else {
    report.push(`payload tokens: unavailable (${tokens?.reason ?? 'measurement module missing'})`);
  }

  return {
    runs: records.length,
    policy: opts.policy,
    threads,
    seedStart: opts.seedStart,
    elapsedMs: Math.round(elapsedMs),
    runsPerSecond: records.length / (elapsedMs / 1000),
    wins,
    losses,
    unfinished,
    winRate: records.length ? wins / records.length : 0,
    malformedRate: submissionsTotal ? rejectedTotal / submissionsTotal : 0,
    meanSteps: stepsTotal / records.length,
    meanFloor: floors.reduce((a, b) => a + b, 0) / floors.length,
    maxFloor: Math.max(...floors),
    boss: bossSummary,
    provenance: 'heuristic',
    payloadTokens: tokens,
    records,
    summary: {
      payloadTokens: tokens?.available ? tokens.stateDump : null,
      actionLine: tokens?.available ? tokens.actionLine : null,
      boss: bossSummary,
    },
    report: report.join('\n'),
  };
}

/** Percentage with one decimal, safe at zero denominator. */
function pct(n, d) {
  if (!d) return '0.0%';
  return `${((n / d) * 100).toFixed(1)}%`;
}

// --- worker side ------------------------------------------------------------------
if (!isMainThread) {
  const { chunk, policy, collect, outDir, profile } = workerData;
  const records = [];
  let failures = null;
  try {
    for (let i = 0; i < chunk.count; i += 1) {
      const rec = await playRun({ seed: chunk.from + i, policy, collect: collect && i === 0, profile });
      records.push(rec);
      if (outDir) appendFileSync(join(outDir, 'runs.jsonl'), `${JSON.stringify(rec, (k, v) => (k === 'payloadTokens' || k === 'samples' ? undefined : v))}\n`);
    }
  } catch (e) {
    failures = e?.stack ?? String(e);
  }
  if (failures) {
    parentPort.postMessage({ error: failures });
  } else {
    parentPort.postMessage({ records });
  }
}
