// EFFECT CHIPS: the card faces' icon row, and the kernel-side words behind it.
//
// The defect this file guards: a player must not have to read a sentence to know what a
// card does at a glance — an icon and a number should carry it, and clicking the icon
// should say what the attribute does. Kernel rule (R1): the web may never derive either
// the numbers or the sentences, so:
//
//   1. describeVerbChip() gives every covered verb and every shipped status a complete,
//      non-empty EN and ES sentence, and a STATUS chip borrows STATUS_MEANING's own
//      label/clause/detail verbatim — a chip popover and a status pill cannot disagree;
//   2. cardChips() folds repeated damage (Pummel is four `{damage,2}` effects, one chip
//      "2×4"), gives `custom` effects NO chip, and reports via chipsCover() whether the
//      chips say the whole card (the tile's licence to drop the visible sentence);
//   3. the SNAPSHOT publishes the chip list for hand cards (Bellows → strength +2,
//      Kiln Cry → draw +1 and discard 1) — if this ever moved into the web layer the
//      kernel's wording monopoly would be broken, which is exactly what test 3's shape
//      assertions catch.

import test from 'node:test';
import assert from 'node:assert/strict';
import { content, loadDescribe, loadKernel } from '../helpers/harness.mjs';

const K = await loadKernel();
const { describeVerbChip, cardChips, chipsCover, describeStatus, cardPool, newRun, step, actions, snapshot } = K;
const C = await content();

/** The verbs the shipped pool actually uses (the closed vocabulary minus `custom`). */
const PLAIN_VERBS = ['damage', 'block', 'draw', 'discard', 'energy', 'heal', 'exhaust', 'retain'];
const STATUSES = ['strength', 'vulnerable', 'weak', 'dexterity', 'metallicize'];

test('every covered verb returns a complete EN and ES sentence', () => {
  for (const verb of PLAIN_VERBS) {
    for (const lang of ['en', 'es']) {
      const line = describeVerbChip(verb, null, 3, lang);
      assert.ok(line.length > 0, `${verb}/${lang} explainer is not empty`);
      assert.ok(!line.includes('undefined') && !line.includes('NaN'), `${verb}/${lang} never leaks a hole: ${line}`);
      assert.match(line, /\.$/, `${verb}/${lang} ends as a sentence: ${line}`);
      assert.ok(!/\b3\b/.test(line) || line.length > 10, `${verb}/${lang} carries its amount`);
    }
  }
});

test('a multi-hit damage chip says how many times', () => {
  assert.equal(describeVerbChip('damage', null, 2, 'en', 'player', 4), 'Deal 2 damage 4 times.');
  assert.equal(describeVerbChip('damage', null, 2, 'es', 'player', 4), 'Infliges 2 de daño 4 veces.');
});

test('status chips borrow STATUS_MEANING verbatim — pill and popover cannot disagree', () => {
  for (const key of STATUSES) {
    for (const lang of ['en', 'es']) {
      for (const side of ['player', 'enemy']) {
        const pill = describeStatus(key, 2, side, lang);
        // The status pill prints "Label n — clause."; the chip prints "Label — clause.
        // detail" — the SAME label and the SAME clause, plus the lasting-effect detail
        // the pill's own sentence omits. If the chip ever reworded either half, the
        // popover and the pill on the hero's card would disagree.
        const label = pill.slice(0, pill.indexOf(' '));
        const clause = pill.slice(pill.indexOf('—') + 1).trim();
        const chip = describeVerbChip('status', key, 2, lang, side);
        assert.ok(chip.startsWith(`${label} — `), `${key}/${lang}/${side} chip leads with the status label`);
        assert.ok(chip.includes(clause), `${key}/${lang}/${side} chip carries the pill's own clause: ${chip}`);
        assert.ok(clause.length > 0, `${key}/${lang}/${side} clause is not empty`);
      }
    }
  }
  // The user's own example, pinned: clicking Bellows' Strength chip says THIS.
  assert.equal(
    describeVerbChip('status', 'strength', 2, 'en', 'player'),
    'Strength — your attacks deal 2 more damage. Lasts the whole fight. Added to every attack you play.',
  );
  assert.equal(
    describeVerbChip('status', 'strength', 2, 'es', 'player'),
    'Fuerza — tus ataques infligen 2 de daño más. Dura todo el combate. Se suma a cada ataque que juegues.',
  );
});

