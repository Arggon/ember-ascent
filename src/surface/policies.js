// Built-in self-play policies (R7 default: "Built-in heuristics first; LLM policy is
// opt-in and never default").
//
// These are HEURISTICS, not a claim about human play. Everything they produce is
// labelled `heuristic` provenance so no report can mistake it for player behaviour
// (R10 binding rule).
//
// Determinism: a policy may only read the kernel's public output — legal actions,
// state, and the events a step returned. No clocks, no Math.random, no I/O. Two runs
// on the same seed and policy take exactly the same decisions, which is what makes
// `sim` replayable and therefore auditable.
//
// LAYOUT — decision logic lives here, value models live beside it:
//   policy-read.js    kernel public output -> neutral facts (intent labels, card profiles)
//   policy-greedy.js  `greedy`'s per-card score (pinned arithmetic — see its header)
//   policy-smart.js   `smart`'s combat/reward/deck scoring (the W weight table)
//   policies.js       THIS FILE: makePolicy + the choose() flows and map routing
// This file re-exports the scoring API, so `policies.js` remains the one import point.
import { CONTENT } from './policy-read.js';
import { scoreCard, rewardWorth } from './policy-greedy.js';
import { SKIP_SCORE, SKIP_DECK_SIZE, combatContext, scoreSmartCard, smartRewardScore } from './policy-smart.js';

/**
 * Build a policy by name.
 * @param {string} name
 * @returns {{name: string, choose: (ctx: any) => {id: string, memory: any}}}
 */
export function makePolicy(name) {
  if (name === 'random') return randomPolicy();
  if (name === 'greedy') return greedyPolicy();
  if (name === 'smart') return smartPolicy();
  throw Object.assign(new Error(`unknown policy "${name}" (expected: greedy, random, smart)`), { code: 3 });
}

/** Deterministic pseudo-choice: no RNG state, so replay of sim runs is exact. */
function randomPolicy() {
  return {
    name: 'random',
    choose(ctx) {
      const acts = ctx.legal;
      if (acts.length === 0) return { id: null, memory: ctx.memory };
      // Hash-free deterministic index mixing seed, step and choice count.
      const mixed = (ctx.session.state.seed * 2654435761 + ctx.session.state.rngDraws * 40503 + ctx.stepIndex * 97) >>> 0;
      return { id: acts[mixed % acts.length].id, memory: ctx.memory };
    },
  };
}

/** Where to go next, best first. Rest when hurt; otherwise take the safe fight.
 *  The shop (S4) and the event (S6) rank last in every mood: no policy prices the
 *  vendor's wares, and an event's gamble (HP for gold, gold for cards) is not worth
 *  pricing blind — walking past is the honest routing rather than an accident of the
 *  unknown-type fallback. */
function routePreference(state) {
  const hpFrac = state.player.hp / state.player.maxHp;
  if (hpFrac < 0.55) return ['rest', 'combat_weak', 'combat_strong', 'elite', 'shop', 'event'];
  if (hpFrac > 0.85) return ['combat_strong', 'combat_weak', 'rest', 'elite', 'shop', 'event'];
  return ['combat_weak', 'combat_strong', 'rest', 'elite', 'shop', 'event'];
}

/**
 * The map-phase choice both heuristic policies share: the best-ranked travel action
 * by routePreference. One implementation, so the two policies cannot drift on where
 * to walk — `smart`'s chooser used to carry a copy of `greedy`'s map branch and
 * promise they agreed; now it is the same code, not a promise.
 */
function chooseTravelId(state, acts) {
  const order = routePreference(state);
  const best = acts
    .filter((a) => a.kind === 'travel')
    .sort((x, y) => (order.indexOf(x.nodeType) + 1 || 99) - (order.indexOf(y.nodeType) + 1 || 99))[0];
  return best?.id ?? acts[0].id;
}

