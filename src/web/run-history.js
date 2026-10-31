// src/web/run-history.js — the run ledger: browser storage, scoring screens, unlocks.
//
// WHAT THIS OWNS: the shape of browser storage, the layout of the history screens, and
// every word on them. WHAT IT DOES NOT OWN: any game fact. The score comes from
// `scoreRun`, the counts from the kernel's own event stream, the marks from
// `badgesForRun`, the unlock verdict from `evaluateUnlocks`, the card pool from
// `contentForProfile`. `localStorage` is host state the kernel is forbidden to touch (R3),
// so the persistence belongs here and only here.
//
// THE TWO ERAS (DR-7). A stored record with no `actions` array yields
// `scoreRun(record) === null`: no score is derivable, so NO score is shown — not a dash,
// not a zero, not an estimate. `not scored` in --faint stands where a scored row shows a
// total, in ONE time-ordered list. An honest gap beats a plausible fiction.
//
// RETENTION (AC-6.4). The newest RETAIN records are kept, the cap is STATED on the screen
// (a silent cap is a defect), and a lifetime aggregate is folded for every finished run so
// that "floors climbed" can never DECAY when the oldest record is dropped.
//
// The records, the unlock bookkeeping and the save-failure flag are written ONLY here
// (`newGame` resets the run outcome through `resetRunOutcome()`), so they need no setters.

import {
  RELIC_TOTAL,
  RELIC_UNLOCK_TABLE,
  RETAIN,
  SHIPPED_CARDS,
  UNLOCK_CATALOG,
  aggregate,
  badgesForRun,
  buildRunRecord,
  contentForProfile,
  emptyAgg,
  evaluateRelicUnlocks,
  evaluateUnlocks,
  fullyUnlockedProfile,
  pruneRuns,
  relicDef,
  relicPoolFor,
  scoreRun,
} from '../kernel/index.js';


import { el } from './dom.js';
import { ctl, runEvents } from './runtime.js';
import { currentLang, t } from './i18n.js';

/* -------------------------------------------------------------------- RUN HISTORY */
//
// WHAT THIS OWNS: the shape of browser storage, the layout of the history screens, and
// every word on them. WHAT IT DOES NOT OWN: any game fact. The score comes from
// `scoreRun`, the counts from the kernel's own event stream, the marks from
// `badgesForRun`, the unlock verdict from `evaluateUnlocks`, the card pool from
// `contentForProfile`. `localStorage` is host state the kernel is forbidden to touch (R3),
// so the persistence belongs here and only here.
//
// THE TWO ERAS (DR-7). A stored record with no `actions` array yields
// `scoreRun(record) === null`: no score is derivable, so NO score is shown — not a dash,
// not a zero, not an estimate. `not scored` in --faint stands where a scored row shows a
// total, in ONE time-ordered list. An honest gap beats a plausible fiction.
//
// RETENTION (AC-6.4). The newest RETAIN records are kept, the cap is STATED on the screen
// (a silent cap is a defect), and a lifetime aggregate is folded for every finished run so
// that "floors climbed" can never DECAY when the oldest record is dropped.

export const RUNS_KEY = 'dlb.runs.v1';
export const UNLOCKS_KEY = 'dlb.unlocks.v1';
/** How many rows are painted before the "Show more" control. The full list stays in memory;
 *  this only bounds the first paint, so a 100-run history does not build 100 buttons at once. */
export const LEDGER_PAGE = 25;

/** `?pool=full` — the tester flag (DR-5). It has NO UI surface by design: a tester who is
 *  told "this build draws from the whole pool" must be blind to which pool they got, or the
 *  measure is biased. Drawing it as a control would be a control that lies. */
const fullPool = (() => {
  try { return new URLSearchParams(location.search).get('pool') === 'full'; }
  catch { return false; }
})();