test('Bellows reads as one Strength +2 chip; Kiln Cry as Draw +1 and Discard 1', () => {
  const flex = cardChips(C.cards.get('flex'));
  assert.equal(flex.length, 1, 'Bellows has exactly one chip');
  assert.equal(flex[0].verb, 'status');
  assert.equal(flex[0].status, 'strength');
  assert.equal(flex[0].amount, 2);
  assert.equal(flex[0].num, '+2');
  assert.equal(flex[0].label, 'Strength');
  assert.equal(flex[0].explain, describeVerbChip('status', 'strength', 2, 'en', 'player'));

  const es = cardChips(C.cards.get('flex'), 'es');
  assert.equal(es[0].label, 'Fuerza', 'the es chip speaks the es status label');
  assert.match(es[0].explain, /^Fuerza — /, 'the es explainer leads with the es label');

  const wc = cardChips(C.cards.get('warcry'));
  assert.deepEqual(wc.map((c) => [c.verb, c.num]), [['draw', '+1'], ['discard', '1']],
    'Kiln Cry: the draw reads as a gain (+1), the discard as a plain cost');
  assert.ok(chipsCover(C.cards.get('warcry')), 'Kiln Cry is fully chip-expressible');
  assert.ok(chipsCover(C.cards.get('flex')), 'Bellows is fully chip-expressible');
});

test('a custom-only card gets NO chip and is NOT covered — its sentence stays on the face', () => {
  const bl = cardChips(C.cards.get('bloodletting'));
  assert.deepEqual(bl, [], 'a bespoke handler claims no generic icon');
  assert.equal(chipsCover(C.cards.get('bloodletting')), false, 'Bloodletting keeps its sentence');
  // Every shipped card with a custom verb is uncovered; every fully plain one is covered.
  for (const [id, def] of C.cards) {
    const custom = def.effects.some((e) => e.verb === 'custom');
    assert.equal(chipsCover(def), !custom, `${id} coverage follows its custom verbs exactly`);
  }
});

test('repeated identical damage folds onto hits: Pummel is one 2×4 chip, not four', () => {
  const chips = cardChips(C.cards.get('pummel'));
  const dmg = chips.filter((c) => c.verb === 'damage');
  assert.equal(dmg.length, 1, 'the four identical damage effects read as ONE chip');
  assert.equal(dmg[0].num, '2×4');
  assert.equal(dmg[0].hits, 4);
  assert.ok(chips.some((c) => c.verb === 'exhaust'), 'the exhaust effect keeps its own chip');
});

test('the snapshot publishes the hand chips — Bellows strength +2, Kiln Cry draw and discard', () => {
  const base = newRun({ seed: 1 });
  const travel = actions(base).find((a) => a.kind === 'travel');
  const combat = step(base, travel.id).state;
  const state = {
    ...combat,
    combat: {
      ...combat.combat,
      hand: [
        { uid: 't1', cardId: 'flex', cost: 0 },
        { uid: 't2', cardId: 'warcry', cost: 0 },
        { uid: 't3', cardId: 'bloodletting', cost: 0 },
      ],
    },
  };
  const view = snapshot(state);
  assert.equal(view.hand.length, 3, 'the crafted hand is the painted hand');
  const [flexRow, wcRow, blRow] = view.hand;
  assert.equal(flexRow.chips.length, 1);
  assert.equal(flexRow.chips[0].status, 'strength');
  assert.equal(flexRow.chips[0].amount, 2, 'Bellows publishes strength 2');
  assert.equal(flexRow.chips[0].num, '+2');
  assert.equal(flexRow.chipsComplete, true);
  assert.deepEqual(wcRow.chips.map((c) => [c.verb, c.num]), [['draw', '+1'], ['discard', '1']],
    'Kiln Cry publishes draw +1 and discard 1');
  assert.equal(blRow.chips.length, 0);
  assert.equal(blRow.chipsComplete, false, 'a custom card keeps its visible sentence');
  const es = snapshot(state, { lang: 'es' });
  assert.equal(es.hand[0].chips[0].label, 'Fuerza');
  assert.match(es.hand[0].chips[0].explain, /tus ataques infligen 2 de daño más/);
  // The collection surfaces carry the same rows, so no surface derives its own chips.
  const pool = cardPool();
  const poolFlex = pool.find((r) => r.cardId === 'flex');
  assert.deepEqual(poolFlex.chips, flexRow.chips, 'the codex table words the chips identically');
  assert.equal(poolFlex.chipsComplete, true);
});

