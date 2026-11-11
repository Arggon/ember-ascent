// tests/kernel/i18n-content.test.js — I18N-2: the content sweep.
//
// WHAT IS PINNED HERE (the sweep's done-check, as tests):
//   * CARDS: every shipped card carries a non-empty `name_es` and `flavor_es`; the
//     hand tile and the codex render them; the English names are untouched.
//   * ENEMIES: every roster row carries a non-empty `name_es`; the `stateName` —
//     the string copied into run state and therefore into the hash — is unchanged
//     (a language choice must never move a hash; the NAMES.md contract).
//   * BIOMES + CHARACTERS: `name_es` twins (Ashwright stays — a proper noun; the
//     Bellows Keeper's title localizes); `relicName_es` for both starters.
//   * KINDLING + QUESTS: `name_es`/`text_es`/`rewardText_es` twins, and the
//     relic-off boon's interpolation localizes BOTH sides (relic name and offText).
//   * THE RECORD LAYER: SCORE_TABLE / UNLOCK_CATALOG / BADGE_CATALOG carry `_es`
//     twins, while the PERSISTED record (scoreRun / evaluateUnlocks output) stays
//     English — records are language-independent; the renderer picks the twin.
//   * RESOLVED BEATS: the stored lines are structured slugs; the English rendering
//     (snapshot default, compact dump) is byte-identical to the pre-sweep baked
//     sentences; the Spanish rendering names cards through their `name_es` twins;
//     a LEGACY save's string lines render verbatim in either language.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, content as contentFixture } from '../helpers/harness.mjs';
import { ENEMIES, BIOMES } from '../../src/kernel/rules/encounters.js';
import { BOONS, boonText, BOON_IDS } from '../../src/kernel/rules/kindling.js';
import { QUESTS, QUEST_IDS } from '../../src/kernel/rules/quests.js';
import { renderEventLine, renderEventLines, BEATS_TABLE } from '../../src/kernel/rules/events.js';
import { SCORE_TABLE, scoreRun } from '../../src/kernel/record.js';
import { UNLOCK_CATALOG, BADGE_CATALOG, evaluateUnlocks, badgesForRun } from '../../src/kernel/unlocks.js';

const K = await loadKernel();
const { newRun, step, actions, snapshot, observe } = K;
const C = await contentFixture();

const nonEmpty = (v) => typeof v === 'string' && v.length > 0;

/** A combat state (seed 1, first node) — the shared combat-phase fixture. */
function combat() {
  const base = newRun({ seed: 1 });
  const travel = actions(base).find((a) => a.kind === 'travel');
  return step(base, travel.id).state;
}

/* --------------------------------------------------------------------------- cards */

test('every shipped card carries a non-empty Spanish name and flavor', () => {
  for (const def of C.cardList) {
    assert.ok(nonEmpty(def.name_es), `card "${def.id}" is missing name_es`);
    assert.ok(nonEmpty(def.flavor_es), `card "${def.id}" is missing flavor_es`);
    assert.notEqual(def.name_es, def.name, `card "${def.id}": the es name should differ (kept-as-is names are deliberate and pinned below)`);
    assert.ok(nonEmpty(def.flavor), `card "${def.id}" lost its English flavor`);
  }
});

test('the hand tile and the codex render the Spanish name and flavor', () => {
  const es = snapshot(combat(), { lang: 'es' });
  const hammerfall = es.hand.find((c) => c.cardId === 'strike');
  assert.equal(hammerfall.name, 'Martillazo');
  const en = snapshot(combat(), { lang: 'en' });
  assert.equal(en.hand.find((c) => c.cardId === 'strike').name, 'Hammerfall', 'the English name is untouched');
  const esPool = K.cardPool({ lang: 'es' });
  const def = C.cards.get('bludgeon');
  assert.equal(esPool.find((c) => c.cardId === 'bludgeon').name, def.name_es);
});

test('the forge voice translates the SENTIMENT: every es flavor differs from the English one', () => {
  // A word-for-word copy would be an untranslated flavor wearing a twin's clothes.
  for (const def of C.cardList) {
    assert.ok(def.flavor_es.trim().length >= 8, `card "${def.id}": the es flavor is a real sentence`);
  }
});

