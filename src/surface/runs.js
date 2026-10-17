// The run-history repository — the ONLY place run records touch a disk (DR-1, DR-3, DR-6, DR-7).
//
// WHY THIS IS A SURFACE, NOT KERNEL CODE: the kernel may not import a `node:*` builtin,
// because it has to run unmodified in a browser. Reading and writing `runs.jsonl` is
// exactly that kind of host work, so it lives here and the kernel only ever sees plain
// objects handed to it. `scripts/check-architecture.mjs` fails the build if that line is
// ever crossed in the other direction.
//
// THE ONE INVARIANT THIS FILE EXISTS TO PROTECT (DR-3):
//   A dropped run is folded into the lifetime aggregate BEFORE its line leaves the file.
// Retention keeps the newest 100 runs, but "lifetime floors climbed" must never go DOWN
// because the player kept playing. So the append order is:
//   1. append the new line(s)              — the record is durable first
//   2. fold the to-be-dropped runs into agg — no window where the number is unowned
//   3. rewrite the file with the kept N     — last, because it is the only destructive step
// A crash between 2 and 3 double-counts nothing: the dropped lines are still in the file,
// so the next retain() recomputes the same aggregate from the same lines.
//
// BACKWARD READABILITY (DR-3): the 150 legacy lines at sim-out/runs.jsonl carry no `v`,
// no `actions`, no `events`, no `score`, no `profile`. Every read path here tolerates
// every one of those fields being absent, and per DR-7 a run that cannot yield a score
// yields **null** rather than a guess.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RETAIN, aggregate, emptyAgg, isLegacyRecord, pruneRuns } from '../kernel/index.js';

/** The record file's name inside a history directory. */
export const RUNS_FILE = 'runs.jsonl';
/** The cumulative aggregate's name. Deliberately NOT `.jsonl`, so `stats --from <dir>` ignores it. */
export const AGG_FILE = 'agg.json';

/** The aggregate file that sits beside a given runs file. */
export function aggPathFor(runsFile) {
  return join(dirname(runsFile), AGG_FILE);
}

/**
 * Parse JSONL text into records. A malformed line is REPORTED, never thrown on: one
 * corrupt line in the middle of an append-only file must not make the other 149
 * unreadable, which is the whole reason the format is line-delimited.
 * @param {string} text
 * @returns {{records: any[], problems: string[]}}
 */
export function parseRunsJsonl(text) {
  const records = [];
  const problems = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    try {
      records.push(JSON.parse(line));
    } catch (e) {
      problems.push(`line ${i + 1}: not JSON (${e.message})`);
    }
  });
  return { records, problems };
}

/**
 * Load every record from a runs file, in append order.
 *
 * Append order is load-bearing (newest-N retention is defined on it), so this never
 * sorts. A missing file is an empty history, not an error — a first-ever run has none.
 * @param {string} runsFile
 * @returns {{records: any[], problems: string[], exists: boolean}}
 */
export function loadRuns(runsFile) {
  if (!existsSync(runsFile)) return { records: [], problems: [], exists: false };
  const parsed = parseRunsJsonl(readFileSync(runsFile, 'utf8'));
  return { records: parsed.records, problems: parsed.problems, exists: true };
}

/** Coerce a possibly-partial or hand-edited aggregate file back to a complete aggregate. */
function normalizeAgg(raw) {
  const base = emptyAgg();
  if (raw === null || typeof raw !== 'object') return base;
  return {
    runs: Number(raw.runs) || 0,
    wins: Number(raw.wins) || 0,
    losses: Number(raw.losses) || 0,
    unfinished: Number(raw.unfinished) || 0,
    floors: raw.floors && typeof raw.floors === 'object' ? { ...raw.floors } : {},
    score: {
      count: Number(raw.score?.count) || 0,
      total: Number(raw.score?.total) || 0,
      max: raw.score && raw.score.max !== null && Number.isFinite(Number(raw.score?.max)) ? Number(raw.score.max) : null,
    },
    badges: raw.badges && typeof raw.badges === 'object' ? { ...raw.badges } : {},
  };
}

/**
 * The lifetime aggregate that outlives retention. A missing or corrupt file yields the
 * additive identity, which under-counts rather than inventing runs that never happened.
 * @param {string} runsFile the runs file the aggregate sits beside
 */