test('an unknown verb degrades honestly: no chip, and the explainer never empties', () => {
  assert.deepEqual(cardChips({ id: 'g', effects: [{ verb: 'mystery', amount: 1 }] }), []);
  assert.equal(chipsCover({ id: 'g', effects: [{ verb: 'mystery', amount: 1 }] }), false);
  assert.equal(chipsCover(null), false);
  assert.deepEqual(cardChips(null), []);
  assert.equal(describeVerbChip('mystery', null, 1), 'Unknown effect (mystery).',
    'the uncovered fallback mirrors describeEffect\u2019s own shape');
});

test('a SCOPED chip names its scope — the popover cannot narrow an AOE', () => {
  // Bellows Gust is a STARTER whose sentence ("Deal 4 damage to ALL enemies.") leaves
  // the face (fully covered): its chip explain must carry the same scope, or the popover
  // quietly misstates the rules.
  const gust = cardChips(C.cards.get('gust'));
  assert.equal(gust.length, 1);
  assert.equal(gust[0].explain, 'Deal 4 damage to ALL enemies.');
  assert.equal(chipsCover(C.cards.get('gust')), true, 'the scope rides the chip, so coverage keeps holding');
  const es = cardChips(C.cards.get('gust'), 'es');
  assert.equal(es[0].explain, 'Infliges 4 de daño a TODOS los enemigos.');
  // Every shipped ALL-enemies damage chip names its scope, in both languages.
  for (const [id, def] of C.cards) {
    for (const chip of cardChips(def)) {
      if (chip.verb === 'damage' && def.effects.some((e) => e.verb === 'damage' && e.target === 'all_enemies')) {
        assert.match(chip.explain, /ALL enemies/, `${id}/${chip.num} names ALL enemies`);
      }
    }
    for (const chip of cardChips(def, 'es')) {
      if (chip.verb === 'damage' && def.effects.some((e) => e.verb === 'damage' && e.target === 'all_enemies')) {
        assert.match(chip.explain, /TODOS los enemigos/, `${id}/${chip.num} (es) names TODOS los enemigos`);
      }
    }
  }
  // A definition-scoped random hit (effect target unset, def.target random_enemy)
  // reads the same way the sentence's who-derivation does.
  const rand = cardChips({ id: 'g', target: 'random_enemy', effects: [{ verb: 'damage', amount: 3 }] });
  assert.match(rand[0].explain, /a random enemy/);
  // And a single-target damage chip keeps the scopeless print.
  assert.equal(cardChips(C.cards.get('strike'))[0].explain, 'Deal 6 damage to the enemy.'.replace(' to the enemy', ''),
    'a plain strike chip says the plain fact');
});

