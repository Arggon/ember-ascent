// scripts/dev/measure-action-shapes.mjs — dev-only spike measuring candidate R5 action-line
// shapes for targeted plays against the FROZEN 8-token action-line ceiling (R9a).
//
// Why this exists: the frozen interface change wants `p2 1` for the multi-enemy case, but
// action lines also carry the card id (`p2 sword_boomerang`) and that pair already measures
// 7 tokens worst-case. Appending anything to it risks the frozen ceiling, so every candidate
// shape is measured over the FULL shipped content set before one is chosen.
//
// Not shipped, not run by the game, no dependencies beyond the census already in-repo.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countWorst } from '../measure-tokens.mjs';

// Read the shipped card table directly: loadContent() additionally validates that every
// custom effect handler is registered, which only happens once the kernel entry is
// imported. For a pure token measurement of id/name text that validation is irrelevant.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const raw = JSON.parse(readFileSync(resolve(REPO, 'src/kernel/content/cards.json'), 'utf8'));
const cards = Array.isArray(raw) ? raw : (raw.cards ?? Object.values(raw));

const shapes = {
  'CURRENT  p{n} id': (c, n) => `p${n} ${c.id}`,
  'A  p{n} id {k}': (c, n) => `p${n} ${c.id} 2`,
  'B  p{n} {k} id': (c, n) => `p${n} 2 ${c.id}`,
  'C  p{n} name': (c, n) => `p${n} ${c.name.replace(/ /g, '_').toLowerCase()}`,
  'D  p{n} name {k}': (c, n) => `p${n} ${c.name.replace(/ /g, '_').toLowerCase()} 2`,
  'E  p{n} {k} name': (c, n) => `p${n} 2 ${c.name.replace(/ /g, '_').toLowerCase()}`,
  'F  p{n}{k} id': (c, n) => `p${n}2 ${c.id}`,
  'G  p{n}:{k} id': (c, n) => `p${n}:2 ${c.id}`,
  'H  p{n} id({k})': (c, n) => `p${n} ${c.id}(2)`,
};

for (const [label, f] of Object.entries(shapes)) {
  let worst = { n: 0, line: '', o: 0, cl: 0 };
  cards.forEach((c, i) => {
    const line = f(c, i + 1);
    const w = countWorst(line);
    if (w.worst > worst.n) worst = { n: w.worst, line, o: w.o200k_base, cl: w.cl100k_base };
  });
  console.log(String(worst.n).padStart(3), label.padEnd(18), JSON.stringify(worst.line), `o=${worst.o} cl=${worst.cl}`);
}

console.log('--- longest shipped ids ---');
cards
  .map((c) => [c.id, c.name])
  .sort((a, b) => b[0].length - a[0].length)
  .slice(0, 5)
  .forEach((x) => console.log(x[0].length, x[0], '|', x[1]));