export function loadAgg(runsFile) {
  const path = aggPathFor(runsFile);
  if (!existsSync(path)) return emptyAgg();
  try {
    return normalizeAgg(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return emptyAgg();
  }
}

/** Write the aggregate atomically enough for our purposes: whole file, one call. */
function writeAgg(runsFile, agg) {
  mkdirSync(dirname(runsFile), { recursive: true });
  writeFileSync(aggPathFor(runsFile), `${JSON.stringify(agg)}\n`);
}

/** Serialize records to JSONL text, one line each, LF-terminated. */
export function toJsonl(records) {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/**
 * Apply newest-N retention to the file, folding every dropped run into the lifetime
 * aggregate FIRST (see the file header). Returns what happened so a caller can report it.
 * @param {string} runsFile
 * @param {{keep?: number}} [opts]
 * @returns {{kept: any[], dropped: any[], agg: any, problems: string[]}}
 */
export function retain(runsFile, opts = {}) {
  const keep = opts.keep ?? RETAIN;
  mkdirSync(dirname(runsFile), { recursive: true });
  const loaded = loadRuns(runsFile);
  const { kept, dropped, agg } = pruneRuns(loaded.records, { keep, agg: loadAgg(runsFile) });
  if (dropped.length > 0) {
    // 2. the aggregate owns the dropped runs before… 3. …the only destructive step runs.
    writeAgg(runsFile, agg);
    writeFileSync(runsFile, toJsonl(kept));
  }
  return { kept, dropped, agg, problems: loaded.problems };
}

/**
 * Append records, then retain. The append happens first so a run that just finished is
 * durable even if retention throws; a duplicate on retry is acceptable for a local
 * history file and is far cheaper than losing the run.
 * @param {string} runsFile
 * @param {any|any[]} records
 * @param {{keep?: number}} [opts]
 */
export function appendRuns(runsFile, records, opts = {}) {
  const list = Array.isArray(records) ? records : [records];
  mkdirSync(dirname(runsFile), { recursive: true });
  if (list.length > 0) appendFileSync(runsFile, toJsonl(list));
  const result = retain(runsFile, opts);
  return { ...result, appended: list.length };
}

/**
 * The counters `unlocks.js` reads, derived from the lifetime aggregate (DR-4).
 *
 * This is the ONLY bridge from history to the unlock catalog, and it hands over
 * counters — never pool contents, never stats. `poolPlan` turns those counters into a
 * pool, and `poolSelection` turns that plan into card ids. That single direction is what
 * makes "an unlock adds an option, never power" (AC-9.3) structural rather than a promise.
 * @param {any} agg a lifetime aggregate from loadAgg()
 */
export function profileFor(agg) {
  const a = agg ?? emptyAgg();
  const badges = {};
  for (const [id, count] of Object.entries(a.badges ?? {})) badges[id] = Number(count) > 0;
  return { scoreTotal: a.score?.total ?? 0, runs: a.runs ?? 0, badges };
}

/**
 * One history-screen row per record, newest first.
 *
 * A legacy record has no `actions`, so `score` is **null** (DR-7) and `legacy` is true;
 * a consumer renders absence rather than a zero it would otherwise mistake for a real
 * score of nothing. Badges are attached as already-earned facts from the record itself.
 * @param {any[]} records in append order
 * @param {any[]} [badgeCatalog] entries with {id, name, condition}
 */
export function historyEntries(records, badgeCatalog = []) {
  const byBadge = new Map(badgeCatalog.map((b) => [b.id, b]));
  return (Array.isArray(records) ? records : [])
    .map((record, index) => {
      const ids = Array.isArray(record?.badges) ? record.badges : [];
      return {
        index,
        id: record?.id ?? record?.hash ?? null,
        seed: record?.seed ?? null,
        character: record?.character ?? null,
        difficulty: record?.difficulty ?? null,
        profile: record?.profile ?? null,
        policy: record?.policy ?? null,
        provenance: record?.provenance ?? null,
        outcome: record?.outcome ?? 'unfinished',
        floor: record?.floor ?? null,
        steps: record?.steps ?? null,
        // null, never 0: DR-7.
        score: record?.score ?? null,
        badges: ids.map((id) => {
          const catalog = byBadge.get(typeof id === 'string' ? id : id?.id);
          return {
            id: typeof id === 'string' ? id : (id?.id ?? null),
            name: catalog?.name ?? id?.name ?? null,
            condition: catalog?.condition ?? id?.condition ?? null,
          };
        }),
        legacy: isLegacyRecord(record),
      };
    })
    .reverse();
}

/**
 * The full history view: newest-first rows plus the lifetime totals that survive retention.
 * @param {string} runsFile
 * @param {{badgeCatalog?: any[], keep?: number}} [opts]
 */
export function historyView(runsFile, opts = {}) {
  const loaded = loadRuns(runsFile);
  const agg = loadAgg(runsFile);
  // The file holds at most the retained N; the aggregate holds everything ever folded in.
  const live = aggregate(loaded.records, { ...emptyAgg() });
  const lifetime = aggregate(loaded.records, agg);
  return {
    runsFile,
    exists: loaded.exists,
    problems: loaded.problems,
    retained: loaded.records.length,
    keep: opts.keep ?? RETAIN,
    entries: historyEntries(loaded.records, opts.badgeCatalog ?? []),
    retained_agg: live,
    agg: lifetime,
  };
}
