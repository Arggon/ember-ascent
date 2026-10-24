// The surface's modules must LOAD as real ES modules — not only concatenated.
//
// WHY THIS EXISTS: the fake-DOM tests (tests/kernel/*.test.js) evaluate src/web/ through
// tests/web/app-bundle.mjs, which flattens every module into ONE scope. That preserves
// their evaluation contract, but it cannot see two real-ESM mistakes the flatten hides:
//   * a module importing a name its target never exported
//     ("does not provide an export named 'snap'");
//   * a module USING a sibling's export without importing it — in the concatenated scope
//     the name resolves anyway; in the browser it is a ReferenceError at first call.
// Both left the page blank in a real browser while every concatenated test stayed green.
//
// So this test does the one thing the concatenation cannot: it imports the REAL app entry
// as an ES module graph against a fake DOM and asserts the boot paint happened. It also
// statically cross-checks every intra-src/web import against the target's export list,
// so a used-but-not-imported name fails even when no code path reaches it during boot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------ static: imports resolve */

const webDir = new URL('../../src/web/', import.meta.url);
const files = readdirSync(fileURLToPath(webDir)).filter((x) => x.endsWith('.js'));
const exportsOf = {};
for (const f of files) {
  const names = new Set();
  for (const m of readFileSync(new URL(f, webDir), 'utf8')
    .matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  exportsOf[f] = names;
}

test('every intra-web import names an export its target really declares', () => {
  const bad = [];
  for (const f of files) {
    for (const m of readFileSync(new URL(f, webDir), 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\/[^']+)'/gs)) {
      const target = m[2].replace('./', '');
      for (const n of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        if (!exportsOf[target] || !exportsOf[target].has(n)) bad.push(`${f} imports {${n}} from ${m[2]}`);
      }
    }
  }
  assert.deepEqual(bad, [], `unresolved intra-src/web imports:\n  ${bad.join('\n  ')}`);
});

test('no module uses a sibling export without importing it (the flatten hides this)', () => {
  const allExports = new Map();
  for (const [f, names] of Object.entries(exportsOf)) for (const n of names) allExports.set(n, f);
  const bad = [];
  for (const f of files) {
    const src = readFileSync(new URL(f, webDir), 'utf8');
    const local = new Set();
    for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) local.add(m[1]);
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/gs)) {
      for (const n of m[1].split(',')) { const t = n.trim().split(/\s+as\s+/).pop(); if (t) local.add(t); }
    }
    // comments and string/template literals stripped: only code identifiers count
    const code = src.replace(/\/\/[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, ' ');
    for (const m of code.matchAll(/\b([a-z][A-Za-z_$\w$]{3,})\b/g)) {
      if (local.has(m[1]) || !allExports.has(m[1])) continue;
      bad.push(`${f} uses "${m[1]}" (exported by ${allExports.get(m[1])}) without importing it`);
    }
  }
  assert.deepEqual(bad, [], `free identifiers that are real-ESM ReferenceErrors:\n  ${bad.join('\n  ')}`);
});

/* -------------------------------------------------- dynamic: the real graph boots */

// The narrow fake DOM the surface needs at import time (same shape the kernel tests use).
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
    };
  }
  set textContent(v) { this.txt = String(v); this.kids = []; }
  get textContent() { return this.txt; }
  append(...c) { for (let x of c) if (x != null) { if (typeof x !== 'object') { const t = new N('#text'); t.txt = String(x); x = t; } x.parent = this; this.kids.push(x); } }
  prepend(...c) { for (const x of c) if (x != null) { x.parent = this; this.kids.unshift(...c); } }
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
  querySelector(sel) { return this._all().find((n) => n._cls.split(/\s+/).includes(sel.replace(/^\./, ''))) ?? null; }
  querySelectorAll(sel) { return this._all().filter((n) => n._cls.split(/\s+/).includes(sel.replace(/^\./, ''))); }
  _all() { const o = []; const go = (n) => { for (const k of n.kids) { o.push(k); go(k); } }; go(this); return o; }
  focus() {}
  remove() { if (this.parent) { this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; } }
  get firstElementChild() { return this.kids.find((k) => k.tag !== '#text') ?? null; }
}
const root = new N('body');
const byId = {};
for (const id of ['hud', 'stage', 'toast', 'live', 'app', 'fx-layer']) {
  const d = new N('div'); d._cls = id; byId[id] = d; root.append(d);
}
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
globalThis.requestAnimationFrame = () => 0;

test('importing src/web/app.js loads the real module graph and paints the kindling screen', async () => {
  const mod = await import('../../src/web/app.js');
  assert.ok(mod, 'the entry module resolves');
  // The boot ran at import: the same snapshot the page exposes, painted into #stage.
  const snap = globalThis.window.__dlb.snapshot();
  assert.equal(snap.phase, 'kindling', 'the first paint drew the boon screen');
  assert.ok(byId.stage._all().some((n) => n._cls && n._cls.split(/\s+/).includes('boon')), 'a boon button is on the stage');
});
