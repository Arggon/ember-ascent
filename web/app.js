// web/app.js — the browser surface: a pure VIEW on the kernel.
//
// It imports the SAME DOM-free controller the CLI-equivalence test drives
// (src/surface/gui/controller.js), reads controller.snapshot() (a value model the
// kernel computes), and paints it. It contains NO game rules: it never adds damage,
// never decides what is legal, never mutates state. When it needs to know something
// (is this card playable? what does this enemy intend? which node can I reach?), it
// reads a field the kernel already answered.
//
// All art in here is CSS or inline SVG built with DOM calls: no image files, no
// external assets, no fonts fetched over the network. Silhouettes and glyphs are
// keyed off names and types the SNAPSHOT already carries (`e.name`, `card.type`,
// `n.type`, `intent.kind`) — decoration only, never a rule.
//
// Interaction is mouse/pointer first: clicking a card plays it, clicking an enemy
// intent does nothing (intent is information), clicking a map node travels, and the
// End Turn button is always present. Keyboard shortcuts exist but are never required.

import { createController } from '../src/surface/gui/controller.js';
import { cardArtMarkup } from './card-art.js';
import { attackTier, backdropMarkup, enemyMarkup, heroMarkup, intentGlyph } from './stage-art.js';
// The ONE public kernel entry point (package.json `exports` is exactly this file, and it
// is browser-safe by construction: no `node:*`, no clock, no unseeded randomness, all
// enforced by tools/check-architecture.mjs). Every number the history screens show is
// read from here or from a record this module built with `buildRunRecord` — the renderer
// composes no game fact, it only chooses layout and words.
import {
  RETAIN,
  SCORE_TABLE,
  SHIPPED_CARDS,
  UNLOCK_CATALOG,
  aggregate,
  badgesForRun,
  buildRunRecord,
  contentForProfile,
  emptyAgg,
  evaluateUnlocks,
  fullyUnlockedProfile,
  pruneRuns,
  scoreRun,
} from '../src/kernel/index.js';

const hudEl = document.getElementById('hud');
const stageEl = document.getElementById('stage');
const toastEl = document.getElementById('toast');
/**
 * The effect layer: a SIBLING of #stage that `render()` never clears, so an effect that
 * must outlive a repaint (a screen pulse, a turn wipe) survives one. It is absent from the
 * DOM in the narrow test harnesses, which build only #hud/#stage/#toast/#live/#app — hence
 * every use is null-guarded rather than assumed.
 */
const fxEl = document.getElementById('fx-layer');
/**
 * True when the player has asked for reduced motion. Read once at load: it is a media
 * QUERY, not a state the page changes at runtime. Under it the renderer emits no
 * floating numbers, no screen pulses and no ghost death cards — every one of those facts
 * is still carried statically by the HP bar, the HP total and the block line, which is
 * what makes dropping them safe.
 */
const reducedMotion = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)').matches
  : false;

/** Presentation speed. 1 and 2 scale the feel queue; 0 skips it. Never a rule. */
const SPEED_KEY = 'ea.animSpeed';
function readAnimSpeed() {
  try {
    const n = Number(localStorage.getItem(SPEED_KEY));
    if (n === 0 || n === 1 || n === 2) return n;
  } catch { /* private mode */ }
  return 1;
}
let animSpeed = readAnimSpeed();
let animGen = 0;
let pileOpen = null;

function animMs(ms) {
  if (reducedMotion || animSpeed === 0) return 0;
  return Math.max(0, Math.round(ms / animSpeed));
}
function clearHitstop() {
  if (stageEl && stageEl.classList) stageEl.classList.remove('hitstop');
  if (fxEl && fxEl.classList) fxEl.classList.remove('hitstop');
}
function revealFloats() {
  if (!stageEl || !stageEl.querySelectorAll) return;
  for (const n of stageEl.querySelectorAll('.efloat.is-queued')) n.classList.remove('is-queued');
}
/** Drop the rest of the feel queue and show the numbers now. */
function skipAnim() {
  animGen += 1;
  clearHitstop();
  revealFloats();
}

/**
 * Every timer the effect layer owns, so a new run can cancel the previous run's pending
 * removal instead of letting it delete a node of the NEW run's tree.
 */
let fxTimers = [];
function later(fn, ms) {
  const t = setTimeout(fn, ms);
  fxTimers.push(t);
  return t;
}
/**
 * A SEPARATE timer list for the per-paint flags the views read (`dealPending`, the inert
 * death cards, the phase beat). Kept apart from the effect-layer timers because a NEW RUN
 * must drop every pending flag — a stale "the panel arrives next paint" flag surviving a
 * restart would blank the first screen of the new run — while an effect-layer node is
 * cleared by name on restart anyway.
 */
let paintTimers = [];
function laterPaint(fn, ms) {
  const t = setTimeout(fn, ms);
  paintTimers.push(t);
  return t;
}
function clearFxTimers() {
  for (const t of fxTimers) clearTimeout(t);
  fxTimers = [];
  for (const t of paintTimers) clearTimeout(t);
  paintTimers = [];
}

/**
 * A rolling generation counter for the HUD flash classes, plus the hand/inventory the
 * last paint saw. `flash.n` changes ONLY when one of the flash booleans actually changes,
 * so a repaint for an unrelated reason reproduces the same class string on the same
 * element. The browser therefore sees no class delta and does NOT restart the animation —
 * the previous boolean-only scheme could not promise that.
 */
let flashGen = 0;
/**
 * The status keys the PREVIOUS paint saw, so a status that merely restacked can be told apart
 * from one that just landed (see `freshStatusKeys`).
 *
 * This was assigned but never declared, and it is declared HERE because the omission broke the
 * real page: `web/app.js` is an ES module, modules are strict mode, and a strict-mode
 * assignment to an undeclared name throws. Every `render()` therefore died with
 * `ReferenceError: lastPlayerStatuses is not defined` at the assignment in `render()`, and the
 * browser surface stopped repainting after the first action — the stage kept whatever the
 * boot paint had put there. The kernel tests did not catch it because they evaluate this file
 * through `new Function()`, whose body is SLOPPY mode, where the same assignment silently
 * creates a global. `git`-less local tree, no CI browser run: nothing executed it strictly.
 */
let lastPlayerStatuses = [];
/** Polite live region. The targeting state is never conveyed by colour alone: every
 *  step that changes what the player can do is also announced as text. */
const liveEl = document.getElementById('live');

/** A fresh random seed per browser game keeps each restart a new run. */
function seedFromUrl() {
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null || raw === '') return Math.floor(Math.random() * 1000000);
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : Math.floor(Math.random() * 1000000);
}

let ctl = createController({ run: { seed: seedFromUrl() } });
let snap = ctl.snapshot();
/** Kernel events of the current run, accumulated for the run-history record (reset in newGame). */
let runEvents = [];
/** Last time a value changed, so a click produces visible feedback. */
let flash = { hp: false, energy: false, block: false, hits: [], n: 0, blockEat: false };
/**
 * The pending visual effect for the action just taken, derived ONLY from the difference
 * between two kernel snapshots. It is presentation data, not game data: every number in
 * it is a subtraction of two values the kernel already published.
 *
 * The kinds are: `vignette`, `wipe`, `card-fly`, `deal`, `float`, `absorbed`,
 * `block-eat`, `death` and `travel`. A `death` burst is only ever appended under reduced
 * motion too — the reduced-motion path still needs to know that a node was left, so it can
 * mark that node as travelled and keep that fact visible statically. `dispatchFx()` drops
 * every animated burst kind on the reduced-motion path.
 */
let bursts = [];
/** The phase the last paint drew, so a phase change animates and a repaint does not. */
let paintedPhase = null;

/* ------------------------------------------------- RENDERER-LOCAL PRESENTATION STATE
 *
 * Everything in this block decides only HOW a moment is SHOWN; none of it can change what
 * is legal or what an outcome is. It is derived from two kernel snapshots the renderer
already holds and from nothing else. Owner ruling: an enemy that WAS alive a moment ago
determines no legality, so tracking that (rather than asking the kernel) is authorised.
 */

/**
 * The enemy list as of the previous paint, by stable `index`. Used for exactly one thing:
 * naming the enemy that has just left the row. The snapshot reports only LIVING enemies,
 * so a dead enemy is simply absent — there is no "died" flag to read, and inventing one
 * would be a rule. Index, not position: an index is stable identity that survives a death,
 * which is the same reason `hitClass` keys on it.
 */
let prevEnemies = [];
/**
 * The enemy ids whose entrance beat has ALREADY been played, for this run. A repaint for an
 * unrelated reason — hovering an enemy calls render() many times a second — must not replay
 * the entrance, so the beat is consumed once per id. `newGame()` clears it, which is what
 * makes a restart animate again. `id` is the kernel's encounter id (`the_guardian`,
 * `nob`): static identity, not a stat, so this reads no rule.
 */
let enteredIds = new Set();
/**
 * The phase whose arrival beat is still owed to the player, or null. Already consumed by
 * `render()` and therefore absent from a paint that merely repeats the phase.
 */
let phaseArriving = null;

/**
 * The one-shot arrival flags a single paint may act on. Every field is a boolean that
 * `render()` sets immediately before drawing and clears on the next paint, which is what
 * makes a beat describe a moment that has just happened rather than replaying on every
 * incidental repaint (a hover must not re-run the boss walking in).
 *
 * `travelTo` is a node id rather than a flag, because the map beat needs to know which
 * node to draw the step toward.
 *
 * @returns {{victory: boolean, defeat: boolean, reward: boolean, rest: boolean, boss: boolean, travelTo: string|null}}
 */
function noArrival() {
  return { victory: false, defeat: false, reward: false, rest: false, boss: false, travelTo: null };
}

/** The one phase beat a paint may play. Reset at the top of every paint. */
let arriving = noArrival();
/**
 * Whether `render()` has still to place the keyboard caret on the arriving panel. Kept
 * OUTSIDE the one-paint reset above because it is consumed by `stageEl.querySelector`
 * after the panel exists, in the same paint — the reset would wipe it in between.
 */
let endFocusPending = false;
/**
 * The map the player was standing on when the last action was taken (`current` node id and
 * floor), recorded by `act()` from the BEFORE snapshot. The travel beat needs the node the
 * step STARTED from, and by the time the new map is drawn that node is a different element
 * on a different row. Presentation only: it names a node to mark, and nothing else.
 */
let prevMapCurrent = null;
let prevMapFloor = null;
/** The travel burst the current paint drew, released with the other one-paint flags. */
let lastTravel = null;
/** The enemy ids whose entrance beat belongs to the paint being built right now. */
let enteringIds = new Set();

/* ------------------------------------------------------------------- TARGETING */
//
// WHO aims WHERE is not decided here. The engine owns the target index; this file only
// collects the player's choice and submits it in the form the engine already accepts.
//
// The frozen interaction contract:
//   * exactly one LIVING enemy  -> plain `p<N>`, no extra step at all;
//   * two or more living enemies -> `p<N> <k>`, where k is 1-based among the LIVING
//     enemies in the order the snapshot prints them. That is `position + 1` below.
//     It is deliberately NOT `enemy.index`: `index` is stable identity that survives a
//     death, so once an enemy in front dies the survivor's `index` stops matching its
//     position. Measured in this repo — kill the first of two enemies and the survivor
//     keeps index 1 while becoming `k` 1.
//   * `all` / `self` cards never ask.
//
// `card.target` is the engine's own answer to "does this card need a target?". While the
// snapshot omits that field the renderer falls back to the card's TYPE, which is an
// INFERENCE, not a rule: see TARGETING-UI-STATUS.md. The fallback never overrides an
// explicit `card.target`.

/** The hand slot ('p3') of the card currently waiting for a target, or null. */
let pendingSlot = null;
/** The 1-based LIVING-enemy slot the pointer, focus or keyboard currently points at. */
let aimed = null;

/**
 * True when this card needs the player to pick an enemy.
 * The kernel now supplies `card.target` ('enemy', 'all', 'self', 'random_enemy', 'none'), so
 * this reads the rule instead of guessing from the card type. The type-based guess is kept
 * only as a fallback for a snapshot that predates the field.
 * @param {any} card a snapshot hand card
 * @returns {boolean}
 */
function needsTarget(card) {
  if (typeof card.target === 'string' && card.target.length > 0) return card.target === 'enemy';
  return card.type === 'attack';
}

/** The card waiting for a target, or null when the hand has moved on under us. */
function pendingCard() {
  if (pendingSlot === null) return null;
  return snap.hand.find((c) => c.slot === pendingSlot) ?? null;
}

/**
 * The action id to submit for a card. `k` is the engine's 1-based living-enemy slot,
 * or null for a card that takes no target.
 *
 * The engine's id form is `p<N>_<K>` with an UNDERSCORE (`p1_2`), which is what
 * `parsePlayId` accepts. This built `${slot} ${k}` with a space, so every aimed click was
 * rejected as an illegal action — the card would look selected and then do nothing.
 * @param {any} card
 * @param {number|null} k
 * @returns {string}
 */
function targetCommand(card, k) {
  if (k == null) return card.slot;
  // Prefer the engine-supplied id for this exact target when it is present, so the two
  // sides can never disagree about how a target is spelled.
  const known = (card.targets || []).find((t) => t.index === k);
  return known ? known.actionId : `${card.slot}_${k}`;
}

/** The spoken description of one enemy, including its telegraphed intent. */
function enemyLabel(e, position, targeting) {
  const total = snap.enemies.length;
  const intent = String(e.intent.text || e.intent.label || '').replace(/\.\s*$/, '');
  const say = intent ? intent.charAt(0).toLowerCase() + intent.slice(1) : 'intent unknown';
  const base = `Enemy ${position + 1} of ${total} — ${e.name}, ${e.hp} of ${e.maxHp} HP, ${say}.`;
  return targeting ? `${base} Press ${position + 1} to target.` : base;
}

/**
 * Announce a line to the live region so the pending state is not purely visual. A fresh
 * text node is appended rather than assigning {textContent} twice, so a repeat of the
 * same sentence is still a change the assistive technology can see.
 * @param {string} msg
 */
function announce(msg) {
  if (!liveEl) return;
  liveEl.replaceChildren(document.createTextNode(msg));
}

/**
 * Every card interaction funnels through here, so the targeting decision lives in ONE
 * place: a card click never plays a target-needing card while several enemies are alive.
 * @param {string} slot the hand slot, e.g. 'p3'
 */
function clickCard(slot) {
  const card = snap.hand.find((c) => c.slot === slot);
  if (!card || !card.playable) return;
  if (pendingSlot !== null) {
    // While a target is being chosen a card click can only ever CANCEL — re-clicking the
    // pending card cancels it, and clicking a different card cancels without playing it.
    // Nothing is played by accident, and no card is ever played at an unstated enemy.
    cancelTargeting();
    return;
  }
  if (snap.enemies.length > 1 && needsTarget(card)) {
    enableTargeting(slot);
    return;
  }
  act(card.slot);
}

/** Enter the pending/targeting state for one hand slot. */
function enableTargeting(slot) {
  pendingSlot = slot;
  aimed = snap.enemies.length > 0 ? 1 : null;
  render();
  const card = snap.hand.find((c) => c.slot === slot);
  announce(`${card ? card.name : 'That card'} needs a target. ${snap.enemies.length} enemies alive. Press 1 to ${snap.enemies.length} to choose one, Escape to cancel.`);
  focusFirstTarget();
}

/** Leave the pending state without playing anything. */
function cancelTargeting() {
  if (pendingSlot === null) return;
  const slot = pendingSlot;
  pendingSlot = null;
  aimed = null;
  render();
  toast('Target cancelled — nothing was played', 'info');
  announce('Target cancelled. Nothing was played.');
  focusSlot(slot);
}

/**
 * Resolve the pending card against and enemy. `k` is the 1-based living-enemy slot; the
 * legality of the resulting id is still the engine's to accept or reject.
 * @param {number} k
 */
