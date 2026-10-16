#!/usr/bin/env node
// tests/qa-layout-fix/parse-harness.mjs — QA scratch. Parses a harness output file into
// rows by regex rather than whitespace columns, because the harness pads the label to 17
// chars and `short-desktop-window`/`galaxy-s25plus-landscape` are longer, so the label and
// the requested-seed column run together. Prints the numbers verbatim plus the checks.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node parse-harness.mjs <harness-output.txt>'); process.exit(2); }
const text = readFileSync(file, 'utf8');

const VP = /^(\d+x\d+)\s+(.*?)(\d+)?\s+(\d+|-)\s+(NOT FOUND|\d+\/\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(true|false|-)\s+(pass|FAIL)\s*$/;
// viewport-check rows: size label requestedSeed reported eTbot/vh clear scrollPx handRows onTop result

const SP = /^(\d+x\d+)\s+(.*?)(\d+)?\s+(\d+|-)\s+\[(\d+),(\d+)\]\s+(-?\d+px)\s+(-?\d+%)\s+(\d+)\s+(\d+%)\s+(pass|FAIL)\s*$/;
// space-check rows: size label requestedSeed reported [w,h] waste waste% scrollH handFill% result

const rows = [];
for (const line of text.split('\n')) {
  let m = VP.exec(line);
  if (m) {
    rows.push({ kind: 'viewport', size: m[1], label: m[2].trim(), seed: m[3], reported: m[4],
      etbot: m[5], clear: Number(m[6]), scroll: Number(m[7]), handRows: Number(m[8]),
      onTop: m[9], result: m[10] });
    continue;
  }
  m = SP.exec(line);
  if (m) {
    rows.push({ kind: 'space', size: m[1], label: m[2].trim(), seed: m[3], reported: m[4],
      viewport: [Number(m[5]), Number(m[6])], waste: m[7], wastePct: m[8],
      scrollH: Number(m[9]), handFill: m[10], result: m[11] });
  }
}

const vp = rows.filter((r) => r.kind === 'viewport');
const sp = rows.filter((r) => r.kind === 'space');
console.log('file:', file);
console.log('rows parsed: viewport=' + vp.length + ' space=' + sp.length);
console.log('FAIL rows in file text: ' + (text.match(/\bFAIL\b/g) || []).length);
console.log('ALL PASS line: ' + ((text.match(/ALL PASS \(\d+ rows\)/) || ['(none)'])[0]));
console.log('');

function seedCheck(r) {
  if (r.seed === null || r.seed === undefined) return 'requested-seed-column-not-parsed';
  return String(r.seed) === String(r.reported) ? 'ok' : 'MISMATCH requested=' + r.seed + ' reported=' + r.reported;
}

console.log('--- per viewport: distinct (clearance, scrollPx, handRows, onTop) and seed-assertion result ---');
const bySize = new Map();
for (const r of rows) {
  if (!bySize.has(r.size)) bySize.set(r.size, []);
  bySize.get(r.size).push(r);
}
for (const [size, rs] of bySize) {
  if (rs[0].kind === 'viewport') {
    const clears = [...new Set(rs.map((r) => r.clear))].sort((a, b) => a - b);
    const scrolls = [...new Set(rs.map((r) => r.scroll))].sort((a, b) => a - b);
    const hand = [...new Set(rs.map((r) => r.handRows))].sort((a, b) => a - b);
    const onTop = [...new Set(rs.map((r) => r.onTop))];
    const seed = [...new Set(rs.map(seedCheck))];
    const res = [...new Set(rs.map((r) => r.result))];
    console.log(size.padEnd(10) + ' n=' + String(rs.length).padEnd(3) +
      ' clearance{' + clears.join(',') + '}' +
      ' scroll{' + scrolls.join(',') + '}' +
      ' handRows{' + hand.join(',') + '}' +
      ' onTop{' + onTop.join(',') + '}' +
      ' seed[' + seed.join('|') + ']' +
      ' result{' + res.join(',') + '}');
  } else {
    const waste = [...new Set(rs.map((r) => r.waste))];
    const sh = [...new Set(rs.map((r) => r.scrollH))];
    const seed = [...new Set(rs.map(seedCheck))];
    const res = [...new Set(rs.map((r) => r.result))];
    console.log(size.padEnd(10) + ' n=' + String(rs.length).padEnd(3) +
      ' waste{' + waste.join(',') + '}' +
      ' scrollH{' + sh.join(',') + '}' +
      ' seed[' + seed.join('|') + ']' +
      ' result{' + res.join(',') + '}');
  }
}
