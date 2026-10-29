// Key-functionality e2e over the REAL web surface (Playwright, headless Chromium).
//
// SCOPE. The game's load-bearing flows, driven the way a player drives them — real
// clicks on the served page, no DOM shortcuts for game actions:
//   1. boot → kindling choice → the map
//   2. a basic attack card deals its printed damage (no targeting with one enemy)
//   3. end turn advances the turn and the enemy does what its intent announced
//   4. a killing stroke resolves the fight into the reward screen
//   5. Maul's signature (stage shake + ember shockwave) fires through the REAL
//      targeting path (card click → numbered targets → enemy click), the regression
//      for the delayed-fx fix (bfa7bf7) and its coexistence with the hit-stop queue
//   6. the S1 master-deck sheet lists the starting deck from the map AND from combat
//      (read-only: no tempered badge at run start, duplicates counted, Esc/Close both
//      dismiss it and the run underneath is untouched)
//   7. the S2 card codex groups the whole draft pool by rarity with counts, shows a known
//      card's describe-layer sentence, wears the "in deck" chip on an injected copy, and
//      Escape dismisses it without moving the run
//   8. the S3 gold economy: a victory pays the purse (the reward head's "+N gold" chip
//      and the HUD readout agree on the same kernel value) and the next victory adds to
//      it; the run summary names the final purse
//   9. the S4 shop: the vendor is a labelled map node with five priced shelves and the
//      purse in view; a click buys a card (the deck sheet agrees mid-shop), the removal
//      service is a modal pick of deck instances, unaffordable shelves are inert, and
//      leaving is final
//  10. the S5 potions: three empty belt slots at boot; a won fight drops a potion into
//      the belt (seed 1: fight 2, Ember Draught); in the next combat the chip opens the
//      quaff/discard popover, quaffing consumes the slot and lands the effect on the
//      engine state, and a discard frees exactly its slot
//  11. the S7 relics: one HUD readout chip (count + the held names in its tooltip); an
//      elite victory always drops a relic (the spoils chip, the chip counting to 2); the
//      boss offers three relic buttons instead of cards, taking one ends the run in
//      victory, and the run summary names the relic count. S10: the walk boots with a
//      doctored VETERAN ledger (the documented dlb.runs.v1 agg schema, 10 lifetime wins)
//      so the warden's vault holds rares — the FRESH-profile walk below owns the gate.
//
// RUN. `npm run test:browser`. Deliberately NOT matched by the default `npm test`
// glob (`tests/**/*.test.js`): this file is `.spec.js` so the default suite stays
// dependency-free and fast, and the browser e2e is opt-in.
//
// REQUIREMENTS. Playwright + its Chromium build. The repo is dependency-free, so
// the module is resolved from `playwright` first, then PLAYWRIGHT_MODULE_PATH, then
// the mise-installed copy used for live verification. Without it every test skips.
//
// FIXTURES. Kernel state is frozen deep and the surface repaints only from the
// snapshot act() refreshes, so cards cannot be injected into a live hand. The one
// writable lever is ctl.load(save): parse ctl.save(), append deck entries, reload
// — BEFORE travelling. The fight then deals them like real cards. Transient FX are
// sampled by an in-page 40ms collector: stage-shake lasts 450ms and fx-shockwave
// 560ms, which round-trip polling from Node can miss.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** Playwright without making the repo depend on it. */
function loadChromium() {
  try { return require('playwright').chromium; } catch { /* fall through */ }
  const fallback = process.env.PLAYWRIGHT_MODULE_PATH
    ?? '/home/arggon/.local/share/mise/installs/npm-playwright/1.64.1/node_modules/playwright';
  try { return require(fallback).chromium; } catch { return null; }
}
const chromium = loadChromium();

const SERVE = fileURLToPath(new URL('../../scripts/serve.mjs', import.meta.url));
let child;
let base;

before(async () => {
  if (!chromium) return;
  const port = await new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
  child = spawn(process.execPath, [SERVE, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('serve.mjs did not start')), 10000);
    child.stdout.on('data', (b) => { if (String(b).includes('serving')) { clearTimeout(t); res(); } });
    child.once('exit', (code) => { clearTimeout(t); rej(new Error(`serve.mjs exited ${code}`)); });
  });
  base = `http://127.0.0.1:${port}`;
});

after(() => { child?.kill(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fresh browser + page with the first-run help dismissed. Caller closes the browser.
 *  `seed` defaults to 7; a test whose claim is pinned to a specific first fight picks
 *  its own (the S4 map shift moved every seed's encounter rolls). */
async function freshPage(t, seed = 7) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'no-preference',
  });
  t.after(() => { void browser.close(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {} });
  await page.goto(`${base}/src/web/index.html?seed=${seed}`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

const readState = (page) => page.evaluate(() => {
  const st = window.__dlb.controller().state;
  return {
    phase: st.phase,
    floor: st.floor,
    turn: st.combat ? st.combat.turn : null,
    player: { hp: st.player.hp, maxHp: st.player.maxHp, energy: st.player.energy },
    enemies: st.combat && st.combat.enemies
      ? st.combat.enemies.filter((e) => !e.dead)
        .map((e) => ({ index: e.index, id: e.id, hp: e.hp, dead: !!e.dead }))
      : [],
    hand: st.combat && st.combat.hand ? st.combat.hand.map((c) => ({ cardId: c.cardId, cost: c.cost })) : [],
    rewardCards: st.reward && st.reward.cards ? st.reward.cards.length : 0,
  };
});

/** The kernel's printed intent for an enemy, e.g. "A11" — from the surface snapshot. */
const readIntents = (page) => page.evaluate(() => window.__dlb.snapshot().enemies
  .map((e) => ({ index: e.index, kind: e.intent.kind, damage: e.intent.damage })));

/** Take a kindling boon and land on the map. Preference order: Bellows Breath (fast
 *  fights), then Iron Skin (deck-neutral: the S4 map shift re-rolled the seed-7 offer
 *  list, and the deck-sheet test pins the untouched 10-card deck), then whatever is
 *  offered. Ash Purge / Sparkfall change the deck, so they are last resorts. */
async function bootToMap(page) {
  assert.ok((await page.locator('button.boon').count()) > 0, 'a kindling boon is offered');
  const preferred = page.getByRole('button', { name: /^Bellows Breath:/ });
  if ((await preferred.count()) > 0) await preferred.first().click();
  else {
    const skin = page.getByRole('button', { name: /^Iron Skin:/ });
    if ((await skin.count()) > 0) await skin.first().click();
    else await page.locator('button.boon').first().click();
  }
  await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });
}

/** Reload the session from a save whose deck carries 8 Mauls (see header: the one lever). */
async function injectMaulDeck(page) {
  const res = await page.evaluate(() => {
    const ctl = window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    for (let i = 0; i < 8; i += 1) save.state.deck.push({ uid: `e2e-maul-${i}`, cardId: 'bludgeon' });
    return ctl.load(save);
  });
  assert.equal(res.ok, true, `save/load failed: ${JSON.stringify(res.problems)}`);
}

/** Travel to the first reachable ordinary fight (Skirmish / Hard fight — never Elite). */
async function travelToFight(page) {
  const nodes = page.locator('button[aria-label*="Skirmish"], button[aria-label*="Hard fight"]');
  assert.ok((await nodes.count()) > 0, 'no fight node reachable');
  await nodes.first().click();
  await page.waitForSelector('.enemy', { timeout: 5000 });
}

/** Click an enabled card by name prefix; a target-needing play resolves on `pickIndex`. */
async function playCard(page, namePrefix, pickIndex = null) {
  const card = page.locator(`button[data-slot][aria-label^="${namePrefix}"][aria-disabled="false"]`);
  assert.ok((await card.count()) > 0, `${namePrefix} not playable in hand`);
  await card.first().click();
  if (pickIndex === null) return;
  await page.waitForSelector('.enemy.targeting', { timeout: 3000 });
  const target = page.locator(`.enemy[data-target-index="${pickIndex}"]`);
  assert.equal(await target.count(), 1, `aimed enemy ${pickIndex} not found`);
  await target.click();
}

async function endTurn(page) {
  const end = page.locator('button', { hasText: 'End Turn' });
  assert.equal(await end.count(), 1, 'End Turn button not found');
  await end.click();
}

/** Skip (or take) the floor reward until the map is back. */
async function leaveReward(page) {
  for (let guard = 0; guard < 6; guard += 1) {
    if ((await readState(page)).phase !== 'reward') return;
    const skip = page.locator('button[data-action]', { hasText: /skip/i });
    if ((await skip.count()) >= 1) await skip.first().click();
    else await page.keyboard.press('0');
    await sleep(900);
  }
}

/** The Maul probe needs 2+ enemies with one naturally above 32 HP: Maul's stroke must
 *  NOT kill, or the shockwave beat (759ms) races the victory hold (480ms). Floor-1
 *  fights never qualify, so walk them, skip rewards, rest-hops, and climb until one
 *  does. (Budget 16: the S4 map draw shifted every seed's path, and seed 7's qualifies
 *  on floor 4 at step ~14 — the claim never cared how many fights it took.) */
async function reachQualifyingFight(page) {
  for (let step = 0; step < 16; step += 1) {
    const s = await readState(page);
    if (s.phase === 'combat') {
      if (s.enemies.length > 1 && s.enemies.some((e) => e.hp > 32)) return s;
      await playOutTransitFight(page);
      continue;
    }
    if (s.phase === 'reward') { await leaveReward(page); continue; }
    if (s.phase === 'map') { await travelToFight(page); continue; }
    if (s.phase === 'rest') {
      await page.getByRole('button', { name: 'Move on' }).first().click();
      await sleep(500);
      continue;
    }
    assert.fail(`the walk ended before a qualifying fight (phase ${s.phase})`);
  }
  assert.fail('no qualifying fight within 16 steps');
}

/** Transit fight: spend attacks (kills are fine here — no claim is taken from these). */
async function playOutTransitFight(page) {
  for (let guard = 0; guard < 24; guard += 1) {
    const s = await readState(page);
    if (s.phase !== 'combat') return;
    const attack = page.locator('button[data-slot].type-attack[aria-disabled="false"]');
    if ((await attack.count()) > 0) {
      await attack.first().click();
      await sleep(300);
      if (s.enemies.length > 1) {
        const toughest = s.enemies.reduce((a, b) => (b.hp > a.hp ? b : a));
        const tgt = page.locator(`.enemy[data-target-index="${toughest.index + 1}"]`);
        if ((await tgt.count()) === 1) await tgt.click();
        else await page.keyboard.press('Escape');
      }
      await sleep(3400);
    } else {
      await endTurn(page);
      await sleep(2200);
    }
  }
}

/* ------------------------------------------------------------------ tests -- */

test('boot: kindling choice leads to the map with a reachable fight', { timeout: 60000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t);
  await bootToMap(page);
  const s = await readState(page);
  assert.equal(s.phase, 'map');
  assert.ok((await page.locator('button[aria-label^="Travel to"]').count()) > 0, 'no travel node painted');
});

/** The S1 deck sheet, opened from wherever the player is. */
async function openDeck(page) {
  const btn = page.locator('#hud button[aria-label^="Deck:"]');
  assert.equal(await btn.count(), 1, 'the HUD Deck control must be present (exactly one)');
  await btn.click();
  await page.waitForSelector('.modal.deck-modal', { timeout: 3000 });
}

test('deck: the master-deck sheet shows the starting deck from the map, and again in combat', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t);
  await bootToMap(page);

  // MAP PHASE. The control names the count (the kernel's own deckCount), the sheet is a
  // labelled dialog, and the rows are the starting deck aggregated: Hammerfall ×5,
  // Quench ×4, Anvil Blow ×1 — nothing tempered at run start.
  const btn = page.locator('#hud button[aria-label^="Deck:"]');
  assert.equal(await btn.getAttribute('aria-label'), 'Deck: 10 cards', 'the control must announce the deck size');
  assert.equal((await btn.textContent()).trim(), 'Deck (10)');
  await openDeck(page);

  const sheet = page.locator('.modal.deck-modal');
  assert.equal(await sheet.getAttribute('aria-label'), 'Deck: 10 cards', 'the sheet must be a labelled dialog');
  assert.equal(await sheet.locator('h2').textContent(), 'Deck (10)', 'the sheet title carries the count');
  const rows = sheet.locator('.deck-row');
  assert.equal(await rows.count(), 3, 'the 10-card starting deck must aggregate to 3 rows');
  const hammer = rows.filter({ hasText: 'Hammerfall' });
  assert.equal(await hammer.count(), 1, 'exactly one Hammerfall row (duplicates counted, not repeated)');
  assert.equal(await hammer.locator('.deck-count').textContent(), '×5', 'the five starter strikes read as one ×5 row');
  assert.equal(await rows.filter({ hasText: 'Quench' }).locator('.deck-count').textContent(), '×4');
  assert.equal(await rows.filter({ hasText: 'Anvil Blow' }).count(), 1);
  assert.equal(await sheet.locator('.ctemper').count(), 0, 'nothing in the starting deck may wear a temper stamp');
  // Deterministic order: cost then name — Hammerfall and Quench share cost 1, so the
  // cheaper pair leads and the cost-2 Anvil Blow closes the list.
  const names = await rows.locator('.deck-name').allTextContents();
  assert.deepEqual(names, ['Hammerfall', 'Quench', 'Anvil Blow']);

  // Escape closes it (keyboard affordance); the map is exactly where it was.
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal.deck-modal', { state: 'detached', timeout: 3000 });
  assert.equal(await readState(page).then((s) => s.phase), 'map', 'closing the sheet must not move the run');

  // COMBAT PHASE. The same control is present in the fight; the deck is the same deck.
  await travelToFight(page);
  await openDeck(page);
  const combatSheet = page.locator('.modal.deck-modal');
  assert.equal(await combatSheet.locator('.deck-row').count(), 3, 'the deck is unchanged in combat');
  assert.equal(await combatSheet.locator('.ctemper').count(), 0);
  // The Close button is the mouse affordance out.
  await combatSheet.getByRole('button', { name: /Close/ }).click();
  await page.waitForSelector('.modal.deck-modal', { state: 'detached', timeout: 3000 });
  assert.equal(await readState(page).then((s) => s.phase), 'combat', 'the fight must still be running after closing');
});

