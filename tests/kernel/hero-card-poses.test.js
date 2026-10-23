// The hero's movement must be chosen by WHICH card was played, not only by its type.
//
// WHAT THIS PINS: `act()` now carries the played card's id on the `card-fly` burst, and
// `heroPose()` resolves it through the `HERO_MOVES` table: Hammerfall (strike) lunges,
// Anvil Blow (bash) winds up a heavy smash, Quench (defend) plants into a guard. Before
// this, every attack card played the same `pose-strike` and every skill/power the same
// `pose-brace`, so no card read differently from its neighbours.
//
// It needs the real renderer, so it drives src/web/app.js against a fake DOM with
// bubbling and closest() — the same harness shape as click-targeting.test.js — then
// reads the pose class off the freshly built hero figure.
//
// MAINTENANCE CONTRACT: HERO_MOVES in src/web/app.js is a hand-maintained mirror of
// src/kernel/content/cards.json. Adding or renaming a card id means updating that table
// (or accepting the type fallback) — the dispatch test below fails on a table key that
// is not a real card id, and the CSS test fails on a movement whose keyframe vanished.
import { readFileSync } from 'node:fs';

let uid = 0;
class N {
  constructor(tag) {
    this.tag = tag; this.uid = uid++; this.kids = []; this.parent = null;
    this.attrs = {}; this._cls = ''; this.txt = ''; this.style = {};
    this._ls = {}; this.disabled = false;
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
  addEventListener: () => {}, body: root,
};
globalThis.window = { addEventListener: () => {}, location: { search: '' } };
globalThis.location = { search: '' };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
globalThis.requestAnimationFrame = () => 0;
globalThis.URLSearchParams = URLSearchParams;

import test from 'node:test';
import assert from 'node:assert/strict';

const toasts = [];
const appUrl = new URL('../../src/web/app.js', import.meta.url);
const rawSrc = readFileSync(appUrl, 'utf8');
// app.js's named imports are re-bound from the real modules, except createController,
// which the factory below stubs with the test controller.
const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const importPrelude = [];
const importedModules = [];
for (const [, names, spec] of rawSrc.matchAll(IMPORT_RE)) {
  const bound = names.split(',').map((n) => n.trim()).filter(Boolean)
    .map((n) => { const [orig, local = orig] = n.split(/\s+as\s+/); return [orig, local]; })
    .filter(([, local]) => local !== 'createController');
  if (!bound.length) continue;
  const mod = await import(new URL(spec, appUrl));
  importPrelude.push(`const { ${bound.map(([o, l]) => (o === l ? o : `${o}: ${l}`)).join(', ')} } = __mods[${importedModules.length}];`);
  importedModules.push(mod);
}
let src = rawSrc
  .replace(/^import\b[\s\S]*?\bfrom\s*['"][^'"]+['"];?[ \t]*$|^import\s*['"][^'"]+['"];?[ \t]*$/gm, '')
  .replace(/\bboot\(\)\s*;?\s*$/, '');
src = src.replace('function toast(msg, kind = \'warn\') {', 'function toast(msg, kind = \'warn\') { __toasts.push(msg);');
src = 'async function measure(){ return null; }\n' + src;
src += '\nreturn { render, clickCard, act, get pendingSlot(){return pendingSlot;}, snapGet(){return snap;}, heroMove, heroPose, HERO_MOVES, MOVE_DEFAULTS, HERO_THROWS, animSpeedGet: () => animSpeed, injectBursts: (b) => { bursts = b; } };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__toasts', '__mods', `
  function createController(){ return __ctl; }
  ${importPrelude.join('\n')}
  ${src}
`);

/** Start a run at the first combat and return { api, ctl }. */
function startRun(seed) {
  const ctl = ctlMod.createController({ run: { seed } });
  ctl.dispatch('n1');
  const api = factory(ctl, toasts, importedModules);
  api.render();
  return { api, ctl };
}

/** The hero's `.fig` node in the freshly painted stage. */
function heroFig() {
  const figs = byId.stage.querySelectorAll('.fig');
  const heroFig = figs.find((f) => f.closest('.hero'));
  assert.ok(heroFig, 'the combat stage renders a hero figure');
  return heroFig;
}