function pickTarget(k) {
  const card = pendingCard();
  if (!card) { cancelTargeting(); return; }
  const cmd = targetCommand(card, k);
  pendingSlot = null;
  aimed = null;
  act(cmd, k);
}

/** Track which candidate the pointer or keyboard is on, and repaint the selected cue. */
function setAimed(k) {
  if (pendingSlot === null || aimed === k) return;
  aimed = k;
  render();
}

/** Drop the pending state without a toast — used when the turn moves on underneath us. */
function endTargeting() {
  if (pendingSlot === null) return;
  pendingSlot = null;
  aimed = null;
}

/** Move keyboard focus onto the first legal target once the step appears. */
function focusFirstTarget() {
  if (!stageEl.querySelector) return;
  const node = stageEl.querySelector('.enemy.targeting');
  if (node && typeof node.focus === 'function') { try { node.focus(); } catch { /* focus is best effort */ } }
}

/** Put focus back on the card a cancelled step came from. */
function focusSlot(slot) {
  if (!stageEl.querySelector) return;
  const node = stageEl.querySelector(`[data-slot="${slot}"]`);
  if (node && typeof node.focus === 'function') { try { node.focus(); } catch { /* focus is best effort */ } }
}

// Clicking empty space (or any control that is not a target) cancels the step. Bound to
// the stage, which survives every repaint, so this is registered exactly once.
//
// THE BUG THIS FIXES: this handler and a control's own click handler both fire for the SAME
// click. Entering targeting mode from a card therefore engaged the step (card handler) and
// then immediately cancelled it (this handler), because the click target was a card, not an
// enemy — which is why the step flashed up and vanished, clicking an enemy did nothing, and
// hotkeys appeared to work: a key event never reaches this listener.
//
// The fix is to let a control that has already handled a click mark the event consumed, and
// for this fallback to ignore it.
if (stageEl && stageEl.addEventListener) {
  stageEl.addEventListener('click', (ev) => {
    if (ev.__dlbHandled) return;
    if (pendingSlot === null) return;
    const t = ev.target;
    if (t && t.closest && (t.closest('.enemy') || t.closest('.cancel-target'))) return;
    cancelTargeting();
  });
}

/** Mark a click as consumed so the stage fallback does not also act on it. */
function consumeClick(ev) {
  if (ev) ev.__dlbHandled = true;
}

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

/**
 * Fill `node` with `text`, wrapping kernel glossary words (Block, Vulnerable, Exhaust…)
 * in gold keyword spans with the kernel's own meaning as the tooltip, and "Lose N HP"
 * costs in ember red. Text nodes only: nothing is parsed as HTML. Presentation only.
 * @param {HTMLElement} node
 * @param {string} text
 * @returns {HTMLElement}
 */
function keywordText(node, text) {
  const terms = new Map();
  for (const row of snap.glossary || []) {
    if ((row.group === 'A' || row.group === 'B') && /^[A-Z][a-z]+$/.test(row.label || '')) terms.set(row.label.toLowerCase(), row.meaning);
  }
  const str = String(text ?? '');
  if (terms.size === 0) { node.textContent = str; return node; }
  const words = [...terms.keys()].sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp(`(Lose \\d+ HP)|\\b(${words})\\b`, 'gi');
  let at = 0;
  for (const m of str.matchAll(re)) {
    if (m.index > at) node.append(str.slice(at, m.index));
    if (m[1]) node.append(el('span', { cls: 'kw kw-cost', text: m[1] }));
    else node.append(el('span', { cls: 'kw', text: m[2], attrs: { title: terms.get(m[2].toLowerCase()) || '' } }));
    at = m.index + m[0].length;
  }
  if (at < str.length) node.append(str.slice(at));
  return node;
}

function toast(msg, kind = 'warn') {
  toastEl.textContent = msg;
  toastEl.className = kind === 'info' ? 'show info' : 'show';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.className = ''; }, 1600);
}

/* ------------------------------------------------------------------------ glyphs */
//
// Every mark is inline SVG built from the static table below and injected into a span.
// Two deliberate properties worth stating:
//   * the markup is 100% constant — no kernel value and no user input is ever
//     interpolated into it, which is what makes innerHTML safe here;
//   * the <svg> element carries no `xmlns` attribute, because the HTML parser places
//     it in the SVG namespace on its own. That keeps this file free of any URL-shaped
//     string at all, so an "no external asset" grep over web/ can be trusted.
// Anything unknown falls back to a rune, so a new enemy or node type in the kernel
// renders as a generic shape rather than an empty box.

