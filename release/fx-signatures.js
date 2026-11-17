// src/web/fx-signatures.js — the per-card SIGNATURE effects, one function per knob.
//
// Each card's signature choreography (HERO_SIGNATURES in ./hero-moves.js) is one knob
// ("shake", "anvil", "twin", ...) that switches on exactly one function here. The knobs
// fire at their own beat of the SAME action generation, so the hit-stop queue in
// dispatchFx() can never retire them early.
//
// Every function takes the same five handles so the call sites are uniform:
//   * fire(fn, ms)  — the action-generation-guarded scheduler from dispatchFx();
//   * lane          — the measured {x, y, from} of the aimed enemy (or null);
//   * b             — the card-fly burst (side, enemy index, card id);
//   * sigMs         — the pose's own length in ms (signature poseMs, or the move's base);
//   * gen           — this action's generation, for timers that must self-cancel.
//
// Placement truth: effects anchored to the hero or the whole enemy row MEASURE the live
// DOM at fire time (the hero node is rebuilt by repainting); lane classes are only the
// fallback. No geometry is measured anywhere else.

import { el, placeAt } from './dom.js';
import { animGen, animMs, later, stageEl } from './runtime.js';
import { fxAdd } from './fx-add.js';
import { THROW_MS } from './hero-moves.js';


export function fxShake(fire, lane, b, sigMs, gen) {
  fire(() => {
    if (stageEl && stageEl.classList) stageEl.classList.add('stage-shake');
    later(() => {
      if (gen === animGen && stageEl && stageEl.classList) stageEl.classList.remove('stage-shake');
    }, animMs(450) || 450);
  }, animMs(Math.round(sigMs * 0.66)) || 1);
}


