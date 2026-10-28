// S8 content scale — the two NEW verbs (heal, retain) and the previously-dormant
// `hits` multi-hit parameter, at the same rigor every other verb is held to.
//
// Pins:
//   heal — restores up to the printed HP, capped at maxHp; the event carries the HP
//          ACTUALLY restored (a full-HP play heals 0 and says so); ignores Block by
//          construction (it never touches the damage path); zero draws.
//   retain — a play-time no-op (zero events, zero draws); the end-of-turn discard
//          phase keeps the card in the hand with its decorated instance intact,
//          turn after turn, while non-retain cards discard exactly as before; the
//          partition itself consumes no rng draws (measured against a control).
//   hits — per-hit Block absorption (block soaks hit by hit), Strength added to every
//          hit, and the loop stops when the target dies mid-card (rule 5: no writing
//          to a corpse).
//
// Inputs are deep-frozen before each step, so an accidental write throws (R1/R3) —
// the same discipline tests/cards/cards.test.js keeps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { combatState, content, dummyPile, loadKernel, loadStateMod } from '../helpers/harness.mjs';

const { step } = await loadKernel();
const { freezeDeep } = await loadStateMod();
const C = await content();

/* ------------------------------------------------------------------------ heal */

test('heal: Tallow Rub restores 6 HP and exhausts, event-first', async () => {
  const state = freezeDeep(await combatState('tallow_rub', { hp: 40 }));
  const res = step(state, 'p1');
  assert.equal(res.error, null);
  assert.equal(res.state.player.hp, 46, '6 of the 54 HP are back');
  assert.deepEqual(res.events.map((e) => e.t), ['heal', 'exhaust'], 'heal resolves, then the card exhausts');
  assert.equal(res.state.combat.exhaust[0].cardId, 'tallow_rub');
});

test('heal: capped at maxHp — the event carries the HP actually restored', async () => {
  const nearFull = freezeDeep(await combatState('tallow_rub', { hp: 56 }));
  const res = step(nearFull, 'p1');
  assert.equal(res.state.player.hp, 60, 'clamped to maxHp');
  assert.deepEqual(res.events[0], { t: 'heal', who: 'player', amount: 4 }, 'says 4, not 6');

  const full = freezeDeep(await combatState('tallow_rub', { hp: 60 }));
  const res2 = step(full, 'p1');
  assert.equal(res2.state.player.hp, 60);
  assert.deepEqual(res2.events[0], { t: 'heal', who: 'player', amount: 0 }, 'a full-HP play restores nothing, honestly');
});

test('heal: Rekindle heals 10 and draws 2 — draw accounting visible', async () => {
  const state = freezeDeep(await combatState('rekindle', { hp: 30 }));
  const res = step(state, 'p1');
  assert.equal(res.error, null);
  assert.equal(res.state.player.hp, 40);
  assert.deepEqual(res.events.map((e) => e.t), ['heal', 'draw', 'exhaust']);
  const drawEvent = res.events.find((e) => e.t === 'draw');
  assert.equal(drawEvent.count, 2, 'exactly two cards drawn');
  assert.equal(res.state.combat.hand.length, 2);
});

/* ---------------------------------------------------------------------- retain */

/** A combat holding `cardIds` in hand; the draw pile is fat so no reshuffle muddies the draw count. */
async function handState(cardIds, over = {}) {
  const c = await content();
  const base = await combatState(cardIds[0], { ...over, hand: undefined });
  const hand = cardIds.map((id, i) => ({ uid: `H${i}`, cardId: id, cost: c.cards.get(id).cost, perPlay: 0 }));
  return freezeDeep({ ...base, combat: { ...base.combat, hand, draw: dummyPile(c, 20) } });
}

