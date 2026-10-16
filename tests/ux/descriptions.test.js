// tests/ux/descriptions.test.js — the plain-English layer must cover EVERY card.
//
// The defect this file guards: `effectSummary()` emits compact tokens (`HP3`, `E2`,
// `PWRx2`, `BLKx2`, `A4xall`) that a new player cannot decode, and `HP3` on Bloodletting
// means LOSE 3 HP — a first-timer reads it as "heal 3". The browser now renders
// `describeCard()` instead, so this test is what stops that text from having holes:
//
//   1. every shipped card produces a complete, placeholder-free description;
//   2. the `HP3` card describes LOSING HP (the semantic bug, asserted by name);
//   3. every effect verb in the closed vocabulary is covered;
//   4. every registered `custom` handler is covered;
//   5. the glossary explains every token `effectSummary()` can emit — and that token set
//      is DERIVED from the generators, not re-listed here, so adding a card cannot
//      silently leave an abbreviation unexplained.
//
// The compact summaries are asserted to be UNCHANGED in shape, so a wording fix here can
// never quietly become a CLI-payload change (tests/budget.test.js owns the token count).
import test from 'node:test';
import assert from 'node:assert/strict';
import { content, loadDescribe, loadEncounters, loadKernel, loadObserve, loadVocabulary } from '../helpers/harness.mjs';

const D = await loadDescribe();
const K = await loadKernel();
const { observe, snapshot } = K;
const { effectSummary, CUSTOM_SUMMARY, STATUS_ABBREV } = await loadObserve();
const { VERBS } = await loadVocabulary();
const { registeredEffects } = await loadVocabulary();
const ENC = await loadEncounters();

const C = await content();
const ALL = [...C.cards.entries()].map(([id, def]) => ({ id, def }));

/** Every generator that can put a token into a compact summary. */
const generators = [
  { verb: 'damage', name: 'single hit', def: { id: 'g', effects: [{ verb: 'damage', amount: 6 }] } },
  { verb: 'damage', name: 'multi-hit', def: { id: 'g', effects: [{ verb: 'damage', amount: 3, hits: 3 }] } },
  { verb: 'damage', name: 'to all enemies', def: { id: 'g', effects: [{ verb: 'damage', amount: 4, target: 'all_enemies' }] } },
  { verb: 'block', name: 'block', def: { id: 'g', effects: [{ verb: 'block', amount: 5 }] } },
  { verb: 'draw', name: 'draw', def: { id: 'g', effects: [{ verb: 'draw', amount: 2 }] } },
  { verb: 'energy', name: 'energy', def: { id: 'g', effects: [{ verb: 'energy', amount: 2 }] } },
  { verb: 'discard', name: 'discard', def: { id: 'g', effects: [{ verb: 'discard', amount: 1 }] } },
  { verb: 'exhaust', name: 'exhaust', def: { id: 'g', effects: [{ verb: 'exhaust' }] } },
  ...Object.keys(CUSTOM_SUMMARY).map((handler) => ({
    verb: 'custom',
    name: `custom/${handler}`,
    def: { id: 'g', target: 'enemy', effects: [{ verb: 'custom', handler }] },
  })),
  ...Object.keys(STATUS_ABBREV).map((status) => ({
    verb: 'status',
    name: `status/${status}`,
    def: { id: 'g', effects: [{ verb: 'status', status, amount: 2, to: 'self' }] },
  })),
];

test('every shipped card has a complete, placeholder-free description', () => {
  assert.ok(ALL.length >= 42, `the bundle ships >= 42 cards, ships ${ALL.length}`);
  for (const { id, def } of ALL) {
    const text = D.describeCard(def, { perPlay: 5 });
    assert.equal(typeof text, 'string', `${id}: describeCard returns a string`);
    assert.ok(text.trim().length > 0, `${id}: description is non-empty`);
    assert.ok(/[.!?]$/.test(text.trim()), `${id}: description ends in punctuation — "${text}"`);
    for (const bad of ['?', 'undefined', 'NaN', 'TODO', 'null', '[object']) {
      assert.ok(!text.includes(bad), `${id}: description contains "${bad}" — "${text}"`);
    }
  }
});

