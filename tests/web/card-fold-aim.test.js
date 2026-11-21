// tests/web/card-fold-aim.test.js — the GUI half of the per-target fold.
//
// The kernel already publishes one sentence per LIVING enemy (`descriptionsByTarget`,
// keyed '1', '2', ... by living position — the same k the aim actions carry). It stops
// there on purpose: the target is the player's choice, so `description` keeps the honest
// no-Vulnerable print. This file pins the surface's half of that contract: WHILE the card
// waits for a target, its tile speaks the sentence of the enemy the crosshair is on.
//
// WHAT THIS PINS, against the REAL surface code driven by the fake-DOM harness:
//   * at rest the tile reads the resting sentence, and the snapshot really does carry a
//     DIFFERENT variant for the Vulnerable enemy — so the resting paint below is a
//     decision the renderer made, not a fixture that had nothing to swap in;
//   * entering the target step aims at the first living enemy (aimed = 1) and the tile
//     still reads the resting sentence: a healthy neighbour's variant IS the resting face;
//   * aiming at the Vulnerable enemy — through a real `mouseenter` on its card, which is
//     what setAimed(2) is wired to — swaps the tile's sentence (its `title` and its
//     `aria-label` to that enemy's amplified sentence (`— 9 against Vulnerable.`), and no
//     other card in the hand moves;
//   * leaving the step — Escape's path (cancelTargeting) — puts the resting sentence back;
//   * the number the tile previews is the number the play LANDS: aiming at the Vulnerable
//     enemy and clicking it takes exactly 9, so the key the renderer reads and the key the
//     kernel resolves cannot drift apart without this file going red.

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleApp } from '../web/app-bundle.mjs';
import { combatState, content, makeEnemy, loadEncounters } from '../helpers/harness.mjs';

const appUrl = new URL('../../src/web/app.js', import.meta.url);
const { prelude, body, mods: importedModules } = await bundleApp(appUrl, { stubController: true });
// The surface internals this file drives. `setCtl`/`setSnap` are the runtime's own setters:
// newGame() would build a RANDOM run, so the crafted fight is injected exactly the way
// hero-status-parity.test.js does it — through the real controller over a plain state.
let src = body;
src += '\nreturn { render, clickCard, setAimed, cancelTargeting, setCtl, setSnap,'
  + ' get pendingSlot(){return pendingSlot;}, get aimed(){return aimed;},'
  + ' snapGet: () => snap };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
  ${src}
