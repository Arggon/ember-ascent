// EVENT CHOICE ART SURFACES: all four wayside events must paint each choice its OWN
// inline-SVG mark — the `.boon.event-choice` buttons wear the relic offers' `.boon-art`
// contract (per-relic art, committed in b59bb71, now extended to the event choices) —
// with the documented fallback (unknown eventId/slug -> the generic r-unknown plate)
// and the kernel sentences untouched in the aria-labels (the art is decorative).
//
// The gap this file exists for: the art table (EVENT_CHOICE_GLYPH in glyphs.js) is keyed
// eventId THEN slug, and the view resolves it from the SNAPSHOT's own pair — a typo'd
// table key, a view that forgets the slug, or a fallback that renders an empty box would
// all stay invisible to the kernel tests. These tests drive the REAL eventView() builder
// on REAL kernel runs (a fresh walk into the row-2 wayside, one state per event id) and
// pin:
//   * every event's three choices paint marks, pairwise DISTINCT within the event, each
//     exactly the table's own mark for its slug;
//   * the four no-op beats (leave/wave/walk/move) share the ONE `ev-road` footprint;
//   * an unknown eventId AND an unknown slug each degrade to r-unknown (table-level: the
//     lookup is the undefined that selects the call-site `|| 'r-unknown'` arm — a torn
//     event renders NO choices, so the arm cannot be reached through a live snapshot);
//   * a dimmed choice (the purse cannot cover it) still carries its art span;
//   * the aria-labels still speak the kernel's own sentences verbatim.

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
import { readFileSync } from 'node:fs';
import { bundleApp } from '../web/app-bundle.mjs';
import { loadKernel } from '../helpers/harness.mjs';

const appUrl = new URL('../../src/web/app.js', import.meta.url);
const { prelude, body, mods: importedModules } = await bundleApp(appUrl, { stubController: true });
// The REAL view builder and the art table, from the bundle scope: these tests drive the
// view the player actually gets and compare what it paints against what glyphMarkup
// would emit for the mapped mark.
let src = body;
src += '\nreturn { snapNow: () => snap, eventView, glyphMarkup, EVENT_CHOICE_GLYPH };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
  ${src}
`);

const K = await loadKernel();
const HELP_SEEN_KEY = 'dlb.helpSeen.v1';

/** The view api, captured on a plain boot: the tests compare what eventView paints
 *  against what glyphMarkup emits for the table's own mark. */
const api = (() => {
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const ctl = ctlMod.createController({ run: { seed: 11 } });
  return factory(ctl, importedModules);
})();

/** Boot the surface on a doctored state and hand back the real view api. */
function bootOn(over = {}) {
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const ctl = ctlMod.createController({ session: { state: over, submitted: [], events: [] } });
  return factory(ctl, importedModules);
}

/** The glyph span inside `node` (by class), via LOCAL lookup only. */
const glyphOf = (node, cls) => node._all().find((n) => n.classList.contains(cls)) ?? null;

/** REAL kernel runs standing at the row-2 wayside: walk a staged run into the first
 *  reachable event node (the event-resolved-tiles precedent) and collect ONE state per
 *  roster event id — the roster order is the frozen pick order, so the seed sweep meets
 *  all four within the first handful. */
const EVENT_STATES = (() => {
  const found = {};
  for (let seed = 0; seed < 80; seed += 1) {
    const base = K.newRun({ seed });
    const staged = { ...base, floor: 1, mapNodeId: 'r1n0' };
    const travel = K.actions(staged).find((a) => a.nodeType === 'event');
    if (!travel) continue;
    const out = K.step(staged, travel.id);
    if (out.error !== null || !out.state.event) continue;
    const id = out.state.event.id;
    if (found[id]) continue;
    found[id] = JSON.parse(JSON.stringify(out.state));
    if (Object.keys(found).length === 4) break;
  }
  return found;
})();

test('all four events sweep in from real runs', () => {
  assert.deepEqual(Object.keys(EVENT_STATES).sort(),
    ['ash_peddler', 'collapsed_shaft', 'sleeping_forge', 'wandering_smith'],
    'the seed sweep reached every roster event');
});

test('every event paints each choice its own DISTINCT mark, exactly the table\u2019s mark', () => {
  for (const [eventId, state] of Object.entries(EVENT_STATES)) {
    const apiV = bootOn(JSON.parse(JSON.stringify(state)));
    const view = apiV.eventView();
    const snapChoices = apiV.snapNow().event.choices;
    const buttons = view._all().filter((n) => n.classList.contains('event-choice') && n.tag === 'button');
    assert.equal(buttons.length, 3, `${eventId}: one button per offered choice`);
    const marks = [];
    for (let i = 0; i < buttons.length; i += 1) {
      const slug = snapChoices[i].slug;
      const art = glyphOf(buttons[i], 'boon-art');
      assert.ok(art, `${eventId}:${slug}: the choice button carries a .boon-art span`);
      // The button paints EXACTLY the table's mark for this eventId+slug (not a
      // neighbour's, not the fallback) — the art is keyed by the snapshot's own pair.
      const expected = api.glyphMarkup(api.EVENT_CHOICE_GLYPH[eventId][slug]);
      assert.equal(art.innerHTML, expected, `${eventId}:${slug}: the art is EVENT_CHOICE_GLYPH[${eventId}][${slug}]'s own mark`);
      assert.ok(art.innerHTML.includes('<svg'), `${eventId}:${slug}: real markup, not an empty box`);
      marks.push(art.innerHTML);
    }
    assert.equal(new Set(marks).size, marks.length, `${eventId}: the three choices paint DISTINCT marks`);
  }
});

