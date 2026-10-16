// tests/qa-layout-fix/parse-check.mjs — CSS parse verification for the release gate.
// Parses every candidate CSS with postcss (project dependency) and reports a verdict.
// Run from the project root:  node tests/qa-layout-fix/parse-check.mjs
import postcss from 'postcss';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const files = process.argv.slice(2);
let bad = 0;
for (const f of files) {
  const css = readFileSync(f, 'utf8');
  const sha = createHash('sha256').update(css).digest('hex');
  try {
    const root = postcss.parse(css, { from: f });
    let rules = 0, decls = 0, at = 0;
    root.walkRules(() => rules++); root.walkDecls(() => decls++); root.walkAtRules(() => at++);
    console.log(`PARSE OK   ${sha.slice(0, 12)}…  rules=${String(rules).padStart(4)} decls=${String(decls).padStart(5)} atRules=${String(at).padStart(3)}  ${f}`);
  } catch (e) {
    bad++;
    console.log(`PARSE FAIL ${sha.slice(0, 12)}…  ${f}\n           ${e.message}`);
  }
}
console.log(bad ? `\n${bad} file(s) FAILED to parse` : '\nall files parsed cleanly');
process.exit(bad ? 1 : 0);
