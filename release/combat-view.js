// src/web/combat-view.js — the fight screen: hero figure, enemy row, hand, controls.
//
// The view paints the LINEUP the stroke was aimed at: a just-killed enemy keeps its slot
// as a collapsing ghost and the survivors keep theirs, so the killing blow reads against
// the target it was aimed at. `heroPose()` owns the precedence rules of the hero's pose
// (hurt outranks the card's movement; a fresh play outranks a hold) and pins the pose
// hold through incidental repaints. The hero's movement is chosen by WHICH card was
// played (hero-moves.js), never only by its type.

import { BIOMES, DEFAULT_BIOME } from './src/kernel/index.js';
import {
  HERO_POSE_MS,
  SPEED_KEY,
  animSpeed,
  bursts,
  dealPending,
  dyingThisPaint,
  enteringIds,
  flash,
  heroMoveHold,
  pileOpen,
  reducedMotion,
  repaint,
  setAnimSpeed,
  setPileOpen,
  setHeroMoveHold,
  skipAnim,
  snap,
} from './runtime.js';
import { el, keywordText } from './dom.js';
import { TEMPER_GLYPH, TYPE_GLYPH, enemyLook, glyphBox } from './glyphs.js';
import { heroMove, isMeleeMove, signatureFor } from './hero-moves.js';
import { backdropMarkup, enemyMarkup, enemyVariant, heroMarkup, attackTier, intentGlyph } from './stage-art.js';
import { cardArtMarkup } from './card-art.js';
import { dyingCard, efxBox, freshStatusKeys, heroEfx, hitClass } from './floats.js';
import { aimed, cancelTargeting, clickCard, consumeClick, enemyLabel, pendingCard, pendingSlot, pickTarget, setAimed } from './targeting.js';
import { act } from './actions.js';
import { page } from './page-frame.js';

export function heroPose() {
  // Precedence: getting hit outranks the card's own movement — a hero who just lost HP
  // flinches, even while playing an attack (and HP-cost cards like bloodletting always
  // read as hurt, never as their HERO_MOVES entry).
  if (bursts.some((b) => b.kind === 'hero-float' && b.tone === 'dmg')) {
    setHeroMoveHold(null);
    return 'hurt';
  }
  // A fresh card play wins over any hold still running from the previous card.
  const move = heroMove(bursts.find((b) => b.kind === 'card-fly'));
  if (move) {
    // Reduced motion and speed 0 skip the animation; do not hold a pose that never plays.
    // The hold length is the CSS animation's own duration (the keyframes do not scale
    // with the JS speed setting), so the pose is never dropped mid-swing on a repaint.
    // A per-card SIGNATURE (HERO_SIGNATURES) may override the pose's base duration.
    const sig = move ? signatureFor(bursts.find((b) => b.kind === 'card-fly')) : null;
    const base = (sig && sig.poseMs) || HERO_POSE_MS[move] || 400;
    if (reducedMotion || animSpeed === 0) setHeroMoveHold(null);
    // `melee` arms the approach (`.hero.is-approach`): a stroke that is not a throw or a
    // cast carries the hero into the enemy lane. fx.js measures the real gap right after
    // the paint and writes it back as `approachX` on this same hold.
    else setHeroMoveHold({ pose: move, start: Date.now(), dur: base, melee: isMeleeMove(move) });
    return move;
  }
  // An incidental repaint (hover, aim) during the hold repaints the SAME pose rather
  // than dropping it: the movement plays out in full exactly once. The window includes
  // the hit-stop beat, which pauses the animation without pausing this clock.
  const held = heroMoveHold;
  if (held && Date.now() < held.start + held.dur + 260) return held.pose;
  if (held) setHeroMoveHold(null);
  const p = snap.player;
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  if (ratio <= 0.35) return 'low';
  return 'idle';
}

