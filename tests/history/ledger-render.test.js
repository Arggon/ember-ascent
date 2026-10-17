// tests/history/ledger-render.test.js — the GUI records a finished run and renders its ledger.
//
// Regression: src/web/app.js defined recordRun() but never called it, and recordRun() read an
// undeclared `runSubmitted`, so the end screen never showed the ledger, marks or unlocks.
// Drives the REAL src/web/app.js against the same fake DOM as tests/kernel/reward-click.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let uid = 0;
class N {
  constructor(tag) {
    this.tag = tag; this.uid = uid++; this.kids = []; this.parent = null;
    this.attrs = {}; this._cls = ''; this.txt = ''; this.style = {};
    this._ls = {}; this.disabled = false;
  }
  set className(v) { this._cls = String(v); }
  get className() { return this._cls; }
  get classList() {
    const list = () => this._cls.split(/\s+/).filter(Boolean);
    const set = (a) => { this._cls = a.join(' '); };
    return {
      contains: (c) => list().includes(c),
      add: (...cs) => set([...new Set([...list(), ...cs])]),
      remove: (...cs) => set(list().filter((x) => !cs.includes(x))),
      toggle: (c, force) => { const on = force ?? !list().includes(c); if (on) set([...new Set([...list(), c])]); else set(list().filter((x) => x !== c)); return on; },
    };
  }
  set textContent(v) { this.txt = String(v); this.kids = []; }
  get textContent() { return this.txt; }
  append(...c) { for (let x of c) if (x != null) { if (typeof x !== 'object') { const t = new N('#text'); t.txt = String(x); x = t; } x.parent = this; this.kids.push(x); } }
  prepend(...c) { const add = c.filter((x) => x != null); for (const x of add) x.parent = this; this.kids.unshift(...add); }
  appendChild(c) { c.parent = this; this.kids.push(c); return c; }
  replaceChildren(...c) { this.kids = []; this.append(...c); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, fn) { (this._ls[t] ||= []).push(fn); }
  removeEventListener() {}
  closest(sel) {
    const want = sel.replace(/^\./, '');
    let n = this;
    while (n) { if (n._cls.split(/\s+/).includes(want)) return n; n = n.parent; }
    return null;
  }
  querySelector(sel) {
    const hit = this._all().find((n) => m(n, sel));
    if (hit) return hit;
    // Fallback: some builders set style on a child obtained before insertion.
    const g = (root && root._all ? root._all() : []).find((n) => m(n, sel));
    return g ?? null;
  }
  querySelectorAll(sel) { return this._all().filter((n) => m(n, sel)); }
  _all() { const o = []; const go = (n) => { for (const k of n.kids) { o.push(k); go(k); } }; go(this); return o; }
  focus() {}
  dispatch(type, extra = {}) {
    const ev = { type, target: this, ...extra };
    let n = this;
    const chain = [];
    while (n) { chain.push(n); n = n.parent; }
    for (const node of chain) {
      ev.currentTarget = node;
      for (const fn of node._ls[type] || []) fn(ev);
    }
  }
}
function m(n, sel) {
  const a = /^\[data-([a-z-]+)="([^"]*)"\]$/.exec(sel);
  if (a) return n.attrs[`data-${a[1]}`] === a[2];
  if (sel.startsWith('.')) return n._cls.split(/\s+/).includes(sel.slice(1));
  // Tag selector (e.g. 'i'). Without this the shim cannot find `el('i', {})`, which the
  // renderer queries immediately after building it — a harness gap, not an app bug.
  return n.tag === sel;
}

const root = new N('body');
const byId = {};
for (const id of ['hud', 'stage', 'toast', 'live', 'app']) { const d = new N('div'); d._cls = id; byId[id] = d; root.append(d); }
globalThis.document = {
  getElementById: (id) => byId[id] ?? null,
  createElement: (t) => new N(t),
  createTextNode: (t) => { const n = new N('#text'); n.txt = String(t); return n; },
  querySelector: (s) => root.querySelector(s),
  querySelectorAll: (s) => root.querySelectorAll(s),
  addEventListener: () => {}, body: root,
};
globalThis.window = { addEventListener: () => {}, location: { search: '' } };
globalThis.location = { search: '' };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
globalThis.requestAnimationFrame = (f) => f();
globalThis.URLSearchParams = URLSearchParams;


