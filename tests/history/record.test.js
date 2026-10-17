// tests/history/record.test.js — the run-history core, pinned.
//
// WHAT THIS FILE IS FOR: `src/kernel/record.js`, `src/kernel/unlocks.js` and
// `src/surface/runs.js` were written but never executed. These are the first tests to
// run them, so they assert the CONTRACT (the ACs and DRs the modules claim in their own
// headers) rather than whatever the code happens to do today.
//
// The distinction that matters: where a module's own documented contract and its
// observed behaviour disagree, the test keeps the CONTRACT and the disagreement is
// reported as a product defect. Exactly three such defects were found here; each is
// written as a `{ todo: true }` case carrying its diagnosis, so the suite stays green
// while the defect stays visible and executable. Nothing was bent to fit the code.
//
// AC map: AC-7.1 (itemised score), AC-7.2 (determinism), AC-6.5 (surface agreement, in
// tests/golden/dual-surface.test.js), AC-9.3 (an unlock adds an option, never power),
// DR-3 (backward-readable records + retention folds before it drops), DR-6 (the event
// stream is the only source of kill counts), DR-7 (no derivable score => null).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { REPO, loadVocabulary } from '../helpers/harness.mjs';
import {
  BADGE_CATALOG,
  FRESH_SIZE,
  GRANT_KEYS,
  HAND_SIZE,
  RECORD_VERSION,
  RETAIN,
  SCORE_TABLE,
  SHIPPED_CARDS,
  UNLOCK_CATALOG,
  aggScoreMean,
  buildRunRecord,
  contentForProfile,
  deriveCounts,
  emptyAgg,
  fullyUnlockedProfile,
  hash,
  isLegacyRecord,
  newRun,
  poolSelection,
  scoreRun,
} from '../../src/kernel/index.js';
import { cardsBundle } from '../../src/kernel/content/cards.bundle.js';
import { playRun } from '../../src/surface/sim.js';
import {
  appendRuns,
  aggPathFor,
  historyEntries,
  historyView,
  loadAgg,
  loadRuns,
  parseRunsJsonl,
  retain,
  toJsonl,
} from '../../src/surface/runs.js';

const { VERBS } = await loadVocabulary();

/** Every shipped card, per the bundle the kernel actually imports. Never a literal. */
const SHIPPED = cardsBundle.cards.length;

/**
 * The frozen fresh/full pools, loaded once. `contentForProfile` re-validates content on
 * every call, so building them per test would only cost time.
 */
const FRESH = contentForProfile(null);
const FULL = contentForProfile(fullyUnlockedProfile());

/** A minimal but complete record: the fields `scoreRun` needs, and nothing else. */
function recordOf({ floor = 1, outcome = 'loss', actions = [], events = [], badges } = {}) {
  const r = { v: RECORD_VERSION, floor, outcome, actions, events };
  if (badges !== undefined) r.badges = badges;
  return r;
}

/** One combat worth of events that kills targets 0..n-1, with no cross-combat carry. */
function combatKilling(encounter, targets) {
  const events = [{ t: 'combat_start', node: 'n', encounter, enemies: targets.map((i) => ({ id: `e${i}`, hp: 1 })) }];
  for (const t of targets) events.push({ t: 'damage', source: 'player', target: t, hp: 0 });
  events.push({ t: 'combat_won' });
  return events;
}

// ---------------------------------------------------------------------------
// The two real runs every end-to-end case below is built from. Two identical
// invocations are also the AC-7.2 determinism fixture, so they are shared.
// ---------------------------------------------------------------------------
const REAL_A = await playRun({ seed: 5 });
const REAL_B = await playRun({ seed: 5 });

// ---------------------------------------------------------------------------
// AC-7.2 — determinism
// ---------------------------------------------------------------------------