export function storeGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}
/** `false` when the browser refused the write (private mode, quota, storage disabled). */
export function storePut(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

/** Every record this browser holds, oldest first, with the lifetime aggregate beside it. */
let history = { records: [], agg: emptyAgg() };
/** Only the bits of unlock state that are NOT derivable: which unlocks were already
 *  narrated, and which record crossed which threshold. */
let unlocksState = { narrated: [], byRecord: {} };
/** The record for the run that just ended, and the unlock verdict that run produced. */
export let lastRecord = null;
export let lastUnlock = null;
/** `false` once a write was refused, so the summary can say so instead of pretending. */
export let savedOk = true;
/** Set when retention has dropped a record at some point in this session. */
let evictedThisSession = false;

/** The kernel's counters, read as an unlock profile. Mirrors surface/runs.js `profileFor`.
 *  S10: the lifetime WIN count rides along — the relic milestones' counter. */
export function profileOf(agg) {
  const badges = {};
  for (const [id, n] of Object.entries(agg?.badges ?? {})) badges[id] = Number(n) > 0;
  return { scoreTotal: agg?.score?.total ?? 0, runs: agg?.runs ?? 0, wins: agg?.wins ?? 0, badges };
}
/** The profile the NEXT run is built for: the player's own lifetime counters. */
export function currentProfile() {
  return fullPool ? fullyUnlockedProfile() : profileOf(history.agg);
}
/** The `profile` a record is stamped with — which pool this run was actually drawn from. */
export const poolLabel = () => (fullPool ? 'full' : 'fresh');

/** The number of cards that exist for a profile, MEASURED from the kernel's own narrowing
 *  rather than assumed, so "Cards in play: n of 42" cannot drift from what is dealt. */
let cardsInPlayCache = { key: '', n: null };
export function cardsInPlay(profile) {
  const key = `${profile.scoreTotal}|${profile.runs}|${Object.values(profile.badges ?? {}).filter(Boolean).length}|${fullPool}`;
  if (cardsInPlayCache.key !== key) {
    let n = null;
    try { n = contentForProfile(profile).cardList.length; } catch { n = null; }
    cardsInPlayCache = { key, n };
  }
  return cardsInPlayCache.n;
}

export function loadHistory() {
  const runs = storeGet(RUNS_KEY);
  if (runs && Array.isArray(runs.records)) {
    const good = runs.records.filter((r) => r !== null && typeof r === 'object' && !Array.isArray(r));
    // A malformed entry is dropped rather than rendered as a broken row, and the loss is
    // REPORTED: silently discarding a stored run would make the list disagree with itself.
    if (good.length !== runs.records.length) savedOk = false;
    history.records = good;
    history.agg = runs.agg && typeof runs.agg === 'object' ? runs.agg : aggregate(good);
  }
  const un = storeGet(UNLOCKS_KEY);
  if (un) {
    if (Array.isArray(un.narrated)) unlocksState.narrated = un.narrated.filter((s) => typeof s === 'string');
    if (un.byRecord && typeof un.byRecord === 'object') unlocksState.byRecord = un.byRecord;
  }
}
loadHistory();

/**
 * The itemised score for a record, or **null** when none is derivable (DR-7).
 * @param {any} record
 */
export function ledgerMath(record) {
  const score = scoreRun(record);
  if (score === null || score === undefined) return null;
  const counts = score.counts ?? {};
  const lines = score.lines.map((row) => {
    // `boss` and `victory` are 0/1 flags, not tallies, so they read "no"/"yes" with a
    // signed value while a count reads "3 × 5". Zeros stay EXPLICIT on every line: a
    // missing line is indistinguishable from a zero, and the formula has to be learnable.
    const flag = row.key === 'boss' || row.key === 'victory';
    return {
      key: row.key,
      label: row.label,
      math: flag ? (row.count > 0 ? 'yes' : 'no') : `${row.count} × ${row.each}`,
      points: flag ? `+${row.points}` : String(row.points),
    };
  });
  // AC-7.4: an elite, the boss or a victory is what EARNS the display-size total. Nothing
  // else may promote it — the total is a consequence of what happened, not a reward for
  // having played at all.
  const earned = (counts.elites ?? 0) > 0 || (counts.boss ?? 0) > 0 || (counts.victory ?? 0) > 0;
  return { total: score.total, lines, counts, earned };
}

/** The factual recognition that replaces an advice-only line on a hollow run (AC-7.4). */
export function recognitionText(math) {
  const c = math.counts ?? {};
  const floor = c.floors ?? 0;
  const kills = c.kills ?? 0;
  return t('ledger.recognition', {
    floor,
    floorPlural: floor === 1 ? t('end.floors.one') : t('end.floors', { n: floor }),
    kills: kills === 1 ? t('end.enemies.one') : t('end.enemies', { n: kills }),
  });
}

/**
 * The score ledger. A REAL list, so every contributing line is individually reachable
 * (AC-7.1) rather than being one text block whose arithmetic must be re-derived by hand.
 * The line LABELS come from the kernel's frozen SCORE_TABLE (English until I18N-2 sweeps
 * the record layer); the math words ("yes"/"no") and the Total are this file's own and
 * localize here.
 * @param {ReturnType<typeof ledgerMath>} math
 */
export function ledgerBlock(math) {
  const block = el('div', { cls: 'run-ledger', attrs: { role: 'list', 'aria-label': t('ledger.aria') } });
  for (const line of math.lines) {
    block.append(el('div', { cls: 'ledger-line', attrs: { role: 'listitem' } },
      el('span', { cls: 'ledger-label', text: line.label }),
      el('span', { cls: 'ledger-math', text: line.math }),
      el('span', { cls: 'ledger-points', text: line.points }),
    ));
  }
  block.append(el('div', { cls: 'ledger-rule', attrs: { 'aria-hidden': 'true' } }));
  block.append(el('div', { cls: 'ledger-total' + (math.earned ? ' is-earned' : ''), attrs: { role: 'listitem' } },
    el('span', { cls: 'ledger-total-label', text: t('ledger.total') }),
    el('span', { cls: 'ledger-total-value', text: String(math.total) }),
  ));
  return block;
}

/** Which catalog threshold an unlock was met by, as a sentence (AC-9.2: the THRESHOLD
 *  CROSSED is half of what has to be stated, not just "unlocked!"). */
export function unlockThresholdLine(entry, info) {
  const at = entry?.at ?? null;
  if (at && typeof at.score === 'number') return t('unlock.threshold.score', { score: info.scoreTotalAfter, mark: at.score });
  if (at && typeof at.runs === 'number') return t('unlock.threshold.runs', { runs: info.runCountAfter, mark: at.runs });
  return t('unlock.threshold.condition', { condition: entry?.condition ?? 'a threshold' });
}

/** The relic milestone an unlock was met by, as a sentence — the AC-9.2 rule in its
 *  S10 register: the WINS mark crossed, never just "unlocked!". The sentence frames are
 *  dictionary keys (relicThreshold.*), so a future sweep finds them like every other
 *  string; only the marks list's own join word stays composed here. */
export function relicThresholdLine(ids, winsAfter) {
  const rows = (RELIC_UNLOCK_TABLE ?? []).filter((row) => row.ids.some((id) => ids.includes(id)));
  const winWord = (n) => (n === 1 ? t('unlock.win.one') : t('unlock.win'));
  const marks = rows.map((row) => `${row.at} ${winWord(row.at)}`);
  if (marks.length > 0) {
    return t('relicThreshold.crossed', {
      n: winsAfter,
      plural: winWord(winsAfter),
      marks: marks.join(currentLang() === 'es' ? ' y ' : ' and '),
      marksPlural: marks.length === 1 ? '' : 's',
      marksClause: t(marks.length === 1 ? 'relicThreshold.marksClause' : 'relicThreshold.marksClausePlural'),
    });
  }
  return t('relicThreshold.plain', { n: winsAfter, plural: winWord(winsAfter) });
}

/** The post-run narration block: threshold crossed, option opened, pool size, limitation. */
export function unlockBlock(info) {
  const block = el('div', { cls: 'unlock-block' });
  for (const unlocked of info.newly) {
    const entry = (UNLOCK_CATALOG ?? []).find((e) => e.id === unlocked.id) ?? null;
    block.append(el('p', { cls: 'unlock-head', text: t('unlock.head', { name: unlocked.name }) }));
    block.append(el('p', { cls: 'unlock-that', text: unlockThresholdLine(entry, info) }));
    // The kernel's own narration sentence: what the option now IS. Never "you are
    // stronger" — an unlock adds an OPTION, and the framing may not imply the game eased.
    // The narration text is frozen kernel content — English until I18N-2 sweeps the
    // record layer (an honest fallback, like the card names).
    block.append(el('p', { cls: 'unlock-line', text: unlocked.narration }));
  }
  // S10 RELICS: the same narration, relic-shaped. A win that crossed a milestone names
  // what future climbs can now be offered (the run's own rewards are unchanged — an
  // unlock adds an option for the NEXT run, never power in this one), states the WINS
  // mark crossed, and counts the pool honestly. Unknown ids (a stale build) name
  // themselves — the raw-id degrade, never a blank.
  const relics = info.relics ?? null;
  if (relics && relics.newly.length > 0) {
    const names = relics.newly.map((id) => relicDef(id)?.name ?? id);
    block.append(el('p', { cls: 'unlock-head', text: t('unlock.relics.head') }));
    block.append(el('p', { cls: 'unlock-line', text: t('unlock.relics.line', { names: names.join(', ') }) }));
    block.append(el('p', { cls: 'unlock-that', text: relicThresholdLine(relics.newly, relics.winsAfter) }));
  }
  const inPlay = info.cardsAfter;
  if (typeof inPlay === 'number') {
    block.append(el('p', { cls: 'unlock-pool', text: t('unlock.pool.cards', { n: inPlay, m: SHIPPED_CARDS }) }));
  }
  if (relics && typeof relics.countAfter === 'number') {
    block.append(el('p', { cls: 'unlock-pool', text: t('unlock.pool.relics', { n: relics.countAfter, m: RELIC_TOTAL }) }));
  }
  // The limitation, stated plainly ONCE, in the kernel's frozen-content terms: the pool is
  // re-ordered and gated, it is never enlarged.
  block.append(el('p', { cls: 'unlock-limit', text: t('unlock.limit', { n: SHIPPED_CARDS }) }));
  return block;
}

/**
 * Write the record for the run that just ended.
 *
 * ORDER IS THE INVARIANT: build the record from the kernel's own state, attach the marks
 * the kernel derives from it, ask the kernel what this run OPENED, then fold and persist.
 * Asking after folding would report the aggregate as the "before" and lose every threshold
 * this very run crossed.
 */
export function recordRun() {
  const record = buildRunRecord({
    state: ctl.state,
    submitted: ctl.submitted,
    events: runEvents,
    profile: poolLabel(),
    policy: 'human',
    provenance: 'human',
  });
  const marks = badgesForRun(record);
  if (marks.length > 0) record.badges = marks;

  const before = profileOf(history.agg);
  const verdict = evaluateUnlocks(before, record);
  const newly = (verdict.newly ?? []).filter((u) => !unlocksState.narrated.includes(u.id));

  history.agg = aggregate(record, history.agg);
  const after = profileOf(history.agg);
  // S10 RELICS: the same order the card verdict keeps — the BEFORE profile is read
  // before the fold, the AFTER after it, so the win this very run earned counts. A
  // loss crosses no milestone (evaluateRelicUnlocks's before/after agree) and the
  // block stays out of the screen entirely.
  const relicVerdict = evaluateRelicUnlocks(before.wins ?? 0, after.wins ?? 0);
  const relicNewly = relicVerdict.newly;

  const next = [...history.records, record];
  const pruned = pruneRuns(next, { keep: RETAIN });
  if (pruned.dropped.length > 0) evictedThisSession = true;
  history.records = pruned.kept;

  savedOk = storePut(RUNS_KEY, { v: 1, records: history.records, agg: history.agg });
  for (const unlocked of newly) if (!unlocksState.narrated.includes(unlocked.id)) unlocksState.narrated.push(unlocked.id);
  const byRecord = { ...unlocksState.byRecord };
  // Keyed by the record's own identity (the kernel's state hash). Two identical replays
  // share a key, which is correct rather than a collision: identical state means identical
  // thresholds, so the annotation is the same fact.
  if (newly.length > 0) byRecord[record.id] = newly.map((u) => u.id);
  unlocksState.byRecord = byRecord;
  if (!storePut(UNLOCKS_KEY, { v: 1, narrated: unlocksState.narrated, byRecord })) savedOk = false;

  lastRecord = record;
  lastUnlock = newly.length > 0 || relicNewly.length > 0
    ? {
      newly,
      scoreTotalAfter: history.agg.score?.total ?? 0,
      runCountAfter: history.agg.runs ?? 0,
      cardsBefore: cardsInPlay(before),
      cardsAfter: cardsInPlay(after),
      // S10: the relic story beside the card story — what the win opened, the WINS
      // mark it crossed, and the pool the NEXT run's drops will draw from. The
      // narration fires on the SAME hook (lastUnlock) so the end screen shows both
      // stories in one block, in one place, or neither.
      relics: {
        newly: relicNewly,
        winsAfter: after.wins ?? 0,
        countAfter: relicPoolFor(after).length,
      },
    }
    : null;
  cardsInPlayCache = { key: '', n: null };
}

/** The cumulative score reached by (and including) one record, from the stored order. */
export function cumulativeAt(record) {
  let sum = 0;
  for (const r of history.records) {
    sum += scoreRun(r)?.total ?? 0;
    if (r === record) return sum;
  }
  return sum;
}

/** The persistent unlock line for a stored entry, if that run crossed a threshold. */
export function unlockPersistentLine(record) {
  const ids = unlocksState.byRecord?.[record.id] ?? [];
  const names = [];
  let score = null;
  let runs = null;
  for (const id of ids) {
    const entry = (UNLOCK_CATALOG ?? []).find((e) => e.id === id);
    if (!entry) continue;
    names.push(entry.name);
    if (typeof entry.at?.score === 'number') score = entry.at.score;
    if (typeof entry.at?.runs === 'number') runs = entry.at.runs;
  }
  if (names.length === 0) return null;
  if (score !== null) return `Unlocked at score ${cumulativeAt(record)}: ${names.join('; ')}.`;
  if (runs !== null) return `Unlocked after ${runs} ${runs === 1 ? 'run' : 'runs'}: ${names.join('; ')}.`;
  return `Unlocked by this run: ${names.join('; ')}.`;
}

/**
 * Reset the run-outcome bookkeeping for a NEW run (`newGame` calls this): the ended
 * screen of the new run must not show the previous run's record, and a fresh run has not
 * failed to save anything.
 */
export function resetRunOutcome() {
  lastRecord = null;
  lastUnlock = null;
  savedOk = true;
}
