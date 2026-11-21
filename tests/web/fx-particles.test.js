// THE WAAPI EMBER PARTICLES' node contract, pinned against the REAL surface code driven
// by the fake-DOM harness (the same bundle trick impact-feel.test.js uses):
//   * the emitter clamps every ask into 12..30 particles (default the PARTICLES table's
//     16) and leaves NOTHING behind: every spawned span carries one element.animate()
//     whose finish removes the node and drops the record — 10+ bursts in a row soul_drain
//     back to zero (AC1);
//   * the wiring scatters on the struck unit only: a golpe window fires one burst on the
//     window's own key; a golpe-less play (an empty strikes list — how a heal flies), a
//     tail-only enemy plan and an all-parried play keep zero embers (AC2);
//   * skipAnim() cancels every live ember (the onSkipFx hook) and a newer action's
//     generation retires the previous one's (AC3);
//   * reduced motion and the » dock gate the emitter to zero spawns (AC4);
//   * the dock paces the particle life through animMs() and the WAAPI duration carries
//     the paced figure (AC5);
//   * the keyframes animate ONLY transform/opacity on the heelburst embers' own curve,
//     and each burst's geometry is measured exactly once (by the caller — the emitter
//     itself never measures) (AC6).
//
// The WAAPI stub is honest about the two halves that matter here: finish() fires
// onfinish, cancel() fires oncancel (both record who was asked), and every call lands
// in a registry the tests soul_drain — the real compositor timing is the e2e's business
// (tests/web/e2e.browser.spec.js), the same split AC7 accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleApp } from '../web/app-bundle.mjs';

/* ------------------------------------------------------ the fake DOM (impact-feel's) */

let uid = 0;
class N {
  constructor(tag) {
    this.tag = tag; this.uid = uid++; this.kids = []; this.parent = null;
    this.attrs = {}; this._cls = ''; this.txt = ''; this._sty = {};
    this._ls = {}; this.disabled = false;
    this.rectCalls = 0;
    this._rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
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
  remove() {
    if (this.parent) {
      this.parent.kids = this.parent.kids.filter((k) => k !== this);
      this.parent = null;
    }
  }
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
  // throwLane() and emberImpact() measure live boxes. A node's box is whatever the test
  // pinned on `_rect` (dressed combat cards carry real boxes); the count is the AC6 probe.
  getBoundingClientRect() {
    this.rectCalls += 1;
    return this._rect;
  }
  // THE WAAPI STUB: one record per animate() call, wired into the shared registry below.
  animate(frames, opts) {
    return new FakeAnim(this, frames, opts);
  }
}

class FakeAnim {
  constructor(node, frames, opts) {
    this.node = node;
    this.frames = frames;
    this.opts = opts;
    this.effect = { target: node };
    this.finished = Promise.resolve();
    this.canceled = false;
    this.ended = false;
    this._finish = null;
    this._cancel = null;
    waapi.push(this);
  }
  set onfinish(fn) { this._finish = fn; }
  get onfinish() { return this._finish; }
  set oncancel(fn) { this._cancel = fn; }
  get oncancel() { return this._cancel; }
  cancel() {
    if (this.canceled || this.ended) return;
    this.canceled = true;
    if (this._cancel) this._cancel();
  }
  finish() {
    if (this.canceled || this.ended) return;
    this.ended = true;
    if (this._finish) this._finish();
  }
}

/** Every animation the app asked for, oldest first; drained by the tests. */
const waapi = [];
const soul_drain = () => { while (waapi.length) waapi.pop().finish(); };

/** One selector match, DESCENDANT-AWARE — the extension over impact-feel's matcher that
 *  lets hpUnitHost's own selectors resolve ('.fight .hero', '.enemy[data-target-index="1"]'),
 *  which is exactly what makes the wiring testable here (R9 in the slice plan). */
function m(n, sel) {
  const parts = sel.trim().split(/\s+/);
  if (parts.length > 1) {
    if (!mCompound(n, parts[parts.length - 1])) return false;
    let up = n.parent;
    let i = parts.length - 2;
    while (up && i >= 0) {
      if (mCompound(up, parts[i])) i -= 1;
      up = up.parent;
    }
    return i < 0;
  }
  return mCompound(n, sel);
}
function mCompound(n, compound) {
  const a = /^\[data-([a-z-]+)="([^"]*)"\]$/.exec(compound);
  if (a) return n.attrs[`data-${a[1]}`] === a[2];
  const cm = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)(\[data-[\w-]+="[^"]*"\])?$/.exec(compound);
  if (!cm) return false;
  if (cm[1] && n.tag !== cm[1]) return false;
  if (cm[1] && !cm[2] && !cm[3]) return true;
  if (cm[2]) {
    const want = cm[2].slice(1).split('.');
    if (!want.every((c) => n._cls.split(/\s+/).includes(c))) return false;
  }
  if (cm[3]) {
    const am = /^\[data-([\w-]+)="([^"]*)"\]$/.exec(cm[3]);
    if ((n.attrs[`data-${am[1]}`] ?? null) !== am[2]) return false;
  }
  return true;
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
  addEventListener: () => {},
  body: root,
};
globalThis.window = { addEventListener: () => {}, location: { search: '' } };
globalThis.location = { search: '' };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
globalThis.requestAnimationFrame = () => 0;
globalThis.URLSearchParams = URLSearchParams;