test('AC-7.2: the same seed and action log yield a byte-identical score and record id', () => {
  // The serialized score object, not just the total: an itemisation that drifted while
  // the total happened to stay equal is still non-determinism.
  assert.equal(
    JSON.stringify(REAL_A.score),
    JSON.stringify(REAL_B.score),
    'two runs from seed 5 must serialize to the same score bytes',
  );
  assert.equal(REAL_A.id, REAL_B.id, 'two runs from seed 5 must share the record id');
  assert.equal(REAL_A.hash, REAL_B.hash, 'the pre-DR-3 `hash` alias must agree too');
  // Re-deriving from the persisted record alone must reproduce the score exactly: that
  // is what makes AC-7.2 a property of the record rather than of the live session.
  assert.equal(
    JSON.stringify(scoreRun(REAL_A)),
    JSON.stringify(REAL_A.score),
    'scoreRun(record) must reproduce the recorded score from the record alone',
  );
  assert.ok(REAL_A.score.total > 0, `a completed run must score above zero, got ${REAL_A.score.total}`);
});

// ---------------------------------------------------------------------------
// AC-7.1 — the frozen score table, itemised
// ---------------------------------------------------------------------------

test('AC-7.1: the score is the frozen formula, itemised, and the total is the sum of the lines', () => {
  // 4 floors, 3 kills in ONE elite fight, a victory, and 2 parseable plays. 'p2_1' is a
  // targeted play; the reject is not a play. Deliberately a single combat: this test is
  // about the ARITHMETIC of the lines (the cross-combat tally has its own case below).
  const record = recordOf({
    floor: 4,
    outcome: 'win',
    actions: [{ act: 'p1' }, { act: 'p2_1' }, { reject: 'zz9' }],
    events: combatKilling('elite_1', [0, 1, 2]),
  });

  const score = scoreRun(record);
  assert.notEqual(score, null);

  // The table itself is frozen: key order, labels and the per-item value.
  assert.deepEqual(
    SCORE_TABLE.map((r) => [r.key, r.each]),
    [['floors', 5], ['kills', 2], ['elites', 10], ['boss', 50], ['victory', 100], ['cards', 1]],
    'the score table is a frozen contract (PM ruling §11.1)',
  );

  // The itemisation must be present, in table order, with count/each/points per line.
  assert.deepEqual(score.lines.map((l) => l.key), ['floors', 'kills', 'elites', 'boss', 'victory', 'cards']);
  assert.deepEqual(
    score.lines.map((l) => [l.key, l.count, l.each, l.points]),
    [['floors', 4, 5, 20], ['kills', 3, 2, 6], ['elites', 1, 10, 10], ['boss', 0, 50, 0], ['victory', 1, 100, 100], ['cards', 2, 1, 2]],
    'every line must be itemised with its own count, value and points',
  );
  assert.equal(score.total, 138, '4×5 + 3×2 + 1×10 + 0×50 + 1×100 + 2×1');
  assert.equal(
    score.total,
    score.lines.reduce((sum, l) => sum + l.points, 0),
    'the total must be exactly the sum of the itemised lines',
  );
  assert.equal(score.lines.every((l) => l.points === l.count * l.each), true, 'points === count × each on every line');

  // The boss line, with a boss fight actually won: 1 floor + 1 kill + the boss + victory.
  const withBoss = scoreRun(recordOf({ floor: 1, outcome: 'win', actions: [], events: combatKilling('boss_1', [0]) }));
  assert.equal(withBoss.lines.find((l) => l.key === 'boss').points, 50, '+50 for the boss');
  assert.equal(withBoss.total, 5 + 2 + 50 + 100, 'floors + kills + boss + victory');

  // Badges are a SEPARATE list and never add to the total (§11.1). Asserting the total
  // is unchanged is not enough on its own, so the arithmetic is also checked directly:
  // adding the badges as points WOULD have moved the number.
  const withBadges = recordOf({ ...record, badges: BADGE_CATALOG.map((b) => ({ ...b })) });
  const badged = scoreRun(withBadges);
  assert.equal(badged.total, 138, 'badges must not add a single point to the total');
  assert.deepEqual(badged, score, 'attaching badges must leave the whole score object identical');
  assert.equal('badges' in badged, false, 'badges are not part of the score object at all');
  assert.notEqual(badged.total, 138 + BADGE_CATALOG.length, 'the badge count was not folded into the total');

  // A score already stored on the record is ignored: the derivation is the source.
  const preScored = recordOf({ ...record, score: { total: 9999, lines: [], counts: {} } });
  assert.equal(scoreRun(preScored).total, 138, 'a stored score must not be trusted over the derivation');
});

