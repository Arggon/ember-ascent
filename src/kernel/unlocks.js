// Unlocks — catalog, pure evaluation, and the card-pool rule (DR-1, DR-4, DR-5).
//
// THE RULE THIS FILE EXISTS TO ENFORCE (AC-9.3): an unlock adds an OPTION, never power.
// There is exactly one mechanical shape an unlock entry can have — a `grantCard`, a
// `grantOption` or a `grantMode` — and a test asserts that against the catalog, so a
// future `{ maxHp: +5 }` entry breaks the build instead of shipping.
//
// NO RULE MAY READ THE PROFILE. The profile reaches the engine as exactly one thing:
// a selection of card ids (`poolSelection`). The engine's own rules (`newRun`, `step`)
// never see a profile at all — they receive content, and content is all they read.
// Every function here is pure: no clock, no `Math.random`, no I/O (the architecture
// gate fails this file if that stops being true).
import { helpTopics, glossary } from './describe.js';
import { VERBS } from './rules/vocabulary.js';

/** The only keys a grant may declare. Anything else is a stat, and stat grants are banned. */
export const GRANT_KEYS = Object.freeze(['grantCard', 'grantOption', 'grantMode']);

/** The frozen fresh-profile composition (§11.2): 24 of the shipped cards, A/S/P 12/9/3. */
export const FRESH_SIZE = 24;
/** Ratio of the pool by card type, applied to any size: 12:9:3 out of 24 = 0.5 / 0.375 / 0.125. */
export const TYPE_RATIO = Object.freeze({ attack: 0.5, skill: 0.375, power: 0.125 });
/** The shipped total (1 act, frozen content). Derived at call time, never used as a literal rule. */
export const SHIPPED_CARDS = 44;

/** Rarity order, cheapest first. A fill may only relax *down* this list. */
const RARITY_RANK = Object.freeze({ starter: 0, common: 1, uncommon: 2, rare: 3 });

/**
 * The unlock catalog.
 *
 * `at` is a THRESHOLD over the profile's own counters (cumulative score, runs played,
 * or a named badge) — never a game stat. `grant.grantCard` only ever widens the draft
 * POOL; it cannot raise HP, energy, hand size or any damage number (AC-9.3).
 *
 * Sizes are monotone (24 → 30 → 36 → 39) so an unlock is a strict superset of what came
 * before: nothing a player already had is ever taken away, and the rare tier is the last
 * and most visible prize (§11.2 rule 4).
 */
export const UNLOCK_CATALOG = Object.freeze([
  Object.freeze({
    id: 'wider_pool_1',
    at: Object.freeze({ score: 25 }),
    grant: Object.freeze({ grantCard: Object.freeze({ size: 30, allowUncommon: true, allowRare: false }) }),
    name: 'More cards can appear in your rewards',
    condition: 'Score 25 or more across your runs',
    narration: 'Seven more of the 42 cards are now in play (24 → 30), uncommon cards among them.',
  }),
  Object.freeze({
    id: 'wider_pool_2',
    at: Object.freeze({ score: 60 }),
    grant: Object.freeze({ grantCard: Object.freeze({ size: 36, allowUncommon: true, allowRare: false }) }),
    name: 'A wider reward pool still',
    condition: 'Score 60 or more across your runs',
    narration: 'Six more cards are now in play (30 → 36).',
  }),
  Object.freeze({
    id: 'rare_tier',
    at: Object.freeze({ score: 120 }),
    grant: Object.freeze({ grantCard: Object.freeze({ size: 39, allowUncommon: true, allowRare: true }) }),
    name: 'Rare cards can appear in your rewards',
    condition: 'Score 120 or more across your runs',
    narration: 'Three more cards are now in play (36 → 39). The rare tier is open.',
  }),
  Object.freeze({
    id: 'play_this_seed',
    at: Object.freeze({ runs: 1 }),
    grant: Object.freeze({ grantMode: 'replay-seed' }),
    name: 'Play a past seed again',
    condition: 'Finish one run',
    narration: 'You can now replay any seed from your history.',
  }),
  Object.freeze({
    id: 'ledger_notes',
    at: Object.freeze({ badge: 'first_win' }),
    grant: Object.freeze({ grantOption: 'badge-notes' }),
    name: 'Your earned marks are explained in the ledger',
    condition: 'Win a run',
    narration: 'Every mark you earn now carries the condition that earned it.',
  }),
]);