test('deck: tempered copies injected through the save lever wear their own stamped row', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t);
  await bootToMap(page);
  // The lever's second half (per the roadmap recipe): a bare ctl.load() does not repaint,
  // so the test travels — the running web boot opts runs into tempers, so state.tempers
  // exists in the save and a uid pushed here can carry a temper.
  const res = await page.evaluate(() => {
    const ctl = window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    save.state.deck.push({ uid: 'e2e-hot-0', cardId: 'strike' }, { uid: 'e2e-hot-1', cardId: 'strike' });
    save.state.tempers['e2e-hot-0'] = 'redhot';
    save.state.tempers['e2e-hot-1'] = 'redhot';
    return ctl.load(save);
  });
  assert.equal(res.ok, true, `save/load failed: ${JSON.stringify(res.problems)}`);
  await travelToFight(page);
  await openDeck(page);

  const hot = page.locator('.modal.deck-modal .deck-row.tempered');
  assert.equal(await hot.count(), 1, 'the tempered pair must aggregate into ONE row of its own');
  assert.equal(await hot.locator('.ctemper .t-name').textContent(), 'Red-hot', 'the row must wear the temper stamp');
  assert.equal(await hot.locator('.deck-count').textContent(), '×2', 'the injected pair reads as one ×2 row');
});

/** The S2 card codex, opened from the HUD's Cards control. */
async function openCodex(page) {
  const btn = page.locator('#hud button[aria-label^="Card codex:"]');
  assert.equal(await btn.count(), 1, 'the HUD Cards control must be present (exactly one)');
  await btn.click();
  await page.waitForSelector('.modal.codex-modal', { timeout: 3000 });
}

test('codex: the Cards sheet groups the draft pool by rarity and marks owned copies', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t);
  await bootToMap(page);

  // The save/load lever (see header): one Slag Surge (cardId ironwave) into the deck, so
  // the sheet can be pinned against an owned copy. The ironclad starters are not pool
  // cards, so this is the ONLY owned copy the codex can chip. The lever's own second half
  // (per the roadmap recipe) is a real action: a bare ctl.load() swaps the session but
  // does not repaint — `act()` does — so the test travels to the first fight (the deck's
  // CONTENTS are untouched by travel) and reads the codex from the refreshed paint, in
  // combat, the same place the S1 deck test reads its sheet.
  const res = await page.evaluate(() => {
    const ctl = window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    save.state.deck.push({ uid: 'e2e-codex-1', cardId: 'ironwave' });
    return ctl.load(save);
  });
  assert.equal(res.ok, true, `save/load failed: ${JSON.stringify(res.problems)}`);
  await travelToFight(page);

  // S10 NOTE: this test boots a FRESH ledger, and the boot now builds the run through
  // the same newGame() a restart uses — so the sheet is the run's REAL narrowed pool
  // (the S2 truth fix, finally visible from the first paint too). S8 grew the shipped
  // table 44 → 70, and the fresh composition moved with it: 20 offerable cards
  // (16 common, 4 uncommon, NO rare — rule 4 holds rares back as the prize; the four
  // uncommons ride the one-card-per-verb and named-in-help rules, not the fill).
  const poolLen = await page.evaluate(() => window.__dlb.controller().snapshot().draftPool.length);
  assert.equal(poolLen, 20, 'the fresh run offers 20 cards');
  const btn = page.locator('#hud button[aria-label^="Card codex:"]');
  assert.equal(await btn.count(), 1, 'the HUD Cards control must be present (exactly one)');
  assert.equal(await btn.getAttribute('aria-label'), 'Card codex: 20 cards', 'the control must announce the pool size');
  await openCodex(page);

  const sheet = page.locator('.modal.codex-modal');
  assert.equal(await sheet.getAttribute('aria-label'), 'Card codex: 20 cards', 'the sheet must be a labelled dialog');
  assert.equal(await sheet.locator('h2').textContent(), 'Cards (20)', 'the sheet title carries the pool size');
  const heads = await sheet.locator('.codex-group-head').allTextContents();
  assert.deepEqual(heads, ['Common (16)', 'Uncommon (4)'], 'the fresh groups with their counts — and no rare group, honestly absent');
  assert.equal(await sheet.locator('.codex-row').count(), 20, 'every pool card is one row');

  // Spot-check one known row: Slag Surge (cardId ironwave), cost 1, its describe-layer
  // sentence verbatim — and the full-table card Maul stays ABSENT from a fresh sheet
  // (the codex shows what the run can be offered, never the whole shipped table).
  const surge = sheet.locator('.codex-row', { hasText: 'Slag Surge' });
  assert.equal(await surge.count(), 1, 'Slag Surge renders exactly one row');
  assert.equal(await surge.locator('.codex-name').textContent(), 'Slag Surge');
  assert.equal(await surge.locator('.codex-cost').textContent(), '1');
  assert.equal(await surge.locator('.codex-desc').textContent(), 'Gain 5 Block. Deal 5 damage to the enemy.');
  assert.equal(await sheet.locator('.codex-row', { hasText: 'Maul' }).count(), 0, 'a locked card is not on the sheet');

  // The injected copy wears the brass chip; nothing else in this deck is a pool card.
  assert.equal(await surge.locator('.codex-indeck').textContent(), 'in deck ×1');
  assert.equal(await sheet.locator('.codex-indeck').count(), 1, 'exactly one owned copy to chip');

  // The codex owns the keyboard while it is open (E8b regression): `d` must NOT stack the
  // deck sheet on top of it and `n` must not start a run behind it — still exactly the one
  // codex sheet — then Escape recovers below.
  await page.keyboard.press('d');
  await page.keyboard.press('n');
  assert.equal(await page.locator('.modal').count(), 1, 'keys are swallowed while the codex is open');
  assert.equal(await page.locator('.modal.codex-modal').count(), 1, 'the surviving sheet is still the codex');
  assert.equal(await page.locator('.modal.deck-modal').count(), 0, 'the deck sheet must not open over the codex');

  // Escape closes it (keyboard affordance); the fight is exactly where it was.
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal.codex-modal', { state: 'detached', timeout: 3000 });
  assert.equal(await readState(page).then((s) => s.phase), 'combat', 'closing the codex must not move the run');
});

test('combat: a basic attack deals its printed damage without targeting', { timeout: 60000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t);
  await bootToMap(page);
  await travelToFight(page);

  const before = await readState(page);
  assert.equal(before.enemies.length, 1, 'seed 7 floor 1 is the single Jaw Worm');
  const energyBefore = before.player.energy;

  // `strike` is named Hammerfall on the card face: "Deal 6 damage to the enemy."
  await playCard(page, 'Hammerfall');
  await sleep(2600); // pose + floats

  const after = await readState(page);
  const worm = after.enemies[0];
  // Nothing has blocked yet on turn 1, so the printed 6 lands in full.
  assert.equal(worm.hp, before.enemies[0].hp - 6, 'the basic attack must deal exactly its printed damage');
  assert.equal(after.player.energy, energyBefore - 1, 'playing the card must spend its cost');
});

test('end turn: the turn advances and the enemy does what its intent announced', { timeout: 60000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t);
  await bootToMap(page);
  await travelToFight(page);

  const before = await readState(page);
  const intents = await readIntents(page);
  const announced = intents[0].kind === 'attack' ? intents[0].damage : 0;

  await endTurn(page);
  // The enemy turn plays out over ~1.5s of animation; poll for the new turn.
  let after = null;
  for (let i = 0; i < 20 && !after; i += 1) {
    await sleep(300);
    const s = await readState(page);
    if (s.turn === before.turn + 1) after = s;
  }
  assert.ok(after, 'turn must advance after End Turn');
  if (announced > 0) {
    assert.equal(before.player.hp - after.player.hp, announced,
      `the enemy announced ${announced} damage and must deal exactly that (no block was raised)`);
  }
});

// ---------------------------------------------------------------------------
// UX-3: the cost gem is a SOCKETED CIRCLE. The old top:-6px/left:-2px offsets hung the
// gem's top arc past the card's border box, where the combat card's own overflow:hidden
// sheared it flat (the user's screenshot), and at the narrow tiers the type word ran
// under the gem ("TACK"). The contract, asserted on the real served page at the two
// representative tiers (the owner-approved desktop and a phone) with the real 5-card
// hand and a grown 7-card hand (the full matrix lives in scripts/dev/viewport-check.mjs,
// which builds the same measurement from the frozen sizes):
//   * every gem's full circle (border included) lies inside its card rectangle — measured
//     on a transform-free clone of each card laid out in an off-screen lab at the live
//     hand's width, so the fan's rotation cannot mask an offset;
//   * every live gem circle and every hand card bounding box sits inside the viewport
//     (a deliberate scroller's by-design window excepted: its first card is whole);
//   * the type word never starts under the gem's circle.
// ---------------------------------------------------------------------------
test('UX-3: every cost gem is a whole circle inside its card, and the type word clears it', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t, 7);
  await bootToMap(page);
  await travelToFight(page);
  await sleep(1300); // the deal-in animation settles before any rect is read

  const GEM_PROBE = () => {
    const out = { gemOutsideCard: [], gemOutsideVp: [], wordUnderGem: [], cardOutsideVp: [], cards: 0 };
    const vw = innerWidth, vh = innerHeight;
    const hand = document.querySelector('.hand');
    if (!hand) return out;
    const scrolls = /auto|scroll/.test(getComputedStyle(hand).overflowX) && hand.scrollWidth > hand.clientWidth + 1;
    const lab = document.createElement('div');
    lab.className = 'stage-combat';
    lab.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;';
    const labHand = document.createElement('div');
    labHand.className = 'hand';
    labHand.style.width = hand.clientWidth + 'px';
    lab.append(labHand);
    document.body.append(lab);
    const wraps = [...hand.querySelectorAll(':scope > .card-wrap')];
    // Clone EVERY wrap before measuring any: flex shares the lab row across the whole hand,
    // so a lone clone grows to its max-width cap instead of the realized width.
    const clones = wraps.map((w) => {
      const c = w.cloneNode(true);
      c.style.setProperty('--i', '0');
      const cc = c.querySelector('.card');
      if (cc) cc.style.transform = 'none';
      labHand.append(c);
      return c;
    });
    wraps.forEach((wrap, i) => {
      const card = wrap.querySelector('.card');
      const clone = clones[i].querySelector('.card');
      if (!card || !clone) return;
      out.cards += 1;
      const name = card.querySelector('.cname')?.textContent.trim() ?? '?';
      const liveVisible = !scrolls || i === 0; // scrolled-out cards are the scroller's design
      if (liveVisible) {
        const cr = card.getBoundingClientRect();
        if (cr.left < -0.5 || cr.top < -0.5 || cr.right > vw + 0.5 || cr.bottom > vh + 0.5) {
          out.cardOutsideVp.push(`${name}[${[cr.left, cr.top, cr.right, cr.bottom].map(Math.round).join(',')}]`);
        }
        const gem = card.querySelector('.cost-gem');
        if (gem) {
          const gr = gem.getBoundingClientRect();
          if (gr.left < -0.5 || gr.top < -0.5 || gr.right > vw + 0.5 || gr.bottom > vh + 0.5) {
            out.gemOutsideVp.push(`${name}[${[gr.left, gr.top, gr.right, gr.bottom].map(Math.round).join(',')}]`);
          }
        }
      }
      const cg = clone.querySelector('.cost-gem');
      if (!cg) { out.gemOutsideCard.push(`${name}: no .cost-gem`); return; }
      const box = clone.getBoundingClientRect();
      const gr = cg.getBoundingClientRect();
      const slack = [gr.left - box.left, gr.top - box.top, box.right - gr.right, box.bottom - gr.bottom];
      if (slack.some((s) => s < -0.5)) {
        out.gemOutsideCard.push(`${name} slack[${slack.map((s) => s.toFixed(1)).join(',')}]`);
      }
      const ct = clone.querySelector('.ctype');
      const word = [...ct.querySelectorAll('span')].find((s) => !/c-type-mark|c-illus/.test(s.className) && s.textContent.trim());
      if (word) {
        const wrd = [...word.getClientRects()].filter((x) => x.width > 0.5);
        if (wrd.length) {
          const wl = Math.min(...wrd.map((x) => x.left));
          const wt = Math.min(...wrd.map((x) => x.top));
          const wb = Math.max(...wrd.map((x) => x.bottom));
          if (gr.right > wl + 0.5 && gr.left < wl && gr.bottom > wt && gr.top < wb) {
            out.wordUnderGem.push(`${name} (gem right ${Math.round(gr.right - box.left)} vs word left ${Math.round(wl - box.left)})`);
          }
        }
      }
    });
    lab.remove();
    return out;
  };

  const GROW7 = `(() => {
    const hand = document.querySelector('.hand');
    hand.classList.remove('deal-in');
    const src = [...hand.children];
    while (hand.children.length < 7) hand.append(src[hand.children.length % src.length].cloneNode(true));
    const names = ['Hammerfall', 'Untempered', 'Overtemper', 'Returning Brand', 'Forgeclap', 'Climbing Heat', 'Unbroken'];
    [...hand.children].forEach((w, i) => {
      w.style.setProperty('--i', String(i));
      const nm = w.querySelector('.cname');
      if (nm) nm.textContent = names[i % names.length];
    });
    hand.style.setProperty('--n', String(hand.children.length));
    hand.scrollLeft = 0;
    return hand.children.length;
  })()`;

  for (const [w, h] of [[1280, 800], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(400); // the tier rules re-resolve at the new size
    const five = await page.evaluate(GEM_PROBE);
    assert.ok(five.cards === 5, `a 5-card hand is dealt at ${w}x${h} (got ${five.cards})`);
    assert.deepEqual(five.gemOutsideCard, [], `gems not fully inside their cards at ${w}x${h}`);
    assert.deepEqual(five.gemOutsideVp, [], `gem circles outside the viewport at ${w}x${h}`);
    assert.deepEqual(five.wordUnderGem, [], `type words run under the gem at ${w}x${h}`);
    assert.deepEqual(five.cardOutsideVp, [], `hand cards outside the viewport at ${w}x${h}`);
  }

  // The 7-card hand (markup-grown with the longest-word names, like the harness fixture):
  // the desktop row compresses, the phone row takes the deliberate scroller.
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await page.evaluate(GROW7), 7, 'the hand grows to 7 cards');
  await sleep(400);
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(400);
    const seven = await page.evaluate(GEM_PROBE);
    assert.ok(seven.cards === 7, `the 7-card hand is still dealt at ${w}x${h} (got ${seven.cards})`);
    assert.deepEqual(seven.gemOutsideCard, [], `7-card gems not fully inside their cards at ${w}x${h}`);
    assert.deepEqual(seven.gemOutsideVp, [], `7-card gem circles outside the viewport at ${w}x${h}`);
    assert.deepEqual(seven.wordUnderGem, [], `7-card type words run under the gem at ${w}x${h}`);
    assert.deepEqual(seven.cardOutsideVp, [], `7-card hand cards outside the viewport at ${w}x${h}`);
  }
});

