// src/web/fx.js — the FX queue: the persistent effect layer and its dispatcher.
//
// Everything here turns the `bursts` list produced by `act()` into DOM. Two placement
// rules, and nothing else:
//   * an effect that belongs to ONE enemy is put INSIDE that enemy's card (`.efx`), so it
//     lands on the right enemy for free;
//   * an effect that belongs to the whole SCREEN goes into `#fx-layer`, a sibling of
//     #stage that `render()` never clears.
// No geometry is measured anywhere except `throwLane()` (and, at fire time, the per-card
// signature effects in ./fx-signatures.js), so no effect can misplace itself after a
// repaint.
//
// `dispatchFx()` runs AFTER `render()`, so any node an effect wants to attach to already
// exists in its final tree. ONE generation is captured per action: every delayed effect
// checks it, so the effects of one action can never cancel each other and a newer action
// retires every pending timer of the previous one.

import { BIOMES, DEFAULT_BIOME } from '../kernel/index.js';
import {
  HERO_THROWS,
  THROW_MS,
  heroMove,
  signatureFor,
} from './hero-moves.js';
import {
  IMPACT_FEEL,
  STRIKE_SEQ,
  TURN_STEP,
  HERO_POSE_MS,
  animMs,
  animSpeed,
  animGen,
  applyHpStep,
  arriving,
  bursts,
  clearHitstop,
  fxEl,
  heroMoveHold,
  hpTrail,
  hpUnitHost,
  later,
  quietIntro,
  reducedMotion,
  revealFloats,
  setBursts,
  setHeroMoveHold,
  setImpactHold,
  setQuietIntro,
  snap,
  stageEl,
  strikeSeq,
  bumpAnimGen,
} from './runtime.js';
import { el, placeAt } from './dom.js';
import { fxAdd } from './fx-add.js';
import { t } from './i18n.js';
import { ENEMY_SIG_FX, SIG_FX } from './fx-signatures.js';
import { guardFloatNode, statusFloatNode, strikeFloatNode } from './floats.js';

/**
 * One line of words on the screen layer at the moment of arrival: the boss walks in, the
 * run ends, a floor is cleared, or the player steps along the path. The same single
 * primitive serves every arrival beat, so there is one thing to verify rather than four.
 * A `banner` class carries the kind, so the CSS can size each one differently.
 * @param {string} text the words (kernel-supplied labels only, or the surface's own)
 * @param {string} kind banner kind: boss | victory | defeat | floor | travel
 * @param {string} extra extra classes
 * @param {number} ms how long the node is left on the layer before removal
 */
export function fxBanner(text, kind, extra, ms) {
  fxAdd(el('div', { cls: `fx-banner banner-${kind}${extra ? ' ' + extra : ''}` },
    el('span', { cls: 'fx-banner-text', text })), ms);
}

/**
 * Scene transitions (presentation only, skipped under reduced motion by fxAdd): the very
 * first map of a run gets the act title card; every later phase change gets a short
 * ember-and-heat wipe. Fixed overlay, pointer-events none, so layout and clicks are untouched.
 * @param {string|null} from the phase painted before
 * @param {string} to the phase being painted
 */
export function sceneBeat(from, to) {
  if (from === null) {
    const quiet = quietIntro;
    setQuietIntro(false);
    if (quiet) return;
    if ((to === 'kindling' || to === 'map') && !(snap.map && snap.map.floor > 0)) {
      fxAdd(el('div', { cls: 'fx-act-card', attrs: { 'aria-hidden': 'true' } },
        el('span', { cls: 'fx-act-num', text: t('fx.act.one') }),
        el('span', { cls: 'fx-act-name', text: snap.biomeName ?? BIOMES[DEFAULT_BIOME].name }),
        el('span', { cls: 'fx-act-rule' })), animMs(2300));
    }
    return;
  }
  if (to === 'ended') return;
  fxAdd(el('div', { cls: `fx-scene to-${to}`, attrs: { 'aria-hidden': 'true' } }), animMs(700));
}

/**
 * Where the burst's aimed enemy actually sits, in fx-layer coordinates (the layer is
 * `position: fixed; inset: 0`, so viewport rects map 1:1), plus the hero's throwing
 * shoulder. The stylesheet's vw lane classes are only the fallback: the enemy row's
 * real layout shifts with the enemy count, so a lane guessed in vw misses the card it
 * is meant to hit — the thrown hammer flew across the top of the screen (owner report).
 * Measuring the card the burst names is the same truth DOM ancestry gives the floaters:
 * the burst carries the aimed enemy's living index, the card carries `data-target-index`.
 * A kill's ghost (the hold stage) keeps its side class, so it can be found too.
 * @returns {{x: number, y: number, from: {x: number, y: number}} | null}
 */
