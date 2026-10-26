// S6 events: the placed nodes, the drawn stories, the choices and their consequences.
//
// Pins:
//   - Exactly TWO event nodes per generated act map, at rows 2 and 6's placed slots,
//     reachable from every node of the rows before them (full-row linking), labelled
//     through NODE_TYPES like any other node. Neither slot is its row's first node, so
//     a first-travel walker passes the wayside by construction. Their encounter-table
//     entries spawn nothing and consume no draw.
//   - WHICH event a node holds rolls at ENTRY: exactly ONE draw, same seed => same
//     story, every roster id reachable across seeds, and the roll reproduces
//     byte-identically from the pre-entry counter (the shop's own convention).
//   - Choice effects compose the existing paths and events: gold through the purse
//     ({t:'gold'} gains, {t:'gold_spent'} spends), HP losses through the non-combat
//     loseHp path ({t:'hp_cost'}, never below 1 — an event cannot kill), heals clamped
//     like a rest site ({t:'heal'}), card adds through the deck-append path
//     ({t:'card_taken'}/{t:'card_bought'}), removals through the S4 path
//     ({t:'card_removed'}), potion grants through the belt-append path ({t:'potion_drop'}).
//   - Draw accounting: entry 1; stoke/ember/potion/sell exactly 1 at resolution; the
//     zero-cost choices, the modal pick and the continue exactly 0; the temper offer
//     roll is the rest site's own builder (6 for a full three-card offer).
//   - Requirements are R6 afford-filters: an unmet choice emits NO action id (forcing
//     it is the one legal-no-op rejection) but stays visible in the snapshot with the
//     reason — the shop's inert-shelf contract.
//   - The resolved beat: the phase STAYS event with exactly one continue action; the
//     continue closes the phase, nulls the event state and consumes the node.
//   - The smith's temper modal reuses the rest site's offer builder byte-for-byte, is
//     committed (no back-out, the paid-removal precedent), and is gated like a rest
//     site (tempers opt-in, at least one temperable card).
//   - Torn saves degrade and never softlock: a null/absent/unknown event field offers
//     exactly the continue; a garbage modal offer shortens the modal instead of
//     enumerating a refused id; an unknown-id belt still blocks the peddler's bottle
//     at capacity; a legacy save (no event field, no event nodes) never meets the phase.
//   - A real run that walks the wayside, chooses, and continues replays hash-for-hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, content as contentFixture } from '../helpers/harness.mjs';
import { begin, submit, legal, saveObject, loadObject, renderLog, parseLog, assertReplay, runHash } from '../../src/surface/session.js';
import { makePolicy } from '../../src/surface/policies.js';
import { EVENT_ROSTER, eventDef, offerEventChoices, rollEventAt, EMBER_PRICE, POTION_PRICE, SELL_GAIN, SHAFT_GOLD, SHAFT_HP, TORCH_PRICE, TORCH_HEAL, FORGE_HP, STORIES_HEAL, EVENT_DECK_FLOOR } from '../../src/kernel/rules/events.js';
import { EVENT_NODES, NODE_TYPES } from '../../src/kernel/rules/map.js';
import { POTION_SLOTS } from '../../src/kernel/rules/potions.js';

const K = await loadKernel();
const { newRun, step, actions, observe, snapshot, hash, validateSave } = K;
const C = await contentFixture();

/** Open the row-2 event from a fresh run (or from `base` patched by `over`). */
function eventVisit(seed, over = {}) {
  const base = over.base ?? newRun({ seed, tempers: over.tempers ?? false });
  const staged = {
    ...base,
    floor: over.floor ?? 1,
    mapNodeId: over.from ?? 'r1n0',
    player: { ...base.player, ...(over.player ?? {}) },
    ...(over.state ?? {}),
  };
  const travel = actions(staged).find((a) => a.nodeType === 'event');
  assert.ok(travel, 'the event node is travel-legal from row 1');
  const out = step(staged, travel.id);
  assert.equal(out.error, null);
  return out.state;
}

/** Find a seed whose row-2 event is `id`, opening it with the same overrides. */
function eventOf(id, over = {}) {
  for (let seed = 0; seed < 60; seed += 1) {
    const s = eventVisit(seed, over);
    if (s.event.id === id) return s;
  }
  return null;
}