/* ------------------------------------------------ the bundle factory (impact-feel's) */

const toasts = [];
const appUrl = new URL('../../src/web/app.js', import.meta.url);
const { prelude, body, mods: importedModules } = await bundleApp(appUrl, { stubController: true });
let src = body;
src = 'async function measure(){ return null; }\n' + src;
src += '\nreturn {'
  + ' emberBurst, cancelEmberParticles, retireEmberGen, liveEmberCount, EMBER_PALETTE,'
  + ' PARTICLES, animMs, setAnimSpeed, dispatchFx, skipAnim, feelSchedule, setStrikeSeq,'
  + ' clearFxTimers, bumpAnimGen,'
  + ' injectBursts: (b) => { bursts = b; }, snapGet: () => snap };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__toasts', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
  ${src}
`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fxLayer = byId['fx-layer'];
const emberNodes = () => fxLayer.querySelectorAll('.fx-ember').length;

/** A booted instance at the first combat (the boot's own newGame drives a real run).
 *  `matchMediaReduce` pre-installs the reduced-motion media query BEFORE the body is
 *  evaluated, so that instance reads it at load — the input-lock.test.js lever. */
function startRun(seed, matchMediaReduce = false) {
  globalThis.localStorage._d['dlb.helpSeen.v1'] = '1';
  const prev = globalThis.matchMedia;
  if (matchMediaReduce) globalThis.matchMedia = () => ({ matches: true });
  const ctl = ctlMod.createController({ run: { seed } });
  ctl.dispatch('n1');
  const api = factory(ctl, toasts, importedModules);
  if (matchMediaReduce) {
    if (prev === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = prev;
  }
  return { api, ctl };
}

/** Dress the fake stage the way a combat paint would: a `.fight` with the hero in it and
 *  the living enemy row at measured boxes, so hpUnitHost's own selectors resolve and
 *  emberImpact has something to measure. Called AFTER the boot, whose map paint owns the
 *  stage until a test dresses combat. */
function dressCombat(api) {
  const stage = byId.stage;
  stage.replaceChildren();
  const fight = new N('div');
  fight._cls = 'fight';
  const hero = new N('div');
  hero._cls = 'hero';
  hero._rect = { x: 40, y: 300, top: 300, left: 40, right: 100, bottom: 420, width: 60, height: 120 };
  fight.append(hero);
  const enemies = (api.snapGet().enemies ?? []).filter((e) => !e.dead);
  enemies.forEach((e, i) => {
    const card = new N('div');
    card._cls = 'enemy';
    card.attrs['data-target-index'] = String(e.index + 1);
    card._rect = { x: 200 + i * 80, y: 300, top: 300, left: 200 + i * 80, right: 280 + i * 80, bottom: 420, width: 80, height: 120 };
    fight.append(card);
  });
  stage.append(fight);
  return { fight, hero };
}

/** One hero-play golpe list: one light strike against a living enemy 0. */
const strike0 = (hp) => [{ kind: 'strike', enemy: 0, name: 'Slag Crawler', dealt: 3, blocked: 0, parried: false, hp, hit: 1 }];
const flickList = (hp) => [{ kind: 'card-fly', side: 'side-0', strikes: strike0(hp) }];

/* --------------------------------------------------------------- the contract */

test('AC1: the ask clamps to 12..30 (default the PARTICLES count), and 10+ bursts soul_drain to zero', () => {
  const { api } = startRun(11);
  const at = { x: 200, y: 340 };
  assert.equal(api.emberBurst(at, { count: 5 }), 12, 'a small ask clamps UP to 12');
  assert.equal(api.liveEmberCount(), 12, 'every clamped particle is a live record');
  soul_drain();
  assert.equal(api.liveEmberCount(), 0, 'the soul_drain removes the records');
  assert.equal(api.emberBurst(at, { count: 50 }), 30, 'a flood clamps DOWN to 30');
  soul_drain();
  assert.equal(api.emberBurst(at), api.PARTICLES.count, 'the unshaped ask bursts the table count');
  assert.equal(api.PARTICLES.count, 16, 'the table default is 16');
  soul_drain();
  // 10 bursts in a row: every particle animated, every node on the layer, and the soul_drain
  // (the onfinish path) takes the whole scatter back off.
  for (let i = 0; i < 10; i += 1) api.emberBurst(at, { count: 16 });
  assert.equal(api.liveEmberCount(), 160, 'ten bursts of 16 stay alive with no retire between them');
  assert.equal(emberNodes(), 160, 'every live record is a node on the layer');
  assert.equal(waapi.length, 160, 'every particle carries exactly one element.animate()');
  for (const a of waapi) {
    assert.equal(a.node.parent, fxLayer, 'the particle was appended to #fx-layer');
    assert.ok(Array.isArray(a.frames) && a.frames.length === 3, 'three keyframes per flight');
    assert.equal(typeof a.opts.duration, 'number', 'the duration is the paced life');
  }
  soul_drain();
  assert.equal(api.liveEmberCount(), 0, 'zero records after the soul_drain — no leak');
  assert.equal(emberNodes(), 0, 'zero nodes after the soul_drain — no leak');
});

test('AC2: a golpe window scatters on the struck unit; golpe-less, tail-only and all-parried plays scatter none', async () => {
  const { api } = startRun(11);
  dressCombat(api);
  api.setAnimSpeed(1);
  api.injectBursts(flickList(29));
  api.dispatchFx();
  // The window's fire lands at animMs(240); the embers spawn inside that fire.
  await sleep(api.animMs(240) + 150);
  assert.ok(emberNodes() >= 12, `the golpe's window must scatter embers (got ${emberNodes()})`);
  soul_drain();

  // A golpe-less play (an EMPTY strikes list — how a heal flies) keeps its single freeze
  // window on key null, and a null key fires no burst.
  api.injectBursts([{ kind: 'card-fly', side: 'side-0', strikes: [] }]);
  api.dispatchFx();
  await sleep(api.animMs(240) + 150);
  assert.equal(emberNodes(), 0, 'a golpe-less play keeps its window but no burst');

  // An all-parried play opens NO window at all — the parry proc is the whole beat.
  api.injectBursts([{ kind: 'card-fly', side: 'side-0', strikes: [
    { kind: 'strike', enemy: 0, name: 'Slag Crawler', dealt: 0, blocked: 0, parried: true, hp: 29, hit: 1 },
  ] }]);
  api.dispatchFx();
  await sleep(api.animMs(240) + 150);
  assert.equal(emberNodes(), 0, 'an all-parried play scatters nothing');

  // A tail-only enemy plan (no attacks): the feel schedule's single window is again the
  // golpe-less key-null one — the TURN_STEP tail never reaches the burst call site.
  api.injectBursts([{ kind: 'enemy-turn' }]);
  api.setStrikeSeq({ attacks: [], tail: [], plans: [], beatMs: api.animMs(500), impactMs: Math.round(api.animMs(640) * 0.46), slamMs: api.animMs(640), stepMs: api.animMs(560) });
  api.dispatchFx();
  await sleep(api.animMs(240) + 150);
  assert.equal(emberNodes(), 0, 'a tail-only plan scatters nothing');
  api.setStrikeSeq(null);
  // Harness hygiene: this instance's pending feel-queue timers (float landings, window
  // closes) measure the SHARED fake stage — kill them so a later test's accounting is its own.
  api.clearFxTimers();
  soul_drain();
});

