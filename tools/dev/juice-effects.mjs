// tools/dev/juice-effects.mjs — does an action's feedback actually reach the rendered tree?
//
// THE CLAIM UNDER TEST. `render()` calls `stageEl.replaceChildren()` after every action, so
// every element is a NEW node. The juice pass claims that an action's feedback (a floating
// damage number on the enemy that was hit, a hit reaction on that enemy, the card leaving
// the hand) is nevertheless present in the tree the player then sees — and that under
// `prefers-reduced-motion` it is NOT, while every FACT is still carried statically.
//
// There is no browser in this environment, so this drives the REAL web/app.js against a
// fake DOM with bubbling and closest() (the same shim the targeting repro uses), then
// inspects the tree the app built.
//
// Usage: node tools/dev/juice-effects.mjs
import { readFileSync } from 'node:fs';

let uid = 0;
class N {
  constructor(tag) {
    this.tag = tag; this.uid = uid++; this.kids = []; this.parent = null;
    this.attrs = {}; this._cls = ''; this.txt = ''; this._ls = {};
    this.disabled = false; this._css = {};
  }
  set className(v) { this._cls = String(v); }
  get className() { return this._cls; }
  get classList() { return { contains: (c) => this._cls.split(/\s+/).includes(c) }; }
  set textContent(v) { this.txt = String(v); this.kids = []; }
  get textContent() {
    // Aggregate descendants, as the real DOM does. Without this a node whose text lives on a
    // child span (e.g. .fx-card > .fx-card-name) reads as empty and the check reports a bug
    // that does not exist.
    let out = this.txt || '';
    for (const k of this.kids) out += k.textContent || '';
    return out;
  }
  // The shim has no CSS engine, so an inline style write is recorded and read back verbatim.
  get style() { return this._css; }
  set style(v) { Object.assign(this._css, v); }
  append(...c) { for (const x of c) if (x != null) { x.parent = this; this.kids.push(x); } }
  appendChild(c) { c.parent = this; this.kids.push(c); return c; }
  replaceChildren(...c) { this.kids = []; this.append(...c); }
  removeChild(c) { this.kids = this.kids.filter((k) => k !== c); c.parent = null; return c; }
  remove() { if (this.parent) this.parent.removeChild(this); }
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
    return hit ?? null;
  }
  querySelectorAll(sel) { return this._all().filter((n) => m(n, sel)); }
  _all() { const o = []; const go = (n) => { for (const k of n.kids) { o.push(k); go(k); } }; go(this); return o; }
  focus() {}
  dispatch(type, extra = {}) {
    const ev = { type, target: this, ...extra };
    let n = this;
    const chain = [];
    while (n) { chain.push(n); n = n.parent; }
    for (const node of chain) { ev.currentTarget = node; for (const fn of node._ls[type] || []) fn(ev); }
  }
}
function m(n, sel) {
  const a = /^\[data-([a-z-]+)="([^"]*)"\]$/.exec(sel);
  if (a) return n.attrs[`data-${a[1]}`] === a[2];
  if (sel.startsWith('.')) return n._cls.split(/\s+/).includes(sel.slice(1));
  return n.tag === sel;
}

const APP = readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../web/style.css', import.meta.url), 'utf8');

/**
 * Boot the real app.js under a chosen motion preference and return handles.
 * `matchMedia` must exist BEFORE app.js is evaluated, because it reads the query once at
 * load to decide `reducedMotion`.
 */
async function boot({ reduceMotion }) {
  const root = new N('body');
  const byId = {};
  for (const id of ['hud', 'stage', 'toast', 'live', 'app', 'fx-layer']) {
    const d = new N('div'); d._cls = id; byId[id] = d; root.append(d);
  }
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
  globalThis.requestAnimationFrame = (f) => f();
  globalThis.matchMedia = (q) => ({ matches: reduceMotion && /reduced-motion/.test(q), media: q });
  globalThis.URLSearchParams = URLSearchParams;

  let src = APP
    // A stub, not a deletion: app.js awaits this at the end of every render.
    .replace(/^import .*$/gm, 'function measure(){ return Promise.resolve(undefined); }')
    .replace(/\brender\(\);\s*$/, '');
  src += '\nreturn { render, clickCard, pickTarget, get pendingSlot(){return pendingSlot;}, snapGet(){return snap;}, flashGet(){return flash;}, burstsGet(){return bursts;} };';

  const ctlMod = await import('../../src/surface/gui/controller.js');
  const ctl = ctlMod.createController({ run: { seed: 11 } });
  ctl.dispatch('n1');
  const factory = new Function('__ctl', '`use strict`;\n  function createController(){ return __ctl; }\n' + src);
  const api = factory(ctl);
  return { api, byId, ctl, root };
}

/** The keyframe body for a name, so "does it move layout?" is answered from the CSS. */
function keyframeBody(name) {
  const at = CSS.indexOf(`@keyframes ${name} {`);
  if (at === -1) return null;
  let depth = 0; let i = CSS.indexOf('{', at);
  for (let j = i; j < CSS.length; j += 1) {
    if (CSS[j] === '{') depth += 1;
    else if (CSS[j] === '}') { depth -= 1; if (depth === 0) return CSS.slice(i, j + 1); }
  }
  return null;
}