// ---------------------------------------------------------------------------
// UX-2: the enemy turn is a SEQUENCE of named attacks, not one simultaneous slam.
// Seed 22's opening fight is two Kiln Mites whose turn-1 intents are both "Will
// attack for 6" — the smallest shape that can prove ordering. The claims:
//   * the kernel truth is unchanged (turn advances, the announced total lands);
//   * each attacker's OWN named float ("Kiln Mite −6") lands over the hero, in
//     attack order, one beat apart — and no aggregate "−12" float paints;
//   * the current attacker's intent badge carries the striking highlight, and the
//     highlight MOVES: attacker 1's window starts a beat before attacker 2's.
// The floats and the highlight are transient (~1s), so an in-page 40ms collector
// samples them, exactly like the kill beat's collector.
// ---------------------------------------------------------------------------
test('the enemy turn plays as ordered, named attacks (UX-2 sequence)', { timeout: 60000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t, 22);
  await bootToMap(page);
  await travelToFight(page);

  const intents = await readIntents(page);
  const attackers = intents.filter((i) => i.kind === 'attack');
  assert.ok(attackers.length >= 2, `the seeded fight needs two attackers: ${JSON.stringify(intents)}`);
  const announced = attackers.reduce((n, i) => n + i.damage, 0);

  await page.evaluate(() => {
    window.__seq = { floats: [], badgeRuns: [] };
    const seen = new WeakSet();
    window.__seqTimer = setInterval(() => {
      for (const n of document.querySelectorAll('#fx-layer .fx-strike-float')) {
        if (seen.has(n)) continue;
        seen.add(n);
        window.__seq.floats.push({ text: (n.textContent || '').trim(), t: Math.round(performance.now()) });
      }
      const running = [];
      for (const card of document.querySelectorAll('.enemy.is-striking')) {
        const badge = card.querySelector('.intent-badge');
        // ACTIVELY lit, not merely scheduled: a delayed CSS animation reports playState
        // 'running' and progress 0 through its delay phase too (the badge is held unlit
        // there), so the lit window is computed from the animation's own clock: from
        // its delay to delay+duration is exactly while that attacker's slam plays.
        const live = badge && badge.getAnimations
          ? badge.getAnimations().some((a) => {
            if (a.animationName !== 'intent-strike' || a.playState !== 'running' || !a.effect) return false;
            const t = a.effect.getComputedTiming();
            const at = (a.currentTime ?? 0) - (t.delay ?? 0);
            return at >= 0 && at < (t.duration ?? 0);
          })
          : false;
        if (live) running.push(card.getAttribute('data-target-index'));
      }
      window.__seq.badgeRuns.push({ t: Math.round(performance.now()), ks: running });
    }, 40);
  });

  const before = await readState(page);
  await endTurn(page);
  // The sequence at 1x: floats land ~0.3s and ~0.8s in, the turn settles by ~1.7s.
  await sleep(2400);
  const seq = await page.evaluate(() => { clearInterval(window.__seqTimer); return window.__seq; });
  const after = await readState(page);

  assert.equal(after.turn, before.turn + 1, 'the turn still advances');
  assert.equal(before.player.hp - after.player.hp, announced,
    'the kernel total still equals what the intents announced');

  // One NAMED float per attacker, each carrying its own damage; no aggregate number.
  assert.equal(seq.floats.length, attackers.length,
    `one named float per attacker: ${JSON.stringify(seq.floats)}`);
  for (let i = 0; i < seq.floats.length; i += 1) {
    assert.match(seq.floats[i].text, new RegExp(`−${attackers[i].damage}`),
      `float ${i} carries its own attacker's damage: ${seq.floats[i].text}`);
    assert.match(seq.floats[i].text, /Kiln Mite/, `the float NAMES the attacker: ${seq.floats[i].text}`);
  }
  assert.ok(seq.floats[1].t - seq.floats[0].t >= 200,
    `the strikes land in ORDER, a beat apart: ${seq.floats.map((f) => `${f.text}@${f.t - seq.floats[0].t}ms`).join(', ')}`);

  // The striking badge highlight moves with the sequence: attacker 1's window opens
  // first, attacker 2's a beat later.
  const firstOf = (k) => seq.badgeRuns.find((r) => r.ks.includes(k)) ?? null;
  const one = firstOf('1');
  const two = firstOf('2');
  assert.ok(one, 'attacker 1 badge carried the intent-strike highlight');
  assert.ok(two, 'attacker 2 badge carried the intent-strike highlight');
  assert.ok(two.t - one.t >= 200,
    `the highlight moved attacker 1 -> attacker 2, a beat apart: ${two.t - one.t}ms`);
});

test('kill: the stroke plays against the hold stage, then the reward arrives', { timeout: 240000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  // Seed 1 deals the exact shape this claim needs (the S4 map draw shift moved seed 7's
  // opening fight): a single 43-HP Jaw Worm — Maul (32) leaves 11 on turn 1, the second
  // stroke kills on turn 2.
  const page = await freshPage(t, 1);
  await bootToMap(page);
  await injectMaulDeck(page);
  await travelToFight(page);

  // In-page collector for the kill beat: the hold is transient (~1.5s for a signature
  // stroke) and the shockwave fires mid-hold, so sample from inside the page.
  await page.evaluate(() => {
    window.__fx = { shake: 0, shockwave: 0, hold: 0, heroInHold: 0 };
    window.__fxTimer = setInterval(() => {
      const stage = document.getElementById('stage');
      if (stage && stage.classList.contains('stage-shake')) window.__fx.shake += 1;
      if (document.querySelector('.fx-shockwave')) window.__fx.shockwave += 1;
      if (stage && stage.querySelector('.ended-hold')) {
        window.__fx.hold += 1;
        if (stage.querySelector('.stage-combat .fight .hero')) window.__fx.heroInHold += 1;
      }
    }, 40);
  });

  // Turn 1: Maul (32) leaves the 43-HP Jaw Worm at 11.
  let s = await readState(page);
  if (!s.hand.some((c) => c.cardId === 'bludgeon')) {
    await endTurn(page);
    await sleep(2200);
    s = await readState(page);
    assert.ok(s.hand.some((c) => c.cardId === 'bludgeon'), 'no Maul dealt in two hands');
  }
  await playCard(page, 'Maul');
  await sleep(3400);

  await endTurn(page);
  await sleep(2200);

  // Turn 2: Maul kills. The stroke must PLAY — hold stage with the hero + the shockwave
  // beat — and only then hand over to the reward screen.
  await playCard(page, 'Maul');
  let reward = null;
  for (let i = 0; i < 40 && !reward; i += 1) {
    await sleep(350);
    const st = await readState(page);
    if (st.phase === 'reward') reward = st;
  }
  assert.ok(reward, 'a killing stroke must resolve the fight into the reward phase');
  assert.ok(reward.rewardCards > 0, 'the reward must offer cards');
  // The kernel flips to `reward` at the kill, while the hold is still playing; the
  // clickable panel arrives when the beat ends.
  await page.waitForSelector('button[data-action]', { timeout: 5000 });

  const fx = await page.evaluate(() => window.__fx);
  assert.ok(fx.hold > 0, 'the kill must hold the fight stage before the panel (the beat)');
  assert.ok(fx.heroInHold > 0, 'the held stage must include the hero figure');
  assert.ok(fx.shake > 0, "Maul's stage shake must fire during the kill");
  assert.ok(fx.shockwave > 0, "Maul's ember shockwave must fire during the kill");

  // S3 GOLD: the victory paid. The reward head carries the "+N gold" chip (the kernel's
  // own goldGained), the HUD purse is the start purse plus exactly that N — one computed
  // value each, screen and HUD cannot disagree — and the NEXT victory adds to the same
  // purse.
  const chip = page.locator('.reward-gold');
  assert.equal(await chip.count(), 1, 'the reward head carries exactly one spoils chip');
  const chipText = await chip.textContent();
  const gained = Number(/\+(\d+) gold/.exec(chipText)?.[1]);
  assert.ok(gained >= 10 && gained <= 17, `a floor-0 fight pays the weak tier 10-17, got "${chipText}"`);
  const purseText = await page.locator('#hud .stat.gold').textContent();
  assert.equal(Number(/(\d+)$/.exec(purseText)[1]), 99 + gained,
    `the HUD purse is 99 + the shown spoils (chip "${chipText}", hud "${purseText}")`);
  assert.match((await chip.getAttribute('title')) ?? '', new RegExp(`purse: ${99 + gained} gold`),
    'the chip tooltips the same total the HUD shows');

  // A second combat pays again, on top of the first purse.
  await leaveReward(page);
  await travelToFight(page);
  for (let guard = 0; guard < 24; guard += 1) {
    const st = await readState(page);
    if (st.phase !== 'combat') break;
    const maul = page.locator('button[data-slot][aria-label^="Maul"][aria-disabled="false"]');
    if ((await maul.count()) > 0) {
      await maul.first().click();
      if ((await page.locator('.enemy.targeting').count()) > 0) {
        await page.locator('.enemy[data-target-index]').first().click();
      }
      await sleep(1200);
    } else {
      await endTurn(page);
      await sleep(1800);
    }
  }
  let reward2 = null;
  for (let i = 0; i < 40 && !reward2; i += 1) {
    await sleep(350);
    const st = await readState(page);
    if (st.phase === 'reward') reward2 = st;
  }
  assert.ok(reward2, 'the second fight resolves into its reward');
  const chip2Text = await page.locator('.reward-gold').textContent();
  const gained2 = Number(/\+(\d+) gold/.exec(chip2Text)?.[1]);
  assert.ok(gained2 >= 10, `the second spoils chip names its grant, got "${chip2Text}"`);
  const purse2Text = await page.locator('#hud .stat.gold').textContent();
  assert.equal(Number(/(\d+)$/.exec(purse2Text)[1]), 99 + gained + gained2,
    'the second victory adds its spoils to the same purse');
});