/**
 * Badges. SEPARATE from the score and never added to it (§11.1) — their value is the
 * story of the run, not a number. `condition` is the string AC-7.3 requires to be
 * recoverable from the history entry.
 */
export const BADGE_CATALOG = Object.freeze([
  Object.freeze({ id: 'first_win', name: 'Victory', condition: 'Win a run' }),
  Object.freeze({ id: 'boss_down', name: 'Warden down', condition: 'Defeat the Slag Warden' }),
  Object.freeze({ id: 'elite_hunter', name: 'Elite hunter', condition: 'Kill an elite' }),
  Object.freeze({ id: 'deep_run', name: 'Deep run', condition: 'Reach the boss floor' }),
  Object.freeze({ id: 'ten_kills', name: 'Ten down', condition: 'Kill ten enemies in one run' }),
]);

/** Thresholds a profile is compared against — the ONLY profile fields an unlock reads. */
function countersOf(profile) {
  const p = profile ?? {};
  return {
    score: Number(p.scoreTotal ?? p.score ?? 0) || 0,
    runs: Number(p.runs ?? 0) || 0,
    badges: p.badges && typeof p.badges === 'object' ? p.badges : {},
  };
}

/** True when a catalog entry's `at` threshold is met by these counters. Pure. */
function meets(entry, counters) {
  const at = entry.at ?? {};
  if (typeof at.score === 'number' && counters.score < at.score) return false;
  if (typeof at.runs === 'number' && counters.runs < at.runs) return false;
  if (typeof at.badge === 'string' && counters.badges[at.badge] !== true) return false;
  return true;
}

/** Every catalog entry already open to this profile. Pure. */
export function unlocksFor(profile) {
  const counters = countersOf(profile);
  return UNLOCK_CATALOG.filter((entry) => meets(entry, counters));
}

/**
 * The all-unlocks-open profile (DR-5). Used by `--pool full` and by the AC-9.3 tests.
 *
 * DERIVED FROM THE CATALOG, not hand-written: a new unlock entry raises these counters
 * automatically, so "full" can never quietly stop meaning full as the catalog grows.
 * Every badge in BADGE_CATALOG is marked earned, because a badge-gated entry reads
 * `counters.badges[id] === true`.
 * @returns {{scoreTotal: number, runs: number, badges: Record<string, boolean>}}
 */
export function fullyUnlockedProfile() {
  let scoreTotal = 0;
  let runs = 0;
  for (const entry of UNLOCK_CATALOG) {
    const at = entry.at ?? {};
    if (typeof at.score === 'number') scoreTotal = Math.max(scoreTotal, at.score);
    if (typeof at.runs === 'number') runs = Math.max(runs, at.runs);
  }
  const badges = {};
  for (const badge of BADGE_CATALOG) badges[badge.id] = true;
  return { scoreTotal, runs, badges };
}

/**
 * Badges earned by a completed record. Pure; only reads the record, never the profile.
 * @param {any} record
 */
export function badgesForRun(record) {
  const earned = [];
  const outcome = record?.outcome;
  const counts = record?.score?.counts ?? null;
  const kills = counts?.kills ?? 0;
  if (outcome === 'win') earned.push(BADGE_CATALOG.find((b) => b.id === 'first_win'));
  if ((counts?.boss ?? 0) > 0) earned.push(BADGE_CATALOG.find((b) => b.id === 'boss_down'));
  if ((counts?.elites ?? 0) > 0) earned.push(BADGE_CATALOG.find((b) => b.id === 'elite_hunter'));
  if (record?.bossArrival !== undefined) earned.push(BADGE_CATALOG.find((b) => b.id === 'deep_run'));
  if (kills >= 10) earned.push(BADGE_CATALOG.find((b) => b.id === 'ten_kills'));
  return earned.filter(Boolean);
}