test('AC3: skipAnim cancels every live ember; a newer action retires the previous generation', () => {
  const { api } = startRun(11);
  // The skip half: spawn, then » — every stub is CANCELLED (not finished), every node is
  // off the layer, every record dropped (the onSkipFx hook).
  api.emberBurst({ x: 100, y: 100 }, { count: 16, gen: 1 });
  assert.ok(api.liveEmberCount() > 0, 'the spawn is live before the skip');
  api.skipAnim();
  assert.equal(api.liveEmberCount(), 0, 'the skip empties the records');
  assert.equal(emberNodes(), 0, 'the skip removes the nodes');
  assert.equal(waapi.length, 16);
  assert.ok(waapi.every((a) => a.canceled), 'every animation was cancelled, none finished');
  soul_drain();

  // The generation half: embers of gen 1 survive a same-generation retire and die when
  // the NEXT action's dispatchFx captures a new generation.
  api.emberBurst({ x: 100, y: 100 }, { count: 12, gen: 1 });
  api.retireEmberGen(1);
  assert.equal(api.liveEmberCount(), 12, 'a same-generation retire keeps the burst');
  api.injectBursts(flickList(29));
  api.dispatchFx(); // captures gen 2 and retires gen 1's embers before its own spawn
  assert.equal(api.liveEmberCount(), 0, 'the new generation retires the old burst');
  api.clearFxTimers(); // same hygiene: this dispatch's windows must not measure later tests
  soul_drain();
});

