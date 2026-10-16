#!/usr/bin/env node
// tools/dev/css-parse-probe.mjs — does web/style.css actually parse, and is the tail intact?
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
const css = readFileSync(new URL('../../web/style.css', import.meta.url), 'utf8');
console.log('bytes:', css.length, 'lines:', css.split('\n').length);
let root;
try {
  root = postcss.parse(css, { from: 'web/style.css' });
  console.log('parsed OK');
} catch (e) {
  console.log('PARSE ERROR:', e.message);
  process.exit(1);
}
const atMedia = [];
root.walkAtRules('media', (r) => atMedia.push(r.params + '  [' + r.nodes.length + ' rules]'));
console.log('@media blocks:', atMedia.length);
for (const m of atMedia) console.log('  ', m);
console.log('top-level rules:', root.nodes.filter((n) => n.type === 'rule').length);
console.log('\nlast 300 chars of source:\n' + JSON.stringify(css.slice(-300)));
