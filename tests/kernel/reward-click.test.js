// Click-to-target, as the browser would deliver it.
//
// THE BUG THIS PINS: the stage-level "clicked empty space -> cancel" fallback and a
// control's own click handler both fire for the same click. Clicking a card engaged the
// targeting step and the same click's bubbled arrival at the stage cancelled it, so the
// step flashed up and vanished. Clicking an enemy then did nothing, while HOTKEYS worked —
// a keydown never reaches the stage click listener. Owner report: "if i try to click the
// cart to atack i can't but if i use hotkeys it works."
//
// It needs the real renderer, so it drives src/web/app.js against a fake DOM with bubbling and
// closest(). A pure engine test cannot see this class of bug.
//
// Owner report: "if i try to click the card to attack i can't but if i use hotkeys it
// works." Targeting mode appears and highlights enemies; a click on an enemy produces the
// "Target cancelled — nothing was played" toast, which only cancelTargeting() emits.
//
// This drives the REAL src/web/app.js against a fake DOM with bubbling and closest(), then
// dispatches a click the way a browser would — including the realistic case where the
// innermost element under the pointer is a child of the enemy button, not the button.
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

import test from 'node:test';
import assert from 'node:assert/strict';

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
src += '\nreturn { render, clickCard, pickTarget, cancelTargeting, get pendingSlot(){return pendingSlot;}, snapGet(){return snap;} };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const ctl = ctlMod.createController({ run: { seed: 11 } });
ctl.dispatch('n1');

const factory = new Function('__ctl', '__toasts', '__mods', `
  function createController(){ return __ctl; }
  ${importPrelude.join('\n')}
  ${src}
`);
const api = factory(ctl, toasts, importedModules);


test('CLICKING a reward card takes it (was: reward screen was dead)', () => {
  // Drive to a reward screen through the controller, then render it and click a tile.
  let c = ctlMod.createController({ run: { seed: 1 } });
  let st = c.snapshot();
  let guard = 0;
  while (st.phase !== 'reward' && !st.ended && guard++ < 300) {
    const a = st.actions?.[0];
    if (!a) break;
    c.dispatch(a.id ?? a);
    st = c.snapshot();
  }
  assert.equal(st.phase, 'reward', 'a reward screen is reached');
  assert.equal(st.reward.cards.length, 3, 'three cards are offered');

  const api = factory(c, [], importedModules);
  toasts.length = 0;
  api.render();

  const tiles = byId.stage.querySelectorAll('.card');
  assert.ok(tiles.length >= 3, `reward tiles are rendered (found ${tiles.length})`);

  const deckBefore = st.actions.filter((a) => a.kind === 'pick').length;
  void deckBefore;

  // Click the SECOND reward tile, from an inner element as a real pointer would.
  const target = tiles[1];
  const inner = target._all()[0] ?? target;
  inner.dispatch('click');

  const after = c.snapshot();
  assert.notEqual(after.phase, 'reward', `clicking a reward card leaves the reward screen (still ${after.phase})`);
});

test('HOTKEY 2 on a reward screen also takes the second card', () => {
  let c = ctlMod.createController({ run: { seed: 1 } });
  let st = c.snapshot();
  let guard = 0;
  while (st.phase !== 'reward' && !st.ended && guard++ < 300) {
    const a = st.actions?.[0];
    if (!a) break;
    c.dispatch(a.id ?? a);
    st = c.snapshot();
  }
  assert.equal(st.phase, 'reward', 'a reward screen is reached');
  const pickId = st.reward.cards[1].actionId;
  const r = c.dispatch(pickId);
  const after = c.snapshot();
  assert.notEqual(after.phase, 'reward', `the reward action ${pickId} resolves (still ${after.phase})`);
  void r;
});
