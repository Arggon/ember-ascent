// Observation — the agent-facing text surface, rendered INSIDE the kernel (R4, R1).
//
// Why here and not in the CLI: if a GUI could render state the CLI cannot, the two
// surfaces would diverge and R1 would be a promise rather than a property. Every
// visible character a player sees is produced by this file; surfaces only transport it.
//
// Card definitions are resolved from content at render time. State stores compact
// instances ({uid, cardId, perPlay}) only, so a save never duplicates content and
// two runs on the same content stay byte-identical.
//
// Budget: the dump is designed to stay under 250 tokens (worst of o200k/cl100k) and
// every action line under 8 — enforced by tests/golden/budget.test.js on measured counts.
import { ENEMIES } from './rules/encounters.js';
import { availableNodes, NODE_TYPES } from './rules/map.js';
import { defaultContent } from './content.js';
import { actions as legalActions } from './actions.js';
import { intentLabel, intentDamage, REST_HEAL } from './rules/act.js';
import { BOONS } from './rules/kindling.js';
// The plain-English layer. Declared AFTER the frozen compact one on purpose: the strings
// in this file are the budgeted payload and may not move, so they stay the single source
// of the abbreviations that describe.js explains.
import {
  describeCard,
  describeIntent,
  describePlayability,
  describePower,
  describeStatus,
  GLOSSARY_SECTIONS,
  glossary,
  helpTopics,
  CARD_TYPE_LABEL,
} from './describe.js';

/** Compact status label for the header, e.g. PWR2 VULN1. Exported so the plain-English
 * layer (describe.js) can derive its glossary from these tables instead of copying them. */
export const STATUS_ABBREV = {
  strength: 'PWR',
  vulnerable: 'VULN',
  weak: 'WK',
  dexterity: 'DEX',
  metallicize: 'METAL',
};

/** One-line summaries for the exotic cards (they cannot be derived from data).
 * Exported for the same reason as STATUS_ABBREV: describe.js derives its glossary from
 * this table, so a new exotic card is never left unexplained in the compact form. */
export const CUSTOM_SUMMARY = {
  bloodletting: 'HP3 E2',
  hemokinesis: 'A15 HP2',
  reaper: 'A4xall HP+',
  limit_break: 'PWRx2',
  offering: 'HP6 E2 D3',
  combust: 'PWR+',
  dark_embrace: 'PWR+',
  feel_no_pain: 'PWR+',
  rupture: 'PWR+',
  entrench: 'BLKx2',
  rampage: 'A8+5',
};

/**
 * Short effect summary for a card definition, used in hand lines and action lines.
 * Every extra character here is paid on every turn, so it is deliberately terse.
 * @param {any} def card definition
 * @returns {string}
 */
export function effectSummary(def) {
  const parts = [];
  for (const e of def.effects) {
    switch (e.verb) {
      case 'damage':
        parts.push(e.hits && e.hits > 1 ? `A${e.amount}x${e.hits}` : `A${e.amount}`);
        break;
      case 'block':
        parts.push(`B${e.amount}`);
        break;
      case 'draw':
        parts.push(`D${e.amount}`);
        break;
      case 'energy':
        parts.push(`E${e.amount}`);
        break;
      case 'status':
        parts.push(`${STATUS_ABBREV[e.status] ?? e.status.toUpperCase()}+${e.amount}`);
        break;
      case 'discard':
        parts.push(`d${e.amount}`);
        break;
      case 'exhaust':
        parts.push('EXH');
        break;
      case 'custom':
        parts.push(CUSTOM_SUMMARY[e.handler] ?? '?');
        break;
      default:
        parts.push('?');
    }
  }
  return parts.join(' ');
}

const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

/** Render the status labels for a combatant, e.g. "PWR2 VULN1". */
function statusLine(statuses) {
  const keys = Object.keys(statuses ?? {}).filter((k) => (statuses[k] ?? 0) > 0);
  if (keys.length === 0) return '';
  return keys.map((k) => `${STATUS_ABBREV[k] ?? k.toUpperCase()}${statuses[k]}`).join(' ');
}

