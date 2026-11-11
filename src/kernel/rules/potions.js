// Potions (S5) — the first per-combat consumable resource.
//
// A belt of POTION_SLOTS slots, empty at run start, that fills from seeded post-combat
// drops. Quaffing and discarding are COMBAT-ONLY belt interactions: both consume the
// slot, a quaff resolves its effect immediately, and a discard is a free action that
// changes nothing but the belt. Outside combat the belt is display-only (the snapshot
// publishes it in every phase so the HUD can show it, but actions() offers no q/d id
// outside `phase === 'combat'` — during the shop and on the map the belt is inert).
//
// Draw accounting — a deliberate decision, part of the format:
//   * The DROP rolls at victory time, from the live counter, in rules/act.js
//     resolveVictory — the same convention as the gold grant it sits beside. The order
//     within one victory is FIXED and part of the format (the full chain lives in
//     rules/act.js resolveVictory's header): relic heal (0 draws) -> tier gold (0..1)
//     -> relic gold (0) -> boss branch (the chain ENDS there with the relic offer) ->
//     POTION DROP (0..2 draws) -> elite relic drop (elite fights: 2) -> reward offer
//     roll. Every later roll therefore reads the counter AFTER the drop, so the drop is
//     reproducible from the action log forever.
//   * A victory on a fight tier with belt room consumes exactly ONE draw: the drop
//     roll `intAt(seed, counter, 100)`. The band convention is the LOWEST `chance`
//     values of the 100 equally likely results: the drop hits when the roll is
//     `< DROP_CHANCE[tier]` — exactly that percentage of seeds, with no boundary
//     ambiguity. A miss consumes the one draw and nothing else.
//   * A HIT consumes exactly ONE more draw: the potion id is `intAt(seed, counter+1,
//     POTIONS.length)` — a uniform single pick over the table, exactly like one price
//     roll in the shop. A dropped victory therefore costs exactly 2 draws, a missed
//     victory exactly 1.
//   * A FULL BELT consumes ZERO draws: the roll is suppressed, not rolled-and-discarded.
//     Getting a 4th potion is impossible (StS parity), and "impossible" must not cost
//     the stream anything — a suppressed victory consumes the same draws it did before
//     the potion system existed at that step.
//   * The boss NEVER rolls a potion (the victory branch ends the chain at the relic
//     offer; nothing is consumed) — checked BEFORE the drop in act.js, exactly like the
//     gold path's flat-tier short-circuit.
//   * Quaff and discard consume ZERO draws. Every potion number is fixed (no per-potion
//     variance); the belt carries ids, not rolled values.
//
// Tolerance: a belt id the table no longer knows (a torn save — validateSave never
// checks potion ids) degrades everywhere: the snapshot shows the raw id as its own
// name, actions() offers no quaff for it (the handler would refuse — the same
// enumeration-mirrors-guard ruling as the S4.1 torn shop), and a DISCARD is still
// offered so the corrupt slot can be cleared. Nothing throws.
//
// Pure: no Date, no Math.random, no I/O; the only entropy is (seed, drawIndex).
import { intAt } from '../rng.js';
import { VOCABULARY, DEBUFFS, damageEnemy } from './vocabulary.js';

/** Belt capacity (StS parity: 3). A 4th potion is impossible — suppressed at the drop. */
export const POTION_SLOTS = 3;

/**
 * The potion roster. Order is the pick order: the id roll indexes THIS array, so
 * reordering changes which potion every seed receives — the order is part of the
 * format, exactly like the shop's offer order.
 *
 * `target` mirrors the card field of the same name: 'enemy' potions must be aimed when
 * more than one enemy is alive (q<n>_<k>), every other target never asks (plain q<n>).
 * `summary` is the compact CLI form; `text` is the describe-layer sentence a human
 * surface shows verbatim. Both live HERE, kernel-side, so no surface re-derives words.
 * I18N-1: `name_es`/`text_es` are the Spanish twins of the player-facing fields, read
 * by snapshot({lang:'es'}) with the English field as the honest fallback; `summary`
 * stays the compact English-only code.
 */
