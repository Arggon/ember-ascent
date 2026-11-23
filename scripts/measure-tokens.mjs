// scripts/measure-tokens.mjs — dev-only payload-token measurement (R9a).
// Measures the WORST of o200k_base and cl100k_base for a payload. Never run by the game.
//
// Usage: node scripts/measure-tokens.mjs            -> spike (phase-3 format validation)
//        import { countWorst } from this file      -> tests/golden budgets use it directly.
//
// CAVEAT (docs/guides/AGENT-PLAY-GUIDE.md): the payloads below are STALE hand-written
// sample strings kept for phase-3 history; the real ceilings are enforced on engine
// output by tests/budget.test.js. Treat this script's report as a spike, not a gate —
// which is why a FAIL row does not fail the run.
import { Tiktoken } from 'js-tiktoken/lite';
import o200k from 'js-tiktoken/ranks/o200k_base';
import cl100k from 'js-tiktoken/ranks/cl100k_base';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ENC = {
  o200k_base: new Tiktoken(o200k),
  cl100k_base: new Tiktoken(cl100k),
};

/** Count one payload in one encoding. Pure; no globals mutated. */
export function count(text, encoding) {
  const enc = ENC[encoding];
  if (!enc) throw new Error(`unknown encoding: ${encoding}`);
  return enc.encode(text).length;
}

/** Worst-case count across both encodings, as CI gates on (R9a). */
export function countWorst(text) {
  const o = count(text, 'o200k_base');
  const c = count(text, 'cl100k_base');
  return { o200k_base: o, cl100k_base: c, worst: Math.max(o, c) };
}

// CLI spike — only when run directly, never on import.
// ---------------------------------------------------------------------------

const DUMP_SPIKE = `T3 | HP 42/60 | EN 3/3 | BLK 0 | draw5 disc3 | PWR2 VULN1
HAND
 1 Hammerfall  A6
 2 Hammerfall  A6
 3 Quench       B5
 4 Anvil Blow   A8+V2 EN2
 5 Stoke        PWR+2 EN1
ENEMY
 Cinder Maw  HP 44/44  A12`;

const PILE_SPIKE = `PILES
 draw: Hammerfall, Hammerfall, Quench, Anvil Blow, Stoke
 disc: Quench, Bellows
 exhaust: -`;

const CONFIG_SPIKE = `$ node bin/dlb new --seed 7 --character ashwright --difficulty 1
$ node bin/dlb actions
$ node bin/dlb play 3
$ node bin/dlb state`;

const ACTION_LINES = [
  '1 strike A6',
  '3 anvil_blow A8+V2 EN2',
  '5 stoke PWR+2 EN1',
  'e1 end turn',
  'c continue',
  's1 card-pick',
  'n2 path',
  '9 quench B5',
];

/** [label, payload, ceiling] — the per-payload budget table this spike reports on. */
const PAYLOAD_BUDGETS = [
  ['R4 state dump (prescribed shape)', DUMP_SPIKE, 250],
  ['R4 --verbose dump (+pile list)', `${DUMP_SPIKE}\n${PILE_SPIKE}`, 250],
  ['R8 --help example block', CONFIG_SPIKE, 60],
];

/** One PASS/FAIL row: `<verdict>  <label>` then the counts indented under it. */
function logPayloadRow(label, text, ceiling) {
  const r = countWorst(text);
  const verdict = r.worst <= ceiling ? 'PASS' : 'FAIL';
  console.log(
    `${verdict}  ${label}\n      o200k=${r.o200k_base} cl100k=${r.cl100k_base} worst=${r.worst} ceiling=${ceiling}`,
  );
}

function main() {
  console.log('=== per-payload budgets ===');
  for (const [label, text, ceiling] of PAYLOAD_BUDGETS) logPayloadRow(label, text, ceiling);

  console.log('\n=== R5 action-line budget (ceiling 8, worst of both encodings) ===');
  for (const line of ACTION_LINES) {
    const r = countWorst(line);
    console.log(
      `${r.worst <= 8 ? 'PASS' : 'FAIL'}  ${JSON.stringify(line)}  o200k=${r.o200k_base} cl100k=${r.cl100k_base} worst=${r.worst}`,
    );
  }
}

// The robust "run directly" test: compare as file URLs, so a relative argv[1], a path
// with spaces, or a symlinked cwd cannot silently skip (or duplicate) the report.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
