// src/web/render.js — the one paint path.
//
// `render()` rebuilds #stage from the current snapshot: it consumes the one-shot arrival
// beats, holds the stage for the collapse that precedes an end/reward panel, delegates to
// the per-phase view module, animates a phase change in (a repaint inside the same phase
// stays still), and releases the per-paint flags with a timer. The "engraved page" frame
// every screen shares lives in ./page-frame.js; the views repaint through the runtime
// hook, so nothing imports back into this file.

import { BIOMES, DEFAULT_BIOME } from '../kernel/index.js';
import {
  arriving,
  bursts,
  dealClock,
  dealPending,
  dyingThisPaint,
  endFocusPending,
  enteredIds,
  enteringIds,
  heroMoveHold,
  laterPaint,
  noArrival,
  paintedPhase,
  phaseArriving,
  prevMapCurrent,
  reducedMotion,
  setArriving,
  setDealClock,
  setDealPending,
  setDyingThisPaint,
  setEndFocusPending,
  setEnteringIds,
  setInputLock,
  setBursts,
  setLastPlayerStatuses,
  setLastEnemyStatuses,
  setLastTravel,
  setPaintedPhase,
  setPhaseArriving,
  setPrevEnemies,
  setStrikeSeq,
  setHeroMoveHold,
  skipAnim,
  snap,
  stageEl,
  strikeSeq,
  DEAL,
  animMs,
} from './runtime.js';
import { el } from './dom.js';
import { enemyLook } from './glyphs.js';
import { signatureFor } from './hero-moves.js';
import { backdropMarkup } from './stage-art.js';
import { dyingRow } from './floats.js';
import { endTargeting, pendingCard, pendingSlot } from './targeting.js';
import { renderHud, helpPanel, helpOpen, deckPanel, deckOpen, codexPanel, codexOpen, beltOpenSlot, beltPanel, setBeltOpenSlot } from './hud.js';
import { tourSync } from './tour.js';
import { t } from './i18n.js';
import { heroFigure, combatView, enemyCard, speedDock } from './combat-view.js';
import { mapView } from './map-view.js';
import { rewardView } from './reward-view.js';
import { kindlingView } from './kindling-view.js';
import { restView } from './rest-view.js';
import { shopView } from './shop-view.js';
import { eventView } from './event-view.js';
import { endView } from './end-view.js';
import { sceneBeat } from './fx.js';
import { page } from './page-frame.js';
import { setRepaint } from './runtime.js';

/* ----------------------------------------------------------------------- STAGE */

/**
 * How long the end-of-run panel is held back on the motion path, so the killing blow is a
 * beat of its own instead of a frame: "the enemy dies, THEN the summary arrives".
 *
 * It is clamped to the COLLAPSE ITSELF, not to how long a boss is worth pausing for. The
 * dying enemy's ghost animates `juice-shatter` for the collapse's PACED length
 * (`animMs(COLLAPSE_MS)` — the stylesheet multiplies the same base by `--pace`), with
 * `fill: both`, so it is at `opacity: 0` from that moment on. A hold longer than the
 * collapse could only ever hold an EMPTY stage — which is what the old boss window did
 * for 1150 ms. The load-bearing bound on an empty stage is AC-5.6's 250 ms, and the hold
 * now ends while the collapse is still on screen.
 *
 * These are read at ONE instant per action (the boot/restart calls have no death to wait
 * for), and `act()` never reads them, so the 8-token action line and the action ids are
 * untouched. Reduced motion uses 0: the panel is simply there.
 */
const COLLAPSE_MS = 500;
const END_DELAY_MS = 480;
/**
 * The hero's DEATH beat (base, pre-pace milliseconds): the collapse-and-dissolve the
 * defeat hold plays on the hero's own figure after the killing turn has landed — the
 * figure sinks, dulls and scatters into embers/ash (see `hero-death` in style.css; no
 * image assets, the same CSS vocabulary as the enemy ghosts' `ash-fall`). The stylesheet
 * paces it through `--pace`, so `animMs` here and the keyframe never drift: ~0.9s at the
 * 1× dock, half at 2×, none at » or reduced motion (where the defeat hold never paints).
 * The defeat hold's wait (the killerTurn branch below) adds this constant to the 200 ms
 * the ash tail needs after it — 120 ms of mote stagger + 80 ms of settle — so the figure
 * is fully dissolved before the panel repaints.
 */
const HERO_DEATH_MS = 450;

// render.js is the paint sink: nothing imports back into it (the views repaint through the
// runtime hook), so registering here at load is enough and the graph stays acyclic.
setRepaint(render);

