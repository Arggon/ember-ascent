// #29 / #53: the short-phone card face and its preview, end to end.
// - Kernel: every card's face (cardFaceLines) carries every number of its full sentence
//   (keyword glosses aside), plain and under every temper; one effect per line, damage/block
//   first, then statuses, then resources.
// - Renderer (the REAL src/web/app.js on the fake DOM of hero-select.test.js): a hand
//   tile's aria-label is the FULL sentence; a long press opens the preview and releasing it
//   does NOT play the card; the one-time long-press hint shows once per profile.
// Line limits, glyph/text sizes, the five-cards-in-view rule, the orb and the fixed stage
// are measured in a real browser by scripts/dev/viewport-check.mjs.
import { readFileSync } from 'node:fs';

let uid = 0;
class N {
  constructor(tag) {
    this.tag = tag; this.uid = uid++; this.kids = []; this.parent = null;
    this.attrs = {}; this._cls = ''; this.txt = ''; this.style = { setProperty(k, v) { this[k] = v; }, removeProperty() {} };
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
    // Fallback: some builders set style on a child obtained before insertion.
    const g = (root && root._all ? root._all() : []).find((n) => m(n, sel));
    return g ?? null;
  }
  querySelectorAll(sel) { return this._all().filter((n) => m(n, sel)); }
  _all() { const o = []; const go = (n) => { for (const k of n.kids) { o.push(k); go(k); } }; go(this); return o; }
  focus() { document.activeElement = this; }
  remove() { if (this.parent) { this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; } }
  get firstElementChild() { return this.kids.find((k) => k.tag !== '#text') ?? null; }
  dispatch(type, extra = {}) {
    const ev = { type, target: this, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this._stop = true; }, ...extra };
    let n = this;
    const chain = [];
    while (n) { chain.push(n); n = n.parent; }
    for (const node of chain) {
      ev.currentTarget = node;
      for (const fn of node._ls[type] || []) { fn(ev); if (ev._stop) return; }
    }
  }
}
function m(n, sel) {
  const a = /^\[data-([a-z-]+)="([^"]*)"\]$/.exec(sel);
  if (a) return n.attrs[`data-${a[1]}`] === a[2];
  if (sel.startsWith('.')) { const have = n._cls.split(/\s+/); return sel.slice(1).split('.').every((c) => have.includes(c)); }
  // Tag selector (e.g. 'i'). Without this the shim cannot find `el('i', {})`, which the
  // renderer queries immediately after building it — a harness gap, not an app bug.
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
  addEventListener: () => {}, body: root, activeElement: null,
};
globalThis.window = { addEventListener: () => {}, location: { search: '?seed=11' } };
globalThis.location = { search: '?seed=11' };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
globalThis.URLSearchParams = URLSearchParams;
globalThis.requestAnimationFrame = () => 0;
// Count act title cards ever ADDED to the fx layer (a run rebuild also clears the layer,
// so a live count would lie).
const fxAdded = [];
{
  const layer = byId['fx-layer'];
  const append = layer.append.bind(layer);
  layer.append = (...c) => { for (const x of c) if (x && x._cls) fxAdded.push(x._cls); append(...c); };
}

import test from 'node:test';
import assert from 'node:assert/strict';

// Layout stubs the preview needs (the fake DOM has no layout engine).
N.prototype.getBoundingClientRect = function () { return { left: 0, top: 500, right: 72, bottom: 600, width: 72, height: 100 }; };
N.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
N.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
N.prototype.contains = function (o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false; };
globalThis.getComputedStyle = () => ({ display: 'flex' });
globalThis.window.innerWidth = 360; globalThis.window.innerHeight = 640;
const docLs = {};
globalThis.document.addEventListener = (t, fn) => { (docLs[t] ||= []).push(fn); };

const appUrl = new URL('../../src/web/app.js', import.meta.url);
const rawSrc = readFileSync(appUrl, 'utf8');
const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const importPrelude = [];
const importedModules = [];
for (const [, names, spec] of rawSrc.matchAll(IMPORT_RE)) {
  const bound = names.split(',').map((n) => n.trim()).filter(Boolean)
    .map((n) => { const [orig, local = orig] = n.split(/\s+as\s+/); return [orig, local]; });
  if (!bound.length) continue;
  const mod = await import(new URL(spec, appUrl));
  importPrelude.push(`const { ${bound.map(([o, l]) => (o === l ? o : `${o}: ${l}`)).join(', ')} } = __mods[${importedModules.length}];`);
  importedModules.push(mod);
}
let src = rawSrc
  .replace(/^import\b[\s\S]*?\bfrom\s*['"][^'"]+['"];?[ \t]*$|^import\s*['"][^'"]+['"];?[ \t]*$/gm, '')
  .replace(/\bboot\(\)\s*;?\s*$/, '');