const GLYPHS = {
  // --- card types: crossed blades / shield / star / hourglass / skull ---
  // --- decorative art-band outlines (design rev 2): no gameplay meaning, so no TYPE_GLYPH ---
  cleave: { box: '0 0 20 20', body: '<path class="m" d="M3 3 L17 17"/><path class="m" d="M14 3 L17 3 L17 6"/><path class="m" d="M3 14 L3 17 L6 17"/>' },
  sweep: { box: '0 0 20 20', body: '<path class="m" d="M3 16 C6 10 14 10 17 4"/><path class="m" d="M3 11 C6 6 12 6 14 3"/>' },
  ward: { box: '0 0 20 20', body: '<circle class="m" cx="10" cy="10" r="6"/><path class="m" d="M10 1 V5"/><path class="m" d="M10 15 V19"/>' },
  blade: { box: '0 0 20 20', body: '<path class="m" d="M4 16 L15 5"/><path class="m" d="M11 4 L16 4 L16 9"/><path class="m" d="M3 17 L6 14"/>' },
  shield: { box: '0 0 20 20', body: '<path class="m" d="M10 2 L17 5 V11 C17 15 14 17.4 10 18.6 C6 17.4 3 15 3 11 V5 Z"/><path class="m" d="M10 7 V13"/>' },
  star: { box: '0 0 20 20', body: '<path class="m" d="M10 2 L11.9 8.1 L18 10 L11.9 11.9 L10 18 L8.1 11.9 L2 10 L8.1 8.1 Z"/>' },
  hourglass: { box: '0 0 20 20', body: '<path class="m" d="M5 3 H15 M5 17 H15 M6.5 3 V6 L10 10 L13.5 6 V3 M6.5 17 V14 L10 10 L13.5 14 V17"/>' },
  skull: { box: '0 0 20 20', body: '<path class="m" d="M10 2 C13.9 2 17 5 17 8.6 C17 11 15.6 12.6 14.2 13.6 V16.4 H5.8 V13.6 C4.4 12.6 3 11 3 8.6 C3 5 6.1 2 10 2 Z"/><circle class="mf" cx="7.4" cy="9" r="1.5"/><circle class="mf" cx="12.6" cy="9" r="1.5"/>' },
  rune: { box: '0 0 20 20', body: '<path class="m" d="M10 2 L18 10 L10 18 L2 10 Z"/><circle class="m" cx="10" cy="10" r="3.2"/>' },

  // --- intent kinds: strike bar / shield / chevrons up / chevrons down ---
  strike: { box: '0 0 40 30', body: '<path class="strike" d="M5 15 H26" stroke-width="5" stroke-linecap="round"/><path class="strike" d="M25 7 L35 15 L25 23" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  shieldWide: { box: '0 0 40 30', body: '<path class="shld" d="M20 3.5 L33 8 V16 C33 21.6 27 24.6 20 27.4 C13 24.6 7 21.6 7 16 V8 Z"/><path class="shld" d="M20 10 V21"/>' },
  chevUp: { box: '0 0 40 30', body: '<path class="chev" d="M8 21 L20 10 L32 21"/><path class="chev" d="M8 29 L20 18 L32 29"/>' },
  chevDown: { box: '0 0 40 30', body: '<path class="chev" d="M8 9 L20 20 L32 9"/><path class="chev" d="M8 17 L20 28 L32 17"/>' },

  // --- map node silhouettes ---
  sword: { box: '0 0 26 26', body: '<path class="m" d="M5 21 L18 8"/><path class="m" d="M13 5 L21 13"/>' },
  swords: { box: '0 0 26 26', body: '<path class="m" d="M5 5 L21 21"/><path class="m" d="M21 5 L5 21"/>' },
  spikes: { box: '0 0 26 26', body: '<path class="m" d="M4 19 L13 5 L22 19"/><path class="m" d="M4 23 H22"/>' },
  flame: { box: '0 0 26 26', body: '<path class="m" d="M13 22 C7 18 9.5 13 12 9 C13 12.5 16.5 12 15.5 7.5 C20 12 20.5 18 13 22 Z"/><path class="m" d="M5 23 H21"/>' },
  horns: { box: '0 0 26 26', body: '<path class="m" d="M9 9 C5 6 4 3 4 2 C7 3 9 5 10 7"/><path class="m" d="M17 9 C21 6 22 3 22 2 C19 3 17 5 16 7"/><path class="m" d="M13 6 C17.4 6 20 9 20 12.6 C20 15 18.6 16.6 17.2 17.6 V21.4 H8.8 V17.6 C7.4 16.6 6 15 6 12.6 C6 9 8.6 6 13 6 Z"/><circle class="mf" cx="10" cy="12" r="1.5"/><circle class="mf" cx="16" cy="12" r="1.5"/>' },
  route: { box: '0 0 26 26', body: '<path class="m" d="M5 21 C12 21 8 5 21 5"/><circle class="mf" cx="5" cy="21" r="2.2"/><circle class="mf" cx="21" cy="5" r="2.2"/>' },
  crown: { box: '0 0 26 26', body: '<path class="m" d="M4 19 L4 8 L9 13 L13 5 L17 13 L22 8 L22 19 Z"/><path class="m" d="M4 22 H22"/>' },
  broken: { box: '0 0 26 26', body: '<path class="m" d="M12 3 L15 11"/><path class="m" d="M14 15 L8 23"/><path class="m" d="M18 5 L21 12"/>' },

  // --- enemy illustrations (art-direction rev): forged-iron woodcut. Three layers per
  //     creature: `.b` body (near-black iron), `.r` rim light (currentColor = the creature's
  //     tint), `.g` ember glow (eyes, cores, cracks). Constant markup, no interpolation. ---
  'e-worm': { box: '0 0 100 100', body: '<path class="b" d="M10 92 C8 70 14 52 30 44 C42 38 56 40 64 30 C70 22 80 20 88 26 L84 36 C78 32 72 34 68 40 C60 52 46 54 38 60 C28 68 26 80 30 92 Z"/><path class="r" d="M10 92 C8 70 14 52 30 44 C42 38 56 40 64 30 C70 22 80 20 88 26"/><path class="r" d="M18 72 L28 76 M22 60 L32 66 M34 50 L40 58 M48 44 L50 52"/><path class="b" d="M66 30 L92 18 L84 34 L94 40 L70 42 Z"/><path class="r" d="M66 30 L92 18 L84 34 L94 40 L70 42"/><path class="g" d="M84 24 l3 3 -3 1z M74 36 l3 0 -1 3z"/><circle class="g" cx="76" cy="26" r="2.6"/><path class="gr" d="M4 94 H96"/>' },
  'e-louse': { box: '0 0 100 100', body: '<path class="r" d="M26 56 L8 46 M26 66 L6 70 M30 76 L14 88 M74 56 L92 46 M74 66 L94 70 M70 76 L86 88"/><ellipse class="b" cx="50" cy="62" rx="28" ry="24"/><path class="r" d="M22 62 C22 48 34 38 50 38 C66 38 78 48 78 62 C78 76 66 86 50 86 C34 86 22 76 22 62 Z"/><path class="r" d="M28 54 C40 48 60 48 72 54 M26 66 C40 60 60 60 74 66 M30 77 C42 72 58 72 70 77"/><path class="b" d="M38 40 C38 30 62 30 62 40 Z"/><path class="r" d="M38 40 C38 30 62 30 62 40 M42 32 L32 14 M58 32 L68 14"/><circle class="g" cx="44" cy="36" r="2.6"/><circle class="g" cx="56" cy="36" r="2.6"/>' },
  'e-slime': { box: '0 0 100 100', body: '<path class="b" d="M12 88 C12 66 20 50 30 40 C38 32 44 22 50 14 C56 22 62 32 70 40 C80 50 88 66 88 88 Z"/><path class="r" d="M12 88 C12 66 20 50 30 40 C38 32 44 22 50 14 C56 22 62 32 70 40 C80 50 88 66 88 88"/><path class="r" d="M30 88 C30 94 26 96 24 92 M64 88 C64 96 70 97 70 91"/><circle class="r" cx="62" cy="56" r="5"/><circle class="r" cx="34" cy="70" r="3.4"/><circle class="r" cx="56" cy="76" r="2.4"/><path class="g" d="M38 54 l8 4 -8 3z M62 66 l-8 -4 8 -3z" transform="translate(0 -6)"/><path class="gr" d="M6 89 H94"/>' },
  'e-cultist': { box: '0 0 100 100', body: '<path class="b" d="M50 10 C64 12 70 28 68 42 L80 92 H20 L32 42 C30 28 36 12 50 10 Z"/><path class="r" d="M50 10 C64 12 70 28 68 42 L80 92 H20 L32 42 C30 28 36 12 50 10 Z"/><path class="b" d="M40 30 C40 22 60 22 60 30 L58 44 H42 Z"/><path class="r" d="M50 44 V92 M34 60 C42 56 58 56 66 60"/><circle class="g" cx="45" cy="34" r="2.3"/><circle class="g" cx="55" cy="34" r="2.3"/><path class="r" d="M80 92 L86 20"/><path class="g" d="M86 8 C90 14 90 18 86 20 C82 18 82 14 86 8 Z"/>' },
  'e-brute': { box: '0 0 100 100', body: '<path class="b" d="M50 22 C70 22 84 34 86 52 L90 92 H10 L14 52 C16 34 30 22 50 22 Z"/><path class="r" d="M50 22 C70 22 84 34 86 52 L90 92 H10 L14 52 C16 34 30 22 50 22 Z"/><path class="r" d="M34 26 C24 18 20 8 22 2 C30 6 36 14 40 22 M66 26 C76 18 80 8 78 2 C70 6 64 14 60 22"/><path class="r" d="M30 50 C40 46 60 46 70 50 M38 62 L50 70 L62 62"/><path class="g" d="M36 40 l8 3 -8 2z M64 40 l-8 3 8 2z"/><path class="gc" d="M22 70 L30 78 L26 88 M78 70 L72 80 L76 88"/>' },
  'e-sentinel': { box: '0 0 100 100', body: '<path class="b" d="M50 4 L84 16 L90 50 C86 72 70 86 50 96 C30 86 14 72 10 50 L16 16 Z"/><path class="r" d="M50 4 L84 16 L90 50 C86 72 70 86 50 96 C30 86 14 72 10 50 L16 16 Z"/><path class="r" d="M50 14 L74 24 L78 50 C74 66 64 76 50 84 C36 76 26 66 22 50 L26 24 Z"/><path class="r" d="M30 40 H70 M50 14 V30 M50 64 V84"/><path class="gc" d="M36 30 L42 36 L38 40 M64 30 L58 36 L62 40 M22 60 L30 62 M78 60 L70 62"/><circle class="g" cx="50" cy="52" r="8"/><circle class="r" cx="50" cy="52" r="12"/>' },
  'e-rune': { box: '0 0 100 100', body: '<path class="b" d="M50 12 L86 50 L50 88 L14 50 Z"/><path class="r" d="M50 12 L86 50 L50 88 L14 50 Z"/><circle class="g" cx="50" cy="50" r="7"/><circle class="r" cx="50" cy="50" r="14"/>' },
};

/**
 * Static SVG markup for a named mark. Unknown names fall back to a rune so a new
 * kernel type still renders as a shape rather than nothing.
 * @param {string} name
 * @returns {string}
 */
function glyphMarkup(name) {
  const spec = GLYPHS[name] || GLYPHS.rune;
  return `<svg viewBox="${spec.box}" aria-hidden="true" focusable="false">${spec.body}</svg>`;
}

/**
 * Wrap a mark in a classed span so the CSS can size and colour it. Decorative: every
 * mark is `aria-hidden`, because each one sits beside its own words (a type word, an
 * intent sentence, a node label).
 * @param {string} name key in GLYPHS
 * @param {string} cls the wrapper's class
 * @returns {HTMLElement}
 */
function glyphBox(name, cls) {
  const box = el('span', { cls });
  box.innerHTML = glyphMarkup(name);
  return box;
}

/** Card type -> its mark. The three cues are hue, mark and the type word. */
const TYPE_GLYPH = { attack: 'blade', skill: 'shield', power: 'star', status: 'hourglass', curse: 'skull' };

/** Intent kind -> its mark. */
const INTENT_GLYPH = { attack: 'strike', block: 'shieldWide', buff: 'chevUp', debuff: 'chevDown' };

/** Node type (after stripping the `combat_` prefix) -> its silhouette. */
const NODE_GLYPH = { weak: 'sword', strong: 'swords', elite: 'spikes', rest: 'flame', boss: 'horns' };

/** Node type -> the words a player reads on the map. Presentation only: the kernel's
 *  own label ("fight", "fight+") still drives the title and the travel banner. The second
 *  line states only what the kernel's NODE_TYPES.reward says (card or heal). */
const NODE_WORDS = {
  weak: ['Skirmish', 'card reward'], strong: ['Hard fight', 'card reward'], elite: ['Elite', 'card reward'],
  rest: ['Campfire', 'heal'], boss: ['Slag Warden', 'final fight'],
};

/**
 * Pick a silhouette, boss/elite framing and a rim tint from the enemy's NAME. The
 * snapshot carries the name; nothing here reads a rule or a stat.
 * @param {string} name
 * @returns {{art: string, boss: boolean, elite: boolean, hue: number}}
 */
function enemyLook(id) {
  const table = {
    jaw_worm: { art: 'e-worm', hue: 1 },
    cultist: { art: 'e-cultist', hue: 4 },
    red_louse: { art: 'e-louse', hue: 1 },
    acid_slime: { art: 'e-slime', hue: 3 },
    gremlin_nob: { art: 'e-brute', elite: true, hue: 2 },
    the_guardian: { art: 'e-sentinel', boss: true, hue: 1 },
  };
  const hit = table[id];
  if (hit) return { art: hit.art, boss: Boolean(hit.boss), elite: Boolean(hit.elite), hue: hit.hue };
  return { art: 'e-rune', boss: false, elite: false, hue: 0 };
}

/* --------------------------------------------------------- the one dispatch path */

/**
 * Every interaction funnels here: dispatch one kernel action id, then repaint.
 * @param {string} actionId the engine's action id
 * @param {number|null} [targetK] the living-enemy slot the player aimed at, when the
 *   action was a targeted play — used ONLY to name the enemy in the feedback sentence.
 */
function act(actionId, targetK = null) {
  if (!actionId) return;
  pileOpen = null;
  const before = snap;
  // The map the player is standing on BEFORE this action, kept for the travel beat: the
  // node the step started from is gone from the rebuilt map, and this is the only handle on
  // it. Recorded from the snapshot, never computed from a coordinate.
  prevMapCurrent = before.map.current;
  prevMapFloor = before.map.floor;
  // Resolved from the BEFORE snapshot: the enemy the player aimed at is the one at that
  // living position before the play, which may not exist at all after it (it can die).
  const aimedAt = targetK != null ? before.enemies[targetK - 1] ?? null : null;
  const res = ctl.dispatch(actionId);
  const after = ctl.snapshot();
  // The kernel's event stream for this step, kept for the run record. `submit()` inside the
  // controller accumulates the same events on the session; the renderer accumulates them
  // here because it builds the record at the end, and a record built from a dropped stream
  // scores zero kills while looking perfectly well-formed (DR-6).
  if (Array.isArray(res.events)) runEvents = [...runEvents, ...res.events];

  const fx = [];
  if (res.error) {
    toast(`✗ ${res.error.error} — "${res.error.id}" is not legal right now`);
    announce(`That action was rejected: ${res.error.error}.`);
  } else {
    // Presentation-only feedback: compare the two kernel snapshots we already have.
    const playerLost = before.player.hp - after.player.hp;
    const enemyLost = sumEnemyHp(before) - sumEnemyHp(after);
    const gainedBlock = after.player.block - before.player.block;
    if (playerLost > 0) toast(`You take ${playerLost} damage`, 'warn');
    else if (enemyLost > 0) toast(aimedAt ? `Dealt ${enemyLost} damage to ${aimedAt.name}` : `Dealt ${enemyLost} damage`, 'info');
    else if (gainedBlock > 0) toast(`+${gainedBlock} block`, 'info');

    /* ------------------------------------------------------------ JUICE ----------
     * The SAME diff that produced the toast above is read again for the visual effects.
     * No extra rules: a floater exists exactly where damage was dealt.
     */

    // Player hurt -> a screen pulse. It lives in the layer `render()` cannot clear, so
    // it does not depend on the enemy's HTML surviving the repaint.
    if (playerLost > 0) fx.push({ kind: 'vignette' });
    // The number is the HP delta between the two kernel snapshots, so it is the damage
    // that actually landed. Block gained is the same kind of delta.
    if (playerLost > 0) {
      fx.push({ kind: 'hero-float', amount: playerLost, tone: 'dmg', tier: playerLost >= 16 ? 3 : playerLost >= 8 ? 2 : 1 });
    }
    if (gainedBlock > 0) fx.push({ kind: 'hero-float', amount: gainedBlock, tone: 'block', tier: 1 });
    if (playerLost > 0 && after.turn !== before.turn) {
      for (const e of before.enemies) {
        if (e.intent && e.intent.kind === 'attack') fx.push({ kind: 'enemy-strike', enemy: e.index });
      }
    }

    // Per-enemy: the damage that landed (HP delta), the glyph tier for that amount, and
    // whether block ate all of it. The bar still shows the remaining total.
    const beforeByIdx = new Map(before.enemies.map((e) => [e.index, e]));
    let absorbed = false;
    for (const e of after.enemies) {
      const was = beforeByIdx.get(e.index);
      if (!was || e.hp >= was.hp) continue;
      const dealt = was.hp - e.hp;
      const tier = dealt >= 16 ? 3 : dealt >= 8 ? 2 : 1;
      fx.push({ kind: 'float', enemy: e.index, amount: dealt, tone: 'dmg', tier, defeated: e.hp <= 0 });
      if (was.block > 0) fx.push({ kind: 'block-eat', enemy: e.index });
    }
    for (const e of after.enemies) {
      const was = beforeByIdx.get(e.index);
      if (was && e.block > was.block && e.hp === was.hp) {
        fx.push({ kind: 'float', enemy: e.index, amount: e.block - was.block, tone: 'block', tier: 1 });
      }
    }
    // A hit that was FULLY absorbed leaves the enemy's HP untouched, so the loop above
    // never fires. Detected by the enemy's block falling while its HP held — and it says
    // so in words, because "0" or "−0" would contradict a bar that did not move.
    for (const e of after.enemies) {
      const was = beforeByIdx.get(e.index);
      if (was && was.block > e.block && e.hp === was.hp) {
        fx.push({ kind: 'absorbed', enemy: e.index });
        absorbed = true;
      }
    }

    // Card played: it travels toward the enemy row as a copy on the effect layer. The
    // copy is built from the hand tile the player actually clicked, so the thing that
    // flies is the thing they pressed; the tile itself is gone from the rebuilt tree.
    if (before.phase === 'combat' && after.phase === 'combat') {
      const playedSlot = actionId.split('_')[0];
      const played = before.hand.find((c) => c.slot === playedSlot && c.cardId);
      if (played) {
        const aimIdx = targetK != null && aimedAt ? (after.enemies.find((e) => e.index === aimedAt.index) ?? null) : null;
        fx.push({
          kind: 'card-fly',
          name: played.name,
          type: played.type,
          // A whole lane class, not an index: `positionClass` already returns `side-0` etc.
          side: aimIdx ? positionClass(aimIdx.index, after.enemies) : 'side-none',
        });
      }
      // The hand the player is looking at changed: the replacement cards fan in.
      if (handKey(before.hand) !== handKey(after.hand)) fx.push({ kind: 'deal' });
    }

    // A TRAVEL along the map. The map is rebuilt on every paint too, so the departing node
    // is gone by the time the new one is drawn. The node the player stood on is therefore
    // named here, from the before/after map snapshots, and the new tree draws it once more
    // as an inert marker that travels to its replacement. `map.current` is the kernel's own
    // answer to "where am I standing" — nothing is inferred from coordinates.
    if (before.phase === 'map' && after.phase === 'map' && before.map.current !== after.map.current) {
      const from = before.map.rows.flat().find((n) => n.id === before.map.current) ?? null;
      const to = after.map.rows.flat().find((n) => n.id === after.map.current) ?? null;
      fx.push({
        kind: 'travel',
        floor: after.map.floor,
        label: to ? to.label : '',
        // The row the step started on, so the new tree can put the marker back on the
        // departing node's own row (`r-<floor>`), beside the node the player now stands on.
        fromRow: from ? from.row : null,
        boss: Boolean(to && to.type === 'boss'),
      });
    }

    // Switching turns is the one moment there is genuinely nothing new to paint yet, so
    // the screen gets a beat before the enemy's action lands.
    if (after.phase === 'combat' && after.turn !== before.turn) fx.push({ kind: 'wipe' });
  }

  // Which enemies lost HP, by index, so only they shake.
  const hits = [];
  const beforeHp = new Map(before.enemies.map((e) => [e.index, e.hp]));
  for (const e of after.enemies) {
    const was = beforeHp.get(e.index);
    if (typeof was === 'number' && e.hp < was) hits.push(e.index);
  }

  const dying = before.enemies
    .filter((e) => !after.enemies.some((a) => a.index === e.index))
    .map((e) => ({
      ...e,
      side: positionClass(e.index, after.enemies, before.enemies, e.index),
      // Whether a BOSS just left the field. Read from the name (`enemyLook` already maps
      // "Guardian" -> boss for the card frame), never from a stat: it decides how large the
      // collapse reads, and nothing else. The victory beat is gated on this below, which is
      // how "the boss dies, THEN the panel arrives" is sequenced without asking the kernel
      // for a new field.
      boss: enemyLook(e.id).boss,
    }));
  // Each departure becomes a `death` burst, which the next paint draws as an inert ghost
  // card that collapses. The ghost is positioned by ENEMY ROW ORDER (`side-*`), never by a
  // measured coordinate.
  for (const d of dying) fx.push({ kind: 'death', enemy: d.index, name: d.name, side: d.side, boss: d.boss });

  /* ------------------------------------------------------------- PHASE ARRIVALS ------
   * The end-of-run beat. `ended` is reached the instant the last enemy (or the player) is
   * removed from the snapshot, so the panel would otherwise appear in the same frame as the
   * killing blow and read as an instant pop. Which arrival the next paint plays is decided
   * here, ONCE, from the before/after snapshots; `render()` consumes it and clears it, so an
   * incidental repaint can never re-trigger it.
   *
   * The delay itself lives in `render()`, because the panel must also be able to stay hidden
   * until the collapse has finished.
   */
  if (after.phase === 'ended' && before.phase !== 'ended') {
    phaseArriving = after.outcome === 'win' ? 'victory' : 'defeat';
  }

  // The generation advances ONLY if a flash state actually changed, so an unrelated
  // repaint re-emits the identical class string and the animation is not restarted.
  const nextFlash = {
    hp: after.player.hp < before.player.hp,
    energy: after.player.energy !== before.player.energy,
    block: after.player.block > before.player.block,
    hits,
    blockEat: fx.some((f) => f.kind === 'block-eat' || f.kind === 'absorbed'),
    n: flash.n,
  };
  if (nextFlash.hp !== flash.hp || nextFlash.energy !== flash.energy
    || nextFlash.block !== flash.block || nextFlash.blockEat !== flash.blockEat
    || nextFlash.hits.join() !== flash.hits.join()) {
    nextFlash.n = flash.n + 1;
  }
  flash = nextFlash;
  bursts = fx;
  snap = after;
  // The victory/defeat panel must WAIT for the collapse that precedes it, so a run that ends
  // on this action is marked here and `render()` holds the stage empty for one beat. A run
  // that was ALREADY over (a restart) never reaches this line, which is why a fresh run
  // paints its map immediately instead of waiting for a death that already happened.
  if (after.phase !== before.phase) {
    if (after.phase === 'ended') {
      // The panel must WAIT for the collapse that precedes it, so the run is marked here and
      // `render()` holds the stage empty for one beat. A run that was ALREADY over (a
      // restart) never reaches this line, which is why a fresh run paints its map at once.
      phaseArriving = after.outcome === 'win' ? 'victory' : 'defeat';
      endFocusPending = true;
    } else if (after.phase === 'reward') {
      phaseArriving = 'reward';
    } else if (after.phase === 'rest') {
      phaseArriving = 'rest';
    }
  }
  render();
  dispatchFx();
}

/**
 * The hand's identity as a string, so "did the hand change?" is a comparison rather than
 * a guess. Only the cards and their order count — hovering an enemy calls render() again
 * with the same hand, and that must never re-deal it.
 */
const handKey = (hand) => (hand || []).map((c) => c.slot + ':' + c.cardId).join('|');

/**
 * Which column of the enemy row an index sits in, as my own class vocabulary: `side-0`
 * for the leftmost LIVING enemy, `side-1` for the rightmost, `side-mid` for anything in
 * between, `side-none` for an enemy whose row is now empty. A boolean cannot shift a
 * floater to the wrong enemy the way an index can, and no pixel is measured.
 */
function positionClass(index, after, before = null, explicit = null) {
  const idx = explicit != null ? explicit : index;
  const row = after.length > 0 ? after : (before || []);
  if (row.length === 0) return 'side-none';
  const at = row.findIndex((e) => e.index === idx);
  const pos = at === -1 ? 0 : at;
  if (row.length === 1) return 'side-0';
  if (pos === 0) return 'side-0';
  if (pos === row.length - 1) return 'side-1';
  return 'side-mid';
}

const sumEnemyHp = (s) => s.enemies.reduce((n, e) => n + e.hp, 0);

function newGame(seed = null) {
  // A NEW run, built for the profile the player's own history has earned (DR-4). The
  // narrowing happens in the kernel: `contentForProfile` decides which cards EXIST, and no
  // rule ever reads the profile. `?pool=full` bypasses the narrowing for a tester.
  ctl = createController({ run: { seed: seed ?? seedFromUrl(), content: contentForProfile(currentProfile()) } });
  snap = ctl.snapshot();
  // The event stream is per-RUN, so it dies with the run. It is the only source of the kill
  // / elite / boss counts the score needs, which is why it is accumulated rather than
  // re-derived later from a snapshot that never carried them.
  runEvents = [];
  lastRecord = null;
  lastUnlock = null;
  savedOk = true;
  clearFxTimers();
  if (fxEl && fxEl.replaceChildren) fxEl.replaceChildren();
  flash = { hp: false, energy: false, block: false, hits: [], n: 0, blockEat: false };
  bursts = [];
  pileOpen = null;
  animGen += 1;
  clearHitstop();
  dealPending = false;
  dyingThisPaint = [];
  lastPlayerStatuses = [];
  paintedPhase = null;
  // A new run must animate its own entrance and its own victory/defeat, so every one-shot
  // presentation flag is cleared with the timers that would have released it.
  prevEnemies = [];
  enteredIds = new Set();
  phaseArriving = null;
  arriving = noArrival();
  endFocusPending = false;
  prevMapCurrent = null;
  prevMapFloor = null;
  lastTravel = null;
  enteringIds = new Set();
  pendingSlot = null;
  aimed = null;
  render();
}

/* ------------------------------------------------------------------------- HUD */

function renderHud() {
  hudEl.replaceChildren();
  const p = snap.player;

  hudEl.append(
    el('span', {
      cls: 'hud-char',
      text: snap.characterName || capitalize(snap.character),
      attrs: { title: snap.relicName ? `${snap.characterName} — relic: ${snap.relicName}` : '' },
    }),
  );

  // DESIGN REV 3 (UX spec): the word label is NOT part of the value text. Emitting `HP 60/60`
  // as one text node inside a chip with a 44px min-width is what wrapped the HUD into
  // two-line blocks on a phone ("HP" over "60/60"). The glyph carries the label, the title
  // carries the full sentence for hover and screen readers, and the value can never wrap.
  hudEl.append(stat('hp', '♥', `${p.hp}/${p.maxHp}`, flash.hp, `HP ${p.hp} of ${p.maxHp}`));
  hudEl.append(stat('energy', '⚡', `${p.energy}/${snap.energyPerTurn}`, flash.energy,
    `Energy ${p.energy} of ${snap.energyPerTurn}`));
  hudEl.append(stat('block', '⛨', String(p.block), flash.block, `Block ${p.block}`));
  hudEl.append(el('span', { cls: 'hud-step', text: `step ${snap.stepIndex}` }));

  // A status that just landed on the PLAYER gets the same by-kind treatment as an enemy's.
  const freshSelf = freshStatusKeys([...(p.statuses || []), ...(p.powers || [])]);
  for (const s of p.statuses) hudEl.append(el('span', {
    cls: `pill ${s.key}` + (freshSelf.has(s.key) ? ' juice-in' : ''),
    text: s.text || `${s.label} ${s.stacks}`,
    attrs: { title: s.explain || '' },
  }));
  for (const pw of p.powers) hudEl.append(el('span', {
    cls: 'pill power' + (freshSelf.has(pw.key) ? ' juice-in' : ''),
    text: pw.text || `${pw.label || pw.key} ${pw.stacks}`,
    attrs: { title: pw.explain || '' },
  }));

  hudEl.append(el('span', { cls: 'spacer' }));
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: 'Help',
    attrs: { type: 'button', title: 'How to play, and what every abbreviation means — keyboard: ?' },
    on: { click: () => toggleHelp(true) },
  }));
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: 'New Run',
    attrs: { type: 'button', title: `New run (seed ${snap.seed}) — keyboard: n` },
    on: { click: newGame },
  }));
}

