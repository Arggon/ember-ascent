// src/web/actions.js — the ONE dispatch path, and the run lifecycle around it.
//
// Every interaction funnels through `act()`: dispatch one kernel action id, diff the two
// snapshots the kernel just handed us (for the toasts AND for the visual-effect bursts),
// then repaint and play the effects. `newGame()` lives here too, because it is the other
// half of the lifecycle: it is where every piece of run-scoped presentation state is reset.
//
// The kernel entry is src/kernel/index.js; the controller comes from
// src/surface/gui/controller.js. Shared presentation state lives in ./runtime.js and is
// written through its setters (ES-module imports are read-only views).

import {
  BIOMES,
  DEFAULT_BIOME,
  HERO_ALIASES,
  contentForProfile,
} from '../kernel/index.js';
import { createController } from '../surface/gui/controller.js';
import {
  STRIKE_SEQ,
  TURN_STEP,
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
  setHeldDeaths,
  setImpactHold,
  setHpTrail,
  hpTrail,
  retireHpTrail,
  setInputLock,
  setLastPlayerStatuses,
  setLastEnemyStatuses,
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
import { cancelEmberParticles } from './fx-particles.js';
import { currentLang, setLang, t } from './i18n.js';

/**
 * UX-9b: which statuses land on the HERO rather than on the enemy the event names (spec
 * §4.1's hex/power mapping). The kernel's `enemy_status` event today only ever carries an
 * enemy's own Strength, so this set is empty in practice; it is the rule the pipeline
 * states, kept here so a future self-debuff stacks on the right body without the grouping
 * changing again. A debuff move afflicts the player through the kernel's `debuff` runner,
 * whose `player_status` events carry NO attacker index — those are read as their own
 * beats below (that is what keeps a sorrow_wail/mourning_hex turn from being silent). The "golpes
 * discretos" slice grew the hex half by the two tick-shaped debuffs: the Matriarch's
 * ember_soulfire leaves Bleed on the hero (`player_status {status:'bleed', enemy}`), and a
 * poison hex would land the same shape.
 */
const PLAYER_AFFLICTING = new Set(['weak', 'vulnerable', 'bleed', 'poison']);

/**
 * A multi-hit move's own printed label (`A4x2`, `A7x2 BLEED2`) is the announced golpe
 * total the wire carries. Read per strike beat so each beat knows its own `hit` of
 * `hits`; clamped 1..4 (no shipped label exceeds x3) so a malformed label cannot spawn
 * an unbounded anything, and a label without `xN` is one golpe.
 * @param {string|null} move the intent label from the before snapshot
 * @returns {number}
 */
function announcedHits(move) {
  const m = /x(\d)/.exec(String(move ?? ''));
  if (!m) return 1;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : 1;
}

/**
 * BARRA DE VIDA POR GOLPE — arm the per-unit HP trail from the kernel's OWN event
 * stream, so the bars FOLLOW the hits instead of jumping to the resolved snapshot at
 * action start. Read-only over facts the kernel already published: `damage.hp` (the
 * struck enemy's HP after each of the hero's golpes), `enemy_attack.hp` (the hero's HP
 * after each golpe of the enemy turn), the tick events' `hp` (with `who`/`index` naming
 * the body), `heal.amount` (HP actually restored) and `self_damage.amount` (an HP cost —
 * the loseHp floor at 1 is the kernel's own convention). Nothing here re-derives a rule;
 * a fact the stream does not carry is handled by the retire's snap, not by a guess.
 *
 * The steps' FIRE SITES are the entries the dispatcher already iterates — the per-golpe
 * strike entries (`strikes` on the card-fly burst), the plan's per-strike `attacks` and
 * their hung `ticks`, the plan's `tail` steps — each carrying `hp` since this slice; fx.js
 * applies them on the very fire that lands the golpe's float (ONE clock). Only the facts
 * with NO per-golpe fire of their own — HP costs, heals, and the hook damage Banked Coal's
 * sweep deals — come back as `reveal` steps, applied on the feel-queue fire where the
 * play's numbers land (the same fire the diff floats reveal on).
 *
 * Units are armed only when the stream touched their HP: an untouched bar paints the
 * snapshot exactly as before. Starts are the kernel's own pre-action values (in ordinary
 * play the same numbers the painted snapshot shows); the running model is anchored there
 * because the two AMOUNT facts (heal, self_damage) have no absolute HP of their own, and
 * every absolute-hp fact re-seeds the model, so it cannot drift.
 *
 * @param {Array<any>} events the kernel's event stream for this step
 * @param {any} preState the kernel's own pre-action state (the seeded truth and the
 *   amount facts' anchor; the snapshots carry no number this builder needs)
 * @returns {{start: number, units: Map<string, any>, reveal: Array<{unit: string, hp: number}>}|null}
 *   null when no HP fact was carried (no trail to arm)
 */
function buildHpTrail(events, preState) {
  const units = new Map();
  const reveal = [];
  const pre = [];
  const unit = (key, startHp, maxHp) => {
    if (!units.has(key)) units.set(key, { start: Math.max(0, startHp), max: Math.max(1, maxHp), current: null, applied: [] });
    return units.get(key);
  };
  // Running HP per body, seeded from the kernel's pre-action truth, kept current for the
  // two facts that arrive as AMOUNTS rather than absolute HP (heal, self_damage). Every
  // absolute-hp fact re-seeds it, so the model cannot drift.
  let heroRun = preState.player.hp;
  const heroMax = preState.player.maxHp;
  const foeRun = new Map((preState.combat?.enemies ?? []).filter((e) => !e.dead).map((e) => [e.index, e.hp]));
  const foeMax = new Map((preState.combat?.enemies ?? []).filter((e) => !e.dead).map((e) => [e.index, e.maxHp]));
  // The stream position of each body's FIRST golpe step, found in a FIRST PASS: the
  // walk below is single-pass in stream order, so a fact it is classifying cannot yet
  // have seen the golpe that follows it — the pre/reveal split needs the answer up
  // front. A reveal/tick/cost fact that PRECEDES its body's first golpe must land on
  // that body's bar before the golpe's fire — the reveal and tail fires both sit after
  // it (the reveal at ~animMs(310) vs the first impact at ~animMs(294+); the tail after
  // the last slam) — or the bar would fall with the slam and then RISE back to the
  // pre-golpe value with a heal pulse: a visual lie on a body being hit (the Banked Coal
  // end-of-turn shape: its sweep and HP cost resolve in the end-of-turn hooks, before
  // the enemy attacks of the same stream). No golpe steps for a body -> Infinity ->
  // nothing is pre for it, and its facts keep the reveal/tail fire they always rode.
  let heroGolpeAt = Infinity;
  const foeGolpeAt = new Map();
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    if (!ev) continue;
    if (ev.t === 'damage' && ev.source === 'player' && Number.isInteger(ev.target) && !foeGolpeAt.has(ev.target)) {
      foeGolpeAt.set(ev.target, i);
    }
    if (ev.t === 'enemy_attack' && Number.isInteger(ev.enemy) && heroGolpeAt === Infinity) {
      heroGolpeAt = i;
    }
  }
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    if (!ev) continue;
    if (ev.t === 'damage' && Number.isInteger(ev.target) && foeRun.has(ev.target)) {
      if (typeof ev.hp !== 'number') continue;
      const key = `e${ev.target}`;
      if (ev.source !== 'player') {
        // Banked Coal's end-of-turn sweep and potion damage: no golpe fire of their own —
        // they ride the reveal fire, the same one their diff float lands on — unless
        // they precede this body's first golpe, in which case they ride the pre-beat.
        if (foeGolpeAt.has(ev.target) && i < foeGolpeAt.get(ev.target)) pre.push({ unit: key, hp: ev.hp });
        else reveal.push({ unit: key, hp: ev.hp });
      }
      unit(key, foeRun.get(ev.target), foeMax.get(ev.target) ?? 1);
      foeRun.set(ev.target, ev.hp);
      // A hero golpe's step rides its strike entry (`strikes[k].hp`, k = the golpe's
      // index in stream order — the order playStrikes is built in below).
      continue;
    }
    if (ev.t === 'enemy_attack' && Number.isInteger(ev.enemy)) {
      // The hero's bar steps on the plan's golpe fire (fx.js reads `attacks[i].hp`).
      if (typeof ev.hp === 'number') {
        unit('p', heroRun, heroMax);
        heroRun = ev.hp;
      }
      continue;
    }
    if (ev.t === 'bleed_tick') {
      if (ev.who === 'player') {
        // The hero bleeds per golpe of his own multi-hit card: no per-golpe fire of its
        // own (the tick floats stack in the hero's box and reveal with the feel queue),
        // so the bar steps ride the reveal fire in stream order — or the pre-beat when
        // the tick precedes the body's first golpe.
        if (typeof ev.hp === 'number') {
          unit('p', heroRun, heroMax);
          heroRun = ev.hp;
          if (heroGolpeAt < Infinity && i < heroGolpeAt) pre.push({ unit: 'p', hp: ev.hp });
          else reveal.push({ unit: 'p', hp: ev.hp });
        }
        continue;
      }
      // An attacker bleeding on its own golpe: the step rides the golpe's tick fire
      // (fx.js reads `tk.hp` off the hung tick) — a stray one that precedes the body's
      // first golpe rides the pre-beat instead. The running model follows the stream
      // either way: the fire choice must not desync it.
      if (Number.isInteger(ev.index) && foeRun.has(ev.index) && typeof ev.hp === 'number') {
        unit(`e${ev.index}`, foeRun.get(ev.index), foeMax.get(ev.index) ?? 1);
        if (foeGolpeAt.has(ev.index) && i < foeGolpeAt.get(ev.index)) pre.push({ unit: `e${ev.index}`, hp: ev.hp });
        foeRun.set(ev.index, ev.hp);
      }
      continue;
    }
    if (ev.t === 'poison_tick') {
      // Poison is turn-close business on both sides — the grouping makes these TAIL
      // beats, and the tail fire reads `s.hp` off the step. But the HERO's close
      // (endOfTurnStatuses) resolves in the stream BEFORE the enemy attacks of the same
      // turn, so a hero tick that precedes the body's first golpe rides the pre-beat:
      // the tail fire would land its absolute pre-attack HP after the slams and lift the
      // bar the golpes had already taken down.
      if (ev.who === 'player') {
        if (typeof ev.hp === 'number') {
          unit('p', heroRun, heroMax);
          heroRun = ev.hp;
          if (heroGolpeAt < Infinity && i < heroGolpeAt) pre.push({ unit: 'p', hp: ev.hp });
        }
        continue;
      }
      if (Number.isInteger(ev.index) && foeRun.has(ev.index) && typeof ev.hp === 'number') {
        unit(`e${ev.index}`, foeRun.get(ev.index), foeMax.get(ev.index) ?? 1);
        if (foeGolpeAt.has(ev.index) && i < foeGolpeAt.get(ev.index)) pre.push({ unit: `e${ev.index}`, hp: ev.hp });
        // The tail fire carries this step's bar step (fx.js reads `s.hp` off the beat) —
        // no reveal push here, or the same fact would apply twice. The running model
        // follows the stream either way: the fire choice must not desync it.
        foeRun.set(ev.index, ev.hp);
      }
      continue;
    }
    if (ev.t === 'self_damage') {
      // An HP cost (vein_tap, blood_tithe, blood_hammer, Banked Coal's own sweep): the
      // amount is the kernel's fact, the floor at 1 is loseHp's own convention.
      const amount = Math.max(0, ev.amount ?? 0);
      unit('p', heroRun, heroMax);
      heroRun = Math.max(1, heroRun - amount);
      if (heroGolpeAt < Infinity && i < heroGolpeAt) pre.push({ unit: 'p', hp: heroRun });
      else reveal.push({ unit: 'p', hp: heroRun });
      continue;
    }
    if (ev.t === 'hp_cost') {
      // The OTHER HP-cost shape: the temper toll (`temperHpCost` — 'redhot' is "Lose 2
      // HP when played", steps.js) and an event choice's toll (events.js), both carried
      // as an AMOUNT. The cost ALWAYS rides the pre-beat, no guard: steps.js pays it
      // BEFORE the effect loop of the play even starts, and the pre fire (animMs(240))
      // lands strictly before the first golpe's impact (animMs(294+)) at every dock —
      // the heroGolpeAt check would be a rule the stream answers by construction
      // (hp_cost only travels in card streams, which carry no enemy_attack). The amount
      // is what the payer PAID (steps.js floors it: paid = min(cost, hp-1)), so the
      // mirror is a plain subtraction; the max(1, ·) is loseHp's own belt, not a rule.
      // Without this branch the anchor sat 2 HP HIGH, and any later HP fact of the same
      // stream — the kindled_heart heal a killing stroke arrives with — lifted the bar
      // ABOVE the snapshot for the retire to snap back down: the owner's "the bar
      // rises, then falls again" report (repro: seed 14, a redhot cinder_flick kills a
      // 8-HP foe, bar 45 -> 51 -> 49).
      const amount = Math.max(0, ev.amount ?? 0);
      unit('p', heroRun, heroMax);
      heroRun = Math.max(1, heroRun - amount);
      pre.push({ unit: 'p', hp: heroRun });
      continue;
    }
    if (ev.t === 'heal' && ev.who === 'player') {
      // `amount` is what the kernel actually restored (overcapped heals report less),
      // so the running value needs no clamp beyond maxHp.
      const amount = Math.max(0, ev.amount ?? 0);
      unit('p', heroRun, heroMax);
      heroRun = Math.min(heroMax, heroRun + amount);
      if (heroGolpeAt < Infinity && i < heroGolpeAt) pre.push({ unit: 'p', hp: heroRun });
      else reveal.push({ unit: 'p', hp: heroRun });
      continue;
    }
  }
  if (units.size === 0) return null;
  // `pre` is built in stream order (the walk pushes as it goes), so the pre-beat applies
  // a body's pre-golpe facts in exactly the order the kernel resolved them.
  return { start: Date.now(), units, reveal, pre };
}

