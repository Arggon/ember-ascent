// THE IMPACT RECIPE's arithmetic, pinned against the REAL surface code driven by the
// fake-DOM harness (the same bundle trick input-lock.test.js uses):
//   * the dock paces the new beats exactly like every other one (AC6): animMs is the
//     only door, so the freeze windows, the squash+recoil span and the input floor all
//     double at 1x, restore the classic pace at 2x and vanish at »;
//   * every freeze window closes at or after the golpe float it must cover (AC2, the
//     light window is 60 base on exactly that arithmetic: the first float lands at
//     base 294, so 240+50 misses it and 240+60 holds it) — at BOTH docks;
//   * windows are disjoint by arithmetic, never by bookkeeping (beat 500 base vs the
//     heaviest 95 base, one shared divisor);
//   * the weight ladder: killing (hp<=0) and dealt>=16 freeze heaviest, dealt>=8 mid,
//     the rest light, a parried golpe no window at all;
//   * a golpe-less action keeps ONE light window; an all-parried play keeps NONE.
import { readFileSync } from 'node:fs';

let uid = 0;
class N {
  constructor(tag) {
    this.tag = tag; this.uid = uid++; this.kids = []; this.parent = null;
    this.attrs = {}; this._cls = ''; this.txt = ''; this._sty = {};
    this._ls = {}; this.disabled = false;
  }
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
  if (sel.startsWith('.')) {
    // Compound class selectors (revealFloats queries '.efloat.is-queued'): every part
    // must be present, like a real querySelectorAll.
    return sel.slice(1).split('.').every((c) => n._cls.split(/\s+/).includes(c));
  }
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
  addEventListener: () => {},
  body: root,
};
globalThis.window = { addEventListener: () => {}, location: { search: '' } };
globalThis.location = { search: '' };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
globalThis.requestAnimationFrame = () => 0;
globalThis.URLSearchParams = URLSearchParams;

import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleApp } from '../web/app-bundle.mjs';

const toasts = [];
const appUrl = new URL('../../src/web/app.js', import.meta.url);
const { prelude, body, mods: importedModules } = await bundleApp(appUrl, { stubController: true });
let src = body;
src = 'async function measure(){ return null; }\n' + src;
src += '\nreturn { feelSchedule, animMs, setAnimSpeed, playInputSpan,'
  + ' IMPACT_FEEL, SLOW_FACTOR,'
  + ' busyReason, dispatchFx,'
  + ' snapGet: () => snap, hpTrailGet: () => hpTrail,'
  + ' injectBursts: (b) => { bursts = b; }, setTrail: (t) => setHpTrail(t),'
  + ' strikeSeqGet: () => strikeSeq };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__toasts', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
  ${src}
