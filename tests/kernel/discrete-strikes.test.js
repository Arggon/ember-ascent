// tests/kernel/discrete-strikes.test.js — the slice "golpes discretos NxM".
//
// The base rule was already true (an NxM attack resolves as M discrete golpes, block
// soaks golpe a golpe); this slice makes that math VISIBLE and adds the first effects
// that react PER GOLPE. The pins below hold the design contract, point by point:
//
//   PARRY — every stack is a 1% whole-strike dodge, rolled per golpe and ONLY when the
//   defender holds stacks: exactly 1 draw per defended strike (intAt over the LIVE
//   counter), ZERO draws without parry, a proc lands nothing (dealt 0, blocked = raw,
//   the block pool NOT consumed, HP untouched) and spends nothing (a chance, not a
//   pool, lasting the whole fight). Symmetric: hero and enemies both roll it.
//
//   BLEED — the ATTACKER loses `stacks` HP after every golpe it executes (a parried
//   strike still executed), one stack per tick, gone at zero. The hero's tick floors
//   at 1 HP (no DoT kills the hero in v1); an enemy CAN bleed out and its remaining
//   golpes are cancelled. Ticks consume ZERO draws.
//
//   POISON — StS style: at the END of the holder's own turn, `stacks` HP straight off,
//   then one stack off. Hero tick inside endOfTurnStatuses (before the decay sweep,
//   floor 1); enemy tick at the close of the enemy turn beside the decay (it CAN kill).
//   Zero interaction with the multi-golpe loop; zero draws.
//
//   ALCANCE v1 — the exotic handlers (blood_hammer/ash_harvest/climbing_heat) and potion_damage
//   stay OUTSIDE the fold: a strike there rolls no parry and ticks no bleed.
//
//   EVENTS — the golpe order with reactions: [parry roll] -> [damage] -> [the
//   attacker's bleed tick]; bleed_tick/poison_tick carry `index` only for who='enemy'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { combatState, content, loadKernel, loadPower, loadRng, loadVocabulary } from '../helpers/harness.mjs';

const K = await loadKernel();
const { freezeDeep } = await import('../../src/kernel/state.js');
const { intAt } = await loadRng();
const P = await loadPower();
const V = await loadVocabulary();
const C = await content();

const endTurn = (state) => K.step(state, 'e1');

/** rngDraws delta of one step, so every draw accounting below is a measured fact. */
const draws = (before, res) => res.state.rngDraws - before.rngDraws;

/* ----------------------------------------------------------------- parry: the roll */

test('parry 100 refuses the whole golpe: dealt 0, blocked = raw, HP untouched', async () => {
  // Cinder Maw maw_chomp (A11) into a hero holding Parry 100 — a guaranteed proc.
  const s = freezeDeep(await combatState('quench', { enemyOver: { moveIndex: 0 }, statuses: { parry: 100 } }));
  const res = endTurn(s);
  const hit = res.events.find((e) => e.t === 'enemy_attack');
  assert.deepEqual(hit, {
    t: 'enemy_attack', enemy: 0, raw: 11, dealt: 0, blocked: 11, hp: 60, parried: true,
  }, 'the strike event carries parried:true and lands nothing');
  assert.equal(res.state.player.hp, 60, 'HP untouched');
  assert.equal(res.state.player.block, 0, 'the block pool is not consumed (the hero held none)');
});

test('the parry roll costs exactly 1 draw per defended golpe, zero without parry (measured)', async () => {
  const withParry = freezeDeep(await combatState('quench', { enemyOver: { moveIndex: 0 }, statuses: { parry: 100 } }));
  const without = freezeDeep(await combatState('quench', { enemyOver: { moveIndex: 0 } }));
  const a = endTurn(withParry);
  const b = endTurn(without);
  const diff = draws(withParry, a) - draws(without, b);
  assert.equal(diff, 1, `one defended golpe = one draw (parry ${draws(withParry, a)} vs control ${draws(without, b)})`);
});

