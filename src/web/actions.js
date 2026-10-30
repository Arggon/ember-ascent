// src/web/actions.js — the ONE dispatch path, and the run lifecycle around it.
//
// Every interaction funnels through `act()`: dispatch one kernel action id, diff the two
// snapshots the kernel just handed us (for the toasts AND for the visual-effect bursts),
// then repaint and play the effects. `newGame()` (plus the hero/path switches that rebuild
// the same screen) lives here too, because it is the other half of the lifecycle: it is
// where every piece of run-scoped presentation state is reset.
//
// The kernel entry is src/kernel/index.js; the controller comes from
// src/surface/gui/controller.js. Shared presentation state lives in ./runtime.js and is
// written through its setters (ES-module imports are read-only views).

import {
  BIOMES,
  DEFAULT_BIOME,
  contentForProfile,
} from '../kernel/index.js';
import { createController } from '../surface/gui/controller.js';
import {
  STRIKE_SEQ,
  clearFxTimers,
  clearHitstop,
  flash,
  fxEl,
  later,
  noArrival,
  notifyEndTargeting,
  repaint,
  runEvents,
  seedFromUrl,
  setBursts,
  setDealClock,
  setDealPending,
  setDyingThisPaint,
  setEndFocusPending,
  setEnteredIds,
  setArriving,
  setEnteringIds,
  setFlash,
  setHeroMoveHold,
  setInputLock,
  setLastPlayerStatuses,
  setLastTravel,
  setPaintedPhase,
  setPhaseArriving,
  setPileOpen,
  setPrevEnemies,
  setPrevMap,
  setQuietIntro,
  setRunEvents,
  setSnap,
  setStrikeSeq,
  snap,
  animSpeed,
  animMs,
  reducedMotion,
  strikeSeq,
  bumpAnimGen,
  ctl,
  setCtl,
} from './runtime.js';
import { announce, toast } from './dom.js';
import { enemyLook } from './glyphs.js';
import { currentProfile, recordRun, resetRunOutcome } from './run-history.js';
import { dispatchFx, playInputSpan } from './fx.js';

/** B4: the chosen hero ('ironclad' Ashwright or 'bellows' Bellows Keeper); `?hero=` seeds it. */
export const HEROES = [
  { id: 'ironclad', name: 'Ashwright', blurb: '60 HP. Hammer and anvil. Kindled Heart: heal 6 after each fight.' },
  { id: 'bellows', name: 'Bellows Keeper', blurb: '54 HP. Bellows Gust hits every enemy; Fan the Flames stokes Energy. Cyan Lantern: +1 Energy on the first turn of each fight.' },
];
/** B5: the chosen biome (an id from the kernel BIOMES table); `?biome=` seeds it. */
const biomeParam = new URLSearchParams(location.search).get('biome');
export let biomeChoice = biomeParam && Object.hasOwn(BIOMES, biomeParam) ? biomeParam : DEFAULT_BIOME;
export let heroChoice = HEROES.some((h) => h.id === new URLSearchParams(location.search).get('hero')) ? new URLSearchParams(location.search).get('hero') : 'ironclad';

/* --------------------------------------------------------- the one dispatch path */

/**
 * Every interaction funnels here: dispatch one kernel action id, then repaint.
 * @param {string} actionId the engine's action id
 * @param {number|null} [targetK] the living-enemy slot the player aimed at, when the
 *   action was a targeted play — used ONLY to name the enemy in the feedback sentence.
 */