`);

const { ENEMIES } = await loadEncounters();

const VULN = { vulnerable: 2 };
/** The kernel's own two sentences for Hammerfall on this field (card-fold-targeting.test.js). */
const PLAIN = 'Deal 6 damage to the enemy.';
const VULN_9 = 'Deal 6 damage to the enemy — 9 against Vulnerable.';
const HELP_SEEN_KEY = 'dlb.helpSeen.v1';

/**
 * Boot the surface on two Cinder Maws — the SECOND one Vulnerable — with `hand` dealt.
 * The controller is the real one; only the state it is loaded from is a plain object, so
 * every sentence below still comes from the kernel.
 * @param {number} [cards] how many copies of Strike to deal (1 unless a test needs a neighbour)
 */
async function startFight(cards = 1) {
  // A RETURNING player: the first-run Help sheet would otherwise paint over the stage.
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const def = (await content()).cards.get('hammerfall');
  const hand = Array.from({ length: cards }, (_, i) => ({ uid: `H${i + 1}`, cardId: 'hammerfall', cost: def.cost, perPlay: 0 }));
  const state = await combatState('hammerfall', {
    enemies: [makeEnemy(ENEMIES.cinder_maw), makeEnemy(ENEMIES.cinder_maw, { statuses: VULN })],
    hand,
  });
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  const api = factory(ctl, importedModules);
  api.setCtl(ctl);
  api.setSnap(ctl.snapshot({ lang: 'en' }));
  api.render();
  assert.equal(api.snapGet().phase, 'combat', 'the crafted state reads as the fight');
  assert.equal(api.snapGet().enemies.length, 2, 'two enemies are alive, so aiming is a choice');
  return api;
}

/** The hand tile for a slot (`p1`, `p2`, ...). */
const tile = (slot) => byId.stage.querySelector(`[data-slot="${slot}"]`);
/** The enemy cards, in living positions. */
const enemyTiles = () => byId.stage.querySelectorAll('.enemy');
/** The tile's current sentence. EFFECT CHIPS moved the carrier: a fully chip-covered
 *  card (plain Hammerfall is one) no longer paints its sentence as `.cdesc` — the icon
 *  row carries the face and the sentence stays in the tile's `title` and `aria-label`
 *  (tests/web/card-effect-chips.test.js pins that move). The fold under test rides the
 *  same kernel sentence, so this reads the title, where the fold is still spelled out. */
const descOf = (slot) => tile(slot).attrs.title;

test('at rest the tile reads the resting sentence — the variants exist but are not used', async () => {
  const api = await startFight();
  // NOT VACUOUS: the snapshot carries an amplified variant for the Vulnerable enemy, so a
  // renderer that swapped at rest would have had something to swap in.
  const card = api.snapGet().hand[0];
  assert.equal(card.description, PLAIN, 'the top-level sentence is the honest no-target print');
  assert.equal(card.descriptionsByTarget['2'], VULN_9, 'the kernel ships the Vulnerable enemy its own sentence');

  assert.equal(descOf('p1'), PLAIN, 'no step is open, so the tile reads the resting face');
  assert.doesNotMatch(descOf('p1'), /Vulnerable/, 'the resting tile claims no amplification');
  assert.equal(tile('p1').attrs.title, PLAIN, 'the tooltip is the same sentence');
  assert.doesNotMatch(tile('p1').attrs['aria-label'], /Vulnerable/, 'so is the spoken label');
});

test('entering the step aims at the first living enemy: a healthy neighbour reads resting', async () => {
  const api = await startFight();
  tile('p1').dispatch('click');
  assert.equal(api.pendingSlot, 'p1', 'the card is waiting for a target');
  assert.equal(api.aimed, 1, 'the step opens on the first living enemy');
  // That enemy's own variant IS the resting sentence, which is why the swap is invisible here.
  assert.equal(api.snapGet().hand[0].descriptionsByTarget['1'], PLAIN, 'the healthy neighbour prints the resting face');
  assert.equal(descOf('p1'), PLAIN, 'aiming at a healthy enemy changes nothing');
});

test("aiming at the Vulnerable enemy swaps the tile's sentence, title and label", async () => {
  const api = await startFight();
  tile('p1').dispatch('click');
  assert.equal(api.pendingSlot, 'p1');
  // A real hover on the enemy card — the path setAimed() is wired to, not a direct call.
  enemyTiles()[1].dispatch('mouseenter');
  assert.equal(api.aimed, 2, 'the mouseenter moved the aim to the second living enemy');

  assert.equal(descOf('p1'), VULN_9, 'the tile speaks the aimed enemy sentence — amplified number included');
  assert.equal(api.snapGet().hand[0].descriptionsByTarget[api.aimed], VULN_9, 'the key the GUI holds is the key the kernel published');
  assert.equal(tile('p1').attrs.title, VULN_9, 'the tooltip follows the same fold');
  assert.match(tile('p1').attrs['aria-label'], new RegExp(VULN_9.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'a screen reader hears the folded sentence too');

  // The crosshair moving back must move the sentence back: the aim is not a one-way latch.
  api.setAimed(1);
  assert.equal(descOf('p1'), PLAIN, 'aiming away restores the resting face');
});

test('only the waiting tile folds: a second copy of the card keeps the resting face', async () => {
  const api = await startFight(2);
  assert.equal(api.snapGet().hand.length, 2, 'two cards are dealt');
  tile('p1').dispatch('click');
  enemyTiles()[1].dispatch('mouseenter');
  assert.equal(descOf('p1'), VULN_9, 'the pending tile folds');
  assert.equal(descOf('p2'), PLAIN, 'the card that is not waiting for a target does not');
  assert.doesNotMatch(tile('p2').attrs.title, /Vulnerable/, 'nor does its tooltip');
});

test('leaving the step puts the resting sentence back', async () => {
  const api = await startFight();
  tile('p1').dispatch('click');
  enemyTiles()[1].dispatch('mouseenter');
  assert.equal(descOf('p1'), VULN_9, 'aimed and folded');
  api.cancelTargeting();
  assert.equal(api.pendingSlot, null, "Escape's path left the step");
  assert.equal(api.aimed, null, 'and dropped the aim');
  assert.equal(descOf('p1'), PLAIN, 'the tile is back to the resting face');
  assert.equal(tile('p1').attrs.title, PLAIN, 'and so is the tooltip');
});

test('the number the tile previews is the number the play lands', async () => {
  const api = await startFight();
  tile('p1').dispatch('click');
  enemyTiles()[1].dispatch('mouseenter');
  // The owner's scenario: the preview promises 9 against the Vulnerable one...
  assert.equal(descOf('p1'), VULN_9);
  const before = api.snapGet().enemies.map((e) => e.hp);
  // ...and clicking that enemy is what resolves it.
  enemyTiles()[1].dispatch('click');
  assert.equal(api.pendingSlot, null, 'the pick closed the step');
  const after = api.snapGet().enemies.map((e) => e.hp);
  assert.equal(before[1] - after[1], 9, 'the Vulnerable enemy took the previewed 9');
  assert.equal(before[0] - after[0], 0, 'the healthy neighbour was not touched');
});

/* ------------------------------------------------- PARITY-2b: the aimed chip swap */
//
// On a fully chip-covered card the sentence is hidden, so the fold preview MUST move the
// chip's number too — the crosshair's whole point. The kernel publishes `chipsByTarget`
// keyed like the sentence variants; the pending tile swaps the row exactly as it swaps
// `aimedDesc`.

test('the aimed chip swaps to the amplified number with the sentence', async () => {
  const api = await startFight();
  // At rest (two enemies alive, none aimed): the resting printed 6.
  const chipNum = () => tile('p1')._all().find((n) => n.classList.contains('cfx-num')).txt;
  assert.equal(chipNum(), '6', 'the resting chip reads the printed 6');
  tile('p1').dispatch('click');
  enemyTiles()[1].dispatch('mouseenter');
  assert.equal(api.aimed, 2);
  assert.equal(chipNum(), '9', 'the crosshair\u2019s chip says 9 — the fold is visible on a covered card');
  api.setAimed(1);
  assert.equal(chipNum(), '6', 'aiming at the healthy neighbour restores the resting chip');
});