test('a defended MULTI-GOLPE move rolls once per golpe: shield_spin A5x3 = exactly 3 draws', async () => {
  // The Slag Warden's script opens plating_up -> piston_bash -> shield_spin; stand the
  // fight at the shield_spin step directly.
  const withParry = freezeDeep(await combatState('quench', {
    enemyId: 'slag_warden', enemyOver: { moveIndex: 3, intentStep: 3 }, statuses: { parry: 100 },
  }));
  const without = freezeDeep(await combatState('quench', {
    enemyId: 'slag_warden', enemyOver: { moveIndex: 3, intentStep: 3 },
  }));
  const a = endTurn(withParry);
  const b = endTurn(without);
  const hits = a.events.filter((e) => e.t === 'enemy_attack');
  assert.equal(hits.length, 3, 'three golpes');
  assert.ok(hits.every((h) => h.parried && h.dealt === 0 && h.blocked === 5), 'each golpe refused whole, blocked = its own raw');
  assert.equal(a.state.player.hp, 60);
  assert.equal(draws(withParry, a) - draws(without, b), 3, 'M golpes = exactly M parry draws');
});

test('the proc rule IS the roll: proc === intAt(seed, liveDraws, 100) < charges', async () => {
  // Deterministic proof on two seeds: compute the roll the helper will read, then check
  // a low-parry hero procs exactly when the roll is under the charges.
  const checked = { proc: 0, noProc: 0 };
  for (let seed = 1; seed <= 40 && (checked.proc === 0 || checked.noProc === 0); seed += 1) {
    const s = await combatState('quench', { enemyOver: { moveIndex: 0 }, statuses: { parry: 20 }, seed });
    const roll = intAt(seed, s.rngDraws, 100);
    const res = endTurn(freezeDeep(s));
    const procced = res.events.find((e) => e.t === 'enemy_attack').parried === true;
    assert.equal(procced, roll < 20, `seed ${seed}: proc must equal roll < charges`);
    checked[procced ? 'proc' : 'noProc'] += 1;
  }
  assert.ok(checked.proc > 0 && checked.noProc > 0, 'both outcomes were actually exercised');
});

test('an enemy with parry rolls against the hero\u2019s golpes too — symmetric (1 draw per golpe)', async () => {
  const armored = freezeDeep(await combatState('hammerfall', { enemyOver: { statuses: { parry: 100 } } }));
  const bare = freezeDeep(await combatState('hammerfall', { enemyOver: {} }));
  const a = K.step(armored, 'p1');
  const b = K.step(bare, 'p1');
  const hit = a.events.find((e) => e.t === 'damage');
  assert.deepEqual(hit, {
    t: 'damage', source: 'player', target: 0, raw: 6, dealt: 0, blocked: 6, hp: 40, parried: true,
  }, 'the hero\u2019s strike is refused whole, parried:true on the damage event');
  assert.equal(a.state.combat.enemies[0].hp, 40);
  assert.equal(draws(armored, a) - draws(bare, b), 1, 'the hero\u2019s single golpe paid exactly one draw');
});

test('a proc spends nothing and a non-proc still soaks through the pool — parry is a chance, not a shield', async () => {
  // The end-of-step state cannot carry this pin (beginTurn resets the hero's Block
  // before the step returns), so the pool fact is read two ways: off the strike event
  // and off a direct attackHit call, which is the exact fold the runner runs.
  const procced = freezeDeep(await combatState('quench', {
    enemyOver: { moveIndex: 0 }, statuses: { parry: 100 }, block: 10,
  }));
  const a = endTurn(procced);
  const hit = a.events.find((e) => e.t === 'enemy_attack');
  assert.equal(hit.blocked, 11, 'blocked = raw: the whole strike refused');
  assert.equal(hit.dealt, 0, 'nothing spilled past a pool that held 10');
  const unit = V.attackHit({
    seed: 5, rngDraws: 0,
    player: { hp: 60, maxHp: 60, block: 10, statuses: { parry: 100 } },
    combat: { enemies: [{ id: 'x', hp: 40, maxHp: 40, block: 0, statuses: {}, dead: false }] },
  }, { attacker: 'enemy', attackerIndex: 0, raw: 11 });
  assert.equal(unit.state.player.block, 10, 'a parried golpe never touches the pool itself');
  assert.equal(unit.state.player.hp, 60);
  // A parry the roll refuses (0 charges here) resolves like any strike: the pool works.
  const refused = freezeDeep(await combatState('quench', {
    enemyOver: { moveIndex: 0 }, statuses: { parry: 0 }, block: 10,
  }));
  const b = endTurn(refused);
  assert.equal(b.events.find((e) => e.t === 'enemy_attack').dealt, 1, 'the pool absorbed 10 and 1 spilled');
});

