// EFFECT CHIPS ON THE COLLECTION SHEETS: the real deckPanel() and codexPanel() modals
// must paint the same kernel-published chip row the hand does.
//
// The gap this file exists for: the first chip round pinned the hand, reward and shop
// rows through crafted inputs, but never drove the REAL sheet/codex modals — and the
// tile builders in hud.js (deckTile/codexTile) assemble cardTile's input by hand, so a
// field they forgot to pass through silently rendered chip-less tiles on two whole
// surfaces while every harness test stayed green. These tests open the REAL panels and
// pin:
//   * a Hammerfall deck-sheet tile shows its damage chip (6);
//   * a RED-HOT Hammerfall row shows the TEMPERED number (9) — the chip list is the
//     tempered definition's, like the row's sentence;
//   * a codex tile (Bellows) shows its strength chip (+2);
//   * the read-only chip is still a real control on these tiles (role=button, tabbable).

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
}
function m(n, sel) {
  const a = /^\[data-([a-z-]+)="([^"]*)"\]$/.exec(sel);
  if (a) return n.attrs[`data-${a[1]}`] === a[2];
  if (sel.startsWith('.')) return n._cls.split(/\s+/).includes(sel.slice(1));
  return n.tag === sel;
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
// The REAL modal builders are exported from the bundle scope: these tests must drive the
// panels the player actually opens, not hand-fed cardTile inputs (the exact gap that let
// the deck sheet and codex render chip-less while the first round's tests passed).
let src = body;
src += '\nreturn { render, snapNow: () => snap, cardTile, deckPanel, codexPanel, rewardView, shopView };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
  ${src}
