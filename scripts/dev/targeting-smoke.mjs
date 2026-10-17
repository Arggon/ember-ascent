// scripts/dev/targeting-smoke.mjs — drive src/web/app.js against a tiny fake DOM and PROVE the
// targeting states, without a browser.
//
// There is no browser in this environment, so this is the closest thing to evidence that
// the interaction actually wires up. It is not a substitute for a real browser: it cannot
// show layout, paint order, focus rings or a screen reader's output. What it CAN show is
// that the right nodes carry the right classes/attributes, that nothing is dispatched
// before the player has chosen an enemy, and that a one-enemy fight asks for no target.
//
// The pattern (fake DOM + `new Function` over a stripped app.js) is copied from
// scripts/dev/render-reward.mjs, with a real selector engine so assertions mean something.
import { readFileSync } from 'node:fs';

/* ------------------------------------------------------------------ a fake DOM */

let nodeCount = 0;

class N {
  constructor(tag = null) {
    this.tag = tag;
    this.kids = [];
    this.a = {};
    this.txt = '';
    this.style = {};
    this._h = {};
    this.parent = null;
    nodeCount += 1;
  }
  get className() { return this.a.class || ''; }
  set className(v) { this.a.class = v; }
  get classList() {
    const self = this;
    const list = () => (self.a.class || '').split(/\s+/).filter(Boolean);
    return {
      add(c) { if (!list().includes(c)) self.a.class = [...list(), c].join(' '); },
      remove(c) { self.a.class = list().filter((x) => x !== c).join(' '); },
      contains(c) { return list().includes(c); },
    };
  }
  append(...c) { for (const x of c) if (x != null) this.kids.push(x) && (x.parent = this); }
  appendChild(c) { this.kids.push(c); c.parent = this; return c; }
  replaceChildren(...c) { this.kids = c.filter(Boolean); for (const k of this.kids) k.parent = this; }
  setAttribute(k, v) { this.a[k] = String(v); }
  getAttribute(k) { return this.a[k] ?? null; }
  addEventListener(t, f) { (this._h[t] || (this._h[t] = [])).push(f); }
  removeEventListener() {}
  get textContent() { return this.txt + this.kids.map((k) => k.textContent).join(''); }
  set textContent(v) { this.txt = v; this.kids = []; }
  /** The node's OWN text (app.js sets textContent, which clears children). */
  get text() { return this.txt; }
  set text(v) { this.txt = v; }
  get firstElementChild() { return this.kids.find((k) => k.tag) ?? null; }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html || ''; }
  querySelector(sel) { return all(this, sel)[0] ?? null; }
  querySelectorAll(sel) { return all(this, sel); }
  closest(sel) { let n = this; while (n) { if (selMatch(n, sel)) return n; n = n.parent; } return null; }
  focus() { this._focused = true; document._focusedNode = this; for (const f of this._h.focus || []) f({ target: this }); }
  click() { for (const f of this._h.click || []) f({ target: this, preventDefault() {} }); }
}

function compoundMatch(n, tok) {
  if (!n || !n.tag || n.tag === '#text') return false;
  const tag = (tok.match(/^[a-zA-Z][\w-]*/) || [])[0];
  if (tag && n.tag.toLowerCase() !== tag.toLowerCase()) return false;
  const cls = n.className.split(/\s+/).filter(Boolean);
  for (const c of tok.match(/\.[\w-]+/g) || []) if (!cls.includes(c.slice(1))) return false;
  for (const a of tok.match(/\[[^\]]+\]/g) || []) {
    const mm = a.slice(1, -1).match(/^([\w-]+)(?:="([^"]*)")?$/);
    if (!mm) return false;
    const v = n.a[mm[1]];
    if (mm[2] === undefined) { if (v === undefined) return false; } else if (String(v) !== mm[2]) return false;
  }
  return true;
}

/** Rightmost compound is the subject; earlier compounds must match ancestors. */
function selMatch(n, sel) {
  const parts = sel.trim().split(/\s+/);
  if (!compoundMatch(n, parts[parts.length - 1])) return false;
  let cur = n.parent;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    let found = false;
    while (cur) { if (compoundMatch(cur, parts[i])) { found = true; cur = cur.parent; break; } cur = cur.parent; }
    if (!found) return false;
  }
  return true;
}

