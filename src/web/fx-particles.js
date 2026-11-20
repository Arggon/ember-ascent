// src/web/fx-particles.js — WAAPI ember particles: the one emitter, and its cancellation.
//
// Every effect node on `#fx-layer` before this module lived and died by `later()` timers
// (fx-add.js) — which `clearFxTimers()` sweeps on a new run, and which the feel queue's
// generation guard retires on the next action. Particles cannot ride that clock: their
// removal is driven by the ANIMATION itself (`element.animate()`), so they own no timer
// to sweep and need their own bookkeeping instead — a Set of live records cancelled by
// generation (a newer action), cancelled outright (» / a new run), and self-removed on
// finish. The Set is the ONLY module state here; nothing else is written.
//
// Placement truth is the same one the thrown hammers use: the caller MEASURES the struck
// unit's box once (one `getBoundingClientRect` per burst — fx.js's emberImpact) and hands
// the burst a viewport point. The layer is `position: fixed; inset: 0`, so viewport rects
// map 1:1; `placeAt` writes static `left/top` and the animation moves the particle with
// `transform` alone. Nothing here ever measures.
//
// Motion gates (reduced motion, the » dock) are checked FIRST, so a gated surface never
// even touches the DOM: the stylesheet's reduce block hides `#fx-layer` entirely, but
// `element.animate()` would still schedule work behind it — the gate is the belt, the
// hidden layer the braces.

import { el, placeAt } from './dom.js';
import { fxEl, reducedMotion, animSpeed, animMs, PARTICLES, setOnSkipFx } from './runtime.js';

/**
 * The ember tones, one class per step of the heelburst embers' own palette (the warm
 * ramp #ffd9a0 → #ff7a24 → #fff3d0 the stylesheet paints). `hot` is the white-hot head
 * of the ramp; a burst draws from the WHOLE palette so the scatter reads as embers, not
 * as a flat fill.
 */
export const EMBER_PALETTE = ['fx-ember-a', 'fx-ember-b', 'fx-ember-c', 'fx-ember-hot'];

/** The live particles, one record `{ node, anim, gen }` each — the cancellation ledger. */
const emberLive = new Set();

/**
 * Scatter ember particles radially from a measured point. One span per particle on the
 * persistent layer, each driven by one `element.animate()` over transform+opacity ONLY
 * (the compositor's own properties — no layout can be triggered mid-flight), positioned
 * at `at` with static left/top and moved by the keyframes' translate.
 *
 * Angle convention: `biasDeg` 0 points straight DOWN the screen, positive angles rotate
 * toward the right (dx = sin, dy = cos); the fan spans `biasDeg ± spreadDeg / 2`. The
 * default `spreadDeg` 360 is the full radial an impact reads as; a heel-style kick asks
 * for a narrow fan around 0 — low and sideways, never upward.
 *
 * The distance each particle travels is drawn from `[speedMin, speedMax]` px-per-second
 * over the BASE life, so the scatter's REACH is dock-independent; the duration is
 * `animMs(lifeMs)`, so the dock scales the SPEED exactly like every other beat.
 *
 * Lifecycle: `anim.onfinish` AND `anim.oncancel` remove the node and drop the record
 * (whichever lands first — a skip cancels, an old age finishes), so ten bursts in a row
 * leave nothing behind. `anim.finished` REJECTS on cancel — the catch swallows the
 * rejection the platform raises for the cancellation we ourselves asked for.
 *
 * @param {{x: number, y: number}|null} at the measured impact point in layer coordinates,
 *   already measured by the caller (null means no measurable host: no burst)
 * @param {{count?: number, lifeMs?: number, speedMin?: number, speedMax?: number,
 *   spreadDeg?: number, biasDeg?: number, palette?: string[], gen?: number|null}} [opts]
 * @returns {number} how many particles were spawned (0 when gated or unmeasurable)
 */
export function emberBurst(at, opts = {}) {
  if (!at || !fxEl || reducedMotion || animSpeed === 0) return 0;
  const count = Math.max(12, Math.min(30, opts.count ?? PARTICLES.count));
  const palette = Array.isArray(opts.palette) && opts.palette.length > 0 ? opts.palette : EMBER_PALETTE;
  const spread = typeof opts.spreadDeg === 'number' ? opts.spreadDeg : 360;
  const bias = typeof opts.biasDeg === 'number' ? opts.biasDeg : 0;
  const baseLife = opts.lifeMs ?? PARTICLES.lifeMs;
  const dur = animMs(baseLife);
  const speedMin = opts.speedMin ?? PARTICLES.speedMin;
  const speedMax = opts.speedMax ?? PARTICLES.speedMax;
  for (let i = 0; i < count; i += 1) {
    const tone = palette[Math.floor(Math.random() * palette.length)] || palette[0];
    const node = el('span', { cls: `fx-ember ${tone}`, attrs: { 'aria-hidden': 'true' } });
    placeAt(node, at);
    fxEl.append(node);
    const angle = (bias + (Math.random() - 0.5) * spread) * (Math.PI / 180);
    const dist = (speedMin + Math.random() * (speedMax - speedMin)) * (baseLife / 1000);
    const dx = Math.round(Math.sin(angle) * dist);
    const dy = Math.round(Math.cos(angle) * dist);
    const anim = node.animate([
      { transform: 'translate(0px, 0px) scale(0.4)', opacity: 0 },
      { transform: `translate(${Math.round(dx * 0.45)}px, ${Math.round(dy * 0.45)}px) scale(1.1)`, opacity: 1, offset: 0.22 },
      { transform: `translate(${dx}px, ${dy}px) scale(1.1)`, opacity: 0 },
    ], { duration: dur, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)', fill: 'both' });
    const rec = { node, anim, gen: opts.gen ?? null };
    emberLive.add(rec);
    const retire = () => {
      node.remove();
      emberLive.delete(rec);
    };
    anim.onfinish = retire;
    anim.oncancel = retire;
    if (anim.finished && typeof anim.finished.catch === 'function') anim.finished.catch(() => {});
  }
  return count;
}

/**
 * Cancel EVERY live ember animation — the » fast form's hook (runtime.skipAnim) and the
 * new-run reset (actions.newGame, whose `fxEl.replaceChildren()` empties the layer but
 * could not reach the records). Cancel fires `oncancel`, which removes the node and
 * drops the record, so the Set empties as a side effect of the loop; the loop walks a
 * snapshot because the handlers mutate the Set under it.
 */
export function cancelEmberParticles() {
  for (const rec of [...emberLive]) rec.anim.cancel();
}

/**
 * Retire the particles of every generation BUT `gen` — one call per action, from
 * dispatchFx right after the generation is captured, so between two actions no ember of
 * the old action is still flying (within one action the multi-golpe bursts overlap by
 * design: a paced life of 1.4s against a paced beat of 1.0s keeps at most two bursts
 * alive, ≤ 30 nodes each).
 * @param {number} gen the action generation that owns the survivors
 */
export function retireEmberGen(gen) {
  for (const rec of [...emberLive]) {
    if (rec.gen !== gen) rec.anim.cancel();
  }
}

/** How many ember particles are alive right now — the tests' leak probe. */
export function liveEmberCount() {
  return emberLive.size;
}

// The skip hook is registered at module load, the same one-time self-registration the
// wiring hooks' owners (render.js, targeting.js) perform (runtime.js WIRING HOOKS).
setOnSkipFx(cancelEmberParticles);
