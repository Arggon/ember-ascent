// Events (S6) — the wayside encounters: seeded stories with 2-3 choices each and
// consequences that compose the effects the game already has (gold through the purse,
// HP through the non-combat loseHp path, cards through the deck-append/remove paths,
// potions through the belt-append path). Meta-level like the shop: no new card verbs,
// the closed vocabulary (ADR-3) is untouched.
//
// Draw accounting — a deliberate decision, part of the format:
//   * WHICH event a node holds rolls at ENTRY time, ONE draw (`intAt` over the roster
//     length), from the live counter — the same convention as the shop's inventory and
//     a rest site's temper offers. Entry happens through exactly one action (the travel
//     that opens the node) and re-entry is impossible, so the counter the roll read is
//     reproducible from the action log forever. Nothing is pre-rolled at map generation,
//     so a run that never visits pays nothing from the stream.
//   * Choice effects that roll consume their draws at RESOLUTION time, inside the
//     choice handler, in the handler's documented order (each choice below states its
//     count). Zero-cost, fixed-number choices consume nothing — the same policy as the
//     shop's flat-priced removal and the belt's quaff/discard: "impossible or fixed"
//     never costs the stream.
//   * The continue step (v0) and the temper modal's pick (t<n>) are choices, not rolls:
//     zero draws.
//
// REQUIREMENTS ARE R6 AFFORD-FILTERS. An unmet requirement means the choice emits NO
// action id — exactly like an unaffordable shelf or an unplayable hand card — while the
// choice stays VISIBLE in the observation with the reason (snapshot `reason`), so a
// renderer can grey it out and say why. Enumeration mirrors the resolver's own guards:
// a choice that is offered always resolves.
//
// Tolerance: an event id the roster no longer knows (a torn save — validateSave never
// checks the event id) degrades everywhere: the dump shows the raw id, no choices are
// offered, and the phase's `v0` continue is still enumerated so the run can never
// softlock inside a story nobody can read. Nothing throws — the S2.1/S4.1/S5 ruling.
//
// Pure: no Date, no Math.random, no I/O; every draw is counted and returned.
import { intAt, pickAt } from '../rng.js';
import { POTION_SLOTS, POTIONS } from './potions.js';
import { offerTempers, TEMPERS } from './tempers.js';
import { loseHp } from './vocabulary.js';

/** The Forge's stoke: HP paid to wake the coals. */
export const FORGE_HP = 8;
/** The ember the Forge sells: a rare card's price. */
export const EMBER_PRICE = 30;
/** The Peddler's bottle: one random potion's price. */
export const POTION_PRICE = 40;
/** The Peddler pays for a card (and the deck floor it protects). */
export const SELL_GAIN = 50;
/** The deck floor the sale must respect: after the removal the deck still holds MORE
 *  than this many cards (spec: "deck > minimum 6 after removal"), so the sell is
 *  offered only from a deck of 8+. */
export const EVENT_DECK_FLOOR = 6;
/** The Shaft pays 60 for a 12-HP climb. */
export const SHAFT_GOLD = 60;
export const SHAFT_HP = 12;
/** The torch: 15 gold spent, 15 HP recovered. */
export const TORCH_PRICE = 15;
export const TORCH_HEAL = 15;
/** The smith's stories heal. */
export const STORIES_HEAL = 8;

/**
 * The roster. Order is the pick order: the entry roll indexes THIS array, so reordering
 * changes which event every seed meets — the order is part of the format, exactly like
 * the potion table's. Every event carries at least one zero-cost, unconditional choice
 * (leave/wave/walk/move), so a fresh event ALWAYS has something legal to do.
 *
 * `effect` is the preview sentence surfaces show on the button; `req` is a REQUIRED
 * guard evaluated per state (null = unconditional). A guard returns null when the
 * choice is offerable, or the REASON string when it is not — the reason is the fact the
 * dimmed button shows.
 */
