// Legacy id migration — the DE-STS rename shim (load-time, before any lookup).
//
// The 0.5.0 content build renamed every StS-lexeme id to its Ember Ascent name
// (enemies, enemy moves, hero ids, card ids, the starting relic, the power ids and
// every encounter stateName). Saves and logs written before the rename carry the OLD
// ids; this module maps them onto the new ones at LOAD time so a pre-rename save
// loads, plays and re-derives its identity deterministically under the new content.
//
// CONTRACT (the NAMES.md break-of-compatibility ruling):
//   * validateSave (state.js) is UNCHANGED — it shape-checks the save, never ids.
//   * migrateLegacySave runs AFTER validation and BEFORE the restored state reaches
//     any table lookup, over every id-bearing structure the save format carries.
//   * Idempotent by construction: only ids present in the maps are rewritten, so
//     loading an already-migrated (or a fresh) save is a no-op, and two loads of the
//     same save yield the SAME migrated state — one canonical hash anchor.
//   * The migrated save does NOT keep its old hash: identity re-derives from the
//     migrated state at the next record.buildRunRecord. Hash verification is not
//     patched to pass — a pre-rename save simply becomes a new-identity run (AC3/AC4).
//   * Unknown ids degrade everywhere through the standing tolerance rulings (a relic,
//     potion or event id the tables no longer know reads as a raw id, never a throw) —
//     the shim only rewrites the ids it KNOWS.
//   * Replaying a PRE-rename action LOG against the new content is NOT promised: the
//     logged card tokens carry old ids and the streams they replayed against are gone
//     (the documented break; logs.jsonl is regenerated against the new content).
//
// Pure: a frozen plain object in, a fresh plain object out; no Date, no randomness,
// no I/O, no mutation of the input.
//
// EXEMPT from this table (review-confirmed, correct by absence): state.potions
// (Ember ids already), state.tempers (uid -> Ember temper id), quests and events
// (generic/Ember ids), historical run records (record.js — the break is declared),
// the kindling BOON ids (`bellows`, `stoke` ... — disjoint namespace from the renamed
// hero/card ids, kept verbatim).

/**
 * Old id -> new id, per namespace. The ONLY place legacy ids live in src/ — AC1's
 * "the shim table is the sole live-code mention" ruling.
 */
export const LEGACY_ID_MAP = Object.freeze({
  /** Hero ids (?hero=, --character, state.character, log headers). */
  characters: Object.freeze({ ironclad: 'ashwright', bellows: 'bellows_keeper' }),
  /** Card ids (deck + every combat pile, draft pool, reward cards, shop offers). */
  cards: Object.freeze({
    strike: 'hammerfall',
    defend: 'quench',
    bash: 'anvil_blow',
    gust: 'bellows_gust',
    fan_flames: 'fan_the_flames',
    anger: 'spark',
    cleave: 'arc_cut',
    clothesline: 'collar_check',
    headbutt: 'brow_strike',
    ironwave: 'slag_surge',
    pommel: 'haft_jab',
    sword_boomerang: 'returning_brand',
    thunderclap: 'forgeclap',
    twin_strike: 'twin_hammers',
    wild_strike: 'untempered',
    flex: 'bellows',
    shrug: 'cast_aside',
    true_grit: 'true_temper',
    warcry: 'kiln_cry',
    armaments: 'fit_the_plate',
    havoc: 'vent',
    battle_trance: 'heat_trance',
    bloodletting: 'vein_tap',
    carnage: 'sunder',
    combust: 'banked_coal',
    dark_embrace: 'ash_embrace',
    dropkick: 'heel_drop',
    entrench: 'brace',
    feel_no_pain: 'cinder_skin',
    flame_barrier: 'flame_ward',
    ghostly_armor: 'cinder_shroud',
    hemokinesis: 'blood_hammer',
    inflame: 'stoke',
    metallicize: 'scale_up',
    pummel: 'hail_of_blows',
    rampage: 'climbing_heat',
    rupture: 'split_seam',
    shockwave: 'heat_wash',
    uppercut: 'rising_blow',
    bludgeon: 'maul',
    impervious: 'unbroken',
    limit_break: 'overtemper',
    offering: 'blood_tithe',
    reaper: 'ash_harvest',
  }),
  /** Relic ids (state.relics, the B4-era singular state.relic, state.relicPool,
   *  reward.relicOffers). */
  relics: Object.freeze({ burning_blood: 'kindled_heart' }),
  /** Enemy roster ids (combat.enemies[].id, encounterTable spawn[].id). */
  enemies: Object.freeze({
    jaw_worm: 'cinder_maw',
    cultist: 'ash_cantor',
    red_louse: 'kiln_mite',
    acid_slime: 'slag_ooze',
    gremlin_nob: 'cinder_brute',
    the_guardian: 'slag_warden',
  }),
  /** Power ids — the state.powers KEYS (stacks preserved). */
  powers: Object.freeze({
    combust: 'banked_coal',
    dark_embrace: 'ash_embrace',
    feel_no_pain: 'cinder_skin',
    rupture: 'split_seam',
  }),
  /**
   * Encounter stateNames — the hash-inert display strings the encounter table bakes
   * into `state.map.encounterTable[].name` and combat copies into enemies[].name.
   * Runtime reads prefer the live definitions (observe.js falls back to e.name only
   * on a torn save), so these never decided behavior — but they ARE hash input, and
   * remapping them here keeps ONE canonical hash anchor and leaves no StS string in
   * any loaded state.
   */
  stateNames: Object.freeze({
    'Jaw Worm': 'Cinder Maw',
    'Cultist': 'Ash Cantor',
    'Red Louse': 'Kiln Mite',
    'Acid Slime': 'Slag Ooze',
    'Gremlin Nob': 'Cinder Brute',
    'The Guardian': 'Slag Warden',
    'Two Lice': 'Twin Mites',
    'Louse + Slime': 'Mite and Ooze',
    'Jaw Worm + Louse': 'Maw and Mite',
    'Cultist + Slime': 'Cantor and Ooze',
    'Gremlin Nob + Louse': 'Brute and Mite',
    'Jaw Worm + Slime': 'Maw and Ooze',
    'Slime + Louse': 'Ooze and Mite',
    'Cultist + Crawler': 'Cantor and Crawler',
    'Two Wraiths + Slime': 'The Wraith Pack',
    'Ash Matriarch + Wraith': 'Matriarch and Wraith',
  }),
});

