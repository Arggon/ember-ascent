// THE EVENT'S RESOLVED CARD REVEAL + THE HUD'S COMBAT-ONLY BELT, on the REAL surface.
//
// Two contracts pinned here through the app bundle (the fake-DOM harness):
//
//   * the resolved beat's card reveal: a line whose kernel-published `cards` ref names a
//     card renders the beat sentence as a CAPTION above a read-only card TILE (name +
//     chip row, the codex tile's own describe path; a tempered beat wears the deck
//     sheet's trim and forged stamp), while lines without a card stay plain text;
//   * the HUD's top bar: the potion belt renders in COMBAT only (its functional home —
//     the kernel offers belt actions there alone), and the relic readout chip is GONE in
//     every phase (relics act through hooks, never clicks; nothing functional is lost).
//
// The states are REAL kernel runs (a fresh walk into the row-2 event), with the resolved
// beat crafted on the standing state the way the save-lever tests do — the snapshot then
// renders the beat through the kernel's own renderEventLines/beatCards, so every word on
// screen is kernel wording.

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

/** LOCAL lookups only: this harness's querySelector falls back to a document-wide search,
 *  which would let a sibling row's fields leak into the assertions. */
const localFind = (node, sel) => node._all().find((n) => m(n, sel)) ?? null;

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
import { loadKernel } from '../helpers/harness.mjs';

const appUrl = new URL('../../src/web/app.js', import.meta.url);
const { prelude, body, mods: importedModules } = await bundleApp(appUrl, { stubController: true });
// The view and HUD builders under test, exported from the bundle scope. The boot paint
// already ran by factory time (app.js), so `snap` holds the booted controller's snapshot.
let src = body;
src += '\nreturn { snapNow: () => snap, eventView, restView, renderHud };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
  ${src}