test('signature: Maul fires shake + shockwave through the real targeting path', { timeout: 300000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t);
  await bootToMap(page);
  await injectMaulDeck(page);
  await travelToFight(page);
  const fight = await reachQualifyingFight(page);

  const tank = fight.enemies.find((e) => e.hp > 32);
  const other = fight.enemies.find((e) => e !== tank);
  const maul = page.locator('button[data-slot][aria-label^="Maul"][aria-disabled="false"]');
  assert.ok((await maul.count()) > 0, 'a Maul must be playable in the qualifying fight');

  // In-page FX collector: transient classes sampled every 40ms (see header).
  await page.evaluate(() => {
    window.__fx = { shake: 0, shockwave: 0, floats: 0, hitstop: 0 };
    window.__fxTimer = setInterval(() => {
      const stage = document.getElementById('stage');
      if (stage && stage.classList.contains('stage-shake')) window.__fx.shake += 1;
      if (stage && stage.classList.contains('hitstop')) window.__fx.hitstop += 1;
      if (document.querySelector('.fx-shockwave')) window.__fx.shockwave += 1;
      if (document.querySelector('.efloat:not(.is-queued)')) window.__fx.floats += 1;
    }, 40);
  });

  await maul.first().click();

  // Targeting engages: the card is pending, every living enemy is highlighted + numbered.
  await page.waitForSelector('.enemy.targeting', { timeout: 3000 });
  assert.equal(await page.locator('.enemy.targeting').count(), fight.enemies.length,
    'every living enemy must be a numbered target while aiming');
  assert.equal(await maul.first().getAttribute('aria-pressed'), 'true',
    'the pending card must announce its targeting state');

  await page.locator(`.enemy[data-target-index="${tank.index + 1}"]`).click();
  await sleep(3200); // pose 1150ms; impact beat at 66% = 759ms; shockwave lives 560ms

  const fx = await page.evaluate(() => window.__fx);
  const after = await readState(page);

  // The aimed enemy took exactly the stroke; the other enemy is untouched.
  const afterTank = after.enemies.find((e) => e.index === tank.index);
  const afterOther = after.enemies.find((e) => e.index === other.index);
  assert.equal(afterTank.hp, tank.hp - 32, 'the stroke must land exactly on the aimed enemy');
  assert.equal(afterOther.hp, other.hp, 'the un-aimed enemy must not take splash damage');

  // The signature effects fired and coexist with the hit-stop queue (bfa7bf7).
  assert.ok(fx.shake > 0, 'stage-shake must be seen (450ms window)');
  assert.ok(fx.shockwave > 0, 'the ember shockwave must be seen (560ms window)');
  assert.ok(fx.hitstop > 0, 'the hit-stop feel queue must still run');
  assert.ok(fx.floats > 0, 'damage floats must rise');

  // The tank survived on purpose: no victory-hold race muddies the claim.
  assert.equal(after.phase, 'combat', 'the fight must still be running');
});

test('thrown hammers arc from the hero and land on the aimed enemy', { timeout: 300000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  // A fixed seed deals a FIXED hand: probe seeds until one deals the salvo (one redraw
  // each), then verify the arc on that attempt. Seed 13 leads with twin Kiln Mites
  // (15/10) — the shape the arc probe wants — since the S4 map draw shift re-rolled
  // every seed's opening fight.
  for (const seed of [13, 7, 8, 9, 10, 11, 12]) {
    const attempt = await probeHammerArc(t, seed);
    if (!attempt) continue;
    const { arc } = attempt;
    assert.ok(arc.first && arc.first.x < 320,
      `the hammer must launch from the hero's side (first sample at ${JSON.stringify(arc.first)})`);
    assert.ok(arc.minDist < 80,
      `the hammer must land on the aimed enemy (closest approach ${Math.round(arc.minDist)}px)`);
    return;
  }
  assert.fail('no seed dealt Twin Hammers in two hands');
});

/** Boot, inject a twin-heavy deck, travel, and fly one salvo. Returns the arc samples,
 *  or null when this seed's two hands held no Twin Hammers. Closes its own browser. */
async function probeHammerArc(t, seed) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {} });
    await page.goto(`${base}/src/web/index.html?seed=${seed}`);
    await page.waitForLoadState('domcontentloaded');
    // The kindling offer is seed-dependent; base 3 Energy covers the salvo's cost 1,
    // so whichever gift is offered will do.
    const bellows = page.getByRole('button', { name: /^Bellows Breath:/ });
    if ((await bellows.count()) === 1) await bellows.click();
    else await page.getByRole('button', { name: /^(Iron Skin|Sparkfall):/ }).first().click();
    await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });
    await page.evaluate(() => {
      const ctl = window.__dlb.controller();
      const save = JSON.parse(ctl.save());
      for (let i = 0; i < 8; i += 1) save.state.deck.push({ uid: `e2e-twin-${i}`, cardId: 'twin_strike' });
      const res = ctl.load(save);
      if (!res.ok) throw new Error(`save/load failed: ${(res.problems || []).join('; ')}`);
    });
    await travelToFight(page);

    let s = await readState(page);
    if (!s.hand.some((c) => c.cardId === 'twin_strike')) {
      await endTurn(page);
      await sleep(2200);
      s = await readState(page);
      if (s.phase !== 'combat' || !s.hand.includes('twin_strike')) return null;
    }

    // Sample the flying hammer against the enemy's live position.
    await page.evaluate(() => {
      const card = document.querySelector('.enemy[data-target-index]');
      const cr = card.getBoundingClientRect();
      window.__aim = { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 };
      window.__arc = { first: null, minDist: Infinity };
      window.__arcTimer = setInterval(() => {
        const h = document.querySelector('.fx-hammer');
        if (!h) return;
        const r = h.getBoundingClientRect();
        const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        if (!window.__arc.first) window.__arc.first = p;
        const d = Math.hypot(p.x - window.__aim.x, p.y - window.__aim.y);
        if (d < window.__arc.minDist) window.__arc.minDist = d;
      }, 40);
    });

    const twin = page.locator('button[data-slot][aria-label^="Twin Hammers"][aria-disabled="false"]');
    assert.ok((await twin.count()) > 0, 'Twin Hammers must be playable');
    await twin.first().click();
    // A two-enemy fight engages the aiming step (the salvo must be aimed); a single
    // enemy plays on the click alone. Either way the hammer flies after the aim.
    const aiming = page.locator('.enemy.targeting');
    if ((await aiming.count()) > 0) await aiming.first().click();
    await sleep(2600);
    return { arc: await page.evaluate(() => window.__arc) };
  } finally {
    await browser.close();
  }
}

test('a killing throw holds the victim in its slot until the hammer lands', { timeout: 300000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  // Probe seeds for a two-enemy first fight where the salvo (5x2) kills the weaker foe.
  // (S6 moved the map draw again: rows 2 and 6 hold the events, so the old sweep's
  // openers changed. Seed 56 opens on louses 12/10 — the weaker second, the shape the
  // slot-hold pins; 55's tie puts the victim first and the survivor on the wrong side.)
  for (const seed of [56, 55, 13, 7, 8, 9, 10, 11, 12]) {
    const r = await probeKillSlot(t, seed);
    if (!r) continue;
    const { before, mid } = r;
    const victimBefore = before.find((b) => b.t === String(mid.victimIdx + 1));
    const ghostNow = mid.ghost;
    const survivorNow = mid.survivors.find((b) => b.t !== String(mid.victimIdx + 1));
    const survivorBefore = before.find((b) => b.t !== String(mid.victimIdx + 1));
    assert.ok(ghostNow, 'the killed enemy must remain on stage as an addressed ghost');
    assert.ok(Math.abs(ghostNow.x - victimBefore.x) < 60,
      `the ghost must hold the victim's slot (ghost ${ghostNow.x}px vs victim ${victimBefore.x}px)`);
    assert.ok(mid.ghostOpacity > 0.5,
      `the ghost must still be visible while the hammer flies (opacity ${mid.ghostOpacity})`);
    assert.ok(survivorNow && survivorBefore && Math.abs(survivorNow.x - survivorBefore.x) < 30,
      'the survivor must not slide into the dead foe\'s slot mid-flight');
    return;
  }
  assert.fail('no seed offered a two-enemy fight the salvo could end');
});

/** Boot into a two-enemy floor-1 fight, kill the weaker foe with Twin Hammers, and
 *  sample the row mid-flight. Returns null when the seed does not offer the setup. */
async function probeKillSlot(t, seed) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {} });
    await page.goto(`${base}/src/web/index.html?seed=${seed}`);
    await page.waitForLoadState('domcontentloaded');
    const bellows = page.getByRole('button', { name: /^Bellows Breath:/ });
    if ((await bellows.count()) === 1) await bellows.click();
    else await page.getByRole('button', { name: /^(Iron Skin|Sparkfall):/ }).first().click();
    await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });
    await page.evaluate(() => {
      const ctl = window.__dlb.controller();
      const save = JSON.parse(ctl.save());
      for (let i = 0; i < 8; i += 1) save.state.deck.push({ uid: `e2e-kill-twin-${i}`, cardId: 'twin_strike' });
      const res = ctl.load(save);
      if (!res.ok) throw new Error(`save/load failed: ${(res.problems || []).join('; ')}`);
    });
    await travelToFight(page);
    await sleep(600);

    let s = await readState(page);
    if (s.enemies.length !== 2) return null;
    if (!s.hand.some((c) => c.cardId === 'twin_strike')) {
      await endTurn(page);
      await sleep(2200);
      s = await readState(page);
      if (s.phase !== 'combat' || !s.hand.some((c) => c.cardId === 'twin_strike')) return null;
    }
    const victim = s.enemies.reduce((a, b) => (b.hp < a.hp ? b : a));
    if (victim.hp > 10) return null; // the salvo must KILL, or there is no reflow to pin

    const before = await page.evaluate(() => [...document.querySelectorAll('.enemy[data-target-index]')]
      .map((el) => { const r = el.getBoundingClientRect(); return { t: el.getAttribute('data-target-index'), x: Math.round(r.x + r.width / 2) }; }));

    const twin = page.locator('button[data-slot][aria-label^="Twin Hammers"][aria-disabled="false"]');
    await twin.first().click();
    await page.waitForSelector('.enemy.targeting', { timeout: 3000 });
    await page.locator(`.enemy[data-target-index="${victim.index + 1}"]`).click();
    await sleep(500); // mid-flight; the ghost holds until ~756ms, then shatters

    const mid = await page.evaluate((victimIdx) => {
      const g = document.querySelector(`.enemy.is-dying[data-death-index="${victimIdx}"]`);
      const survivors = [...document.querySelectorAll('.enemy[data-target-index]')]
        .map((el) => { const r = el.getBoundingClientRect(); return { t: el.getAttribute('data-target-index'), x: Math.round(r.x + r.width / 2) }; });
      return {
        victimIdx,
        ghost: g ? { x: Math.round(g.getBoundingClientRect().x + g.getBoundingClientRect().width / 2) } : null,
        ghostOpacity: g ? Number(getComputedStyle(g).opacity) : 0,
        survivors,
      };
    }, victim.index);
    return { before, mid };
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

test('smoke: las nuevas firmas emiten su fx propio', { timeout: 300000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  // The seed fixes the deal: probe seeds until one lets all four representatives reach
  // the stage (8 copies each in a ~42-card deck makes that the common case).
  for (const seed of [7, 8, 9, 10, 11, 12]) {
    const fx = await probeSignatureFx(t, seed);
    if (!fx) continue;
    assert.ok(fx.slagwave > 0, 'Slag Surge (ironwave) must roll its slag wave into the aimed lane');
    assert.ok(fx.heatwash > 0, 'Heat Wash (shockwave) must drag its thermal wave across the whole row');
    assert.ok(fx.stokedraft > 0, 'Stoke (inflame) must draft its embers over the hero');
    assert.ok(fx.platestack > 0, 'Unbroken (impervious) must stack its plates as the skill exhausts');
    return;
  }
  assert.fail('no seed let all four signature cards reach the stage');
});

/** Boot, stack the deck with one representative per signature family (8 copies each,
 *  dealt like real cards — see header), and play each once. Returns what the 40ms
 *  collector saw, or null when this seed's eight hands could not get all four played.
 *  Closes its own browser. */
async function probeSignatureFx(t, seed) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {} });
    await page.goto(`${base}/src/web/index.html?seed=${seed}`);
    await page.waitForLoadState('domcontentloaded');
    const bellows = page.getByRole('button', { name: /^Bellows Breath:/ });
    if ((await bellows.count()) === 1) await bellows.click();
    else await page.getByRole('button', { name: /^(Iron Skin|Sparkfall):/ }).first().click();
    await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });
    await page.evaluate(() => {
      const ctl = window.__dlb.controller();
      const save = JSON.parse(ctl.save());
      for (const id of ['ironwave', 'shockwave', 'inflame', 'impervious']) {
        for (let i = 0; i < 8; i += 1) save.state.deck.push({ uid: `e2e-fx-${id}-${i}`, cardId: id });
      }
      const res = ctl.load(save);
      if (!res.ok) throw new Error(`save/load failed: ${(res.problems || []).join('; ')}`);
    });
    await travelToFight(page);

    // In-page collector: each signature fx is transient (a ~0.2-0.3×pose beat, then
    // 720-1240ms alive), so sample every 40ms from inside the page (see header).
    await page.evaluate(() => {
      window.__fx = { slagwave: 0, heatwash: 0, stokedraft: 0, platestack: 0 };
      window.__fxTimer = setInterval(() => {
        for (const cls of ['fx-slagwave', 'fx-heatwash', 'fx-stokedraft', 'fx-platestack']) {
          if (document.querySelector(`.${cls}`)) window.__fx[cls.slice(3)] += 1;
        }
      }, 40);
    });

    // Face name → collector key: the fx classes are unique per card (Heat Wash's wave
    // is fx-heatwash — Maul's ring is fx-shockwave, no clash).
    const FACES = [
      ['slagwave', 'Slag Surge'],   // ironwave
      ['heatwash', 'Heat Wash'],    // shockwave
      ['stokedraft', 'Stoke'],      // inflame
      ['platestack', 'Unbroken'],   // impervious
    ];
    const pending = new Set(FACES.map(([key]) => key));
    for (let hand = 0; hand < 8 && pending.size > 0; hand += 1) {
      if ((await readState(page)).phase !== 'combat') return null;
      for (const [key, face] of FACES) {
        if (!pending.has(key)) continue;
        const btn = page.locator(`button[data-slot][aria-label^="${face}"][aria-disabled="false"]`);
        if ((await btn.count()) === 0) continue;
        const seen = await page.evaluate((k) => window.__fx[k], key);
        await btn.first().click();
        // Only the attack aims: with 2+ enemies the row enters targeting; with one it
        // plays straight through (see playCard).
        if ((await page.locator('.enemy.targeting').count()) > 0) {
          await page.locator('.enemy[data-target-index]').first().click();
        }
        await sleep(2000); // beat + fx life; also keeps the next play from retiring this
                           // one's pending signature timer (the animGen guard)
        if ((await page.evaluate((k) => window.__fx[k], key)) > seen) pending.delete(key);
      }
      if (pending.size === 0) break;
      await endTurn(page);
      await sleep(2200);
    }
    return pending.size === 0 ? await page.evaluate(() => window.__fx) : null;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

