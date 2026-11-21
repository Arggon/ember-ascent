// CARD EFFECT CHIPS: every card face carries one icon+number chip per kernel-published
// effect, clicking a chip explains it with the KERNEL's own sentence, and clicking a chip
// NEVER plays the card.
//
// WHAT THIS PINS, against the REAL surface code driven by the fake-DOM harness:
//   * Bellows (bellows) paints ONE strength chip reading "+2" and, because the kernel says
//     the chips say the whole card (`chipsComplete`), its long sentence leaves the face —
//     but stays in the tile's title and aria-label;
//   * Kiln Cry (kiln_cry) paints Draw +1 and Discard 1;
//   * a `custom` card (Vein Tap) paints NO chip and KEEPS its visible sentence;
//   * clicking the strength chip opens the kernel Strength sentence on the fx layer and
//     stops the click from reaching the play button (the hand keeps all its cards);
//   * Escape closes the popover, and an outside pointer-down closes it too;
//   * on a READ-ONLY tile (a div) the chip is a real control: role=button, tabindex,
//     Enter opens the same explainer.
//
// A regression that derived chips in the web layer, played the card on a chip click, or
// left the popover un-closable fails here — each by a named assertion below.

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
  focus() { this.focused = true; }
}
function m(n, sel) {
  const a = /^\[data-([a-z-]+)="([^"]*)"\]$/.exec(sel);
  if (a) return n.attrs[`data-${a[1]}`] === a[2];
  if (sel.startsWith('.')) return n._cls.split(/\s+/).includes(sel.slice(1));
  return n.tag === sel;
}

const root = new N('body');
const byId = {};
// `fx-layer` is the chip explainer's host (a #stage sibling render() never clears); the
// test host must carry it or the popover would refuse to open here.
for (const id of ['hud', 'stage', 'toast', 'live', 'app', 'fx-layer']) { const d = new N('div'); d._cls = id; byId[id] = d; root.append(d); }
// The document-level Escape / outside-pointerdown listeners are registered by the surface
// module itself; the host records them so a test can fire them the way a browser would.
const docHandlers = {};
globalThis.document = {
  getElementById: (id) => byId[id] ?? null,
  createElement: (t) => new N(t),
  createTextNode: (t) => { const n = new N('#text'); n.txt = String(t); return n; },
  querySelector: (s) => root.querySelector(s),
  querySelectorAll: (s) => root.querySelectorAll(s),
  addEventListener: (t, fn) => { (docHandlers[t] ||= []).push(fn); },
  documentElement: { setAttribute: () => {} },
  body: root,
};
globalThis.window = { addEventListener: () => {}, location: { search: '' } };
globalThis.location = { search: '' };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
globalThis.requestAnimationFrame = () => 0;

import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleApp } from '../web/app-bundle.mjs';

const appUrl = new URL('../../src/web/app.js', import.meta.url);
const { prelude, body, mods: importedModules } = await bundleApp(appUrl, { stubController: true });
// `cardTile` is exported too, so the read-only tile's own contract is testable in
// isolation without standing up the codex/deck/shop panels around it.
let src = body;
src += '\nreturn { render, snapNow: () => snap, cardTile };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
  ${src}