export function heroFigure() {
  const p = snap.player;
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  const pose = heroPose();
  const isBellows = snap.character === 'bellows';
  const node = el('div', {
    cls: 'hero' + (ratio <= 0.35 ? ' is-low' : '') + (isBellows ? ' is-bellows' : ''),
    attrs: { role: 'group', 'aria-label': `${snap.characterName || 'Ashwright'}, ${p.hp} of ${p.maxHp} HP, block ${p.block}` },
  });
  const fig = el('div', { cls: `fig pose-${pose}`, attrs: { 'aria-hidden': 'true' } });
  // The stage tree is rebuilt on every paint, which would restart the keyframe from 0%
  // on each hover repaint during the hold. A negative animation-delay resumes the run
  // from where it should be, so the movement stays in phase across repaints.
  const held = heroMoveHold;
  if (held && held.pose === pose && pose !== 'idle') {
    const elapsed = Math.max(0, Date.now() - held.start);
    if (elapsed < held.dur) {
      // Mid-run: resume the keyframe where it should be, so hover repaints do not stutter.
      fig.style.animationDuration = `${held.dur}ms`;
      fig.style.animationDelay = `-${elapsed}ms`;
    } else {
      // Past the end (hit-stop grace): keep the pose class but stop the motion, so a
      // repaint can never replay the swing.
      fig.style.animation = 'none';
    }
  }
  // The MELEE APPROACH rides the same hold on the .hero CONTAINER (not .fig, so it
  // composes with the pose's own keyframes): a measured step into the enemy lane and
  // back, over the pose's full duration. The distance lands after the paint (fx.js
  // measures it and writes --approach-x both live and onto this hold), so a mid-hold
  // repaint re-applies it from here. Reduced motion and speed 0 never arm the hold.
  if (held && held.melee && held.pose === pose) {
    const elapsed = Math.max(0, Date.now() - held.start);
    node.classList.add('is-approach');
    // setProperty is guarded: the fake-DOM test hosts carry a plain style object, and
    // only a real CSSOM can hold custom properties anyway.
    if (node.style.setProperty) {
      node.style.setProperty('--approach-dur', `${held.dur}ms`);
      if (held.approachX != null) node.style.setProperty('--approach-x', `${held.approachX}px`);
    }
    if (elapsed < held.dur) {
      node.style.animationDuration = `${held.dur}ms`;
      node.style.animationDelay = `-${elapsed}ms`;
    } else {
      node.style.animation = 'none';
    }
  }
  fig.innerHTML = heroMarkup(snap.character);
  node.append(fig);
  node.append(el('div', { cls: 'hero-name', text: snap.characterName || 'Ashwright' }));
  node.append(el('div', { cls: 'ehp', text: `${p.hp}/${p.maxHp}` }));
  const bar = el('div', { cls: 'hpbar' }, el('i', {}));
  bar.querySelector('i').style.width = `${Math.max(0, Math.round((p.hp / Math.max(1, p.maxHp)) * 100))}%`;
  node.append(bar);
  if (p.block > 0) node.append(el('div', { cls: 'eblock', text: `⛨ ${p.block}` }));
  node.append(heroEfx());
  return node;
}

function enemyPose(e) {
  // The attack RUN: an enemy whose turn it was just acted — dash across and slam. The
  // burst fires exactly once (when the turn flipped), like the old strike, but the pose
  // reads as travel: anticipation, long dash, impact beat, return.
  if (bursts.some((b) => b.kind === 'enemy-strike' && b.enemy === e.index)) return 'slam';
  if (flash.hits.includes(e.index)) return 'hurt';
  if (e.hp / Math.max(1, e.maxHp) <= 0.35) return 'low';
  if (e.intent && e.intent.kind === 'attack') return 'windup';
  return 'idle';
}

export function intentBadge(e) {
  const kind = e.intent.kind;
  let which = 'buff';
  let tier = 1;
  if (kind === 'attack') {
    tier = attackTier(e.intent.damage);
    which = tier >= 3 ? 'meteor' : tier >= 2 ? 'axe' : 'dagger';
  } else if (kind === 'block') which = 'shield';
  else if (kind === 'debuff') which = 'down';
  const badge = el('div', {
    cls: `intent-badge kind-${kind} tier-${tier}`,
    attrs: { title: e.intent.text || e.intent.label || '', 'aria-hidden': 'true' },
  });
  badge.innerHTML = intentGlyph(which);
  if (kind === 'attack') {
    // `damage` is the intent's TOTAL (all hits); the badge reads per-hit × hits, as the label does.
    const n = e.intent.hits > 1 ? `${Math.round(e.intent.damage / e.intent.hits)}×${e.intent.hits}` : String(e.intent.damage ?? '');
    badge.append(el('b', { cls: 'intent-num', text: n }));
  }
  return badge;
}