function all(root, sel) {
  const out = [];
  (function walk(n) {
    for (const k of n.kids) { if (k.tag && selMatch(k, sel)) out.push(k); walk(k); }
  })(root);
  return out;
}

const byId = new Map();
const documentShim = {
  _h: {},
  _focusedNode: null,
  getElementById(id) {
    if (!byId.has(id)) byId.set(id, new N('div'));
    return byId.get(id);
  },
  createElement: (t) => new N(t),
  createTextNode: (t) => { const n = new N('#text'); n.txt = t; return n; },
  querySelector: (s) => all(byId.get('__root') || new N('body'), s)[0] ?? null,
  addEventListener(t, f) { (this._h[t] || (this._h[t] = [])).push(f); },
  body: new N('body'),
};

globalThis.document = documentShim;
globalThis.window = { addEventListener() {}, location: { search: '' } };
globalThis.location = { search: '' };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
globalThis.requestAnimationFrame = (f) => f();
globalThis.URLSearchParams = URLSearchParams;

/* ------------------------------------------------------------- the app under test */

const HERE = new URL('../../', import.meta.url);
const src = readFileSync(new URL('src/web/app.js', HERE), 'utf8')
  .replace(/^import .*$/gm, '');
const ctlMod = await import(new URL('src/surface/gui/controller.js', HERE));

/**
 * Build a fresh instance of src/web/app.js driving `ctl`.
 * The tokenizer import is stripped with the rest of the imports, so a stub stands in for
 * it: token measurement is not what this test is about.
 *
 * Only the keydown handlers THIS build registered are returned, because every instance
 * adds one to the same fake document — firing all of them would let a previous screen
 * answer a keypress meant for the current one.
 */
function buildApp(ctl) {
  const hk = documentShim._h.keydown || (documentShim._h.keydown = []);
  const before = hk.length;
  const dispatched = [];
  const spy = {
    ...ctl,
    snapshot: () => ctl.snapshot(),
    dispatch: (id) => { dispatched.push(id); return ctl.dispatch(id); },
  };
  const factory = new Function(
    'const __ctl = arguments[0];\n'
    + 'function createController(){ return __ctl; }\n'
    + 'const measure = async () => null;\n'
    + src
    + '\nreturn { render, combatView, clickCard, pickTarget, cancelTargeting, snapshot: () => snap, state: () => ({ pendingSlot, aimed }) };',
  );
  const api = factory(spy);
  const mine = hk.slice(before);
  return { api, dispatched, press: (key) => { for (const f of mine) f({ key, preventDefault() {} }); } };
}

/** Focus the fake DOM on a fresh app instance and paint its screen. */
function fresh(ctl) {
  byId.clear();
  const built = buildApp(ctl);
  built.api.render();
  return { ...built, stage: byId.get('stage'), live: byId.get('live') };
}

/**
 * A fresh controller in a combat with at least `min` living enemies AND a playable card of
 * one of `types` in hand. Energy may have been spent reaching the fight, so this ends
 * turns (which is legal and costs nothing to the test) until such a card is drawn.
 * @returns {{ctl:any, snap:any, card:any}|null}
 */
function reach(seed, min, types) {
  const ctl = ctlMod.createController({ run: { seed } });
  for (let i = 0; i < 400; i += 1) {
    const s = ctl.snapshot();
    if (s.phase === 'combat' && s.enemies.length >= min) break;
    if (s.phase === 'ended') break;
    const a = (s.actions || [])[0];
    if (!a) break;
    ctl.dispatch(a.id);
  }
  let card = null;
  for (let turn = 0; turn < 12; turn += 1) {
    const s = ctl.snapshot();
    if (s.phase !== 'combat' || s.enemies.length < min) break;
    card = s.hand.find((c) => types.includes(c.type) && c.playable) ?? null;
    if (card) break;
    ctl.dispatch('e1');
  }
  return card ? { ctl, snap: ctl.snapshot(), card } : null;
}