`);

/** A fresh run at the map phase, frozen: the deck sheet reads `state.deck` in any phase. */
const bootRun = ctlMod.createController({ run: { seed: 11 } });
const MAP_STATE = JSON.parse(JSON.stringify(bootRun.state));
assert.equal(MAP_STATE.phase, 'map', 'the fixture is a map-phase run');
const strikeUids = MAP_STATE.deck.filter((c) => c.cardId === 'strike').map((c) => c.uid);
assert.ok(strikeUids.length >= 1, 'the starting deck holds at least one Hammerfall to temper');

/** LOCAL lookups only: this harness's querySelector falls back to a document-wide search,
 *  which would let a sibling tile's fields leak into the assertions. */
const localFind = (node, sel) => node._all().find((n) => m(n, sel)) ?? null;
const tilesOf = (panelRoot) => panelRoot._all().filter((n) => n.classList.contains('card'));
const tileByName = (panelRoot, name) => tilesOf(panelRoot).find((t) => localFind(t, '.cname').txt === name);
const chipsOf = (tile) => {
  const row = localFind(tile, '.cfx');
  return row ? row.kids.filter((k) => k.classList.contains('cfx-chip')) : [];
};
const chipNums = (tile) => chipsOf(tile).map((c) => c.querySelector('.cfx-num').txt);

const HELP_SEEN_KEY = 'dlb.helpSeen.v1';

/**
 * Boot the surface on a map-phase run; `over` may add run-state fields (e.g. `tempers`)
 * before the controller snapshots it.
 */
function bootSheet(over = {}) {
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const state = { ...JSON.parse(JSON.stringify(MAP_STATE)), ...over };
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  return factory(ctl, importedModules);
}

test('the real deck sheet paints Hammerfall its damage chip', () => {
  const api = bootSheet();
  const panel = api.deckPanel();
  assert.ok(Boolean(localFind(panel, '.deck-modal')), 'the REAL deck panel builder ran');
  const tile = tileByName(panel, 'Hammerfall');
  assert.ok(tile, 'a Hammerfall tile is painted');
  assert.deepEqual(chipNums(tile), ['6'], 'the damage chip reads the printed 6');
  const chip = chipsOf(tile)[0];
  assert.equal(chip.attrs.role, 'button', 'a read-only tile\u2019s chip is a real control');
  assert.equal(chip.attrs.tabindex, '0', 'the chip is keyboard-reachable');
  assert.match(chip.attrs['aria-label'], /^Deal 6 damage\.$/, 'the chip announces the kernel sentence');
  assert.ok(chip.attrs.title.startsWith('Deal 6 damage.'), 'the title carries the same sentence');
  // The class-list fact the live check asked for: the chip mark is ON the tile.
  assert.ok(chip.classList.contains('cfx-chip') && Boolean(localFind(chip, '.cfx-mark')),
    'the tile carries a .cfx-chip with its woodcut mark');
});

test('a RED-HOT deck row chips the TEMPERED number, like its sentence', () => {
  const api = bootSheet({ tempers: { [strikeUids[0]]: 'redhot' } });
  const panel = api.deckPanel();
  const hot = tilesOf(panel).find((t) => t.classList.contains('tempered'));
  assert.ok(hot, 'a tempered tile is painted with its trim');
  assert.equal(localFind(hot, '.cname').txt, 'Hammerfall', 'the tempered copy is a Hammerfall');
  assert.deepEqual(chipNums(hot), ['9'],
    'the Red-hot row\u2019s damage chip says the tempered 9 (snapshotDeck\u2019s tempered chip list)');
  const plain = tileByName(panel, 'Hammerfall');
  assert.deepEqual(chipNums(plain), ['6'], 'the untempered copies keep the printed 6');
});

test('the real codex modal paints its tiles the same chips', () => {
  const api = bootSheet();
  const panel = api.codexPanel();
  assert.ok(Boolean(localFind(panel, '.codex-modal')), 'the REAL codex panel builder ran');
  const bellows = tileByName(panel, 'Bellows');
  assert.ok(bellows, 'the codex lists Bellows (a draft-pool common)');
  assert.deepEqual(chipNums(bellows), ['+2'], 'the codex tile\u2019s strength chip reads +2');
  assert.match(chipsOf(bellows)[0].attrs.title,
    /your attacks deal 2 more damage/, 'the chip title is the kernel sentence');
  const kiln = tileByName(panel, 'Kiln Cry');
  assert.ok(kiln, 'the codex lists Kiln Cry');
  assert.deepEqual(chipNums(kiln), ['+1', '1'], 'the codex tile shows Draw +1 and Discard 1');
  // And a fully covered tile drops the sentence here too — the same face everywhere.
  assert.ok(!localFind(bellows, '.cdesc'), 'the covered codex tile drops the visible sentence');
  assert.match(bellows.attrs['aria-label'], /Gain 2 Strength/, 'the sentence stays in its aria-label');
});

test('the real reward screen paints its tiles the same chips', () => {
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const state = {
    ...JSON.parse(JSON.stringify(MAP_STATE)),
    phase: 'reward',
    reward: { cards: ['flex', 'warcry'], relicOffers: [], boss: false, gold: 10 },
  };
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  const api = factory(ctl, importedModules);
  const view = api.rewardView();
  const bellows = tileByName(view, 'Bellows');
  assert.ok(bellows, 'the reward tile for Bellows is painted');
  assert.deepEqual(chipNums(bellows), ['+2'], 'the reward tile\u2019s strength chip rides the snapshot row');
  const kiln = tileByName(view, 'Kiln Cry');
  assert.deepEqual(chipNums(kiln), ['+1', '1'], 'Draw +1 and Discard 1 on the reward face too');
});

test('the real shop screen paints its shelves and its removal tiles the same chips', () => {
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const state = {
    ...JSON.parse(JSON.stringify(MAP_STATE)),
    phase: 'shop',
    shop: { offers: [{ cardId: 'flex', price: 45 }], removal: { price: 75, sold: false, done: false }, removing: false },
  };
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  const api = factory(ctl, importedModules);
  const shelfTile = tileByName(api.shopView(), 'Bellows');
  assert.ok(shelfTile, 'the shelf tile for Bellows is painted');
  assert.deepEqual(chipNums(shelfTile), ['+2'], 'the shelf\u2019s chip rides the offer row');
  // The removal step lists deck INSTANCES — the tempered rule lives there too.
  const removing = {
    ...state,
    shop: { ...state.shop, offers: [], removing: true },
  };
  const ctl2 = ctlMod.createController({ session: { state: { ...removing, tempers: { [strikeUids[0]]: 'redhot' } }, submitted: [], events: [] } });
  const api2 = factory(ctl2, importedModules);
  const hot = tilesOf(api2.shopView()).find((t) => t.classList.contains('tempered'));
  assert.ok(hot, 'the removal list paints the tempered copy');
  assert.deepEqual(chipNums(hot), ['9'], 'the Red-hot removal tile chips the tempered 9');
});