export function act(actionId, targetK = null) {
  if (!actionId) return;
  setPileOpen(null);
  const before = snap;
  // The map the player is standing on BEFORE this action, kept for the travel beat: the
  // node the step started from is gone from the rebuilt map, and this is the only handle on
  // it. Recorded from the snapshot, never computed from a coordinate.
  setPrevMap(before.map.current, before.map.floor);
  // Resolved from the BEFORE snapshot: the enemy the player aimed at is the one at that
  // living position before the play, which may not exist at all after it (it can die).
  const aimedAt = targetK != null ? before.enemies[targetK - 1] ?? null : null;
  const res = ctl.dispatch(actionId);
  const after = ctl.snapshot();
  // The kernel's event stream for this step, kept for the run record. `submit()` inside the
  // controller accumulates the same events on the session; the renderer accumulates them
  // here because it builds the record at the end, and a record built from a dropped stream
  // scores zero kills while looking perfectly well-formed (DR-6).
  if (Array.isArray(res.events)) setRunEvents([...runEvents, ...res.events]);

  const fx = [];
  if (res.error) {
    toast(`✗ ${res.error.error} — "${res.error.id}" is not legal right now`);
    announce(`That action was rejected: ${res.error.error}.`);
  } else {
    // Presentation-only feedback: compare the two kernel snapshots we already have.
    const playerLost = before.player.hp - after.player.hp;
    const enemyLost = sumEnemyHp(before) - sumEnemyHp(after);
    const gainedBlock = after.player.block - before.player.block;
    if (playerLost > 0) toast(`You take ${playerLost} damage`, 'warn');
    else if (enemyLost > 0) toast(aimedAt ? `Dealt ${enemyLost} damage to ${aimedAt.name}` : `Dealt ${enemyLost} damage`, 'info');
    else if (gainedBlock > 0) toast(`+${gainedBlock} block`, 'info');

    /* ------------------------------------------------------------ JUICE ----------
     * The SAME diff that produced the toast above is read again for the visual effects.
     * No extra rules: a floater exists exactly where damage was dealt.
     */

    // UX-2: the enemy turn, SEQUENCED AND NAMED. The turn flip is the one moment the
    // kernel resolves several attacks in one step, so the snapshot diff can only say
    // "the hero lost N in total" — the per-attacker facts live in the kernel's OWN
    // event stream for this step (`enemy_attack` carries the attacker's index, what it
    // dealt and what the hero's block ate, per hit, in resolution order). They are read
    // here the same way the run record reads them: kernel words about what happened,
    // regrouped for presentation, never re-derived. The result is ONE burst the
    // dispatcher plays as a sequence — enemy 1 winds up and strikes (its named float
    // lands on the hero), THEN enemy 2 — instead of every foe slamming at once.
    let turnStrikes = null;
    if (before.phase === 'combat' && after.turn !== before.turn) {
      const attacks = [];
      for (const ev of (Array.isArray(res.events) ? res.events : [])) {
        if (!ev || ev.t !== 'enemy_attack') continue;
        let a = attacks.find((x) => x.enemy === ev.enemy);
        if (!a) {
          const foe = before.enemies.find((e) => e.index === ev.enemy);
          a = { enemy: ev.enemy, name: foe ? foe.name : 'The enemy', dealt: 0, blocked: 0, hits: 0 };
          attacks.push(a);
        }
        a.dealt += ev.dealt ?? 0;
        a.blocked += ev.blocked ?? 0;
        a.hits += 1;
      }
      if (attacks.length > 0) turnStrikes = attacks;
    }
    if (turnStrikes) fx.push({ kind: 'enemy-turn', attacks: turnStrikes, playerLost });
    // The player hurt flinch: the HP delta drives the pose (and the HP-bar flash). The
    // NUMBER is carried per attacker by the sequenced floats instead — on a sequenced
    // turn the aggregate floater is marked silent so the hero flinches once without
    // printing a second, unnamed total over the named ones. A non-sequenced loss (an
    // HP-cost card) keeps its own float, as before.
    if (playerLost > 0) {
      fx.push({ kind: 'hero-float', amount: playerLost, tone: 'dmg', tier: playerLost >= 16 ? 3 : playerLost >= 8 ? 2 : 1, silent: turnStrikes !== null });
      if (!turnStrikes) fx.push({ kind: 'vignette' });
    }
    if (gainedBlock > 0) fx.push({ kind: 'hero-float', amount: gainedBlock, tone: 'block', tier: 1 });

    // Per-enemy: the damage that landed (HP delta), the glyph tier for that amount, and
    // whether block ate all of it. The bar still shows the remaining total.
    const beforeByIdx = new Map(before.enemies.map((e) => [e.index, e]));
    let absorbed = false;
    for (const e of after.enemies) {
      const was = beforeByIdx.get(e.index);
      if (!was || e.hp >= was.hp) continue;
      const dealt = was.hp - e.hp;
      const tier = dealt >= 16 ? 3 : dealt >= 8 ? 2 : 1;
      fx.push({ kind: 'float', enemy: e.index, amount: dealt, tone: 'dmg', tier, defeated: e.hp <= 0 });
      if (was.block > 0) fx.push({ kind: 'block-eat', enemy: e.index });
    }
    for (const e of after.enemies) {
      const was = beforeByIdx.get(e.index);
      if (was && e.block > was.block && e.hp === was.hp) {
        fx.push({ kind: 'float', enemy: e.index, amount: e.block - was.block, tone: 'block', tier: 1 });
      }
    }
    // A hit that was FULLY absorbed leaves the enemy's HP untouched, so the loop above
    // never fires. Detected by the enemy's block falling while its HP held — and it says
    // so in words, because "0" or "−0" would contradict a bar that did not move.
    for (const e of after.enemies) {
      const was = beforeByIdx.get(e.index);
      if (was && was.block > e.block && e.hp === was.hp) {
        fx.push({ kind: 'absorbed', enemy: e.index });
        absorbed = true;
      }
    }

    // Card played: it travels toward the enemy row as a copy on the effect layer. The
    // copy is built from the hand tile the player actually clicked, so the thing that
    // flies is the thing they pressed; the tile itself is gone from the rebuilt tree.
    // The fly (and with it the pose hold and the signature timers) must also arm on a
    // KILL — `after` is reward/ended then, and a kill is exactly the stroke the player
    // most needs to see. The hold stage mirrors the fight's own layout, so the fly's
    // lane classes still read against it.
    if (before.phase === 'combat') {
      const playedSlot = actionId.split('_')[0];
      const played = before.hand.find((c) => c.slot === playedSlot && c.cardId);
      if (played) {
        const aimIdx = targetK != null && aimedAt ? (after.enemies.find((e) => e.index === aimedAt.index) ?? aimedAt) : null;
        fx.push({
          kind: 'card-fly',
          name: played.name,
          type: played.type,
          // Which card it is, so the hero's movement can be chosen per card, not just per
          // type (`heroPose()` reads this one paint later). Presentation only: the kernel
          // snapshot already carries the id, this just keeps it alive for the effect.
          id: played.cardId,
          // The aimed enemy's STABLE index (or null), so per-card signatures can direct
          // their effects at the actual target (e.g. Rising Blow launches THAT enemy).
          // A kill empties the aimed enemy from the AFTER snapshot, so the aim itself is
          // the fallback — the effects still need to know which body they are flying
          // toward (a kill's ghost carries `data-death-index` = this).
          enemy: aimIdx ? aimIdx.index : null,
          // A whole lane class, not an index: `positionClass` already returns `side-0` etc.
          side: aimIdx ? positionClass(aimIdx.index, after.enemies) : 'side-none',
        });
      }
      // The hand the player is looking at changed: the replacement cards fan in.
      if (handKey(before.hand) !== handKey(after.hand)) fx.push({ kind: 'deal' });
    }
    // UX-4: the OPENING hand is a draw too. Entering a fight (map/reward/rest/event ->
    // combat) lands the first hand fully formed — the deal burst above only fired on
    // IN-combat hand changes, so the most-seen draw in the game was the one with no
    // animation at all. The fight's first paint now deals its hand the same way every
    // later draw plays. Presentation only: a burst the renderer consumes; no rule reads it.
    if (after.phase === 'combat' && before.phase !== 'combat') fx.push({ kind: 'deal' });

    // A TRAVEL along the map. The map is rebuilt on every paint too, so the departing node
    // is gone by the time the new one is drawn. The node the player stood on is therefore
    // named here, from the before/after map snapshots, and the new tree draws it once more
    // as an inert marker that travels to its replacement. `map.current` is the kernel's own
    // answer to "where am I standing" — nothing is inferred from coordinates.
    if (before.phase === 'map' && after.phase === 'map' && before.map.current !== after.map.current) {
      const from = before.map.rows.flat().find((n) => n.id === before.map.current) ?? null;
      const to = after.map.rows.flat().find((n) => n.id === after.map.current) ?? null;
      fx.push({
        kind: 'travel',
        floor: after.map.floor,
        label: to ? to.label : '',
        // The row the step started on, so the new tree can put the marker back on the
        // departing node's own row (`r-<floor>`), beside the node the player now stands on.
        fromRow: from ? from.row : null,
        boss: Boolean(to && to.type === 'boss'),
      });
    }

    // Switching turns is the one moment there is genuinely nothing new to paint yet, so
    // the screen gets a beat before the enemy's action lands.
    if (after.phase === 'combat' && after.turn !== before.turn) fx.push({ kind: 'wipe' });
  }

  // Which enemies lost HP, by index, so only they shake.
  const hits = [];
  const beforeHp = new Map(before.enemies.map((e) => [e.index, e.hp]));
  for (const e of after.enemies) {
    const was = beforeHp.get(e.index);
    if (typeof was === 'number' && e.hp < was) hits.push(e.index);
  }

  const dying = before.enemies
    .filter((e) => !after.enemies.some((a) => a.index === e.index))
    .map((e) => ({
      ...e,
      side: positionClass(e.index, after.enemies, before.enemies, e.index),
      // Whether a BOSS just left the field. Read from the name (`enemyLook` already maps
      // "Guardian" -> boss for the card frame), never from a stat: it decides how large the
      // collapse reads, and nothing else. The victory beat is gated on this below, which is
      // how "the boss dies, THEN the panel arrives" is sequenced without asking the kernel
      // for a new field.
      boss: enemyLook(e.id).boss,
    }));
  // Each departure becomes a `death` burst, which the next paint draws as an inert ghost
  // card that collapses. The ghost is positioned by ENEMY ROW ORDER (`side-*`), never by a
  // measured coordinate.
  for (const d of dying) fx.push({ kind: 'death', enemy: d.index, name: d.name, side: d.side, boss: d.boss });

  /* ------------------------------------------------------------- PHASE ARRIVALS ------
   * The end-of-run beat. `ended` is reached the instant the last enemy (or the player) is
   * removed from the snapshot, so the panel would otherwise appear in the same frame as the
   * killing blow and read as an instant pop. Which arrival the next paint plays is decided
   * here, ONCE, from the before/after snapshots; `render()` consumes it and clears it, so an
   * incidental repaint can never re-trigger it.
   *
   * The delay itself lives in `render()`, because the panel must also be able to stay hidden
   * until the collapse has finished.
   */
  if (after.phase === 'ended' && before.phase !== 'ended') {
    setPhaseArriving(after.outcome === 'win' ? 'victory' : 'defeat');
    // The run just ended: build, score and store its record ONCE, so the end screen shows
    // the ledger, marks and unlocks (it was defined but never called, so S1 always fell
    // back to the no-record branch).
    recordRun();
  }

  // The generation advances ONLY if a flash state actually changed, so an unrelated
  // repaint re-emits the identical class string and the animation is not restarted.
  const nextFlash = {
    hp: after.player.hp < before.player.hp,
    energy: after.player.energy !== before.player.energy,
    block: after.player.block > before.player.block,
    hits,
    blockEat: fx.some((f) => f.kind === 'block-eat' || f.kind === 'absorbed'),
    n: flash.n,
  };
  if (nextFlash.hp !== flash.hp || nextFlash.energy !== flash.energy
    || nextFlash.block !== flash.block || nextFlash.blockEat !== flash.blockEat
    || nextFlash.hits.join() !== flash.hits.join()) {
    nextFlash.n = flash.n + 1;
  }
  setFlash(nextFlash);
  setBursts(fx);
  setSnap(after);
  // The victory/defeat panel must WAIT for the collapse that precedes it, so a run that ends
  // on this action is marked here and `render()` holds the stage empty for one beat. A run
  // that was ALREADY over (a restart) never reaches this line, which is why a fresh run
  // paints its map immediately instead of waiting for a death that already happened.
  if (after.phase !== before.phase) {
    if (after.phase === 'ended') {
      // The panel must WAIT for the collapse that precedes it, so the run is marked here and
      // `render()` holds the stage empty for one beat. A run that was ALREADY over (a
      // restart) never reaches this line, which is why a fresh run paints its map at once.
      setPhaseArriving(after.outcome === 'win' ? 'victory' : 'defeat');
      setEndFocusPending(true);
    } else if (after.phase === 'reward') {
      setPhaseArriving('reward');
    } else if (after.phase === 'rest') {
      setPhaseArriving('rest');
    }
  }
  // UX-2: arm the strike sequence BEFORE the paint, so the slam poses it schedules are
  // painted with their per-attacker delays from the first frame. The plan carries the
  // ALREADY-PACED durations (animMs applies the dock and the UX-4 base factor once,
  // here), so the dock scales every beat and reduced motion / » never arm one at all —
  // those shapes collapse to the simultaneous fast form the turn had before this slice.
  // A flip that ENDS the run (the hero died on the enemy turn) arms nothing: the defeat
  // panel is the moment, and unplaced floats would land unpositioned over it (UX-2
  // review P3).
  const seqBurst = after.phase === 'ended' ? null : fx.find((b) => b.kind === 'enemy-turn');
  if (seqBurst && !reducedMotion && animSpeed !== 0) {
    const beatMs = animMs(STRIKE_SEQ.beat);
    const slamMs = animMs(STRIKE_SEQ.slam);
    const plan = {
      attacks: seqBurst.attacks,
      beatMs,
      slamMs,
      impactMs: Math.round(slamMs * STRIKE_SEQ.impactAt),
      start: Date.now(),
      totalMs: beatMs * (seqBurst.attacks.length - 1) + slamMs,
    };
    setStrikeSeq(plan);
    // The plan's retirement is deliberately NOT generation-guarded: a newer action
    // retires the pending float/vignette timers (its own dispatchFx bumps the
    // generation), but it must not leave the plan armed — a leaked plan would re-slam
    // its attackers on every hover repaint forever. The identity check keeps a stale
    // cleanup from clearing a NEWER sequence armed by an action in between.
    // UX-5: the retirement now REPAINTS — the plan's busy reason sits painted on the
    // hand and End Turn, and a player who never moves the mouse would keep seeing the
    // locked shape after the sequence is over.
    later(() => {
      if (strikeSeq !== plan) return;
      setStrikeSeq(null);
      repaint();
    }, plan.totalMs + 400);
  } else if (!seqBurst) {
    // UX-2 review P2: the turn-flip that is NOT an enemy attack (the player's own
    // actions, the reward/rest flips) must retire any plan still armed — the
    // End-Turn timer above only covers the sequence's own lifetime, and an unguarded
    // plan re-slams stale attackers over the player's next action for ~1.5s.
    setStrikeSeq(null);
  }
  // UX-5: arm the play's input lock BEFORE the paint, the same place and order the
  // strike plan above is armed — so the hand the player sees after the play is already
  // painted locked and no card can start mid-swing. The span is `playInputSpan`, the
  // longest beat of the choreography dispatchFx is about to schedule, from the same
  // lifetimes the beats use; the SAME condition gates it that dispatchFx plays under
  // (reduced motion and » never animate, so they never lock), and setInputLock keeps
  // the longer of the two spans when a play chains onto a still-running one.
  const flyBurst = fx.find((b) => b.kind === 'card-fly');
  if (flyBurst && !reducedMotion && animSpeed !== 0) {
    setInputLock({ until: Date.now() + playInputSpan(flyBurst), why: 'play' });
  }
  repaint();
  dispatchFx();
}

