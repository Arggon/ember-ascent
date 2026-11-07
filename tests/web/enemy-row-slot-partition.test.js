// ENEMY ROW SLOT PARTITION: a targeted kill in a fight where an EARLIER death has already
// left the painted row must not crash the stage. The crash this file pins (fuzzer repro,
// seed 273/kiln): a fight whose kernel enemy list still carries a dead row at stable
// index 0 — the kernel keeps dead enemies, snapshots omit them (snapshotEnemies filters
// !e.dead) — so the two survivors sit at stable indices 1 and 2 but paint at row
// positions 0 and 1. Killing the acid_slime (stable 2, painted position 1) used to push a
// death burst keyed `enemy: 2` — the STABLE index — and combatView mapped ghosts to slots
// by that field: the ghost landed at slot 2, past the row's end (slots = 1 living + 1
// dying = 2), the last slot fell through to `snap.enemies[1]` = undefined, and
// enemyCard's `e.intent` threw — TypeError, #stage emptied, dead screen.
//
// WHAT THIS PINS, against the REAL surface code driven by the fake-DOM harness:
//   * the death burst carries BOTH namespaces: `enemy` = the stable kernel index (what
//     the fx layer matches on: card-fly.enemy <-> the ghost's data-death-index), and
//     `slot` = the victim's position in the BEFORE painted row (what combatView keys the
//     ghost by);
//   * the painted row holds the LINEUP the stroke was aimed at: the ghost at the
//     victim's own slot, the survivor at its own, living slots and ghost slots together
//     exactly 0..n-1 — and enemyCard is never handed an undefined.
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
    while (n) { if (n._cls.split(/\s+/).includes(want)) return n; n = this === n ? null : n.parent; }
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
// `dyingNow` reads the death bursts the LAST paint handed the fx layer (the very objects
// act() pushed). `clearFx` retires the kill choreography's timers so the test process
// does not outlive its assertions on the event loop.
let src = body;
src += '\nreturn { act, render, snapNow: () => snap, dyingNow: () => dyingThisPaint, clearFx: clearFxTimers };';

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

/** The defensive skip in combatView's row loop must stay unreachable — the partition is
 *  computed, not papered over. This spy fails the test the moment the guard speaks. */
function guardSpy() {
  const fired = [];
  const orig = console.error;
  console.error = (...a) => { if (String(a[0]).includes('[combat]')) fired.push(a.join(' ')); };
  return { fired, restore: () => { console.error = orig; } };
}

/**
 * Boot the surface on the repro fight's EXACT shape: a kernel enemy list that still
 * carries a dead ash_wraith at stable index 0 (the earlier death that shifted every
 * later stable index above its painted position), the wraith survivor at stable 1 and
 * the acid_slime at stable 2, and a hand holding carnage (Sunder, 20 damage, single
 * target) — the fuzzer's aimed-kill state, as a plain object the real controller loads.
 * The enemy rows copy the kernel's own row shape (the fields playCard and the snapshot
 * read); hp values are the save's, so the blow is deterministic.
 */
function startReproFight() {
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const state = JSON.parse(JSON.stringify(FIRST_FIGHT));
  const row = (over) => ({
    block: 0, dead: false, hp: 10, id: 'ash_wraith', index: 0, intentStep: 0,
    maxHp: 26, moveHistory: [0], moveIndex: 0, name: 'Ash Wraith', statuses: {}, ...over,
  });
  state.combat = {
    ...state.combat,
    enemies: [
      row({ index: 0, hp: 0, dead: true }),                                        // the compacted death
      row({ index: 1, hp: 2, maxHp: 26 }),                                         // survivor, painted position 0
      row({ id: 'acid_slime', index: 2, hp: 17, maxHp: 29, name: 'Acid Slime', moveHistory: [1, 0, 0, 0] }), // victim, painted position 1
    ],
    hand: [{ uid: 'repro-carnage', cardId: 'carnage', cost: 2 }],
  };
  state.player = { ...state.player, energy: 3 };
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  const api = factory(ctl, importedModules);
  api.render();
  return api;
}

/** The painted enemy row (combatView's own), its children in slot order. */
function enemyRow() {
  return byId.stage.querySelector('.enemies');
}