export const EVENT_ROSTER = Object.freeze([
  Object.freeze({
    id: 'sleeping_forge',
    name: 'The Sleeping Forge',
    story: 'A forge sleeps under a skin of grey ash, but its heart is not cold — something down in the coals still breathes, slow and patient. The warmth reaches for your hands like it remembers being fed.',
    choices: Object.freeze([
      Object.freeze({
        slug: 'stoke', label: 'Stoke it awake', cost: null, hpLoss: FORGE_HP,
        effect: `Lose ${FORGE_HP} HP. Gain a random Uncommon card.`,
        req: (state, defs) => (uncommonPool(state, defs).length > 0 ? null : 'the run\u2019s pool holds no Uncommon card'),
        // Draw: ONE `pickAt` pick of an Uncommon card from the run's narrowed pool.
      }),
      Object.freeze({
        slug: 'leave', label: 'Leave it sleeping', cost: null, hpLoss: null,
        effect: 'Nothing happens.', req: null,
      }),
      Object.freeze({
        slug: 'ember', label: 'Buy the ember', cost: EMBER_PRICE, hpLoss: null,
        effect: `Pay ${EMBER_PRICE} gold. Gain a random Rare card.`,
        req: (state, defs) => {
          if ((state.player.gold ?? 0) < EMBER_PRICE) return `needs ${EMBER_PRICE} gold`;
          if (rarePool(state, defs).length === 0) return 'the run\u2019s pool holds no Rare card';
          return null;
        },
        // Draw: ONE `pickAt` pick of a Rare card from the run's narrowed pool.
      }),
    ]),
  }),
  Object.freeze({
    id: 'ash_peddler',
    name: 'The Ash Peddler',
    story: 'A bent figure wheels a cart of bottles and bones through the cinders, calling prices like blessings. Nothing on the cart carries a label, and the peddler likes it that way.',
    choices: Object.freeze([
      Object.freeze({
        slug: 'potion', label: 'Buy a bottle', cost: POTION_PRICE, hpLoss: null,
        effect: `Pay ${POTION_PRICE} gold. Gain a random potion.`,
        req: (state) => {
          if ((state.player.gold ?? 0) < POTION_PRICE) return `needs ${POTION_PRICE} gold`;
          if ((Array.isArray(state.potions) ? state.potions : []).length >= POTION_SLOTS) return 'your belt is full';
          return null;
        },
        // Draw: ONE `intAt` over the potion table (the drop's own convention).
      }),
      Object.freeze({
        slug: 'sell', label: 'Sell a card', cost: null, hpLoss: null,
        effect: `Remove one random Common or Uncommon card from your deck. Gain ${SELL_GAIN} gold.`,
        req: (state, defs) => {
          if (sellTargets(state, defs).length === 0) return 'your deck holds no Common or Uncommon card';
          if (((state.deck ?? []).length - 1) <= EVENT_DECK_FLOOR) return `your deck must stay above ${EVENT_DECK_FLOOR} cards`;
          return null;
        },
        // Draw: ONE `pickAt` pick of the deck instance that leaves (shown in the result).
      }),
      Object.freeze({
        slug: 'wave', label: 'Wave them on', cost: null, hpLoss: null,
        effect: 'Nothing happens.', req: null,
      }),
    ]),
  }),
  Object.freeze({
    id: 'collapsed_shaft',
    name: 'The Collapsed Shaft',
    story: 'A shaft drops into the dark beside the track, its ladder burned to a stub. Far below, something glints — coin-bright, or only the eyes of the dark looking back.',
    choices: Object.freeze([
      Object.freeze({
        slug: 'climb', label: 'Climb down', cost: null, hpLoss: SHAFT_HP,
        effect: `Gain ${SHAFT_GOLD} gold. Lose ${SHAFT_HP} HP.`, req: null,
      }),
      Object.freeze({
        slug: 'torch', label: 'Drop a torch', cost: TORCH_PRICE, hpLoss: null,
        effect: `Pay ${TORCH_PRICE} gold. Recover ${TORCH_HEAL} HP.`,
        // The torch comes out of your own pack and the pack is priced: a spend the
        // purse cannot cover is not an action (the shop's own ruling), so the torch
        // guards on gold like every other price.
        req: (state) => ((state.player.gold ?? 0) < TORCH_PRICE ? `needs ${TORCH_PRICE} gold` : null),
      }),
      Object.freeze({
        slug: 'walk', label: 'Walk past', cost: null, hpLoss: null,
        effect: 'Nothing happens.', req: null,
      }),
    ]),
  }),
  Object.freeze({
    id: 'wandering_smith',
    name: 'The Wandering Smith',
    story: 'An anvil walks on legs of knotted iron, and the smith under its shadow offers a hammer and a bench. Every traveller pays in a different coin; today the price is a moment of your climb.',
    choices: Object.freeze([
      Object.freeze({
        slug: 'temper', label: 'Temper a card', cost: null, hpLoss: null,
        effect: 'Pick one of three cards and temper it, exactly as at a rest site\u2019s forge.',
        // The rest site's own gating, mirrored: the run must carry tempers (opt-in),
        // and the offer builder must find at least one untempered, known card — an
        // empty modal would be a softlock, so the choice is never offered into one.
        req: (state, defs) => {
          if (!state.tempers) return 'this run carries no tempers';
          return offerTempers(state, defs).offers.length > 0 ? null : 'every card in your deck is already tempered';
        },
        // Draw: the offer roll itself — `offerTempers` consumes 3 `pickAt` picks plus
        // one fit roll per offer (6 for a full three-card offer, fewer on a thin deck).
      }),
      Object.freeze({
        slug: 'stories', label: 'Ask for stories', cost: null, hpLoss: null,
        effect: `Recover ${STORIES_HEAL} HP.`, req: null,
      }),
      Object.freeze({
        slug: 'move', label: 'Move on', cost: null, hpLoss: null,
        effect: 'Nothing happens.', req: null,
      }),
    ]),
  }),
]);