/**
 * Legacy hero ids every surface accepts (?hero=, --character, newRun opts) — mapped
 * onto the canonical id BEFORE validation. The canonical ids are the characters
 * table's own keys ('ashwright', 'bellows_keeper'); the aliases are the renamed
 * pre-0.5.0 ids, kept working so old links, scripts and logs' `?hero=` still boot.
 */
export const HERO_ALIASES = Object.freeze({ ironclad: 'ashwright', bellows: 'bellows_keeper' });

const mapIds = (table, id) => (typeof id === 'string' ? table[id] ?? id : id);
const mapCardIds = (list) => list.map((c) => (c && typeof c === 'object' && typeof c.cardId === 'string' ? { ...c, cardId: LEGACY_ID_MAP.cards[c.cardId] ?? c.cardId } : c));
const mapIdList = (list, table) => (Array.isArray(list) ? list.map((id) => mapIds(table, id)) : list);

/**
 * Migrate one saved run state (and its save wrapper's character field) from the
 * pre-rename id vocabulary to the Ember one. Returns the SAME reference when nothing
 * matched, a fresh value otherwise; never mutates the input.
 * @param {any} raw a parsed save object (validateSave already passed)
 * @returns {any} the save with legacy ids rewritten (character + state)
 */
export function migrateLegacySave(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const st = raw.state;
  if (!st || typeof st !== 'object') return raw;
  const next = { ...st };
  let touched = false;

  const take = (v) => {
    touched = true;
    return v;
  };

  // (a) the character id
  const character = mapIds(LEGACY_ID_MAP.characters, st.character);
  if (character !== st.character) next.character = take(character);

  // (b) the deck and every mid-combat pile carry cardId instances
  if (Array.isArray(st.deck)) next.deck = mapCardIds(st.deck);
  const combat = st.combat && typeof st.combat === 'object' ? { ...st.combat } : st.combat;
  let combatTouched = false;
  if (combat && typeof combat === 'object') {
    for (const pile of ['hand', 'draw', 'discard', 'exhaust']) {
      if (Array.isArray(combat[pile])) {
        const mapped = mapCardIds(combat[pile]);
        if (mapped !== combat[pile]) { combat[pile] = mapped; combatTouched = true; }
      }
    }
    // (g) the enemy row: roster ids + the copied stateName strings
    if (Array.isArray(combat.enemies)) {
      const mapped = combat.enemies.map((e) => {
        const id = mapIds(LEGACY_ID_MAP.enemies, e?.id);
        const name = mapIds(LEGACY_ID_MAP.stateNames, e?.name);
        return id !== e?.id || name !== e?.name ? { ...e, id, name } : e;
      });
      if (mapped.some((e, i) => e !== combat.enemies[i])) { combat.enemies = mapped; combatTouched = true; }
    }
  }
  if (combatTouched) next.combat = take(combat);

  // (c) the reward: card picks and the boss's relic offers
  if (st.reward && typeof st.reward === 'object') {
    const reward = { ...st.reward };
    let rewardTouched = false;
    if (Array.isArray(reward.cards)) {
      const mapped = mapIdList(reward.cards, LEGACY_ID_MAP.cards);
      if (mapped.some((id, i) => id !== reward.cards[i])) { reward.cards = mapped; rewardTouched = true; }
    }
    if (Array.isArray(reward.relicOffers)) {
      const mapped = mapIdList(reward.relicOffers, LEGACY_ID_MAP.relics);
      if (mapped.some((id, i) => id !== reward.relicOffers[i])) { reward.relicOffers = mapped; rewardTouched = true; }
    }
    // the elite's guaranteed drop baked into state (act.js grants it up front) — a
    // single string, mapped like the offer list so no StS id survives a loaded state
    if (typeof reward.relic === 'string') {
      const mapped = mapIds(LEGACY_ID_MAP.relics, reward.relic);
      if (mapped !== reward.relic) { reward.relic = mapped; rewardTouched = true; }
    }
    if (rewardTouched) next.reward = take(reward);
  }

  // (d) the shop shelves (the removal step carries no card id)
  if (st.shop && typeof st.shop === 'object' && Array.isArray(st.shop.offers)) {
    const offers = st.shop.offers.map((o) => {
      const cardId = mapIds(LEGACY_ID_MAP.cards, o?.cardId);
      return cardId !== o?.cardId ? { ...o, cardId } : o;
    });
    if (offers.some((o, i) => o !== st.shop.offers[i])) {
      next.shop = take({ ...st.shop, offers });
    }
  }

  // (e) the draft pool
  if (Array.isArray(st.draftPool)) {
    const mapped = mapIdList(st.draftPool, LEGACY_ID_MAP.cards);
    if (mapped.some((id, i) => id !== st.draftPool[i])) next.draftPool = take(mapped);
  }

  // (f) relics: the S7 array, the B4-era singular, and the S10 pool
  if (Array.isArray(st.relics)) {
    const mapped = mapIdList(st.relics, LEGACY_ID_MAP.relics);
    if (mapped.some((id, i) => id !== st.relics[i])) next.relics = take(mapped);
  }
  if (typeof st.relic === 'string' && LEGACY_ID_MAP.relics[st.relic]) {
    next.relic = take(LEGACY_ID_MAP.relics[st.relic]);
  }
  if (Array.isArray(st.relicPool)) {
    const mapped = mapIdList(st.relicPool, LEGACY_ID_MAP.relics);
    if (mapped.some((id, i) => id !== st.relicPool[i])) next.relicPool = take(mapped);
  }

  // (g) the generated map's encounter table: spawn ids + the baked stateNames
  const map = st.map && typeof st.map === 'object' && st.map.encounterTable && typeof st.map.encounterTable === 'object'
    ? { ...st.map, encounterTable: { ...st.map.encounterTable } }
    : null;
  if (map) {
    let mapTouched = false;
    for (const [nodeId, row] of Object.entries(map.encounterTable)) {
      if (!row || typeof row !== 'object') continue;
      const name = mapIds(LEGACY_ID_MAP.stateNames, row.name);
      const spawn = Array.isArray(row.spawn)
        ? row.spawn.map((s) => {
          const id = mapIds(LEGACY_ID_MAP.enemies, s?.id);
          return id !== s?.id ? { ...s, id } : s;
        })
        : row.spawn;
      if (name !== row.name || (Array.isArray(spawn) && spawn.some((s, i) => s !== row.spawn[i]))) {
        map.encounterTable[nodeId] = { ...row, name, spawn };
        mapTouched = true;
      }
    }
    if (mapTouched) next.map = take(map);
  }

  // (h) the power keys (stacks preserved)
  if (st.powers && typeof st.powers === 'object') {
    const powers = {};
    let powersTouched = false;
    for (const [power, stacks] of Object.entries(st.powers)) {
      const mapped = mapIds(LEGACY_ID_MAP.powers, power);
      if (mapped !== power) powersTouched = true;
      powers[mapped] = stacks;
    }
    if (powersTouched) next.powers = take(powers);
  }

  // The save wrapper's own header fact mirrors state.character.
  const wrapper = raw.character !== next.character && typeof raw.character === 'string'
    ? { ...raw, character: next.character }
    : raw;
  return touched ? { ...wrapper, state: next } : wrapper;
}