/** B4: the chosen hero ('ashwright' Ashwright or 'bellows_keeper' Bellows Keeper); `?hero=` seeds it —
 *  and since the fixed start retired the kindling pickers, that seeding is the ONLY chooser.
 *  The NAMES are proper nouns in every language. The blurbs are NOT carried here: they live
 *  in i18n as `hero.<id>.blurb` — living content of the two heroes, but after the rework
 *  nothing in src consumes them at paint, so the wiring test (i18n.test.js) is their only
 *  net: it pins every id below to a non-empty en/es row, and a renamed id fails a test. */
export const HEROES = [
  { id: 'ashwright', name: 'Ashwright' },
  { id: 'bellows_keeper', name: 'Bellows Keeper' },
];
/** B5: the chosen biome (an id from the kernel BIOMES table); `?biome=` seeds it. */
const biomeParam = new URLSearchParams(location.search).get('biome');
export let biomeChoice = biomeParam && Object.hasOwn(BIOMES, biomeParam) ? biomeParam : DEFAULT_BIOME;
// The DE-STS rename: the canonical ids are the HEROES rows'; the renamed pre-0.5.0
// ids resolve through the kernel alias map BEFORE validation, so old links and old
// seeds keep booting the same heroes.
const heroParam = new URLSearchParams(location.search).get('hero');
const heroRequested = HERO_ALIASES[heroParam] ?? heroParam;
export let heroChoice = HEROES.some((h) => h.id === heroRequested) ? heroRequested : 'ashwright';