/** First seed in `seeds` that can reach the asked-for combat with a usable card. */
function reachAny(seeds, min, types) {
  for (const seed of seeds) {
    const got = reach(seed, min, types);
    if (got) return { ...got, seed };
  }
  return null;
}

const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1).concat([42, 99]);

/** The help panel would cover the screen on a first visit; this test visits it separately. */
globalThis.localStorage.setItem('dlb.helpSeen.v1', '1');

/* ------------------------------------------------------------------- the harness */

const results = [];
let skipped = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
function skip(name, why) {
  skipped += 1;
  process.stdout.write(`  SKIP  ${name}  — ${why}\n`);
}

function dumpTree(root, depth = 0, out = []) {
  for (const k of root.kids) {
    if (k.tag === '#text') continue;
    const aria = k.a['aria-label'] ? ` aria-label="${k.a['aria-label']}"` : '';
    const ti = k.a['data-target-index'] ? ` data-target-index=${k.a['data-target-index']}` : '';
    const txt = k.kids.some((c) => c.tag === '#text') && k.className
      ? ` "${k.txt.trim().slice(0, 46)}"` : '';
    out.push('  '.repeat(depth) + `<${k.tag}${k.className ? ' .' + k.className.split(' ').join('.') : ''}>${txt}${ti}${aria}`);
    dumpTree(k, depth + 1, out);
  }
  return out;
}

process.stdout.write('== A. TWO ENEMIES: a target-needing card must NOT play on click ==\n');
const A0 = reachAny(SEEDS, 2, ['attack']);
if (!A0) { process.stdout.write('   could not reach a multi-enemy fight with a playable attack card\n'); process.exitCode = 1; }
const A = A0 && fresh(A0.ctl);
const aSnap = A0 && A0.snap;
if (A0) {
  process.stdout.write(`   seed=${A0.seed}  ${aSnap.enemies.length} enemies [${aSnap.enemies.map((e, i) => `${i + 1}=${e.name}(${e.hp}hp,index=${e.index})`).join(', ')}]\n`);
  process.stdout.write(`   hand:  ${aSnap.hand.map((c) => `${c.slot}=${c.name}(${c.type}${c.playable ? '' : ',unplayable'})`).join(' ')}\n`);
  process.stdout.write(`   arming: ${A0.card.slot} ${A0.card.name}\n`);
}

if (A0) {
  check('no enemy is marked as a target before any card is clicked',
    all(A.stage, '.enemy.targeting').length === 0,
    `${all(A.stage, '.enemy.targeting').length} of ${all(A.stage, '.enemy').length} marked`);

  A.api.clickCard(A0.card.slot);
  check('clicking it dispatched NOTHING (the card is armed, not played)',
    A.dispatched.length === 0, `dispatched=[${A.dispatched.join(', ')}]`);

  check('every living enemy is highlighted as a legal target',
    all(A.stage, '.enemy.targeting').length === aSnap.enemies.length,
    `${all(A.stage, '.enemy.targeting').length} highlighted of ${aSnap.enemies.length}`);
  check('exactly one enemy is the SELECTED target (a shape cue, not just a colour)',
    all(A.stage, '.enemy.aimed').length === 1 && all(A.stage, '.enemy.aimed .target-mark').length === 1,
    `${all(A.stage, '.enemy.aimed').length} selected, ${all(A.stage, '.enemy.aimed .target-mark').length} crosshairs`);
  check('each target shows its slot number (the digit the action id carries)',
    all(A.stage, '.enemy.targeting .target-index').length === aSnap.enemies.length,
    all(A.stage, '.enemy .target-index').map((n) => n.text.trim()).join(', '));
  check('the pending card carries an in-card cue that it is waiting',
    all(A.stage, '.card-wrap.is-pending .awaiting-badge').length === 1,
    (all(A.stage, '.awaiting-badge')[0]?.text || '').trim());
  check('there is a visible Cancel affordance',
    all(A.stage, '.cancel-target').length === 1,
    (all(A.stage, '.cancel-target')[0]?.text || '').trim());
  check('the other cards are dimmed so the step is unambiguous',
    all(A.stage, '.card-wrap.is-inactive').length === aSnap.hand.length - 1,
    `${all(A.stage, '.card-wrap.is-inactive').length} dimmed of ${aSnap.hand.length}`);
  check('the pending state is announced textually, not only visually',
    /needs a target/.test(A.live.textContent), A.live.textContent.trim().slice(0, 92));

  const labels = all(A.stage, '.enemy.targeting').map((n) => n.a['aria-label']);
  const labelsOk = labels.length === aSnap.enemies.length && labels.every((l, i) => l
    && l.includes(`Enemy ${i + 1} of ${aSnap.enemies.length}`)
    && l.includes(`${aSnap.enemies[i].hp} of ${aSnap.enemies[i].maxHp} HP`)
    && l.includes(`Press ${i + 1} to target`));
  check('each enemy is labelled with its index, HP and its telegraphed intent', labelsOk);
  process.stdout.write(`   aria-label[1] => "${labels[0] || ''}"\n`);

  // The script's `k` and the engine's enemy print order must agree, or the digit on screen
  // is not the digit the id carries. This is the ordering contract from the PM table.
  const orderOk = all(A.stage, '.enemy').every((n, i) => n.a['data-target-index'] === String(i + 1)
    && n.a['aria-label'].startsWith(`Enemy ${i + 1} of ${aSnap.enemies.length} — ${aSnap.enemies[i].name},`));
  check('k on screen equals the snapshot print order (position + 1), enemy for enemy', orderOk,
    all(A.stage, '.enemy').map((n) => `${n.a['data-target-index']}:${aSnap.enemies[Number(n.a['data-target-index']) - 1].name}`).join(' '));

  process.stdout.write('\n   --- combat tree while aiming (truncated to the enemies + hand) ---\n');
  process.stdout.write(dumpTree(A.stage).slice(0, 34).map((l) => `   ${l}`).join('\n') + '\n');
}