export function throwLane(b) {
  if (!stageEl || !stageEl.querySelector) return null;
  let card = null;
  if (b && Number.isInteger(b.enemy)) {
    // A kill re-indexes the row (the survivor takes the dead foe's TARGETING slot), so
    // the aimed foe's collapsing ghost must be matched BEFORE any living card — it is
    // the body the blow is still flying toward.
    card = stageEl.querySelector(`.enemy.is-dying[data-death-index="${b.enemy}"]`)
      ?? stageEl.querySelector(`.enemy[data-target-index="${b.enemy + 1}"]`);
  }
  if (!card) {
    const living = stageEl.querySelectorAll('.enemy[data-target-index]');
    if (living.length === 1) card = living[0];
  }
  if (!card) return null;
  const r = card.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const hero = stageEl.querySelector('.fight .hero');
  const hr = hero ? hero.getBoundingClientRect() : null;
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height * 0.55),
    from: hr
      ? { x: Math.round(hr.left + hr.width * 0.62), y: Math.round(hr.top + hr.height * 0.28) }
      : { x: Math.round(innerWidth * 0.08), y: Math.round(innerHeight * 0.39) },
  };
}

/**
 * Where the HERO stands, in fx-layer coordinates (the layer is `position: fixed; inset: 0`,
 * so viewport rects map 1:1), measured at the moment an effect needs it. The sequenced
 * enemy turn's named damage floats land here — over the hero's chest, where the old
 * aggregate floater used to rise from the hero's own effect box.
 * @returns {{x: number, y: number, w: number, h: number} | null}
 */
function heroLane() {
  if (!stageEl || !stageEl.querySelector) return null;
  const hero = stageEl.querySelector('.fight .hero');
  if (!hero) return null;
  const r = hero.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height * 0.24),
    w: r.width,
    h: r.height,
  };
}

/**
 * THE PARRY PROC's decoration ("golpes discretos"): a crossing-plates spark that blooms
 * and slides off at the DEFENDER's lane the moment a refused strike's float rises — over
 * the hero when the hero's parry ate an enemy golpe, over the enemy card when its
 * PARRY20 spur ate one of the hero's. Pure decoration on the persistent layer: aria-
 * hidden, no text, transform/opacity only, sized by padding + border so the diff
 * declares no width/height (the same shape discipline the fx-beat rings keep).
 * @param {{x: number, y: number}} [at] the defender's measured lane, or null (no lane,
 *   no node — an unmeasurable host simply skips the flourish)
 */
function parryProc(at) {
  if (!at) return;
  const proc = el('div', { cls: 'fx-parry-proc', attrs: { 'aria-hidden': 'true' } },
    el('span', { cls: 'fx-parry-proc-plate' }),
    el('span', { cls: 'fx-parry-proc-plate fx-parry-proc-plate-2' }),
    el('span', { cls: 'fx-parry-proc-spark' }));
  placeAt(proc, at, 0, 0);
  fxAdd(proc, animMs(560) || 560);
}

/**
 * THE IMPACT BUNDLE's live half (the impact recipe): retrigger the one-shot squash /
 * recoil on a golpe's victim at the beat its freeze window opens. The victim's LIVE
 * body is resolved with the very selector the hp trail writes bars through
 * (`hpUnitHost` — a killing golpe resolves to the collapsing ghost, exactly like a
 * landing hammer), the animation is restarted by reflow (the same mechanism the hp
 * pulse uses), the resume hold (`impactHold`) is armed for a repaint that lands inside
 * the window, and a generation-guarded timer retires the class when the bundle's paced
 * span is over — so it can never linger under a death or a launch that starts later.
 *
 * The bundle REPLACES the hurt flinch on this live figure for its whole span (the
 * stylesheet rule wins it), so the retirement also pins the figure's motion off with
 * the pose-hold grace form (`animation: none`): removing the class alone would restart
 * that flinch from 0% and play a second flinch no kernel event asked for. The next
 * paint rebuilds the tree and drops the inline style with it.
 *
 * Direction: an enemy victim recoils AWAY from the hero (`1`), the hero victim mirrors
 * it (`-1`), so both knockbacks read away from the blow. The recoil width is
 * pinned inline from IMPACT_FEEL so the value survives the `hitstop-heavy` class's own
 * retirement at window close (the recoil peak lands right after the unfreeze).
 * @param {string} key the victim unit ('p' or `e<index>`, the hpTrail namespace)
 * @param {number} gen this action's effect generation (the fire() guard's own)
 * @param {number} weight the golpe's freeze weight (2 widens the recoil)
 */