function pileButton(which) {
  const isDraw = which === 'draw';
  const count = snap.piles[which] ?? 0;
  const names = (isDraw ? snap.piles.drawCards : snap.piles.discardCards) || [];
  const label = isDraw ? 'Draw' : 'Discard';
  const extra = !isDraw && snap.piles.exhaust > 0 ? `, exhaust ${snap.piles.exhaust}` : '';
  return el('button', {
    cls: isDraw ? 'pile pile-draw' : 'pile pile-discard',
    attrs: {
      type: 'button',
      title: names.length ? `${label}: ${names.join(', ')}` : `${label} pile empty`,
      'aria-label': `${label} pile, ${count} cards${extra}`,
    },
    on: {
      click: (ev) => {
        consumeClick(ev);
        setPileOpen(pileOpen === which ? null : which);
        repaint();
      },
    },
  },
    el('b', { cls: 'pile-count', text: String(count) }),
    el('span', { cls: 'pile-name', text: label }),
  );
}

function energyOrb() {
  const n = snap.player.energy;
  const max = snap.energyPerTurn;
  return el('div', {
    cls: 'energy-orb' + (n === 0 ? ' is-empty' : ''),
    attrs: { title: `Energy ${n} of ${max}`, 'aria-label': `Energy ${n} of ${max}` },
  },
    el('b', { cls: 'orb-num', text: String(n) }),
    el('span', { cls: 'orb-cap', text: `/${max}` }),
  );
}

function speedDock() {
  const dock = el('div', { cls: 'speed-dock', attrs: { role: 'group', 'aria-label': 'Animation speed' } });
  const add = (speed, text, title) => dock.append(el('button', {
    cls: 'btn ghost speed-btn' + (animSpeed === speed ? ' is-on' : ''),
    text,
    attrs: { type: 'button', title },
    on: {
      click: (ev) => {
        consumeClick(ev);
        setAnimSpeed(speed);
        try { localStorage.setItem(SPEED_KEY, String(speed)); } catch { /* private mode */ }
        if (speed === 0) skipAnim();
        repaint();
      },
    },
  }));
  add(1, '1×', 'Animation speed 1×');
  add(2, '2×', 'Animation speed 2×');
  add(0, '»', 'Skip animation');
  return dock;
}

function pileModal(which) {
  const names = (which === 'draw' ? snap.piles.drawCards : snap.piles.discardCards) || [];
  const title = which === 'draw' ? 'Draw pile' : 'Discard pile';
  const back = el('div', { cls: 'pile-back', attrs: { role: 'dialog', 'aria-label': title } });
  back.addEventListener('click', (ev) => {
    if (ev.target === back) { setPileOpen(null); repaint(); }
  });
  const sheet = el('div', { cls: 'pile-sheet' }, el('h2', { text: `${title} (${names.length})` }));
  if (names.length === 0) sheet.append(el('p', { text: 'Empty.' }));
  else {
    const list = el('ul', { cls: 'pile-list' });
    for (const name of names) list.append(el('li', { text: name }));
    sheet.append(list);
  }
  if (which === 'discard' && snap.piles.exhaust > 0) {
    const exh = snap.piles.exhaustCards || [];
    sheet.append(el('p', { cls: 'pile-exh', text: `Exhausted (${snap.piles.exhaust}): ${exh.join(', ') || '—'}` }));
  }
  sheet.append(el('button', {
    cls: 'btn secondary',
    text: 'Close',
    attrs: { type: 'button' },
    on: { click: (ev) => { consumeClick(ev); setPileOpen(null); repaint(); } },
  }));
  back.append(sheet);
  return back;
}

function combatControls(targeting) {
  const hit = pendingCard();
  const controls = el('div', { cls: 'controls' });
  if (targeting && hit) {
    controls.append(el('span', { cls: 'target-banner', text: `${hit.name} — choose an enemy target` }));
    controls.append(el('button', {
      cls: 'btn secondary cancel-target',
      text: 'Cancel  (Esc)',
      attrs: { type: 'button' },
      on: { click: () => cancelTargeting() },
    }));
  } else {
    const endTurn = snap.actions.find((a) => a.kind === 'end_turn');
    controls.append(el('button', {
      cls: 'btn',
      text: 'End Turn  (e)',
      attrs: { type: 'button' },
      on: { click: () => act(endTurn && endTurn.id) },
    }));
  }
  return controls;
}