export function render() {
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
  setDealPending(bursts.some((b) => b.kind === 'deal'));
  setDyingThisPaint(bursts.filter((b) => b.kind === 'death'));
  // UX-4: arm the deal clock ONCE for the deal that just arrived (a later repaint must
  // not re-deal the hand — bursts is emptied right after this paint, so `dealPending`
  // is only true here). The clock carries the PACED step and flight (`animMs`), and its
  // release timer waits out the whole span — every card's landing plus one flight — so
  // the `deal-in` entry survives an incidental repaint as a RESUME, never a restart.
  // Speed 0 and reduced motion pace the clock to 0, so no clock is armed and the hand
  // paints statically — the fast form the dock promises.
  if (dealPending && !dealClock) {
    const stepMs = animMs(DEAL.step);
    const durMs = animMs(DEAL.dur);
    if (stepMs > 0 && durMs > 0) {
      const clock = { start: Date.now(), stepMs, durMs };
      setDealClock(clock);
      // UX-5: the release REPAINTS — the deal's busy reason sits painted on the hand
      // and End Turn, so the clock retiring without a paint would leave the locked
      // shape up until some incidental repaint. The release also CONSUMES the bursts:
      // a paint whose bursts were never consumed by dispatchFx (a direct render in a
      // test harness) would otherwise re-derive `dealPending` from the same stale
      // deal burst on every release render and re-arm the clock — an infinite timer
      // chain that never lets the event loop rest. In the real flow bursts is already
      // empty here (dispatchFx consumed it right after the paint).
      laterPaint(() => { if (dealClock === clock) { setBursts([]); setDealClock(null); render(); } },
        stepMs * Math.max(0, (snap.hand.length || 1) - 1) + durMs + 120);
    }
  }
  const travelPending = bursts.find((b) => b.kind === 'travel') || null;
  // The status keys of the snapshot BEFORE this action, so a status can be told apart from
  // one that merely restacked. Captured before renderHud() reads it.
  const statusKeysNow = [...(snap.player.statuses || []).map((s) => s.key),
    ...(snap.player.powers || []).map((p) => p.key),
    ...(snap.enemies || []).flatMap((e) => (e.statuses || []).map((s) => s.key))];
  // UX-9 D3: the same "before" snapshot, but per enemy and keyed by stable `index`, so an
  // enemy chip can be diffed against THAT enemy's own previous keys. Built before any child
  // of this paint reads it, exactly like the player list above.
  const enemyStatusKeysNow = new Map((snap.enemies || []).map((e) =>
    [e.index, (e.statuses || []).map((s) => s.key)]));

  renderHud();
  stageEl.replaceChildren();
  const phaseChanged = snap.phase !== paintedPhase;

  /* ----------------------------------------------------- ARRIVAL BEATS (one paint only)
   * A beat that describes a moment that has just HAPPENED can only play on the paint that
   * immediately follows it. `phaseArriving` is set by `act()` and consumed here; an
   * incidental repaint a moment later therefore sees none of them, which is what stops a
   * hover from replaying the boss walking in. */
  setArriving(noArrival());
  const arrivingNow = phaseArriving;
  setPhaseArriving(null);
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
  setLastTravel(travelPending);
  // The node the previous floor's row should draw a travelling marker on: the `current`
  // node of the map we were standing on when the step was taken.
  const travelFromId = travelPending && prevMapCurrent ? prevMapCurrent : null;

  // Enemies seen for the FIRST time this paint get an entrance. A boss gets its own beat.
  // `enteredIds` is consumed once per id per run, so this can never replay on a repaint.
  setEnteringIds(new Set());
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
  // here") is readable with no motion at all. The name rides along on the beat (UX-9 D1): it
  // is the snapshot's own enemy name, already localized by the kernel, so the banner needs
  // no string of its own and announces whichever boss actually walked in.
  if (bossWelcomed.length > 0) {
    arriving.boss = true;
    arriving.bossName = bossWelcomed[0];
  }

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
   * A DEFEAT has no collapse to show HERE — no death burst is emitted when the PLAYER is
   * the one who dies — but it is no longer dropped to the panel either: the killing turn
   * takes its own branch below, which holds the fight exactly as it stood and replays the
   * enemy turn that ended the run on it, then the hero's death, THEN the panel.
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
  /* THE KILLING TURN, HELD (defeat). A defeat that arrives on the enemy turn is the one
   * ending the kernel resolves WITHOUT a death burst: nobody died on the board, the hero
   * did — so the branch above never fires and the DEFEAT panel used to replace the fight
   * on the very next paint, discarding the turn that killed the player (owner report:
   * "when an enemy defeats the hero you don't see the attack animation, it just shows the
   * defeat screen").
   *
   * WHAT THIS BRANCH PAINTS. The fight EXACTLY as it stood the instant the turn began —
   * the same `.stage-combat > .fight` wrapper the live view uses, backdrop, ground, the
   * hero holding its final HP, and the standing enemies rebuilt by the SAME `enemyCard()`
   * the live row uses, so the attackers wear the same plan-driven slam poses and intent
   * highlights. The strike plan was armed in `act()` BEFORE this paint and lives in
   * `runtime.strikeSeq` (presentation state, like every other motion lifetime), so the
   * dispatcher (`dispatchFx()`, called right after this paint by `act()`) replays the
   * WHOLE killing turn on this stage on the plan's own divided clock — attacker dash,
   * named damage float over the held hero's chest (`heroLane()` measures whatever
   * `.fight .hero` is painted), tail steps, closing pulse. Nothing about the kernel's
   * answer is re-derived or mutated: this is presentation replaying facts it already has.
   *
   * THEN THE DEATH. When the last slam has landed (`--death-delay` = the plan's own
   * totalMs), the hero's figure plays its death beat — a collapse that dulls, sinks and
   * dissolves into embers/ash (`hero-death`, `hero-ash` in style.css; CSS only, the same
   * ember/ash vocabulary the stage already speaks). After that tail the panel repaints.
   *
   * THE GUARDS. Reduced motion never enters: `act()` arms no plan there, so the branch
   * falls through and the panel is simply there — the information is static on it, which
   * is the reduced-motion contract. » (the speed dock, painted on the hold itself, or the
   * backdrop's skip) retires the plan and repaints, so the hold is skippable exactly like
   * the live fight. The whole span gates on the UX-5 door the plan itself provides
   * (`busyReason()` reads `strikeSeq` first): no card, no key, no End Turn while the
   * turn-and-death sequence plays, and the stage is FULL from the first frame (AC-5.6's
   * empty-stage bound never sees this window). paintedPhase is deliberately left at
   * 'combat' so the panel's own entrance deal still plays when the beat ends.
   */
  const killerTurn = arriving.defeat && dyingThisPaint.length === 0
    && Boolean(strikeSeq) && bursts.some((b) => b.kind === 'enemy-turn');
  if (killerTurn) {
    const plan = strikeSeq;
    // The pose hold of the player's last card may still sit in its hit-stop grace window
    // (heroPose's `start + dur + 260ms`), in which case heroFigure() would paint the
    // figure with inline `animation: none` — and an inline style outranks the
    // `.is-hero-death` rule, freezing the hero standing through the whole death beat.
    // The held stage is the TURN's, not the last play's: the hold owns the pose.
    setHeroMoveHold(null);
    const holdWrap = el('div', { cls: 'stage-combat' });
    const holdFight = el('div', { cls: 'fight' });
    const holdBackdrop = el('div', { cls: 'backdrop', attrs: { 'aria-hidden': 'true' } });
    holdBackdrop.innerHTML = backdropMarkup((BIOMES[snap.biome] ?? BIOMES[DEFAULT_BIOME]).backdrop);
    // The skip the live backdrop honours: retire the plan (which also clears the plan's
    // own busy reason) and repaint — the ended panel replaces the held stage at once.
    // render() is the paint sink, so the callback paints directly.
    holdBackdrop.addEventListener('pointerdown', () => { skipAnim(); render(); });
    holdFight.append(holdBackdrop);
    holdFight.append(el('div', { cls: 'ground', attrs: { 'aria-hidden': 'true' } }));
    const heldHero = heroFigure();
    const deathFig = typeof heldHero.querySelector === 'function' ? heldHero.querySelector('.fig') : null;
    if (deathFig && deathFig.classList) deathFig.classList.add('is-hero-death');
    // `--death-delay` rides the .hero CONTAINER, not the .fig: the figure and the ash
    // span below are SIBLINGS, and custom properties inherit downward only — written on
    // the container, both children read the same plan total (the death collapse starts
    // when the last slam has landed; the ash rises on that same clock). setProperty is
    // guarded — only a real CSSOM can hold custom properties.
    if (heldHero.style && heldHero.style.setProperty) {
      heldHero.style.setProperty('--death-delay', `${plan ? plan.totalMs : 0}ms`);
    }
    // The ash: three rising motes timed to the same delay (the stylesheet staggers them).
    heldHero.append(el('span', { cls: 'hero-ash', attrs: { 'aria-hidden': 'true' } },
      el('i', {}), el('i', {}), el('i', {})));
    holdFight.append(heldHero);
    const holdEnemies = el('div', { cls: 'enemies' });
    (snap.enemies || []).forEach((e, i) => holdEnemies.append(enemyCard(e, i)));
    holdFight.append(holdEnemies);
    const holdDock = speedDock();
    // ANY dock press on the held stage retires the plan: 1×/2× cannot re-pace timers
    // already scheduled, so on the hold they read as the skip the » button documents —
    // without this, a 1×/2× press repainted the panel with the plan still armed (its
    // busyReason swallowing keys over the finished screen until the hold's own wait
    // retired it). Capture phase: the retirement lands before the button's own handler.
    holdDock.addEventListener('click', () => setStrikeSeq(null), true);
    holdFight.append(holdDock);
    holdWrap.append(holdFight, el('div', { cls: 'ended-hold', attrs: { 'aria-hidden': 'true' } }));
    // The hold stage must sit in the SAME page wrapper combatView uses (`page-combat`
    // sizes and positions the fight), or the hero lands outside the frame and the
    // backdrop loses its lighting — a near-black stage instead of the fight it ended.
    stageEl.replaceChildren(page('combat', t('combat.chapter'), 'blade', '', [holdWrap]));
    // How long the stage holds: the killing turn's own plan total (every slam, every
    // named float, the tail), then the death beat (HERO_DEATH_MS) plus the 200 ms its
    // ash tail needs after it (120 ms of mote stagger + 80 ms of settle). One clock, the
    // plan's plus one figure — nothing here invents a second timing system.
    const wait = plan ? plan.totalMs + animMs(HERO_DEATH_MS + 200) : 0;
    // The killing turn's discard phase emits a `deal` burst (the hand emptied), but the
    // hold paints no hand and the panel arrives only after the beat — the deal clock
    // armed for that burst must not own a release repaint here: measured, its ~720ms
    // release repainted the ended panel into the middle of the sequence. Retiring the
    // clock NOW no-ops its own release callback (it guards on clock identity) and keeps
    // this branch the sole owner of the wait.
    setDealPending(false);
    setDealClock(null);
    // The plan's retirement is THIS branch's job (act() schedules none for the killing
    // turn): when the death beat is over, retire the plan — which releases the UX-5
    // gate with it — and repaint into the panel, whose entrance still plays because
    // paintedPhase was left at 'combat'.
    laterPaint(() => { setStrikeSeq(null); render(); }, wait);
    setLastPlayerStatuses(statusKeysNow);
    setLastEnemyStatuses(enemyStatusKeysNow);
    setPrevEnemies((snap.enemies || []).map((e) => ({ index: e.index, id: e.id, name: e.name })));
    setEnteringIds(new Set());
    return;
  }
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
    stageEl.replaceChildren(page('combat', t('combat.chapter'), 'blade', '', [holdWrap]));
    // How long the stage holds. The collapse ghost reads for the PACED collapse
    // (`animMs(COLLAPSE_MS)`, the stylesheet's own paced `juice-shatter`); a killing
    // stroke with a SIGNATURE needs longer, because its impact beat fires at ~70% of
    // the pose and the effect (shockwave, anvil, salvo, rend, launch) lives a paced
    // beat beyond that — on the persistent fx layer, so it plays against THIS stage
    // only while the stage is up. heroFigure() above armed the pose hold, so
    // `heroMoveHold.dur` is the pose's true PACED length (animMs of the signature's
    // poseMs, or its move's base when it has none) — and the effect's tail is paced
    // through `animMs` with it, so the hold scales with the dock exactly as the
    // effects it protects do.
    const held = heroMoveHold;
    const sig = signatureFor(bursts.find((b) => b.kind === 'card-fly'));
    const strokeMs = held && sig ? Math.round(held.dur * 0.7) + animMs(650) : 0;
    const wait = reducedMotion ? 0 : Math.max(Math.min(animMs(END_DELAY_MS), animMs(COLLAPSE_MS)), strokeMs);
    // UX-5: the hold OWNS the stage while it plays, so the gate holds too — armed for
    // exactly the hold's own `wait` (the same lifetime the re-render timer below uses),
    // which keeps the reward/summary hotkeys (digits, 0, r, n) from acting mid-collapse.
    // Reduced motion computes wait 0 and arms nothing; setInputLock keeps the longer of
    // the two locks (the killing stroke's own play lock may outlive this hold).
    if (wait > 0) setInputLock({ until: Date.now() + wait, why: 'hold' });
    laterPaint(() => { if (snap.phase === 'ended' || snap.phase === 'reward') render(); }, wait);
    // Keep the fight as the painted phase after a reward hold, so the spoils panel still
    // gets its entrance animation when the beat ends. The ended panel paints plain.
    if (snap.phase !== 'reward') setPaintedPhase(snap.phase);
    setLastPlayerStatuses(statusKeysNow);
    setLastEnemyStatuses(enemyStatusKeysNow);
    if (dealPending || dyingThisPaint.length > 0 || travelPending) {
      laterPaint(() => { setDealPending(false); setDyingThisPaint([]); }, 0);
    }
    setEnteringIds(new Set());
    return;
  }

  switch (snap.phase) {
    case 'map': stageEl.append(mapView(travelPending)); break;
    case 'combat': stageEl.append(combatView()); break;
    case 'reward': stageEl.append(rewardView()); break;
    case 'rest': stageEl.append(restView()); break;
    case 'shop': stageEl.append(shopView()); break;
    case 'event': stageEl.append(eventView()); break;
    case 'kindling': stageEl.append(kindlingView()); break;
    case 'ended': stageEl.append(endView()); break;
    default: stageEl.append(el('p', { text: `phase ${snap.phase}` }));
  }
  // Animate a phase change in; a repaint inside the same phase stays still, or every
  // card play would flash the whole screen.
  if (phaseChanged && stageEl.firstElementChild) {
    stageEl.firstElementChild.classList.add('enter');
    sceneBeat(paintedPhase, snap.phase);
    setPaintedPhase(snap.phase);
  }
  // The first-run explanation is now the TOUR (tourSync below): a fresh boot paints the
  // coach-marks on the kindling screen instead of the auto-opened Help sheet, and BOTH
  // onboarding flags are written when the tour ends (tour.js closeTour). Help still
  // opens through its own HUD button, exactly as before — never automatically.
  if (helpOpen) stageEl.append(helpPanel());
  // The S1 master-deck viewer, when the player opened it from the HUD. It paints AFTER the
  // phase view like the help sheet, and its `.modal-back` covers the stage, so the run
  // underneath stays untouched (and unclickable) while it is open.
  if (deckOpen) stageEl.append(deckPanel());
  // The S2 card codex, when the player opened it from the HUD. Same placement contract as
  // the deck sheet: it paints after the phase view and its backdrop covers the stage, so
  // the run underneath stays untouched (and unclickable) while it is open.
  if (codexOpen) stageEl.append(codexPanel());
  // The S5 quaff/discard popover, when the player clicked a filled belt chip in combat.
  // Same one-modal-system placement as the sheets above: the backdrop covers the stage,
  // so the choice is the only thing clickable while it is open. A slot whose row the
  // snapshot no longer carries (a repaint raced a quaff/discard) is STALE: the flag is
  // dropped HERE, in the paint sink where the one-paint flags are consumed, instead of
  // from inside beltPanel mid-render (S5 review P3) — the next repaint is what clears it.
  if (beltOpenSlot !== null) {
    if ((snap.belt ?? []).some((r) => r.slot === beltOpenSlot)) stageEl.append(beltPanel());
    else setBeltOpenSlot(null);
  }
  // The product tour's paint-path hook (ONBOARDING-TOUR spec): it may open on a fresh
  // boot, follow a phase change, and re-measure its shade ring against THIS paint's
  // layout. It repaints nothing and owns no rule (see tour.js tourSync).
  tourSync(phaseChanged);
  // The arriving VICTORY or DEFEAT panel takes the caret, so a keyboard player lands on
  // Restart instead of at the top of the document. Best effort, and never a rule.
  if (endFocusPending) {
    setEndFocusPending(false);
    const first = stageEl.querySelector ? stageEl.querySelector('button') : null;
    if (first && typeof first.focus === 'function') { try { first.focus(); } catch { /* best effort */ } }
  }

  /* Release the one-paint flags, and carry the enemy list forward. `prevEnemies` is the
     renderer's own record of who was alive a moment ago — the ONLY thing `act()` asks it
     for is which enemy has just left the row. It decides how a departure is shown and can
     change neither what is legal nor what an outcome is. */
  setLastPlayerStatuses(statusKeysNow);
  setLastEnemyStatuses(enemyStatusKeysNow);
  setLastTravel(travelPending);
  setPrevEnemies((snap.enemies || []).map((e) => ({ index: e.index, id: e.id, name: e.name })));
  if (dealPending || dyingThisPaint.length > 0 || travelPending) {
    laterPaint(() => { setDealPending(false); setDyingThisPaint([]); setLastTravel(null); setEnteringIds(new Set()); }, 0);
  } else {
    // Nothing else to release, but the entrance set is only ever true for the paint that
    // created it, so it is dropped on the next microtask regardless.
    laterPaint(() => { setEnteringIds(new Set()); }, 0);
  }
}
