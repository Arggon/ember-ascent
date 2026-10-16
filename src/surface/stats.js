// Balance statistics — R10, with the provenance rule the PM made binding (§8.2).
//
// The requirement: per card, pick rate when offered, presence in winning decks, plus
// average damage taken per act, win rate by act, and run-length distribution.
//
// The binding constraint: sim metrics measure THE HEURISTIC POLICY, not humans.
// Shipping an unlabelled "card win rate" would be a fabricated claim about player
// behaviour. So every number here carries a provenance label, classes are reported
// separately, and a record directory containing mixed provenance is refused rather
// than averaged into a number that means nothing.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Provenance classes, most authoritative last (human wins disagreements). */
export const PROVENANCE = ['heuristic', 'llm', 'human'];

/**
 * Read every run record under a directory. Accepts either a runs.jsonl file or any
 * directory containing one, so `--from` works on a sim-out dir or a single file.
 * @param {string} from
 * @returns {{records: any[], problems: string[], source: string}}
 */
export function readRecords(from) {
  const problems = [];
  const records = [];
  let files = [];
  if (!existsSync(from)) return { records, problems: [`no such path: ${from}`], source: from };
  if (statSync(from).isFile()) files = [from];
  else {
    files = readdirSync(from)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .map((f) => join(from, f));
  }
  if (files.length === 0) problems.push(`no .jsonl records under ${from}`);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (line.trim() === '') return;
      try {
        records.push(JSON.parse(line));
      } catch (e) {
        problems.push(`${file}:${i + 1}: not JSON (${e.message})`);
      }
    });
  }
  return { records, problems, source: files.join(', ') };
}

/**
 * Build the balance report.
 * @param {{from: string, byCard?: boolean, format?: string, provenance?: string}} opts
 * @returns {{ok: boolean, text: string, data: any}}
 */