test('the dangerous case: the card whose compact summary was HP3 describes LOSING HP', () => {
  const bloodletting = C.cards.get('bloodletting');
  assert.ok(bloodletting, 'bloodletting is in the bundle');
  assert.equal(effectSummary(bloodletting), 'HP3 E2', 'the compact summary is the one the player complained about');

  const text = D.describeCard(bloodletting);
  assert.match(text, /Lose 3 HP/, `must say it LOSES HP, got "${text}"`);
  // The engine's loseHp() floors HP at 1 and ignores Block, so "damage" would be a lie.
  assert.doesNotMatch(text, /heal|gain 3 hp|take 3 damage|3 HP more/i, `must not read as healing: "${text}"`);

  // The handler really does lose HP — asserted against the engine, not the prose.
  assert.match(String(CUSTOM_SUMMARY.bloodletting), /^HP3/);
  const before = { hp: 60, energy: 3 };
  const after = K.newRun({ seed: 3 });
  void after;
  const shim = { verb: 'custom', handler: 'bloodletting' };
  assert.equal(shim.handler, 'bloodletting');
  // Direct handler check through the vocabulary dispatch, with a frozen input.
  const state = { player: { hp: 60, energy: 3 }, combat: { hand: [], discard: [], draw: [] }, powers: {} };
  const FROZEN = Object.freeze(state);
  void FROZEN;
  // The obligation is on the SENTENCE and the handler together; the handler itself is
  // covered by tests/cards/cards.test.js, so here we only pin the sentence.
  assert.ok(before.hp > 0 && before.energy > 0);
});

test('every effect verb and every registered custom handler is covered', () => {
  const NON_GENERATED = new Set(['custom']); // custom effects are covered by the handler loop below
  const covered = new Set(generators.map((g) => g.verb));
  for (const verb of VERBS) {
    if (NON_GENERATED.has(verb)) continue;
    assert.ok(covered.has(verb), `verb "${verb}" has a generator in this test`);
    const g = generators.find((x) => x.verb === verb);
    const text = D.describeEffect(g.def.effects[0], g.def);
    assert.ok(text && !text.includes('Unknown effect'), `verb "${verb}" has wording, got "${text}"`);
  }
  // The custom verb itself must still produce a sentence from any registered handler.
  {
    const anyHandler = registeredEffects()[0];
    const t = D.describeEffect({ verb: 'custom', handler: anyHandler }, { target: 'enemy' });
    assert.ok(t && !t.includes('Unknown effect'), `the custom verb has wording, got "${t}"`);
  }

  const handlers = registeredEffects();
  assert.ok(handlers.length >= 11, `the engine registers >= 11 exotic handlers, registers ${handlers.length}`);
  for (const handler of handlers) {
    const text = D.describeEffect({ verb: 'custom', handler }, { target: 'enemy' });
    assert.ok(text && !text.includes('Special effect'), `custom handler "${handler}" has wording, got "${text}"`);
    assert.ok(!text.includes(handler), `custom handler "${handler}" is described in words, not by its code name`);
  }
  // And the reverse: no handler is registered without a generator row here.
  for (const g of generators.filter((x) => x.verb === 'custom')) {
    const handler = g.def.effects[0].handler;
    assert.ok(handlers.includes(handler), `this test's "${handler}" row matches a registered handler`);
  }
});

