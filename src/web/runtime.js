// src/web/runtime.js — the app's environment handles, motion plumbing and shared state.
//
// This is the STATE GLUE of the browser surface: the DOM roots the views paint into
// (#hud/#stage/#toast/#live and the persistent #fx-layer), the animation-speed and timer
// plumbing every effect queues on, and every piece of mutable presentation state that more
// than one module writes. It owns no game rule: `ctl`/`snap` are the controller and the
// value model the kernel computes, held here so every module reads the SAME binding.
//
// WRITES GO THROUGH SETTERS. ES-module imports are live read-only views, so a module that
// needs to change shared state calls the setter exported next to it (`setSnap`,
// `setBursts`, ...). State written by exactly ONE module (targeting's `pendingSlot`, the
// run-history records, the help toggle) stays inside that module instead.
//
// The kernel entry this file's consumers read is src/kernel/index.js — the ONE public,
// browser-safe entry point (no `node:*`, no clock, no unseeded randomness, all enforced by
// scripts/check-architecture.mjs).

export const hudEl = document.getElementById('hud');
export const stageEl = document.getElementById('stage');
export const toastEl = document.getElementById('toast');
/**
 * The effect layer: a SIBLING of #stage that `render()` never clears, so an effect that
 * must outlive a repaint (a screen pulse, a turn wipe) survives one. It is absent from the
 * DOM in the narrow test harnesses, which build only #hud/#stage/#toast/#live/#app — hence
 * every use is null-guarded rather than assumed.
 */
export const fxEl = document.getElementById('fx-layer');
/**
 * True when the player has asked for reduced motion. Read once at load: it is a media
 * QUERY, not a state the page changes at runtime. Under it the renderer emits no
 * floating numbers, no screen pulses and no ghost death cards — every one of those facts
 * is still carried statically by the HP bar, the HP total and the block line, which is
 * what makes dropping them safe.
 */
export const reducedMotion = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)').matches
  : false;
/** Presentation speed. 1 and 2 scale the feel queue; 0 skips it. Never a rule. */
export const SPEED_KEY = 'ea.animSpeed';
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
export let animSpeed = readAnimSpeed();
/** Speed is the one piece of motion state the player changes at runtime (the speed dock). */
export function setAnimSpeed(n) { animSpeed = n; }
export let animGen = 0;
/** Advance the action generation; returns the NEW value, as `++animGen` would. */
export function bumpAnimGen() { animGen += 1; return animGen; }
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
export let heroMoveHold = null; // { pose, start, dur } — the pose to keep painting, and its window
export function setHeroMoveHold(hold) { heroMoveHold = hold; }
export const HERO_POSE_MS = { strike: 320, heavy: 720, flurry: 660, sweep: 550, guard: 550, channel: 600, brace: 280, throw: 900, twinthrow: 1100, rend: 800, uppercut: 700, hammerfall: 560, quench: 620, bellowspush: 640, snapcast: 480, fanflames: 700, arccut: 620, collarline: 680, headbutt: 600, surge: 760, haftjab: 520, forgeclap: 780, wildflail: 740, bellowsflex: 560, dropkick: 820, bloodhammer: 900, castaside: 640, truetemper: 700, fitplate: 660, kilncry: 620, vent: 600, heattrance: 760, hailblows: 880, climbcut: 720, veintap: 560, reapsweep: 1000, heatwash: 900, bracelock: 800, flameward: 760, cindershroud: 720, stoke: 640, scaleup: 700, bankcoal: 680, ashembrace: 720, cinderskin: 660, lockdown: 900, overtemper: 820, tithe: 780, splitseam: 700 };
export let pileOpen = null;
export function setPileOpen(v) { pileOpen = v; }

export function animMs(ms) {
  if (reducedMotion || animSpeed === 0) return 0;
  return Math.max(0, Math.round(ms / animSpeed));
}
export function clearHitstop() {
  if (stageEl && stageEl.classList) stageEl.classList.remove('hitstop');
  if (fxEl && fxEl.classList) fxEl.classList.remove('hitstop');
}
export function revealFloats() {
  if (!stageEl || !stageEl.querySelectorAll) return;
  for (const n of stageEl.querySelectorAll('.efloat.is-queued')) n.classList.remove('is-queued');
}
/** Drop the rest of the feel queue and show the numbers now. */
export function skipAnim() {
  animGen += 1;
  clearHitstop();
  revealFloats();
}

/**
 * Every timer the effect layer owns, so a new run can cancel the previous run's pending
 * removal instead of letting it delete a node of the NEW run's tree.
 */