function restartImpact(key, gen, weight) {
  if (reducedMotion || animSpeed === 0) return;
  const host = hpUnitHost(key);
  const fig = host && host.querySelector ? host.querySelector('.fig') : null;
  if (!fig || !fig.classList) return;
  fig.classList.remove('is-impact');
  // Guarded for the fake-DOM test hosts (no offsetWidth there); the reflow is only the
  // retrigger nicety for a second golpe on a figure already carrying the class.
  if (typeof fig.offsetWidth === 'number') void fig.offsetWidth;
  // --impact-dir is a UNITLESS sign (calc() multiplication forbids length*length —
  // a px sign times a px width would drop the whole declaration); the width below
  // carries the unit. Both ride the hold: a repaint inside the window rebuilds the
  // figure, and the resume path (combat-view) must re-pin the SAME values, not the
  // stylesheet fallbacks a fresh node would otherwise inherit.
  const dir = key === 'p' ? '-1' : '1';
  const recoil = `${weight === 2 ? IMPACT_FEEL.recoilPxHeavy : IMPACT_FEEL.recoilPx}px`;
  if (fig.style && fig.style.setProperty) {
    fig.style.setProperty('--impact-dir', dir);
    fig.style.setProperty('--impact-recoil', recoil);
  }
  fig.classList.add('is-impact');
  const start = Date.now();
  const dur = animMs(IMPACT_FEEL.squashMs + IMPACT_FEEL.recoilMs) || (IMPACT_FEEL.squashMs + IMPACT_FEEL.recoilMs);
  setImpactHold({ key, start, until: start + dur, dir, recoil });
  later(() => {
    if (gen !== animGen) return;
    if (fig.classList) fig.classList.remove('is-impact');
    // The grace pin is for HURT-pose victims only: the inline `animation: none` would
    // beat the normal-specificity rules of the figures whose beats this bundle must
    // never own — the same closed enumeration the stylesheet's :not chain names (the
    // hero's death combo, a launch mid-flight, a gust lean) — and kill their beats
    // outright. On those figures the class just comes off.
    const owned = fig.classList
      && (fig.classList.contains('is-hero-death') || fig.classList.contains('launched') || fig.classList.contains('blown'));
    if (!owned && fig.style) fig.style.animation = 'none';
  }, dur);
}

/**
 * The weight of one golpe's freeze: killing (`hp <= 0` — the very predicate the death
 * hold and the floats' DOWN word use) or a heavy hit (dealt >= heavyDealt) freezes
 * heaviest, a mid hit (dealt >= midDealt) a step lighter, everything else light; a
 * parried golpe freezes nothing (-1) — the defender refused it outright and the parry
 * proc is its beat.
 * @param {{dealt?: number, hp?: number, parried?: boolean}|null} g one golpe's facts
 * @returns {number} 2 heavy / 1 mid / 0 light / -1 no freeze
 */
function feelWeight(g) {
  if (!g || g.parried) return -1;
  const dealt = typeof g.dealt === 'number' ? g.dealt : 0;
  if ((typeof g.hp === 'number' && g.hp <= 0) || dealt >= IMPACT_FEEL.heavyDealt) return 2;
  if (dealt >= IMPACT_FEEL.midDealt) return 1;
  return 0;
}

/**
 * THE IMPACT FEEL SCHEDULE (pure, unit-pinned): the freeze windows an action plays,
 * one per golpe, on the same clocks the golpe floats already fire on — each window
 * closes at or after its golpe's float beat, so the number lands INSIDE the frozen
 * frame (the light window is 60 base, not 50, on exactly that arithmetic — see
 * IMPACT_FEEL). The hero play reads its per-golpe facts off the card-fly burst's
 * `strikes` (the same array the fx-layer floats ride); an enemy turn reads the armed
 * plan's per-attacker entries, which turns the old single global freeze into one
 * window per attacker beat. Windows are disjoint by arithmetic, never by bookkeeping:
 * the beat is 500 base, the heaviest window 95 base, and both scale by the same
 * divisor, so they cannot overlap at any dock. A golpe-less action (a guard, a draw,
 * a quaff that only carries a reveal step — including a play whose burst flies with an
 * EMPTY `strikes` list, which is how a heal flies) keeps ONE light window as the beat
 * its numbers land on — lighter than the old fixed 70ms freeze; the same for a
 * non-attack turn's empty `attacks`. All-parried golpes (a NON-empty strike list whose
 * every entry was refused) freeze nothing at all.
 * @param {Array} list the action's bursts (dispatchFx's own list)
 * @param {any} plan the armed strike plan (runtime.strikeSeq) on an enemy turn
 * @returns {Array<{key: string|null, at: number, dur: number, weight: number}>}
 *   paced windows in time order; `key` null marks the golpe-less single window
 */
export function feelSchedule(list, plan) {
  const events = [];
  const fly = Array.isArray(list)
    ? list.find((b) => b && b.kind === 'card-fly' && Array.isArray(b.strikes) && b.strikes.length > 0)
    : null;
  const golpes = fly
    ? fly.strikes
    : (plan && Array.isArray(plan.attacks) && plan.attacks.length > 0 ? plan.attacks : null);
  if (golpes) {
    golpes.forEach((g, i) => {
      const weight = feelWeight(g);
      if (weight < 0) return; // parried: the proc decorates it, no freeze, no bundle
      const beat = fly ? animMs(STRIKE_SEQ.beat) * i : (plan.beatMs || 0) * i;
      events.push({
        key: fly ? `e${g.enemy}` : 'p',
        at: beat + animMs(IMPACT_FEEL.lead),
        dur: animMs(IMPACT_FEEL.freezeMs[weight]),
        weight,
      });
    });
  } else {
    events.push({
      key: null,
      at: animMs(IMPACT_FEEL.lead),
      dur: animMs(IMPACT_FEEL.freezeMs[0]),
      weight: 0,
    });
  }
  return events;
}