test('the aimed kill against a compacted row pushes a death burst carrying BOTH index namespaces', () => {
  const api = startReproFight();
  const spy = guardSpy();
  try {
    // The pre-kill lineup documents the offset: two LIVING enemies painted, but the
    // acid's stable index (2) is NOT its painted position (1) — the dead row at stable
    // 0 is the whole difference, and it is what the old ghost keying ignored.
    const before = api.snapNow();
    assert.equal(before.enemies.length, 2, 'the snapshot omits the dead kernel row');
    assert.deepEqual(before.enemies.map((e) => e.index), [1, 2], 'the survivors keep their STABLE kernel indices');
    assert.equal(enemyRow().kids.length, 2, 'the pre-kill row paints two enemies');
    assert.equal(enemyRow().kids[1].getAttribute('data-target-index'), '2', 'the acid is the row\'s 2nd target');

    // The repro's kill, by its exact action id shape: play hand slot 1 aimed at the
    // 2nd LIVING enemy — the acid, 17 hp against 20 damage.
    api.act('p1_2', 2);

    const after = api.snapNow();
    assert.equal(after.enemies.length, 1, 'the acid_slime died and left the snapshot');
    assert.equal(after.enemies[0].index, 1, 'the wraith survivor keeps its stable index 1');
    assert.equal(after.phase, 'combat', 'the fight continues, so the kill repaints combatView itself');

    const dying = api.dyingNow();
    assert.equal(dying.length, 1, 'one death burst for the one dead enemy');
    assert.equal(dying[0].kind, 'death', 'the burst is a death burst');
    // THE PIN, stable half: the fx layer's namespace (`card-fly.enemy` matches the
    // ghost's `data-death-index` on exactly this value).
    assert.equal(dying[0].enemy, 2, 'the burst names the victim by its STABLE kernel index');
    // THE PIN, positional half: the slot the ghost must hold — the victim's position in
    // the BEFORE painted row. Without it combatView keyed the ghost at stable slot 2,
    // past the row's end, and the crash shipped.
    assert.equal(dying[0].slot, 1, 'the burst carries the victim\'s slot in the painted row');
    // The fx-matching half of the contract, on the DOM side: the ghost publishes the
    // victim's STABLE index as its data-death-index — the exact value a card-fly aimed
    // at this body carries on a kill (actions.js resolves fly.enemy to the victim's
    // stable index, the `?? aimedAt` fallback). act() runs dispatchFx synchronously, so
    // the fly burst itself is already consumed here; the ghost's handle is what it
    // matched against.
    const ghost = enemyRow().querySelector('.is-dying');
    assert.ok(ghost, 'the kill paints its ghost on the stage');
    assert.equal(ghost.getAttribute('data-death-index'), String(dying[0].enemy),
      'the ghost\'s fx handle is the stable index a card-fly matches on');
  } finally {
    spy.restore();
    api.clearFx();
  }
});

test('the row paints the victim\'s own slot as the ghost and never hands enemyCard an undefined', () => {
  const api = startReproFight();
  const spy = guardSpy();
  try {
    api.act('p1_2', 2);

    const row = enemyRow();
    const dying = api.dyingNow();
    // The partition the invariant promises: living slots + ghost slots = exactly
    // 0..n-1, so the row holds living+dyings children and NOTHING is undefined.
    assert.equal(row.kids.length, api.snapNow().enemies.length + dying.length,
      'the row paints the lineup the stroke was aimed at');
    assert.equal(row.kids.length, 2, 'one survivor plus one ghost');

    const [first, second] = row.kids;
    // Survivor first, at ITS OWN slot: a living enemy card, not slid into the ghost's
    // place and not the victim's body.
    assert.ok(first.classList.contains('enemy'), 'slot 0 paints an enemy card');
    assert.ok(!first.classList.contains('is-dying'), 'slot 0 is the living survivor');
    assert.equal(first.getAttribute('data-target-index'), '1', 'the survivor keeps its targeting slot');
    assert.ok(first.querySelector('.ename').txt.includes('Ash Wraith'), 'slot 0 is the wraith');
    // THE PIN: the ghost at the slot the victim occupied in the painted row — stable
    // index 2's body held row position 1, so the ghost is the row's SECOND card.
    assert.ok(second.classList.contains('is-dying'), 'slot 1 is the collapsing ghost');
    assert.ok(second.classList.contains('enemy'), 'the ghost paints as an enemy card');
    assert.equal(second.getAttribute('data-death-index'), '2', 'the ghost\'s fx handle stays the STABLE index');
    assert.ok(second.querySelector('.ename').txt.includes(dying[0].name),
      'the ghost is the body that died, not a shifted survivor');
    // enemyCard is fed only real rows: every NON-ghost child carries the attrs
    // enemyCard always paints — an undefined would have thrown before this line.
    const livingCards = row.kids.filter((k) => !k.classList.contains('is-dying'));
    assert.equal(livingCards.length, api.snapNow().enemies.length, 'one living card per living enemy, no more');
    for (const card of livingCards) assert.ok(card.getAttribute('data-target-index'), 'enemyCard painted a real row');
    // The defensive skip is for a future burst shape, not for this one.
    assert.equal(spy.fired.length, 0, 'the row partition is computed — the defensive guard never fires');
  } finally {
    spy.restore();
    api.clearFx();
  }
});