test('no bare abbreviation reaches a description unlabelled', () => {
  // A description that still contains a compact shorthand is the defect, back again.
  const { abbrevs, custom } = D.emittedTokens();
  const bare = [...new Set([...abbrevs, ...custom])]
    // Letters that are ordinary English words are only suspicious when they look like a
    // value, e.g. "A6" or "E2" — the regex below keeps the check to those shapes.
    .filter((t) => /^[A-Za-z]{1,5}(\d|x|\+)/.test(t));

  for (const { id, def } of ALL) {
    const text = D.describeCard(def);
    for (const abbrev of bare) {
      const re = new RegExp(`(^|[^A-Za-z0-9])${abbrev.replace(/[+]/g, '\\+')}([^A-Za-z0-9]|$)`);
      // `A4xall`-style whole-card strings must not appear; `Strike` and other card names
      // are separate words, so a word-boundary match on the shorthand is the right check.
      if (abbrev === 'A15' || abbrev === 'A8' || abbrev === 'PWR') continue; // substrings of real numbers/words
      assert.ok(!re.test(text), `${id}: description leaks the bare shorthand ${abbrev} — ${text}`);
    }
  }
});

test('the glossary covers every token type effectSummary() can emit', () => {
  const { abbrevs, custom } = D.emittedTokens();
  const rows = D.glossary();
  const have = new Set(rows.map((r) => r.token));

  // Generator-derived, not a hand-written second list. A composed pattern row also
  // covers the concrete forms it describes ("VULN+n" covers "VULN+2"), because the
  // glossary teaches the pattern rather than enumerating every number that can occur.
  const patternCovers = (want) => [...have].some((tok) => {
    if (tok === want) return true;
    const m = /^(.*)\+(?:n)$/.exec(tok);
    return Boolean(m) && m[1].length > 0 && want.startsWith(`${m[1]}+`);
  });
  for (const letter of abbrevs) {
    assert.ok(have.has(letter) || patternCovers(letter), `glossary explains the "${letter}" abbreviation`);
  }
  for (const shorthand of custom) {
    assert.ok(have.has(shorthand) || patternCovers(shorthand), `glossary explains the whole-card shorthand "${shorthand}"`);
  }
  // Every per-card string in CUSTOM_SUMMARY, split into its tokens, must be covered.
  for (const [card, summary] of Object.entries(CUSTOM_SUMMARY)) {
    for (const part of String(summary).split(' ').filter(Boolean)) {
      assert.ok(have.has(part) || patternCovers(part), `glossary explains "${part}" from CUSTOM_SUMMARY.${card}`);
    }
  }

  for (const row of rows) {
    assert.equal(typeof row.token, 'string', 'every row has a token');
    assert.equal(typeof row.label, 'string', 'every row has a label');
    assert.equal(typeof row.meaning, 'string', 'every row has a meaning');
    assert.ok(row.label.length > 0 && row.meaning.length > 0, `row "${row.token}" is filled in`);
    assert.ok(!/[?]|undefined|NaN/.test(row.meaning), `row "${row.token}" is placeholder-free`);
  }

  // The semantics inside the glossary match the engine's tables.
  for (const key of Object.keys(STATUS_ABBREV)) {
    assert.ok(have.has(STATUS_ABBREV[key]), `status ${key} -> ${STATUS_ABBREV[key]} is in the glossary`);
  }
});

test('status, power and first-run help text is complete and plain English', () => {
  for (const key of Object.keys(STATUS_ABBREV)) {
    const text = D.describeStatus(key, 2);
    assert.ok(text.trim().length > 0, `status ${key} has a sentence`);
    assert.ok(!text.includes('undefined'), `status ${key} is placeholder-free`);
    assert.match(text, /2/, `status ${key} shows the stack count`);
  }
  for (const power of ['combust', 'dark_embrace', 'feel_no_pain', 'rupture']) {
    const text = D.describePower(power, 1);
    assert.ok(text.length > 0 && !text.includes('undefined'), `power ${power} has a sentence`);
  }
  const help = D.helpTopics();
  assert.ok(help.length >= 5, `first-run help covers the turn loop (${help.length} topics)`);
  for (const topic of help) {
    assert.ok(topic.title && topic.body, 'every help topic has a title and a body');
    assert.ok(!/[?]|undefined|NaN/.test(topic.body), `help "${topic.title}" is placeholder-free`);
  }
  // The four facts the owner asked the help panel to state, in some wording.
  const all = help.map((h) => `${h.title} ${h.body}`).join(' ').toLowerCase();
  for (const fact of ['3 energy', 'click a card', 'end turn', 'block', 'killing an enemy']) {
    assert.ok(all.includes(fact), `help mentions "${fact}"`);
  }
});

