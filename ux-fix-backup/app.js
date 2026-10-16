// web/app.js — the browser surface: a pure VIEW on the kernel.
//
// It imports the SAME DOM-free controller the CLI-equivalence test drives
// (src/surface/gui/controller.js), reads controller.snapshot() (a value model the
// kernel computes), and paints it. It contains NO game rules: it never adds damage,
// never decides what is legal, never mutates state. When it needs to know something
// (is this card playable? what does this enemy intend? which node can I reach?), it
// reads a field the kernel already answered.
//
// Interaction is mouse/pointer first: clicking a card plays it, clicking an enemy
// intent does nothing (intent is information), clicking a map node travels, and the
// End Turn button is always present. Keyboard shortcuts exist but are never required.

import { createController } from '../src/surface/gui/controller.js';
import { measure } from './tokens.js';

const hudEl = document.getElementById('hud');
const stageEl = document.getElementById('stage');
const toastEl = document.getElementById('toast');

/** A fresh random seed per browser game keeps each restart a new run. */
function seedFromUrl() {
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null || raw === '') return Math.floor(Math.random() * 1000000);
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : Math.floor(Math.random() * 1000000);
}

let ctl = createController({ run: { seed: seedFromUrl() } });
let snap = ctl.snapshot();
/** Last time a value changed, so a click produces visible feedback. */
let flash = { hp: false, energy: false, block: false };
let tokenState = { text: null, result: undefined };

/* ---------------------------------------------------------------- tiny DOM helper */

function el(tag, opts = {}, ...kids) {
  const node = document.createElement(tag);
  if (opts.cls) node.className = opts.cls;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.on) for (const [k, v] of Object.entries(opts.on)) node.addEventListener(k, v);
  for (const kid of kids) if (kid != null) node.append(kid);
  return node;
}

function toast(msg, kind = 'warn') {
  toastEl.textContent = msg;
  toastEl.className = kind === 'info' ? 'show info' : 'show';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.className = ''; }, 1600);
}

/* --------------------------------------------------------- the one dispatch path */

/** Every interaction funnels here: dispatch one kernel action id, then repaint. */
function act(actionId) {
  if (!actionId) return;
  const before = snap;
  const res = ctl.dispatch(actionId);
  const after = ctl.snapshot();

  if (res.error) {
    toast(`✗ ${res.error.error} — "${res.error.id}" is not legal right now`);
  } else {
    // Presentation-only feedback: compare the two kernel snapshots we already have.
    const playerLost = before.player.hp - after.player.hp;
    const enemyLost = sumEnemyHp(before) - sumEnemyHp(after);
    const gainedBlock = after.player.block - before.player.block;
    if (playerLost > 0) toast(`You take ${playerLost} damage`, 'warn');
    else if (enemyLost > 0) toast(`Dealt ${enemyLost} damage`, 'info');
    else if (gainedBlock > 0) toast(`+${gainedBlock} block`, 'info');
  }

  flash = {
    hp: after.player.hp < before.player.hp,
    energy: after.player.energy !== before.player.energy,
    block: after.player.block > before.player.block,
  };
  snap = after;
  render();
}

const sumEnemyHp = (s) => s.enemies.reduce((n, e) => n + e.hp, 0);

function newGame() {
  ctl = createController({ run: { seed: seedFromUrl() } });
  snap = ctl.snapshot();
  flash = { hp: false, energy: false, block: false };
  render();
}

/* ------------------------------------------------------------------------- HUD */

