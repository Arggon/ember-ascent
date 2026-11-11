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
/** Presentation speed. 1 and 2 scale the feel queue; 0 skips it. Never a rule.
 *  UX-4 dock semantics at the halved base pace: 1× is the cinematic pace, 2×
 *  reproduces the pre-UX-4 pace ("the classic pace"), » skips everything. */
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
export function setAnimSpeed(n) {
  animSpeed = n;
  applyPace();
}
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

/* --------------------------------------------------- UX-4: the deal clock ---------
 * The hand's deal is an EVENT the player must SEE: cards landing one by one, not eight
 * tiles fading in as one. The stagger and the per-card flight therefore have real
 * lengths — a base 90ms step (0.03s before UX-4) and a base 300ms flight — both routed
 * through `animMs` like every other beat, so the dock scales the deal with everything
 * else and » collapses it to an instant.
 *
 * `dealClock` is the armed clock for the deal in progress, held for its whole span (an
 * 8-card deal runs ~1.9s at 1×) so an incidental repaint — a hover — can RESUME the
 * flight instead of cutting it: the hand applies the clock's divided step and duration
 * as CSS variables, and `--deal-offset` (the negative of the elapsed time) makes every
 * card's animation-delay resume where the flight actually is. The same resume shape the
 * hero's pose hold and the strike sequence use. `render()` arms it when a deal burst
 * arrives (never twice — a repaint must not re-deal), and the release timer retires it
 * after the last card lands; `newGame()` drops it with the rest of the run's motion
 * state.
 *
 * The layout contract is unchanged: the clock only times the ENTRY. Every card's final
 * position is the ordinary fan (`--i`/`--n` on the same tiles); `juice-deal` animates
 * to `transform: none`, so the fan never shifts when the deal finishes.
 */
/** The deal's base timing, at the pre-factor base, in milliseconds: 90ms between two
 *  cards' landings and a 300ms flight per card. At 1× the pace factor doubles both
 *  (180ms step, 600ms flight) — an 8-card deal spans 7 × 180 + 600 ≈ 1.86s of visible
 *  sequential landing; at the 2× dock they collapse to the classic 90/300. */
export const DEAL = { step: 90, dur: 300 };
export let dealClock = null; // { start, stepMs, durMs } — while the deal is on screen
export function setDealClock(clock) { dealClock = clock; }

/* ------------------------------------------------------- UX-2: the strike sequence ---
 * The enemy turn, SEQUENCED: one attacker at a time, each with its own windup-to-slam
 * beat, its own named damage float on the hero, and its own intent-row highlight.
 * The plan is armed by `act()` (BEFORE the paint, so the poses it schedules are painted
 * with their delays from the first frame) from the kernel's own per-attacker events, and
 * it is pure presentation: it decides when a pose plays, never what a rule does. Like
 * `heroMoveHold` it is read per paint and survives incidental repaints (a hover recomputes
 * the same clock), and it is cleared when the sequence ends (act() schedules the
 * retirement timer beside the arming), when the player hits » (`skipAnim`), or when the
 * run restarts (`newGame`). On the KILLING turn (a flip that ends the run in defeat)
 * act() arms the plan and schedules no timer: the defeat hold in render.js replays the
 * whole plan on the held stage — the hero's death beat rides the plan's own clock — and
 * retires the plan itself when the beat is over.
 *
 * `beatMs` is the gap between two attackers' slams, `slamMs` the CSS slam length, and
 * `impactMs` the moment inside a slam where the dash ARRIVES (the keyframe's impact beat)
 * — that is when the attacker's named float lands and the vignette pulse reads. All three
 * arrive already paced by the speed dock (`animMs`), so the dock scales every beat and »
 * never arms a plan at all. Reduced motion arms nothing: the turn collapses to the fast
 * form.
 */
