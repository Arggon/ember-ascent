// The UX-5 input gate: while a play's animation is landing, the hand and End Turn are
// locked (the unplayable cards' own shape) and the combat shortcuts are swallowed —
// and the kernel never saw any of it.
//
// WHAT THIS PINS, against the REAL surface code driven by the fake-DOM harness:
//   * a card play arms the gate from the play's own choreography span (playInputSpan —
//     pose + signature tail + throw flight + hit-stop, all paced), and the paint that
//     follows the play is ALREADY locked (the gate arms in act() before the repaint,
//     exactly where the UX-2 strike plan arms);
//   * the locked shape is the unplayable cards': aria-disabled="true", the disabled
//     class, the native disabled flag, and an honest wait named in the label;
//   * hotkeys (digit, e/space, n) are swallowed while busy and work again after;
//   * the enemy turn gates on the strike plan (strikeSeq), » retires both;
//   * a deal gates on the deal clock (dealClock);
//   * reduced motion NEVER engages the gate, and neither does » (speed 0);
//   * the kernel state is byte-identical whether or not the gate holds: the gate is
//     presentation only, so the same play the gate blocks by click is still legal —
//     the sim's fast path never routes through the surface.
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
  if (sel.startsWith('.')) return n._cls.split(/\s+/).includes(sel.slice(1));
  return n.tag === sel;
}

const root = new N('body');
const byId = {};
for (const id of ['hud', 'stage', 'toast', 'live', 'app']) { const d = new N('div'); d._cls = id; byId[id] = d; root.append(d); }
/** The document-level listeners app.js registers — the keyboard is driven through them. */
const docListeners = {};
globalThis.document = {
  getElementById: (id) => byId[id] ?? null,
  createElement: (t) => new N(t),
  createTextNode: (t) => { const n = new N('#text'); n.txt = String(t); return n; },
  querySelector: (s) => root.querySelector(s),
  querySelectorAll: (s) => root.querySelectorAll(s),
  addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); },
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
src = src.replace('function toast(msg, kind = \'warn\') {', 'function toast(msg, kind = \'warn\') { __toasts.push(msg);');
src = 'async function measure(){ return null; }\n' + src;
src += '\nreturn { render, clickCard, act, skipAnim, setAnimSpeed, busyReason, playInputSpan,'
  + ' get pendingSlot(){return pendingSlot;}, snapGet(){return snap;},'
  + ' strikeSeqGet: () => strikeSeq, dealClockGet: () => dealClock, lockGet: () => inputLock,'
  + ' injectBursts: (b) => { bursts = b; } };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__toasts', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
  ${src}
