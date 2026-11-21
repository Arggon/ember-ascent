// tests/kernel/i18n.test.js — I18N-1: the bilingual describe layer and the snapshot's
// `lang` presentation option.
//
// WHAT IS PINNED HERE:
//   * Spanish card sentences come from the SAME effect data as the English ones (the
//     verb-keyed template tables), so a damage card, a multi-hit, a block card and a
//     power each read as complete, pinned Spanish sentences.
//   * Spanish status/power/intent text, and the Spanish relic/potion/temper/event words
//     via snapshot({lang:'es'}) — the `_es` twins, read through the bilingual field
//     lookup with the English field as the honest fallback.
//   * THE CONTRACT: the language is a surface choice — no state field, no hash input,
//     no log change. The compact dump is English-only in BOTH languages, the default
//     snapshot is the English one, and an unknown lang reads English.
//   * The fallback path: a card with no `name_es` twin (all of them, until I18N-2)
//     renders its English name; an unknown describe key degrades honestly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel, content } from '../helpers/harness.mjs';

const K = await loadKernel();
const { newRun, step, actions, snapshot, observe, hash, describeCard, describeStatus, describePower, describeIntent } = K;
const C = await content();

/** A combat state (seed 1, first node) — the shared fixture for combat-phase reads. */
function combat() {
  const base = newRun({ seed: 1 });
  const travel = actions(base).find((a) => a.kind === 'travel');
  return step(base, travel.id).state;
}

test('a damage card reads as the pinned Spanish sentence', () => {
  const def = C.cards.get('hammerfall'); // Hammerfall — the starter attack
  assert.equal(def.name, 'Hammerfall');
  assert.equal(describeCard(def, {}, 'es'), 'Infliges 6 de daño al enemigo.');
  assert.equal(describeCard(def, {}), 'Deal 6 damage to the enemy.', 'the default stays English');
});

test('a multi-hit and an ALL-enemies attack read as one Spanish sentence each', () => {
  assert.equal(
    describeCard(C.cards.get('anvil_rain'), {}, 'es'),
    'Infliges 6 de daño al enemigo 3 veces.',
  );
  assert.equal(
    describeCard(C.cards.get('cinder_storm'), {}, 'es'),
    'Infliges 3 de daño a TODOS los enemigos 4 veces.',
  );
});

test('a block card and a status card read as pinned Spanish sentences', () => {
  assert.equal(describeCard(C.cards.get('quench'), {}, 'es'), 'Ganas 5 de Bloqueo.');
  assert.equal(
    describeCard(C.cards.get('anvil_blow'), {}, 'es'),
    'Infliges 8 de daño al enemigo. Aplicas 2 de Vulnerable al enemigo — recibe 50% más de daño de los ataques.',
  );
  assert.equal(
    describeCard(C.cards.get('stoke'), {}, 'es'),
    'Ganas 2 de Fuerza — tus ataques infligen 2 de daño más.',
  );
});

test('a power card reads its Spanish custom sentence, matching its es power label', () => {
  assert.equal(
    describeCard(C.cards.get('banked_coal'), {}, 'es'),
    'Ganas Carbón Guardado: al final de cada turno, infliges 1 de daño a TODOS los enemigos y pierdes 1 HP.',
  );
  // The card's words and the status pill's words must name the power identically.
  const pill = describePower('banked_coal', 1, 'es');
  assert.match(pill, /^Carbón Guardado 1 — /);
  assert.match(pill, /Permanece por el resto del combate\.$/);
});

test('snapshot({lang:"es"}) renders Spanish hand descriptions, statuses and intents', () => {
  const state = combat();
  const es = snapshot(state, { lang: 'es' });
  const en = snapshot(state, { lang: 'en' });

  const hammerfall = es.hand.find((c) => c.cardId === 'hammerfall');
  assert.ok(hammerfall, 'the starter attack is in the opening hand (seed 1)');
  assert.equal(hammerfall.description, 'Infliges 6 de daño al enemigo.');
  assert.equal(hammerfall.typeLabel, 'Ataque');
  const quench = es.hand.find((c) => c.cardId === 'quench');
  if (quench) assert.equal(quench.description, 'Ganas 5 de Bloqueo.');

  assert.equal(es.enemies.length > 0, true);
  assert.match(es.enemies[0].intent.text, /^(Atacará|Ganará|Te aplicará|Se potenciará)/, 'the intent sentence is Spanish');
  assert.notEqual(es.enemies[0].intent.text, en.enemies[0].intent.text);

  // The English snapshot of the SAME state is unchanged, sentence for sentence.
  assert.equal(en.hand.find((c) => c.cardId === 'hammerfall').description, 'Deal 6 damage to the enemy.');
  assert.equal(en.hand.find((c) => c.cardId === 'hammerfall').typeLabel, 'Attack');
});