test('an AOE STATUS chip scopes its applicator clause', () => {
  // Thunderclap's status is single-target, so its chip stays scopeless — the plain
  // "the enemy" applicator the sentence names.
  const chips = cardChips(C.cards.get('thunderclap'));
  const vuln = chips.find((c) => c.verb === 'status');
  assert.ok(vuln, 'Thunderclap carries a Vulnerable chip');
  assert.equal(vuln.explain,
    'Vulnerable — it takes 50% more damage from attacks. Wears off by 1 at the end of each of your turns.');
  // The RULE, on the shape the shipped content has not shipped yet but accepts: an
  // all-enemies status names its scope, EN and ES, so a future AOE debuff card cannot
  // ship a chip that quietly narrows itself to one enemy.
  const aoe = cardChips({
    id: 'g',
    effects: [{ verb: 'status', status: 'vulnerable', amount: 2, to: 'enemy', target: 'all_enemies' }],
  });
  assert.equal(aoe[0].explain,
    'Vulnerable on ALL enemies — it takes 50% more damage from attacks. Wears off by 1 at the end of each of your turns.');
  const es = cardChips({
    id: 'g',
    effects: [{ verb: 'status', status: 'vulnerable', amount: 2, to: 'enemy', target: 'all_enemies' }],
  }, 'es');
  assert.match(es[0].explain, /^Vulnerable sobre TODOS los enemigos — /);
  // A granted (self) status keeps the player's own voice with no scope named.
  assert.equal(cardChips(C.cards.get('flex'))[0].explain,
    'Strength — your attacks deal 2 more damage. Lasts the whole fight. Added to every attack you play.');
});

test('a tempered hand row with an HP rider is NOT chip-covered — the cost stays on the face', () => {
  const base = newRun({ seed: 2, tempers: true });
  const travel = actions(base).find((a) => a.kind === 'travel');
  const combat = step(base, travel.id).state;
  const strikeUid = combat.combat.hand.find((c) => c.cardId === 'strike')?.uid;
  const state = { ...combat, tempers: { [strikeUid]: 'redhot' } };
  const view = snapshot(state);
  const hot = view.hand.find((c) => c.temper === 'redhot');
  assert.ok(hot, 'a Red-hot card is in the hand');
  assert.match(hot.description, /Lose 2 HP when played/, 'the rider is appended to the sentence');
  assert.deepEqual(hot.chips[0].num, '9', 'the damage chip says the tempered 9');
  assert.equal(hot.chipsComplete, false,
    'the "Lose 2 HP when played." tail has no chip, so the sentence STAYS on the visible face');
  const clean = view.hand.find((c) => c.cardId === 'strike' && c.temper === null);
  assert.equal(clean.chipsComplete, true, 'an untempered copy of the same card stays fully covered');
});

test('the reward and shop snapshot rows publish the same chip lists', () => {
  const map = newRun({ seed: 3 });
  const rewardState = {
    ...map,
    phase: 'reward',
    reward: { cards: ['flex', 'warcry'], relicOffers: [], boss: false, gold: 10 },
  };
  const view = snapshot(rewardState);
  assert.equal(view.reward.cards[0].cardId, 'flex');
  assert.deepEqual(view.reward.cards[0].chips.map((c) => [c.verb, c.num]), [['status', '+2']],
    'the reward row\u2019s chips are the hand\u2019s chips');
  assert.equal(view.reward.cards[0].chipsComplete, true);
  const shopState = {
    ...map,
    phase: 'shop',
    shop: {
      offers: [{ cardId: 'warcry', price: 45 }],
      removal: { price: 75, sold: false, done: false },
      removing: false,
    },
  };
  const shop = snapshot(shopState);
  assert.deepEqual(shop.shop.offers[0].chips.map((c) => [c.verb, c.num]), [['draw', '+1'], ['discard', '1']],
    'the shelf row\u2019s chips are the hand\u2019s chips');
  assert.equal(shop.shop.offers[0].chipsComplete, true);
  const removal = snapshot({ ...shopState, shop: { ...shopState.shop, removing: true } });
  const row = removal.shop.deckInstances.find((d) => d.cardId === 'strike');
  assert.ok(row && row.chips.length === 1 && row.chips[0].num === '6', 'the removal instance row carries its chip');
});