export let strikeSeq = null; // { attacks (ONE PER STRIKE), beatMs, slamMs, impactMs, start, totalMs }
export function setStrikeSeq(seq) { strikeSeq = seq; }
/**
 * The sequence's base timing, at the pre-factor base, in milliseconds — the numbers the
 * audit targets: a beat (windup-to-slam gap between two attackers) of 500ms and a slam
 * of 640ms whose dash arrives at 46% of its run. `animMs` paces all of it (× SLOW_FACTOR
 * ÷ the dock), so the new 1× plays a 1000ms beat and a 1280ms slam and a 3-attacker
 * turn's INFORMATION (every named float and the closing vignette) completes in about
 * 3.3s; 2× restores the classic pace, » never arms a plan at all.
 */
export const STRIKE_SEQ = { beat: 500, slam: 640, impactAt: 0.46, floatMs: 950 };
/**
 * UX-9b: the BEAT slot for a non-attack step of the same turn (guard / power / hex), at the
 * same pre-factor base as STRIKE_SEQ. The attack path keeps its own three figures
 * untouched; this is one extra number, not a second timing system: the plan's tail is the
 * non-attack steps in kernel order, one slot each, played AFTER the last slam (so a
 * `thrash` A7 B5 reads as strike then guard). 560ms is the spec's §4.2 `power` beat — the
 * middle of guard 480 / power 560 / hex 640 — because 9c's per-kind pose durations are the
 * refinement, and a plan that already carries the kind can be re-slotted there without
 * touching the event grouping again. `animMs` paces it exactly like every other beat.
 */
export const TURN_STEP = { ms: 560 };
/**
 * Where THIS enemy sits in the playing sequence, or null. `delay` is what its .fig's
 * animation-delay should be RIGHT NOW: positive (waiting for its turn — `fill: both`
 * holds the 0% frame) or negative (resuming mid-flight after an incidental repaint),
 * exactly the resume mechanism the hero's pose uses.
 *
 * GOLPES DISCRETOS: `attacks` is ONE ENTRY PER STRIKE, so an enemy with a multi-hit move
 * owns several windows — beatMs * k .. beatMs * k + slamMs for each of its golpes. This
 * returns the FIRST of the enemy's strikes whose window has not fully passed, so the
 * slam re-arms per golpe: between its own golpes the delay is positive again (the figure
 * holds the standing 0% frame for the gap), then the next slam plays on its own beat.
 * A single-strike enemy resolves exactly as before.
 */
export function strikeSlot(index) {
  if (!strikeSeq) return null;
  const elapsed = Date.now() - strikeSeq.start;
  for (let k = 0; k < strikeSeq.attacks.length; k += 1) {
    if (strikeSeq.attacks[k].enemy !== index) continue;
    const at = strikeSeq.beatMs * k;
    if (at + strikeSeq.slamMs > elapsed) {
      return {
        i: k,
        delay: Math.round(at - elapsed),
        dur: strikeSeq.slamMs,
      };
    }
  }
  return null;
}
export const HERO_POSE_MS = { strike: 320, heavy: 720, flurry: 660, sweep: 550, guard: 550, channel: 600, brace: 280, throw: 900, twinthrow: 1100, rend: 800, uppercut: 700, hammerfall: 560, quench: 620, bellowspush: 640, snapcast: 480, fanflames: 700, arccut: 620, collarline: 680, headbutt: 600, surge: 760, haftjab: 520, forgeclap: 780, wildflail: 740, bellowsflex: 560, dropkick: 820, bloodhammer: 900, castaside: 640, truetemper: 700, fitplate: 660, kilncry: 620, vent: 600, heattrance: 760, hailblows: 880, climbcut: 720, veintap: 560, reapsweep: 1000, heatwash: 900, bracelock: 800, flameward: 760, cindershroud: 720, stoke: 640, scaleup: 700, bankcoal: 680, ashembrace: 720, cinderskin: 660, lockdown: 900, overtemper: 820, tithe: 780, splitseam: 700 };
/* ------------------------------------------------------- UX-4: the global pace ---
 * The user played at 1× and could not follow the game: strokes, throws and draws
 * flashed past. UX-4 halves the pace — every combat animation timing DOUBLES at the
 * new 1× — and it does so as ONE factor, not by editing every constant.
 *
 * The factor has two expressions over the same number, so JS-scheduled beats and
 * CSS keyframes can never drift apart:
 *
 *   * `SLOW_FACTOR` inside `animMs()` — every duration the JS schedules (pose holds,
 *     card-fly and hammer flights, hit impacts, hit-stop, the strike sequence's
 *     beat/slam/impact, kill holds, the deal clock) is a base milliseconds figure,
 *     and `animMs(ms) = ms × SLOW_FACTOR / animSpeed` is the ONLY door it goes through.
 *   * the `--pace` custom property on the document root — every ONE-SHOT combat
 *     animation in style.css declares its duration (and delay) as
 *     `calc(<base>s * var(--pace, 1))`, and `applyPace()` keeps the property in step
 *     with the dock: `--pace = SLOW_FACTOR / animSpeed` (0 at »). Ambient loops
 *     (idle breathing, wind-up, embers) and screen-level arrivals (fade-up, settle,
 *     travel-in) stay at their base — they are not combat beats.
 *
 * At the 2× dock both expressions collapse to the base figures, which is exactly the
 * pre-UX-4 pace — that is what the dock's "2× = the classic pace" label promises.
 * At » animMs returns 0, --pace is 0, and nothing animates. Reduced motion arms
 * nothing and the stylesheet forces every animation to 0.001ms; the fast form stays
 * fast — reduced motion is an accessibility need, not a pace preference.
 */
