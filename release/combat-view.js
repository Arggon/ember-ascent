// src/web/combat-view.js — the fight screen: hero figure, enemy row, hand, controls.
//
// The view paints the LINEUP the stroke was aimed at: a just-killed enemy keeps its slot
// as a collapsing ghost and the survivors keep theirs, so the killing blow reads against
// the target it was aimed at. `heroPose()` owns the precedence rules of the hero's pose
// (hurt outranks the card's movement; a fresh play outranks a hold) and pins the pose
// hold through incidental repaints. The hero's movement is chosen by WHICH card was
// played (hero-moves.js), never only by its type.

import { BIOMES, DEFAULT_BIOME, describeTile, intentChips, loadContent } from './src/kernel/index.js';
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
import { EFFECT_GLYPH, TEMPER_GLYPH, TYPE_GLYPH, enemyLook, glyphBox } from './glyphs.js';
import { heroMove, isMeleeMove, signatureFor } from './hero-moves.js';
import { backdropMarkup, enemyMarkup, enemyVariant, heroMarkup } from './stage-art.js';
import { cardArtMarkup } from './card-art.js';
import { dyingCard, efxBox, freshEnemyStatusKeys, freshStatusKeys, heroEfx, hitClass } from './floats.js';
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
  // The stage tree is rebuilt on every paint, which would restart every pose keyframe
  // from 0% on each repaint during the hold. MID-RUN a negative animation-delay resumes
  // the run where it should be, so the movement stays in phase across repaints. PAST
  // THE END (hit-stop grace) the pose class stays but every layer is frozen with
  // animation:none — which lands each child on its own base styles, the pose's natural
  // end state (idle sprite visible, frames at their base opacity 0, no transform) — so
  // no repaint can ever replay the swing. The layers are the .fig AND every child its
  // markup paints (.sh, .spr, each .spr-frame-*): the children are phased together
  // further down, once the markup above has painted them.
  const held = heroMoveHold;
  const holding = Boolean(held && held.pose === pose && pose !== 'idle');
  const heldElapsed = holding ? Math.max(0, Date.now() - held.start) : -1;
  const midRun = holding && heldElapsed < held.dur;
  if (holding) {
    if (midRun) {
      // Mid-run: resume the keyframe where it should be, so hover repaints do not stutter.
      fig.style.animationDuration = `${held.dur}ms`;
      fig.style.animationDelay = `-${heldElapsed}ms`;
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
  // MID-RUN ONLY: past the end the class stays off — the approach's 100% keyframe is
  // translateX(0), the hero's own place, so a grace-window repaint cannot restart the
  // walk from 0%.
  if (held && held.melee && held.pose === pose && midRun) {
    node.classList.add('is-approach');
    // setProperty is guarded: the fake-DOM test hosts carry a plain style object, and
    // only a real CSSOM can hold custom properties anyway.
    if (node.style.setProperty) {
      node.style.setProperty('--approach-dur', `${held.dur}ms`);
      if (held.approachX != null) node.style.setProperty('--approach-x', `${held.approachX}px`);
    }
    node.style.animationDuration = `${held.dur}ms`;
    node.style.animationDelay = `-${heldElapsed}ms`;
  }
  fig.innerHTML = heroMarkup(snap.character);
  // The pose's frame layers are the .fig's CHILDREN, painted fresh by the markup above
  // — the .fig's own phasing does not cover them, and an unphased child restarts its
  // timeline from 0% on the next repaint (the whole swing replaying after its impact).
  // Phase them with the .fig: mid-run they resume at the hold's elapsed point; past
  // the end they freeze with it. (Only a real DOM parses markup into children; the
  // fake-DOM test hosts carry no child list, so this sweep is empty there.)
  if (holding) {
    for (const child of fig.children ?? []) {
      if (midRun) {
        child.style.animationDuration = `${held.dur}ms`;
        child.style.animationDelay = `-${heldElapsed}ms`;
      } else {
        child.style.animation = 'none';
      }
    }
  }
  node.append(fig);
  node.append(el('div', { cls: 'hero-name', text: snap.characterName || 'Ashwright' }));
  node.append(el('div', { cls: 'ehp', text: `${p.hp}/${p.maxHp}` }));
  const bar = el('div', { cls: 'hpbar' }, el('i', {}));
  bar.querySelector('i').style.width = `${Math.max(0, Math.round((p.hp / Math.max(1, p.maxHp)) * 100))}%`;
  node.append(bar);
  if (p.block > 0) node.append(el('div', { cls: 'eblock', text: `⛨ ${p.block}` }));
  // PARITY: the hero's statuses (Vulnerable, Weak, …) read as CHIPS under her own HP
  // bar — mark + stacks, the card chips' own component — instead of a full sentence per
  // pill: the user reads an icon and a number, and the sentence is one click away (the
  // kernel's own explain, through the shared popover) and on the chip's native title.
  // The hero card is a read-only readout (a div), so the chips are real controls. The
  // juice-in diff is unchanged (`freshStatusKeys` diffs against the PREVIOUS paint,
  // which render.js records before this view is built) — the entrance class moves onto
  // the chip, and the reduced-motion block neutralizes it there like it does the pills.
  // Powers (run-long counters: Combust, Rupture, …) STAY on the HUD: they outlive the
  // fight, and this card exists only in combat.
  const freshHero = freshStatusKeys(p.statuses || []);
  const heroStatuses = (p.statuses || []).map((s) => chipNode(
    {
      verb: 'status',
      status: s.key,
      num: String(s.stacks ?? 0),
      label: s.name || s.label || s.key,
      explain: s.explain || s.text || '',
    },
    true,
    freshHero.has(s.key) ? 'juice-in' : '',
  ));
  if (heroStatuses.length > 0) node.append(el('div', { cls: 'e-statuses' }, ...heroStatuses));
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

/**
 * The »/1×/2× dock. Shared with render.js's defeat hold, which paints the same dock on
 * the held stage so the killing turn can be skipped exactly like a live fight's.
 */
export function speedDock() {
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
  // while the weapon is still in the air. (The row never reorders, so a ghost holds the
  // slot its body occupied in the PREVIOUS row — the burst's `slot`, its position in the
  // before snapshot's enemies array, the same position the aim's `targetK` names. The
  // stable kernel `index` is a DIFFERENT namespace: the kernel keeps dead rows in its
  // enemy list while snapshots omit them, so once one death has left the painted row
  // every later stable index sits ABOVE its painted position — keying ghosts by it put
  // the ghost past the row's end and fed `undefined` into enemyCard. Living slots and
  // ghost slots together are exactly 0..n-1.)
  const ghostAt = new Map(dyingThisPaint.map((d) => [d.slot, d]));
  const slots = snap.enemies.length + dyingThisPaint.length;
  const row = el('div', { cls: 'enemies' });
  for (let slot = 0, live = 0; slot < slots; slot += 1) {
    const ghost = ghostAt.get(slot);
    if (ghost) row.append(dyingCard(ghost));
    else if (snap.enemies[live]) row.append(enemyCard(snap.enemies[live], live++));
    /* DEFENSIVE (must stay unreachable): the partition above is computed, not assumed —
     * `slot` is the victim's own position in the before row, so every slot lands either a
     * ghost or a living enemy. Should a future burst shape break that invariant, SKIP the
     * hole here rather than crash the whole stage — an enemy card missing beats a dead
     * screen. Do not tighten this into an assert: a throw here is the aimed-kill crash
     * this loop once shipped with. */
    else console.error('[combat] enemy row slot %d has no ghost and no living enemy (live=%d, slots=%d, dying=%o) — skipped', slot, live, slots, dyingThisPaint);
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
 * One enemy card. Shared with render.js's defeat hold: the held stage paints the SAME
 * builder, so the standing attackers wear the same plan-driven slam poses and delays the
 * live fight was wearing when the killing turn began.
 * @param {any} e a snapshot enemy
 * @param {number} position its 0-based place among the LIVING enemies (= k - 1)
 */
export function enemyCard(e, position) {
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
  // intent row (its `.e-intent` chips) lights up exactly while ITS slam plays (a CSS
  // animation whose delay is the same clock, so a repaint re-derives it without
  // restarting the timeline), and the .fig's slam waits for (or resumes at) its slot.
  // Reduced motion and » never arm a plan, so both fall through to the static forms.
  const seq = strikeSlot(e.index);
  if (seq) {
    // The row highlight rides a CSS variable pair so the stylesheet owns the look and
    // the plan only owns the clock. setProperty is guarded: the fake-DOM test hosts carry
    // a plain style object, and only a real CSSOM can hold custom properties anyway.
    if (card.style && card.style.setProperty) {
      card.style.setProperty('--seq-delay', `${seq.delay}ms`);
      card.style.setProperty('--seq-dur', `${seq.dur}ms`);
    }
    card.classList.add('is-striking');
  }
  // UX-9 D3: the chip juices off THIS enemy's own previous status keys (per-index), not
  // off the player's list, which made an enemy chip animate whenever the player gained one.
  // Statuses read as CHIPS now — mark + stacks, no visible sentence (the user's ask):
  // the kernel's explain is the native title and one click away through the shared
  // popover. While TARGETING the enemy card is a native <button>, so the chips take the
  // hand-card path (spans whose click stops propagation — clicking a chip must never
  // pick the target); the rest state is a read-only readout (a div) and gets real
  // controls, exactly like the read-only card tiles.
  //
  // THE SPLIT (the user's ask): the kernel publishes each row's `kind` (observe.js
  // statusPairs, from vocabulary.js STATUS_KINDS — no key matching here). The enemy's
  // own BUFFS go up with the intent row (hosted above the fig); the hero-applied
  // DEBUFFS stay at the foot. A row missing `kind` (a hand-crafted snapshot) reads as a
  // debuff — the bottom group it always rendered in before this split. Chip internals,
  // the juice-in entrance and the targeting demotion are the same component in both
  // rows; only which row hosts a chip changed.
  const fresh = freshEnemyStatusKeys(e.index, e.statuses);
  const statusChip = (s) => chipNode(
    {
      verb: 'status',
      status: s.key,
      num: String(s.stacks ?? 0),
      label: s.name || s.label || s.key,
      explain: s.explain || s.text || '',
    },
    !targeting,
    fresh.has(s.key) ? 'juice-in' : '',
  );
  const buffs = e.statuses.filter((s) => s.kind === 'buff').map(statusChip);
  const debuffs = e.statuses.filter((s) => s.kind !== 'buff').map(statusChip);
  // Plain visual grouping: no sentence of its own (the chips carry their own aria),
  // so a bare div — the same treatment the foot row has always had.
  const buffRow = buffs.length > 0 ? el('div', { cls: 'e-statuses e-buffs' }, ...buffs) : null;
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
  // THE ENEMY'S OWN HEADLINE sits ABOVE the figure, where the retired intent badge used
  // to float (the user's ask): the ACTIONS row (the `.e-intent` chips — what the enemy is
  // about to do) topmost, then the enemy's own BUFFS (`.e-statuses.e-buffs`, from the
  // kernel-published `kind`), then the art. The hero-applied DEBUFFS stay at the card's
  // foot below (their own row further down this function). The strike-lit ring stays
  // exactly what it was: the class and the --seq-* variables ride the CARD, the
  // keyframes light `.e-intent` wherever the row lives, and both branch shapes below
  // carry the class — so the animation follows the row up unchanged.
  const plain = e.intent.text || `${e.intent.label}`;
  const ichips = intentChips(e, currentLang());
  card.append(ichips.length > 0
    ? el('div', {
        cls: `e-intent kind-${kind}`,
        attrs: { role: 'group', title: plain, 'aria-label': plain },
      }, ...ichips.map((c) => chipNode(c, !targeting)))
    : el('div', {
        cls: `e-intent kind-${kind}`,
        attrs: { title: plain },
      }, el('span', { cls: 'ilabel', text: plain })));
  if (buffRow) card.append(buffRow);
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
  // The DEBUFF foot row: the statuses the kernel classifies as debuffs (Vulnerable,
  // Weak — `kind: 'debuff'`), exactly where the single status row always sat. The
  // floating-damage efx box follows it, as before.
  card.append(efxBox(e.index));
  if (debuffs.length > 0) card.append(el('div', { cls: 'e-statuses' }, ...debuffs));
  return card;
}

/* ----------------------------------------------- effect chips (the card icon row) */
//
// The kernel publishes one chip per effect (`card.chips`, kernel-worded: `{verb,
// status?, amount, num, label, explain}`); this layer only paints glyph + number and
// opens the explainer. NO number or sentence is derived here — an unknown chip shape
// simply renders without its number, and a card with no chips keeps its sentence.

/** The one open explainer popover, plus the chip node it explains. One at a time, like
 *  every other panel in the surface. Hosted on #pop-layer — NOT #fx-layer: the fx layer
 *  is switched off wholesale for reduced-motion users (`#fx-layer { display: none }` in
 *  the reduce block), and a popover inside it would be INVISIBLE for exactly the users
 *  who most need the static reveal. A descendant rule cannot override that ancestor, so
 *  the explainer gets its own always-visible fixed layer, created once on first open
 *  (a sibling of #fx-layer, never cleared by render(), so a repaint under an open
 *  popover cannot clip it inside the hand's overflow:hidden fan box or lose it). */
let chipPop = null;
let chipPopFor = null;

/** The explainer's host layer, created lazily so narrow test hosts and pre-pop paints
 *  never grow stray nodes. */
function popLayer() {
  if (chipPopHost && chipPopHost.parent) return chipPopHost;
  let existing = null;
  try { existing = document.getElementById('pop-layer'); } catch { /* no document */ }
  if (existing) { chipPopHost = existing; return existing; }
  const layer = document.createElement('div');
  layer.setAttribute('id', 'pop-layer');
  try { document.body.append(layer); } catch { /* no body in a narrow host */ }
  chipPopHost = layer;
  return layer;
}
let chipPopHost = null;

/** Detach a node from both real and fake-DOM hosts (the test harness's nodes have no
 *  .remove; splicing the parent's kid list is the same fact there). */
function detachNode(node) {
  if (!node) return;
  if (typeof node.remove === 'function') { node.remove(); return; }
  const p = node.parent;
  if (p && Array.isArray(p.kids)) p.kids = p.kids.filter((k) => k !== node);
}

/** Close the chip explainer and hand focus back to the chip it came from (a read-only
 *  chip is a real control; the keyboard user who opened this must not be dropped). */
function closeChipPop() {
  const back = chipPopFor;
  detachNode(chipPop);
  chipPop = null;
  chipPopFor = null;
  if (back && typeof back.focus === 'function') {
    try { back.focus(); } catch { /* best effort */ }
  }
}

/** Open (or toggle closed) the kernel-worded explainer for one chip node. Anchored to
 *  the chip when the host can measure a rect (a real browser), flipped ABOVE the chip
 *  when it would cross the viewport floor; the layer's CSS gives the unmeasured
 *  fallback a sane resting spot, and the native `title` on the chip always carried the
 *  same sentence for the no-JS/hover path. Focus moves to the popover's Close button
 *  so a keyboard user lands inside what they just opened. */
function openChipPop(chipNode, chip) {
  if (chipPopFor === chipNode) { closeChipPop(); return; }
  closeChipPop();
  const host = popLayer();
  if (!host || typeof host.append !== 'function') return; // narrow host: the title still carries the sentence
  const pop = el('div', {
    cls: 'cfx-pop',
    attrs: { role: 'dialog', 'aria-label': chip.explain || '' },
  },
    el('b', { cls: 'cfx-pop-label', text: chip.label || '' }),
    el('p', { cls: 'cfx-pop-body', text: chip.explain || '' }),
    el('button', {
      cls: 'btn secondary cfx-pop-close',
      text: t('combat.close'),
      attrs: { type: 'button' },
      on: { click: (ev) => { consumeClick(ev); closeChipPop(); } },
    }),
  );
  let measured = false;
  if (typeof chipNode.getBoundingClientRect === 'function') {
    try {
      const r = chipNode.getBoundingClientRect();
      pop.style.left = `${Math.round(r.left + r.width / 2)}px`;
      pop.style.top = `${Math.round(r.bottom + 6)}px`;
      measured = true;
    } catch { /* decorative positioning only; the CSS fallback stands */ }
  }
  host.append(pop);
  chipPop = pop;
  chipPopFor = chipNode;
  // Viewport clamp, measured AFTER the append (the popover must be in the tree to have
  // a height): a chip near the screen's bottom would push the sheet off-screen, so it
  // flips above the chip instead. Purely presentational; skipped where unmeasurable.
  if (measured) {
    try {
      const h = typeof pop.offsetHeight === 'number' ? pop.offsetHeight : 0;
      const vh = (typeof window !== 'undefined' && Number.isFinite(window.innerHeight)) ? window.innerHeight : 0;
      if (h > 0 && vh > 0 && parseFloat(pop.style.top) + h + 6 > vh) {
        const r = chipNode.getBoundingClientRect();
        pop.style.top = `${Math.round(r.top - 6)}px`;
        pop.classList.add('cfx-pop-above');
      }
    } catch { /* decorative only */ }
  }
  const closer = pop.querySelector ? pop.querySelector('.cfx-pop-close') : null;
  if (closer && typeof closer.focus === 'function') {
    try { closer.focus(); } catch { /* best effort */ }
  }
}

// Escape closes the explainer. A dismissal by tapping OUTSIDE it must never also play
// the card under the finger, and the swallow has to happen on CLICK: the Pointer Events
// spec exempts `click` from pointerdown cancellation, so stopping pointerdown alone
// would still let the tap through to the play button. Both listeners sit in capture
// phase at the document, ahead of every card handler; the popover's own buttons and the
// chips (which toggle) are let through. Registered once at module load, like i18n's
// document-level lang sync.
let chipPopSwallowUntil = 0;
const insideChipUi = (at) => Boolean(at && typeof at.closest === 'function'
  && (at.closest('.cfx-pop') || at.closest('.cfx-chip')));
const swallowClick = (ev) => {
  if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
  if (typeof ev.preventDefault === 'function') ev.preventDefault();
};
try {
  document.addEventListener('keydown', (ev) => {
    if (chipPop && (ev.key === 'Escape' || ev.key === 'Esc')) closeChipPop();
  });
  document.addEventListener('pointerdown', (ev) => {
    if (!chipPop || !ev) return;
    if (insideChipUi(ev.target)) return;
    // Close early (feels immediate) and arm a short swallow window: the click this
    // press produces is exempt from pointerdown cancellation, so it is stopped below.
    closeChipPop();
    chipPopSwallowUntil = Date.now() + 600;
  }, true);
  document.addEventListener('click', (ev) => {
    if (!ev) return;
    if (chipPop) {
      if (insideChipUi(ev.target)) return; // chips toggle, popover buttons work
      closeChipPop();
      swallowClick(ev);
      return;
    }
    // The press that dismissed us just produced this click: swallow it.
    if (Date.now() < chipPopSwallowUntil) {
      chipPopSwallowUntil = 0;
      swallowClick(ev);
    }
  }, true);
} catch { /* narrow test hosts with no document */ }

/**
 * One chip: the mark, the kernel's number, the kernel's sentence as the native title.
 * On READ-ONLY tiles (a div) the chip is a real interactive element (role=button,
 * tabindex, Enter/Space). On hand tiles the tile is a native <button> and nested
 * interactive elements are invalid HTML, so the chip stays a span whose pointer click
 * opens the explainer with stopPropagation — swallowing the play click, because
 * clicking a chip must NEVER play the card. The trade-off the span buys: a disabled
 * hand tile (no Energy, busy gate) also swallows its children's clicks in a real
 * browser, so those chips explain through their native title only, and keyboard users
 * reach the same sentence through the tile's aria-label, which always carries it.
 * @param {any} chip a kernel-published chip row
 * @param {boolean} readOnly the containing tile is a READ-ONLY READOUT, so the chip
 *   becomes a real control (role=button, tabbable); inside a native button (a hand tile,
 *   a targeting-mode enemy card) it stays an inert span — but with tabindex -1, so
 *   closing the explainer can still hand focus back to the chip it came from
 * @returns {HTMLElement}
 */
function chipNode(chip, readOnly, extraCls = '') {
  const mark = EFFECT_GLYPH[chip.status ?? chip.verb] || 'rune';
  const node = el('span', {
    cls: 'cfx-chip' + (extraCls ? ` ${extraCls}` : ''),
    attrs: {
      title: chip.explain || '',
      'aria-label': chip.explain || '',
      ...(readOnly ? { role: 'button', tabindex: '0' } : { tabindex: '-1' }),
    },
  },
    glyphBox(mark, 'cfx-mark'),
    chip.num ? el('b', { cls: 'cfx-num', text: chip.num }) : null,
  );
  const open = (ev) => {
    consumeClick(ev);
    // The play click dies here: the chip sits inside the play button, and without the
    // stopPropagation the hand tile would fire right after this handler in a real DOM.
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    openChipPop(node, chip);
  };
  node.addEventListener('click', open);
  if (readOnly) {
    node.addEventListener('keydown', (ev) => {
      if (ev && (ev.key === 'Enter' || ev.key === ' ')) {
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        open(ev);
      }
    });
  }
  return node;
}

/**
 * The chip row for one tile: one chip per kernel-published effect.
 * @param {any[]} chips the snapshot card's `chips` (may be empty)
 * @param {boolean} readOnly the tile is a fact, not a control
 * @returns {HTMLElement}
 */
function chipRow(chips, readOnly) {
  // role="group": the enemy-card readout pattern. Without a role, the aria-label on a
  // plain span is ignored by assistive tech — the row's name would never be heard.
  return el('span', {
    cls: 'cfx',
    attrs: { role: 'group', 'aria-label': t('card.effects') },
  }, ...chips.map((c) => chipNode(c, readOnly)));
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
  // PARITY-2: while THIS card waits for a target, its sentence is the AIMED enemy's own
  // variant (kernel-published `descriptionsByTarget`, keyed by the same 1-based living
  // slot `aimed` holds) — the fold preview follows the crosshair, so a Vulnerable foe
  // shows its amplified number the moment the pointer rests on it. No variant, or not
  // aiming: the resting face.
  const aimedDesc = isPending && aimed != null ? (card.descriptionsByTarget?.[aimed] ?? null) : null;
  const desc = aimedDesc || card.description || card.summary;
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
  // The EFFECT CHIPS occupy the rules row on every surface, and they own it outright
  // when the kernel says the chips say the whole card (`chipsComplete`): the long
  // sentence then leaves the visible face but stays in the tile's title and aria-label
  // above (they already carry `desc`). A card whose effects are not fully chip-
  // expressible (a `custom` verb) keeps its sentence BESIDE the chips, so nothing its
  // text says is ever lost to the icons. Rows without chips (an old snapshot) fall
  // straight through to the sentence — the old face.
  // PARITY-2b: while THIS card waits for a target, its chip row is the AIMED enemy's
  // own variant (kernel-published `chipsByTarget`, keyed by the same 1-based living slot
  // `aimed` holds) — the same swap `aimedDesc` performs on the sentence, so a covered
  // card's hidden fold still shows its amplified number under the crosshair. No variant
  // for this enemy, or not aiming: the resting face.
  const chips = (isPending && aimed != null ? (card.chipsByTarget?.[aimed] ?? null) : null)
    || (Array.isArray(card.chips) ? card.chips : []);
  if (chips.length > 0) tile.append(chipRow(chips, readOnly));
  if (!(chips.length > 0 && card.chipsComplete === true)) {
    tile.append(keywordText(el('span', { cls: 'cdesc' }), desc));
  }
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
 * its flavor line, its type word, and its effect-chip row — computed in the CURRENT language and cached per
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
          // The chip row rides the same fact bundle (describeTile's own), so a caller
          // that builds tiles from facts alone still paints kernel-worded icons.
          chips: tile.chips,
          chipsComplete: tile.chipsComplete,
        };
      })()
    : { description: '', flavor: '', type: 'unknown', typeLabel: 'unknown', chips: [], chipsComplete: false };
  per.set(cardId, fact);
  return fact;
}
