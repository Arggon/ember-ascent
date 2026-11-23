#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');

const BEAT_DELAYS = [1, 2, 3];
const MAX_STEPS = 9;
const MAX_TICKS = 6;
const MAX_ACTIONS = 2;
const MAX_SEEN = 200000;
export const VARIANTS = ['current', 'per-timer-generation', 'unguarded-fire'];

export function functionBody(text, name) {
  const start = text.search(new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`));
  if (start < 0) return null;
  const open = text.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  let mode = 'code';
  let quote = '';
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') { mode = 'line'; i += 1; continue; }
      if (ch === '/' && next === '*') { mode = 'block'; i += 1; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { mode = 'string'; quote = ch; continue; }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(open, i + 1);
      }
    } else if (mode === 'line') {
      if (ch === '\n') mode = 'code';
    } else if (mode === 'block') {
      if (ch === '*' && next === '/') { mode = 'code'; i += 1; }
    } else if (ch === '\\') {
      i += 1;
    } else if (ch === quote) {
      mode = 'code';
    }
  }
  return null;
}

export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

export function checkSource(root = ROOT) {
  const fxPath = join(root, 'src/web/fx.js');
  const runtimePath = join(root, 'src/web/runtime.js');
  const fx = readFileSync(fxPath, 'utf8');
  const runtime = readFileSync(runtimePath, 'utf8');
  const violations = [];
  const dispatch = functionBody(fx, 'dispatchFx');
  if (!dispatch) {
    violations.push({ file: 'src/web/fx.js', detail: 'FX1: dispatchFx is missing. Fix: keep the exported dispatchFx entry point.' });
  } else {
    const code = stripComments(dispatch);
    const bumps = code.match(/(?:bumpAnimGen\(\)|\+\+animGen|animGen\s*\+=)/g) ?? [];
    if (bumps.length !== 1 || !/const\s+gen\s*=\s*bumpAnimGen\(\)/.test(code)) {
      violations.push({
        file: 'src/web/fx.js',
        detail: `FX1: dispatchFx captures ${bumps.length} effect generations. Fix: capture one const gen = bumpAnimGen() before scheduling any beat and route every delayed beat through fire() (bfa7bf7).`,
      });
    }
    if (!/const\s+fire\s*=\s*\(\s*fn\s*,\s*ms\s*\)\s*=>\s*later\(\(\)\s*=>\s*\{\s*if\s*\(\s*gen\s*===\s*animGen\s*\)\s*fn\(\)\s*;\s*\}\s*,\s*ms\s*\)/.test(code)) {
      violations.push({
        file: 'src/web/fx.js',
        detail: 'FX2: delayed beats no longer share the guarded fire() helper. Fix: `const fire = (fn, ms) => later(() => { if (gen === animGen) fn(); }, ms);` (bfa7bf7).',
      });
    }
  }
  const skip = functionBody(runtime, 'skipAnim');
  if (!skip || !/\b(?:animGen\s*\+=\s*1|\+\+animGen|bumpAnimGen\(\))/.test(stripComments(skip))) {
    violations.push({
      file: 'src/web/runtime.js',
      detail: 'FX3: skipAnim no longer retires pending beats by generation. Fix: bump animGen inside skipAnim (bfa7bf7, 7906900).',
    });
  }
  const laterFn = functionBody(runtime, 'later');
  if (!laterFn || !/fxTimers\.push\(/.test(stripComments(laterFn))) {
    violations.push({
      file: 'src/web/runtime.js',
      detail: 'FX4: later() stopped tracking effect timers. Fix: keep fxTimers.push(t) so clearFxTimers() can retire the previous run.',
    });
  }
  return { ok: violations.length === 0, violations };
}

function initialState() {
  return { gen: 0, timers: [], fires: [], starts: {}, dispatched: 0, tick: 0, invalidated: [], resets: 0, skips: 0 };
}

function clone(state) {
  return {
    ...state,
    timers: state.timers.map((t) => ({ ...t })),
    fires: state.fires.map((f) => ({ ...f })),
    starts: { ...state.starts },
    invalidated: state.invalidated.slice(),
  };
}

function invalidate(state) {
  for (const timer of state.timers) {
    if (!state.invalidated.includes(timer.action)) state.invalidated.push(timer.action);
  }
}

function dispatchAction(state, variant) {
  const s = clone(state);
  invalidate(s);
  const action = `a${s.dispatched + 1}`;
  s.dispatched += 1;
  s.starts[action] = s.tick;
  const schedule = (id, delay, gen) => s.timers.push({ id, action, gen, due: s.tick + delay });
  if (variant === 'per-timer-generation') {
    BEAT_DELAYS.forEach((delay, i) => schedule(`${action}.beat${i + 1}`, delay, ++s.gen));
    s.gen += 1;
    schedule(`${action}.feel`, 1, s.gen);
  } else {
    const gen = ++s.gen;
    BEAT_DELAYS.forEach((delay, i) => schedule(`${action}.beat${i + 1}`, delay, gen));
    schedule(`${action}.feel`, 1, gen);
  }
  return s;
}

function advance(state, variant) {
  const s = clone(state);
  s.tick += 1;
  const due = s.timers.filter((t) => t.due <= s.tick);
  s.timers = s.timers.filter((t) => t.due > s.tick);
  for (const timer of due) {
    if (variant === 'unguarded-fire' || timer.gen === s.gen) {
      s.fires.push({ id: timer.id, action: timer.action, timerGen: timer.gen, atGen: s.gen, at: s.tick });
    }
  }
  return s;
}

function skip(state) {
  const s = clone(state);
  invalidate(s);
  s.gen += 1;
  s.skips += 1;
  return s;
}

function reset(state) {
  const s = clone(state);
  invalidate(s);
  s.timers = [];
  s.gen += 1;
  s.resets += 1;
  return s;
}

function transitions(state) {
  const out = [];
  if (state.dispatched < MAX_ACTIONS) out.push({ name: `dispatch(a${state.dispatched + 1})`, next: dispatchAction });
  if (state.tick < MAX_TICKS) out.push({ name: 'tick', next: advance });
  if (state.skips < 1) out.push({ name: 'skipAnim()', next: skip });
  if (state.resets < 1) out.push({ name: 'newGame()/clearFxTimers()', next: reset });
  return out;
}

function violations(state) {
  const out = [];
  const ids = state.fires.map((f) => f.id);
  if (new Set(ids).size !== ids.length) out.push('an effect fired twice');
  for (const fire of state.fires) {
    if (fire.timerGen !== fire.atGen) {
      out.push(`${fire.id} fired after its generation retired (timer gen ${fire.timerGen}, live gen ${fire.atGen})`);
    }
  }
  for (let a = 1; a <= state.dispatched; a += 1) {
    const action = `a${a}`;
    if (state.invalidated.includes(action) || state.tick - state.starts[action] < Math.max(...BEAT_DELAYS)) continue;
    const expected = BEAT_DELAYS.map((_, i) => `${action}.beat${i + 1}`).concat(`${action}.feel`);
    const missing = expected.filter((id) => !ids.includes(id));
    if (missing.length) out.push(`${action} effects never fired: ${missing.join(', ')}`);
  }
  return out;
}

function stateKey(state) {
  return JSON.stringify([
    state.gen, state.dispatched, state.tick, state.skips, state.resets,
    state.starts,
    state.timers.map((t) => [t.id, t.gen, t.due]),
    state.fires.map((f) => [f.id, f.timerGen, f.atGen]),
    state.invalidated,
  ]);
}

export function explore(variant = 'current') {
  if (!VARIANTS.includes(variant)) throw new Error(`unknown variant: ${variant}`);
  const queue = [{ state: initialState(), trace: [] }];
  const seen = new Set();
  while (queue.length > 0) {
    const { state, trace } = queue.shift();
    const key = stateKey(state);
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > MAX_SEEN) return { ok: false, violation: 'exploration bound exceeded', trace, explored: seen.size };
    const found = violations(state);
    if (found.length > 0) return { ok: false, violation: found[0], trace, explored: seen.size };
    if (trace.length >= MAX_STEPS) continue;
    for (const step of transitions(state)) {
      queue.push({ state: step.next(state, variant), trace: trace.concat(step.name) });
    }
  }
  return { ok: true, explored: seen.size };
}

const EXPECTATIONS = [
  { variant: 'current', pass: true },
  { variant: 'per-timer-generation', pass: false, match: /never fired/ },
  { variant: 'unguarded-fire', pass: false, match: /generation retired/ },
];

export function verify(root = ROOT) {
  const source = checkSource(root);
  const models = EXPECTATIONS.map((expectation) => {
    const result = explore(expectation.variant);
    const ok = result.ok === expectation.pass
      && (expectation.pass || expectation.match.test(result.violation));
    return { ...expectation, ...result, ok };
  });
  return { ok: source.ok && models.every((m) => m.ok), source, models };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const report = verify();
  for (const v of report.source.violations) process.stdout.write(`SOURCE ${v.file}: ${v.detail}\n`);
  for (const m of report.models) {
    const verdict = m.ok ? 'OK' : 'FAIL';
    process.stdout.write(`${verdict}  ${m.variant}: ${m.ok ? `${m.explored} states explored` : `${m.violation} after ${m.trace.join(' -> ')}`}\n`);
  }
  process.stdout.write(report.ok ? 'fx-generation: verified\n' : 'fx-generation: FAILED\n');
  process.exit(report.ok ? 0 : 1);
}