test('every generated act map holds exactly two events, at rows 2 and 6, reachable from the rows before them', () => {
  for (let seed = 0; seed < 60; seed += 1) {
    const s = newRun({ seed });
    const events = s.map.rows.flat().filter((n) => n.type === 'event');
    assert.equal(events.length, 2, `seed ${seed}: exactly two event nodes`);
    assert.deepEqual(events.map((n) => n.id).sort(), EVENT_NODES.map((e) => `r${e.row}n${e.slot}`).sort(),
      `seed ${seed}: the events sit on the placed slots`);
    // Full-row linking: every node of the row before each event connects to it.
    for (const { row } of EVENT_NODES) {
      for (const n of s.map.rows[row - 1]) {
        assert.ok(n.next.includes(`r${row}n${EVENT_NODES.find((e) => e.row === row).slot}`),
          `seed ${seed}: ${n.id} links to the row-${row} event`);
      }
    }
    // Neither event is its row's first node: a first-travel walker passes the wayside.
    for (const { row, slot } of EVENT_NODES) {
      assert.ok(slot > 0, `seed ${seed}: the row-${row} event is not the first travel of its row`);
    }
    // And no other row grew an event.
    for (let r = 0; r < s.map.rows.length; r += 1) {
      const want = EVENT_NODES.some((e) => e.row === r) ? 1 : 0;
      assert.equal(s.map.rows[r].filter((n) => n.type === 'event').length, want, `seed ${seed}: row ${r}`);
    }
  }
  // The node type is labelled like any other: the CLI map dump and the snapshot map
  // both read NODE_TYPES[n.type].label.
  assert.equal(NODE_TYPES.event.label, 'event');
  const snapMap = snapshot(newRun({ seed: 1 })).map;
  const eventNode = snapMap.rows[2].find((n) => n.type === 'event');
  assert.equal(eventNode.label, 'event');
  assert.ok(!eventNode.available, 'row 2 is not available at run start');
});

test('the event opens from a real travel step: one draw decides the story, deterministically', () => {
  const pre = { ...newRun({ seed: 11 }), floor: 1, mapNodeId: 'r1n0' };
  const s = eventVisit(11);
  assert.equal(s.phase, 'event');
  assert.equal(s.mapNodeId, 'r2n1');
  assert.equal(s.rngDraws - pre.rngDraws, 1, 'entry consumed exactly ONE draw (the which-event roll)');
  assert.ok(eventDef(s.event.id), 'the drawn id is on the roster');
  assert.equal(s.event.resolved, null);
  assert.equal(s.event.tempering, false);
  // Same seed => same story, from the same counter position.
  assert.equal(eventVisit(11).event.id, s.event.id);
  // The entry roll reproduces byte-identically from the pre-entry counter — the
  // property that makes the draw replayable from the action log forever.
  const rerolled = rollEventAt({ ...s, rngDraws: s.rngDraws - 1 });
  assert.equal(rerolled.id, s.event.id);
  assert.equal(rerolled.draws, 1);
  // The encounter-table entry spawns nothing and pays nothing.
  const entry = s.map.encounterTable[s.mapNodeId];
  assert.deepEqual(entry.spawn, [], 'the wayside keeps no enemies');
  assert.equal(entry.reward, 'event');
});

test('all four roster events occur across seeds, each with 2-3 choices and story text', () => {
  const seen = new Set();
  for (let seed = 0; seed < 40; seed += 1) seen.add(eventVisit(seed).event.id);
  assert.deepEqual([...seen].sort(), EVENT_ROSTER.map((e) => e.id).sort(), 'every roster event was met');
  for (const def of EVENT_ROSTER) {
    assert.ok(def.choices.length >= 2 && def.choices.length <= 3, `${def.id}: 2-3 choices`);
    assert.ok(def.story.length > 40, `${def.id}: a story worth reading`);
    assert.ok(def.choices.some((c) => c.cost === null && c.hpLoss === null && !c.req),
      `${def.id}: at least one zero-cost unconditional choice (the phase always resolves)`);
  }
});