test('snapshot({lang:"es"}) localizes relic, potion and temper words via the _es twins', () => {
  const state = combat();
  const es = snapshot(state, { lang: 'es' });
  const starter = es.relics[0];
  assert.equal(starter.relicId, 'kindled_heart');
  assert.equal(starter.name, 'Corazón Encendido');
  assert.equal(starter.text, 'Después de cada combate, recuperas 6 HP.');
  // The compact summary stays the agent-facing English code, in either language.
  assert.equal(starter.summary, snapshot(state, { lang: 'en' }).relics[0].summary);

  const belted = { ...state, potions: ['ember_draught', 'purge_flask'] };
  const esBelt = snapshot(belted, { lang: 'es' });
  assert.equal(esBelt.belt[0].name, 'Brebaje de Ascuas');
  assert.equal(esBelt.belt[0].text, 'Inflige 20 de daño a un enemigo.');
  assert.equal(esBelt.belt[1].name, 'Frasco Purgador');

  const tempered = { ...state, phase: 'rest', temperOffers: [{ cardId: 'hammerfall', temper: 'redhot' }] };
  const esRest = snapshot(tempered, { lang: 'es' });
  assert.equal(esRest.rest.tempers[0].temperName, 'Al rojo vivo');
  assert.equal(esRest.rest.tempers[0].text, 'Al rojo vivo: +50% de daño. Pierdes 2 HP al jugarla.');
});

test('snapshot({lang:"es"}) renders the event name, story, choices and reasons in Spanish', () => {
  const state = { ...newRun({ seed: 1 }), phase: 'event', event: { id: 'collapsed_shaft' } };
  const es = snapshot(state, { lang: 'es' });
  assert.equal(es.event.name, 'El Pozo Derrumbado');
  assert.match(es.event.story, /^Un pozo cae hacia la oscuridad/);
  const climb = es.event.choices.find((c) => c.slug === 'climb');
  assert.equal(climb.label, 'Baja al pozo');
  assert.equal(climb.effect, 'Ganas 60 de oro. Pierdes 12 HP.');
  // The unmet-requirement reason is Spanish too, and the compact dump keeps English.
  const poor = { ...state, player: { ...state.player, gold: 0 } };
  const torchEs = snapshot(poor, { lang: 'es' }).event.choices.find((c) => c.slug === 'torch');
  assert.equal(torchEs.offered, false);
  assert.equal(torchEs.reason, 'necesitas 15 de oro');
  assert.equal(
    snapshot(poor, { lang: 'en' }).event.choices.find((c) => c.slug === 'torch').reason,
    'needs 15 gold',
  );
  // The compact dump (observe) stays English-only in both languages: the agent contract.
  assert.match(observe(poor), /\[needs 15 gold\]/);
});

test('the es help topics, glossary and glossary sections arrive through the snapshot', () => {
  const es = snapshot(combat(), { lang: 'es' });
  assert.equal(es.help.length, 8);
  assert.equal(es.help[0].title, 'Tienes 3 de Energía cada turno');
  assert.equal(es.glossarySections[0].title, 'Todas las cartas');
  // The compact TOKENS are language-independent; the labels and meanings are Spanish.
  const aRow = es.glossary.find((r) => r.token === 'A');
  assert.equal(aRow.label, 'Ataque');
  assert.match(aRow.meaning, /^Inflige el daño mostrado/);
  assert.equal(es.cardTypes.attack, 'Ataque');
  const en = snapshot(combat(), { lang: 'en' });
  assert.equal(en.cardTypes.attack, 'Attack');
  assert.equal(en.help[0].title, 'You have 3 Energy every turn');
});

test('THE CONTRACT: the language rides the opts — no state field, no hash input, no log change', () => {
  const state = combat();
  const es = snapshot(state, { lang: 'es' });
  const en = snapshot(state, { lang: 'en' });
  const dflt = snapshot(state);

  // The compact text dump is byte-identical in every language.
  assert.equal(es.text, en.text);
  assert.equal(es.text, dflt.text);
  assert.equal(observe(state), es.text);

  // The language never entered the state: identical runs hash identically, and a run
  // built for either language is the same run.
  const base = newRun({ seed: 1 });
  assert.equal(hash(base), hash(newRun({ seed: 1 })));
  assert.equal(JSON.stringify(base).includes('lang'), false, 'no lang field in run state');

  // ...and the SERIALIZED SAVE is byte-identical before and after an es snapshot of the
  // same state: the lang opt cannot leak into the save format any more than into the hash.
  const before = K.serializeSave(K.toSave(state, []));
  snapshot(state, { lang: 'es' });
  const after = K.serializeSave(K.toSave(state, []));
  assert.equal(before, after, 'save bytes identical across a snapshot({lang:"es"}) call');

  // The default snapshot IS the English one, field for field.
  assert.deepEqual(JSON.parse(JSON.stringify(dflt)), JSON.parse(JSON.stringify(en)));
});

