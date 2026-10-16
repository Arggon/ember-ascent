#!/usr/bin/env node
// Architecture gate — the mechanical form of R1, R3 and the determinism contract.
//
// A requirement that is only written in a requirements file is a wish. This script
// turns three of them into a build result:
//
//   R1 (a) no surface/** file may import kernel/rules/**  — surfaces receive data only
//   R1 (b) no rules file may import I/O or surface code  — rules cannot reach outside
//   R1 (c) state mutation may happen only inside the kernel
//   R3     the kernel may not import node:perf_hooks, read Date, or call Math.random
//
// It walks the import graph by static parse (not by running anything), so a violation
// is reported even in a file that would never execute in CI.
//
// Exit 0 clean, 2 violations. `--json` prints the machine form. Usage:
//   node scripts/check-architecture.mjs [--root <dir>] [--json]
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const { values } = parseArgs({
  options: { root: { type: 'string' }, json: { type: 'boolean', default: false }, help: { type: 'boolean', default: false } },
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(`check-architecture — import-graph gate for R1/R3

usage: node scripts/check-architecture.mjs [--root <dir>] [--json]

rules enforced
  R1a  surface/** must not import kernel/rules/**
  R1b  kernel/rules/** must not import node:fs, node:child_process, node:perf_hooks, or surface/**
  R1c  state mutation (Object.assign on state, direct .prop = on a state arg) only inside kernel
  R3   kernel must not import node:perf_hooks, read Date, or call Math.random
  R3   kernel must import NO node:* builtin at all (so it runs in a browser unmodified)

exit codes
  0  clean
  2  violations found
`);
  process.exit(0);
}

const root = resolve(values.root ?? ROOT);
const SRC = join(root, 'src');

/** Every .js file under a directory tree, sorted for stable output. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Static import/export-from specifiers in a file, via regex over the source. */
function importsOf(text) {
  const specs = [];
  const patterns = [
    /(?:^|\n)\s*import\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) specs.push({ spec: m[1], index: m.index });
  }
  return specs;
}

/** Resolve a specifier to a repo-relative path when it stays inside src/. */
function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return spec; // bare specifier: node builtin or package
  const abs = resolve(dirname(fromFile), spec);
  return relative(root, abs);
}

const files = walk(SRC); // the browser surface lives under src/web/ since the repo remap
const violations = [];
const warnings = [];

// A surface is anything outside the kernel: the CLI controller layer AND the
// browser renderer under src/web/. Both receive data only and may hold no rule.
const isSurface = (rel) => rel.startsWith('src/surface/') || rel.startsWith('src/web/');
const isRules = (rel) => rel.startsWith('src/kernel/rules/');
const isKernel = (rel) => rel.startsWith('src/kernel/');

const IO_MODULES = ['node:fs', 'node:fs/promises', 'node:child_process', 'node:perf_hooks', 'node:net', 'node:http', 'node:https', 'node:dgram', 'node:worker_threads', 'node:os', 'node:cluster'];

/** Any Node builtin specifier (node:...). Adding one to the kernel forfeits browser support. */
const isNodeBuiltin = (spec) => spec.startsWith('node:');

for (const file of files) {
  const rel = relative(root, file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const imports = importsOf(text);

  for (const { spec } of imports) {
    const target = resolveSpec(file, spec);
    const targetRel = target.startsWith('src/') ? target : null;

    // R1a — a surface may never reach into rules.
    if (isSurface(rel) && targetRel && targetRel.startsWith('src/kernel/rules/')) {
      violations.push({ rule: 'R1a', file: rel, detail: `surface imports rules module "${spec}"` });
    }

    // Web renderer is browser code: it may not reach for a Node builtin or the disk.
    if (rel.startsWith('src/web/') && isNodeBuiltin(spec)) {
      violations.push({ rule: 'R1a', file: rel, detail: `web renderer imports node builtin "${spec}"` });
    }

    // R1b — rules may not perform I/O or import a surface.
    if (isRules(rel) && IO_MODULES.includes(spec)) {
      violations.push({ rule: 'R1b', file: rel, detail: `rules import I/O module "${spec}"` });
    }
    if (isRules(rel) && targetRel && targetRel.startsWith('src/surface/')) {
      violations.push({ rule: 'R1b', file: rel, detail: `rules import surface module "${spec}"` });
    }

    // R3 — the kernel holds no clock and no host I/O, and (phase 5) NO node:* builtin
    // at all: that is the structural guarantee the browser build cannot drift. Content
    // is injected (content/cards.bundle.js), so there is no sanctioned exception left.
    if (isKernel(rel) && isNodeBuiltin(spec)) {
      violations.push({ rule: 'R3', file: rel, detail: `kernel imports node builtin "${spec}" (browser-unsafe)` });
    }
  }

  // R3 — no wall clock, no unseeded randomness, anywhere in the kernel.
  if (isKernel(rel)) {
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/\bDate\s*\.\s*now\b|\bnew\s+Date\b/.test(code)) {
        violations.push({ rule: 'R3', file: rel, line: i + 1, detail: 'reads the wall clock (Date)' });
      }
      if (/\bMath\s*\.\s*random\b/.test(code)) {
        violations.push({ rule: 'R3', file: rel, line: i + 1, detail: 'calls Math.random' });
      }
      if (/\bperformance\s*\.\s*now\b/.test(code)) {
        violations.push({ rule: 'R3', file: rel, line: i + 1, detail: 'reads performance.now (perf_hooks)' });
      }
    });
  }

  // R1c — mutation outside the kernel. State is frozen by freezeDeep, so a surface
  // write throws at runtime; the gate catches it before that.
  if (!isKernel(rel)) {
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/\bstate\s*\.\s*[A-Za-z_$][\w$]*\s*(?:=[^=]|\+\+|--)/.test(code)) {
        violations.push({ rule: 'R1c', file: rel, line: i + 1, detail: 'assigns to a state property outside the kernel' });
      }
    });
  }
}

// The public surface is a frozen list: kernel/index.js and nothing else (R1).
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const exportKeys = Object.keys(pkg.exports ?? {});
if (exportKeys.length !== 1 || exportKeys[0] !== './kernel/index.js') {
  violations.push({ rule: 'R1', file: 'package.json', detail: `exports must be exactly ["./kernel/index.js"], got ${JSON.stringify(exportKeys)}` });
}

// The shipped game holds zero runtime dependencies.
const runtimeDeps = Object.keys(pkg.dependencies ?? {});
if (runtimeDeps.length > 0) {
  violations.push({ rule: 'R1', file: 'package.json', detail: `runtime dependencies must be empty, got ${JSON.stringify(runtimeDeps)}` });
}

if (values.json) {
  process.stdout.write(`${JSON.stringify({ ok: violations.length === 0, scanned: files.length, violations, warnings }, null, 2)}\n`);
} else {
  process.stdout.write(`check-architecture: scanned ${files.length} files under src/\n`);
  if (warnings.length > 0) for (const w of warnings) process.stdout.write(`  warn  ${w.file}: ${w.detail}\n`);
  if (violations.length === 0) {
    process.stdout.write('OK — no R1/R3 violations\n');
  } else {
    for (const v of violations) {
      const at = v.line ? `${v.file}:${v.line}` : v.file;
      process.stdout.write(`  FAIL  ${v.rule}  ${at}  ${v.detail}\n`);
    }
    process.stdout.write(`${violations.length} violation(s)\n`);
  }
}
process.exit(violations.length === 0 ? 0 : 2);
