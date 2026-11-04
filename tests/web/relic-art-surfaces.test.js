// RELIC & BOON ART SURFACES: the three treasure surfaces must paint each relic/boon its
// OWN inline-SVG mark — the boss relic offers (large .boon-art), the elite's spoils chip
// (.coin-glyph.boon-glyph) and the kindling boon buttons (.boon-glyph) — with the
// documented fallbacks (unknown relic id -> the generic r-unknown plate on offers / the
// generic `relic` heart on the chip; glyphMarkup's rune under the unknown boon id), and
// the kernel sentences untouched in the aria-labels (the art is decorative).
//
// The gap this file exists for: the art tables (RELIC_GLYPH / BOON_GLYPH in glyphs.js) are
// keyed by kernel id, and the views resolve them from the SNAPSHOT's own ids — a typo'd
// table key, a view that forgets to pass the id through, or a fallback that renders an
// empty box would all stay invisible to the kernel tests. These tests drive the REAL
// rewardView()/kindlingView() builders on doctored states and pin:
//   * every known relic id paints its own DISTINCT offer mark (13 of them, pairwise
//     different markup) with its snapshot tier on the offer frame;
//   * an unknown relic id degrades to r-unknown (offer) / the `relic` heart (chip), never
//     an empty box;
//   * the elite chip is keyed by the relic id (different relic -> different chip mark);
//   * the kindling boons each carry their own chip mark, and the aria-labels still speak
//     the kernel's sentences verbatim.

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
  prepend(...c) { const add = c.filter((x) => x != null); for (let x of add) x.parent = this; this.kids.unshift(...add); }
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
import { RELICS } from '../../src/kernel/rules/relics.js';

const appUrl = new URL('../../src/web/app.js', import.meta.url);
const { prelude, body, mods: importedModules } = await bundleApp(appUrl, { stubController: true });
// The REAL view builders and the art tables, from the bundle scope: these tests must drive
// the views the player actually gets (not hand-fed markup), and compare what they paint
// against what glyphMarkup would emit for the mapped mark.
let src = body;
src += '\nreturn { rewardView, kindlingView, glyphMarkup, RELIC_GLYPH, BOON_GLYPH };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
  ${src}
`);

/** A fresh run at the map phase, frozen: the fixture every doctored phase spreads over. */
const bootRun = ctlMod.createController({ run: { seed: 11 } });
const MAP_STATE = JSON.parse(JSON.stringify(bootRun.state));
assert.equal(MAP_STATE.phase, 'map', 'the fixture is a map-phase run');

const HELP_SEEN_KEY = 'dlb.helpSeen.v1';

/** Boot the surface on a doctored state and hand back the real view api. */
function bootView(over = {}) {
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const state = { ...JSON.parse(JSON.stringify(MAP_STATE)), ...over };
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  return factory(ctl, importedModules);
}

/** The glyph span inside `node` (by class), via LOCAL lookup only. */
const glyphOf = (node, cls) => node._all().find((n) => n.classList.contains(cls)) ?? null;

// The view api, captured once on the plain fixture: the tests compare what the views paint
// against what glyphMarkup emits for the table's own mark.
const api = bootView();
const RELIC_IDS = Object.keys(RELICS).filter((id) => RELICS[id] && RELICS[id].tier);

test('every known relic id paints its own distinct offer mark, with its tier on the frame', () => {
  // All thirteen offers in ONE render: the snapshot maps rows 1:1, so the offer loop is
  // driven across the whole table at once.
  const state = {
    phase: 'reward',
    reward: { boss: true, cards: [], gold: 0, relicOffers: RELIC_IDS },
  };
  const view = bootView(state).rewardView();
  const offers = view._all().filter((n) => n.classList.contains('relic-offer'));
  assert.equal(offers.length, RELIC_IDS.length, `one offer tile per known relic (${RELIC_IDS.length})`);
  const marks = [];
  for (let i = 0; i < offers.length; i += 1) {
    const id = RELIC_IDS[i];
    const art = glyphOf(offers[i], 'boon-art');
    assert.ok(art, `${id}: the offer tile carries a .boon-art span`);
    // The tile paints EXACTLY the table's mark for this id (not a neighbour's, not the
    // fallback) — the art is keyed by the snapshot's own relicId.
    const expected = api.glyphMarkup(api.RELIC_GLYPH[id]);
    assert.equal(art.innerHTML, expected, `${id}: the offer art is RELIC_GLYPH[${id}]'s own mark`);
    marks.push(art.innerHTML);
    // The snapshot's tier rides the FRAME (and only the frame) as a tier-* class.
    const tier = RELICS[id].tier;
    assert.ok(offers[i].classList.contains(`tier-${tier}`), `${id}: the frame wears tier-${tier}`);
    assert.ok(offers[i].classList.contains('boon') && offers[i].classList.contains('relic-offer'),
      `${id}: the boon/relic-offer shell classes are untouched`);
  }
  assert.equal(new Set(marks).size, marks.length, 'every relic paints a DISTINCT mark (no two offers share markup)');
});