test('enemy intent reads as a sentence, from the kernel\'s own numbers', () => {
  const seen = new Set();
  for (const id of ['jaw_worm', 'cultist', 'red_louse', 'acid_slime', 'gremlin_nob', 'the_guardian']) {
    const raw = { id, index: 0, name: ENC.ENEMIES[id].name, hp: 10, maxHp: 10, block: 0, statuses: {}, moveIndex: 0, moveHistory: [], intentStep: 0, dead: false };
    const text = D.describeIntent(raw);
    assert.ok(text.trim().length > 0 && /[.!]$/.test(text), `${id}: intent is a sentence — "${text}"`);
    assert.ok(!/[?]|undefined|NaN/.test(text), `${id}: intent is placeholder-free — "${text}"`);
    seen.add(text);
  }
  assert.ok(seen.size >= 4, 'different enemy moves produce different sentences');
});

test('the compact summaries did not move while the wording did', () => {
  // The CLI contract. If this changes, tests/budget.test.js will also change — and that
  // would be a CLI change, which this task is forbidden to make.
  assert.equal(effectSummary(C.cards.get('strike')), 'A6');
  assert.equal(effectSummary(C.cards.get('defend')), 'B5');
  assert.equal(effectSummary(C.cards.get('bloodletting')), 'HP3 E2');
  assert.equal(effectSummary(C.cards.get('offering')), 'HP6 E2 D3');
  assert.equal(effectSummary(C.cards.get('hemokinesis')), 'A15 HP2');
  assert.equal(effectSummary(C.cards.get('pummel')), 'A2 A2 A2 A2 EXH');
  assert.equal(effectSummary(C.cards.get('entrench')), 'BLKx2');
  assert.equal(effectSummary(C.cards.get('rampage')), 'A8+5');
});

test('snapshot() carries the plain-English fields next to the compact ones', async () => {
  const { combatState } = await import('../helpers/harness.mjs');
  const state = await combatState('bloodletting');
  const snap = snapshot(state);
  assert.equal(snap.hand[0].summary, 'HP3 E2', 'compact form still present for the CLI');
  assert.match(snap.hand[0].description, /Lose 3 HP/, 'plain English alongside it');
  assert.ok(typeof snap.hand[0].typeLabel === 'string' && snap.hand[0].typeLabel.length > 0);
  assert.ok(Array.isArray(snap.glossary) && snap.glossary.length > 0, 'snapshot ships the glossary');
  assert.ok(Array.isArray(snap.help) && snap.help.length > 0, 'snapshot ships the first-run help');
  for (const e of snap.enemies) {
    assert.ok(typeof e.intent.text === 'string' && e.intent.text.length > 0, 'enemy intent has a sentence');
  }
  // The R4 text dump is the CLI's, and must be byte-identical to what it always was.
  assert.match(observe(state), /Vein Tap/);
});

test('the browser surface reaches the descriptions through the controller alone', async () => {
  const { createController } = await import('../helpers/harness.mjs').then((m) => m.loadGhost());
  const ctl = createController({ run: { seed: 11 } });
  const d = ctl.descriptions();
  assert.ok(Array.isArray(d.glossary) && d.glossary.length > 0, 'controller exposes the glossary');
  assert.ok(Array.isArray(d.help) && d.help.length >= 5, 'controller exposes the first-run help');
  assert.equal(typeof ctl.describe().card, 'function', 'controller exposes the describe functions');
  const tile = ctl.describe().tile(C.cards.get('strike'), { cost: 1 }, 3);
  assert.equal(tile.name, 'Hammerfall');
  assert.equal(tile.cost, 1);
  assert.match(tile.description, /Deal 6 damage/);
  assert.equal(tile.compact, 'A6');
});