/** Play the card with the given id via the DOM (click, then a target if one is asked). */
function playCard(api, cardId) {
  const hand = api.snapGet().hand || [];
  const card = hand.find((c) => c.cardId === cardId);
  assert.ok(card, `seed deals ${cardId} (hand: ${hand.map((c) => c.cardId).join(', ')})`);
  const btn = byId.stage.querySelector(`[data-slot="${card.slot}"]`);
  assert.ok(btn, `the ${cardId} tile is rendered with data-slot`);
  btn.dispatch('click');
  if (api.pendingSlot !== null) {
    const enemies = byId.stage.querySelectorAll('.enemy');
    assert.ok(enemies.length > 0, 'targeting offers at least one enemy');
    enemies[0].dispatch('click');
  }
}

/**
 * Poses the stylesheet really animates: a `.fig.pose-*` rule whose body declares
 * `animation: <name>` with name !== 'none', where `@keyframes <name>` exists. A mere
 * MENTION of the class (the reduced-motion kill-list, a filter-only `.spr` rule) does
 * not count — this must fail if a keyframe or its animation rule is deleted.
 */
function animatedPoses(css) {
  const decls = new Map();
  for (const m2 of css.matchAll(/\.fig\.pose-([a-z]+)[^{]*\{([^}]*)\}/g)) {
    const a = /animation:\s*([a-zA-Z][\w-]*)/.exec(m2[2]);
    if (a && a[1] !== 'none') decls.set(m2[1], a[1]);
  }
  const kf = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m2) => m2[1]));
  return { decls, kf };
}

const CARDS = JSON.parse(readFileSync(new URL('../../src/kernel/content/cards.json', import.meta.url), 'utf8')).cards;
const CSS = readFileSync(new URL('../../src/web/style.css', import.meta.url), 'utf8');
const { decls: POSE_DECLS, kf: POSE_KEYFRAMES } = animatedPoses(CSS);

function assertPoseAnimated(id, move) {
  assert.ok(POSE_DECLS.has(move), `${id} -> pose-${move} must have a top-level .fig.pose-* rule with an animation declaration`);
  const kfName = POSE_DECLS.get(move);
  assert.ok(POSE_KEYFRAMES.has(kfName), `pose-${move} animates with @keyframes ${kfName}, which must be defined`);
}

test('a basic attack card plays the strike movement', () => {
  const { api } = startRun(11);
  playCard(api, 'strike');
  assert.match(heroFig().className, /pose-strike/, 'Hammerfall lunges (pose-strike)');
});

test('a heavy attack card plays a DIFFERENT movement than the basic strike', () => {
  const { api } = startRun(5);
  playCard(api, 'bash');
  const cls = heroFig().className;
  assert.match(cls, /pose-heavy/, 'Anvil Blow winds up a heavy smash (pose-heavy)');
  assert.doesNotMatch(cls, /pose-strike/, 'the heavy movement is not the plain strike');
});

test('a block card plays the guard movement, not the attack one', () => {
  const { api } = startRun(6);
  playCard(api, 'defend');
  const cls = heroFig().className;
  assert.match(cls, /pose-guard/, 'Quench plants into a guard (pose-guard)');
  assert.doesNotMatch(cls, /pose-strike/, 'no attack movement on a block card');
});

test('the movement dispatch resolves every shipped card to a pose the stylesheet animates', () => {
  const { api } = startRun(11);
  const ids = new Set(CARDS.map((c) => c.id));
  // The five movements this change introduced must each really animate, not merely be
  // named somewhere in the stylesheet (the kill-list mention is not an implementation).
  for (const move of ['heavy', 'flurry', 'sweep', 'guard', 'channel']) {
    assert.ok(POSE_DECLS.has(move), `pose-${move} has an animation declaration in style.css`);
  }
  for (const c of CARDS) {
    const move = api.heroMove({ kind: 'card-fly', id: c.id, type: c.type, name: c.name });
    assert.ok(move, `${c.id} resolves to a movement`);
    assertPoseAnimated(c.id, move);
  }
  for (const key of Object.keys(api.HERO_MOVES)) {
    assert.ok(ids.has(key), `HERO_MOVES key "${key}" is a real card id`);
  }
});

