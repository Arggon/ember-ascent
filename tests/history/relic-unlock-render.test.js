// tests/history/relic-unlock-render.test.js — the S10 relic narration on the end screen.
//
// The unlock block (S4) already narrates CARD thresholds; S10 extends the same hook
// (lastUnlock) with the relic story: a WIN that crossed a RELIC_UNLOCK_TABLE milestone
// names what future climbs can be offered, states the WINS mark crossed, and counts the
// pool. A loss crosses nothing. Drives the REAL src/web app bundle against the same fake
// DOM as tests/history/ledger-render.test.js; the run is ended through the documented
// save/load lever (a parsed-object load), and recordRun() is invoked exactly as the
// ended transition invokes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleApp } from '../web/app-bundle.mjs';

let uid = 0;
class N {
  constructor(tag) {
    this.tag = tag; this.uid = uid++; this.kids = []; this.parent = null;
    this.attrs = {}; this._cls = ''; this.txt = ''; this.style = {};
    this._ls = {}; this.disabled = false;
  }
  set className(v) { this._cls = String(v); }
  get className() { this._cls = String(v); return this._cls; }
  get classList() {
    const list = () => this._cls.split(/\s+/).filter(Boolean);
    const set = (a) => { this._cls = a.join(' '); };
    return {
      contains: (c) => list().includes(c),
      add: (...cs) => set([...new Set([...list(), ...cs])]),
      remove: (...cs) => set(list().filter((x) => !cs.includes(x))),
      toggle: (c, force) => { const on = force ?? !list().includes(c); if (on) set([...new Set([...list(), ...cs])]); else set(list().filter((x) => !cs.includes(x))); return on; },
    };
  }
  set textContent(v) { this.txt = String(v); this.kids = []; }
  get textContent() {
    // Deep text: the narration block is nested (p > span), so the assertion walks.
    const join = (n) => `${n.txt ?? ''}${(n.kids ?? []).map(join).join('')}`;
    return join(this);
  }
  append(...c) { for (let x of c) if (x != null) { if (typeof x !== 'object') { const t = new N('#text'); t.txt = String(x); x = t; } x.parent = this; this.kids.push(x); } }
  prepend(...c) { const add = c.filter((x) => x != null); for (let x of c) if (x != null) x.parent = this; this.kids.unshift(...add); }
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
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    return this._all().filter((n) => m(n, sel));
  }
  _all() { const o = []; const go = (n) => { o.push(n); for (const k of n.kids) go(k); }; for (const k of this.kids) go(k); return o; }
  focus() {}
}
function m(n, sel) {
  const a = /^\[data-([a-z-]+)="([^"]*)"\]$/.exec(sel);
  if (a) return n.attrs[`data-${a[1]}`] === a[2];
  if (sel.startsWith('.')) return n._cls.split(/\s+/).includes(sel.slice(1));
  return n.tag === sel;
}

const root = new N('body');
const byId = {};
for (const id of ['hud', 'stage', 'toast', 'live', 'app']) { const d = new N('div'); d._cls = id; byId[id] = d; root.append(d); }
globalThis.document = {
  getElementById: (id) => byId[id] ?? null,
  createElement: (t) => new N(t),
  createTextNode: (t) => { const n = new N('#text'); n.txt = String(t); n.kids = []; return n; },
  querySelector: (s) => root.querySelector(s),
  querySelectorAll: (s) => root.querySelectorAll(s),
  addEventListener: () => {}, body: root,
};
globalThis.window = { addEventListener: () => {}, location: { search: '' } };
globalThis.location = { search: '' };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } };
globalThis.requestAnimationFrame = () => 0;
globalThis.URLSearchParams = URLSearchParams;

const appUrl = new URL('../../src/web/app.js', import.meta.url);
const { prelude, body, mods: importedModules } = await bundleApp(appUrl, { stubController: true });
let src = body.replace(/\bboot\(\)\s*;?\s*$/, '');
src = 'async function measure(){ return null; }\n' + src;
// Expose the narration path: recordRun (the ended-transition call), the hook it fills,
// the block builder, and the paint (setSnap + render) for the end screen.
src += '\nreturn { render, setSnap, recordRun, unlockBlock, get lastUnlock(){ return lastUnlock; }, get lastRecord(){ return lastRecord; } };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__toasts', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
  ${src}
