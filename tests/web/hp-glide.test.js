// barra de vida por golpe: the glide RESUME. A repaint mid-step used to restart the
// bar's width transition from the glide's FROM-value: the fresh node re-eased the whole
// step the eye had partly watched (owner report: the bar visibly climbed back up before
// settling — the repro's repaint landed ~660ms after the fire, past the 420ms settle).
// These pins drive the REAL src/web/runtime.js against a minimal fake DOM — the shape
// input-lock.test.js builds — with one addition the resume contract needs: a host WITH
// layout (`offsetWidth`), which is exactly what the narrow harnesses lack and why
// runtime.resumeHpGlides skips them by design.
//
// WHAT IS PINNED:
//   * the glide record: applyHpStep arms started/until/duration coherently (ONE clock),
//     and the duration models the stylesheet's own `--dur-slow` (0.42s, style.css) —
//     the length the transition the eye watches actually runs;
//   * the interpolator: mid-glide, paintHpFill paints BETWEEN from and to, and the
//     painted position moves monotonically toward `to` as the clock advances — a
//     repaint can never show a position behind the one the eye had already seen;
//   * the resume: resumeHpGlides writes the target with the transition-duration set to
//     the REMAINING time (the final stretch keeps the real rhythm, not a fresh
//     var(--dur-slow)), and the paced cleanup hands the duration back to the
//     stylesheet ('') once the glide expires;
//   * the settle: past the glide the paint falls back to the plain shown value, and an
//     expired glide resumes nothing.
//
// The harness has no fake clock: Date.now is the real one, so the timed pins reset the
// glide's `started`/`until` arm right before the sampled span (the test owns the trail
// object) and wait real sleeps inside the 420ms window.
let uid = 0;
class N {
  constructor(tag) {
    this.tag = tag; this.uid = uid++; this.kids = []; this.parent = null;
    this.attrs = {}; this._cls = ''; this.txt = '';
    // A PERSISTENT style object: production writes `fill.style.width = '40%'` as a plain
    // property and the assertions read it back. (input-lock's harness rebuilds the
    // object per access — its writes are never read, so it never noticed.)
    const sty = {};
    this.style = {
      setProperty: (k, v) => { sty[k] = String(v); },
      getPropertyValue: (k) => sty[k] ?? '',
    };
    // A host WITH layout: the resume's reflow branch (`typeof offsetWidth === 'number'`)
    // is the contract under test — the layout-less harnesses skip it on purpose.
    this.offsetWidth = 0;
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
  append(...c) { for (let x of c) if (x != null) { x.parent = this; this.kids.push(x); } }
  replaceChildren(...c) { this.kids = []; this.append(...c); }
  /** A subtree matcher for exactly the selectors the hp-trail code speaks: class parts
   *  (`'.fight .hero'`), tags (`'i'`), and one child link (`'.hpbar > i'`). Matches
   *  right-to-left; the node it SELECTS is always the one matching the LAST link. */
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const links = sel.trim().split(/\s+/);
    const matchPart = (n, part) => part.split('.').every((seg) => !seg || n.tag === seg || n._cls.split(/\s+/).includes(seg));
    /** Does the chain links[0..i] hold above-or-at `n`? Returns `n` when it does — the
     *  rightmost link's node is the one the selector selects. */
    const from = (n, i) => {
      for (let cur = n; cur; cur = cur.parent) {
        if (!matchPart(cur, links[i])) continue;
        if (i === 0) return n;
        if (links[i - 1] === '>') {
          if (cur.parent && matchPart(cur.parent, links[i - 2])) {
            if (i - 2 === 0 || from(cur.parent, i - 2)) return n;
          }
          continue;
        }
        if (from(cur, i - 1)) return n;
      }
      return null;
    };
    const all = [];
    const go = (n) => { for (const k of n.kids) { all.push(k); go(k); } };
    go(this);
    return all.map((n) => from(n, links.length - 1)).filter(Boolean);
  }
}

const root = new N('body');
const byId = {};
for (const id of ['hud', 'stage', 'toast', 'live', 'fx-layer']) { const d = new N('div'); d._cls = id; byId[id] = d; root.append(d); }
globalThis.document = { getElementById: (id) => byId[id] ?? null };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };

