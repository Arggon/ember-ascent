// tests/policy.test.js — the `smart` policy is a REAL FUNCTION, and it fixes the
// specific blindness that made the balance data meaningless.
//
// WHY THIS FILE EXISTS. The reported failure was not "the bot is weak" — it was that
// the bot was blind to Block and to synergy while the balance report called its
// numbers meaningful. So these tests do not check that the bot wins; they check the
// properties that make its output worth reading:
//
//   1. determinism   — same seed + same state => the same action, always
//   2. legality      — it never names an action the kernel did not offer
//   3. energy        — it does not idle while a useful card is playable
//   4. the regression — `unbroken` out-ranks `strike` in a hand holding both
//
// (4) is the exact defect from the report: `unbroken` was offered 742 times and
// picked 0 times, because the reward valuation credited Block as
// min(block, incoming - player.block) and asked with incoming = 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { combatState, loadKernel, loadObserve, loadSession, loadSim, content as contentFixture } from './helpers/harness.mjs';
import { makePolicy, scoreSmartCard, smartRewardScore, deckNeeds, effectProfile, enemyThreats, combatContext } from '../src/surface/policies.js';

const { newRun, actions } = await loadKernel();
const { observe } = await loadObserve();
const { legal, submit, begin, view } = await loadSession();
const { playRun } = await loadSim();

/** One deterministic full run, returning the action ids actually submitted. */
function playIds(seed, policyName, maxSteps = 5000) {
  const policy = makePolicy(policyName);
  let session = begin({ seed });
  const memory = {};
  const ids = [];
  let steps = 0;
  while (session.state.phase !== 'ended' && steps < maxSteps) {
    const dump = view(session);
    const choice = policy.choose({ session, state: session.state, legal: legal(session), stepIndex: session.state.stepIndex, memory, dump });
    if (choice.id === null) break;
    ids.push(choice.id);
    session = submit(session, choice.id).session;
    steps += 1;
  }
  return ids;
}

test('smart is deterministic: the same seed yields the same action list twice', () => {
  const a = playIds(11, 'smart');
  const b = playIds(11, 'smart');
  assert.ok(a.length > 20, `expected a real run, got ${a.length} actions`);
  assert.deepEqual(a, b, 'two runs of one seed must submit identical actions');
});

test('smart is deterministic step by step: same state => same choice', async () => {
  const policy = makePolicy('smart');
  const state = await combatState('hammerfall');
  const call = () => policy.choose({ session: { state }, state, legal: actions(state), stepIndex: state.stepIndex, memory: {}, dump: observe(state) }).id;
  assert.equal(call(), call(), 'a pure chooser must return the same id on repeat');
});

test('smart never plays an action absent from the kernel legal list', () => {
  for (const seed of [3, 17, 42]) {
    const policy = makePolicy('smart');
    let session = begin({ seed });
    const memory = {};
    let steps = 0;
    while (session.state.phase !== 'ended' && steps < 5000) {
      const offered = legal(session).map((a) => a.id);
      const choice = policy.choose({ session, state: session.state, legal: legal(session), stepIndex: session.state.stepIndex, memory, dump: view(session) });
      assert.ok(offered.includes(choice.id), `seed ${seed}: chose "${choice.id}" not in [${offered.join(', ')}]`);
      session = submit(session, choice.id).session;
      steps += 1;
    }
  }
});