export const POTIONS = Object.freeze([
  Object.freeze({ id: 'ember_draught', name: 'Ember Draught', name_es: 'Brebaje de Ascuas', target: 'enemy', summary: 'A20', text: 'Deal 20 damage to one enemy.', text_es: 'Inflige 20 de daño a un enemigo.' }),
  Object.freeze({ id: 'stone_skin', name: 'Stone Skin', name_es: 'Piel de Piedra', target: 'none', summary: 'B12', text: 'Gain 12 Block.', text_es: 'Ganas 12 de Bloqueo.' }),
  Object.freeze({ id: 'ash_salts', name: 'Ash Salts', name_es: 'Sales de Ceniza', target: 'none', summary: 'HP+20%', text: 'Heal 20% of your max HP, rounded down.', text_es: 'Recuperas el 20% de tu HP máximo, redondeado hacia abajo.' }),
  Object.freeze({ id: 'bellows_fuel', name: 'Bellows Fuel', name_es: 'Combustible de Fuelle', target: 'none', summary: 'E2', text: 'Gain 2 Energy.', text_es: 'Ganas 2 de Energía.' }),
  Object.freeze({ id: 'whetstone', name: 'Whetstone', name_es: 'Piedra de Afilar', target: 'none', summary: 'PWR+2', text: 'Gain 2 Strength for the rest of this combat.', text_es: 'Ganas 2 de Fuerza por el resto de este combate.' }),
  Object.freeze({ id: 'purge_flask', name: 'Purge Flask', name_es: 'Frasco Purgador', target: 'none', summary: 'PURGE', text: 'Remove ALL of your debuffs (Vulnerable, Weak, Bleed and Poison). Buffs stay.', text_es: 'Elimina TODOS tus estados negativos (Vulnerable, Débil, Sangrado y Veneno). Los positivos se quedan.' }),
]);

/** id -> definition. The ONE lookup; unknown ids yield undefined (never a throw). */
export const POTION_DEFS = Object.freeze(new Map(POTIONS.map((p) => [p.id, p])));

/** Drop chance per fight tier, in percent of the 100-band. ONE constant table; a tier
 *  with no row means no drop (the boss is short-circuited in act.js before this reads). */
export const DROP_CHANCE = Object.freeze({
  combat_weak: 40,
  combat_strong: 40,
  elite: 60,
});

/** The status keys a Purge Flask clears: the player's DEBUFFS, derived from the ONE
 *  buff/debuff classification in rules/vocabulary.js (STATUS_KINDS) rather than a
 *  second copy of the list beside it — a future status ('frail') is classified THERE
 *  once, and either lands in the purge or deliberately does not (S5 review P3). */
export const POTION_DEBUFFS = DEBUFFS;

/**
 * Effect lists per potion id, in the card-effects shape so the shared verbs receive
 * the params they already understand. Reusable verbs are reused (the design ruling):
 * Ember Draught IS the `damage` verb (Vulnerable amplifies it, block absorbs it),
 * Stone Skin IS the `block` verb (Dexterity boosts it), Bellows Fuel IS the `energy`
 * verb, Whetstone IS the `status` verb applied to self. Two potions need a shape no
 * closed vocabulary verb composes — there is no `heal` verb, and "clear my debuffs"
 * is new — so they use the two potion-only resolvers in POTION_VERBS below rather
 * than widening the card vocabulary (ADR-3's set stays closed for cards).
 */
export const POTION_EFFECTS = Object.freeze({
  ember_draught: Object.freeze([{ verb: 'potion_damage', amount: 20 }]),
  stone_skin: Object.freeze([{ verb: 'block', amount: 12 }]),
  ash_salts: Object.freeze([{ verb: 'potion_heal', percent: 20 }]),
  bellows_fuel: Object.freeze([{ verb: 'energy', amount: 2 }]),
  whetstone: Object.freeze([{ verb: 'status', status: 'strength', amount: 2, to: 'self' }]),
  purge_flask: Object.freeze([{ verb: 'potion_purge' }]),
});

/** The potion-only resolvers, same (state, params) -> {state, events} shape and purity
 *  contract as a vocabulary verb. Kept beside the table they serve; reachable ONLY
 *  through quaffEffects below, never from card content (the `custom` verb cannot name
 *  them, so the card vocabulary stays closed). */