/**
 * The hand's identity as a string, so "did the hand change?" is a comparison rather than
 * a guess. Only the cards and their order count — hovering an enemy calls render() again
 * with the same hand, and that must never re-deal it.
 */
export const handKey = (hand) => (hand || []).map((c) => c.slot + ':' + c.cardId).join('|');

/**
 * Which column of the enemy row an index sits in, as my own class vocabulary: `side-0`
 * for the leftmost LIVING enemy, `side-1` for the rightmost, `side-mid` for anything in
 * between, `side-none` for an enemy whose row is now empty. A boolean cannot shift a
 * floater to the wrong enemy the way an index can, and no pixel is measured.
 */
export function positionClass(index, after, before = null, explicit = null) {
  const idx = explicit != null ? explicit : index;
  const row = after.length > 0 ? after : (before || []);
  if (row.length === 0) return 'side-none';
  const at = row.findIndex((e) => e.index === idx);
  const pos = at === -1 ? 0 : at;
  if (row.length === 1) return 'side-0';
  if (pos === 0) return 'side-0';
  if (pos === row.length - 1) return 'side-1';
  return 'side-mid';
}

export const sumEnemyHp = (s) => s.enemies.reduce((n, e) => n + e.hp, 0);

/**
 * @param {number|null} [seed]
 * @param {{quiet?: boolean}} [opts] quiet: a hero switch on the Kindling screen, which must
 *   not replay the act title card
 */