/* ----------------------------------------------------------------- HELP / GLOSSARY */

let helpOpen = false;
const HELP_SEEN_KEY = 'dlb.helpSeen.v1';

function toggleHelp(open) {
  helpOpen = open;
  render();
}

/**
 * The how-to-play panel and the keyword glossary. Every string comes from the kernel
 * (`snap.help`, `snap.glossary`), so the browser can never explain a rule differently
 * from the engine that enforces it.
 */
/**
 * The how-to-play panel and the keyword glossary. Every string comes from the kernel
 * (`snap.help`, `snap.glossary`), so the browser can never explain a rule differently
 * from the engine that enforces it.
 *
 * Structure note (phone fix): the sheet has an INNER `.modal-scroll` and the `Got it`
 * control is a SIBLING of that scroller, not a child of it. Laid out this way the sheet is
 * a column, the scroller takes the leftover height with `min-height: 0`, and the footer is
 * simply the last row — so the dismiss button is on screen at every viewport height with no
 * `position: fixed`, no measured geometry and no compromise to the document scroll. Before
 * this, a 390x844 phone put `Got it` below the fold of a ~760px sheet and the only ways out
 * were Escape or tapping the backdrop.
 */
function helpPanel() {
  const back = el('div', { cls: 'modal-back' });
  back.addEventListener('click', (ev) => { if (ev.target === back) toggleHelp(false); });

  const panel = el('div', { cls: 'modal', attrs: { role: 'dialog', 'aria-label': 'How to play' } });
  // Everything that can be long lives in the scroller: the panel scrolls INSIDE the
  // viewport instead of growing past it.
  const scroll = el('div', { cls: 'modal-scroll' });
  scroll.append(el('h2', { text: 'How to play' }));

  for (const topic of snap.help || []) {
    scroll.append(el('div', { cls: 'help-topic' },
      el('div', { cls: 'ht-title', text: topic.title }),
      el('div', { cls: 'ht-body', text: topic.body }),
    ));
  }

  // How targeting works is the SURFACE's behaviour, not a game rule, so this line lives
  // here rather than in the kernel's help topics: the engine has no opinion about clicks.
  scroll.append(el('div', { cls: 'help-topic' },
    el('div', { cls: 'ht-title', text: 'Aiming at one enemy' }),
    el('div', { cls: 'ht-body', text: 'When more than one enemy is alive, clicking a card that needs a target does not play it yet — the card lifts and every enemy that can be hit is highlighted and numbered. Click a highlighted enemy, or press its number, to hit that one; the enemy\'s telegraphed intent is shown beside it while you decide, so you can spend the hit on the one that hurts most. Press Escape, press 0, click the card again, or click empty space to put the card back and play something else. With a single enemy alive a card still plays in one click, and cards that say ALL or SELF never ask.' }),
  ));

  scroll.append(el('h2', { cls: 'mt', text: 'What the shorthand means' }));
  scroll.append(el('p', { cls: 'hint', text: 'Cards always describe themselves in words. These compact codes appear in the corner of a card, in the enemy\'s intent, and in the command-line version of the game.' }));

  // Grouped, so the vocabulary a player meets on every card is separated from the codes
  // that only ever appear on one card. The kernel supplies the grouping.
  const sections = snap.glossarySections || [{ key: 'A', title: 'Codes', blurb: '' }];
  for (const section of sections) {
    const rows = (snap.glossary || []).filter((r) => (r.group || 'A') === section.key);
    if (rows.length === 0) continue;
    scroll.append(el('h3', { cls: 'gl-section', text: section.title }));
    if (section.blurb) scroll.append(el('p', { cls: 'gl-blurb', text: section.blurb }));
    const list = el('dl', { cls: 'glossary' });
    for (const row of rows) {
      list.append(el('dt', { cls: 'gl-token', text: row.token }));
      list.append(el('dd', { cls: 'gl-cell' },
        el('span', { cls: 'gl-label', text: row.label }),
        el('span', { cls: 'gl-meaning', text: row.meaning }),
      ));
    }
    scroll.append(list);
  }

  panel.append(scroll);
  panel.append(el('div', { cls: 'modal-foot' },
    el('button', {
      cls: 'btn',
      text: 'Got it',
      attrs: { type: 'button' },
      on: { click: () => { try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch {} toggleHelp(false); } },
    }),
    // New Run moved here from the HUD (UX rev 3): it is destructive — it discards the run —
    // and never belonged one tap from End Turn. The `n` hotkey still starts a new run.
    el('button', {
      cls: 'btn secondary',
      text: 'New Run',
      attrs: { type: 'button', title: 'Discard this run and start a new one (keyboard: n)' },
      on: { click: newGame },
    }),
  ));

  back.append(panel);
  return back;
}

function stat(kind, glyph, text, isFlash, title) {
  // Two independent cues on the same element: the colour flash (which value changed) and
  // the jolt (which HURT). The generation suffix is what keeps the animation from restarting
  // on every repaint. Under reduced motion neither class is emitted and the number alone
  // reports the change, so no fact is lost.
  const flashCls = { hp: 'flash-hit', energy: 'flash-energy', block: 'flash-block' }[kind] || '';
  const cls = `stat ${kind}`
    + (isFlash && flashCls && !reducedMotion ? ` ${flashCls} flash-${kind}-${flash.n}` : '')
    + (kind === 'hp' && isFlash && !reducedMotion ? ` stat-jolt jolt-${flash.n}` : '');
  const node = el('span', { cls, attrs: title ? { title } : {} });
  if (glyph) node.append(el('span', { cls: 'glyph', text: glyph }));
  node.append(document.createTextNode(text));
  return node;
}

/* The on-screen token badge was REMOVED (PM revision 8). It could not show a real
   number: an exact count needs ~11 MB of encoder ranks against a 306 KiB game, so it
   always read "tokens n/a". The claim is still measured and enforced where it is
   actually honest — tests/budget.test.js and `dlb sim`'s payload reporting. */

/* ----------------------------------------------------------------------- STAGE */

/**
 * Wrap one phase in an "engraved page": a faint chapter line and a large watermark
 * glyph behind the content. Purely atmospheric — no meaning lives in the watermark.
 * @param {string} kind phase name, used for the class hook
 * @param {string} chapter the faint uppercase line
 * @param {string} mark a GLYPHS key
 * @param {string} extra extra classes for the page element
 * @param {Element[]} kids the real content
 */
function page(kind, chapter, mark, extra, kids) {
  const wrap = el('div', { cls: 'page page-' + kind + (extra ? ' ' + extra : '') },
    el('span', { cls: 'page-num', text: chapter }),
  );
  for (const kid of kids) wrap.append(kid);
  wrap.append(glyphBox(mark, 'page-glyph'));
  return wrap;
}

/**
 * How long the end-of-run panel is held back on the motion path, so the killing blow is a
 * beat of its own instead of a frame: "the enemy dies, THEN the summary arrives".
 *
 * It is clamped to the COLLAPSE ITSELF, not to how long a boss is worth pausing for. The
 * dying enemy's ghost animates `juice-shatter` for exactly `COLLAPSE_MS` (`.enemy.is-dying`
 * in style.css), with `fill: both`, so from 500 ms on it is at `opacity: 0`. A hold longer
 * than the collapse could only ever hold an EMPTY stage — which is what the old boss window
 * did for 1150 ms. The load-bearing bound on an empty stage is AC-5.6's 250 ms, and the
 * hold now ends while the collapse is still on screen.
 *
 * These are read at ONE instant per action (the boot/restart calls have no death to wait
 * for), and `act()` never reads them, so the 8-token action line and the action ids are
 * untouched. Reduced motion uses 0: the panel is simply there.
 */
const COLLAPSE_MS = 500;
const END_DELAY_MS = 480;

/**
 * One line of words on the screen layer at the moment of arrival: the boss walks in, the
 * run ends, a floor is cleared, or the player steps along the path. The same single
 * primitive serves every arrival beat, so there is one thing to verify rather than four.
 * A `banner` class carries the kind, so the CSS can size each one differently.
 * @param {string} text the words (kernel-supplied labels only, or the surface's own)
 * @param {string} kind banner kind: boss | victory | defeat | floor | travel
 * @param {string} extra extra classes
 * @param {number} ms how long the node is left on the layer before removal
 */
function fxBanner(text, kind, extra, ms) {
  fxAdd(el('div', { cls: `fx-banner banner-${kind}${extra ? ' ' + extra : ''}` },
    el('span', { cls: 'fx-banner-text', text })), ms);
}

function render() {
  // A target step that the battle has moved on from (hand changed, fight over, enemies
  // down to one) is ended BEFORE anything paints, so no stale highlighting is ever shown
  // and no card can be resolved against an enemy the player did not choose.
  if (pendingSlot !== null && (snap.phase !== 'combat' || !pendingCard() || snap.enemies.length < 2)) endTargeting();

  /* ---------------------------------------------------- per-paint effect state ----
   * The bits of state that are true for exactly the paint that follows an action, and are
   * released by a timer afterwards. Building them HERE (rather than inside the view
   * functions) means an incidental repaint — `setAimed` on hover calls render() many times
   * a second — sees them cleared, so hovering an enemy can never re-deal the hand or
   * re-draw a dying enemy. */
  dealPending = bursts.some((b) => b.kind === 'deal');
  dyingThisPaint = bursts.filter((b) => b.kind === 'death');
  const travelPending = bursts.find((b) => b.kind === 'travel') || null;
  // The status keys of the snapshot BEFORE this action, so a status can be told apart from
  // one that merely restacked. Captured before renderHud() reads it.
  const statusKeysNow = [...(snap.player.statuses || []).map((s) => s.key),
    ...(snap.player.powers || []).map((p) => p.key),
    ...(snap.enemies || []).flatMap((e) => (e.statuses || []).map((s) => s.key))];

  renderHud();
  stageEl.replaceChildren();
  const phaseChanged = snap.phase !== paintedPhase;

  /* ----------------------------------------------------- ARRIVAL BEATS (one paint only)
   * A beat that describes a moment that has just HAPPENED can only play on the paint that
   * immediately follows it. `phaseArriving` is set by `act()` and consumed here; an
   * incidental repaint a moment later therefore sees none of them, which is what stops a
   * hover from replaying the boss walking in. */
  arriving = noArrival();
  const arrivingNow = phaseArriving;
  phaseArriving = null;
  if (arrivingNow === 'victory') arriving.victory = true;
  if (arrivingNow === 'defeat') arriving.defeat = true;
  if (arrivingNow === 'reward') arriving.reward = true;
  if (arrivingNow === 'rest') arriving.rest = true;
  if (arrivingNow === null && travelPending) arriving.travelTo = travelPending;
  /**
   * The travel burst THIS paint drew, so the map can mark the departing node. Set once per
   * paint from `bursts` and released by the same timer as the other one-paint flags, so an
   * incidental repaint cannot re-mark a node the player left several actions ago.
   */
  lastTravel = travelPending;
  // The node the previous floor's row should draw a travelling marker on: the `current`
  // node of the map we were standing on when the step was taken.
  const travelFromId = travelPending && prevMapCurrent ? prevMapCurrent : null;

  // Enemies seen for the FIRST time this paint get an entrance. A boss gets its own beat.
  // `enteredIds` is consumed once per id per run, so this can never replay on a repaint.
  enteringIds = new Set();
  const bossWelcomed = [];
  if (snap.phase === 'combat') {
    for (const e of snap.enemies || []) {
      if (enteredIds.has(e.id)) continue;
      enteredIds.add(e.id);
      enteringIds.add(e.id);
      if (enemyLook(e.id).boss) bossWelcomed.push(e.name);
    }
  }
  // The boss's arrival is NAMED on screen as well as animated, so the fact ("the boss is
  // here") is readable with no motion at all.
  if (bossWelcomed.length > 0) arriving.boss = true;

  /* The end of a run: a VICTORY or DEFEAT that arrives on the same action as a death holds
   * the collapse on screen before the summary replaces it, so "the enemy dies, THEN the
   * panel arrives" is a beat rather than a single frame.
   *
   * WHAT THE HOLD IS FOR. `combatView()` cannot draw the collapse of the enemy that ended
   * the run: `resolveVictory` empties `snap.enemies`, so that card has already left the
   * snapshot by the paint this hold acts on. The ghost drawn here is the only place it can
   * appear, and it is drawn by the SAME `dyingRow()` the combat view uses. The hold used to
   * paint an EMPTY `.ended-hold` spacer instead, which left the stage blank for the entire
   * hold — 480 ms on a defeat, 1150 ms on a boss kill — while `juice-shatter` has the ghost
   * at `opacity: 0` from 500 ms on (`fill: both`).
   *
   * WHY IT IS GUARDED, AND WHAT THAT FIXES. A hold is worth exactly one thing: the collapse.
   * A DEFEAT has none to show — the player is the one who died, no death burst is emitted,
   * and the enemies are still standing — so there is nothing for a hold to hold, and holding
   * anyway is what burned 480 ms of blank stage on the run's most common ending (the bot wins
   * about 7% of runs). The guard then falls through to the switch below and the DEFEAT panel
   * is simply there on the next paint. The fight that killed the player is on screen right up
   * to that paint; it is the blank window, not the panel, that used to discard it.
   *
   * HOW LONG. `wait` is clamped to the collapse duration: past `COLLAPSE_MS` the ghost is
   * transparent and the stage would be blank again. The sequence the brief asks for survives
   * — the collapse is still a beat of its own, before the summary.
   */
  const endHeld = arriving.victory || arriving.defeat;
  if (endHeld && dyingThisPaint.length > 0) {
    const wait = reducedMotion ? 0 : Math.min(END_DELAY_MS, COLLAPSE_MS);
    stageEl.replaceChildren(dyingRow(dyingThisPaint),
      el('div', { cls: 'ended-hold', attrs: { 'aria-hidden': 'true' } }));
    laterPaint(() => { if (snap.phase === 'ended') render(); }, wait);
    paintedPhase = snap.phase;
    lastPlayerStatuses = statusKeysNow;
    if (dealPending || dyingThisPaint.length > 0 || travelPending) {
      laterPaint(() => { dealPending = false; dyingThisPaint = []; }, 0);
    }
    enteringIds = new Set();
    return;
  }

  switch (snap.phase) {
    case 'map': stageEl.append(mapView(travelPending)); break;
    case 'combat': stageEl.append(combatView()); break;
    case 'reward': stageEl.append(rewardView()); break;
    case 'rest': stageEl.append(restView()); break;
    case 'ended': stageEl.append(endView()); break;
    default: stageEl.append(el('p', { text: `phase ${snap.phase}` }));
  }
  // Animate a phase change in; a repaint inside the same phase stays still, or every
  // card play would flash the whole screen.
  if (phaseChanged && stageEl.firstElementChild) {
    stageEl.firstElementChild.classList.add('enter');
    sceneBeat(paintedPhase, snap.phase);
    paintedPhase = snap.phase;
  }
  // The first-run explanation, shown once. A player who has never seen the game should
  // not have to guess what "3 Energy" or an enemy's announced attack means.
  let seen = false;
  try { seen = localStorage.getItem(HELP_SEEN_KEY) === '1'; } catch { seen = true; }
  // The battle moved on underneath a target step (the hand changed, the fight ended): the
  // step is no longer about anything real, so it ends silently rather than aiming at a
  // stale slot.
  if (helpOpen || !seen) stageEl.append(helpPanel());
  // The arriving VICTORY or DEFEAT panel takes the caret, so a keyboard player lands on
  // Restart instead of at the top of the document. Best effort, and never a rule.
  if (endFocusPending) {
    endFocusPending = false;
    const first = stageEl.querySelector ? stageEl.querySelector('button') : null;
    if (first && typeof first.focus === 'function') { try { first.focus(); } catch { /* best effort */ } }
  }

  /* Release the one-paint flags, and carry the enemy list forward. `prevEnemies` is the
     renderer's own record of who was alive a moment ago — the ONLY thing `act()` asks it
     for is which enemy has just left the row. It decides how a departure is shown and can
     change neither what is legal nor what an outcome is. */
  lastPlayerStatuses = statusKeysNow;
  lastTravel = travelPending;
  prevEnemies = (snap.enemies || []).map((e) => ({ index: e.index, id: e.id, name: e.name }));
  if (dealPending || dyingThisPaint.length > 0 || travelPending) {
    laterPaint(() => { dealPending = false; dyingThisPaint = []; lastTravel = null; enteringIds = new Set(); }, 0);
  } else {
    // Nothing else to release, but the entrance set is only ever true for the paint that
    // created it, so it is dropped on the next microtask regardless.
    laterPaint(() => { enteringIds = new Set(); }, 0);
  }
}

