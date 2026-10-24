// Boss-fight summary over run records — ONE implementation, two reporters.
//
// `sim` prints it live (its report) and `stats` rebuilds it from a directory of
// records, and the two must agree: the stats header explicitly promises "boss floor,
// the same separation `sim` reports, derived from the same records". Before this
// module existed that agreement was two hand-copied blocks, so a field added to one
// silently went missing from the other. Both now call bossSummaryOf().
//
// Pure: takes records, returns numbers. No I/O, so any surface can use it.

/**
 * Aggregate the boss-fight story of a set of run records.
 *
 * `bossArrival` is written by the sim on the turn the boss fight starts, so
 * `reached` is exactly the set of runs that got there. `meanBossHpRemaining` is
 * averaged ONLY over runs that DIED in the boss fight: a run that killed the boss
 * has no "HP remaining" to average, and folding a 0 in would understate the boss.
 * @param {any[]} records run records ({outcome, bossArrival?, bossHpRemaining?})
 */
export function bossSummaryOf(records) {
  const bossRuns = records.filter((r) => r.bossArrival);
  const bossWins = bossRuns.filter((r) => r.outcome === 'win');
  const bossDeaths = bossRuns.filter((r) => typeof r.bossHpRemaining === 'number' && r.outcome !== 'win');
  const mean = (xs) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    reached: bossRuns.length,
    reachedRate: records.length ? bossRuns.length / records.length : 0,
    kills: bossWins.length,
    killRate: bossRuns.length ? bossWins.length / bossRuns.length : 0,
    meanArrivalHp: mean(bossRuns.map((r) => r.bossArrival.hp)),
    meanArrivalHpFrac: mean(bossRuns.map((r) => r.bossArrival.hp / r.bossArrival.maxHp)),
    meanArrivalDeckSize: mean(bossRuns.map((r) => r.bossArrival.deckSize)),
    meanArrivalAttacks: mean(bossRuns.map((r) => r.bossArrival.attacks)),
    meanArrivalSkills: mean(bossRuns.map((r) => r.bossArrival.skills)),
    meanArrivalPowers: mean(bossRuns.map((r) => r.bossArrival.powers)),
    meanArrivalBlockPoints: mean(bossRuns.map((r) => r.bossArrival.blockPoints)),
    meanBossHpRemaining: mean(bossDeaths.map((r) => r.bossHpRemaining)),
    // The 240 fallback covers a record whose bossArrival predates bossMaxHp.
    meanBossHpRemainingPct: mean(bossDeaths.map((r) => r.bossHpRemaining / (r.bossArrival.bossMaxHp || 240))),
    deathsCounted: bossDeaths.length,
  };
}
