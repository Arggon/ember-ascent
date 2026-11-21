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
  + ' hpTrailGet: () => hpTrail,'
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

/* ------------------------------------- barra de vida por golpe: the step timelines ---
 * The trail is presentation state armed from the kernel's OWN event stream. These tests
 * pin its DATA shape and its FIRE-TIME behaviour against the real act()/dispatchFx code
 * with real timers: the golpe fires are the dispatcher's own paced `later` timers, so
 * awaiting the paced impact puts the assertions on the same clock the floats land on.
 * The live-node writes are the browser e2e's claim (the fake DOM cannot resolve
 * `.fight .hero`); what is pinned here is that the RIGHT step fires at the RIGHT beat,
 * that the last applied value equals the snapshot (invariant (a)), and that skip
 * retires (invariant (b)). */

/** Start a run at the first combat with `cardId` injected 8-deep BEFORE the first hand
 *  is dealt (the e2e's save lever, at run-start where the snapshot cannot go stale). */
function startRunWithDeck(seed, cardId, matchMediaReduce = false) {
  globalThis.localStorage._d['dlb.helpSeen.v1'] = '1';
  keyFrom = (docListeners.keydown || []).length;
  const prev = globalThis.matchMedia;
  if (matchMediaReduce) globalThis.matchMedia = () => ({ matches: true });
  const ctl = ctlMod.createController({ run: { seed } });
  const save = JSON.parse(ctl.save());
  for (let i = 0; i < 8; i += 1) save.state.deck.push({ uid: `t-${cardId}-${i}`, cardId });
  const res = ctl.load(save);
  if (!res.ok) throw new Error(`deck load failed: ${JSON.stringify(res.problems)}`);
  ctl.dispatch('n1');
  const api = factory(ctl, toasts, importedModules);
  if (matchMediaReduce) {
    if (prev === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = prev;
  }
  api.render();
  return { api, ctl };
}

/** The stable index of the first living enemy (the trail's unit key namespace). */
const firstFoeKey = (ctl) => `e${ctl.state.combat.enemies.findIndex((e) => !e.dead)}`;

/** Play a SPECIFIC card by id the way a player does (playACard plays whatever the hand
 *  offers first — the injected deck does not reorder the shuffle). */
function playCardById(api, cardId) {
  const hand = api.snapGet().hand;
  const card = hand.find((c) => c.cardId === cardId && c.playable);
  assert.ok(card, `${cardId} playable in hand (hand: ${hand.map((c) => c.cardId).join(', ')})`);
  byId.stage.querySelector(`[data-slot="${card.slot}"]`).dispatch('click');
  if (api.pendingSlot !== null) {
    const enemies = byId.stage.querySelectorAll('.enemy');
    assert.ok(enemies.length > 0, 'targeting offers at least one enemy');
    enemies[0].dispatch('click');
  }
  return card;
}

test('a multi-hit play arms the trail and its bar steps land golpe by golpe', async () => {
  const { api, ctl } = startRunWithDeck(11, 'cinder_flick');
  const foeKey = firstFoeKey(ctl);
  const foeStart = ctl.state.combat.enemies.find((e) => !e.dead).hp;
  // The paint BEFORE any fire shows the trail's start, never the resolved end.
  playCardById(api, 'cinder_flick');
  const trail = api.hpTrailGet();
  assert.ok(trail, 'a damage play armed the trail');
  const unit = trail.units.get(foeKey);
  assert.ok(unit, `the struck enemy is an armed unit: ${[...trail.units.keys()].join(', ')}`);
  assert.equal(unit.start, foeStart, 'the unit starts where the bar was painted');
  assert.equal(unit.current, null, 'no step has fired yet at paint time');
  // The strike entries carry per-golpe HP — the timeline the dispatcher reads.
  const plan = api.strikeSeqGet();
  assert.equal(plan, null, 'a card play does not arm the enemy-turn plan');
  // The first golpe's float lands at the STRIKE_SEQ impact (beat 0 + impact, paced).
  const impact = Math.round(640 * 2 * 0.46);
  await sleep(impact + 120);
  const mid = api.hpTrailGet();
  assert.ok(mid && mid.units.get(foeKey).current !== null, 'the first golpe fired its bar step');
  const first = mid.units.get(foeKey).current;
  assert.ok(first < foeStart, `the first golpe took HP off the shown value: ${foeStart} -> ${first}`);
  // The last golpe fires two beats later (beat 2 + impact); past it the applied value IS
  // the snapshot, and the read still lands inside the trail's own span (the retire waits
  // on playInputSpan + its transition tail, a beat past the last golpe).
  await sleep(Math.round(500 * 2 * 2) + 200);
  const end = api.hpTrailGet();
  assert.ok(end, 'the trail is still armed inside its own span (all golpes applied)');
  const last = end.units.get(foeKey).current;
  const kernelHp = ctl.state.combat.enemies.find((e) => !e.dead)?.hp ?? 0;
  assert.equal(last, kernelHp, `invariant (a): the last applied step equals the snapshot (${last} vs ${kernelHp})`);
  assert.ok(end.units.get(foeKey).applied.length >= 2, `the bar stepped per golpe (${end.units.get(foeKey).applied.length} steps)`);
});

test('a heal play arms the hero unit and its reveal step lands on the reveal fire', async () => {
  const { api, ctl } = startRunWithDeck(11, 'tallow_rub');
  // Damage the hero the one way the harness may: the save lever (documented as the one
  // writable lever). The trail's AMOUNT steps anchor on the kernel's pre-action truth
  // (ctl.state), so a stale painted snapshot cannot poison the heal's step.
  const crafted = (() => {
    const save = JSON.parse(ctl.save());
    save.state.player.hp = 30;
    return ctl.load(save);
  })();
  assert.equal(crafted.ok, true, `the hp craft failed: ${JSON.stringify(crafted.problems)}`);
  const healedBefore = ctl.state.player.hp;
  assert.equal(healedBefore, 30, 'the kernel holds the crafted 30 HP');
  playCardById(api, 'tallow_rub');
  const trail = api.hpTrailGet();
  assert.ok(trail, 'a heal play armed the trail');
  const unit = trail.units.get('p');
  assert.ok(unit, 'the hero is an armed unit');
  assert.equal(unit.start, 30, 'the unit anchors on the kernel truth, not the painted snapshot');
  assert.equal(trail.reveal.length, 1, `exactly one reveal step (the heal): ${JSON.stringify(trail.reveal)}`);
  assert.equal(trail.reveal[0].unit, 'p', 'the heal speaks for the hero');
  // `heal.amount` is what the kernel actually restored: start + amount == the step.
  const healed = ctl.state.player.hp - healedBefore;
  assert.ok(healed > 0, `the kernel restored HP (${healed})`);
  assert.equal(trail.reveal[0].hp, unit.start + healed,
    `the reveal step carries the kernel's own restoration (${unit.start} + ${healed})`);
  assert.equal(trail.reveal[0].hp, ctl.state.player.hp, 'the step equals the kernel truth');
  // The reveal fire is the feel queue's (animMs(240)+animMs(70) at 1x = 620ms).
  await sleep(620 + 150);
  const fired = api.hpTrailGet();
  assert.ok(fired, 'the trail is still armed right after the reveal');
  assert.equal(fired.units.get('p').current, trail.reveal[0].hp, 'the heal step fired on the reveal beat');
  assert.equal(fired.units.get('p').current, ctl.state.player.hp, 'the hero bar shows the kernel truth');
});

test('the enemy turn arms the hero unit and the slams step its bar per golpe', async () => {
  // Seed 3: the first End Turn meets two attackers (the same shape the gate test pins).
  const { api, ctl } = startRun(3);
  const heroStart = ctl.state.player.hp;
  endTurnBtn().dispatch('click');
  const trail = api.hpTrailGet();
  assert.ok(trail, 'an attacking turn armed the hero trail');
  assert.ok(trail.units.has('p'), 'the hero is armed');
  assert.equal(trail.units.get('p').start, heroStart, 'the hero bar starts where the paint put it');
  const plan = api.strikeSeqGet();
  assert.ok(plan && plan.attacks.length >= 2, 'the seeded turn has per-strike entries');
  for (const a of plan.attacks) assert.equal(typeof a.hp, 'number', 'each strike entry carries its golpe HP');
  // The first golpe's impact: the same fire that lands the named float.
  await sleep(Math.round(640 * 2 * 0.46) + 120);
  const mid = api.hpTrailGet();
  assert.ok(mid && mid.units.get('p').current !== null, 'the first slam fired its hero bar step');
  assert.equal(mid.units.get('p').current, plan.attacks[0].hp, 'the step is the kernel\'s own enemy_attack.hp');
  // » mid-sequence: the remaining golpes never fire and the bar snaps to the snapshot.
  api.skipAnim();
  assert.equal(api.hpTrailGet(), null, 'invariant (b): skip retires the trail');
});

test('reduced motion and » arm no trail (invariant c: instant truth)', async () => {
  const reduce = startRunWithDeck(11, 'cinder_flick', true);
  playACard(reduce.api);
  assert.equal(reduce.api.hpTrailGet(), null, 'reduced motion arms nothing');
  const fast = startRunWithDeck(11, 'cinder_flick');
  fast.api.setAnimSpeed(0);
  playACard(fast.api);
  assert.equal(fast.api.hpTrailGet(), null, '» arms nothing');
});

/* -------------------------------------- hp_cost: the temper toll anchors the model ---
 * The temper toll (`temperHpCost` — 'redhot' is "Lose 2 HP when played", steps.js) and
 * an event choice's toll (events.js) travel as `hp_cost { amount }`, paid BEFORE the
 * play's own effects. The trail's running hero model must pay it on the PRE beat and
 * stay anchored on the kernel's truth — without the branch the anchor sat 2 HP high,
 * and a later HP fact of the same stream (the kindled_heart heal a killing stroke
 * arrives with) lifted the bar ABOVE the snapshot for the retire to snap back down:
 * the owner's "the bar rises, then falls again" report. These pins drive the REAL
 * act() through the fake-DOM harness with a wrapper that reports a PINNED stream while
 * the real controller below resolves the same play — and the craft makes the real
 * truth agree with the pinned stream (45 - 2 = 43 alive; 45 - 2 + 6 = 49 on the kill),
 * so the no-snap claim is checked against a consistent run, not a stream's say-so. */

/** A delegating wrapper around a REAL controller whose dispatch reports `streamOf()`
 *  as the step's kernel events. The state, the snapshots and save/load stay the
 *  kernel's own — the stream is the presentation input, nothing else. */
function ctlReporting(ctl, streamOf) {
  return {
    get state() { return ctl.state; },
    get submitted() { return ctl.submitted; },
    dispatch(id) {
      const res = ctl.dispatch(id);
      const stream = streamOf(id);
      if (stream) res.events = stream;
      return res;
    },
    snapshot(opts) { return ctl.snapshot(opts); },
    save() { return ctl.save(); },
    load(raw) { return ctl.load(raw); },
  };
}

/** Start a run at the first combat whose controller reports the pinned stream — the
 *  same deck-lever shape startRunWithDeck uses (8× `cardId` pushed before the first
 *  hand), but the wrapper is in the module's ctl seat from the boot onward. */
function startWithStream(seed, streamOf, cardId = 'cinder_flick') {
  globalThis.localStorage._d['dlb.helpSeen.v1'] = '1';
  keyFrom = (docListeners.keydown || []).length;
  const ctl = ctlMod.createController({ run: { seed } });
  const save = JSON.parse(ctl.save());
  for (let i = 0; i < 8; i += 1) save.state.deck.push({ uid: `t-${cardId}-${i}`, cardId });
  const res = ctl.load(save);
  if (!res.ok) throw new Error(`deck load failed: ${JSON.stringify(res.problems)}`);
  ctl.dispatch('n1');
  const api = factory(ctlReporting(ctl, streamOf), toasts, importedModules);
  api.render();
  return { api, ctl };
}

/** Craft a live combat into the repro's shape through the save/load lever (the one
 *  documented writable lever): the hero at `hp`, the first living foe at `foeHp` with
 *  no block, and every deck copy of the tested card tempered 'redhot' (the toll's
 *  payer — the kernel then pays exactly the 2 HP the pinned stream declares). */
function craftRepro(ctl, { hp, foeHp }) {
  const save = JSON.parse(ctl.save());
  save.state.player.hp = hp;
  const foe = save.state.combat.enemies.find((e) => !e.dead);
  foe.hp = foeHp;
  foe.block = 0;
  save.state.tempers = save.state.tempers ?? {};
  for (const c of save.state.deck) if (c.cardId === 'cinder_flick') save.state.tempers[c.uid] = 'redhot';
  const res = ctl.load(save);
  assert.equal(res.ok, true, `the repro craft failed: ${JSON.stringify(res.problems)}`);
  return { foeIdx: foe.index };
}

/** Capture '[hp-trail]' warns while `fn` runs — the retire's snap warn is the bug's
 *  signature (a trail the stream did not fully carry), so a no-warn claim needs the
 *  channel spied across the WHOLE span, retire timer included. */
async function withoutTrailWarns(fn) {
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.warn = realWarn;
  }
  return warns.filter((w) => w.includes('[hp-trail]'));
}