/** id -> definition. The ONE lookup; unknown ids yield undefined (never a throw). */
const EVENT_DEFS = new Map(EVENT_ROSTER.map((e) => [e.id, e]));

/** @param {string} id @returns {any | undefined} */
export function eventDef(id) {
  return EVENT_DEFS.get(id);
}

/** The run's narrowed draft pool filtered to one rarity, ids the content still knows. */
function poolOfRarity(state, defs, rarity) {
  return (Array.isArray(state.draftPool) ? state.draftPool : []).filter((id) => defs.get(id)?.rarity === rarity);
}
const uncommonPool = (state, defs) => poolOfRarity(state, defs, 'uncommon');
const rarePool = (state, defs) => poolOfRarity(state, defs, 'rare');

/** Deck instances whose card the content knows AND prices as Common or Uncommon — the
 *  Peddler's buy list. Rare cards are beneath their interest; unknown ids are not
 *  sellable (the removal would strand a card the game cannot name). */
function sellTargets(state, defs) {
  return (state.deck ?? []).filter((inst) => ['common', 'uncommon'].includes(defs.get(inst.cardId)?.rarity));
}

/**
 * Evaluate every choice of the state's event: the ONE offer table both actions() and
 * the snapshot read, so the id list and the visible list cannot drift.
 * @param {any} state
 * @param {Map<string, any>} defs card definitions (injected; rules never import content)
 * @returns {Array<{index: number, slug: string, label: string, effect: string, cost: number | null, hpLoss: number | null, offered: boolean, reason: string | null}>}
 */
export function offerEventChoices(state, defs) {
  const def = eventDef(state.event?.id);
  if (!def) return [];
  // actions.js may call before kernel init (its cardDefs() defensive null); the
  // guards and offer builder read the map, so an empty one degrades to "nothing
  // offerable" instead of throwing.
  const D = defs ?? new Map();
  return def.choices.map((choice, index) => {
    const reason = choice.req ? choice.req(state, D) : null;
    return {
      index,
      slug: choice.slug,
      label: choice.label,
      effect: choice.effect,
      cost: choice.cost,
      hpLoss: choice.hpLoss,
      offered: reason === null,
      reason,
    };
  });
}