test('AC4: reduced motion and the » dock both gate the emitter to zero spawns', () => {
  const { api } = startRun(21, true); // the whole instance boots under matchMedia reduce
  dressCombat(api);
  assert.equal(api.emberBurst({ x: 100, y: 100 }), 0, 'the emitter gates reduced motion outright');
  assert.equal(api.liveEmberCount(), 0);
  // And the wiring path cannot sneak past: dispatchFx itself early-returns under reduce
  // (fx.js gates before the feel queue), and even a direct window fire would burst 0.
  api.injectBursts(flickList(29));
  api.dispatchFx();
  assert.equal(emberNodes(), 0, 'reduced motion scatters no embers through dispatchFx either');
  soul_drain();

  // The » dock: speed 0 is the other half of the gate (a NOT-reduced instance).
  const { api: api2 } = startRun(11);
  api2.setAnimSpeed(0);
  assert.equal(api2.emberBurst({ x: 100, y: 100 }), 0, 'speed 0 gates the emitter too');
  assert.equal(api2.liveEmberCount(), 0);
});

test('AC5: the dock paces the particle life through animMs and the WAAPI duration carries it', () => {
  const { api } = startRun(11);
  api.setAnimSpeed(1);
  assert.equal(api.animMs(api.PARTICLES.lifeMs), 1400, 'life 700 -> 1400 at 1x');
  api.setAnimSpeed(2);
  assert.equal(api.animMs(api.PARTICLES.lifeMs), 700, 'life 700 stays 700 at 2x');
  api.setAnimSpeed(0);
  assert.equal(api.animMs(api.PARTICLES.lifeMs), 0, '» collapses the life to 0');
  // The recorded durations carry the paced figure (2x: the classic pace).
  api.setAnimSpeed(2);
  api.emberBurst({ x: 50, y: 50 }, { count: 12, lifeMs: api.PARTICLES.lifeMs });
  assert.equal(waapi.length, 12);
  for (const a of waapi) assert.equal(a.opts.duration, 700, 'the WAAPI duration is animMs(lifeMs) at 2x');
  soul_drain();
  // Distance does NOT ride the dock: the spread band is drawn at the BASE life
  // (200..400 px/s over 0.7s base = 140..280 px), varied per particle.
  api.setAnimSpeed(1);
  api.emberBurst({ x: 50, y: 50 }, { count: 12, lifeMs: api.PARTICLES.lifeMs });
  const reaches = waapi.map((a) => {
    const mm = /translate\((-?\d+)px, (-?\d+)px\)/.exec(a.frames[2].transform);
    return Math.hypot(Number(mm[1]), Number(mm[2]));
  });
  assert.ok(reaches.every((d) => d >= 138 && d <= 282), `reaches inside the band (got ${reaches.map((d) => Math.round(d)).join(', ')})`);
  assert.ok(new Set(reaches.map((d) => Math.round(d))).size >= 2, 'distances vary per particle within the band');
  soul_drain();
  // The heelburst fan's own invariant, on the knob's exact shape (bias 0 points straight
  // down, ±55° of spread): dy = cos(angle) * dist with |angle| ≤ 55° is ALWAYS positive —
  // no particle of that fan can fly up, whatever the random draw (deterministic).
  api.emberBurst({ x: 50, y: 50 }, { count: 12, lifeMs: 500, spreadDeg: 110, biasDeg: 0 });
  const fan = waapi.map((a) => Number(/translate\((-?\d+)px, (-?\d+)px\)/.exec(a.frames[2].transform)[2]));
  assert.ok(fan.every((dy) => dy > 0), `the fan never points up (dys ${fan.join(', ')})`);
  soul_drain();
});