`);

/** One real first fight, frozen: seed 11 steps onto its first node and lands in combat. */
const bootRun = ctlMod.createController({ run: { seed: 11 } });
bootRun.dispatch('n1');
const FIRST_FIGHT = JSON.parse(JSON.stringify(bootRun.state));
assert.equal(bootRun.snapshot().phase, 'combat', 'the reference run opens on a fight');

const HELP_SEEN_KEY = 'dlb.helpSeen.v1';

/**
 * Boot the surface on the reference fight with the hand crafted to hold the three cards
 * the spec names: Bellows (bellows), Kiln Cry (kiln_cry) and a custom-only card (Vein Tap).
 * The controller is the real one; the chip lists and sentences on the tiles are still the
 * kernel's, through the controller's own snapshot().
 */
function startCombat() {
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const state = JSON.parse(JSON.stringify(FIRST_FIGHT));
  state.combat = {
    ...state.combat,
    hand: [
      { uid: 't1', cardId: 'bellows', cost: 0 },
      { uid: 't2', cardId: 'kiln_cry', cost: 0 },
      { uid: 't3', cardId: 'vein_tap', cost: 0 },
    ],
  };
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  const api = factory(ctl, importedModules);
  assert.equal(api.snapNow().phase, 'combat', 'the crafted state still reads as the fight');
  return api;
}

/** The painted hand tiles, in hand order. */
function handTiles() {
  return byId.stage.querySelectorAll('.card').filter((t) => t.parent && t.parent.classList.contains('card-wrap'));
}
// LOCAL lookups only: this harness's querySelector falls back to a document-wide search
// when a node has no local hit, which would let a SIBLING tile's .cdesc/.cfx leak into
// these assertions and make the "sentence dropped / chips absent" checks vacuous.
const localFind = (tile, sel) => tile._all().find((n) => m(n, sel)) ?? null;
const tileByName = (name) => handTiles().find((t) => localFind(t, '.cname').txt === name);
const chipsOf = (tile) => {
  const row = localFind(tile, '.cfx');
  return row ? row.kids.filter((k) => k.classList.contains('cfx-chip')) : [];
};
const hasDesc = (tile) => Boolean(localFind(tile, '.cdesc'));
// The explainer hosts in #pop-layer (its own always-visible layer — #fx-layer is
// display:none under reduced motion), created lazily and appended to the body, so the
// popover is found from the document root, not from a fixed host node.
const pop = () => root.querySelector('.cfx-pop');

test('Bellows paints one Strength +2 chip and its long sentence leaves the visible face', () => {
  const api = startCombat();
  api.render();
  const tile = tileByName('Bellows');
  assert.ok(tile, 'the Bellows tile is painted');
  const chips = chipsOf(tile);
  assert.equal(chips.length, 1, 'exactly one chip for its one status effect');
  const chip = chips[0];
  assert.equal(chip.querySelector('.cfx-num').txt, '+2', 'the Strength chip reads +2');
  assert.ok(chip.querySelector('.cfx-mark'), 'the chip carries its mark');
  assert.equal(chip.attrs.title, 'Strength — your attacks deal 2 more damage. Lasts the whole fight. Added to every attack you play.',
    'the chip title is the kernel sentence verbatim (the no-JS/hover fallback)');
  assert.ok(!hasDesc(tile), 'a fully chip-covered card drops the visible sentence');
  // …but the sentence survives where screen readers and hovers read it.
  assert.match(tile.attrs['aria-label'], /Gain 2 Strength/, 'the full sentence stays in the aria-label');
  assert.match(tile.attrs.title, /Gain 2 Strength/, 'the full sentence stays in the tile title');
});

test('Kiln Cry paints Draw +1 and Discard 1; the custom card keeps its sentence and no chips', () => {
  const api = startCombat();
  api.render();
  const wc = chipsOf(tileByName('Kiln Cry'));
  assert.deepEqual(wc.map((c) => c.querySelector('.cfx-num').txt), ['+1', '1'],
    'the draw reads as a gain (+1), the discard as a plain cost');
  const blTile = tileByName('Vein Tap');
  assert.ok(blTile, 'the custom-only card (Vein Tap, face name Vein Tap) is painted');
  assert.equal(chipsOf(blTile).length, 0, 'a custom-only card claims no generic icon');
  const desc = localFind(blTile, '.cdesc');
  assert.ok(desc, 'the custom card KEEPS its visible sentence');
  // keywordText splits the sentence across keyword spans and text nodes, so read the
  // node's full descendant text rather than its (unset) textContent.
  const descText = desc._all().map((k) => k.txt || '').join('');
  assert.match(descText, /Lose 3 HP/, 'the sentence is the kernel describeCard one');
});

test('clicking the Strength chip explains it with the kernel sentence and NEVER plays the card', () => {
  const api = startCombat();
  api.render();
  const chip = chipsOf(tileByName('Bellows'))[0];
  let swallowed = false;
  chip._ls.click[0]({ target: chip, stopPropagation: () => { swallowed = true; } });
  assert.ok(swallowed, 'the chip click stops propagation — the play click dies on the chip');
  const sheet = pop();
  assert.ok(sheet, 'the explainer popover opened');
  assert.ok(sheet.querySelector('.cfx-pop-close').focused, 'focus moved into the popover (its Close button)');
  assert.equal(sheet.querySelector('.cfx-pop-label').txt, 'Strength', 'the popover titles with the kernel label');
  assert.match(sheet.querySelector('.cfx-pop-body').txt, /your attacks deal 2 more damage/,
    'the popover body is the kernel Strength sentence');
  // The play click is gone: the same hand is still the same hand, still in combat.
  assert.equal(api.snapNow().hand.length, 3, 'all three cards are still in the hand');
  assert.equal(api.snapNow().phase, 'combat', 'the fight did not advance — nothing was played');
  // Clicking the same chip again toggles the popover closed — and hands focus back.
  chip._ls.click[0]({ target: chip, stopPropagation: () => {} });
  assert.equal(pop(), null, 'a second click on the same chip closes its popover');
  assert.ok(chip.focused, 'focus was restored to the chip the popover came from');
});

test('a REAL dismissal sequence on a hand card closes the popover and never plays the card', () => {
  const api = startCombat();
  api.render();
  chipsOf(tileByName('Bellows'))[0]._ls.click[0]({ target: null, stopPropagation: () => {} });
  assert.ok(pop(), 'the popover is open');
  // The full browser sequence on a DIFFERENT hand card: press (pointerdown) then the
  // click it produces. The press closes the popover and arms the swallow window; the
  // click — EXEMPT from pointerdown cancellation per the Pointer Events spec — is
  // stopped in capture, so the play button underneath never hears it.
  const card = tileByName('Kiln Cry');
  let clickStopped = false;
  for (const fn of docHandlers.pointerdown || []) fn({ target: card });
  for (const fn of docHandlers.click || []) {
    fn({ target: card, stopPropagation: () => { clickStopped = true; }, preventDefault: () => {} });
  }
  assert.ok(clickStopped, 'the tap\u2019s click was stopped before reaching the play button');
  assert.equal(pop(), null, 'the popover is closed by the dismissal');
  assert.equal(api.snapNow().hand.length, 3, 'the hand kept every card — nothing was played');
  assert.equal(api.snapNow().phase, 'combat', 'the fight did not advance');
});

test('Escape closes the popover', () => {
  const api = startCombat();
  api.render();
  chipsOf(tileByName('Bellows'))[0]._ls.click[0]({ target: null, stopPropagation: () => {} });
  assert.ok(pop(), 'the popover is open before the keypress');
  const handlers = docHandlers.keydown || [];
  assert.ok(handlers.length > 0, 'the surface registered its document-level key handler');
  for (const fn of handlers) fn({ key: 'Escape' });
  assert.equal(pop(), null, 'Escape closed the explainer');
});

test('a pointer-down outside the popover closes it, and the click it produces is swallowed', () => {
  const api = startCombat();
  api.render();
  chipsOf(tileByName('Bellows'))[0]._ls.click[0]({ target: null, stopPropagation: () => {} });
  assert.ok(pop(), 'the popover is open');
  // A REAL dismissal sequence: pointerdown closes and arms the swallow, then the click
  // the press produces is stopped in capture. Per the Pointer Events spec `click` is
  // EXEMPT from pointerdown cancellation — a swallow on pointerdown alone would still
  // let the tap through, which is exactly the double-fire this sequence pins shut.
  let clickStopped = false;
  for (const fn of docHandlers.pointerdown || []) {
    fn({ target: byId.hud });
  }
  assert.equal(pop(), null, 'the outside pointer-down closed the explainer');
  for (const fn of docHandlers.click || []) {
    fn({ target: byId.hud, stopPropagation: () => { clickStopped = true; }, preventDefault: () => {} });
  }
  assert.ok(clickStopped, 'the dismissal click was stopped in capture before any card handler');
  // A pointer-down ON the popover's own surface is let through (its Close button works).
  chipsOf(tileByName('Bellows'))[0]._ls.click[0]({ target: null, stopPropagation: () => {} });
  const sheet = pop();
  assert.ok(sheet, 'the popover reopened');
  const closeBtn = sheet.querySelector('.cfx-pop-close');
  closeBtn._ls.click[0]({ stopPropagation: () => {} });
  assert.equal(pop(), null, 'the popover Close button works');
});

test('on a read-only tile the chip is a real control: role=button, tabbable, Enter explains', () => {
  const api = startCombat();
  const explain = 'Strength — your attacks deal 2 more damage. Lasts the whole fight. Added to every attack you play.';
  const tile = api.cardTile({
    cardId: 'bellows', name: 'Bellows', cost: 0, type: 'skill', typeLabel: 'Skill',
    description: 'Gain 2 Strength — your attacks deal 2 more damage.', summary: 'PWR+2',
    chips: [{ verb: 'status', status: 'strength', amount: 2, num: '+2', label: 'Strength', explain }],
    chipsComplete: true,
    slot: 's1',
  }, { readOnly: true });
  const chip = tile.querySelector('.cfx-chip');
  assert.ok(chip, 'the read-only tile paints its chip');
  assert.equal(chip.attrs.role, 'button', 'the chip is a real interactive element');
  assert.equal(chip.attrs.tabindex, '0', 'the chip is reachable by keyboard');
  assert.equal(chip.attrs['aria-label'], explain, 'the chip announces the kernel sentence');
  chip._ls.keydown[0]({ key: 'Enter', preventDefault: () => {} });
  assert.ok(pop(), 'Enter opened the explainer');
  assert.equal(pop().querySelector('.cfx-pop-body').txt, explain);
  assert.ok(pop().querySelector('.cfx-pop-close').focused, 'focus lands in the popover on open');
  for (const fn of docHandlers.keydown || []) fn({ key: 'Escape' });
  assert.equal(pop(), null, 'Escape still closes it');
  assert.ok(chip.focused, 'focus returns to the read-only chip on close');
  assert.ok(!hasDesc(tile), 'the covered read-only tile drops the sentence too');
});
