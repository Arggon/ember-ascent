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
 * A bilingual requirement reason: `{en, es}`. The compact dump (observe.js eventBody)
 * renders the ENGLISH string — the agent-facing contract — and snapshot({lang:'es'})
 * renders the Spanish one. Truthiness is unchanged everywhere a guard is checked
 * (resolveChoice), so a pair is a drop-in for the old plain string.
 * @param {string} en
 * @param {string} es
 * @returns {{en: string, es: string}}
 */
const R = (en, es) => Object.freeze({ en, es });

/**
 * The roster. Order is the pick order: the entry roll indexes THIS array, so reordering
 * changes which event every seed meets — the order is part of the format, exactly like
 * the potion table's. Every event carries at least one zero-cost, unconditional choice
 * (leave/wave/walk/move), so a fresh event ALWAYS has something legal to do.
 *
 * `effect` is the preview sentence surfaces show on the button; `req` is a REQUIRED
 * guard evaluated per state (null = unconditional). A guard returns null when the
 * choice is offerable, or the REASON when it is not — the reason is the fact the
 * dimmed button shows (a bilingual `{en, es}` pair, see R above).
 *
 * I18N-1: `name_es`/`story_es` and per-choice `label_es`/`effect_es` are the Spanish
 * twins, read by offerEventChoices(..., 'es') through the snapshot's language; every
 * English field is the honest fallback when a twin is absent.
 */