src = 'async function measure(){ return null; }\n' + src;
src += '\nreturn { render, newGame, snapGet(){ return snap; }, previewOpen(){ return !!previewEl; } };';
const api = new Function('__mods', `${importPrelude.join('\n')}\n${src}`)(importedModules);

import { cardFaceLines, describeCard } from '../../src/kernel/describe.js';
import { TEMPERS, temperEffects, temperHpCost } from '../../src/kernel/rules/tempers.js';
const CARDS = JSON.parse(readFileSync(new URL('../../src/kernel/content/cards.json', import.meta.url), 'utf8')).cards;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const textOf = (n) => (n ? n.txt + n.kids.map(textOf).join('') : '');
const nums = (s) => (s.replace(/ — [^.]*/g, '').match(/\d+/g) || []);
const faceNums = (lines) => lines.flatMap((l) => (String(l.t ?? l.n ?? '').match(/\d+/g) || []));
const RANK = { damage: 0, block: 0, weak: 1, vulnerable: 1, strength: 1, metallicize: 1, hp: 2, energy: 2, draw: 2, discard: 2 };
const rowsOf = (face) => face.filter((l) => !('mark' in l));
const TRIGGERS = ['Turn end:', 'Exhaust:', 'HP lost:', 'Grows:'];
/** Every legal (card, temper) pair: Red-hot only on cards that deal damage. */
const VARIANTS = CARDS.flatMap((def) => [null, ...Object.keys(TEMPERS)]
  .filter((t) => t !== 'redhot' || def.effects.some((e) => e.verb === 'damage'))
  .map((t) => ({ def, t, d: t ? { ...def, effects: temperEffects(def.effects, t) } : def, hp: t ? temperHpCost(t) : 0 })));

test('every number of the full sentence is on the card face; tempered totals are summed right', () => {
  assert.equal(CARDS.length, 44);
  for (const def of CARDS) {
    const full = describeCard(def);
    const have = faceNums(cardFaceLines(def));
    for (const n of nums(full)) assert.ok(have.includes(n), `${def.id}: ${n} from "${full}" missing on face`);
  }
  // Tempered: a repeated glyph is ONE line carrying the summed number (Draw 3 + Draw 1 = +4).
  for (const { def, t, d, hp } of VARIANTS) {
    const face = cardFaceLines(d, {}, hp);
    const now = face.filter((l) => 'g' in l && !l.under);
    const sum = (verb, key) => d.effects.filter((e) => e.verb === verb && (!key || e.status === key)).reduce((a, e) => a + e.amount, 0);
    const val = (g) => now.filter((x) => x.g === g && /^[+-]?\d+$/.test(x.n)).reduce((a, l) => a + Math.abs(Number(l.n)), 0);
    if (d.effects.some((e) => e.verb === 'custom')) continue; // custom handlers: numbers checked on the plain face
    for (const v of ['block', 'draw', 'energy', 'discard']) if (sum(v)) assert.equal(val(v), sum(v), `${def.id}+${t}: ${v} total on ${JSON.stringify(face)}`);
    for (const st of ['weak', 'vulnerable', 'strength', 'metallicize']) if (sum('status', st)) assert.equal(val(st), sum('status', st), `${def.id}+${t}: ${st}`);
    if (hp) assert.ok(now.some((l) => l.g === 'hp' && l.n === `-${hp}`), `${def.id}+${t}: HP cost on the face`);
    for (const e of d.effects.filter((x) => x.verb === 'damage')) assert.ok(faceNums(face).includes(String(e.amount)), `${def.id}+${t}: damage ${e.amount}`);
  }
});