test('parry never decays — it lasts the whole fight (and the other statuses do not ride the decay sweep)', () => {
  const swept = P.decayStatuses({ statuses: { vulnerable: 1, weak: 2, parry: 6, bleed: 3, poison: 2, strength: 1 } });
  assert.deepEqual(swept.statuses, { weak: 1, parry: 6, bleed: 3, poison: 2, strength: 1 },
    'the sweep touches vulnerable/weak ONLY (-1 each); parry/bleed/poison/buffs are untouched');
});

/* ---------------------------------------------------------------- bleed: the ticks */

test('NxM = M ticks: bleed 4 through a 3-hit card ticks 4, 3, 2 and stops at zero', async () => {
  const s = freezeDeep(await combatState('cinder_flick', { statuses: { bleed: 4 } }));
  const res = K.step(s, 'p1');
  const ticks = res.events.filter((e) => e.t === 'bleed_tick');
  assert.deepEqual(ticks, [
    { t: 'bleed_tick', who: 'player', amount: 4, hp: 56, remaining: 3 },
    { t: 'bleed_tick', who: 'player', amount: 3, hp: 53, remaining: 2 },
    { t: 'bleed_tick', who: 'player', amount: 2, hp: 51, remaining: 1 },
  ], 'one tick per golpe, one stack per tick, gone at zero');
  assert.equal(res.state.player.hp, 51, '4+3+2 straight off (60 -> 51)');
  assert.deepEqual(res.state.player.statuses, { bleed: 1 }, 'one stack left after three ticks');
  assert.equal(draws(s, res), 0, 'ticks consume ZERO draws (the card itself rolls nothing)');
});

test('the tick order per golpe: [damage] -> [bleed_tick], interleaved over a multi-hit', async () => {
  const s = freezeDeep(await combatState('cinder_flick', { statuses: { bleed: 4 } }));
  const res = K.step(s, 'p1');
  assert.deepEqual(
    res.events.map((e) => `${e.t}${e.who ? `:${e.who}` : ''}`),
    ['damage', 'bleed_tick:player', 'damage', 'bleed_tick:player', 'damage', 'bleed_tick:player'],
    'the fold is per golpe: the strike, then the attacker\u2019s tick',
  );
});

test('a parried golpe still executed — the attacker\u2019s bleed ticks anyway', async () => {
  // The hero bleeds 2 and strikes an enemy holding Parry 100: the strike is refused,
  // the tick is not (rule 4: parry covers attack golpes, never ticks).
  const s = freezeDeep(await combatState('hammerfall', { statuses: { bleed: 2 }, enemyOver: { statuses: { parry: 100 } } }));
  const res = K.step(s, 'p1');
  const hit = res.events.find((e) => e.t === 'damage');
  assert.equal(hit.parried, true);
  assert.deepEqual(
    res.events.find((e) => e.t === 'bleed_tick'),
    { t: 'bleed_tick', who: 'player', amount: 2, hp: 58, remaining: 1 },
  );
  assert.equal(res.state.player.hp, 58);
  assert.equal(res.state.combat.enemies[0].hp, 40);
});

test('the hero\u2019s bleed floors at 1 HP — no DoT kills the hero in v1', async () => {
  const s = freezeDeep(await combatState('hammerfall', { hp: 3, statuses: { bleed: 5 } }));
  const res = K.step(s, 'p1');
  const tick = res.events.find((e) => e.t === 'bleed_tick');
  assert.equal(tick.amount, 5);
  assert.equal(tick.hp, 1, 'floored at 1, not 0');
  assert.equal(res.state.player.hp, 1);
  assert.equal(res.state.phase, 'combat', 'the hero stood through his own bleed');
});

test('an attacker felled by its own bleed cancels the golpes it has left', async () => {
  // Slag Crawler pincers (A4x2) bleeding 5 on 2 HP: golpe 1 lands, the tick kills the
  // striker, golpe 2 never fires. The kill settles the fight, so the corpse is read
  // off the events (resolveVictory empties the field).
  const s = freezeDeep(await combatState('quench', {
    enemyId: 'slag_crawler', enemyOver: { moveIndex: 1, hp: 2, maxHp: 2, statuses: { bleed: 5 } },
  }));
  const res = endTurn(s);
  const attacks = res.events.filter((e) => e.t === 'enemy_attack');
  assert.equal(attacks.length, 1, 'one golpe, then the striker died');
  assert.deepEqual(res.events.filter((e) => e.t === 'bleed_tick'),
    [{ t: 'bleed_tick', who: 'enemy', index: 0, amount: 5, hp: 0, remaining: 4 }]);
  assert.equal(attacks[0].hp, 56, 'only the first golpe\u2019s 4 damage landed');
  assert.ok(res.events.some((e) => e.t === 'combat_won'), 'the felled striker ends the fight');
});