test('an unknown card id falls back to the type-based movement', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'no_such_card', type: 'attack' }), 'strike', 'unknown attack falls back to strike');
  assert.equal(api.heroMove({ id: 'no_such_card', type: 'skill' }), 'brace', 'unknown skill falls back to brace');
  assert.equal(api.heroMove({ id: 'no_such_card', type: 'power' }), 'brace', 'unknown power falls back to brace');
  // A known id overrides its type: bludgeon is an attack, but a 3-cost maul lands heavy.
  assert.equal(api.heroMove({ id: 'bludgeon', type: 'attack' }), 'heavy', 'the per-card entry wins over the type default');
  assert.equal(api.heroMove(null), null, 'no card-fly burst means no movement override');
  // Prototype-chain trap: an id that collides with Object.prototype must not resolve.
  assert.equal(api.heroMove({ id: 'constructor', type: 'attack' }), 'strike', 'an Object.prototype key is not a movement');
});

test('the hurt flinch outranks the card movement when HP was lost (heroPose, not heroMove)', () => {
  const { api } = startRun(11);
  // HP-cost cards (bloodletting, offering, hemokinesis) carry a HERO_MOVES entry, but the
  // hero who just paid HP must flinch, not flourish. heroPose() owns that precedence.
  api.injectBursts([{ kind: 'card-fly', id: 'bloodletting', type: 'skill', name: 'Vein Tap', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'channel', 'without an HP loss, bloodletting reads as its channel movement');
  api.injectBursts([
    { kind: 'card-fly', id: 'bloodletting', type: 'skill', name: 'Vein Tap', side: 'side-none' },
    { kind: 'hero-float', tone: 'dmg', amount: 3, tier: 1 },
  ]);
  assert.equal(api.heroPose(), 'hurt', 'with an HP loss on the same action, the flinch wins over the card movement');
});

test('a hover repaint during the movement hold keeps the pose (the swing is not cut short)', async () => {
  const { api } = startRun(11);
  api.injectBursts([{ kind: 'card-fly', id: 'bash', type: 'attack', name: 'Anvil Blow', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'heavy', 'the fresh burst resolves to the heavy movement');
  // Simulate the very next paint with bursts already cleared (dispatchFx ran): hovering
  // an enemy repaints the stage, and that paint must STILL draw the movement.
  api.injectBursts([]);
  assert.equal(api.heroPose(), 'heavy', 'an incidental repaint during the hold keeps the movement');
  // After the window (0.72s movement + 0.26s hit-stop grace) the hold must be released.
  await new Promise((r) => setTimeout(r, 1100));
  assert.notEqual(api.heroPose(), 'heavy', 'once the window elapses the hold is released');
});

test('a fast consecutive play replaces the still-running hold with the new card movement', () => {
  const { api } = startRun(11);
  api.injectBursts([{ kind: 'card-fly', id: 'bash', type: 'attack', name: 'Anvil Blow', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'heavy');
  api.injectBursts([{ kind: 'card-fly', id: 'defend', type: 'skill', name: 'Quench', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'guard', 'the fresh card play wins over the previous hold');
});

test('throw cards play the throw pose, and HERO_THROWS carries the flight choreography', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'sword_boomerang', type: 'attack' }), 'throw', 'Returning Brand hurls its hammer (throw)');
  assert.equal(api.heroMove({ id: 'hemokinesis', type: 'attack' }), 'throw', 'Blood Hammer is hurled (throw)');
  assert.ok(api.HERO_THROWS.sword_boomerang.returns, 'the Brand hammer returns to the hero');
  assert.ok(!api.HERO_THROWS.hemokinesis.returns, 'the Blood Hammer stays in the target');
  api.injectBursts([{ kind: 'card-fly', id: 'sword_boomerang', type: 'attack', name: 'Returning Brand', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'throw', 'the pose dispatch resolves throw cards to the throw pose');
});

test('a fresh browser with NO stored speed preference defaults to animations ON (1x)', () => {
  // THE BUG THIS PINS: Number(null) is 0, so the old readAnimSpeed() read "never chose"
  // as "chose skip" and shipped with every combat animation off — reported by the owner
  // as "I don't see any change in the characters". With empty localStorage the default
  // must be 1.
  const { api } = startRun(11);
  assert.equal(api.animSpeedGet(), 1, 'no stored preference means animations on at 1x');
});