test('the dump shows the story, the choices with costs, and the unmet requirements', () => {
  const poor = eventOf('sleeping_forge', { player: { gold: 10 } });
  const dump = observe(poor);
  assert.match(dump, /EVENT — The Sleeping Forge/);
  assert.match(dump, /"A forge sleeps under a skin of grey ash/);
  assert.match(dump, / v1 Stoke it awake — 8 HP/);
  assert.match(dump, / v2 Leave it sleeping/);
  assert.match(dump, / v3 Buy the ember — 30g \[needs 30 gold\]/);
  // The action lines stay id + slug (cost lives in the dump, the Energy ruling).
  assert.deepEqual(actions(poor).map((a) => a.id), ['v1', 'v2']);
});

test('Sleeping Forge — stoke pays HP through the loseHp path and appends a pool card; leave does nothing for free', () => {
  const s0 = eventOf('sleeping_forge');
  // Draw accounting: the stoke resolution is exactly ONE draw (the uncommon pick).
  const pre = { ...s0 };
  const deck0 = s0.deck.length;
  const hp0 = s0.player.hp;
  let s = step(s0, 'v1').state;
  assert.equal(s.rngDraws - pre.rngDraws, 1, 'the stoke consumed exactly one draw');
  assert.equal(s.deck.length, deck0 + 1, 'the deck grew by the card');
  assert.ok(s.deck.at(-1).cardId !== 'strike', 'the gained card comes from the draft pool, not the starters');
  assert.equal(C.cards.get(s.deck.at(-1).cardId).rarity, 'uncommon', 'the gained card is Uncommon');
  assert.equal(s.player.hp, Math.max(1, hp0 - FORGE_HP), `the coals took ${FORGE_HP} HP (floored at 1, never killing)`);
  assert.ok(s.event.resolved, 'the phase moved to the resolved beat');
  // The event stream: hp_cost then card_taken, the paths their combat/reward counterparts use.
  const out = step(pre, 'v1');
  assert.deepEqual(out.events.map((e) => e.t), ['hp_cost', 'card_taken']);
  assert.equal(out.events[0].source, 'event');
  // Leave it: zero draws, zero state movement beyond the beat.
  const idle = eventOf('sleeping_forge', { seedFix: null });
  const idlePre = { ...idle };
  const left = step(idle, 'v2').state;
  assert.equal(left.rngDraws - idlePre.rngDraws, 0, 'the leave consumed nothing');
  assert.equal(left.deck.length, idle.deck.length);
  assert.equal(left.player.hp, idle.player.hp);
  assert.deepEqual(left.event.resolved.lines, ['- Nothing happens.']);
});

test('Sleeping Forge — the ember costs exactly 30 and grants a Rare; a poor purse gets no id and forcing it is the R6 rejection', () => {
  const rich = eventOf('sleeping_forge', { player: { gold: 99 } });
  const ids = actions(rich).map((a) => a.id);
  assert.ok(ids.includes('v3'), 'the purse covers the ember: the id exists');
  const pre = { ...rich };
  const deck0 = rich.deck.length;
  let s = step(rich, 'v3').state;
  assert.equal(s.player.gold, 99 - EMBER_PRICE, 'the price left the purse');
  assert.equal(s.deck.length, deck0 + 1);
  assert.equal(C.cards.get(s.deck.at(-1).cardId).rarity, 'rare', 'the ember is a Rare');
  assert.equal(s.rngDraws - pre.rngDraws, 1, 'the ember consumed exactly one draw');
  const out = step(pre, 'v3');
  assert.deepEqual(out.events.map((e) => e.t), ['gold_spent', 'card_bought']);

  const poor = eventOf('sleeping_forge', { player: { gold: EMBER_PRICE - 1 } });
  assert.ok(!actions(poor).some((a) => a.id === 'v3'), 'an unaffordable choice is not an action');
  const snapChoices = snapshot(poor).event.choices;
  assert.equal(snapChoices.find((c) => c.slug === 'ember').actionId, null, 'the dimmed choice carries no id');
  assert.equal(snapChoices.find((c) => c.slug === 'ember').reason, `needs ${EMBER_PRICE} gold`, 'and says why');
  const forced = step(poor, 'v3');
  assert.equal(forced.error?.code, 2, 'forcing it is the R6 rejection');
  assert.equal(forced.error?.error, 'illegal_action');
  assert.equal(forced.state, poor, 'a rejected choice does not move the state');
});

test('Ash Peddler — the bottle costs 40 and lands a table potion; a full belt (stale ids included) gets no id', () => {
  const s0 = eventOf('ash_peddler', { player: { gold: 99 } });
  const pre = { ...s0 };
  let s = step(s0, 'v1').state;
  assert.equal(s.player.gold, 99 - POTION_PRICE);
  assert.equal(s.potions.length, 1, 'the bottle joined the belt');
  assert.ok(s.event.resolved.lines.some((l) => l.includes('bottle')), 'the beat names the bottle');
  assert.equal(s.rngDraws - pre.rngDraws, 1, 'the bottle consumed exactly one draw');
  const out = step(pre, 'v1');
  assert.deepEqual(out.events.map((e) => e.t), ['gold_spent', 'potion_drop']);
  assert.equal(out.events[1].potion, s.potions[0]);
  assert.equal(out.events[1].source, 'event');

  // A full belt blocks the choice — and stale ids count toward the belt the same way
  // the victory drop's suppression counts them (the S5 torn-belt degrade, never a throw).
  const full = eventOf('ash_peddler', {
    player: { gold: 999 },
    state: { potions: ['deleted_flask', 'deleted_flask', 'deleted_flask'] },
  });
  assert.equal(actions(full).some((a) => a.slug === 'potion'), false, 'three stale ids fill the belt');
  const snapFull = snapshot(full).event.choices.find((c) => c.slug === 'potion');
  assert.equal(snapFull.reason, 'your belt is full');
  const half = eventOf('ash_peddler', {
    player: { gold: 999 },
    state: { potions: ['deleted_flask'] },
  });
  const buy = actions(half).find((a) => a.slug === 'potion');
  assert.ok(buy, 'one stale slot leaves room, and the choice is a button');
  const after = step(half, buy.id).state;
  assert.equal(after.potions.length, 2, 'the fresh potion rides beside the stale one');
});

test('Ash Peddler — the sale removes one seeded Common/Uncommon instance for exactly 50 gold, above the deck floor only', () => {
  // Fixture: a deck of starters plus two sellable instances (anger = Common).
  const deck = [...newRun({ seed: 8 }).deck, { uid: 'sell-1', cardId: 'anger' }, { uid: 'sell-2', cardId: 'cleave' }];
  const s0 = eventOf('ash_peddler', { base: newRun({ seed: 8 }), state: { deck }, floor: 1, from: 'r1n0' });
  const pre = { ...s0 };
  const purse0 = s0.player.gold;
  let s = step(s0, 'v2').state;
  assert.equal(s.rngDraws - pre.rngDraws, 1, 'the sale consumed exactly one draw (the target pick)');
  assert.equal(s.deck.length, deck.length - 1, 'exactly one instance left the deck');
  const gone = deck.find((c) => !s.deck.some((x) => x.uid === c.uid));
  assert.ok(['sell-1', 'sell-2'].includes(gone.uid), 'the removal target was one of the sellable instances');
  assert.equal(C.cards.get(gone.cardId).rarity === 'common' || C.cards.get(gone.cardId).rarity === 'uncommon', true);
  assert.equal(s.player.gold, purse0 + SELL_GAIN, 'the purse was paid exactly 50');
  // The stream: gold lands first, then the removal — the order the effects read.
  const out = step(pre, 'v2');
  assert.deepEqual(out.events.map((e) => e.t), ['gold', 'card_removed']);
  assert.equal(out.events[0].amount, SELL_GAIN);
  assert.equal(out.events[1].uid, gone.uid);
  // Deterministic: the same seed sells the same copy.
  const again = eventOf('ash_peddler', { base: newRun({ seed: 8 }), state: { deck }, floor: 1, from: 'r1n0' });
  const gone2 = deck.find((c) => !step(again, 'v2').state.deck.some((x) => x.uid === c.uid));
  assert.equal(gone2.uid, gone.uid, 'the seeded pick is the same instance');

  // The deck floor: after the removal the deck must still hold MORE than 6 cards.
  const thinDeck = newRun({ seed: 8 }).deck.slice(0, 6).concat([{ uid: 'sell-1', cardId: 'anger' }]); // 7 cards -> 6 after: refused
  const thin = eventOf('ash_peddler', { base: newRun({ seed: 8 }), state: { deck: thinDeck }, floor: 1, from: 'r1n0' });
  const thinChoice = snapshot(thin).event.choices.find((c) => c.slug === 'sell');
  assert.equal(thinChoice.offered, false);
  assert.equal(thinChoice.reason, `your deck must stay above ${EVENT_DECK_FLOOR} cards`);
  assert.ok(!actions(thin).some((a) => a.slug === 'sell'));
  const okDeck = newRun({ seed: 8 }).deck.slice(0, 6).concat([{ uid: 'sell-1', cardId: 'anger' }, { uid: 'sell-2', cardId: 'cleave' }]); // 8 -> 7 after: offered
  const ok = eventOf('ash_peddler', { base: newRun({ seed: 8 }), state: { deck: okDeck }, floor: 1, from: 'r1n0' });
  assert.ok(actions(ok).some((a) => a.slug === 'sell'), 'eight cards may sell down to seven');

  // No sellable card at all: the choice is not offered (and starters never sell).
  const starters = eventOf('ash_peddler', { base: newRun({ seed: 8 }), floor: 1, from: 'r1n0' });
  assert.equal(starters.deck.every((c) => C.cards.get(c.cardId).rarity === 'starter'), true, 'fixture: all starters');
  assert.equal(actions(starters).some((a) => a.slug === 'sell'), false, 'starters are beneath the peddler');
});

test('Collapsed Shaft — climb pays 60 for 12 HP through the fixed paths; the torch is priced; walking past is free', () => {
  const s0 = eventOf('collapsed_shaft', { player: { gold: 50, hp: 40 } });
  const pre = { ...s0 };
  let s = step(s0, 'v1').state;
  assert.equal(s.player.gold, 50 + SHAFT_GOLD, 'the shaft paid in full');
  assert.equal(s.player.hp, 40 - SHAFT_HP, 'and took its due');
  assert.equal(s.rngDraws - pre.rngDraws, 0, 'fixed numbers consume nothing');
  assert.deepEqual(step(pre, 'v1').events.map((e) => e.t), ['hp_cost', 'gold']);

  const rich = eventOf('collapsed_shaft', { player: { gold: 50, hp: 40 } });
  let t = step(rich, 'v2').state;
  assert.equal(t.player.gold, 50 - TORCH_PRICE);
  assert.equal(t.player.hp, 40 + Math.min(TORCH_HEAL, t.player.maxHp - (40 - 0)), 'the torch heals, clamped to max');
  assert.deepEqual(step(rich, 'v2').events.map((e) => e.t), ['gold_spent', 'heal']);
  // The torch is a price like any other: a broke player gets no id.
  const broke = eventOf('collapsed_shaft', { player: { gold: TORCH_PRICE - 1 } });
  assert.ok(!actions(broke).some((a) => a.slug === 'torch'));
  assert.equal(snapshot(broke).event.choices.find((c) => c.slug === 'torch').reason, `needs ${TORCH_PRICE} gold`);

  const idle = eventOf('collapsed_shaft');
  const preIdle = { ...idle };
  const past = step(idle, 'v3').state;
  assert.equal(past.rngDraws - preIdle.rngDraws, 0);
  assert.deepEqual(past.event.resolved.lines, ['- Nothing happens.']);
});

test('Wandering Smith — the temper choice reuses the rest site\u2019s offer builder as a committed modal', () => {
  const s0 = eventOf('wandering_smith', { tempers: true });
  const pre = { ...s0 };
  const temper0 = { ...s0.tempers };
  let s = step(s0, 'v1').state;
  // The offer roll is the rest site's own: 3 picks + 3 fit rolls on the untouched deck.
  const expectedDraws = (() => {
    const open = pre.deck.filter((c) => !pre.tempers[c.uid] && C.cards.has(c.cardId));
    return Math.min(3, open.length) * 2;
  })();
  assert.equal(s.rngDraws - pre.rngDraws, expectedDraws, 'the offer consumed the builder\u2019s own draws');
  assert.equal(s.event.tempering, true);
  assert.equal(s.event.offers.length, Math.min(3, pre.deck.filter((c) => !temper0[c.uid] && C.cards.has(c.cardId)).length));
  assert.deepEqual(Object.keys(s.tempers), Object.keys(temper0), 'no temper landed yet');

  // MODAL: the only actions are the picks — no leaving mid-temper (the paid-removal precedent).
  const L = actions(s);
  assert.deepEqual(L.map((a) => a.id), s.event.offers.map((_, i) => `t${i + 1}`));
  assert.ok(L.every((a) => a.kind === 'event_temper'));

  // The pick lands the temper by uid and closes the modal into the resolved beat.
  const offer = s.event.offers[0];
  const t1 = step(s, 't1').state;
  assert.equal(t1.tempers[offer.uid], offer.temper, 'the temper landed on the deck instance');
  assert.equal(t1.event.tempering, false);
  assert.ok(t1.event.resolved, 'the modal resolves into the beat');
  assert.equal(t1.rngDraws, s.rngDraws, 'the pick is a choice, not a roll');
  const out = step(s, 't1');
  assert.deepEqual(out.events.map((e) => e.t), ['card_tempered']);
  assert.equal(out.events[0].uid, offer.uid);
  assert.equal(out.events[0].temper, offer.temper);

  // The rest-site gate, mirrored: a run without tempers never sees the choice at all.
  const plain = eventOf('wandering_smith', { tempers: false });
  const plainChoice = snapshot(plain).event.choices.find((c) => c.slug === 'temper');
  assert.equal(plainChoice.offered, false);
  assert.equal(plainChoice.reason, 'this run carries no tempers');
  assert.ok(!actions(plain).some((a) => a.slug === 'temper'));
  // ...and the stories and the way out remain.
  assert.ok(actions(plain).some((a) => a.slug === 'stories'));
  assert.ok(actions(plain).some((a) => a.slug === 'move'));
});

test('Wandering Smith — stories heal like a rest site; every card already tempered closes the choice', () => {
  const s0 = eventOf('wandering_smith', { player: { hp: 30 } });
  let s = step(s0, 'v2').state;
  assert.equal(s.player.hp, 30 + Math.min(STORIES_HEAL, s.player.maxHp - 30));
  assert.deepEqual(step(s0, 'v2').events.map((e) => e.t), ['heal']);
  assert.equal(step(s0, 'v2').events[0].source, 'event');

  // An all-tempered deck: the modal would be empty, so the choice is never offered.
  const base = newRun({ seed: 2, tempers: true });
  const allTempered = { ...base, tempers: Object.fromEntries(base.deck.map((c) => [c.uid, 'quenched'])) };
  const full = eventOf('wandering_smith', { base: allTempered, tempers: true, floor: 1, from: 'r1n0' });
  const choice = snapshot(full).event.choices.find((c) => c.slug === 'temper');
  assert.equal(choice.offered, false);
  assert.match(choice.reason, /already tempered/);
  assert.ok(!actions(full).some((a) => a.slug === 'temper'));
});

test('the resolved beat: the phase stays, the continue is the only action, and the node is consumed', () => {
  let s = eventOf('collapsed_shaft');
  s = step(s, 'v3').state;
  assert.equal(s.phase, 'event', 'the beat holds the phase open');
  assert.deepEqual(actions(s).map((a) => a.id), ['v0'], 'exactly one way out');
  assert.deepEqual(actions(s).map((a) => a.kind), ['event_continue']);
  const dump = observe(s);
  assert.match(dump, /RESOLVED/);
  assert.match(dump, / v0 continue \(HP \d+\/\d+, purse \d+\)/);
  const pre = { ...s };
  s = step(s, 'v0').state;
  assert.equal(s.rngDraws - pre.rngDraws, 0, 'the continue is a choice, not a roll');
  assert.equal(s.phase, 'map');
  assert.equal(s.event, null, 'the event state closed with the room');
  assert.ok(actions(s).every((a) => a.kind === 'travel'), 'back on the map, the run moves on');
  // The stream names what closed.
  assert.deepEqual(step(pre, 'v0').events.map((e) => e.t), ['event_left']);
});

test('the resolved beat renders in the snapshot with the kernel\u2019s own lines', () => {
  let s = eventOf('collapsed_shaft');
  s = step(s, 'v1').state;
  const ev = snapshot(s).event;
  assert.equal(ev.known, true);
  assert.equal(ev.name, 'The Collapsed Shaft');
  assert.ok(ev.resolved.lines.length >= 2, 'the beat carries the concrete results');
  assert.equal(ev.continueId, 'v0');
  // Fresh-event snapshot facts: every choice carries its afford fact, and the purse/HP
  // readouts the view prints are the kernel's own numbers.
  const fresh = snapshot(eventOf('collapsed_shaft', { player: { gold: 5 } })).event;
  assert.equal(fresh.purse, 5);
  for (const c of fresh.choices) {
    assert.equal(c.offered, c.actionId !== null, `${c.slug}: the afford fact and the action agree`);
    assert.ok(typeof c.effect === 'string' && c.effect.length > 0, `${c.slug} previews its effect`);
  }
  assert.equal(fresh.choices.find((c) => c.slug === 'torch').reason, `needs ${TORCH_PRICE} gold`);
});

test('torn saves degrade, never throw, and never strand the run inside the phase', () => {
  const base = newRun({ seed: 3 });
  for (const torn of [null, undefined, {}]) {
    const s = { ...base, phase: 'event', floor: 1, mapNodeId: 'r2n1', event: torn };
    assert.deepEqual(actions(s).map((a) => a.id), ['v0'], `torn ${JSON.stringify(torn)}: the continue is offered`);
    const dump = observe(s);
    assert.match(dump, /EVENT — the wayside/, 'the degraded dump still names the phase');
    const out = step(s, 'v0');
    assert.equal(out.error, null);
    assert.equal(out.state.phase, 'map', 'the escape hatch closes the phase');
    assert.doesNotThrow(() => hash(out.state), 'the degraded state stays hashable');
    assert.doesNotThrow(() => snapshot(s), 'the degraded snapshot renders');
    const forced = step(s, 'v1');
    assert.equal(forced.error?.code, 2, 'no choice id exists to force');
  }
  // An UNKNOWN event id (a save from a future build): no story, no choices, one continue.
  const unknown = { ...base, phase: 'event', floor: 1, mapNodeId: 'r2n1', event: { id: 'deleted_event', nodeId: 'r2n1', resolved: null, tempering: false, offers: null } };
  assert.deepEqual(actions(unknown).map((a) => a.id), ['v0']);
  const snapEv = snapshot(unknown).event;
  assert.equal(snapEv.known, false, 'the snapshot says the story is unknown');
  assert.equal(snapEv.name, 'deleted_event', 'the raw id stands in for the name');
  assert.deepEqual(snapEv.choices, []);
  assert.equal(step(unknown, 'v0').state.phase, 'map');

  // A torn temper MODAL: a garbage offer is never enumerated (the S4.1 ruling), and a
  // modal with no valid offer degrades to the continue instead of stranding the run.
  const tornModal = { ...base, phase: 'event', floor: 1, mapNodeId: 'r2n1', tempers: {}, event: { id: 'wandering_smith', nodeId: 'r2n1', resolved: null, tempering: true, offers: [{ junk: true }, { uid: 7 }, { uid: 'c0', cardId: 'strike', temper: 'deleted_temper' }] } };
  assert.deepEqual(actions(tornModal).map((a) => a.id), ['v0'], 'no valid offer, no refused id');
  assert.equal(step(tornModal, 'v0').state.phase, 'map');
  // A modal with one valid offer beside garbage: only the valid pick exists, and it resolves.
  const mixed = { ...base, phase: 'event', floor: 1, mapNodeId: 'r2n1', tempers: {}, event: { id: 'wandering_smith', nodeId: 'r2n1', resolved: null, tempering: true, offers: [{ junk: 1 }, { uid: 'c0', cardId: 'strike', temper: 'redhot' }] } };
  assert.deepEqual(actions(mixed).map((a) => a.id), ['t2'], 'the valid offer keeps its slot index');
  const picked = step(mixed, 't2').state;
  assert.equal(picked.tempers.c0, 'redhot');
});

test('validateSave: the event field is optional (object or null), and a legacy save never meets the phase', () => {
  const save = JSON.parse(JSON.stringify(saveObject(begin({ seed: 7 }))));
  delete save.state.event;
  assert.deepEqual(validateSave(save), [], 'a legacy save validates without the field');
  assert.equal(loadObject(save).ok, true);
  save.state.event = null;
  assert.deepEqual(validateSave(save), [], 'null is the closed-room shape');
  save.state.event = { id: 'x' };
  assert.deepEqual(validateSave(save), [], 'the inner ids are NOT shape-checked (they degrade at the surfaces)');
  save.state.event = 'junk';
  assert.ok(validateSave(save).some((p) => p.includes('"event" must be an object or null')));
  save.state.event = [];
  assert.ok(validateSave(save).some((p) => p.includes('"event" must be an object or null')));

  // The legacy RUN: no event field, a stored map with no event nodes — the phase
  // never occurs and the run plays to an end like it always did.
  let session = begin({ seed: 7 });
  const legacy = JSON.parse(JSON.stringify(saveObject(session)));
  delete legacy.state.event;
  legacy.state.map.rows = legacy.state.map.rows.map((row) => row.map((n) => (n.type === 'event' ? { ...n, type: 'combat_weak' } : n)));
  assert.deepEqual(validateSave(legacy), [], `the legacy save still validates: ${JSON.stringify(validateSave(legacy))}`);
  const res = loadObject(legacy);
  assert.equal(res.ok, true, `the legacy save loads: ${JSON.stringify(res.problems ?? [])}`);
  session = res.session;
  assert.equal(session.state.event, undefined);
  let sawEvent = false;
  for (let g = 0; g < 40 && session.state.phase !== 'ended'; g += 1) {
    const L = legal(session);
    if (L.some((a) => a.nodeType === 'event') || L.some((a) => a.kind.startsWith('event_'))) sawEvent = true;
    const pick = L.find((a) => a.kind === 'travel') ?? L[0];
    session = submit(session, pick).session;
  }
  assert.equal(sawEvent, false, 'the event phase never occurs on a legacy map');
  assert.notEqual(session.state.phase, 'event');
});

test('both heuristic policies take the free pass-through and continue; the random policy survives any event', () => {
  for (const name of ['greedy', 'smart']) {
    const policy = makePolicy(name);
    for (let seed = 0; seed < 12; seed += 1) {
      let s = eventVisit(seed);
      let guard = 0;
      const walked = [];
      while (s.phase === 'event' && guard < 10) {
        const L = actions(s);
        const choice = policy.choose({ session: { state: s }, state: s, legal: L, stepIndex: s.stepIndex, memory: {} });
        assert.ok(L.some((a) => a.id === choice.id), `${name} chose a legal id (seed ${seed})`);
        walked.push(choice.id);
        s = step(s, choice.id).state;
        guard += 1;
      }
      assert.equal(s.phase, 'map', `${name} resolved the wayside in two steps (seed ${seed}: ${walked.join(',')})`);
      assert.equal(walked.length, 2, `${name} chose once, then continued (seed ${seed})`);
      // The free choice first: whichever event it was, no gold left and no HP lost
      // beyond the beat's own effects... assert the stance directly on the id instead.
      const def = eventDef(eventVisit(seed).event.id);
      const free = def.choices.findIndex((c) => c.cost === null && c.hpLoss === null && !c.req);
      assert.equal(walked[0], `v${free + 1}`, `${name} took the zero-cost choice of ${def.id} (seed ${seed})`);
    }
  }
  const policy = makePolicy('random');
  for (const seed of [0, 1, 2, 3]) {
    let s = eventVisit(seed);
    let guard = 0;
    while (s.phase === 'event' && guard < 20) {
      const L = actions(s);
      const choice = policy.choose({ session: { state: s }, state: s, legal: L, stepIndex: s.stepIndex, memory: {} });
      assert.ok(L.some((a) => a.id === choice.id), `random chose a legal id (seed ${seed})`);
      s = step(s, choice.id).state;
      guard += 1;
    }
    assert.equal(s.phase, 'map', `seed ${seed}: random resolved the wayside and left`);
    assert.ok(s.player.hp >= 1, 'an event choice can never kill the run');
  }
});

test('a real run that walks the wayside, chooses, and continues replays hash-for-hash', () => {
  // greedy everywhere EXCEPT: at floor 1 it takes the row-2 event (its routing ranks
  // the event last, so the walk must ask for it by node type), and inside the phase it
  // takes the zero-cost choice, then the continue.
  const driver = (seed) => {
    const greedy = makePolicy('greedy');
    let session = begin({ seed });
    const memory = {};
    for (let guard = 0; guard < 3000; guard += 1) {
      const st = session.state;
      if (st.phase === 'ended') break;
      const L = legal(session);
      let id;
      if (st.phase === 'map' && st.floor === 1) {
        id = (L.find((a) => a.nodeType === 'event')?.id ?? greedy.choose({ session, state: st, legal: L, stepIndex: st.stepIndex, memory }).id);
      } else if (st.phase === 'event') {
        const choices = L.filter((a) => a.kind === 'event_choice');
        const free = choices.filter((a) => !a.cost && !a.hpLoss);
        id = (free[0] ?? choices[0] ?? L.find((a) => a.kind === 'event_continue')).id;
      } else {
        id = greedy.choose({ session, state: st, legal: L, stepIndex: st.stepIndex, memory }).id;
      }
      if (id == null) break;
      session = submit(session, id).session;
      if (session.state.phase === 'map' && session.state.floor === 2) break;
    }
    return session;
  };
  let session = null;
  for (let seed = 1; seed <= 30 && !session; seed += 1) {
    const run = driver(seed);
    const visited = run.events.some((e) => e.t === 'event_open') && run.events.some((e) => e.t === 'event_left');
    if (visited && run.state.phase === 'map' && run.state.floor === 2) session = run;
  }
  assert.ok(session, 'some seed in 1..30 walks the wayside and continues');
  const parsed = parseLog(renderLog(session));
  assert.equal(parsed.ok, true, `log parses: ${JSON.stringify(parsed.problems ?? [])}`);
  const result = assertReplay(parsed);
  assert.equal(result.ok, true, `hash-for-hash: ${JSON.stringify(result.mismatches ?? [])}`);
  assert.equal(runHash(session), result.finalHash);
  assert.equal(session.events.filter((e) => e.t === 'event_open').length, 1);
  assert.equal(session.events.filter((e) => e.t === 'event_left').length, 1);
});

test('the ride replays: same action list, same hashes, effects and all', () => {
  const drive = () => {
    let s = eventOf('collapsed_shaft', { player: { gold: 50, hp: 40 } });
    const hashes = [hash(s)];
    s = step(s, 'v1').state;
    hashes.push(hash(s));
    s = step(s, 'v0').state;
    hashes.push(hash(s));
    return hashes;
  };
  assert.deepEqual(drive(), drive(), 'enter, choose, continue — identical every time');
});