test('the enemy\u2019s bleed ticks per golpe too, and the event is index-stamped', async () => {
  // Slag Crawler pincers (2 golpes) bleeding 2 on full HP: two ticks, 2 then 1.
  const s = freezeDeep(await combatState('quench', {
    enemyId: 'slag_crawler', enemyOver: { moveIndex: 1, statuses: { bleed: 2 } },
  }));
  const res = endTurn(s);
  assert.deepEqual(res.events.filter((e) => e.t === 'bleed_tick'), [
    { t: 'bleed_tick', who: 'enemy', index: 0, amount: 2, hp: 30, remaining: 1 },
    { t: 'bleed_tick', who: 'enemy', index: 0, amount: 1, hp: 29, remaining: 0 },
  ]);
  assert.deepEqual(res.state.combat.enemies[0].statuses, {}, 'the status is gone at zero');
});

/* ---------------------------------------------------------------- poison: turn ends */

test('the hero\u2019s poison ticks at HIS turn end, one stack per tick, floored at 1', async () => {
  const s = freezeDeep(await combatState('quench', {
    enemyId: 'slag_warden', enemyOver: { moveIndex: 0, intentStep: 0 }, statuses: { poison: 3 }, hp: 50,
  }));
  const res = endTurn(s);
  // Slag Warden's script opens plating_up (B20) — no damage muddies the tick.
  assert.deepEqual(
    res.events.find((e) => e.t === 'poison_tick'),
    { t: 'poison_tick', who: 'player', amount: 3, hp: 47, remaining: 2 },
  );
  assert.deepEqual(res.state.player.statuses, { poison: 2 });
  assert.equal(res.state.player.hp, 47);
});

test('the hero\u2019s poison tick sits INSIDE endOfTurnStatuses, before the decay sweep', async () => {
  // Metallicize first (block), then poison, then decay (vulnerable) — the contract's
  // hero-close order, read straight off the event list of one endTurn.
  const s = freezeDeep(await combatState('quench', {
    enemyId: 'slag_warden', enemyOver: { moveIndex: 0, intentStep: 0 },
    statuses: { poison: 2, metallicize: 4, vulnerable: 1 }, hp: 50,
  }));
  const res = endTurn(s);
  assert.deepEqual(
    res.events.filter((e) => ['block', 'poison_tick'].includes(e.t)).map((e) => [e.t, e.amount ?? e.stacks]),
    [['block', 4], ['poison_tick', 2]],
  );
  assert.deepEqual(res.state.player.statuses, { poison: 1, metallicize: 4 },
    'vulnerable decayed away; poison decremented by its own tick, not the sweep; the buff persists');
});

test('the enemies\u2019 poison ticks at THEIR turn close, beside the decay — and it can kill', async () => {
  const s = freezeDeep(await combatState('kiln_fume', { enemies: undefined }));
  const frail = { ...s.combat.enemies[0], hp: 3, maxHp: 3, statuses: { poison: 4, vulnerable: 1 } };
  const one = freezeDeep({ ...s, combat: { ...s.combat, enemies: [{ ...frail, index: 0 }] } });
  const res = endTurn(one);
  const tick = res.events.find((e) => e.t === 'poison_tick');
  assert.deepEqual(tick, { t: 'poison_tick', who: 'enemy', index: 0, amount: 4, hp: 0, remaining: 3 },
    'the tick is index-stamped and lands the full stacks');
  assert.ok(res.events.some((e) => e.t === 'combat_won'), 'a foe felled by its own poison is dead, and the all-dead field settles');
});

test('poison has zero interaction with the multi-golpe loop — one tick per turn end, not per golpe', async () => {
  // A poisoned HERO facing the shield_spin (3 golpes): his poison ticks ONCE per turn end
  // (his own), no matter how many golpes flew.
  const s = freezeDeep(await combatState('quench', {
    enemyId: 'slag_warden', enemyOver: { moveIndex: 3, intentStep: 3 }, statuses: { poison: 2 }, hp: 60,
  }));
  const res = endTurn(s);
  assert.equal(res.events.filter((e) => e.t === 'enemy_attack').length, 3);
  assert.deepEqual(
    res.events.filter((e) => e.t === 'poison_tick' && e.who === 'player'),
    [{ t: 'poison_tick', who: 'player', amount: 2, hp: 58, remaining: 1 }],
    'exactly one hero tick per turn end, before the golpes (his close comes first)');
  const next = endTurn(freezeDeep(res.state));
  const ticks = next.events.filter((e) => e.t === 'poison_tick' && e.who === 'player');
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].amount, 1, 'the stacks decremented: 2, then 1');
});