/**
 * The event phase's choice, both heuristic policies share (S6). No purchase heuristic
 * ships for the wayside either: the stance is the shop's leave-at-once minimalism —
 * take a zero-cost, no-HP-loss choice if one exists (every event carries at least one,
 * so the phase always resolves), else the first offered; then the continue. The
 * temper modal and the resolved beat carry only their own exits, and this helper's
 * fallthrough (first offered) resolves both without a special case.
 * Zero-cost is read from the ACTION's own fields (`cost`/`hpLoss`), so no policy
 * re-derives a requirement the kernel already evaluated.
 */
function chooseEventId(acts) {
  const choices = acts.filter((a) => a.kind === 'event_choice');
  const free = choices.filter((a) => !a.cost && !a.hpLoss);
  if (free.length > 0) return free[0].id;
  if (choices.length > 0) return choices[0].id;
  return acts[0]?.id ?? null;
}

/**
 * The heuristic the balance data is generated with.
 *
 * Priority order, in plain terms: take a kill when one exists; block only as much
 * as the incoming attack actually requires; otherwise build damage and value. The
 * "only as much as required" part is what separates a competent player from a
 * card-cycling bot, and it is why this policy can finish a run.
 */
function greedyPolicy() {
  return {
    name: 'greedy',
    choose(ctx) {
      const { state, legal: acts, memory } = ctx;
      if (acts.length === 0) return { id: null, memory };

      if (state.phase === 'ended') return { id: null, memory };

      if (state.phase === 'reward') {
        const picks = acts.filter((a) => a.kind === 'pick');
        const skip = acts.find((a) => a.kind === 'skip');
        if (picks.length === 0) return { id: skip?.id ?? acts[0].id, memory };
        const ranked = picks
          .map((a) => ({ a, s: rewardWorth(CONTENT.cards.get(a.cardId)) }))
          .sort((x, y) => y.s - x.s);
        const best = ranked[0];
        // A thin deck is the most common way to lose this act: with 3 energy a turn,
        // what matters is average damage per energy, and 10 starter cards supply ~6.
        // Refusing cards therefore has to clear a high bar, not a low one.
        const deckIsFat = state.deck.length >= 24;
        const floor = deckIsFat ? 22 : 0;
        if (best.s < floor && skip) return { id: skip.id, memory };
        return { id: best.a.id, memory };
      }

      if (state.phase === 'rest') {
        const heal = acts.find((a) => a.kind === 'rest_heal');
        // Heal whenever it is not wasted: an act-1 boss is a 240 HP damage race, so
        // HP is the resource that decides whether the run reaches it at all.
        if (heal && state.player.hp < state.player.maxHp - 2) return { id: heal.id, memory };
        return { id: acts.find((a) => a.kind === 'rest_leave')?.id ?? acts[0].id, memory };
      }

      if (state.phase === 'shop') {
        // S4: no purchase heuristic ships in this slice — pricing an offer against the
        // deck is a future policy slice's work, and the shop's routing rank (last, in
        // routePreference) means greedy normally walks past it anyway. Leaving at once
        // is the honest minimal behaviour; in the paid removal step the leave action
        // does not exist, so the first pick is the only move.
        const leave = acts.find((a) => a.kind === 'shop_leave');
        return { id: leave?.id ?? acts[0].id, memory };
      }

      if (state.phase === 'event') {
        // S6: the shared minimal stance (see chooseEventId) — a free pass-through if
        // one exists, else the first offered choice, else the phase's own exit.
        return { id: chooseEventId(acts), memory };
      }

      if (state.phase === 'map') return { id: chooseTravelId(state, acts), memory };

      // Combat.
      const live = state.combat.enemies.filter((e) => !e.dead);
      const incoming = memory.incoming ?? 0;
      const plays = acts.filter((a) => a.kind === 'play');
      if (plays.length === 0) {
        const end = acts.find((a) => a.kind === 'end_turn');
        return { id: end?.id ?? acts[0].id, memory };
      }

      const hpSum = live.reduce((s, e) => s + e.hp, 0);
      const scored = plays
        .map((a) => {
          const def = CONTENT.cards.get(a.cardId);
          const card = state.combat.hand[Number(a.id.slice(1)) - 1];
          const s = scoreCard(def, { state, card, liveEnemies: live, incoming, lethalAnywhere: hpSum <= 14 });
          // Prefer the cheapest card that reaches the same score: energy is the
          // scarce resource, and a 2-cost card that overkills wastes a whole turn.
          return { a, def, card, ...s, key: s.score - (a.cost ?? 0) * 1.2 };
        })
        .sort((x, y) => y.key - x.key);

      const top = scored[0];
      const end = acts.find((a) => a.kind === 'end_turn');

      // Every card is actively bad here (e.g. only self-damage at 5 HP left): stop.
      if (top.score <= 0 && end) return { id: end.id, memory };

      // SURVIVAL OVERRIDE. If the incoming hit kills us and a block card can change
      // that, take block regardless of damage — a dead player deals no damage, and
      // the per-card score cannot see that because it scores one card at a time.
      if (end) {
        const lethal = incoming >= state.player.hp;
        if (lethal) {
          const blockers = scored.filter((s) => s.block > 0).sort((x, y) => y.block - x.block);
          const cover = blockers.reduce((sum, s) => sum + s.block, 0) + state.player.block;
          if (blockers.length > 0 && cover >= incoming) return { id: blockers[0].a.id, memory };
          // Cannot survive even blocking: maximise damage and hope for a kill.
          if (blockers.length === 0) return { id: top.a.id, memory };
        }
      }

      // If we cannot meaningfully dent the enemy and nothing is incoming, stop
      // wasting cards on a fight we are losing slowly.
      if (!end) return { id: top.a.id, memory };
      const deadHand = incoming === 0 && top.damage === 0 && top.block === 0 && top.score < 6;
      if (deadHand) return { id: end.id, memory };

      return { id: top.a.id, memory };
    },
  };
}