/**
 * The entry roll: which event this node holds. Exactly ONE draw, whatever the roster's
 * length — reproducible from the action log forever (see the header).
 * @param {any} state
 * @returns {{id: string, draws: number}}
 */
export function rollEventAt(state) {
  const id = EVENT_ROSTER[intAt(state.seed, state.rngDraws, EVENT_ROSTER.length)].id;
  return { id, draws: 1 };
}

/**
 * Pick one card of `rarity` from the run's own narrowed draft pool (the S2 codex
 * lesson: never from the full content). ONE draw; an empty pool would grant nothing,
 * which is why the guards above keep every rolling choice out of that corner.
 * @param {any} state
 * @param {Map<string, any>} defs
 * @param {string} rarity
 * @returns {{cardId: string | null, draws: number}}
 */
function rollCardOfRarity(state, defs, rarity) {
  const pick = pickAt(state.seed, state.rngDraws, poolOfRarity(state, defs, rarity), 1);
  return { cardId: pick.picked[0] ?? null, draws: pick.draws };
}

/**
 * Resolve one offered event choice. The id was matched against the legal list by step()
 * before this runs, so the choice exists, is offered, and its guards hold — the
 * defensive no-op returns below are unreachable through legal ids, the same shape
 * every handler in rules/steps.js keeps.
 *
 * Order of operations is part of the format: spend/earn gold first, then HP, then the
 * deck or belt change — one effect per event-t row, in the order the result lines read.
 * @param {any} state
 * @param {{index: number, slug: string, eventId: string}} match
 * @param {Map<string, any>} defs card definitions
 * @returns {{state: any, events: any[]}}
 */