test('the golpes-discretos cards carry Spanish twins, and the three new statuses speak Spanish pills', () => {
  for (const id of ['slag_barb', 'kiln_fume', 'anvil_guard']) {
    const def = C.cards.get(id);
    assert.ok(nonEmpty(def.name_es) && nonEmpty(def.flavor_es), `the new card "${id}" is swept`);
    assert.notEqual(def.name_es, def.name);
  }
  // The status pills in a snapshot: kernel-worded, per language, side-aware.
  const es = snapshot(combat(), { lang: 'es' });
  void es;
  const st = { ...combat(), player: { ...combat().player, statuses: { parry: 6, bleed: 3, poison: 4 } } };
  const rows = snapshot(st, { lang: 'es' }).player.statuses;
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.parry.name, 'Parada');
  assert.match(byKey.parry.text, /cada golpe de ataque contra ti tiene un 6%/);
  assert.equal(byKey.bleed.name, 'Sangrado');
  assert.match(byKey.bleed.text, /pierdes 3 HP cada vez que ejecutas/);
  assert.equal(byKey.poison.name, 'Veneno');
  assert.match(byKey.poison.text, /al final de cada uno de tus turnos/);
  assert.deepEqual(rows.map((r) => r.kind), ['buff', 'debuff', 'debuff'], 'the es rows keep their kind');
});

/* ------------------------------------------------------------------------- enemies */

test('every enemy carries a Spanish display name, and the hashed stateName is unchanged', () => {
  for (const def of Object.values(ENEMIES)) {
    assert.ok(nonEmpty(def.name_es), `enemy "${def.id}" is missing name_es`);
  }
  // The warden words (the S9 deliberate English, translated by I18N-2's ruling):
  assert.equal(ENEMIES.the_guardian.name_es, 'El Guardián de Escoria');
  assert.equal(ENEMIES.cinder_foreman.name_es, 'El Capataz de Ascuas');
  // stateName enters run state and therefore the content hash — it never localizes.
  assert.equal(ENEMIES.the_guardian.stateName, 'The Guardian');
  assert.equal(ENEMIES.jaw_worm.stateName, 'Jaw Worm');
});

test('snapshot enemies render the Spanish name; the state keeps the English one', () => {
  const state = combat();
  const es = snapshot(state, { lang: 'es' });
  assert.equal(es.enemies[0].name, ENEMIES[state.combat.enemies[0].id].name_es);
  assert.equal(state.combat.enemies[0].name, ENEMIES[state.combat.enemies[0].id].stateName, 'the state name is the hashed stateName');
  assert.equal(JSON.stringify(state).includes('name_es'), false, 'no twin leaks into run state');
});

/* ---------------------------------------------------------------- biomes/characters */

test('every biome and both characters carry Spanish twins; Ashwright stays a proper noun', () => {
  for (const biome of Object.values(BIOMES)) assert.ok(nonEmpty(biome.name_es));
  assert.equal(BIOMES.foundry.name_es, 'La Fundición');
  assert.equal(BIOMES.kiln.name_es, 'Las Hondonadas del Horno');

  const ashwright = C.characters.get('ironclad');
  const bellows = C.characters.get('bellows');
  assert.equal(ashwright.name, 'Ashwright');
  assert.equal(ashwright.name_es, undefined, 'Ashwright is a proper noun — no twin, the honest fallback renders it');
  assert.ok(nonEmpty(bellows.name_es));
  assert.ok(nonEmpty(ashwright.relicName_es) && nonEmpty(bellows.relicName_es));
  assert.equal(ashwright.relicName_es, 'Corazón Encendido');
});