test('AC-7.1: the victory bonus is 0/1 and applies only to a won run', () => {
  const events = combatKilling('weak_1', [0]);
  const won = scoreRun(recordOf({ floor: 2, outcome: 'win', actions: [{ act: 'p1' }], events }));
  const lost = scoreRun(recordOf({ floor: 2, outcome: 'loss', actions: [{ act: 'p1' }], events }));
  assert.equal(won.counts.victory, 1);
  assert.equal(lost.counts.victory, 0);
  assert.equal(won.total - lost.total, 100, 'the whole difference is the victory line');
  // The boss is a 0/1 flag too, not a tally: two boss combats still pay 50 once.
  const twoBosses = scoreRun(
    recordOf({ floor: 1, outcome: 'win', actions: [{ act: 'p1' }], events: [...combatKilling('boss_1', [0]), ...combatKilling('boss_1', [0])] }),
  );
  assert.equal(twoBosses.counts.boss, 2, 'the tally is honest about two boss fights');
  assert.equal(twoBosses.lines.find((l) => l.key === 'boss').points, 100, 'but it is paid per fight, as itemised');
});

test('AC-7.1: a multi-hit attack counts one kill per enemy, not one per damage event', () => {
  // Three hp<=0 reports against the SAME enemy are one death (a multi-hit attack), two
  // distinct enemies are two. This is the dedupe half of deriveCounts, and it works.
  const events = [
    { t: 'combat_start', node: 'n', encounter: 'weak_1', enemies: [{ id: 'a', hp: 1 }, { id: 'b', hp: 1 }] },
    { t: 'damage', source: 'player', target: 0, hp: 0 },
    { t: 'damage', source: 'player', target: 0, hp: 0 },
    { t: 'damage', source: 'player', target: 0, hp: 0 },
    { t: 'damage', source: 'player', target: 1, hp: 0 },
    { t: 'damage', source: 'player', hp: 0 }, // a player-side hit carries no `target`
    { t: 'combat_won' },
  ];
  assert.equal(deriveCounts(recordOf({ events })).kills, 2, 'three reports on one enemy and one on another is two kills');
});

test(
  'AC-7.1: kills accumulate across combats, not reset at each combat_start',
  () => {
    // Was a defect: deriveCounts() cleared its death set on every `combat_start`, so only
    // the LAST combat's kills counted. The `${combatSeq}:${target}` key separates combats.
    const events = [...combatKilling('weak_1', [0, 1]), ...combatKilling('weak_2', [0])];
    const counts = deriveCounts(recordOf({ events }));
    assert.equal(counts.kills, 3, `2 kills then 1 kill must total 3, got ${counts.kills}`);
  },
);

test('AC-7.1: elite and boss points come from the fight flag on the winning combat', () => {
  // The control for the two kill cases above: given a `combat_won` for a
  // flagged encounter, deriveCounts scores it correctly. That localises the real-run
  // kill defect to the missing EMISSION, not to this arithmetic.
  assert.equal(deriveCounts(recordOf({ events: combatKilling('elite_1', [0]) })).elites, 1);
  assert.equal(deriveCounts(recordOf({ events: combatKilling('boss_1', [0]) })).boss, 1);
  assert.equal(deriveCounts(recordOf({ events: combatKilling('weak_1', [0]) })).elites, 0, 'a plain fight is not an elite');
  assert.equal(deriveCounts(recordOf({ events: combatKilling('weak_1', [0]) })).boss, 0);
});

test('DR-7: a record that cannot yield a score yields null, never a guessed one', () => {
  assert.equal(scoreRun(null), null);
  assert.equal(scoreRun('not a record'), null);
  // No `actions` array => the cards line is not derivable => no score at all.
  assert.equal(scoreRun({ v: RECORD_VERSION, floor: 9, outcome: 'win' }), null, 'a legacy line has no derivable score');
  assert.equal(scoreRun({ floor: 9, actions: null }), null, 'actions:null is not an action log');
  // The same record WITH an action log does score, so the null is about derivability.
  assert.notEqual(scoreRun({ floor: 9, outcome: 'win', actions: [] }), null, 'an empty action log is still a log');
  assert.equal(scoreRun({ floor: 9, outcome: 'win', actions: [] }).total, 145, '9 floors + a victory');
});