test('EVERY card x temper: <= 4 rows, no repeated glyph, play effects first, triggers last, self-exhaust is a corner mark', () => {
  let over3 = 0;
  for (const { def, t, d, hp } of VARIANTS) {
    const tag = `${def.id}${t ? '+' + t : ''}`;
    const face = cardFaceLines(d, {}, hp);
    const rows = rowsOf(face);
    assert.ok(rows.length >= 1 && rows.length <= 4, `${tag}: ${rows.length} rows ${JSON.stringify(face)}`);
    if (rows.length > 3) over3++;
    if (!t) assert.ok(rows.length <= 3, `${tag}: an untempered card keeps to 3 rows`);
    // A trigger block (word + colon, never a glyph) and its lines come after every play effect.
    const first = rows.findIndex((l) => l.trig);
    if (first >= 0) {
      assert.ok(rows.slice(first).every((l) => l.trig || l.under), `${tag}: a play effect sits under a trigger ${JSON.stringify(face)}`);
      for (const l of rows.filter((x) => x.trig)) assert.ok(TRIGGERS.includes(l.t), `${tag}: trigger word ${l.t}`);
    }
    // No glyph twice among the play effects (numbers merged).
    const now = rows.filter((l) => 'g' in l && !l.under && /^[+-]?\d+$/.test(l.n)).map((l) => l.g + (l.all ? '-all' : ''));
    assert.equal(new Set(now).size, now.length, `${tag}: repeated glyph ${JSON.stringify(face)}`);
    // Self-exhaust: exactly one corner mark, never a line.
    const exhausts = d.effects.some((e) => e.verb === 'exhaust');
    assert.equal(face.filter((l) => l.mark === 'exhaust').length, exhausts ? 1 : 0, `${tag}: exhaust mark`);
    assert.ok(!rows.some((l) => l.g === 'exhaust'), `${tag}: exhaust drawn as a line`);
    // Signs: gains +N, losses -N.
    for (const l of rows.filter((x) => 'g' in x && /^[+-]?\d+$/.test(x.n))) {
      if (['hp', 'discard'].includes(l.g)) assert.match(l.n, /^-/, `${tag}: ${l.g} is a loss`);
      else if (l.g !== 'damage') assert.match(l.n, /^\+/, `${tag}: ${l.g} is a gain`);
    }
  }
  assert.ok(over3 <= 10, `${over3} variants on the 4-row fallback`);
});

test('the four misread tempered faces now read right (#53 P1-2)', () => {
  const f = (id, t) => { const def = CARDS.find((c) => c.id === id); return cardFaceLines({ ...def, effects: temperEffects(def.effects, t) }, {}, temperHpCost(t)); };
  assert.deepEqual(f('rupture', 'quenched'), [{ g: 'block', n: '+3' }, { t: 'HP lost:', trig: true }, { g: 'strength', n: '+1', under: true }]);
  assert.deepEqual(f('combust', 'quenched'), [{ g: 'block', n: '+3' }, { t: 'Turn end:', trig: true }, { g: 'damage', n: '1', all: true, under: true }, { g: 'hp', n: '-1', under: true }]);
  assert.deepEqual(f('dark_embrace', 'balanced'), [{ g: 'draw', n: '+1' }, { t: 'Exhaust:', trig: true }, { g: 'draw', n: '+1', under: true }, { mark: 'exhaust' }]);
  assert.deepEqual(f('offering', 'balanced'), [{ g: 'hp', n: '-6' }, { g: 'energy', n: '+2' }, { g: 'draw', n: '+4' }, { mark: 'exhaust' }]);
  assert.deepEqual(f('uppercut', 'balanced').length, 5); // 4 rows + the corner mark
  // r2: the heal sentence stays under its damage line; the temper's line comes after it.
  assert.deepEqual(f('reaper', 'quenched'), [{ g: 'damage', n: '4', all: true }, { t: 'Heal that much' }, { g: 'block', n: '+3' }]);
  assert.deepEqual(f('reaper', 'balanced'), [{ g: 'damage', n: '4', all: true }, { t: 'Heal that much' }, { g: 'draw', n: '+1' }, { mark: 'exhaust' }]);
  assert.deepEqual(f('rampage', 'quenched').slice(2), [{ t: 'Grows:', trig: true }, { g: 'damage', n: '+5', under: true }]);
});