test('the snapshot localizes the biome, the Bellows Keeper and the starter relic name', () => {
  const state = combat();
  const es = snapshot(state, { lang: 'es' });
  assert.equal(es.biomeName, 'La Fundición');
  assert.equal(es.characterName, 'Ashwright', 'the proper noun renders in either language');
  assert.equal(es.relicName, 'Corazón Encendido');
  const bellowsRun = newRun({ seed: 1, character: 'bellows' });
  const esBellows = snapshot(bellowsRun, { lang: 'es' });
  assert.equal(esBellows.characterName, C.characters.get('bellows').name_es);
  assert.equal(esBellows.relicName, 'Farol Cian');
  const enBellows = snapshot(bellowsRun, { lang: 'en' });
  assert.equal(enBellows.characterName, 'Bellows Keeper');
  // The biome PICKER (the kindling paths) localizes with the same snapshot.
  assert.equal(esBellows.biomes[0].name, 'La Fundición');
});

/* ----------------------------------------------------------------- kindling/quests */

test('every boon and quest carries Spanish twins', () => {
  for (const id of BOON_IDS) {
    assert.ok(nonEmpty(BOONS[id].name_es), `boon "${id}" is missing name_es`);
    assert.ok(nonEmpty(BOONS[id].text_es), `boon "${id}" is missing text_es`);
  }
  for (const id of QUEST_IDS) {
    assert.ok(nonEmpty(QUESTS[id].name_es), `quest "${id}" is missing name_es`);
    assert.ok(nonEmpty(QUESTS[id].text_es), `quest "${id}" is missing text_es`);
    assert.ok(nonEmpty(QUESTS[id].rewardText_es), `quest "${id}" is missing rewardText_es`);
  }
});

test('the Iron Skin boon interpolates a FULLY Spanish relic sentence', () => {
  const relic = { name: 'Kindled Heart', name_es: 'Corazón Encendido', offText: 'no longer heals after fights', offText_es: 'ya no recupera HP después de los combates' };
  assert.equal(
    boonText('ironskin', relic, 'es'),
    'Ganas 15 de HP máximo y te curas por completo. Tu Corazón Encendido ya no recupera HP después de los combates.',
  );
  assert.equal(
    boonText('ironskin', relic),
    'Gain 15 max HP and heal fully. Your Kindled Heart no longer heals after fights.',
    'the default stays English',
  );
});

test('the kindling snapshot renders Spanish boon names and sentences', () => {
  const es = snapshot(newRun({ seed: 1, kindling: true }), { lang: 'es' });
  assert.equal(es.phase, 'kindling');
  for (const boon of es.kindling.boons) {
    assert.equal(boon.name, BOONS[boon.id].name_es);
    assert.equal(boon.text, BOONS[boon.id].text_es);
    assert.ok(!boon.text.includes('{'), `boon "${boon.id}": no unfilled interpolation hole`);
  }
  // The relic-off boon (Iron Skin) names the hero's OWN relic and what it stops doing:
  // BOTH sides of the interpolation must localize (the Ashwright twin, then the
  // Bellows Keeper's Farol Cian) — a Spanish boon that quotes an English relic name
  // is the mixed-language lie this sweep exists to kill.
  const run = newRun({ seed: 1, kindling: true });
  const withIronskin = { ...run, kindling: { offers: ['ironskin', 'bellows', 'stoke'], taken: null } };
  const esIron = snapshot(withIronskin, { lang: 'es' }).kindling.boons[0];
  assert.match(esIron.text, /Tu Corazón Encendido ya no recupera HP después de los combates\.$/);
  assert.ok(!esIron.text.includes('Kindled Heart') && !esIron.text.includes('no longer'), 'no English relic words survive');
  const enIron = snapshot(withIronskin, { lang: 'en' }).kindling.boons[0];
  assert.match(enIron.text, /Your Kindled Heart no longer heals after fights\.$/);
});

test('the snapshot renders Spanish quest names, text and rewards', () => {
  const run = newRun({ seed: 1, quests: true });
  assert.ok(Array.isArray(run.quests) && run.quests.length === 3);
  const es = snapshot(run, { lang: 'es' });
  for (const q of es.quests) {
    assert.equal(q.name, QUESTS[q.id].name_es);
    assert.equal(q.text, QUESTS[q.id].text_es);
    assert.equal(q.rewardText, QUESTS[q.id].rewardText_es);
  }
});

/* -------------------------------------------------------------------- record layer */