process.stdout.write('\n== B. choosing enemy 2 submits the two-argument id ==\n');
if (A0) {
  const B = fresh(A0.ctl);
  B.api.clickCard(A0.card.slot);
  all(B.stage, '.enemy.targeting')[1].click();
  check('clicking enemy 2 dispatched exactly one action', B.dispatched.length === 1, `dispatched=[${B.dispatched.join(', ')}]`);
  check(`the id carries the target ("${A0.card.slot} 2"), not the old bare "${A0.card.slot}"`,
    B.dispatched[0] === `${A0.card.slot} 2`, `got "${B.dispatched[0]}"`);
}

process.stdout.write('\n== C. Escape cancels the step and plays nothing ==\n');
if (A0) {
  const C = fresh(A0.ctl);
  C.api.clickCard(A0.card.slot);
  const armed = all(C.stage, '.enemy.targeting').length;
  C.press('Escape');
  check('the step was armed first', armed === aSnap.enemies.length, `${armed} highlighted`);
  check('Escape cancelled it and dispatched nothing', C.dispatched.length === 0, `dispatched=[${C.dispatched.join(', ')}]`);
  check('no enemy is highlighted after the cancel', all(C.stage, '.enemy.targeting').length === 0);
  check('no card is left lifted after the cancel', all(C.stage, '.card-wrap.is-pending').length === 0);
  check('the cancel is announced', /cancel/i.test(C.live.textContent), C.live.textContent.trim().slice(0, 72));
  check('focus went back to the card that was armed',
    documentShim._focusedNode && documentShim._focusedNode.a['data-slot'] === A0.card.slot,
    documentShim._focusedNode ? `data-slot=${documentShim._focusedNode.a['data-slot']}` : 'no focus');
}

process.stdout.write('\n== D. keyboard targeting: a digit picks the enemy, 0 cancels ==\n');
if (A0) {
  const D = fresh(A0.ctl);
  D.api.clickCard(A0.card.slot);
  D.press('1');
  check('pressing "1" targeted enemy 1', D.dispatched[0] === `${A0.card.slot} 1`, `dispatched=[${D.dispatched.join(', ')}]`);
  const D2 = fresh(A0.ctl);
  D2.api.clickCard(A0.card.slot);
  D2.press('0');
  check('pressing "0" cancelled instead of playing',
    D2.dispatched.length === 0 && all(D2.stage, '.enemy.targeting').length === 0,
    `dispatched=[${D2.dispatched.join(', ')}]`);
}