`);

/** The index into docListeners.keydown where the CURRENT instance's listener starts —
 *  every factory evaluation registers another one, and a press must reach only the
 *  instance under test (an earlier instance's closure would drive its own dead run). */
let keyFrom = 0;

/** Press a key the way the page's own keydown listener receives it. */
function pressKey(key) {
  for (const fn of (docListeners.keydown || []).slice(keyFrom)) {
    fn({ key, metaKey: false, ctrlKey: false, altKey: false, preventDefault() {} });
  }
}

/** Start a run at the first combat. `matchMediaReduce` pre-installs the reduced-motion
 *  media query BEFORE the bundle is evaluated, so that instance reads it at load. */
function startRun(seed, matchMediaReduce = false) {
  // A RETURNING player: the first-run Help sheet owns the keyboard until dismissed
  // (hud.js HELP_SEEN_KEY), and these tests drive the keyboard — mark it seen the way
  // the sheet's own close button does, so the keys reach the busy gate under test.
  globalThis.localStorage._d['dlb.helpSeen.v1'] = '1';
  keyFrom = (docListeners.keydown || []).length;
  const prev = globalThis.matchMedia;
  if (matchMediaReduce) globalThis.matchMedia = () => ({ matches: true });
  const ctl = ctlMod.createController({ run: { seed } });
  ctl.dispatch('n1');
  const api = factory(ctl, toasts, importedModules);
  if (matchMediaReduce) {
    if (prev === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = prev;
  }
  api.render();
  return { api, ctl };
}

/** Play a playable hand card through the DOM, the way a player does: click, then a
 *  target if the row asks for one (a play has not resolved until the target fired). */
function playACard(api) {
  const hand = api.snapGet().hand;
  const card = hand.find((c) => c.playable);
  assert.ok(card, `a playable card is dealt (hand: ${hand.map((c) => c.cardId).join(', ')})`);
  byId.stage.querySelector(`[data-slot="${card.slot}"]`).dispatch('click');
  if (api.pendingSlot !== null) {
    const enemies = byId.stage.querySelectorAll('.enemy');
    assert.ok(enemies.length > 0, 'targeting offers at least one enemy');
    enemies[0].dispatch('click');
  }
  return card;
}

/** The hand tiles painted on the stage, and the End Turn button. */
function handTiles() {
  return byId.stage.querySelectorAll('button').filter((b) => b.attrs['data-slot']);
}
function endTurnBtn() {
  return byId.stage.querySelectorAll('button').find((b) => (b.txt || '').includes('End Turn')) ?? null;
}
function kernelFingerprint(ctl) {
  const s = ctl.state;
  return JSON.stringify({ step: s.stepIndex, hp: s.player.hp, en: s.player.energy, deck: s.deck.length, disc: s.combat ? s.combat.discard.length : null });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('at rest the hand and End Turn are unlocked (the gate is not always on)', () => {
  const { api } = startRun(11);
  assert.equal(api.busyReason(), null, 'nothing is busy before any action');
  const tiles = handTiles();
  assert.ok(tiles.length > 0, 'the hand painted');
  for (const t of tiles) {
    assert.equal(t.getAttribute('aria-disabled'), 'false', 'a playable hand tile is enabled');
    assert.equal(t.disabled, false, 'a playable hand tile is not natively disabled');
  }
  const end = endTurnBtn();
  assert.ok(end, 'End Turn painted');
  assert.notEqual(end.getAttribute('aria-disabled'), 'true', 'End Turn is enabled at rest');
});

test('a play locks the hand and End Turn in the very paint that follows it', () => {
  const { api, ctl } = startRun(11);
  const before = kernelFingerprint(ctl);
  playACard(api);
  // The gate armed from the play's own choreography, and the paint act() just ran
  // already shows it — the same place-and-order the UX-2 strike plan arms.
  assert.equal(api.busyReason(), 'play', 'the play locked the input');
  const tiles = handTiles();
  assert.ok(tiles.length > 0, 'the repainted hand exists');
  for (const t of tiles) {
    assert.equal(t.getAttribute('aria-disabled'), 'true', 'every hand tile reads locked during the play');
    assert.match(t.className, /is-unplayable/, 'the tile wears the unplayable visual');
    assert.match(t.getAttribute('aria-label'), /Waiting: the last card is landing/, 'the tile names the honest wait');
    assert.equal(t.disabled, true, 'the tile is natively disabled (a click cannot even fire)');
  }
  const end = endTurnBtn();
  assert.equal(end.getAttribute('aria-disabled'), 'true', 'End Turn reads locked during the play');
  assert.equal(end.disabled, true, 'End Turn is natively disabled during the play');
  // The kernel fingerprint is unchanged by the LOCK itself — only the play moved state.
  assert.notEqual(kernelFingerprint(ctl), before, 'the play itself resolved');
});

test('hotkeys are swallowed while the gate holds, and work again after it releases', async () => {
  const { api, ctl } = startRun(11);
  playACard(api);
  assert.equal(api.busyReason(), 'play');
  const locked = kernelFingerprint(ctl);
  // Digit, End-Turn key, and the run restart are all swallowed while busy.
  pressKey('1');
  pressKey('e');
  pressKey('n');
  assert.equal(kernelFingerprint(ctl), locked, 'no swallowed key moved the kernel');
  assert.equal(api.pendingSlot, null, 'no swallowed digit even opened a target step');
  // The span is the play's own choreography, armed on the lock itself: Hammerfall's
  // paced pose (560 base → 1120ms) with its signature tail (the kill-hold convention,
  // 0.7 × pose + a paced 650 → 2084ms) — the longest beat, floored by the hit-stop.
  // Past it the gate releases lazily on the next paint, so the wait is read off the
  // armed lock rather than restated here.
  const lock = api.lockGet();
  assert.ok(lock && lock.why === 'play', 'the play armed its lock');
  await sleep(lock.until - Date.now() + 150);
  assert.equal(api.busyReason(), null, 'the gate released when the play landed');
  api.render();
  const tiles = handTiles();
  for (const t of tiles) assert.equal(t.getAttribute('aria-disabled'), 'false', 'the hand is playable again');
  const after = kernelFingerprint(ctl);
  pressKey('1');
  // The released digit acts: either the kernel moved (an instant play) or a target step
  // opened (a targeted play on a multi-enemy row) — both are the keyboard working again.
  assert.ok(api.pendingSlot !== null || kernelFingerprint(ctl) !== after,
    'the released digit played a card (or opened its target step)');
});

test('the enemy turn gates on the strike plan, and » retires it', () => {
  // Seed 3: the first End Turn meets TWO attackers (seed 11's first turn is a non-attack
  // turn, and a turn with no attack arms no plan — there is no sequence to show).
  const { api, ctl } = startRun(3);
  const end = endTurnBtn();
  end.dispatch('click');
  // The state the gate protects is the one the End Turn click left behind (`n1` was
  // already step 1, so the click itself moved the kernel) — captured AFTER the click.
  const before = kernelFingerprint(ctl);
  // The plan is armed (the seeded fight attacks), so the gate says so — and the paint
  // after the click is already locked.
  assert.ok(api.strikeSeqGet(), 'the strike plan armed');
  assert.equal(api.busyReason(), 'enemy-turn', 'the sequence holds the gate');
  assert.equal(endTurnBtn().getAttribute('aria-disabled'), 'true', 'End Turn is locked for the sequence');
  pressKey('1');
  assert.equal(kernelFingerprint(ctl), before, 'a digit cannot play during the enemy turn');
  // » skips the animation AND the wait: the plan retires, the gate releases.
  api.skipAnim();
  assert.equal(api.strikeSeqGet(), null, '» retired the plan');
  assert.equal(api.busyReason(), null, '» released the gate');
  api.render();
  assert.notEqual(endTurnBtn().getAttribute('aria-disabled'), 'true', 'End Turn is playable again');
});

test('a deal gates on the deal clock', () => {
  const { api } = startRun(11);
  api.injectBursts([{ kind: 'deal' }]);
  api.render();
  assert.ok(api.dealClockGet(), 'the deal clock armed');
  assert.equal(api.busyReason(), 'deal', 'the arriving hand holds the gate');
  for (const t of handTiles()) assert.equal(t.getAttribute('aria-disabled'), 'true', 'the arriving tiles read locked');
});

test('reduced motion never engages the gate (animations are instant there)', () => {
  const { api } = startRun(11, true);
  playACard(api);
  assert.equal(api.busyReason(), null, 'reduced motion arms nothing');
  for (const t of handTiles()) assert.equal(t.getAttribute('aria-disabled'), 'false', 'the hand stays playable');
});

test('» (speed 0) never engages the gate either', () => {
  const { api } = startRun(11);
  api.setAnimSpeed(0);
  playACard(api);
  assert.equal(api.busyReason(), null, 'the fast form locks nothing');
  for (const t of handTiles()) assert.equal(t.getAttribute('aria-disabled'), 'false', 'the hand stays playable at »');
});

test('the gate is presentation only: the kernel still takes what the gate blocks', () => {
  // The gate lives in the surface. The kernel answers the same action identically
  // whether or not a lock is armed — the exact action the gate is blocking (End Turn,
  // locked and unwired on the button) is still legal through the controller the sim
  // and the stepping tests drive.
  const { api, ctl } = startRun(11);
  playACard(api);
  assert.equal(api.busyReason(), 'play', 'the surface is locked');
  const endId = (api.snapGet().actions || []).find((a) => a.kind === 'end_turn')?.id;
  assert.ok(endId, 'the snapshot offers the end turn');
  const res = ctl.dispatch(endId);
  assert.ok(!res.error, `the kernel still takes the blocked action: ${JSON.stringify(res.error || {})}`);
});
