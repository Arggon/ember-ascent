// The enemy intent badge must read PER-HIT damage × hits, like the intent label ("A5x3")
// and the sentence ("Will attack for 5 damage 3 times").
//
// THE BUG THIS PINS: observe() hands the renderer `intent.damage` as the TOTAL over all
// hits (intentDamage() multiplies by hits), and the badge then printed `${damage}×${hits}`.
// The Guardian's Whirlwind (5 damage, 3 hits) showed "15×3" — reading as 45 damage.
//
// src/web/app.js is a browser module that boots on import, so this lifts intentBadge() out of
// it and runs it against minimal stand-ins for el()/attackTier()/intentGlyph(), fed with
// the kernel's real intent numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENEMIES } from '../../src/kernel/rules/encounters.js';
import { intentDamage } from '../../src/kernel/rules/act.js';

const src = readFileSync(new URL('../../src/web/app.js', import.meta.url), 'utf8');
const start = src.indexOf('function intentBadge(e) {');
assert.ok(start >= 0, 'intentBadge() not found in src/web/app.js');
const end = src.indexOf('\n}\n', start);
const body = src.slice(start, end + 2);

function el(tag, opts = {}) {
  const node = { tag, cls: opts.cls ?? '', text: opts.text ?? '', kids: [], innerHTML: '' };
  node.append = (...k) => node.kids.push(...k);
  return node;
}
const intentBadge = new Function('el', 'attackTier', 'intentGlyph', `${body}\nreturn intentBadge;`)(
  el, (d) => (d >= 20 ? 3 : d >= 10 ? 2 : 1), () => '<svg></svg>',
);

function badgeNumber(enemy) {
  const def = ENEMIES[enemy.id];
  const move = def.moves[enemy.moveIndex];
  const intent = { kind: move.kind, damage: intentDamage(enemy), hits: move.hits ?? 1 };
  const num = intentBadge({ intent }).kids.find((k) => k.cls === 'intent-num');
  return num?.text;
}

const guardian = ENEMIES.the_guardian;
const whirlwind = guardian.moves.findIndex((mv) => mv.id === 'whirlwind');

test('the Guardian\'s Whirlwind badge reads 5×3, not 15×3', () => {
  assert.ok(whirlwind >= 0, 'the_guardian has a whirlwind move');
  assert.equal(guardian.moves[whirlwind].label, 'A5x3');
  assert.equal(badgeNumber({ id: 'the_guardian', moveIndex: whirlwind, statuses: {} }), '5×3');
});

test('per-hit badge folds in Strength and Weak the same way the kernel does', () => {
  assert.equal(badgeNumber({ id: 'the_guardian', moveIndex: whirlwind, statuses: { strength: 2 } }), '7×3');
  assert.equal(badgeNumber({ id: 'the_guardian', moveIndex: whirlwind, statuses: { weak: 1 } }), '3×3');
});

test('single-hit attacks still show the plain number', () => {
  const bash = guardian.moves.findIndex((mv) => mv.kind === 'attack' && (mv.hits ?? 1) === 1);
  assert.ok(bash >= 0);
  assert.equal(badgeNumber({ id: 'the_guardian', moveIndex: bash, statuses: {} }), String(guardian.moves[bash].damage));
});