// The run-over screen was the one surface no e2e reached: a full victory (or a run that
// ends at all) never happened in this file, so a mid-render crash there — the run-history
// `el` defect shipped with the module split — left a BLANK stage where the restart menu
// belongs and every other suite stayed green. This walks a whole run to the end (win or
// loss at the Warden both exercise it) and asserts the restart menu is on screen.
test('a full run ends on the restart menu, not a blank stage', { timeout: 300000 }, async (t) => {
  if (!chromium) return t.skip('playwright unavailable');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce', // paint instantly: the walk's assertions are structural
  });
  t.after(() => { void browser.close(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {} });
  await page.goto(`${base}/src/web/index.html?seed=7`);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('button.boon').first().click(); // any boon; the walk does not care which
  await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });
  const res = await page.evaluate(() => {
    const ctl = window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    for (let i = 0; i < 10; i += 1) save.state.deck.push({ uid: `e2e-run-${i}`, cardId: 'bludgeon' });
    return ctl.load(save);
  });
  assert.equal(res.ok, true, `save/load failed: ${JSON.stringify(res.problems)}`);

  let sawBossFight = false;
  for (let guard = 0; guard < 400; guard += 1) {
    const phase = await page.evaluate(() => window.__dlb.snapshot().phase);
    if (phase === 'ended') break;
    if (phase === 'map') {
      const boss = page.locator('button[aria-label*="boss" i]').first();
      if ((await boss.count()) > 0) await boss.click();
      else await page.locator('button[aria-label^="Travel to"]').last().click();
    } else if (phase === 'combat') {
      const names = await page.evaluate(() => window.__dlb.snapshot().enemies.map((e) => e.name).join(','));
      if (/warden/i.test(names)) sawBossFight = true;
      const maul = page.locator('.card:not(.disabled)', { hasText: 'Maul' }).first();
      if ((await maul.count()) > 0) {
        await maul.click();
        const tgt = page.locator('.enemy.targeting').last();
        if ((await tgt.count()) > 0) await tgt.click();
      } else {
        await page.getByRole('button', { name: /End Turn/i }).click();
      }
    } else {
      const card = page.locator('#stage .card:not(.disabled)').first();
      if ((await card.count()) > 0) await card.click();
      else {
        const btn = page.locator('#stage button:not(:disabled)').first();
        if ((await btn.count()) > 0) await btn.click();
        else { await page.keyboard.press('1'); }
      }
    }
    await sleep(120);
  }
  await sleep(1000);
  assert.equal(errors.length, 0, `no page errors during the run: ${errors.join(' | ')}`);
  assert.equal(await page.evaluate(() => window.__dlb.snapshot().phase), 'ended', 'the run reached its end');
  assert.ok(sawBossFight, 'the walk fought the Slag Warden');
  const restartVisible = await page.getByRole('button', { name: /Restart/i }).isVisible();
  assert.ok(restartVisible, 'the restart menu is on the screen after the run ends');
  // S3: the summary line carries the purse the run finished with (the kernel's own
  // player.gold — the same value the HUD showed from boot). S7: beside it, the relic
  // count the run carried to its end (the boss pick adds the third one on this walk).
  const endStats = await page.locator('.end-stats').textContent();
  assert.match(endStats, /· \d+ gold · \d+ relics?$/, `the run summary names the purse and the relic count: ${endStats}`);
});