const rt = await import('../../src/web/runtime.js');
const { setHpTrail, applyHpStep, paintHpFill, resumeHpGlides, hpGlideCurrent, hpDisplay } = rt;

import test from 'node:test';
import assert from 'node:assert/strict';

const el = (tag, cls = '') => { const n = new N(tag); if (cls) n.className = cls; return n; };
const pct = (n) => Number.parseInt(String(n.style.width), 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A trail with one armed unit at max 100 — the shape actions.js arms, minus the
 *  kernel-driven rows this file never reads. */
const mkTrail = (key) => ({
  start: Date.now(),
  pre: [],
  reveal: [],
  units: new Map([[key, { start: 100, max: 100, current: null, applied: [] }]]),
});

test('applyHpStep arms a coherent glide record; the paint interpolates where the eye is', async () => {
  setHpTrail(null);
  const trail = mkTrail('e0');
  setHpTrail(trail);
  applyHpStep('e0', 60);
  const unit = trail.units.get('e0');
  assert.ok(unit.glide, 'the step armed a glide');
  const g = unit.glide;
  assert.equal(g.from, 100, 'the glide starts where the bar was painted');
  assert.equal(g.to, 60, 'the glide targets the step HP');
  assert.equal(g.until - g.started, g.duration, 'ONE clock: the window is the recorded duration');
  // 420ms: the stylesheet's own `--dur-slow` on `.hpbar > i` (style.css). The glide's
  // clock must equal the transition the eye watches — a longer window would keep
  // interpolating BEHIND the bar's own settle (a backward jump, the old bug).
  assert.equal(g.duration, 420, `the glide duration models --dur-slow (${g.duration}ms)`);
  // Reset the clock arm so the samples below read a deterministic position.
  const t0 = Date.now();
  trail.units.get('e0').glide = { ...g, started: t0, until: t0 + g.duration };
  await sleep(180);
  const v1 = hpGlideCurrent('e0').value;
  const fill = el('i');
  paintHpFill(fill, 'e0', hpDisplay('e0'), 100);
  const w1 = pct(fill);
  assert.ok(w1 > 60 && w1 < 100, `mid-glide the paint sits BETWEEN from and to (${w1}% in (60, 100))`);
  await sleep(90);
  const v2 = hpGlideCurrent('e0').value;
  paintHpFill(fill, 'e0', hpDisplay('e0'), 100);
  const w2 = pct(fill);
  assert.ok(w2 > 60 && w2 < 100, `still between (${w2}%)`);
  assert.ok(v2 < v1, `the interpolated position moves monotonically toward \`to\` (${v1.toFixed(1)} -> ${v2.toFixed(1)})`);
  assert.ok(w2 <= w1, `the painted width never regresses (${w1}% -> ${w2}%)`);
  // Past the window the glide is gone: the paint falls back to the shown value — the
  // repro's settle frame, the bar at rest at the right width.
  await sleep(220);
  assert.equal(hpGlideCurrent('e0'), null, 'the glide expired');
  paintHpFill(fill, 'e0', hpDisplay('e0'), 100);
  assert.equal(fill.style.width, '60%', 'past the glide the paint is the plain shown value');
  setHpTrail(null);
});

test('resumeHpGlides writes the target on the remaining duration; the cleanup restores the stylesheet', async () => {
  setHpTrail(null);
  // The host the resume resolves through: stage > .fight > .hero > .hpbar > i (the same
  // selector hpUnitHost speaks for the hero key).
  const stage = byId.stage;
  stage.replaceChildren();
  const fight = el('div', 'fight');
  const hero = el('div', 'hero');
  const ehp = el('div', 'ehp');
  const bar = el('div', 'hpbar');
  const fill = el('i');
  bar.append(fill);
  hero.append(ehp, bar);
  fight.append(hero);
  stage.append(fight);

  const trail = mkTrail('p');
  setHpTrail(trail);
  applyHpStep('p', 60); // arms the glide AND fires the live-node write (hpWriteBar)
  const unit = trail.units.get('p');
  assert.ok(unit.glide, 'the step armed the glide on the hero unit');
  assert.equal(fill.style.width, '60%', 'the fire-time write put the target on the live node');

  // The PAINT half: a fresh tree (the repaint) catches the glide mid-flight and starts
  // the new node where the eye is — strictly between from and to.
  const g = unit.glide;
  const t0 = Date.now();
  trail.units.get('p').glide = { ...g, started: t0, until: t0 + g.duration };
  await sleep(180); // mid-window: the interpolation has real progress to paint
  const freshFill = el('i');
  bar.replaceChildren(freshFill);
  paintHpFill(freshFill, 'p', hpDisplay('p'), 100);
  const mid = pct(freshFill);
  assert.ok(mid > 60 && mid < 100, `the fresh node painted a mid-glide width (${mid}%)`);

  // The RESUME half: commit the painted position, write the target on the REMAINING
  // time — not on a fresh var(--dur-slow), the full restart that replayed the motion.
  resumeHpGlides();
  assert.equal(freshFill.style.width, '60%', 'the resume wrote the target');
  const dur = String(freshFill.style.transitionDuration ?? '');
  assert.match(dur, /ms$/, `the resume set an inline transition-duration (${JSON.stringify(dur)})`);
  const ms = Number.parseFloat(dur);
  assert.ok(ms > 0 && ms <= 420, `the duration is the REMAINING glide time (${ms}ms of 420)`);

  // The CLEANUP: once the glide expires the inline duration hands back to the
  // stylesheet ('') — the next fire-time write must run at the standard pace again.
  await sleep(ms + 150);
  assert.equal(String(freshFill.style.transitionDuration ?? ''), '', 'the cleanup restored the stylesheet duration');
  // An expired glide resumes nothing: the settled bar is left alone.
  resumeHpGlides();
  assert.equal(freshFill.style.width, '60%', 'the expired glide left the settled width alone');
  assert.equal(String(freshFill.style.transitionDuration ?? ''), '', 'and no duration came back');
  setHpTrail(null);
});

test('a fire-time write between a resume and its cleanup restores the stylesheet rhythm', () => {
  setHpTrail(null);
  // The reviewer's race: a golpe firing INSIDE the resumed window (tail steps fire
  // animMs(160) apart — fx.js — both inside one 420ms glide) would write its width over
  // the OLD inline remaining duration, the eye would settle off the glide's clock, and
  // a later interpolated paint would land BEHIND it (the backward-jump class again).
  // hpWriteBar therefore clears the inline duration before every width write.
  const stage = byId.stage;
  stage.replaceChildren();
  const fight = el('div', 'fight');
  const hero = el('div', 'hero');
  const bar = el('div', 'hpbar');
  const fill = el('i');
  bar.append(fill);
  hero.append(el('div', 'ehp'), bar);
  fight.append(hero);
  stage.append(fight);

  const trail = mkTrail('p');
  setHpTrail(trail);
  applyHpStep('p', 60);
  const unit = trail.units.get('p');
  const g = unit.glide;
  const t0 = Date.now();
  unit.glide = { ...g, started: t0, until: t0 + g.duration };
  // Resume mid-window: the node now carries the inline REMAINING duration...
  resumeHpGlides();
  assert.match(String(fill.style.transitionDuration ?? ''), /ms$/, 'the resume left an inline duration on the live node');
  // ...and the next golpe fires before its cleanup: the fire-time write must run the
  // stylesheet's own --dur-slow, not the resumed tail.
  applyHpStep('p', 50);
  assert.equal(String(fill.style.transitionDuration ?? ''), '', 'the fire-time write cleared the inline duration first');
  assert.equal(fill.style.width, '50%', 'and wrote the new step on the standard rhythm');
  setHpTrail(null);
});

test('paint fallbacks: no trail paints the shown value; an expired glide paints it too', () => {
  setHpTrail(null);
  const fill = el('i');
  paintHpFill(fill, 'p', 80, 100);
  assert.equal(fill.style.width, '80%', 'no trail: the plain shown value');
  const trail = mkTrail('e0');
  setHpTrail(trail);
  const now = Date.now();
  trail.units.get('e0').glide = { from: 100, to: 60, started: now - 1000, until: now - 1, duration: 420 };
  paintHpFill(fill, 'e0', 60, 100);
  assert.equal(fill.style.width, '60%', 'an expired glide paints the shown (settled) value');
  setHpTrail(null);
});