/**
 * The `smart` policy: score every legal action, take the best, repeat.
 *
 * Same contract as every other policy — `choose(ctx)` returns `{id, memory}` and reads
 * only public observation. The action space carries no target parameter (the kernel
 * always aims a single-target card at the first living enemy), so "hit the most
 * dangerous enemy" is expressed as "play the card that kills or covers the threat",
 * which is the part of requirement 6 the interface can actually express.
 */
function smartPolicy() {
  return {
    name: 'smart',
    choose(ctx) {
      const { state, legal: acts, memory } = ctx;
      if (acts.length === 0) return { id: null, memory };
      if (state.phase === 'ended') return { id: null, memory };

      if (state.phase === 'reward') return chooseReward(state, acts, memory);
      if (state.phase === 'rest') return chooseRest(state, acts, memory);
      if (state.phase === 'shop') return chooseShop(state, acts, memory);
      if (state.phase === 'event') return { id: chooseEventId(acts), memory };
      if (state.phase === 'map') return { id: chooseTravelId(state, acts), memory };
      return chooseCombat(state, acts, memory, ctx);
    },
  };
}

/** Reward: take the card the DECK needs, not the card with the biggest number. */
function chooseReward(state, acts, memory) {
  const picks = acts.filter((a) => a.kind === 'pick');
  const skip = acts.find((a) => a.kind === 'skip');
  if (picks.length === 0) return { id: skip?.id ?? acts[0].id, memory };
  const ranked = picks
    .map((a) => ({ a, s: smartRewardScore(CONTENT.cards.get(a.cardId), state) }))
    .sort((x, y) => y.s.key - x.s.key || y.s.perEnergy - x.s.perEnergy);
  const best = ranked[0];
  // The deck is allowed to stay thin, but only once it is already large and only when
  // the offer is genuinely weak: dilution costs consistency, and a small deck that
  // draws its best card every turn beats a big one. Thresholds are ARBITRARY.
  const fat = state.deck.length >= SKIP_DECK_SIZE;
  if (fat && best.s.key < SKIP_SCORE && skip) return { id: skip.id, memory };
  return { id: best.a.id, memory };
}

