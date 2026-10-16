#!/usr/bin/env node
// scripts/check-surface-art.mjs — static checks for the browser surface's presentation.
//
// WHY THIS EXISTS: the art pass makes three claims that a browser would normally verify
// and a headless run cannot: (1) every class app.js emits has a rule in style.css, so no
// style ships invisible; (2) style.css has balanced braces and no duplicated top-level
// selector; (3) no external asset is referenced. Grep cannot prove (1) because app.js
// builds class names from templates, so this walks the two real sources.
//
// It is read-only and dependency-free: node:fs only, no execution of the page.
//
// Usage: node scripts/check-surface-art.mjs [--json]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = process.argv.includes('--json');

const appSrc = readFileSync(join(ROOT, 'src/web/app.js'), 'utf8');
const cssSrc = readFileSync(join(ROOT, 'src/web/style.css'), 'utf8');

const problems = [];
const notes = [];

/* ---------------------------------------------------------------- 1. class coverage */

/**
 * The text of a `cls:` value, from just after the colon to the end of that argument.
 *
 * WHY A SCANNER RATHER THAN A REGEX: the previous pattern
 * (`/\bcls:\s*(`[^`]*`|'[^']*'|"[^"]*")/g`) matched ONE complete quoted literal and then
 * stopped, so it was blind to a class assembled from several pieces. `src/web/app.js` emits the
 * dying-enemy ghost as `` `enemy is-dying side-${d.side}` + (d.boss ? ' boss-down' : '') ``,
 * and `boss-down` — a class with no rule anywhere in style.css — lived in the second piece,
 * invisible to the checker, which therefore reported OK. This walks the whole value instead.
 *
 * The value ends at the first bracket at depth zero (`}` closing the options object, or the
 * `,` ending the argument). Quoted spans are skipped whole, escapes included, so a `,` or
 * `}` INSIDE a class string cannot end the scan early, and a template's `${}` braces are
 * tracked as depth so an interpolation cannot terminate it either.
 */