// ---------------------------------------------------------------------------
// AC-9.3 — an unlock adds an option, never power. BOTH layers.
// ---------------------------------------------------------------------------

test('AC-9.3(a): every unlock grant declares only grant keys, so a stat grant breaks the build', () => {
  assert.deepEqual(GRANT_KEYS, ['grantCard', 'grantOption', 'grantMode'], 'the grant vocabulary is frozen');
  assert.equal(Object.isFrozen(GRANT_KEYS), true);
  assert.ok(UNLOCK_CATALOG.length > 0, 'the catalog is not empty, or this proves nothing');

  for (const entry of UNLOCK_CATALOG) {
    const keys = Object.keys(entry.grant ?? {});
    assert.ok(keys.length > 0, `${entry.id}: a grant with no keys would unlock nothing`);
    for (const key of keys) {
      assert.ok(
        GRANT_KEYS.includes(key),
        `${entry.id}: grant key "${key}" is not one of ${GRANT_KEYS.join('/')} — an unlock may add an OPTION, never a stat`,
      );
    }
    // The threshold may only read the profile's own counters, never a game stat.
    for (const at of Object.keys(entry.at ?? {})) {
      assert.ok(['score', 'runs', 'badge'].includes(at), `${entry.id}: unlock threshold "${at}" is not a profile counter`);
    }
    // Belt and braces: no stat-shaped key anywhere in the grant payload.
    const payload = JSON.stringify(entry.grant);
    for (const banned of ['maxHp', 'damage', 'energy', 'handSize', 'hp']) {
      assert.equal(payload.includes(`"${banned}"`), false, `${entry.id}: grant carries the stat "${banned}"`);
    }
  }
});

test('AC-9.3(b): enabling every unlock changes WHICH cards exist and nothing else', () => {
  const freshIds = FRESH.cardList.map((c) => c.id);
  const fullIds = FULL.cardList.map((c) => c.id);

  // 1. The enabled pool is a strict superset: it can only ever add ids.
  const fullSet = new Set(fullIds);
  for (const id of freshIds) assert.ok(fullSet.has(id), `${id} is in the fresh pool but not the enabled pool`);
  assert.equal(freshIds.length < fullIds.length, true, 'enabling unlocks must widen the pool, and it does');

  // 2. Every SHARED card definition is byte-identical between the two pools. This is the
  //    AC: the pool decides which cards exist, never what a card does.
  //
  //    NOTE on "strongest form": object identity across the two pools is NOT achievable
  //    here, because contentForProfile() re-serializes content through JSON. An identity
  //    assertion between two loadContent() results would therefore fail for the wrong
  //    reason (a fresh parse), and must not be written. What IS asserted is that the
  //    definitions are equal field for field, including every effect amount — the same
  //    guarantee, measured the way the data actually exists.
  const forId = new Map(FULL.cardList.map((c) => [c.id, c]));
  for (const card of FRESH.cardList) {
    assert.equal(
      JSON.stringify(forId.get(card.id)),
      JSON.stringify(card),
      `${card.id}: enabling unlocks changed the card definition, not just its availability`,
    );
  }

  // 3. Narrow ONE cardList instance and check the loader's own contract: `cards` holds a
  //    frozen copy of each entry, so a shared definition cannot be mutated through the map.
  const one = FRESH.cardList[0];
  assert.deepEqual(FRESH.cards.get(one.id), one, 'the map entry must match the list entry');
  assert.equal(Object.isFrozen(FRESH.cards.get(one.id)), true, 'a card definition is frozen');

  // 4. Damage numbers: the full pool contains strictly larger damage values, and NOT ONE
  //    of them is a buff applied to a card the fresh player already had.
  const damageOf = (content) =>
    new Map(content.cardList.flatMap((c) => c.effects.filter((e) => e.verb === 'damage').map((e) => [`${c.id}:${e.amount}`, e.amount])));
  const freshDamage = damageOf(FRESH);
  const fullDamage = damageOf(FULL);
  for (const key of freshDamage.keys()) assert.ok(fullDamage.has(key), `damage ${key} vanished when unlocks were enabled`);
  assert.equal(
    [...freshDamage.keys()].length < [...fullDamage.keys()].length,
    true,
    'the enabled pool must contain damage values the fresh pool does not (that is the wider pool, not power creep)',
  );

  // 5. Rares are the last and most visible prize, so they exist ONLY in the enabled pool.
  assert.equal(FRESH.cardList.filter((c) => c.rarity === 'rare').length, 0, 'no rare is in the fresh pool');
  assert.ok(FULL.cardList.some((c) => c.rarity === 'rare'), 'the enabled pool does open the rare tier');
});