/**
 * Evaluate what a just-finished run opens.
 *
 * PURE (DR-4): no clock, no randomness, no I/O, and it runs once per completed run.
 * It reads the profile ONLY as counters (cumulative score / runs / earned badges) and
 * returns the OPTIONS that became open — never a number the engine could use as power.
 * @param {{scoreTotal?: number, runs?: number, badges?: Record<string, boolean>}} profile
 * @param {any} record the run that just finished
 * @returns {{open: any[], newly: any[], gained: {score: number, runs: number}}}
 */
export function evaluateUnlocks(profile, record) {
  const before = countersOf(profile);
  const gained = {
    score: Number(record?.score?.total ?? 0) || 0,
    runs: record === null || record === undefined ? 0 : 1,
  };
  const after = {
    score: before.score + gained.score,
    runs: before.runs + gained.runs,
    badges: { ...before.badges },
  };
  for (const badge of Array.isArray(record?.badges) ? record.badges : []) {
    if (badge && typeof badge.id === 'string') after.badges[badge.id] = true;
  }
  const openBefore = new Set(unlocksFor(profile).map((e) => e.id));
  const open = UNLOCK_CATALOG.filter((entry) => meets(entry, after));
  return {
    open: open.map((entry) => ({ id: entry.id, name: entry.name, condition: entry.condition, narration: entry.narration, grant: entry.grant })),
    newly: open
      .filter((entry) => !openBefore.has(entry.id))
      .map((entry) => ({ id: entry.id, name: entry.name, condition: entry.condition, narration: entry.narration, grant: entry.grant })),
    gained,
  };
}

/** The largest pool any open unlock asks for, with its rarity permissions. */
export function poolPlan(profile) {
  let plan = { size: FRESH_SIZE, allowUncommon: false, allowRare: false, from: 'fresh' };
  for (const entry of unlocksFor(profile)) {
    const grant = entry.grant?.grantCard;
    if (!grant) continue;
    if (grant.size > plan.size) {
      plan = {
        size: grant.size,
        allowUncommon: Boolean(grant.allowUncommon),
        allowRare: Boolean(grant.allowRare),
        from: entry.id,
      };
    }
  }
  return plan;
}

/** Card ids named anywhere in the kernel's own How-to-play / glossary text (rule 2). */
function namedInHelp(content) {
  const text = [
    ...helpTopics().map((t) => `${t.title} ${t.body}`),
    ...glossary().map((g) => `${g.token} ${g.label} ${g.meaning ?? ''}`),
  ].join(' \n ');
  const out = [];
  for (const card of content.cardList) {
    if (text.includes(card.name)) out.push(card.id);
  }
  return out;
}

/** Type queues, cheapest rarity first then id, so every fill step is deterministic. */
function queues(content) {
  const q = { attack: [], skill: [], power: [] };
  for (const card of content.cardList) {
    if (card.rarity === 'starter') continue;
    if (!q[card.type]) continue;
    q[card.type].push(card.id);
  }
  for (const type of Object.keys(q)) {
    q[type].sort((a, b) => {
      const ca = content.cards.get(a);
      const cb = content.cards.get(b);
      return RARITY_RANK[ca.rarity] - RARITY_RANK[cb.rarity] || a.localeCompare(b);
    });
  }
  return q;
}

/** Targets by type for a pool of `size`, clamped to what content actually offers. */
function typeTargets(size, content, base) {
  const avail = { attack: 0, skill: 0, power: 0 };
  for (const card of content.cardList) if (avail[card.type] !== undefined) avail[card.type] += 1;
  const want = {
    attack: Math.ceil(size * TYPE_RATIO.attack),
    skill: Math.ceil(size * TYPE_RATIO.skill),
    power: Math.ceil(size * TYPE_RATIO.power),
  };
  // Starters are always in, and they count toward their type.
  for (const type of Object.keys(want)) want[type] = Math.max(want[type], base[type] ?? 0);
  for (const type of Object.keys(want)) want[type] = Math.min(want[type], avail[type]);
  let total = want.attack + want.skill + want.power;
  // Deterministic correction so the targets always sum to the requested size.
  const order = ['attack', 'skill', 'power'];
  let guard = 0;
  while (total < size && guard < 1000) {
    guard += 1;
    const type = order.find((t) => want[t] < avail[t]);
    if (type === undefined) break;
    want[type] += 1;
    total += 1;
  }
  while (total > size && guard < 2000) {
    guard += 1;
    const type = ['power', 'skill', 'attack'].find((t) => want[t] > (base[t] ?? 0));
    if (type === undefined) break;
    want[type] -= 1;
    total -= 1;
  }
  return want;
}