function clsValue(src, from) {
  let i = from;
  let depth = 0;
  let out = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '`' || ch === "'" || ch === '"') {
      const q = ch;
      out += ch;
      i += 1;
      while (i < src.length) {
        out += src[i];
        if (src[i] === '\\') { out += (src[i + 1] || ''); i += 2; continue; }
        if (src[i] === q) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; out += ch; i += 1; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { if (depth === 0) break; depth -= 1; out += ch; i += 1; continue; }
    if (ch === ',' && depth === 0) break;
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Classes appearing inside a `cls:` option in app.js, including template literals and every
 * fragment of a concatenated value.
 */
function classesFromOptions(src) {
  const found = new Set();
  // Concrete members for every `${...}` interpolation that appears in a class position.
  // Without this, a template such as `card type-${card.type}` leaves the fragment `type-`
  // behind as if it were a class name, and the checker reports it as unstyled. The names
  // are derived from the real value lists used in app.js, not invented here.
  const EXPANSIONS = [
    { re: /type-\$\{card\.type\}/, members: ['attack', 'skill', 'power', 'status', 'curse'] },
    { re: /kind-\$\{kind\}/, members: ['attack', 'block', 'buff', 'debuff'] },
    { re: /page-\$\{kind\}/, members: ['map', 'combat', 'reward', 'rest', 'end'] },
    { re: /t-\$\{short\}/, members: ['weak', 'strong', 'elite', 'rest', 'boss'] },
  ];
  for (const m of src.matchAll(/\bcls:\s*/g)) {
    // The WHOLE value, not just its first quoted piece: `cls: a + (cond ? ' b' : '')` emits
    // both `a` and `b`, and the old single-literal match saw only `a`.
    let raw = clsValue(src, m.index + m[0].length);
    // Replace each interpolation with its expanded members (space separated) when we know
    // them, so the resulting names are real classes rather than dangling prefixes.
    raw = raw.replace(/\$\{([^}]*)\}/g, (whole, expr) => {
      for (const { re, members } of EXPANSIONS) {
        if (re.test(whole) || re.test(expr)) return members.join(' ');
      }
      // A bare interpolation contributes no literal class: `${s.key}` is handled by the
      // value tables below.
      return ' ';
    });
    // Every quoted span that remains is one fragment of the class list. Taking them ALL is
    // the widening: a fragment after a `+` is exactly as real as the first one.
    for (const lit of raw.matchAll(/`([^`]*)`|'([^']*)'|"([^"]*)"/g)) {
      for (const cls of (lit[1] ?? lit[2] ?? lit[3] ?? '').split(/\s+/)) {
        // A CSS class name never ends in a hyphen. A trailing `-` here is the leftover arm of
        // a template interpolation whose members we did not expand (e.g. `card type-`), not a
        // class, so drop it rather than reporting it as unstyled.
        if (/^[A-Za-z][\w-]*$/.test(cls) && !cls.endsWith('-')) found.add(cls);
      }
    }
    // A template literal like `node t-${short}` contributes the literal prefix parts only.
    // The expanded names (`t-weak`, ...) are added below from their own constant tables.
  }
  return found;
}

/** Expand the known-variant template literals into their concrete members. */
function variants(src) {
  const out = new Set();
  if (/card type-\$\{card\.type\}/.test(src)) {
    for (const t of ['attack', 'skill', 'power', 'status', 'curse']) out.add(`type-${t}`);
  }
  if (/node t-\$\{short\}/.test(src)) {
    for (const t of ['weak', 'strong', 'elite', 'rest', 'boss']) out.add(`t-${t}`);
  }
  if (/e-intent kind-\$\{kind\}/.test(src)) {
    for (const t of ['attack', 'block', 'buff', 'debuff']) out.add(`kind-${t}`);
  }
  if (/pill \$\{s\.key\}/.test(src) || /pill \$\{/.test(src)) {
    for (const k of ['strength', 'vulnerable', 'weak', 'dexterity', 'metallicize', 'power']) out.add(k);
  }
  if (/stat \$\{kind\}/.test(src)) {
    for (const k of ['hp', 'energy', 'block', 'dim']) out.add(k);
  }
  if (/enemy .*eh-\$\{/.test(src)) for (let i = 0; i < 5; i += 1) out.add(`eh-${i}`);
  if (/'btn ghost'/.test(src)) out.add('ghost');
  if (/'btn secondary'/.test(src)) out.add('secondary');
  if (/btn secondary/.test(src)) out.add('secondary');
  if (/big-title \$\{won/.test(src)) { out.add('win'); out.add('loss'); }
  if (/type-\$\{card\.type\}` \+ \(disabled \? ' disabled is-unplayable'/.test(src)) {
    out.add('disabled');
    out.add('is-unplayable');
  }
  if (/demon\$\{won \? '' : ' lose'\}/.test(src)) out.add('lose');
  if (/page-\$\{kind\}/.test(src)) for (const k of ['map', 'combat', 'reward', 'rest', 'end']) out.add(`page-${k}`);
  return out;
}

/** Every class name that appears anywhere in style.css (selector positions). */
function cssClasses(src) {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const found = new Set();
  for (const m of stripped.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) found.add(m[1]);
  return found;
}

const used = new Set([...classesFromOptions(appSrc), ...variants(appSrc)]);
const declared = cssClasses(cssSrc);
const missing = [...used].filter((c) => !declared.has(c)).sort();

notes.push(`classes: ${used.size} emitted by app.js, ${declared.size} present in style.css`);
if (missing.length > 0) {
  problems.push(`app.js emits ${missing.length} class(es) with no rule in style.css: ${missing.join(', ')}`);
}

/* ------------------------------------------------------- 2. braces and duplicate tops */

const strippedCss = cssSrc.replace(/\/\*[\s\S]*?\*\//g, ' ');
const opens = (strippedCss.match(/\{/g) || []).length;
const closes = (strippedCss.match(/\}/g) || []).length;
if (opens !== closes) problems.push(`style.css braces unbalanced: ${opens} '{' vs ${closes} '}'`);

/**
 * Top-level selector strings outside any at-rule, split on commas.
 *
 * A selector re-declared inside an `@media` block is a legitimate override, not a
 * duplicate — that is how the responsive and reduced-motion blocks work. The CSS text is
 * masked first so at-rule contents are simply absent, rather than being tracked and then
 * compared against the outer scope (which produced five false "duplicate" reports).
 */
function topSelectors(src) {
  const clean = maskAtBlocks(src.replace(/\/\*[\s\S]*?\*\//g, ' '));
  const selectors = [];
  const stack = [];
  let buf = '';
  for (const ch of clean) {
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (ch === '}') {
      const top = stack.pop();
      if (stack.length === 0 && top && !top.startsWith('@')) {
        for (const sel of top.split(',')) selectors.push(sel.trim().replace(/\s+/g, ' '));
      }
      buf = '';
    } else {
      buf += ch;
    }
  }
  return selectors.filter(Boolean);
}

/**
 * Blank out the whole body of every at-rule (`@media`, `@supports`, `@keyframes`), so only
 * true top-level rules remain. Brace-depth aware, so nested blocks are removed correctly.
 */
function maskAtBlocks(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf('@', i);
    if (at === -1) { out += src.slice(i); break; }
    out += src.slice(i, at);
    // Handle one-statement at-rules like `@import "x";` and `@charset`.
    const brace = src.indexOf('{', at);
    const semi = src.indexOf(';', at);
    if (brace === -1 || (semi !== -1 && semi < brace)) { out += ' '; i = semi === -1 ? src.length : semi + 1; continue; }
    let depth = 0;
    let j = brace;
    for (; j < src.length; j += 1) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') { depth -= 1; if (depth === 0) { j += 1; break; } }
    }
    out += ' ';
    i = j;
  }
  return out;
}

const sels = topSelectors(cssSrc);
const seen = new Map();
for (const s of sels) seen.set(s, (seen.get(s) || 0) + 1);
const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([s, n]) => `${s} ×${n}`);
if (dupes.length > 0) problems.push(`duplicate top-level selector(s): ${dupes.join(', ')}`);
notes.push(`top-level selectors: ${sels.length}, distinct ${seen.size}`);

/* --------------------------------------------------------------- 3. external assets */

const external = [];
for (const [file, src] of [['src/web/index.html', readFileSync(join(ROOT, 'src/web/index.html'), 'utf8')], ['src/web/app.js', appSrc], ['src/web/style.css', cssSrc]]) {
  for (const re of [/https?:\/\//gi, /\bcdn\b/gi, /@import/gi, /googleapis/gi, /\.woff2?\b/gi]) {
    const m = src.match(re);
    if (m) external.push(`${file}: ${re} matched ${JSON.stringify(m.slice(0, 3))}`);
  }
  // CSS `url(...)` fetches a resource. JS `new URLSearchParams(...)` does not — the earlier
  // regex matched that constructor and reported three phantom external references. Only
  // scan stylesheets, and only for genuine url() tokens.
  if (file.endsWith('.css')) {
    const m = src.match(/url\(\s*['"]?(?!data:)[^)'"]*['"]?\s*\)/gi);
    if (m) external.push(`${file}: css url() matched ${JSON.stringify(m.slice(0, 3))}`);
  }
}
if (external.length > 0) problems.push(`external-asset reference(s) found: ${external.join('; ')}`);

/* ------------------------------------------------------------------------ reporting */

if (json) {
  process.stdout.write(`${JSON.stringify({ ok: problems.length === 0, notes, problems, missing, dupes }, null, 2)}\n`);
} else {
  process.stdout.write('check-surface-art: static presentation checks over src/web/\n');
  for (const n of notes) process.stdout.write(`  · ${n}\n`);
  if (problems.length === 0) process.stdout.write('OK — no missing class rules, no duplicate selectors, no external assets\n');
  else for (const p of problems) process.stdout.write(`  FAIL  ${p}\n`);
}
process.exit(problems.length === 0 ? 0 : 2);