`);

/** A booted instance at the first combat (the boot's own newGame drives a real run).
 *  No render here: the schedule under test is pure, and the factory evaluation itself
 *  already exercised a full boot + first paint path via the module-level newGame(). */
function startRun(seed) {
  globalThis.localStorage._d['dlb.helpSeen.v1'] = '1';
  const ctl = ctlMod.createController({ run: { seed } });
  ctl.dispatch('n1');
  const api = factory(ctl, toasts, importedModules);
  return { api, ctl };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One hero-play golpe list: two light strikes against a living enemy 0. */
const flickStrikes = (hp) => [
  { kind: 'strike', enemy: 0, name: 'Slag Crawler', dealt: 3, blocked: 0, parried: false, hp, hit: 1 },
  { kind: 'strike', enemy: 0, name: 'Slag Crawler', dealt: 3, blocked: 0, parried: false, hp: hp - 3, hit: 2 },
];
const flickList = (hp) => [{ kind: 'card-fly', side: 'side-0', strikes: flickStrikes(hp) }];

test('the dock paces the impact beats exactly like every other one (animMs is the only door)', () => {
  const { api } = startRun(11);
  const { IMPACT_FEEL, SLOW_FACTOR } = api;
  assert.equal(SLOW_FACTOR, 2, 'the halved-base factor is 2 (runtime)');
  // 1x doubles every base figure.
  api.setAnimSpeed(1);
  assert.equal(api.animMs(IMPACT_FEEL.lead), 480, 'lead 240 -> 480 at 1x');
  assert.equal(api.animMs(IMPACT_FEEL.freezeMs[0]), 120, 'light 60 -> 120 at 1x');
  assert.equal(api.animMs(IMPACT_FEEL.freezeMs[2]), 190, 'heavy 95 -> 190 at 1x');
  assert.equal(api.animMs(IMPACT_FEEL.squashMs + IMPACT_FEEL.recoilMs), 920,
    'the bundle span 460 -> 920 at 1x');
  // 2x restores the classic pace; » collapses everything to 0.
  api.setAnimSpeed(2);
  assert.equal(api.animMs(IMPACT_FEEL.freezeMs[2]), 95, 'heavy 95 stays 95 at 2x');
  assert.equal(api.animMs(IMPACT_FEEL.squashMs + IMPACT_FEEL.recoilMs), 460, 'bundle span 460 at 2x');
  api.setAnimSpeed(0);
  assert.equal(api.animMs(IMPACT_FEEL.freezeMs[2]), 0, '» collapses the freeze to 0');
  // The CSS half of the same number: the keyframes declare calc(0.46s * var(--pace, 1))
  // and applyPace sets --pace = SLOW_FACTOR / animSpeed, so paced-CSS === animMs(460)
  // at every dock — asserted here on the shared expression, per dock.
  for (const dock of [1, 2]) {
    api.setAnimSpeed(dock);
    const pace = SLOW_FACTOR / dock;
    assert.equal(api.animMs(460), Math.round(0.46 * 1000 * pace),
      `animMs(460) === 0.46s * --pace at ${dock}x (pace ${pace})`);
  }
});

test('every freeze window closes at or after its golpe float, at both docks', () => {
  const { api } = startRun(11);
  for (const dock of [1, 2]) {
    api.setAnimSpeed(dock);
    // The hero path's float fires at animMs(beat)*k + animMs(294) (fx.js); the plan
    // path's at plan.beatMs*i + plan.impactMs with impactMs = round(animMs(640)*0.46).
    const impact = api.animMs(294);
    const events = api.feelSchedule(flickList(29), null);
    assert.equal(events.length, 2, `two golpes, two windows at ${dock}x`);
    events.forEach((ev, i) => {
      const floatAt = api.animMs(500) * i + impact;
      assert.ok(ev.at + ev.dur >= floatAt,
        `golpe ${i} closes inside the frozen frame at ${dock}x (${ev.at}+${ev.dur} >= ${floatAt})`);
      assert.equal(ev.key, 'e0', 'the window names the struck unit');
      assert.equal(ev.dur, api.animMs(60), `a 3-dealt golpe is light at ${dock}x`);
    });
    assert.ok(events[0].at + events[0].dur <= events[1].at,
      `windows are disjoint at ${dock}x (${events[0].at}+${events[0].dur} <= ${events[1].at})`);
  }
});

test('the enemy-turn windows cover the plan float beats and speak for the hero', () => {
  const { api } = startRun(11);
  api.setAnimSpeed(1);
  const plan = {
    attacks: [
      { enemy: 0, name: 'Slag Crawler', dealt: 4, blocked: 0, parried: false, hp: 46, hit: 1, hits: 2 },
      { enemy: 0, name: 'Slag Crawler', dealt: 4, blocked: 0, parried: false, hp: 42, hit: 2, hits: 2 },
    ],
    beatMs: api.animMs(500),
    impactMs: Math.round(api.animMs(640) * 0.46),
  };
  const events = api.feelSchedule([], plan);
  assert.equal(events.length, 2, 'one window per attacker golpe');
  events.forEach((ev, i) => {
    const floatAt = plan.beatMs * i + plan.impactMs;
    assert.equal(ev.key, 'p', 'the window names the HERO (the victim of the turn)');
    assert.ok(ev.at + ev.dur >= floatAt,
      `golpe ${i} closes inside the frozen frame (${ev.at}+${ev.dur} >= ${floatAt})`);
    assert.equal(ev.dur, api.animMs(60), 'a 4-dealt golpe is light');
  });
  assert.ok(events[0].at + events[0].dur <= events[1].at, 'turn windows are disjoint');
});

test('the weight ladder: killing and heavy freezes longest, parried freezes never', () => {
  const { api } = startRun(11);
  api.setAnimSpeed(2); // base figures, no scaling noise
  const heavy = api.animMs(95);
  const mid = api.animMs(70);
  const light = api.animMs(60);
  const one = (strike) => api.feelSchedule([{ kind: 'card-fly', side: 'side-0', strikes: [strike] }], null);
  assert.equal(one({ kind: 'strike', enemy: 0, dealt: 3, blocked: 0, parried: false, hp: 0 })[0].dur, heavy,
    'a killing golpe (hp <= 0) freezes heavy');
  assert.equal(one({ kind: 'strike', enemy: 0, dealt: 18, blocked: 0, parried: false, hp: 12 })[0].dur, heavy,
    'dealt >= 16 freezes heavy without a kill');
  assert.equal(one({ kind: 'strike', enemy: 0, dealt: 8, blocked: 0, parried: false, hp: 24 })[0].dur, mid,
    'dealt >= 8 freezes mid');
  assert.equal(one({ kind: 'strike', enemy: 0, dealt: 7, blocked: 0, parried: false, hp: 25 })[0].dur, light,
    'a light golpe freezes light');
  assert.equal(one({ kind: 'strike', enemy: 0, dealt: 0, blocked: 6, parried: false, hp: 25 })[0].dur, light,
    'an absorbed golpe still freezes light');
  assert.equal(one({ kind: 'strike', enemy: 0, dealt: 0, blocked: 6, parried: true, hp: 25 }).length, 0,
    'a parried golpe opens NO window (the proc decorates it)');
  const mixed = api.feelSchedule([{
    kind: 'card-fly', side: 'side-0',
    strikes: [
      { kind: 'strike', enemy: 0, dealt: 0, blocked: 6, parried: true, hp: 25, hit: 1 },
      { kind: 'strike', enemy: 0, dealt: 3, blocked: 0, parried: false, hp: 22, hit: 2 },
    ],
  }], null);
  assert.equal(mixed.length, 1, 'the parried golpe is skipped, its sibling keeps its window');
  assert.equal(mixed[0].key, 'e0');
});

test('a golpe-less action keeps ONE light window; an all-parried play keeps none', () => {
  const { api } = startRun(11);
  api.setAnimSpeed(2);
  const bare = api.feelSchedule([], null);
  assert.equal(bare.length, 1, 'no golpes, no plan: exactly one window');
  assert.equal(bare[0].key, null, 'the bare window names no unit');
  assert.equal(bare[0].dur, api.animMs(60), 'the bare window is light');
  assert.equal(bare[0].at, api.animMs(240), 'the bare window sits on the same lead beat');
  const noStrikes = api.feelSchedule([{ kind: 'card-fly', side: 'side-0' }], null);
  assert.equal(noStrikes.length, 1, 'a play without strike facts keeps the single window');
  // REGRESSION (caught by the heal trail test): a play whose burst flies with an EMPTY
  // strikes list — exactly how a heal flies — is golpe-less, not all-parried: it keeps
  // the single light window, or its reveal steps would never fire.
  const emptyStrikes = api.feelSchedule([{ kind: 'card-fly', side: 'side-0', strikes: [] }], null);
  assert.equal(emptyStrikes.length, 1, 'an empty strikes list is golpe-less, not golpe-silencing');
  assert.equal(emptyStrikes[0].key, null, 'the empty-strikes window names no unit');
  const bareTurn = api.feelSchedule([], { attacks: [], beatMs: api.animMs(500) });
  assert.equal(bareTurn.length, 1, 'a non-attack turn keeps the single light window');
  assert.equal(bareTurn[0].key, null, 'the bare turn window names no unit');
  const allParried = api.feelSchedule([{
    kind: 'card-fly', side: 'side-0',
    strikes: [
      { kind: 'strike', enemy: 0, dealt: 0, blocked: 6, parried: true, hp: 25, hit: 1 },
      { kind: 'strike', enemy: 0, dealt: 0, blocked: 4, parried: true, hp: 25, hit: 2 },
    ],
  }], null);
  assert.equal(allParried.length, 0, 'an all-parried play freezes nothing at all');
});

test('an all-parried play still fires its trail steps and its float reveal, with no freeze', async () => {
  // REGRESSION (round-2 review): zero windows from feelSchedule used to zero out the
  // WHOLE feel queue — the hp_cost/pre steps, revealFloats() and the reveal steps never
  // fired, so a cost's timed bar step was dropped and its queued number never left
  // opacity 0. The freeze contract stays (no window, no hitstop, no bundle); only the
  // trail/float fires ride the old unconditional HEAD beats (pre@240, reveal@310).
  const { api } = startRun(11);
  api.setAnimSpeed(1); // real-paced sleeps: animMs(240)=480, animMs(310)=620
  // A queued float painted into the stage, the way floatHold() leaves every number.
  const queued = new N('span');
  queued.className = 'efloat is-queued';
  byId.stage.append(queued);
  const trail = {
    start: Date.now(),
    units: new Map([
      ['e0', { start: 46, max: 32, current: null, applied: [] }],
      ['p', { start: 54, max: 60, current: null, applied: [] }],
    ]),
    pre: [{ unit: 'e0', hp: 43 }],
    reveal: [{ unit: 'p', hp: 48 }],
  };
  api.setTrail(trail);
  api.injectBursts([{
    kind: 'card-fly', side: 'side-0',
    strikes: [{ kind: 'strike', enemy: 0, name: 'Slag Crawler', dealt: 0, blocked: 6, parried: true, hp: 46, hit: 1 }],
  }]);
  api.dispatchFx();
  assert.equal(byId.stage.classList.contains('hitstop'), false,
    'the all-parried action arms no freeze window at all');
  assert.equal(api.hpTrailGet().units.get('e0').current, null, 'no step has fired at dispatch time');
  await sleep(api.animMs(240) + 100);
  assert.equal(byId.stage.classList.contains('hitstop'), false, 'still no freeze at the pre beat');
  assert.equal(api.hpTrailGet().units.get('e0').current, 43,
    'the hp_cost/pre step fired on its HEAD beat (240 base) despite zero windows');
  await sleep(api.animMs(310) - api.animMs(240));
  assert.equal(api.hpTrailGet().units.get('p').current, 48,
    'the reveal step fired on its HEAD beat (310 base)');
  assert.equal(queued.classList.contains('is-queued'), false,
    'revealFloats() ran: the queued float left opacity 0');
});