/* ------------------------------------------------------------------- COMBAT */

/* ------------------------------------------------------------------- EFFECTS -----
//
// Everything below turns the `bursts` list produced by `act()` into DOM. Two placement
// rules, and nothing else:
//   * an effect that belongs to ONE enemy is put INSIDE that enemy's card (`.efx`), so it
//     lands on the right enemy for free;
//   * an effect that belongs to the whole SCREEN goes into `#fx-layer`, a sibling of
//     #stage that `render()` never clears.
// No geometry is measured anywhere, so no effect can misplace itself after a repaint.
*/

/** Put a node on the persistent screen layer. Null-safe: the test harness has no layer. */
/**
 * Scene transitions (presentation only, skipped under reduced motion by fxAdd): the very
 * first map of a run gets the act title card; every later phase change gets a short
 * ember-and-heat wipe. Fixed overlay, pointer-events none, so layout and clicks are untouched.
 * @param {string|null} from the phase painted before
 * @param {string} to the phase being painted
 */
function sceneBeat(from, to) {
  if (from === null) {
    if (to === 'map' && !(snap.map && snap.map.floor > 0)) {
      fxAdd(el('div', { cls: 'fx-act-card', attrs: { 'aria-hidden': 'true' } },
        el('span', { cls: 'fx-act-num', text: 'Act I' }),
        el('span', { cls: 'fx-act-name', text: 'The Foundry' }),
        el('span', { cls: 'fx-act-rule' })), 2300);
    }
    return;
  }
  if (to === 'ended') return;
  fxAdd(el('div', { cls: `fx-scene to-${to}`, attrs: { 'aria-hidden': 'true' } }), 700);
}

function fxAdd(node, ms) {
  if (!fxEl || reducedMotion) return;
  fxEl.append(node);
  // `parentNode`, not `parent`: DOM nodes have no `.parent`, so effect nodes used to pile up forever.
  later(() => { node.remove(); }, ms);
}

/**
 * Play the bursts collected for the action just taken. Called AFTER `render()`, so any
 * node an effect wants to attach to already exists in its final tree.
 */
function dispatchFx() {
  const list = bursts;
  bursts = [];
  if (reducedMotion || list.length === 0) return;
  // The arrival banners are driven by `arriving`, not by `bursts`: they describe a moment
  // (a boss walking in, a run ending) rather than a value that changed, and `arriving` is
  // already reset by the next paint. Consumed HERE, once, so nothing replays.
  const welcome = arriving.boss;
  const won = arriving.victory;
  const lost = arriving.defeat;
  arriving.boss = false;

  for (const b of list) {
    switch (b.kind) {
      case 'vignette':
        fxAdd(el('div', { cls: 'fx-vignette' }), 620);
        break;
      case 'wipe':
        fxAdd(el('div', { cls: 'fx-turn-wipe' }), 460);
        break;
      case 'card-fly':
        // `b.side` is already my own full lane class (`side-0` / `side-mid` / `side-1` /
        // `side-none`), so it is interpolated directly — prefixing it here produced
        // `side-side-0`, which no rule matches. Instant speed skips the flight.
        if (animSpeed === 0) break;
        fxAdd(el('div', { cls: `fx-card ${b.side || 'side-none'} type-${b.type || 'skill'}` },
          el('span', { cls: 'fx-card-name', text: b.name || '' })), animMs(460) || 460);
        break;
      default:
        break;
    }
  }
  // The boss arrives as a BEAT, not a bigger fade: a red wash, a heavier and slower
  // title card, plus a ring that expands out of the enemy row.
  if (welcome) {
    fxBanner('SLAG WARDEN', 'boss', '', 1350);
    fxAdd(el('div', { cls: 'fx-boss-ring' }), 1100);
  }
  // The run's last two moments, each with its own weight: a bright hold for the win, a
  // slow darkening for the loss. Both are words as well as motion.
  if (won) {
    fxBanner('VICTORY', 'victory', '', 1500);
    fxAdd(el('div', { cls: 'fx-run-bloom' }), 1400);
  }
  if (lost) {
    fxBanner('DEFEAT', 'defeat', '', 1700);
    fxAdd(el('div', { cls: 'fx-darken' }), 1700);
  }
  // Feel queue: the card is already in flight. Hold the stage for a short hit-stop,
  // then let the damage and block numbers rise. A newer action bumps `animGen` and
  // this wait becomes a no-op. Speed 0 and reduced motion never wait.
  const gen = ++animGen;
  if (reducedMotion || animSpeed === 0) {
    revealFloats();
    return;
  }
  later(() => {
    if (gen !== animGen) return;
    if (stageEl && stageEl.classList) stageEl.classList.add('hitstop');
    if (fxEl && fxEl.classList) fxEl.classList.add('hitstop');
    later(() => {
      if (gen !== animGen) return;
      clearHitstop();
      revealFloats();
    }, animMs(70));
  }, animMs(240));
}

/**
 * The floating marker for one enemy, appended INSIDE that enemy's own card.
 *
 * The readable number is the damage dealt or the block gained: the HP or block delta
 * between the two kernel snapshots of this action. The bar still shows the remaining
 * total. A fully absorbed hit says "absorbed", because a 0 would contradict a bar that
 * did not move. The glyph (`·` `◆` `✸`) scales with the amount.
 */
function floatHold() {
  if (reducedMotion) return '';
  return animSpeed === 0 ? ' is-static' : ' is-queued';
}

function floatNode(b) {
  const span = el('span', { cls: 'efloat' });
  if (b.kind === 'absorbed') {
    span.className = 'efloat efloat-absorbed' + floatHold();
    span.append(el('b', { text: '⛨' }), el('b', { text: 'absorbed' }));
    return span;
  }
  const tier = b.tier || 1;
  const glyph = tier >= 3 ? '✸' : tier >= 2 ? '◆' : '·';
  const tone = b.tone === 'block' ? ' efloat-block' : '';
  span.className = `efloat efloat-g${tier}${tone}` + floatHold();
  const text = b.tone === 'block' ? `+${b.amount}` : `−${b.amount}`;
  span.append(el('b', { text: glyph }), el('b', { text }));
  if (b.defeated) span.append(el('b', { text: 'down' }));
  return span;
}

/**
 * The enemy's hit reaction, as a class on its own card. `flash.n` is part of the class
 * name so that a repaint for an unrelated reason reproduces the identical string — a new
 * class string only ever appears when a hit genuinely happened. Colour is not the carrier:
 * the card also shifts (see `juice-hit-flash`), and the HP total changes. Under reduced
 * motion no class is emitted at all, and the HP bar alone reports the hit.
 */
const hitClass = (index) => (flash.hits.includes(index) && !reducedMotion ? ` damaged damaged-${flash.n}` : '');

/**
 * Set once per paint, from `bursts`, at the top of `render()`:
 *   * `dealPending` — this paint should fan the hand in;
 *   * `dyingThisPaint` — collapsed cards to draw for enemies that just left the snapshot.
 * Both are derived per paint and then released by a timer, so they can never latch on.
 */
let dealPending = false;
let dyingThisPaint = [];

/**
 * The per-enemy effect box. It is created on every paint (so it is always inside the
 * current enemy card) and holds this enemy's floaters. Because it is a child of the card,
 * a floater is aligned to the enemy by layout — there is no coordinate to get wrong.
 */
function efxBox(index) {
  const box = el('span', { cls: 'efx' });
  if (reducedMotion) return box;
  for (const b of bursts) {
    if (b.enemy !== index) continue;
    if (b.kind !== 'float' && b.kind !== 'absorbed') continue;
    box.append(floatNode(b));
  }
  return box;
}

function heroEfx() {
  const box = el('span', { cls: 'efx' });
  if (reducedMotion) return box;
  for (const b of bursts) {
    if (b.kind !== 'hero-float') continue;
    box.append(floatNode(b));
  }
  return box;
}

/**
 * Which status keys on this list were NOT present on the previous snapshot — i.e. which
 * ones just landed. Purely a comparison of two kernel snapshots; it decides an animation,
 * never a rule. Stacks merely going up do not re-trigger it, so a stacking power does not
 * re-animate every turn.
 */
function freshStatusKeys(list) {
  const prev = new Set((lastPlayerStatuses || []));
  return new Set((list || []).map((s) => s.key).filter((k) => !prev.has(k)));
}

/**
 * The collapse of enemies that died on the action being painted: the ghost cards.
 *
 * FACTORY, NOT A CONSTANT: it returns a fresh `.enemies` row holding one ghost per death,
 * so there is no single node that two places could move between two parents.
 *
 * It is shared by `combatView()` and by the end-of-run hold in `render()`, and it is the
 * SAME builder for both on purpose. A kill empties `snap.enemies` (`resolveVictory`), so
 * `combatView()` draws only the hand and the hold is the sole place the collapse is ever
 * drawn; an ordinary kill in a fight that continues is drawn by `combatView()`. One builder
 * means the two cannot drift apart, and the ordinary path's output is unchanged.
 *
 * The ghost carries the `side-*` recorded when the enemy was still alive — a lane class, not
 * a measured coordinate — so a collapse cannot drift into another enemy's column.
 *
 * An enemy that died this action is no longer in the snapshot, so its collapse cannot be
 * animated on the new tree. It is drawn one last time, inert, as a ghost that fades. Under
 * reduced motion the ghost is STILL drawn — statically, with no animation — because it
 * carries a fact that would otherwise vanish with the enemy: this slot was just held by a
 * live enemy whose name and HP are no longer anywhere else on the screen. What is dropped on
 * that path is the movement, not the fact (see the reduced-motion block in style.css).
 *
 * @param {Array<{name: string, side: string, boss?: boolean}>} dying the death bursts
 * @param {HTMLElement} [row] the row to append the ghosts to; a fresh one when omitted
 * @returns {HTMLElement} the row the ghosts were appended to
 */
function dyingRow(dying, row = el('div', { cls: 'enemies' })) {
  for (const d of dying) {
    // A boss says so: its collapse is the biggest single event in the run, and the word is
    // what makes the difference readable with no motion at all (the row is also the only
    // place the boss's name is still on screen, its card having left the snapshot).
    const label = d.boss ? 'BOSS DOWN' : 'DOWN';
    const ghost = el('div', { cls: `enemy is-dying ash side-${d.side}` + (d.boss ? ' boss-down' : '') });
    const fig = el('div', { cls: 'fig pose-hurt', attrs: { 'aria-hidden': 'true' } });
    fig.innerHTML = enemyMarkup(d.id);
    ghost.append(fig);
    ghost.append(el('div', { cls: 'ename', text: d.name }));
    ghost.append(el('div', { cls: 'ehp', text: label }));
    row.append(ghost);
  }
  return row;
}

function heroPose() {
  const p = snap.player;
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  if (bursts.some((b) => b.kind === 'hero-float' && b.tone === 'dmg')) return 'hurt';
  const fly = bursts.find((b) => b.kind === 'card-fly');
  if (fly && fly.type === 'attack') return 'strike';
  if (fly && (fly.type === 'skill' || fly.type === 'power')) return 'brace';
  if (ratio <= 0.35) return 'low';
  return 'idle';
}

function heroFigure() {
  const p = snap.player;
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  const pose = heroPose();
  const node = el('div', {
    cls: 'hero' + (ratio <= 0.35 ? ' is-low' : ''),
    attrs: { role: 'group', 'aria-label': `${snap.characterName || 'Ashwright'}, ${p.hp} of ${p.maxHp} HP, block ${p.block}` },
  });
  const fig = el('div', { cls: `fig pose-${pose}`, attrs: { 'aria-hidden': 'true' } });
  fig.innerHTML = heroMarkup();
  node.append(fig);
  node.append(el('div', { cls: 'hero-name', text: snap.characterName || 'Ashwright' }));
  node.append(el('div', { cls: 'ehp', text: `${p.hp}/${p.maxHp}` }));
  const bar = el('div', { cls: 'hpbar' }, el('i', {}));
  bar.querySelector('i').style.width = `${Math.max(0, Math.round((p.hp / Math.max(1, p.maxHp)) * 100))}%`;
  node.append(bar);
  if (p.block > 0) node.append(el('div', { cls: 'eblock', text: `⛨ ${p.block}` }));
  node.append(heroEfx());
  return node;
}

function enemyPose(e) {
  if (bursts.some((b) => b.kind === 'enemy-strike' && b.enemy === e.index)) return 'strike';
  if (flash.hits.includes(e.index)) return 'hurt';
  if (e.hp / Math.max(1, e.maxHp) <= 0.35) return 'low';
  if (e.intent && e.intent.kind === 'attack') return 'windup';
  return 'idle';
}

