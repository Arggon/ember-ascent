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
    this.attrs = {}; this._cls = ''; this.txt = ''; this._sty = {};
    this._ls = {}; this.disabled = false;
  }
  // A recording CSSOM stand-in: custom properties go through setProperty (what the
  // melee approach writes), and plain writes are tolerated and dropped, exactly as
  // they were when style was a bare object.
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
import { bundleApp } from '../web/app-bundle.mjs';

const toasts = [];
const appUrl = new URL('../../src/web/app.js', import.meta.url);
// The surface is split into sibling ES modules (src/web/*.js); bundleApp concatenates
// them back into ONE sloppy-mode body — the same evaluation contract this test always
// used — re-binding the kernel/surface imports from the real modules, with
// createController stubbed by the factory below.
const { prelude, body, mods: importedModules } = await bundleApp(appUrl, { stubController: true });
let src = body
  .replace(/\bboot\(\)\s*;?\s*$/, '');
src = src.replace('function toast(msg, kind = \'warn\') {', 'function toast(msg, kind = \'warn\') { __toasts.push(msg);');
src = 'async function measure(){ return null; }\n' + src;
src += '\nreturn { render, clickCard, act, get pendingSlot(){return pendingSlot;}, snapGet(){return snap;}, heroMove, heroPose, HERO_MOVES, MOVE_DEFAULTS, HERO_THROWS, MELEE_APPROACH_MOVES, isMeleeMove, signatureFor, animMs, STRIKE_SEQ, HERO_POSE_MS, heroHold: () => heroMoveHold, animSpeedGet: () => animSpeed, injectBursts: (b) => { bursts = b; } };';