export function newGame(seed = null, opts = {}) {
  // A NEW run, built for the profile the player's own history has earned (DR-4). The
  // narrowing happens in the kernel: `contentForProfile` decides which cards EXIST, and no
  // rule ever reads the profile. S10: the profile's lifetime WINS ride along — the relic
  // pool is derived kernel-side from them (RELIC_UNLOCK_TABLE), the same one-way trip the
  // card pool takes. `?pool=full` bypasses both narrowings for a tester.
  const profile = currentProfile();
  setCtl(createController({ run: { seed: seed ?? seedFromUrl(), content: contentForProfile(profile), character: heroChoice, biome: biomeChoice, kindling: true, tempers: true, quests: true, wins: profile.wins } }));
  setSnap(ctl.snapshot());
  // The event stream is per-RUN, so it dies with the run. It is the only source of the kill
  // / elite / boss counts the score needs, which is why it is accumulated rather than
  // re-derived later from a snapshot that never carried them.
  setRunEvents([]);
  resetRunOutcome();
  clearFxTimers();
  if (fxEl && fxEl.replaceChildren) fxEl.replaceChildren();
  setFlash({ hp: false, energy: false, block: false, hits: [], n: 0, blockEat: false });
  setBursts([]);
  setPileOpen(null);
  bumpAnimGen();
  clearHitstop();
  setDealPending(false);
  setDealClock(null);
  // UX-5: the input lock is run-scoped motion state like the rest — a restart must not
  // inherit a wait a dead run's animation armed.
  setInputLock(null);
  setDyingThisPaint([]);
  setLastPlayerStatuses([]);
  setPaintedPhase(null);
  setQuietIntro(opts.quiet === true);
  // A new run must animate its own entrance and its own victory/defeat, so every one-shot
  // presentation flag is cleared with the timers that would have released it.
  setPrevEnemies([]);
  setEnteredIds(new Set());
  setHeroMoveHold(null);
  setStrikeSeq(null);
  setPhaseArriving(null);
  setArriving(noArrival());
  setEndFocusPending(false);
  setPrevMap(null, null);
  setLastTravel(null);
  setEnteringIds(new Set());
  notifyEndTargeting();
  repaint();
}

/**
 * B4: rebuild the run, same seed, for another hero. It is the SAME screen with a different
 * hero, not a new act: the Act I title card is not replayed. Focus follows the selection,
 * so the arrow keys keep working after the repaint.
 * @param {string} id hero id from HEROES
 */
export function switchHero(id) {
  if (id === (snap.character ?? 'ironclad')) return;
  heroChoice = id;
  newGame(snap.seed, { quiet: true });
  const picked = document.querySelector('.hero-pick.on');
  if (picked && typeof picked.focus === 'function') picked.focus();
}

/**
 * B5: rebuild the run, same seed, on another path. Like a hero switch it is the SAME
 * screen, not a new act: the Act I title card is not replayed, and focus follows the
 * selection so the arrow keys keep working after the repaint.
 * @param {string} id biome id from the kernel BIOMES table
 */
export function switchPath(id) {
  if (id === (snap.biome ?? DEFAULT_BIOME)) return;
  biomeChoice = id;
  newGame(snap.seed, { quiet: true });
  const picked = document.querySelector('.biome-pick.on');
  if (picked && typeof picked.focus === 'function') picked.focus();
}