test('one effect per line, damage/block, then statuses, then resources; ALL only for all-enemy hits', () => {
  for (const def of CARDS) {
    const face = rowsOf(cardFaceLines(def));
    const g = face.filter((l) => 'g' in l);
    if (g.length === face.length && !def.effects.some((e) => e.verb === 'custom' && !['bloodletting', 'hemokinesis', 'offering', 'limit_break', 'entrench'].includes(e.handler))) {
      const ranks = g.map((l) => RANK[l.g]);
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `${def.id}: order ${JSON.stringify(face)}`);
    }
    for (const l of g) if (l.all) assert.ok(def.effects.some((e) => e.target === 'all_enemies' || e.to === 'all_enemies') || /ALL/.test(describeCard(def)), `${def.id}: ALL tag without an all-enemy effect`);
    assert.ok(face.length <= 3, `${def.id}: ${face.length} face lines`);
  }
  assert.deepEqual(cardFaceLines(CARDS.find((c) => c.id === 'uppercut')), [{ g: 'damage', n: '13' }, { g: 'weak', n: '+1' }, { g: 'vulnerable', n: '+1' }]);
  // #56: Forgeclap and Heat Wash give their statuses to ALL living enemies; the face says so.
  assert.deepEqual(cardFaceLines(CARDS.find((c) => c.id === 'thunderclap')), [{ g: 'damage', n: '4', all: true }, { g: 'vulnerable', n: '+1', all: true }]);
  assert.deepEqual(cardFaceLines(CARDS.find((c) => c.id === 'shockwave')), [{ g: 'weak', n: '+3', all: true }, { g: 'vulnerable', n: '+3', all: true }]);
  assert.deepEqual(cardFaceLines(CARDS.find((c) => c.id === 'offering')), [{ g: 'hp', n: '-6' }, { g: 'energy', n: '+2' }, { g: 'draw', n: '+3' }]);
  assert.deepEqual(cardFaceLines(CARDS.find((c) => c.id === 'combust')), [{ t: 'Turn end:', trig: true }, { g: 'damage', n: '1', all: true, under: true }, { g: 'hp', n: '-1', under: true }]);
  assert.deepEqual(cardFaceLines(CARDS.find((c) => c.id === 'pummel')), [{ g: 'damage', n: '2×4' }, { mark: 'exhaust' }]);
});

// Drive the real app into the first fight.
async function toFight(seed) {
  api.newGame(seed, { quiet: true });
  const boon = byId.stage.querySelectorAll('.boon').find((b) => b.attrs['data-action']);
  boon.dispatch('click');
  for (let i = 0; i < 5 && api.snapGet().phase !== 'combat'; i++) {
    const node = root.querySelectorAll('.node').find((n) => n._cls.includes('available'));
    if (!node) break;
    node.dispatch('click');
    await sleep(50);
  }
  assert.equal(api.snapGet().phase, 'combat', 'reached the first fight');
}
const handTiles = () => byId.stage.querySelectorAll('.card').filter((c) => c.attrs['data-slot'] && c.parent && c.parent._cls.includes('card-wrap'));

test('hand tiles: aria-label is the full sentence; the face is aria-hidden glyph lines', async () => {
  await toFight(11);
  const s = api.snapGet();
  const tiles = handTiles();
  assert.equal(tiles.length, s.hand.length);
  s.hand.forEach((c, i) => {
    const label = tiles[i].attrs['aria-label'];
    assert.ok(label.includes(c.description), `${c.name}: aria-label must carry the full sentence`);
    assert.ok(label.startsWith(`${c.name}. ${c.typeLabel || c.type}. `), `${c.name}: aria-label names the card type: ${label}`);
    assert.ok(/damage|Block|Apply|Draw|Gain|Lose|Double/.test(c.description));
    const face = tiles[i].querySelector('.cd-face');
    assert.ok(face, `${c.name}: has a card face`);
    assert.equal(face.attrs['aria-hidden'], 'true');
  });
});