const ctlMod = await import('../../src/surface/gui/controller.js');
const factory = new Function('__ctl', '__toasts', '__mods', `
  function createController(){ return __ctl; }
  ${prelude}
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

/** The hero's `.hero` container — the node the melee approach moves. */
function heroNode() {
  const heroes = byId.stage.querySelectorAll('.hero');
  const hero = heroes.find((n) => n.closest('.fight') || n.closest('.stage-combat'));
  assert.ok(hero, 'the combat stage renders a hero container');
  return hero;
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

test('HAMMERFALL (strike) drops with its own hammerfall movement', () => {
  const { api } = startRun(11);
  playCard(api, 'strike');
  assert.match(heroFig().className, /pose-hammerfall/, 'Hammerfall plays its own vertical drop (pose-hammerfall)');
  assert.doesNotMatch(heroFig().className, /pose-strike/, 'the starter strike no longer rides the plain strike pose');
});

test('a heavy attack card plays a DIFFERENT movement than the basic strike', () => {
  const { api } = startRun(5);
  playCard(api, 'bash');
  const cls = heroFig().className;
  assert.match(cls, /pose-heavy/, 'Anvil Blow winds up a heavy smash (pose-heavy)');
  assert.doesNotMatch(cls, /pose-strike/, 'the heavy movement is not the plain strike');
});

test('QUENCH (defend) pours with its own movement, not the attack one', () => {
  const { api } = startRun(6);
  playCard(api, 'defend');
  const cls = heroFig().className;
  assert.match(cls, /pose-quench/, 'Quench pours its veil (pose-quench)');
  assert.doesNotMatch(cls, /pose-strike/, 'no attack movement on a block card');
});

test('a MELEE stroke carries the hero into the enemy lane (.hero.is-approach)', () => {
  const { api } = startRun(11);
  playCard(api, 'strike');
  const hero = heroNode();
  assert.match(hero.className, /is-approach/, 'a melee stroke steps toward the enemy row');
  assert.match(hero._sty['--approach-dur'], /ms/, 'the approach rides the pose hold length');
  // A host with no layout measures a zero box, so the dispatch-measured distance is the
  // 0px fallback — the point here is that the variable is WRITTEN at all, i.e. the
  // act() -> dispatchFx() measurement path ran for a melee play.
  assert.equal(hero._sty['--approach-x'], '0px', 'the measured distance is written even when no layout exists');
});

test('a THROWN hammer or a cast stays home — no approach on ranged attack moves', () => {
  const { api } = startRun(11);
  // Twin Hammers: two hammers FLY (twinthrow) — the hero does not close.
  api.injectBursts([{ kind: 'card-fly', id: 'twin_strike', type: 'attack', name: 'Twin Hammers', side: 'side-none' }]);
  api.render();
  assert.doesNotMatch(heroNode().className, /is-approach/, 'a thrown hammer is ranged: the hero stays planted');
  // Spark (anger) is a finger-snap cast (snapcast): ranged, no approach.
  api.injectBursts([{ kind: 'card-fly', id: 'anger', type: 'attack', name: 'Spark', side: 'side-none' }]);
  api.render();
  assert.doesNotMatch(heroNode().className, /is-approach/, 'an ember dart is ranged: the hero stays planted');
  // Blood Hammer (hemokinesis) hurls the hammer itself: ranged, no approach.
  api.injectBursts([{ kind: 'card-fly', id: 'hemokinesis', type: 'attack', name: 'Blood Hammer', side: 'side-none' }]);
  api.render();
  assert.doesNotMatch(heroNode().className, /is-approach/, 'Blood Hammer flies: the hero stays planted');
});

test('a skill or power stance never approaches — planting is the point', () => {
  const { api } = startRun(6);
  playCard(api, 'defend');
  assert.doesNotMatch(heroNode().className, /is-approach/, 'Quench plants, it does not step');
  api.injectBursts([{ kind: 'card-fly', id: 'flex', type: 'skill', name: 'Flex', side: 'side-none' }]);
  api.render();
  assert.doesNotMatch(heroNode().className, /is-approach/, 'Flex swells in place');
});

test('the melee-approach set is honest: every move in it animates, and no ranged move sneaks in', () => {
  const { api } = startRun(11);
  for (const move of api.MELEE_APPROACH_MOVES) {
    assert.ok(POSE_DECLS.has(move) || move === 'strike', `melee move "${move}" must be an animated pose (or the type fallback)`);
  }
  for (const ranged of ['throw', 'twinthrow', 'snapcast', 'bellowspush', 'bloodhammer']) {
    assert.equal(api.isMeleeMove(ranged), false, `"${ranged}" is a ranged attack move and must not approach`);
  }
  assert.equal(api.isMeleeMove('hammerfall'), true, 'Hammerfall closes');
  assert.equal(api.isMeleeMove('guard'), false, 'a guard stance stays planted');
  // The approach itself must really animate: the rule exists and its keyframes too.
  assert.match(CSS, /\.hero\.is-approach[^{]*\{[^}]*animation:\s*hero-approach/, '.hero.is-approach must animate hero-approach');
  assert.ok([...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].some((m) => m[1] === 'hero-approach'), '@keyframes hero-approach must be defined');
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
  // A known id overrides its type. (Maul/bludgeon now has its OWN colossal signature —
  // covered by the dedicated test below — so the override example here is Returning Brand.)
  assert.equal(api.heroMove({ id: 'sword_boomerang', type: 'attack' }), 'throw', 'the per-card entry wins over the type default');
  assert.equal(api.heroMove(null), null, 'no card-fly burst means no movement override');
  // Prototype-chain trap: an id that collides with Object.prototype must not resolve.
  assert.equal(api.heroMove({ id: 'constructor', type: 'attack' }), 'strike', 'an Object.prototype key is not a movement');
});

test('the hurt flinch outranks the card movement when HP was lost (heroPose, not heroMove)', () => {
  const { api } = startRun(11);
  // HP-cost cards (bloodletting, offering, hemokinesis) carry a HERO_MOVES entry, but the
  // hero who just paid HP must flinch, not flourish. heroPose() owns that precedence.
  api.injectBursts([{ kind: 'card-fly', id: 'bloodletting', type: 'skill', name: 'Vein Tap', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'veintap', 'without an HP loss, bloodletting reads as its vein-tap movement');
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
  // After the window the hold must be released. The window is the pose's PACED length
  // (UX-4: animMs(720) = 1440ms at 1×) plus the 260ms hit-stop grace, so the probe waits
  // past 1700ms — the same claim at the halved pace, not a weaker one.
  await new Promise((r) => setTimeout(r, 1800));
  assert.notEqual(api.heroPose(), 'heavy', 'once the window elapses the hold is released');
});

test('a fast consecutive play replaces the still-running hold with the new card movement', () => {
  const { api } = startRun(11);
  api.injectBursts([{ kind: 'card-fly', id: 'bash', type: 'attack', name: 'Anvil Blow', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'heavy');
  api.injectBursts([{ kind: 'card-fly', id: 'defend', type: 'skill', name: 'Quench', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'quench', 'the fresh card play wins over the previous hold');
});

test('a MULTI-HIT play\u2019s pose hold outlives the single-pose window — the strike-sequence extension (golpes discretos)', () => {
  // fx.js beats out one float per golpe on the STRIKE_SEQ clock and playInputSpan holds
  // the INPUT past the pose; the pose hold itself must take the SAME extension, or the
  // hero falls back to pose-idle while golpes 2..M still land ("pose + impacto + float
  // propio por CADA golpe" — the fx.js contract comment). The math is shared verbatim
  // with playInputSpan: beats to the last golpe + its impact + a short float-rise beat.
  const { api } = startRun(11);
  // Cinder Flick: three golpes.
  api.injectBursts([{ kind: 'card-fly', id: 'cinder_flick', type: 'attack', name: 'Cinder Flick', side: 'side-none', strikes: [{}, {}, {}] }]);
  assert.equal(api.heroPose(), 'strike');
  const plain = api.animMs(api.HERO_POSE_MS.strike);
  const extended = api.animMs(api.STRIKE_SEQ.beat) * 2
    + api.animMs(Math.round(api.STRIKE_SEQ.slam * api.STRIKE_SEQ.impactAt))
    + api.animMs(300);
  assert.ok(extended > plain, `the sequence outlives the single pose (paced ${extended} vs ${plain})`);
  assert.equal(api.heroHold().dur, extended, 'the hold is the strike extension, not the bare pose');
  // A single-golpe play keeps the plain pose duration — the extension only exists to
  // cover golpes 2..M.
  api.injectBursts([{ kind: 'card-fly', id: 'cinder_flick', type: 'attack', name: 'Cinder Flick', side: 'side-none', strikes: [{}] }]);
  api.heroPose();
  assert.equal(api.heroHold().dur, plain, 'one golpe: the plain paced pose duration');
  // No strikes facts at all (a play whose damage never rode the `damage` verb) — the
  // plain duration, byte-identical to the pre-slice behavior.
  api.injectBursts([{ kind: 'card-fly', id: 'bash', type: 'attack', name: 'Anvil Blow', side: 'side-none' }]);
  api.heroPose();
  assert.equal(api.heroHold().dur, api.animMs(api.HERO_POSE_MS.heavy), 'no strikes facts: the plain paced pose duration');
});

test('MAUL (bludgeon) plays its own colossal signature move, not the shared heavy', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'bludgeon', type: 'attack' }), 'colossal', 'Maul resolves to its own colossal pose');
  assert.equal(api.heroMove({ id: 'bash', type: 'attack' }), 'heavy', 'other heavies are untouched');
  api.injectBursts([{ kind: 'card-fly', id: 'bludgeon', type: 'attack', name: 'Maul', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'colossal');
  // The signature knobs drive the hold and the impact beat.
  const sig = api.signatureFor({ kind: 'card-fly', id: 'bludgeon', type: 'attack' });
  assert.ok(sig && sig.poseMs === 1150 && sig.shake && sig.shockwave, 'Maul signature: 1150ms hold, shake, shockwave');
  // shockwave (Heat Wash) left this row for its own LOTE 6 signature — the no-knob
  // example here is Returning Brand, whose flight choreography lives in HERO_THROWS.
  assert.equal(api.signatureFor({ kind: 'card-fly', id: 'sword_boomerang', type: 'attack' }), null, 'non-signature cards have no knobs');
});

test('ANVIL BLOW (bash) drops the spectral anvil on its heavy stroke', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'bash', type: 'attack' }), 'heavy', 'Anvil Blow keeps the heavy body motion');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'bash', type: 'attack' });
  assert.ok(sig && sig.anvil, 'Anvil Blow signature: the anvil drop knob');
  assert.ok(!sig.shake && !sig.shockwave, 'Anvil Blow does not steal Maul\'s stage shake');
});

test('TWIN HAMMERS (twin_strike) throws a salvo of two hammers, not the flurry', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'twin_strike', type: 'attack' }), 'twinthrow', 'Twin Hammers has its own two-throw pose');
  assert.equal(api.heroMove({ id: 'pummel', type: 'attack' }), 'hailblows', "Pummel hails its own four blows, not the flurry");
  const sig = api.signatureFor({ kind: 'card-fly', id: 'twin_strike', type: 'attack' });
  assert.ok(sig && sig.twin, 'Twin Hammers signature: the two-hammer salvo knob');
  api.injectBursts([{ kind: 'card-fly', id: 'twin_strike', type: 'attack', name: 'Twin Hammers', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'twinthrow');
});

test('SUNDER (carnage) rends the air with a vertical cleave', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'carnage', type: 'attack' }), 'rend', 'Sunder has its own rending pose');
  assert.equal(api.heroMove({ id: 'rampage', type: 'attack' }), 'climbcut', 'Rampage climbs its own diagonal stroke');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'carnage', type: 'attack' });
  assert.ok(sig && sig.rend, 'Sunder signature: the burning-seam knob');
  api.injectBursts([{ kind: 'card-fly', id: 'carnage', type: 'attack', name: 'Sunder', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'rend');
});

test('RISING BLOW (uppercut) lifts the aimed enemy off its stance', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'uppercut', type: 'attack' }), 'uppercut', 'Rising Blow has its own uppercut pose');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'uppercut', type: 'attack' });
  assert.ok(sig && sig.launch, 'Rising Blow signature: the launch knob');
  api.injectBursts([
    { kind: 'card-fly', id: 'uppercut', type: 'attack', name: 'Rising Blow', side: 'side-none', enemy: 1 },
  ]);
  assert.equal(api.heroPose(), 'uppercut');
  // The burst carries the aimed enemy index so the launch finds the RIGHT mob.
  const burst = api.snapGet() && { kind: 'card-fly', id: 'uppercut', enemy: 1 };
  assert.ok(burst && burst.enemy === 1, 'the card-fly burst carries the aimed enemy index');
});

/* ---- LOTE 1 — mazo inicial y ataques básicos: one movement per card. ---- */

test('HAMMERFALL (strike) holds the apex and cracks the lane with dust', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'strike', type: 'attack' }), 'hammerfall', 'Hammerfall has its own vertical-drop pose');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'strike', type: 'attack' });
  assert.ok(sig && sig.dustcrack, 'Hammerfall signature: the dust-crack knob');
  api.injectBursts([{ kind: 'card-fly', id: 'strike', type: 'attack', name: 'Hammerfall', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'hammerfall');
  assert.equal(api.heroMove({ id: 'anger', type: 'attack' }), 'snapcast', 'Spark left the shared strike row');
});

test('QUENCH (defend) pours a steam veil, not the guard dome', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'defend', type: 'skill' }), 'quench', 'Quench has its own pouring pose');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'defend', type: 'skill' });
  assert.ok(sig && sig.quenchveil, 'Quench signature: the steam-veil knob');
  api.injectBursts([{ kind: 'card-fly', id: 'defend', type: 'skill', name: 'Quench', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'quench');
});

test('BELLOWS GUST (gust) pushes the whole row with a wind cone', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'gust', type: 'attack' }), 'bellowspush', 'Bellows Gust has its own two-armed push pose');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'gust', type: 'attack' });
  assert.ok(sig && sig.gustcone, 'Bellows Gust signature: the wind-cone knob');
  api.injectBursts([{ kind: 'card-fly', id: 'gust', type: 'attack', name: 'Bellows Gust', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'bellowspush');
});

test('SPARK (anger) snapcasts a dart out and a mote back', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'anger', type: 'attack' }), 'snapcast', 'Spark has its own finger-snap pose');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'anger', type: 'attack' });
  assert.ok(sig && sig.sparkdart, 'Spark signature: the dart-and-mote knob');
  api.injectBursts([{ kind: 'card-fly', id: 'anger', type: 'attack', name: 'Spark', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'snapcast');
});

test('FAN THE FLAMES (fan_flames) fans three tongues and sparks the orb', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'fan_flames', type: 'skill' }), 'fanflames', 'Fan the Flames has its own fanning pose');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'fan_flames', type: 'skill' });
  assert.ok(sig && sig.flarefan, 'Fan the Flames signature: the flare-fan knob');
  api.injectBursts([{ kind: 'card-fly', id: 'fan_flames', type: 'skill', name: 'Fan the Flames', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'fanflames');
});

test('throw cards play the throw pose, and HERO_THROWS carries the flight choreography', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'sword_boomerang', type: 'attack' }), 'throw', 'Returning Brand hurls its hammer (throw)');
  assert.equal(api.heroMove({ id: 'hemokinesis', type: 'attack' }), 'bloodhammer', 'Blood Hammer condenses, then hurls (bloodhammer)');
  assert.ok(api.HERO_THROWS.sword_boomerang.returns, 'the Brand hammer returns to the hero');
  assert.ok(!api.HERO_THROWS.hemokinesis.returns, 'the Blood Hammer stays in the target');
  assert.ok(api.HERO_THROWS.hemokinesis.delayMs > 0, 'the Blood Hammer flight waits for the clot to close');
  assert.ok(api.HERO_THROWS.hemokinesis.blood, 'the Blood Hammer flight wears the ember-blood tint');
  api.injectBursts([{ kind: 'card-fly', id: 'sword_boomerang', type: 'attack', name: 'Returning Brand', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'throw', 'the pose dispatch resolves throw cards to the throw pose');
});

/* ---- LOTE 3 — ataques comunes II: one movement per common attack. ---- */

test('FORGECLAP (thunderclap) clashes overhead and marks the whole row', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'thunderclap', type: 'attack' }), 'forgeclap', 'Forgeclap has its own overhead-clash pose');
  assert.equal(api.heroMove({ id: 'reaper', type: 'attack' }), 'reapsweep', 'Reaper harvests with its own ash-scythe sweep');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'thunderclap', type: 'attack' });
  assert.ok(sig && sig.forgering, 'Forgeclap signature: the forgering knob');
  api.injectBursts([{ kind: 'card-fly', id: 'thunderclap', type: 'attack', name: 'Forgeclap', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'forgeclap');
});

test('UNTEMPERED (wild_strike) flails without form, cracks around the lane', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'wild_strike', type: 'attack' }), 'wildflail', 'Untempered has its own wild-flail pose');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'wild_strike', type: 'attack' });
  assert.ok(sig && sig.wildcracks, 'Untempered signature: the wild-cracks knob');
  api.injectBursts([{ kind: 'card-fly', id: 'wild_strike', type: 'attack', name: 'Untempered', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'wildflail');
});

test('BELLOWS (flex) swells the chest with one ember pulse', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'flex', type: 'skill' }), 'bellowsflex', 'Bellows has its own chest-swell pose');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'flex', type: 'skill' });
  assert.ok(sig && sig.chestpulse, 'Bellows signature: the chest-pulse knob');
  api.injectBursts([{ kind: 'card-fly', id: 'flex', type: 'skill', name: 'Bellows', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'bellowsflex');
});

test('HEEL DROP (dropkick) launches feet-first and sparks the orb', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'dropkick', type: 'attack' }), 'dropkick', 'Heel Drop has its own airborne pose');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'dropkick', type: 'attack' });
  assert.ok(sig && sig.heelburst, 'Heel Drop signature: the heel-burst knob');
  api.injectBursts([{ kind: 'card-fly', id: 'dropkick', type: 'attack', name: 'Heel Drop', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'dropkick');
});

test('BLOOD HAMMER (hemokinesis) condenses at the chest before the flight', () => {
  const { api } = startRun(11);
  assert.equal(api.heroMove({ id: 'hemokinesis', type: 'attack' }), 'bloodhammer', 'Blood Hammer has its own condense-and-heave pose');
  const sig = api.signatureFor({ kind: 'card-fly', id: 'hemokinesis', type: 'attack' });
  assert.ok(sig && sig.bloodcondense, 'Blood Hammer signature: the blood-condense knob');
  api.injectBursts([{ kind: 'card-fly', id: 'hemokinesis', type: 'attack', name: 'Blood Hammer', side: 'side-none' }]);
  assert.equal(api.heroPose(), 'bloodhammer');
});

test('a fresh browser with NO stored speed preference defaults to animations ON (1x)', () => {
  // THE BUG THIS PINS: Number(null) is 0, so the old readAnimSpeed() read "never chose"
  // as "chose skip" and shipped with every combat animation off — reported by the owner
  // as "I don't see any change in the characters". With empty localStorage the default
  // must be 1.
  const { api } = startRun(11);
  assert.equal(api.animSpeedGet(), 1, 'no stored preference means animations on at 1x');
});