export function resolveChoice(state, match, defs) {
  const def = eventDef(state.event?.id);
  if (!def) return { state, events: [] };
  const choice = def.choices[match.index];
  if (!choice || choice.slug !== match.slug) return { state, events: [] };
  // The guards held at enumeration time; a stale resolve degrades rather than half-applies.
  if (choice.req && choice.req(state, defs)) return { state, events: [] };

  // The smith's temper is the one choice that does not resolve into the beat: it opens
  // the modal sub-step (rules/events.js openTemper), whose pick resolves separately.
  if (def.id === 'wandering_smith' && choice.slug === 'temper') return openTemper(state, defs);

  const ev = state.event;
  const lines = [];
  const events = [];
  let next = state;
  let draws = 0;

  // 1. GOLD — spend or earn, through the purse. Spends floor like the shop's own
  //    deduction (validateSave keeps player.gold optional, so the read is `?? 0`).
  if (choice.cost !== null) {
    next = { ...next, player: { ...next.player, gold: (next.player.gold ?? 0) - choice.cost } };
    events.push({ t: 'gold_spent', amount: choice.cost, what: `${def.id}:${choice.slug}` });
    lines.push(`- You paid ${choice.cost} gold.`);
  }

  // 2. HP — losses through the non-combat loseHp path (vocabulary.js): block ignored,
  //    never below 1 HP, the same path self-damage cards and temper costs take. A loss
  //    cannot kill, so the event phase has no ended transition of its own. Heals clamp
  //    to max HP like a rest site's.
  if (choice.hpLoss !== null) {
    const before = next.player.hp;
    next = { ...next, player: loseHp(next.player, choice.hpLoss) };
    const paid = before - next.player.hp;
    events.push({ t: 'hp_cost', amount: paid, source: 'event' });
    lines.push(`- The ${def.name.split(' ').slice(-1)[0].toLowerCase()} took its due: ${paid} HP.`);
  }

  // 3. The choice's own consequence, each through the path its shop/reward/rest
  //    counterpart uses. Every roll happens HERE, at resolution, in this order.
  if (def.id === 'sleeping_forge' && choice.slug === 'stoke') {
    const roll = rollCardOfRarity(next, defs, 'uncommon');
    draws += roll.draws;
    if (roll.cardId) {
      const uid = `c${next.deck.length}_${next.stepIndex}`;
      next = { ...next, deck: [...next.deck, { uid, cardId: roll.cardId }] };
      events.push({ t: 'card_taken', cardId: roll.cardId, uid });
      lines.push(`- The coals give up a card: ${defs.get(roll.cardId)?.name ?? roll.cardId} joins your deck.`);
    }
  } else if (def.id === 'sleeping_forge' && choice.slug === 'ember') {
    const roll = rollCardOfRarity(next, defs, 'rare');
    draws += roll.draws;
    if (roll.cardId) {
      const uid = `c${next.deck.length}_${next.stepIndex}`;
      next = { ...next, deck: [...next.deck, { uid, cardId: roll.cardId }] };
      events.push({ t: 'card_bought', cardId: roll.cardId, uid, price: choice.cost });
      lines.push(`- The ember cools into ${defs.get(roll.cardId)?.name ?? roll.cardId}, and the card is yours.`);
    }
  } else if (def.id === 'ash_peddler' && choice.slug === 'potion') {
    const potionId = POTIONS[intAt(next.seed, next.rngDraws, POTIONS.length)].id;
    draws += 1;
    const belt = (Array.isArray(next.potions) ? next.potions : []).slice();
    belt.push(potionId);
    next = { ...next, potions: belt };
    events.push({ t: 'potion_drop', potion: potionId, beltSize: belt.length, source: 'event' });
    lines.push('- The peddler presses a bottle into your hands. No label, as promised.');
  } else if (def.id === 'ash_peddler' && choice.slug === 'sell') {
    const pick = pickAt(next.seed, next.rngDraws, sellTargets(next, defs), 1);
    draws += pick.draws;
    const inst = pick.picked[0];
    if (inst) {
      // Gold first, then the removal — the effect order this function's header states.
      next = { ...next, player: { ...next.player, gold: (next.player.gold ?? 0) + SELL_GAIN } };
      events.push({ t: 'gold', who: 'player', amount: SELL_GAIN, source: 'event' });
      next = { ...next, deck: next.deck.filter((c) => c.uid !== inst.uid) };
      events.push({ t: 'card_removed', uid: inst.uid, cardId: inst.cardId });
      lines.push(`- ${defs.get(inst.cardId)?.name ?? inst.cardId} leaves your deck. The peddler counts out ${SELL_GAIN} gold.`);
    }
  } else if (def.id === 'collapsed_shaft' && choice.slug === 'climb') {
    next = { ...next, player: { ...next.player, gold: (next.player.gold ?? 0) + SHAFT_GOLD } };
    events.push({ t: 'gold', who: 'player', amount: SHAFT_GOLD, source: 'event' });
    lines.push(`- The glint was coin after all: ${SHAFT_GOLD} gold, heavy and real.`);
  } else if (def.id === 'collapsed_shaft' && choice.slug === 'torch') {
    const healed = Math.min(TORCH_HEAL, next.player.maxHp - next.player.hp);
    if (healed > 0) {
      next = { ...next, player: { ...next.player, hp: next.player.hp + healed } };
      events.push({ t: 'heal', who: 'player', amount: healed, source: 'event' });
    }
    // The beat says what HAPPENED: the heal phrase is gated exactly like the event it
    // describes (S6.1 review P3 — a full-health torch printed "+0 HP" beside a
    // suppressed heal event). The accounting above is untouched.
    lines.push(healed > 0
      ? `- The light falls and falls. In its glow you bind your scrapes and breathe (+${healed} HP).`
      : '- The light falls and falls. You are already whole — the glow finds nothing to mend.');
  } else if (def.id === 'wandering_smith' && choice.slug === 'stories') {
    const healed = Math.min(STORIES_HEAL, next.player.maxHp - next.player.hp);
    if (healed > 0) {
      next = { ...next, player: { ...next.player, hp: next.player.hp + healed } };
      events.push({ t: 'heal', who: 'player', amount: healed, source: 'event' });
    }
    lines.push(healed > 0
      ? `- The smith talks of old fires and older mistakes. You stand easier (+${healed} HP).`
      : '- The smith talks of old fires and older mistakes. You are already whole, and he nods like he knew.');
  } else {
    lines.push('- Nothing happens.');
  }

  // The resolved beat: the phase STAYS `event`, the concrete results travel in state
  // (a surface renders them from the snapshot, not from the event stream), and the
  // only action left is the continue.
  return {
    state: {
      ...next,
      rngDraws: next.rngDraws + draws,
      event: { ...ev, resolved: { choice: match.index, lines } },
    },
    events,
  };
}