/** Live card definition lookup. Single place where an instance becomes renderable. */
let CARD_DEFS = null;
/** @param {any} content */
export function _setContentForObservation(content) {
  CARD_DEFS = content.cards;
}
function defOf(card) {
  if (CARD_DEFS === null) CARD_DEFS = defaultContent().cards;
  const def = CARD_DEFS.get(card.cardId);
  if (!def) throw new Error(`observation: unknown card "${card.cardId}"`);
  return def;
}

/**
 * The R4 state dump. Shape fixed by the requirement:
 *   T3 | HP 42/60 | EN 3/3 | BLK 0 | draw5 disc3 | PWR2 VULN1
 *   HAND
 *    1 Hammerfall  A6
 *   ENEMY
 *    Cinder Maw  HP 44/44  A12
 * @param {any} state
 * @param {{verbose?: boolean}} [opts]
 * @returns {string}
 */
export function observe(state, opts = {}) {
  return [...header(state), ...body(state, opts)].join('\n');
}

function header(state) {
  const p = state.player;
  const statuses = statusLine(p.statuses);
  const head = [
    `T${state.stepIndex}`,
    `HP ${p.hp}/${p.maxHp}`,
    `EN ${p.energy}/${state.energyPerTurn ?? 3}`,
    `BLK ${p.block}`,
    `draw${state.combat?.draw?.length ?? 0} disc${state.combat?.discard?.length ?? 0}`,
    statuses,
  ].filter(Boolean);
  return [head.join(' | ')];
}

function body(state, opts) {
  switch (state.phase) {
    case 'combat':
      return combatBody(state, opts);
    case 'reward':
      return rewardBody(state);
    case 'rest':
      return restBody(state);
    case 'map':
      return mapBody(state, opts);
    case 'kindling':
      return kindlingBody(state);
    case 'ended':
      return [
        `GAME OVER — ${state.outcome === 'win' ? 'VICTORY' : 'DEFEAT'} | floor ${state.floor + 1} | steps ${state.stepIndex}`,
      ];
    default:
      return [`phase ${state.phase}`];
  }
}

function combatBody(state, opts) {
  const lines = ['HAND'];
  if (state.combat.hand.length === 0) lines.push(' (empty)');
  state.combat.hand.forEach((card, i) => {
    const def = defOf(card);
    lines.push(` ${i + 1} ${pad(def.name, 12)} ${effectSummary(def)}`);
  });
  lines.push('ENEMY');
  const live = state.combat.enemies.filter((e) => !e.dead);
  if (live.length === 0) lines.push(' (none)');
  for (const e of live) {
    const def = ENEMIES[e.id];
    const move = def.moves[e.moveIndex] ?? def.moves[0];
    const st = statusLine(e.statuses);
    // `def.name` is the player-facing name. `e.name` is the hashed state string.
    const shown = def?.name || e.name;
    lines.push(` ${shown}  HP ${e.hp}/${e.maxHp}${e.block > 0 ? ` B${e.block}` : ''}  ${move.label}${st ? ` ${st}` : ''}`);
  }
  if (opts.verbose) {
    lines.push('PILES');
    lines.push(` draw: ${pileNames(state.combat.draw)}`);
    lines.push(` disc: ${pileNames(state.combat.discard)}`);
    lines.push(` exh:  ${state.combat.exhaust.length > 0 ? state.combat.exhaust.map((c) => defOf(c).name).join(', ') : '-'}`);
    lines.push(` deck: ${state.deck.length} cards`);
  }
  return lines;
}

const pileNames = (pile) => (pile.length === 0 ? '-' : pile.map((c) => defOf(c).name).join(', '));
const pileCardNames = (pile) => (pile ?? []).map((c) => defOf(c).name);

function rewardBody(state) {
  const lines = ['REWARD — pick one'];
  state.reward.cards.forEach((id) => {
    const def = CARD_DEFS?.get(id) ?? defaultContent().cards.get(id);
    lines.push(` s${state.reward.cards.indexOf(id) + 1} ${def ? def.name : id} ${def ? effectSummary(def) : ''}`);
  });
  lines.push(` s0 skip (HP ${state.player.hp}/${state.player.maxHp})`);
  return lines;
}

function restBody(state) {
  return ['REST — heal or move on', ` HP ${state.player.hp}/${state.player.maxHp}`];
}