// ---------------------------------------------------------------------------
// 9. the S4 shop: the vendor is a labelled map node; walking in shows five priced
//    shelves and the purse; a real click buys a card (purse down, deck up, the deck
//    sheet agrees mid-shop); the removal service is a modal pick of deck INSTANCES;
//    an unaffordable shelf is inert (the kernel never offered it); leaving is final
//    and returns to the map with no shop left to enter.
// ---------------------------------------------------------------------------
test('shop: the vendor sells a card, removes one, and closes for good', { timeout: 300000 }, async (t) => {
  if (!chromium) return t.skip('playwright/chromium unavailable');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce', // paint instantly: the walk's assertions are structural
  });
  t.after(() => { void browser.close(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {} });
  await page.goto(`${base}/src/web/index.html?seed=7`);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('button.boon').first().click(); // any boon; the walk does not care which
  await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });
  const res = await page.evaluate(() => {
    const ctl = window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    for (let i = 0; i < 10; i += 1) save.state.deck.push({ uid: `e2e-shop-${i}`, cardId: 'bludgeon' });
    return ctl.load(save);
  });
  assert.equal(res.ok, true, `save/load failed: ${JSON.stringify(res.problems)}`);

  // The walk: rows 0-4 the honest way (real clicks), fights preferred, the injected
  // Mauls end fights fast; seed 7 reaches floor 4 with a purse that covers the service
  // plus a cheap shelf, verified against the engine before this test was written.
  for (let guard = 0; guard < 240; guard += 1) {
    const st = await readState(page);
    if (st.phase === 'map' && st.floor === 4) break;
    if (st.phase === 'map') {
      const fight = page.locator('button[aria-label*="Skirmish"], button[aria-label*="Hard fight"]').first();
      if ((await fight.count()) > 0) await fight.click();
      else await page.getByRole('button', { name: 'Move on' }).first().click();
      await sleep(500);
    } else if (st.phase === 'combat') {
      const card = page.locator('button[data-slot][aria-disabled="false"]').first();
      if ((await card.count()) > 0) {
        await card.click();
        const tgt = page.locator('.enemy.targeting').first();
        if ((await tgt.count()) > 0) await tgt.click();
        await sleep(700);
      } else {
        await endTurn(page);
        await sleep(1300);
      }
    } else if (st.phase === 'reward') {
      await leaveReward(page);
    } else if (st.phase === 'rest') {
      await page.getByRole('button', { name: 'Move on' }).first().click();
      await sleep(500);
    } else {
      await sleep(400);
    }
  }
  const staged = await readState(page);
  assert.equal(staged.phase, 'map', 'the walk reached floor 4');
  assert.equal(staged.floor, 4, 'standing on row 4: the vendor row is next');

  // The shop node is labelled like any other, and it is the middle choice of row 5.
  const shopNode = page.locator('button[aria-label*="Shop"]');
  assert.equal(await shopNode.count(), 1, 'exactly one Shop node is travel-legal');
  await shopNode.click();
  await page.waitForSelector('.shop-grid', { timeout: 5000 });

  // The purse chip and the HUD read the same kernel number.
  const purse = await page.evaluate(() => window.__dlb.snapshot().shop.purse);
  const hudPurse = Number(/(\d+)$/.exec(await page.locator('#hud .stat.gold').textContent())[1]);
  assert.equal(purse, hudPurse, 'the shop purse and the HUD agree');
  assert.ok(purse >= 75, `the walked purse covers the service, got ${purse}`);

  // Five shelves, each carrying a gold price badge.
  assert.equal(await page.locator('.shop-grid .card').count(), 5, 'five shelves');
  const badges = await page.locator('.shop-grid .shop-price').allTextContents();
  assert.equal(badges.length, 5);
  const prices = badges.map((b) => Number(b.trim()));
  assert.ok(prices.every((p) => p >= 45 && p <= 165), `prices in the StS bands: ${prices.join(', ')}`);

  // Buy the cheapest affordable shelf with a real click: purse down by its price,
  // deck up by one, the slot sells out.
  const before = await page.evaluate(() => ({
    purse: window.__dlb.snapshot().shop.purse,
    deck: window.__dlb.snapshot().deckCount,
  }));
  const cheapestTile = page.locator('.shop-grid .card[aria-disabled="false"]')
    .first();
  const tilePrice = Number((await cheapestTile.locator('.shop-price').textContent()).trim());
  const boughtName = (await cheapestTile.getAttribute('aria-label')).split('.')[0];
  await cheapestTile.click();
  await sleep(400);
  const after = await page.evaluate(() => ({
    purse: window.__dlb.snapshot().shop.purse,
    deck: window.__dlb.snapshot().deckCount,
    sold: window.__dlb.snapshot().shop.offers.filter((o) => o.sold).length,
  }));
  assert.equal(after.purse, before.purse - tilePrice, `the purse paid exactly ${tilePrice}`);
  assert.equal(after.deck, before.deck + 1, 'the bought card joined the deck');
  assert.equal(after.sold, 1, 'the bought slot sold out');

  // The deck sheet is accurate MID-SHOP: it already lists what was just bought.
  await page.locator('#hud button', { hasText: /^Deck \(/ }).click();
  await page.waitForSelector('.modal', { timeout: 3000 });
  const sheet = await page.locator('.modal').textContent();
  assert.ok(sheet.includes(boughtName), `the deck sheet lists the bought ${boughtName}`);
  await page.keyboard.press('Escape');
  await sleep(200);

  // The removal service: pay, pick one instance out of the modal list, land back.
  const rem = page.locator('button[data-action="x"]');
  assert.equal(await rem.count(), 1, 'the service is a button while the purse covers it');
  await rem.click();
  await page.waitForSelector('.remove-list', { timeout: 3000 });
  const deckNow = await page.evaluate(() => window.__dlb.snapshot().deckCount);
  const choices = page.locator('.remove-list .boon');
  assert.equal(await choices.count(), deckNow, 'one choice per deck instance');
  await choices.first().click();
  await sleep(400);
  assert.equal(await page.evaluate(() => window.__dlb.snapshot().deckCount), deckNow - 1,
    'the picked instance left the deck');
  await page.waitForSelector('.shop-grid', { timeout: 3000 });
  assert.equal(await page.locator('button[data-action="x"]').count(), 0, 'one removal per visit');
  assert.match(await page.locator('.shop-controls').textContent(), /removal service is spent/);

  // The afford-filter: an UNSOLD shelf is inert exactly when its price exceeds the
  // purse, and after 75 + a purchase something on the shelves must be out of reach.
  // (The SOLD shelf is inert by definition — it has no buy action left — so the purse
  // equality is only about shelves still standing; the fresh-pool price roll exposed
  // that the old loop quietly demanded it of the sold shelf too.)
  const affordability = await page.evaluate(() => {
    const s = window.__dlb.snapshot();
    return { purse: s.shop.purse, offers: s.shop.offers.map((o) => ({ price: o.price, sold: o.sold, affordable: o.affordable })) };
  });
  for (const o of affordability.offers) {
    if (o.sold) { assert.equal(o.affordable, false, 'a sold shelf is inert, whatever the purse'); continue; }
    assert.equal(o.affordable, o.price <= affordability.purse, `a ${o.price}-gold shelf vs purse ${affordability.purse}`);
  }
  assert.ok(affordability.offers.some((o) => !o.affordable), 'after paying, some shelf is inert');
  const inert = page.locator('.shop-grid .card[aria-disabled="true"]');
  assert.equal(await inert.count(), affordability.offers.filter((o) => !o.affordable).length,
    'the view greys exactly the unaffordable shelves');

  // Leaving is final: back to the map on the row the shop's exits face, and the shop
  // is gone from the reachable set.
  await page.locator('button[data-action="l"]').click();
  await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });
  const left = await readState(page);
  assert.equal(left.phase, 'map');
  assert.equal(left.floor, 5, 'the player stands ON the consumed shop node (row 5); travel continues to row 6');
  assert.equal(await page.locator('button[aria-label*="Shop"]').count(), 0, 'no shop is travel-legal after leaving');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('potions: the belt fills from a victory, quaffs in combat, and discards', { timeout: 300000 }, async (t) => {
  if (!chromium) return t.skip('playwright/chromium unavailable');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  t.after(() => { void browser.close(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Seed 1 (verified against the engine before this test was written: with this exact
  // deck injection and walk policy, the second won fight drops Ember Draught).
  await page.addInitScript(() => { try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {} });
  await page.goto(`${base}/src/web/index.html?seed=1`);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('button.boon').first().click();
  await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });

  // BOOT: three empty slots, dim, beside the gold readout — and the kernel agrees.
  assert.equal(await page.locator('.belt .belt-slot.empty').count(), 3, 'three empty belt slots at boot');
  assert.equal(await page.locator('.belt .belt-slot.filled').count(), 0, 'nothing filled at boot');
  assert.deepEqual(await page.evaluate(() => window.__dlb.snapshot().belt), [], 'the kernel belt is empty');

  // Bludgeons end fights fast (the shop test's lever).
  const res = await page.evaluate(() => {
    const ctl = window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    for (let i = 0; i < 10; i += 1) save.state.deck.push({ uid: `e2e-belt-${i}`, cardId: 'bludgeon' });
    return ctl.load(save);
  });
  assert.equal(res.ok, true, `save/load failed: ${JSON.stringify(res.problems)}`);

  // Fight until a drop lands in the belt (seed 1: fight 2), real clicks only.
  let dropped = null;
  for (let guard = 0; guard < 40 && !dropped; guard += 1) {
    const st = await readState(page);
    if (st.phase === 'map') {
      const fight = page.locator('button[aria-label*="Skirmish"], button[aria-label*="Hard fight"]').first();
      if ((await fight.count()) > 0) await fight.click();
      else await page.getByRole('button', { name: 'Move on' }).first().click();
      await sleep(500);
    } else if (st.phase === 'combat') {
      const card = page.locator('button[data-slot][aria-disabled="false"]').first();
      if ((await card.count()) > 0) {
        await card.click();
        const tgt = page.locator('.enemy.targeting').first();
        if ((await tgt.count()) > 0) await tgt.click();
        await sleep(700);
      } else {
        await endTurn(page);
        await sleep(1300);
      }
    } else if (st.phase === 'reward') {
      await leaveReward(page);
    } else if (st.phase === 'rest') {
      await page.getByRole('button', { name: 'Move on' }).first().click();
      await sleep(500);
    } else {
      await sleep(400);
    }
    dropped = await page.evaluate(() => (window.__dlb.snapshot().belt ?? []).find((r) => r.known) ?? null);
  }
  assert.ok(dropped, 'a victory dropped a potion into the belt');
  assert.equal(await page.locator('.belt .belt-slot.filled').count(), 1, 'the HUD chip lit up');
  const chipLabel = await page.locator('.belt .belt-slot.filled').first().getAttribute('aria-label');
  assert.ok(chipLabel.includes(dropped.name), `the chip names the kernel potion (${chipLabel})`);
  // Off-combat the chip is a readout, not a button.
  assert.equal(await page.locator('button.belt-slot.filled').count(), 0, 'no quaff button outside combat');

  // The walk may have exited on the reward screen itself (the drop lands the instant the
  // fight is won): land on the map before travelling on.
  for (let guard = 0; guard < 12; guard += 1) {
    const st = await readState(page);
    if (st.phase === 'map') break;
    if (st.phase === 'reward') await leaveReward(page);
    else if (st.phase === 'rest') {
      await page.getByRole('button', { name: 'Move on' }).first().click();
      await sleep(500);
    } else await sleep(400);
  }
  assert.equal(await readState(page).then((s) => s.phase), 'map', 'back on the map with the filled belt');

  // The next fight: the chip is a BUTTON that opens the quaff/discard popover.
  const nextFight = page.locator('button[aria-label*="Skirmish"], button[aria-label*="Hard fight"], button[aria-label*="Elite"]').first();
  if ((await nextFight.count()) === 0) await page.getByRole('button', { name: 'Move on' }).first().click();
  else await nextFight.click();
  await sleep(700);
  const st = await readState(page);
  assert.equal(st.phase, 'combat', 'the quaff happens inside a fight');
  const chip = page.locator('button.belt-slot.filled').first();
  assert.equal(await chip.count(), 1, 'in combat the filled chip is a button');
  await chip.click();
  await page.waitForSelector('.belt-modal', { timeout: 3000 });
  const popoverText = await page.locator('.belt-modal').textContent();
  assert.ok(popoverText.includes(dropped.name), 'the popover names the potion');
  // The combat-phase belt row carries the legal forms (the drop-time row was read
  // off-combat, where quaffIds is legitimately empty).
  const liveRow = await page.evaluate(() => window.__dlb.snapshot().belt[0] ?? null);
  assert.ok(liveRow, 'the staged potion is still in the belt');
  const quaffBtn = page.locator('.belt-modal button.belt-act.quaff');
  assert.equal(await quaffBtn.count(), liveRow.quaffIds.length, 'one quaff button per legal form');

  // Quaff it: the belt shrinks by the slot and the effect lands on the engine state.
  const before = await page.evaluate(() => {
    const s = window.__dlb.snapshot();
    return {
      belt: s.belt.map((r) => r.potionId),
      hp: s.player.hp,
      energy: s.player.energy,
      block: s.player.block,
      enemyHp: s.enemies.reduce((n, e) => n + e.hp, 0),
      phase: s.phase,
    };
  });
  await quaffBtn.first().click();
  await sleep(700);
  const after = await page.evaluate(() => {
    const s = window.__dlb.snapshot();
    return {
      belt: s.belt.map((r) => r.potionId),
      hp: s.player.hp,
      energy: s.player.energy,
      block: s.player.block,
      enemyHp: s.enemies.reduce((n, e) => n + e.hp, 0),
      phase: s.phase,
      statuses: s.player.statuses.map((x) => x.key),
    };
  });
  assert.equal(after.belt.length, before.belt.length - 1, 'the slot is consumed');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
  if (dropped.potionId === 'ember_draught') {
    assert.ok(after.enemyHp < before.enemyHp || after.phase !== 'combat', 'the draught dealt its damage');
  } else if (dropped.potionId === 'stone_skin') {
    assert.ok(after.block >= before.block + 12, 'the skin raised block');
  } else if (dropped.potionId === 'ash_salts') {
    assert.ok(after.hp > before.hp || after.hp === 60, 'the salts healed');
  } else if (dropped.potionId === 'bellows_fuel') {
    assert.equal(after.energy, before.energy + 2, 'the fuel added energy');
  } else if (dropped.potionId === 'whetstone') {
    assert.ok(after.statuses.includes('strength'), 'the whetstone left Strength');
  } // purge_flask with nothing to purge: the consumed slot IS the observable.

  // DISCARD: play the quaffed fight out (the same card-then-target flow as the walk —
  // with two enemies alive a card click opens targeting, and a click that never picks a
  // target only cancels, so the handler below is what lets the fight actually end),
  // return to the map, stage a two-slot belt through the save lever, then travel into
  // the next fight: the travel act() is what repaints the staged belt (the lever note).
  for (let guard = 0; guard < 120; guard += 1) {
    const s = await readState(page);
    if (s.phase !== 'combat') break;
    const card = page.locator('button[data-slot][aria-disabled="false"]').first();
    if ((await card.count()) > 0) {
      await card.click();
      const tgt = page.locator('.enemy.targeting').first();
      if ((await tgt.count()) > 0) await tgt.click();
      await sleep(700);
    } else {
      await endTurn(page);
      await sleep(1300);
    }
  }
  if ((await readState(page)).phase === 'reward') await leaveReward(page);
  assert.equal(await readState(page).then((s) => s.phase), 'map', 'back on the map to stage the belt');
  const staged = await page.evaluate(() => {
    const ctl = window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    save.state.potions = ['stone_skin', 'bellows_fuel'];
    return { res: ctl.load(save) };
  });
  assert.equal(staged.res.ok, true, `the lever load failed: ${JSON.stringify(staged.res.problems)}`);
  // Walk to the next fight (any row type in between is passed the part-1 way).
  for (let guard = 0; guard < 40; guard += 1) {
    const st = await readState(page);
    if (st.phase === 'combat') {
      assert.equal(await page.locator('.belt .belt-slot.filled').count(), 2, 'the staged belt renders two chips in the fight');
      break;
    }
    if (st.phase === 'map') {
      const fight = page.locator('button[aria-label*="Skirmish"], button[aria-label*="Hard fight"], button[aria-label*="Elite"]').first();
      if ((await fight.count()) > 0) await fight.click();
      else await page.getByRole('button', { name: 'Move on' }).first().click();
      await sleep(500);
    } else if (st.phase === 'reward') {
      await leaveReward(page);
    } else if (st.phase === 'rest') {
      await page.getByRole('button', { name: 'Move on' }).first().click();
      await sleep(500);
    } else {
      await sleep(400);
    }
  }
  assert.equal(await readState(page).then((s) => s.phase), 'combat', 'a fight for the discard');
  await page.locator('button.belt-slot.filled').nth(1).click();
  await page.waitForSelector('.belt-modal', { timeout: 3000 });
  await page.locator('.belt-modal button.belt-act.discard').click();
  await sleep(500);
  const discarded = await page.evaluate(() => window.__dlb.snapshot().belt.map((r) => r.potionId));
  assert.deepEqual(discarded, ['stone_skin'], 'slot 2 freed, slot 1 untouched');
  assert.equal(errors.length, 0, `no page errors after the discard: ${errors.join(' | ')}`);
});

test('event: the wayside tells its story, a choice pays and takes, and the beat closes for good', { timeout: 300000 }, async (t) => {
  if (!chromium) return t.skip('playwright/chromium unavailable');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce', // paint instantly: the walk's assertions are structural
  });
  t.after(() => { void browser.close(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {} });
  await page.goto(`${base}/src/web/index.html?seed=1`);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('button.boon').first().click();
  await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });
  const res = await page.evaluate(() => {
    const ctl = window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    for (let i = 0; i < 8; i += 1) save.state.deck.push({ uid: `e2e-event-${i}`, cardId: 'bludgeon' });
    return ctl.load(save);
  });
  assert.equal(res.ok, true, `save/load failed: ${JSON.stringify(res.problems)}`);

  // The walk: rows 0-1 the honest way (the injected Mauls end fights fast), until the
  // player stands on row 1 with the row-2 wayside in reach.
  for (let guard = 0; guard < 240; guard += 1) {
    const st = await readState(page);
    if (st.phase === 'map' && st.floor === 1) break;
    if (st.phase === 'map') {
      const fight = page.locator('button[aria-label*="Skirmish"], button[aria-label*="Hard fight"]').first();
      if ((await fight.count()) > 0) await fight.click();
      else await page.getByRole('button', { name: 'Move on' }).first().click();
      await sleep(500);
    } else if (st.phase === 'combat') {
      const card = page.locator('button[data-slot][aria-disabled="false"]').first();
      if ((await card.count()) > 0) {
        await card.click();
        const tgt = page.locator('.enemy.targeting').first();
        if ((await tgt.count()) > 0) await tgt.click();
        await sleep(700);
      } else {
        await endTurn(page);
        await sleep(1300);
      }
    } else if (st.phase === 'reward') {
      await leaveReward(page);
    } else if (st.phase === 'rest') {
      await page.getByRole('button', { name: 'Move on' }).first().click();
      await sleep(500);
    } else {
      await sleep(400);
    }
  }
  const staged = await readState(page);
  assert.equal(staged.floor, 1, 'standing on row 1: the wayside row is next');

  // The wayside node is labelled like any other, and exactly one is travel-legal.
  const wayside = page.locator('button[aria-label*="Wayside"]');
  assert.equal(await wayside.count(), 1, 'exactly one Wayside node is travel-legal');
  await wayside.click();
  await page.waitForSelector('.event-choices', { timeout: 5000 });

  // The story and its facts: title, story text, one button per offered choice, and the
  // view greys exactly the choices the kernel offers no id for. The WHICH-event draw
  // reads the live counter after the walk's fights, so the test pins the CONTRACT, not
  // a story id: the kernel's own answer drives the choice and the effect assertions.
  const ev = await page.evaluate(() => window.__dlb.snapshot().event);
  assert.ok(ev.known, `a known story opened, got ${ev.eventId}`);
  assert.ok((await page.locator('.event-story').textContent()).length > 40, 'the story is on the page');
  const buttons = await page.locator('.event-choices .boon').all();
  assert.equal(buttons.length, ev.choices.length, 'one button per choice');
  for (let i = 0; i < ev.choices.length; i += 1) {
    const dimmed = await buttons[i].isDisabled();
    assert.equal(dimmed, ev.choices[i].actionId === null,
      `${ev.choices[i].slug}: the view greys exactly what the kernel refuses`);
  }

  // Choose by preference — a choice whose effect is exact and visible in the HUD:
  //   climb (Shaft): gold +60, HP -12 — stoke (Forge): HP -8 (floored at 1), deck +1.
  // Anything else (the other events) still resolves; only the exact numbers yield.
  const pref = ev.choices.find((c) => c.slug === 'climb' && c.actionId) ? 'climb'
    : (ev.choices.find((c) => c.slug === 'stoke' && c.actionId) ? 'stoke' : null);
  const before = await page.evaluate(() => {
    const s = window.__dlb.snapshot();
    return { gold: s.player.gold, hp: s.player.hp, deck: s.deckCount };
  });
  if (pref) {
    await page.locator(`button[aria-label^="${pref === 'climb' ? 'Climb down' : 'Stoke it awake'}"]`).click();
  } else {
    // Affordable event choices carry no `disabled` attribute (the view greys with
    // disabled="disabled" exactly when the kernel refuses) — this is the enabled form.
    await page.locator('.event-choices .boon:not([disabled])').first().click();
  }
  await page.waitForSelector('.event-result', { timeout: 5000 });
  const after = await page.evaluate(() => {
    const s = window.__dlb.snapshot();
    return { gold: s.player.gold, hp: s.player.hp, deck: s.deckCount, phase: s.phase, lines: s.event.resolved.lines };
  });
  if (pref === 'climb') {
    assert.equal(after.gold, before.gold + 60, 'the shaft paid 60 gold');
    assert.equal(after.hp, before.hp - 12, 'the shaft took 12 HP');
    assert.ok(after.lines.some((l) => /60 gold/.test(l)), `the beat names the gold: ${JSON.stringify(after.lines)}`);
  } else if (pref === 'stoke') {
    assert.equal(after.hp, Math.max(1, before.hp - 8), 'the coals took their 8 HP (never killing)');
    assert.equal(after.deck, before.deck + 1, 'the gained card joined the deck');
  } else {
    assert.ok(after.lines.length > 0, 'the beat carries the kernel\u2019s own results');
  }
  assert.equal(after.phase, 'event', 'the resolved beat holds the phase open');

  // The beat's only way out is the continue; it closes the room and the run moves on.
  await page.locator('button[data-action="v0"]').click();
  await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });
  const left = await readState(page);
  assert.equal(left.phase, 'map', 'the continue returns to the map');
  assert.equal(await page.locator('button[aria-label*="Wayside"]').count(), 0, 'no wayside is travel-legal after leaving');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('help sheet: the keyboard guard swallows everything but Escape, and the run behind it is intact', { timeout: 120000 }, async (t) => {
  if (!chromium) return t.skip('playwright/chromium unavailable');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  t.after(() => { void browser.close(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {} });
  await page.goto(`${base}/src/web/index.html?seed=7`);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('button.boon').first().click();
  await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });

  const before = await page.evaluate(() => {
    const s = window.__dlb.snapshot();
    return { seed: s.seed, step: s.stepIndex, phase: s.phase };
  });

  // Open Help from the HUD. Exactly one sheet is up.
  await page.getByRole('button', { name: 'Help' }).click();
  await page.waitForSelector('.modal', { timeout: 3000 });
  const isHelp = await page.locator('.modal[aria-label="How to play"]').count();
  assert.equal(isHelp, 1, 'the sheet on stage is the help sheet');
  assert.equal(await page.locator('.modal').count(), 1, 'exactly one sheet');

  // The E8b class, one layer down: d used to stack the deck sheet on Help, and n used
  // to discard the run BEHIND it. Both are swallowed now; the sheet and the run stand.
  await page.keyboard.press('d');
  await sleep(300);
  assert.equal(await page.locator('.modal').count(), 1, 'd does not stack a second sheet');
  assert.equal(await page.locator('.modal[aria-label="How to play"]').count(), 1, 'the help sheet is still the one up');
  await page.keyboard.press('n');
  await sleep(300);
  assert.equal(await page.locator('.modal').count(), 1, 'n does not discard the run behind the sheet');
  const afterKeys = await page.evaluate(() => {
    const s = window.__dlb.snapshot();
    return { seed: s.seed, step: s.stepIndex, phase: s.phase };
  });
  assert.deepEqual(afterKeys, before, 'the run behind the sheet is untouched');

  // Escape is Help's only key (it has no toggle key of its own): it closes the sheet,
  // and the released keyboard behaves again — d opens the deck sheet.
  await page.keyboard.press('Escape');
  await sleep(200);
  assert.equal(await page.locator('.modal').count(), 0, 'Escape closes the help sheet');
  await page.keyboard.press('d');
  await sleep(300);
  assert.equal(await page.locator('.modal.deck-modal').count(), 1, 'the released d opens the deck sheet');
  await page.keyboard.press('Escape');
  await sleep(200);
  assert.equal(await page.locator('.modal').count(), 0, 'and Escape closes that too');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

// ---------------------------------------------------------------------------
// 11. the S7 relics: the HUD carries a readout chip from boot (count + names in the
//     tooltip); an ELITE victory always drops a relic (the spoils chip on the reward
//     head, the HUD chip counting to 2); the BOSS victory offers three relic buttons
//     instead of cards, taking one ends the run in victory, and the summary names the
//     relic count. Real clicks only; the injected deck ends fights fast.
// ---------------------------------------------------------------------------
test('relics: the chip counts up on an elite drop and the warden offers three', { timeout: 300000 }, async (t) => {
  if (!chromium) return t.skip('playwright/chromium unavailable');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce', // paint instantly: the walk's assertions are structural
  });
  t.after(() => { void browser.close(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {} });
  // S10 VETERAN LEDGER (the documented dlb.runs.v1 agg schema — the S2 QA's doctored
  // aggregate): 10 lifetime wins put four rares in the pool, so this walk still sees a
  // real three-offer warden. The score total keeps the CARD pool wide too — this test
  // claims the relic screen, not the card gate. The FRESH gate is the next test's walk.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dlb.runs.v1', JSON.stringify({
        v: 1,
        records: [],
        agg: {
          runs: 10, wins: 10, losses: 0, unfinished: 0, floors: {},
          score: { count: 10, total: 900, max: 200 },
          badges: { first_win: 10, boss_down: 10 },
        },
      }));
    } catch {}
  });
  await page.goto(`${base}/src/web/index.html?seed=7`);
  await page.waitForLoadState('domcontentloaded');

  // Boot: exactly one held relic (the hero's starter), counted by the HUD chip.
  await page.locator('button.boon').first().click();
  await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });
  const chip = page.locator('.relics');
  assert.equal(await chip.count(), 1, 'the HUD carries one relic readout');
  assert.equal(await chip.locator('.relic-count').textContent(), '1', 'one held relic at boot');
  const chipLabel = await chip.getAttribute('aria-label');
  assert.match(chipLabel, /Relics: 1 held: Kindled Heart|Cyan Lantern/, `the chip names the starter: ${chipLabel}`);
  const res = await page.evaluate(() => {
    const ctl = window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    for (let i = 0; i < 12; i += 1) save.state.deck.push({ uid: `e2e-relic-${i}`, cardId: 'bludgeon' });
    // The naive auto-player bleeds out at the row-6 elite (deterministically, hp 71 ->
    // 9 by floor 5): a padded HP pool removes the attrition coin-flip without touching
    // what this test claims — the drop chain, the chip, the offers, the ended win.
    save.state.player.maxHp = 999;
    save.state.player.hp = 999;
    return ctl.load(save);
  });
  assert.equal(res.ok, true, `save/load failed: ${JSON.stringify(res.problems)}`);

  // The walk: elites preferred, then fights, then the boss — real clicks only. Claims
  // are taken on the way: the elite's spoils chip, the HUD count, the boss's three
  // offers, and the summary's relic count at the end.
  let sawEliteSpoils = null;
  let bossOffers = 0;
  let climbedPre = null; // the max-HP the hero carried INTO the first boss pick
  let firstPickDone = false;
  for (let guard = 0; guard < 600; guard += 1) {
    const phase = await page.evaluate(() => window.__dlb.snapshot().phase);
    if (phase === 'ended') break;
    if (phase === 'map') {
      const elite = page.locator('button[aria-label="Travel to Elite"]').first();
      const boss = page.locator('button.node.available.t-boss').first();
      if ((await boss.count()) > 0) await boss.click();
      else if ((await elite.count()) > 0) await elite.click();
      else await page.locator('button[aria-label^="Travel to"]').last().click();
      await sleep(500);
    } else if (phase === 'combat') {
      const card = page.locator('button[data-slot][aria-disabled="false"]').first();
      if ((await card.count()) > 0) {
        await card.click();
        const tgt = page.locator('.enemy.targeting').first();
        if ((await tgt.count()) > 0) await tgt.click();
        await sleep(700);
      } else {
        await endTurn(page);
        await sleep(1300);
      }
    } else if (phase === 'reward') {
      const spoils = page.locator('.reward-relic');
      if ((await spoils.count()) > 0 && sawEliteSpoils === null) {
        sawEliteSpoils = (await spoils.first().textContent()).trim();
        assert.equal(await chip.locator('.relic-count').textContent(), '2',
          'the elite drop lit the HUD chip to 2');
      }
      const offers = page.locator('.relic-offer');
      // The boss reward paints a beat after the kernel flips (the kill-hold): poll the
      // painted DOM for the offers before deciding — leaveReward's '0' hotkey would
      // otherwise walk away from the warden's offer unseen. (The walk still climbs —
      // but this test's claims ride the offer screen.)
      const bossTruth = await page.evaluate(() => Boolean(window.__dlb.controller().snapshot().reward?.boss));
      for (let w = 0; bossTruth && (await offers.count()) === 0 && w < 10; w += 1) await sleep(300);
      if ((await offers.count()) > 0) {
        bossOffers = await offers.count();
        assert.equal(bossOffers, 3, 'the warden offers exactly three relics (five rares hold out across both acts)');
        const head = await page.locator('.reward-head span').first().textContent();
        assert.match(head, /warden/, `the boss reward head names the relic: ${head}`);
        // First pick only: assert the CLIMB (S9) — act 2 opens, the hero heals full with
        // the +5 bonus, and nothing held is lost. The SECOND boss pick ends the run.
        if (climbedPre === null) {
          climbedPre = await page.evaluate(() => window.__dlb.snapshot().player.maxHp);
          const heldBefore = await page.evaluate(() => window.__dlb.snapshot().relics.length);
          await offers.first().click(); // take the first offer — the policies' stance
          await sleep(900);
          const climbed = await page.evaluate(() => {
            const s = window.__dlb.controller().snapshot();
            return { phase: s.phase, act: s.act, acts: s.acts, biome: s.biomeName, chapter: document.querySelector('.page-num')?.textContent ?? null, maxHp: s.player.maxHp, hp: s.player.hp, held: s.relics.length };
          });
          assert.equal(climbed.phase, 'map', 'act 2 opens on the map');
          assert.equal(climbed.act, 2, 'the act advanced');
          assert.equal(climbed.biome, 'The Kiln Deeps', 'act 2 walks its own biome');
          assert.match(climbed.chapter, /Kiln Deeps/, `the map chapter names act 2: ${climbed.chapter}`);
          assert.equal(climbed.maxHp, climbedPre + 5, 'the climb bonus');
          assert.equal(climbed.hp, climbed.maxHp, 'the climb heals full');
          assert.equal(climbed.held, heldBefore + 1, 'the picked relic crossed the climb');
          firstPickDone = true;
          continue;
        }
        await offers.first().click(); // the act-2 pick — the run ends in victory below
        await sleep(900);
        continue;
      }
      // Card reward: skip it — but only when kernel truth still says a NON-boss reward.
      // In a stale-paint window a blind '0' (the s0 hotkey) lands on the warden's offer
      // and walks away from it unseen; the offer branch above must own that pick.
      const truthNow = await page.evaluate(() => { const s = window.__dlb.controller().snapshot(); return { phase: s.phase, boss: !!s.reward?.boss }; });
      if (truthNow.phase === 'reward' && truthNow.boss) continue; // the offer is painting; loop re-enters above
      await leaveReward(page);
    } else if (phase === 'rest') {
      await page.getByRole('button', { name: 'Move on' }).first().click();
      await sleep(500);
    } else if (phase === 'event') {
      // A wayside sits on some seed-7 paths: take the free choice, then continue.
      // Affordable choices carry no `disabled` attribute (dimmed ones carry
      // disabled="disabled"), so :not([disabled]) is the enabled-selector form.
      await page.locator('.event-choices .boon:not([disabled])').first().click();
      await page.waitForSelector('.event-result, button[data-action="v0"]', { timeout: 5000 });
      const cont = page.locator('button[data-action="v0"]').first();
      if (await cont.count()) { await cont.click(); await sleep(500); }
    } else {
      await sleep(400);
    }
  }
  await sleep(1000);
  assert.equal(errors.length, 0, `no page errors during the walk: ${errors.join(' | ')}`);
  assert.ok(sawEliteSpoils, 'an elite victory showed its spoils relic chip on the reward head');
  assert.ok(firstPickDone, 'the act-1 boss pick climbed into act 2 (asserted at the pick)');
  // The run ends at the ACT-2 boss in victory — the kernel's settled shape, proven in
  // the browser: the summary carries the act and the relic count.
  assert.equal(await page.evaluate(() => window.__dlb.snapshot().phase), 'ended', 'the act-2 boss pick ended the run');
  const ended = await page.evaluate(() => { const s = window.__dlb.snapshot(); return { outcome: s.ended.outcome, act: s.ended.act, relics: s.ended.relics }; });
  assert.equal(ended.outcome, 'win', 'the act-2 pick ends the run in victory');
  assert.equal(ended.act, 2, 'the summary names act 2');
  const held = await page.evaluate(() => window.__dlb.snapshot().relics.map((r) => ({ id: r.relicId, starting: r.starting })));
  assert.equal(ended.relics, held.length, 'the ended count matches the held rows');
  assert.ok(held.length >= 4, `starter + elite drops + two boss picks: ${JSON.stringify(held)}`);
  assert.equal(held[0].starting, true, 'the starter leads the acquisition order');
  assert.equal(await chip.locator('.relic-count').textContent(), String(held.length), 'the chip counts every held relic');
  const endStats = await page.locator('.end-stats').textContent();
  assert.match(endStats, /Act 2 · floor/, `the summary names the act: ${endStats}`);
  assert.match(endStats, new RegExp(`· ${held.length} relics$`), `the summary counts the relics: ${endStats}`);
});