test('an unknown lang reads English, and every shipped card now renders its es face name', () => {
  const state = combat();
  const fr = snapshot(state, { lang: 'fr' });
  const en = snapshot(state, { lang: 'en' });
  assert.deepEqual(JSON.parse(JSON.stringify(fr)), JSON.parse(JSON.stringify(en)));

  // I18N-2: the sweep filled every `name_es` in, so every es row renders the Spanish
  // face name — never a key name, never empty, and never the English name.
  const es = snapshot(state, { lang: 'es' });
  for (const card of es.hand) {
    const def = C.cards.get(card.cardId);
    assert.equal(card.name, def.name_es, `${card.cardId} renders its Spanish face name`);
    assert.ok(card.name.length > 0);
  }

  // An unknown handler/verb keeps the English escape hatch in both languages.
  assert.equal(
    K.describeEffect({ verb: 'custom', handler: 'no_such_handler' }, {}, 'es'),
    'Special effect (no_such_handler).',
  );
  assert.equal(describeStatus('no_such_status', 2, 'player', 'es'), 'no such status 2.');
  assert.equal(describeStatus('strength', 2, 'player', 'es'), 'Fuerza 2 — tus ataques infligen 2 de daño más.');
  assert.equal(describeStatus('strength', 2, 'enemy', 'es'), 'Fuerza 2 — sus ataques infligen 2 de daño más.');
  // An unknown enemy shape degrades to the localized "unknown" line.
  assert.equal(describeIntent(null, 'es'), 'Intención desconocida.');
  assert.equal(describeIntent(null), 'Intent unknown.');
});

test('cardPool({lang:"es"}) localizes the codex rows without touching the run pool', () => {
  const es = K.cardPool({ lang: 'es' });
  const en = K.cardPool({ lang: 'en' });
  assert.equal(es.length, en.length, 'the same rows in either language');
  const rainEs = es.find((c) => c.cardId === 'anvil_rain');
  assert.ok(rainEs, 'anvil_rain is a draftable (non-starter) card');
  assert.equal(rainEs.name, 'Lluvia de Yunces', 'the face name renders its I18N-2 twin');
  assert.equal(rainEs.description, 'Infliges 6 de daño al enemigo 3 veces.');
  assert.equal(rainEs.typeLabel, 'Ataque');
  assert.equal(en.find((c) => c.cardId === 'anvil_rain').description, 'Deal 6 damage to the enemy 3 times.');
  assert.equal(en.find((c) => c.cardId === 'anvil_rain').name, 'Anvil Rain');
  // Same sort order shape (rarity, cost, ENGLISH face name, id) in both languages:
  // the order is keyed on the definitions, so localizing names cannot re-order rows.
  assert.deepEqual(es.map((c) => c.cardId), en.map((c) => c.cardId), 'the row order is language-independent');
});

test('content validation accepts optional es twins and refuses an empty one', async () => {
  const { loadContent } = K;
  const base = {
    contentVersion: 'test',
    characters: { ashwright: { name: 'X', maxHp: 10, startingDeck: ['es_test'], startingRelic: 'kindled_heart' } },
    cards: [{
      id: 'es_test', name: 'Test', name_es: 'Prueba', flavor_es: 'Sabor', cost: 1,
      type: 'attack', rarity: 'starter', target: 'enemy', effects: [{ verb: 'damage', amount: 1 }],
    }],
  };
  // Present and non-empty: loads fine, and the es name rides the definition.
  const ok = loadContent(JSON.stringify(base));
  assert.equal(ok.cards.get('es_test').name_es, 'Prueba');
  // Absent: still fine (the normal case until I18N-2).
  const { name_es: _drop, ...withoutEs } = base.cards[0];
  const ok2 = loadContent(JSON.stringify({ ...base, cards: [withoutEs] }));
  assert.equal(ok2.cards.get('es_test').name_es, undefined);
  // Present but empty: refused, loudly.
  assert.throws(
    () => loadContent(JSON.stringify({ ...base, cards: [{ ...base.cards[0], name_es: '' }] })),
    /"name_es" must be a non-empty string/,
  );
  assert.throws(
    () => loadContent(JSON.stringify({ ...base, cards: [{ ...base.cards[0], flavor_es: 42 }] })),
    /"flavor_es" must be a non-empty string/,
  );
});