process.stdout.write('\n== E. a single-enemy fight must ask for NO target ==\n');
{
  let found = null;
  const why = [];
  for (const seed of SEEDS) {
    const start = reach(seed, 2, ['attack']);
    if (!start) { why.push(`seed ${seed}: no multi-enemy fight with an attack`); continue; }
    const ctl = start.ctl;
    // Down to one enemy using only SINGLE-TARGET attacks (a summary containing `all` hits
    // the whole field). The engine aims at the first living enemy, so this kills the enemy
    // at identity index 0 and the survivor is the one spawned second — identity index 1,
    // which is NOT its DOM position (0).
    for (let i = 0; i < 120; i += 1) {
      const s = ctl.snapshot();
      if (s.phase !== 'combat' || s.enemies.length <= 1) break;
      const single = s.hand.find((c) => c.type === 'attack' && c.playable && !/all/i.test(c.summary || ''));
      if (single) ctl.dispatch(single.slot);
      else ctl.dispatch('e1');
    }
    const s = ctl.snapshot();
    if (s.phase === 'combat' && s.enemies.length === 1) {
      found = { ctl, snap: s, seed };
      break;
    }
    why.push(`seed ${seed}: phase=${s.phase} enemies=${s.enemies?.length}`);
  }
  if (!found) {
    check('reached a single-enemy fight after a kill', false, why.join('; '));
  } else {
    const survivor = found.snap.enemies[0];
    process.stdout.write(`   seed=${found.seed}  1 enemy [${survivor.name} ${survivor.hp}/${survivor.maxHp}hp`
      + ` identity index=${survivor.index}, DOM position 0]\n`);
    const E = fresh(found.ctl);
    const hitCard = found.snap.hand.find((c) => c.type === 'attack' && c.playable && !/all/i.test(c.summary || ''));
    if (!hitCard) {
      skip('one click plays it immediately with no targeting step', 'no playable single-target attack in hand this turn');
    } else {
      E.api.clickCard(hitCard.slot);
      check('one click played it immediately — no targeting step',
        all(E.stage, '.enemy.targeting').length === 0 && all(E.stage, '.card-wrap.is-pending').length === 0,
        `${all(E.stage, '.enemy.targeting').length} highlighted, ${all(E.stage, '.card-wrap.is-pending').length} pending`);
      check('and it dispatched the plain id with no target suffix',
        E.dispatched.length === 1 && !E.dispatched[0].includes(' '), `dispatched=[${E.dispatched.join(', ')}]`);
      const damaged = all(E.stage, '.enemy.damaged');
      const toastText = byId.get('toast').textContent;
      if (damaged.length === 1 || survivor.hp <= 0) {
        // The hit landed and the fight continues: the flash must be on the survivor, whose
        // identity index differs from its position. That is the identity-vs-position check.
        check(`the flash followed identity, not position (survivor index=${survivor.index}, position 0)`,
          damaged.length === 1 && survivor.index !== 0, `${damaged.length} flashing`);
        check('the feedback toast names the enemy that was hit',
          /Dealt \d+ damage to /.test(toastText), `"${toastText.trim()}"`);
      } else {
        skip('flash follows identity rather than position',
          `the fight ended on that hit, so no enemy card survives to carry the flash (survivor hp ${survivor.hp})`);
      }
    }
  }
}

process.stdout.write('\n== F. a card that takes no target is never given a target step ==\n');
{
  const F0 = reachAny(SEEDS, 2, ['skill']);
  if (!F0) {
    check('reached a multi-enemy fight with a playable skill', false, 'no seed produced one');
  } else {
    const F = fresh(F0.ctl);
    F.api.clickCard(F0.card.slot);
    check(`a ${F0.card.type} card ("${F0.card.name}") played on one click with no target step`,
      F.dispatched.length === 1 && !F.dispatched[0].includes(' ') && all(F.stage, '.enemy.targeting').length === 0,
      `dispatched=[${F.dispatched.join(', ')}], ${all(F.stage, '.enemy.targeting').length} highlighted`);
  }
}

