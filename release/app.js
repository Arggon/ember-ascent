// src/web/app.js — the browser surface's BOOT: create the run, wire the keyboard, paint.
//
// The surface is a pure VIEW on the kernel. It imports the SAME DOM-free controller the
// CLI-equivalence test drives (src/surface/gui/controller.js), reads
// controller.snapshot() (a value model the kernel computes), and paints it. It contains
// NO game rules: it never adds damage, never decides what is legal, never mutates state.
// When it needs to know something (is this card playable? what does this enemy intend?
// which node can I reach?), it reads a field the kernel already answered.
//
// The surface is split into focused modules beside this one:
//   runtime.js       element roots, motion/timer plumbing, shared presentation state
//   dom.js           the el() builder, toast/announce, keyword text, small helpers
//   glyphs.js        every inline-SVG mark and the name->mark tables
//   hero-moves.js    the per-card movement/throw/signature tables (a mirror of cards.json)
//   targeting.js     the aiming flow (pendingSlot/aimed live here)
//   actions.js       act() — the ONE dispatch path — plus newGame and the hero/path switch
//   run-history.js   localStorage ledger, scoring screens, unlock narration
//   hud.js           the status bar and the help/glossary sheet
//   floats.js        floating numbers, hit classes, dying-enemy ghosts
//   fx.js            the FX queue and its dispatcher (the persistent #fx-layer)
//   fx-signatures.js one function per per-card signature effect
//   combat-view.js   the fight screen (hero, enemies, hand, controls)
//   map-view.js      the ascent map
//   reward-view.js / kindling-view.js / rest-view.js / end-view.js  the other screens
//   render.js        the one paint path and the shared page() wrapper
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

import { createController } from './src/surface/gui/controller.js';
import { ctl, seedFromUrl, setCtl, setSnap, snap } from './runtime.js';
import { biomeChoice, heroChoice, act, newGame } from './actions.js';
import { cancelTargeting, clickCard, pendingSlot, pickTarget } from './targeting.js';
import { render } from './render.js';

/* ------------------------------------------------------------- keyboard bonus */

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

/** Expose the controller for a curious viewer (read-only use). Not required by the game. */
window.__dlb = { controller: () => ctl, snapshot: () => snap };

// The first run of the page: same construction newGame() uses, minus the profile
// narrowing (the very first run of a fresh browser has an empty history anyway).
setCtl(createController({ run: { seed: seedFromUrl(), character: heroChoice, biome: biomeChoice, kindling: true, tempers: true, quests: true } }));
setSnap(ctl.snapshot());
render();
