// Run record — schema, builder, itemised score, retention (DR-1, DR-3, DR-6, DR-7).
//
// WHY THIS FILE IS IN THE KERNEL: the record is what the two surfaces must AGREE on
// (AC-6.5). If the CLI built it and the browser built it, agreement would be a promise
// about two code paths; here it is one function, and R1's golden test can assert it.
//
// BROWSER-SAFE BY CONSTRUCTION (DR-2): this module imports NO `node:*` builtin. It is
// reachable from `src/web/**` through the kernel entry, and `scripts/check-architecture.mjs`
// fails the build if that ever stops being true. Everything here is a pure function of
// its arguments — no clock, no `Math.random`, no I/O.
//
// ---------------------------------------------------------------------------
// RECORD SCHEMA (one JSON object per line in runs.jsonl, append-only)
// ---------------------------------------------------------------------------
//   v             number   schema version of THIS record      [optional on read]
//   id            string   the run's state hash (DR-3: id === the state hash)  [required]
//   hash          string   compatibility alias of `id` for pre-DR-3 readers   [optional]
//   engineVersion string   ENGINE_VERSION at the time of the run              [optional]
//   contentVersion string  so a record can be refused rather than misread     [required]
//   seed          number   run seed                                           [required]
//   character     string                                                      [required]
//   difficulty    number                                                      [optional]
//   profile       'full'|'fresh'|string   which pool the run was played with   [optional]
//   policy        string   the policy that drove it ('human' for a human)      [required]
//   provenance    'human'|'heuristic'|'llm'   R10 — never mixed unlabelled     [required]
//   outcome       'win'|'loss'|'unfinished'                                    [required]
//   floor         number   the floor reached, as displayed to the player       [required]
//   steps         number   submissions (accepted + rejected)                   [required]
//   hp, maxHp, deckSize, deck[], rejected, malformedRate                       [required]
//   offered[]     card ids offered as rewards                                  [optional]
//   taken[]       card ids taken from those offers                             [optional]
//   bossArrival   object   only when the run reached the boss floor            [optional]
//   bossHpRemaining number|null                                                 [optional]
//   actions[]     [{act}|{reject}]  the ordered action log (R3)                [optional]
//   events[]      kernel event stream, in order (DR-6: the only source of
//                 kill/elite/boss counts — snapshot() has none)                [optional]
//   score         {total, lines[{key,label,count,each,points}], counts{}}      [optional]
//   badges[]      [{id,name,condition}]  SEPARATE from score; never add to it  [optional]
//
// OPTIONAL-ON-READ is not a stylistic choice: 150 legacy lines at sim-out/runs.jsonl
// carry no v, engineVersion, actions, events, score, badges or profile. They must keep
// loading, and per DR-7 they must yield NO score rather than a guessed one.
import { hash } from './state.js';
import { parsePlayId } from './actions.js';
import { ENCOUNTERS } from './rules/encounters.js';

/** Schema version of the lines this module writes. */
export const RECORD_VERSION = 1;

/** Newest-N retention (DR-3, requirements §10: "newest 100 runs retained"). */
export const RETAIN = 100;

/**
 * The frozen score table (PM ruling §11.1). Order is the order it is itemised in.
 *
 * `count` is supplied by deriveCounts(); `boss` and `victory` are 0/1 flags rather
 * than tallies, so they read as "+50 for the boss" instead of "+50 each time".
 * BADGES ARE NOT HERE. They are a separate list and never add to the total (§11.1).
 */
export const SCORE_TABLE = Object.freeze([
  Object.freeze({ key: 'floors', label: 'Floors climbed', each: 5 }),
  Object.freeze({ key: 'kills', label: 'Enemies killed', each: 2 }),
  Object.freeze({ key: 'elites', label: 'Elites killed', each: 10 }),
  Object.freeze({ key: 'boss', label: 'Boss defeated', each: 50 }),
  Object.freeze({ key: 'victory', label: 'Victory', each: 100 }),
  Object.freeze({ key: 'cards', label: 'Cards played', each: 1 }),
]);

/**
 * Derive every score input from the PERSISTED record alone (DR-6, AC-7.2).
 *
 * Nothing here reads the live session: a score derived from a record is reproducible
 * from the record, which is what makes AC-7.2 a property instead of a hope.
 *
 * Kill / elite / boss counts come from the kernel `events` stream because `snapshot()`
 * carries no such counters at all. The kernel emits:
 *   combat_start {node, encounter, enemies[]}   — roster + which encounter this is
 *   damage {target, hp}                          — a target reaching hp<=0 is a death
 *   combat_won                                   — every enemy of that combat is dead
 * A death is counted per (combat, target) pair, so a multi-hit attack that reports
 * hp<=0 three times counts one kill, and a player-side hit (no `target`) counts none.
 * @param {any} record
 * @returns {{floors: number, kills: number, elites: number, boss: number, victory: number, cards: number}}
 */
