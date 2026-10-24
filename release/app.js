// src/web/app.js — the browser surface: a pure VIEW on the kernel.
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

import { createController } from './src/surface/gui/controller.js';
import { cardArtMarkup } from './card-art.js';
import { attackTier, backdropMarkup, enemyMarkup, enemyVariant, heroMarkup, intentGlyph } from './stage-art.js';
// The ONE public kernel entry point (package.json `exports` is exactly this file, and it
// is browser-safe by construction: no `node:*`, no clock, no unseeded randomness, all
// enforced by scripts/check-architecture.mjs). Every number the history screens show is
// read from here or from a record this module built with `buildRunRecord` — the renderer
// composes no game fact, it only chooses layout and words.
import {
  BIOMES,
  DEFAULT_BIOME,
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
} from './src/kernel/index.js';

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
    const raw = localStorage.getItem(SPEED_KEY);
    // Nothing stored (or blank) is a FRESH player: animations on. `Number(null)` is 0,
    // so the numeric path below would silently read "never chose" as "chose skip" —
    // which left every combat animation off by default and was reported as "the
    // characters don't move". Only an explicit stored 0/1/2 may change the default.
    if (raw === null || raw === '') return 1;
    const n = Number(raw);
    if (n === 0 || n === 1 || n === 2) return n;
  } catch { /* private mode */ }
  return 1;
}
let animSpeed = readAnimSpeed();
let animGen = 0;
/**
 * The hero's card movement, held for its own duration. `bursts` lives for exactly one
 * paint (cleared by `dispatchFx()`), so without this a single mousemove — which repaints
 * the stage via `setAimed` — rebuilds the hero WITHOUT the pose and the movement is cut
 * short mid-swing. The pose is therefore pinned here when the burst first paints and
 * kept across incidental repaints until its window elapses (checked lazily, no timer),
 * so the movement always plays out in full, exactly once, and cannot retrigger itself.
 * A FRESH card-fly burst always replaces an existing hold, so fast consecutive plays
 * each get their own movement.
 */
let heroMoveHold = null; // { pose, start, dur } — the pose to keep painting, and its window
const HERO_POSE_MS = { strike: 320, heavy: 720, flurry: 660, sweep: 550, guard: 550, channel: 600, brace: 280, throw: 900, twinthrow: 1100, rend: 800, uppercut: 700, hammerfall: 560, quench: 620, bellowspush: 640, snapcast: 480, fanflames: 700, arccut: 620, collarline: 680, headbutt: 600, surge: 760, haftjab: 520, forgeclap: 780, wildflail: 740, bellowsflex: 560, dropkick: 820, bloodhammer: 900, castaside: 640, truetemper: 700, fitplate: 660, kilncry: 620, vent: 600, heattrance: 760, hailblows: 880, climbcut: 720, veintap: 560, reapsweep: 1000, heatwash: 900, bracelock: 800, flameward: 760, cindershroud: 720, stoke: 640, scaleup: 700, bankcoal: 680, ashembrace: 720, cinderskin: 660, lockdown: 900, overtemper: 820, tithe: 780, splitseam: 700 };
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
 * real page: `src/web/app.js` is an ES module, modules are strict mode, and a strict-mode
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

/** B4: the chosen hero ('ironclad' Ashwright or 'bellows' Bellows Keeper); `?hero=` seeds it. */
const HEROES = [
  { id: 'ironclad', name: 'Ashwright', blurb: '60 HP. Hammer and anvil. Kindled Heart: heal 6 after each fight.' },
  { id: 'bellows', name: 'Bellows Keeper', blurb: '54 HP. Bellows Gust hits every enemy; Fan the Flames stokes Energy. Cyan Lantern: +1 Energy on the first turn of each fight.' },
];
/** B5: the chosen biome (an id from the kernel BIOMES table); `?biome=` seeds it. */
const biomeParam = new URLSearchParams(location.search).get('biome');
let biomeChoice = biomeParam && Object.hasOwn(BIOMES, biomeParam) ? biomeParam : DEFAULT_BIOME;
let heroChoice = HEROES.some((h) => h.id === new URLSearchParams(location.search).get('hero')) ? new URLSearchParams(location.search).get('hero') : 'ironclad';