test('retain: playing a retain card is a no-op — it discards like any attack', async () => {
  const state = await handState(['kindled_blade']);
  const res = step(state, 'p1');
  assert.equal(res.error, null);
  assert.deepEqual(res.events.map((e) => e.t), ['damage'], 'the marker verb emits nothing');
  assert.equal(res.state.combat.discard.length, 1, 'played retain card goes to discard normally');
  assert.equal(res.state.combat.exhaust.length, 0);
});

test('retain: a held card survives the discard phase — event, hand, decorated cost', async () => {
  // Ember Ward (B14 RTN) sits unplayed in hand; Cinder Flick beside it discards. The
  // returned state is the START of the next turn, so the hand is the held card PLUS the
  // turn draw stacked on top (beginTurn) — the held card is still there, cost intact.
  const state = await handState(['ember_ward', 'cinder_flick']);
  const res = step(state, 'e1');
  assert.equal(res.error, null);
  const retain = res.events.find((e) => e.t === 'retain');
  assert.deepEqual(retain.uids, ['H0'], 'the retain event names the held card');
  const discardHand = res.events.find((e) => e.t === 'discard_hand');
  assert.deepEqual(discardHand.uids, ['H1'], 'the non-retain card discards exactly as before');
  assert.equal(res.state.combat.discard.length, 1, 'only the discarded card entered the pile');
  const held = res.state.combat.hand.find((c) => c.uid === 'H0');
  assert.ok(held, 'the retained card is still in hand (with the new turn draw beside it)');
  assert.equal(held.cardId, 'ember_ward');
  assert.equal(held.cost, 2, 'the decorated instance (cost) survives the turn boundary');
});

test('retain: across two turn ends, and the next turn draws on top', async () => {
  const state = await handState(['ember_ward', 'hearth_stand', 'heavy_swing', 'slag_wall', 'forge_rhythm']);
  // Turn 1 ends: two retain cards stay, three discard; turn 2 begins by drawing 5 ON TOP
  // of the 2 held cards (hand 7 — beginTurn draws the full hand size, StS-style).
  let res = step(state, 'e1');
  assert.equal(res.state.combat.hand.length, 7, '2 retained + the 5-card turn draw');
  assert.ok(res.state.combat.hand.some((c) => c.uid === 'H0') && res.state.combat.hand.some((c) => c.uid === 'H1'));
  assert.deepEqual(res.events.filter((e) => e.t === 'retain').length, 1, 'one retain event');
  // Turn 2: hold everything again (play nothing), end turn. Hand 7 → 5 discards, 2 retains;
  // turn 3 begins and stacks another 5 on top.
  const mid = freezeDeep(res.state);
  res = step(mid, 'e1');
  const retain2 = res.events.find((e) => e.t === 'retain');
  assert.deepEqual(retain2.uids.sort(), ['H0', 'H1'], 'the same two cards stay held, turn after turn');
  assert.equal(res.state.combat.hand.length, 7, 'retained + the next turn draw, again');
});

test('retain: the partition itself consumes no rng draws (measured against a control)', async () => {
  // Same shape, same piles, same draw — the ONLY difference is whether the two held
  // cards carry the retain verb. Any draw difference would mean the partition rolled.
  const withRetain = await handState(['ember_ward', 'cinder_flick']);
  const withoutRetain = await handState(['slag_wall', 'cinder_flick']);
  const a = step(withRetain, 'e1');
  const b = step(withoutRetain, 'e1');
  const deltaA = a.state.rngDraws - withRetain.rngDraws;
  const deltaB = b.state.rngDraws - withoutRetain.rngDraws;
  assert.equal(deltaA, deltaB, `draw accounting identical (retain ${deltaA} vs control ${deltaB})`);
});