test('AC6: keyframes carry only transform/opacity on the heelburst curve; geometry measured once per burst', async () => {
  const { api } = startRun(11);
  const dressed = dressCombat(api);
  api.setAnimSpeed(1);
  // The emitter itself never measures: a direct burst takes zero rect reads.
  const before = [...root._all()].map((n) => n.rectCalls).reduce((a, b) => a + b, 0);
  api.emberBurst({ x: 240, y: 340 }, { count: 12 });
  const after = [...root._all()].map((n) => n.rectCalls).reduce((a, b) => a + b, 0);
  assert.equal(after, before, 'the emitter measures nothing — the caller brings the point');
  soul_drain();

  // The wiring: one golpe = one window fire = ONE measurement of the struck card for the
  // burst. The golpe float's own landing (throwLane, a fire later) measures the same
  // card once more — each beat's geometry is taken once, so one golpe reads exactly two.
  api.injectBursts(flickList(29));
  api.dispatchFx();
  await sleep(api.animMs(240) + api.animMs(294) + 120); // window fire AND float landing
  const struck = dressed.fight._all().find((n) => n.attrs['data-target-index'] === '1');
  assert.equal(struck.rectCalls, 2, 'one measure for the burst, one for the float landing');
  // Every animation on the layer: transform/opacity ONLY (offset is a timeline mark, not
  // an animated property), on the heelburst embers' own easing curve.
  for (const a of waapi) {
    for (const frame of a.frames) {
      const props = Object.keys(frame);
      assert.ok(props.every((p) => p === 'transform' || p === 'opacity' || p === 'offset'),
        `keyframes animate only transform/opacity, got [${props.join(', ')}]`);
    }
    assert.equal(a.opts.easing, 'cubic-bezier(0.2, 0.8, 0.4, 1)', 'the heelburst curve');
    assert.ok(a.opts.fill === 'both', 'the flight holds its last frame until removal');
  }
  soul_drain();
});
