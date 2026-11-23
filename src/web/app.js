// src/web/app.js — the browser surface's BOOT: create the run, wire the keyboard, paint.
//
// The surface is a pure VIEW on the kernel. It imports the SAME DOM-free controller the
// CLI-equivalence test drives (src/surface/gui/controller.js), reads
// controller.snapshot() (a value model the kernel computes), and paints it. It contains
// NO game rules: it never adds damage, never decides what is legal, never mutates state.
// When it needs to know something (is this card playable? what does this enemy intend?
// which node can I reach?), it reads a field the kernel already answered.
//
//
// All art is CSS or inline SVG built with DOM calls: no image files beyond the local
// sprites, no external assets, no fonts fetched over the network. Silhouettes and glyphs
// are keyed off names and types the SNAPSHOT already carries (`e.name`, `card.type`,
// `n.type`, `intent.kind`) — decoration only, never a rule.
//
// Interaction is mouse/pointer first: clicking a card plays it, clicking an enemy
// intent does nothing (intent is information), clicking a map node travels, and the
// End Turn button is always present. Keyboard shortcuts exist but are never required.
//
// This module boots on import (index.html loads it as the page's only script): it
// creates the first controller for the URL's seed/hero/biome, registers the keyboard
// listener, exposes `window.__dlb` for a curious viewer, and paints the first screen.

import { ctl, snap, busyReason } from './runtime.js';
import { audioState } from './audio.js';
import { biomeChoice, heroChoice, act, newGame } from './actions.js';
import { cancelTargeting, clickCard, pendingSlot, pickTarget } from './targeting.js';
import { deckOpen, toggleDeck, codexOpen, toggleCodex, beltOpenSlot, toggleBelt, helpOpen, toggleHelp } from './hud.js';
import { tourOpen, tourStep, freshOnboarding, tourNext, tourBack, dismissTour } from './tour.js';
// Imported for its LOAD-BEARING side effect, not its export: render.js registers itself
// as the paint sink (setRepaint) at load, and the boot's newGame() below repaints
// through that hook. A tree-shake or a "cleanup" of this line blanks the first screen.
import { render } from './render.js';
void render;