test('retain: Pyre Feast heals AFTER the damage — a killing blow still pays the feast', async () => {
  // pyre_feast = damage ALL (8) + heal 5. One 8-HP enemy dies on the hit; the heal
  // must still resolve (the effects loop never short-circuits on a kill), and the
  // card's heal lands BEFORE combat_won — the victory chain (Kindled Heart's +6, gold,
  // potion, reward) follows it.
  const state = freezeDeep(await combatState('pyre_feast', { hp: 40, enemies: undefined }));
  const weak = { ...state.combat.enemies[0], hp: 8, maxHp: 8 };
  const one = freezeDeep({ ...state, combat: { ...state.combat, enemies: [{ ...weak, index: 0 }] } });
  const res = step(one, 'p1');
  assert.deepEqual(res.events.slice(0, 3).map((e) => e.t), ['damage', 'heal', 'combat_won'], 'the feast resolves in order, then victory');
  assert.equal(res.events[1].amount, 5, 'the card heal is exactly 5');
  assert.equal(res.state.player.hp, 51, '40 + feast 5 + the Kindled Heart victory heal 6');
});

/* ------------------------------------------------- multi-hit (the `hits` param) */

test('multi-hit vs Block: 3x3 into 4 Block soaks hit by hit', async () => {
  const state = freezeDeep(await combatState('cinder_flick', { enemyOver: { block: 4 } }));
  const res = step(state, 'p1');
  assert.equal(res.error, null);
  const hits = res.events.filter((e) => e.t === 'damage');
  assert.equal(hits.length, 3, 'three hit events');
  assert.deepEqual(hits.map((h) => h.blocked), [3, 1, 0], 'block absorbs hit by hit');
  assert.deepEqual(hits.map((h) => h.dealt), [0, 2, 3], '5 damage lands through 4 Block');
  assert.equal(res.state.combat.enemies[0].block, 0, 'block spent');
  assert.equal(res.state.combat.enemies[0].hp, 40 - 5);
});

test('multi-hit: Strength is added to EVERY hit', async () => {
  const state = freezeDeep(await combatState('cinder_flick', { statuses: { strength: 2 } }));
  const res = step(state, 'p1');
  const hits = res.events.filter((e) => e.t === 'damage');
  assert.deepEqual(hits.map((h) => h.raw), [5, 5, 5], '3 + 2 Strength per hit');
  assert.equal(res.state.combat.enemies[0].hp, 40 - 15);
});

test('multi-hit: the loop stops at a dead target — a killing hit ends the card, no corpse hits', async () => {
  // 4 hits of 2 into a 3-HP enemy: hit 1 → 1 HP, hit 2 → dead, hits 3+4 must not fire.
  const state = freezeDeep(await combatState('slag_shrapnel', { enemies: undefined }));
  const frail = { ...state.combat.enemies[0], hp: 3, maxHp: 3, block: 0 };
  const one = freezeDeep({ ...state, combat: { ...state.combat, enemies: [{ ...frail, index: 0 }] } });
  const res = step(one, 'p1');
  const hits = res.events.filter((e) => e.t === 'damage');
  assert.equal(hits.length, 2, 'two hits, then the target died');
  assert.deepEqual(hits.map((h) => h.hp), [1, 0]);
  assert.ok(res.events.some((e) => e.t === 'combat_won'), 'victory settles through the one implementation');
});

test('multi-hit to ALL enemies: Cinder Storm hits every living enemy 4 times', async () => {
  const state = freezeDeep(await combatState('cinder_storm', { enemies: undefined }));
  const mk = (hp) => ({ ...state.combat.enemies[0], hp, maxHp: hp, block: 0, index: 0 });
  const two = freezeDeep({ ...state, combat: { ...state.combat, enemies: [mk(20), mk(6)] } });
  const res = step(two, 'p1');
  const byTarget = new Map();
  for (const e of res.events.filter((x) => x.t === 'damage')) {
    byTarget.set(e.target, (byTarget.get(e.target) ?? 0) + 1);
  }
  assert.deepEqual([...byTarget.entries()].sort(), [[0, 4], [1, 2]], 'enemy 0 takes 4 hits, the 6-HP enemy dies on its 2nd');
  assert.ok(res.state.combat.enemies[1].dead);
});