/**
 * The input span of one play, from its card-fly burst: the LONGEST beat of the
 * choreography dispatchFx will schedule for it, in paced milliseconds. UX-5 arms the
 * input lock for exactly this figure in `act()` — BEFORE the paint, the same place and
 * order the UX-2 strike plan is armed, so the hand the player sees after the play is
 * already painted locked. The span comes from the same lifetimes the beats use, never
 * a fixed sleep:
 *   * the pose — `(sig.poseMs) || HERO_POSE_MS[move] || 400`, paced (the base combat
 *     view's heroPose() will arm the hold with this very action);
 *   * a signature's tail — the render.js kill-hold convention: its impact beat fires
 *     at ~70% of the pose and the effect lives a paced 650ms beyond;
 *   * a throw's flight — HERO_THROWS' condense delay plus the flight itself;
 *   * the hit-stop beat (the 240 + 60..95 freeze windows of the impact recipe) where
 *     the play's numbers land — a FLOOR on the whole span, not an addition: the numbers
 *     land inside the FIRST window (whose close rose to up to 335 base with the per-
 *     golpe windows), so every beat that outlives them already covers them and summing
 *     would hold the hand dead past the last real beat.
 * `animMs` paces every figure, so the dock scales the gate with the animation. The
 * caller gates on the same condition dispatchFx plays under (not reduced motion, dock
 * not at »), so the gate never engages where nothing animates.
 * @param {{id?: string, type?: string}} b the card-fly burst
 * @returns {number} paced milliseconds the input should stay locked
 */
export function playInputSpan(b) {
  const sig = signatureFor(b);
  let span = animMs((sig && sig.poseMs) || HERO_POSE_MS[heroMove(b)] || 400);
  if (sig) span = Math.max(span, Math.round(span * 0.7) + animMs(650));
  if (b && b.id && HERO_THROWS[b.id]) {
    const spec = HERO_THROWS[b.id];
    span = Math.max(span, animMs(spec.delayMs ?? 0) + animMs(spec.ms ?? THROW_MS));
  }
  // GOLPES DISCRETOS: a multi-hit play beats out its floats one per STRIKE_SEQ beat, so
  // the gate holds past the pose until the LAST golpe's impact has landed (plus a short
  // beat for the float to be seen rising). A single-golpe play leaves the span untouched.
  const strikes = Array.isArray(b && b.strikes) ? b.strikes.length : 0;
  if (strikes > 1) {
    const beatMs = animMs(STRIKE_SEQ.beat);
    const impact = animMs(Math.round(STRIKE_SEQ.slam * STRIKE_SEQ.impactAt));
    span = Math.max(span, beatMs * (strikes - 1) + impact + animMs(300));
  }
  // The floor is the first freeze window's widest close (lead 240 + heavy 95 base): the
  // reveal — where the play's numbers land — must stay inside the locked span. The
  // multi-golpe arithmetic above already covers the later windows.
  return Math.max(span, animMs(340));
}

/**
 * Play the bursts collected for the action just taken. Called AFTER `render()`, so any
 * node an effect wants to attach to already exists in its final tree.
 */