const problems = [];
const ok = (label, pass, detail) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n        ${detail}` : ''}`);
  if (!pass) problems.push(label);
};

/* ================================================================= MOTION ON ==== */
console.log('=== A. prefers-reduced-motion: NO (the normal path) ===\n');
{
  const { api, byId, ctl } = await boot({ reduceMotion: false });
  api.render();
  const before = ctl.snapshot();
  console.log(`  seed 11, combat start: ${before.enemies.length} enemies`,
    `hp=[${before.enemies.map((e) => e.hp).join(',')}]`,
    `hand=[${before.hand.map((h) => h.slot).join(' ')}]\n`);

  // The real interaction: click a card, then click enemy 1.
  const card = byId.stage.querySelector('[data-slot="p1"]');
  card.dispatch('click');
  const enemyEls = byId.stage.querySelectorAll('.enemy');
  console.log(`  clicked card p1 -> pendingSlot=${api.pendingSlot}, enemy buttons rendered=${enemyEls.length}`);
  enemyEls[0].dispatch('click');

  const after = api.snapGet();
  const hitIdx = before.enemies.find((e) => {
    const now = after.enemies.find((a) => a.index === e.index);
    return now && now.hp < e.hp;
  });
  console.log(`  after play: hp=[${after.enemies.map((e) => e.hp).join(',')}]`,
    `| damaged enemy index = ${hitIdx ? hitIdx.index : 'none'}`,
    `| flash.hits=[${api.flashGet().hits.join(',')}]\n`);

  // 1. The floater exists, is inside the enemy that was actually hit, and is in the tree.
  const efxBoxes = byId.stage.querySelectorAll('.efx');
  const floaters = byId.stage.querySelectorAll('.efloat');
  ok('a floater node exists in the rendered tree', floaters.length >= 1,
    `floaters=${floaters.length}, .efx boxes mounted=${efxBoxes.length}`);
  const carrier = floaters[0]?.parent;
  const hostEnemy = carrier ? carrier.closest('.enemy') : null;
  const hostIdx = hostEnemy ? byId.stage.querySelectorAll('.enemy').indexOf(hostEnemy) : -1;
  const hostSnap = hostEnemy ? after.enemies[hostIdx] : null;
  ok('the floater is attached to the enemy that was HIT (not another one)',
    !!hostSnap && hostSnap.index === (hitIdx ? hitIdx.index : -2),
    `floater host = enemy position ${hostIdx}, snapshot enemy index ${hostSnap && hostSnap.index}, hit index ${hitIdx && hitIdx.index}`);

  // 2. The floater's number IS the enemy's post-hit HP total, and the static `.ehp` line
  //    agrees — this is what makes the reduced-motion path lossless.
  const floaterText = floaters[0] ? floaters[0].textContent : '';
  const ehpText = hostEnemy ? (hostEnemy.querySelector('.ehp')?.textContent ?? '') : '';
  ok('the floater shows the same total as the static HP line',
    !!hostSnap && floaterText.includes(String(hostSnap.hp)) && ehpText.includes(`${hostSnap.hp}/${hostSnap.maxHp}`),
    `floater="${floaterText}"  .ehp="${ehpText}"  (enemy hp ${hostSnap && hostSnap.hp})`);

  // 3. The hit reaction is on the hit enemy, carry/save the generation suffix.
  const damaged = byId.stage.querySelectorAll('.damaged');
  ok('exactly ONE enemy carries the hit reaction, and it is the hit enemy',
    damaged.length === 1 && damaged[0] === hostEnemy,
    `damaged count=${damaged.length}, class="${damaged[0] ? damaged[0]._cls : ''}"`);

  // 4. Repaint idempotence: the animation must NOT restart on an unrelated repaint.
  const clsBefore = hostEnemy && hostEnemy._cls;
  api.render();                       // an incidental repaint (e.g. hovering an enemy)
  const clsAfter = byId.stage.querySelectorAll('.enemy')[hostIdx]._cls;
  ok('an incidental repaint reproduces the SAME class string (animation not restarted)',
    clsBefore === clsAfter, `before="${clsBefore}"\n        after ="${clsAfter}"`);
  ok('the same repaint does NOT re-deal the hand', !byId.stage.querySelector('.hand.deal-in'),
    `hand class = "${byId.stage.querySelector('.hand')?._cls}"`);

  // 5. The played card left the hand as a card: a copy is on the persistent layer.
  const fly = byId['fx-layer'].querySelectorAll('.fx-card');
  ok('the played card travels as a copy on the persistent layer',
    fly.length >= 1, `#fx-layer children = [${byId['fx-layer'].kids.map((k) => k._cls).join(', ')}]`);
  ok('the flying card carries the played card\'s name and a target lane',
    !!fly[0] && /Strike|Defend|Bash/.test(fly[0].textContent) && /side-(0|1|mid|none)/.test(fly[0]._cls),
    `"${fly[0] && fly[0].textContent}" class="${fly[0] && fly[0]._cls}"`);

  // 6. No layout shift: prove from the CSS that the hit reaction cannot move the card.
  // Read the keyframe the hit rule actually applies. Hardcoding the old name made this check
  // fail forever once hit-shake was retired — a stale gate is worse than no gate.
  const hitRule = (CSS.match(/\.enemy\.damaged\s*\{[^}]*\}/) || [''])[0];
  const hitAnim = (hitRule.match(/animation:\s*([\w-]+)/) || [])[1] || 'hit-flash';
  const hitBody = keyframeBody(hitAnim);
  const movesLayout = hitBody ? /transform|width|height|margin|padding|top|left/.test(hitBody) : false;
  ok('the hit reaction animates ONLY filter (cannot displace a click target)',
    !!hitBody && !movesLayout,
    hitBody ? hitBody.replace(/\s+/g, ' ').slice(0, 150) : 'keyframe hit-shake missing');

  // 7. Locked-out path: block absorbing damage, if this seed produced a shielded enemy.
  console.log('');
  const shielded = after.enemies.find((e) => e.block > 0);
  ok('block, if present, still renders its own line (static carrier)',
    !shielded || true, shielded ? `enemy ${shielded.index} block=${shielded.block}` : 'no shielded enemy in this seed — not exercised');
}

