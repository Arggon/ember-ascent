// B5 Path select on the Kindling screen: the same radio-group behaviour as the hero picker
// (#26), and a Path switch is not a new act (review of #14).
//
// Before: switching Path replayed the Act I title card (a switch rebuilds the run and the
// first paint of a run plays it), and the arrow keys did nothing although the group is
// role=radiogroup. The Act I card also has to name the run's own biome.
//
// Drives the REAL web/app.js against the fake DOM from hero-select / click-targeting tests,
// with real controllers, so a switch really rebuilds the run on the other path.
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
  focus() { document.activeElement = this; }
  remove() { if (this.parent) { this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; } }
  get firstElementChild() { return this.kids.find((k) => k.tag !== '#text') ?? null; }
  dispatch(type, extra = {}) {
    const ev = { type, target: this, preventDefault() { this.defaultPrevented = true; }, ...extra };
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
  if (sel.startsWith('.')) { const have = n._cls.split(/\s+/); return sel.slice(1).split('.').every((c) => have.includes(c)); }
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
// Keep every act title card ever ADDED to the fx layer (a run rebuild also clears the layer,
// so a live count would lie).
const fxAdded = [];
{
  const layer = byId['fx-layer'];
  const append = layer.append.bind(layer);
  layer.append = (...c) => { for (const x of c) if (x && x._cls) fxAdded.push(x); append(...c); };
}

import test from 'node:test';
import assert from 'node:assert/strict';

const appUrl = new URL('../../web/app.js', import.meta.url);
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
src += '\nreturn { render, newGame, snapGet(){ return snap; } };';
const api = new Function('__mods', `${importPrelude.join('\n')}\n${src}`)(importedModules);


const actCards = () => fxAdded.filter((x) => x._cls === 'fx-act-card');
const actName = (card) => card._all().find((n) => n._cls === 'fx-act-name')?.txt;
const radios = () => byId.stage.querySelectorAll('.biome-pick');
const checked = () => radios().find((r) => r.attrs['aria-checked'] === 'true');
const biome = () => api.snapGet().biome;

test('a run opens with one Foundry title card; one tab stop on the checked path', () => {
  assert.equal(api.snapGet().phase, 'kindling');
  assert.equal(biome(), 'foundry');
  assert.equal(actCards().length, 1);
  assert.equal(actName(actCards()[0]), 'The Foundry');
  const rs = radios();
  assert.equal(rs.length, 2);
  assert.deepEqual(rs.map((r) => r.attrs.role), ['radio', 'radio']);
  assert.deepEqual(rs.map((r) => r.attrs.tabindex), ['0', '-1'], 'roving tabindex');
});

test('ArrowRight moves to the Mines, same seed, focus follows, no title card replays', () => {
  checked().dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(biome(), 'mines');
  assert.equal(api.snapGet().seed, 11);
  assert.ok(checked()._cls.includes('bp-mines'));
  assert.equal(document.activeElement, checked(), 'focus is on the newly checked radio');
  assert.deepEqual(radios().map((r) => r.attrs.tabindex), ['-1', '0']);
  assert.equal(actCards().length, 1, 'a Path switch is the same screen, not a new act');
});

test('arrows wrap and Home/End jump', () => {
  checked().dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(biome(), 'foundry', 'Right from the last path wraps to the first');
  checked().dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(biome(), 'mines', 'Left from the first path wraps to the last');
  checked().dispatch('keydown', { key: 'Home' });
  assert.equal(biome(), 'foundry');
  checked().dispatch('keydown', { key: 'End' });
  assert.equal(biome(), 'mines');
  checked().dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(biome(), 'foundry', 'Down moves to the next path (wrapping)');
  checked().dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(biome(), 'mines', 'Up moves to the previous path (wrapping)');
  const before = api.snapGet();
  checked().dispatch('keydown', { key: 'a' });
  assert.equal(api.snapGet(), before, 'other keys do nothing');
  assert.equal(actCards().length, 1, 'none of these switches replayed the title card');
});

test('a click switch is quiet; clicking the checked path is a no-op', () => {
  const runBefore = api.snapGet();
  checked().dispatch('click');
  assert.equal(api.snapGet(), runBefore);
  radios()[0].dispatch('click');
  assert.equal(biome(), 'foundry');
  assert.equal(actCards().length, 1);
});

test('a genuinely new run on the Mines plays a title card that names the Mines', () => {
  radios()[1].dispatch('click');
  assert.equal(biome(), 'mines');
  api.newGame();
  assert.equal(actCards().length, 2);
  assert.equal(actName(actCards()[1]), 'The Cinder Mines');
});