`);

const K = await loadKernel();
const HELP_SEEN_KEY = 'dlb.helpSeen.v1';

/** A REAL run standing at the row-2 event (any story): walk one node in. */
function eventState() {
  for (let seed = 0; seed < 60; seed += 1) {
    const base = K.newRun({ seed });
    const staged = { ...base, floor: 1, mapNodeId: 'r1n0' };
    const travel = K.actions(staged).find((a) => a.nodeType === 'event');
    if (!travel) continue;
    const out = K.step(staged, travel.id);
    if (out.error === null && out.state.event) return JSON.parse(JSON.stringify(out.state));
  }
  throw new Error('no walk reached the row-2 event');
}

/** Boot the surface on a crafted state and hand back the bundle's exports. */
function bootOn(state) {
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1'; // a RETURNING player: no Help sheet over the stage
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  return factory(ctl, importedModules);
}

/** A REAL smith modal: a run with tempers opt-in walks into the row-2 wayside until it
 *  is the smith, then opens the committed modal with the kernel's own offer roll. */
function smithModalState() {
  for (let seed = 0; seed < 60; seed += 1) {
    const base = K.newRun({ seed, tempers: true });
    const staged = { ...base, floor: 1, mapNodeId: 'r1n0' };
    const travel = K.actions(staged).find((a) => a.nodeType === 'event');
    if (!travel) continue;
    const visit = K.step(staged, travel.id);
    if (visit.error !== null || visit.state.event?.id !== 'wandering_smith') continue;
    const open = K.step(visit.state, 'v1'); // the temper choice opens the modal
    if (open.error === null && open.state.event?.tempering && open.state.event.offers.length >= 2) {
      return JSON.parse(JSON.stringify(open.state));
    }
  }
  throw new Error('no walk opened the smith\u2019s modal');
}

/** The event list's <li> rows, in beat order. */
const resultRows = (view) => view.querySelectorAll('li').filter((li) => li.classList.contains('has-card') || !li.classList.contains('kw'));

test('the resolved beat renders the card as a TILE under its sentence, and the rest as plain text', () => {
  const state = eventState();
  state.event.resolved = {
    choice: 1,
    lines: [
      { slug: 'toll', who: { en: 'forge', es: 'La forja' }, n: 8 },
      { slug: 'card_joined', cardId: 'strike' },
    ],
  };
  const api = bootOn(state);
  assert.equal(api.snapNow().phase, 'event', 'the crafted state stands at the resolved beat');
  const view = api.eventView();
  const result = localFind(view, '.event-result');
  assert.ok(result, 'the resolved beat paints its result list');
  const rows = result.kids;
  assert.equal(rows.length, 2, 'one row per beat line');
  // Row 0 — a toll line: plain text, no tile.
  assert.equal(rows[0].txt, 'The forge took its due: 8 HP.', 'the non-card line stays a plain sentence');
  assert.equal(localFind(rows[0], '.card'), null, 'the toll row carries no tile');
  // Row 1 — the card beat: the sentence stays as the CAPTION, the card shows as a
  // read-only tile with its name and kernel chip row.
  assert.ok(rows[1].classList.contains('has-card'), 'the card line is marked');
  const caption = localFind(rows[1], '.event-card-caption');
  assert.equal(caption.txt, 'The coals give up a card: Hammerfall joins your deck.',
    'the beat sentence survives as the caption');
  const tile = localFind(localFind(rows[1], '.event-cards'), '.card');
  assert.ok(tile, 'the card renders as a tile inside the .event-cards row');
  assert.equal(localFind(tile, '.cname').txt, 'Hammerfall', 'the tile names the card');
  assert.ok(tile.attrs['data-slot']?.startsWith('event-'), 'the read-only tile wears an event slot key');
  assert.ok(localFind(tile, '.cfx'), 'the tile carries a chip row');
  const chips = localFind(tile, '.cfx').kids.filter((k) => k.classList.contains('cfx-chip'));
  assert.ok(chips.length >= 1, `the kernel chips are on the tile (${chips.length})`);
  assert.equal(chips[0].attrs.role, 'button', 'the chip is a real control (the shared popover path)');
  assert.match(tile.attrs.title ?? '', /Deal 6 damage/, 'the tile tooltip carries the kernel sentence');
  // Read-only: a labelled div, never the hand's disabled affordance, never a button.
  assert.equal(tile.tag, 'div', 'the tile is a readout div');
  assert.equal(tile.attrs.role, 'group', 'the readout announces as a group, not a button');
});

test('a tempered beat wears the deck sheet\u2019s trim and forged stamp', () => {
  const state = eventState();
  state.event.resolved = {
    choice: null,
    lines: [{ slug: 'temper_done', cardId: 'strike', temper: 'redhot' }],
  };
  const api = bootOn(state);
  const view = api.eventView();
  const row = localFind(view, '.has-card');
  assert.ok(row, 'the temper line is a card row');
  assert.equal(localFind(row, '.event-card-caption').txt,
    'The smith takes strike to the anvil. It comes back changed.',
    'the beat sentence (the en column\u2019s raw-id form) stays the caption');
  const tile = localFind(localFind(row, '.event-cards'), '.card');
  assert.ok(tile, 'the tempered card renders as a tile');
  assert.ok(tile.classList.contains('tempered') && tile.classList.contains('temper-redhot'),
    'the tile wears the temper trim');
  const stamp = localFind(tile, '.ctemper');
  assert.ok(stamp, 'the forged stamp is on the tile');
  assert.match(stamp.attrs.title ?? '', /Red-hot/i, 'the stamp\u2019s tooltip is the kernel\u2019s own temper sentence');
  assert.match(tile.attrs['aria-label'] ?? '', /Red-hot/i, 'the temper sentence is announced too');
  // B2 on this screen too: the tile's face is the TEMPERED one (beatCards' synthetic
  // def) — the Red-hot Hammerfall chips the 9 it deals, not the base card's 6.
  const hotChips = localFind(tile, '.cfx').kids.filter((k) => k.classList.contains('cfx-chip'));
  assert.deepEqual(hotChips.map((c) => c.querySelector('.cfx-num').txt), ['9'],
    'the tempered face\u2019s chip list rides the ref, not the base card');
});

test('the tempered face is the tile\u2019s face: the Quenched Quench tile shows BOTH block chips', () => {
  const state = eventState();
  state.event.resolved = {
    choice: null,
    lines: [{ slug: 'temper_done', cardId: 'defend', temper: 'quenched' }],
  };
  const api = bootOn(state);
  const view = api.eventView();
  const row = localFind(view, '.has-card');
  assert.ok(row, 'the temper line is a card row');
  const tile = localFind(localFind(row, '.event-cards'), '.card');
  assert.ok(tile, 'the tempered card renders as a tile');
  assert.ok(tile.classList.contains('tempered') && tile.classList.contains('temper-quenched'),
    'the tile wears the Quenched trim');
  const chips = localFind(tile, '.cfx').kids.filter((k) => k.classList.contains('cfx-chip'));
  assert.deepEqual(chips.map((c) => c.querySelector('.cfx-num').txt), ['5', '3'],
    'both block chips — the base 5 AND the temper\u2019s 3 (the engine resolves 8)');
  assert.match(tile.attrs['aria-label'] ?? '', /Gain 3 Block/,
    'the tempered sentence is announced with the temper\u2019s gain too');
});

test('an unknown card id degrades to a raw-id tile, never a crash', () => {
  const state = eventState();
  state.event.resolved = {
    choice: null,
    lines: [{ slug: 'card_joined', cardId: 'deleted_card' }],
  };
  const api = bootOn(state);
  const view = api.eventView();
  const row = localFind(view, '.has-card');
  assert.ok(row, 'the card line still renders');
  const tile = localFind(localFind(row, '.event-cards'), '.card');
  assert.ok(tile, 'a tile renders even for an id the content no longer knows');
  assert.equal(localFind(tile, '.cname').txt, 'deleted_card', 'the raw id stands in as the name');
  assert.equal(localFind(tile, '.cfx'), null, 'no chips for a card the describe layer cannot read');
});

test('the smith\u2019s modal renders clickable tempered tiles, and a click commits the pick', () => {
  const state = smithModalState();
  const api = bootOn(state);
  assert.equal(api.snapNow().phase, 'event', 'the crafted state stands at the modal');
  // The SNAPSHOT's offer rows are the contract (actionId + tempered face), not the raw
  // stored state — the tiles read what the kernel published.
  const offers = api.snapNow().event.offers;
  const view = api.eventView();
  const list = localFind(view, '.temper-list');
  assert.ok(list, 'the modal paints its offer row');
  const tiles = list.kids.filter((k) => k.classList.contains('card'));
  assert.equal(tiles.length, offers.length, 'one TILE per offer — no text-only button left');
  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i];
    const offer = offers[i];
    assert.equal(tile.tag, 'button', 'the pick tile is a real control, not the readout div');
    assert.equal(tile.attrs['data-action'], offer.actionId, `tile ${i + 1} carries its pick id`);
    assert.ok(tile.classList.contains('tempered') && tile.classList.contains(`temper-${offer.temper}`),
      `tile ${i + 1} wears the tempered trim (${offer.temper})`);
    assert.ok(localFind(tile, '.ctemper'), `tile ${i + 1} wears the forged stamp`);
    assert.ok(localFind(tile, '.cfx'), `tile ${i + 1} carries a chip row`);
    assert.match(tile.attrs['aria-label'] ?? '', new RegExp(`Temper ${offer.cardName}`),
      `tile ${i + 1} keeps the offer aria contract`);
  }
  // COMMIT: a real click on the first tile plays its pick — the modal closes into the
  // resolved beat and the temper lands on the deck instance (the kernel's own record:
  // the deck sheet gains a tempered row, published by snapshotDeck).
  const before = api.snapNow();
  tiles[0]._ls.click[0]({ target: tiles[0] });
  const after = api.snapNow();
  assert.ok(after.event?.resolved, 'the click committed: the resolved beat followed');
  assert.equal(after.event?.tempering, false, 'the modal closed');
  assert.ok(!(before.deckCards ?? []).some((r) => r.tempered), 'nothing tempered before the pick');
  assert.ok((after.deckCards ?? []).some((r) => r.tempered), 'the temper landed on a deck instance');
});

test('the rest site\u2019s forge renders the same clickable tempered tiles', () => {
  const base = K.newRun({ seed: 3, tempers: true });
  const forge = { ...JSON.parse(JSON.stringify(base)), phase: 'rest', temperOffers: [
    { uid: base.deck[0].uid, cardId: 'defend', temper: 'quenched' },
  ] };
  const api = bootOn(forge);
  assert.equal(api.snapNow().phase, 'rest', 'the crafted state stands at the forge');
  const view = api.restView();
  const list = localFind(view, '.temper-list');
  assert.ok(list, 'the forge paints its offer row');
  const tiles = list.kids.filter((k) => k.classList.contains('card'));
  assert.equal(tiles.length, 1, 'one tile per offer');
  const tile = tiles[0];
  assert.equal(tile.tag, 'button', 'the forge pick is a real control too');
  assert.equal(tile.attrs['data-action'], 't1', 'the pick id rides the tile');
  assert.ok(tile.classList.contains('tempered') && tile.classList.contains('temper-quenched'),
    'the tempered trim is on the forge tile');
  const chips = localFind(tile, '.cfx').kids.filter((k) => k.classList.contains('cfx-chip'));
  assert.deepEqual(chips.map((c) => c.querySelector('.cfx-num').txt), ['5', '3'],
    'the forge tile shows the tempered numbers (both blocks)');
  assert.match(tile.attrs['aria-label'] ?? '', /^Temper Quench\./, 'the aria contract holds at the forge');
});

/* ------------------------------------------------------- the HUD: belt and relics */

test('the belt renders in combat only, and no relic chip exists in any phase', () => {
  // MAP: a fresh run's boot phase — no belt (potions are combat items), no relic chip.
  const mapRun = ctlMod.createController({ run: { seed: 11 } });
  const mapApi = factory(mapRun, importedModules);
  assert.equal(mapApi.snapNow().phase, 'map', 'the fresh run boots on the map');
  mapApi.renderHud();
  assert.equal(byId.hud.querySelector('.belt'), null, 'no belt on the map');
  assert.equal(byId.hud.querySelector('.relics'), null, 'no relic chip on the map');

  // COMBAT: the belt's functional home — the row is there, slots and all.
  const fightRun = ctlMod.createController({ run: { seed: 11 } });
  fightRun.dispatch('n1'); // the fresh run's first step opens its first fight
  assert.equal(fightRun.snapshot().phase, 'combat', 'the reference run stands in a fight');
  const fightState = JSON.parse(JSON.stringify(fightRun.state));
  const api = bootOn(fightState);
  assert.equal(api.snapNow().phase, 'combat', 'the crafted state is the fight');
  api.renderHud();
  const belt = byId.hud.querySelector('.belt');
  assert.ok(belt, 'the belt renders in combat');
  const slots = belt.kids.filter((k) => k.classList.contains('belt-slot'));
  assert.equal(slots.length, (api.snapNow().beltSlots ?? 3), 'the belt keeps its slot row');
  assert.equal(byId.hud.querySelector('.relics'), null, 'no relic chip in combat either');
});