function renderHud() {
  hudEl.replaceChildren();
  const p = snap.player;

  hudEl.append(
    el('span', { cls: 'hud-char', text: capitalize(snap.character) },
      snap.difficulty > 0 ? el('span', { cls: 'diff', text: `diff ${snap.difficulty}` }) : null),
  );

  hudEl.append(stat('hp', '♥', `HP ${p.hp}/${p.maxHp}`, flash.hp));
  hudEl.append(stat('energy', '⚡', `EN ${p.energy}/${snap.energyPerTurn}`, flash.energy));
  hudEl.append(stat('block', '⛨', `BLK ${p.block}`, flash.block));
  hudEl.append(stat('dim', '', `step ${snap.stepIndex}`));

  for (const s of p.statuses) hudEl.append(el('span', { cls: `pill ${s.key}`, text: s.label }));
  for (const pw of p.powers) hudEl.append(el('span', { cls: 'pill power', text: `${pw.key.toUpperCase()}${pw.stacks}` }));

  hudEl.append(el('span', { cls: 'spacer' }));
  hudEl.append(tokenBadge());
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: 'New Run',
    attrs: { type: 'button', title: `New run (seed ${snap.seed}) — keyboard: n` },
    on: { click: newGame },
  }));
}

function stat(kind, glyph, text, isFlash) {
  const node = el('span', { cls: `stat ${kind}` + (isFlash ? ` flash-${kind === 'hp' ? 'hit' : 'energy'}` : '') });
  if (glyph) node.append(el('span', { cls: 'glyph', text: glyph }));
  node.append(document.createTextNode(text));
  return node;
}

/** Unobtrusive token readout: worst of o200k/cl100k, against the 250 ceiling. */
function tokenBadge() {
  const r = tokenState.result;
  let text;
  if (tokenState.text !== snap.text) text = 'measuring…';
  else if (r && typeof r.worst === 'number') text = `${r.worst}/250 tokens`;
  else text = 'tokens n/a';
  return el('span', {
    cls: 'token-badge',
    attrs: { title: 'Payload tokens of the R4 observation the CLI prints — the agent-facing cost. Measured with the same tool the test suite gates on.' },
    text: '',
  }, (() => { const b = el('b', {}); b.textContent = text; return b; })());
}

/* ----------------------------------------------------------------------- STAGE */

function render() {
  renderHud();
  stageEl.replaceChildren();
  switch (snap.phase) {
    case 'map': stageEl.append(mapView()); break;
    case 'combat': stageEl.append(combatView()); break;
    case 'reward': stageEl.append(rewardView()); break;
    case 'rest': stageEl.append(restView()); break;
    case 'ended': stageEl.append(endView()); break;
    default: stageEl.append(el('p', { text: `phase ${snap.phase}` }));
  }
  measureTokens();
}

async function measureTokens() {
  const text = snap.text;
  if (tokenState.text === text) return;
  tokenState = { text, result: undefined };
  paintTokensSoon(text);
  const result = await measure(text);
  tokenState = { text, result };
  if (snap.text === text) paintTokensSoon(text);
}

/** Repaint only the badge when the measurement lands, to avoid a full flash. */
function paintTokensSoon(text) {
  const badge = hudEl.querySelector('.token-badge b');
  if (!badge) return;
  const r = tokenState.result;
  if (tokenState.text !== text) return;
  badge.textContent = r && typeof r.worst === 'number' ? `${r.worst}/250 tokens` : 'tokens n/a';
}

/* ------------------------------------------------------------------- COMBAT */

function combatView() {
  const wrap = el('div', { cls: 'stage-combat' });

  if (snap.enemies.length > 0) {
    wrap.append(el('p', { cls: 'section-title', text: 'Enemies' }));
    wrap.append(el('div', { cls: 'enemies' }, ...snap.enemies.map(enemyCard)));
  }

  const piles = `draw ${snap.piles.draw} · discard ${snap.piles.discard}` + (snap.piles.exhaust > 0 ? ` · exhaust ${snap.piles.exhaust}` : '');
  wrap.append(el('p', { cls: 'section-title', text: `Your Hand — ${piles}` }));
  wrap.append(el('div', { cls: 'hand' }, ...snap.hand.map(cardTile)));

  const endTurn = snap.actions.find((a) => a.kind === 'end_turn');
  wrap.append(el('div', { cls: 'controls' },
    el('button', {
      cls: 'btn',
      text: 'End Turn  (e)',
      attrs: { type: 'button' },
      on: { click: () => act(endTurn && endTurn.id) },
    }),
    el('span', { cls: 'hint', text: 'Click a card to play it · unplayable cards are dimmed' }),
  ));
  return wrap;
}