const POTION_VERBS = {
  /** potion_damage — deal `amount` to the aimed enemy: the printed number IS the
   *  number, both sides of damageEnemy still apply (block absorbs, Vulnerable
   *  amplifies), but the hero's statuses do NOT fold in — a potion is not an attack,
   *  so Strength never adds and Weak never multiplies it. This is the StS ruling
   *  (Fire Potion hits for its printed 20 through block and Vulnerable, at full
   *  value under Weak). It is also the honest reading of the potion's own text:
   *  "Deal 20 damage" promises no modifier. Kept here rather than widening the
   *  card vocabulary — ADR-3's set stays closed for cards (see the header). */
  potion_damage(state, params) {
    const idx = state.ctx?.targetEnemyIndex ?? 0;
    const enemies = state.combat.enemies;
    const target = enemies[idx];
    if (!target || target.dead) return { state, events: [] };
    const out = damageEnemy(target, params.amount);
    return {
      state: { ...state, combat: { ...state.combat, enemies: enemies.map((e, i) => (i === idx ? out.enemy : e)) } },
      events: [{ t: 'damage', source: 'potion', target: idx, raw: out.raw, dealt: out.dealt, blocked: out.blocked, hp: out.enemy.hp }],
    };
  },

  /** potion_heal — restore `percent`% of the player's MAX HP, floored to an integer,
   *  capped at the max: the same clamp every other heal reads (`resolveVictory`,
   *  reaper). The source names the potion so the event trail says what healed. */
  potion_heal(state, params) {
    const amount = Math.min(Math.floor((state.player.maxHp * params.percent) / 100), state.player.maxHp - state.player.hp);
    if (amount <= 0) return { state, events: [] };
    return {
      state: { ...state, player: { ...state.player, hp: state.player.hp + amount } },
      events: [{ t: 'heal', who: 'player', amount, source: params.source ?? 'potion' }],
    };
  },

  /** potion_purge — drop every DEBUFF stack from the player, buffs untouched. Mirrors
   *  the status-reset path's shape (a fresh statuses object), scoped to the debuff keys. */
  potion_purge(state, _params) {
    const statuses = { ...(state.player.statuses ?? {}) };
    const cleared = [];
    for (const key of POTION_DEBUFFS) {
      if ((statuses[key] ?? 0) > 0) { cleared.push(key); delete statuses[key]; }
    }
    if (cleared.length === 0) return { state, events: [] };
    return {
      state: { ...state, player: { ...state.player, statuses } },
      events: [{ t: 'status_cleared', who: 'player', statuses: cleared }],
    };
  },
};

/**
 * Resolve one potion's effect list against a combat state. The aimed convention is
 * playCard's own: `targetEnemyIndex` is the 0-based LIVING-enemy position the caller
 * resolved from the action id's 1-based k, and the shared verbs treat it identically.
 * The potion-only `potion_damage` resolver reads the aim through `state.ctx`, so
 * `quaffEffects` plants it on the state copy it hands the verb.
 * @param {any} state
 * @param {string} potionId a KNOWN potion id (every caller guards on potionDef first)
 * @param {number} targetEnemyIndex 0-based living-enemy position (unused by self potions)
 * @returns {{state: any, events: any[]}}
 */
export function quaffEffects(state, potionId, targetEnemyIndex) {
  const ctx = { rng: null, card: null, source: 'potion', target: null, targetEnemyIndex };
  let next = { ...state, ctx: { targetEnemyIndex } };
  const events = [];
  for (const effect of POTION_EFFECTS[potionId] ?? []) {
    const fn = POTION_VERBS[effect.verb];
    const out = fn ? fn(next, effect) : VOCABULARY[effect.verb](next, ctx, effect);
    next = out.state;
    events.push(...out.events);
  }
  return { state: { ...next, ctx: state.ctx ?? null }, events };
}

/**
 * Roll the post-combat potion drop from the live counter.
 *
 * Consumes exactly 2 draws on a hit, 1 on a miss, and 0 when the belt is full (the
 * roll is suppressed — see the header). The belt is read tolerantly (`?? []`): a
 * legacy save without the field reads as an empty belt.
 * @param {any} state a POST-gold, POST-boss-check victory state
 * @param {string} nodeType the fight tier (`combat_weak` | `combat_strong` | `elite`)
 * @returns {{belt: string[], draws: number, potion: string | null}}
 *          `belt` is the new belt (the input plus at most one id, never over capacity);
 *          `potion` is the dropped id or null.
 */
export function rollPotionDrop(state, nodeType) {
  const belt = Array.isArray(state.potions) ? state.potions.slice() : [];
  const chance = DROP_CHANCE[nodeType] ?? 0;
  if (belt.length >= POTION_SLOTS || chance <= 0) {
    return { belt, draws: 0, potion: null };
  }
  if (intAt(state.seed, state.rngDraws, 100) >= chance) {
    return { belt, draws: 1, potion: null };
  }
  const potion = POTIONS[intAt(state.seed, state.rngDraws + 1, POTIONS.length)].id;
  belt.push(potion);
  return { belt, draws: 2, potion };
}

/**
 * A tolerant definition lookup for ids that arrive from persisted state: a stale save
 * after a rename yields undefined, and every caller degrades (raw id as the name) —
 * the defOrNull precedent from the observation layer.
 * @param {string} id
 * @returns {any | undefined}
 */
export function potionDef(id) {
  return POTION_DEFS.get(id);
}