export function combatView() {
  const targeting = pendingSlot !== null && snap.enemies.length > 1;
  const wrap = el('div', { cls: 'stage-combat' + (targeting ? ' sc-targeting' : '') });

  const fight = el('div', { cls: 'fight' });
  const backdrop = el('div', { cls: 'backdrop', attrs: { 'aria-hidden': 'true' } });
  backdrop.innerHTML = backdropMarkup((BIOMES[snap.biome] ?? BIOMES[DEFAULT_BIOME]).backdrop);
  // Empty foundry floor fast-forwards the feel queue. Cards, enemies and buttons sit above it.
  backdrop.addEventListener('pointerdown', () => skipAnim());
  fight.append(backdrop);
  fight.append(el('div', { cls: 'ground', attrs: { 'aria-hidden': 'true' } }));
  fight.append(heroFigure());
  // The row paints the LINEUP the stroke was aimed at: a just-killed enemy keeps its slot
  // as a collapsing ghost and the survivors keep theirs, so the killing blow reads
  // against the target it was aimed at and no survivor slides into a dead foe's place
  // while the weapon is still in the air. (The row never reorders, so the stable kernel
  // index IS the old slot; death only removes — living slots and ghost slots together
  // are exactly 0..n-1.)
  const ghostAt = new Map(dyingThisPaint.map((d) => [d.enemy, d]));
  const slots = snap.enemies.length + dyingThisPaint.length;
  const row = el('div', { cls: 'enemies' });
  for (let slot = 0, live = 0; slot < slots; slot += 1) {
    if (ghostAt.has(slot)) row.append(dyingCard(ghostAt.get(slot)));
    else row.append(enemyCard(snap.enemies[live], live++));
  }
  fight.append(row);
  fight.append(speedDock());
  wrap.append(fight);

  const dock = el('div', { cls: 'dock' });
  dock.append(pileButton('draw'));
  dock.append(energyOrb());
  // Fan rotation lives on the inner card (`--i`), never on this wrap, so the hand stays one row.
  dock.append(el('div', {
    cls: 'hand' + (dealPending ? ' deal-in' : ''),
    attrs: { style: `--n:${snap.hand.length}` },
  }, ...snap.hand.map((c, i) => cardTile(c, { index: i + 1 }))));
  dock.append(pileButton('discard'));
  dock.append(combatControls(targeting));
  wrap.append(dock);

  wrap.append(el('p', { cls: 'hint', text: targeting
    ? 'Click a highlighted enemy, or press 1–9 · Esc or click empty space to cancel'
    : 'Click a card to play it · a card that needs a target asks you to pick one' }));
  if (pileOpen === 'draw' || pileOpen === 'discard') wrap.append(pileModal(pileOpen));
  return page('combat', 'II — The Fight', 'blade', '', [wrap]);
}

/**
 * One enemy card.
 * @param {any} e a snapshot enemy
 * @param {number} position its 0-based place among the LIVING enemies (= k - 1)
 */