export function fxShockwave(fire, lane, b, sigMs, gen) {
  fire(() => {
    const wave = el('div', { cls: `fx-shockwave ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } });
    if (lane) placeAt(wave, lane, -35, -35);
    fxAdd(wave, animMs(560) || 560);
  }, animMs(Math.round(sigMs * 0.66)) || 1);
}

        // Anvil Blow: the spectral anvil falls and cracks onto the target.
export function fxAnvil(fire, lane, b, sigMs, gen) {
  fire(() => {
    const anvil = el('div', { cls: `fx-anvil ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-anvil-body' }), el('span', { cls: 'fx-anvil-crack' }));
    if (lane) anvil.style.left = `${lane.x - 37}px`;
    fxAdd(anvil, animMs(700) || 700);
  }, animMs(Math.round(sigMs * 0.58)) || 1);
}

        // Twin Hammers: a SALVO — two hammers, 180ms apart, two impact flashes timed
        // to each hammer's own landing (84% of the flight from each launch).
export function fxTwin(fire, lane, b, sigMs, gen) {
  const TWIN_STAGGER = 180;
  for (let n = 0; n < 2; n++) {
    fire(() => {
      const hammer = el('div', { cls: `fx-hammer ${b.side || 'side-none'} fx-hammer-twin-${n ? 'second' : 'first'}`, attrs: { 'aria-hidden': 'true' } },
        el('span', { cls: 'fx-hammer-head' }), el('span', { cls: 'fx-hammer-haft' }));
      if (lane) {
        hammer.style.left = `${lane.from.x - 27}px`;
        hammer.style.top = `${lane.from.y - 11}px`;
        hammer.style.setProperty('--fly-x', `${lane.x - lane.from.x}px`);
        hammer.style.setProperty('--fly-y', `${lane.y - lane.from.y}px`);
      }
      fxAdd(hammer, animMs(THROW_MS) || THROW_MS);
      fire(() => {
        const hit = el('div', { cls: `fx-hammer-hit ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } });
        if (lane) placeAt(hit, lane, -45, -45);
        fxAdd(hit, animMs(420) || 420);
      }, animMs(Math.round(THROW_MS * 0.84)) || 1);
    }, animMs(n * TWIN_STAGGER) || 1);
  }
}

        // Sunder: the burning seam splits the air down the target lane.
export function fxRend(fire, lane, b, sigMs, gen) {
  fire(() => {
    const seam = el('div', { cls: `fx-rend ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-rend-seam' }), el('span', { cls: 'fx-rend-seam fx-rend-seam-2' }));
    if (lane) seam.style.left = `${lane.x - 13}px`;
    fxAdd(seam, animMs(560) || 560);
  }, animMs(Math.round(sigMs * 0.55)) || 1);
}

        // Rising Blow: the aimed enemy is LAUNCHED off its stance at the impact beat.
export function fxLaunch(fire, lane, b, sigMs, gen) {
  fire(() => {
    // Enemy cards carry data-target-index = position+1 (the targeting k); the
    // burst's enemy index is the kernel's living index (0-based) at that paint.
    const cards = stageEl && stageEl.querySelectorAll ? [...stageEl.querySelectorAll('.enemy')] : [];
    const target = b.enemy != null
      ? cards.find((c) => c.getAttribute && c.getAttribute('data-target-index') === String(b.enemy + 1))
      : null;
    const fig = (target || cards[0])?.querySelector('.fig');
    if (fig && fig.classList) {
      fig.classList.add('launched');
      later(() => {
        if (gen === animGen && fig.classList) fig.classList.remove('launched');
      }, animMs(620) || 620);
    }
  }, animMs(Math.round(sigMs * 0.55)) || 1);
}

        // Hammerfall: the drop cracks the lane — a small crack splits the ground under the
        // aimed enemy and forge-dust puffs out of it, at the beat the hammer lands.
export function fxDustcrack(fire, lane, b, sigMs, gen) {
  fire(() => {
    const crack = el('div', { cls: `fx-dustcrack ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-dustcrack-crack' }),
      el('span', { cls: 'fx-dustcrack-puff' }),
      el('span', { cls: 'fx-dustcrack-puff fx-dustcrack-puff-2' }),
      el('span', { cls: 'fx-dustcrack-puff fx-dustcrack-puff-3' }));
    if (lane) placeAt(crack, lane, -55, 88);
    fxAdd(crack, animMs(620) || 620);
  }, animMs(Math.round(sigMs * 0.62)) || 1);
}

        // Quench: a veil of blue-white steam climbs the HERO. Effects on the hero anchor
        // to the hero's own measured box (the hero node is rebuilt by repainting, so it
        // is measured HERE, at fire time — the same truth the lane classes fall back to).
export function fxQuenchveil(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const veil = el('div', { cls: 'fx-quenchveil', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-quenchveil-steam' }),
      el('span', { cls: 'fx-quenchveil-steam fx-quenchveil-steam-2' }),
      el('span', { cls: 'fx-quenchveil-steam fx-quenchveil-steam-3' }));
    veil.style.left = `${Math.round(r.left + r.width * 0.5 - 34)}px`;
    veil.style.top = `${Math.round(r.top + r.height * 0.16)}px`;
    fxAdd(veil, animMs(780) || 780);
  }, animMs(Math.round(sigMs * 0.3)) || 1);
}

        // Bellows Gust: a cone of wind sweeps the WHOLE enemy row — it is sized to the
        // row's measured span (a targeted lane would miss an all-row hit) — and the row
        // leans back under it (a `blown` class on each figure, one gust, then gone).
export function fxGustcone(fire, lane, b, sigMs, gen) {
  fire(() => {
    const cards = stageEl && stageEl.querySelectorAll
      ? [...stageEl.querySelectorAll('.enemy[data-target-index]')] : [];
    const cone = el('div', { cls: `fx-gustcone ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-gustcone-streak' }),
      el('span', { cls: 'fx-gustcone-streak fx-gustcone-streak-2' }),
      el('span', { cls: 'fx-gustcone-streak fx-gustcone-streak-3' }));
    if (cards.length > 0) {
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
      }
      if (right > left) {
        cone.style.left = `${Math.round(left - 80)}px`;
        cone.style.top = `${Math.round((top + bottom) / 2 - 60)}px`;
        cone.style.setProperty('--gust-w', `${Math.round(right - left + 100)}px`);
      }
    }
    fxAdd(cone, animMs(640) || 640);
    for (const c of cards) {
      const fig = c.querySelector && c.querySelector('.fig');
      if (fig && fig.classList) {
        fig.classList.add('blown');
        later(() => {
          if (gen === animGen && fig.classList) fig.classList.remove('blown');
        }, animMs(600) || 600);
      }
    }
  }, animMs(Math.round(sigMs * 0.45)) || 1);
}

        // Spark: the snap casts — an ember dart flies from the hero's shoulder to the
        // aimed lane, and a luminous mote peels off and drifts back to the draw pile.
export function fxSparkdart(fire, lane, b, sigMs, gen) {
  fire(() => {
    const dart = el('div', { cls: `fx-sparkdart ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } });
    if (lane) {
      dart.style.left = `${lane.from.x - 10}px`;
      dart.style.top = `${lane.from.y - 8}px`;
      dart.style.setProperty('--dart-x', `${lane.x - lane.from.x}px`);
      dart.style.setProperty('--dart-y', `${lane.y - lane.from.y}px`);
    }
    fxAdd(dart, animMs(430) || 430);
    const pile = stageEl && stageEl.querySelector ? stageEl.querySelector('.pile-draw') : null;
    if (lane && pile) {
      const pr = pile.getBoundingClientRect();
      const mote = el('div', { cls: 'fx-sparkmote', attrs: { 'aria-hidden': 'true' } });
      mote.style.left = `${lane.from.x - 7}px`;
      mote.style.top = `${lane.from.y - 7}px`;
      mote.style.setProperty('--mote-x', `${Math.round(pr.left + pr.width / 2 - lane.from.x)}px`);
      mote.style.setProperty('--mote-y', `${Math.round(pr.top + pr.height / 2 - lane.from.y)}px`);
      fxAdd(mote, animMs(820) || 820);
    }
  }, animMs(Math.round(sigMs * 0.4)) || 1);
}

        // Fan the Flames: three flame tongues open in a fan by the hero's furnace, and
        // one bright spark darts off to the energy orb — the fire fed, the orb fed.
export function fxFlarefan(fire, lane, b, sigMs, gen) {
  fire(() => {
    const fan = el('div', { cls: 'fx-flarefan', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-flarefan-tongue' }),
      el('span', { cls: 'fx-flarefan-tongue fx-flarefan-tongue-2' }),
      el('span', { cls: 'fx-flarefan-tongue fx-flarefan-tongue-3' }));
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (hero) {
      const r = hero.getBoundingClientRect();
      fan.style.left = `${Math.round(r.left + r.width * 0.55)}px`;
      fan.style.top = `${Math.round(r.top + r.height * 0.08)}px`;
    }
    fxAdd(fan, animMs(700) || 700);
    const orb = stageEl && stageEl.querySelector ? stageEl.querySelector('.energy-orb') : null;
    if (orb) {
      const or = orb.getBoundingClientRect();
      const spark = el('div', { cls: 'fx-flarespark', attrs: { 'aria-hidden': 'true' } });
      const hr = hero ? hero.getBoundingClientRect() : null;
      const sx = hr ? Math.round(hr.left + hr.width * 0.62) : Math.round(innerWidth * 0.2);
      const sy = hr ? Math.round(hr.top + hr.height * 0.3) : Math.round(innerHeight * 0.5);
      spark.style.left = `${sx}px`;
      spark.style.top = `${sy}px`;
      spark.style.setProperty('--spark-x', `${Math.round(or.left + or.width / 2 - sx)}px`);
      spark.style.setProperty('--spark-y', `${Math.round(or.top + or.height / 2 - sy)}px`);
      fxAdd(spark, animMs(560) || 560);
    }
  }, animMs(Math.round(sigMs * 0.42)) || 1);
}

        // ==== LOTE 2 — ataques comunes I: each common attack draws its own mark. ====
        // Arc Cut: ONE horizontal luminous arc crosses the WHOLE enemy row, side to
        // side — sized to the row's measured span (like the gust cone), never to a
        // single lane, because the card hits all enemies.
export function fxArcspan(fire, lane, b, sigMs, gen) {
  fire(() => {
    const cards = stageEl && stageEl.querySelectorAll
      ? [...stageEl.querySelectorAll('.enemy[data-target-index]')] : [];
    const arc = el('div', { cls: `fx-arcspan ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-arcspan-blade' }),
      el('span', { cls: 'fx-arcspan-under' }));
    if (cards.length > 0) {
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
      }
      if (right > left) {
        arc.style.left = `${Math.round(left - 60)}px`;
        arc.style.top = `${Math.round((top + bottom) / 2 - 26)}px`;
        arc.style.setProperty('--arc-w', `${Math.round(right - left + 120)}px`);
      }
    }
    fxAdd(arc, animMs(520) || 520);
  }, animMs(Math.round(sigMs * 0.5)) || 1);
}

        // Collar Check: a taut line flashes across the lane at NECK height, then two
        // sagging weak marks droop in over the target — the status drawn as weight.
export function fxCollarline(fire, lane, b, sigMs, gen) {
  fire(() => {
    const wire = el('div', { cls: `fx-collarline ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-collarline-wire' }),
      el('span', { cls: 'fx-collarline-sag' }),
      el('span', { cls: 'fx-collarline-sag fx-collarline-sag-2' }));
    if (lane) placeAt(wire, lane, -70, -66);
    fxAdd(wire, animMs(680) || 680);
  }, animMs(Math.round(sigMs * 0.42)) || 1);
}

        // Brow Strike: an eight-point impact star bursts where the brow lands; the
        // pose's own recoil then reads the bounce-off.
export function fxImpactstar(fire, lane, b, sigMs, gen) {
  fire(() => {
    const star = el('div', { cls: `fx-impactstar ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-impactstar-core' }),
      el('span', { cls: 'fx-impactstar-ray' }));
    if (lane) placeAt(star, lane, -48, -60);
    fxAdd(star, animMs(440) || 440);
  }, animMs(Math.round(sigMs * 0.55)) || 1);
}

        // Slag Surge: a molten plate glows on the HERO's front (measured hero box, the
        // quenchveil anchor), and a wave of slag rolls along the GROUND from the hero's
        // feet to the aimed lane.
export function fxSlagwave(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const plate = el('div', { cls: 'fx-slagplate', attrs: { 'aria-hidden': 'true' } });
    plate.style.left = `${Math.round(r.left + r.width * 0.22)}px`;
    plate.style.top = `${Math.round(r.top + r.height * 0.18)}px`;
    fxAdd(plate, animMs(760) || 760);
    const wave = el('div', { cls: `fx-slagwave ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } });
    const wx = Math.round(r.left + r.width * 0.55);
    const wy = Math.round(r.top + r.height * 0.92);
    wave.style.left = `${wx}px`;
    wave.style.top = `${wy}px`;
    if (lane) {
      wave.style.setProperty('--slag-x', `${Math.round(lane.x - wx)}px`);
      wave.style.setProperty('--slag-y', `${Math.round(lane.y - wy)}px`);
    }
    fxAdd(wave, animMs(720) || 720);
  }, animMs(Math.round(sigMs * 0.3)) || 1);
}

        // Haft Jab: the pommel's blunt cap cracks against the target, and a card is
        // PULLED out of the foe — it flies FROM the enemy toward the hero's hand.
export function fxJabpull(fire, lane, b, sigMs, gen) {
  fire(() => {
    const cap = el('div', { cls: `fx-jabspark ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } });
    if (lane) placeAt(cap, lane, -26, -30);
    fxAdd(cap, animMs(320) || 320);
  }, animMs(Math.round(sigMs * 0.42)) || 1);
  fire(() => {
    const hand = stageEl && stageEl.querySelector ? stageEl.querySelector('.hand') : null;
    if (!lane || !hand) return;
    const hr = hand.getBoundingClientRect();
    const card = el('div', { cls: 'fx-jabpull', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-jabpull-face' }),
      el('span', { cls: 'fx-jabpull-tip' }));
    card.style.left = `${lane.x - 16}px`;
    card.style.top = `${lane.y - 22}px`;
    card.style.setProperty('--pull-x', `${Math.round(hr.left + hr.width * 0.28 - lane.x)}px`);
    card.style.setProperty('--pull-y', `${Math.round(hr.top + hr.height / 2 - lane.y)}px`);
    fxAdd(card, animMs(640) || 640);
  }, animMs(Math.round(sigMs * 0.52)) || 1);
}

        // ==== LOTE 3 — ataques comunes II: each common attack draws its own mark. ====
        // Forgeclap: TWO hammer heads rise and MEET overhead — the clash point is ABOVE
        // the hero (measured hero box), and the shock ring plus the vulnerable cracks
        // span the WHOLE row (measured row span, like the gust cone: every enemy is hit).
export function fxForgering(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const forge = el('div', { cls: 'fx-forgering', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-forgering-head fx-forgering-head-left' }),
      el('span', { cls: 'fx-forgering-head fx-forgering-head-right' }),
      el('span', { cls: 'fx-forgering-clash' }),
      el('span', { cls: 'fx-forgering-ring' }));
    forge.style.left = `${Math.round(r.left + r.width * 0.5 - 60)}px`;
    forge.style.top = `${Math.round(r.top - 64)}px`;
    fxAdd(forge, animMs(720) || 720);
    const cards = stageEl && stageEl.querySelectorAll
      ? [...stageEl.querySelectorAll('.enemy[data-target-index]')] : [];
    const cracks = el('div', { cls: `fx-forgecracks ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-forgecracks-mark' }),
      el('span', { cls: 'fx-forgecracks-mark fx-forgecracks-mark-2' }),
      el('span', { cls: 'fx-forgecracks-mark fx-forgecracks-mark-3' }));
    if (cards.length > 0) {
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
      for (const c of cards) {
        const cr = c.getBoundingClientRect();
        if (cr.width === 0 && cr.height === 0) continue;
        left = Math.min(left, cr.left); top = Math.min(top, cr.top);
        right = Math.max(right, cr.right); bottom = Math.max(bottom, cr.bottom);
      }
      if (right > left) {
        cracks.style.left = `${Math.round(left)}px`;
        cracks.style.top = `${Math.round((top + bottom) / 2 - 34)}px`;
        cracks.style.setProperty('--forge-w', `${Math.round(right - left)}px`);
      }
    }
    fxAdd(cracks, animMs(660) || 660);
  }, animMs(Math.round(sigMs * 0.2)) || 1);
}

        // Untempered: the untempered double swing throws white-hot cracks AROUND the
        // aimed lane — one flare per wild beat (the fissures flash twice), white core
        // cooling to ember red.
export function fxWildcracks(fire, lane, b, sigMs, gen) {
  fire(() => {
    const cracks = el('div', { cls: `fx-wildcracks ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-wildcracks-fissure' }),
      el('span', { cls: 'fx-wildcracks-fissure fx-wildcracks-fissure-2' }),
      el('span', { cls: 'fx-wildcracks-fissure fx-wildcracks-fissure-3' }));
    if (lane) placeAt(cracks, lane, -66, -44);
    fxAdd(cracks, animMs(700) || 700);
  }, animMs(Math.round(sigMs * 0.3)) || 1);
}

        // Bellows: ONE ember pulse blooms and collapses at the hero's chest as it
        // swells — a single pulse, deliberately never a column (the quench veil's).
export function fxChestpulse(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const pulse = el('div', { cls: 'fx-chestpulse', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-chestpulse-core' }),
      el('span', { cls: 'fx-chestpulse-halo' }));
    pulse.style.left = `${Math.round(r.left + r.width * 0.5 - 26)}px`;
    pulse.style.top = `${Math.round(r.top + r.height * 0.24)}px`;
    fxAdd(pulse, animMs(560) || 560);
  }, animMs(Math.round(sigMs * 0.18)) || 1);
}

        // Heel Drop: the heels land — embers burst at the impact point, and the
        // refunded energy is a spark that rides FROM the burst INTO the energy orb
        // (the flarefan's spark flies hero→orb; this one flies lane→orb).
export function fxHeelburst(fire, lane, b, sigMs, gen) {
  fire(() => {
    const burst = el('div', { cls: `fx-heelburst ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-heelburst-core' }),
      el('span', { cls: 'fx-heelburst-ember' }),
      el('span', { cls: 'fx-heelburst-ember fx-heelburst-ember-2' }),
      el('span', { cls: 'fx-heelburst-ember fx-heelburst-ember-3' }));
    if (lane) placeAt(burst, lane, -40, -34);
    fxAdd(burst, animMs(560) || 560);
    const orb = stageEl && stageEl.querySelector ? stageEl.querySelector('.energy-orb') : null;
    if (lane && orb) {
      const or2 = orb.getBoundingClientRect();
      const spark = el('div', { cls: 'fx-heelspark', attrs: { 'aria-hidden': 'true' } });
      spark.style.left = `${lane.x - 7}px`;
      spark.style.top = `${lane.y - 7}px`;
      spark.style.setProperty('--heelspark-x', `${Math.round(or2.left + or2.width / 2 - lane.x)}px`);
      spark.style.setProperty('--heelspark-y', `${Math.round(or2.top + or2.height / 2 - lane.y)}px`);
      fxAdd(spark, animMs(620) || 620);
    }
  }, animMs(Math.round(sigMs * 0.55)) || 1);
}

        // Blood Hammer: an ember-BLOOD clot condenses at the hero's chest and closes
        // into the hammer head — the throw flight above is HELD (HERO_THROWS.delayMs)
        // until this clot closes, then the blood-tinted hammer flies on.
export function fxBloodcondense(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const clot = el('div', { cls: 'fx-bloodcondense', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-bloodcondense-mass' }),
      el('span', { cls: 'fx-bloodcondense-edge' }));
    clot.style.left = `${Math.round(r.left + r.width * 0.5 - 22)}px`;
    clot.style.top = `${Math.round(r.top + r.height * 0.2)}px`;
    fxAdd(clot, animMs(520) || 520);
  }, animMs(Math.round(sigMs * 0.06)) || 1);
}

        // ==== LOTE 4 — skills comunes: each common skill draws its own mark. ====
        // Cast Aside: the shrug tosses a spare plate OVER the shoulder — it rises behind
        // the hero's back and drops away (measured hero box) — and the DRAWN card slides
        // from the chest into the hand (the hand measured, like the jab's pulled card).
export function fxPlatefly(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const plate = el('div', { cls: 'fx-platefly', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-platefly-sheet' }));
    plate.style.left = `${Math.round(r.left + r.width * 0.34)}px`;
    plate.style.top = `${Math.round(r.top + r.height * 0.04)}px`;
    fxAdd(plate, animMs(620) || 620);
  }, animMs(Math.round(sigMs * 0.14)) || 1);
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    const hand = stageEl && stageEl.querySelector ? stageEl.querySelector('.hand') : null;
    if (!hero || !hand) return;
    const r = hero.getBoundingClientRect();
    const hr = hand.getBoundingClientRect();
    const card = el('div', { cls: 'fx-platecard', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-platecard-face' }));
    const sx = Math.round(r.left + r.width * 0.5);
    const sy = Math.round(r.top + r.height * 0.3);
    card.style.left = `${sx}px`;
    card.style.top = `${sy}px`;
    card.style.setProperty('--slide-x', `${Math.round(hr.left + hr.width * 0.3 - sx)}px`);
    card.style.setProperty('--slide-y', `${Math.round(hr.top + hr.height * 0.55 - sy)}px`);
    fxAdd(card, animMs(560) || 560);
  }, animMs(Math.round(sigMs * 0.5)) || 1);
}

        // True Temper: the raised hammer tempers — hiss jets rise OFF it at hammer
        // height (measured hero box, above the head where the windup frame holds it)
        // and the white-hot temper line flares across the metal.
export function fxTemperhiss(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const hiss = el('div', { cls: 'fx-temperhiss', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-temperhiss-jet' }),
      el('span', { cls: 'fx-temperhiss-jet fx-temperhiss-jet-2' }),
      el('span', { cls: 'fx-temperhiss-jet fx-temperhiss-jet-3' }),
      el('span', { cls: 'fx-temperhiss-line' }));
    hiss.style.left = `${Math.round(r.left + r.width * 0.62)}px`;
    hiss.style.top = `${Math.round(r.top + r.height * 0.13)}px`;
    fxAdd(hiss, animMs(680) || 680);
  }, animMs(Math.round(sigMs * 0.24)) || 1);
}

        // Fit the Plate: the plate DROPS onto the shoulder and locks at the settle
        // beat — a bronze clank ring opens where it lands and rivet sparks scatter.
export function fxPlateclank(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const clank = el('div', { cls: 'fx-plateclank', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-plateclank-plate' }),
      el('span', { cls: 'fx-plateclank-ring' }),
      el('span', { cls: 'fx-plateclank-rivet' }),
      el('span', { cls: 'fx-plateclank-rivet fx-plateclank-rivet-2' }),
      el('span', { cls: 'fx-plateclank-rivet fx-plateclank-rivet-3' }));
    clank.style.left = `${Math.round(r.left + r.width * 0.52)}px`;
    clank.style.top = `${Math.round(r.top + r.height * 0.25)}px`;
    fxAdd(clank, animMs(640) || 640);
  }, animMs(Math.round(sigMs * 0.46)) || 1);
}

        // Kiln Cry: the shout — a wedge of kiln heat cones from the mouth toward the
        // row (measured hero box, mouth height) while the DISCARDED card catches fire
        // in the air beside the hero and burns to ash.
export function fxCrycone(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const cone = el('div', { cls: 'fx-crycone', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-crycone-heat' }),
      el('span', { cls: 'fx-crycone-heat fx-crycone-heat-2' }),
      el('span', { cls: 'fx-crycone-heat fx-crycone-heat-3' }));
    cone.style.left = `${Math.round(r.left + r.width * 0.58)}px`;
    cone.style.top = `${Math.round(r.top + r.height * 0.1)}px`;
    fxAdd(cone, animMs(560) || 560);
    const card = el('div', { cls: 'fx-crycard', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-crycard-face' }),
      el('span', { cls: 'fx-crycard-ash' }));
    card.style.left = `${Math.round(r.left + r.width * 0.86)}px`;
    card.style.top = `${Math.round(r.top + r.height * 0.02)}px`;
    fxAdd(card, animMs(660) || 660);
  }, animMs(Math.round(sigMs * 0.28)) || 1);
}

        // Vent: pressure leaves the BACK — two flat steam jets blast from behind the
        // hero (the back is the hero's measured LEFT side) and the refunded energy
        // bursts AT the orb in the HUD (the orb measured, like the flarefan's spark).
export function fxVentjets(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const jets = el('div', { cls: 'fx-ventjets', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-ventjets-jet' }),
      el('span', { cls: 'fx-ventjets-jet fx-ventjets-jet-2' }));
    jets.style.left = `${Math.round(r.left + r.width * 0.22)}px`;
    jets.style.top = `${Math.round(r.top + r.height * 0.26)}px`;
    fxAdd(jets, animMs(620) || 620);
  }, animMs(Math.round(sigMs * 0.2)) || 1);
  fire(() => {
    const orb = stageEl && stageEl.querySelector ? stageEl.querySelector('.energy-orb') : null;
    if (!orb) return;
    const or = orb.getBoundingClientRect();
    const burst = el('div', { cls: 'fx-ventorb', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-ventorb-ring' }),
      el('span', { cls: 'fx-ventorb-flare' }));
    burst.style.left = `${Math.round(or.left + or.width / 2 - 30)}px`;
    burst.style.top = `${Math.round(or.top + or.height / 2 - 30)}px`;
    fxAdd(burst, animMs(560) || 560);
  }, animMs(Math.round(sigMs * 0.5)) || 1);
}

        // ==== LOTE 5 — ataques uncommon: each uncommon card draws its own mark. ====
        // Heat Trance: the arms cross and THREE GHOST CARDS fan open by the chest —
        // they glow in sequence, then flow one after another into the hand (the hand
        // measured, like the jab's pulled card). A fan of cards, not a dart and not a
        // plate — the cards themselves are the effect.
export function fxCardfan(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const fan = el('div', { cls: 'fx-cardfan', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-cardfan-ghost' }),
      el('span', { cls: 'fx-cardfan-ghost fx-cardfan-ghost-2' }),
      el('span', { cls: 'fx-cardfan-ghost fx-cardfan-ghost-3' }));
    fan.style.left = `${Math.round(r.left + r.width * 0.5 - 60)}px`;
    fan.style.top = `${Math.round(r.top + r.height * 0.16)}px`;
    const hand = stageEl && stageEl.querySelector ? stageEl.querySelector('.hand') : null;
    if (hand) {
      const hr = hand.getBoundingClientRect();
      fan.style.setProperty('--fan-x', `${Math.round(hr.left + hr.width * 0.3 - (r.left + r.width * 0.5))}px`);
      fan.style.setProperty('--fan-y', `${Math.round(hr.top + hr.height * 0.55 - (r.top + r.height * 0.3))}px`);
    }
    fxAdd(fan, animMs(920) || 920);
  }, animMs(Math.round(sigMs * 0.3)) || 1);
}

        // Hail of Blows: a BURST of four SMALL flashes that land in alternation along
        // the aimed lane — tiny, tight, staggered, and deliberately nothing like the
        // twin salvo's flying hammers or the hammer-hit's one big flash.
export function fxHailticks(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hail = el('div', { cls: `fx-hailticks ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-hailticks-tick' }),
      el('span', { cls: 'fx-hailticks-tick fx-hailticks-tick-2' }),
      el('span', { cls: 'fx-hailticks-tick fx-hailticks-tick-3' }),
      el('span', { cls: 'fx-hailticks-tick fx-hailticks-tick-4' }));
    if (lane) placeAt(hail, lane, -46, -44);
    fxAdd(hail, animMs(620) || 620);
  }, animMs(Math.round(sigMs * 0.4)) || 1);
}

        // Climbing Heat: the ascending stroke — a diagonal slash cuts UP across the
        // lane while ember RUNGS light up bottom-to-top under it, a ladder of heat.
export function fxHeatladder(fire, lane, b, sigMs, gen) {
  fire(() => {
    const ladder = el('div', { cls: `fx-heatladder ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-heatladder-slash' }),
      el('span', { cls: 'fx-heatladder-rung' }),
      el('span', { cls: 'fx-heatladder-rung fx-heatladder-rung-2' }),
      el('span', { cls: 'fx-heatladder-rung fx-heatladder-rung-3' }),
      el('span', { cls: 'fx-heatladder-rung fx-heatladder-rung-4' }));
    if (lane) placeAt(ladder, lane, -34, -92);
    fxAdd(ladder, animMs(780) || 780);
  }, animMs(Math.round(sigMs * 0.45)) || 1);
}

        // Vein Tap: the tap opens a glowing nick on the hero's forearm — ember drops
        // FALL from it and the last one condenses into one bright bead of energy at
        // the wrist. Crimson ember-blood, drops falling: never the chest clot.
export function fxVeindrip(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const drip = el('div', { cls: 'fx-veindrip', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-veindrip-cut' }),
      el('span', { cls: 'fx-veindrip-drop' }),
      el('span', { cls: 'fx-veindrip-drop fx-veindrip-drop-2' }),
      el('span', { cls: 'fx-veindrip-drop fx-veindrip-drop-3' }),
      el('span', { cls: 'fx-veindrip-bead' }));
    drip.style.left = `${Math.round(r.left + r.width * 0.56)}px`;
    drip.style.top = `${Math.round(r.top + r.height * 0.42)}px`;
    fxAdd(drip, animMs(880) || 880);
  }, animMs(Math.round(sigMs * 0.45)) || 1);
}

        // Ash Harvest: a scythe of ash sweeps the WHOLE row (sized to the row's
        // measured span, like the gust cone — the card hits every enemy) and one ash
        // mote per enemy DRAINS from its card back toward the hero.
export function fxAshscythe(fire, lane, b, sigMs, gen) {
  fire(() => {
    const cards = stageEl && stageEl.querySelectorAll
      ? [...stageEl.querySelectorAll('.enemy[data-target-index]')] : [];
    const scythe = el('div', { cls: `fx-ashscythe ${b.side || 'side-none'}`, attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-ashscythe-blade' }),
      el('span', { cls: 'fx-ashscythe-mist' }));
    if (cards.length > 0) {
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
      }
      if (right > left) {
        scythe.style.left = `${Math.round(left - 40)}px`;
        scythe.style.top = `${Math.round((top + bottom) / 2 - 70)}px`;
        scythe.style.setProperty('--ash-w', `${Math.round(right - left + 80)}px`);
      }
    }
    fxAdd(scythe, animMs(980) || 980);
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (hero) {
      const hr = hero.getBoundingClientRect();
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const mote = el('div', { cls: 'fx-ashmote', attrs: { 'aria-hidden': 'true' } });
        mote.style.left = `${Math.round(r.left + r.width * 0.5)}px`;
        mote.style.top = `${Math.round(r.top + r.height * 0.45)}px`;
        mote.style.setProperty('--drain-x', `${Math.round(hr.left + hr.width * 0.55 - (r.left + r.width * 0.5))}px`);
        mote.style.setProperty('--drain-y', `${Math.round(hr.top + hr.height * 0.4 - (r.top + r.height * 0.45))}px`);
        fxAdd(mote, animMs(760) || 760);
      }
    }
  }, animMs(Math.round(sigMs * 0.45)) || 1);
}

        // ==== LOTE 6 — skills uncommon: each uncommon skill makes its own mark. ====
        // Heat Wash: the low arm sweep drags a THERMAL WAVE across the WHOLE row
        // (sized to the row's measured span, like the ash scythe) — a low crest rolls
        // left-to-right and the haze behind it wilts as it passes.
export function fxHeatwashwave(fire, lane, b, sigMs, gen) {
  fire(() => {
    const cards = stageEl && stageEl.querySelectorAll
      ? [...stageEl.querySelectorAll('.enemy[data-target-index]')] : [];
    const wash = el('div', { cls: 'fx-heatwash', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-heatwash-crest' }),
      el('span', { cls: 'fx-heatwash-haze' }),
      el('span', { cls: 'fx-heatwash-wilt' }),
      el('span', { cls: 'fx-heatwash-wilt fx-heatwash-wilt-2' }));
    if (cards.length > 0) {
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
      }
      if (right > left) {
        wash.style.left = `${Math.round(left - 90)}px`;
        wash.style.top = `${Math.round((top + bottom) / 2 - 75)}px`;
        wash.style.setProperty('--wash-w', `${Math.round(right - left + 180)}px`);
      }
    }
    fxAdd(wash, animMs(980) || 980);
  }, animMs(Math.round(sigMs * 0.3)) || 1);
}

        // Brace: the stance LOCKS — two concentric rings of plate fit around the hero
        // with a DOUBLE CLANK (the inner ring closes first, the outer a beat later;
        // each close fires its own bright glint). Hero-measured, like the plate clank.
export function fxLockrings(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const rings = el('div', { cls: 'fx-lockrings', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-lockrings-ring fx-lockrings-ring-inner' }),
      el('span', { cls: 'fx-lockrings-ring fx-lockrings-ring-outer' }),
      el('span', { cls: 'fx-lockrings-glint' }),
      el('span', { cls: 'fx-lockrings-glint fx-lockrings-glint-2' }));
    rings.style.left = `${Math.round(r.left + r.width * 0.5 - 95)}px`;
    rings.style.top = `${Math.round(r.top + r.height * 0.4 - 95)}px`;
    fxAdd(rings, animMs(840) || 840);
  }, animMs(Math.round(sigMs * 0.4)) || 1);
}

        // Flame Ward: a vertical CURTAIN of flame rises in front of the hero — three
        // licks of fire climb together off a low ember base, bright at the core.
export function fxFlamecurtain(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const curtain = el('div', { cls: 'fx-flamecurtain', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-flamecurtain-base' }),
      el('span', { cls: 'fx-flamecurtain-lick' }),
      el('span', { cls: 'fx-flamecurtain-lick fx-flamecurtain-lick-2' }),
      el('span', { cls: 'fx-flamecurtain-lick fx-flamecurtain-lick-3' }));
    curtain.style.left = `${Math.round(r.left + r.width * 0.26)}px`;
    curtain.style.top = `${Math.round(r.top + r.height * 0.02)}px`;
    fxAdd(curtain, animMs(880) || 880);
  }, animMs(Math.round(sigMs * 0.34)) || 1);
}

        // Cinder Shroud: a cocoon of ash swirls UP AROUND the hero — two grey orbits
        // spin opposite ways and three motes ride them, then the whole shroud
        // SETTLES down onto the figure as a shell.
export function fxAshswirl(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const shroud = el('div', { cls: 'fx-ashswirl', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-ashswirl-orbit' }),
      el('span', { cls: 'fx-ashswirl-orbit fx-ashswirl-orbit-2' }),
      el('span', { cls: 'fx-ashswirl-mote' }),
      el('span', { cls: 'fx-ashswirl-mote fx-ashswirl-mote-2' }),
      el('span', { cls: 'fx-ashswirl-mote fx-ashswirl-mote-3' }),
      el('span', { cls: 'fx-ashswirl-shell' }));
    shroud.style.left = `${Math.round(r.left + r.width * 0.5 - 80)}px`;
    shroud.style.top = `${Math.round(r.top + r.height * 0.02)}px`;
    fxAdd(shroud, animMs(920) || 920);
  }, animMs(Math.round(sigMs * 0.26)) || 1);
}

        // ==== LOTE 7 — poderes uncommon: each uncommon power makes its own mark. ====
        // Stoke: a COLUMN of embers drafts UP over the hero's furnace — the breast is
        // the furnace and this is it being fed. A soft glow breathes at the chest and
        // the embers rise through it: round motes in a tight vertical draft, never
        // flame licks (that is the curtain's silhouette) and never one lone pulse.
export function fxStokedraft(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const draft = el('div', { cls: 'fx-stokedraft', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-stokedraft-breathe' }),
      el('span', { cls: 'fx-stokedraft-mote' }),
      el('span', { cls: 'fx-stokedraft-mote fx-stokedraft-mote-2' }),
      el('span', { cls: 'fx-stokedraft-mote fx-stokedraft-mote-3' }),
      el('span', { cls: 'fx-stokedraft-mote fx-stokedraft-mote-4' }),
      el('span', { cls: 'fx-stokedraft-mote fx-stokedraft-mote-5' }));
    draft.style.left = `${Math.round(r.left + r.width * 0.5 - 34)}px`;
    draft.style.top = `${Math.max(6, Math.round(r.top - 64))}px`;
    fxAdd(draft, animMs(860) || 860);
  }, animMs(Math.round(sigMs * 0.3)) || 1);
}

        // Scale Up: WAVES of metallic scales climb the body BOTTOM-TO-TOP — three
        // ribbed plate bands rise one after another (feet, torso, shoulders) and one
        // cold sheen sweeps up the whole figure. Hero-measured, full-body height.
export function fxScaleripple(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const ripple = el('div', { cls: 'fx-scaleripple', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-scaleripple-band' }),
      el('span', { cls: 'fx-scaleripple-band fx-scaleripple-band-2' }),
      el('span', { cls: 'fx-scaleripple-band fx-scaleripple-band-3' }),
      el('span', { cls: 'fx-scaleripple-sheen' }));
    ripple.style.left = `${Math.round(r.left + r.width * 0.5 - 58)}px`;
    ripple.style.top = `${Math.round(r.top - 4)}px`;
    fxAdd(ripple, animMs(960) || 960);
  }, animMs(Math.round(sigMs * 0.22)) || 1);
}

        // Banked Coal: the hand tips — coals fall THROUGH the enemy row and pile
        // GLOWING on the ground under it (row-measured, like the heat wash's span):
        // a dark mound rises, each coal bounces off it, and the ground heat blooms.
export function fxBankedglow(fire, lane, b, sigMs, gen) {
  fire(() => {
    const cards = stageEl && stageEl.querySelectorAll
      ? [...stageEl.querySelectorAll('.enemy[data-target-index]')] : [];
    const coals = el('div', { cls: 'fx-bankedglow', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-bankedglow-mound' }),
      el('span', { cls: 'fx-bankedglow-coal' }),
      el('span', { cls: 'fx-bankedglow-coal fx-bankedglow-coal-2' }),
      el('span', { cls: 'fx-bankedglow-coal fx-bankedglow-coal-3' }),
      el('span', { cls: 'fx-bankedglow-coal fx-bankedglow-coal-4' }),
      el('span', { cls: 'fx-bankedglow-heat' }));
    if (cards.length > 0) {
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
      }
      if (right > left) {
        coals.style.left = `${Math.round(left - 40)}px`;
        coals.style.top = `${Math.round(top - 56)}px`;
        coals.style.setProperty('--glow-w', `${Math.round(right - left + 80)}px`);
        coals.style.setProperty('--glow-h', `${Math.round(bottom - top + 96)}px`);
      }
    }
    fxAdd(coals, animMs(1400) || 1400);
  }, animMs(Math.round(sigMs * 0.36)) || 1);
}

        // Ash Embrace: TENDRILS of ash rise from behind and WRAP the hero — four soft
        // grey curls that grow up the sides and lean INWARD (the embrace), with two
        // motes drifting up alongside. Curled strands, hero-measured: never the
        // circular orbits of the shroud, never the hard plates of the crust.
export function fxAshtendrils(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const arms = el('div', { cls: 'fx-ashtendrils', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-ashtendrils-tendril' }),
      el('span', { cls: 'fx-ashtendrils-tendril fx-ashtendrils-tendril-2' }),
      el('span', { cls: 'fx-ashtendrils-tendril fx-ashtendrils-tendril-3' }),
      el('span', { cls: 'fx-ashtendrils-tendril fx-ashtendrils-tendril-4' }),
      el('span', { cls: 'fx-ashtendrils-mote' }),
      el('span', { cls: 'fx-ashtendrils-mote fx-ashtendrils-mote-2' }));
    arms.style.left = `${Math.round(r.left + r.width * 0.5 - 76)}px`;
    arms.style.top = `${Math.round(r.top - 6)}px`;
    fxAdd(arms, animMs(940) || 940);
  }, animMs(Math.round(sigMs * 0.26)) || 1);
}

        // Cinder Skin: a CRUST of cinder hardens OVER the skin — four soot plates set
        // in sequence from the feet to the shoulders (each carrying a hairline ember
        // crack), and a chest rim flares once when the shell completes. Hero-measured.
export function fxCindercrust(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const crust = el('div', { cls: 'fx-cindercrust', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-cindercrust-plate' }),
      el('span', { cls: 'fx-cindercrust-plate fx-cindercrust-plate-2' }),
      el('span', { cls: 'fx-cindercrust-plate fx-cindercrust-plate-3' }),
      el('span', { cls: 'fx-cindercrust-plate fx-cindercrust-plate-4' }),
      el('span', { cls: 'fx-cindercrust-rim' }));
    crust.style.left = `${Math.round(r.left + r.width * 0.5 - 54)}px`;
    crust.style.top = `${Math.round(r.top - 4)}px`;
    fxAdd(crust, animMs(1380) || 1380);
  }, animMs(Math.round(sigMs * 0.2)) || 1);
}

        // ==== LOTE 8 — cartas raras: each rare card makes its own mark. ====
        // Unbroken: FOUR steel plates stack onto the hero ONE BY ONE — each drops
        // from above onto the pile (its own staggered beat), then a white seal closes
        // the set. Hero-measured (self-target), like the quench veil; a BUILD, never
        // the single plate's clank and never the soot crust's patches.
export function fxPlatestack(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const stack = el('div', { cls: 'fx-platestack', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-platestack-plate' }),
      el('span', { cls: 'fx-platestack-plate fx-platestack-plate-2' }),
      el('span', { cls: 'fx-platestack-plate fx-platestack-plate-3' }),
      el('span', { cls: 'fx-platestack-plate fx-platestack-plate-4' }),
      el('span', { cls: 'fx-platestack-seal' }),
      el('span', { cls: 'fx-platestack-seal fx-platestack-seal-2' }));
    stack.style.left = `${Math.round(r.left + r.width * 0.5 - 44)}px`;
    stack.style.top = `${Math.round(r.top - 34)}px`;
    fxAdd(stack, animMs(1240) || 1240);
  }, animMs(Math.round(sigMs * 0.2)) || 1);
}

        // Overtemper: the forge heart BLOOMS at the chest — a white-gold core flares
        // and FIVE petals open outward around it, lifting away as they fade. A
        // flowering with NO ring: the shockwave's expanding circle is Maul's mark,
        // never this one's. Hero-measured at the chest, like the chest pulse.
export function fxHeartbloom(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const bloom = el('div', { cls: 'fx-heartbloom', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-heartbloom-core' }),
      el('span', { cls: 'fx-heartbloom-petal' }),
      el('span', { cls: 'fx-heartbloom-petal fx-heartbloom-petal-2' }),
      el('span', { cls: 'fx-heartbloom-petal fx-heartbloom-petal-3' }),
      el('span', { cls: 'fx-heartbloom-petal fx-heartbloom-petal-4' }),
      el('span', { cls: 'fx-heartbloom-petal fx-heartbloom-petal-5' }));
    bloom.style.left = `${Math.round(r.left + r.width * 0.5 - 48)}px`;
    bloom.style.top = `${Math.round(r.top + r.height * 0.16)}px`;
    fxAdd(bloom, animMs(980) || 980);
  }, animMs(Math.round(sigMs * 0.3)) || 1);
}

        // Blood Tithe: the payment rises OFF — three crimson motes climb from the
        // hero's chest — while the tithe's return DESCENDS — three ghost cards fall
        // from above toward the hero. An up-and-down crosscurrent, hero-measured at
        // both ends; kneeling motes and falling cards, never the ember draft's
        // single column (stoke owns that) and never the card fan's handward flow.
export function fxTithe(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const anima = el('div', { cls: 'fx-tithe', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-tithe-mote' }),
      el('span', { cls: 'fx-tithe-mote fx-tithe-mote-2' }),
      el('span', { cls: 'fx-tithe-mote fx-tithe-mote-3' }),
      el('span', { cls: 'fx-tithe-card' }),
      el('span', { cls: 'fx-tithe-card fx-tithe-card-2' }),
      el('span', { cls: 'fx-tithe-card fx-tithe-card-3' }));
    anima.style.left = `${Math.round(r.left + r.width * 0.5 - 62)}px`;
    anima.style.top = `${Math.round(r.top - 58)}px`;
    fxAdd(anima, animMs(1150) || 1150);
  }, animMs(Math.round(sigMs * 0.3)) || 1);
}

        // Split Seam: ONE hairline seam of heat splits open on the hero's OWN front —
        // not on the enemy (the rend's fire blades own the target lane): a
        // crimson-gold line at chest height that opens from its middle, seeps a few
        // flecks, and seals itself shut. Hero-measured, like the vein tap's cut.
export function fxSelfseam(fire, lane, b, sigMs, gen) {
  fire(() => {
    const hero = stageEl && stageEl.querySelector ? stageEl.querySelector('.fight .hero') : null;
    if (!hero) return;
    const r = hero.getBoundingClientRect();
    const seam = el('div', { cls: 'fx-selfseam', attrs: { 'aria-hidden': 'true' } },
      el('span', { cls: 'fx-selfseam-line' }),
      el('span', { cls: 'fx-selfseam-fleck' }),
      el('span', { cls: 'fx-selfseam-fleck fx-selfseam-fleck-2' }),
      el('span', { cls: 'fx-selfseam-fleck fx-selfseam-fleck-3' }));
    seam.style.left = `${Math.round(r.left + r.width * 0.5 - 14)}px`;
    seam.style.top = `${Math.round(r.top + r.height * 0.14)}px`;
    fxAdd(seam, animMs(760) || 760);
  }, animMs(Math.round(sigMs * 0.45)) || 1);
}


/* --------------------------------------------------------------------- REGISTRY ----
 * The knob -> effect table, in dispatch order (dispatchFx() iterates it in creation
 * order, which is the order the timers are scheduled in — keep it stable). Adding a
 * signature is now one function here plus one entry below, not another branch in the
 * dispatcher. The knob names are the keys HERO_SIGNATURES (./hero-moves.js) sets.
 */
export const SIG_FX = {
  shake: fxShake,
  shockwave: fxShockwave,
  anvil: fxAnvil,
  twin: fxTwin,
  rend: fxRend,
  launch: fxLaunch,
  dustcrack: fxDustcrack,
  quenchveil: fxQuenchveil,
  gustcone: fxGustcone,
  sparkdart: fxSparkdart,
  flarefan: fxFlarefan,
  arcspan: fxArcspan,
  collarline: fxCollarline,
  impactstar: fxImpactstar,
  slagwave: fxSlagwave,
  jabpull: fxJabpull,
  forgering: fxForgering,
  wildcracks: fxWildcracks,
  chestpulse: fxChestpulse,
  heelburst: fxHeelburst,
  bloodcondense: fxBloodcondense,
  platefly: fxPlatefly,
  temperhiss: fxTemperhiss,
  plateclank: fxPlateclank,
  crycone: fxCrycone,
  ventjets: fxVentjets,
  cardfan: fxCardfan,
  hailticks: fxHailticks,
  heatladder: fxHeatladder,
  veindrip: fxVeindrip,
  ashscythe: fxAshscythe,
  heatwashwave: fxHeatwashwave,
  lockrings: fxLockrings,
  flamecurtain: fxFlamecurtain,
  ashswirl: fxAshswirl,
  stokedraft: fxStokedraft,
  scaleripple: fxScaleripple,
  bankedglow: fxBankedglow,
  ashtendrils: fxAshtendrils,
  cindercrust: fxCindercrust,
  platestack: fxPlatestack,
  heartbloom: fxHeartbloom,
  tithe: fxTithe,
  selfseam: fxSelfseam,
};


/* ============================ UX-9c: THE ENEMY'S OWN PRESENTATIONS ============================
 * The per-card table above answers "what does this CARD look like on the hero's side". This
 * table answers the other half: what does THIS ENEMY look like when it acts. Same shape, same
 * five handles, same rule — one function per presentation, keyed by the enemy's roster id, and
 * a knob that plays nothing is simply absent. dispatchFx() iterates the entry for the acting
 * enemy's id on the matching beat (spec §5).
 *
 * Keys are `src/kernel/rules/encounters.js` ids; knobs are the beat kinds the roster really
 * produces (`attack` = enemy_attack, `guard` = enemy_block, `power`/`hex` = enemy_status).
 * The Cantor's rite and the Foreman's survey are SCRIPTED moves, so those two also read the
 * move id off the beat (`b.move`, from the intent label) and key on it.
 *
 * Every node is decoration: aria-hidden, no text, transform/opacity/filter only, and placed by
 * MEASURING the live enemy card + hero at fire time (the row re-lays out on every paint).
 * `stageShake` reuses the hero side's one stage-shake class instead of adding a second shake.
 */

/**
 * A multi-hit move's own printed label (A5x3, A4x2) is the only hit count on the beat.
 *
 * GOLPES DISCRETOS (supersedes the UX-9 count): the turn now beats out ONE SLAM PER
 * GOLPE — the plan's `attacks` is per strike, and dispatchFx calls this enemy's attack
 * knob once per golpe with the golpe index on the payload (`b.hit`, 1-based). So the
 * flourishes below draw exactly ONE mark per call, nudged sideways by the golpe index
 * so consecutive golpes read as separate impacts rather than the same one restamped.
 * The old N-marks-inside-one-beat shapes (a triple pocket inside the first slam) were
 * the pre-slice presentation of a multi-hit move and are gone with the accumulation
 * they mirrored.
 */

/** The enemy card this beat belongs to, in viewport coordinates. */
function foeLane(b) {
  if (!stageEl || !stageEl.querySelector) return null;
  const card = Number.isInteger(b.enemy)
    ? stageEl.querySelector(`.enemy[data-target-index="${b.enemy + 1}"]`)
    : null;
  if (!card) return null;
  const r = card.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.5), w: r.width, h: r.height };
}

/** The hero, in viewport coordinates — where every strike's impact reads. */
function markLane() {
  if (!stageEl || !stageEl.querySelector) return null;
  const hero = stageEl.querySelector('.fight .hero');
  if (!hero) return null;
  const r = hero.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.55), w: r.width, h: r.height };
}

/** Put one decoration on the layer, at the hero (default) or the acting foe. */
function put(cls, ms, kids = [], at = null, dx = 0, dy = 0) {
  const node = el('div', { cls, attrs: { 'aria-hidden': 'true' } }, ...kids);
  const p = at;
  if (p) placeAt(node, p, dx, dy);
  fxAdd(node, ms);
  return node;
}

/** One 240ms stage shake — the same class the hero's signature uses, never a second one. */
function stageShake(fire, gen, at) {
  fire(() => {
    if (stageEl && stageEl.classList) stageEl.classList.add('stage-shake');
    later(() => {
      if (gen === animGen && stageEl && stageEl.classList) stageEl.classList.remove('stage-shake');
    }, animMs(450) || 450);
  }, at);
}

/* ---- 5.1 Cinder Maw: winds back too far, then snaps; the shell plate lands mid-bite. ---- */
export function fxMawBite(fire, lane, b, sigMs, gen) {
  const impact = animMs(Math.round((sigMs || 640) * 0.46)) || 1;
  const foe = foeLane(b);
  const mark = markLane();
  fire(() => { if (mark) put('fx-maw-bite', animMs(340) || 340, [], mark, -46, -34); }, impact);
  // The plate falls from the JAW's side and lands a beat EARLY — mid-bite, not after it.
  fire(() => { if (foe) put('fx-maw-plate', animMs(260) || 260, [], foe, 14, 6); },
    Math.max(1, impact - (animMs(90) || 90)));
}
export function fxMawInhale(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  fire(() => { if (foe) put('fx-maw-inhale', animMs(560) || 560, [], foe); }, animMs(40) || 1);
}

/* ---- 5.2 Ash Cantor: never touches the hero. Rite column rises; ash cone falls. ---- */
export function fxRiteColumn(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  fire(() => { if (foe) put('fx-rite-col', animMs(560) || 560, [el('span', { cls: 'fx-rite-glyph' })], foe, 0, 10); },
    animMs(60) || 1);
}
export function fxAshCone(fire, lane, b, sigMs, gen) {
  const mark = markLane();
  fire(() => { if (mark) put('fx-ash-cone', animMs(640) || 640, [el('span', { cls: 'fx-ash-cone-body' })], mark, -70, -110); },
    animMs(Math.round((sigMs || 640) * 0.2)) || 1);
}

/* ---- 5.3 Kiln Mite: a 460ms dart with one twitch; grow TIGHTENS (≤1.04), never enlarges. ---- */
export function fxMiteDart(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  const mark = markLane();
  fire(() => {
    if (!foe || !mark) return;
    const node = put('fx-mite-dart', animMs(460) || 460, [], foe);
    // The dart's own distance, written as a custom property: the keyframe translates by it.
    if (node.style && node.style.setProperty) {
      node.style.setProperty('--dart-x', `${Math.round(mark.x - foe.x)}px`);
      node.style.setProperty('--dart-y', `${Math.round(mark.y - foe.y)}px`);
    }
  }, animMs(30) || 1);
}

export function fxMiteTighten(fire, lane, b, sigMs) {
  // GROW = TIGHTEN. The mite never gets bigger (hard cap 1.04 in the keyframe); the inner
  // glow is the tell, so this reads as winding up rather than inflating.
  const foe = foeLane(b);
  fire(() => { if (foe) put('fx-mite-tighten', animMs(560) || 560, [el('span', { cls: 'fx-mite-glow' })], foe); },
    animMs(40) || 1);
}

/* ---- 5.4 Slag Ooze: compress, then lunge; the acid arc drips to the hero's FEET. ---- */
export function fxOozeCompress(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  fire(() => { if (foe) put('fx-ooze-compress', animMs(300) || 300, [], foe); }, animMs(10) || 1);
}
export function fxOozeLunge(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  fire(() => { if (foe) put('fx-ooze-lunge', animMs(340) || 340, [], foe); }, animMs(300) || 1);
}
export function fxAcidArc(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  const mark = markLane();
  fire(() => {
    if (!foe || !mark) return;
    const arc = put('fx-acid-arc', animMs(640) || 640, [el('span', { cls: 'fx-acid-drip' })], foe);
    if (arc.style && arc.style.setProperty) {
      arc.style.setProperty('--arc-x', `${Math.round(mark.x - foe.x)}px`);
      arc.style.setProperty('--arc-y', `${Math.round(mark.y - foe.y + 34)}px`);
    }
  }, animMs(40) || 1);
}

/* ---- 5.5 Cinder Brute: 900ms charge + stage shake; seams glow; enraged holds. ---- */
export function fxBruteCharge(fire, lane, b, sigMs, gen) {
  const foe = foeLane(b);
  fire(() => { if (foe) put('fx-brute-charge', animMs(900) || 900, [], foe); }, animMs(10) || 1);
  stageShake(fire, gen, animMs(760) || 1);
}
export function fxBruteSeams(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  fire(() => { if (foe) put('fx-brute-seams', animMs(720) || 720, [], foe); }, animMs(60) || 1);
}
export function fxVulnRing(fire, lane, b, sigMs) {
  const mark = markLane();
  fire(() => { if (mark) put('fx-vuln-ring', animMs(480) || 480, [], mark); }, animMs(Math.round((sigMs || 640) * 0.46)) || 1);
}

/* ---- 5.6 Slag Warden: defence IS the flourish — three-plate wall, triple pockets. ---- */
export function fxWardenWall(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  fire(() => {
    if (!foe) return;
    put('fx-warden-wall', animMs(620) || 620, [
      el('span', { cls: 'fx-warden-plate' }),
      el('span', { cls: 'fx-warden-plate fx-warden-plate-2' }),
      el('span', { cls: 'fx-warden-plate fx-warden-plate-3' }),
    ], foe, 0, -6);
  }, animMs(40) || 1);
}
export function fxWardenPockets(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  const mark = markLane();
  const impact = animMs(Math.round((sigMs || 640) * 0.46)) || 1;
  // GOLPES DISCRETOS: this call IS one golpe (the dispatcher fires the attack knob once
  // per strike), so the flourish is the piston ride plus ONE pocket at the impact — the
  // golpe index nudges the pocket sideways so golpe 2 reads as a second impact, not the
  // first one restamped. (The old N-pockets-inside-one-beat salvo was the accumulated
  // presentation the per-strike plan replaced.)
  const k = Math.min(4, Math.max(1, (b && b.hit) || 1)) - 1;
  fire(() => { if (foe) put('fx-warden-piston', animMs(520) || 520, [], foe); }, animMs(10) || 1);
  fire(() => { if (mark) put('fx-pocket', animMs(260) || 260, [], mark, -26 + k * 6, -26); }, impact);
}
export function fxSteamWash(fire, lane, b, sigMs) {
  const mark = markLane();
  fire(() => { if (mark) put('fx-steam', animMs(640) || 640, [el('span', { cls: 'fx-steam-body' })], mark, -90, -50); },
    animMs(40) || 1);
}

/* ---- 5.7 Slag Crawler: hex shell draw on harden; two mirrored claw darts. ---- */
export function fxCrawlerHex(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  fire(() => { if (foe) put('fx-crawler-hex', animMs(480) || 480, [el('span', { cls: 'fx-hex-outline' })], foe); },
    animMs(20) || 1);
}
export function fxCrawlerClaws(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  const mark = markLane();
  // GOLPES DISCRETOS: ONE mirrored claw pair per beat — this call IS one golpe; the
  // golpe index nudges the strike's tilt so consecutive golpes read as separate rakes.
  const k = Math.min(4, Math.max(1, (b && b.hit) || 1)) - 1;
  fire(() => {
    if (!foe || !mark) return;
    for (const [side, cls] of [[-1, 'fx-claw-l'], [1, 'fx-claw-r']]) {
      const claw = put(cls, animMs(340) || 340, [], foe);
      if (claw.style && claw.style.setProperty) {
        claw.style.setProperty('--claw-x', `${Math.round(mark.x - foe.x)}px`);
        claw.style.setProperty('--claw-y', `${Math.round(mark.y - foe.y)}px`);
        claw.style.setProperty('--claw-tilt', `${side * (9 + k * 3)}deg`);
      }
    }
  }, animMs(30) || 1);
}

/* ---- 5.8 Ash Wraith: ZERO travel — thins, crosses as a streak, thickens at the hero. ---- */
export function fxWraithThin(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  fire(() => { if (foe) put('fx-wraith-thin', animMs(480) || 480, [], foe); }, animMs(10) || 1);
}
export function fxWailRings(fire, lane, b, sigMs) {
  const mark = markLane();
  fire(() => {
    if (!mark) return;
    put('fx-wail-ring', animMs(480) || 480, [], mark);
    put('fx-wail-ring fx-wail-ring-2', animMs(480) || 480, [], mark, 0, 0);
  }, animMs(40) || 1);
}
export function fxWraithStreak(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  const mark = markLane();
  fire(() => {
    if (!foe || !mark) return;
    const streak = put('fx-wraith-streak', animMs(460) || 460, [], foe);
    if (streak.style && streak.style.setProperty) {
      streak.style.setProperty('--streak-x', `${Math.round(mark.x - foe.x)}px`);
      streak.style.setProperty('--streak-y', `${Math.round(mark.y - foe.y)}px`);
    }
  }, animMs(20) || 1);
}
export function fxWraithDrift(fire, lane, b, sigMs) {
  const foe = foeLane(b);
  fire(() => { if (foe) put('fx-wraith-drift', animMs(560) || 560, [], foe); }, animMs(20) || 1);
}

/* ---- 5.9 Ash Matriarch: the Wraith's phase language, AREA instead of distance. ---- */
export function fxMatriarchVeil(fire, lane, b, sigMs) {
  const mark = markLane();
  if (!mark) return;
  fire(() => {
    put('fx-matriarch-veil', animMs(640) || 640, [el('span', { cls: 'fx-veil-body' })], mark, -110, -70);
  }, animMs(Math.round((sigMs || 640) * 0.16)) || 1);
}

/* ---- 5.10 Cinder Foreman: the survey circle marks the ground, THEN the ceiling drops. ---- */
export function fxSurveyCircle(fire, lane, b, sigMs) {
  const mark = markLane();
  fire(() => { if (mark) put('fx-survey-circle', animMs(480) || 480, [], mark, -24, 8); }, animMs(10) || 1);
}
export function fxCeilingSlab(fire, lane, b, sigMs, gen) {
  const mark = markLane();
  // After the survey's draw + one beat: the hold is the beat itself, not a second clock.
  const at = animMs(480) + (animMs(320) || 320);
  fire(() => {
    if (!mark) return;
    put('fx-ceiling-slab', animMs(360) || 360, [], mark, -56, -230);
    put('fx-ceiling-dust', animMs(260) || 260, [], mark, -44, 6);
  }, at);
  stageShake(fire, gen, at + (animMs(220) || 220));
}

/**
 * UX-9c: the per-enemy presentation table (spec §5). Keyed by roster id; each entry's knobs
 * are the beat kinds that enemy really produces. A knob that plays nothing is absent — the
 * generic §4 beat from UX-9b is the fallback for every type and every missing knob.
 */
export const ENEMY_SIG_FX = {
  // 5.1: overshoot windup then snap; the plate lands mid-bite. Bellow inhales instead of biting.
  jaw_worm: { attack: fxMawBite, power: fxMawInhale },
  // 5.2 scripted: the rite column (incantation PWR3), then the ash cone that falls across the
  // stage INSTEAD of a lunge (dark_strike A6). She never touches the hero.
  cultist: { power: fxRiteColumn, attack: fxAshCone },
  // 5.3: 460ms dart with the 85% twitch; grow tightens, never enlarges.
  red_louse: { attack: fxMiteDart, power: fxMiteTighten },
  // 5.4: compress then lunge (tackle A10); the acid arc drips to the hero's feet (lick WK1).
  acid_slime: {
    attack: (fire, lane, b, sigMs) => { fxOozeCompress(fire, lane, b, sigMs); fxOozeLunge(fire, lane, b, sigMs); },
    hex: fxAcidArc,
  },
  // 5.5: 900ms charge + stage shake (rush A14); skull_bash's vulnerable half is its `hex` beat
  // (short charge + ring); enrage glows the seams and holds `is-enraged` at paint time.
  gremlin_nob: {
    attack: fxBruteCharge,
    hex: fxVulnRing,
    power: fxBruteSeams,
  },
  // 5.6: defense is the flourish. Three-plate wall on B20; the piston (with its pocket)
  // is the per-golpe attack mark — the dispatcher fires it once per strike now, and the
  // pocket inside it is nudged by the golpe index (fxWardenPockets); vent_steam is a
  // steam wash, no travel.
  the_guardian: {
    guard: fxWardenWall,
    attack: fxWardenPockets,
    hex: fxSteamWash,
  },
  // 5.7: hex shell draw on harden; the claw pair is the per-golpe attack mark — the
  // dispatcher fires it once per strike, the pair's tilt nudged by the golpe index
  // (fxCrawlerClaws); ram stays the single-slam fallback shape it always was.
  slag_crawler: {
    guard: fxCrawlerHex,
    attack: fxCrawlerClaws,
  },
  // 5.8: zero travel. Wail thins in place and rings at the hero; drain crosses as a streak;
  // drift bobs and never moves horizontally (its block half is the shared guard shimmer).
  ash_wraith: {
    hex: (fire, lane, b, sigMs) => { fxWraithThin(fire, lane, b, sigMs); fxWailRings(fire, lane, b, sigMs); },
    attack: fxWraithStreak,
    power: fxWraithDrift,
  },
  // 5.9: the Wraith's phases with AREA instead of distance — the veil sweeps the hero row
  // while she holds full opacity; hex/power/guard reuse the wraith phases.
  ash_wraith_elite: {
    attack: fxMatriarchVeil,
    hex: (fire, lane, b, sigMs) => { fxWraithThin(fire, lane, b, sigMs); fxWailRings(fire, lane, b, sigMs); },
    power: fxWraithDrift,
    guard: fxWraithDrift,
  },
  // 5.10 scripted: survey marks the ground, THEN the ceiling slab drops on the same beat.
  cinder_foreman: { attack: (fire, lane, b, sigMs, gen) => { fxSurveyCircle(fire, lane, b, sigMs); fxCeilingSlab(fire, lane, b, sigMs, gen); } },
};