/**
 * Open the smith's temper modal: roll the rest site's own offer ONCE, right now, and
 * park it in the event state. The choice is committed (no back-out) — the S4 removal
 * modal's precedent; the offer list was guarded non-empty, so the modal always has a
 * pick and can never softlock.
 * @param {any} state
 * @param {Map<string, any>} defs
 * @returns {{state: any, events: any[]}}
 */
export function openTemper(state, defs) {
  const ev = state.event;
  if (!ev || !state.tempers) return { state, events: [] };
  const offer = offerTempers(state, defs);
  if (offer.offers.length === 0) return { state, events: [] };
  return {
    state: {
      ...state,
      rngDraws: state.rngDraws + offer.draws,
      event: { ...ev, tempering: true, offers: offer.offers },
    },
    events: [{ t: 'event_temper_open', event: ev.id }],
  };
}

/**
 * Is this modal offer one the resolver will actually accept? The ONE validity guard:
 * actions.js enumerates a `t<n>` only for offers that pass it, and resolveTemper
 * re-checks it — the same enumeration-mirrors-guard ruling the S4.1 torn shop and the
 * S5 torn belt made (a refused id is never offered; an offered id always resolves).
 * A torn offer (garbage shape, an unknown temper id, or a run without tempers) therefore
 * degrades to a shorter modal, never to a legal no-op.
 * @param {any} offer
 * @param {any} state
 * @returns {boolean}
 */
export function temperOfferOpen(offer, state) {
  return Boolean(state?.tempers && offer && typeof offer === 'object'
    && typeof offer.uid === 'string' && offer.cardId && offer.temper && TEMPERS[offer.temper]);
}

/**
 * The modal's pick: exactly the rest site's temper, scoped to the event — the temper
 * lands on the deck instance by uid, the modal closes, and the resolved beat shows
 * what was struck. Zero draws (a choice, not a roll).
 * @param {any} state
 * @param {{index: number}} match
 * @returns {{state: any, events: any[]}}
 */
export function resolveTemper(state, match) {
  const ev = state.event;
  const offer = (Array.isArray(ev?.offers) ? ev.offers : [])[match.index];
  // The offer passed temperOfferOpen when it was enumerated; a stale resolve
  // degrades rather than half-applies (and can never be reached through legal ids).
  if (!temperOfferOpen(offer, state)) return { state, events: [] };
  const line = `- The smith takes ${offer.cardId} to the anvil. It comes back changed.`;
  return {
    state: {
      ...state,
      tempers: { ...state.tempers, [offer.uid]: offer.temper },
      event: { ...ev, tempering: false, offers: null, resolved: { choice: null, lines: [line] } },
    },
    events: [{ t: 'card_tempered', uid: offer.uid, cardId: offer.cardId, temper: offer.temper }],
  };
}

/**
 * Leave the event — the resolved beat's continue, or the torn-state escape hatch.
 * Final, like leaving the shop: the node is consumed (every node sits in one row and
 * travel always moves on), the phase closes, the event state nulls.
 * @param {any} state
 * @returns {{state: any, events: any[]}}
 */
export function continueEvent(state) {
  const id = state.event?.id ?? null;
  return { state: { ...state, phase: 'map', event: null }, events: [{ t: 'event_left', event: id }] };
}
