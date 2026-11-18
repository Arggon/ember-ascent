// tests/web/i18n.test.js — the UI-string dictionary (I18N-1), as a plain unit test.
//
// i18n.js is a dependency-free leaf (no runtime import), so this test imports the REAL
// module directly: every key carries an English string (the completeness pin — a wholly
// missing row cannot fall back to anything), Spanish resolves with the English twin as
// the honest fallback, interpolation fills its holes, and an unknown language reads
// English. The <html lang> switch and the persistence across a reload are covered by
// the browser e2e (tests/web/e2e.browser.spec.js), which has a real DOM and storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentLang, setLang, strings, t } from '../../src/web/i18n.js';

test('every key in the dictionary carries a non-empty English string', () => {
  const table = strings();
  assert.ok(Object.keys(table).length >= 60, `the UI dictionary is populated (${Object.keys(table).length} keys)`);
  const bad = Object.entries(table)
    .filter(([, row]) => typeof row.en !== 'string' || row.en.length === 0)
    .map(([k]) => k);
  assert.deepEqual(bad, [], `keys without an English string:\n  ${bad.join('\n  ')}`);
});

test('t() resolves English by default and Spanish after setLang', () => {
  setLang('en');
  assert.equal(currentLang(), 'en');
  assert.equal(t('combat.endTurn'), 'End Turn  (e)');
  setLang('es');
  assert.equal(currentLang(), 'es');
  assert.equal(t('combat.endTurn'), 'Terminar turno  (e)');
  assert.equal(t('hud.deck', { n: 7 }), 'Mazo (7)');
  setLang('en');
  assert.equal(t('hud.deck', { n: 7 }), 'Deck (7)');
});

test('t() fills {holes} from params and leaves an unfilled hole visible', () => {
  assert.equal(t('combat.endTurn.locked', { why: 'the enemies act' }), 'End Turn — locked while the enemies act');
  // No params at all: the template comes back with its holes as they are.
  assert.equal(t('combat.endTurn.locked'), 'End Turn — locked while {why}');
  // An unknown hole name stays verbatim — a louder failure than an empty string.
  assert.equal(t('hud.deck', { n: 1, bogus: 'x' }), 'Deck (1)');
});

test('FALLBACK: a missing Spanish value renders the English string, never a key, never empty', () => {
  const table = strings();
  const key = 'hud.help';
  const saved = table[key].es;
  try {
    delete table[key].es; // simulate the honest-fallback path for exactly one row
    setLang('es');
    assert.equal(t(key), 'Help');
    setLang('en');
    assert.equal(t(key), 'Help');
  } finally {
    table[key].es = saved;
    setLang('en');
  }
});

test('an unknown language reads English, and the toggle pair is mirrored', () => {
  setLang('fr');
  assert.equal(currentLang(), 'en', "anything that is not exactly 'es' reads English");
  assert.equal(t('combat.endTurn'), 'End Turn  (e)');
  setLang('en');

  // The language toggle's own labels are bilingual ON PURPOSE: a screen reader must
  // find the control in either language, and the visible label names the language.
  const row = strings()['lang.toggle.aria'];
  assert.equal(row.en, 'Language / Idioma');
  assert.equal(row.es, 'Language / Idioma');
  assert.equal(strings()['lang.toggle'].en, 'EN');
  assert.equal(strings()['lang.toggle'].es, 'ES');
});

test('the player-facing combat chrome is fully present in both languages', () => {
  const table = strings();
  // The strings the game shows on EVERY combat screen, in both languages, non-empty.
  for (const key of [
    'combat.endTurn', 'combat.pile.draw', 'combat.pile.discard', 'combat.hint',
    'combat.hint.targeting', 'hud.deck', 'hud.cards', 'hud.help', 'hud.newRun',
    'lang.toggle', 'lang.toggle.aria',
  ]) {
    assert.ok(table[key]?.en?.length > 0, `${key}.en`);
    assert.ok(table[key]?.es?.length > 0, `${key}.es`);
  }
});

test('WIRING: every HEROES id has a kindling blurb that renders non-empty in en AND es', () => {
  // The keys are `hero.<id>.blurb` over actions.js's HEROES ids — the two heroes'
  // LIVING CONTENT, kept by ruling after the fixed start. The retired kindling picker
  // was the only src consumer, so this pin is now the blurbs' only net: read the ids
  // from the real source so the pin cannot drift from what the game declares.
  const src = readFileSync(new URL('../../src/web/actions.js', import.meta.url), 'utf8');
  const ids = [...src.matchAll(/id:\s*'([a-z_]+)',\s*name:/g)].map((m) => m[1]);
  assert.ok(ids.length >= 2, `the two shipped heroes are declared (${ids.join(', ')})`);
  const table = strings();
  for (const id of ids) {
    const row = table[`hero.${id}.blurb`];
    assert.ok(row, `hero.${id}.blurb must exist in the dictionary (HEROES id "${id}")`);
    assert.ok(row.en.length > 0, `hero.${id}.blurb.en is non-empty`);
    assert.ok(row.es.length > 0, `hero.${id}.blurb.es is non-empty`);
    setLang('en');
    assert.ok(t(`hero.${id}.blurb`).length > 0, `t('hero.${id}.blurb') renders in en`);
    setLang('es');
    assert.ok(t(`hero.${id}.blurb`).length > 0, `t('hero.${id}.blurb') renders in es`);
  }
  setLang('en');
});
