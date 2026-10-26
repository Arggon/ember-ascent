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
    // Declared names at ANY position, not only line starts: a `for (const n of ...)`
    // loop variable or a mid-line `const` is a local, and short names (`el`, `n`, `b`)
    // are exactly the ones a narrow scan would miss — the run-history.js `el` defect
    // shipped through this test because it only looked at names of 4+ characters.
    for (const m of src.matchAll(/\b(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|class\s+)([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/gs)) {
      for (const n of m[1].split(',')) { const t = n.trim().split(/\s+as\s+/).pop(); if (t) local.add(t); }
    }
    // Function parameters are locals too (`(el) => ...`, `(b, lane) => ...`).
    for (const m of src.matchAll(/\(([^()]*)\)\s*=>|\bfunction\b[^ (]*\(([^()]*)\)/g)) {
      for (const part of (m[1] ?? m[2] ?? '').split(',')) {
        const p = part.trim().replace(/=[^,]*/, '').split(/\s+/).pop();
        if (p && /^[A-Za-z_$][\w$]*$/.test(p)) local.add(p);
      }
    }
    // comments and string/template literals stripped: only code identifiers count
    const code = src.replace(/\/\/[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, ' ');
    for (const m of code.matchAll(/\b([a-z][A-Za-z_$\w$]*)\b/g)) {
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
    this.attrs = {}; this._cls = ''; this.txt = ''; this._sty = {};
    this._ls = {}; this.disabled = false;
  }
  // A recording CSSOM stand-in: custom properties go through setProperty, plain
  // property writes are tolerated (they are dropped, exactly as with a bare object).
  get style() {
    const self = this;
    return {
      setProperty: (k, v) => { self._sty[k] = String(v); },
      getPropertyValue: (k) => self._sty[k] ?? '',
    };
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
  querySelector(sel) { return this._all().find((n) => matchesSel(n, sel)) ?? null; }
  querySelectorAll(sel) { return this._all().filter((n) => matchesSel(n, sel)); }
  _all() { const o = []; const go = (n) => { for (const k of n.kids) { o.push(k); go(k); } }; go(this); return o; }
  focus() {}
  remove() { if (this.parent) { this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; } }
  get firstElementChild() { return this.kids.find((k) => k.tag !== '#text') ?? null; }
  // The walk below drives handlers exactly the way a click would.
  dispatch(type, ev = {}) { ev.target ??= this; for (const fn of this._ls[type] ?? []) fn(ev); }
  // throwLane() and the melee approach measure live boxes; a host with no layout
  // answers the zero box, the same answer every other fake DOM gives.
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}
const root = new N('body');
/** Class selectors (`.card`) match the class list; bare selectors (`i`, `button`) match the tag. */
function matchesSel(n, sel) {
  if (sel.startsWith('.')) return n._cls.split(/\s+/).includes(sel.slice(1));
  return n.tag === sel;
}
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
// Reduced motion + animations skipped: the walk below drives a WHOLE RUN, and waiting
// out every pose hold and killing-stroke beat in real time would cost it ~9s. The
// reduced-motion path paints every screen instantly and is itself an accessibility
// contract — a fine shape for the walk to run under.
globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
globalThis.localStorage = { _d: { 'ea.animSpeed': '0' }, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
globalThis.requestAnimationFrame = () => 0;

test('importing src/web/app.js loads the real module graph and paints the kindling screen', async () => {
  const mod = await import('../../src/web/app.js');
  assert.ok(mod, 'the entry module resolves');
  // The boot ran at import: the same snapshot the page exposes, painted into #stage.
  const snap = globalThis.window.__dlb.snapshot();
  assert.equal(snap.phase, 'kindling', 'the first paint drew the boon screen');
  assert.ok(byId.stage._all().some((n) => n._cls && n._cls.split(/\s+/).includes('boon')), 'a boon button is on the stage');
});

/* ------------------------------------------- dynamic: a full run through the REAL graph */

/**
 * The ended screen was the one surface no test reached: the fake-DOM suites evaluate the
 * app CONCATENATED, where a missing sibling import still resolves, and the browser e2e
 * never walked a full run. The gap shipped a real bug — run-history.js used dom.js's
 * `el` without importing it, so the victory/defeat panel threw mid-render in a real
 * browser and left an EMPTY stage where the restart menu belongs. This walk drives the
 * REAL ES-module graph (the imports that actually load in a browser) through a whole
 * run to the ended screen, clicking only what a player clicks.
 */
test('the real module graph survives a full run and paints the restart menu', async () => {
  const snapOf = () => globalThis.window.__dlb.snapshot();
  const stageNodes = () => byId.stage._all();
  const click = (node) => node.dispatch('click', { target: node });
  const buttons = () => stageNodes().filter((n) => n.tag === 'button');
  const label = (n) => n.attrs['aria-label'] ?? n.txt ?? '';

  // Take the Bellows Breath boon, then load a deck with 8 Mauls into the live run
  // (the save IS the run: the same lever the browser e2e uses).
  click(buttons().find((n) => label(n).startsWith('Bellows Breath')));
  assert.equal(snapOf().phase, 'map', 'the boon led to the map');
  {
    const ctl = globalThis.window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    for (let i = 0; i < 8; i += 1) save.state.deck.push({ uid: `mg-walk-${i}`, cardId: 'bludgeon' });
    const res = ctl.load(save);
    assert.equal(res.ok, true, `save/load failed: ${JSON.stringify(res.problems)}`);
  }

  let sawBossFight = false;
  for (let guard = 0; guard < 400 && snapOf().phase !== 'ended'; guard += 1) {
    const phase = snapOf().phase;
    // Yield to the event loop every step: the killing-stroke hold repaints through a
    // real timer, which a synchronous walk would never let fire.
    await new Promise((r) => setTimeout(r, 10));
    if (phase === 'map') {
      // S6: the row-2 event is now its row's LAST node, so the old "last travel" rule
      // would stumble into the wayside and gamble the walk on an event choice. The
      // walk's job is the restart-menu regression, so it routes AROUND events the way
      // its node order always routed around the shop; the event screen has its own
      // dedicated e2e in tests/web/e2e.browser.spec.js.
      const travel = buttons().filter((n) => label(n).startsWith('Travel to') && !/Wayside/i.test(label(n)));
      const boss = travel.find((n) => /boss/i.test(label(n)));
      click(boss ?? travel[travel.length - 1]);
    } else if (phase === 'combat') {
      const names = snapOf().enemies.map((e) => e.name).join(',');
      if (/warden/i.test(names)) sawBossFight = true;
      const maul = stageNodes().find((n) => n._cls.split(/\s+/).includes('card')
        && !n._cls.split(/\s+/).includes('disabled') && label(n).startsWith('Maul'));
      if (maul) {
        click(maul);
        const targets = stageNodes().filter((n) => n._cls.split(/\s+/).includes('enemy')
          && n._cls.split(/\s+/).includes('targeting'));
        if (targets.length > 0) click(targets[targets.length - 1]);
      } else {
        click(buttons().find((n) => /End Turn/i.test(label(n))));
      }
    } else {
      const tile = stageNodes().find((n) => n._cls.split(/\s+/).includes('card')
        && !n._cls.split(/\s+/).includes('disabled'));
      const btn = buttons().find((n) => !n.disabled);
      if (tile) click(tile);
      else if (btn) click(btn);
    }
  }
  const end = snapOf();
  assert.equal(end.phase, 'ended', 'the run reached its end');
  assert.ok(sawBossFight, 'the walk fought the Slag Warden');
  // The walk may WIN or fall at the Warden — the defect under test fires on ANY ended
  // run (endView builds the ledger either way), so what matters is that the screen
  // paints at all and names the outcome.
  assert.ok(['win', 'loss'].includes(end.ended.outcome), `an outcome is recorded: ${end.ended.outcome}`);
  // THE REGRESSION: the restart menu is on the stage. Before the run-history fix this
  // threw mid-render (ReferenceError in a real graph) and left the stage EMPTY.
  // A WIN arrives on the same paint as a death, so render() holds the collapse beat
  // before the ended panel paints (render.js's ended-hold); the walk can therefore exit
  // its loop while the summary is still one timed repaint away. Wait the beat out — the
  // S3 gold grants shifted this walk's seed-11 run from a defeat (no hold: nothing dies)
  // onto a boss-killing win (a hold), which is what moved the old single read.
  let restart = null;
  for (let i = 0; i < 50 && !restart; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
    restart = buttons().find((n) => /restart/i.test(label(n))) ?? null;
  }
  assert.ok(restart, 'the ended screen shows a Restart button');
  assert.ok(stageNodes().some((n) => n._cls.split(/\s+/).includes('big-title')), 'the outcome headline is painted');
});