document.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key;

  // --- the product tour owns the keyboard while it shows (ONBOARDING-TOUR spec) ----
  // It stands BEFORE the sheet guards: on a fresh boot the tour IS the first-run surface,
  // and no sheet, no card, no turn and no run may be driven from behind its shades.
  // freshOnboarding() covers the keystroke that races the boot paint. Escape dismisses
  // (both flags, tour.js), Enter/→ advance, ← steps back; everything else is swallowed
  // the same way the Help guard swallows — native Tab still moves focus. Space is
  // deliberately NOT bound: it is End Turn muscle memory, and training a conflict here
  // would hurt more than the shortcut helps.
  // ONE exception (review round 1 of the onboarding rework): Enter on a focused card
  // BUTTON activates that button natively — the guard's preventDefault used to cancel
  // the activation, so Enter on Back/Skip ran tourNext instead of the focused control.
  // Enter anywhere else in the card (the card div an action step takes the caret with)
  // still advances.
  if (tourOpen || freshOnboarding()) {
    if (k === 'Escape' || k === 'Esc') { ev.preventDefault(); dismissTour(); return; }
    if (k === 'Enter' && document.activeElement?.tagName === 'BUTTON'
      && document.activeElement.closest('#tour-layer')) return;
    if (k === 'Enter' || k === 'ArrowRight') { ev.preventDefault(); tourNext(); return; }
    if (k === 'ArrowLeft') { ev.preventDefault(); tourBack(); return; }
    return;
  }

  // --- a sheet owns the keyboard while it is open -------------------------------------------
  // ONE contract for all three sheets: while a sheet is open every key is swallowed
  // except that sheet's own toggle (d for deck, k for codex) and Escape — so no OTHER
  // sheet, no card, no turn and no run can be driven from behind an overlay. The
  // open-sheet guards stand BEFORE the open-toggle lines below: a toggle line that ran
  // first would leak its key into a sheet that is already open (d used to stack the
  // deck sheet on top of the codex). (Each panel is a dialog, so its Close button and
  // backdrop are the mouse paths out.)
  // The Help sheet is the strictest case (POLISH round, the E8b class one layer down):
  // it has no toggle key of its own, so Escape is its ONLY key — d/k would stack sheets
  // on it and `n` used to discard a run behind it (the footer's own New Run button is
  // the deliberate way out). The guard covers the sheet however it came up — always the
  // player's own click now: the first-run paint it also covered is the TOUR's surface
  // (ONBOARDING-TOUR spec §4.4), so the seen-flag read and the Escape write it carried
  // live no more. It stands before the open-toggle lines: if Help is somehow open over
  // another sheet, the topmost sheet is the one the keyboard talks to.
  if (helpOpen) {
    if (k === 'Escape' || k === 'Esc') { ev.preventDefault(); toggleHelp(false); }
    return;
  }
  if (deckOpen) {
    if (k === 'Escape' || k === 'Esc' || k === 'd' || k === 'D') { ev.preventDefault(); toggleDeck(false); }
    return;
  }
  if (codexOpen) {
    if (k === 'Escape' || k === 'Esc' || k === 'k' || k === 'K') { ev.preventDefault(); toggleCodex(false); }
    return;
  }
  // The S5 quaff/discard popover owns the keyboard while it is open, the same contract:
  // Escape closes (keeping the potion), everything else is swallowed so no card, no turn
  // and no run can be driven from behind the overlay (the E8b class). The popover's own
  // buttons stay natively keyboard-operable (Tab + Enter) without this handler.
  if (beltOpenSlot !== null) {
    if (k === 'Escape' || k === 'Esc') { ev.preventDefault(); toggleBelt(null); }
    return;
  }
  if (k === 'd' || k === 'D') { ev.preventDefault(); toggleDeck(true); return; }
  if (k === 'k' || k === 'K') { ev.preventDefault(); toggleCodex(true); return; }

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

  // --- the UX-5 input gate owns combat's shortcuts while an animation is landing -----
  // One contract, the open-sheet guard's shape: while the surface is busy — a play's
  // animation (pose, throw, signature, hit-stop), the enemy-turn sequence, a hand
  // mid-deal, a kill hold — every combat shortcut is swallowed, because the hand and
  // the End Turn button are painted locked for the same span. The kernel never sees
  // the key: the gate is presentation only (runtime.busyReason, derived from the same
  // lifetimes the effects use), and under reduced motion it never engages at all.
  // Sheets (d/k and the modal guards above) and the targeting step stay live; the speed
  // dock and the backdrop's skip stay clickable, so » is always reachable.
  if (busyReason()) {
    if (snap.phase === 'combat' || snap.phase === 'reward' || snap.phase === 'ended') {
      ev.preventDefault();
      return;
    }
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

/** Expose the controller for a curious viewer (read-only use). Not required by the game.
 *  `busy` publishes the UX-5 input gate's current reason (runtime.busyReason) — the same
 *  presentation truth the hand and End Turn paint — so tooling and the e2e walks can wait
 *  for the surface to take input again instead of guessing at animation lengths. */
window.__dlb = {
  controller: () => ctl,
  snapshot: () => snap,
  busy: () => busyReason(),
  // The product tour's published truth (ONBOARDING-TOUR spec §5.4): walks wait on IT
  // instead of querying the layer's CSS.
  tour: () => ({ open: tourOpen, step: tourStep }),
  // The audio layer's published truth (the sfx slice): the context's state, the toggle
  // and the schedule counters — the e2e anchors its autoplay asserts on IT.
  audio: audioState,
};

// The first run of the page IS newGame() — the exact construction, not a copy of it.
// The old inline build "minus the profile narrowing" was an honesty hole the S2 codex
// ruled out and S10's relic gate made visible: a REVISIT of a veteran browser booted a
// full-table run behind a narrowed profile — the page showed (and dropped, and offered)
// relics the run could not actually get. newGame() reads the same ledger the HUD does,
// so the first paint is already the run this player's profile earned.
newGame();