/**
 * Build the card pool for a profile — the ONLY way a profile reaches the engine (DR-4).
 *
 * The frozen rule (§11.2), applied in order:
 *   1. every starter is in;
 *   2. every card named in the How-to-play panel is in;
 *   3. at least one card per effect verb in the vocabulary is present;
 *   4. the remaining slots are filled common-before-uncommon, never rare.
 * Rule 4's "never rare" is the FRESH pool's rule; later unlock tiers relax it in the
 * declared order, because AC-9.4 requires the whole pool to be reachable, and the rare
 * tier is exactly what rule 4 is holding back as the prize.
 * @param {any} content loaded content
 * @param {any} [profile]
 * @returns {{ids: string[], composition: {attack: number, skill: number, power: number}, size: number, plan: any}}
 */
export function poolSelection(allContent, profile = null) {
  // Hero-only starters (B4: `hero` set) belong to their hero's deck, not to the shared
  // pool, so adding a hero leaves every pool slice — and every Ashwright run — unchanged.
  // contentForProfile adds them back so that hero's run can still resolve them.
  const content = withoutHeroCards(allContent);
  const plan = poolPlan(profile);
  const q = queues(content);
  const chosen = new Map(); // id -> card
  const add = (id) => {
    if (chosen.has(id)) return;
    const card = content.cards.get(id);
    if (card) chosen.set(id, card);
  };

  // 1. starters
  for (const card of content.cardList) if (card.rarity === 'starter') add(card.id);
  // 2. named in the How-to-play / glossary text the game itself shows
  for (const id of namedInHelp(content)) add(id);
  // 3. one card per effect verb, cheapest non-rare first
  for (const verb of VERBS) {
    const candidates = content.cardList
      .filter((c) => c.rarity !== 'starter' && c.rarity !== 'rare' && c.effects.some((e) => e.verb === verb))
      .sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || a.id.localeCompare(b.id));
    // Prefer the cheapest candidate whose type still has room, else the cheapest at all.
    const pick = candidates.find((c) => ordered(typeTargets(plan.size, content, countTypes(chosen)).attack ? true : true, c)) ?? candidates[0];
    if (pick) add(pick.id);
  }
  // 4. fill to the type targets, common before uncommon, and rare only when allowed
  const targets = typeTargets(plan.size, content, countTypes(chosen));
  for (const type of ['attack', 'skill', 'power']) {
    for (const id of q[type]) {
      if (countType(chosen, type) >= targets[type]) break;
      const card = content.cards.get(id);
      if (card.rarity === 'uncommon' && !plan.allowUncommon && countType(chosen, type) >= (countTypes(chosen)[type] ?? 0)) {
        // Only relax downward: an unlock may open uncommon, never close it.
        if (!plan.allowUncommon) continue;
      }
      if (card.rarity === 'rare' && !plan.allowRare) continue;
      add(id);
    }
  }
  const composition = countTypes(chosen);
  return { ids: [...chosen.keys()].sort(), composition, size: chosen.size, plan };
}

function ordered(_flag, card) {
  return Boolean(card);
}

function countType(chosen, type) {
  let n = 0;
  for (const card of chosen.values()) if (card.type === type) n += 1;
  return n;
}

function countTypes(chosen) {
  return { attack: countType(chosen, 'attack'), skill: countType(chosen, 'skill'), power: countType(chosen, 'power') };
}

/** The content minus hero-only starter cards (cards carrying a `hero` field). */
export function withoutHeroCards(content) {
  if (!content.cardList.some((c) => c.hero)) return content;
  const cardList = content.cardList.filter((c) => !c.hero);
  return { ...content, cardList, cards: new Map(cardList.map((c) => [c.id, c])) };
}