`);

/** An empty or veteran ledger, then a run ended by the save/load lever, then recordRun().
 *  The lever ends the run on the REAL boss floor (row index 7 — the shape the engine
 *  actually produces; the snapshot builders are entitled to refuse impossible ones). */
function finishRun(seed, agg) {
  localStorage._d = {};
  if (agg) localStorage.setItem('dlb.runs.v1', JSON.stringify({ v: 1, records: [], agg }));
  const ctl = ctlMod.createController({ run: { seed } });
  const api = factory(ctl, [], importedModules);
  const save = JSON.parse(ctl.save());
  save.state.phase = 'ended';
  save.state.outcome = 'win';
  save.state.floor = 7;
  const res = ctl.load(JSON.parse(JSON.stringify(save)));
  assert.equal(res.ok, true, `the ended-win lever loads: ${JSON.stringify(res.problems ?? [])}`);
  api.recordRun();
  return { ctl, api };
}

const WIN_AGG = (wins) => ({
  runs: wins, wins, losses: 0, unfinished: 0, floors: {},
  score: { count: wins, total: wins * 100, max: 100 },
  // The first-win badge rides the veteran ledger, so the badge-gated CARD unlock is
  // already open and the narration tests exactly the relic story they claim.
  badges: wins > 0 ? { first_win: wins } : {},
});

const textOf = (node) => node.textContent;

test('a first WIN crosses the 1-win milestone: the end screen narrates Ember Heart', () => {
  const { api } = finishRun(3, null);
  const rel = api.lastUnlock?.relics;
  assert.ok(rel, 'the relic story rides lastUnlock');
  assert.deepEqual(rel.newly, ['ember_heart'], 'the first win opens the first uncommon');
  assert.equal(rel.winsAfter, 1);
  assert.equal(rel.countAfter, 6, 'the next run draws from 6 relics');
  const block = api.unlockBlock(api.lastUnlock);
  const lines = block.querySelectorAll('.unlock-line').map(textOf).join(' | ');
  assert.match(lines, /Your climbs unlocked: Ember Heart\./, `the design's line, verbatim shape: ${lines}`);
  const thats = block.querySelectorAll('.unlock-that').map(textOf).join(' | ');
  assert.match(thats, /1 lifetime win crossed the 1 win mark/, `the WINS mark crossed is stated: ${thats}`);
  const pools = block.querySelectorAll('.unlock-pool').map(textOf).join(' | ');
  assert.match(pools, /Relics in play: 6 of 13\./, `the pool count is honest: ${pools}`);
  assert.doesNotMatch(lines, /stronger|power|boost|easier/, 'option framing only — never power words');
});

test('a veteran ledger (6 wins) + a win crosses the 7-win mark: two rares named', () => {
  const { api } = finishRun(3, WIN_AGG(6));
  const rel = api.lastUnlock?.relics;
  assert.deepEqual(rel?.newly, ['deep_well', 'ash_crown'], 'one win, two rares — the union, not one row');
  assert.equal(rel.countAfter, 10, 'the next run draws from 10');
  const lines = api.unlockBlock(api.lastUnlock).querySelectorAll('.unlock-line').map(textOf).join(' | ');
  assert.match(lines, /Your climbs unlocked: Deep Well, Ash Crown\./, `the design line: ${lines}`);
});

test('a LOSS crosses no milestone: no unlock block at all', () => {
  localStorage._d = {};
  localStorage.setItem('dlb.runs.v1', JSON.stringify({ v: 1, records: [], agg: WIN_AGG(6) }));
  const ctl = ctlMod.createController({ run: { seed: 3 } });
  const api = factory(ctl, [], importedModules);
  const save = JSON.parse(ctl.save());
  save.state.phase = 'ended';
  save.state.outcome = 'loss';
  save.state.floor = 4;
  const res = ctl.load(JSON.parse(JSON.stringify(save)));
  assert.equal(res.ok, true, `the ended-loss lever loads: ${JSON.stringify(res.problems ?? [])}`);
  api.recordRun();
  assert.equal(api.lastUnlock, null, 'losing does not grow the relic pool, and the screen says nothing');
});

test('the win narration paints on the real end screen (one block, both stories)', () => {
  const { ctl, api } = finishRun(3, WIN_AGG(6));
  api.setSnap(ctl.snapshot());
  byId.stage.replaceChildren();
  api.render();
  const blocks = byId.stage.querySelectorAll('.unlock-block');
  assert.equal(blocks.length, 1, 'exactly one unlock block');
  const lines = blocks[0].querySelectorAll('.unlock-line').map(textOf).join(' | ');
  assert.match(lines, /Your climbs unlocked: Deep Well, Ash Crown\./, `painted: ${lines}`);
  const pools = blocks[0].querySelectorAll('.unlock-pool').map(textOf).join(' | ');
  assert.match(pools, /Relics in play: 10 of 13\./, `pool count painted: ${pools}`);
});

test('a veteran at the LAST milestone whose win unlocks nothing narrates no relic line', () => {
  const { api } = finishRun(3, WIN_AGG(15));
  assert.equal(api.lastUnlock, null, '15 wins already hold the whole table; win 16 opens nothing');
  // Even so, the run is recorded and scored — only the narration is quiet.
  assert.ok(api.lastRecord, 'the record exists');
  assert.equal(api.lastRecord.outcome, 'win');
});