function intentBadge(e) {
  const kind = e.intent.kind;
  let which = 'buff';
  let tier = 1;
  if (kind === 'attack') {
    tier = attackTier(e.intent.damage);
    which = tier >= 3 ? 'meteor' : tier >= 2 ? 'axe' : 'dagger';
  } else if (kind === 'block') which = 'shield';
  else if (kind === 'debuff') which = 'down';
  const badge = el('div', {
    cls: `intent-badge kind-${kind} tier-${tier}`,
    attrs: { title: e.intent.text || e.intent.label || '', 'aria-hidden': 'true' },
  });
  badge.innerHTML = intentGlyph(which);
  if (kind === 'attack') {
    const n = e.intent.hits > 1 ? `${e.intent.damage}×${e.intent.hits}` : String(e.intent.damage ?? '');
    badge.append(el('b', { cls: 'intent-num', text: n }));
  }
  return badge;
}

function pileButton(which) {
  const isDraw = which === 'draw';
  const count = snap.piles[which] ?? 0;
  const names = (isDraw ? snap.piles.drawCards : snap.piles.discardCards) || [];
  const label = isDraw ? 'Draw' : 'Discard';
  const extra = !isDraw && snap.piles.exhaust > 0 ? `, exhaust ${snap.piles.exhaust}` : '';
  return el('button', {
    cls: isDraw ? 'pile pile-draw' : 'pile pile-discard',
    attrs: {
      type: 'button',
      title: names.length ? `${label}: ${names.join(', ')}` : `${label} pile empty`,
      'aria-label': `${label} pile, ${count} cards${extra}`,
    },
    on: {
      click: (ev) => {
        consumeClick(ev);
        pileOpen = pileOpen === which ? null : which;
        render();
      },
    },
  },
    el('b', { cls: 'pile-count', text: String(count) }),
    el('span', { cls: 'pile-name', text: label }),
  );
}

function energyOrb() {
  const n = snap.player.energy;
  const max = snap.energyPerTurn;
  return el('div', {
    cls: 'energy-orb' + (n === 0 ? ' is-empty' : ''),
    attrs: { title: `Energy ${n} of ${max}`, 'aria-label': `Energy ${n} of ${max}` },
  },
    el('b', { cls: 'orb-num', text: String(n) }),
    el('span', { cls: 'orb-cap', text: `/${max}` }),
  );
}

function speedDock() {
  const dock = el('div', { cls: 'speed-dock', attrs: { role: 'group', 'aria-label': 'Animation speed' } });
  const add = (speed, text, title) => dock.append(el('button', {
    cls: 'btn ghost speed-btn' + (animSpeed === speed ? ' is-on' : ''),
    text,
    attrs: { type: 'button', title },
    on: {
      click: (ev) => {
        consumeClick(ev);
        animSpeed = speed;
        try { localStorage.setItem(SPEED_KEY, String(speed)); } catch { /* private mode */ }
        if (speed === 0) skipAnim();
        render();
      },
    },
  }));
  add(1, '1×', 'Animation speed 1×');
  add(2, '2×', 'Animation speed 2×');
  add(0, '»', 'Skip animation');
  return dock;
}

function pileModal(which) {
  const names = (which === 'draw' ? snap.piles.drawCards : snap.piles.discardCards) || [];
  const title = which === 'draw' ? 'Draw pile' : 'Discard pile';
  const back = el('div', { cls: 'pile-back', attrs: { role: 'dialog', 'aria-label': title } });
  back.addEventListener('click', (ev) => {
    if (ev.target === back) { pileOpen = null; render(); }
  });
  const sheet = el('div', { cls: 'pile-sheet' }, el('h2', { text: `${title} (${names.length})` }));
  if (names.length === 0) sheet.append(el('p', { text: 'Empty.' }));
  else {
    const list = el('ul', { cls: 'pile-list' });
    for (const name of names) list.append(el('li', { text: name }));
    sheet.append(list);
  }
  if (which === 'discard' && snap.piles.exhaust > 0) {
    const exh = snap.piles.exhaustCards || [];
    sheet.append(el('p', { cls: 'pile-exh', text: `Exhausted (${snap.piles.exhaust}): ${exh.join(', ') || '—'}` }));
  }
  sheet.append(el('button', {
    cls: 'btn secondary',
    text: 'Close',
    attrs: { type: 'button' },
    on: { click: (ev) => { consumeClick(ev); pileOpen = null; render(); } },
  }));
  back.append(sheet);
  return back;
}

function combatControls(targeting) {
  const hit = pendingCard();
  const controls = el('div', { cls: 'controls' });
  if (targeting && hit) {
    controls.append(el('span', { cls: 'target-banner', text: `${hit.name} — choose an enemy target` }));
    controls.append(el('button', {
      cls: 'btn secondary cancel-target',
      text: 'Cancel  (Esc)',
      attrs: { type: 'button' },
      on: { click: () => cancelTargeting() },
    }));
  } else {
    const endTurn = snap.actions.find((a) => a.kind === 'end_turn');
    controls.append(el('button', {
      cls: 'btn',
      text: 'End Turn  (e)',
      attrs: { type: 'button' },
      on: { click: () => act(endTurn && endTurn.id) },
    }));
  }
  return controls;
}

function combatView() {
  const targeting = pendingSlot !== null && snap.enemies.length > 1;
  const wrap = el('div', { cls: 'stage-combat' + (targeting ? ' sc-targeting' : '') });

  const fight = el('div', { cls: 'fight' });
  const backdrop = el('div', { cls: 'backdrop', attrs: { 'aria-hidden': 'true' } });
  backdrop.innerHTML = backdropMarkup();
  // Empty foundry floor fast-forwards the feel queue. Cards, enemies and buttons sit above it.
  backdrop.addEventListener('pointerdown', () => skipAnim());
  fight.append(backdrop);
  fight.append(el('div', { cls: 'ground', attrs: { 'aria-hidden': 'true' } }));
  fight.append(heroFigure());
  const row = el('div', { cls: 'enemies' }, ...snap.enemies.map((e, i) => enemyCard(e, i)));
  dyingRow(dyingThisPaint, row);
  fight.append(row);
  fight.append(speedDock());
  wrap.append(fight);

  const dock = el('div', { cls: 'dock' });
  dock.append(pileButton('draw'));
  dock.append(energyOrb());
  // Fan rotation lives on the inner card (`--i`), never on this wrap, so the hand stays one row.
  dock.append(el('div', {
    cls: 'hand' + (dealPending ? ' deal-in' : ''),
    attrs: { style: `--n:${snap.hand.length}` },
  }, ...snap.hand.map((c, i) => cardTile(c, { index: i + 1 }))));
  dock.append(pileButton('discard'));
  dock.append(combatControls(targeting));
  wrap.append(dock);

  wrap.append(el('p', { cls: 'hint', text: targeting
    ? 'Click a highlighted enemy, or press 1–9 · Esc or click empty space to cancel'
    : 'Click a card to play it · a card that needs a target asks you to pick one' }));
  if (pileOpen === 'draw' || pileOpen === 'discard') wrap.append(pileModal(pileOpen));
  return page('combat', 'II — The Fight', 'blade', '', [wrap]);
}

/**
 * One enemy card.
 * @param {any} e a snapshot enemy
 * @param {number} position its 0-based place among the LIVING enemies (= k - 1)
 */
function enemyCard(e, position) {
  const kind = e.intent.kind;
  const look = enemyLook(e.id);
  const targeting = pendingSlot !== null && snap.enemies.length > 1;
  const isAimed = targeting && aimed === position + 1;
  // The damage flash is keyed on the enemy's stable identity (`index`), never on its
  // position, so the shake lands on the enemy that was actually hit even after an
  // earlier enemy has died and shifted everyone up.
  // The ENTRANCE beats are keyed on `e.id` (the kernel's encounter id) and are consumed once
  // per id per run, so an incidental repaint reproduces no arrival class and nothing
  // replays. A boss gets its own, heavier beat: the fight announces itself.
  const entering = enteringIds.has(e.id);
  const cls = 'enemy' + ` eh-${look.hue}` + (look.boss ? ' e-boss' : '') + (look.elite ? ' e-elite' : '')
    + hitClass(e.index)
    + (entering ? (look.boss ? ' arriving boss-enter' : ' arriving') : '')
    // `targeting` marks a legal candidate; `aimed` marks the ONE the player has actually
    // selected. Nothing is marked illegal: the snapshot reports only LIVING enemies and
    // exposes no per-enemy legality flag, so a living enemy is always a legal target.
    + (targeting ? ' targeting' : '')
    + (isAimed ? ' aimed' : '');

  const card = el(targeting ? 'button' : 'div', {
    cls,
    attrs: {
      // Screen readers get the whole decision in one sentence, including the digit to
      // press. The `data-target-index` is the k the action id will carry.
      'aria-label': enemyLabel(e, position, targeting),
      'data-target-index': String(position + 1),
      ...(targeting
        ? { type: 'button', 'aria-pressed': String(isAimed) }
        : { role: 'group' }),
    },
    // Hover previews the target without committing: the click commits. The click is marked
    // consumed so the stage-level "clicked empty space" fallback cannot cancel it too.
    on: targeting
      ? {
          click: (ev) => { consumeClick(ev); pickTarget(position + 1); },
          mouseenter: () => setAimed(position + 1),
          focus: () => setAimed(position + 1),
        }
      : {},
  });

  const pose = enemyPose(e);
  card.append(intentBadge(e));
  const fig = el('div', { cls: `fig pose-${pose}`, attrs: { 'aria-hidden': 'true' } });
  fig.innerHTML = enemyMarkup(e.id);
  card.append(fig);
  // The target mark is a SHAPE, not a colour: a slot number, plus a crosshair on the
  // enemy the player has actually selected.
  if (targeting) {
    card.append(el('span', { cls: 'target-index', text: String(position + 1), attrs: { 'aria-hidden': 'true' } }));
    card.append(el('span', { cls: 'target-mark', text: '◎', attrs: { 'aria-hidden': 'true' } }));
  }
  card.append(el('div', { cls: 'ename', text: e.name }));
  card.append(el('div', { cls: 'ehp', text: `${e.hp}/${e.maxHp}` }));
  const bar = el('div', { cls: 'hpbar' }, el('i', {}));
  bar.querySelector('i').style.width = `${Math.max(0, Math.round((e.hp / e.maxHp) * 100))}%`;
  card.append(bar);
  if (e.block > 0) {
    card.append(el('div', { cls: 'eblock', text: `⛨ ${e.block}` }));
    const eaten = flash.blockEat && !reducedMotion;
    const bb = el('div', { cls: 'hpbar block' + (eaten ? ' block-eat' : '') }, el('i', {}));
    bb.querySelector('i').style.width = `${Math.min(100, Math.round((e.block / Math.max(1, e.maxHp)) * 100))}%`;
    card.append(bb);
  }
  const fresh = freshStatusKeys(e.statuses);
  const statuses = e.statuses.map((s) => el('span', {
    cls: `pill ${s.key}` + (fresh.has(s.key) ? ' juice-in' : ''),
    text: s.text || `${s.label} ${s.stacks}`,
    attrs: { title: s.explain || '' },
  }));
  if (statuses.length > 0) card.append(el('div', { cls: 'e-statuses' }, ...statuses));
  card.append(efxBox(e.index));
  // The sentence stays readable under the figure. The badge above is the scaled glyph.
  const plain = e.intent.text || `${e.intent.label}`;
  card.append(el('div', {
    cls: `e-intent kind-${kind}`,
    attrs: { title: plain },
  }, el('span', { cls: 'ilabel', text: plain })));
  return card;
}

/**
 * One card tile. Structure: cost gem, type line (mark + word), name, plain-English
 * effect, then the compact CLI code. Auto height means a 3-line effect grows the tile
 * rather than clipping it.
 * @param {any} card the snapshot's card view
 * @param {{index?: number, onClick?: Function, actionId?: string}} [opts]
 *        `index` draws the keyboard digit badge (hand only); `onClick` overrides the default
 *        hand-play action (reward tiles need it, because taking a card is a different verb)
 */
function cardTile(card, opts = {}) {
  const isPending = pendingSlot !== null && card.slot === pendingSlot;
  // While one card is waiting for a target the OTHER cards cannot be played by accident:
  // clicking them cancels the step instead. They read as inert but stay focusable, so a
  // keyboard user can still click out of the step with the digit shortcuts and Escape.
  const disabled = !card.playable;
  // A tile is clicked for two different reasons: playing it from the hand, or taking it from
  // a reward. `opts.onClick` supplies the second. Before this existed every tile called
  // `clickCard(slot)`, which only searches `snap.hand` — so a reward tile (slot `s1`)
  // resolved to nothing and the reward screen was dead to both clicks and hotkeys.
  const onClick = opts.onClick ?? ((ev) => { consumeClick(ev); clickCard(card.slot); });
  const inactive = pendingSlot !== null && !isPending;
  // The plain-English text comes from the kernel (`describeCard`), never from the
  // renderer. The compact shorthand stays visible but secondary and labelled, so a
  // reader who meets "A6" in the CLI can still connect the two.
  const desc = card.description || card.summary;
  const awaiting = isPending ? ' Choosing a target: click a highlighted enemy, or press Escape to cancel.' : '';
  const tile = el('button', {
    cls: `card type-${card.type}` + (disabled ? ' disabled is-unplayable' : ''),
    attrs: {
      type: 'button',
      // `data-slot` is how focus returns to the right card after a cancel.
      'data-slot': card.slot,
      ...(opts.actionId ? { 'data-action': opts.actionId } : {}),
      'aria-disabled': String(disabled),
      'aria-label': `${card.name}. Costs ${card.cost} Energy. ${desc}${disabled ? ' Not playable: not enough Energy.' : ''}${awaiting}`,
      ...(isPending ? { 'aria-pressed': 'true' } : {}),
    },
    on: disabled && !opts.onClick ? {} : { click: onClick },
  });
  if (disabled) tile.disabled = true;

  // Cost gem: a faceted stone, not a plain circle.
  const gem = el('span', { cls: 'cost-gem', attrs: { title: 'Energy cost' } },
    el('span', { cls: 'gem-core', text: String(card.cost) }),
  );
  tile.append(gem);

  // The head plate is the illustration window: one woodcut drawing per card id
  // (web/card-art.js), decorative and aria-hidden. The type mark + word stay on top, so
  // type is still carried by hue, mark and word. Unknown ids fall back to the type mark.
  const head = el('span', { cls: 'ctype' },
    glyphBox(TYPE_GLYPH[card.type] || 'rune', 'c-type-mark'),
    el('span', { text: card.typeLabel || card.type }),
  );
  const drawn = cardArtMarkup(card.cardId);
  if (drawn) {
    const ill = el('span', { cls: 'c-illus', attrs: { 'aria-hidden': 'true' } });
    ill.innerHTML = drawn;
    head.prepend(ill);
    // A large, faint echo of the same drawing fills the effect panel behind the words.
    const echo = el('span', { cls: 'c-art c-echo', attrs: { 'aria-hidden': 'true' } });
    echo.innerHTML = drawn;
    tile.append(echo);
    tile.classList.add('has-illus');
  }
  tile.append(head);
  tile.append(el('span', { cls: 'cname', text: card.name }));
  if (card.flavor) tile.append(el('span', { cls: 'cflavor', text: card.flavor }));
  tile.append(keywordText(el('span', { cls: 'cdesc' }), desc));
  // The compact code is NOT repeated on a reward tile: the player is choosing a card to
  // keep, not playing one, so the shorthand is noise there.
  if (card.showSummary !== false) {
    const foot = el('span', { cls: 'cfoot' });
    foot.append(el('span', { cls: 'csum', text: card.summary, attrs: { title: 'Compact form used by the agent-facing command line' } }));
    if (disabled) foot.append(el('span', { cls: 'cwhy', text: 'needs more Energy' }));
    tile.append(foot);
  }

  // Only the in-hand tiles get a wrapper: it carries the hover lift and the keyboard
  // digit. A reward tile has no digit to show.
  if (!opts.index) return tile;
  const wrap = el('div', {
    cls: 'card-wrap' + (disabled ? ' is-disabled' : '') + (inactive ? ' is-inactive' : '') + (isPending ? ' is-pending' : ''),
    attrs: opts.index ? { style: `--i:${opts.index - 1}` } : {},
  },
    el('span', { cls: 'hand-index', text: String(opts.index), attrs: { title: `Keyboard shortcut: ${opts.index}` } }),
    // The in-card cue that this card is the one waiting for a target. A shape and a word,
    // not a colour: `⇱` reads as "aim" at a glance and survives a monochrome screen.
    isPending ? el('span', { cls: 'awaiting-badge', text: '⇱ pick a target', attrs: { 'aria-hidden': 'true' } }) : null,
    tile,
  );
  return wrap;
}