function enemyCard(e) {
  const intentClass = `intent kind-${e.intent.kind}`;
  const sub = e.intent.kind === 'attack'
    ? `attacks for ${e.intent.damage}${e.intent.hits > 1 ? ` ×${e.intent.hits}` : ''}`
    : e.intent.kind === 'block' ? 'will block'
    : e.intent.kind === 'buff' ? 'will buff'
    : e.intent.kind === 'debuff' ? 'will debuff' : 'intent';

  const card = el('div', { cls: 'enemy' });
  card.append(el('div', { cls: 'ename', text: e.name }));
  card.append(el('div', { cls: 'ehp', text: `HP ${e.hp}/${e.maxHp}` }));
  const bar = el('div', { cls: 'hpbar' }, el('i', {}));
  bar.querySelector('i').style.width = `${Math.max(0, Math.round((e.hp / e.maxHp) * 100))}%`;
  card.append(bar);
  if (e.block > 0) {
    card.append(el('div', { cls: 'eblock', text: `⛨ block ${e.block}` }));
    const bb = el('div', { cls: 'hpbar block' }, el('i', {}));
    bb.querySelector('i').style.width = `${Math.min(100, Math.round((e.block / Math.max(1, e.maxHp)) * 100))}%`;
    card.append(bb);
  }
  const statuses = e.statuses.map((s) => el('span', { cls: `pill ${s.key}`, text: s.label }));
  if (statuses.length > 0) card.append(el('div', {}, ...statuses));
  card.append(el('div', { cls: intentClass },
    el('span', { cls: 'ilabel', text: e.intent.label }),
    el('span', { cls: 'isub', text: sub }),
  ));
  return card;
}

function cardTile(card) {
  const disabled = !card.playable;
  const tile = el('button', {
    cls: `card type-${card.type}` + (disabled ? ' disabled' : ''),
    attrs: {
      type: 'button',
      'aria-disabled': String(disabled),
      title: `${card.name} · cost ${card.cost} · ${card.summary}${disabled ? ' · not enough energy' : ''}`,
    },
    on: disabled ? {} : { click: () => act(card.slot) },
  });
  if (disabled) tile.disabled = true;
  tile.append(el('span', { cls: 'cost', text: String(card.cost) }));
  tile.append(el('span', { cls: 'cname', text: card.name }));
  tile.append(el('span', { cls: 'ctype', text: card.type }));
  tile.append(el('span', { cls: 'csum', text: card.summary }));
  return tile;
}

/* ---------------------------------------------------------------------- MAP */

function mapView() {
  const wrap = el('div', { cls: 'panel' });
  wrap.append(el('p', { cls: 'section-title', text: `Map — floor ${snap.map.floor + 1}/${snap.map.floorCount}` }));
  const map = el('div', { cls: 'map' });
  snap.map.rows.forEach((row, r) => {
    const rowEl = el('div', { cls: 'map-row' });
    rowEl.append(el('span', { cls: 'map-floor-label', text: `${r + 1}` }));
    for (const n of row) rowEl.append(mapNode(n));
    map.append(rowEl);
  });
  wrap.append(map);
  wrap.append(el('p', { cls: 'hint', text: 'Click a glowing node to travel. Fight something weak, risk an elite, or rest.' }));
  return wrap;
}

function mapNode(n) {
  const cls = `node t-${n.type.replace('combat_', '')}` + (n.available ? ' available' : '') + (n.current ? ' current' : '');
  const node = el(n.available ? 'button' : 'span', {
    cls,
    attrs: n.available ? { type: 'button', title: `Travel to ${n.label}` } : {},
    on: n.available && n.actionId ? { click: () => act(n.actionId) } : {},
  });
  node.append(el('span', { cls: 'ntype', text: n.label }));
  node.append(el('span', { cls: 'nsub', text: n.type.replace('_', ' ') }));
  return node;
}