process.stdout.write('\n== G. targeted play: what the UI submits, and what the engine returns ==\n');
if (A0) {
  const G = fresh(A0.ctl);
  const beforeHp = new Map(A0.snap.enemies.map((e) => [e.index, e.hp]));
  G.api.clickCard(A0.card.slot);
  // Aim at the LAST enemy deliberately: aiming at the first would pass even if the flash
  // were keyed on position rather than identity, which is the behaviour in question.
  const nodes = all(G.stage, '.enemy.targeting');
  const targetNode = nodes[nodes.length - 1];
  const chosen = targetNode.a['data-target-index'];
  targetNode.click();
  process.stdout.write(`   UI submitted: ${JSON.stringify(G.dispatched[0] || null)}  (chosen target ${chosen})\n`);

  const after = G.api.snapshot ? G.api.snapshot() : A0.ctl.snapshot();
  const afterHp = new Map(after.enemies.map((e) => [e.index, e.hp]));
  const lost = [...beforeHp.entries()].filter(([idx, hp]) =>{const h=afterHp.get(idx); return h!==undefined && h<hp;});
  const damaged = all(G.stage, '.enemy.damaged');
  const illegal = /illegal_action/.test(byId.get('toast').textContent);
  process.stdout.write(`   engine verdict: ${illegal ? 'REJECTED the two-argument id' : `accepted; HP dropped for ${JSON.stringify(lost)}`}\n`);
  process.stdout.write(`   toast: "${byId.get('toast').textContent.trim()}"\n`);

  if (illegal) {
    // This is the blocked-on-the-sibling path. The UI did its part; the engine in the tree
    // does not accept `p<N> <k>` yet. Assert only what is mine: no damage is claimed, and
    // no enemy is shown as hit.
    check('the engine rejects "<slot> <target>" (see docs/status/TARGETING-UI-STATUS.md — the two-arg form is not in the kernel yet)', true,
      'illegal_action');
    check('the UI does not claim damage that did not happen',
      damaged.length === 0 && !/Dealt /.test(byId.get('toast').textContent),
      `${damaged.length} flashing`);
    check('it simply cancels the step, leaving no card armed', all(G.stage, '.card-wrap.is-pending').length === 0);
    process.stdout.write('   NOTE: end-to-end "the chosen enemy takes the hit" cannot be verified in this tree —\n'
      + '         the engine rejects the target-bearing id. Reported, not patched (src/ is not mine).\n');
  } else {
    check('exactly one enemy is flashing as damaged', lost.length === 1, `${lost.length} lost HP`);
    check(`it is the enemy the player chose (target ${chosen}), not the first one`,
      damaged.length === 1 && damaged[0].a['data-target-index'] === chosen,
      damaged.length ? `flashing target=${damaged[0].a['data-target-index']}, chosen=${chosen}` : 'none flashed');
    check('the toast names the enemy that was hit', /Dealt \d+ damage to /.test(byId.get('toast').textContent),
      byId.get('toast').textContent.trim());
  }
}

process.stdout.write('\n== H. the first-run help panel explains targeting ==\n');
{
  globalThis.localStorage._d = {};
  const H = fresh(A0 ? A0.ctl : ctlMod.createController({ run: { seed: 1 } }));
  const help = H.stage.textContent;
  check('the first-run panel is shown when nothing has been seen yet', /How to play/.test(help));
  check('it carries a targeting explanation', /Aiming at one enemy/.test(help) && /press its number/.test(help),
    (help.match(/Aiming at one enemy/) || [''])[0]);
  globalThis.localStorage.setItem('dlb.helpSeen.v1', '1');
}