export function deriveCounts(record) {
  const events = Array.isArray(record?.events) ? record.events : [];
  const seenDead = new Set();
  let combatSeq = -1;
  let elites = 0;
  let boss = 0;
  let isElite = false;
  let isBoss = false;

  for (const ev of events) {
    if (ev === null || typeof ev !== 'object') continue;
    if (ev.t === 'combat_start') {
      combatSeq += 1;
      seenDead.clear();
      const enc = typeof ev.encounter === 'string' ? ENCOUNTERS[ev.encounter] : null;
      isElite = Boolean(enc?.elite);
      isBoss = Boolean(enc?.boss);
    } else if (ev.t === 'damage') {
      if (typeof ev.target === 'number' && typeof ev.hp === 'number' && ev.hp <= 0) {
        const key = `${combatSeq}:${ev.target}`;
        if (!seenDead.has(key)) seenDead.add(key);
      }
    } else if (ev.t === 'combat_won') {
      if (isElite) elites += 1;
      if (isBoss) boss += 1;
    }
  }

  const actions = Array.isArray(record?.actions) ? record.actions : [];
  let cards = 0;
  for (const entry of actions) {
    // parsePlayId is the kernel's own action-id parser — never a hand-rolled regex,
    // so this count cannot drift from what the engine considers a played card.
    if (entry && typeof entry.act === 'string' && parsePlayId(entry.act) !== null) cards += 1;
  }

  return {
    // The record's own `floor` is what the player is shown, so a player can check the
    // arithmetic against the history screen (§11.1). No off-by-one correction is applied
    // here, because a number the player cannot reconcile is worse than a conservative one.
    floors: Math.max(0, Math.trunc(Number(record?.floor) || 0)),
    kills: seenDead.size,
    elites,
    boss,
    victory: record?.outcome === 'win' ? 1 : 0,
    cards,
  };
}

/**
 * The itemised score (AC-7.1), or **null** when the record cannot yield one (DR-7).
 *
 * Pure. A legacy line has no `actions` array, so no score is derivable and none is
 * invented: the caller renders absence, never a guess.
 * @param {any} record
 * @returns {{total: number, lines: Array<{key: string, label: string, count: number, each: number, points: number}>, counts: any} | null}
 */
export function scoreRun(record) {
  if (record === null || typeof record !== 'object') return null;
  if (!Array.isArray(record.actions)) return null; // DR-7: not derivable => absent
  const counts = deriveCounts(record);
  const lines = SCORE_TABLE.map((row) => {
    const count = counts[row.key] ?? 0;
    return { key: row.key, label: row.label, count, each: row.each, points: count * row.each };
  });
  const total = lines.reduce((sum, line) => sum + line.points, 0);
  return { total, lines, counts };
}

/**
 * Build the record for a finished (or in-progress) run.
 *
 * One function, both surfaces (AC-6.5). `state`/`submitted`/`events` come from
 * surface/session.js; everything else is run metadata supplied by the caller.
 * @param {{state: any, submitted?: any[], events?: any[], policy?: string, provenance?: string,
 *          profile?: string, collect?: boolean, payloadTokens?: any, samples?: number,
 *          bossArrival?: any, bossHpRemaining?: number|null, badges?: any[]}} opts
 * @returns {any} record
 */
