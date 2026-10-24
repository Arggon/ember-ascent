// src/web/targeting.js — WHO aims WHERE is not decided here.
//
// The engine owns the target index; this module only collects the player's choice and
// submits it in the form the engine already accepts. `pendingSlot`/`aimed` live here
// because only the functions in this file ever write them; everything else reads them
// through the live ES-module binding.
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

import { snap, stageEl } from './runtime.js';
import { announce, toast } from './dom.js';
import { act } from './actions.js';
import { render } from './render.js';

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
export let pendingSlot = null;
/** The 1-based LIVING-enemy slot the pointer, focus or keyboard currently points at. */
export let aimed = null;

/**
 * True when this card needs the player to pick an enemy.
 * The kernel now supplies `card.target` ('enemy', 'all', 'self', 'random_enemy', 'none'), so
 * this reads the rule instead of guessing from the card type. The type-based guess is kept
 * only as a fallback for a snapshot that predates the field.
 * @param {any} card a snapshot hand card
 * @returns {boolean}
 */
export function needsTarget(card) {
  if (typeof card.target === 'string' && card.target.length > 0) return card.target === 'enemy';
  return card.type === 'attack';
}

/** The card waiting for a target, or null when the hand has moved on under us. */
export function pendingCard() {
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
export function targetCommand(card, k) {
  if (k == null) return card.slot;
  // Prefer the engine-supplied id for this exact target when it is present, so the two
  // sides can never disagree about how a target is spelled.
  const known = (card.targets || []).find((t) => t.index === k);
  return known ? known.actionId : `${card.slot}_${k}`;
}

/** The spoken description of one enemy, including its telegraphed intent. */
export function enemyLabel(e, position, targeting) {
  const total = snap.enemies.length;
  const intent = String(e.intent.text || e.intent.label || '').replace(/\.\s*$/, '');
  const say = intent ? intent.charAt(0).toLowerCase() + intent.slice(1) : 'intent unknown';
  const base = `Enemy ${position + 1} of ${total} — ${e.name}, ${e.hp} of ${e.maxHp} HP, ${say}.`;
  return targeting ? `${base} Press ${position + 1} to target.` : base;
}

/**
 * Every card interaction funnels through here, so the targeting decision lives in ONE
 * place: a card click never plays a target-needing card while several enemies are alive.
 * @param {string} slot the hand slot, e.g. 'p3'
 */
export function clickCard(slot) {
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
export function enableTargeting(slot) {
  pendingSlot = slot;
  aimed = snap.enemies.length > 0 ? 1 : null;
  render();
  const card = snap.hand.find((c) => c.slot === slot);
  announce(`${card ? card.name : 'That card'} needs a target. ${snap.enemies.length} enemies alive. Press 1 to ${snap.enemies.length} to choose one, Escape to cancel.`);
  focusFirstTarget();
}

/** Leave the pending state without playing anything. */
export function cancelTargeting() {
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
export function pickTarget(k) {
  const card = pendingCard();
  if (!card) { cancelTargeting(); return; }
  const cmd = targetCommand(card, k);
  pendingSlot = null;
  aimed = null;
  act(cmd, k);
}

/** Track which candidate the pointer or keyboard is on, and repaint the selected cue. */
export function setAimed(k) {
  if (pendingSlot === null || aimed === k) return;
  aimed = k;
  render();
}

/** Drop the pending state without a toast — used when the turn moves on underneath us. */
export function endTargeting() {
  if (pendingSlot === null) return;
  pendingSlot = null;
  aimed = null;
}

/** Move keyboard focus onto the first legal target once the step appears. */
export function focusFirstTarget() {
  if (!stageEl.querySelector) return;
  const node = stageEl.querySelector('.enemy.targeting');
  if (node && typeof node.focus === 'function') { try { node.focus(); } catch { /* focus is best effort */ } }
}

/** Put focus back on the card a cancelled step came from. */
export function focusSlot(slot) {
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
export function consumeClick(ev) {
  if (ev) ev.__dlbHandled = true;
}