test('the four no-op slugs share the one ev-road footprint', () => {
  for (const slug of ['leave', 'wave', 'walk', 'move']) {
    const mapped = Object.values(api.EVENT_CHOICE_GLYPH)
      .map((per) => per[slug])
      .filter(Boolean);
    assert.equal(mapped.length, 1, `${slug}: exactly one event maps it`);
    assert.equal(mapped[0], 'ev-road', `${slug}: the no-op beat wears the shared road mark`);
  }
  // And the VIEWS agree: each event's no-op button paints the same ev-road markup.
  const road = api.glyphMarkup('ev-road');
  for (const [eventId, state] of Object.entries(EVENT_STATES)) {
    const view = bootOn(state).eventView();
    const noop = view._all().find((n) => n.classList.contains('event-choice')
      && glyphOf(n, 'boon-art')?.innerHTML === road);
    assert.ok(noop, `${eventId}: one choice wears the shared ev-road mark`);
  }
});

test('an unknown eventId AND an unknown slug each degrade to r-unknown', () => {
  // A torn event (an id the kernel no longer knows) renders NO choices at all — the
  // `ev.known === false` branch — so the call-site fallback cannot be reached through a
  // live snapshot. What is pin-able is the mechanism: the table lookups ARE the undefined
  // that selects the `|| 'r-unknown'` arm, the arm's mark is real, and the view source
  // still consults the table with that arm (a deleted arm would render an empty box).
  assert.equal(api.EVENT_CHOICE_GLYPH['not_an_event']?.['anything'], undefined,
    'an unknown eventId maps to nothing in the table');
  assert.equal(api.EVENT_CHOICE_GLYPH.sleeping_forge['not_a_slug'], undefined,
    'an unknown slug under a known event maps to nothing in the table');
  assert.ok(api.glyphMarkup('r-unknown').includes('<svg'), 'the fallback is real markup, not an empty box');
  const viewSrc = readFileSync(new URL('../../src/web/event-view.js', import.meta.url), 'utf8');
  assert.match(viewSrc, /EVENT_CHOICE_GLYPH\[ev\.eventId\]\?\.\[c\.slug\] \|\| 'r-unknown'/,
    'the view resolves the table from the snapshot pair and falls back to r-unknown');
  // The table covers every roster choice: 4 events x 3 slugs, all real mark names.
  const pairs = Object.entries(api.EVENT_CHOICE_GLYPH).flatMap(([ev, per]) => Object.entries(per).map(([slug, mark]) => `${ev}:${slug}:${mark}`));
  assert.equal(pairs.length, 12, 'the table covers all 12 choices');
  for (const pair of pairs) {
    const mark = pair.split(':')[2];
    assert.ok(mark === 'r-unknown' || /^ev-/.test(mark), `${pair}: a mark name this table owns`);
    assert.ok(api.glyphMarkup(mark).includes('<svg'), `${pair}: its mark renders`);
  }
});

test('a dimmed choice still carries its art (the purse cannot cover it)', () => {
  const state = JSON.parse(JSON.stringify(EVENT_STATES.sleeping_forge));
  state.player.gold = 0; // the ember's price (30g) is now out of reach: the kernel dims it
  const apiDim = bootOn(state);
  const view = apiDim.eventView();
  const buttons = view._all().filter((n) => n.classList.contains('event-choice') && n.tag === 'button');
  assert.equal(buttons.length, 3, 'all three choices stay VISIBLE (the inert-shelf contract)');
  const snapChoices = apiDim.snapNow().event.choices;
  const dimRow = snapChoices.findIndex((c) => c.actionId === null);
  assert.ok(dimRow >= 0, 'the kernel refused at least one choice at 0 gold');
  for (let i = 0; i < buttons.length; i += 1) {
    const art = glyphOf(buttons[i], 'boon-art');
    assert.ok(art, `${snapChoices[i].slug}: the dim-excluded row keeps its art span`);
    assert.equal(buttons[i].classList.contains('dim'), snapChoices[i].actionId === null,
      `${snapChoices[i].slug}: dim rides exactly the refused choice`);
    if (i === dimRow) {
      assert.equal(art.innerHTML, api.glyphMarkup(api.EVENT_CHOICE_GLYPH.sleeping_forge[snapChoices[i].slug]),
        `${snapChoices[i].slug}: the dimmed row paints its OWN mark, not a fallback`);
      const reason = buttons[i]._all().find((n) => n.classList.contains('event-reason'));
      assert.ok(reason && reason.txt.length > 0, `${snapChoices[i].slug}: the dimmed row still says WHY`);
    }
  }
});

test('the aria-labels still speak the kernel\u2019s sentences verbatim (the art is decorative)', () => {
  for (const state of Object.values(EVENT_STATES)) {
    const apiV = bootOn(JSON.parse(JSON.stringify(state)));
    const view = apiV.eventView();
    const buttons = view._all().filter((n) => n.classList.contains('event-choice') && n.tag === 'button');
    const snapChoices = apiV.snapNow().event.choices;
    for (let i = 0; i < buttons.length; i += 1) {
      const c = snapChoices[i];
      const expected = c.actionId !== null
        ? `${c.label}. ${c.effect}`
        : `${c.label}. Unavailable: ${c.reason}.`;
      assert.equal(buttons[i].attrs['aria-label'], expected,
        `${c.slug}: the aria contract holds (${c.actionId === null ? 'dim' : 'affordable'} form)`);
      // The art span is decorative: the aria-hidden rides the mark's <svg> markup
      // inside it (the harness keeps innerHTML as a raw string, unparsed).
      const art = glyphOf(buttons[i], 'boon-art');
      assert.match(art.innerHTML, /<svg [^>]*aria-hidden="true"/, `${c.slug}: the art stays aria-hidden`);
    }
  }
});