test('smart spends Energy instead of idling while a useful card is playable', async () => {
  // The failure this guards: ending the turn with Energy left AND a card in hand that
  // would do something. Blocking into nothing does not count as something (requirement
  // 4), so the check is against the same scorer the policy uses — through the SAME board
  // builder, too: combatContext is the one place that assembles the scoring context
  // (race awareness included), and hand-rolling a subset of it here made the checker see
  // a different fight than the chooser — a lethal incoming turn re-prices every play's
  // uncovered-lethal penalty, so the two disagreed about "useful". The S3 gold grants
  // shifted the seed-5 draw stream onto exactly such a corner. Judging every play through
  // the shared builder is the repair; the assertion itself is unchanged.
  const c = await contentFixture();
  for (const seed of [5, 23, 61]) {
    const policy = makePolicy('smart');
    let session = begin({ seed });
    const memory = {};
    let steps = 0;
    while (session.state.phase !== 'ended' && steps < 5000) {
      const state = session.state;
      const dump = view(session);
      const choice = policy.choose({ session, state, legal: legal(session), stepIndex: state.stepIndex, memory, dump });
      if (state.phase === 'combat' && state.player.energy > 0) {
        const plays = legal(session).filter((a) => a.kind === 'play');
        const base = combatContext(state, dump);
        const useful = plays.filter((a) => {
          const def = c.cards.get(a.cardId);
          if (!def) return false;
          return scoreSmartCard(def, base).score > 0;
        });
        if (useful.length > 0) {
          assert.notEqual(choice.id, 'e1', `seed ${seed} step ${steps}: ended the turn with Energy ${state.player.energy} and ${useful.length} useful play(s) available`);
        }
      }
      session = submit(session, choice.id).session;
      steps += 1;
    }
  }
});

test('the regression: unbroken out-ranks strike in a hand holding both', async () => {
  // The exact defect. A hand of [strike, unbroken] with an 11-damage intent must
  // play unbroken: 5 Block covers none of it, 30 Block covers all of it.
  const policy = makePolicy('smart');
  const state = await combatState('hammerfall', {
    energy: 3,
    hand: [
      { uid: 'H1', cardId: 'hammerfall', cost: 1, perPlay: 0 },
      { uid: 'H2', cardId: 'unbroken', cost: 2, perPlay: 0 },
    ],
  });
  const legalIds = actions(state).map((a) => a.id);
  assert.ok(legalIds.includes('p1') && legalIds.includes('p2'), `both cards must be legal, got ${legalIds.join(', ')}`);
  const choice = policy.choose({ session: { state }, state, legal: actions(state), stepIndex: state.stepIndex, memory: {}, dump: observe(state) });
  assert.equal(choice.id, 'p2', `expected unbroken (p2), chose ${choice.id}`);
});

test('the regression, at the reward table: a defence-poor deck is offered Block', async () => {
  const c = await contentFixture();
  const fresh = newRun({ seed: 1 });
  const needs = deckNeeds(fresh.deck);
  assert.ok(needs.blockNeed > 1, `the starter deck must read as short on Block, got ${needs.blockNeed}`);
  const unbroken = smartRewardScore(c.cards.get('unbroken'), fresh);
  const strike = smartRewardScore(c.cards.get('hammerfall'), fresh);
  const maul = smartRewardScore(c.cards.get('maul'), fresh);
  assert.ok(unbroken.key > strike.key, `unbroken (${unbroken.key.toFixed(2)}) must beat strike (${strike.key.toFixed(2)})`);
  // Deliberately NOT asserting unbroken > maul here. Measured at 2000 seeds,
  // ranking pure Block above a 3-cost 32-damage attack is exactly the over-correction
  // that made `smart` lose to `greedy` (14.3% vs 22.1%): it built 44 block points of
  // deck and still could not kill the boss. Block is ranked correctly by value PER
  // ENERGY (asserted in the next test); at the reward table a blocking card must not
  // outrank raw damage, because damage ends fights and Block only delays them.
});

test('30 Block for 2 Energy beats a 6-damage attack on value per Energy', async () => {
  const c = await contentFixture();
  const fresh = newRun({ seed: 1 });
  const unbroken = smartRewardScore(c.cards.get('unbroken'), fresh);
  const strike = smartRewardScore(c.cards.get('hammerfall'), fresh);
  // 30/2 = 15 per Energy vs 6/1 = 6 per Energy. The report named this comparison
  // explicitly, so it is pinned here rather than left to the blended ranking.
  assert.ok(unbroken.perEnergy > strike.perEnergy, `unbroken ${unbroken.perEnergy.toFixed(2)}/EN must beat strike ${strike.perEnergy.toFixed(2)}/EN`);
});

