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
  setLastTravel,
  setPaintedPhase,
  setPhaseArriving,
  setPrevEnemies,
  snap,
  stageEl,
  DEAL,
  animMs,
} from './runtime.js';
import { el } from './dom.js';
import { enemyLook } from './glyphs.js';
import { signatureFor } from './hero-moves.js';
import { backdropMarkup } from './stage-art.js';
import { dyingRow } from './floats.js';
import { endTargeting, pendingCard, pendingSlot } from './targeting.js';
import { renderHud, helpPanel, helpOpen, HELP_SEEN_KEY, deckPanel, deckOpen, codexPanel, codexOpen, beltOpenSlot, beltPanel, setBeltOpenSlot } from './hud.js';
import { heroFigure, combatView } from './combat-view.js';
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
  // The first-run explanation, shown once. A player who has never seen the game should
  // not have to guess what "3 Energy" or an enemy's announced attack means.
  let seen = false;
  try { seen = localStorage.getItem(HELP_SEEN_KEY) === '1'; } catch { seen = true; }
  // The battle moved on underneath a target step (the hand changed, the fight ended): the
  // step is no longer about anything real, so it ends silently rather than aiming at a
  // stale slot.
  if (helpOpen || !seen) stageEl.append(helpPanel());
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
