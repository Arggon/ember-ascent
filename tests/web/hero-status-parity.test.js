// STATUS PARITY: the player's combat statuses (Vulnerable, Weak, …) read as pills on the
// HERO'S OWN CARD, under her HP bar — the same place an enemy's statuses sit — and NOT in
// the top HUD bar, where a landing debuff read as faint legend chrome. Powers (Combust, …)
// stay up there: they outlive the fight, and the combat card never shows them.
//
// WHAT THIS PINS, against the REAL surface code driven by the fake-DOM harness:
//   * heroFigure() emits a `.e-statuses` row INSIDE `.hero`, after the hp bar and before
//     the `.efx` strip, holding one `pill <key>` per snapshot status, with the kernel's own
//     explain sentence as the pill's title (and its own text as the pill's text);
//   * renderHud() paints NO status pill — a `vulnerable`/`weak` pill reappearing in the top
//     bar is the regression this file exists to catch — while the powers still paint there
//     as `pill power`;
//   * the `juice-in` diff pins once and is KEY-based: it rides the paint on which a status
//     key first appears and is gone from every repaint of that same key. Stacks going up do
//     NOT re-juice (freshStatusKeys compares keys, by design: a stacking status must not
//     re-animate every turn), so a key that leaves and lands again is what re-arms it.

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

const appUrl = new URL('../../src/web/app.js', import.meta.url);
const { prelude, body, mods: importedModules } = await bundleApp(appUrl, { stubController: true });
// `render` is the paint under test; `snap`/`setSnap` let a test hand the surface a crafted
// snapshot between paints (the controller's own state is freeze-protected, so the statuses
// are set on a plain clone and re-read through the REAL controller's snapshot()).
let src = body;
src += '\nreturn { render, snapNow: () => snap, sync: () => setSnap(ctl.snapshot()) };';

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
 * Boot the surface on the reference fight with the player's statuses/powers crafted on,
 * the way a turn that landed them would leave them. The controller is the real one; only
 * the state it was loaded from is a plain object, so the pills' labels and explain
 * sentences still come from the kernel.
 * @param {{statuses?: Record<string, number>, powers?: Record<string, number>}} [player]
 */
function startCombat({ statuses = {}, powers = {} } = {}) {
  // A RETURNING player: the first-run Help sheet would otherwise paint over the stage.
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const state = JSON.parse(JSON.stringify(FIRST_FIGHT));
  state.player = { ...state.player, statuses: { ...statuses } };
  state.powers = { ...powers };
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  const api = factory(ctl, importedModules);
  assert.equal(api.snapNow().phase, 'combat', 'the crafted state still reads as the fight');
  return { api, state };
}

const heroOf = () => byId.stage.querySelector('.hero');
function heroStatusBox() {
  const hero = heroOf();
  return hero ? hero.querySelector('.e-statuses') : null;
}
/** The status pills painted on the hero card, in paint order. */
function heroStatusPills() {
  const box = heroStatusBox();
  return box ? box.kids.filter((k) => k.tag === 'span') : [];
}
/** The pills painted in the top HUD bar (whatever they are). */
function hudPills() {
  return byId.hud.querySelectorAll('span').filter((s) => s.classList.contains('pill'));
}
/** The status key a pill stands for (`pill vulnerable juice-in` -> `vulnerable`). */
const pillKey = (pill) => pill.className.split(/\s+/).find((c) => c !== 'pill' && c !== 'juice-in');
/** Which keys are wearing the one-paint `juice-in` entrance on this paint. */
const juiceKeys = (pills) => pills.filter((p) => p.classList.contains('juice-in')).map(pillKey).sort();

