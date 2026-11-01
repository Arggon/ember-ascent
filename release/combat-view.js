// src/web/combat-view.js — the fight screen: hero figure, enemy row, hand, controls.
//
// The view paints the LINEUP the stroke was aimed at: a just-killed enemy keeps its slot
// as a collapsing ghost and the survivors keep theirs, so the killing blow reads against
// the target it was aimed at. `heroPose()` owns the precedence rules of the hero's pose
// (hurt outranks the card's movement; a fresh play outranks a hold) and pins the pose
// hold through incidental repaints. The hero's movement is chosen by WHICH card was
// played (hero-moves.js), never only by its type.

import { BIOMES, DEFAULT_BIOME, describeTile, loadContent } from './src/kernel/index.js';
import {
  HERO_POSE_MS,
  SPEED_KEY,
  animMs,
  animSpeed,
  bursts,
  busyReason,
  dealClock,
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
  strikeSeq,
  strikeSlot,
} from './runtime.js';
import { el, keywordText } from './dom.js';
import { TEMPER_GLYPH, TYPE_GLYPH, enemyLook, glyphBox } from './glyphs.js';
import { heroMove, isMeleeMove, signatureFor } from './hero-moves.js';
import { backdropMarkup, enemyMarkup, enemyVariant, heroMarkup, attackTier, intentGlyph } from './stage-art.js';
import { cardArtMarkup } from './card-art.js';
import { dyingCard, efxBox, freshEnemyStatusKeys, heroEfx, hitClass } from './floats.js';
import { aimed, cancelTargeting, clickCard, consumeClick, enemyLabel, pendingCard, pendingSlot, pickTarget, setAimed } from './targeting.js';
import { act } from './actions.js';
import { page } from './page-frame.js';
import { currentLang, t } from './i18n.js';

/**
 * UX-5: the input gate's reader-facing sentences, one per busy reason, keyed into the
 * i18n table (I18N-1). `tile` names the wait inside a locked card's aria-label; `aria`
 * does the same for the End Turn button. The gate is the surface refusing to ASK the
 * kernel while an animation is landing — every reason is a presentation lifetime
 * (runtime.busyReason), never a rule.
 */
const busyText = (reason, which) => t(`busy.${reason}.${which}`) || t(`busy.fight.${which === 'tile' ? 'animatingTile' : 'animating'}`);