/** Wait for the play's own span timer to retire the armed trail (the natural retire —
 *  the same path the repro's snap warn rode). */
async function awaitTrailRetire(api, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (api.hpTrailGet() && Date.now() < deadline) await sleep(100);
}

test('hp_cost pays on the pre-beat and the heal stays anchored: the retire snaps nothing', async () => {
  const box = { stream: null };
  const { api, ctl } = startWithStream(14, () => box.stream);
  const { foeIdx } = craftRepro(ctl, { hp: 45, foeHp: 8 });
  // The repro's trio in the kernel's OWN measured shape (K.step, redhot cinder_flick
  // vs the crafted 8-HP foe): the toll, the killing golpes, the relic heal that arrives
  // with the kill. cinder_flick is Deal 3 damage 3 times; redhot floors that to 4
  // (tempers.js Math.floor((3*3)/2)), so the fight resolves as TWO damage facts —
  // hp 4, then 0 — with the third golpe re-resolving to nothing on the dead aim. The
  // heal amount is the full +6 under this craft (45 - 2 + 6 = 49 < maxHp), which is
  // what every assertion below hangs on; the foe's truth (hp 0, omitted from the
  // snapshot) is the other half the retire checks.
  box.stream = [
    { t: 'hp_cost', amount: 2, source: 'temper' },
    { t: 'damage', source: 'player', target: foeIdx, raw: 4, dealt: 4, blocked: 0, hp: 4 },
    { t: 'damage', source: 'player', target: foeIdx, raw: 4, dealt: 4, blocked: 0, hp: 0 },
    { t: 'heal', who: 'player', amount: 6, source: 'kindled_heart' },
  ];
  const trailWarns = await withoutTrailWarns(async () => {
    playCardById(api, 'cinder_flick');
    const trail = api.hpTrailGet();
    assert.ok(trail, 'the play armed the trail');
    // The cost rides the PRE list (always — it precedes the play's whole choreography);
    // the heal rides the reveal, anchored on 45 - 2, NOT on the unpayed 45.
    assert.deepEqual(trail.pre, [{ unit: 'p', hp: 43 }],
      `the pre list carries the cost step: ${JSON.stringify(trail.pre)}`);
    assert.deepEqual(trail.reveal, [{ unit: 'p', hp: 49 }],
      `the reveal carries the heal anchored on the paid model: ${JSON.stringify(trail.reveal)}`);
    // Both fires land inside the feel queue (pre at animMs(240), reveal +animMs(70);
    // 620ms at the harness's 1x pace) — past it the hero bar walked 43 then 49.
    await sleep(620 + 150);
    const fired = api.hpTrailGet();
    assert.ok(fired, 'the trail is still armed right after the reveal');
    assert.deepEqual(fired.units.get('p').applied.map((s) => s.hp), [43, 49],
      'the hero bar stepped pre-2, then pre-2+6, in that order');
    assert.equal(fired.units.get('p').current, 49, 'the shown value is the kernel truth');
    assert.equal(ctl.state.player.hp, 49, 'and the kernel itself holds 45 - 2 + 6');
    // The retire runs on the play span's own timer: past it the trail is gone and no
    // '[hp-trail]' snap warn ever fired — every HP fact the model carried was truth.
    await awaitTrailRetire(api);
    assert.equal(api.hpTrailGet(), null, 'the trail retired with the play span');
  });
  assert.equal(trailWarns.length, 0, `the retire snapped nothing: ${JSON.stringify(trailWarns)}`);
});