/* ------------------------------------------------------ UX-5: the input lock -------
 * "Treat each card as a turn": while a play's animation is still on screen, the next
 * card must not be playable, and while the enemy-turn sequence or a kill hold is
 * playing, nothing player-facing is. The gate is PRESENTATION ONLY — the kernel's
 * legality is untouched (the sim and the stepping tests never route through it) — and
 * it is derived from the SAME lifetimes the effects already use, not a parallel timer
 * system:
 *
 *   * a play (dispatchFx's `card-fly` case) arms `inputLock` for exactly the span the
 *     case itself schedules — the pose hold (`heroMoveHold.dur`, the same paced figure
 *     combat-view paints), the throw choreography (`HERO_THROWS` delay + flight), a
 *     signature's tail (the render.js kill-hold convention: ~70% of the pose + a paced
 *     650ms beat) — with the hit-stop beat where the play's numbers land as the FLOOR
 *     of that span, not an addition (fx.js playInputSpan);
 *   * the enemy turn gates on `strikeSeq` — the plan UX-2 armed, read directly, so the
 *     gate retires exactly when the plan does (its own timer, totalMs + 400; on the
 *     killing turn, when the defeat hold retires the plan after the hero's death beat,
 *     so the whole turn-and-death sequence stays gated);
 *   * a deal gates on `dealClock` — the clock UX-4 armed in render(), read directly;
 *   * a kill hold (render.js's endHeld branch) arms `inputLock` for exactly the hold's
 *     own `wait`.
 *
 * `busyReason()` reads the lock lazily (the heroMoveHold shape), but every armed span
 * schedules its own RELEASE PAINT (setInputLock), so the locked shape on the hand and
 * End Turn always comes off on time, painted — a player who never moves the mouse is
 * not left staring at a locked hand. The gate NEVER engages under reduced motion —
 * animations are instant there, so there is nothing to wait for. The dock scales every
 * span through `animMs`, and » clears the lock in `skipAnim` — skipping the animation
 * also skips the wait.
 */
export let inputLock = null; // { until, why } — busy while Date.now() < until
/**
 * Arm (or extend) the input lock. Max semantics: a second lifetime landing while one is
 * already armed must hold until BOTH end — a new play may not shorten a lock an older,
 * longer play is still entitled to.
 *
 * Each arm also schedules the RELEASE PAINT: the lock's expiry is read lazily (the
 * heroMoveHold shape), but unlike the pose — which only styles a paint that is already
 * happening — the locked shape sits on the hand and End Turn BUTTONS, and a paint that
 * never comes would leave them disabled forever. The timer repaints when this lock's
 * span is over and it is still the current lock — OR when it is already gone: the lazy
 * expiry in busyReason() nulls an expired lock, and a reader that raced the expiry
 * (a polling wait) must not talk the release paint out of firing, or the last paint —
 * still locked — is the one the player keeps. A replaced (longer) lock skips this
 * paint: the arm that replaced it scheduled its own.
 */