export function buildRunRecord(opts) {
  const state = opts.state;
  const submitted = Array.isArray(opts.submitted) ? opts.submitted : [];
  const events = Array.isArray(opts.events) ? opts.events : [];
  const rejected = submitted.filter((e) => e && typeof e === 'object' && 'reject' in e).length;
  const cardsPlayed = submitted.filter((e) => e && typeof e.act === 'string' && parsePlayId(e.act) !== null).length;

  // The run's identity is the state hash (DR-3). `hash` is kept as an alias so a
  // pre-DR-3 reader of these lines keeps working after the name became `id`.
  const id = hash(state);

  const record = {
    v: RECORD_VERSION,
    id,
    hash: id,
    contentVersion: state.contentVersion,
    seed: state.seed,
    character: state.character,
    difficulty: state.difficulty,
    profile: opts.profile ?? 'full',
    policy: opts.policy ?? 'human',
    provenance: opts.provenance ?? 'human',
    steps: submitted.length,
    outcome: state.outcome ?? 'unfinished',
    floor: state.floor,
    hp: state.player.hp,
    maxHp: state.player.maxHp,
    deckSize: state.deck.length,
    deck: state.deck.map((c) => c.cardId),
    rejected,
    malformedRate: submitted.length === 0 ? 0 : rejected / submitted.length,
    // The action log is what makes the score derivable and the run replayable (R3).
    actions: submitted.map((e) => ('reject' in e ? { reject: e.reject } : { act: e.act })),
    events,
  };

  if (opts.badges !== undefined) record.badges = opts.badges;
  if (opts.offered !== undefined) record.offered = opts.offered;
  if (opts.taken !== undefined) record.taken = opts.taken;
  if (opts.collect) {
    record.payloadTokens = opts.payloadTokens ?? null;
    record.samples = opts.samples ?? 0;
  }
  // Additive: absent when the run never reached the boss, so a stats reader can tell
  // "did not arrive" from "arrived at 0 HP".
  if (opts.bossArrival !== undefined && opts.bossArrival !== null) {
    record.bossArrival = opts.bossArrival;
    record.bossHpRemaining = opts.bossHpRemaining ?? null;
  }

  const score = scoreRun(record);
  if (score !== null) record.score = score;
  void cardsPlayed;
  return record;
}

/** An empty cumulative aggregate. Folding is additive, so this is the identity. */
export function emptyAgg() {
  return {
    runs: 0,
    wins: 0,
    losses: 0,
    unfinished: 0,
    floors: {},
    score: { count: 0, total: 0, max: null },
    badges: {},
  };
}

/**
 * Fold one record, or an array of them, into a cumulative aggregate.
 *
 * WHY THIS EXISTS (DR-3): when retention drops the oldest runs, their contribution must
 * already be folded in, or every lifetime total would *decay* as the player keeps
 * playing. Folding is monotone: numbers only ever grow.
 * @param {any|any[]} input a record, or an array of records
 * @param {any} [prev] the aggregate to fold into
 * @returns {any} a new aggregate
 */
export function aggregate(input, prev = emptyAgg()) {
  const base = prev ?? emptyAgg();
  const acc = {
    runs: base.runs ?? 0,
    wins: base.wins ?? 0,
    losses: base.losses ?? 0,
    unfinished: base.unfinished ?? 0,
    floors: { ...(base.floors ?? {}) },
    score: { ...(base.score ?? { count: 0, total: 0, max: null }) },
    badges: { ...(base.badges ?? {}) },
  };
  const list = Array.isArray(input) ? input : [input];
  for (const record of list) {
    if (record === null || typeof record !== 'object') continue;
    acc.runs += 1;
    if (record.outcome === 'win') acc.wins += 1;
    else if (record.outcome === 'loss') acc.losses += 1;
    else acc.unfinished += 1;
    const floor = Math.trunc(Number(record.floor));
    if (Number.isFinite(floor)) acc.floors[floor] = (acc.floors[floor] ?? 0) + 1;
    const score = record.score ?? scoreRun(record);
    if (score !== null && score !== undefined) {
      acc.score.count += 1;
      acc.score.total += score.total;
      acc.score.max = acc.score.max === null ? score.total : Math.max(acc.score.max, score.total);
    }
    for (const badge of Array.isArray(record.badges) ? record.badges : []) {
      if (badge && typeof badge.id === 'string') acc.badges[badge.id] = (acc.badges[badge.id] ?? 0) + 1;
    }
  }
  return acc;
}

/** Lifetime mean score over SCORED runs only, or null when there are none (DR-7). */
export function aggScoreMean(agg) {
  const score = agg?.score;
  if (!score || !score.count) return null;
  return score.total / score.count;
}

/**
 * Apply newest-N retention in APPEND ORDER, folding the dropped runs into `agg` first.
 *
 * Pure: it returns the kept list, the dropped list and the new aggregate; the caller
 * decides when to touch a file.
 * @param {any[]} records in append order
 * @param {{keep?: number, agg?: any}} [opts]
 * @returns {{kept: any[], dropped: any[], agg: any}}
 */
export function pruneRuns(records, opts = {}) {
  const keep = Number.isInteger(opts.keep) && opts.keep >= 0 ? opts.keep : RETAIN;
  const list = Array.isArray(records) ? records : [];
  const agg = opts.agg ?? emptyAgg();
  if (list.length <= keep) return { kept: list.slice(), dropped: [], agg };
  const cut = list.length - keep;
  const dropped = list.slice(0, cut);
  const kept = list.slice(cut);
  return { kept, dropped, agg: aggregate(dropped, agg) };
}

/** The full-pool card count a record was played against, when it is derivable. */
export function isLegacyRecord(record) {
  return !Array.isArray(record?.actions);
}