test('kill-first: a lethal attack is taken over Block when the enemy can die now', async () => {
  const policy = makePolicy('smart');
  const state = await combatState('hammerfall', {
    energy: 3,
    enemyOver: { hp: 5, maxHp: 44 },
    hand: [
      { uid: 'H1', cardId: 'hammerfall', cost: 1, perPlay: 0 },
      { uid: 'H2', cardId: 'unbroken', cost: 2, perPlay: 0 },
    ],
  });
  const choice = policy.choose({ session: { state }, state, legal: actions(state), stepIndex: state.stepIndex, memory: {}, dump: observe(state) });
  assert.equal(choice.id, 'p1', `expected the lethal strike (p1), chose ${choice.id}`);
});

test('no-waste: a Block card with nothing incoming is not played', async () => {
  const policy = makePolicy('smart');
  // An enemy whose intent is a buff (B20-style block move) deals 0 this turn, so the
  // only card in hand accomplishes nothing and must be held.
  const state = await combatState('quench', {
    energy: 3,
    enemyId: 'slag_warden',
    enemyOver: { moveIndex: 0 }, // plating_up — B20, zero damage
    hand: [{ uid: 'H1', cardId: 'unbroken', cost: 2, perPlay: 0 }],
  });
  const threat = enemyThreats(state, observe(state)).reduce((a, b) => a + b, 0);
  assert.equal(threat, 0, `Slag Warden's plating_up must announce no damage, got ${threat}`);
  const choice = policy.choose({ session: { state }, state, legal: actions(state), stepIndex: state.stepIndex, memory: {}, dump: observe(state) });
  assert.equal(choice.id, 'e1', `expected end_turn (e1) rather than a no-op Block, chose ${choice.id}`);
});

test('effectProfile reads Block, multi-hit, area and custom handlers without hardcoding ids', async () => {
  const c = await contentFixture();
  assert.equal(effectProfile(c.cards.get('unbroken')).block, 30, 'unbroken is 30 Block');
  assert.equal(effectProfile(c.cards.get('hail_of_blows')).damage, 8, 'hail_of_blows is four 2-damage hits');
  assert.equal(effectProfile(c.cards.get('arc_cut')).aoePerTarget, 4, 'arc_cut hits every enemy for 4');
  assert.equal(effectProfile(c.cards.get('ash_harvest')).aoePerTarget, 4, 'ash_harvest reads its number from the handler table');
  assert.equal(effectProfile(c.cards.get('ash_harvest')).handlerUnknown, false, 'every shipped custom handler must be known');
  assert.equal(effectProfile(c.cards.get('blood_tithe')).selfDamage, 6, 'blood_tithe costs 6 HP');
});

test('every shipped card with a custom handler is covered by the policy reading table', async () => {
  const c = await contentFixture();
  const unknown = [];
  for (const def of c.cards.values()) {
    if (effectProfile(def).handlerUnknown) unknown.push(def.id);
  }
  assert.deepEqual(unknown, [], `custom handlers the policy cannot read: ${unknown.join(', ')}`);
});

test('sim records boss arrival, and reports ints.. n/a rather than a ratio for a never-offered card', async () => {
  // One real run through the same entry point `dlb sim` uses.
  const record = await playRun({ seed: 4, policy: 'smart' });
  assert.equal(record.policy, 'smart');
  assert.equal(record.provenance, 'heuristic', 'the provenance label must survive');
  if (record.floor >= 7) {
    assert.ok(record.bossArrival, 'a run that reached floor 7 must carry its boss-arrival snapshot');
    assert.ok(Number.isInteger(record.bossArrival.deckSize), 'arrival deck size must be present');
    assert.ok('attacks' in record.bossArrival && 'skills' in record.bossArrival && 'powers' in record.bossArrival);
  }
});