test('touch: a long press opens the preview, it STAYS open after release (which never plays); X or a tap outside closes it', async () => {
  await toFight(11);
  const before = api.snapGet();
  const handN = before.hand.length; const energy = before.player?.energy ?? before.energy;
  const t = handTiles().find((x) => x.attrs['aria-disabled'] === 'false');
  t.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
  await sleep(420);
  assert.ok(api.previewOpen(), 'preview open after ~350ms hold');
  const pv = root.querySelectorAll('.card-preview')[0];
  assert.ok(pv && pv.querySelector('.cp-text'), 'preview carries the full sentence');
  assert.match(textOf(pv.querySelector('.cp-meta')), /^(Attack|Skill|Power|Status|Curse) · \d+ Energy$/, 'preview title carries the type');
  t.dispatch('pointerup', { pointerType: 'touch' });
  assert.ok(api.previewOpen(), 'the preview stays open after the release (touch)');
  t.dispatch('click');
  const after = api.snapGet();
  assert.equal(after.hand.length, handN, 'release after a preview must not play the card');
  assert.equal(after.player?.energy ?? after.energy, energy);
  // The X closes it.
  const x = root.querySelectorAll('.cp-close')[0];
  assert.ok(x && x.attrs['aria-label'] === 'Close preview', 'the preview has an X button');
  x.dispatch('click');
  assert.equal(api.previewOpen(), false, 'X closes the preview');
  // A short tap (no hold) still plays at once.
  const t2 = handTiles().find((x) => x.attrs['aria-disabled'] === 'false');
  t2.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
  t2.dispatch('pointerup', { pointerType: 'touch' });
  t2.dispatch('click');
  const played = api.snapGet();
  assert.ok(played.hand.length < handN || played.pending || (played.player?.energy ?? played.energy) !== energy, 'a plain tap plays (or aims) the card');
});

test('Esc and a tap outside close the preview', async () => {
  await toFight(11);
  const t = handTiles()[0];
  t.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
  await sleep(420);
  assert.ok(api.previewOpen());
  for (const fn of docLs.keydown || []) fn({ key: 'Escape' });
  assert.equal(api.previewOpen(), false, 'Esc closes');
  t.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
  await sleep(420);
  assert.ok(api.previewOpen());
  for (const fn of docLs.pointerdown || []) fn({ target: byId.hud });
  assert.equal(api.previewOpen(), false, 'a tap outside closes');
  t.dispatch('pointerup', { pointerType: 'touch' });
});

test('the long-press hint shows once per profile, on the first battle hand, and a tap or a key dismisses it', async () => {
  delete localStorage._d['dlb.pressHint.v1'];
  await toFight(11);
  await sleep(800);
  const hints = () => root.querySelectorAll('.press-hint');
  assert.equal(hints().length, 1, 'hint shown on the first battle hand');
  assert.match(hints()[0].kids.map((k) => k.txt).join(''), /hold a card/);
  assert.equal(localStorage.getItem('dlb.pressHint.v1'), '1', 'remembered for this profile');
  for (const fn of docLs.keydown || []) fn({ key: 'Tab' });
  assert.equal(hints().length, 0, 'a key dismisses it');
  await toFight(12);
  await sleep(800);
  assert.equal(hints().length, 0, 'never shown again for this profile');
});

test('keyboard: focusing a card opens its preview (full text + glyph names); no aria-describedby (the label already says it); Esc closes', async () => {
  await toFight(11);
  const t = handTiles().find((x) => (api.snapGet().hand.find((c) => c.slot === x.attrs['data-slot']) || {}).face?.some((l) => l.g));
  // A focus that follows a pointer (a re-render after a touch tap, e.g. End Turn) never opens it.
  for (const fn of docLs.pointerdown || []) fn({ target: byId.hud });
  for (const fn of t._ls.focus || []) fn({ type: 'focus', target: t });
  assert.equal(api.previewOpen(), false, 'focus after a touch/pointer input does not open a preview');
  for (const fn of docLs.keydown || []) fn({ key: 'Tab' });
  for (const fn of t._ls.focus || []) fn({ type: 'focus', target: t });
  assert.ok(api.previewOpen(), 'focus opens the preview');
  assert.equal(t.attrs['aria-describedby'], undefined, 'the label carries the sentence; the visual glyph key is not read twice');
  const pv = root.querySelectorAll('.card-preview')[0];
  assert.equal(pv.attrs.id, 'card-preview');
  const card = api.snapGet().hand.find((c) => c.slot === t.attrs['data-slot']);
  const text = pv.querySelector('.cp-text');
  assert.equal(text.kids.map((k) => k.txt).join(''), card.description, 'preview carries the full sentence');
  assert.ok(pv.querySelectorAll('.cp-glyph').length >= 1, 'preview names each glyph');
  for (const fn of docLs.keydown || []) fn({ key: 'Escape' });
  assert.equal(api.previewOpen(), false, 'Esc closes');
  assert.equal(t.attrs['aria-describedby'], undefined);
});