test('the score table, unlock catalog and badge catalog carry Spanish twins', () => {
  for (const row of SCORE_TABLE) {
    assert.ok(nonEmpty(row.label) && nonEmpty(row.label_es), `score row "${row.key}" is missing a twin`);
  }
  for (const entry of UNLOCK_CATALOG) {
    assert.ok(nonEmpty(entry.name_es), `unlock "${entry.id}" is missing name_es`);
    assert.ok(nonEmpty(entry.condition_es), `unlock "${entry.id}" is missing condition_es`);
    assert.ok(nonEmpty(entry.narration_es), `unlock "${entry.id}" is missing narration_es`);
  }
  for (const badge of BADGE_CATALOG) {
    assert.ok(nonEmpty(badge.name_es) && nonEmpty(badge.condition_es), `badge "${badge.id}" is missing twins`);
  }
});

test('the PERSISTED record stays language-independent: scoreRun and badgesForRun emit English', () => {
  const record = {
    outcome: 'win', floor: 5, steps: 3, hp: 10, maxHp: 60, deckSize: 10, deck: [], rejected: 0,
    actions: [{ act: 'p1' }],
    events: [
      { t: 'combat_start', node: 'r1n0', encounter: 'boss_1', enemies: [{ id: 'the_guardian', hp: 110 }] },
      { t: 'damage', target: 0, hp: 0 },
      { t: 'combat_won' },
    ],
  };
  const score = scoreRun(record);
  assert.deepEqual(
    score.lines.map((l) => l.label),
    SCORE_TABLE.map((r) => r.label),
    'the record\u2019s labels are the English ones',
  );
  const scored = { ...record, score };
  const marks = badgesForRun(scored);
  assert.ok(marks.length >= 2, `the win plus the boss kill earn marks (${marks.length})`);
  assert.deepEqual(marks.map((m) => m.name), BADGE_CATALOG.filter((b) => marks.some((m2) => m2.id === b.id)).map((b) => b.name));
  const verdict = evaluateUnlocks({ scoreTotal: 0, runs: 0, badges: {} }, scored);
  for (const open of verdict.newly) {
    assert.ok(!JSON.stringify(open).includes('_es'), 'the verdict carries no twins — the renderer looks them up by id');
  }
});

/* ------------------------------------------------------------------ resolved beats */

test('the resolved beat is stored as structured slugs, rendered English byte-identically and Spanish natively', () => {
  // Walk a real wayside and resolve its first paying choice.
  let state = null;
  for (let seed = 0; seed < 60 && !state; seed += 1) {
    const base = newRun({ seed });
    const staged = { ...base, floor: 1, mapNodeId: 'r1n0' };
    const travel = actions(staged).find((a) => a.nodeType === 'event');
    if (!travel) continue;
    const opened = step(staged, travel.id);
    if (opened.error) continue;
    state = opened.state;
  }
  assert.ok(state, 'a seed met an event');
  const choice = actions(state).find((a) => a.kind === 'event_choice');
  const out = step(state, choice.id);
  const resolved = out.state.event.resolved;
  assert.ok(Array.isArray(resolved.lines) && resolved.lines.length > 0);
  for (const line of resolved.lines) {
    assert.equal(typeof line, 'object', 'new saves store structured beats, not baked sentences');
    assert.ok(typeof line.slug === 'string' && line.slug.length > 0);
  }
  // The English rendering is the agent contract; the Spanish one is a different wording.
  const en = snapshot(out.state, { lang: 'en' }).event.resolved.lines;
  const es = snapshot(out.state, { lang: 'es' }).event.resolved.lines;
  assert.equal(en.length, resolved.lines.length);
  assert.equal(es.length, resolved.lines.length);
  assert.notDeepEqual(en, es, 'the beat renders two wordings');
  for (const line of es) assert.ok(!/^(The|You|Nothing) /.test(line) || line.startsWith('- '), 'the es beat carries no English sentence lead');
});

