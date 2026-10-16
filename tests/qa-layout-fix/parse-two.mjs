#!/usr/bin/env node
// tests/qa-layout-fix/parse-two.mjs — QA scratch. Parses web/style.css with postcss and
// pinpoints the first parse error with a surrounding line dump, so the claim "missing
// semicolon after `column-gap: 8px` at web/style.css:118" can be checked on any CSS file.
// Read-only: it never writes to the file it inspects.
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const path = process.argv[2];
if (!path) { console.error('usage: node parse-two.mjs <css-file>'); process.exit(2); }
const css = readFileSync(path, 'utf8');
console.log('file:', path);
console.log('bytes:', css.length, 'lines:', css.split('\n').length);
try {
  postcss.parse(css, { from: path });
  console.log('parsed OK (no parse error)');
} catch (e) {
  console.log('PARSE ERROR:', e.message);
  const line = /:(\d+):(\d+):/.exec(e.message);
  if (line) {
    const n = Number(line[1]);
    const lines = css.split('\n');
    for (let i = Math.max(1, n - 2); i <= Math.min(lines.length, n + 2); i++) {
      console.log((i === n ? '>> ' : '   ') + String(i).padStart(5) + ': ' + JSON.stringify(lines[i - 1]));
    }
  }
  process.exit(1);
}
