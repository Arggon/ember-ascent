// The New Run buttons must start a new run.
//
// THE BUG THIS PINS: both New Run buttons (HUD and help panel) were wired as
// `on: { click: newGame }`, so the browser called `newGame(event)` and the click event
// became the SEED. The kernel rejected it ("seed must be an integer in [0, 2^32], got
// [object PointerEvent]"), the handler threw, and no new run started. Only the `n` hotkey,
// which calls `newGame()` with no argument, worked.
//
// Drives the REAL src/web/app.js against a fake DOM (shim from click-targeting.test.js) with
// real controllers, and clicks the buttons the way a browser does: with an event object.
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
  remove() { if (this.parent) { this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; } }
  get firstElementChild() { return this.kids.find((k) => k.tag !== '#text') ?? null; }
  dispatch(type, extra = {}) {
    const ev = { type, target: this, preventDefault() {}, stopPropagation() {}, ...extra };
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
for (const id of ['hud', 'stage', 'toast', 'live', 'app', 'fx-layer']) { const d = new N('div'); d._cls = id; byId[id] = d; root.append(d); }
globalThis.document = {
  getElementById: (id) => byId[id] ?? null,
  createElement: (t) => new N(t),
  createTextNode: (t) => { const n = new N('#text'); n.txt = String(t); return n; },
  querySelector: (s) => root.querySelector(s),
  querySelectorAll: (s) => root.querySelectorAll(s),
  addEventListener: () => {}, body: root, activeElement: null,
};
globalThis.window = { addEventListener: () => {}, location: { search: '?seed=11' } };
globalThis.location = { search: '?seed=11' };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
globalThis.URLSearchParams = URLSearchParams;
globalThis.requestAnimationFrame = () => 0;

import test from 'node:test';
import assert from 'node:assert/strict';

const appUrl = new URL('../../src/web/app.js', import.meta.url);
const rawSrc = readFileSync(appUrl, 'utf8');
const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const importPrelude = [];
const importedModules = [];
for (const [, names, spec] of rawSrc.matchAll(IMPORT_RE)) {
  const bound = names.split(',').map((n) => n.trim()).filter(Boolean)
    .map((n) => { const [orig, local = orig] = n.split(/\s+as\s+/); return [orig, local]; });
  if (!bound.length) continue;
  const mod = await import(new URL(spec, appUrl));
  importPrelude.push(`const { ${bound.map(([o, l]) => (o === l ? o : `${o}: ${l}`)).join(', ')} } = __mods[${importedModules.length}];`);
  importedModules.push(mod);
}
let src = rawSrc
  .replace(/^import\b[\s\S]*?\bfrom\s*['"][^'"]+['"];?[ \t]*$|^import\s*['"][^'"]+['"];?[ \t]*$/gm, '')
  .replace(/\bboot\(\)\s*;?\s*$/, '');
src = 'async function measure(){ return null; }\n' + src;
src += '\nreturn { render, snapGet(){ return snap; }, ctlGet(){ return ctl; } };';
const api = new Function('__mods', `${importPrelude.join('\n')}\n${src}`)(importedModules);

const textOf = (n) => n.txt + n._all().map((k) => k.txt).join('');
const buttonIn = (scope, re) => scope._all().find((n) => n.tag === 'button' && re.test(textOf(n)));
// What a browser hands a click listener: an event object, NOT nothing.
const clickEvent = () => ({ type: 'click', pointerType: 'mouse', button: 0, detail: 1 });

/** Take one step so the run is no longer fresh; a new run is then visible as stepIndex 0. */
function advance() {
  const first = api.ctlGet().actions()[0];
  api.ctlGet().dispatch(first.id);
  api.render();
  assert.ok(api.snapGet().stepIndex > 0 || api.ctlGet().state.stepIndex > 0, 'the run has advanced');
}

test('clicking the HUD New Run button starts a new run (the event is not taken as the seed)', () => {
  advance();
  const before = api.ctlGet();
  const btn = buttonIn(byId.hud, /^New Run$/);
  assert.ok(btn, 'the HUD has a New Run button');
  assert.doesNotThrow(() => btn.dispatch('click', clickEvent()));
  assert.notEqual(api.ctlGet(), before, 'a new run (controller) was created');
  assert.equal(api.ctlGet().state.stepIndex, 0, 'the new run starts at step 0');
  assert.equal(api.snapGet().seed, 11, 'it uses the URL seed, not the click event');
});

test('clicking New Run in the help panel starts a new run too', () => {
  advance();
  const help = buttonIn(byId.hud, /^Help$/);
  assert.ok(help, 'the HUD has a Help button');
  help.dispatch('click', clickEvent());
  const hudButtons = byId.hud._all();
  const btn = root._all().find((n) => n.tag === 'button' && /^New Run$/.test(textOf(n)) && !hudButtons.includes(n));
  assert.ok(btn, 'the help panel has a New Run button');
  const before = api.ctlGet();
  assert.doesNotThrow(() => btn.dispatch('click', clickEvent()));
  assert.notEqual(api.ctlGet(), before, 'a new run (controller) was created');
  assert.equal(api.ctlGet().state.stepIndex, 0);
  assert.equal(api.snapGet().seed, 11);
});