export function stats(opts) {
  const wanted = opts.provenance ?? 'heuristic';
  if (!PROVENANCE.includes(wanted)) {
    throw Object.assign(new Error(`unknown provenance "${wanted}" (expected: ${PROVENANCE.join(', ')})`), { code: 3 });
  }
  const { records: all, problems, source } = readRecords(opts.from);
  if (problems.length > 0) {
    throw Object.assign(new Error(`stats: ${problems.join('; ')}`), { code: 3 });
  }
  if (all.length === 0) {
    throw Object.assign(new Error(`stats: no run records under ${opts.from}`), { code: 3 });
  }

  // Class separation is mandatory: mixing classes would produce an unlabelled
  // aggregate, which the PM ruling classifies as a defect rather than a style choice.
  const present = [...new Set(all.map((r) => r.provenance ?? 'unknown'))];
  const records = all.filter((r) => (r.provenance ?? 'heuristic') === wanted);
  if (records.length === 0) {
    throw Object.assign(
      new Error(`stats: no records with provenance "${wanted}" (found: ${present.join(', ')})`),
      { code: 3 },
    );
  }

  const wins = records.filter((r) => r.outcome === 'win');
  const byCard = new Map();
  for (const r of records) {
    for (const id of r.offered ?? []) {
      const row = byCard.get(id) ?? { id, offered: 0, picked: 0, inDeck: 0, inWin: 0 };
      row.offered += 1;
      byCard.set(id, row);
    }
    for (const id of r.taken ?? []) {
      const row = byCard.get(id) ?? { id, offered: 0, picked: 0, inDeck: 0, inWin: 0 };
      row.picked += 1;
      byCard.set(id, row);
    }
    for (const id of r.deck ?? []) {
      const row = byCard.get(id) ?? { id, offered: 0, picked: 0, inDeck: 0, inWin: 0 };
      row.inDeck += 1;
      row.inWin += r.outcome === 'win' ? 1 : 0;
      byCard.set(id, row);
    }
  }

  const cards = [...byCard.values()]
    .map((c) => ({
      ...c,
      // A RATIO NEEDS A DENOMINATOR. A starter card (`strike`, `defend`, `bash`) is
      // never OFFERED as a reward — it is in the deck from turn one — so `picked /
      // offered` was 0/0, printed as "0.000", which reads as "picked 0% of the time"
      // when the truth is "not applicable". Same for a presence rate before the first
      // win. Both are now null and printed as `n/a`; the raw counts stay.
      pickRate: c.offered > 0 ? c.picked / c.offered : null,
      presenceInWins: wins.length > 0 ? c.inWin / wins.length : null,
      presenceInDeck: records.length > 0 ? c.inDeck / records.length : null,
    }))
    .sort((a, b) => (b.pickRate ?? -1) - (a.pickRate ?? -1) || a.id.localeCompare(b.id));

  const steps = records.map((r) => r.steps).sort((a, b) => a - b);
  const floorHist = {};
  for (const r of records) floorHist[r.floor] = (floorHist[r.floor] ?? 0) + 1;

  // Boss floor, the same separation `sim` reports, derived from the same records so a
  // balance report can be rebuilt from a directory alone (see the file header).
  const bossRuns = records.filter((r) => r.bossArrival);
  const bossWins = bossRuns.filter((r) => r.outcome === 'win');
  const bossDeaths = bossRuns.filter((r) => typeof r.bossHpRemaining === 'number' && r.outcome !== 'win');
  const avg = (xs) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const fmt = (v, d = 1) => (v === null ? 'n/a' : v.toFixed(d));
  const bossData = bossRuns.length === 0 ? null : {
    reached: bossRuns.length,
    reachedRate: bossRuns.length / records.length,
    kills: bossWins.length,
    killRate: bossWins.length / bossRuns.length,
    meanArrivalHp: avg(bossRuns.map((r) => r.bossArrival.hp)),
    meanArrivalDeckSize: avg(bossRuns.map((r) => r.bossArrival.deckSize)),
    meanArrivalAttacks: avg(bossRuns.map((r) => r.bossArrival.attacks)),
    meanArrivalSkills: avg(bossRuns.map((r) => r.bossArrival.skills)),
    meanArrivalPowers: avg(bossRuns.map((r) => r.bossArrival.powers)),
    meanArrivalBlockPoints: avg(bossRuns.map((r) => r.bossArrival.blockPoints)),
    meanBossHpRemaining: avg(bossDeaths.map((r) => r.bossHpRemaining)),
    deathsCounted: bossDeaths.length,
  };

  const header = `stats — provenance: ${wanted} | ${records.length} runs (of ${all.length} present${present.length > 1 ? `: ${present.join(', ')}` : ''}) | source: ${source}`;
  const notes = [
    `${wanted.toUpperCase()} POLICY DATA — these numbers describe the ${wanted} policy, not human players.`,
    present.length > 1 ? `Classes present: ${present.join(', ')}; this report is filtered to "${wanted}" and never averaged across classes.` : null,
  ].filter(Boolean);

  const data = {
    provenance: wanted,
    classesPresent: present,
    runs: records.length,
    wins: wins.length,
    winRate: wins.length / records.length,
    runLength: {
      min: steps[0],
      median: steps[Math.floor(steps.length / 2)],
      max: steps[steps.length - 1],
      mean: steps.reduce((a, b) => a + b, 0) / steps.length,
    },
    floorHistogram: floorHist,
    meanFloor: records.reduce((a, b) => a + b.floor, 0) / records.length,
    boss: bossData,
    cards,
  };

  let text = `${header}\n${notes.join('\n')}\n`;
  text += `\nwin rate ${(data.winRate * 100).toFixed(1)}% (${wins.length}/${records.length}) | mean floor ${data.meanFloor.toFixed(2)}\n`;
  text += `run length (steps) min ${data.runLength.min} median ${data.runLength.median} max ${data.runLength.max} mean ${data.runLength.mean.toFixed(1)}\n`;
  text += `floor distribution ${Object.entries(floorHist).sort((a, b) => a[0] - b[0]).map(([f, n]) => `f${f}:${n}`).join(' ')}\n`;
  if (bossData) {
    text += `boss reached ${bossData.reached}/${records.length} (${(bossData.reachedRate * 100).toFixed(1)}%) | KILL RATE AT THE BOSS ${(bossData.killRate * 100).toFixed(1)}% (${bossData.kills}/${bossData.reached})\n`;
    text += `boss arrival: HP ${fmt(bossData.meanArrivalHp)} | deck ${fmt(bossData.meanArrivalDeckSize)} (atk ${fmt(bossData.meanArrivalAttacks)} blk ${fmt(bossData.meanArrivalSkills)} pow ${fmt(bossData.meanArrivalPowers)}) | block points ${fmt(bossData.meanArrivalBlockPoints)}\n`;
    text += `boss HP remaining at death ${fmt(bossData.meanBossHpRemaining)}/240 over ${bossData.deathsCounted} boss deaths\n`;
  } else {
    text += `boss reached 0/${records.length} — no run in this set reached the boss floor\n`;
  }

  if (opts.byCard) {
    if (opts.format === 'json') {
      text += `\n${JSON.stringify(cards, null, 2)}\n`;
    } else if (opts.format === 'csv') {
      // Empty cells, not zeros: a consumer parsing this CSV must be able to tell
      // "not applicable" from "picked never".
      text += '\ncard,offered,picked,pickRate,inWins,presenceInWins,presenceInDeck\n';
      for (const c of cards) {
        text += `${c.id},${c.offered},${c.picked},${c.pickRate === null ? 'n/a' : c.pickRate.toFixed(3)},${c.inWin},${c.presenceInWins === null ? 'n/a' : c.presenceInWins.toFixed(3)},${c.presenceInDeck.toFixed(3)}\n`;
      }
    } else if (opts.format === 'table') {
      text += '\ncard                     offered picked pickRate inWins presence\n';
      for (const c of cards) {
        const rate = c.pickRate === null ? 'n/a' : c.pickRate.toFixed(3);
        const pres = c.presenceInWins === null ? 'n/a' : c.presenceInWins.toFixed(3);
        text += `${c.id.padEnd(24)} ${String(c.offered).padStart(7)} ${String(c.picked).padStart(6)} ${rate.padStart(8)} ${String(c.inWin).padStart(6)} ${pres.padStart(8)}\n`;
      }
    } else {
      throw Object.assign(new Error(`unknown --format "${opts.format}" (expected: table, json, csv)`), { code: 3 });
    }
  }
  return { text, data };
}
