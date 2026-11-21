// THE PROCEDURAL SFX LAYER's contract, pinned against the REAL surface code driven by
// the fake-DOM harness (the same bundle trick impact-feel.test.js uses), plus the two
// dispatcher hooks the audio slice added to fx.js:
//   * the name -> synth mapping builds each sound's own node signature, and the
//     strike-impact pitch randomize stays inside its published band with real variety;
//   * the tier ladder rides the freeze weight the feel schedule computed (0 light /
//     1 mid / 2 heavy — IMPACT_FEEL's own ladder);
//   * the throttle folds bursts two ways: per-name inside 100ms, and a rolling
//     budget of 5 scheduled sounds per trailing second whatever the name;
//   * the toggle mutes with zero scheduled nodes and persists across reloads;
//   * the context is LAZY: nothing constructs an AudioContext before the first
//     gesture (AC1) — the gesture listeners registered at load prime it;
//   * the dispatcher's hooks: a live-dock play schedules one strike-impact per golpe
//     on its own beat (h1), the same play under reduce folds to ONE sound scheduled
//     synchronously (h2 — the beat the pre-partition plan could not pass), a stamped
//     death fires its sound at the collapse's START, not its end (h3), two
//     simultaneous deaths are one sound (h4), and the » skip retires pending death
//     sounds through the generation guard (h5).
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
  addEventListener(type, fn) { (this._ls[type] ||= []).push(fn); }
  removeEventListener() {}
  closest(sel) {
    const want = sel.replace(/^\./, '');
    let n = this;
    while (n) { if (n._cls.split(/\s+/).includes(want)) return n; n = n.parent; }
    return null;
  }
  querySelector(sel) { return this._all().find((n) => m(n, sel)) ?? null; }
  querySelectorAll(sel) { return this._all().filter((n) => m(n, sel)); }
  _all() { const o = []; const go = (n) => { for (const k of n.kids) { o.push(k); go(k); } }; go(this); return o; }
  focus() {}
  remove() { if (this.parent) { this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; } }
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
  if (sel.startsWith('.')) {
    return sel.slice(1).split('.').every((c) => n._cls.split(/\s+/).includes(c));
  }
  return n.tag === sel;
}

const root = new N('body');
const byId = {};
for (const id of ['hud', 'stage', 'toast', 'live', 'app', 'fx-layer']) { const d = new N('div'); d._cls = id; byId[id] = d; root.append(d); }
// The document RECORDS the audio layer's load-time gesture listeners: the lazy-init
// test dispatches a pointerdown through them and watches the context wake up.
const docListeners = {};
globalThis.document = {
  getElementById: (id) => byId[id] ?? null,
  createElement: (tag) => new N(tag),
  createTextNode: (txt) => { const n = new N('#text'); n.txt = String(txt); return n; },
  querySelector: (s) => root.querySelector(s),
  querySelectorAll: (s) => root.querySelectorAll(s),
  addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
  body: root,
};
globalThis.window = { addEventListener: () => {}, location: { search: '' } };
globalThis.location = { search: '' };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
globalThis.requestAnimationFrame = () => 0;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.URLSearchParams = URLSearchParams;

/* --------------------------------------------------- the FakeAudioContext stand-in */

class FakeParam {
  constructor(v = 0) { this.value = v; this.ops = []; }
  setValueAtTime(v, t) { this.value = v; this.ops.push(['set', v, t]); }
  exponentialRampToValueAtTime(v, t) { this.value = v; this.ops.push(['exp', v, t]); }
  linearRampToValueAtTime(v, t) { this.value = v; this.ops.push(['lin', v, t]); }
}
class FakeAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = { name: 'destination' };
    this.resumed = 0;
    this.created = [];
  }
  resume() { this.resumed += 1; this.state = 'running'; return Promise.resolve(); }
  createGain() { return this._node('gain', { gain: new FakeParam(1) }); }
  createOscillator() { return this._node('oscillator', { type: 'sine', frequency: new FakeParam(440) }); }
  createBiquadFilter() {
    return this._node('biquadfilter', { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1) });
  }
  createBuffer(channels, length, sampleRate) {
    return { channels, length, sampleRate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() { return this._node('buffersource', { buffer: null, playbackRate: new FakeParam(1) }); }
  _node(kind, extra) {
    const node = {
      kind, ...extra, uid: uid++, connected: [], started: null, stopped: null,
      connect(dest) { this.connected.push(dest); return dest; },
      start(t) { this.started = t ?? 0; },
      stop(t) { this.stopped = t; },
    };
    this.created.push(node);
    return node;
  }
}
globalThis.AudioContext = FakeAudioContext;

import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleApp } from '../web/app-bundle.mjs';