// ---------------------------------------------------------------------------
// 11b. the S10 fresh gate (UX-1 down-tier): an EMPTY ledger (a brand-new browser
//      profile) boots a run whose relic pool is the five commons. Lever-free claims
//      from that fact: the pool the snapshot publishes, an elite drop that is ALWAYS a
//      common, and a warden whose vault is a REAL down-tier offer (S10's empty vault
//      became a normal choice the moment the pool had anything to give): each warden
//      offers min(3, pool minus held), every offer not-held, in-pool, and a common.
//      The act-1 offer is PICKED (the pick climbs into act 2 — the act-1 vault is
//      never exhausted through play: at most four of the five commons are holdable by
//      then); the act-2 offer is WALKED AWAY from (the skip ends the run in victory)
//      — the act-2 vault may be legitimately EXHAUSTED (the elite-heavy walk can hold
//      all five commons by then: starter + four elite drops), and the walk asserts the
//      honest zero in that shape too. The run summary narrates what the win just
//      opened for the NEXT run (Ember Heart, 6 of 13). The deck/HP lever below only
//      makes the walk fast; it never touches relics or the pool.
// ---------------------------------------------------------------------------
test('a fresh profile: the vault offers down-tier commons and the first win unlocks Ember Heart', { timeout: 300000 }, async (t) => {
  if (!chromium) return t.skip('playwright/chromium unavailable');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce', // paint instantly: the walk's assertions are structural
  });
  t.after(() => { void browser.close(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {} });
  await page.goto(`${base}/src/web/index.html?seed=7`);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('button.boon').first().click();
  await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });

  // The run's pool, straight from the kernel's own snapshot: the five commons, no rares.
  const FRESH_NAMES = ['Kindled Heart', 'Cyan Lantern', 'Forge Iron', 'Whetted Edge', 'Hearth Ash'];
  const bootPool = await page.evaluate(() => window.__dlb.snapshot().relicPool);
  assert.deepEqual(bootPool, ['burning_blood', 'cyan_lantern', 'forge_iron', 'whetted_edge', 'hearth_ash'],
    `a fresh ledger boots the five-common pool: ${JSON.stringify(bootPool)}`);

  const res = await page.evaluate(() => {
    const ctl = window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    for (let i = 0; i < 12; i += 1) save.state.deck.push({ uid: `e2e-fresh-${i}`, cardId: 'bludgeon' });
    save.state.player.maxHp = 999;
    save.state.player.hp = 999;
    return ctl.load(save);
  });
  assert.equal(res.ok, true, `save/load failed: ${JSON.stringify(res.problems)}`);

  let eliteDrops = [];
  let wardens = 0;
  for (let guard = 0; guard < 600; guard += 1) {
    const phase = await page.evaluate(() => window.__dlb.snapshot().phase);
    if (phase === 'ended') break;
    if (phase === 'map') {
      const elite = page.locator('button[aria-label="Travel to Elite"]').first();
      const boss = page.locator('button.node.available.t-boss').first();
      if ((await boss.count()) > 0) await boss.click();
      else if ((await elite.count()) > 0) await elite.click();
      else await page.locator('button[aria-label^="Travel to"]').last().click();
      await sleep(500);
    } else if (phase === 'combat') {
      const card = page.locator('button[data-slot][aria-disabled="false"]').first();
      if ((await card.count()) > 0) {
        await card.click();
        const tgt = page.locator('.enemy.targeting').first();
        if ((await tgt.count()) > 0) await tgt.click();
        await sleep(700);
      } else {
        await endTurn(page);
        await sleep(1300);
      }
    } else if (phase === 'reward') {
      const spoils = page.locator('.reward-relic');
      if ((await spoils.count()) > 0) eliteDrops.push((await spoils.first().textContent()).trim());
      // The warden's DOWN-TIER offer (UX-1): a real choice drawn from the run's own
      // pool minus what it holds. Poll past the kill-hold paint beat, then assert the
      // offer against the kernel's own arithmetic.
      const bossTruth = await page.evaluate(() => Boolean(window.__dlb.controller().snapshot().reward?.boss));
      for (let w = 0; bossTruth && w < 10; w += 1) await sleep(300);
      const truthNow = await page.evaluate(() => { const s = window.__dlb.controller().snapshot(); return { phase: s.phase, boss: !!s.reward?.boss }; });
      if (truthNow.phase === 'reward' && truthNow.boss) {
        const k = await page.evaluate(() => {
          const s = window.__dlb.controller().snapshot();
          return { pool: s.relicPool, held: s.relics.map((r) => r.relicId), offers: s.reward.relicOffers };
        });
        const expected = Math.min(3, k.pool.length - k.held.length);
        assert.equal(k.offers.length, expected,
          `the warden offers min(3, pool minus held) = ${expected}: ${JSON.stringify(k)}`);
        for (const o of k.offers) {
          assert.ok(k.pool.includes(o.relicId), `the offer ${o.relicId} is inside the run's pool`);
          assert.ok(!k.held.includes(o.relicId), `the offer ${o.relicId} is not already held`);
          assert.equal(o.tier, 'common', `a fresh pool has only commons to give (${o.relicId})`);
        }
        wardens += 1;
        if (expected === 0) {
          // The vault can be genuinely EXHAUSTED through play on a fresh profile: the
          // elite-heavy walk may hold every common the pool carries by the act-2 warden
          // (starter + four elite drops). The honest zero is the S10 truth, still
          // headlined, still offering the walk-away.
          const head = await page.locator('.reward-head span').first().textContent();
          assert.match(head, /the warden offers nothing/, `an exhausted vault says so: ${head}`);
          assert.equal(await page.locator('.relic-offer').count(), 0, 'an exhausted vault renders no offer button');
        } else {
          const head = await page.locator('.reward-head span').first().textContent();
          assert.match(head, /claim the warden\u2019s relic/, `a stocked vault headlines the offer: ${head}`);
        }
        if (wardens === 1) {
          // The ACT-1 vault is never exhausted through play (at most four of the five
          // commons can be held by then — starter + three elites): take the first
          // offer — it climbs into act 2, the relic crossing with the hero.
          assert.ok(expected >= 1, 'the act-1 vault always has something to give');
          const heldBefore = k.held.length;
          await page.locator('.relic-offer').first().click();
          await sleep(900);
          const climbed = await page.evaluate(() => window.__dlb.controller().snapshot());
          assert.equal(climbed.phase, 'map', 'the pick climbs into act 2');
          assert.equal(climbed.act, 2, 'the act advanced');
          assert.match(await page.locator('.page-num').first().textContent(), /Kiln Deeps/, 'the climb opens act 2');
          assert.equal(climbed.relics.length, heldBefore + 1, 'the picked relic crossed the climb');
          continue;
        }
        // The ACT-2 WALK AWAY: stocked or exhausted, the skip ends the run in victory.
        await page.getByRole('button', { name: 'Walk away' }).first().click();
        await sleep(900);
        continue;
      }
      if ((await spoils.count()) > 0) await sleep(300); // let the spoils paint settle before leaving
      await leaveReward(page);
    } else if (phase === 'rest') {
      await page.getByRole('button', { name: 'Move on' }).first().click();
      await sleep(500);
    } else if (phase === 'event') {
      await page.locator('.event-choices .boon:not([disabled])').first().click();
      await page.waitForSelector('.event-result, button[data-action="v0"]', { timeout: 5000 });
      const cont = page.locator('button[data-action="v0"]').first();
      if (await cont.count()) { await cont.click(); await sleep(500); }
    } else {
      await sleep(400);
    }
  }
  await sleep(1000);
  assert.equal(errors.length, 0, `no page errors during the walk: ${errors.join(' | ')}`);
  assert.ok(eliteDrops.length >= 1, `an elite dropped under the gate: ${JSON.stringify(eliteDrops)}`);
  assert.ok(eliteDrops.every((n) => FRESH_NAMES.includes(n)), `every gated drop is a row-0 common: ${JSON.stringify(eliteDrops)}`);
  assert.equal(wardens, 2, 'both wardens of the two-act climb opened a vault priced at min(3, pool minus held)');

  // The run ends in VICTORY at the act-2 warden's skip — and the win is the unlock.
  assert.equal(await page.evaluate(() => window.__dlb.snapshot().ended.outcome), 'win', 'the act-2 skip ends the run in victory');
  // The run's pool never grew mid-run (unlocks happen BETWEEN runs); the narration
  // already counts the NEXT run's pool — the contrast is the slice's whole story.
  const endedPool = await page.evaluate(() => window.__dlb.snapshot().relicPool);
  assert.deepEqual(endedPool, bootPool, 'the ended run still holds the pool it booted with');
  const narrated = await page.locator('.unlock-line').allTextContents();
  assert.ok(narrated.some((s) => s.includes('Your climbs unlocked: Ember Heart.')), `the win narrates the unlock: ${JSON.stringify(narrated)}`);
  const pools = await page.locator('.unlock-pool').allTextContents();
  assert.ok(pools.some((s) => s.includes('Relics in play: 6 of 13.')), `the pool count is honest: ${JSON.stringify(pools)}`);
  // And the ledger itself grew by exactly the one win (the unlock's source of truth).
  const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem('dlb.runs.v1') ?? 'null'));
  assert.equal(ledger?.agg?.wins, 1, `the doctored-by-nothing ledger holds one win: ${JSON.stringify(ledger?.agg)}`);
});