function enemyCard(e, position) {
  const kind = e.intent.kind;
  const look = enemyLook(e.id);
  const targeting = pendingSlot !== null && snap.enemies.length > 1;
  const isAimed = targeting && aimed === position + 1;
  // The damage flash is keyed on the enemy's stable identity (`index`), never on its
  // position, so the shake lands on the enemy that was actually hit even after an
  // earlier enemy has died and shifted everyone up.
  // The ENTRANCE beats are keyed on `e.id` (the kernel's encounter id) and are consumed once
  // per id per run, so an incidental repaint reproduces no arrival class and nothing
  // replays. A boss gets its own, heavier beat: the fight announces itself.
  const entering = enteringIds.has(e.id);
  const cls = 'enemy' + ` eh-${look.hue}` + (look.boss ? ' e-boss' : '') + (look.elite ? ' e-elite' : '')
    + hitClass(e.index)
    + (entering ? (look.boss ? ' arriving boss-enter' : ' arriving') : '')
    // `targeting` marks a legal candidate; `aimed` marks the ONE the player has actually
    // selected. Nothing is marked illegal: the snapshot reports only LIVING enemies and
    // exposes no per-enemy legality flag, so a living enemy is always a legal target.
    + (targeting ? ' targeting' : '')
    + (isAimed ? ' aimed' : '');

  const card = el(targeting ? 'button' : 'div', {
    cls,
    attrs: {
      // Screen readers get the whole decision in one sentence, including the digit to
      // press. The `data-target-index` is the k the action id will carry.
      'aria-label': enemyLabel(e, position, targeting),
      'data-target-index': String(position + 1),
      ...(targeting
        ? { type: 'button', 'aria-pressed': String(isAimed) }
        : { role: 'group' }),
    },
    // Hover previews the target without committing: the click commits. The click is marked
    // consumed so the stage-level "clicked empty space" fallback cannot cancel it too.
    on: targeting
      ? {
          click: (ev) => { consumeClick(ev); pickTarget(position + 1); },
          mouseenter: () => setAimed(position + 1),
          focus: () => setAimed(position + 1),
        }
      : {},
  });

  const pose = enemyPose(e);
  card.append(intentBadge(e));
  const fig = el('div', { cls: `fig pose-${pose}${enemyVariant(e.id)}`, attrs: { 'aria-hidden': 'true' } });
  fig.innerHTML = enemyMarkup(e.id);
  card.append(fig);
  // The target mark is a SHAPE, not a colour: a slot number, plus a crosshair on the
  // enemy the player has actually selected.
  if (targeting) {
    card.append(el('span', { cls: 'target-index', text: String(position + 1), attrs: { 'aria-hidden': 'true' } }));
    card.append(el('span', { cls: 'target-mark', text: '◎', attrs: { 'aria-hidden': 'true' } }));
  }
  card.append(el('div', { cls: 'ename', text: e.name }));
  card.append(el('div', { cls: 'ehp', text: `${e.hp}/${e.maxHp}` }));
  const bar = el('div', { cls: 'hpbar' }, el('i', {}));
  bar.querySelector('i').style.width = `${Math.max(0, Math.round((e.hp / e.maxHp) * 100))}%`;
  card.append(bar);
  if (e.block > 0) {
    card.append(el('div', { cls: 'eblock', text: `⛨ ${e.block}` }));
    const eaten = flash.blockEat && !reducedMotion;
    const bb = el('div', { cls: 'hpbar block' + (eaten ? ' block-eat' : '') }, el('i', {}));
    bb.querySelector('i').style.width = `${Math.min(100, Math.round((e.block / Math.max(1, e.maxHp)) * 100))}%`;
    card.append(bb);
  }
  const fresh = freshStatusKeys(e.statuses);
  const statuses = e.statuses.map((s) => el('span', {
    cls: `pill ${s.key}` + (fresh.has(s.key) ? ' juice-in' : ''),
    text: s.text || `${s.label} ${s.stacks}`,
    attrs: { title: s.explain || '' },
  }));
  if (statuses.length > 0) card.append(el('div', { cls: 'e-statuses' }, ...statuses));
  card.append(efxBox(e.index));
  // The sentence stays readable under the figure. The badge above is the scaled glyph.
  const plain = e.intent.text || `${e.intent.label}`;
  card.append(el('div', {
    cls: `e-intent kind-${kind}`,
    attrs: { title: plain },
  }, el('span', { cls: 'ilabel', text: plain })));
  return card;
}

/**
 * One card tile. Structure: cost gem, type line (mark + word), name, plain-English
 * effect, then the compact CLI code. Auto height means a 3-line effect grows the tile
 * rather than clipping it.
 * @param {any} card the snapshot's card view
 * @param {{index?: number, onClick?: Function, actionId?: string}} [opts]
 *        `index` draws the keyboard digit badge (hand only); `onClick` overrides the default
 *        hand-play action (reward tiles need it, because taking a card is a different verb)
 */