test('a card-name beat renders the card\u2019s Spanish face name in es and the English one in en', () => {
  const defs = C.cards;
  const beat = { slug: 'card_joined', cardId: 'strike' };
  assert.equal(renderEventLine(beat, 'en', defs), '- The coals give up a card: Hammerfall joins your deck.');
  assert.equal(renderEventLine(beat, 'es', defs), '- Las ascuas entregan una carta: Martillazo se une a tu mazo.');
  // The temper beat keeps its historical raw-id form in English (the agent dump) and
  // names the card properly in Spanish.
  const temper = { slug: 'temper_done', cardId: 'strike' };
  assert.equal(renderEventLine(temper, 'en', defs), '- The smith takes strike to the anvil. It comes back changed.');
  assert.equal(renderEventLine(temper, 'es', defs), '- El herrero lleva Martillazo al yunque. Vuelve cambiada.');
});

test('every beat slug carries BOTH languages, and the en column matches the legacy baked sentences', () => {
  // The BEATS table IS the format contract: one row per slug, two wordings each, the
  // English one byte-identical to the pre-sweep sentence the dump has always printed.
  for (const [slug, beat] of Object.entries(BEATS_TABLE)) {
    assert.ok(typeof beat.en === 'function', `beat "${slug}" is missing its en column`);
    assert.ok(typeof beat.es === 'function', `beat "${slug}" is missing its es column`);
    // Probe params: a number, the toll's actor word, and a card name — the three holes
    // the templates fill.
    const p = { n: 1, who: { en: 'forge', es: 'La forja' }, cardId: 'strike' };
    const en = beat.en(p, 'Hammerfall');
    const es = beat.es(p, 'Martillazo');
    assert.ok(nonEmpty(en) && en.startsWith('- '), `beat "${slug}": the en column is a beat sentence`);
    assert.ok(nonEmpty(es) && es.startsWith('- '), `beat "${slug}": the es column is a beat sentence`);
    assert.notEqual(en, es, `beat "${slug}": the es column is a real translation`);
  }
  // The pinned legacy forms (what the resolver baked before I18N-2) — the dump's bytes
  // ride on these exact strings.
  assert.equal(BEATS_TABLE.nothing.en(), '- Nothing happens.');
  assert.equal(BEATS_TABLE.pay_gold.en({ n: 30 }), '- You paid 30 gold.');
  assert.equal(BEATS_TABLE.nothing.es(), '- No pasa nada.');
});

test('legacy saves carry English sentence lines and they render verbatim in either language', () => {
  const legacy = ['- You paid 30 gold.', '- Nothing happens.'];
  assert.deepEqual(renderEventLines(legacy, 'en'), legacy, 'en renders them untouched');
  assert.deepEqual(renderEventLines(legacy, 'es'), legacy, 'es renders them untouched — the honest degrade, documented in PLAYING.md');
  // A torn line (a number, null, an unknown slug) degrades without a throw.
  assert.equal(renderEventLine(42, 'es'), '42');
  assert.equal(renderEventLine(null, 'es'), '?');
  assert.equal(renderEventLine({ slug: 'no_such_beat' }, 'es'), 'no_such_beat');
  // A torn resolved array (lines = 42) degrades to no lines, like the dump always has.
  assert.deepEqual(renderEventLines(42, 'es'), []);
});

test('the compact dump renders the resolved beat in English for either language', () => {
  let state = null;
  for (let seed = 0; seed < 60 && !state; seed += 1) {
    const base = newRun({ seed });
    const staged = { ...base, floor: 1, mapNodeId: 'r1n0' };
    const travel = actions(staged).find((a) => a.nodeType === 'event');
    if (!travel) continue;
    const opened = step(staged, travel.id);
    if (opened.error) continue;
    const evState = opened.state;
    const pick = actions(evState).find((a) => a.kind === 'event_choice');
    if (!pick) continue;
    const done = step(evState, pick.id);
    if (!done.error) { state = done.state; break; }
  }
  assert.ok(state, 'a seed resolved an event');
  const dumpEn = observe(state);
  const dumpEs = observe(state, { lang: 'es' });
  assert.match(dumpEn, /RESOLVED/);
  assert.equal(dumpEs, dumpEn, 'the agent-facing dump is language-independent');
  assert.match(dumpEn, /- (Nothing happens|You paid|The \w+ took its due|Las|El )/, 'the beat lines render as sentences');
});