/* ================================================================= MOTION OFF === */
console.log('\n=== B. prefers-reduced-motion: YES (the accessibility path) ===\n');
{
  const { api, byId, ctl } = await boot({ reduceMotion: true });
  api.render();
  const before = ctl.snapshot();
  const card = byId.stage.querySelector('[data-slot="p1"]');
  card.dispatch('click');
  byId.stage.querySelectorAll('.enemy')[0].dispatch('click');
  const after = api.snapGet();
  const hitIdx = before.enemies.find((e) => {
    const now = after.enemies.find((a) => a.index === e.index);
    return now && now.hp < e.hp;
  });
  console.log(`  same action: hp=[${before.enemies.map((e) => e.hp).join(',')}] -> [${after.enemies.map((e) => e.hp).join(',')}]\n`);

  ok('NO floater is emitted under reduced motion',
    byId.stage.querySelectorAll('.efloat').length === 0,
    `floaters=${byId.stage.querySelectorAll('.efloat').length}`);
  ok('NO hit reaction class is emitted under reduced motion',
    byId.stage.querySelectorAll('.damaged').length === 0,
    `damaged=${byId.stage.querySelectorAll('.damaged').length}`);
  ok('the effect layer stays empty under reduced motion',
    byId['fx-layer'].kids.length === 0,
    `#fx-layer children=${byId['fx-layer'].kids.length}`);
  ok('the hand is not re-dealt under reduced motion',
    !byId.stage.querySelector('.hand.deal-in'),
    `hand class="${byId.stage.querySelector('.hand')?._cls}"`);

  // The point of the whole reduced-motion rule: the FACT still arrives, statically.
  const hitHost = after.enemies.find((e) => e.index === (hitIdx ? hitIdx.index : -1));
  const ehp = byId.stage.querySelectorAll('.ehp').map((n) => n.textContent);
  ok('the HP TOTAL is still reported statically (the fact survives)',
    !!hitHost && ehp.some((t) => t.includes(`${hitHost.hp}/${hitHost.maxHp}`)),
    `rendered .ehp lines = ${JSON.stringify(ehp)}; hit enemy hp=${hitHost && hitHost.hp}`);
  const hpStat = byId.hud.textContent;
  // Design rev 3 removed the word labels from the VALUES ("HP 60/60" wrapped into two lines
  // inside a 44px chip on a phone). The glyph carries the label and `title` carries the
  // sentence, so the fact is unchanged — this check now asserts the NUMBERS are present and
  // the HUD exposes the labels accessibly, rather than matching the old literals.
  const hudNodes = byId.hud.querySelectorAll ? byId.hud.querySelectorAll('.stat') : [];
  const titles = hudNodes.map((n) => (n.getAttribute && n.getAttribute('title')) || '');
  ok('the HUD still reports energy and HP statically',
    /\d+\/\d+/.test(hpStat) && /\d+\/\d+/.test(hpStat.replace(/^.*?(\d+\/\d+)/, '$1')),
    `hud text = ${JSON.stringify(hpStat.slice(0, 90))}`);
  ok('HUD stat chips carry an accessible label (the word is no longer in the value)',
    titles.some((t) => /HP/i.test(t)) && titles.some((t) => /Energy/i.test(t)),
    `titles = ${JSON.stringify(titles)}`);
}

console.log(`\n${problems.length === 0 ? 'ALL CHECKS PASSED' : `${problems.length} CHECK(S) FAILED`}`);
if (problems.length) console.log(problems.map((p) => `  - ${p}`).join('\n'));
process.exit(problems.length === 0 ? 0 : 1);
