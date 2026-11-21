// CHARACTER CHIPS: the enemy card and the hero card speak in chips — statuses as
// mark+stack chips (no visible sentence), the enemy intent as chips instead of the long
// "Will attack for 7 and block 5." line. The kernel owns every number and sentence: the
// chips' titles ARE the kernel's own explain/intent sentences, the popover is the ONE
// shared explainer, and a chip click must never pick a target while aiming.
//
// WHAT THIS PINS, against the REAL surface code driven by the fake-DOM harness:
//   * an enemy card renders NO visible intent sentence (.ilabel is gone when chips
//     exist) and NO visible status sentence — the pills' inline text is gone;
//   * the intent row carries the kernel's attack/block chips (coil_thrash: 7 and 5) with the
//     sentence as the row's title and aria-label;
//   * a Vulnerable status chip, clicked, opens the shared popover with the kernel
//     sentence and closes on Escape;
//   * the chips are real controls on the resting readout (a div) and demote to inert
//     spans while TARGETING (the enemy card is then a native button — nested interactive
//     elements are invalid, and a chip click must never pick the target);
//   * the hero card paints its statuses as the same chips (hero-status-parity pins the
//     full juice-in contract; here we pin the click-to-explain path once, on an enemy).

let uid = 0;
class N {
  constructor(tag) {
    this.tag = tag; this.uid = uid++; this.kids = []; this.parent = null;
    this.attrs = {}; this._cls = ''; this.txt = ''; this._sty = {};
    this._ls = {}; this.disabled = false; this.focused = false;
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
for (const id of ['hud', 'stage', 'toast', 'live', 'app', 'fx-layer']) { const d = new N('div'); d._cls = id; byId[id] = d; root.append(d); }
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
let src = body;
src += '\nreturn { render, snapNow: () => snap };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
  ${src}
`);

/** One real first fight, frozen. */
const bootRun = ctlMod.createController({ run: { seed: 11 } });
bootRun.dispatch('n1');
const FIRST_FIGHT = JSON.parse(JSON.stringify(bootRun.state));
assert.equal(bootRun.snapshot().phase, 'combat', 'the reference run opens on a fight');

const HELP_SEEN_KEY = 'dlb.helpSeen.v1';

/**
 * Boot on the reference fight with the FIRST enemy carrying a status and cinder_maw's
 * coil_thrash move (attack 7 + block 5) — the richest intent shape the act-1 roster has.
 */
function startFight({ enemyStatuses = { vulnerable: 2 } } = {}) {
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const state = JSON.parse(JSON.stringify(FIRST_FIGHT));
  state.combat.enemies = state.combat.enemies.map((e, i) => (i === 0
    ? { ...e, id: 'cinder_maw', statuses: { ...enemyStatuses }, moveIndex: 1 }
    : e));
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  const api = factory(ctl, importedModules);
  assert.equal(api.snapNow().phase, 'combat', 'the crafted state still reads as the fight');
  return api;
}

/** LOCAL lookups only — the harness querySelector falls back document-wide. */
const localFind = (node, sel) => node._all().find((n) => m(n, sel)) ?? null;
const enemyCard = () => byId.stage.querySelectorAll('.enemy')[0] ?? null;
const chipsIn = (row) => (row ? row.kids.filter((k) => k.classList.contains('cfx-chip')) : []);
const pop = () => root.querySelector('.cfx-pop');

test('the enemy card speaks in chips: no visible intent sentence, no visible status sentence', () => {
  const api = startFight();
  api.render();
  const card = enemyCard();
  assert.ok(card, 'the enemy card painted');
  // Statuses: chips with kernel titles, the pills' inline sentence gone.
  const statusRow = localFind(card, '.e-statuses');
  assert.ok(statusRow, 'the enemy paints a status row');
  const vuln = chipsIn(statusRow)[0];
  assert.ok(vuln && vuln.classList.contains('cfx-chip'), 'the status is a chip');
  assert.equal(vuln.querySelector('.cfx-num').txt, '2', 'the chip reads the live stacks');
  assert.equal(vuln.attrs.role, 'button', 'the resting readout\u2019s chips are real controls');
  assert.match(vuln.attrs.title, /^Vulnerable 2 — /, 'the chip title is the kernel sentence');
  assert.ok(!vuln.textContent.includes('50% more damage'), 'NO visible status sentence on the card');
  // Intent: attack 7 + block 5 chips, the sentence demoted to title/aria.
  const intentRow = localFind(card, '.e-intent');
  assert.ok(intentRow, 'the enemy paints an intent row');
  const ichips = chipsIn(intentRow);
  assert.deepEqual(ichips.map((c) => c.querySelector('.cfx-num').txt), ['7', '5'],
    'coil_thrash reads as attack 7 and block 5');
  assert.ok(!localFind(intentRow, '.ilabel'), 'NO visible intent sentence on the card');
  assert.match(intentRow.attrs['aria-label'], /Will attack for 7 and block 5/,
    'the sentence stays in the intent row\u2019s aria-label');
  assert.match(intentRow.attrs.title, /Will attack for 7 and block 5/,
    'and in its native title');
  assert.match(ichips[0].attrs.title, /Will attack for 7 and block 5/,
    'every intent chip\u2019s explain is the whole move\u2019s kernel sentence');
});

test('the enemy\'s own buffs float ABOVE the art with the intent row; the hero-applied debuffs stay at the foot', () => {
  // The user's ask: actions (the intent chips) and the enemy's own buffs live where the
  // retired intent badge floated — over the enemy — while the statuses the HERO applies
  // (Vulnerable, Weak) keep the foot row. The split reads the kernel-published `kind`
  // (observe.js statusPairs), never a key match. Death ghosts (floats.js dyingCard) and
  // the boss-down hold never build any of these rows — they paint fig/name/ehp only —
  // so this reordering cannot reach them.
  const api = startFight({ enemyStatuses: { strength: 3, vulnerable: 2 } });
  api.render();
  const card = enemyCard();
  assert.ok(card, 'the enemy card painted');
  const marker = (n) => (n.classList.contains('e-buffs') ? 'e-buffs'
    : n.classList.contains('e-statuses') ? 'e-statuses'
    : n.classList.contains('e-intent') ? 'e-intent'
    : n.classList.contains('fig') ? 'fig' : null);
  const order = card.kids.map(marker).filter(Boolean);
  assert.ok(order.includes('e-intent') && order.includes('e-buffs') && order.includes('fig') && order.includes('e-statuses'),
    `all four bands painted, got ${order.join(',')}`);
  const intentAt = order.indexOf('e-intent');
  const buffsAt = order.indexOf('e-buffs');
  const figAt = order.indexOf('fig');
  const debuffAt = order.indexOf('e-statuses');
  assert.ok(intentAt === 0, 'the intent row is the card\'s topmost band');
  assert.ok(intentAt < buffsAt && buffsAt < figAt, 'the buff row sits between the intent row and the art');
  assert.ok(figAt < debuffAt, 'the debuff row stays at the foot, below the art');
  // Which chip went where — kernel `kind`, same chip component in both rows.
  const buffChips = chipsIn(card.kids.filter((n) => marker(n) === 'e-buffs')[0]);
  assert.equal(buffChips.length, 1, 'one buff chip above the art');
  assert.match(buffChips[0].attrs.title, /^Strength 3 — its attacks/, 'the up-top chip is the enemy\'s own Strength');
  const footRow = card.kids.filter((n) => marker(n) === 'e-statuses')[0];
  const footChips = chipsIn(footRow);
  assert.equal(footChips.length, 1, 'one debuff chip at the foot');
  assert.match(footChips[0].attrs.title, /^Vulnerable 2 — /, 'the foot chip is the hero-applied Vulnerable');
  // A buffless enemy renders no top buff row at all (the conditional pattern), and the
  // foot row is a plain `.e-statuses` — no new chrome for the old shape.
  const bare = startFight({ enemyStatuses: {} });
  bare.render();
  const bareCard = enemyCard();
  assert.equal(bareCard.kids.some((n) => marker(n) === 'e-buffs'), false, 'no buffs row when the enemy holds none');
  assert.equal(bareCard.kids.some((n) => marker(n) === 'e-statuses'), false, 'and no foot row either');
});

test('clicking the Vulnerable status chip explains it through the shared popover; Escape closes', () => {
  const api = startFight();
  api.render();
  const vuln = chipsIn(localFind(enemyCard(), '.e-statuses'))[0];
  vuln._ls.click[0]({ target: vuln, stopPropagation: () => {} });
  const sheet = pop();
  assert.ok(sheet, 'the popover opened on the shared layer');
  assert.equal(sheet.querySelector('.cfx-pop-label').txt, 'Vulnerable', 'the popover titles with the kernel label');
  assert.match(sheet.querySelector('.cfx-pop-body').txt, /it takes 50% more damage from attacks/,
    'the body is the kernel\u2019s own enemy-side sentence');
  for (const fn of docHandlers.keydown || []) fn({ key: 'Escape', preventDefault: () => {} });
  assert.equal(pop(), null, 'Escape closed the explainer');
  // The chip that opened it gets the focus back, like every other chip path.
  assert.ok(vuln.focused, 'focus was restored to the status chip');
});

test('while TARGETING the enemy card is a button, so its chips demote to inert spans', () => {
  // Two enemies are alive, so aiming is a choice and the enemy card becomes a button.
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const state = JSON.parse(JSON.stringify(FIRST_FIGHT));
  const first = { ...state.combat.enemies[0], statuses: { vulnerable: 2 }, moveIndex: 1 };
  state.combat.enemies = [first, { ...first, index: 1, statuses: {}, moveIndex: 0 }];
  state.player.energy = 5; // a hand card must be playable or the click never aims
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  const api = factory(ctl, importedModules);
  api.render();
  // Enter the target step with a hand card.
  const handTile = byId.stage.querySelectorAll('.card').find((n) => n.tag === 'button');
  assert.ok(handTile, 'a hand tile is painted');
  handTile.dispatch ? handTile.dispatch('click') : handTile._ls.click[0]({ stopPropagation: () => {} });
  assert.equal(api.snapNow().enemies.length, 2, 'two enemies are alive');
  const card = enemyCard();
  assert.equal(card.tag, 'button', 'the enemy card became the targeting button');

  const chip = chipsIn(localFind(card, '.e-statuses'))[0];
  assert.ok(chip, 'the status chip still paints');
  assert.equal(chip.attrs.role, undefined, 'the chip is a span — no nested interactive element');
  // tabindex -1: no TAB stop inside the button (the enemy button keeps the tab ring),
  // but focus() can still land here — closing the explainer hands focus back to the
  // chip that opened it instead of dropping the keyboard user.
  assert.equal(chip.attrs.tabindex, '-1', 'and takes no tab stop inside the button, yet stays focus()able');
  // Its pointer click still explains, and NEVER picks the target: stopPropagation dies
  // on the chip before the card's pick handler can hear it.
  let swallowed = false;
  chip._ls.click[0]({ target: chip, stopPropagation: () => { swallowed = true; } });
  assert.ok(swallowed, 'the chip click stops propagation');
  assert.ok(pop(), 'the popover still opens from the targeting state');
  for (const fn of docHandlers.keydown || []) fn({ key: 'Escape', preventDefault: () => {} });
});

test('the hero card speaks in the same chips (the sentence path is one click away)', () => {
  const api = startFight({ enemyStatuses: {} });
  // Give the HERO a status for this paint: the same surface the parity file pins.
  const hero = byId.stage.querySelector('.hero');
  assert.ok(hero, 'the hero figure painted');
  api.render();
  // The crafted fight carries no player statuses; drive one through the crafted state.
  // Re-boot with a player status on the state.
  const state = JSON.parse(JSON.stringify(FIRST_FIGHT));
  state.player.statuses = { strength: 2 };
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  const api2 = factory(ctl, importedModules);
  api2.render();
  const hero2 = byId.stage.querySelector('.hero');
  const row = localFind(hero2, '.e-statuses');
  assert.ok(row, 'the hero paints a status row');
  const chip = chipsIn(row)[0];
  assert.ok(chip, 'the hero status is a chip');
  assert.equal(chip.querySelector('.cfx-num').txt, '2', 'the chip reads the stacks');
  assert.match(chip.attrs.title, /your attacks deal 2 more damage/, 'the kernel sentence is the title');
  assert.ok(!chip.textContent.includes('your attacks'), 'NO visible sentence on the hero card');
});