test('the hero card carries the player statuses as pills under her own HP bar', () => {
  const { api } = startCombat({ statuses: { vulnerable: 2, weak: 1 } });
  const hero = heroOf();
  assert.ok(hero, 'the hero figure painted');
  const box = heroStatusBox();
  assert.ok(box, 'the hero paints an .e-statuses row');
  assert.equal(box.parent, hero, 'the row belongs to the hero card, not to the HUD');
  // UNDER the HP bar, above the effects strip — an enemy's statuses sit in the same place
  // on its own card, which is the whole point of the move.
  const order = hero.kids.map((k) => (k._cls.split(/\s+/)[0] || k.tag));
  assert.ok(order.includes('hpbar'), 'the hero still paints her hp bar');
  assert.ok(order.indexOf('hpbar') < order.indexOf('e-statuses'), 'the status row sits under the hp bar');
  assert.ok(order.indexOf('e-statuses') < order.indexOf('efx'), 'the status row sits above the effects strip');

  const pills = heroStatusPills();
  const snapshotStatuses = api.snapNow().player.statuses;
  assert.equal(pills.length, snapshotStatuses.length, 'one pill per status on the snapshot');
  assert.deepEqual(pills.map(pillKey).sort(), ['vulnerable', 'weak'], 'both statuses are on the hero card');
  for (const s of snapshotStatuses) {
    const pill = pills.find((p) => pillKey(p) === s.key);
    assert.ok(pill, `a pill is painted for ${s.key}`);
    assert.ok(pill.classList.contains('pill'), 'the entry is a pill');
    assert.equal(pill.attrs.title, s.explain, `the ${s.key} pill explains itself with the kernel's own sentence`);
    assert.equal(pill.txt, s.text, `the ${s.key} pill reads the kernel's own text`);
  }
});

test('the top HUD bar shows powers only — a combat status up there is the regression', () => {
  const { api } = startCombat({ statuses: { vulnerable: 2, weak: 1 }, powers: { combust: 1 } });
  // The same paint carries the statuses on the hero card, so the absence below is not
  // vacuous: the same facts are on screen, just on the card that owns them.
  assert.equal(heroStatusPills().length, 2, 'the statuses are painted on the hero card');
  const hudSpans = byId.hud.querySelectorAll('span');
  for (const s of hudSpans) {
    for (const key of ['vulnerable', 'weak']) {
      assert.ok(!s.classList.contains(key), `the HUD must not paint a ${key} pill`);
    }
  }
  const pills = hudPills();
  for (const pill of pills) {
    assert.match(pill.className, /^pill power( juice-in)?$/, 'every HUD pill is a power pill');
  }
  const powers = api.snapNow().player.powers;
  assert.equal(powers.length, 1, 'the snapshot carries one power');
  assert.equal(pills.length, powers.length, 'the HUD paints the powers and nothing else');
  const power = pills[0];
  assert.ok(power, 'the power still paints on the HUD');
  assert.equal(power.attrs.title, powers[0].explain, "the power pill keeps the kernel's own sentence");
});

test('juice-in pins once: it rides the paint a status first appears on, not every repaint', () => {
  const { api, state } = startCombat({ statuses: { weak: 1 } });
  // The boot paint is the run's first paint, so Weak is NEW there: it juices.
  assert.deepEqual(juiceKeys(heroStatusPills()), ['weak'], 'a status landing on the first paint juices');
  // A repaint of the SAME statuses must not re-animate — render() records the painted keys
  // at the end of every paint, which is what makes the diff a one-shot.
  api.render();
  assert.deepEqual(juiceKeys(heroStatusPills()), [], 'the same statuses on a reprint do not re-juice');
  // A key that newly LANDS juices; the one already painted does not.
  state.player.statuses = { vulnerable: 2, weak: 1 };
  api.sync();
  api.render();
  assert.deepEqual(juiceKeys(heroStatusPills()), ['vulnerable'], 'only the arriving key juices');
  // Stacks going up are NOT an arrival: freshStatusKeys diffs keys, so a stacking status
  // does not re-animate on every turn that adds to it.
  state.player.statuses = { vulnerable: 3, weak: 1 };
  api.sync();
  api.render();
  assert.deepEqual(juiceKeys(heroStatusPills()), [], 'more stacks on a known key do not re-juice');
  const vuln = heroStatusPills().find((p) => pillKey(p) === 'vulnerable');
  assert.equal(vuln.txt, api.snapNow().player.statuses.find((s) => s.key === 'vulnerable').text,
    'the pill still follows the new stack count');
  // A key that leaves and lands again IS an arrival, so the juice comes back.
  state.player.statuses = { weak: 1 };
  api.sync();
  api.render();
  assert.deepEqual(juiceKeys(heroStatusPills()), [], 'a status that falls off paints nothing');
  state.player.statuses = { vulnerable: 1, weak: 1 };
  api.sync();
  api.render();
  assert.deepEqual(juiceKeys(heroStatusPills()), ['vulnerable'], 'a status that lands again juices again');
});