test('a preview closed by a drag leaves no dead tap: the next tap still acts', async () => {
  await toFight(11);
  const t = handTiles()[0];
  t.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
  await sleep(420);
  t.dispatch('pointerup', { pointerType: 'touch' });
  assert.ok(api.previewOpen());
  // Dismiss by a drag on the stage: pointerdown outside, then pointercancel, and NO click.
  for (const fn of docLs.pointerdown || []) fn({ target: byId.hud });
  for (const fn of docLs.pointercancel || []) fn({ target: byId.hud });
  assert.equal(api.previewOpen(), false);
  assert.equal(t._lp, false, 'gesture state cleared on close');
  // The next real tap: a fresh pointerdown, then its click, must NOT be swallowed.
  for (const fn of docLs.pointerdown || []) fn({ target: t });
  let stopped = false;
  const ev = { stopImmediatePropagation() { stopped = true; }, preventDefault() {} };
  for (const fn of docLs.click || []) fn(ev);
  assert.equal(stopped, false, 'the next tap after a drag-dismiss acts');
});

test('glyph tips are remembered for the profile (once ever, not per run)', async () => {
  localStorage.setItem('dlb.pressHint.v1', '1');
  delete localStorage._d['dlb.glyphTips.v1'];
  await toFight(11);
  await sleep(800);
  const seen = JSON.parse(localStorage.getItem('dlb.glyphTips.v1') || '[]');
  // A new run does not forget them.
  await toFight(12);
  await sleep(800);
  const after = JSON.parse(localStorage.getItem('dlb.glyphTips.v1') || '[]');
  for (const k of seen) assert.ok(after.includes(k), 'still remembered after a new run: ' + k);
});

test('an unknown status gets the neutral glyph plus its name, never another status glyph', () => {
  const face = cardFaceLines({ effects: [{ verb: 'status', status: 'frail', amount: 2, to: 'enemy' }] });
  assert.deepEqual(face, [{ g: 'status', n: '+2', label: 'frail' }]);
});

test('reviewer: an outside touch that turns into a scroll (pointercancel, no click) never swallows the next tap', async () => {
  await toFight(11);
  const t = handTiles()[0];
  t.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
  await sleep(420);
  t.dispatch('pointerup', { pointerType: 'touch' });
  for (const fn of docLs.pointerdown || []) fn({ target: byId.hud });
  for (const fn of docLs.pointercancel || []) fn({ target: byId.hud });
  let stopped = false;
  const ev = { stopImmediatePropagation() { stopped = true; }, preventDefault() {} };
  for (const fn of docLs.click || []) fn(ev); // the next tap's click, with no pointerdown seen
  assert.equal(stopped, false, 'pointercancel cleared the swallow');
});

test('the preview is a labelled non-modal dialog', async () => {
  await toFight(11);
  const t = handTiles()[0];
  t.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
  await sleep(420);
  t.dispatch('pointerup', { pointerType: 'touch' });
  const pv = root.querySelectorAll('.card-preview')[0];
  assert.equal(pv.attrs.role, 'dialog');
  assert.equal(pv.attrs['aria-modal'], 'false');
  assert.match(pv.attrs['aria-label'], /full card$/);
  for (const fn of docLs.keydown || []) fn({ key: 'Escape' });
});

test('a tap outside a touch preview only closes it (swallowed), a tap on the previewed card is not', async () => {
  await toFight(11);
  const open = async () => {
    const t = handTiles()[0];
    t.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
    await sleep(420);
    t.dispatch('pointerup', { pointerType: 'touch' });
    return t;
  };
  const clickStopped = () => {
    let stopped = false;
    const ev = { stopImmediatePropagation() { stopped = true; }, preventDefault() {} };
    for (const fn of docLs.click || []) fn(ev);
    return stopped;
  };
  // The REAL order: pointerdown, pointerup, then the click as a later task. (The first version
  // of this test fired the click straight after pointerdown, so a pointerup timer that
  // cleared the block never got to run and the test passed while the browser leaked.)
  const tap = async (target) => {
    for (const fn of docLs.pointerdown || []) fn({ target, pointerType: 'touch' });
    for (const fn of docLs.pointerup || []) fn({ target, pointerType: 'touch' });
    await sleep(0); await sleep(5);
    return clickStopped();
  };
  await open();
  assert.equal(await tap(byId.hud), true, 'the outside tap that closed the preview does nothing else');
  const t = await open();
  assert.equal(await tap(t), false, 'tapping the previewed card plays it');
});