test('a hp_cost alone steps the pre-beat and the model ends at pre-2 (no heal to misplace)', async () => {
  const box = { stream: null };
  const { api, ctl } = startWithStream(14, () => box.stream);
  const { foeIdx } = craftRepro(ctl, { hp: 45, foeHp: 60 });
  box.stream = [{ t: 'hp_cost', amount: 2, source: 'temper' }];
  const trailWarns = await withoutTrailWarns(async () => {
    playCardById(api, 'cinder_flick');
    const trail = api.hpTrailGet();
    assert.ok(trail, 'the cost armed a trail');
    assert.deepEqual(trail.pre, [{ unit: 'p', hp: 43 }],
      `the pre list carries the cost step alone: ${JSON.stringify(trail.pre)}`);
    assert.deepEqual(trail.reveal, [], `nothing else to reveal: ${JSON.stringify(trail.reveal)}`);
    assert.ok(!trail.units.has(`e${foeIdx}`), 'the foe the pinned stream never touches stays unarmed');
    await sleep(620 + 150);
    const fired = api.hpTrailGet();
    assert.ok(fired, 'the trail is still armed inside its span');
    assert.equal(fired.units.get('p').current, 43, 'the model ends at pre-2');
    assert.equal(ctl.state.player.hp, 43, 'the kernel paid exactly the 2 HP');
    await awaitTrailRetire(api);
    assert.equal(api.hpTrailGet(), null, 'the trail retired with the play span');
  });
  assert.equal(trailWarns.length, 0, `the retire snapped nothing: ${JSON.stringify(trailWarns)}`);
});