export function heroPose() {  // Precedence: getting hit outranks the card's own movement — a hero who just lost HP
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
    // The hold length is the pose's PACED duration — the same `animMs` figure the
    // stylesheet's `calc(<base>s * var(--pace, 1))` resolves to — so the pose is never
    // dropped mid-swing on a repaint and the swing plays at the dock's pace. A per-card
    // SIGNATURE (HERO_SIGNATURES) may override the pose's base duration.
    const sig = move ? signatureFor(bursts.find((b) => b.kind === 'card-fly')) : null;
    const base = (sig && sig.poseMs) || HERO_POSE_MS[move] || 400;
    if (reducedMotion || animSpeed === 0) setHeroMoveHold(null);
    // `melee` arms the approach (`.hero.is-approach`): a stroke that is not a throw or a
    // cast carries the hero into the enemy lane. fx.js measures the real gap right after
    // the paint and writes it back as `approachX` on this same hold.
    else setHeroMoveHold({ pose: move, start: Date.now(), dur: animMs(base), melee: isMeleeMove(move) });
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
    attrs: { role: 'group', 'aria-label': t('combat.hero.aria', { name: snap.characterName || 'Ashwright', hp: p.hp, max: p.maxHp, block: p.block }) },
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

/**
 * UX-9c: the per-(enemy, beat kind) POSE class (spec §4.2's table, per-type refinements
 * from §5). The `epose-` prefix is deliberate: `pose-*` is the renderer's global pose
 * contract that check-surface-art.mjs gates against POSE_VALUES, and these are the enemy
 * CHIP's beat poses, not hero movements. Each value is the pose name only — the paint site
 * adds the prefix, which is also what keeps the checker's class scan honest.
 *
 * `null` means "no beat pose": the card falls through to the old enemyPose() precedence
 * (strike clock, hurt, low, windup, idle), so a type with no entry reads exactly as before.
 */
const ENEMY_POSES = {
  // §5.1 — the overshoot windup is the POSE; the snap is the shared slam.
  jaw_worm: { attack: 'maw-wind', power: 'maw-inhale' },
  // §5.2 — she never advances: the rite and the cone are columns, not dashes.
  cultist: { power: 'cantor-rite', attack: 'cantor-cast' },
  // §5.3 — a 460ms dart; grow TIGHTENS.
  red_louse: { attack: 'mite-dart', power: 'mite-tighten' },
  // §5.4 — compress then lunge; the arc is a drip from a body that stays put.
  acid_slime: { attack: 'ooze-lunge', hex: 'ooze-drip' },
  // §5.5 — long charge, then the enraged seam glow holds.
  gremlin_nob: { attack: 'brute-charge', hex: 'brute-bash', power: 'brute-enrage' },
  // §5.6 — the wall is the guard pose; the piston is the heavy slam.
  the_guardian: { guard: 'warden-wall', attack: 'warden-piston', hex: 'warden-steam' },
  // §5.7 — hex shell hardens; claws dart; ram pushes low.
  slag_crawler: { guard: 'crawler-hex', attack: 'crawler-dart' },
  // §5.8 — zero travel, ever: thin / streak / bob.
  ash_wraith: { hex: 'wraith-thin', attack: 'wraith-streak', power: 'wraith-drift' },
  // §5.9 — the same phases, held as an AREA: the hero row dims, she does not.
  ash_wraith_elite: { attack: 'matriarch-veil', hex: 'wraith-thin', power: 'wraith-drift', guard: 'wraith-drift' },
  // §5.10 — the survey marks the ground; the drop is the slam.
  cinder_foreman: { attack: 'foreman-survey' },
};

/**
 * The beat kind the playing plan says THIS enemy is on, or null.
 *
 * `strikeSeq.tail` is the turn's non-attack steps in kernel order, one TURN_STEP slot each,
 * starting where the last slam ended. A single attacker's beats are therefore positional:
 * its step i plays in tail slot i. The pose the card wears is the kind of the step whose
 * slot the clock is currently in — computed from the same `start`/`stepMs` the CSS delays
 * use, so a repaint mid-beat re-derives the same answer instead of restarting anything.
 * Only the FIRST attacker is served positionally: with several foes the tail's slots are
 * not their individual beats, and a wrong pose is worse than the generic one, so a
 * multi-enemy turn keeps the shared §4 behaviour.
 */
function beatPose(e) {
  const plan = strikeSeq;
  if (!plan || !Array.isArray(plan.tail) || plan.tail.length === 0) return null;
  if (plan.attacks && plan.attacks.length > 1) return null;
  const table = ENEMY_POSES[e.id];
  if (!table) return null;
  const elapsed = Date.now() - plan.start;
  const i = Math.floor((elapsed - plan.tailAt) / Math.max(1, plan.stepMs));
  if (i < 0 || i >= plan.tail.length) return null;
  const step = plan.tail[i];
  if (step.enemy !== e.index && step.owner !== e.index) return null;
  const kind = step.kind === 'block' ? 'guard' : step.kind === 'status' ? (step.to === 'player' ? 'hex' : 'power') : 'attack';
  return table[kind] ?? null;
}

function enemyPose(e) {
  // UX-2, the SEQUENCED attack run: while a strike sequence is playing, its attackers
  // slam one at a time — the plan (runtime.strikeSeq) carries each attacker's beat, and
  // enemyCard applies the per-attacker animation delay from the same clock. The pose
  // reads as travel: anticipation, long dash, impact beat, return.
  if (strikeSlot(e.index)) return 'slam';
  // The simultaneous form (kept for »/reduced motion, where no plan is armed): the
  // action's own burst names this turn's attackers and they strike together, as before.
  const turn = bursts.find((b) => b.kind === 'enemy-turn');
  if (turn && turn.attacks.some((a) => a.enemy === e.index)) return 'slam';
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
  const label = isDraw ? t('combat.pile.draw') : t('combat.pile.discard');
  const extra = !isDraw && snap.piles.exhaust > 0 ? t('combat.pile.exhaustExtra', { n: snap.piles.exhaust }) : '';
  return el('button', {
    cls: isDraw ? 'pile pile-draw' : 'pile pile-discard',
    attrs: {
      type: 'button',
      title: names.length ? t('combat.pile.named', { label, names: names.join(', ') }) : t('combat.pile.empty', { label }),
      'aria-label': t('combat.pile.aria', { label, n: count, extra }),
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
    attrs: { title: t('combat.energy.title', { n, max }), 'aria-label': t('combat.energy.title', { n, max }) },
  },
    el('b', { cls: 'orb-num', text: String(n) }),
    el('span', { cls: 'orb-cap', text: `/${max}` }),
  );
}

function speedDock() {
  const dock = el('div', { cls: 'speed-dock', attrs: { role: 'group', 'aria-label': t('combat.speed.aria') } });
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
  add(1, '1×', t('combat.speed.1'));
  add(2, '2×', t('combat.speed.2'));
  add(0, '»', t('combat.speed.skip'));
  return dock;
}

function pileModal(which) {
  const names = (which === 'draw' ? snap.piles.drawCards : snap.piles.discardCards) || [];
  const title = which === 'draw' ? t('combat.pile.drawTitle') : t('combat.pile.discardTitle');
  const back = el('div', { cls: 'pile-back', attrs: { role: 'dialog', 'aria-label': title } });
  back.addEventListener('click', (ev) => {
    if (ev.target === back) { setPileOpen(null); repaint(); }
  });
  const sheet = el('div', { cls: 'pile-sheet' }, el('h2', { text: `${title} (${names.length})` }));
  if (names.length === 0) sheet.append(el('p', { text: t('combat.pile.emptySheet') }));
  else {
    const list = el('ul', { cls: 'pile-list' });
    for (const name of names) list.append(el('li', { text: name }));
    sheet.append(list);
  }
  if (which === 'discard' && snap.piles.exhaust > 0) {
    const exh = snap.piles.exhaustCards || [];
    sheet.append(el('p', { cls: 'pile-exh', text: t('combat.pile.exhausted', { n: snap.piles.exhaust, names: exh.join(', ') || '—' }) }));
  }
  sheet.append(el('button', {
    cls: 'btn secondary',
    text: t('combat.close'),
    attrs: { type: 'button' },
    on: { click: (ev) => { consumeClick(ev); setPileOpen(null); repaint(); } },
  }));
  back.append(sheet);
  return back;
}

function combatControls(targeting, busy) {
  const hit = pendingCard();
  const controls = el('div', { cls: 'controls' });
  if (targeting && hit) {
    controls.append(el('span', { cls: 'target-banner', text: t('combat.targetBanner', { name: hit.name }) }));
    controls.append(el('button', {
      cls: 'btn secondary cancel-target',
      text: t('combat.cancel'),
      attrs: { type: 'button' },
      on: { click: () => cancelTargeting() },
    }));
  } else {
    const endTurn = snap.actions.find((a) => a.kind === 'end_turn');
    // UX-5: the input gate. While the surface is busy the turn cannot be ended from
    // here — the same locked shape the unplayable cards wear (aria-disabled + the
    // disabled visual), and the handler is not wired at all, so a click during the
    // animation is inert even before the hotkey swallow in app.js. The kernel never
    // saw a rejected action: this is the surface refusing to ask.
    const btn = el('button', {
      cls: 'btn' + (busy ? ' is-locked' : ''),
      text: t('combat.endTurn'),
      attrs: {
        type: 'button',
        ...(busy ? {
          'aria-disabled': 'true',
          'aria-label': t('combat.endTurn.locked', { why: busyText(busy, 'aria') }),
          title: t('combat.endTurn.waiting', { why: busyText(busy, 'tile') }),
        } : {}),
      },
      on: busy ? {} : { click: () => act(endTurn && endTurn.id) },
    });
    if (busy) btn.disabled = true;
    controls.append(btn);
  }
  return controls;
}

export function combatView() {
  const targeting = pendingSlot !== null && snap.enemies.length > 1;
  // UX-5: the input gate. While a play's animation, the enemy-turn sequence, a hand
  // deal or a kill hold is on screen, the hand and End Turn paint the locked shape and
  // app.js swallows the shortcuts — the gate is presentation only, derived from the
  // same lifetimes the effects use (runtime.busyReason). Reduced motion never arms it.
  const busy = busyReason();
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
  // UX-4: the deal is a visible EVENT. While the deal clock is armed the hand carries
  // `deal-in` and the clock's PACED step/duration as CSS variables, plus `--deal-offset`
  // (the negative elapsed time) so a mid-deal repaint — a hover — RESUMES each card's
  // flight where it is instead of cutting it (the same resume shape the hero pose uses).
  // The layout contract is unchanged: the entry animates, the fan it lands in does not.
  const deal = dealClock;
  const dealStyle = deal
    ? `;--deal-step:${deal.stepMs}ms;--deal-dur:${deal.durMs}ms;--deal-offset:${Math.min(0, deal.start - Date.now())}ms`
    : '';
  // Fan rotation lives on the inner card (`--i`), never on this wrap, so the hand stays one row.
  // The `is-busy` marker scopes the gate's CSS and gives the tests a hook; the locked
  // shape itself rides each tile (below), the way unplayable cards always read.
  dock.append(el('div', {
    cls: 'hand' + (deal ? ' deal-in' : '') + (busy ? ' is-busy' : ''),
    attrs: { style: `--n:${snap.hand.length}${dealStyle}` },
  }, ...snap.hand.map((c, i) => cardTile(c, { index: i + 1, locked: busy }))));
  dock.append(pileButton('discard'));
  dock.append(combatControls(targeting, busy));
  wrap.append(dock);

  wrap.append(el('p', { cls: 'hint', text: targeting ? t('combat.hint.targeting') : t('combat.hint') }));
  if (pileOpen === 'draw' || pileOpen === 'discard') wrap.append(pileModal(pileOpen));
  return page('combat', t('combat.chapter'), 'blade', '', [wrap]);
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
  // UX-9c: the beat pose (spec §4.2) — one `epose-*` class for the step the plan is on,
  // reduced motion never paints one (the plan is not armed there either, but the guard is
  // explicit: no transition-bearing class is added on that path, AC-11).
  // A strike is on the shared `pose-slam` body clock (the checker's pose contract), so its
  // per-type body language rides this same `epose-*` class — the type's `attack` pose takes
  // the slot when it has one. The tail's non-attack steps own the slot otherwise.
  const striking = strikeSlot(e.index) !== null
    || Boolean(bursts.find((x) => x.kind === 'enemy-turn' && x.attacks.some((a) => a.enemy === e.index)));
  const beat = reducedMotion ? null
    : (ENEMY_POSES[e.id] && ENEMY_POSES[e.id].attack && striking ? ENEMY_POSES[e.id].attack : beatPose(e));
  // §5.5: the enrage persists while its Strength stands. Paint-time and reduced-motion
  // gated — the seams are already a transition-bearing class, and the Strength chip states
  // the same fact statically (AC-11).
  const enraged = !reducedMotion && e.id === 'gremlin_nob'
    && (e.statuses || []).some((x) => x.key === 'strength');
  const cls = 'enemy' + ` eh-${look.hue}` + (look.boss ? ' e-boss' : '') + (look.elite ? ' e-elite' : '')
    + (beat ? ` epose-${beat}` : '')
    + (enraged ? ' is-enraged' : '')
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
  // UX-2: the sequenced attacker. The plan clock gives this enemy its own beat: the
  // intent badge lights up exactly while ITS slam plays (a CSS animation whose delay is
  // the same clock, so a repaint re-derives it without restarting the timeline), and the
  // .fig's slam waits for (or resumes at) its slot. Reduced motion and » never arm a
  // plan, so both fall through to the static forms.
  const seq = strikeSlot(e.index);
  if (seq) {
    // The badge highlight rides a CSS variable pair so the stylesheet owns the look and
    // the plan only owns the clock. setProperty is guarded: the fake-DOM test hosts carry
    // a plain style object, and only a real CSSOM can hold custom properties anyway.
    if (card.style && card.style.setProperty) {
      card.style.setProperty('--seq-delay', `${seq.delay}ms`);
      card.style.setProperty('--seq-dur', `${seq.dur}ms`);
    }
    card.classList.add('is-striking');
  }
  card.append(intentBadge(e));
  const fig = el('div', { cls: `fig pose-${pose}${enemyVariant(e.id)}`, attrs: { 'aria-hidden': 'true' } });
  if (seq && pose === 'slam') {
    // Same resume mechanism as the hero's pose: a positive delay waits for the
    // attacker's turn (`fill: both` holds the 0% frame), a negative one resumes
    // mid-flight after an incidental repaint instead of restarting it.
    if (fig.style && fig.style.setProperty) {
      fig.style.animationDuration = `${seq.dur}ms`;
      fig.style.animationDelay = `${seq.delay}ms`;
    }
  }
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
  // UX-9 D3: the chip juices off THIS enemy's own previous status keys (per-index), not
  // off the player's list, which made an enemy chip animate whenever the player gained one.
  const fresh = freshEnemyStatusKeys(e.index, e.statuses);
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
 * @param {{index?: number, onClick?: Function, actionId?: string, locked?: string|null,
 *          readOnly?: boolean}} [opts]
 *        `index` draws the keyboard digit badge (hand only); `onClick` overrides the default
 *        hand-play action (reward tiles need it, because taking a card is a different verb);
 *        `locked` is the UX-5 busy reason — the tile wears the disabled shape even though
 *        the kernel would take it, because the previous animation is still landing;
 *        `readOnly` (UX-8) renders the tile as a FACT, not a control: a labelled div, no
 *        disabled/unplayable shape, no click — the codex gallery, the deck sheet and an
 *        inert removal instance share it. The full-tile markup is the hand's own, so the
 *        three read-only surfaces can never drift from the game's card face.
 */
export function cardTile(card, opts = {}) {
  const readOnly = Boolean(opts.readOnly);
  const isPending = pendingSlot !== null && card.slot === pendingSlot;
  // While one card is waiting for a target the OTHER cards cannot be played by accident:
  // clicking them cancels the step instead. They read as inert but stay focusable, so a
  // keyboard user can still click out of the step with the digit shortcuts and Escape.
  // UX-5: a busy hand is disabled the SAME way — the unplayable visual, aria-disabled,
  // and the native disabled flag — with the honest wait named instead of the Energy one.
  const locked = opts.locked ?? null;
  // UX-8: a read-only tile is never the disabled/unplayable shape — it is not a card the
  // hand refused, it is a card nobody asked to play. Full colour, no aria-disabled, and
  // no click handler at all (a div, so no focus stop announces a control that does nothing).
  const disabled = !readOnly && (!card.playable || locked !== null);
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
  const awaiting = isPending ? t('combat.choosing') : '';
  // The locked wait is named in the tile's own sentence (the i18n busy keys), so a
  // screen reader hears why the playable card is not taking input right now.
  const lockedNote = locked !== null ? t('combat.waiting', { why: busyText(locked, 'tile') }) : '';
  const tile = el(readOnly ? 'div' : 'button', {
    cls: `card type-${card.type}` + (disabled ? ' disabled is-unplayable' : ''),
    attrs: {
      // A readout is a group (the enemy cards' own resting role): labelled, but never
      // announced as a button that would do nothing.
      ...(readOnly ? { role: 'group' } : { type: 'button' }),
      // `data-slot` is how focus returns to the right card after a cancel.
      'data-slot': card.slot,
      ...(opts.actionId ? { 'data-action': opts.actionId } : {}),
      ...(readOnly ? {} : { 'aria-disabled': String(disabled) }),
      // The inert reason belongs to the CARD'S CONTEXT: a hand tile lacks Energy, a
      // shop shelf (S4) lacks gold. `disabledNote` lets a caller state the real reason
      // instead of the Energy default.
      'aria-label': `${card.name}. ${t('card.costs', { n: card.cost })} ${desc}${lockedNote || (disabled ? ` ${card.disabledNote ?? t('card.notPlayable')}` : '')}${awaiting}`,
      // UX-2 (review P3): the rules row is line-clamped at several tiers, and the
      // clamped tail was reachable only through the aria-label — invisible to a
      // sighted hover. The native title carries the FULL sentence, which makes the
      // "full sentence stays in the card's aria-label/tooltip" claims literal.
      title: desc,
      ...(isPending ? { 'aria-pressed': 'true' } : {}),
    },
    on: readOnly ? {} : (disabled && !opts.onClick ? {} : { click: onClick }),
  });
  if (!readOnly && disabled) tile.disabled = true;

  // Cost gem: a faceted stone, not a plain circle.
  const gem = el('span', { cls: 'cost-gem', attrs: { title: t('deck.cost') } },
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
    foot.append(el('span', { cls: 'csum', text: card.summary, attrs: { title: t('combat.compact.title') } }));
    if (disabled) foot.append(el('span', { cls: 'cwhy', text: card.disabledWhy ?? t('card.needsEnergy') }));
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
    el('span', { cls: 'hand-index', text: String(opts.index), attrs: { title: t('combat.keyHint', { n: opts.index }) } }),
    // The in-card cue that this card is the one waiting for a target. A shape and a word,
    // not a colour: `⇱` reads as "aim" at a glance and survives a monochrome screen.
    isPending ? el('span', { cls: 'awaiting-badge', text: t('combat.pickTarget'), attrs: { 'aria-hidden': 'true' } }) : null,
    tile,
  );
  return wrap;
}

/* ------------------------------------------------- UX-8: the gallery fact layer */
//
// The codex gallery, the deck sheet and the shop's removal pick render cardTile, whose
// hand/reward callers receive their describe-layer sentences pre-computed in the snapshot.
// The read-only surfaces are NOT snapshot fields (the kernel publishes the deck as
// name/cost/type/temper rows; descriptions live behind the describe layer), so this
// helper feeds the tile the two facts the snapshot rows lack. Everything here is the
// kernel's own wording through the ONE public entry point — the surface never derives a
// number or a sentence of its own.

/** The FULL shipped table's definitions, loaded once: the 65 draft-pool cards plus the
 *  five hero-only starters, which snapshot.deckCards and the shop's deckInstances can
 *  both hold but cardPool() (rewards only) does not list. */
let GALLERY_DEFS = null;
function galleryDefs() {
  if (!GALLERY_DEFS) GALLERY_DEFS = loadContent().cards;
  return GALLERY_DEFS;
}

const GALLERY_FACTS = {};

/**
 * The describe-layer facts one content card needs for a read-only tile: its sentence,
 * its flavor line, and its type word — computed in the CURRENT language and cached per
 * language, so a language switch re-derives exactly once like the codex pool cache.
 * The kernel's own `describeTile` is the fact bundle (it feeds the hand tiles' fields:
 * the name, the cost, the SHORT type word, the describe sentence), so every word here is
 * kernel wording; only the flavor line is read off the def beside it. An id the content
 * no longer knows (a torn save's placeholder row) degrades to empty strings; the tile
 * then shows the raw id name it already carries and no rules text.
 * @param {string} cardId
 * @returns {{description: string, flavor: string, type: string, typeLabel: string}}
 */
export function cardDescribe(cardId) {
  const lang = currentLang();
  let per = GALLERY_FACTS[lang];
  if (!per) per = GALLERY_FACTS[lang] = new Map();
  const hit = per.get(cardId);
  if (hit) return hit;
  const def = galleryDefs().get(cardId) || null;
  const fact = def
    ? (() => {
        const tile = describeTile(def, {}, 0, lang);
        return {
          description: tile.description || '',
          flavor: (lang === 'es' ? (def.flavor_es ?? def.flavor) : def.flavor) || '',
          type: tile.type,
          typeLabel: tile.typeLabel,
        };
      })()
    : { description: '', flavor: '', type: 'unknown', typeLabel: 'unknown' };
  per.set(cardId, fact);
  return fact;
}