export function dispatchFx() {
  const list = bursts;
  setBursts([]);
  // barra de vida por golpe: the trail's `reveal` steps (HP costs, heals, and the hook
  // damage Combust's sweep deals — facts with no golpe fire of their own) ride the
  // feel-queue fire where the play's numbers land. An action that produced no burst of
  // its own (a belt quaff heals, nothing else moves) still has that fire to offer, so
  // the early return below stands down for it rather than leaving the bar unfired until
  // the retirement's snap.
  const trailHasReveal = Boolean(hpTrail && (hpTrail.reveal.length > 0 || (Array.isArray(hpTrail.pre) && hpTrail.pre.length > 0)));
  if (reducedMotion || (list.length === 0 && !trailHasReveal)) return;
  // ONE generation per action, captured before any timer is scheduled. Every delayed
  // effect below (signature impacts, hammer landings, the hit-stop feel queue) checks
  // THIS generation, so the effects of one action can never cancel each other. A newer
  // action runs its own dispatchFx, bumps the generation once, and retires every pending
  // timer of the previous action — which is the whole point of the guard. (Bug this
  // replaced: each signature timer used to take its own ++animGen, so the feel queue's
  // later increment made every delayed signature effect cancel itself before it fired —
  // the stage shake, shockwave, anvil, salvo and rend never appeared.)
  const gen = bumpAnimGen();
  const fire = (fn, ms) => later(() => { if (gen === animGen) fn(); }, ms);
  // The arrival banners are driven by `arriving`, not by `bursts`: they describe a moment
  // (a boss walking in, a run ending) rather than a value that changed, and `arriving` is
  // already reset by the next paint. Consumed HERE, once, so nothing replays.
  const welcome = arriving.boss;
  // The boss's name is consumed with the beat (UX-9 D1), for the same reason: `arriving` is
  // replaced by the next paint, so reading it here is the one chance this play has.
  const welcomeName = arriving.bossName || '';
  const won = arriving.victory;
  const lost = arriving.defeat;
  arriving.boss = false;
  arriving.bossName = null;

  for (const b of list) {
    switch (b.kind) {
      case 'vignette':
        // Every fx-layer LIFETIME is a paced beat (animMs), so the node always outlives
        // its stylesheet animation — whose duration is the same base multiplied by
        // `--pace` — and » (animMs → 0) removes it at once.
        fxAdd(el('div', { cls: 'fx-vignette' }), animMs(620));
        break;
      case 'enemy-turn': {
        // UX-2: the enemy turn as a SEQUENCE of named attacks. The plan (armed in act()
        // before the paint) carries the divided clock; every beat below is scheduled on
        // THIS action generation, so a newer action (or ») retires the rest of the turn.
        // Speed 0 skips the choreography entirely — the » fast form paints the named
        // floats statically in the hero's own effect box (floats.js heroEfx).
        // A turn that KILLS the hero plays here too: render.js's defeat hold paints the
        // fight as it stood and this same replay runs over it — the named floats land on
        // the HELD hero (heroLane() measures whatever `.fight .hero` is painted), the
        // poses on the held attackers — and the hero's death beat waits on the plan's
        // own total (render.js). Nothing here knows which stage it is playing on.
        if (animSpeed === 0) break;
        const plan = strikeSeq;
        if (!plan) break;
        // UX-9c: the per-type presentations. `plan.plans` is the same turn grouped per
        // attacker (actions.js), so each strike beat knows its roster id and the moved
        // label; a type with no entry simply plays the generic beats below.
        const byFoe = new Map((plan.plans ?? []).map((p) => [p.enemy, p]));
        // GOLPES DISCRETOS: `plan.attacks` is ONE ENTRY PER STRIKE, so this loop beats out
        // the turn golpe by golpe — each entry gets its own float at its own impact beat,
        // and a multi-hit move reads as two slams a beat apart, not one accumulated
        // number with an "N×" suffix.
        plan.attacks.forEach((a, i) => {
          // Each strike's named float lands where its dash arrives (the slam's impact
          // keyframe), measured over the hero at fire time — a repaint between beats
          // moves the hero, so the lane is re-read when the beat fires, not captured once.
          // The fx-layer class rides the hold param (className assembly, the same shape
          // the tier ladder uses), so no classList surgery is needed on the node.
          fire(() => {
            const node = strikeFloatNode(a, ' fx-strike-float');
            const l = heroLane();
            if (l) placeAt(node, l, 0, 0);
            fxAdd(node, animMs(STRIKE_SEQ.floatMs) || STRIKE_SEQ.floatMs);
            // THE PARRY PROC — the defender's own decoration. The hero's parry refused
            // this strike outright, so the crossing-plates spark blooms over the hero
            // (the defender), beside the float that says so.
            if (a.parried) parryProc(l);
            // barra de vida por golpe: the HERO's bar steps on THIS fire — the same beat
            // the named float lands on, one clock. `a.hp` is the kernel's own
            // `enemy_attack.hp` (the hero's HP after this golpe); a parried golpe carries
            // the unchanged HP and applyHpStep leaves the bar alone.
            if (typeof a.hp === 'number') applyHpStep('p', a.hp);
          }, plan.beatMs * i + plan.impactMs);
          // The attacker's OWN bleed ticks ride this golpe (actions.js hung them off the
          // strike). They fire a short beat after the impact — the strike landed, then
          // the body bleeds — on the attacking enemy's measured lane, one float per tick.
          (a.ticks ?? []).forEach((tk, j) => {
            fire(() => {
              const node = statusFloatNode(tk, ' fx-beat-float');
              const at = throwLane({ enemy: tk.enemy });
              if (at) placeAt(node, at, 0, 0);
              fxAdd(node, animMs(STRIKE_SEQ.floatMs) || STRIKE_SEQ.floatMs);
              // barra de vida por golpe: the BLEEDING body's bar steps on this same
              // tick fire — the tick float and the bar step are one event.
              if (tk.enemy != null && typeof tk.hp === 'number') applyHpStep(`e${tk.enemy}`, tk.hp);
            }, plan.beatMs * i + plan.impactMs + animMs(260) + j * animMs(160));
          });
        });
        // UX-9b: the NON-ATTACK beats, on the SAME clock. `plan.tail` is the turn's guard /
        // power / hex / TICK steps in kernel order (armed in act()); they play one
        // TURN_STEP slot each, starting where the last slam ended — so a compound move
        // reads strike THEN guard, and the turn-closing poison ticks (the hero's, then
        // one per living foe) play as the tail's own beats. The input gate holds for the
        // whole plan (busyReason reads strikeSeq, not the attack count), which is what
        // keeps a block/buff/debuff turn from being raced by a player click.
        // The per-type table, iterated one knob at a time exactly like the hero's SIG_FX loop
        // above — one entry per ROSTER ID, one knob per beat kind. A knob that does not exist
        // for this type, or does not exist at all, leaves the generic beat as the fallback.
        const sigFor = (id) => (id ? ENEMY_SIG_FX[id] : null);
        plan.attacks.forEach((a, i) => {
          const foe = byFoe.get(a.enemy);
          const table = sigFor(foe && foe.id);
          if (!table || !table.attack) return;
          // UX-9: the same per-attacker offset the named float above uses. The table's own
          // clock already measures from the slam start (its impact knob is sigMs * impactAt,
          // i.e. plan.impactMs relative to a zero-delay fire), so the ONLY thing to add is
          // this attacker's beat — plan.beatMs * i. Attacker 0 is then byte-identical to
          // before, and attacker 2's flourish lands on its own slam instead of one beat
          // early, where it overlapped attacker 1's impact.
          // GOLPES DISCRETOS: the per-type attack flourish is ONE MARK PER BEAT now — the
          // payload carries this golpe's index (`hit` of `hits`), and the mark functions
          // (fxWardenPockets / fxCrawlerClaws) place exactly one pocket or claw pair per
          // call, offset by it.
          const offset = plan.beatMs * i;
          const staggered = (cb, ms) => fire(cb, (ms || 0) + offset);
          table.attack(staggered, null, { enemy: a.enemy, id: foe.id, move: foe.move, hit: a.hit, hits: a.hits }, plan.slamMs, gen);
        });
        plan.tail.forEach((s, i) => {
          fire(() => {
            const at = s.enemy != null && s.to !== 'player' ? throwLane(s) : null;
            const node = s.kind === 'block' ? guardFloatNode(s) : statusFloatNode(s);
            node.className += ' fx-beat-float';
            if (at) placeAt(node, at, 0, 0);
            else if (s.to === 'player') {
              const l = heroLane();
              if (l) placeAt(node, l, 0, 0);
            }
            fxAdd(node, animMs(STRIKE_SEQ.floatMs) || STRIKE_SEQ.floatMs);
            // The decoration that makes the beat read as an ACTION rather than a number
            // appearing: a shield arc for guard, a pulse for a status landing. Same lane as
            // the float above, so the two are one event. The two tests are hoisted OUT of
            // the class value on purpose: the surface-art checker reads every quoted span
            // in a class position as a class name, so `s.to === 'player'` inline would be
            // reported as an emitted (and unstyled) `.player`.
            const isBlock = s.kind === 'block';
            const isHex = s.kind === 'status' && s.to === 'player';
            // UX-9c: the SAME beat kind selects the type's own knob. `ownerId` is the acting
            // enemy (a `player_status` step carries no index of its own, see actions.js).
            // A tick is nobody's power move — the generic pulse carries it, no type knob.
            const board = s.kind === 'tick' ? null : sigFor(s.ownerId);
            const knob = isBlock ? 'guard' : (isHex ? 'hex' : 'power');
            if (board && board[knob]) {
              board[knob](fire, null, { enemy: s.owner, id: s.ownerId, move: s.move, hits: 1 }, plan.stepMs, gen);
            }
            const beat = el('div', {
              cls: `fx-beat ${isBlock ? 'fx-beat-guard' : 'fx-beat-status'}${isHex ? ' is-hex' : ''}`,
              attrs: { 'aria-hidden': 'true' },
            });
            if (at) placeAt(beat, at, 0, 0);
            else {
              const l = heroLane();
              if (l) placeAt(beat, l, 0, 0);
            }
            fxAdd(beat, animMs(TURN_STEP.ms) || TURN_STEP.ms);
            // barra de vida por golpe: a TICK step takes HP straight off its holder — the
            // bar steps on this same tail fire the tick float landed on. Player ticks
            // speak 'p'; an enemy tick names its own stable index. A tick that PRECEDES
            // its body's first golpe in the stream (`pre`) already applied at the
            // pre-beat — firing its absolute pre-golpe HP here would lift the bar the
            // golpes had already taken down.
            if (s.kind === 'tick' && typeof s.hp === 'number' && !s.pre) {
              applyHpStep(s.to === 'player' ? 'p' : `e${s.enemy}`, s.hp);
            }
          }, plan.tailAt + plan.stepMs * i);
        });
        // The screen pulse, re-timed to the sequence: ONE pulse when the last attack
        // lands, so the turn's cumulative weight reads without strobing the screen per
        // hit. (The aggregate "You take N" toast keeps the net fact for everyone else.)
        if (b.playerLost > 0) {
          // A turn with no slam (block/buff/hex only) cannot lose HP, so the fallback to
          // the tail's start is a guard against a future event pairing, not a live path.
          const last = plan.attacks.length - 1;
          const at = plan.attacks.length > 0 ? plan.beatMs * last + plan.impactMs : plan.tailAt;
          fire(() => fxAdd(el('div', { cls: 'fx-vignette' }), animMs(620)), at);
        }
        break;
      }
      case 'wipe':
        fxAdd(el('div', { cls: 'fx-turn-wipe' }), animMs(460));
        break;
      case 'card-fly':
        // `b.side` is already my own full lane class (`side-0` / `side-mid` / `side-1` /
        // `side-none`), so it is interpolated directly — prefixing it here produced
        // `side-side-0`, which no rule matches. Instant speed skips the flight.
        if (animSpeed === 0) break;
        fxAdd(el('div', { cls: `fx-card ${b.side || 'side-none'} type-${b.type || 'skill'}` },
          el('span', { cls: 'fx-card-name', text: b.name || '' })), animMs(460) || 460);
        // Both ends of every aimed effect are MEASURED once here (throwLane above): the
        // lane classes only remain as a fallback for an unmeasurable row, because a
        // guessed vw lane misses multi-enemy rows.
        const lane = throwLane(b);
        // MELEE APPROACH: a stroke that is not a throw or a cast carries the hero into
        // the aimed lane. The gap is measured HERE, after the paint, from the hero's
        // shoulder to the aimed card — the row's real layout, not a guessed vw lane —
        // written onto the live hero for THIS paint and onto the hold, so every repaint
        // during the pose re-applies the same distance (combat-view reads it). The 56px
        // margin keeps the hero just short of the card it strikes. No lane (unmeasurable
        // host) means no visible step, and the pose still plays in place.
        const hold = heroMoveHold;
        if (hold && hold.melee) {
          const dist = lane ? Math.max(0, Math.round(lane.x - lane.from.x - 56)) : 0;
          setHeroMoveHold({ ...hold, approachX: dist });
          const live = stageEl && stageEl.querySelector ? stageEl.querySelector('.hero') : null;
          if (live && live.style && live.style.setProperty) live.style.setProperty('--approach-x', `${dist}px`);
        }
        // THROW choreography: a spinning hammer leaves the hero, arcs into the aimed
        // lane, and (for Returning Brand) flies back. The burst carries the card id, so
        // the effect layer can read `HERO_THROWS` for the return beat. The impact flash
        // is delayed to the moment the arc lands (84% of the flight).
        if (b.id && HERO_THROWS[b.id]) {
          const spec = HERO_THROWS[b.id];
          const flight = spec.ms ?? THROW_MS;
          const throwCls = `fx-hammer ${b.side || 'side-none'}${spec.returns ? ' fx-hammer-returns' : ''}${spec.blood ? ' fx-hammer-blood' : ''}`;
          const launch = () => {
            const hammer = el('div', { cls: throwCls, attrs: { 'aria-hidden': 'true' } },
              el('span', { cls: 'fx-hammer-head' }), el('span', { cls: 'fx-hammer-haft' }));
            if (lane) {
              hammer.style.left = `${lane.from.x - 27}px`;
              hammer.style.top = `${lane.from.y - 11}px`;
              hammer.style.setProperty('--fly-x', `${lane.x - lane.from.x}px`);
              hammer.style.setProperty('--fly-y', `${lane.y - lane.from.y}px`);
            }
            fxAdd(hammer, animMs(flight) || flight);
            fire(() => {
              const hit = el('div', { cls: `fx-hammer-hit ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } });
              if (lane) placeAt(hit, lane, -45, -45);
              fxAdd(hit, animMs(420) || 420);
            }, animMs(Math.round(flight * (spec.hitAt ?? 0.84))) || 1);
          };
          // Blood Hammer condenses FIRST: the flight is held (delayMs) until the clot at
          // the hero's chest closes; every other throw leaves the shoulder immediately.
          if (spec.delayMs) fire(launch, animMs(spec.delayMs) || 1);
          else launch();
        }
        // SIGNATURE choreography (per-card): each knob fires at its own beat of the SAME
        // action generation, so the hit-stop queue below can never retire them early.
        // The knob -> effect table lives in fx-signatures.js next to the effects it
        // dispatches; Object.entries() yields it in creation order, which is the order
        // the timers were scheduled in before the table existed.
        const sig = signatureFor(b);
        if (sig) {
          const sigMs = sig.poseMs || HERO_POSE_MS[heroMove(b)] || 800;
          for (const [knob, play] of Object.entries(SIG_FX)) {
            if (sig[knob]) play(fire, lane, b, sigMs, gen);
          }
        }
        // GOLPES DISCRETOS — the hero's own strike sequence. A play whose kernel events
        // carried per-strike `damage` facts (actions.js hung them on this burst as
        // `strikes`) floats ONE number per golpe, each on its own STRIKE_SEQ beat, while
        // the pose hold (combat-view) keeps the hero mid-swing: "pose + impacto + float
        // propio por CADA golpe". The lane is re-measured at fire time — a killing golpe
        // resolves to the victim's collapsing ghost, exactly like a thrown hammer's
        // landing. A parried golpe blooms the parry proc at the foe (the defender) that
        // refused it. Speed 0 skips the choreography; the » fast form stacks the same
        // facts statically in the enemy's own effect box (floats.js efxBox).
        if (Array.isArray(b.strikes) && b.strikes.length > 0) {
          const beatMs = animMs(STRIKE_SEQ.beat);
          const impact = animMs(Math.round(STRIKE_SEQ.slam * STRIKE_SEQ.impactAt));
          b.strikes.forEach((s, k) => {
            fire(() => {
              const node = strikeFloatNode(s, ' fx-golpe-float');
              const at = throwLane({ enemy: s.enemy });
              if (at) placeAt(node, at, 0, 0);
              fxAdd(node, animMs(STRIKE_SEQ.floatMs) || STRIKE_SEQ.floatMs);
              if (s.parried) parryProc(at);
              // barra de vida por golpe: the target's bar steps on THIS fire — the same
              // beat its golpe float lands on. `s.hp` is the kernel's `damage.hp` (the
              // target's HP after this golpe); a killing golpe drives the bar — live
              // card or collapsing ghost, whichever body holds it now — to 0 here.
              if (typeof s.hp === 'number') applyHpStep(`e${s.enemy}`, s.hp);
            }, beatMs * k + impact);
          });
        }
        // UX-5: this play's input lock was armed by act() for `playInputSpan(b)` — the
        // figure this case's own choreography adds up to — BEFORE the paint, so the
        // hand repainted locked. There is nothing to arm here.
        break;
      default:
        break;
    }
  }
  // The boss arrives as a BEAT, not a bigger fade: a red wash, a heavier and slower
  // title card, plus a ring that expands out of the enemy row. The card's word is the
  // acting boss's own name, carried on the beat by the renderer (UX-9 D1) — the snapshot
  // name is already localized, so Slag Warden and the Cinder Foreman each announce
  // themselves in EN and ES with no literal here.
  if (welcome) {
    fxBanner(welcomeName, 'boss', '', animMs(1350));
    fxAdd(el('div', { cls: 'fx-boss-ring' }), animMs(1100));
  }
  // The run's last two moments, each with its own weight: a bright hold for the win, a
  // slow darkening for the loss. Both are words as well as motion.
  if (won) {
    fxBanner('VICTORY', 'victory', '', animMs(1500));
    fxAdd(el('div', { cls: 'fx-run-bloom' }), animMs(1400));
  }
  if (lost) {
    fxBanner('DEFEAT', 'defeat', '', animMs(1700));
    fxAdd(el('div', { cls: 'fx-darken' }), animMs(1700));
  }
  // THE IMPACT FEEL QUEUE (the impact recipe): one freeze window per golpe, armed from
  // the pure schedule above on the SAME action generation captured above, so it
  // coexists with the signature timers instead of retiring them. The hpTrail pre
  // invariant keeps its shape: the trail's pre steps land on the FIRST window's arm —
  // the first UNPARRIED golpe's beat + animMs(240); a mixed play whose golpe 0 was
  // parried owns no window for it, so windows[0] sits one beat in — and that is still
  // strictly before THAT golpe's bar step (its float fires at its own beat +
  // animMs(294), and every window closes at or past its golpe's float beat) — on the
  // same timers as the freezes rather than a sibling, so the bar walks the stream in
  // order instead of falling with the first slam and then rising back to the pre-golpe
  // value with a heal pulse. The first window's close still owns the reveal (the queued
  // floats and the trail's reveal steps); later windows only freeze and unfreeze their
  // own beat. Speed 0 and reduced motion never wait (and neither arms a trail — the
  // reveal application below is a no-op there by construction).
  if (reducedMotion || animSpeed === 0) {
    revealFloats();
    return;
  }
  const t = hpTrail;
  const windows = feelSchedule(list, strikeSeq);
  if (windows.length === 0) {
    // THE ALL-PARRIED ACTION: every golpe was refused outright, so the schedule opens
    // no freeze window and pins no squash — the parry proc is the whole beat. The
    // action's TRAIL fires are not freeze facts, though: the hp_cost/pre steps, the
    // queued floats' reveal and the reveal steps are owed regardless of windows (the
    // old unconditional feel queue fired them for every action). Fire that pair on the
    // HEAD beats — pre@animMs(240), reveal@animMs(310), both inside the animMs(340)
    // input-lock floor (playInputSpan) — with no hitstop class and no restartImpact.
    fire(() => {
      if (t && Array.isArray(t.pre)) {
        for (const s of t.pre) applyHpStep(s.unit, s.hp);
      }
    }, animMs(240));
    fire(() => {
      revealFloats();
      if (t && Array.isArray(t.reveal)) {
        for (const s of t.reveal) applyHpStep(s.unit, s.hp);
      }
    }, animMs(310));
  } else windows.forEach((w, i) => {
    fire(() => {
      if (i === 0 && t && Array.isArray(t.pre)) {
        for (const s of t.pre) applyHpStep(s.unit, s.hp);
      }
      if (stageEl && stageEl.classList) {
        stageEl.classList.add('hitstop');
        if (w.weight === 2) stageEl.classList.add('hitstop-heavy');
      }
      if (fxEl && fxEl.classList) {
        fxEl.classList.add('hitstop');
        if (w.weight === 2) fxEl.classList.add('hitstop-heavy');
      }
      if (w.key) restartImpact(w.key, gen, w.weight);
    }, w.at);
    fire(() => {
      clearHitstop();
      if (i === 0) {
        revealFloats();
        // barra de vida por golpe: the trail's reveal steps land HERE — the same fire
        // this action's first floats land on, never a sibling timer that could drift.
        // The golpe-fired steps (the per-strike/per-attack/tail facts) were hung on
        // their own golpe's fire above; this is only for the facts without one. The
        // steps that preceded their body's first golpe already applied at the pre-beat.
        if (t && Array.isArray(t.reveal)) {
          for (const s of t.reveal) applyHpStep(s.unit, s.hp);
        }
      }
    }, w.at + w.dur);
  });
}