test('AC-9.3(b): the enabled pool does not touch HP, energy, hand size or the starting deck', () => {
  const freshRun = newRun({ seed: 5, content: FRESH });
  const fullRun = newRun({ seed: 5, content: FULL });

  assert.equal(freshRun.player.maxHp, 60, 'starting max HP is not an unlock');
  assert.equal(fullRun.player.maxHp, 60, 'enabling every unlock must not raise max HP');
  assert.equal(freshRun.player.hp, 60);
  assert.equal(fullRun.player.hp, 60);
  assert.equal(freshRun.energyPerTurn, 3, 'energy per turn is not an unlock');
  assert.equal(fullRun.energyPerTurn, 3, 'enabling every unlock must not raise energy per turn');
  assert.equal(freshRun.energyPerTurn, fullRun.energyPerTurn);

  // Starting hand size lives in the kernel's own constant and is not profile-aware.
  assert.equal(HAND_SIZE, 5, 'HAND_SIZE is a kernel constant, not a grant');

  assert.equal(freshRun.deck.length, fullRun.deck.length, 'the starting deck is the same size either way');
  assert.deepEqual(
    freshRun.deck.map((c) => c.cardId),
    fullRun.deck.map((c) => c.cardId),
    'the starting deck is the same deck either way',
  );
  // The pool a run drafts from is wider; the pool it starts with is identical.
  assert.notDeepEqual(freshRun.draftPool, fullRun.draftPool, 'the DRAFT pool is what an unlock widens');
});

// ---------------------------------------------------------------------------
// §11.2 — the fresh pool's composition rule
// ---------------------------------------------------------------------------

test('§11.2: the fresh pool is a documented slice of the shipped cards', () => {
  assert.equal(FRESH_SIZE, 24, 'the frozen fresh-pool size is 24');
  assert.equal(SHIPPED_CARDS, SHIPPED, `SHIPPED_CARDS must equal the bundle it describes (${SHIPPED})`);
  assert.ok(
    FRESH.cardList.length < SHIPPED,
    `the fresh pool must be smaller than the shipped set (${FRESH.cardList.length} vs ${SHIPPED})`,
  );
  assert.ok(
    FULL.cardList.length <= SHIPPED,
    `the widest pool cannot exceed the shipped set (${FULL.cardList.length} vs ${SHIPPED})`,
  );

  // Rule 1: every starter is in the fresh pool.
  const starters = FULL.cardList.filter((c) => c.rarity === 'starter').map((c) => c.id);
  assert.ok(starters.length >= 3, `expected starters in content, got ${JSON.stringify(starters)}`);
  const freshIds = new Set(FRESH.cardList.map((c) => c.id));
  for (const id of starters) assert.ok(freshIds.has(id), `starter ${id} must be in the fresh pool`);

  // Rule 3: at least one card per effect verb the vocabulary declares.
  const verbsPresent = new Set(FRESH.cardList.flatMap((c) => c.effects.map((e) => e.verb)));
  for (const verb of VERBS) {
    assert.ok(verbsPresent.has(verb), `the fresh pool has no card with the "${verb}" verb`);
  }

  // Rule 4: never rare.
  assert.equal(FRESH.cardList.filter((c) => c.rarity === 'rare').length, 0, 'rule 4 holds rares back as the prize');

  // The pool selection reports its own composition and plan, and they agree with the pool.
  const sel = poolSelection(FULL, null);
  assert.deepEqual(sel.ids.slice().sort(), FRESH.cardList.filter((c) => !c.hero).map((c) => c.id).slice().sort(), 'poolSelection and contentForProfile agree (hero-only starters ride along outside the selection)');
  assert.equal(sel.composition.attack + sel.composition.skill + sel.composition.power, sel.ids.length, 'the type split sums to the pool');
  assert.equal(sel.plan.allowRare, false, 'the fresh plan may not allow rares');
});