/* ------------------------------------------------------------------- REWARD */

function rewardView() {
  const wrap = el('div', { cls: 'panel' });
  wrap.append(el('p', { cls: 'section-title', text: 'Victory — choose a card' }));
  const row = el('div', { cls: 'hand' });
  for (const c of snap.reward.cards) {
    const tile = cardTile({ slot: c.actionId, cardId: c.cardId, name: c.name, cost: c.cost, type: c.type, summary: c.summary, playable: true });
    row.append(tile);
  }
  wrap.append(row);
  const controls = el('div', { cls: 'controls' });
  if (snap.reward.canSkip) {
    controls.append(el('button', {
      cls: 'btn secondary',
      text: `Skip  (HP ${snap.player.hp}/${snap.player.maxHp})`,
      attrs: { type: 'button' },
      on: { click: () => act(snap.reward.skipId) },
    }));
  }
  controls.append(el('span', { cls: 'hint', text: 'Click a card to add it to your deck' }));
  wrap.append(controls);
  return wrap;
}

/* --------------------------------------------------------------------- REST */

function restView() {
  const wrap = el('div', { cls: 'panel' });
  wrap.append(el('p', { cls: 'section-title', text: 'Rest Site' }));
  wrap.append(el('div', { cls: 'big-title', text: 'A quiet moment' }));
  wrap.append(el('p', { text: `HP ${snap.player.hp}/${snap.player.maxHp} — you may heal ${snap.rest.heal} or move on.` }));
  wrap.append(el('div', { cls: 'restart-row' },
    el('button', { cls: 'btn', text: `Rest (+${snap.rest.heal} HP)`, attrs: { type: 'button' }, on: { click: () => act(snap.rest.healId) } }),
    el('button', { cls: 'btn secondary', text: 'Move on', attrs: { type: 'button' }, on: { click: () => act(snap.rest.leaveId) } }),
  ));
  return wrap;
}

/* --------------------------------------------------------------------- ENDED */

function endView() {
  const e = snap.ended;
  const won = e.outcome === 'win';
  const wrap = el('div', { cls: 'panel' });
  wrap.append(el('p', { cls: 'section-title', text: 'Run Over' }));
  wrap.append(el('div', { cls: `big-title ${won ? 'win' : 'loss'}`, text: won ? 'VICTORY' : 'DEFEAT' }));
  wrap.append(el('p', { text: `Reached floor ${e.floor} · ${e.steps} steps · seed ${snap.seed}` }));
  wrap.append(el('p', { cls: 'hint', text: won
    ? 'You cleared Act 1 and the boss fell.'
    : 'The Ironclad falls. Try a different route or a better card pick.' }));
  wrap.append(el('div', { cls: 'restart-row' },
    el('button', { cls: 'btn', text: 'Restart  (r)', attrs: { type: 'button' }, on: { click: newGame } }),
  ));
  return wrap;
}

/* ---------------------------------------------------------------- keyboard bonus */

document.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key;
  if (snap.phase === 'combat') {
    if (k === 'e' || k === 'E' || k === ' ') {
      const endTurn = snap.actions.find((a) => a.kind === 'end_turn');
      if (endTurn) { ev.preventDefault(); act(endTurn.id); }
      return;
    }
    const n = Number(k);
    if (Number.isInteger(n) && n >= 1 && n <= snap.hand.length) {
      const card = snap.hand[n - 1];
      if (card && card.playable) { ev.preventDefault(); act(card.slot); }
      return;
    }
  }
  if (snap.phase === 'ended' && (k === 'r' || k === 'R')) { ev.preventDefault(); newGame(); }
  if (k === 'n' || k === 'N') { ev.preventDefault(); newGame(); }
});

const capitalize = (s) => (typeof s === 'string' && s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s);

/** Expose the controller for a curious viewer (read-only use). Not required by the game. */
window.__dlb = { controller: () => ctl, snapshot: () => snap };

render();
