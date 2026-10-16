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
  hunter: { name: 'Elite Hunter', goal: 1, text: 'Win a fight against an elite.', reward: { maxHp: 8 }, rewardText: '+8 max HP' },
  smith: { name: "Smith's Rhythm", goal: 30, text: 'Play 30 cards.', reward: { heal: 12 }, rewardText: 'Heal 12' },
  blade: { name: 'Bladework', goal: 120, text: 'Deal 120 damage.', reward: { maxHp: 6 }, rewardText: '+6 max HP' },
  wall: { name: 'Ironwall', goal: 60, text: 'Gain 60 Block.', reward: { maxHp: 6 }, rewardText: '+6 max HP' },
  pilgrim: { name: 'Pilgrim', goal: 2, text: 'Reach 2 campfires.', reward: { heal: 15 }, rewardText: 'Heal 15' },
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