/* ---------------------------------------------------------------------- MAP */

/**
 * The map. `travel` is the burst for a step just taken (or null), so the node the player
 * LEFT is drawn once more as an inert marker that travels toward the node they now stand
 * on. Both are located by the kernel's own `row` / `current` fields: no coordinate is
 * measured, and nothing is inferred about where the player may go next.
 * @param {any} travel the `travel` burst for this paint, or null
 */
function mapView(travel = null) {
  // The wrapper carries `.panel`; this inner div is content only.
  const wrap = el('div');
  wrap.append(el('p', { cls: 'section-title', text: `Map — floor ${snap.map.floor + 1}/${snap.map.floorCount}` }));
  const travelFromId = travel ? (prevMapCurrent ?? null) : null;
  const travelFromRow = travel ? (prevMapFloor ?? null) : null;
  const map = el('div', { cls: 'map' });
  snap.map.rows.forEach((row, r) => {
    const rowEl = el('div', { cls: 'map-row' });
    rowEl.append(el('span', { cls: 'map-floor-label', text: `${r + 1}` }));
    // The row the step STARTED on gets one extra, inert marker: the node that was just
    // left. It sits at the end of its own row, which is where a "was here" mark belongs,
    // and it is never a button, so it cannot be clicked and cannot shift a real node.
    const showTravel = travel !== null && travelFromId !== null && r === travelFromRow;
    // "You are here" as TEXT (UX rev 3): the fact survives reduced motion and greyscale, and
    // on a phone a ribbon answers "where am I" better than a tint ever does.
    if (row.some((n) => n.current)) rowEl.append(el('div', { cls: 'node-you', text: 'you are here' }));
    for (const n of row) rowEl.append(mapNode(n));
    if (showTravel) rowEl.append(travelMarker(travel));
    map.append(rowEl);
  });
  // The world behind the path (decorative, constant markup): lava at the foot where the
  // climb starts, two ridge lines, and the Guardian's spire at the summit.
  const world = el('div', { cls: 'map-world', attrs: { 'aria-hidden': 'true' } });
  world.innerHTML = MAP_WORLD;
  map.prepend(world);
  wrap.append(map);
  requestAnimationFrame(() => drawRoutes(map));
  wrap.append(el('p', { cls: 'hint', text: 'Click a glowing node to travel. Fight something weak, risk an elite, or rest.' }));
  return page('map', 'I — The Path', 'route', 'panel', [wrap]);
}

const MAP_WORLD = '<svg viewBox="0 0 400 600" preserveAspectRatio="none">'
  + '<path class="w-sky" d="M0 0 H400 V600 H0 Z"/>'
  + '<path class="w-far" d="M0 150 L40 120 L70 135 L110 80 L150 110 L200 30 L250 100 L290 75 L330 115 L370 90 L400 110 V600 H0 Z"/>'
  + '<path class="w-spire" d="M188 70 L196 18 L200 4 L204 18 L212 70 Z"/>'
  + '<path class="w-mid" d="M0 330 L50 290 L90 310 L140 250 L190 290 L240 240 L290 280 L340 245 L400 285 V600 H0 Z"/>'
  + '<path class="w-crack" d="M140 250 L150 300 L138 340 M290 280 L282 330"/>'
  + '<path class="w-near" d="M0 500 L60 470 L120 490 L180 455 L250 485 L320 460 L400 490 V600 H0 Z"/>'
  + '<path class="w-lava" d="M0 575 C70 555 130 590 200 570 C270 550 330 588 400 566"/>'
  + '</svg>';

/**
 * Draw the routes between floors. The kernel connects every node on a floor to every node
 * on the next one (rules/map.js availableNodes), so every pair is drawn; the legs the player
 * can take right now are lit. Geometry is read from the laid-out nodes, so it follows any
 * breakpoint. Decorative: aria-hidden, pointer-inert, and it carries no fact the node
 * buttons do not already state.
 * @param {HTMLElement} map
 */
function drawRoutes(map) {
  if (!map.isConnected) return;
  const box = map.getBoundingClientRect();
  if (box.width === 0) return;
  const rows = [...map.querySelectorAll('.map-row')].map((r) => [...r.querySelectorAll('.node')]);
  // offset* geometry, not getBoundingClientRect: it ignores the rows' entrance transform,
  // so the routes are drawn where the nodes come to rest.
  const c = (n) => { const r = n.parentElement; return [r.offsetLeft + n.offsetLeft + n.offsetWidth / 2, r.offsetTop + n.offsetTop + n.offsetHeight / 2]; };
  let lit = '';
  let dim = '';
  for (let r = 0; r + 1 < rows.length; r += 1) {
    for (const a of rows[r]) {
      for (const b of rows[r + 1]) {
        const [x1, y1] = c(a); const [x2, y2] = c(b);
        const my = (y1 + y2) / 2;
        const d = `M${x1.toFixed(1)} ${y1.toFixed(1)} C${x1.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)} `;
        if (a.classList.contains('current') && b.classList.contains('available')) lit += d; else dim += d;
      }
    }
  }
  // innerHTML on a constant template keeps this file free of any namespace URL string;
  // the only interpolated values are numbers this function computed.
  const holder = el('div');
  holder.innerHTML = `<svg class="map-routes" aria-hidden="true" width="${Math.round(box.width)}" height="${Math.round(box.height)}">`
    + (dim ? `<path class="route-dim" d="${dim}"/>` : '') + (lit ? `<path class="route-lit" d="${lit}"/>` : '') + '</svg>';
  const svg = holder.firstChild;
  map.querySelector('.map-routes')?.remove();
  map.insertBefore(svg, map.querySelector('.map-row'));
}

/**
 * The inert marker left behind on the row a step started from. It carries the kernel's label
 * for where the player now stands, so the "where did I just get to" fact is readable without
 * any motion at all — which is what makes this safe under reduced motion.
 * @param {any} travel the `travel` burst
 */
function travelMarker(travel) {
  const mark = el('span', { cls: 'node-travel' + (travel.boss ? ' to-boss' : ''),
    attrs: { title: `Just travelled from floor ${(prevMapFloor ?? 0) + 1}` } },
    el('span', { cls: 'ntravel-from', text: 'you were here' }),
    el('span', { cls: 'ntravel-to', text: travel.label ? `→ ${travel.label}` : '→ next' }),
  );
  return mark;
}

/* Map pins (M5): up to 3 planning marks per run, kept in localStorage under the run's
   seed and NEVER in run state, so the kernel, replays and hashes are untouched. */
const PINS_KEY = 'dlb.mapPins.v1';
const PIN_MAX = 3;
function mapPins() {
  const all = storeGet(PINS_KEY);
  const list = all && Array.isArray(all[String(snap.seed)]) ? all[String(snap.seed)] : [];
  return list.filter((x) => typeof x === 'string');
}
function toggleMapPin(id) {
  let list = mapPins();
  list = list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-PIN_MAX);
  // Only the current seed is kept, so the store never grows across runs.
  storePut(PINS_KEY, { [String(snap.seed)]: list });
  announce(list.includes(id) ? 'Pin placed.' : 'Pin removed.');
}

function mapNode(n) {
  const short = n.type.replace('combat_', '');
  const cls = `node t-${short}` + (n.available ? ' available' : '') + (n.current ? ' current' : '');
  const node = el(n.available ? 'button' : 'span', {
    cls,
    attrs: n.available ? { type: 'button', title: `Travel to ${n.label}`, 'aria-label': `Travel to ${(NODE_WORDS[short] || [n.label])[0]}` } : {},
    on: {
      ...(n.available && n.actionId ? { click: () => act(n.actionId) } : {}),
      // Right-click (long-press on touch) drops or lifts a planning pin. Browser-only state.
      contextmenu: (ev) => { ev.preventDefault(); toggleMapPin(n.id); render(); },
    },
  });
  if (n.available) node.title = `Travel to ${n.label} · right-click to pin`;
  else node.setAttribute('title', 'Right-click to pin this node');
  node.append(glyphBox(NODE_GLYPH[short] || 'rune', 'ntype-mark'));
  if (mapPins().includes(n.id)) {
    node.classList.add('pinned');
    node.append(el('span', { cls: 'node-pin', attrs: { 'aria-label': 'pinned' } }));
  }
  const words = NODE_WORDS[short] || [n.label, ''];
  node.append(el('span', { cls: 'ntype', text: words[0] }));
  if (words[1]) node.append(el('span', { cls: 'nsub', text: words[1] }));
  return node;
}

/* ------------------------------------------------------------------- REWARD */

/** Header illustration for the reward and rest scenes: a local WebP, decorative only. */
function sceneIllus(key) {
  const box = el('div', { cls: `scene-illus scene-${key}`, attrs: { 'aria-hidden': 'true' } });
  box.append(el('img', { attrs: { src: `assets/sprites/${key}.webp`, alt: '', draggable: 'false', decoding: 'async' } }));
  return box;
}

