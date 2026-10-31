// Ember quests — three seeded side goals per run (B3). Opt-in per run
// (`newRun({ quests: true })`).
//
// A quests run draws three of QUEST_IDS when it starts. Progress is folded from the
// events every step already emits (no new choices, no extra draws), and a finished
// quest pays its reward at once. A run without the option has no `quests` field and
// keeps its stream and hashes byte-identical. Pure; every draw is counted into rngDraws.
import { pickAt } from '../rng.js';

/** How many quests a run carries. */
export const QUEST_COUNT = 3;

export const QUESTS = Object.freeze({
  hunter: {
    name: 'Elite Hunter', name_es: 'Cazador de Élites',
    goal: 1, text: 'Win a fight against an elite.', text_es: 'Gana un combate contra un élite.',
    reward: { maxHp: 8 }, rewardText: '+8 max HP', rewardText_es: '+8 de HP máximo',
  },
  smith: {
    name: "Smith's Rhythm", name_es: 'Ritmo del Herrero',
    goal: 30, text: 'Play 30 cards.', text_es: 'Juega 30 cartas.',
    reward: { heal: 12 }, rewardText: 'Heal 12', rewardText_es: 'Cura 12',
  },
  blade: {
    name: 'Bladework', name_es: 'Labores de Filo',
    goal: 120, text: 'Deal 120 damage.', text_es: 'Inflige 120 de daño.',
    reward: { maxHp: 6 }, rewardText: '+6 max HP', rewardText_es: '+6 de HP máximo',
  },
  wall: {
    name: 'Ironwall', name_es: 'Muro de Hierro',
    goal: 60, text: 'Gain 60 Block.', text_es: 'Gana 60 de Bloqueo.',
    reward: { maxHp: 6 }, rewardText: '+6 max HP', rewardText_es: '+6 de HP máximo',
  },
  pilgrim: {
    name: 'Pilgrim', name_es: 'Peregrino',
    goal: 2, text: 'Reach 2 campfires.', text_es: 'Alcanza 2 hogueras.',
    reward: { heal: 15 }, rewardText: 'Heal 15', rewardText_es: 'Cura 15',
  },
});
/** Stable order, part of the format (the seeded roll indexes into it). */
export const QUEST_IDS = Object.freeze(['hunter', 'smith', 'blade', 'wall', 'pilgrim']);

/**
 * Seeded quest roll at run start.
 * @returns {{quests: Array<{id: string, progress: number, done: boolean}>, draws: number}}
 */
export function rollQuests(seed, startDraw) {
  const pick = pickAt(seed, startDraw, QUEST_IDS, QUEST_COUNT);
  return { quests: pick.picked.map((id) => ({ id, progress: 0, done: false })), draws: pick.draws };
}

/** How much one step moved a quest, from that step's events. */
function gain(id, ctx) {
  let n = 0;
  for (const e of ctx.events) {
    if (id === 'hunter' && e.t === 'combat_won' && ctx.nodeType === 'elite') n += 1;
    if (id === 'blade' && e.t === 'damage' && e.source === 'player') n += e.dealt ?? 0;
    if (id === 'wall' && e.t === 'block' && e.who === 'player') n += e.amount ?? 0;
    if (id === 'pilgrim' && e.t === 'rest_ready') n += 1;
  }
  if (id === 'smith' && ctx.played) n += 1;
  return n;
}

/**
 * Fold one step into the run's quests and pay out any that just finished.
 * @param {any} state the state after the step
 * @param {{events: any[], played: boolean, nodeType: string | null}} ctx
 * @returns {{state: any, events: any[]}}
 */
export function advanceQuests(state, ctx) {
  if (!state.quests) return { state, events: [] };
  let player = state.player;
  const events = [];
  let changed = false;
  const quests = state.quests.map((q) => {
    if (q.done) return q;
    const g = gain(q.id, ctx);
    if (g === 0) return q;
    changed = true;
    const def = QUESTS[q.id];
    const progress = Math.min(def.goal, q.progress + g);
    if (progress < def.goal) return { ...q, progress };
    const r = def.reward;
    const maxHp = player.maxHp + (r.maxHp ?? 0);
    const hp = Math.min(maxHp, player.hp + (r.maxHp ?? 0) + (r.heal ?? 0));
    player = { ...player, maxHp, hp };
    events.push({ t: 'quest_done', quest: q.id, reward: r });
    return { ...q, progress, done: true };
  });
  if (!changed) return { state, events: [] };
  return { state: { ...state, quests, player }, events };
}