export const EVENT_ROSTER = Object.freeze([
  Object.freeze({
    id: 'sleeping_forge',
    name: 'The Sleeping Forge',
    name_es: 'La Forja Dormida',
    story: 'A forge sleeps under a skin of grey ash, but its heart is not cold — something down in the coals still breathes, slow and patient. The warmth reaches for your hands like it remembers being fed.',
    story_es: 'Una forja duerme bajo una piel de ceniza gris, pero su corazón no está frío: algo, allá abajo entre los carbones, todavía respira, lento y paciente. El calor te busca las manos como si recordara haber sido alimentado.',
    choices: Object.freeze([
      Object.freeze({
        slug: 'stoke', label: 'Stoke it awake', label_es: 'Avívala', cost: null, hpLoss: FORGE_HP,
        effect: `Lose ${FORGE_HP} HP. Gain a random Uncommon card.`,
        effect_es: `Pierdes ${FORGE_HP} HP. Ganas una carta Infrecuente al azar.`,
        req: (state, defs) => (uncommonPool(state, defs).length > 0 ? null : R('the run\u2019s pool holds no Uncommon card', 'la reserva de esta partida no tiene cartas Infrecuentes')),
        // Draw: ONE `pickAt` pick of an Uncommon card from the run's narrowed pool.
      }),
      Object.freeze({
        slug: 'leave', label: 'Leave it sleeping', label_es: 'Déjala dormir', cost: null, hpLoss: null,
        effect: 'Nothing happens.', effect_es: 'No pasa nada.', req: null,
      }),
      Object.freeze({
        slug: 'ember', label: 'Buy the ember', label_es: 'Compra el ascua', cost: EMBER_PRICE, hpLoss: null,
        effect: `Pay ${EMBER_PRICE} gold. Gain a random Rare card.`,
        effect_es: `Pagas ${EMBER_PRICE} de oro. Ganas una carta Rara al azar.`,
        req: (state, defs) => {
          if ((state.player.gold ?? 0) < EMBER_PRICE) return R(`needs ${EMBER_PRICE} gold`, `necesitas ${EMBER_PRICE} de oro`);
          if (rarePool(state, defs).length === 0) return R('the run\u2019s pool holds no Rare card', 'la reserva de esta partida no tiene cartas Raras');
          return null;
        },
        // Draw: ONE `pickAt` pick of a Rare card from the run's narrowed pool.
      }),
    ]),
  }),
  Object.freeze({
    id: 'ash_peddler',
    name: 'The Ash Peddler',
    name_es: 'El Vendedor de Ceniza',
    story: 'A bent figure wheels a cart of bottles and bones through the cinders, calling prices like blessings. Nothing on the cart carries a label, and the peddler likes it that way.',
    story_es: 'Una figura encorvada empuja un carrito de botellas y huesos entre las ascuas, pregonando precios como bendiciones. Nada en el carrito lleva etiqueta, y al vendedor le gusta que sea así.',
    choices: Object.freeze([
      Object.freeze({
        slug: 'potion', label: 'Buy a bottle', label_es: 'Compra una botella', cost: POTION_PRICE, hpLoss: null,
        effect: `Pay ${POTION_PRICE} gold. Gain a random potion.`,
        effect_es: `Pagas ${POTION_PRICE} de oro. Ganas una poción al azar.`,
        req: (state) => {
          if ((state.player.gold ?? 0) < POTION_PRICE) return R(`needs ${POTION_PRICE} gold`, `necesitas ${POTION_PRICE} de oro`);
          if ((Array.isArray(state.potions) ? state.potions : []).length >= POTION_SLOTS) return R('your belt is full', 'tu cinturón está lleno');
          return null;
        },
        // Draw: ONE `intAt` over the potion table (the drop's own convention).
      }),
      Object.freeze({
        slug: 'sell', label: 'Sell a card', label_es: 'Vende una carta', cost: null, hpLoss: null,
        effect: `Remove one random Common or Uncommon card from your deck. Gain ${SELL_GAIN} gold.`,
        effect_es: `Quita una carta Común o Infrecuente al azar de tu mazo. Ganas ${SELL_GAIN} de oro.`,
        req: (state, defs) => {
          if (sellTargets(state, defs).length === 0) return R('your deck holds no Common or Uncommon card', 'tu mazo no tiene cartas Comunes ni Infrecuentes');
          if (((state.deck ?? []).length - 1) <= EVENT_DECK_FLOOR) return R(`your deck must stay above ${EVENT_DECK_FLOOR} cards`, `tu mazo debe quedarse con más de ${EVENT_DECK_FLOOR} cartas`);
          return null;
        },
        // Draw: ONE `pickAt` pick of the deck instance that leaves (shown in the result).
      }),
      Object.freeze({
        slug: 'wave', label: 'Wave them on', label_es: 'Despídete y sigue', cost: null, hpLoss: null,
        effect: 'Nothing happens.', effect_es: 'No pasa nada.', req: null,
      }),
    ]),
  }),
  Object.freeze({
    id: 'collapsed_shaft',
    name: 'The Collapsed Shaft',
    name_es: 'El Pozo Derrumbado',
    story: 'A shaft drops into the dark beside the track, its ladder burned to a stub. Far below, something glints — coin-bright, or only the eyes of the dark looking back.',
    story_es: 'Un pozo cae hacia la oscuridad junto al sendero; su escalera quedó reducida a un muñón quemado. Muy abajo brilla algo: brillante como una moneda, o solo los ojos de la oscuridad que te devuelven la mirada.',
    choices: Object.freeze([
      Object.freeze({
        slug: 'climb', label: 'Climb down', label_es: 'Baja al pozo', cost: null, hpLoss: SHAFT_HP,
        effect: `Gain ${SHAFT_GOLD} gold. Lose ${SHAFT_HP} HP.`,
        effect_es: `Ganas ${SHAFT_GOLD} de oro. Pierdes ${SHAFT_HP} HP.`, req: null,
      }),
      Object.freeze({
        slug: 'torch', label: 'Drop a torch', label_es: 'Deja caer una antorcha', cost: TORCH_PRICE, hpLoss: null,
        effect: `Pay ${TORCH_PRICE} gold. Recover ${TORCH_HEAL} HP.`,
        effect_es: `Pagas ${TORCH_PRICE} de oro. Recuperas ${TORCH_HEAL} HP.`,
        // The torch comes out of your own pack and the pack is priced: a spend the
        // purse cannot cover is not an action (the shop's own ruling), so the torch
        // guards on gold like every other price.
        req: (state) => ((state.player.gold ?? 0) < TORCH_PRICE ? R(`needs ${TORCH_PRICE} gold`, `necesitas ${TORCH_PRICE} de oro`) : null),
      }),
      Object.freeze({
        slug: 'walk', label: 'Walk past', label_es: 'Sigue de largo', cost: null, hpLoss: null,
        effect: 'Nothing happens.', effect_es: 'No pasa nada.', req: null,
      }),
    ]),
  }),
  Object.freeze({
    id: 'wandering_smith',
    name: 'The Wandering Smith',
    name_es: 'El Herrero Errante',
    story: 'An anvil walks on legs of knotted iron, and the smith under its shadow offers a hammer and a bench. Every traveller pays in a different coin; today the price is a moment of your climb.',
    story_es: 'Un yunque camina sobre patas de hierro anudado, y el herrero a su sombra ofrece un martillo y un banco. Cada viajero paga con una moneda distinta; hoy el precio es un momento de tu ascenso.',
    choices: Object.freeze([
      Object.freeze({
        slug: 'temper', label: 'Temper a card', label_es: 'Templa una carta', cost: null, hpLoss: null,
        effect: 'Pick one of three cards and temper it, exactly as at a rest site\u2019s forge.',
        effect_es: 'Elige una de tres cartas y témplala, igual que en la forja de un sitio de descanso.',
        // The rest site's own gating, mirrored: the run must carry tempers (opt-in),
        // and the offer builder must find at least one untempered, known card — an
        // empty modal would be a softlock, so the choice is never offered into one.
        req: (state, defs) => {
          if (!state.tempers) return R('this run carries no tempers', 'esta partida no lleva temple');
          return offerTempers(state, defs).offers.length > 0
            ? null
            : R('every card in your deck is already tempered', 'todas las cartas de tu mazo ya están templadas');
        },
        // Draw: the offer roll itself — `offerTempers` consumes 3 `pickAt` picks plus
        // one fit roll per offer (6 for a full three-card offer, fewer on a thin deck).
      }),
      Object.freeze({
        slug: 'stories', label: 'Ask for stories', label_es: 'Pide historias', cost: null, hpLoss: null,
        effect: `Recover ${STORIES_HEAL} HP.`,
        effect_es: `Recuperas ${STORIES_HEAL} HP.`, req: null,
      }),
      Object.freeze({
        slug: 'move', label: 'Move on', label_es: 'Sigue adelante', cost: null, hpLoss: null,
        effect: 'Nothing happens.', effect_es: 'No pasa nada.', req: null,
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

/* ----------------------------------------------------------------- resolved beats
 *
 * I18N-2 — THE FORMAT DECISION (the slice's flagged risk, argued):
 *
 * The resolved beat used to be baked ENGLISH SENTENCES into state
 * (`state.event.resolved.lines`), which made the beat the one player-facing string the
 * snapshot could not localize — and a beat that names a card could never name it in
 * Spanish, because the sentence pre-dates the language choice. So the lines are now
 * STRUCTURED SLUGS + PARAMS: `{ slug: 'pay_gold', n: 30 }`, one row per result, and the
 * wording lives in the BEATS table below — one English column (the agent-facing compact
 * dump renders it byte-identically to the old baked sentences) and one Spanish column
 * the snapshot({lang:'es'}) renders, with card names resolved through the content's
 * own `_es` twins at render time.
 *
 * WHY SLUGS AND NOT A LOOKUP KEYED BY THE ENGLISH SENTENCE (the zero-migration
 * alternative): a sentence-keyed table silently reverts a beat to English the first
 * time anyone copy-edits the English wording — exactly the class of silent drift this
 * codebase refuses (a typo must fail a test, not ship as a fallback). Slug keys are
 * stable identifiers; the wording can move in either column without re-keying.
 *
 * THE COST, HANDLED HONESTLY: this is a save-shape change, so a state that stands at a
 * resolved event hashes differently than before — the golden logs are regenerated
 * beside this change (their per-step hashes move only at event-resolution steps), and
 * LEGACY SAVES whose beat still carries the old English sentence strings keep loading
 * and render those strings VERBATIM in either language (renderEventLines below passes
 * plain strings through untouched). An old save reads its beats in English even in a
 * Spanish session — documented in docs/guides/PLAYING.md, the same honesty as every
 * other torn-format degrade, never a throw and never a guess.
 */

/**
 * One bilingual beat sentence per slug. `en` renders the compact dump's line (byte-
 * identical to the pre-I18N-2 baked sentence); `es` renders the Spanish one. Params:
 * `n` = a number; `cardId` = a card id, resolved to the card's display NAME at render
 * time (English name in the en column, `name_es` twin in the es one — the temper beat
 * keeps its historical raw-id form in English, the agent-facing contract, and names
 * the card properly in Spanish); `who` = the taking thing's short word, en/es mapped
 * in BEAT_WHO below.
 */
const BEATS = {
  pay_gold: {
    en: (p) => `- You paid ${p.n} gold.`,
    es: (p) => `- Pagas ${p.n} de oro.`,
  },
  toll: {
    en: (p) => `- The ${p.who.en} took its due: ${p.n} HP.`,
    es: (p) => `- ${p.who.es} se cobró lo suyo: ${p.n} HP.`,
  },
  card_joined: {
    en: (p, name) => `- The coals give up a card: ${name} joins your deck.`,
    es: (p, name) => `- Las ascuas entregan una carta: ${name} se une a tu mazo.`,
  },
  card_bought: {
    en: (p, name) => `- The ember cools into ${name}, and the card is yours.`,
    es: (p, name) => `- El ascua se enfría en ${name}, y la carta es tuya.`,
  },
  potion_gift: {
    en: () => '- The peddler presses a bottle into your hands. No label, as promised.',
    es: () => '- El vendedor te mete una botella en las manos. Sin etiqueta, como prometió.',
  },
  card_sold: {
    en: (p, name) => `- ${name} leaves your deck. The peddler counts out ${p.n} gold.`,
    es: (p, name) => `- ${name} sale de tu mazo. El vendedor cuenta ${p.n} de oro.`,
  },
  shaft_gold: {
    en: (p) => `- The glint was coin after all: ${p.n} gold, heavy and real.`,
    es: (p) => `- El brillo era moneda al fin: ${p.n} de oro, pesado y real.`,
  },
  torch_heal: {
    en: (p) => `- The light falls and falls. In its glow you bind your scrapes and breathe (+${p.n} HP).`,
    es: (p) => `- La luz cae y cae. Bajo su resplandor vendas tus rasguños y respiras (+${p.n} HP).`,
  },
  torch_whole: {
    en: () => '- The light falls and falls. You are already whole — the glow finds nothing to mend.',
    es: () => '- La luz cae y cae. Ya no tienes heridas: el resplandor no encuentra nada que remendar.',
  },
  stories_heal: {
    en: (p) => `- The smith talks of old fires and older mistakes. You stand easier (+${p.n} HP).`,
    es: (p) => `- El herrero habla de fuegos viejos y de errores más viejos. Recuperas el aliento (+${p.n} HP).`,
  },
  stories_whole: {
    en: () => '- The smith talks of old fires and older mistakes. You are already whole, and he nods like he knew.',
    es: () => '- El herrero habla de fuegos viejos y de errores más viejos. Ya no tienes heridas, y él asiente como si lo supiera.',
  },
  temper_done: {
    en: (p) => `- The smith takes ${p.cardId} to the anvil. It comes back changed.`,
    es: (p, name) => `- El herrero lleva ${name} al yunque. Vuelve cambiada.`,
  },
  nothing: {
    en: () => '- Nothing happens.',
    es: () => '- No pasa nada.',
  },
};

/** The slug table, exported for the sweep's own test: the table IS the format contract
 *  (every slug carries BOTH columns, and the en column is pinned to the legacy baked
 *  sentences it replaced). Not for surfaces — render through renderEventLine(s). */
export const BEATS_TABLE = BEATS;

/** The toll beat's actor word, per event shape: the English word the old baked sentence
 *  derived (`def.name.split(' ').slice(-1)[0].toLowerCase()`) beside its Spanish twin. */
const BEAT_WHO = {
  forge: { en: 'forge', es: 'La forja' },
  shaft: { en: 'shaft', es: 'El pozo' },
};

/**
 * Render one stored resolved-beat line for the requested language.
 *
 * A PLAIN STRING renders verbatim — a legacy save's baked English sentence (or any
 * string a torn save carries) is shown as-is, in either language: the honest degrade,
 * never a throw. An object with a known slug renders the table's sentence for `lang`,
 * resolving `cardId` to the content's display name for that language (the raw id when
 * the content no longer knows it). An unknown slug degrades to the slug itself, the
 * same raw-token honesty as an unknown potion or relic id.
 * @param {any} line a stored line: a legacy string, or `{slug, ...params}`
 * @param {string} lang 'en' (default) or 'es'
 * @param {Map<string, any>} [defs] card definitions, for the card-name beats
 * @returns {string} the sentence to show (no leading/trailing whitespace)
 */
export function renderEventLine(line, lang = 'en', defs = null) {
  if (typeof line === 'string') return line;
  if (!line || typeof line !== 'object' || typeof line.slug !== 'string') {
    return typeof line === 'number' || typeof line === 'boolean' ? String(line) : '?';
  }
  const beat = BEATS[line.slug];
  if (!beat) return line.slug;
  const es = lang === 'es';
  const fn = es ? (beat.es ?? beat.en) : beat.en;
  const name = typeof line.cardId === 'string'
    ? (defs?.get(line.cardId)?.[es ? 'name_es' : 'name'] ?? line.cardId)
    : '';
  return fn(line, name);
}

/**
 * Render a whole stored beat array, lines in order. Legacy string lines pass through.
 * @param {any} lines the stored `resolved.lines` (array of strings or beat objects)
 * @param {string} [lang]
 * @param {Map<string, any>} [defs]
 * @returns {string[]}
 */
export function renderEventLines(lines, lang = 'en', defs = null) {
  if (!Array.isArray(lines)) return [];
  return lines.map((l) => renderEventLine(l, lang, defs));
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
 *
 * I18N-1: `lang` (default 'en') picks the choice's label/effect/reason words. The
 * compact dump calls with the default and gets the English strings byte-identically;
 * snapshot({lang:'es'}) gets the Spanish twins, with the English field as the honest
 * fallback whenever a `_es` twin is absent. The guard VALUES are unchanged: a reason
 * is null exactly when the choice is offerable, whatever the language.
 * @param {any} state
 * @param {Map<string, any>} defs card definitions (injected; rules never import content)
 * @param {string} [lang]
 * @returns {Array<{index: number, slug: string, label: string, effect: string, cost: number | null, hpLoss: number | null, offered: boolean, reason: string | null}>}
 */
export function offerEventChoices(state, defs, lang = 'en') {
  const def = eventDef(state.event?.id);
  if (!def) return [];
  // actions.js may call before kernel init (its cardDefs() defensive null); the
  // guards and offer builder read the map, so an empty one degrades to "nothing
  // offerable" instead of throwing.
  const D = defs ?? new Map();
  return def.choices.map((choice, index) => {
    const req = choice.req ? choice.req(state, D) : null;
    // The guard's shape: null = offerable, otherwise the reason pair (or a plain
    // string from an older table shape). The TEXT is resolved here, once, so both
    // surfaces read the same resolved string.
    const reason = req === null ? null
      : (typeof req === 'string' ? req : (lang === 'es' ? (req.es ?? req.en) : req.en));
    return {
      index,
      slug: choice.slug,
      label: lang === 'es' ? (choice.label_es ?? choice.label) : choice.label,
      effect: lang === 'es' ? (choice.effect_es ?? choice.effect) : choice.effect,
      cost: choice.cost,
      hpLoss: choice.hpLoss,
      offered: req === null,
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
    lines.push({ slug: 'pay_gold', n: choice.cost });
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
    // The toll's actor word: the OLD baked sentence derived it from the event name's
    // last word ("The Sleeping Forge" -> "forge"); the structured beat carries the same
    // word beside its Spanish twin (BEAT_WHO). An unknown event shape degrades to its
    // own id as the word, in both languages.
    const whoKey = def.name.split(' ').slice(-1)[0].toLowerCase();
    const who = BEAT_WHO[whoKey] ?? { en: whoKey, es: whoKey };
    lines.push({ slug: 'toll', who, n: paid });
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
      lines.push({ slug: 'card_joined', cardId: roll.cardId });
    }
  } else if (def.id === 'sleeping_forge' && choice.slug === 'ember') {
    const roll = rollCardOfRarity(next, defs, 'rare');
    draws += roll.draws;
    if (roll.cardId) {
      const uid = `c${next.deck.length}_${next.stepIndex}`;
      next = { ...next, deck: [...next.deck, { uid, cardId: roll.cardId }] };
      events.push({ t: 'card_bought', cardId: roll.cardId, uid, price: choice.cost });
      lines.push({ slug: 'card_bought', cardId: roll.cardId });
    }
  } else if (def.id === 'ash_peddler' && choice.slug === 'potion') {
    const potionId = POTIONS[intAt(next.seed, next.rngDraws, POTIONS.length)].id;
    draws += 1;
    const belt = (Array.isArray(next.potions) ? next.potions : []).slice();
    belt.push(potionId);
    next = { ...next, potions: belt };
    events.push({ t: 'potion_drop', potion: potionId, beltSize: belt.length, source: 'event' });
    lines.push({ slug: 'potion_gift' });
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
      lines.push({ slug: 'card_sold', cardId: inst.cardId, n: SELL_GAIN });
    }
  } else if (def.id === 'collapsed_shaft' && choice.slug === 'climb') {
    next = { ...next, player: { ...next.player, gold: (next.player.gold ?? 0) + SHAFT_GOLD } };
    events.push({ t: 'gold', who: 'player', amount: SHAFT_GOLD, source: 'event' });
    lines.push({ slug: 'shaft_gold', n: SHAFT_GOLD });
  } else if (def.id === 'collapsed_shaft' && choice.slug === 'torch') {
    const healed = Math.min(TORCH_HEAL, next.player.maxHp - next.player.hp);
    if (healed > 0) {
      next = { ...next, player: { ...next.player, hp: next.player.hp + healed } };
      events.push({ t: 'heal', who: 'player', amount: healed, source: 'event' });
    }
    // The beat says what HAPPENED: the heal phrase is gated exactly like the event it
    // describes (S6.1 review P3 — a full-health torch printed "+0 HP" beside a
    // suppressed heal event). The accounting above is untouched.
    lines.push(healed > 0 ? { slug: 'torch_heal', n: healed } : { slug: 'torch_whole' });
  } else if (def.id === 'wandering_smith' && choice.slug === 'stories') {
    const healed = Math.min(STORIES_HEAL, next.player.maxHp - next.player.hp);
    if (healed > 0) {
      next = { ...next, player: { ...next.player, hp: next.player.hp + healed } };
      events.push({ t: 'heal', who: 'player', amount: healed, source: 'event' });
    }
    lines.push(healed > 0 ? { slug: 'stories_heal', n: healed } : { slug: 'stories_whole' });
  } else {
    lines.push({ slug: 'nothing' });
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
  // I18N-2: the beat is a structured slug (the English column keeps the historical
  // raw-id sentence; the Spanish one names the card properly — see BEATS above).
  // The temper id rides the line too: the beat is the ONE record of WHAT was struck
  // (the offer table nulls the moment the modal closes), so the snapshot can publish
  // the tempered card tile's facts from the beat alone — no guessing which deck
  // instance of a duplicated card the smith just took. renderEventLine ignores the
  // field (it reads slug + cardId), so the dump and both language columns stay
  // byte-identical; a legacy beat without it still loads and renders unchanged.
  // HASH: the field is in the canonical state, so a temper-resolution step hashes
  // differently than the previous kernel — no golden log crosses a temper step
  // (verified 0 occurrences in tests/golden/logs.jsonl), so the goldens stand.
  const line = { slug: 'temper_done', cardId: offer.cardId, temper: offer.temper };
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