export function cardTile(card, opts = {}) {
  const isPending = pendingSlot !== null && card.slot === pendingSlot;
  // While one card is waiting for a target the OTHER cards cannot be played by accident:
  // clicking them cancels the step instead. They read as inert but stay focusable, so a
  // keyboard user can still click out of the step with the digit shortcuts and Escape.
  const disabled = !card.playable;
  // A tile is clicked for two different reasons: playing it from the hand, or taking it from
  // a reward. `opts.onClick` supplies the second. Before this existed every tile called
  // `clickCard(slot)`, which only searches `snap.hand` — so a reward tile (slot `s1`)
  // resolved to nothing and the reward screen was dead to both clicks and hotkeys.
  const onClick = opts.onClick ?? ((ev) => { consumeClick(ev); clickCard(card.slot); });
  const inactive = pendingSlot !== null && !isPending;
  // The plain-English text comes from the kernel (`describeCard`), never from the
  // renderer. The compact shorthand stays visible but secondary and labelled, so a
  // reader who meets "A6" in the CLI can still connect the two.
  const desc = card.description || card.summary;
  const awaiting = isPending ? ' Choosing a target: click a highlighted enemy, or press Escape to cancel.' : '';
  const tile = el('button', {
    cls: `card type-${card.type}` + (disabled ? ' disabled is-unplayable' : ''),
    attrs: {
      type: 'button',
      // `data-slot` is how focus returns to the right card after a cancel.
      'data-slot': card.slot,
      ...(opts.actionId ? { 'data-action': opts.actionId } : {}),
      'aria-disabled': String(disabled),
      // The inert reason belongs to the CARD'S CONTEXT: a hand tile lacks Energy, a
      // shop shelf (S4) lacks gold. `disabledNote` lets a caller state the real reason
      // instead of the Energy default.
      'aria-label': `${card.name}. Costs ${card.cost} Energy. ${desc}${disabled ? ` ${card.disabledNote ?? 'Not playable: not enough Energy.'}` : ''}${awaiting}`,
      ...(isPending ? { 'aria-pressed': 'true' } : {}),
    },
    on: disabled && !opts.onClick ? {} : { click: onClick },
  });
  if (disabled) tile.disabled = true;

  // Cost gem: a faceted stone, not a plain circle.
  const gem = el('span', { cls: 'cost-gem', attrs: { title: 'Energy cost' } },
    el('span', { cls: 'gem-core', text: String(card.cost) }),
  );
  tile.append(gem);

  // The head plate is the illustration window: one woodcut drawing per card id
  // (src/web/card-art.js), decorative and aria-hidden. The type mark + word stay on top, so
  // type is still carried by hue, mark and word. Unknown ids fall back to the type mark.
  const head = el('span', { cls: 'ctype' },
    glyphBox(TYPE_GLYPH[card.type] || 'rune', 'c-type-mark'),
    el('span', { text: card.typeLabel || card.type }),
  );
  const drawn = cardArtMarkup(card.cardId);
  if (drawn) {
    const ill = el('span', { cls: 'c-illus', attrs: { 'aria-hidden': 'true' } });
    ill.innerHTML = drawn;
    head.prepend(ill);
    // A large, faint echo of the same drawing fills the effect panel behind the words.
    const echo = el('span', { cls: 'c-art c-echo', attrs: { 'aria-hidden': 'true' } });
    echo.innerHTML = drawn;
    tile.append(echo);
    tile.classList.add('has-illus');
  }
  tile.append(head);
  // B2: a tempered instance wears a trim and a forged stamp (mark + temper name). The rules
  // text below already carries the tempered numbers (the kernel renders it), so the stamp
  // only says WHICH temper; its full sentence is the tooltip.
  // It sits in the footer bar beside the compact code (placed below); a tile without a
  // footer carries it on the plate instead.
  let stamp = null;
  if (card.temper) {
    tile.classList.add('tempered', `temper-${card.temper}`);
    stamp = el('span', { cls: 'ctemper', attrs: { title: card.temperText } },
      glyphBox(TEMPER_GLYPH[card.temper] || 'rune', 't-mark'),
      el('span', { cls: 't-name', text: card.temperName || card.temperText.split(':')[0] }),
    );
  }
  tile.append(el('span', { cls: 'cname', text: card.name }));
  if (card.flavor) tile.append(el('span', { cls: 'cflavor', text: card.flavor }));
  tile.append(keywordText(el('span', { cls: 'cdesc' }), desc));
  // The compact code is NOT repeated on a reward tile: the player is choosing a card to
  // keep, not playing one, so the shorthand is noise there.
  if (card.showSummary !== false) {
    const foot = el('span', { cls: 'cfoot' });
    foot.append(el('span', { cls: 'csum', text: card.summary, attrs: { title: 'Compact form used by the agent-facing command line' } }));
    if (disabled) foot.append(el('span', { cls: 'cwhy', text: card.disabledWhy ?? 'needs more Energy' }));
    if (stamp) foot.append(stamp);
    tile.append(foot);
  } else if (stamp) {
    tile.append(stamp);
  }

  // Only the in-hand tiles get a wrapper: it carries the hover lift and the keyboard
  // digit. A reward tile has no digit to show.
  if (!opts.index) return tile;
  const wrap = el('div', {
    cls: 'card-wrap' + (disabled ? ' is-disabled' : '') + (inactive ? ' is-inactive' : '') + (isPending ? ' is-pending' : ''),
    attrs: opts.index ? { style: `--i:${opts.index - 1}` } : {},
  },
    el('span', { cls: 'hand-index', text: String(opts.index), attrs: { title: `Keyboard shortcut: ${opts.index}` } }),
    // The in-card cue that this card is the one waiting for a target. A shape and a word,
    // not a colour: `⇱` reads as "aim" at a glance and survives a monochrome screen.
    isPending ? el('span', { cls: 'awaiting-badge', text: '⇱ pick a target', attrs: { 'aria-hidden': 'true' } }) : null,
    tile,
  );
  return wrap;
}