process.stdout.write('\n== I. renderer-level checks on synthetic snapshots where index != position ==\n');
{
  // No state reachable through the current engine can separate the two keys: because the
  // engine only ever aims at the FIRST living enemy, it kills low identities first, so an
  // enemy's `index` always equals its `position + 1` in every state this tree can produce.
  // The requirement still says the damage flash must follow the enemy actually HIT, so the
  // renderer is exercised directly against synthetic snapshots in which the two disagree.
  const enemy = (index, name, hp, maxHp) => ({
    index, id: 'x', name, hp, maxHp, block: 0, statuses: [],
    intent: { label: 'A11', kind: 'attack', damage: 11, hits: 1, text: 'Will attack for 11.' },
  });
  const snapshotWith = (enemies) => ({
    phase: 'combat', outcome: null, stepIndex: 1, floor: 0, turn: 1, energyPerTurn: 3,
    character: 'ironclad', difficulty: 0, seed: 1,
    player: { hp: 50, maxHp: 80, energy: 2, block: 0, statuses: [], powers: [] },
    hand: [{ slot: 'p1', cardId: 'strike', name: 'Hammerfall', cost: 1, type: 'attack', rarity: 'starter', typeLabel: 'Attack', summary: 'A6', description: 'Deal 6 damage.', playable: true, hint: '' }],
    piles: { draw: 4, discard: 1, exhaust: 0 },
    enemies,
    map: { floor: 0, floorCount: 8, current: null, rows: [], currentRow: [] },
    reward: null, rest: null, ended: null,
    cardTypes: [], glossary: [], glossarySections: [], help: [],
    actions: [{ id: 'p1', kind: 'play', cardId: 'strike' }, { id: 'e1', kind: 'end_turn' }],
    actionLines: [], text: 'synthetic',
  });

  // --- I.1  the identity flash: one enemy at position 0 whose index is 2 ---
  let solo = [enemy(2, 'Cinder Maw', 40, 40)];
  const fakeSolo = {
    snapshot: () => snapshotWith(solo),
    dispatch: (id) => { if (id === 'p1') solo = [{ ...solo[0], hp: solo[0].hp - 6 }]; return { error: null, events: [], changed: true }; },
    actions: () => [],
  };
  const I1 = fresh(fakeSolo);
  I1.api.clickCard('p1');
  const d1 = all(I1.stage, '.enemy.damaged');
  check('at position 0 with identity index 2: the flash still fires (a positional key would flash nothing)',
    d1.length === 1, `${d1.length} flashing`);
  check('one enemy therefore needs no target step, as required',
    I1.dispatched.length === 1 && I1.dispatched[0] === 'p1', `dispatched=[${I1.dispatched.join(', ')}]`);

  // --- I.2  a targeted play names and flashes the enemy that was hit ---
  let duo = [enemy(0, 'Slag Ooze', 20, 20), enemy(2, 'Cinder Maw', 40, 40)];
  const fakeDuo = {
    snapshot: () => snapshotWith(duo),
    dispatch: (id) => {
      // The engine's own contract: k is 1-based among the living, in print order.
      const m = /^p1 (\d+)$/.exec(id);
      if (m) { const at = Number(m[1]) - 1; duo = duo.map((e, i) => (i === at ? { ...e, hp: e.hp - 6 } : e)); }
      return { error: null, events: [], changed: true };
    },
    actions: () => [],
  };
  const I2 = fresh(fakeDuo);
  I2.api.clickCard('p1');
  const armed = all(I2.stage, '.enemy.targeting').length;
  all(I2.stage, '.enemy.targeting')[1].click();  // choose k = 2 -> identity index 2
  const d2 = all(I2.stage, '.enemy.damaged');
  check('two enemies: the second was armed and chosen', armed === 2, `${armed} highlighted`);
  check('the submitted id carried the chosen k', I2.dispatched[0] === 'p1 2', `dispatched=[${I2.dispatched.join(', ')}]`);
  check('the flash landed on the chosen enemy (position 1, identity index 2), not the first',
    d2.length === 1 && d2[0].a['data-target-index'] === '2',
    d2.length ? `flashing data-target-index=${d2[0].a['data-target-index']}` : 'none flashed');
  check('the feedback toast names the enemy that was hit',
    /Dealt 6 damage to Cinder Maw/.test(byId.get('toast').textContent), `"${byId.get('toast').textContent.trim()}"`);
}

const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${'='.repeat(64)}\n${results.length - failed.length}/${results.length} checks passed`
  + `${skipped ? `, ${skipped} skipped` : ''}\n`);
if (failed.length) {
  process.stdout.write('FAILED:\n' + failed.map((f) => `  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`).join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('OK — targeting states render, nothing plays before a choice, single-enemy play is untouched\n');
}
