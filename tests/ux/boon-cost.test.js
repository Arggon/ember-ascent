// #40: every Kindling boon shows its full price on the choice itself, before the pick.
// QA: a boon's cost could be missed (Iron Skin's relic-off price had no 'Lose' keyword, so
// nothing marked it as a cost; on phones the cost sat in the same run-on sentence).
// Drives the REAL src/web/app.js against the fake DOM from hero-select.test.js, across
// many seeds so every boon id is offered, and checks each boon button carries a labelled
// cost line whose text is the kernel's cost sentence. A CSS check makes sure no rule hides
// or clips that line.
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
// Count act title cards ever ADDED to the fx layer (a run rebuild also clears the layer,
// so a live count would lie).
const fxAdded = [];
{
  const layer = byId['fx-layer'];
  const append = layer.append.bind(layer);
  layer.append = (...c) => { for (const x of c) if (x && x._cls) fxAdded.push(x._cls); append(...c); };
}

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
src += '\nreturn { render, newGame, snapGet(){ return snap; } };';
const api = new Function('__mods', `${importPrelude.join('\n')}\n${src}`)(importedModules);

import { BOONS, BOON_IDS } from '../../src/kernel/rules/kindling.js';

const costOf = (text) => text.slice(text.indexOf('. ') + 2);

test('every boon on offer shows a labelled cost line with the kernel cost sentence', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    api.newGame(seed, { quiet: true });
    const s = api.snapGet();
    assert.equal(s.phase, 'kindling', `seed ${seed}: run opens on Kindling`);
    const buttons = byId.stage.querySelectorAll('.boon').filter((b) => b.attrs['data-action']?.startsWith('k'));
    assert.equal(buttons.length, s.kindling.boons.length, `seed ${seed}: one button per boon`);
    s.kindling.boons.forEach((b, i) => {
      seen.add(b.id);
      const cost = buttons[i].querySelector('.boon-cost');
      assert.ok(cost, `seed ${seed} ${b.name}: no .boon-cost line`);
      const txt = cost._all().map((n) => n.txt).join('') + cost.txt;
      assert.match(txt, /^Cost: /, `seed ${seed} ${b.name}: cost line is not labelled`);
      assert.equal(txt.replace(/^Cost: /, ''), costOf(b.text), `seed ${seed} ${b.name}: cost line must be the full kernel cost`);
      assert.ok(costOf(b.text).length > 3, `${b.name}: kernel text has no cost sentence`);
      const label = buttons[i].attrs['aria-label'];
      assert.ok(label.includes(costOf(b.text)), `${b.name}: accessible name must include the cost`);
    });
  }
  assert.deepEqual([...seen].sort(), [...BOON_IDS].sort(), 'every boon id was offered and checked');
  for (const id of BOON_IDS) assert.ok(BOONS[id].text.includes('. '), `${id}: text must be 'upside. cost.'`);
});

test('no stylesheet rule hides or clips the boon cost line', () => {
  const css = readFileSync(new URL('../../src/web/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const offenders = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [sel, body] = [m[1].trim(), m[2]];
    if (!/\.boon-cost\b|\.boon-list|\.kindling \.boon\b|^\.boon\b|,\s*\.boon\b/.test(sel)) continue;
    if (/display\s*:\s*none|visibility\s*:\s*hidden|line-clamp|text-overflow|(?<![-\w])overflow\s*:\s*hidden|max-height/.test(body)) offenders.push(`${sel} { ${body.trim()} }`);
  }
  assert.deepEqual(offenders, []);
});

test('landscape phones (915x412, 844x390): three boons fit one row, so no cost drops below the fold', () => {
  // The landscape Kindling plate gives the boon list 618px (#52 review). Three boons at their
  // flex-basis plus two gaps must fit it, or the third wraps under the fold.
  const css = readFileSync(new URL('../../src/web/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = /@media \(max-height: 480px\) \{([\s\S]*?)\n\}/g;
  let basis = null;
  for (const m of css.matchAll(block)) { const b = /\.kindling \.boon \{[^}]*flex-basis:\s*(\d+)px/.exec(m[1]); if (b) basis = Number(b[1]); }
  assert.ok(basis !== null, 'a landscape flex-basis for .kindling .boon exists');
  const gap = Number(/\.boon-list \{[^}]*gap:\s*(\d+)px/.exec(css)[1]);
  assert.ok(3 * basis + 2 * gap <= 618, `3 x ${basis}px + 2 x ${gap}px must fit 618px`);
});
