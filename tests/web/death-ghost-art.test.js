// DEATH GHOST ART: the collapsing card a kill leaves behind must show the enemy that
// actually died, not the jaw-worm. The ghost's art is keyed by the death burst's `id`
// (`dyingCard` -> `enemyMarkup(id)`), and `enemyMarkup(undefined)` falls back to
// SPRITES.jaw_worm — so a burst pushed without the id made EVERY death ghost (the
// combat-row one and the end-of-run hold render.js draws alike, both fed from the same
// bursts) wear the Cinder Maw's body.
//
// WHAT THIS PINS, against the REAL surface code driven by the fake-DOM harness:
//   * the REAL act() push site in actions.js stamps the dying enemy's own `id` onto the
//     `death` burst (read back through the burst objects render() handed to the fx layer);
//   * the ghost card the REAL render() paints from that burst (`.enemy.is-dying .fig`)
//     carries THAT enemy's sprite markup and not the jaw-worm fallback.
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
// `dyingNow` reads the burst objects the LAST paint handed the fx layer: render() copies
// the `death` bursts verbatim into `dyingThisPaint`, so these are the very objects act()
// pushed — the same reference, one hop downstream. `clearFx` retires the timers the kill's
// choreography arms, so the test process does not outlive its assertions on the event loop.
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
assert.equal(FIRST_FIGHT.combat.enemies.length, 1, 'the reference fight is one enemy');

const HELP_SEEN_KEY = 'dlb.helpSeen.v1';

/**
 * Boot the surface on a fight whose single enemy is an ASH WRAITH one hit from death.
 * The fight itself is the reference run's (seed 11), with only the enemy's identity and
 * its last point of HP rewritten: a one-hp wraith falls to the opening Hammerfall, so the
 * kill is deterministic and the dying enemy is guaranteed NOT the jaw-worm the fallback
 * would draw. The controller is the real one; the state it was loaded from is a plain
 * object, so the snapshot (and the ghost's name) still come from the kernel's tables.
 */
function startDyingWraithFight() {
  // A RETURNING player: the first-run Help sheet would otherwise paint over the stage.
  globalThis.localStorage._d[HELP_SEEN_KEY] = '1';
  const state = JSON.parse(JSON.stringify(FIRST_FIGHT));
  state.combat.enemies = [{ ...state.combat.enemies[0], id: 'ash_wraith', name: 'Ash Wraith', hp: 1, maxHp: 24 }];
  const ctl = ctlMod.createController({ session: { state, submitted: [], events: [] } });
  const api = factory(ctl, importedModules);
  assert.equal(api.snapNow().phase, 'combat', 'the crafted state still reads as the fight');
  assert.equal(api.snapNow().enemies[0].id, 'ash_wraith', 'the kernel snapshot carries the wraith');
  return api;
}

test('the death burst a kill pushes carries the dying enemy\'s own id', () => {
  const api = startDyingWraithFight();
  // The opening Hammerfall kills the one-hp wraith: act() diffs the two snapshots and
  // pushes one `death` burst for it, then the paint copies it into the fx layer.
  api.act('p1');
  const dying = api.dyingNow();
  assert.equal(dying.length, 1, 'one death burst for the one dead enemy');
  const burst = dying[0];
  assert.equal(burst.kind, 'death', 'the burst is a death burst');
  assert.equal(burst.enemy, 0, 'the burst names the dead enemy by index');
  // THE PIN: without `id` on the burst, the ghost's art falls back to SPRITES.jaw_worm
  // for every enemy in the game.
  assert.equal(burst.id, 'ash_wraith', 'the burst carries the dying enemy\'s stable id');
  assert.equal(burst.name, 'Ash Wraith', 'the burst still carries the kernel\'s own name');
  api.clearFx();
});

test('the ghost card a kill paints wears the dead enemy\'s sprite, never the jaw-worm fallback', () => {
  const api = startDyingWraithFight();
  api.act('p1');
  // render() drew the end-of-run hold (the run ended on this blow), whose ghost row is
  // the SAME dyingRow() the combat view uses — one path, so one pin covers both.
  // The harness matcher takes ONE class per selector, so the ghost is found by its
  // one-paint marker class and checked for its card class separately.
  const ghost = byId.stage.querySelector('.is-dying');
  assert.ok(ghost, 'the painted stage holds a dying ghost card');
  assert.ok(ghost.classList.contains('enemy'), 'the dying card paints as an enemy card');
  assert.equal(ghost.querySelector('.ename').txt, 'Ash Wraith', 'the ghost is labelled with the wraith\'s name');
  const fig = ghost.querySelector('.fig');
  assert.ok(fig, 'the ghost carries a figure');
  assert.ok(fig.innerHTML.includes('spr-ash_wraith'), 'the ghost\'s figure shows the ash-wraith sprite');
  // The exact regression this file exists to catch: the fallback art of the Cinder Maw
  // standing in for a wraith's body.
  assert.ok(!fig.innerHTML.includes('spr-jaw_worm'), 'the ghost\'s figure is NOT the jaw-worm fallback');
  api.clearFx();
});