test('an unknown relic id degrades to the generic plate (offer) and the generic heart (chip), never an empty box', () => {
  const view = bootView({
    phase: 'reward',
    reward: { boss: true, cards: [], gold: 0, relicOffers: ['not_a_relic', 'burning_blood'] },
  }).rewardView();
  const offers = view._all().filter((n) => n.classList.contains('relic-offer'));
  assert.equal(offers.length, 2, 'both offers still render (the torn one is visible, not dropped)');
  const art = glyphOf(offers[0], 'boon-art');
  assert.equal(art.innerHTML, api.glyphMarkup('r-unknown'), 'the torn offer wears the generic r-unknown plate');
  assert.equal(art.innerHTML.includes('<svg'), true, 'the fallback is real markup, not an empty box');
  const tierClasses = offers[0].className.split(/\s+/).filter((c) => c.startsWith('tier-'));
  assert.deepEqual(tierClasses, [], 'an unknown tier takes the neutral frame (no tier-* class)');
  const knownArt = glyphOf(offers[1], 'boon-art');
  assert.notEqual(knownArt.innerHTML, art.innerHTML, 'the known neighbour still paints its own mark');
  // The raw id is its own name (the kernel's torn-id rule) and the sentence slot stays honest.
  assert.match(offers[0].attrs['aria-label'], /not_a_relic/, 'the offer names the raw id in its aria-label');
});

test('the elite spoils chip is keyed by relicId: each relic chips its own mark, unknown keeps the heart', () => {
  for (const id of ['ash_crown', 'deep_well', 'forge_iron']) {
    const view = bootView({
      phase: 'reward',
      reward: { boss: false, cards: ['flex'], gold: 5, relic: id },
    }).rewardView();
    const chip = view._all().find((n) => n.classList.contains('reward-relic'));
    assert.ok(chip, `${id}: the spoils chip renders`);
    const glyph = glyphOf(chip, 'coin-glyph');
    assert.ok(glyph, `${id}: the chip carries its glyph span`);
    assert.ok(glyph.classList.contains('boon-glyph'), `${id}: the chip glyph is the .boon-glyph mark context`);
    const expected = api.glyphMarkup(api.RELIC_GLYPH[id]);
    assert.equal(glyph.innerHTML, expected, `${id}: the chip is keyed by the relicId (RELIC_GLYPH[${id}])`);
    assert.notEqual(glyph.innerHTML, api.glyphMarkup('relic'), `${id}: the chip is NOT the generic relic heart`);
  }
  const torn = bootView({
    phase: 'reward',
    reward: { boss: false, cards: ['flex'], gold: 5, relic: 'zzz_torn' },
  }).rewardView();
  const chip = torn._all().find((n) => n.classList.contains('reward-relic'));
  const glyph = glyphOf(chip, 'coin-glyph');
  assert.equal(glyph.innerHTML, api.glyphMarkup('relic'), 'an unknown relicId keeps the generic `relic` heart');
});

test('the kindling boons each carry their own chip mark under the kernel sentence', () => {
  // The kernel's BOONS names, in offer order — the aria-label opens with the same words.
  const NAMES = {
    bellows: 'Bellows Breath', ironskin: 'Iron Skin', sparkfall: 'Sparkfall',
    purge: 'Ash Purge', stoke: 'Banked Coals',
  };
  const ids = Object.keys(NAMES);
  const view = bootView({
    phase: 'kindling',
    stepIndex: 1,
    kindling: { offers: ids },
  }).kindlingView();
  const buttons = view._all().filter((n) => n.classList.contains('boon') && n.tag === 'button');
  assert.equal(buttons.length, ids.length, 'one boon button per offer');
  const marks = [];
  for (let i = 0; i < buttons.length; i += 1) {
    const id = ids[i];
    const glyph = glyphOf(buttons[i], 'boon-glyph');
    assert.ok(glyph, `${id}: the boon button carries a .boon-glyph span`);
    const expected = api.glyphMarkup(api.BOON_GLYPH[id]);
    assert.equal(glyph.innerHTML, expected, `${id}: the chip is BOON_GLYPH[${id}]'s own mark`);
    marks.push(glyph.innerHTML);
    // The art is decorative; the aria-label still speaks the kernel's own sentence —
    // it opens with the boon's kernel name, colon, sentence.
    assert.ok(buttons[i].attrs['aria-label'].startsWith(`${NAMES[id]}: `),
      `${id}: the aria-label opens with the kernel name: ${buttons[i].attrs['aria-label']}`);
  }
  assert.match(buttons[0].attrs['aria-label'], /Gain 1 Energy every turn/, 'the kernel sentence rides verbatim');
  assert.equal(new Set(marks).size, marks.length, 'every offered boon paints a DISTINCT mark');
});

test('an unknown boon id falls back to the rune, never an empty box', () => {
  // The kernel's own snapshot can only publish BOONS ids (an unknown one would not
  // snapshot at all), so the fallback is the view's defensive `|| 'rune'` arm: assert the
  // table lookup IS the undefined that selects it, and that the arm's mark is the rune.
  assert.equal(api.BOON_GLYPH['not_a_boon'], undefined, 'an unknown boon id maps to nothing in the table');
  assert.equal(api.glyphMarkup('rune'), api.glyphMarkup('not_a_mark'),
    'glyphMarkup degrades any unknown mark name to the same rune shape');
  assert.ok(api.glyphMarkup('rune').includes('<svg'), 'the fallback is real markup, not an empty box');
});