const appUrl = new URL('../../src/web/app.js', import.meta.url);
const { prelude, body, mods: importedModules } = await bundleApp(appUrl, { stubController: true });
let src = body;
src = 'async function measure(){ return null; }\n' + src;
src += '\nreturn {'
  + ' sfx, setSfxMuted, primeAudio, audioState, SFX_MUTED_KEY,'
  + ' dispatchFx, injectBursts: (b) => { bursts = b; },'
  + ' feelSchedule, animMs, setAnimSpeed, skipAnim,'
  + ' actxGet: () => actx,'
  + ' foldMs: FOLD_MS, budgetMs: BUDGET_MS, budgetMax: BUDGET_MAX };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__toasts', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
  ${src}
`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gesture = (type) => { for (const fn of docListeners[type] ?? []) fn({ type }); };

/** A booted instance at the first combat (the boot's own newGame drives a real run).
 *  Every factory evaluation re-runs audio.js's module body, so each instance owns a
 *  FRESH audio state; the gesture listeners pile up on the recording document, which
 *  is harmless — primeAudio is idempotent per instance. `reduce` pre-installs the
 *  reduced-motion media query BEFORE the body is evaluated (the input-lock lever). */
function startRun(seed, reduce = false) {
  globalThis.localStorage._d['dlb.helpSeen.v1'] = '1';
  const prev = globalThis.matchMedia;
  if (reduce) globalThis.matchMedia = () => ({ matches: true });
  const ctl = ctlMod.createController({ run: { seed } });
  ctl.dispatch('n1');
  const api = factory(ctl, [], importedModules);
  globalThis.matchMedia = prev;
  return { api, ctl };
}

/** One hero-play golpe list: two light strikes against a living enemy 0. */
const flickStrikes = (hp) => [
  { kind: 'strike', enemy: 0, name: 'Slag Crawler', dealt: 3, blocked: 0, parried: false, hp, hit: 1 },
  { kind: 'strike', enemy: 0, name: 'Slag Crawler', dealt: 3, blocked: 0, parried: false, hp: hp - 3, hit: 2 },
];
const flickList = (hp) => [{ kind: 'card-fly', side: 'side-0', strikes: flickStrikes(hp) }];
const deathBurst = (holdMs) => ({
  kind: 'death', enemy: 0, slot: 0, id: 'cinder_maw', name: 'Cinder Maw',
  side: 'side-0', boss: false, maxHp: 32, holdMs,
});

/* ------------------------------------------------------------------- unit: mapping */

test("the name->synth mapping builds each sound's own node signature", () => {
  const { api } = startRun(11);
  api.primeAudio();
  const ctx = api.actxGet();
  assert.ok(ctx, 'primeAudio built the context');
  const master = ctx.created[0];
  assert.equal(ctx.created.length, 1, 'prime built exactly the master bus');
  const gainsToMaster = () => ctx.created.filter((n) => n.kind === 'gain'
    && n !== master && n.connected.includes(master)).length;

  assert.equal(api.sfx('card-play'), true, 'card-play schedules');
  let kinds = ctx.created.slice(1).map((n) => n.kind).sort().join(',');
  assert.equal(kinds, 'biquadfilter,buffersource,gain', 'card-play is one filtered noise voice');
  assert.equal(ctx.created.find((n) => n.kind === 'biquadfilter').type, 'bandpass', 'the whoosh is band-passed');
  assert.equal(gainsToMaster(), 1, 'the whoosh reaches the master bus');

  assert.equal(api.sfx('hero-guard'), true, 'hero-guard schedules');
  const plates = ctx.created.filter((n) => n.kind === 'oscillator');
  assert.equal(plates.length, 2, 'the guard rings two plates');
  assert.deepEqual(plates.map((n) => n.frequency.value).sort((a, b) => a - b), [520, 780],
    'the plate rings sit a fifth apart');

  assert.equal(api.sfx('enemy-death'), true, 'enemy-death schedules');
  const fall = ctx.created.filter((n) => n.kind === 'oscillator').pop();
  assert.equal(fall.type, 'sawtooth', 'the collapse falls on a sawtooth');
  const freq = fall.frequency.ops;
  assert.equal(freq[0][1], 320, 'the fall starts at 320 Hz');
  assert.equal(freq[1][1], 40, 'the fall bottoms at 40 Hz');
  assert.ok(ctx.created.filter((n) => n.kind === 'buffersource').length >= 2, 'the ash tail rides noise');

  assert.equal(api.sfx('strike-impact', { weight: 0 }), true, 'strike-impact schedules');
  const sq = ctx.created.filter((n) => n.kind === 'oscillator' && n.type === 'square').pop();
  assert.ok(sq, 'the impact carries the click layer');
  assert.ok(sq.frequency.value >= 1400 * 0.94 && sq.frequency.value <= 1400 * 1.06,
    `the click rides the pitch band (${sq.frequency.value})`);

  assert.equal(api.sfx('no-such-sound'), false, 'an unknown name schedules nothing');
  assert.equal(api.audioState().counts['no-such-sound'], undefined, 'unknown names are not counted');

  assert.equal(api.sfx('card-play'), false, 'the same name inside the fold window folds');
});

test('the strike tier ladder rides the freeze weight the feel schedule computed', () => {
  // Two instances: the per-name fold would eat a second play inside 100ms.
  const light = startRun(11);
  light.api.primeAudio();
  const heavy = startRun(11);
  heavy.api.primeAudio();
  light.api.sfx('strike-impact', { weight: 0 });
  heavy.api.sfx('strike-impact', { weight: 2 });
  assert.equal(light.api.audioState().lastParams.weight, 0, 'a light golpe is tier 0');
  assert.equal(heavy.api.audioState().lastParams.weight, 2, 'a killing golpe is tier 2');
  const lightBand = light.api.actxGet().created.find((n) => n.kind === 'biquadfilter');
  const heavyBand = heavy.api.actxGet().created.find((n) => n.kind === 'biquadfilter');
  assert.equal(heavyBand.frequency.value / lightBand.frequency.value < 1, true,
    `the heavy tier sits a band below the light one (${heavyBand.frequency.value} < ${lightBand.frequency.value})`);
  const lightCrack = light.api.actxGet().created.find((n) => n.kind === 'gain' && n.gain.ops.length > 0);
  const heavyCrack = heavy.api.actxGet().created.find((n) => n.kind === 'gain' && n.gain.ops.length > 0);
  assert.equal(heavyCrack.gain.ops[0][1], 0.48, 'the heavy crack peaks louder');
  assert.equal(lightCrack.gain.ops[0][1], 0.2, 'the light crack peaks quieter');
});

test('the strike pitch randomize stays in its published band with real variety', async () => {
  const { api } = startRun(11);
  api.primeAudio();
  const pitches = [];
  for (let i = 0; i < 20; i += 1) {
    assert.equal(api.sfx('strike-impact', { weight: 1 }), true, `play ${i} schedules`);
    pitches.push(api.audioState().lastParams.pitch);
    // Spaced past DOUBLE the fold: a sustained rate under the rolling budget's 5/s too,
    // so neither throttle eats a play (the band test wants 20 real syntheses).
    await sleep(api.foldMs * 2 + 5);
  }
  for (const p of pitches) {
    assert.ok(p >= 0.94 && p <= 1.06, `every pitch stays in [0.94, 1.06] (${p})`);
  }
  assert.ok(new Set(pitches).size >= 2, 'the band produces more than one value in 20 plays');
});

/* ----------------------------------------------------------------- unit: throttle */

test('the per-name fold collapses a burst to its first sound', () => {
  const { api } = startRun(11);
  api.primeAudio();
  for (let i = 0; i < 5; i += 1) api.sfx('card-play');
  const st = api.audioState();
  assert.equal(st.counts['card-play'], 1, 'one sound scheduled of the five asked');
  assert.equal(st.throttled, 4, 'four asks folded');
});

test('plays spaced past the fold window pass, and the rolling budget folds the sixth in a second', async () => {
  const { api } = startRun(11);
  api.primeAudio();
  for (let i = 0; i < 5; i += 1) {
    assert.equal(api.sfx('card-play'), true, `play ${i} spaced past the fold passes`);
    await sleep(api.foldMs + 10);
  }
  assert.equal(api.audioState().counts['card-play'], 5, 'all five scheduled');
  const foldedBefore = api.audioState().throttled;
  assert.equal(api.sfx('card-play'), false, 'the sixth inside the trailing second folds');
  assert.equal(api.audioState().counts['card-play'], 5, 'the budgeted ask scheduled nothing');
  assert.equal(api.audioState().throttled, foldedBefore + 1, 'the budget fold is counted');
});

/* ------------------------------------------------------------------ unit: toggle */

test('the toggle mutes with zero scheduled nodes and persists across reloads', async () => {
  const { api } = startRun(11);
  api.primeAudio();
  assert.equal(api.sfx('card-play'), true);
  const ctx = api.actxGet();
  const nodesBefore = ctx.created.length;
  const countsBefore = api.audioState().counts['card-play'];

  api.setSfxMuted(true);
  assert.equal(api.sfx('card-play'), false, 'a muted ask schedules nothing');
  assert.equal(ctx.created.length, nodesBefore, 'no node was built');
  assert.equal(api.audioState().counts['card-play'], countsBefore, 'the counters froze');
  assert.equal(api.audioState().muted, true, 'the state reads muted');
  assert.equal(globalThis.localStorage._d[api.SFX_MUTED_KEY], '1', 'the toggle persisted');

  api.setSfxMuted(false);
  // The unmuted ask rides the SAME fold bookkeeping (the first play's timestamp is
  // still inside the window), so the restore waits it out like a second real play.
  await sleep(api.foldMs + 5);
  assert.equal(api.sfx('card-play'), true, 'unmuting restores the sound');

  // A fresh instance reads the persisted toggle at load — the reload contract.
  globalThis.localStorage._d[api.SFX_MUTED_KEY] = '1';
  const reloaded = startRun(11);
  assert.equal(reloaded.api.audioState().muted, true, 'the reload starts muted');
  reloaded.api.primeAudio();
  assert.equal(reloaded.api.sfx('card-play'), false, 'a muted reload schedules nothing');
  delete globalThis.localStorage._d[api.SFX_MUTED_KEY];
});

/* --------------------------------------------------------------- unit: lazy init */

test('no AudioContext exists before the first gesture; the gesture wakes it running', () => {
  const { api } = startRun(11);
  assert.equal(api.audioState().ctx, 'none', 'nothing primed at load');
  assert.equal(api.actxGet(), null, 'no context object exists');
  assert.equal(api.sfx('card-play'), false, 'an unprimed ask is a silent no-op');
  assert.deepEqual(api.audioState().counts, {}, 'nothing was scheduled');

  gesture('pointerdown');
  assert.equal(api.audioState().ctx, 'running', 'the gesture woke the context');
  assert.ok(api.actxGet(), 'the context object now exists');
  assert.ok(api.actxGet().resumed >= 1, 'the wake asked for a resume');
  assert.equal(api.sfx('card-play'), true, 'sound schedules after the gesture');
});

/* ------------------------------------------- integration: the dispatcher's hooks */

test('h1: a live-dock multi-golpe play schedules one strike-impact per golpe on its own beat', async () => {
  const { api } = startRun(11);
  api.primeAudio();
  api.setAnimSpeed(2); // base pace: the beats are 240 and 740
  api.injectBursts(flickList(29));
  api.dispatchFx();
  const st0 = api.audioState();
  assert.equal(st0.counts['card-play'], 1, 'the play whooshes at dispatch time');
  assert.equal(st0.counts['strike-impact'], undefined, 'the collapsed-beat half skipped: the beats are > 0');
  await sleep(320);
  assert.equal(api.audioState().counts['strike-impact'], 1, 'the first golpe sounded on its beat');
  await sleep(520);
  const st1 = api.audioState();
  assert.equal(st1.counts['strike-impact'], 2, 'the second golpe sounded a beat later');
  assert.equal(st1.throttled, 0, 'beats 500ms apart never fold');
  assert.ok(st1.lastParams.pitch >= 0.94 && st1.lastParams.pitch <= 1.06, 'the pitch band is live');
});

test('h2: the same play under reduce folds to ONE sound scheduled synchronously', () => {
  const { api } = startRun(11, true);
  api.primeAudio();
  api.injectBursts(flickList(29));
  api.dispatchFx();
  const st = api.audioState();
  assert.equal(st.counts['strike-impact'], 1, 'the collapsed beats fold to one golpe sound');
  assert.equal(st.throttled, 1, 'the sibling ask folded');
  assert.equal(st.counts['card-play'], 1, 'the play still whooshes');
  assert.equal(api.actxGet().created.length > 1, true, 'the sound is real, not swallowed');
});

test('h3: a stamped death fires its sound at the collapse START, not its end', async () => {
  const { api } = startRun(11);
  api.primeAudio();
  api.setAnimSpeed(2);
  api.injectBursts([deathBurst(600)]);
  api.dispatchFx();
  assert.equal(api.audioState().counts['enemy-death'], undefined,
    'the immediate half skipped the stamped hold');
  await sleep(100);
  assert.equal(api.audioState().counts['enemy-death'], undefined, 'still waiting at 100ms');
  await sleep(550);
  assert.equal(api.audioState().counts['enemy-death'], 1, 'it fired at the 600ms hold — 500ms before the end');
});

test('h4: two simultaneous deaths are one sound (the fold)', () => {
  const { api } = startRun(11);
  api.primeAudio();
  api.injectBursts([deathBurst(0), deathBurst(0)]);
  api.dispatchFx();
  const st = api.audioState();
  assert.equal(st.counts['enemy-death'], 1, 'two collapsed deaths, one shatter sound');
  assert.equal(st.throttled, 1, 'the sibling ask folded');
});

test('h5: the » skip retires a pending death sound through the generation guard', async () => {
  const { api } = startRun(11);
  api.primeAudio();
  api.setAnimSpeed(2);
  api.injectBursts([deathBurst(500)]);
  api.dispatchFx();
  await sleep(60);
  api.skipAnim();
  await sleep(600);
  assert.equal(api.audioState().counts['enemy-death'], undefined,
    'the skip bumped the generation; the deferred fire retired');
});
