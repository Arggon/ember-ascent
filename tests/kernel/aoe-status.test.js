// Rules fix: Forgeclap (thunderclap) and Heat Wash (shockwave) are "all" cards that cannot
// be aimed, but their statuses used `to: "enemy"`, so vocabulary.status gave them to
// enemies[0] — even a dead one. They now hit ALL living enemies, and a status never lands on
// a dead enemy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VOCABULARY } from '../../src/kernel/rules/vocabulary.js';
import { describeCard } from '../../src/kernel/describe.js';

const cards = JSON.parse(readFileSync(new URL('../../src/kernel/content/cards.json', import.meta.url), 'utf8')).cards;
const card = (id) => cards.find((c) => c.id === id);
const state = (enemies) => ({ player: { hp: 50, statuses: {} }, combat: { enemies } });
const enemy = (dead = false) => ({ hp: dead ? 0 : 20, dead, statuses: {} });

test('Forgeclap and Heat Wash apply every status to ALL enemies', () => {
  for (const id of ['thunderclap', 'shockwave']) {
    const c = card(id);
    assert.equal(c.target, 'all');
    for (const e of c.effects.filter((x) => x.verb === 'status')) assert.equal(e.to, 'all_enemies', `${id} ${e.status}`);
    assert.ok(!/to the enemy/.test(describeCard(c)), `${id}: sentence must say ALL enemies: ${describeCard(c)}`);
    assert.match(describeCard(c), /to ALL enemies/);
  }
});

test('no un-aimable ("all") card gives a status to a single enemy', () => {
  for (const c of cards.filter((x) => x.target === 'all')) {
    for (const e of c.effects.filter((x) => x.verb === 'status')) assert.ok(['all_enemies', 'self', 'player'].includes(e.to), `${c.id}: ${e.status} to ${e.to}`);
  }
});

test('all-enemy statuses skip dead enemies, even when enemy 0 is dead', () => {
  const s = state([enemy(true), enemy(), enemy()]);
  const { state: next } = VOCABULARY.status(s, { targetEnemyIndex: 0 }, { status: 'vulnerable', amount: 1, to: 'all_enemies' });
  assert.deepEqual(next.combat.enemies.map((e) => e.statuses.vulnerable ?? 0), [0, 1, 1]);
});

test('a single-target status never lands on a dead enemy', () => {
  const s = state([enemy(true), enemy()]);
  const { state: next, events } = VOCABULARY.status(s, { targetEnemyIndex: 0 }, { status: 'weak', amount: 2, to: 'enemy' });
  assert.deepEqual(next.combat.enemies.map((e) => e.statuses.weak ?? 0), [0, 0]);
  assert.deepEqual(events, []);
  const alive = VOCABULARY.status(s, { targetEnemyIndex: 1 }, { status: 'weak', amount: 2, to: 'enemy' }).state;
  assert.deepEqual(alive.combat.enemies.map((e) => e.statuses.weak ?? 0), [0, 2]);
});
