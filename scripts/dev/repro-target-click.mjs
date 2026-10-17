// Decisive repro: does clicking an ENEMY resolve the target, or cancel it?
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
  get classList() { return { contains: (c) => this._cls.split(/\s+/).includes(c) }; }
  set textContent(v) { this.txt = String(v); this.kids = []; }
  get textContent() { return this.txt; }
  append(...c) { for (const x of c) if (x != null) { x.parent = this; this.kids.push(x); } }
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

const toasts = [];
let src = readFileSync(new URL('../../src/web/app.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/\bboot\(\)\s*;?\s*$/, '');
// Record every toast, and expose the internals we need to inspect.
src = src.replace('function toast(msg, kind = \'warn\') {', 'function toast(msg, kind = \'warn\') { __toasts.push(msg);');
src += '\nreturn { render, clickCard, pickTarget, cancelTargeting, get pendingSlot(){return pendingSlot;}, snapGet(){return snap;} };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const ctl = ctlMod.createController({ run: { seed: 11 } });
ctl.dispatch('n1');

const factory = new Function('__ctl', '__toasts', `
  function createController(){ return __ctl; }
  ${src}
`);
const api = factory(ctl, toasts);

api.render();
const before = ctl.snapshot();
console.log('energy', before.energy, '| enemies', before.enemies.length, '| hand', before.hand.map(h=>h.slot+':'+h.name).join(' '));

// Step 1: click the card (this is what the user does first).
const cardBtn = byId.stage.querySelector('[data-slot="p1"]') ?? byId.stage.querySelector('[data-slot]');
console.log('\nclicking hand card p1 ...');
cardBtn.dispatch('click');
console.log('  pendingSlot after card click =', api.pendingSlot);
if (api.pendingSlot === null) {
  console.log('  >>> targeting never engaged on click. toasts:', JSON.stringify(toasts));
  process.exit(0);
}

// Step 2: click an ENEMY. Dispatch from the innermost child, as a real pointer would.
const enemyEls = byId.stage.querySelectorAll('.enemy');
console.log('  enemy elements rendered:', enemyEls.length);
const targetEl = enemyEls[1] ?? enemyEls[0];
const inner = targetEl._all()[0] ?? targetEl;   // e.g. the SVG inside the button
console.log('\nclicking enemy 2 (dispatching from inner <' + inner.tag + '>) ...');
const toastsBefore = toasts.length;
inner.dispatch('click');
const toastsAfter = toasts.slice(toastsBefore);
console.log('  toasts emitted:', JSON.stringify(toastsAfter));
console.log('  pendingSlot now =', api.pendingSlot);

const after = ctl.snapshot();
console.log('\nRESULT');
console.log('  enemy HP:', before.enemies.map(e=>e.hp).join(',') , '->', after.enemies.map(e=>e.hp).join(','));
const cancelled = toastsAfter.some((t) => /cancel/i.test(t));
console.log('  outcome:', cancelled ? 'CANCELLED (bug present)' : 'RESOLVED (click played the card)');
