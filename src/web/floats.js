// src/web/floats.js — the per-paint effect DOM: floating numbers, hit classes, ghosts.
//
// Everything here turns the `bursts` list into nodes that belong to a SPECIFIC body: a
// floater is appended INSIDE the enemy card it hit (`.efx`), so it is aligned by layout
// and no coordinate can be measured wrong; a dying enemy's ghost is drawn by the SAME
// `dyingRow()` builder in both `combatView()` and the end-of-run hold, so the two cannot
// drift apart. Under reduced motion the numbers and ghosts are simply absent — their
// facts stay on the HP bars.

import { animMs, animSpeed, bursts, flash, lastEnemyStatuses, lastPlayerStatuses, reducedMotion } from './runtime.js';
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
  // The hero's OWN bleed tick ("golpes discretos"): HP straight off, one float per tick,
  // in the tick language statusFloatNode uses (the word names the status; the number is
  // the HP the kernel's `bleed_tick` event reports).
  if (b.tone === 'tick') {
    span.className = 'efloat efloat-status is-down efloat-tick' + floatHold();
    span.append(el('b', { text: `−${b.amount}` }));
    span.append(el('b', { cls: 'efloat-status-word', text: b.status === 'poison' ? t('fx.poison') : t('fx.bleed') }));
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
 * UX-2: the NAMED damage float for one GOLPE of the sequenced enemy turn — who struck,
 * and what this one strike did. The name is the kernel's own enemy name (carried on the
 * burst from the before-snapshot); the number is what THIS strike dealt THROUGH block
 * according to the kernel's own `enemy_attack` event — one float per golpe, no per-
 * attacker accumulation and no "3×" suffix (the "golpes discretos" ruling: the turn
 * already plays one beat per strike, so each float is one strike's fact). The honest
 * words: "absorbed" when block ate the whole strike, and the parry word when the
 * defender's parry refused it outright (`parried: true` on the event — dealt 0, the
 * block pool untouched). Two containers share the node: the animated form sits on the
 * fx layer above the hero (fx.js places it at the strike's own impact beat), the
 * »-speed form sits in the hero's own effect box (heroEfx).
 * @param {{name: string, dealt: number, blocked: number, parried?: boolean}} a one strike
 * @param {string} [hold] extra class for the queued/static mechanism (`floatHold()`)
 */
export function strikeFloatNode(a, hold = '') {
  // className, not a cls: template — the same shape floatNode uses, so the tier ladder
  // stays an assembled string (the surface-art checker resolves cls: templates only).
  const span = el('span', { cls: 'efloat' });
  // THE PARRY PROC reads as its own fact, not as a zero: the strike was refused
  // outright, so the float wears the parry word and the tier ladder stays out.
  if (a.parried) {
    span.className = `efloat efloat-parried efloat-named${hold}`;
    if (a.name) span.append(el('b', { cls: 'efloat-who', text: a.name }));
    span.append(el('b', { text: '✦' }));
    span.append(el('b', { text: t('fx.parried') }));
    return span;
  }
  const absorbedByBlock = a.dealt <= 0;
  const tier = absorbedByBlock ? 1 : a.dealt >= 16 ? 3 : a.dealt >= 8 ? 2 : 1;
  const glyph = absorbedByBlock ? '⛨' : tier >= 3 ? '✸' : tier >= 2 ? '◆' : '·';
  span.className = `efloat efloat-g${tier} efloat-named${hold}`;
  if (a.name) span.append(el('b', { cls: 'efloat-who', text: a.name }));
  span.append(el('b', { text: glyph }));
  span.append(el('b', { text: absorbedByBlock ? t('fx.absorbed') : `−${a.dealt}` }));
  return span;
}

/**
 * UX-9b: the GUARD beat's float — the block the enemy just gained, on that enemy. It is the
 * same readable figure the existing block-gain float prints (`+N` with the ⛨ glyph), built
 * from the kernel's own `enemy_block` amount rather than from a snapshot delta, so a guard
 * beat reads on the beat instead of arriving with the next paint's diff. No words: the
 * glyph is the noun, the number is the fact.
 * @param {{amount: number}} s one block step of a turn plan
 * @param {string} [hold] extra class for the queued/static mechanism (`floatHold()`)
 */
export function guardFloatNode(s, hold = '') {
  const span = el('span', { cls: 'efloat' });
  span.className = `efloat efloat-g${s.amount >= 8 ? 2 : 1} efloat-block${hold}`;
  span.append(el('b', { text: '⛨' }), el('b', { text: `+${s.amount}` }));
  return span;
}

/**
 * UX-9b: the STATUS beat's float — the stacks a turn just applied, on the body they landed
 * on. Decoration only: the glyph and the kernel's own stack count, no invented wording, and
 * the status chip on that body already carries its name and explanation (combat-view). The
 * `-`/`+` sign states the direction (an enemy self-buff adds, a hex on the hero takes), and
 * the class carries the direction for the stylesheet.
 *
 * THE TICKS ("golpes discretos" slice): a step whose `kind` is 'tick' is a bleed/poison
 * tick the kernel emitted as its own event (`bleed_tick` / `poison_tick`) — HP straight
 * off the holder, block and parry never in the way. The float is the HP lost with the
 * status's own word in small type, always downward (HP only ever leaves): the same
 * `efloat-status` language, one class (`efloat-tick`) so the stylesheet can set its size.
 * @param {{status: string, stacks: number, to: 'player'|'enemy', kind?: string,
 *          amount?: number}} s one status (or tick) step of a turn plan
 * @param {string} [hold] extra class for the queued/static mechanism (`floatHold()`)
 */
export function statusFloatNode(s, hold = '') {
  const span = el('span', { cls: 'efloat' });
  if (s.kind === 'tick') {
    span.className = `efloat efloat-status is-down efloat-tick${hold}`;
    span.append(el('b', { text: `−${s.amount}` }));
    span.append(el('b', { cls: 'efloat-status-word', text: s.status === 'poison' ? t('fx.poison') : t('fx.bleed') }));
    return span;
  }
  const up = s.to !== 'player';
  span.className = `efloat efloat-g1 efloat-status ${up ? 'is-up' : 'is-down'}${hold}`;
  span.append(el('b', { text: up ? '▲' : '▼' }), el('b', { text: `${up ? '+' : '−'}${s.stacks}` }));
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
 *
 * THE GOLPE FLOATS ("golpes discretos"): a play whose events carry per-strike `damage`
 * facts (actions.js `strike` bursts) is sequenced on the fx layer at NORMAL speed —
 * one float per golpe, on the strike's own beat — so the box prints them ONLY in the
 * » fast form (animSpeed === 0), stacked like heroEfx stacks the turn's floats. Under
 * reduced motion the box stays empty and the facts remain on the HP bars.
 */
export function efxBox(index) {
  const box = el('span', { cls: 'efx' });
  if (reducedMotion) return box;
  for (const b of bursts) {
    if (b.enemy !== index) continue;
    if (b.kind !== 'float' && b.kind !== 'absorbed') continue;
    box.append(floatNode(b));
  }
  if (animSpeed === 0) {
    let i = 0;
    for (const b of bursts) {
      if (b.kind !== 'strike' || b.enemy !== index) continue;
      const node = strikeFloatNode(b, ' is-static');
      if (node.style) node.style.top = `${i * 40}px`;
      i += 1;
      box.append(node);
    }
  }
  return box;
}

export function heroEfx() {
  const box = el('span', { cls: 'efx' });
  if (reducedMotion) return box;
  // The hero's own bleed ticks ride the same box as the numbers: one float per tick,
  // stacked so consecutive ticks (a multi-hit card ticks per golpe) read separately.
  let tickAt = 0;
  for (const b of bursts) {
    if (b.kind !== 'hero-float') continue;
    // UX-2: on a sequenced enemy turn the aggregate damage float is silent — the
    // per-attacker NAMED floats carry the numbers instead (see strikeFloatNode).
    if (b.silent) continue;
    const node = floatNode(b);
    if (b.tone === 'tick' && node.style) node.style.top = `${tickAt++ * 40}px`;
    box.append(node);
  }
  // UX-2, the » fast form: with the choreography skipped the per-attacker facts still
  // land — each attacker's named float, stacked, in the order the attacks resolved.
  // (The box is a 0-height absolute strip, so the stack is spaced by an inline top.)
  // The "golpes discretos" slice made `attacks` PER STRIKE, so this stack is one float
  // per golpe — the »-speed form of the beat-per-strike turn.
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
 * The enemy variant of `freshStatusKeys` (UX-9 D3): which of THIS enemy's status keys were
 * not on the same enemy at the previous paint, read from the per-index map the renderer
 * publishes. Keyed by `index` rather than by position, so an enemy that shifted up the row
 * after a death is still diffed against itself and does not re-juice its whole chip row.
 * The player path above is untouched and keeps its own list.
 *
 * @param {number} index the enemy's stable snapshot index
 * @param {Array<{key: string}>} list its statuses on the paint being built
 * @returns {Set<string>} the keys that just landed
 */
export function freshEnemyStatusKeys(index, list) {
  const prev = new Set((lastEnemyStatuses instanceof Map ? lastEnemyStatuses.get(index) : null) || []);
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

/** The collapsing card for one just-dead enemy. `data-death-index` carries the burst's
 *  `enemy` — the victim's STABLE kernel index, not its row slot: the kernel keeps dead
 *  rows in its enemy list while snapshots omit them, so after one death has left the
 *  painted row the two drift apart (the slot the ghost sits in is the burst's `slot`).
 *  The fx layer matches on exactly this value — `card-fly.enemy` resolves to the same
 *  stable index on a kill — so the hammer lands on the body it was still flying toward. */
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