// The renderer measures token cost asynchronously after each paint; that dynamic import
// escapes the test boundary and trips unhandledRejection. It is not what this test covers.
const origRAF = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = () => 0;

const toasts = [];
const appUrl = new URL('../../src/web/app.js', import.meta.url);
const rawSrc = readFileSync(appUrl, 'utf8');
// app.js's named imports (single- or multi-line) are re-bound from the real modules,
// except createController, which the factory below stubs with the test controller.
const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const importPrelude = [];
const importedModules = [];
for (const [, names, spec] of rawSrc.matchAll(IMPORT_RE)) {
  const bound = names.split(',').map((n) => n.trim()).filter(Boolean)
    .map((n) => { const [orig, local = orig] = n.split(/\s+as\s+/); return [orig, local]; })
    .filter(([, local]) => local !== 'createController');
  if (!bound.length) continue;
  const mod = await import(new URL(spec, appUrl));
  importPrelude.push(`const { ${bound.map(([o, l]) => (o === l ? o : `${o}: ${l}`)).join(', ')} } = __mods[${importedModules.length}];`);
  importedModules.push(mod);
}
let src = rawSrc
  // Strip every static import, including multi-line `import {\n ... \n} from '...';`.
  .replace(/^import\b[\s\S]*?\bfrom\s*['"][^'"]+['"];?[ \t]*$|^import\s*['"][^'"]+['"];?[ \t]*$/gm, '')
  .replace(/\bboot\(\)\s*;?\s*$/, '');
// Record every toast, and expose the internals we need to inspect.
src = src.replace('function toast(msg, kind = \'warn\') {', 'function toast(msg, kind = \'warn\') { __toasts.push(msg);');
src = 'async function measure(){ return null; }\n' + src;
src += '\nreturn { render, act, snapGet(){return snap;}, get lastRecord(){return lastRecord;} };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__toasts', '__mods', `
  function createController(){ return __ctl; }
  ${importPrelude.join('\n')}
  ${src}
`);

/** Play a seeded run to its end through the renderer's own act(), first legal action each step. */
function playToEnd(seed) {
  localStorage._d = {};
  const ctl = ctlMod.createController({ run: { seed } });
  const api = factory(ctl, [], importedModules);
  let guard = 0;
  while (ctl.snapshot().phase !== 'ended' && guard++ < 5000) {
    const a = ctl.snapshot().actions?.[0];
    if (!a) break;
    api.act(a.id ?? a);
  }
  return { ctl, api };
}

test('a run that ends through the GUI is recorded once, with its real action log', () => {
  const { ctl, api } = playToEnd(1);
  assert.equal(ctl.snapshot().phase, 'ended', 'the run reaches its end');
  const rec = api.lastRecord;
  assert.ok(rec, 'recordRun() ran at the ended transition (lastRecord is set)');
  assert.equal(rec.steps, ctl.submitted.length, 'record.steps counts the submitted log, not an undefined variable');
  assert.ok(rec.steps > 0, 'the log is non-empty');
  const stored = JSON.parse(localStorage.getItem('dlb.runs.v1') ?? 'null');
  assert.ok(stored && stored.records.length === 1, 'exactly one record is stored for one run');
});

test('the end screen renders the ledger, not the no-record fallback', () => {
  const { api } = playToEnd(7);
  byId.stage.replaceChildren();
  api.render();
  const ledger = byId.stage.querySelectorAll('.run-ledger');
  assert.equal(ledger.length, 1, 'one .run-ledger block is rendered');
  assert.equal(byId.stage.querySelectorAll('.ledger-line').length >= 6, true, 'all ledger lines are shown');
  assert.equal(byId.stage.querySelectorAll('.ledger-total').length, 1, 'the total is shown');
});