// ---------------------------------------------------------------------------
// UX-2: the DOUBLY-TORN vault — a save whose relicPool is a VALID array of ids the
// relic table does not know. The kernel rolls such a pool honestly to zero offers, but
// the run does NOT hold a complete collection, so the exhausted-vault wording ("You
// hold everything the warden's vault can give") would be false there; the reward
// screen says the neutral line instead. The pool is doctored through the documented
// save lever BEFORE any travel (validateSave takes any array of unique strings — the
// torn-save tolerance is the point), so the warden's own roll proves the shape.
// ---------------------------------------------------------------------------
test('a torn relic pool seals the warden\u2019s vault honestly (UX-2 fallback)', { timeout: 300000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t, 7);
  await bootToMap(page);
  const res = await page.evaluate(() => {
    const ctl = window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    save.state.relicPool = ['ghost_one', 'ghost_two'];
    for (let i = 0; i < 12; i += 1) save.state.deck.push({ uid: `e2e-torn-${i}`, cardId: 'bludgeon' });
    save.state.player.maxHp = 999;
    save.state.player.hp = 999;
    return ctl.load(save);
  });
  assert.equal(res.ok, true, `save/load failed: ${JSON.stringify(res.problems)}`);
  // Engine truth, not the painted surface: a bare load leaves window.__dlb.snapshot()
  // (the renderer's last paint) stale until the next act(), so the pool is read off the
  // controller's own snapshot — the same read the relics walk uses mid-climb.
  const pool = await page.evaluate(() => window.__dlb.controller().snapshot().relicPool);
  assert.deepEqual(pool, ['ghost_one', 'ghost_two'], 'the torn pool is the run\u2019s own pool');

  // Boss-ward walk: boss when reachable, else the last travel (the 11b pattern).
  let sealed = null;
  for (let guard = 0; guard < 400 && !sealed; guard += 1) {
    const phase = await page.evaluate(() => window.__dlb.snapshot().phase);
    if (phase === 'ended') break;
    if (phase === 'map') {
      const boss = page.locator('button.node.available.t-boss').first();
      if ((await boss.count()) > 0) await boss.click();
      else await page.locator('button[aria-label^="Travel to"]').last().click();
      await sleep(500);
    } else if (phase === 'combat') {
      const card = page.locator('button[data-slot][aria-disabled="false"]').first();
      if ((await card.count()) > 0) {
        await card.click();
        const tgt = page.locator('.enemy.targeting').first();
        if ((await tgt.count()) > 0) await tgt.click();
        await sleep(700);
      } else {
        await endTurn(page);
        await sleep(1600);
      }
    } else if (phase === 'rest') {
      await page.getByRole('button', { name: /^Rest \(/ }).first().click();
      await sleep(600);
    } else if (phase === 'event') {
      // A choice button if the wayside still asks, else the resolved beat's Continue.
      const choice = page.locator('button.event-choice[aria-disabled="false"], button.event-choice:not([disabled])').first();
      if ((await choice.count()) > 0) await choice.click();
      else await page.getByRole('button', { name: 'Continue' }).first().click();
      await sleep(600);
    } else if (phase === 'shop') {
      await page.locator('button', { hasText: /leave/i }).first().click();
      await sleep(600);
    } else if (phase === 'reward') {
      const truth = await page.evaluate(() => {
        const s = window.__dlb.controller().snapshot();
        return { boss: Boolean(s.reward?.boss), offers: (s.reward?.relicOffers ?? []).length };
      });
      if (truth.boss) {
        sealed = truth;
        assert.equal(truth.offers, 0, `a torn pool offers nothing: ${JSON.stringify(truth)}`);
        const body = await page.locator('.boon-name').first().textContent();
        assert.match(body, /sealed to you this climb/, `the torn vault says so honestly: ${body}`);
        assert.doesNotMatch(body, /hold everything/, 'the false exhausted claim is gone');
        assert.equal(await page.locator('.relic-offer').count(), 0, 'a sealed vault renders no offer button');
        await page.getByRole('button', { name: 'Walk away' }).first().click();
        await sleep(900);
      } else {
        await page.getByRole('button', { name: /^Skip/ }).click();
        await sleep(600);
      }
    } else {
      await sleep(300);
    }
  }
  assert.ok(sealed, 'the walk reached the warden and read the sealed vault');
});