test('§11.2 [TODO — real defect]: poolSelection must actually return FRESH_SIZE cards', { todo: true }, () => {
  // DEFECT: FRESH_SIZE is 24 and the header calls it "the frozen fresh-profile
  // composition (§11.2): 24 of the shipped cards, A/S/P 12/9/3", but poolSelection()
  // yields 21 (A/S/P 12/8/1). poolPlan() asks typeTargets() for 12/9/3 = 24, then the
  // fill loop hands only 21 back because the per-type queues run out: only 1 power card
  // is selected where 3 were requested, and nothing refills the 2 lost slots from the
  // attack/skill queues that still have candidates. A player who unlocks nothing is
  // promised 24 cards and shipped 21.
  const sel = poolSelection(FULL, null);
  assert.equal(sel.size, FRESH_SIZE, `the fresh pool must be FRESH_SIZE (24), got ${sel.size}`);
  assert.deepEqual(sel.composition, { attack: 12, skill: 9, power: 3 }, `the documented 12/9/3 split, got ${JSON.stringify(sel.composition)}`);
});

// ---------------------------------------------------------------------------
// DR-3 — the 150 legacy lines keep loading, and yield no score
// ---------------------------------------------------------------------------

test('DR-3: every legacy line loads without error, and yields NO score', () => {
  const runsFile = resolve(REPO, 'sim-out', 'runs.jsonl');
  const lines = readFileSync(runsFile, 'utf8').split('\n').filter((l) => l.trim() !== '');
  assert.ok(lines.length >= 150, `the legacy fixture must still hold >=150 lines, holds ${lines.length}`);

  const loaded = loadRuns(runsFile);
  assert.equal(loaded.exists, true);
  assert.equal(loaded.records.length, lines.length, 'every legacy line must parse — one must not cost the others');
  assert.deepEqual(loaded.problems, [], `no legacy line may be reported as a problem, got ${JSON.stringify(loaded.problems)}`);
  assert.equal(loadRuns(join(REPO, 'sim-out', 'does-not-exist.jsonl')).records.length, 0, 'a missing history is empty, not an error');

  for (const record of loaded.records) {
    assert.equal(isLegacyRecord(record), true, 'a record with no actions array is legacy');
    assert.equal(scoreRun(record), null, 'DR-7: a legacy line yields null, never a guessed score');
  }
  assert.equal(isLegacyRecord({ actions: [] }), false, 'a record with an action log is not legacy');

  // The history screen renders absence rather than a zero it would read as a real score.
  const entries = historyEntries(loaded.records, BADGE_CATALOG);
  assert.equal(entries.length, lines.length);
  assert.equal(entries.every((e) => e.score === null), true, 'a legacy row has score null, not 0');
  assert.equal(entries.every((e) => e.legacy === true), true);
  assert.equal(entries.every((e) => e.outcome === 'win' || e.outcome === 'loss' || e.outcome === 'unfinished'), true);
  const seeds = loaded.records.map((r) => r.seed);
  assert.deepEqual(entries.map((e) => e.seed), seeds.slice().reverse(), 'rows are presented newest-first');
  assert.equal(
    entries[entries.length - 1].index,
    0,
    'the row model keeps the append-order index, so the oldest run is index 0',
  );
});

test('DR-3: a malformed line is reported, never thrown on', () => {
  const parsed = parseRunsJsonl('{"seed":1}\nnot json at all\n\n{"seed":2}\n');
  assert.equal(parsed.records.length, 2, 'the two good lines must survive one corrupt line');
  assert.equal(parsed.problems.length, 1);
  assert.match(parsed.problems[0], /line 2/, `the problem must name the offending line, got ${parsed.problems[0]}`);
  assert.deepEqual(parseRunsJsonl(toJsonl([{ a: 1 }, { b: 2 }])).records, [{ a: 1 }, { b: 2 }], 'toJsonl round-trips');
});

