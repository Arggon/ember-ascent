// src/web/floats.js — the per-paint effect DOM: floating numbers, hit classes, ghosts.
//
// Everything here turns the `bursts` list into nodes that belong to a SPECIFIC body: a
// floater is appended INSIDE the enemy card it hit (`.efx`), so it is aligned by layout
// and no coordinate can be measured wrong; a dying enemy's ghost is drawn by the SAME
// `dyingRow()` builder in both `combatView()` and the end-of-run hold, so the two cannot
// drift apart. Under reduced motion the numbers and ghosts are simply absent — their
// facts stay on the HP bars.

import { animMs, animSpeed, bursts, flash, lastPlayerStatuses, reducedMotion } from './runtime.js';
import { el } from './dom.js';
import { HERO_THROWS, THROW_MS, heroMove, signatureFor } from './hero-moves.js';
import { enemyMarkup } from './stage-art.js';
import { t } from './i18n.js';

/**
 * The floating marker for one enemy, appended INSIDE that enemy's own card.
 *
 * The readable number is the damage dealt or the block gained: the HP or block delta
 * between the two kernel snapshots of this action. The bar still shows the remaining
 * total. A fully absorbed hit says "absorbed", because a 0 would contradict a bar that
 * did not move. The glyph (`·` `◆` `✸`) scales with the amount.
 */
export function floatHold() {
  if (reducedMotion) return '';
  return animSpeed === 0 ? ' is-static' : ' is-queued';
}

export function floatNode(b) {
  const span = el('span', { cls: 'efloat' });
  if (b.kind === 'absorbed') {
    span.className = 'efloat efloat-absorbed' + floatHold();
    span.append(el('b', { text: '⛨' }), el('b', { text: t('fx.absorbed') }));
    return span;
  }
  const tier = b.tier || 1;
  const glyph = tier >= 3 ? '✸' : tier >= 2 ? '◆' : '·';
  const tone = b.tone === 'block' ? ' efloat-block' : '';
  span.className = `efloat efloat-g${tier}${tone}` + floatHold();
  const text = b.tone === 'block' ? `+${b.amount}` : `−${b.amount}`;
  span.append(el('b', { text: glyph }), el('b', { text }));
  if (b.defeated) span.append(el('b', { text: t('fx.down') }));
  return span;
}

/**
 * UX-2: the NAMED damage float for one attacker of the sequenced enemy turn — who hit
 * the hero, and for what. The name is the kernel's own enemy name (carried on the burst
 * from the before-snapshot); the number is what that attacker's hits dealt THROUGH block
 * according to the kernel's own `enemy_attack` events, or the honest "absorbed" when
 * block ate the whole attack (a 0 would contradict an unchanged HP bar). Two containers
 * share the node: the animated form sits on the fx layer above the hero (fx.js places
 * it at the impact beat), the »-speed form sits in the hero's own effect box (heroEfx).
 * @param {{name: string, dealt: number, blocked: number, hits: number}} a one attacker
 * @param {string} [hold] extra class for the queued/static mechanism (`floatHold()`)
 */
export function strikeFloatNode(a, hold = '') {
  const absorbedByBlock = a.dealt <= 0;
  const tier = absorbedByBlock ? 1 : a.dealt >= 16 ? 3 : a.dealt >= 8 ? 2 : 1;
  const glyph = absorbedByBlock ? '⛨' : tier >= 3 ? '✸' : tier >= 2 ? '◆' : '·';
  // className, not a cls: template — the same shape floatNode uses, so the tier ladder
  // stays an assembled string (the surface-art checker resolves cls: templates only).
  const span = el('span', { cls: 'efloat' });
  span.className = `efloat efloat-g${tier} efloat-named${hold}`;
  span.append(el('b', { cls: 'efloat-who', text: a.name }));
  span.append(el('b', { text: glyph }));
  span.append(el('b', { text: absorbedByBlock ? t('fx.absorbed') : `−${a.dealt}` }));
  if (a.hits > 1 && !absorbedByBlock) span.append(el('b', { cls: 'efloat-hits', text: `${a.hits}×` }));
  return span;
}

/**
 * The enemy's hit reaction, as a class on its own card. `flash.n` is part of the class
 * name so that a repaint for an unrelated reason reproduces the identical string — a new
 * class string only ever appears when a hit genuinely happened. Colour is not the carrier:
 * the card also shifts (see `juice-hit-flash`), and the HP total changes. Under reduced
 * motion no class is emitted at all, and the HP bar alone reports the hit.
 */
export const hitClass = (index) => (flash.hits.includes(index) && !reducedMotion ? ` damaged damaged-${flash.n}` : '');

/**
 * The per-enemy effect box. It is created on every paint (so it is always inside the
 * current enemy card) and holds this enemy's floaters. Because it is a child of the card,
 * a floater is aligned to the enemy by layout — there is no coordinate to get wrong.
 */
export function efxBox(index) {
  const box = el('span', { cls: 'efx' });
  if (reducedMotion) return box;
  for (const b of bursts) {
    if (b.enemy !== index) continue;
    if (b.kind !== 'float' && b.kind !== 'absorbed') continue;
    box.append(floatNode(b));
  }
  return box;
}

export function heroEfx() {
  const box = el('span', { cls: 'efx' });
  if (reducedMotion) return box;
  for (const b of bursts) {
    if (b.kind !== 'hero-float') continue;
    // UX-2: on a sequenced enemy turn the aggregate damage float is silent — the
    // per-attacker NAMED floats carry the numbers instead (see strikeFloatNode).
    if (b.silent) continue;
    box.append(floatNode(b));
  }
  // UX-2, the » fast form: with the choreography skipped the per-attacker facts still
  // land — each attacker's named float, stacked, in the order the attacks resolved.
  // (The box is a 0-height absolute strip, so the stack is spaced by an inline top.)
  if (animSpeed === 0) {
    const turn = bursts.find((b) => b.kind === 'enemy-turn');
    if (turn) {
      turn.attacks.forEach((a, i) => {
        const node = strikeFloatNode(a, ' is-static');
        if (node.style) node.style.top = `${i * 44}px`;
        box.append(node);
      });
    }
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
export function freshStatusKeys(list) {
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
export function deathHoldMs(d) {
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
export function dyingCard(d) {
  // A boss says so: its collapse is the biggest single event in the run, and the word is
  // what makes the difference readable with no motion at all (the row is also the only
  // place the boss's name is still on screen, its card having left the snapshot).
  // I18N-1: one key for the word, upper-cased here for the ghost's shout.
  const label = d.boss ? t('fx.bossDown') : t('fx.down').toUpperCase();
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

export function dyingRow(dying, row = el('div', { cls: 'enemies' })) {
  for (const d of dying) row.append(dyingCard(d));
  return row;
}