function kindlingBody(state) {
  return ['KINDLING — take one boon (upside and cost)',
    ...state.kindling.offers.map((id, i) => ` k${i + 1} ${id} ${BOONS[id].label}`)];
}

function mapBody(state, opts) {
  const lines = [`MAP — floor ${state.floor + 1}/${state.map.rows.length}`, 'NEXT'];
  availableNodes(state).forEach((n, i) => {
    lines.push(` n${i + 1} ${NODE_TYPES[n.type].label}`);
  });
  if (opts.verbose) {
    const row = state.floor >= 0 ? state.map.rows[state.floor] : [];
    lines.push('PATH');
    lines.push(` at: ${row.length > 0 ? row.map((n) => n.id).join(', ') : 'start'}`);
    lines.push(` hp: ${state.player.hp}/${state.player.maxHp} deck: ${state.deck.length}`);
  }
  return lines;
}

/**
 * Render the legal actions, one per line, as `<id> <verb>` (R5).
 * Produced in the kernel for the same reason observe() is: a surface must never be
 * able to show (or accept) an action the other surface cannot.
 *
 * CARD LINES ARE `<p-slot> <cardId>`, e.g. `p1 bash`. Two deliberate omissions:
 *
 *   - No cost. The PM ruling froze the 8-token ceiling ahead of the illustrative
 *     `3 bash A8+V2 EN2` line; cost stays in the R4 hand dump and still gates
 *     legality, so nothing is hidden, it is just not paid for twice.
 *   - No effect summary. Measured: `<slot> <name> <summary>` overran the ceiling on
 *     12 of 40 cards (worst 15 tokens, `p3 pummel A2 A2 A2 A2 EXH`). Effects are
 *     already in the hand dump the agent reads to decide; repeating them per action
 *     would be the single largest avoidable cost in the interface.
 *
 * Measured worst across all 42 content ids: 7 tokens (`p1 sword_boomerang`). Unlike
 * a name+summary scheme, this form is bounded BY CONSTRUCTION as content grows —
 * the only input is the slot and the card's stable id — and tests/golden/budget.test.js
 * fails CI if any shipped id ever breaks the ceiling.
 * @param {any} state
 * @returns {string}
 */
export function observeActions(state) {
  const lines = [];
  for (const a of legalActions(state)) {
    switch (a.kind) {
      case 'play':
        lines.push(`${a.id} ${a.cardId}`);
        break;
      case 'end_turn':
        lines.push(`${a.id} end`);
        break;
      case 'travel':
        lines.push(`${a.id} ${NODE_TYPES[a.nodeType].label}`);
        break;
      case 'pick':
        lines.push(`${a.id} ${a.cardId}`);
        break;
      case 'skip':
        lines.push(`${a.id} skip`);
        break;
      case 'rest_heal':
        lines.push(`${a.id} heal`);
        break;
      case 'rest_leave':
        lines.push(`${a.id} leave`);
        break;
      case 'boon':
        lines.push(`${a.id} ${a.boon}`);
        break;
      default:
        lines.push(`${a.id} ?`);
    }
  }
  return lines.join('\n');
}

/** Card definition lookup by id. */
function cardDef(id) {
  if (CARD_DEFS === null) CARD_DEFS = defaultContent().cards;
  const def = CARD_DEFS.get(id);
  if (!def) throw new Error(`observation: unknown card id "${id}"`);
  return def;
}

/** Status labels for the structured snapshot (same abbreviations as the text dump). */
function statusPairs(statuses) {
  return Object.entries(statuses ?? {})
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([key, stacks]) => ({
      key,
      stacks,
      // Compact form for the CLI and for anyone who has read the glossary.
      label: `${STATUS_ABBREV[key] ?? key.toUpperCase()}${stacks}`,
      // The same fact in words, for a reader meeting it for the first time. Derived
      // here, in the kernel, so no surface can invent its own wording.
      text: `${describeStatus(key, stacks).replace(/\.$/, '')}`,
      explain: describeStatus(key, stacks),
    }));
}