/**
 * Every interaction funnels here: dispatch one kernel action id, then repaint.
 * @param {string} actionId the engine's action id
 * @param {number|null} [targetK] the living-enemy slot the player aimed at, when the
 *   action was a targeted play — used ONLY to name the enemy in the feedback sentence.
 */
export function act(actionId, targetK = null) {
  if (!actionId) return;
  setPileOpen(null);
  // barra de vida por golpe: the held ghosts belong to the PREVIOUS action's row truth —
  // this action repaints the row from its own snapshot and its own death bursts, so a
  // ghost still mid-collapse is dropped here rather than mixed into the new slot
  // partition (heldDeaths exist only across repaints INSIDE one action's span).
  setHeldDeaths([]);
  const before = snap;
  // barra de vida por golpe: the kernel's OWN pre-action truth. In ordinary play it
  // equals the painted snapshot (every act() re-snapshots); the one writable lever that
  // can desync them (a mid-combat ctl.load in a test harness) must not poison the trail's
  // AMOUNT steps — a heal or an HP cost is anchored to the HP the kernel actually had,
  // never to a stale painted number (the golpe steps are absolute event hp and need no
  // anchor at all).
  const preState = ctl.state;
  // The map the player is standing on BEFORE this action, kept for the travel beat: the
  // node the step started from is gone from the rebuilt map, and this is the only handle on
  // it. Recorded from the snapshot, never computed from a coordinate.
  setPrevMap(before.map.current, before.map.floor);
  // Resolved from the BEFORE snapshot: the enemy the player aimed at is the one at that
  // living position before the play, which may not exist at all after it (it can die).
  const aimedAt = targetK != null ? before.enemies[targetK - 1] ?? null : null;
  const res = ctl.dispatch(actionId);
  // I18N-1: every repaint's snapshot is taken in the persisted presentation language —
  // the kernel re-derives its sentences in it. The language rides the OPTS only: run
  // state, hashes and the log are untouched.
  const after = ctl.snapshot({ lang: currentLang() });
  // A flip that ends the run in DEFEAT (outcome loss): the killing turn. The kernel's
  // endTurn returns at the death WITHOUT beginTurn (rules/act.js), so `combat.turn`
  // never increments on it — both the beat grouping and the plan arming below must
  // recognize the defeat by the phase/outcome pair, not by the turn counter.
  const defeatFlip = after.phase === 'ended' && after.outcome !== 'win';
  // The kernel's event stream for this step, kept for the run record. `submit()` inside the
  // controller accumulates the same events on the session; the renderer accumulates them
  // here because it builds the record at the end, and a record built from a dropped stream
  // scores zero kills while looking perfectly well-formed (DR-6).
  if (Array.isArray(res.events)) setRunEvents([...runEvents, ...res.events]);

  const fx = [];
  // barra de vida por golpe: armed below, in the success branch, from the kernel's own
  // event stream; declared here so the publish site beside the input lock sees it.
  let trail = null;
  if (res.error) {
    toast(t('toast.illegal', { err: res.error.error, id: res.error.id }));
    announce(t('toast.rejected.aria', { err: res.error.error }));
  } else {
    // Presentation-only feedback: compare the two kernel snapshots we already have.
    const playerLost = before.player.hp - after.player.hp;
    const enemyLost = sumEnemyHp(before) - sumEnemyHp(after);
    const gainedBlock = after.player.block - before.player.block;
    if (playerLost > 0) toast(t('toast.playerHit', { n: playerLost }), 'warn');
    else if (enemyLost > 0) toast(aimedAt ? t('toast.dealtTo', { n: enemyLost, name: aimedAt.name }) : t('toast.dealt', { n: enemyLost }), 'info');
    else if (gainedBlock > 0) toast(t('toast.block', { n: gainedBlock }), 'info');

    /* ------------------------------------------------------------ JUICE ----------
     * The SAME diff that produced the toast above is read again for the visual effects.
     * No extra rules: a floater exists exactly where damage was dealt.
     */

    // UX-2: the enemy turn, SEQUENCED AND NAMED. The turn flip is the one moment the
    // kernel resolves several attackers in one step, so the snapshot diff can only say
    // "the hero lost N in total" — the per-golpe facts live in the kernel's OWN
    // event stream for this step (`enemy_attack` carries the attacker's index, what it
    // dealt and what the hero's block ate, per strike, in resolution order). They are
    // read here the same way the run record reads them: kernel words about what happened,
    // regrouped for presentation, never re-derived. The result is ONE burst the
    // dispatcher plays as a sequence — enemy 1 winds up and strikes (its named float
    // lands on the hero), THEN enemy 2 — instead of every foe slamming at once.
    //
    // UX-9b GENERALIZED THE GROUPING (spec §4.1). It used to read `enemy_attack` alone, so
    // a turn of guards, buffs or debuffs produced no plan at all — no pose, no float, no
    // gate, the turn just arrived silently. The stream carries three enemy-indexed kinds,
    // and each is a BEAT: `enemy_attack` → strike, `enemy_block {enemy, amount}` → guard,
    // `enemy_status {enemy, status, stacks}` → the enemy's own status gain. A turn with any
    // of them now produces ONE plan, even with zero attacks. A debuff move afflicts the
    // HERO and its `player_status` event carries no attacker index (spec §4.1 notes this);
    // that step rides the flat beat list with `enemy: null` and lands on the hero, which is
    // what keeps a sorrow_wail/mourning_hex turn from being silent too.
    //
    // GOLPES DISCRETOS (this slice): `attacks` is ONE ENTRY PER STRIKE, not one per
    // attacker — an A4x2 move yields two beats, each with its own dealt/blocked/parried
    // and its 1-based golpe index (`hit`) against the move's announced total (`hits`,
    // parsed off the printed label "A4x2" — the only hit count the wire carries). The
    // attacker's OWN bleed rides the strike that triggered it: the kernel's
    // `bleed_tick {who:'enemy', index}` resolves right after that attacker's golpe, so
    // the tick steps hang off the strike (`strike.ticks`) and fx.js plays them on the
    // golpe's own clock. Poison is turn-END business, not golpe business: both tick
    // events (`poison_tick` on the hero, then one per living foe) become plain tail
    // beats in stream order, and fx.js plays the tail after the last slam.
    //
    // `plans` groups the beats per attacker, in kernel resolution order (what 9c paints
    // poses from); `beats` is the same steps flat in that same order (spec §4.1's list).
    // `attacks` is the per-strike list the sequenced playback iterates.
    let turnPlans = null;
    let turnBeats = null;
    let turnStrikes = null;
    // The killing turn is grouped TOO (see `defeatFlip` above): the old turn-flip probe
    // (`after.turn !== before.turn`) missed the whole sequence — the turn that killed
    // the hero produced no beats, no plan and no animation at all (owner report: "you
    // don't see the attack animation, it just shows the defeat screen"). A death by the
    // player's own card (an HP cost) carries no enemy events, so the grouping yields
    // nothing and stays silent, as before.
    if (before.phase === 'combat' && (after.turn !== before.turn || defeatFlip)) {
      const attacks = [];
      const plans = new Map();
      const beats = [];
      // UX-9c: the acting enemy, as the flat beat list walks the stream. A debuff move emits
      // only `player_status` (no attacker index), so the step is attributed to the last
      // enemy that spoke — see the branch below.
      let lastOwner = null;
      let lastOwnerId = null;
      let lastMove = null;
      // Per-enemy golpe counters for the strike beats (`hit` is 1-based).
      const golpeOf = new Map();
      // barra de vida por golpe: whether each body's FIRST golpe has already been
      // processed — the walk is in stream order, so a tick created while its body's
      // flag is still false PRECEDES that body's first golpe and must ride the pre-beat
      // (the same rule buildHpTrail applies to the trail's own pre list).
      let heroAttackSeen = false;
      const attackSeenFoes = new Set();
      // The last attack beat per enemy, so a bleed tick can ride its own golpe. BOTH
      // shapes that beat travels in are kept: the plan step (steps/beats, which the tail
      // and pose clocks read) and the per-strike entry (plan.attacks, which the golpe
      // playback iterates) — one tick, hung on both.
      const lastStrikeOf = new Map();
      const lastAttackOf = new Map();
      for (const ev of (Array.isArray(res.events) ? res.events : [])) {
        if (!ev) continue;
        if (ev.t === 'bleed_tick' || ev.t === 'poison_tick') {
          const status = ev.t === 'bleed_tick' ? 'bleed' : 'poison';
          // The tick's BODY names itself: `who: 'player'` is the hero's own close (the
          // hero poison tick), an enemy tick carries `index`.
          const onPlayer = ev.who === 'player';
          const foeIdx = onPlayer ? null : ev.index;
          const tick = {
            enemy: onPlayer ? null : foeIdx,
            owner: foeIdx,
            ownerId: onPlayer ? null : (plans.get(foeIdx)?.id ?? null),
            move: onPlayer ? lastMove : (plans.get(foeIdx)?.move ?? null),
            kind: 'tick',
            status,
            to: onPlayer ? 'player' : 'enemy',
            amount: ev.amount ?? 0,
            remaining: ev.remaining ?? 0,
            // barra de vida por golpe: the tick's own HP truth, so the bar's step can
            // ride the SAME fire the tick float lands on (fx.js). `pre` marks a tick
            // that precedes its body's first golpe in the stream — its bar step rides
            // the pre-beat instead of the tail (which fires after the slams and would
            // lift the bar the golpes had already taken down with the pre-golpe value).
            hp: typeof ev.hp === 'number' ? ev.hp : null,
            pre: onPlayer ? !heroAttackSeen : !attackSeenFoes.has(foeIdx),
          };
          if (!onPlayer && status === 'bleed' && Number.isInteger(foeIdx)) {
            // BLEED rides the golpe that triggered it — the holder ticks right after
            // each strike it executes, so the tick hangs off that golpe (present only
            // when a strike of this turn reached the tick; a tail slot would misorder
            // it against the NEXT golpe's slam). Both shapes the beat travels in carry
            // it: the plan step and the per-strike entry the playback iterates.
            const step = lastStrikeOf.get(foeIdx);
            const entry = lastAttackOf.get(foeIdx);
            if (step && entry) {
              step.ticks = [...(step.ticks ?? []), tick];
              entry.ticks = [...(entry.ticks ?? []), tick];
              continue;
            }
          }
          // Everything else — the POISON close on both sides, and a bleed tick with no
          // strike of its own to ride — is a plain tail beat, in stream order.
          beats.push(tick);
          continue;
        }
        if (ev.t === 'player_status') {
          // UX-9: the debuff that lands on the HERO is the acting enemy's own move half.
          // The kernel now stamps `enemy: i` on it (act.js debuff runner), the same index
          // its sibling runners use, so the hex is attributed to the enemy that actually
          // spoke — a debuff-only turn no longer falls back to `lastOwner: null`, which
          // left the Wraith's opening sorrow_wail with no signature and no pose. The FALLBACK
          // stays for any event that arrives without an index: then the last enemy that
          // spoke is still the one whose move emitted it. The step keeps `enemy: null`
          // (the float places at the HERO via `to: 'player'`), so nothing downstream
          // changes: fx.js/beatPose read step.owner/ownerId.
          const ownerIdx = Number.isInteger(ev.enemy) ? ev.enemy : lastOwner;
          const ownerFoe = ownerIdx == null
            ? null
            : before.enemies.find((e) => e.index === ownerIdx);
          beats.push({
            enemy: null,
            owner: ownerIdx,
            ownerId: ownerFoe ? ownerFoe.id : lastOwnerId,
            move: lastMove,
            kind: 'status',
            to: 'player',
            status: ev.status,
            stacks: ev.stacks ?? 0,
          });
          continue;
        }
        const kind = ev.t === 'enemy_attack' ? 'attack'
          : ev.t === 'enemy_block' ? 'block'
            : ev.t === 'enemy_status' ? 'status'
              : null;
        if (kind === null || !Number.isInteger(ev.enemy)) continue;
        let plan = plans.get(ev.enemy);
        if (!plan) {
          const foe = before.enemies.find((e) => e.index === ev.enemy);
          // UX-9c: the step carries the enemy's ROSTER ID and the move's own printed label.
          // The presentation table (fx-signatures ENEMY_SIG_FX) is keyed by id, so a beat must
          // know which type is acting; the label is the only hit count the wire carries
          // (`A5x3`, `A4x2`, `A7x2 BLEED2`), which is what tells a triple-pocket from a
          // single slam. Both come from the BEFORE snapshot — the acting enemy is still
          // on it, dead or not.
          plan = {
            enemy: ev.enemy,
            name: foe ? foe.name : t('toast.enemyFallback'),
            id: foe ? foe.id : null,
            move: foe && foe.intent ? foe.intent.label : null,
            steps: [],
          };
          plans.set(ev.enemy, plan);
        }
        if (kind === 'attack') {
          // ONE BEAT PER GOLPE: no accumulation. `hit` counts this attacker's own
          // golpes; `hits` is the move's announced total (the label's xN, clamped).
          const soFar = golpeOf.get(ev.enemy) ?? 0;
          golpeOf.set(ev.enemy, soFar + 1);
          const entry = {
            enemy: ev.enemy,
            name: plan.name,
            dealt: ev.dealt ?? 0,
            blocked: ev.blocked ?? 0,
            parried: Boolean(ev.parried),
            hit: soFar + 1,
            hits: announcedHits(plan.move),
            // barra de vida por golpe: the hero's HP after THIS golpe (the kernel's own
            // `enemy_attack.hp`), so the hero's bar steps on the golpe's own fire.
            hp: typeof ev.hp === 'number' ? ev.hp : null,
          };
          attacks.push(entry);
          lastAttackOf.set(ev.enemy, entry);
        }
        lastOwner = ev.enemy;
        lastOwnerId = plan.id;
        lastMove = plan.move;
        // The step's TARGET is the event's own: a status the kernel words as
        // player-afflicting lands on the hero even though the event carries an enemy
        // index (spec §4.1's hex mapping); everything else lands on that enemy.
        const to = kind === 'status' && PLAYER_AFFLICTING.has(ev.status) ? 'player' : 'enemy';
        // UX-9c: `id` / `move` ride every step (see the plan note above) so the per-type
        // presentation can key on the roster id and read the move's own label.
        const who = { id: plan.id, move: plan.move };
        const step = kind === 'attack'
          ? { enemy: ev.enemy, ...who, kind, to, dealt: ev.dealt ?? 0, blocked: ev.blocked ?? 0, parried: Boolean(ev.parried), hit: golpeOf.get(ev.enemy), hits: announcedHits(plan.move) }
          : kind === 'block'
            ? { enemy: ev.enemy, ...who, kind, to, amount: Math.max(0, ev.amount ?? 0) }
            : { enemy: ev.enemy, ...who, kind, to, status: ev.status, stacks: ev.stacks ?? 0 };
        plan.steps.push(step);
        beats.push(step);
        if (kind === 'attack') {
          lastStrikeOf.set(ev.enemy, step);
          heroAttackSeen = true;
          attackSeenFoes.add(ev.enemy);
        }
      }
      if (beats.length > 0) {
        turnPlans = [...plans.values()];
        turnBeats = beats;
        turnStrikes = attacks.length > 0 ? attacks : null;
      }
    }
    if (turnPlans) fx.push({ kind: 'enemy-turn', attacks: turnStrikes ?? [], plans: turnPlans, beats: turnBeats, playerLost });
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

    // GOLPES DISCRETOS — the hero's own strikes, per golpe. A play whose kernel events
    // carry `damage {source:'player'}` resolves as M discrete golpes (M×E across an
    // all-row hit), and each event is one golpe's truth (dealt through block, the
    // parry proc). The per-golpe `strike` bursts below REPLACE the snapshot-diff float
    // for the enemies they cover: the diff can only say "the enemy lost N in total",
    // while the events say what each strike did, in resolution order — and a parried
    // strike (dealt 0, HP untouched) would be invisible to the diff entirely. Cards
    // whose damage never rides the `damage` verb (the custom handlers, potion damage)
    // emit no events, so they keep the diff floats exactly as before.
    const playStrikes = [];
    for (const ev of (Array.isArray(res.events) ? res.events : [])) {
      if (!ev || ev.t !== 'damage' || ev.source !== 'player' || !Number.isInteger(ev.target)) continue;
      const foe = after.enemies.find((e) => e.index === ev.target) ?? before.enemies.find((e) => e.index === ev.target);
      playStrikes.push({
        kind: 'strike',
        enemy: ev.target,
        // A killing golpe empties the AFTER row — the name rides the BEFORE snapshot's
        // body, which is also the one the death ghost carries.
        name: foe ? foe.name : t('toast.enemyFallback'),
        dealt: ev.dealt ?? 0,
        blocked: ev.blocked ?? 0,
        parried: Boolean(ev.parried),
        hp: ev.hp ?? 0,
        hit: playStrikes.length + 1,
      });
    }
    if (playStrikes.length > 0) fx.push(...playStrikes);
    // BARRA DE VIDA POR GOLPE — arm the presentation trail from the SAME stream, before
    // the paint, exactly where the strike plan and the input lock arm: the paint this
    // action produces must already show the bars where the action FOUND them (the trail
    // read in combat-view/floats), with the per-golpe steps to follow on the dispatcher's
    // fires. The gate is the same condition the golpe choreography plays under — reduced
    // motion and » arm nothing, so the bars show snapshot truth at once (invariant (c)).
    trail = !reducedMotion && animSpeed !== 0 && before.phase === 'combat'
      ? buildHpTrail(Array.isArray(res.events) ? res.events : [], preState)
      : null;
    if (trail) {
      // The ghost timeline this trail drives: a killing golpe's delayed ash-fall ends one
      // collapse after its fire (the ghost's bar is stepped until then), so the trail
      // must outlive it — the retirement below adds this to its span. The ash-fall base
      // is render.js's COLLAPSE_MS (500, paced).
      const lethalIdx = playStrikes.findIndex((s) => typeof s.hp === 'number' && s.hp <= 0);
      trail.ghostMs = lethalIdx >= 0
        ? animMs(STRIKE_SEQ.beat) * lethalIdx + animMs(Math.round(STRIKE_SEQ.slam * STRIKE_SEQ.impactAt)) + animMs(500)
        : 0;
    }
    const struckIdx = new Set(playStrikes.map((s) => s.enemy));
    // Per-enemy: the damage that landed (HP delta), the glyph tier for that amount, and
    // whether block ate all of it. The bar still shows the remaining total. Enemies the
    // per-golpe events already covered are skipped — their numbers travel with the
    // sequenced strike floats instead (the `block-eat` bar flash still fires for them:
    // it animates the bar, it prints no number).
    const beforeByIdx = new Map(before.enemies.map((e) => [e.index, e]));
    let absorbed = false;
    for (const e of after.enemies) {
      const was = beforeByIdx.get(e.index);
      if (!was || e.hp >= was.hp) continue;
      if (struckIdx.has(e.index)) {
        if (was.block > 0) fx.push({ kind: 'block-eat', enemy: e.index });
        continue;
      }
      const dealt = was.hp - e.hp;
      const tier = dealt >= 16 ? 3 : dealt >= 8 ? 2 : 1;
      fx.push({ kind: 'float', enemy: e.index, amount: dealt, tone: 'dmg', tier, defeated: e.hp <= 0 });
      if (was.block > 0) fx.push({ kind: 'block-eat', enemy: e.index });
    }
    // UX-9b: an enemy's block gain now has its OWN beat in the sequenced turn
    // (`enemy_block` -> guard step, played by fx.js on the turn clock), so the diff must not
    // print the same `+N` a second time. The beats path wins: an enemy already covered by a
    // guard step is skipped here, and only a gain the event stream never named (a kernel
    // path that moves block silently) still falls through to this float. The PLAYER's side
    // is untouched — `gainedBlock` above keeps its one hero float, byte-identical.
    // UX-9: the dedupe only applies when the BEAT is going to play. fx.js breaks out of the
    // enemy-turn tail loop at `animSpeed === 0` (it paints the named floats statically
    // instead), and efxBox renders no guard beat either — so under fast mode or reduced
    // motion the guard step never becomes visible and suppressing the diff would drop the
    // `+N` entirely. Gate on the same condition the beats path runs under: the snapshot-diff
    // float is then the only carrier, which is exactly what it is for.
    const beatsPlay = !reducedMotion && animSpeed !== 0;
    const guardedIdx = new Set(
      beatsPlay ? (turnBeats ?? []).filter((s) => s.kind === 'block').map((s) => s.enemy) : [],
    );
    for (const e of after.enemies) {
      const was = beforeByIdx.get(e.index);
      if (was && e.block > was.block && e.hp === was.hp && !guardedIdx.has(e.index)) {
        fx.push({ kind: 'float', enemy: e.index, amount: e.block - was.block, tone: 'block', tier: 1 });
      }
    }
    // A hit that was FULLY absorbed leaves the enemy's HP untouched, so the loop above
    // never fires. Detected by the enemy's block falling while its HP held — and it says
    // so in words, because "0" or "−0" would contradict a bar that did not move. The
    // per-golpe events already carry that word for their own enemies (a fully blocked
    // golpe prints "absorbed" on its own float), so covered enemies only feed the bar
    // flash here, never a second float.
    for (const e of after.enemies) {
      const was = beforeByIdx.get(e.index);
      if (was && was.block > e.block && e.hp === was.hp) {
        if (!struckIdx.has(e.index)) fx.push({ kind: 'absorbed', enemy: e.index });
        else fx.push({ kind: 'block-eat', enemy: e.index });
        absorbed = true;
      }
    }

    // The hero's OWN bleed ticks ("golpes discretos"): every attack golpe the hero
    // executes ticks his bleed right after the strike lands (the kernel's
    // `bleed_tick {who:'player'}`), and the number is the HP that tick took. One
    // hero-float per tick, in the tick language (floatNode's tone 'tick'); `playerLost`
    // above already flinched the hero at the play's total, so these are words on top.
    let tickFloats = 0;
    for (const ev of (Array.isArray(res.events) ? res.events : [])) {
      if (!ev || ev.t !== 'bleed_tick' || ev.who !== 'player') continue;
      fx.push({ kind: 'hero-float', tone: 'tick', status: 'bleed', amount: ev.amount ?? 0, remaining: ev.remaining ?? 0, silent: false, at: tickFloats++ });
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
          // GOLPES DISCRETOS: this play's own per-strike facts (the same list the
          // `strike` bursts above carry), so fx.js can beat out a multi-hit card's
          // floats one per golpe on the STRIKE_SEQ clock and `playInputSpan` can hold
          // the input for the whole sequence.
          strikes: playStrikes,
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
    .map((e, slot) => ({ e, slot }))
    .filter(({ e }) => !after.enemies.some((a) => a.index === e.index))
    .map(({ e, slot }) => ({
      ...e,
      slot,
      side: positionClass(e.index, after.enemies, before.enemies, e.index),
      // Whether a BOSS just left the field. Read from the name (`enemyLook` already maps
      // "Warden" -> boss for the card frame), never from a stat: it decides how large the
      // collapse reads, and nothing else. The victory beat is gated on this below, which is
      // how "the boss dies, THEN the panel arrives" is sequenced without asking the kernel
      // for a new field.
      boss: enemyLook(e.id).boss,
    }));
  // Each departure becomes a `death` burst, which the next paint draws as an inert ghost
  // card that holds the victim's own slot while it collapses. The burst carries BOTH
  // index namespaces the row speaks: `slot` — the position the body occupied in the
  // BEFORE painted row (this array), which combatView keys the ghost by so the row's
  // living and ghost slots keep partitioning 0..n-1; and `enemy` — the STABLE kernel
  // index, which the fx layer matches on (`card-fly.enemy` <-> the ghost's
  // `data-death-index`). They differ once a kernel death is compacted out of the
  // snapshots (the kernel keeps dead rows; `snapshotEnemies` omits them): every later
  // stable index then sits above its painted position, and a ghost keyed by the stable
  // index lands past the row's end — the aimed-kill crash.
  // `id` rides along too: the ghost card's art is keyed by it (`dyingCard` -> `enemyMarkup`),
  // and without it every death ghost fell back to the cinder-maw sprite (SPRITES.cinder_maw).
  // `maxHp` rides along since the hp-trail slice: while a trail is armed for the victim,
  // its collapsing ghost carries the victim's own HP bar (the kill-hold's "its bar falls
  // to 0 at the lethal golpe"), and a bar width needs the max to be a width.
  for (const d of dying) fx.push({ kind: 'death', enemy: d.index, slot: d.slot, id: d.id, name: d.name, side: d.side, boss: d.boss, maxHp: d.maxHp });

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
  // The victory/defeat panel must WAIT for the collapse (or, on a defeat, the killing
  // turn and the hero's death) that precedes it, so a run that ends on this action is
  // marked here and `render()` holds the stage for one beat. A run that was ALREADY over
  // (a restart) never reaches this line, which is why a fresh run paints its map
  // immediately instead of waiting for a death that already happened.
  if (after.phase !== before.phase) {
    if (after.phase === 'ended') {
      // The panel must WAIT for the beat that precedes it, so the run is marked here and
      // `render()` holds the stage for one beat. A run that was ALREADY over (a
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
  // A flip that ENDS the run in DEFEAT arms the plan TOO: the defeat hold (render.js)
  // paints the fight exactly as it stood and replays THIS plan over it, so the killing
  // turn is a beat the player sees instead of a snapshot they are handed. The named
  // floats land on the HELD hero — fx.js heroLane() measures whatever `.fight .hero` is
  // painted, and the hold paints one — so nothing is unpositioned over the panel (the
  // UX-2 review P3 concern that used to gate this off is superseded, not ignored). A
  // victory flip that ends the run (the last enemy falling to end-of-turn damage during
  // its own turn) keeps the old shape: no plan — the kill hold owns that beat.
  const seqBurst = after.phase === 'ended' && !defeatFlip ? null : fx.find((b) => b.kind === 'enemy-turn');
  // A defeat flip that ALSO carries enemy deaths (Banked Coal can clear the last foe inside
  // the very endTurn that kills the hero — rules/act.js:439-447) runs the EXISTING kill
  // hold in render.js, not the defeat hold, and on that path the plan has no retirement
  // timer: it would sit armed forever, reporting busyReason 'enemy-turn' over the
  // finished screen and swallowing every key until a restart. The plan is therefore
  // armed only for the CLEAN killing turn; the else-if below retires it on every other
  // ended flip (reduced motion and » reach the same cleanup), so no plan survives a run
  // that is already over.
  let trailArmedPlan = false;
  if (seqBurst && !(defeatFlip && dying.length > 0) && !reducedMotion && animSpeed !== 0) {
    trailArmedPlan = true;
    const beatMs = animMs(STRIKE_SEQ.beat);
    const slamMs = animMs(STRIKE_SEQ.slam);
    // UX-9b: the non-attack beats (guard / power / hex) ride the SAME plan as a tail after
    // the last slam, one TURN_STEP slot each in kernel order — so a compound move reads as
    // strike THEN guard, and a turn with no attack at all still has a clock to present on.
    // The tail starts where the last slam ENDS (not at the next beat: with one attacker the
    // next beat would fall inside its own slam); a turn with no slam starts it at 0, which
    // is the block-only / buff-only / debuff-only turn. An attack-only turn has an empty
    // tail, so totalMs stays byte-identical to the pre-9b figure.
    const tail = (seqBurst.beats ?? []).filter((s) => s.kind !== 'attack');
    const stepMs = animMs(TURN_STEP.ms);
    const strikeMs = seqBurst.attacks.length > 0 ? beatMs * (seqBurst.attacks.length - 1) + slamMs : 0;
    const tailAt = strikeMs;
    const plan = {
      attacks: seqBurst.attacks,
      plans: seqBurst.plans ?? [],
      tail,
      stepMs,
      tailAt,
      beatMs,
      slamMs,
      impactMs: Math.round(slamMs * STRIKE_SEQ.impactAt),
      start: Date.now(),
      totalMs: Math.max(strikeMs, tail.length > 0 ? tailAt + stepMs * tail.length : 0),
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
    // The timer is the NORMAL turn's cleanup only. On the clean killing turn the defeat
    // hold in render.js owns the clock end to end and retires the plan itself when the
    // hero's death beat is over — a retirement repaint here would paint the ended panel
    // OVER the still-playing sequence. A defeat flip that carries deaths never arms (the
    // guard above), and » (skipAnim), the hold's backdrop skip, the hold's dock and a
    // restart all retire it too.
    if (after.phase !== 'ended') {
      later(() => {
        if (strikeSeq !== plan) return;
        setStrikeSeq(null);
        // barra de vida por golpe: the turn's bar steps are all fired by now — the trail
        // retires WITH the plan (the same clock), so no paint after this one can show a
        // stale stepped value.
        retireHpTrail();
        repaint();
      }, plan.totalMs + 400);
    }
  } else if (!seqBurst || after.phase === 'ended') {
    // UX-2 review P2: the turn-flip that is NOT an enemy attack (the player's own
    // actions, the reward/rest flips) must retire any plan still armed — the
    // End-Turn timer above only covers the sequence's own lifetime, and an unguarded
    // plan re-slams stale attackers over the player's next action for ~1.5s. Every run-
    // ending flip that did not arm reaches this same cleanup — the defeat-with-deaths
    // flip (no hold of its own for a plan there), a killing turn under reduced motion
    // or » — so nothing may stay armed over a run that has already ended.
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
  // barra de vida por golpe: publish the trail and schedule its retirement. When a
  // strike plan owns the clock, the trail retires WITH the plan (the timer above) —
  // the gate is held for the whole sequence, so no action can supersede it mid-turn.
  // Everything else (a card play, a belt quaff, a defeat flip that carries deaths) arms
  // its own span: the play's choreography span covers every golpe fire it schedules
  // (playInputSpan is the figure the gate arms from), plus the width transition's tail;
  // the no-play fallback covers the reveal beat where the un-fired floats land. The
  // identity check keeps a stale timer from retiring a NEWER action's trail.
  if (trail) {
    setHpTrail(trail);
    if (!trailArmedPlan) {
      // barra de vida por golpe: the span adds the trail's own ghost timeline
      // (`trail.ghostMs`, computed where the strikes are in scope) — a repaint inside
      // the delayed collapse must still re-draw the ghost WITH its bar.
      const span = (flyBurst && !reducedMotion && animSpeed !== 0
        ? playInputSpan(flyBurst)
        : animMs(900)) + animMs(450) + (trail.ghostMs || 0);
      later(() => { if (hpTrail === trail) retireHpTrail(); }, span);
    }
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
 * @param {{quiet?: boolean}} [opts] quiet: skip the act title card on this run's first
 *   paint. The in-src caller died with the fixed start (the same-seed kindling switches
 *   are gone); the option STAYS because the test harness still passes it (boon-cost
 *   rebuilds per seed), and such rebuilds must never replay the title card.
 */
export function newGame(seed = null, opts = {}) {
  // A NEW run, built for the profile the player's own history has earned (DR-4). The
  // narrowing happens in the kernel: `contentForProfile` decides which cards EXIST, and no
  // rule ever reads the profile. S10: the profile's lifetime WINS ride along — the relic
  // pool is derived kernel-side from them (RELIC_UNLOCK_TABLE), the same one-way trip the
  // card pool takes. `?pool=full` bypasses both narrowings for a tester.
  const profile = currentProfile();
  setCtl(createController({ run: { seed: seed ?? seedFromUrl(), content: contentForProfile(profile), character: heroChoice, biome: biomeChoice, kindling: true, tempers: true, quests: true, wins: profile.wins } }));
  setSnap(ctl.snapshot({ lang: currentLang() }));
  // The event stream is per-RUN, so it dies with the run. It is the only source of the kill
  // / elite / boss counts the score needs, which is why it is accumulated rather than
  // re-derived later from a snapshot that never carried them.
  setRunEvents([]);
  resetRunOutcome();
  clearFxTimers();
  // WAAPI embers own no fx-layer timer, so the sweep above cannot reach them: cancel
  // them by name BEFORE the layer is emptied (their records would otherwise outlive
  // their nodes for the rest of the particle life).
  cancelEmberParticles();
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
  setLastEnemyStatuses(new Map());
  setPaintedPhase(null);
  setQuietIntro(opts.quiet === true);
  // A new run must animate its own entrance and its own victory/defeat, so every one-shot
  // presentation flag is cleared with the timers that would have released it.
  setPrevEnemies([]);
  setEnteredIds(new Set());
  setHeroMoveHold(null);
  setStrikeSeq(null);
  // the impact bundle's hold is run-scoped motion state like the rest: a restart must
  // not let a dead run's window resume a squash on the new run's first paint.
  setImpactHold(null);
  // barra de vida por golpe: run-scoped motion state like the rest — a restart drops the
  // trail without the retire's snap (the fresh run repaints from its own snapshot), and
  // any held ghosts with it.
  setHpTrail(null);
  setHeldDeaths([]);
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
 * I18N-1: flip the presentation language, persist it, and re-narrate the CURRENT run in
 * the new language — a fresh `ctl.snapshot({ lang })` (the kernel re-derives every
 * sentence; nothing is cached per-language here) and a repaint. The run state, its hash
 * and the action log are untouched: the same run, re-narrated. This lives beside
 * newGame() because it is a run-lifecycle move over the same handles (the language
 * itself, its persistence and its strings live in i18n.js, a dependency-free leaf).
 */
export function switchLang() {
  setLang(currentLang() === 'es' ? 'en' : 'es');
  if (ctl) setSnap(ctl.snapshot({ lang: currentLang() }));
  repaint();
}