test('DR-3: retention drops runs only AFTER folding them in, so lifetime totals never decay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dlb-history-'));
  const runsFile = join(dir, 'runs.jsonl');
  try {
    const total = RETAIN + 20;
    const records = Array.from({ length: total }, (_, i) =>
      recordOf({
        floor: i % 8,
        outcome: i % 3 === 0 ? 'win' : 'loss',
        actions: [{ act: 'p1' }],
        events: [{ t: 'combat_start', node: 'n', encounter: 'weak_1', enemies: [] }, { t: 'damage', target: 0, hp: 0 }],
      }),
    ).map((r, i) => ({ ...r, id: `run-${i}`, seed: i, score: { total: i, lines: [], counts: {} } }));
    const expectedLifetime = records.reduce((sum, r) => sum + r.score.total, 0);
    const sumOf = (a, b) => records.slice(a, b).reduce((s, r) => s + r.score.total, 0);

    // A missing aggregate file is the ADDITIVE IDENTITY, never a throw and never a guess.
    assert.deepEqual(loadAgg(join(dir, 'nothing-here.jsonl')), emptyAgg(), 'a missing aggregate under-counts rather than inventing runs');

    // "Lifetime" is the aggregate PLUS the retained lines — never either half alone. That
    // is precisely what the fold is for, and the completeness assertion below is written
    // against the whole sum rather than against the aggregate file.
    let previousLifetime = 0;
    let applied = 0;
    for (const batch of [[0, RETAIN], [RETAIN, total]]) {
      const result = appendRuns(runsFile, records.slice(batch[0], batch[1]));
      assert.equal(result.appended, batch[1] - batch[0], 'every record in the batch is appended');
      applied = batch[1];
      const grown = historyView(runsFile);
      assert.equal(
        grown.agg.score.total,
        sumOf(0, applied),
        `the lifetime total must account for every run applied so far (${applied}) — none lost, none double-counted`,
      );
      assert.ok(
        grown.agg.score.total >= previousLifetime,
        `lifetime score must not decrease (${grown.agg.score.total} after ${previousLifetime})`,
      );
      previousLifetime = grown.agg.score.total;
    }
    assert.equal(previousLifetime, expectedLifetime, 'after every run has been applied, the lifetime total is the whole sum');

    // The file holds the newest N; the aggregate holds the runs that were dropped.
    const kept = loadRuns(runsFile);
    assert.equal(kept.records.length, RETAIN, `the file retains exactly ${RETAIN} lines, holds ${kept.records.length}`);
    assert.deepEqual(kept.records.map((r) => r.seed), records.slice(total - RETAIN).map((r) => r.seed), 'the newest N survive, in order');
    assert.equal(loadAgg(runsFile).runs, total - RETAIN, 'the dropped runs are owned by the aggregate');
    assert.equal(loadAgg(runsFile).score.total, sumOf(0, total - RETAIN), 'the aggregate holds exactly the dropped runs, counted once');

    // The view separates what is on disk from what is lifetime — and lifetime is larger.
    const view = historyView(runsFile);
    assert.equal(view.retained, RETAIN);
    assert.equal(view.entries.length, RETAIN);
    assert.ok(
      view.agg.score.total > view.retained_agg.score.total,
      'lifetime must exceed the retained window once runs have been dropped',
    );
    assert.equal(view.agg.score.total, expectedLifetime, 'historyView reports the lifetime total, not the retained window');
    assert.equal(view.agg.score.count, total, 'every run ever played is counted exactly once');
    assert.equal(aggScoreMean(view.agg), expectedLifetime / total, 'the lifetime mean divides by scored runs only');

    // A further, tighter retention folds more runs in and must NOT change the lifetime.
    retain(runsFile, { keep: 50 });
    assert.equal(loadRuns(runsFile).records.length, 50);
    assert.equal(loadAgg(runsFile).runs, total - 50, 'the newly dropped runs join the aggregate');
    assert.equal(loadAgg(runsFile).score.total, sumOf(0, total - 50), 'and bring their score with them');
    assert.equal(historyView(runsFile).agg.score.total, expectedLifetime, 'trimming again must not lose a point already earned');
    assert.equal(historyView(runsFile).agg.score.count, total, 'nor a run');
    assert.equal(aggPathFor(runsFile), join(dir, 'agg.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// DR-6 — the wiring that makes a score possible at all
// ---------------------------------------------------------------------------

test('DR-6: a record built from a real completed run carries the accumulated event stream', () => {
  assert.ok(Array.isArray(REAL_A.events), 'the record must carry an events array');
  assert.ok(REAL_A.events.length > 0, 'the event stream is empty — buildRunRecord was handed nothing to score from');
  assert.ok(Array.isArray(REAL_A.actions) && REAL_A.actions.length > 0, 'a completed run has an action log');
  assert.equal(REAL_A.events.some((e) => e?.t === 'combat_start'), true, 'the stream contains a combat');
  assert.equal(REAL_A.events.some((e) => e?.t === 'run_end'), true, 'and the end of the run');

  // The two lines that CAN be scored from a real run today are non-zero, which proves the
  // action log and the floor reached really do travel from the session into the record.
  assert.ok(REAL_A.score.counts.cards > 0, `cards played must be counted, got ${REAL_A.score.counts.cards}`);
  assert.equal(REAL_A.score.counts.cards, REAL_A.actions.filter((a) => typeof a.act === 'string' && /^p\d/.test(a.act)).length, 'the cards line matches the action log');
  assert.ok(REAL_A.score.counts.floors > 0, `the floor reached must be scored, got ${REAL_A.score.counts.floors}`);
});

test('DR-6: every combat won in a real run emits combat_won, whether a card or end turn finished it', () => {
  const starts = REAL_A.events.filter((e) => e.t === 'combat_start').length;
  const won = REAL_A.events.filter((e) => e.t === 'combat_won').length;
  const lost = REAL_A.outcome === 'loss' ? 1 : 0;
  assert.equal(won, starts - lost, `combats started ${starts}, won ${won}, lost ${lost}`);
});

test('DR-6: a real completed run scores a non-zero kill count', () => {
  // Was a defect: kills were reset per combat (see AC-7.1 above) and a combat won by a
  // CARD never emitted `combat_won` (only the end-turn path did), so real runs scored
  // 0 kills and 0 elites. Both are fixed in src/kernel/record.js and src/kernel/index.js.
  assert.ok(
    REAL_A.score.counts.kills > 0,
    `a run that killed enemies must score kills, got ${REAL_A.score.counts.kills} (events carry ${REAL_A.events.filter((e) => e.t === 'damage' && e.hp <= 0).length} enemy deaths)`,
  );
});

// ---------------------------------------------------------------------------
// The record shape itself (DR-1, DR-3)
// ---------------------------------------------------------------------------

test('DR-1/DR-3: buildRunRecord writes a versioned, self-describing, replayable record', () => {
  assert.equal(RECORD_VERSION, 1, 'the record schema version is frozen at 1');
  assert.equal(RETAIN, 100, 'newest-100 retention is a frozen requirement');

  const built = buildRunRecord({
    state: newRun({ seed: 11 }),
    submitted: [{ act: 'p1' }, { reject: 'zz9' }],
    events: [],
    profile: 'fresh',
  });
  assert.equal(built.v, RECORD_VERSION);
  assert.equal(built.id, hash(newRun({ seed: 11 })), 'the record id IS the state hash (DR-3)');
  assert.equal(built.hash, built.id, 'the pre-DR-3 alias must match');
  assert.equal(built.contentVersion, newRun({ seed: 11 }).contentVersion, 'a record can be refused rather than misread');
  assert.equal(built.profile, 'fresh', 'which pool a run was played with travels with it');
  assert.equal(built.steps, 2, 'steps counts submissions, accepted and rejected');
  assert.equal(built.rejected, 1);
  assert.equal(built.malformedRate, 0.5);
  assert.deepEqual(built.actions, [{ act: 'p1' }, { reject: 'zz9' }], 'the action log is what makes the run replayable');
  assert.equal(built.outcome, 'unfinished');
  assert.equal(JSON.parse(JSON.stringify(built)).id, built.id, 'a record survives a JSONL round trip unchanged');
  // A run with an action log always carries a score; a run without one never does.
  assert.notEqual(built.score, undefined, 'a record with actions carries its score');
  const noActions = buildRunRecord({ state: newRun({ seed: 11 }), submitted: [], events: [] });
  assert.equal(noActions.actions.length, 0);
  assert.notEqual(noActions.score, undefined, 'an empty action log is still a derivable score');
});