/**
 * A DOM-free STRUCTURED view of the state, for renderers that must not reimplement
 * a rule. Every derived fact a screen needs (card name/cost/effect text, enemy
 * intent and its damage, which cards are playable, which nodes are reachable) is
 * computed here, in the kernel, which is the only place allowed to know the rules.
 *
 * The R4 text dump and this snapshot are two renderings of ONE state: a browser view
 * built on snapshots therefore cannot show something the CLI cannot. Purely
 * presentational data (colors, layout) stays in the renderer; anything a player
 * could use to decide stays here.
 * @param {any} state
 * @param {{verbose?: boolean}} [opts]
 * @returns {object} JSON-safe value model
 */
export function snapshot(state) {
  const legal = legalActions(state);
  // A card that needs a target is offered as ONE action per living enemy (`p1_1`, `p1_2`),
  // while its hand slot is the bare `p1`. Matching on the exact action id therefore marked
  // every attackable card unplayable — the whole hand greyed out with energy to spare. The
  // slot prefix is what a hand tile is playable by, so match on that.
  const playableSlots = new Set(
    legal.filter((a) => a.kind === 'play').map((a) => String(a.id).replace(/_\d+$/, '')),
  );
  // Actions per slot, so a view can offer the target choice without re-deriving legality.
  const targetsBySlot = new Map();
  for (const a of legal) {
    if (a.kind !== 'play') continue;
    const m = /^p(\d+)_(\d+)$/.exec(String(a.id));
    if (!m) continue;
    const slotKey = `p${m[1]}`;
    if (!targetsBySlot.has(slotKey)) targetsBySlot.set(slotKey, []);
    targetsBySlot.get(slotKey).push({ index: Number(m[2]), actionId: a.id });
  }
  const travel = new Map(legal.filter((a) => a.kind === 'travel').map((a) => [a.nodeId, a.id]));
  const pick = new Map(legal.filter((a) => a.kind === 'pick').map((a) => [a.cardId, a.id]));

  const hand = (state.combat?.hand ?? []).map((card, i) => {
    const def = cardDef(card.cardId);
    const slot = `p${i + 1}`;
    const playable = playableSlots.has(slot);
    const targets = targetsBySlot.get(slot) ?? [];
    return {
      slot,
      cardId: card.cardId,
      name: def.name,
      flavor: typeof def.flavor === 'string' ? def.flavor : '',
      cost: card.cost,
      type: def.type,
      rarity: def.rarity,
      // Same card, second rendering. `summary` stays the CLI's compact form (frozen by
      // tests/budget.test.js); `description` is the sentence a human reads instead.
      typeLabel: CARD_TYPE_LABEL[def.type] ?? def.type,
      summary: effectSummary(def),
      description: describeCard(def, card),
      playable,
      // The engine's own answer to "may this card be aimed?" — so a renderer never has to
      // infer it from the card type (Defend is type 'skill', Bash is 'attack', but the
      // rule belongs here, in the kernel).
      target: def.target ?? 'self',
      // Non-empty only when the player actually has a choice to make: more than one living
      // enemy AND a card that must be aimed. Empty means "one click plays it".
      targets: targets.length > 1 ? targets : [],
      hint: describePlayability({ cost: card.cost, playable }, state.player.energy),
    };
  });

  const enemies = (state.combat?.enemies ?? [])
    .filter((e) => !e.dead)
    .map((e) => {
      const def = ENEMIES[e.id];
      const move = def.moves[e.moveIndex] ?? def.moves[0];
      return {
        index: e.index,
        id: e.id,
        name: def.name,
        hp: e.hp,
        maxHp: e.maxHp,
        block: e.block,
        statuses: statusPairs(e.statuses),
        intent: {
          label: intentLabel(e),
          kind: move.kind,
          damage: intentDamage(e),
          hits: move.hits ?? 1,
          // The sentence for the SAME intent, from the same rules, so the compact number
          // and the readable line can never disagree.
          text: describeIntent(e),
        },
      };
    });

  const currentRow = state.floor >= 0 ? state.map.rows[state.floor] : [];
  const nextNodes = availableNodes(state);
  const map = {
    floor: state.floor,
    floorCount: state.map.rows.length,
    current: state.mapNodeId,
    // Every node, grouped by row, with flags the view can paint: `available` (a legal
    // destination) and `current` (where the player stands). Availability is decided
    // here, not guessed by the renderer.
    rows: state.map.rows.map((row, r) =>
      row.map((n) => ({
        id: n.id,
        type: n.type,
        label: NODE_TYPES[n.type].label,
        row: r,
        current: r === state.floor && n.id === state.mapNodeId,
        available: nextNodes.some((a) => a.id === n.id),
        actionId: travel.get(n.id) ?? null,
      })),
    ),
    currentRow: currentRow.map((n) => n.id),
  };

  const reward = state.reward
    ? {
        canSkip: legal.some((a) => a.kind === 'skip'),
        skipId: legal.find((a) => a.kind === 'skip')?.id ?? null,
        cards: state.reward.cards.map((id) => {
          const def = cardDef(id);
          return {
            cardId: id,
            name: def.name,
            flavor: typeof def.flavor === 'string' ? def.flavor : '',
            cost: def.cost,
            type: def.type,
            typeLabel: CARD_TYPE_LABEL[def.type] ?? def.type,
            summary: effectSummary(def),
            description: describeCard(def),
            actionId: pick.get(id) ?? null,
          };
        }),
      }
    : null;

  return {
    phase: state.phase,
    outcome: state.outcome,
    stepIndex: state.stepIndex,
    floor: state.floor,
    turn: state.combat?.turn ?? 0,
    energyPerTurn: state.energyPerTurn ?? 3,
    character: state.character,
    characterName: defaultContent().characters.get(state.character)?.name ?? state.character,
    relicName: defaultContent().characters.get(state.character)?.relicName ?? '',
    difficulty: state.difficulty,
    seed: state.seed,
    player: {
      hp: state.player.hp,
      maxHp: state.player.maxHp,
      block: state.player.block,
      energy: state.player.energy,
      statuses: statusPairs(state.player.statuses),
      powers: Object.entries(state.powers ?? {})
        .filter(([, v]) => v > 0)
        .map(([key, stacks]) => ({
          key,
          stacks,
          label: `${STATUS_ABBREV[key] ?? key.toUpperCase()}`,
          text: `${describePower(key, stacks).replace(/\.$/, '')}`,
          explain: describePower(key, stacks),
        })),
    },
    hand,
    piles: {
      draw: state.combat?.draw?.length ?? 0,
      discard: state.combat?.discard?.length ?? 0,
      exhaust: state.combat?.exhaust?.length ?? 0,
      // Names only, for the pile viewer. Counts above stay the compact facts.
      drawCards: pileCardNames(state.combat?.draw),
      discardCards: pileCardNames(state.combat?.discard),
      exhaustCards: pileCardNames(state.combat?.exhaust),
    },
    enemies,
    map,
    reward,
    rest: state.phase === 'rest' ? { healId: legal.find((a) => a.kind === 'rest_heal')?.id ?? null, leaveId: legal.find((a) => a.kind === 'rest_leave')?.id ?? null, heal: REST_HEAL } : null,
    kindling: state.phase === 'kindling'
      ? { boons: state.kindling.offers.map((id, i) => ({ id, name: BOONS[id].name, text: BOONS[id].text, label: BOONS[id].label, actionId: `k${i + 1}` })) }
      : null,
    ended: state.phase === 'ended' ? { outcome: state.outcome, floor: state.floor + 1, steps: state.stepIndex } : null,
    // The plain-English layer, computed from this same state. A human surface paints
    // `description` / `text` / `glossary`; the compact fields above stay untouched for
    // the CLI. One state, two renderings, one place that knows the rules.
    cardTypes: CARD_TYPE_LABEL,
    glossary: glossary(),
    glossarySections: GLOSSARY_SECTIONS,
    help: helpTopics(),
    // Legal actions, verbatim from the kernel, so a view can label its buttons without
    // inventing an id. Includes the R5 line text for parity with the CLI surface.
    actions: legal.map((a) => ({ id: a.id, kind: a.kind, cardId: a.cardId ?? null, nodeType: a.nodeType ?? null, nodeId: a.nodeId ?? null })),
    actionLines: observeActions(state),
    text: observe(state),
  };
}