export function setInputLock(lock) {
  if (lock && inputLock && inputLock.until > lock.until) return;
  inputLock = lock;
  if (lock) {
    const armed = lock;
    laterPaint(() => { if (inputLock === armed || inputLock === null) repaint(); }, (armed.until - Date.now()) + 30);
  }
}
/**
 * Why the hand and End Turn are locked right now, or null. The reasons the surface
 * shows: 'play' (a card's animation is landing), 'enemy-turn' (the strike sequence),
 * 'deal' (a hand is arriving), 'hold' (a kill hold owns the stage). Reduced motion
 * short-circuits first: the gate never engages when nothing animates.
 * @returns {string|null}
 */
export function busyReason() {
  if (reducedMotion) return null;
  if (strikeSeq) return 'enemy-turn';
  if (inputLock) {
    if (Date.now() < inputLock.until) return inputLock.why;
    inputLock = null; // expired — released lazily, the way heroMoveHold expires
  }
  // The deal is reported last: a play that also replaces the hand reads as its play
  // (the longer span), and a bare turn draw reads as the deal that it is.
  if (dealClock) return 'deal';
  return null;
}
export const SLOW_FACTOR = 2;
/**
 * Publish the pace factor to the stylesheet. Called once at module load and on every
 * dock change; guarded because the narrow test hosts carry a document without a root
 * element (and only a real CSSOM can hold custom properties anyway).
 */
export function applyPace() {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (!root || !root.style || !root.style.setProperty) return;
  root.style.setProperty('--pace', String(animSpeed === 0 ? 0 : SLOW_FACTOR / animSpeed));
}
applyPace();
export let pileOpen = null;
export function setPileOpen(v) { pileOpen = v; }

export function animMs(ms) {
  if (reducedMotion || animSpeed === 0) return 0;
  return Math.max(0, Math.round((ms * SLOW_FACTOR) / animSpeed));
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
  // » also retires a playing strike sequence: the remaining beats never fire, and the
  // next paint drops the slam poses (the past floats stay until their own removal timers).
  setStrikeSeq(null);
  // UX-5: skipping the animation also skips the wait — the gate releases with the
  // effects it was derived from (the lock and the deal clock; the strike sequence is
  // retired directly above).
  setInputLock(null);
  setDealClock(null);
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
/**
 * The enemy statuses the PREVIOUS paint saw, keyed by each enemy's stable `index`. UX-9 D3:
 * an enemy chip's juice-in must compare against THAT enemy's own previous keys — comparing
 * against the player's list made an enemy chip animate whenever the player gained a status.
 * A Map, not an array: `index` is stable identity that survives a death and a shift up the
 * row, which is the same reason `hitClass` and `prevEnemies` key on it.
 */
export let lastEnemyStatuses = new Map();
export function setLastEnemyStatuses(map) { lastEnemyStatuses = map; }
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
 * `bossName` is the acting boss's already-localized display name, carried with the boss beat
 * so the welcome banner can announce the boss that actually walked in rather than a literal.
 *
 * @returns {{victory: boolean, defeat: boolean, reward: boolean, rest: boolean, boss: boolean, bossName: string|null, travelTo: string|null}}
 */
export function noArrival() {
  return { victory: false, defeat: false, reward: false, rest: false, boss: false, bossName: null, travelTo: null };
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

/* ------------------------------------------------------------- WIRING HOOKS --------
 * Two owners sit ABOVE the layers that need to reach them: only render.js may paint, and
 * only targeting.js may end a targeting step. Having actions.js and the views import
 * upward would make the module graph cyclic (render imports the views, the views import
 * actions, actions imports render), so each owner registers itself here once at module
 * load and the lower layers call the hook. Calls before registration are no-ops, which
 * can only happen during boot, before any interaction exists.
 */

/** The one paint path, registered by render.js; the views and actions repaint through it. */
export let repaint = () => {};
export function setRepaint(fn) { repaint = fn; }

/** The targeting state reset, registered by targeting.js; actions.js ends steps through it. */
export let notifyEndTargeting = () => {};
export function setEndTargeting(fn) { notifyEndTargeting = fn; }