let ctl = createController({ run: { seed: seedFromUrl(), character: heroChoice, biome: biomeChoice, kindling: true, tempers: true, quests: true } });
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
// INFERENCE, not a rule: see docs/status/TARGETING-UI-STATUS.md. The fallback never overrides an
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
  const re = new RegExp(`(Lose \\d+ (?:max )?HP)|\\b(${words})\\b`, 'gi');
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
//     string at all, so an "no external asset" grep over src/web/ can be trusted.
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
  // --- temper stamps (B2): struck into a tempered card's plate. Same woodcut stroke as the
  //     node marks; the hue comes from the temper class (cold blue / ember / brass). ---
  't-quench': { box: '0 0 20 20', body: '<path class="m" d="M10 2.5 C13 6.5 14.6 9 14.6 11.4 C14.6 14 12.6 15.8 10 15.8 C7.4 15.8 5.4 14 5.4 11.4 C5.4 9 7 6.5 10 2.5 Z"/><path class="m" d="M2.5 18 C5 16.6 7.5 19.4 10 18 C12.5 16.6 15 19.4 17.5 18"/>' },
  't-redhot': { box: '0 0 20 20', body: '<path class="m" d="M10 18 C5 15 6.6 10.6 8.8 7.4 C9.6 10 12.4 9.8 11.8 6 C15.4 9.4 15.8 15 10 18 Z"/><path class="mf" d="M10 15.6 C8.4 14.4 8.8 12.6 9.8 11.4 C10.4 12.6 11.8 12.8 11.6 11.6 C12.6 13 12.2 14.8 10 15.6 Z"/>' },
  't-balance': { box: '0 0 20 20', body: '<path class="m" d="M10 3 V17 M6 17 H14 M3.5 6 H16.5"/><path class="m" d="M3.5 6 L1.8 11 H5.2 Z"/><path class="m" d="M16.5 6 L14.8 11 H18.2 Z"/>' },
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
/** Temper id -> its stamp. */
const TEMPER_GLYPH = { quenched: 't-quench', redhot: 't-redhot', balanced: 't-balance' };

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
    // The fly (and with it the pose hold and the signature timers) must also arm on a
    // KILL — `after` is reward/ended then, and a kill is exactly the stroke the player
    // most needs to see. The hold stage mirrors the fight's own layout, so the fly's
    // lane classes still read against it.
    if (before.phase === 'combat') {
      const playedSlot = actionId.split('_')[0];
      const played = before.hand.find((c) => c.slot === playedSlot && c.cardId);
      if (played) {
        const aimIdx = targetK != null && aimedAt ? (after.enemies.find((e) => e.index === aimedAt.index) ?? aimedAt) : null;
        fx.push({
          kind: 'card-fly',
          name: played.name,
          type: played.type,
          // Which card it is, so the hero's movement can be chosen per card, not just per
          // type (`heroPose()` reads this one paint later). Presentation only: the kernel
          // snapshot already carries the id, this just keeps it alive for the effect.
          id: played.cardId,
          // The aimed enemy's STABLE index (or null), so per-card signatures can direct
          // their effects at the actual target (e.g. Rising Blow launches THAT enemy).
          // A kill empties the aimed enemy from the AFTER snapshot, so the aim itself is
          // the fallback — the effects still need to know which body they are flying
          // toward (a kill's ghost carries `data-death-index` = this).
          enemy: aimIdx ? aimIdx.index : null,
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
    // The run just ended: build, score and store its record ONCE, so the end screen shows
    // the ledger, marks and unlocks (it was defined but never called, so S1 always fell
    // back to the no-record branch).
    recordRun();
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

/**
 * @param {number|null} [seed]
 * @param {{quiet?: boolean}} [opts] quiet: a hero switch on the Kindling screen, which must
 *   not replay the act title card
 */
function newGame(seed = null, opts = {}) {
  // A NEW run, built for the profile the player's own history has earned (DR-4). The
  // narrowing happens in the kernel: `contentForProfile` decides which cards EXIST, and no
  // rule ever reads the profile. `?pool=full` bypasses the narrowing for a tester.
  ctl = createController({ run: { seed: seed ?? seedFromUrl(), content: contentForProfile(currentProfile()), character: heroChoice, biome: biomeChoice, kindling: true, tempers: true, quests: true } });
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
  quietIntro = opts.quiet === true;
  // A new run must animate its own entrance and its own victory/defeat, so every one-shot
  // presentation flag is cleared with the timers that would have released it.
  prevEnemies = [];
  enteredIds = new Set();
  heroMoveHold = null;
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
    on: { click: () => newGame() },
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
      on: { click: () => newGame() },
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
  // A MID-RUN kill arrives at `reward`, not `ended`, but the beat is the same one: the
  // stroke lands, the enemy folds, THEN the next panel replaces the stage. Without the
  // reward arrival here, the spoils view swapped in on the very next paint — no swing,
  // no collapse (owner report: "when I use a card that kills the enemy I don't see any
  // animation, just the victory screen").
  const endHeld = arriving.victory || arriving.defeat || arriving.reward;
  if (endHeld && dyingThisPaint.length > 0) {
    // The killing stroke must still be SEEN. The old hold painted only the dying ghost +
    // a spacer, so the hero vanished the instant its blow landed and the victory panel
    // replaced everything ~480ms later — the player never saw the swing they triggered
    // (owner report: "when the card kills the enemy the attack effect does not play").
    // The hold therefore mirrors combatView's structure — same .stage-combat > .fight
    // wrapper, backdrop, ground, the hero figure HOLDING its killing pose, and the ghost
    // row — so the pose animation (and its impact beat, fired by dispatchFx right after)
    // plays against a stage that looks exactly like the fight it ended.
    const holdWrap = el('div', { cls: 'stage-combat' });
    const holdFight = el('div', { cls: 'fight' });
    const holdBackdrop = el('div', { cls: 'backdrop', attrs: { 'aria-hidden': 'true' } });
    holdBackdrop.innerHTML = backdropMarkup((BIOMES[snap.biome] ?? BIOMES[DEFAULT_BIOME]).backdrop);
    holdFight.append(holdBackdrop);
    holdFight.append(el('div', { cls: 'ground', attrs: { 'aria-hidden': 'true' } }));
    holdFight.append(heroFigure());
    const holdEnemies = el('div', { cls: 'enemies' });
    dyingRow(dyingThisPaint, holdEnemies);
    holdFight.append(holdEnemies);
    holdWrap.append(holdFight, el('div', { cls: 'ended-hold', attrs: { 'aria-hidden': 'true' } }));
    // The hold stage must sit in the SAME page wrapper combatView uses (`page-combat`
    // sizes and positions the fight), or the hero lands outside the frame and the
    // backdrop loses its lighting — a near-black stage instead of the fight it ended.
    stageEl.replaceChildren(page('combat', 'II — The Fight', 'blade', '', [holdWrap]));
    // How long the stage holds. The collapse ghost reads for COLLAPSE_MS; a killing
    // stroke with a SIGNATURE needs longer, because its impact beat fires at ~70% of the
    // pose and the effect (shockwave, anvil, salvo, rend, launch) lives ~600ms beyond
    // that — on the persistent fx layer, so it plays against THIS stage only while the
    // stage is up. heroFigure() above armed the pose hold, so `heroMoveHold.dur` is the
    // pose's true length (the signature's poseMs, or its move's base when it has none).
    const held = heroMoveHold;
    const sig = signatureFor(bursts.find((b) => b.kind === 'card-fly'));
    const strokeMs = held && sig ? Math.round(held.dur * 0.7) + 650 : 0;
    const wait = reducedMotion ? 0 : Math.max(Math.min(END_DELAY_MS, COLLAPSE_MS), strokeMs);
    laterPaint(() => { if (snap.phase === 'ended' || snap.phase === 'reward') render(); }, wait);
    // Keep the fight as the painted phase after a reward hold, so the spoils panel still
    // gets its entrance animation when the beat ends. The ended panel paints plain.
    if (snap.phase !== 'reward') paintedPhase = snap.phase;
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
    case 'kindling': stageEl.append(kindlingView()); break;
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

/** Set by a hero switch: the next first paint is the same screen, so no act title card. */
let quietIntro = false;

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
    const quiet = quietIntro;
    quietIntro = false;
    if (quiet) return;
    if ((to === 'kindling' || to === 'map') && !(snap.map && snap.map.floor > 0)) {
      fxAdd(el('div', { cls: 'fx-act-card', attrs: { 'aria-hidden': 'true' } },
        el('span', { cls: 'fx-act-num', text: 'Act I' }),
        el('span', { cls: 'fx-act-name', text: snap.biomeName ?? BIOMES[DEFAULT_BIOME].name }),
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
 * Where the burst's aimed enemy actually sits, in fx-layer coordinates (the layer is
 * `position: fixed; inset: 0`, so viewport rects map 1:1), plus the hero's throwing
 * shoulder. The stylesheet's vw lane classes are only the fallback: the enemy row's
 * real layout shifts with the enemy count, so a lane guessed in vw misses the card it
 * is meant to hit — the thrown hammer flew across the top of the screen (owner report).
 * Measuring the card the burst names is the same truth DOM ancestry gives the floaters:
 * the burst carries the aimed enemy's living index, the card carries `data-target-index`.
 * A kill's ghost (the hold stage) keeps its side class, so it can be found too.
 * @returns {{x: number, y: number, from: {x: number, y: number}} | null}
 */
function throwLane(b) {
  if (!stageEl || !stageEl.querySelector) return null;
  let card = null;
  if (b && Number.isInteger(b.enemy)) {
    // A kill re-indexes the row (the survivor takes the dead foe's TARGETING slot), so
    // the aimed foe's collapsing ghost must be matched BEFORE any living card — it is
    // the body the blow is still flying toward.
    card = stageEl.querySelector(`.enemy.is-dying[data-death-index="${b.enemy}"]`)
      ?? stageEl.querySelector(`.enemy[data-target-index="${b.enemy + 1}"]`);
  }
  if (!card) {
    const living = stageEl.querySelectorAll('.enemy[data-target-index]');
    if (living.length === 1) card = living[0];
  }
  if (!card) return null;
  const r = card.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const hero = stageEl.querySelector('.fight .hero');
  const hr = hero ? hero.getBoundingClientRect() : null;
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height * 0.55),
    from: hr
      ? { x: Math.round(hr.left + hr.width * 0.62), y: Math.round(hr.top + hr.height * 0.28) }
      : { x: Math.round(innerWidth * 0.08), y: Math.round(innerHeight * 0.39) },
  };
}

/** Centre an fx node on a measured point (the node's own CSS size does the rest). */
function placeAt(node, p, dx = 0, dy = 0) {
  node.style.left = `${p.x + dx}px`;
  node.style.top = `${p.y + dy}px`;
}

/**
 * Play the bursts collected for the action just taken. Called AFTER `render()`, so any
 * node an effect wants to attach to already exists in its final tree.
 */
function dispatchFx() {
  const list = bursts;
  bursts = [];
  if (reducedMotion || list.length === 0) return;
  // ONE generation per action, captured before any timer is scheduled. Every delayed
  // effect below (signature impacts, hammer landings, the hit-stop feel queue) checks
  // THIS generation, so the effects of one action can never cancel each other. A newer
  // action runs its own dispatchFx, bumps the generation once, and retires every pending
  // timer of the previous action — which is the whole point of the guard. (Bug this
  // replaced: each signature timer used to take its own ++animGen, so the feel queue's
  // later increment made every delayed signature effect cancel itself before it fired —
  // the stage shake, shockwave, anvil, salvo and rend never appeared.)
  const gen = ++animGen;
  const fire = (fn, ms) => later(() => { if (gen === animGen) fn(); }, ms);
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
        // Both ends of every aimed effect are MEASURED once here (throwLane above): the
        // lane classes only remain as a fallback for an unmeasurable row, because a
        // guessed vw lane misses multi-enemy rows.
        const lane = throwLane(b);
        // THROW choreography: a spinning hammer leaves the hero, arcs into the aimed
        // lane, and (for Returning Brand) flies back. The burst carries the card id, so
        // the effect layer can read `HERO_THROWS` for the return beat. The impact flash
        // is delayed to the moment the arc lands (84% of the flight).
        if (b.id && HERO_THROWS[b.id]) {
          const spec = HERO_THROWS[b.id];
          const flight = spec.ms ?? THROW_MS;
          const throwCls = `fx-hammer ${b.side || 'side-none'}${spec.returns ? ' fx-hammer-returns' : ''}${spec.blood ? ' fx-hammer-blood' : ''}`;
          const launch = () => {
            const hammer = el('div', { cls: throwCls, attrs: { 'aria-hidden': 'true' } },
              el('span', { cls: 'fx-hammer-head' }), el('span', { cls: 'fx-hammer-haft' }));
            if (lane) {
              hammer.style.left = `${lane.from.x - 27}px`;
              hammer.style.top = `${lane.from.y - 11}px`;
              hammer.style.setProperty('--fly-x', `${lane.x - lane.from.x}px`);
            }
            fxAdd(hammer, animMs(flight) || flight);
            fire(() => {
              const hit = el('div', { cls: `fx-hammer-hit ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } });
              if (lane) placeAt(hit, lane, -45, -45);
              fxAdd(hit, animMs(420) || 420);
            }, animMs(Math.round(flight * (spec.hitAt ?? 0.84))) || 1);
          };
          // Blood Hammer condenses FIRST: the flight is held (delayMs) until the clot at
          // the hero's chest closes; every other throw leaves the shoulder immediately.
          if (spec.delayMs) fire(launch, animMs(spec.delayMs) || 1);
          else launch();
        }
        // SIGNATURE choreography (per-card): each knob fires at its own beat of the SAME
        // action generation, so the hit-stop queue below can never retire them early.
        const sig = signatureFor(b);
        if (sig) {
          const sigMs = sig.poseMs || HERO_POSE_MS[heroMove(b)] || 800;
          if (sig.shake) {
            fire(() => {
              if (stageEl && stageEl.classList) stageEl.classList.add('stage-shake');
              later(() => {
                if (gen === animGen && stageEl && stageEl.classList) stageEl.classList.remove('stage-shake');
              }, animMs(450) || 450);
            }, animMs(Math.round(sigMs * 0.66)) || 1);
          }
          if (sig.shockwave) {
            fire(() => {
              const wave = el('div', { cls: `fx-shockwave ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } });
              if (lane) placeAt(wave, lane, -35, -35);
              fxAdd(wave, animMs(560) || 560);
            }, animMs(Math.round(sigMs * 0.66)) || 1);
          }
          // Anvil Blow: the spectral anvil falls and cracks onto the target.
          if (sig.anvil) {
            fire(() => {
              const anvil = el('div', { cls: `fx-anvil ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-anvil-body' }), el('span', { cls: 'fx-anvil-crack' }));
              if (lane) anvil.style.left = `${lane.x - 37}px`;
              fxAdd(anvil, animMs(700) || 700);
            }, animMs(Math.round(sigMs * 0.58)) || 1);
          }
          // Twin Hammers: a SALVO — two hammers, 180ms apart, two impact flashes timed
          // to each hammer's own landing (84% of the flight from each launch).
          if (sig.twin) {
            const TWIN_STAGGER = 180;
            for (let n = 0; n < 2; n++) {
              fire(() => {
                const hammer = el('div', { cls: `fx-hammer ${b.side || 'side-none'} fx-hammer-twin-${n ? 'second' : 'first'}`, attrs: { 'aria-hidden': 'true' } },
                  el('span', { cls: 'fx-hammer-head' }), el('span', { cls: 'fx-hammer-haft' }));
                if (lane) {
                  hammer.style.left = `${lane.from.x - 27}px`;
                  hammer.style.top = `${lane.from.y - 11}px`;
                  hammer.style.setProperty('--fly-x', `${lane.x - lane.from.x}px`);
                }
                fxAdd(hammer, animMs(THROW_MS) || THROW_MS);
                fire(() => {
                  const hit = el('div', { cls: `fx-hammer-hit ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } });
                  if (lane) placeAt(hit, lane, -45, -45);
                  fxAdd(hit, animMs(420) || 420);
                }, animMs(Math.round(THROW_MS * 0.84)) || 1);
              }, animMs(n * TWIN_STAGGER) || 1);
            }
          }
          // Sunder: the burning seam splits the air down the target lane.
          if (sig.rend) {
            fire(() => {
              const seam = el('div', { cls: `fx-rend ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-rend-seam' }), el('span', { cls: 'fx-rend-seam fx-rend-seam-2' }));
              if (lane) seam.style.left = `${lane.x - 13}px`;
              fxAdd(seam, animMs(560) || 560);
            }, animMs(Math.round(sigMs * 0.55)) || 1);
          }
          // Rising Blow: the aimed enemy is LAUNCHED off its stance at the impact beat.
          if (sig.launch) {
            fire(() => {
              // Enemy cards carry data-target-index = position+1 (the targeting k); the
              // burst's enemy index is the kernel's living index (0-based) at that paint.
              const cards = stageEl && stageEl.querySelectorAll ? [...stageEl.querySelectorAll('.enemy')] : [];
              const target = b.enemy != null
                ? cards.find((c) => c.getAttribute && c.getAttribute('data-target-index') === String(b.enemy + 1))
                : null;
              const fig = (target || cards[0])?.querySelector('.fig');
              if (fig && fig.classList) {
                fig.classList.add('launched');
                later(() => {
                  if (gen === animGen && fig.classList) fig.classList.remove('launched');
                }, animMs(620) || 620);
              }
            }, animMs(Math.round(sigMs * 0.55)) || 1);
          }
          // Hammerfall: the drop cracks the lane — a small crack splits the ground under the
          // aimed enemy and forge-dust puffs out of it, at the beat the hammer lands.
          if (sig.dustcrack) {
            fire(() => {
              const crack = el('div', { cls: `fx-dustcrack ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-dustcrack-crack' }),
                el('span', { cls: 'fx-dustcrack-puff' }),
                el('span', { cls: 'fx-dustcrack-puff fx-dustcrack-puff-2' }),
                el('span', { cls: 'fx-dustcrack-puff fx-dustcrack-puff-3' }));
              if (lane) placeAt(crack, lane, -55, 88);
              fxAdd(crack, animMs(620) || 620);
            }, animMs(Math.round(sigMs * 0.62)) || 1);
          }
          // Quench: a veil of blue-white steam climbs the HERO. Effects on the hero anchor
          // to the hero's own measured box (the hero node is rebuilt by repainting, so it
          // is measured HERE, at fire time — the same truth the lane classes fall back to).
          if (sig.quenchveil) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const veil = el('div', { cls: 'fx-quenchveil', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-quenchveil-steam' }),
                el('span', { cls: 'fx-quenchveil-steam fx-quenchveil-steam-2' }),
                el('span', { cls: 'fx-quenchveil-steam fx-quenchveil-steam-3' }));
              veil.style.left = `${Math.round(r.left + r.width * 0.5 - 34)}px`;
              veil.style.top = `${Math.round(r.top + r.height * 0.16)}px`;
              fxAdd(veil, animMs(780) || 780);
            }, animMs(Math.round(sigMs * 0.3)) || 1);
          }
          // Bellows Gust: a cone of wind sweeps the WHOLE enemy row — it is sized to the
          // row's measured span (a targeted lane would miss an all-row hit) — and the row
          // leans back under it (a `blown` class on each figure, one gust, then gone).
          if (sig.gustcone) {
            fire(() => {
              const cards = stageEl && stageEl.querySelectorAll
                ? [...stageEl.querySelectorAll('.enemy[data-target-index]')] : [];
              const cone = el('div', { cls: `fx-gustcone ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-gustcone-streak' }),
                el('span', { cls: 'fx-gustcone-streak fx-gustcone-streak-2' }),
                el('span', { cls: 'fx-gustcone-streak fx-gustcone-streak-3' }));
              if (cards.length > 0) {
                let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
                for (const c of cards) {
                  const r = c.getBoundingClientRect();
                  if (r.width === 0 && r.height === 0) continue;
                  left = Math.min(left, r.left); top = Math.min(top, r.top);
                  right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
                }
                if (right > left) {
                  cone.style.left = `${Math.round(left - 80)}px`;
                  cone.style.top = `${Math.round((top + bottom) / 2 - 60)}px`;
                  cone.style.setProperty('--gust-w', `${Math.round(right - left + 100)}px`);
                }
              }
              fxAdd(cone, animMs(640) || 640);
              for (const c of cards) {
                const fig = c.querySelector && c.querySelector('.fig');
                if (fig && fig.classList) {
                  fig.classList.add('blown');
                  later(() => {
                    if (gen === animGen && fig.classList) fig.classList.remove('blown');
                  }, animMs(600) || 600);
                }
              }
            }, animMs(Math.round(sigMs * 0.45)) || 1);
          }
          // Spark: the snap casts — an ember dart flies from the hero's shoulder to the
          // aimed lane, and a luminous mote peels off and drifts back to the draw pile.
          if (sig.sparkdart) {
            fire(() => {
              const dart = el('div', { cls: `fx-sparkdart ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } });
              if (lane) {
                dart.style.left = `${lane.from.x - 10}px`;
                dart.style.top = `${lane.from.y - 8}px`;
                dart.style.setProperty('--dart-x', `${lane.x - lane.from.x}px`);
                dart.style.setProperty('--dart-y', `${lane.y - lane.from.y}px`);
              }
              fxAdd(dart, animMs(430) || 430);
              const pile = stageEl && stageEl.querySelector ? stageEl.querySelector('.pile-draw') : null;
              if (lane && pile) {
                const pr = pile.getBoundingClientRect();
                const mote = el('div', { cls: 'fx-sparkmote', attrs: { 'aria-hidden': 'true' } });
                mote.style.left = `${lane.from.x - 7}px`;
                mote.style.top = `${lane.from.y - 7}px`;
                mote.style.setProperty('--mote-x', `${Math.round(pr.left + pr.width / 2 - lane.from.x)}px`);
                mote.style.setProperty('--mote-y', `${Math.round(pr.top + pr.height / 2 - lane.from.y)}px`);
                fxAdd(mote, animMs(820) || 820);
              }
            }, animMs(Math.round(sigMs * 0.4)) || 1);
          }
          // Fan the Flames: three flame tongues open in a fan by the hero's furnace, and
          // one bright spark darts off to the energy orb — the fire fed, the orb fed.
          if (sig.flarefan) {
            fire(() => {
              const fan = el('div', { cls: 'fx-flarefan', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-flarefan-tongue' }),
                el('span', { cls: 'fx-flarefan-tongue fx-flarefan-tongue-2' }),
                el('span', { cls: 'fx-flarefan-tongue fx-flarefan-tongue-3' }));
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (hero) {
                const r = hero.getBoundingClientRect();
                fan.style.left = `${Math.round(r.left + r.width * 0.55)}px`;
                fan.style.top = `${Math.round(r.top + r.height * 0.08)}px`;
              }
              fxAdd(fan, animMs(700) || 700);
              const orb = stageEl && stageEl.querySelector ? stageEl.querySelector('.energy-orb') : null;
              if (orb) {
                const or = orb.getBoundingClientRect();
                const spark = el('div', { cls: 'fx-flarespark', attrs: { 'aria-hidden': 'true' } });
                const hr = hero ? hero.getBoundingClientRect() : null;
                const sx = hr ? Math.round(hr.left + hr.width * 0.62) : Math.round(innerWidth * 0.2);
                const sy = hr ? Math.round(hr.top + hr.height * 0.3) : Math.round(innerHeight * 0.5);
                spark.style.left = `${sx}px`;
                spark.style.top = `${sy}px`;
                spark.style.setProperty('--spark-x', `${Math.round(or.left + or.width / 2 - sx)}px`);
                spark.style.setProperty('--spark-y', `${Math.round(or.top + or.height / 2 - sy)}px`);
                fxAdd(spark, animMs(560) || 560);
              }
            }, animMs(Math.round(sigMs * 0.42)) || 1);
          }
          // ==== LOTE 2 — ataques comunes I: each common attack draws its own mark. ====
          // Arc Cut: ONE horizontal luminous arc crosses the WHOLE enemy row, side to
          // side — sized to the row's measured span (like the gust cone), never to a
          // single lane, because the card hits all enemies.
          if (sig.arcspan) {
            fire(() => {
              const cards = stageEl && stageEl.querySelectorAll
                ? [...stageEl.querySelectorAll('.enemy[data-target-index]')] : [];
              const arc = el('div', { cls: `fx-arcspan ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-arcspan-blade' }),
                el('span', { cls: 'fx-arcspan-under' }));
              if (cards.length > 0) {
                let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
                for (const c of cards) {
                  const r = c.getBoundingClientRect();
                  if (r.width === 0 && r.height === 0) continue;
                  left = Math.min(left, r.left); top = Math.min(top, r.top);
                  right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
                }
                if (right > left) {
                  arc.style.left = `${Math.round(left - 60)}px`;
                  arc.style.top = `${Math.round((top + bottom) / 2 - 26)}px`;
                  arc.style.setProperty('--arc-w', `${Math.round(right - left + 120)}px`);
                }
              }
              fxAdd(arc, animMs(520) || 520);
            }, animMs(Math.round(sigMs * 0.5)) || 1);
          }
          // Collar Check: a taut line flashes across the lane at NECK height, then two
          // sagging weak marks droop in over the target — the status drawn as weight.
          if (sig.collarline) {
            fire(() => {
              const wire = el('div', { cls: `fx-collarline ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-collarline-wire' }),
                el('span', { cls: 'fx-collarline-sag' }),
                el('span', { cls: 'fx-collarline-sag fx-collarline-sag-2' }));
              if (lane) placeAt(wire, lane, -70, -66);
              fxAdd(wire, animMs(680) || 680);
            }, animMs(Math.round(sigMs * 0.42)) || 1);
          }
          // Brow Strike: an eight-point impact star bursts where the brow lands; the
          // pose's own recoil then reads the bounce-off.
          if (sig.impactstar) {
            fire(() => {
              const star = el('div', { cls: `fx-impactstar ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-impactstar-core' }),
                el('span', { cls: 'fx-impactstar-ray' }));
              if (lane) placeAt(star, lane, -48, -60);
              fxAdd(star, animMs(440) || 440);
            }, animMs(Math.round(sigMs * 0.55)) || 1);
          }
          // Slag Surge: a molten plate glows on the HERO's front (measured hero box, the
          // quenchveil anchor), and a wave of slag rolls along the GROUND from the hero's
          // feet to the aimed lane.
          if (sig.slagwave) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const plate = el('div', { cls: 'fx-slagplate', attrs: { 'aria-hidden': 'true' } });
              plate.style.left = `${Math.round(r.left + r.width * 0.22)}px`;
              plate.style.top = `${Math.round(r.top + r.height * 0.18)}px`;
              fxAdd(plate, animMs(760) || 760);
              const wave = el('div', { cls: `fx-slagwave ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } });
              const wx = Math.round(r.left + r.width * 0.55);
              const wy = Math.round(r.top + r.height * 0.92);
              wave.style.left = `${wx}px`;
              wave.style.top = `${wy}px`;
              if (lane) {
                wave.style.setProperty('--slag-x', `${Math.round(lane.x - wx)}px`);
                wave.style.setProperty('--slag-y', `${Math.round(lane.y - wy)}px`);
              }
              fxAdd(wave, animMs(720) || 720);
            }, animMs(Math.round(sigMs * 0.3)) || 1);
          }
          // Haft Jab: the pommel's blunt cap cracks against the target, and a card is
          // PULLED out of the foe — it flies FROM the enemy toward the hero's hand.
          if (sig.jabpull) {
            fire(() => {
              const cap = el('div', { cls: `fx-jabspark ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } });
              if (lane) placeAt(cap, lane, -26, -30);
              fxAdd(cap, animMs(320) || 320);
            }, animMs(Math.round(sigMs * 0.42)) || 1);
            fire(() => {
              const hand = stageEl && stageEl.querySelector ? stageEl.querySelector('.hand') : null;
              if (!lane || !hand) return;
              const hr = hand.getBoundingClientRect();
              const card = el('div', { cls: 'fx-jabpull', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-jabpull-face' }),
                el('span', { cls: 'fx-jabpull-tip' }));
              card.style.left = `${lane.x - 16}px`;
              card.style.top = `${lane.y - 22}px`;
              card.style.setProperty('--pull-x', `${Math.round(hr.left + hr.width * 0.28 - lane.x)}px`);
              card.style.setProperty('--pull-y', `${Math.round(hr.top + hr.height / 2 - lane.y)}px`);
              fxAdd(card, animMs(640) || 640);
            }, animMs(Math.round(sigMs * 0.52)) || 1);
          }
          // ==== LOTE 3 — ataques comunes II: each common attack draws its own mark. ====
          // Forgeclap: TWO hammer heads rise and MEET overhead — the clash point is ABOVE
          // the hero (measured hero box), and the shock ring plus the vulnerable cracks
          // span the WHOLE row (measured row span, like the gust cone: every enemy is hit).
          if (sig.forgering) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const forge = el('div', { cls: 'fx-forgering', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-forgering-head fx-forgering-head-left' }),
                el('span', { cls: 'fx-forgering-head fx-forgering-head-right' }),
                el('span', { cls: 'fx-forgering-clash' }),
                el('span', { cls: 'fx-forgering-ring' }));
              forge.style.left = `${Math.round(r.left + r.width * 0.5 - 60)}px`;
              forge.style.top = `${Math.round(r.top - 64)}px`;
              fxAdd(forge, animMs(720) || 720);
              const cards = stageEl && stageEl.querySelectorAll
                ? [...stageEl.querySelectorAll('.enemy[data-target-index]')] : [];
              const cracks = el('div', { cls: `fx-forgecracks ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-forgecracks-mark' }),
                el('span', { cls: 'fx-forgecracks-mark fx-forgecracks-mark-2' }),
                el('span', { cls: 'fx-forgecracks-mark fx-forgecracks-mark-3' }));
              if (cards.length > 0) {
                let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
                for (const c of cards) {
                  const cr = c.getBoundingClientRect();
                  if (cr.width === 0 && cr.height === 0) continue;
                  left = Math.min(left, cr.left); top = Math.min(top, cr.top);
                  right = Math.max(right, cr.right); bottom = Math.max(bottom, cr.bottom);
                }
                if (right > left) {
                  cracks.style.left = `${Math.round(left)}px`;
                  cracks.style.top = `${Math.round((top + bottom) / 2 - 34)}px`;
                  cracks.style.setProperty('--forge-w', `${Math.round(right - left)}px`);
                }
              }
              fxAdd(cracks, animMs(660) || 660);
            }, animMs(Math.round(sigMs * 0.2)) || 1);
          }
          // Untempered: the untempered double swing throws white-hot cracks AROUND the
          // aimed lane — one flare per wild beat (the fissures flash twice), white core
          // cooling to ember red.
          if (sig.wildcracks) {
            fire(() => {
              const cracks = el('div', { cls: `fx-wildcracks ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-wildcracks-fissure' }),
                el('span', { cls: 'fx-wildcracks-fissure fx-wildcracks-fissure-2' }),
                el('span', { cls: 'fx-wildcracks-fissure fx-wildcracks-fissure-3' }));
              if (lane) placeAt(cracks, lane, -66, -44);
              fxAdd(cracks, animMs(700) || 700);
            }, animMs(Math.round(sigMs * 0.3)) || 1);
          }
          // Bellows: ONE ember pulse blooms and collapses at the hero's chest as it
          // swells — a single pulse, deliberately never a column (the quench veil's).
          if (sig.chestpulse) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const pulse = el('div', { cls: 'fx-chestpulse', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-chestpulse-core' }),
                el('span', { cls: 'fx-chestpulse-halo' }));
              pulse.style.left = `${Math.round(r.left + r.width * 0.5 - 26)}px`;
              pulse.style.top = `${Math.round(r.top + r.height * 0.24)}px`;
              fxAdd(pulse, animMs(560) || 560);
            }, animMs(Math.round(sigMs * 0.18)) || 1);
          }
          // Heel Drop: the heels land — embers burst at the impact point, and the
          // refunded energy is a spark that rides FROM the burst INTO the energy orb
          // (the flarefan's spark flies hero→orb; this one flies lane→orb).
          if (sig.heelburst) {
            fire(() => {
              const burst = el('div', { cls: `fx-heelburst ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-heelburst-core' }),
                el('span', { cls: 'fx-heelburst-ember' }),
                el('span', { cls: 'fx-heelburst-ember fx-heelburst-ember-2' }),
                el('span', { cls: 'fx-heelburst-ember fx-heelburst-ember-3' }));
              if (lane) placeAt(burst, lane, -40, -34);
              fxAdd(burst, animMs(560) || 560);
              const orb = stageEl && stageEl.querySelector ? stageEl.querySelector('.energy-orb') : null;
              if (lane && orb) {
                const or2 = orb.getBoundingClientRect();
                const spark = el('div', { cls: 'fx-heelspark', attrs: { 'aria-hidden': 'true' } });
                spark.style.left = `${lane.x - 7}px`;
                spark.style.top = `${lane.y - 7}px`;
                spark.style.setProperty('--heelspark-x', `${Math.round(or2.left + or2.width / 2 - lane.x)}px`);
                spark.style.setProperty('--heelspark-y', `${Math.round(or2.top + or2.height / 2 - lane.y)}px`);
                fxAdd(spark, animMs(620) || 620);
              }
            }, animMs(Math.round(sigMs * 0.55)) || 1);
          }
          // Blood Hammer: an ember-BLOOD clot condenses at the hero's chest and closes
          // into the hammer head — the throw flight above is HELD (HERO_THROWS.delayMs)
          // until this clot closes, then the blood-tinted hammer flies on.
          if (sig.bloodcondense) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const clot = el('div', { cls: 'fx-bloodcondense', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-bloodcondense-mass' }),
                el('span', { cls: 'fx-bloodcondense-edge' }));
              clot.style.left = `${Math.round(r.left + r.width * 0.5 - 22)}px`;
              clot.style.top = `${Math.round(r.top + r.height * 0.2)}px`;
              fxAdd(clot, animMs(520) || 520);
            }, animMs(Math.round(sigMs * 0.06)) || 1);
          }
          // ==== LOTE 4 — skills comunes: each common skill draws its own mark. ====
          // Cast Aside: the shrug tosses a spare plate OVER the shoulder — it rises behind
          // the hero's back and drops away (measured hero box) — and the DRAWN card slides
          // from the chest into the hand (the hand measured, like the jab's pulled card).
          if (sig.platefly) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const plate = el('div', { cls: 'fx-platefly', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-platefly-sheet' }));
              plate.style.left = `${Math.round(r.left + r.width * 0.34)}px`;
              plate.style.top = `${Math.round(r.top + r.height * 0.04)}px`;
              fxAdd(plate, animMs(620) || 620);
            }, animMs(Math.round(sigMs * 0.14)) || 1);
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              const hand = stageEl && stageEl.querySelector ? stageEl.querySelector('.hand') : null;
              if (!hero || !hand) return;
              const r = hero.getBoundingClientRect();
              const hr = hand.getBoundingClientRect();
              const card = el('div', { cls: 'fx-platecard', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-platecard-face' }));
              const sx = Math.round(r.left + r.width * 0.5);
              const sy = Math.round(r.top + r.height * 0.3);
              card.style.left = `${sx}px`;
              card.style.top = `${sy}px`;
              card.style.setProperty('--slide-x', `${Math.round(hr.left + hr.width * 0.3 - sx)}px`);
              card.style.setProperty('--slide-y', `${Math.round(hr.top + hr.height * 0.55 - sy)}px`);
              fxAdd(card, animMs(560) || 560);
            }, animMs(Math.round(sigMs * 0.5)) || 1);
          }
          // True Temper: the raised hammer tempers — hiss jets rise OFF it at hammer
          // height (measured hero box, above the head where the windup frame holds it)
          // and the white-hot temper line flares across the metal.
          if (sig.temperhiss) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const hiss = el('div', { cls: 'fx-temperhiss', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-temperhiss-jet' }),
                el('span', { cls: 'fx-temperhiss-jet fx-temperhiss-jet-2' }),
                el('span', { cls: 'fx-temperhiss-jet fx-temperhiss-jet-3' }),
                el('span', { cls: 'fx-temperhiss-line' }));
              hiss.style.left = `${Math.round(r.left + r.width * 0.62)}px`;
              hiss.style.top = `${Math.round(r.top + r.height * 0.13)}px`;
              fxAdd(hiss, animMs(680) || 680);
            }, animMs(Math.round(sigMs * 0.24)) || 1);
          }
          // Fit the Plate: the plate DROPS onto the shoulder and locks at the settle
          // beat — a bronze clank ring opens where it lands and rivet sparks scatter.
          if (sig.plateclank) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const clank = el('div', { cls: 'fx-plateclank', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-plateclank-plate' }),
                el('span', { cls: 'fx-plateclank-ring' }),
                el('span', { cls: 'fx-plateclank-rivet' }),
                el('span', { cls: 'fx-plateclank-rivet fx-plateclank-rivet-2' }),
                el('span', { cls: 'fx-plateclank-rivet fx-plateclank-rivet-3' }));
              clank.style.left = `${Math.round(r.left + r.width * 0.52)}px`;
              clank.style.top = `${Math.round(r.top + r.height * 0.25)}px`;
              fxAdd(clank, animMs(640) || 640);
            }, animMs(Math.round(sigMs * 0.46)) || 1);
          }
          // Kiln Cry: the shout — a wedge of kiln heat cones from the mouth toward the
          // row (measured hero box, mouth height) while the DISCARDED card catches fire
          // in the air beside the hero and burns to ash.
          if (sig.crycone) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const cone = el('div', { cls: 'fx-crycone', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-crycone-heat' }),
                el('span', { cls: 'fx-crycone-heat fx-crycone-heat-2' }),
                el('span', { cls: 'fx-crycone-heat fx-crycone-heat-3' }));
              cone.style.left = `${Math.round(r.left + r.width * 0.58)}px`;
              cone.style.top = `${Math.round(r.top + r.height * 0.1)}px`;
              fxAdd(cone, animMs(560) || 560);
              const card = el('div', { cls: 'fx-crycard', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-crycard-face' }),
                el('span', { cls: 'fx-crycard-ash' }));
              card.style.left = `${Math.round(r.left + r.width * 0.86)}px`;
              card.style.top = `${Math.round(r.top + r.height * 0.02)}px`;
              fxAdd(card, animMs(660) || 660);
            }, animMs(Math.round(sigMs * 0.28)) || 1);
          }
          // Vent: pressure leaves the BACK — two flat steam jets blast from behind the
          // hero (the back is the hero's measured LEFT side) and the refunded energy
          // bursts AT the orb in the HUD (the orb measured, like the flarefan's spark).
          if (sig.ventjets) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const jets = el('div', { cls: 'fx-ventjets', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-ventjets-jet' }),
                el('span', { cls: 'fx-ventjets-jet fx-ventjets-jet-2' }));
              jets.style.left = `${Math.round(r.left + r.width * 0.22)}px`;
              jets.style.top = `${Math.round(r.top + r.height * 0.26)}px`;
              fxAdd(jets, animMs(620) || 620);
            }, animMs(Math.round(sigMs * 0.2)) || 1);
            fire(() => {
              const orb = stageEl && stageEl.querySelector ? stageEl.querySelector('.energy-orb') : null;
              if (!orb) return;
              const or = orb.getBoundingClientRect();
              const burst = el('div', { cls: 'fx-ventorb', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-ventorb-ring' }),
                el('span', { cls: 'fx-ventorb-flare' }));
              burst.style.left = `${Math.round(or.left + or.width / 2 - 30)}px`;
              burst.style.top = `${Math.round(or.top + or.height / 2 - 30)}px`;
              fxAdd(burst, animMs(560) || 560);
            }, animMs(Math.round(sigMs * 0.5)) || 1);
          }
          // ==== LOTE 5 — ataques uncommon: each uncommon card draws its own mark. ====
          // Heat Trance: the arms cross and THREE GHOST CARDS fan open by the chest —
          // they glow in sequence, then flow one after another into the hand (the hand
          // measured, like the jab's pulled card). A fan of cards, not a dart and not a
          // plate — the cards themselves are the effect.
          if (sig.cardfan) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const fan = el('div', { cls: 'fx-cardfan', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-cardfan-ghost' }),
                el('span', { cls: 'fx-cardfan-ghost fx-cardfan-ghost-2' }),
                el('span', { cls: 'fx-cardfan-ghost fx-cardfan-ghost-3' }));
              fan.style.left = `${Math.round(r.left + r.width * 0.5 - 60)}px`;
              fan.style.top = `${Math.round(r.top + r.height * 0.16)}px`;
              const hand = stageEl && stageEl.querySelector ? stageEl.querySelector('.hand') : null;
              if (hand) {
                const hr = hand.getBoundingClientRect();
                fan.style.setProperty('--fan-x', `${Math.round(hr.left + hr.width * 0.3 - (r.left + r.width * 0.5))}px`);
                fan.style.setProperty('--fan-y', `${Math.round(hr.top + hr.height * 0.55 - (r.top + r.height * 0.3))}px`);
              }
              fxAdd(fan, animMs(920) || 920);
            }, animMs(Math.round(sigMs * 0.3)) || 1);
          }
          // Hail of Blows: a BURST of four SMALL flashes that land in alternation along
          // the aimed lane — tiny, tight, staggered, and deliberately nothing like the
          // twin salvo's flying hammers or the hammer-hit's one big flash.
          if (sig.hailticks) {
            fire(() => {
              const hail = el('div', { cls: `fx-hailticks ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-hailticks-tick' }),
                el('span', { cls: 'fx-hailticks-tick fx-hailticks-tick-2' }),
                el('span', { cls: 'fx-hailticks-tick fx-hailticks-tick-3' }),
                el('span', { cls: 'fx-hailticks-tick fx-hailticks-tick-4' }));
              if (lane) placeAt(hail, lane, -46, -44);
              fxAdd(hail, animMs(620) || 620);
            }, animMs(Math.round(sigMs * 0.4)) || 1);
          }
          // Climbing Heat: the ascending stroke — a diagonal slash cuts UP across the
          // lane while ember RUNGS light up bottom-to-top under it, a ladder of heat.
          if (sig.heatladder) {
            fire(() => {
              const ladder = el('div', { cls: `fx-heatladder ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-heatladder-slash' }),
                el('span', { cls: 'fx-heatladder-rung' }),
                el('span', { cls: 'fx-heatladder-rung fx-heatladder-rung-2' }),
                el('span', { cls: 'fx-heatladder-rung fx-heatladder-rung-3' }),
                el('span', { cls: 'fx-heatladder-rung fx-heatladder-rung-4' }));
              if (lane) placeAt(ladder, lane, -34, -92);
              fxAdd(ladder, animMs(780) || 780);
            }, animMs(Math.round(sigMs * 0.45)) || 1);
          }
          // Vein Tap: the tap opens a glowing nick on the hero's forearm — ember drops
          // FALL from it and the last one condenses into one bright bead of energy at
          // the wrist. Crimson ember-blood, drops falling: never the chest clot.
          if (sig.veindrip) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const drip = el('div', { cls: 'fx-veindrip', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-veindrip-cut' }),
                el('span', { cls: 'fx-veindrip-drop' }),
                el('span', { cls: 'fx-veindrip-drop fx-veindrip-drop-2' }),
                el('span', { cls: 'fx-veindrip-drop fx-veindrip-drop-3' }),
                el('span', { cls: 'fx-veindrip-bead' }));
              drip.style.left = `${Math.round(r.left + r.width * 0.56)}px`;
              drip.style.top = `${Math.round(r.top + r.height * 0.42)}px`;
              fxAdd(drip, animMs(880) || 880);
            }, animMs(Math.round(sigMs * 0.45)) || 1);
          }
          // Ash Harvest: a scythe of ash sweeps the WHOLE row (sized to the row's
          // measured span, like the gust cone — the card hits every enemy) and one ash
          // mote per enemy DRAINS from its card back toward the hero.
          if (sig.ashscythe) {
            fire(() => {
              const cards = stageEl && stageEl.querySelectorAll
                ? [...stageEl.querySelectorAll('.enemy[data-target-index]')] : [];
              const scythe = el('div', { cls: `fx-ashscythe ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-ashscythe-blade' }),
                el('span', { cls: 'fx-ashscythe-mist' }));
              if (cards.length > 0) {
                let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
                for (const c of cards) {
                  const r = c.getBoundingClientRect();
                  if (r.width === 0 && r.height === 0) continue;
                  left = Math.min(left, r.left); top = Math.min(top, r.top);
                  right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
                }
                if (right > left) {
                  scythe.style.left = `${Math.round(left - 40)}px`;
                  scythe.style.top = `${Math.round((top + bottom) / 2 - 70)}px`;
                  scythe.style.setProperty('--ash-w', `${Math.round(right - left + 80)}px`);
                }
              }
              fxAdd(scythe, animMs(980) || 980);
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (hero) {
                const hr = hero.getBoundingClientRect();
                for (const c of cards) {
                  const r = c.getBoundingClientRect();
                  if (r.width === 0 && r.height === 0) continue;
                  const mote = el('div', { cls: 'fx-ashmote', attrs: { 'aria-hidden': 'true' } });
                  mote.style.left = `${Math.round(r.left + r.width * 0.5)}px`;
                  mote.style.top = `${Math.round(r.top + r.height * 0.45)}px`;
                  mote.style.setProperty('--drain-x', `${Math.round(hr.left + hr.width * 0.55 - (r.left + r.width * 0.5))}px`);
                  mote.style.setProperty('--drain-y', `${Math.round(hr.top + hr.height * 0.4 - (r.top + r.height * 0.45))}px`);
                  fxAdd(mote, animMs(760) || 760);
                }
              }
            }, animMs(Math.round(sigMs * 0.45)) || 1);
          }
          // ==== LOTE 6 — skills uncommon: each uncommon skill makes its own mark. ====
          // Heat Wash: the low arm sweep drags a THERMAL WAVE across the WHOLE row
          // (sized to the row's measured span, like the ash scythe) — a low crest rolls
          // left-to-right and the haze behind it wilts as it passes.
          if (sig.heatwashwave) {
            fire(() => {
              const cards = stageEl && stageEl.querySelectorAll
                ? [...stageEl.querySelectorAll('.enemy[data-target-index]')] : [];
              const wash = el('div', { cls: 'fx-heatwash', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-heatwash-crest' }),
                el('span', { cls: 'fx-heatwash-haze' }),
                el('span', { cls: 'fx-heatwash-wilt' }),
                el('span', { cls: 'fx-heatwash-wilt fx-heatwash-wilt-2' }));
              if (cards.length > 0) {
                let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
                for (const c of cards) {
                  const r = c.getBoundingClientRect();
                  if (r.width === 0 && r.height === 0) continue;
                  left = Math.min(left, r.left); top = Math.min(top, r.top);
                  right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
                }
                if (right > left) {
                  wash.style.left = `${Math.round(left - 90)}px`;
                  wash.style.top = `${Math.round((top + bottom) / 2 - 75)}px`;
                  wash.style.setProperty('--wash-w', `${Math.round(right - left + 180)}px`);
                }
              }
              fxAdd(wash, animMs(980) || 980);
            }, animMs(Math.round(sigMs * 0.3)) || 1);
          }
          // Brace: the stance LOCKS — two concentric rings of plate fit around the hero
          // with a DOUBLE CLANK (the inner ring closes first, the outer a beat later;
          // each close fires its own bright glint). Hero-measured, like the plate clank.
          if (sig.lockrings) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const rings = el('div', { cls: 'fx-lockrings', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-lockrings-ring fx-lockrings-ring-inner' }),
                el('span', { cls: 'fx-lockrings-ring fx-lockrings-ring-outer' }),
                el('span', { cls: 'fx-lockrings-glint' }),
                el('span', { cls: 'fx-lockrings-glint fx-lockrings-glint-2' }));
              rings.style.left = `${Math.round(r.left + r.width * 0.5 - 95)}px`;
              rings.style.top = `${Math.round(r.top + r.height * 0.4 - 95)}px`;
              fxAdd(rings, animMs(840) || 840);
            }, animMs(Math.round(sigMs * 0.4)) || 1);
          }
          // Flame Ward: a vertical CURTAIN of flame rises in front of the hero — three
          // licks of fire climb together off a low ember base, bright at the core.
          if (sig.flamecurtain) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const curtain = el('div', { cls: 'fx-flamecurtain', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-flamecurtain-base' }),
                el('span', { cls: 'fx-flamecurtain-lick' }),
                el('span', { cls: 'fx-flamecurtain-lick fx-flamecurtain-lick-2' }),
                el('span', { cls: 'fx-flamecurtain-lick fx-flamecurtain-lick-3' }));
              curtain.style.left = `${Math.round(r.left + r.width * 0.26)}px`;
              curtain.style.top = `${Math.round(r.top + r.height * 0.02)}px`;
              fxAdd(curtain, animMs(880) || 880);
            }, animMs(Math.round(sigMs * 0.34)) || 1);
          }
          // Cinder Shroud: a cocoon of ash swirls UP AROUND the hero — two grey orbits
          // spin opposite ways and three motes ride them, then the whole shroud
          // SETTLES down onto the figure as a shell.
          if (sig.ashswirl) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const shroud = el('div', { cls: 'fx-ashswirl', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-ashswirl-orbit' }),
                el('span', { cls: 'fx-ashswirl-orbit fx-ashswirl-orbit-2' }),
                el('span', { cls: 'fx-ashswirl-mote' }),
                el('span', { cls: 'fx-ashswirl-mote fx-ashswirl-mote-2' }),
                el('span', { cls: 'fx-ashswirl-mote fx-ashswirl-mote-3' }),
                el('span', { cls: 'fx-ashswirl-shell' }));
              shroud.style.left = `${Math.round(r.left + r.width * 0.5 - 80)}px`;
              shroud.style.top = `${Math.round(r.top + r.height * 0.02)}px`;
              fxAdd(shroud, animMs(920) || 920);
            }, animMs(Math.round(sigMs * 0.26)) || 1);
          }
          // ==== LOTE 7 — poderes uncommon: each uncommon power makes its own mark. ====
          // Stoke: a COLUMN of embers drafts UP over the hero's furnace — the breast is
          // the furnace and this is it being fed. A soft glow breathes at the chest and
          // the embers rise through it: round motes in a tight vertical draft, never
          // flame licks (that is the curtain's silhouette) and never one lone pulse.
          if (sig.stokedraft) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const draft = el('div', { cls: 'fx-stokedraft', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-stokedraft-breathe' }),
                el('span', { cls: 'fx-stokedraft-mote' }),
                el('span', { cls: 'fx-stokedraft-mote fx-stokedraft-mote-2' }),
                el('span', { cls: 'fx-stokedraft-mote fx-stokedraft-mote-3' }),
                el('span', { cls: 'fx-stokedraft-mote fx-stokedraft-mote-4' }),
                el('span', { cls: 'fx-stokedraft-mote fx-stokedraft-mote-5' }));
              draft.style.left = `${Math.round(r.left + r.width * 0.5 - 34)}px`;
              draft.style.top = `${Math.max(6, Math.round(r.top - 64))}px`;
              fxAdd(draft, animMs(860) || 860);
            }, animMs(Math.round(sigMs * 0.3)) || 1);
          }
          // Scale Up: WAVES of metallic scales climb the body BOTTOM-TO-TOP — three
          // ribbed plate bands rise one after another (feet, torso, shoulders) and one
          // cold sheen sweeps up the whole figure. Hero-measured, full-body height.
          if (sig.scaleripple) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const ripple = el('div', { cls: 'fx-scaleripple', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-scaleripple-band' }),
                el('span', { cls: 'fx-scaleripple-band fx-scaleripple-band-2' }),
                el('span', { cls: 'fx-scaleripple-band fx-scaleripple-band-3' }),
                el('span', { cls: 'fx-scaleripple-sheen' }));
              ripple.style.left = `${Math.round(r.left + r.width * 0.5 - 58)}px`;
              ripple.style.top = `${Math.round(r.top - 4)}px`;
              fxAdd(ripple, animMs(960) || 960);
            }, animMs(Math.round(sigMs * 0.22)) || 1);
          }
          // Banked Coal: the hand tips — coals fall THROUGH the enemy row and pile
          // GLOWING on the ground under it (row-measured, like the heat wash's span):
          // a dark mound rises, each coal bounces off it, and the ground heat blooms.
          if (sig.bankedglow) {
            fire(() => {
              const cards = stageEl && stageEl.querySelectorAll
                ? [...stageEl.querySelectorAll('.enemy[data-target-index]')] : [];
              const coals = el('div', { cls: 'fx-bankedglow', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-bankedglow-mound' }),
                el('span', { cls: 'fx-bankedglow-coal' }),
                el('span', { cls: 'fx-bankedglow-coal fx-bankedglow-coal-2' }),
                el('span', { cls: 'fx-bankedglow-coal fx-bankedglow-coal-3' }),
                el('span', { cls: 'fx-bankedglow-coal fx-bankedglow-coal-4' }),
                el('span', { cls: 'fx-bankedglow-heat' }));
              if (cards.length > 0) {
                let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
                for (const c of cards) {
                  const r = c.getBoundingClientRect();
                  if (r.width === 0 && r.height === 0) continue;
                  left = Math.min(left, r.left); top = Math.min(top, r.top);
                  right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
                }
                if (right > left) {
                  coals.style.left = `${Math.round(left - 40)}px`;
                  coals.style.top = `${Math.round(top - 56)}px`;
                  coals.style.setProperty('--glow-w', `${Math.round(right - left + 80)}px`);
                  coals.style.setProperty('--glow-h', `${Math.round(bottom - top + 96)}px`);
                }
              }
              fxAdd(coals, animMs(1400) || 1400);
            }, animMs(Math.round(sigMs * 0.36)) || 1);
          }
          // Ash Embrace: TENDRILS of ash rise from behind and WRAP the hero — four soft
          // grey curls that grow up the sides and lean INWARD (the embrace), with two
          // motes drifting up alongside. Curled strands, hero-measured: never the
          // circular orbits of the shroud, never the hard plates of the crust.
          if (sig.ashtendrils) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const arms = el('div', { cls: 'fx-ashtendrils', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-ashtendrils-tendril' }),
                el('span', { cls: 'fx-ashtendrils-tendril fx-ashtendrils-tendril-2' }),
                el('span', { cls: 'fx-ashtendrils-tendril fx-ashtendrils-tendril-3' }),
                el('span', { cls: 'fx-ashtendrils-tendril fx-ashtendrils-tendril-4' }),
                el('span', { cls: 'fx-ashtendrils-mote' }),
                el('span', { cls: 'fx-ashtendrils-mote fx-ashtendrils-mote-2' }));
              arms.style.left = `${Math.round(r.left + r.width * 0.5 - 76)}px`;
              arms.style.top = `${Math.round(r.top - 6)}px`;
              fxAdd(arms, animMs(940) || 940);
            }, animMs(Math.round(sigMs * 0.26)) || 1);
          }
          // Cinder Skin: a CRUST of cinder hardens OVER the skin — four soot plates set
          // in sequence from the feet to the shoulders (each carrying a hairline ember
          // crack), and a chest rim flares once when the shell completes. Hero-measured.
          if (sig.cindercrust) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const crust = el('div', { cls: 'fx-cindercrust', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-cindercrust-plate' }),
                el('span', { cls: 'fx-cindercrust-plate fx-cindercrust-plate-2' }),
                el('span', { cls: 'fx-cindercrust-plate fx-cindercrust-plate-3' }),
                el('span', { cls: 'fx-cindercrust-plate fx-cindercrust-plate-4' }),
                el('span', { cls: 'fx-cindercrust-rim' }));
              crust.style.left = `${Math.round(r.left + r.width * 0.5 - 54)}px`;
              crust.style.top = `${Math.round(r.top - 4)}px`;
              fxAdd(crust, animMs(1380) || 1380);
            }, animMs(Math.round(sigMs * 0.2)) || 1);
          }
          // ==== LOTE 8 — cartas raras: each rare card makes its own mark. ====
          // Unbroken: FOUR steel plates stack onto the hero ONE BY ONE — each drops
          // from above onto the pile (its own staggered beat), then a white seal closes
          // the set. Hero-measured (self-target), like the quench veil; a BUILD, never
          // the single plate's clank and never the soot crust's patches.
          if (sig.platestack) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const stack = el('div', { cls: 'fx-platestack', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-platestack-plate' }),
                el('span', { cls: 'fx-platestack-plate fx-platestack-plate-2' }),
                el('span', { cls: 'fx-platestack-plate fx-platestack-plate-3' }),
                el('span', { cls: 'fx-platestack-plate fx-platestack-plate-4' }),
                el('span', { cls: 'fx-platestack-seal' }),
                el('span', { cls: 'fx-platestack-seal fx-platestack-seal-2' }));
              stack.style.left = `${Math.round(r.left + r.width * 0.5 - 44)}px`;
              stack.style.top = `${Math.round(r.top - 34)}px`;
              fxAdd(stack, animMs(1240) || 1240);
            }, animMs(Math.round(sigMs * 0.2)) || 1);
          }
          // Overtemper: the forge heart BLOOMS at the chest — a white-gold core flares
          // and FIVE petals open outward around it, lifting away as they fade. A
          // flowering with NO ring: the shockwave's expanding circle is Maul's mark,
          // never this one's. Hero-measured at the chest, like the chest pulse.
          if (sig.heartbloom) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const bloom = el('div', { cls: 'fx-heartbloom', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-heartbloom-core' }),
                el('span', { cls: 'fx-heartbloom-petal' }),
                el('span', { cls: 'fx-heartbloom-petal fx-heartbloom-petal-2' }),
                el('span', { cls: 'fx-heartbloom-petal fx-heartbloom-petal-3' }),
                el('span', { cls: 'fx-heartbloom-petal fx-heartbloom-petal-4' }),
                el('span', { cls: 'fx-heartbloom-petal fx-heartbloom-petal-5' }));
              bloom.style.left = `${Math.round(r.left + r.width * 0.5 - 48)}px`;
              bloom.style.top = `${Math.round(r.top + r.height * 0.16)}px`;
              fxAdd(bloom, animMs(980) || 980);
            }, animMs(Math.round(sigMs * 0.3)) || 1);
          }
          // Blood Tithe: the payment rises OFF — three crimson motes climb from the
          // hero's chest — while the tithe's return DESCENDS — three ghost cards fall
          // from above toward the hero. An up-and-down crosscurrent, hero-measured at
          // both ends; kneeling motes and falling cards, never the ember draft's
          // single column (stoke owns that) and never the card fan's handward flow.
          if (sig.tithe) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const anima = el('div', { cls: 'fx-tithe', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-tithe-mote' }),
                el('span', { cls: 'fx-tithe-mote fx-tithe-mote-2' }),
                el('span', { cls: 'fx-tithe-mote fx-tithe-mote-3' }),
                el('span', { cls: 'fx-tithe-card' }),
                el('span', { cls: 'fx-tithe-card fx-tithe-card-2' }),
                el('span', { cls: 'fx-tithe-card fx-tithe-card-3' }));
              anima.style.left = `${Math.round(r.left + r.width * 0.5 - 62)}px`;
              anima.style.top = `${Math.round(r.top - 58)}px`;
              fxAdd(anima, animMs(1150) || 1150);
            }, animMs(Math.round(sigMs * 0.3)) || 1);
          }
          // Split Seam: ONE hairline seam of heat splits open on the hero's OWN front —
          // not on the enemy (the rend's fire blades own the target lane): a
          // crimson-gold line at chest height that opens from its middle, seeps a few
          // flecks, and seals itself shut. Hero-measured, like the vein tap's cut.
          if (sig.selfseam) {
            fire(() => {
              const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
              if (!hero) return;
              const r = hero.getBoundingClientRect();
              const seam = el('div', { cls: 'fx-selfseam', attrs: { 'aria-hidden': 'true' } },
                el('span', { cls: 'fx-selfseam-line' }),
                el('span', { cls: 'fx-selfseam-fleck' }),
                el('span', { cls: 'fx-selfseam-fleck fx-selfseam-fleck-2' }),
                el('span', { cls: 'fx-selfseam-fleck fx-selfseam-fleck-3' }));
              seam.style.left = `${Math.round(r.left + r.width * 0.5 - 14)}px`;
              seam.style.top = `${Math.round(r.top + r.height * 0.14)}px`;
              fxAdd(seam, animMs(760) || 760);
            }, animMs(Math.round(sigMs * 0.45)) || 1);
          }
        }
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
  // then let the damage and block numbers rise. Uses the SAME action generation captured
  // above, so it coexists with the signature timers instead of retiring them. Speed 0
  // and reduced motion never wait.
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
  // A GUARD that actually gained block raises the glowing armor dome: the barrier is
  // the card's promise made visible, and it flashes at the same beat the number rises.
  // `heroMove` takes the BURST, not an array — an array has no `.id` and resolves null.
  const fly = bursts.find((b) => b.kind === 'card-fly');
  if (fly && heroMove(fly) === 'guard' &&
      bursts.some((b) => b.kind === 'hero-float' && b.tone === 'block' && b.amount > 0)) {
    box.append(el('span', { cls: 'fx-armor-dome', attrs: { 'aria-hidden': 'true' } }));
  }
  // A CHANNEL move throws embers up around the hero while the power lands.
  if (fly && heroMove(fly) === 'channel') {
    box.append(el('span', { cls: 'fx-channel-embers', attrs: { 'aria-hidden': 'true' } },
      el('i', {}), el('i', {}), el('i', {}), el('i', {}), el('i', {})));
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
/**
 * How long a dying enemy must HOLD its slot before collapsing: when the killing stroke
 * is a thrown weapon, the hammer must be seen ARRIVING before the foe shatters, so the
 * ghost waits for the impact beat (`fill: both` keeps the 0% frame — standing — until
 * the delay ends). Only the AIMED foe waits; a splash death collapses on its own beat.
 */
function deathHoldMs(d) {
  if (reducedMotion) return 0;
  const fly = bursts.find((b) => b.kind === 'card-fly');
  if (!fly || d.enemy !== fly.enemy) return 0;
  const spec = HERO_THROWS[fly.id];
  if (spec) return animMs(Math.round((spec.ms ?? THROW_MS) * (spec.hitAt ?? 0.84)));
  if (signatureFor(fly)?.twin) return animMs(Math.round(THROW_MS * 0.84));
  return 0;
}

/** The collapsing card for one just-dead enemy. `data-death-index` is its slot in the
 *  row it died in — a kill re-indexes the survivors, so the fx layer needs a stable
 *  handle on the body the blow is still flying toward. */
function dyingCard(d) {
  // A boss says so: its collapse is the biggest single event in the run, and the word is
  // what makes the difference readable with no motion at all (the row is also the only
  // place the boss's name is still on screen, its card having left the snapshot).
  const label = d.boss ? 'BOSS DOWN' : 'DOWN';
  // No lane class here: the ghost sits in the flex row at its own slot, and the fx layer
  // aims by `data-death-index`, not by side (a `side-${d.side}` prefix produced the
  // meaningless `side-side-0` anyway).
  const ghost = el('div', {
    cls: `enemy is-dying ash` + (d.boss ? ' boss-down' : ''),
    attrs: { 'data-death-index': String(d.enemy) },
  });
  const holdMs = deathHoldMs(d);
  if (holdMs > 0) ghost.style.animationDelay = `${holdMs}ms`;
  const fig = el('div', { cls: 'fig pose-hurt', attrs: { 'aria-hidden': 'true' } });
  fig.innerHTML = enemyMarkup(d.id);
  ghost.append(fig);
  ghost.append(el('div', { cls: 'ename', text: d.name }));
  ghost.append(el('div', { cls: 'ehp', text: label }));
  return ghost;
}

function dyingRow(dying, row = el('div', { cls: 'enemies' })) {
  for (const d of dying) row.append(dyingCard(d));
  return row;
}

/**
 * Per-card hero movement. The pose is chosen by WHICH card was played, not only by its
 * type: a maul lands differently from a jab, and raising a barrier plants the hero where
 * channelling ember-lift raises them. Ids must match `src/kernel/content/cards.json`; a
 * card missing from the table (or an id-less burst) falls back to the old type-based
 * pose, so unknown or future content still animates.
 */
const HERO_MOVES = {
  // Attacks — how the blow lands. (strike and anger left this row for their own
  // signature poses below: Hammerfall drops, Spark snaps.)
  headbutt: 'strike', pommel: 'strike', dropkick: 'strike', ironwave: 'strike', rampage: 'strike',
  bash: 'heavy', clothesline: 'heavy', wild_strike: 'heavy',
  // LOTE 1 — the starter deck and the basic attacks, each with its own movement:
  // Hammerfall (strike): the hammer rises, PAUSES at the apex, and drops straight down —
  // a dust cloud and a small crack open in the lane it lands on.
  strike: 'hammerfall',
  // Quench (defend): a pouring gesture — no dome, a veil of blue-white steam climbs the hero.
  defend: 'quench',
  // Bellows Gust (gust): a two-armed PUSH — a cone of wind sweeps the whole row back.
  gust: 'bellowspush',
  // Spark (anger): a finger-snap cast — an ember dart flies out, a mote returns to the deck.
  anger: 'snapcast',
  // Fan the Flames (fan_flames): the furnace is fanned — three flame tongues and a spark to the orb.
  fan_flames: 'fanflames',
  // Per-card signature moves (one commit per card): bludgeon — Maul, "One stroke. The
  // argument ends." — is the 32-damage rare: its own COLOSSAL pose, not shared heavy.
  bludgeon: 'colossal',
  // Twin Hammers: the card is the name — TWO hammers, two hits (5×2). Its own throw
  // pose with a salvo of two projectiles and two impacts.
  twin_strike: 'twinthrow',
  // Sunder (carnage, 20 dmg): a RENDING vertical stroke — the hammer cleaves straight
  // down and the air itself splits with a burning seam over the target.
  carnage: 'rend',
  // Rising Blow (uppercut): the name is an uppercut — the hammer swings UP and the
  // target is LIFTED off its stance by the impact.
  uppercut: 'uppercut',
  // Per-card signature moves (one commit per card): bludgeon — Maul, "One stroke. The
  // argument ends." — is the 32-damage rare: its own COLOSSAL pose, not shared heavy.
  bludgeon: 'colossal',
  pummel: 'flurry',
  cleave: 'sweep', thunderclap: 'sweep', reaper: 'sweep',
  // THROW cards: the flavor text says the weapon flies and (for the Brand) comes back,
  // so the move is a real throw — the hero winds up, a spinning hammer flies to the
  // target and bursts. `HERO_THROWS` below holds the per-card choreography knobs.
  sword_boomerang: 'throw', hemokinesis: 'throw',
  // Skills and powers — how the hero plants or draws power.
  // HP-cost cards (bloodletting, offering) read as their movement only when
  // no HP was actually lost; the hurt flinch outranks the card flourish (see heroPose).
  // (defend left this row for its own quench pose above; fan_flames left channel below.)
  shrug: 'guard', true_grit: 'guard', armaments: 'guard',
  entrench: 'guard', flame_barrier: 'guard', ghostly_armor: 'guard', impervious: 'guard',
  flex: 'channel', warcry: 'channel', havoc: 'channel', battle_trance: 'channel',
  bloodletting: 'channel', offering: 'channel', limit_break: 'channel', shockwave: 'channel',
  combust: 'channel', dark_embrace: 'channel', feel_no_pain: 'channel',
  inflame: 'channel', metallicize: 'channel', rupture: 'channel',
  // LOTE 2 — ataques comunes I: each common attack reads as its own stroke.
  // Arc Cut (cleave): ONE wide horizontal swing that crosses the whole row.
  cleave: 'arccut',
  // Collar Check (clothesline): a lateral arm-bar driven at neck height.
  clothesline: 'collarline',
  // Brow Strike (headbutt): a headfirst drive that bounces off in recoil.
  headbutt: 'headbutt',
  // Slag Surge (ironwave): a heavy grounded roll that shoves a molten wave.
  ironwave: 'surge',
  // Haft Jab (pommel): a quick backhand jab with the hammer's pommel.
  pommel: 'haftjab',
  // LOTE 3 — ataques comunes II: each common attack draws its own stroke.
  // Forgeclap (thunderclap): BOTH hammers rise and clash OVERHEAD — a clap, not a swing.
  thunderclap: 'forgeclap',
  // Untempered (wild_strike): a double untempered flail — off balance, no form, no temple.
  wild_strike: 'wildflail',
  // Bellows (flex): the chest swells like the forge bellows — a flex, not a channel.
  flex: 'bellowsflex',
  // Heel Drop (dropkick): a feet-first airborne launch that lands heels-down.
  dropkick: 'dropkick',
  // Blood Hammer (hemokinesis): the hammer condenses from the hero's chest, THEN flies
  // (the flight itself stays the throw choreography — see HERO_THROWS.delayMs below).
  hemokinesis: 'bloodhammer',
  // LOTE 4 — skills comunes: each common skill moves its own way.
  // Cast Aside (shrug): a dismissive SHRUG — shoulders lift, the blow slides off, and a
  // spare plate sails over the back of the shoulder (fx-platefly below).
  shrug: 'castaside',
  // True Temper (true_grit): a ROOTED tempering hold — the hammer raised steady in the
  // heat while it hisses, no lunge, no swing (fx-temperhiss below).
  true_grit: 'truetemper',
  // Fit the Plate (armaments): the body squares up and LOCKS as the plate sets on the
  // shoulder — a settle, never a swing (fx-plateclank below).
  armaments: 'fitplate',
  // Kiln Cry (warcry): an inhale swell, then a forward SHOUT rock — the cry made visible
  // (fx-crycone below).
  warcry: 'kilncry',
  // Vent (havoc): a twist and recoil as pressure vents from the BACK — no arm swing at
  // all (fx-ventjets below).
  havoc: 'vent',
  // LOTE 5 — ataques uncommon: each uncommon card reads as its own stroke.
  // Heat Trance (battle_trance): arms cross and open — three GHOST CARDS fan out
  // glowing and flow into the hand (fx-cardfan below).
  battle_trance: 'heattrance',
  // Hail of Blows (pummel): a BURST of four alternate blows — four small staggered
  // flashes, deliberately nothing like Twin Hammers' two-hammer salvo (fx-hailticks).
  pummel: 'hailblows',
  // Climbing Heat (rampage): a DIAGONAL UPWARD slash — ember rungs climb the lane like
  // a ladder of heat under the rising stroke (fx-heatladder).
  rampage: 'climbcut',
  // Vein Tap (bloodletting): taps a vein on the forearm — ember drops fall and bead
  // into one glowing bead of energy (fx-veindrip; the hurt flinch still outranks this
  // movement whenever HP was actually lost, see heroPose).
  bloodletting: 'veintap',
  // Ash Harvest (reaper): a scythe of ash sweeps the ENTIRE row — ash motes drain from
  // the enemies back toward the hero (fx-ashscythe).
  reaper: 'reapsweep',
  // LOTE 6 — skills uncommon: each uncommon skill moves its own way.
  // Heat Wash (shockwave): a LOW ARM SWEEP — the hero drags a thermal wave across the
  // whole row, left to right, and the row wilts under it (fx-heatwash).
  shockwave: 'heatwash',
  // Brace (entrench): the stance SINKS into the ground and locks — a settle, never a
  // swing; the rings of plate lock over it (fx-lockrings).
  entrench: 'bracelock',
  // Flame Ward (flame_barrier): the hero raises a hand and a CURTAIN of flame climbs
  // in front of them (fx-flamecurtain).
  flame_barrier: 'flameward',
  // Cinder Shroud (ghostly_armor): the hero turns in place while a cocoon of cinders
  // swirls UP AROUND them and settles as a shell (fx-ashswirl).
  ghostly_armor: 'cindershroud',
  // LOTE 7 — poderes uncommon: each uncommon power moves its own way.
  // Stoke (inflame): a bellows PULL — the chest draws in and swells as the furnace of
  // the breast is fed (fx-stokedraft below).
  inflame: 'stoke',
  // Scale Up (metallicize): a slow STRAIGHTEN — the body stands taller as the plate
  // waves climb it, no swing, no step (fx-scaleripple below).
  metallicize: 'scaleup',
  // Banked Coal (combust): a hand TIPS out over the row and drops its coals — they fall
  // and pile glowing under the enemies (fx-bankedglow below).
  combust: 'bankcoal',
  // Ash Embrace (dark_embrace): the hero hunches and draws IN as the ash tendrils
  // arrive from behind and wrap them (fx-ashtendrils below).
  dark_embrace: 'ashembrace',
  // Cinder Skin (feel_no_pain): the hero STIFFENS in place — a rigid hardening while
  // the crust sets, the stillest movement in the deck (fx-cindercrust below).
  feel_no_pain: 'cinderskin',
  // ==== LOTE 8 — cartas raras: each rare card moves its own way. ====
  // Unbroken (impervious): the body SQUARES UP and LOCKS as the plates stack onto it —
  // four small compressive beats, then a rigid clench (fx-platestack below).
  impervious: 'lockdown',
  // Overtemper (limit_break): the chest ARCHES BACK and UP as the forge heart
  // overpressures — an overshoot with a shudder at its peak (fx-heartbloom below).
  limit_break: 'overtemper',
  // Blood Tithe (offering): the hero DROPS TO ONE KNEE — the payment made deliberate,
  // a kneel, not a flinch (fx-tithe below; plays when no HP was actually lost, the
  // kernel's loseHp floor makes a 1-HP tithe free — see heroPose).
  offering: 'tithe',
  // Split Seam (rupture): a sharp TWIST as the seam splits open on the hero's OWN
  // front — a wrench of recoil, no swing at all (fx-selfseam below).
  rupture: 'splitseam',
};
// Type fallback for cards with no row above, kept identical to the pre-move behaviour.
const MOVE_DEFAULTS = { attack: 'strike', skill: 'brace', power: 'brace' };
/**
 * Throw choreography per card id, keyed off what each card's own text says:
 * sword_boomerang — Returning Brand, "Heat you threw comes back": the hammer flies AND
 * returns; hemokinesis — Blood Hammer, the hammer first CONDENSES at the hero's chest
 * (the bloodcondense fx, below) and only then is hurled, staying in the target.
 */
const HERO_THROWS = {
  // Returning Brand: the hammer comes BACK — the CSS round trip is 1.25s, and the lane
  // moment (where the impact flash belongs) is the outward apex, not the 84% landing of
  // a one-way throw. A plain throw's CSS flight is 0.9s, landing at 84%.
  sword_boomerang: { returns: true, ms: 1250, hitAt: 0.55 },
  // Blood Hammer: the clot closes over ~320ms before the flight is released, and the
  // flying hammer wears the ember-BLOOD tint (fx-hammer-blood) instead of forge iron.
  hemokinesis: { returns: false, ms: 900, hitAt: 0.84, delayMs: 320, blood: true },
};
/** Total wall-clock of a ONE-WAY hammer flight, in ms at 1x (the twin salvo rides this). */
const THROW_MS = 900;
/** Per-card signature moves: extra knobs keyed by card id (pose handled via HERO_MOVES). */
const HERO_SIGNATURES = {
  // Maul: longer windup, screen shake and an ember shockwave on impact.
  bludgeon: { poseMs: 1150, shake: true, shockwave: true },
  // Anvil Blow: "The anvil answers louder than the hammer." A spectral anvil drops
  // from above onto the target the moment the hammer lands.
  bash: { anvil: true },
  // Twin Hammers: two hammers in the air, staggered, with two impact flashes.
  twin_strike: { twin: true },
  // Sunder: the rending seam flashes down the target lane as the stroke lands.
  carnage: { rend: true },
  // Rising Blow: the aimed enemy is launched upward at the impact beat.
  uppercut: { launch: true },
  // LOTE 1 — the starter deck and the basic attacks:
  // Hammerfall: the drop cracks the lane — dust puffs and a small crack open under the target.
  strike: { dustcrack: true },
  // Quench: a steam veil climbs the HERO — a veil, never a dome.
  defend: { quenchveil: true },
  // Bellows Gust: a wind cone sweeps the WHOLE enemy row, and the row leans back under it.
  gust: { gustcone: true },
  // Spark: an ember dart flies out to the target; a mote returns toward the draw pile.
  anger: { sparkdart: true },
  // Fan the Flames: three flame tongues fan out by the hero; one spark flies to the energy orb.
  fan_flames: { flarefan: true },
  // LOTE 2 — ataques comunes I:
  // Arc Cut: a single luminous arc sweeps the WHOLE enemy row, side to side.
  cleave: { arcspan: true },
  // Collar Check: a taut line flashes over the lane at neck height; weak marks sag in.
  clothesline: { collarline: true },
  // Brow Strike: an impact star bursts at the contact point of the headfirst drive.
  headbutt: { impactstar: true },
  // Slag Surge: a molten plate glows on the hero while slag rolls along the ground.
  ironwave: { slagwave: true },
  // Haft Jab: the pommel lands, and a card is PULLED from the enemy toward the hand.
  pommel: { jabpull: true },
  // LOTE 3 — ataques comunes II:
  // Forgeclap: two hammers MEET overhead; the clash rolls a shock ring and vulnerable
  // cracks across the WHOLE row (the card hits every enemy).
  thunderclap: { forgering: true },
  // Untempered: white-hot cracks flare around the aimed lane on both wild beats.
  wild_strike: { wildcracks: true },
  // Bellows: ONE ember pulse blooms at the hero's chest — a pulse, never a column.
  flex: { chestpulse: true },
  // Heel Drop: embers burst where the heels land; a spark rides into the energy orb.
  dropkick: { heelburst: true },
  // Blood Hammer: the ember-blood clot condenses at the chest before the throw leaves.
  hemokinesis: { bloodcondense: true },
  // LOTE 4 — skills comunes:
  // Cast Aside: a spare plate sails OVER the shoulder (behind the hero) and the drawn
  // card slides into the hand.
  shrug: { platefly: true },
  // True Temper: steam hisses OFF the hero's raised hammer while the temper line flares.
  true_grit: { temperhiss: true },
  // Fit the Plate: a shoulder plate drops, locks with a clank ring, and rivets spark.
  armaments: { plateclank: true },
  // Kiln Cry: hot air cones from the mouth; the discarded card catches fire in the air.
  warcry: { crycone: true },
  // Vent: steam jets blast from the hero's BACK; the energy orb flares in the HUD.
  havoc: { ventjets: true },
  // LOTE 5 — ataques uncommon:
  // Heat Trance: three ghost cards fan open glowing by the chest and flow into the hand.
  battle_trance: { cardfan: true },
  // Hail of Blows: four SMALL flashes land in alternation along the lane, staggered —
  // a hail, never the twin salvo, never the hammer-hit flash.
  pummel: { hailticks: true },
  // Climbing Heat: ember rungs light up the lane bottom-to-top under the rising slash.
  rampage: { heatladder: true },
  // Vein Tap: ember drops fall from the hero's tapped forearm and bead into one glint.
  bloodletting: { veindrip: true },
  // Ash Harvest: a scythe of ash sweeps the WHOLE row and ash motes drain to the hero.
  reaper: { ashscythe: true },
  // LOTE 6 — skills uncommon:
  // Heat Wash: the low sweep drags a THERMAL WAVE across the whole row, left to right
  // (sized to the row's measured span, like the ash scythe) — each enemy wilts as it passes.
  shockwave: { heatwashwave: true },
  // Brace: the sink locks the stance — TWO concentric rings of plates fit together
  // around the hero with a double clank (inner first, outer a beat later).
  entrench: { lockrings: true },
  // Flame Ward: a vertical CURTAIN of flame rises in front of the hero.
  flame_barrier: { flamecurtain: true },
  // Cinder Shroud: a cocoon of ash swirls UP AROUND the hero and settles as a shell.
  ghostly_armor: { ashswirl: true },
  // LOTE 7 — poderes uncommon:
  // Stoke: a COLUMN of embers drafts up over the hero's furnace while the chest swells.
  inflame: { stokedraft: true },
  // Scale Up: WAVES of metallic scales climb the body bottom-to-top.
  metallicize: { scaleripple: true },
  // Banked Coal: coals fall THROUGH the enemy row and pile GLOWING under it.
  combust: { bankedglow: true },
  // Ash Embrace: tendrils of ash rise from behind and WRAP the hero.
  dark_embrace: { ashtendrils: true },
  // Cinder Skin: a crust of cinder hardens progressively OVER the hero's skin.
  feel_no_pain: { cindercrust: true },
  // ==== LOTE 8 — cartas raras: each rare card makes its own mark. ====
  // Unbroken: FOUR steel plates stack onto the hero ONE BY ONE (top-down drops) and a
  // white seal closes the set — a build, never the single plate's clank.
  impervious: { platestack: true },
  // Overtemper: the forge heart BLOOMS — white-gold petals open outward from the chest
  // and lift away, a flowering that carries NO expanding ring (that is the shockwave's
  // silhouette, never this).
  limit_break: { heartbloom: true },
  // Blood Tithe: crimson HP motes ASCEND from the chest while THREE ghost cards
  // DESCEND toward the hero — the payment rising off, the tithe's draw falling in.
  offering: { tithe: true },
  // Split Seam: ONE hairline seam of heat splits open on the hero's OWN front
  // (hero-measured) — crimson-gold, seeping flecks, then it seals itself.
  rupture: { selfseam: true },
};
/** The signature knobs for a card-fly burst, or null. */
function signatureFor(fly) {
  return fly && fly.id ? HERO_SIGNATURES[fly.id] || null : null;
}

function heroMove(fly) {
  if (!fly) return null;
  // `hasOwn`, not a bare index: card ids come from frozen content today, but a bare
  // `HERO_MOVES[fly.id]` walks the prototype chain, so an id like "constructor" would
  // resolve to a function and emit a garbage pose class.
  const named = fly.id && Object.hasOwn(HERO_MOVES, fly.id) ? HERO_MOVES[fly.id] : null;
  if (named) return named;
  return MOVE_DEFAULTS[fly.type] || null;
}

function heroPose() {
  // Precedence: getting hit outranks the card's own movement — a hero who just lost HP
  // flinches, even while playing an attack (and HP-cost cards like bloodletting always
  // read as hurt, never as their HERO_MOVES entry).
  if (bursts.some((b) => b.kind === 'hero-float' && b.tone === 'dmg')) {
    heroMoveHold = null;
    return 'hurt';
  }
  // A fresh card play wins over any hold still running from the previous card.
  const move = heroMove(bursts.find((b) => b.kind === 'card-fly'));
  if (move) {
    // Reduced motion and speed 0 skip the animation; do not hold a pose that never plays.
    // The hold length is the CSS animation's own duration (the keyframes do not scale
    // with the JS speed setting), so the pose is never dropped mid-swing on a repaint.
    // A per-card SIGNATURE (HERO_SIGNATURES) may override the pose's base duration.
    const sig = move ? signatureFor(bursts.find((b) => b.kind === 'card-fly')) : null;
    const base = (sig && sig.poseMs) || HERO_POSE_MS[move] || 400;
    if (reducedMotion || animSpeed === 0) heroMoveHold = null;
    else heroMoveHold = { pose: move, start: Date.now(), dur: base };
    return move;
  }
  // An incidental repaint (hover, aim) during the hold repaints the SAME pose rather
  // than dropping it: the movement plays out in full exactly once. The window includes
  // the hit-stop beat, which pauses the animation without pausing this clock.
  const held = heroMoveHold;
  if (held && Date.now() < held.start + held.dur + 260) return held.pose;
  if (held) heroMoveHold = null;
  const p = snap.player;
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  if (ratio <= 0.35) return 'low';
  return 'idle';
}

function heroFigure() {
  const p = snap.player;
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  const pose = heroPose();
  const isBellows = snap.character === 'bellows';
  const node = el('div', {
    cls: 'hero' + (ratio <= 0.35 ? ' is-low' : '') + (isBellows ? ' is-bellows' : ''),
    attrs: { role: 'group', 'aria-label': `${snap.characterName || 'Ashwright'}, ${p.hp} of ${p.maxHp} HP, block ${p.block}` },
  });
  const fig = el('div', { cls: `fig pose-${pose}`, attrs: { 'aria-hidden': 'true' } });
  // The stage tree is rebuilt on every paint, which would restart the keyframe from 0%
  // on each hover repaint during the hold. A negative animation-delay resumes the run
  // from where it should be, so the movement stays in phase across repaints.
  const held = heroMoveHold;
  if (held && held.pose === pose && pose !== 'idle') {
    const elapsed = Math.max(0, Date.now() - held.start);
    if (elapsed < held.dur) {
      // Mid-run: resume the keyframe where it should be, so hover repaints do not stutter.
      fig.style.animationDuration = `${held.dur}ms`;
      fig.style.animationDelay = `-${elapsed}ms`;
    } else {
      // Past the end (hit-stop grace): keep the pose class but stop the motion, so a
      // repaint can never replay the swing.
      fig.style.animation = 'none';
    }
  }
  fig.innerHTML = heroMarkup(snap.character);
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
  // The attack RUN: an enemy whose turn it was just acted — dash across and slam. The
  // burst fires exactly once (when the turn flipped), like the old strike, but the pose
  // reads as travel: anticipation, long dash, impact beat, return.
  if (bursts.some((b) => b.kind === 'enemy-strike' && b.enemy === e.index)) return 'slam';
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
    // `damage` is the intent's TOTAL (all hits); the badge reads per-hit × hits, as the label does.
    const n = e.intent.hits > 1 ? `${Math.round(e.intent.damage / e.intent.hits)}×${e.intent.hits}` : String(e.intent.damage ?? '');
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
  backdrop.innerHTML = backdropMarkup((BIOMES[snap.biome] ?? BIOMES[DEFAULT_BIOME]).backdrop);
  // Empty foundry floor fast-forwards the feel queue. Cards, enemies and buttons sit above it.
  backdrop.addEventListener('pointerdown', () => skipAnim());
  fight.append(backdrop);
  fight.append(el('div', { cls: 'ground', attrs: { 'aria-hidden': 'true' } }));
  fight.append(heroFigure());
  // The row paints the LINEUP the stroke was aimed at: a just-killed enemy keeps its slot
  // as a collapsing ghost and the survivors keep theirs, so the killing blow reads
  // against the target it was aimed at and no survivor slides into a dead foe's place
  // while the weapon is still in the air. (The row never reorders, so the stable kernel
  // index IS the old slot; death only removes — living slots and ghost slots together
  // are exactly 0..n-1.)
  const ghostAt = new Map(dyingThisPaint.map((d) => [d.enemy, d]));
  const slots = snap.enemies.length + dyingThisPaint.length;
  const row = el('div', { cls: 'enemies' });
  for (let slot = 0, live = 0; slot < slots; slot += 1) {
    if (ghostAt.has(slot)) row.append(dyingCard(ghostAt.get(slot)));
    else row.append(enemyCard(snap.enemies[live], live++));
  }
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
  const fig = el('div', { cls: `fig pose-${pose}${enemyVariant(e.id)}`, attrs: { 'aria-hidden': 'true' } });
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
  // (src/web/card-art.js), decorative and aria-hidden. The type mark + word stay on top, so
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
  // B2: a tempered instance wears a trim and a forged stamp (mark + temper name). The rules
  // text below already carries the tempered numbers (the kernel renders it), so the stamp
  // only says WHICH temper; its full sentence is the tooltip.
  // It sits in the footer bar beside the compact code (placed below); a tile without a
  // footer carries it on the plate instead.
  let stamp = null;
  if (card.temper) {
    tile.classList.add('tempered', `temper-${card.temper}`);
    stamp = el('span', { cls: 'ctemper', attrs: { title: card.temperText } },
      glyphBox(TEMPER_GLYPH[card.temper] || 'rune', 't-mark'),
      el('span', { cls: 't-name', text: card.temperName || card.temperText.split(':')[0] }),
    );
  }
  tile.append(el('span', { cls: 'cname', text: card.name }));
  if (card.flavor) tile.append(el('span', { cls: 'cflavor', text: card.flavor }));
  tile.append(keywordText(el('span', { cls: 'cdesc' }), desc));
  // The compact code is NOT repeated on a reward tile: the player is choosing a card to
  // keep, not playing one, so the shorthand is noise there.
  if (card.showSummary !== false) {
    const foot = el('span', { cls: 'cfoot' });
    foot.append(el('span', { cls: 'csum', text: card.summary, attrs: { title: 'Compact form used by the agent-facing command line' } }));
    if (disabled) foot.append(el('span', { cls: 'cwhy', text: 'needs more Energy' }));
    if (stamp) foot.append(stamp);
    tile.append(foot);
  } else if (stamp) {
    tile.append(stamp);
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
  if (snap.quests) wrap.append(questStrip(snap.quests));
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

/** B3 Ember quests: one compact chip per quest, progress as text and as a bar. */
function questStrip(quests) {
  const strip = el('div', { cls: 'quests', attrs: { 'aria-label': 'Ember quests' } });
  for (const q of quests) {
    const pct = Math.round((100 * q.progress) / q.goal);
    const chip = el('div', {
      cls: `quest${q.done ? ' done' : ''}`,
      attrs: { title: `${q.text} Reward: ${q.rewardText}.` },
    },
    el('span', { cls: 'q-name', text: q.name }),
    el('span', { cls: 'q-prog', text: q.done ? `done · ${q.rewardText}` : `${q.progress}/${q.goal} · ${q.rewardText}` }));
    const bar = el('span', { cls: 'q-bar' });
    bar.style.setProperty('--q', `${pct}%`);
    chip.append(bar);
    strip.append(chip);
  }
  return strip;
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

/* ------------------------------------------------------------------ KINDLING */

/** A hero portrait for the select buttons (constant markup from a fixed table). */
function heroFace(id) {
  const face = el('span', { cls: 'hp-face', attrs: { 'aria-hidden': 'true' } });
  face.innerHTML = heroMarkup(id);
  return face;
}

/**
 * B4: rebuild the run, same seed, for another hero. It is the SAME screen with a different
 * hero, not a new act: the Act I title card is not replayed. Focus follows the selection,
 * so the arrow keys keep working after the repaint.
 * @param {string} id hero id from HEROES
 */
function switchHero(id) {
  if (id === (snap.character ?? 'ironclad')) return;
  heroChoice = id;
  newGame(snap.seed, { quiet: true });
  const picked = document.querySelector('.hero-pick.on');
  if (picked && typeof picked.focus === 'function') picked.focus();
}

/**
 * B5: rebuild the run, same seed, on another path. Like a hero switch it is the SAME
 * screen, not a new act: the Act I title card is not replayed, and focus follows the
 * selection so the arrow keys keep working after the repaint.
 * @param {string} id biome id from the kernel BIOMES table
 */
function switchPath(id) {
  if (id === (snap.biome ?? DEFAULT_BIOME)) return;
  biomeChoice = id;
  newGame(snap.seed, { quiet: true });
  const picked = document.querySelector('.biome-pick.on');
  if (picked && typeof picked.focus === 'function') picked.focus();
}

/** B1: the act-start boon choice. Every word comes from the kernel snapshot. */
function kindlingView() {
  const wrap = el('div', { cls: 'kindling' });
  wrap.append(sceneIllus('event'));
  // B4 hero select: only before the first choice of a run. Switching rebuilds the run
  // with the same seed for the other hero, so nothing about the climb is rerolled by hand.
  if (snap.stepIndex === 0) {
    // Radio-group semantics (WAI-ARIA APG): one tab stop (the checked hero), and the arrow
    // keys move the selection, wrapping; Home/End jump to the ends. Selecting IS switching.
    const current = snap.character ?? 'ironclad';
    const at = Math.max(0, HEROES.findIndex((h) => h.id === current));
    const heroes = el('div', {
      cls: 'hero-select',
      attrs: { role: 'radiogroup', 'aria-label': 'Choose your hero' },
      on: {
        keydown: (ev) => {
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
          let to = null;
          if (step) to = (at + step + HEROES.length) % HEROES.length;
          else if (ev.key === 'Home') to = 0;
          else if (ev.key === 'End') to = HEROES.length - 1;
          if (to === null) return;
          ev.preventDefault();
          switchHero(HEROES[to].id);
        },
      },
    });
    for (const h of HEROES) {
      const on = current === h.id;
      heroes.append(el('button', {
        cls: `hero-pick${on ? ' on' : ''} hp-${h.id}`,
        attrs: { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', tabindex: on ? '0' : '-1', title: h.blurb },
        on: { click: () => switchHero(h.id) },
      },
      heroFace(h.id),
      el('span', { cls: 'hp-name', text: h.name }),
      el('span', { cls: 'hp-blurb', text: h.blurb })));
    }
    wrap.append(heroes);
    // Radio group like the hero picker (WAI-ARIA APG): one tab stop (the checked path),
    // arrow keys move the selection, wrapping; Home/End jump to the ends. Selecting IS switching.
    const biomes = snap.biomes ?? [];
    const curBiome = snap.biome ?? DEFAULT_BIOME;
    const atBiome = Math.max(0, biomes.findIndex((b) => b.id === curBiome));
    const paths = el('div', {
      cls: 'biome-select',
      attrs: { role: 'radiogroup', 'aria-label': 'Choose the path' },
      on: {
        keydown: (ev) => {
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
          let to = null;
          if (step) to = (atBiome + step + biomes.length) % biomes.length;
          else if (ev.key === 'Home') to = 0;
          else if (ev.key === 'End') to = biomes.length - 1;
          if (to === null || biomes.length === 0) return;
          ev.preventDefault();
          switchPath(biomes[to].id);
        },
      },
    });
    paths.append(el('span', { cls: 'bs-label', text: 'Path' }));
    for (const b of biomes) {
      const on = curBiome === b.id;
      paths.append(el('button', {
        cls: `biome-pick${on ? ' on' : ''} bp-${b.id}`, text: b.name,
        attrs: { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', tabindex: on ? '0' : '-1' },
        on: { click: () => switchPath(b.id) },
      }));
    }
    wrap.append(paths);
  }
  wrap.append(el('div', { cls: 'big-title kindling-head', text: 'The forge offers a kindling' }));
  wrap.append(el('p', { cls: 'kindling-note', text: 'Take one. Each gift has a price.' }));
  const list = el('div', { cls: 'boon-list' });
  for (const b of snap.kindling.boons) {
    list.append(el('button', {
      cls: 'boon', attrs: { type: 'button', 'data-action': b.actionId, 'aria-label': `${b.name}: ${b.text}` },
      on: { click: () => act(b.actionId) },
    },
    el('span', { cls: 'boon-name', text: b.name }),
    keywordText(el('span', { cls: 'boon-text' }), b.text)));
  }
  wrap.append(list);
  return page('kindling', '0 — The Kindling', 'flame', 'panel', [wrap]);
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
  // B2: or temper one card instead of healing. Offers and sentences come from the kernel.
  const tempers = snap.rest.tempers || [];
  if (tempers.length > 0) {
    wrap.classList.add('has-tempers');
    wrap.append(el('p', { cls: 'temper-head', text: 'Or temper a card at the forge (instead of resting):' }));
    const list = el('div', { cls: 'boon-list temper-list' });
    for (const t of tempers) {
      list.append(el('button', {
        cls: `boon temper-offer temper-${t.temper}`,
        attrs: { type: 'button', 'data-action': t.actionId, 'aria-label': `Temper ${t.cardName}. ${t.text}` },
        on: { click: () => act(t.actionId) },
      },
      el('span', { cls: 'boon-name', text: `${t.cardName} · ${t.temperName}` }),
      keywordText(el('span', { cls: 'boon-text' }), t.text.split(': ').slice(1).join(': '))));
    }
    wrap.append(list);
  }
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
    submitted: ctl.submitted,
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