let fxTimers = [];
export function later(fn, ms) {
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
export function laterPaint(fn, ms) {
  const t = setTimeout(fn, ms);
  paintTimers.push(t);
  return t;
}
export function clearFxTimers() {
  for (const t of fxTimers) clearTimeout(t);
  fxTimers = [];
  for (const t of paintTimers) clearTimeout(t);
  paintTimers = [];
}

/**
 * The status keys the PREVIOUS paint saw, so a status that merely restacked can be told apart
 * from one that just landed (see `freshStatusKeys`).
 *
 * This was assigned but never declared, and it is declared HERE because the omission broke the
 * real page: the web modules are ES modules, modules are strict mode, and a strict-mode
 * assignment to an undeclared name throws. Every `render()` therefore died with
 * `ReferenceError: lastPlayerStatuses is not defined` at the assignment in `render()`, and the
 * browser surface stopped repainting after the first action — the stage kept whatever the
 * boot paint had put there. The kernel tests did not catch it because they evaluate this code
 * through `new Function()`, whose body is SLOPPY mode, where the same assignment silently
 * creates a global. `git`-less local tree, no CI browser run: nothing executed it strictly.
 */
export let lastPlayerStatuses = [];
export function setLastPlayerStatuses(keys) { lastPlayerStatuses = keys; }
/** Polite live region. The targeting state is never conveyed by colour alone: every
 *  step that changes what the player can do is also announced as text. */
export const liveEl = document.getElementById('live');

/** A fresh random seed per browser game keeps each restart a new run. */
export function seedFromUrl() {
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null || raw === '') return Math.floor(Math.random() * 1000000);
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : Math.floor(Math.random() * 1000000);
}

/**
 * The DOM-free controller the whole surface drives (created in app.js's boot and by
 * `newGame()`), and the value model the kernel computes for it. `act()` refreshes `snap`
 * after every dispatch, so a repaint always paints the freshest kernel answer.
 */
export let ctl = null;
export let snap = null;
export function setCtl(next) { ctl = next; }
export function setSnap(next) { snap = next; }
/** Kernel events of the current run, accumulated for the run-history record (reset in newGame). */
export let runEvents = [];
export function setRunEvents(events) { runEvents = events; }
/**
 * A rolling generation counter for the HUD flash classes, plus the hand/inventory the
 * last paint saw. `flash.n` changes ONLY when one of the flash booleans actually changes,
 * so a repaint for an unrelated reason reproduces the same class string on the same
 * element. The browser therefore sees no class delta and does NOT restart the animation —
 * the previous boolean-only scheme could not promise that.
 */
export let flash = { hp: false, energy: false, block: false, hits: [], n: 0, blockEat: false };
export function setFlash(next) { flash = next; }
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
export let bursts = [];
export function setBursts(next) { bursts = next; }
/** The phase the last paint drew, so a phase change animates and a repaint does not. */
export let paintedPhase = null;
export function setPaintedPhase(phase) { paintedPhase = phase; }

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
export let prevEnemies = [];
export function setPrevEnemies(list) { prevEnemies = list; }
/**
 * The enemy ids whose entrance beat has ALREADY been played, for this run. A repaint for an
 * unrelated reason — hovering an enemy calls render() many times a second — must not replay
 * the entrance, so the beat is consumed once per id. `newGame()` clears it, which is what
 * makes a restart animate again. `id` is the kernel's encounter id (`the_guardian`,
 * `nob`): static identity, not a stat, so this reads no rule.
 */
export let enteredIds = new Set();
export function setEnteredIds(set) { enteredIds = set; }
/**
 * The phase whose arrival beat is still owed to the player, or null. Already consumed by
 * `render()` and therefore absent from a paint that merely repeats the phase.
 */
export let phaseArriving = null;
export function setPhaseArriving(phase) { phaseArriving = phase; }

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
export function noArrival() {
  return { victory: false, defeat: false, reward: false, rest: false, boss: false, travelTo: null };
}

/** The one phase beat a paint may play. Reset at the top of every paint. */
export let arriving = noArrival();
export function setArriving(next) { arriving = next; }
/**
 * Whether `render()` has still to place the keyboard caret on the arriving panel. Kept
 * OUTSIDE the one-paint reset above because it is consumed by `stageEl.querySelector`
 * after the panel exists, in the same paint — the reset would wipe it in between.
 */
export let endFocusPending = false;
export function setEndFocusPending(v) { endFocusPending = v; }
/**
 * The map the player was standing on when the last action was taken (`current` node id and
 * floor), recorded by `act()` from the BEFORE snapshot. The travel beat needs the node the
 * step STARTED from, and by the time the new map is drawn that node is a different element
 * on a different row. Presentation only: it names a node to mark, and nothing else.
 */
export let prevMapCurrent = null;
export let prevMapFloor = null;
export function setPrevMap(current, floor) { prevMapCurrent = current; prevMapFloor = floor; }
/** The travel burst the current paint drew, released with the other one-paint flags. */
export let lastTravel = null;
export function setLastTravel(v) { lastTravel = v; }
/** The enemy ids whose entrance beat belongs to the paint being built right now. */
export let enteringIds = new Set();
export function setEnteringIds(set) { enteringIds = set; }

/** Set by a hero switch: the next first paint is the same screen, so no act title card. */
export let quietIntro = false;
export function setQuietIntro(v) { quietIntro = v; }

/**
 * Set once per paint, from `bursts`, at the top of `render()`:
 *   * `dealPending` — this paint should fan the hand in;
 *   * `dyingThisPaint` — collapsed cards to draw for enemies that just left the snapshot.
 * Both are derived per paint and then released by a timer, so they can never latch on.
 */
export let dealPending = false;
export let dyingThisPaint = [];
export function setDealPending(v) { dealPending = v; }
export function setDyingThisPaint(list) { dyingThisPaint = list; }
