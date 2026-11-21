// Fixed start — the HARD CONSTRAINT, pinned: the surface no longer offers a hero or a
// path picker, but the URL seeding (?hero=/?biome=, read ONCE at import time in
// actions.js) must keep the other hero and the other start path reachable. This file
// boots the app with both params set and pins that the run really is the Bellows Keeper
// in the Cinder Mines — deleting either from the kernel must break this test even though
// no picker exists anywhere. A second run through newGame() must preserve the seeding
// (the choices are module-level state, so a plain restart must not silently drop them).
//
// Drives the REAL src/web/app.js against its own copy of the fake-DOM harness (every
// kernel test owns one — the seeding is read at import time, so a file cannot re-seed
// after boot), with real controllers, so the pinned paint is what the app really renders.
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
    // stopPropagation is part of the generic event API a real DOM models and any view
    // may rely on, so the shim models it too: the walk ends after the node that stopped
    // the bubble.
    const ev = {
      type, target: this,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      ...extra,
    };
    let n = this;
    const chain = [];
    while (n) { chain.push(n); n = n.parent; }
    for (const node of chain) {
      ev.currentTarget = node;
      for (const fn of node._ls[type] || []) fn(ev);
      if (ev.stopped) break;
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
// THE SEEDED BOOT — the whole point of this file: both params set, BEFORE the app bundle
// evaluates (actions.js reads location.search once, at import time).
globalThis.window = { addEventListener: () => {}, location: { search: '?seed=11&hero=bellows_keeper&biome=mines' } };
globalThis.location = { search: '?seed=11&hero=bellows_keeper&biome=mines' };
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
import { bundleApp } from '../web/app-bundle.mjs';

const appUrl = new URL('../../src/web/app.js', import.meta.url);
// The surface is split into sibling ES modules (src/web/*.js); bundleApp concatenates
// them back into ONE sloppy-mode body — the same evaluation contract the sibling tests
// always used — re-binding every kernel/surface import from the real modules.
const { prelude, body, mods: importedModules } = await bundleApp(appUrl);
let src = body
  .replace(/\bboot\(\)\s*;?\s*$/, '');
src = 'async function measure(){ return null; }\n' + src;
src += '\nreturn { render, newGame, snapGet(){ return snap; } };';
const api = new Function('__mods', `${prelude}\n${src}`)(importedModules);

const actCards = () => fxAdded.filter((x) => x._cls === 'fx-act-card');
const actName = (card) => card._all().find((n) => n._cls === 'fx-act-name')?.txt;

test('the ?hero=/?biome= seeding still reaches the retired pickers\' content: a Bellows run in the Mines, kindling, no pickers', () => {
  assert.equal(api.snapGet().phase, 'kindling');
  assert.equal(api.snapGet().character, 'bellows_keeper', 'the ?hero= seed made the run a Bellows-Keeper run');
  assert.equal(api.snapGet().biome, 'mines', 'the ?biome= seed made the run a Mines run');
  assert.equal(actCards().length, 1, 'the seeded run opens with its one act title card');
  assert.equal(actName(actCards()[0]), 'The Cinder Mines', 'the title card names the seeded biome');
  assert.equal(byId.stage.querySelectorAll('.hero-pick').length, 0, 'no hero picker exists');
  assert.equal(byId.stage.querySelectorAll('.biome-pick').length, 0, 'no path picker exists');
  assert.ok(byId.stage.querySelectorAll('.boon').length >= 1, 'the kindling boon list is painted');
});

test('newGame() preserves the URL seeding (the choices are module-level state)', () => {
  const n = actCards().length;
  api.newGame();
  assert.equal(api.snapGet().character, 'bellows_keeper', 'the hero seeding survives a plain new run');
  assert.equal(api.snapGet().biome, 'mines', 'the biome seeding survives a plain new run');
  assert.equal(actCards().length, n + 1, 'a genuinely new run plays its title card');
  assert.equal(actName(actCards()[actCards().length - 1]), 'The Cinder Mines', 'and the new card still names the seeded biome');
});
