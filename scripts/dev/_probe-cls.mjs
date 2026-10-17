// TEMP probe: what would an improved cls: extractor surface as missing? Deleted after Item 1.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const appSrc = readFileSync(join(ROOT, 'src/web/app.js'), 'utf8');
const cssSrc = readFileSync(join(ROOT, 'src/web/style.css'), 'utf8');

// The cls VALUE: from just after `cls:` up to the first bracket at depth 0 (the `}` that
// closes the options object, or the `,` that ends the argument).
function clsValue(src, from) {
  let i = from, depth = 0, out = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '`' || ch === "'" || ch === '"') {
      const q = ch; out += ch; i += 1;
      while (i < src.length) {
        out += src[i];
        if (src[i] === '\\') { out += (src[i + 1] || ''); i += 2; continue; }
        if (src[i] === q) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (ch === '(' || ch === '[') { depth += 1; out += ch; i += 1; continue; }
    if (ch === '{') { depth += 1; out += ch; i += 1; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { if (depth === 0) break; depth -= 1; out += ch; i += 1; continue; }
    if (ch === ',' && depth === 0) break;
    out += ch; i += 1;
  }
  return out.replace(/\s+/g, ' ').trim();
}

const exprs = [];
const literals = new Set();
for (const m of appSrc.matchAll(/\bcls:\s*/g)) {
  const v = clsValue(appSrc, m.index + m[0].length);
  const line = appSrc.slice(0, m.index).split('\n').length;
  exprs.push([line, v]);
  for (const lit of v.matchAll(/`[^`]*`|'[^']*'|"[^"]*"/g)) {
    literals.add(lit[0].slice(1, -1).replace(/\$\{[^}]*\}/g, ' '));
  }
}

const toks = new Set();
for (const l of literals) {
  for (const c of l.split(/\s+/)) if (/^[A-Za-z][\w-]*$/.test(c) && !c.endsWith('-')) toks.add(c);
}
const declared = new Set();
for (const m of cssSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) declared.add(m[1]);
const missing = [...toks].filter((c) => !declared.has(c)).sort();

console.log('expressions:', exprs.length, '| literal tokens:', toks.size);
console.log('MISSING:', JSON.stringify(missing));
console.log('--- expressions (line: value) ---');
for (const [l, e] of exprs) console.log(l + ': ' + e);
console.log('--- tokens ---');
console.log([...toks].sort().join(' '));
