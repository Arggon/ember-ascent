// tests/kernel/legacy-migration.test.js — the DE-STS rename shim (AC3/AC4).
//
// The 0.5.0 content build renamed every StS-lexeme id to its Ember Ascent name. A
// save written BEFORE the rename carries the old ids; this file proves the load-time
// shim (src/kernel/legacy-ids.js) migrates such a save so it:
//   AC3 — loads, plays at least one step, and every id-bearing structure comes out
//         in the NEW vocabulary (the fixture below CONSERVES old ids on purpose: it
//         is the pre-rename shape, so migrating it is the whole test);
//   AC4 — is DETERMINISTIC: two loads of the same save yield the same migrated hash,
//         and a fresh run's hash is stable across two builds.
//
// The fixture is built from a REAL run (travel into a fight) and then torn back to
// the pre-rename ids by hand — never through newRun's own content, which already
// speaks the new vocabulary.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newRun,
  step,
  actions,
  hash,
  validateSave,
  toSave,
  serializeSave,
  migrateLegacySave,
  LEGACY_ID_MAP,
} from '../../src/kernel/index.js';
import { loadObject, submit } from '../../src/surface/session.js';

/** A real combat state (seed 7, walked into the first fight), torn to pre-rename ids. */
function preRenameSave() {
  let state = newRun({ seed: 7 });
  for (let i = 0; i < 24 && state.phase !== 'combat' && state.phase !== 'ended'; i += 1) {
    const travel = actions(state).find((a) => a.kind === 'travel');
    if (!travel) break;
    state = step(state, travel.id).state;
  }
  assert.equal(state.phase, 'combat', 'the walk reached a fight');
  // Tear the deck + piles to the old card ids (a mid-fight save holds all four piles).
  const oldStarter = { hammerfall: 'strike', quench: 'defend', anvil_blow: 'bash' };
  const tearCard = (c) => ({ ...c, cardId: oldStarter[c.cardId] ?? c.cardId });
  const torn = {
    ...state,
    character: 'ironclad',
    deck: state.deck.map(tearCard),
    relics: ['burning_blood'],
    powers: { combust: 1 },
    combat: {
      ...state.combat,
      hand: state.combat.hand.map(tearCard),
      draw: state.combat.draw.map(tearCard),
      discard: state.combat.discard.map(tearCard),
      exhaust: state.combat.exhaust.map(tearCard),
      enemies: state.combat.enemies.map((e) => {
        const legacy = Object.entries(LEGACY_ID_MAP.enemies).find(([, v]) => v === e.id);
        return { ...e, id: legacy ? legacy[0] : e.id, name: 'The Guardian' };
      }),
    },
    map: {
      ...state.map,
      encounterTable: Object.fromEntries(
        Object.entries(state.map.encounterTable).map(([nodeId, row]) => [nodeId, { ...row, name: 'Two Lice', spawn: row.spawn }]),
      ),
    },
    draftPool: state.draftPool,
  };
  return toSave(torn, []);
}

test('a pre-rename save validates (shape only) and migrates to the Ember vocabulary', () => {
  const save = preRenameSave();
  assert.deepEqual(validateSave(save), [], 'the pre-rename shape passes validateSave unchanged');
  const res = loadObject(save);
  assert.equal(res.ok, true, `the pre-rename save loads: ${res.problems ?? ''}`);
  const st = res.session.state;
  assert.equal(st.character, 'ashwright');
  assert.ok(st.deck.every((c) => !LEGACY_ID_MAP.cards[c.cardId]), 'deck carries no legacy card id');
  assert.equal(st.relics[0], 'kindled_heart');
  assert.deepEqual(st.powers, { banked_coal: 1 }, 'power keys migrate with stacks preserved');
  for (const pile of ['hand', 'draw', 'discard', 'exhaust']) {
    assert.ok(st.combat[pile].every((c) => !LEGACY_ID_MAP.cards[c.cardId]), `${pile} carries no legacy card id`);
  }
  assert.ok(st.combat.enemies.every((e) => !LEGACY_ID_MAP.enemies[e.id]), 'enemy ids migrated');
  assert.equal(st.combat.enemies[0].name, 'Slag Warden', 'the torn enemy name remaps (hash-inert string)');
  const names = Object.values(st.map.encounterTable).map((r) => r.name);
  assert.ok(names.every((n) => !LEGACY_ID_MAP.stateNames[n]), 'encounter table names carry no legacy stateName');
  // The save wrapper's own character fact mirrors the migrated state.
  assert.equal(migrateLegacySave(save).character, 'ashwright');
});

test('the reward blob migrates too: cards, relic offers and the elite\'s baked-in relic drop', () => {
  const torn = JSON.parse(JSON.stringify(preRenameSave())); // toSave freezes: un-freeze to tear in a reward
  torn.state.reward = { cards: ['cleave'], relicOffers: ['burning_blood'], relic: 'burning_blood' };
  const st = loadObject(torn).session.state;
  assert.deepEqual(
    st.reward,
    { cards: ['arc_cut'], relicOffers: ['kindled_heart'], relic: 'kindled_heart' },
    'reward.cards, reward.relicOffers AND the guaranteed reward.relic all remap',
  );
});

test('AC3: the migrated save PLAYS — a step dispatches against the new content', () => {
  const save = preRenameSave();
  const { session } = loadObject(save);
  const legal = actions(session.state);
  assert.ok(legal.length > 0, 'the migrated state enumerates legal actions');
  // Play a hand card if one is affordable, else end the turn: either way one step runs.
  const play = legal.find((a) => a.kind === 'play');
  const id = play ? play.id : 'e1';
  const out = submit(session, id);
  assert.equal(out.error, null, `the migrated save plays: ${out.error?.error ?? ''}`);
  assert.ok(out.events.length > 0, 'the step emitted kernel events');
});

test('AC4: two loads of the same save yield the SAME migrated hash, and a fresh run is stable', () => {
  const save = preRenameSave();
  const a = loadObject(serializeSave(save) ? JSON.parse(serializeSave(save)) : save);
  const b = loadObject(save);
  assert.equal(hash(a.session.state), hash(b.session.state), 'the migrated identity is load-order independent');
  // Determinism of a fresh run under the new content (two builds, one hash).
  assert.equal(hash(newRun({ seed: 7 })), hash(newRun({ seed: 7 })));
});