test('both sides tick in one endTurn: the hero first, the enemies after their turn', async () => {
  const s = freezeDeep(await combatState('kiln_fume', {
    enemyId: 'slag_crawler', enemyOver: { moveIndex: 1, statuses: { poison: 2 } }, // pincers (A4x2)
    statuses: { poison: 3 }, hp: 60,
  }));
  // The fume's poison lands on the crawler (poison 4), topped up to 6; the hero holds 3.
  const played = K.step(s, 'p1');
  const both = freezeDeep(played.state);
  const res = endTurn(both);
  const order = res.events.filter((e) => e.t === 'poison_tick').map((e) => e.who);
  assert.deepEqual(order, ['player', 'enemy'], 'hero tick first (his turn end), enemy tick after the enemy turn');
  const enemyTick = res.events.find((e) => e.t === 'poison_tick' && e.who === 'enemy');
  assert.deepEqual(enemyTick, { t: 'poison_tick', who: 'enemy', index: 0, amount: 6, hp: 26, remaining: 5 },
    'the crawler spawns at 32 (its low HP roll), the 6-stack tick takes it to 26');
  assert.equal(res.events.filter((e) => e.t === 'enemy_attack').length, 2, 'poison never touches the golpe loop');
});

/* ------------------------------------------------- alcance v1: what stays OUTSIDE */

test('ALCANCE v1: the exotic handlers stay outside the fold — blood_hammer rolls no parry and ticks no bleed', async () => {
  // The enemy holds Parry 100 and the hero holds Bleed 2: a blood_hammer strike must
  // land plainly — no roll (zero draws), no hex refusal, no tick.
  const s = freezeDeep(await combatState('blood_hammer', {
    hp: 40, statuses: { bleed: 2 }, enemyOver: { statuses: { parry: 100 } },
  }));
  const res = K.step(s, 'p1');
  const hit = res.events.find((e) => e.t === 'damage');
  assert.equal(hit.parried, undefined, 'no parry roll ever happened');
  assert.equal(hit.dealt, 15, 'the strike landed in full');
  assert.equal(res.events.some((e) => e.t === 'bleed_tick'), false, 'no bleed tick outside the canonical loops');
  assert.equal(draws(s, res), 0, 'and it consumed zero draws');
});

test('ALCANCE v1: the shared helper is exported for the two canonical loops only — the vocabulary still folds through playerStrike', () => {
  // The damage verb's per-golpe number is unchanged by the slice: Strength and Weak
  // fold exactly as before (a status-fold pin, restated here so the slice cannot
  // quietly move the math it wrapped).
  const per = V.playerStrike(6, { statuses: { strength: 2, weak: 1 } });
  assert.equal(per, 6, 'add, then multiply, floored: floor(8 x 3/4)');
  assert.equal(typeof V.attackHit, 'function', 'attackHit is the one shared fold');
  assert.deepEqual(C.cards.get('slag_barb').effects.map((e) => e.verb), ['damage', 'status'],
    'the new bleed card is plain vocabulary — no custom handler');
});

/* --------------------------------------------------------------- events contract */

test('the tick events carry `index` ONLY for who="enemy" (the contract\u2019s shape)', async () => {
  const heroSide = freezeDeep(await combatState('cinder_flick', { statuses: { bleed: 1 } }));
  const a = K.step(heroSide, 'p1');
  for (const e of a.events.filter((x) => x.t === 'bleed_tick')) {
    assert.equal(e.who, 'player');
    assert.equal('index' in e, false, 'a player tick is not indexed');
    assert.equal(typeof e.amount, 'number');
    assert.equal(typeof e.hp, 'number');
    assert.equal(typeof e.remaining, 'number');
  }
  const enemySide = freezeDeep(await combatState('quench', {
    enemyId: 'slag_crawler', enemyOver: { moveIndex: 1, statuses: { bleed: 1 } },
  }));
  const b = endTurn(enemySide);
  const tick = b.events.find((e) => e.t === 'bleed_tick');
  assert.equal(tick.who, 'enemy');
  assert.equal(tick.index, 0, 'an enemy tick is index-stamped');
});