function rewardView() {
  const wrap = el('div');
  // The reward arrives after a victory, so the spoils head and the three tiles come in as a
  // sequence rather than all at once. `.reveal` is on the ONCE-per-arrival class string
  // built in `render()`; an incidental repaint inside the phase reproduces the same string
  // and the browser restarts nothing.
  wrap.append(sceneIllus('reward'));
  wrap.append(el('div', { cls: 'reward-head' + (arriving.reward ? ' reveal' : ''), text: 'Victory — choose a card' }));
  const row = el('div', { cls: 'hand' + (arriving.reward ? ' reveal-cards' : '') });
  for (const c of snap.reward.cards) {
    // The reward tile's own action: taking a card, not playing one. Marked with `data-action`
    // so the hotkey handler can also reach it.
    const tile = cardTile(
      { slot: c.actionId, cardId: c.cardId, name: c.name, flavor: c.flavor, cost: c.cost, type: c.type, typeLabel: c.typeLabel, summary: c.summary, description: c.description, hint: c.hint, playable: true, showSummary: false },
      { actionId: c.actionId, onClick: (ev) => { consumeClick(ev); act(c.actionId); } },
    );
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
  return page('reward', 'III — The Spoils', 'star', 'panel', [wrap]);
}

/* --------------------------------------------------------------------- REST */

function restView() {
  const wrap = el('div', { cls: 'rest' + (arriving.rest ? ' rest-arriving' : '') });
  wrap.append(el('p', { cls: 'section-title', text: 'Rest Site' }));
  // The pause is a SHAPE: a slowly breathing ember ring behind the words, plus an arrival
  // beat on the first paint. Nothing on this screen is a form field and nothing moves on a
  // click, so the two choices below never shift out from under a pointer.
  wrap.append(el('div', { cls: 'rest-embers', attrs: { 'aria-hidden': 'true' } },
    el('span', { cls: 'ember e1' }), el('span', { cls: 'ember e2' }), el('span', { cls: 'ember e3' }),
  ));
  wrap.append(sceneIllus('event'));
  wrap.append(el('div', { cls: 'big-title rest-head', text: 'A quiet moment' }));
  // The one thing this screen must SAY without motion: resting is safe, and leaving is safe.
  wrap.append(el('p', { cls: 'rest-note', text: `HP ${snap.player.hp}/${snap.player.maxHp} — you may heal ${snap.rest.heal} or move on.` }));
  wrap.append(el('p', { cls: 'rest-calm', text: 'Nothing is hunting you here. Take the breath, or walk on.' }));
  wrap.append(el('div', { cls: 'restart-row' },
    el('button', { cls: 'btn', text: `Rest (+${snap.rest.heal} HP)`, attrs: { type: 'button' }, on: { click: () => act(snap.rest.healId) } }),
    el('button', { cls: 'btn secondary', text: 'Move on', attrs: { type: 'button' }, on: { click: () => act(snap.rest.leaveId) } }),
  ));
  return page('rest', 'IV — The Ember', 'flame', 'panel', [wrap]);
}

/* --------------------------------------------------------------------- ENDED */

function endView() {
  const e = snap.ended;
  const won = e.outcome === 'win';
  const wrap = el('div');
  wrap.append(el('p', { cls: 'section-title', text: 'Run Over' }));
  wrap.append(el('div', { cls: `demon${won ? '' : ' lose'}` }, glyphBox(won ? 'crown' : 'broken', 'demon-glyph')));
  // THE OUTCOME IS THE HEADLINE, NEVER THE SCORE (S1). No score may ever occupy this slot:
  // a number is not an achievement, and a run's meaning is not its arithmetic.
  wrap.append(el('div', { cls: `big-title ${won ? 'win' : 'loss'}`, text: won ? 'VICTORY' : 'DEFEAT' }));
  wrap.append(el('hr', { cls: 'end-rule' }));
  wrap.append(el('p', { cls: 'end-stats', text: `Reached floor ${e.floor} · ${e.steps} steps · seed ${snap.seed}` }));

  const math = lastRecord ? ledgerMath(lastRecord) : null;
  if (math) {
    wrap.append(ledgerBlock(math));
    if (math.earned) {
      wrap.append(el('p', { cls: 'def', text: won
        ? 'You cleared Act 1 and the Slag Warden fell.'
        : 'The Ashwright falls. Try a different route or a better card pick.' }));
    } else {
      // AC-7.4 (ANTI-HOLLOW). No elite, no boss, no victory: the total does NOT get display
      // size and no celebratory word is attached to it. The factual recognition below keeps
      // the run's real content on screen — floors climbed, enemies killed, and where the
      // larger totals actually come from — instead of an empty "0 elites" and a flourish.
      wrap.append(el('p', { cls: 'recognition', text: recognitionText(math) }));
    }
  } else {
    // No record exists for this run (the ended transition was never observed, e.g. a page
    // that was reloaded onto a finished run). The screen shows what it has and NO ledger:
    // an itemised block would have to invent every line.
    wrap.append(el('p', { cls: 'def', text: won
      ? 'You cleared Act 1 and the Slag Warden fell.'
      : 'The Ashwright falls. Try a different route or a better card pick.' }));
  }

  if (!savedOk) {
    wrap.append(el('p', { cls: 'save-failed', text: 'This run could not be saved — your browser refused local storage.' }));
  }

  // MARKS (AC-7.3). Name AND the condition that earned each one. None => no block at all,
  // never a placeholder: an empty "Marks" heading would promise a feature that is absent.
  const marks = Array.isArray(lastRecord?.badges) ? lastRecord.badges.filter(Boolean) : [];
  if (marks.length > 0) {
    wrap.append(el('hr', { cls: 'end-rule' }));
    wrap.append(el('p', { cls: 'section-title', text: 'Marks' }));
    const list = el('ul', { cls: 'marks' });
    for (const mark of marks) {
      list.append(el('li', { cls: 'mark-item' },
        el('span', { cls: 'mark-name', text: mark.name }),
        el('span', { cls: 'mark-cond', text: mark.condition }),
      ));
    }
    wrap.append(list);
    wrap.append(el('p', { cls: 'ledger-note', text: 'Marks do not add to the total.' }));
  }

  // UNLOCK NARRATION (S4) sits between the totals and the actions: visible on arrival and
  // never below the button, because the moment after a loss is when the player decides
  // whether to play again. It is a block, NOT a modal — a dialog here would interrupt that
  // exact decision. Nothing about it auto-dismisses, so reduced motion loses no fact.
  if (lastUnlock) wrap.append(unlockBlock(lastUnlock));

  wrap.append(el('div', { cls: 'restart-row' },
    el('button', { cls: 'btn', text: 'Restart  (r)', attrs: { type: 'button' }, on: { click: () => newGame() } }),
    el('button', {
      cls: 'btn secondary',
      text: 'Open the Ledger  (h)',
      attrs: { type: 'button', 'data-end-ledger': '1' },
      on: { click: () => openLedger({ from: 'end' }) },
    }),
  ));
  return page('end', 'V — The Ledger', won ? 'crown' : 'broken', `panel page-end${won ? '' : ' lose'}`, [wrap]);
}

/* -------------------------------------------------------------------- RUN HISTORY */
//
// WHAT THIS OWNS: the shape of browser storage, the layout of the history screens, and
// every word on them. WHAT IT DOES NOT OWN: any game fact. The score comes from
// `scoreRun`, the counts from the kernel's own event stream, the marks from
// `badgesForRun`, the unlock verdict from `evaluateUnlocks`, the card pool from
// `contentForProfile`. `localStorage` is host state the kernel is forbidden to touch (R3),
// so the persistence belongs here and only here.
//
// THE TWO ERAS (DR-7). A stored record with no `actions` array yields
// `scoreRun(record) === null`: no score is derivable, so NO score is shown — not a dash,
// not a zero, not an estimate. `not scored` in --faint stands where a scored row shows a
// total, in ONE time-ordered list. An honest gap beats a plausible fiction.
//
// RETENTION (AC-6.4). The newest RETAIN records are kept, the cap is STATED on the screen
// (a silent cap is a defect), and a lifetime aggregate is folded for every finished run so
// that "floors climbed" can never DECAY when the oldest record is dropped.

const RUNS_KEY = 'dlb.runs.v1';
const UNLOCKS_KEY = 'dlb.unlocks.v1';
/** How many rows are painted before the "Show more" control. The full list stays in memory;
 *  this only bounds the first paint, so a 100-run history does not build 100 buttons at once. */
const LEDGER_PAGE = 25;

/** `?pool=full` — the tester flag (DR-5). It has NO UI surface by design: a tester who is
 *  told "this build draws from the whole pool" must be blind to which pool they got, or the
 *  measure is biased. Drawing it as a control would be a control that lies. */
const fullPool = (() => {
  try { return new URLSearchParams(location.search).get('pool') === 'full'; }
  catch { return false; }
})();

function storeGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}
/** `false` when the browser refused the write (private mode, quota, storage disabled). */
function storePut(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

/** Every record this browser holds, oldest first, with the lifetime aggregate beside it. */
let history = { records: [], agg: emptyAgg() };
/** Only the bits of unlock state that are NOT derivable: which unlocks were already
 *  narrated, and which record crossed which threshold. */
let unlocksState = { narrated: [], byRecord: {} };
/** The record for the run that just ended, and the unlock verdict that run produced. */
let lastRecord = null;
let lastUnlock = null;
/** `false` once a write was refused, so the summary can say so instead of pretending. */
let savedOk = true;
/** Set when retention has dropped a record at some point in this session. */
let evictedThisSession = false;

/** The kernel's counters, read as an unlock profile. Mirrors surface/runs.js `profileFor`. */
function profileOf(agg) {
  const badges = {};
  for (const [id, n] of Object.entries(agg?.badges ?? {})) badges[id] = Number(n) > 0;
  return { scoreTotal: agg?.score?.total ?? 0, runs: agg?.runs ?? 0, badges };
}
/** The profile the NEXT run is built for: the player's own lifetime counters. */
function currentProfile() {
  return fullPool ? fullyUnlockedProfile() : profileOf(history.agg);
}
/** The `profile` a record is stamped with — which pool this run was actually drawn from. */
const poolLabel = () => (fullPool ? 'full' : 'fresh');

/** The number of cards that exist for a profile, MEASURED from the kernel's own narrowing
 *  rather than assumed, so "Cards in play: n of 42" cannot drift from what is dealt. */
let cardsInPlayCache = { key: '', n: null };
function cardsInPlay(profile) {
  const key = `${profile.scoreTotal}|${profile.runs}|${Object.values(profile.badges ?? {}).filter(Boolean).length}|${fullPool}`;
  if (cardsInPlayCache.key !== key) {
    let n = null;
    try { n = contentForProfile(profile).cardList.length; } catch { n = null; }
    cardsInPlayCache = { key, n };
  }
  return cardsInPlayCache.n;
}

function loadHistory() {
  const runs = storeGet(RUNS_KEY);
  if (runs && Array.isArray(runs.records)) {
    const good = runs.records.filter((r) => r !== null && typeof r === 'object' && !Array.isArray(r));
    // A malformed entry is dropped rather than rendered as a broken row, and the loss is
    // REPORTED: silently discarding a stored run would make the list disagree with itself.
    if (good.length !== runs.records.length) savedOk = false;
    history.records = good;
    history.agg = runs.agg && typeof runs.agg === 'object' ? runs.agg : aggregate(good);
  }
  const un = storeGet(UNLOCKS_KEY);
  if (un) {
    if (Array.isArray(un.narrated)) unlocksState.narrated = un.narrated.filter((s) => typeof s === 'string');
    if (un.byRecord && typeof un.byRecord === 'object') unlocksState.byRecord = un.byRecord;
  }
}
loadHistory();

/**
 * The itemised score for a record, or **null** when none is derivable (DR-7).
 * @param {any} record
 */
function ledgerMath(record) {
  const score = scoreRun(record);
  if (score === null || score === undefined) return null;
  const counts = score.counts ?? {};
  const lines = score.lines.map((row) => {
    // `boss` and `victory` are 0/1 flags, not tallies, so they read "no"/"yes" with a
    // signed value while a count reads "3 × 5". Zeros stay EXPLICIT on every line: a
    // missing line is indistinguishable from a zero, and the formula has to be learnable.
    const flag = row.key === 'boss' || row.key === 'victory';
    return {
      key: row.key,
      label: row.label,
      math: flag ? (row.count > 0 ? 'yes' : 'no') : `${row.count} × ${row.each}`,
      points: flag ? `+${row.points}` : String(row.points),
    };
  });
  // AC-7.4: an elite, the boss or a victory is what EARNS the display-size total. Nothing
  // else may promote it — the total is a consequence of what happened, not a reward for
  // having played at all.
  const earned = (counts.elites ?? 0) > 0 || (counts.boss ?? 0) > 0 || (counts.victory ?? 0) > 0;
  return { total: score.total, lines, counts, earned };
}

/** The factual recognition that replaces an advice-only line on a hollow run (AC-7.4). */
function recognitionText(math) {
  const c = math.counts ?? {};
  const floor = c.floors ?? 0;
  const kills = c.kills ?? 0;
  return `This run ended on floor ${floor}. You climbed ${floor} ${floor === 1 ? 'floor' : 'floors'} `
    + `and killed ${kills} ${kills === 1 ? 'enemy' : 'enemies'}. `
    + 'Killing an elite (+10) or the boss (+50) is where the larger totals come from.';
}

/**
 * The score ledger. A REAL list, so every contributing line is individually reachable
 * (AC-7.1) rather than being one text block whose arithmetic must be re-derived by hand.
 * @param {ReturnType<typeof ledgerMath>} math
 */
function ledgerBlock(math) {
  const block = el('div', { cls: 'run-ledger', attrs: { role: 'list', 'aria-label': 'Score ledger' } });
  for (const line of math.lines) {
    block.append(el('div', { cls: 'ledger-line', attrs: { role: 'listitem' } },
      el('span', { cls: 'ledger-label', text: line.label }),
      el('span', { cls: 'ledger-math', text: line.math }),
      el('span', { cls: 'ledger-points', text: line.points }),
    ));
  }
  block.append(el('div', { cls: 'ledger-rule', attrs: { 'aria-hidden': 'true' } }));
  block.append(el('div', { cls: 'ledger-total' + (math.earned ? ' is-earned' : ''), attrs: { role: 'listitem' } },
    el('span', { cls: 'ledger-total-label', text: 'Total' }),
    el('span', { cls: 'ledger-total-value', text: String(math.total) }),
  ));
  return block;
}

/** Which catalog threshold an unlock was met by, as a sentence (AC-9.2: the THRESHOLD
 *  CROSSED is half of what has to be stated, not just "unlocked!"). */
function unlockThresholdLine(entry, info) {
  const at = entry?.at ?? null;
  if (at && typeof at.score === 'number') return `Score ${info.scoreTotalAfter} crossed the ${at.score}-point mark.`;
  if (at && typeof at.runs === 'number') return `Run ${info.runCountAfter} crossed the ${at.runs}-run mark.`;
  return `Condition met: ${entry?.condition ?? 'a threshold'}.`;
}

/** The post-run narration block: threshold crossed, option opened, pool size, limitation. */
function unlockBlock(info) {
  const block = el('div', { cls: 'unlock-block' });
  for (const unlocked of info.newly) {
    const entry = (UNLOCK_CATALOG ?? []).find((e) => e.id === unlocked.id) ?? null;
    block.append(el('p', { cls: 'unlock-head', text: `UNLOCKED — ${unlocked.name}` }));
    block.append(el('p', { cls: 'unlock-that', text: unlockThresholdLine(entry, info) }));
    // The kernel's own narration sentence: what the option now IS. Never "you are
    // stronger" — an unlock adds an OPTION, and the framing may not imply the game eased.
    block.append(el('p', { cls: 'unlock-line', text: unlocked.narration }));
  }
  const inPlay = info.cardsAfter;
  if (typeof inPlay === 'number') {
    block.append(el('p', { cls: 'unlock-pool', text: `Cards in play: ${inPlay} of ${SHIPPED_CARDS}.` }));
  }
  // The limitation, stated plainly ONCE, in the kernel's frozen-content terms: the pool is
  // re-ordered and gated, it is never enlarged.
  block.append(el('p', { cls: 'unlock-limit', text: `The card pool is the same ${SHIPPED_CARDS} cards. `
    + 'Unlocking changes which of them you are offered — it does not add cards.' }));
  return block;
}

/**
 * Write the record for the run that just ended.
 *
 * ORDER IS THE INVARIANT: build the record from the kernel's own state, attach the marks
 * the kernel derives from it, ask the kernel what this run OPENED, then fold and persist.
 * Asking after folding would report the aggregate as the "before" and lose every threshold
 * this very run crossed.
 */
function recordRun() {
  const record = buildRunRecord({
    state: ctl.state,
    submitted: runSubmitted,
    events: runEvents,
    profile: poolLabel(),
    policy: 'human',
    provenance: 'human',
  });
  const marks = badgesForRun(record);
  if (marks.length > 0) record.badges = marks;

  const before = profileOf(history.agg);
  const verdict = evaluateUnlocks(before, record);
  const newly = (verdict.newly ?? []).filter((u) => !unlocksState.narrated.includes(u.id));

  history.agg = aggregate(record, history.agg);
  const next = [...history.records, record];
  const pruned = pruneRuns(next, { keep: RETAIN });
  if (pruned.dropped.length > 0) evictedThisSession = true;
  history.records = pruned.kept;

  savedOk = storePut(RUNS_KEY, { v: 1, records: history.records, agg: history.agg });
  for (const unlocked of newly) if (!unlocksState.narrated.includes(unlocked.id)) unlocksState.narrated.push(unlocked.id);
  const byRecord = { ...unlocksState.byRecord };
  // Keyed by the record's own identity (the kernel's state hash). Two identical replays
  // share a key, which is correct rather than a collision: identical state means identical
  // thresholds, so the annotation is the same fact.
  if (newly.length > 0) byRecord[record.id] = newly.map((u) => u.id);
  unlocksState.byRecord = byRecord;
  if (!storePut(UNLOCKS_KEY, { v: 1, narrated: unlocksState.narrated, byRecord })) savedOk = false;

  lastRecord = record;
  lastUnlock = newly.length > 0
    ? {
      newly,
      scoreTotalAfter: history.agg.score?.total ?? 0,
      runCountAfter: history.agg.runs ?? 0,
      cardsBefore: cardsInPlay(before),
      cardsAfter: cardsInPlay(profileOf(history.agg)),
    }
    : null;
  cardsInPlayCache = { key: '', n: null };
}

/** The cumulative score reached by (and including) one record, from the stored order. */
function cumulativeAt(record) {
  let sum = 0;
  for (const r of history.records) {
    sum += scoreRun(r)?.total ?? 0;
    if (r === record) return sum;
  }
  return sum;
}

/** The persistent unlock line for a stored entry, if that run crossed a threshold. */
function unlockPersistentLine(record) {
  const ids = unlocksState.byRecord?.[record.id] ?? [];
  const names = [];
  let score = null;
  let runs = null;
  for (const id of ids) {
    const entry = (UNLOCK_CATALOG ?? []).find((e) => e.id === id);
    if (!entry) continue;
    names.push(entry.name);
    if (typeof entry.at?.score === 'number') score = entry.at.score;
    if (typeof entry.at?.runs === 'number') runs = entry.at.runs;
  }
  if (names.length === 0) return null;
  if (score !== null) return `Unlocked at score ${cumulativeAt(record)}: ${names.join('; ')}.`;
  if (runs !== null) return `Unlocked after ${runs} ${runs === 1 ? 'run' : 'runs'}: ${names.join('; ')}.`;
  return `Unlocked by this run: ${names.join('; ')}.`;
}
/* ---------------------------------------------------------------- keyboard bonus */

document.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key;

  // --- targeting owns the keyboard while it is active -----------------------------
  if (pendingSlot !== null && snap.phase === 'combat') {
    if (k === 'Escape' || k === 'Esc' || k === '0') { ev.preventDefault(); cancelTargeting(); return; }
    const t = Number(k);
    if (Number.isInteger(t) && t >= 1 && t <= snap.enemies.length) {
      ev.preventDefault();
      pickTarget(t);
      return;
    }
    // Anything else (digit shortcuts, End Turn) is swallowed: during a target step no
    // card may be played at an enemy the player has not chosen.
    return;
  }

  if (snap.phase === 'combat') {
    if (k === 'e' || k === 'E' || k === ' ') {
      const endTurn = snap.actions.find((a) => a.kind === 'end_turn');
      if (endTurn) { ev.preventDefault(); act(endTurn.id); }
      return;
    }
    const n = Number(k);
    if (Number.isInteger(n) && n >= 1 && n <= snap.hand.length) {
      const card = snap.hand[n - 1];
      if (card && card.playable) { ev.preventDefault(); clickCard(card.slot); }
      return;
    }
  }
  // The reward screen had NO digit handling at all, so a player who reached it could not
  // take a card by keyboard or mouse. Digits now take the numbered reward.
  if (snap.phase === 'reward') {
    const n = Number(k);
    if (Number.isInteger(n) && n >= 1 && n <= snap.reward.cards.length) {
      const pick = snap.reward.cards[n - 1];
      if (pick && pick.actionId) { ev.preventDefault(); act(pick.actionId); }
      return;
    }
    if (k === '0' && snap.reward.canSkip) { ev.preventDefault(); act(snap.reward.skipId); }
  }
  if (snap.phase === 'ended' && (k === 'r' || k === 'R')) { ev.preventDefault(); newGame(); }
  if (k === 'n' || k === 'N') { ev.preventDefault(); newGame(); }
});

const capitalize = (s) => (typeof s === 'string' && s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s);

/** Expose the controller for a curious viewer (read-only use). Not required by the game. */
window.__dlb = { controller: () => ctl, snapshot: () => snap };

render();