/** Rest: healing is free, so the only reason to leave is that there is nothing to heal. */
function chooseRest(state, acts, memory) {
  const heal = acts.find((a) => a.kind === 'rest_heal');
  if (heal && state.player.hp < state.player.maxHp) return { id: heal.id, memory };
  return { id: acts.find((a) => a.kind === 'rest_leave')?.id ?? acts[0].id, memory };
}

/** Shop (S4): leave at once — same minimal stance greedy takes; see its branch above. */
function chooseShop(state, acts, memory) {
  const leave = acts.find((a) => a.kind === 'shop_leave');
  return { id: leave?.id ?? acts[0].id, memory };
}

/**
 * Combat: reject the lethal line, take the kill, else spend Energy on real value.
 *
 * The loop is the policy: after every play the board changes, so the next decision is
 * made on the new board with the same scoring function. That is what makes "cover only
 * what is needed", "stop blocking once the enemy is dead" and "never leave Energy
 * unspent while a useful card is playable" fall out of one rule instead of three.
 */
function chooseCombat(state, acts, memory, ctx) {
  const plays = acts.filter((a) => a.kind === 'play');
  const end = acts.find((a) => a.kind === 'end_turn');
  if (plays.length === 0) return { id: end?.id ?? acts[0].id, memory };

  const incomingOverride = typeof ctx?.incoming === 'number' ? ctx.incoming : null;
  const base = combatContext(state, ctx?.dump ?? null, incomingOverride);
  const attacksInHand = base.attacksInHand;

  const scored = plays
    .map((a) => {
      const def = CONTENT.cards.get(a.cardId);
      const card = state.combat.hand[Number(a.id.slice(1)) - 1];
      const isAttack = def.type === 'attack' || def.effects.some((e) => e.verb === 'damage');
      const s = scoreSmartCard(def, {
        ...base,
        perPlay: card?.perPlay ?? 0,
        // Follow-up credit counts the OTHER attack cards still in hand.
        followUpAttacks: isAttack ? Math.max(0, attacksInHand - 1) : attacksInHand,
      });
      return { a, s };
    })
    .sort((x, y) => y.s.key - x.s.key || y.s.perEnergy - x.s.perEnergy);

  const top = scored[0];
  // A card whose effect accomplishes nothing scores at or below zero, so the energy
  // is kept rather than spent on an empty play (requirement 4).
  if (top.s.score <= 0) return { id: end?.id ?? acts[0].id, memory };
  // The one position where a bad card is better than the best card: if the incoming
  // attack kills us and no sequence of blocks can change that, race instead of
  // stacking Block that cannot save us.
  if (base.incoming >= base.playerHp) {
    const cover = base.playerBlock + scored.reduce((m, x) => Math.max(m, x.s.detail.blockGiven), 0);
    if (cover < base.incoming) {
      const bestDamage = scored.reduce((best, x) => (x.s.detail.rawDamage > best.s.detail.rawDamage ? x : best), scored[0]);
      if (bestDamage.s.detail.rawDamage > 0) return { id: bestDamage.a.id, memory };
    }
  }
  return { id: top.a.id, memory };
}

// --- public API (unchanged surface for every importer: sim, tests, dev probes) ---
export { intentDamageFromLabel, intentLabelsFromDump, enemyThreats, effectProfile, CONTENT as content } from './policy-read.js';
export { profileDamage, scoreSmartCard, deckComposition, deckNeeds, smartRewardScore, combatContext } from './policy-smart.js';
export { scoreCard } from './policy-greedy.js';
