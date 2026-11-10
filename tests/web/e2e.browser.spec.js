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
//   6. the S1 master-deck sheet shows the starting deck from the map AND from combat
//      as the game's card tiles, ONE PER COPY (UX-8: the tile count is the count,
//      read-only divs — no tempered badge at run start, Esc/Close both dismiss it and
//      the run underneath is untouched; a tempered injected pair wears its stamp)
//   7. the S2 card codex groups the whole draft pool by rarity with counts as a card-TILE
//      GALLERY (UX-8: full faces with their woodcut art), shows a known card's
//      describe-layer sentence, wears the "in deck" chip on an injected copy, and
//      Escape dismisses it without moving the run
//   8. the S3 gold economy: a victory pays the purse (the reward head's "+N gold" chip
//      and the HUD readout agree on the same kernel value) and the next victory adds to
//      it; the run summary names the final purse
//   9. the S4 shop: the vendor is a labelled map node with five priced shelves and the
//      purse in view; a click buys a card (the deck sheet agrees mid-shop), the removal
//      service is the deck as card TILES and the tile itself is the pick (UX-8),
//      unaffordable shelves are inert, and leaving is final
//  10. the S5 potions: the belt renders in COMBAT only (off-combat it does not render);
//      a won fight drops a potion into the belt (seed 1: fight 2, Ember Draught); in the
//      next combat the chip opens the quaff/discard popover, quaffing consumes the slot
//      and lands the effect on the engine state, and a discard frees exactly its slot
//  11. the S7 relics: NO HUD relic chip (relics act through hooks, never clicks — the
//      kernel's own snapshot carries the held rows); an elite victory always drops a
//      relic (the spoils chip, the held count reaching 2 in the snapshot); the
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
// sampled by an in-page 40ms collector: at the UX-4 pace stage-shake lasts 900ms and
// fx-shockwave 1120ms, which round-trip polling from Node can miss.
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

/** Wait for the UX-5 input gate to release. While a play's animation, the enemy-turn
 *  sequence, a hand deal or a kill hold is on screen, the hand and End Turn are locked
 *  (aria-disabled, natively disabled) and the combat shortcuts are swallowed — the gate
 *  is the surface's own published truth (window.__dlb.busy, runtime.busyReason), so the
 *  walks wait on IT instead of guessing at animation lengths. Under reduced motion or »
 *  the gate never engages and this returns at once. */
async function waitIdle(page, timeoutMs = 8000) {
  await page.waitForFunction(() => window.__dlb && window.__dlb.busy() === null, null, { timeout: timeoutMs });
}

/** A fresh browser + page with the first-run help dismissed. Caller closes the browser.
 *  `seed` defaults to 7; a test whose claim is pinned to a specific first fight picks
 *  its own (the S4 map shift moved every seed's encounter rolls). `reduce` serves the
 *  prefers-reduced-motion walks. */
async function freshPage(t, seed = 7, reduce = false) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: reduce ? 'reduce' : 'no-preference',
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

/** Travel to the first reachable ordinary fight (Skirmish / Hard fight — never Elite).
 *  NO gate wait here: the UX-4 deal test samples the hand MID-DEAL through this helper,
 *  and every interaction path (playCard/endTurn, the locators' own enabled-wait) gates
 *  on the UX-5 lock itself. */
async function travelToFight(page) {
  const nodes = page.locator('button[aria-label*="Skirmish"], button[aria-label*="Hard fight"]');
  assert.ok((await nodes.count()) > 0, 'no fight node reachable');
  await nodes.first().click();
  await page.waitForSelector('.enemy', { timeout: 5000 });
}

/** Click an enabled card by name prefix; a target-needing play resolves on `pickIndex`.
 *  The walk waits for the UX-5 gate FIRST (a previous play's animation, the enemy turn or
 *  a deal locks the hand — the enabled tile IS the gate's release), and again after the
 *  play resolves, so the caller resumes with the input actually back. */
async function playCard(page, namePrefix, pickIndex = null) {
  await waitIdle(page);
  const card = page.locator(`button[data-slot][aria-label^="${namePrefix}"][aria-disabled="false"]`);
  assert.ok((await card.count()) > 0, `${namePrefix} not playable in hand`);
  await card.first().click();
  if (pickIndex === null) { await waitIdle(page); return; }
  await page.waitForSelector('.enemy.targeting', { timeout: 3000 });
  const target = page.locator(`.enemy[data-target-index="${pickIndex}"]`);
  assert.equal(await target.count(), 1, `aimed enemy ${pickIndex} not found`);
  await target.click();
  await waitIdle(page);
}

async function endTurn(page) {
  await waitIdle(page);
  const end = page.locator('button', { hasText: 'End Turn' });
  assert.equal(await end.count(), 1, 'End Turn button not found');
  await end.click();
  await waitIdle(page);
}

/** Skip (or take) the floor reward until the map is back. The kill hold may still own
 *  the input when the phase flips, so each attempt waits for the gate first. */
async function leaveReward(page) {
  for (let guard = 0; guard < 6; guard += 1) {
    await waitIdle(page);
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
      if (s.enemies.length > 1 && s.enemies.some((e) => e.hp > 32)) {
        await waitIdle(page); // the arriving hand's deal gates the input; wait it out
        return s;
      }
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

/** Transit fight: spend attacks (kills are fine here — no claim is taken from these).
 *  The UX-5 gate owns the pacing now: waitIdle returns when the play's span (or the
 *  enemy turn, or a deal) has landed, so no blind animation-length sleeps remain. */
async function playOutTransitFight(page) {
  for (let guard = 0; guard < 24; guard += 1) {
    const s = await readState(page);
    if (s.phase !== 'combat') return;
    await waitIdle(page);
    const attack = page.locator('button[data-slot].type-attack[aria-disabled="false"]');
    if ((await attack.count()) > 0) {
      await attack.first().click();
      if (s.enemies.length > 1) {
        const toughest = s.enemies.reduce((a, b) => (b.hp > a.hp ? b : a));
        const tgt = page.locator(`.enemy[data-target-index="${toughest.index + 1}"]`);
        if ((await tgt.count()) === 1) await tgt.click();
        else await page.keyboard.press('Escape');
      }
      await waitIdle(page);
    } else {
      await endTurn(page);
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
  // labelled dialog, and the gallery is the starting deck ONE TILE PER COPY (UX-8, the
  // StS reading): Hammerfall ×5, Quench ×4, Anvil Blow ×1 render as 10 tiles — the tile
  // count IS the deck count — and nothing is tempered at run start.
  const btn = page.locator('#hud button[aria-label^="Deck:"]');
  assert.equal(await btn.getAttribute('aria-label'), 'Deck: 10 cards', 'the control must announce the deck size');
  assert.equal((await btn.textContent()).trim(), 'Deck (10)');
  await openDeck(page);

  const sheet = page.locator('.modal.deck-modal');
  assert.equal(await sheet.getAttribute('aria-label'), 'Deck: 10 cards', 'the sheet must be a labelled dialog');
  assert.equal(await sheet.locator('h2').textContent(), 'Deck (10)', 'the sheet title carries the count');
  const tiles = sheet.locator('.deck-grid .card');
  assert.equal(await tiles.count(), 10, 'the 10-card starting deck renders 10 tiles, one per copy');
  const hammer = tiles.filter({ hasText: 'Hammerfall' });
  assert.equal(await hammer.count(), 5, 'the five starter strikes read as five Hammerfall tiles');
  assert.equal(await tiles.filter({ hasText: 'Quench' }).count(), 4);
  assert.equal(await tiles.filter({ hasText: 'Anvil Blow' }).count(), 1);
  assert.equal(await sheet.locator('.ctemper').count(), 0, 'nothing in the starting deck may wear a temper stamp');
  // Each tile is the game's card face: the cost gem, the woodcut illustration of the
  // card id, and the kernel's describe sentence — which the chips-first face no longer
  // prints as a `.cdesc` row on a chip-complete card like Hammerfall (the chips row owns
  // the visible rules row); the sentence lives verbatim on the tile's native title and
  // aria-label (cardTile).
  const firstHammer = hammer.first();
  assert.equal(await firstHammer.locator('.cname').textContent(), 'Hammerfall');
  assert.equal(await firstHammer.locator('.gem-core').textContent(), '1');
  assert.match(await firstHammer.getAttribute('title'), /Deal 6 damage/);
  assert.match(await firstHammer.getAttribute('aria-label'), /Costs 1 Energy/);
  assert.equal(await firstHammer.locator('.c-illus svg').count(), 1, 'a deck tile carries the card art');
  assert.equal(await firstHammer.getAttribute('role'), 'group', 'a read-only tile is a labelled fact, not a button');
  // Deterministic order: cost then name — Hammerfall and Quench share cost 1, so the
  // cheaper pair leads and the cost-2 Anvil Blow closes the gallery (copies cluster).
  const names = await tiles.locator('.cname').allTextContents();
  assert.deepEqual(names.slice(0, 6), ['Hammerfall', 'Hammerfall', 'Hammerfall', 'Hammerfall', 'Hammerfall', 'Quench']);
  assert.equal(names[9], 'Anvil Blow');

  // Escape closes it (keyboard affordance); the map is exactly where it was.
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal.deck-modal', { state: 'detached', timeout: 3000 });
  assert.equal(await readState(page).then((s) => s.phase), 'map', 'closing the sheet must not move the run');

  // COMBAT PHASE. The same control is present in the fight; the deck is the same deck.
  await travelToFight(page);
  await openDeck(page);
  const combatSheet = page.locator('.modal.deck-modal');
  assert.equal(await combatSheet.locator('.deck-grid .card').count(), 10, 'the deck is unchanged in combat');
  assert.equal(await combatSheet.locator('.ctemper').count(), 0);
  // The Close button is the mouse affordance out.
  await combatSheet.getByRole('button', { name: /Close/ }).click();
  await page.waitForSelector('.modal.deck-modal', { state: 'detached', timeout: 3000 });
  assert.equal(await readState(page).then((s) => s.phase), 'combat', 'the fight must still be running after closing');
});

test('deck: tempered copies injected through the save lever wear their own stamped tiles', { timeout: 120000 }, async (t) => {
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

  const hot = page.locator('.modal.deck-modal .deck-grid .card.tempered');
  assert.equal(await hot.count(), 2, 'the tempered pair reads as two tiles of its own (one per copy)');
  const stamp = hot.first().locator('.ctemper .t-name');
  assert.equal(await stamp.textContent(), 'Red-hot', 'each tempered tile wears the temper stamp');
  assert.equal(await hot.nth(1).locator('.ctemper .t-name').textContent(), 'Red-hot');
  // The tile's hover sentence carries the kernel's own temper sentence beside the base one.
  assert.match(await hot.first().getAttribute('title'), /Red-hot: \+50% damage/);
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
  const tiles = sheet.locator('.codex-grid .card');
  assert.equal(await tiles.count(), 20, 'every pool card is one full card tile');

  // Spot-check one known tile: Slag Surge (cardId ironwave) — the game's card face, with
  // its cost gem, its woodcut illustration and its describe-layer sentence verbatim (the
  // chips-first face owns the visible rules row — one chip per kernel effect — and the
  // sentence itself stays verbatim on the tile's native title, cardTile) — while the
  // full-table card Maul stays ABSENT from a fresh sheet (the codex shows what the run
  // can be offered, never the whole shipped table).
  const surge = tiles.filter({ hasText: 'Slag Surge' });
  assert.equal(await surge.count(), 1, 'Slag Surge renders exactly one tile');
  assert.equal(await surge.locator('.cname').textContent(), 'Slag Surge');
  assert.equal(await surge.locator('.gem-core').textContent(), '1');
  assert.equal(await surge.locator('.cfx .cfx-chip').count(), 2,
    'the chips row carries one chip per kernel effect (Gain 5 Block, Deal 5 damage)');
  // The codex tile's title is the sentence PLUS the rarity word (codexTile keeps rarity
  // spoken deep in a long group), so the verbatim sentence is pinned as the title's head
  // and the rarity as its tail.
  assert.equal(await surge.getAttribute('title'), 'Gain 5 Block. Deal 5 damage to the enemy. (Common)');
  assert.equal(await surge.locator('.c-illus svg').count(), 1, 'the tile renders the card art');
  assert.equal(await surge.getAttribute('role'), 'group', 'a codex tile is a labelled fact, not a button');
  assert.match(await surge.getAttribute('aria-label'), /Costs 1 Energy/);
  assert.match(await surge.getAttribute('aria-label'), /Rarity: Common/);
  assert.match(await surge.getAttribute('title'), /Common/);
  assert.equal(await tiles.filter({ hasText: 'Maul' }).count(), 0, 'a locked card is not on the sheet');

  // The injected copy wears the brass corner chip; nothing else in this deck is a pool card.
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

// ---------------------------------------------------------------------------
// UX-8: the three read-only surfaces render the GAME'S card tiles. The codex is a card
// gallery — every pool card one full tile with its woodcut illustration, gem, type head
// and describe sentence — and the deck sheet is one tile per copy. The shop's removal
// pick is the deck as tiles with the tile itself the pick; that flow is driven end-to-end
// by the vendor walk above (a real click on a removal tile takes the instance out).
// Fitting is the shared modal shell's own contract: the scroller scrolls, the sheet never
// outgrows the viewport — verified here at a phone size against the 20-tile gallery.
// ---------------------------------------------------------------------------
test('UX-8: the codex gallery renders card tiles with art, and the deck sheet one tile per copy', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t);
  await bootToMap(page);

  // The codex gallery. The fresh pool is 20 cards; 14 of them have a drawn woodcut
  // today (the six Bellows-family cards ship through the designed no-art fallback —
  // the head stays, only the drawing is absent), so 14 tiles carry an illustration.
  await openCodex(page);
  const sheet = page.locator('.modal.codex-modal');
  const tiles = sheet.locator('.codex-grid .card');
  assert.equal(await tiles.count(), 20, 'the gallery shows one tile per offerable card');
  assert.equal(await sheet.locator('.codex-grid .card .c-illus svg').count(), 14,
    'the drawn cards render their woodcut inside the tile head');

  // Phone fit: the sheet never outgrows a 390x844 viewport, and the gallery scrolls
  // inside the shared modal scroller instead of clipping.
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(200);
  const sheetBox = await sheet.boundingBox();
  assert.ok(sheetBox && sheetBox.height <= 844, `the codex sheet must fit a phone viewport, got ${sheetBox && sheetBox.height}`);
  const scrolls = await sheet.locator('.modal-scroll').evaluate((n) => ({ sh: n.scrollHeight, ch: n.clientHeight }));
  assert.ok(scrolls.sh > scrolls.ch, `a 20-tile gallery must scroll (scrollHeight ${scrolls.sh} > clientHeight ${scrolls.ch})`);
  await page.locator('.modal.codex-modal').getByRole('button', { name: /Close/ }).click();
  await page.waitForSelector('.modal.codex-modal', { state: 'detached', timeout: 3000 });

  // The deck sheet: exactly 7 cards render exactly 7 tiles, duplicates as separate
  // faces, each with its art. (The lever recipe: load, then a real action repaints.)
  const res = await page.evaluate(() => {
    const ctl = window.__dlb.controller();
    const save = JSON.parse(ctl.save());
    save.state.deck = [
      { uid: 'u-0', cardId: 'strike' }, { uid: 'u-1', cardId: 'strike' },
      { uid: 'u-2', cardId: 'defend' }, { uid: 'u-3', cardId: 'defend' }, { uid: 'u-4', cardId: 'defend' },
      { uid: 'u-5', cardId: 'bash' }, { uid: 'u-6', cardId: 'ironwave' },
    ];
    return ctl.load(save);
  });
  assert.equal(res.ok, true, `save/load failed: ${JSON.stringify(res.problems)}`);
  await travelToFight(page);
  await openDeck(page);
  const deckSheet = page.locator('.modal.deck-modal');
  const deckTiles = deckSheet.locator('.deck-grid .card');
  assert.equal(await deckTiles.count(), 7, 'a 7-card deck shows 7 tiles');
  assert.equal(await deckTiles.filter({ hasText: 'Hammerfall' }).count(), 2, 'duplicates render as separate tiles');
  assert.equal(await deckSheet.locator('.deck-grid .card .c-illus svg').count(), 7,
    'every deck tile carries its card art');
  await deckSheet.getByRole('button', { name: /Close/ }).click();
  await page.waitForSelector('.modal.deck-modal', { state: 'detached', timeout: 3000 });
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
  // playCard waits for the UX-5 gate to release (the play's own span), so no blind
  // animation-length sleep is needed before the state is read.
  await playCard(page, 'Hammerfall');

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
  await waitIdle(page); // the deal gates the input; past it the deal-in has settled
  await sleep(200);

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
//   * the current attacker's intent row carries the striking highlight, and the
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
        // The intent ROW (`.e-intent`, the chips under the card) is the UX-2 highlight
        // host since the floating badge was removed — the same intent-strike animation.
        const row = card.querySelector('.e-intent');
        // ACTIVELY lit, not merely scheduled: a delayed CSS animation reports playState
        // 'running' and progress 0 through its delay phase too (the row is held unlit
        // there), so the lit window is computed from the animation's own clock: from
        // its delay to delay+duration is exactly while that attacker's slam plays.
        const live = row && row.getAnimations
          ? row.getAnimations().some((a) => {
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
  // endTurn waits for the UX-5 gate to release — the strike sequence IS that gate — so
  // by the time it returns every beat has fired and been sampled by the collector.
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
  assert.ok(seq.floats[1].t - seq.floats[0].t >= 700,
    `the strikes land in ORDER, a beat apart (the UX-4 beat is 1000ms): ${seq.floats.map((f) => `${f.text}@${f.t - seq.floats[0].t}ms`).join(', ')}`);

  // The striking row highlight moves with the sequence: attacker 1's window opens
  // first, attacker 2's a beat later.
  const firstOf = (k) => seq.badgeRuns.find((r) => r.ks.includes(k)) ?? null;
  const one = firstOf('1');
  const two = firstOf('2');
  assert.ok(one, 'attacker 1 intent row carried the intent-strike highlight');
  assert.ok(two, 'attacker 2 intent row carried the intent-strike highlight');
  assert.ok(two.t - one.t >= 700,
    `the highlight moved attacker 1 -> attacker 2, a beat apart (the UX-4 beat is 1000ms): ${two.t - one.t}ms`);
});

// ---------------------------------------------------------------------------
// UX-4: the DRAW is a visible DEAL. The complaint under the slice: cards landed
// "almost together" (a 30ms ripple over a 0.3s fade) and the play barely registered.
// The claims, measured on the fight's own opening deal:
//   * every card's entry is a real animation (juice-deal) with a >=400ms flight
//     (the paced 600ms);
//   * consecutive cards land a >=150ms beat apart (the paced 180ms step) — an 8-card
//     deal therefore spans 7x180 + 600 ≈ 1.86s of visible sequential landing;
//   * the entry is a TRAVEL, not a fade: mid-deal, wraps sit away from their seats;
//   * the deal lands in the layout's OWN fan: the settled live hand's wrap rects equal
//     an off-screen lab copy built without the deal class (the UX-3 lab pattern), and
//     no transform residue is left on any wrap — the cards land where the layout put
//     them, only the entry animates.
// (The opening hand is 5 cards; the step assertion is what generalises to 8.)
// ---------------------------------------------------------------------------
test('the opening draw is a visible deal: staggered, travelling, layout-stable (UX-4)', { timeout: 60000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t);
  await bootToMap(page);
  await travelToFight(page);

  // MID-DEAL sample, taken as soon as the fight paints: the deal clock is still running
  // (a 5-card deal spans ~1.32s), so late wraps are held at their entry frame and early
  // ones are mid-flight. Each wrap reports its own juice-deal timing off the Web
  // Animations API — the deal's own clock, not a stylesheet constant.
  const mid = await page.evaluate(() => {
    const wraps = [...document.querySelectorAll('.hand.deal-in > .card-wrap')];
    return {
      n: wraps.length,
      anims: wraps.map((w) => {
        const a = (w.getAnimations ? w.getAnimations() : []).find((x) => x.animationName === 'juice-deal');
        if (!a) return null;
        const t2 = a.effect.getComputedTiming();
        return { delay: t2.delay, dur: t2.duration };
      }),
      cardRects: wraps.map((w) => {
        const r = w.querySelector('.card').getBoundingClientRect();
        return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10 };
      }),
      wrapRects: wraps.map((w) => {
        const r = w.getBoundingClientRect();
        return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10 };
      }),
    };
  });

  assert.ok(mid.n >= 5, `the opening hand is dealt (${mid.n} cards)`);
  assert.ok(mid.anims.every((a) => a), `every dealt card carries the deal entry: ${JSON.stringify(mid.anims)}`);
  for (const a of mid.anims) {
    assert.ok(a.dur >= 400, `each card's flight is a visible >=400ms (got ${a.dur}ms)`);
  }
  for (let i = 1; i < mid.anims.length; i += 1) {
    const gap = mid.anims[i].delay - mid.anims[i - 1].delay;
    assert.ok(gap >= 150, `cards land one by one: card ${i + 1} starts >=150ms after card ${i} (got ${gap}ms)`);
  }
  const span = mid.anims[mid.anims.length - 1].delay + mid.anims[mid.anims.length - 1].dur;
  assert.ok(span >= 1000, `the deal spans a readable >=1s (${Math.round(span)}ms for ${mid.n} cards)`);

  // Settle, then prove the LANDING: the settled live hand must sit exactly where the
  // ordinary layout puts a hand — measured against an off-screen lab copy built without
  // the deal class (the UX-3 gem probe's lab pattern). Only the entry animates; the fan
  // the deal lands in is the layout's own, and no entry residue is left on the wraps.
  await waitIdle(page); // the deal clock retires the gate; the entry is over past it
  await sleep(200);
  const end = await page.evaluate(() => {
    const hand = document.querySelector('.hand');
    const lab = document.createElement('div');
    lab.className = 'stage-combat';
    lab.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;';
    const labHand = document.createElement('div');
    labHand.className = 'hand';
    labHand.style.width = hand.clientWidth + 'px';
    lab.append(labHand);
    document.body.append(lab);
    const live = [...hand.querySelectorAll(':scope > .card-wrap')];
    for (const w of live) labHand.append(w.cloneNode(true));
    const off = (w, parent) => {
      const r = w.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      return { x: Math.round((r.x - p.x) * 10) / 10, y: Math.round((r.y - p.y) * 10) / 10 };
    };
    const out = {
      live: live.map((w) => off(w, hand)),
      lab: [...labHand.querySelectorAll(':scope > .card-wrap')].map((w) => off(w, labHand)),
      residue: live.map((w) => getComputedStyle(w).transform),
    };
    lab.remove();
    return out;
  });
  assert.equal(end.live.length, mid.n, 'the settled hand is the dealt hand');
  assert.deepEqual(end.residue, Array(end.live.length).fill('none'),
    'the entry released every wrap: no transform left after the deal');
  for (let i = 0; i < end.live.length; i += 1) {
    const dx = Math.abs(end.live[i].x - end.lab[i].x);
    const dy = Math.abs(end.live[i].y - end.lab[i].y);
    assert.ok(dx <= 1 && dy <= 1,
      `card ${i + 1} lands exactly in the layout's own fan position (off by ${dx},${dy}px)`);
  }
  const travelled = mid.wrapRects.some((r, i) =>
    Math.abs(r.x - end.live[i].x) >= 20 || Math.abs(r.y - end.live[i].y) >= 20);
  assert.ok(travelled, 'the deal entry is a travel: a card was away from its seat mid-deal');
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

  // Turn 1: Maul (32) leaves the 43-HP Jaw Worm at 11. playCard/endTurn wait on the
  // UX-5 gate (the play span, the enemy turn, the deal), so no blind sleeps remain.
  let s = await readState(page);
  if (!s.hand.some((c) => c.cardId === 'bludgeon')) {
    await endTurn(page);
    s = await readState(page);
    assert.ok(s.hand.some((c) => c.cardId === 'bludgeon'), 'no Maul dealt in two hands');
  }
  await playCard(page, 'Maul');

  await endTurn(page);

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
    await waitIdle(page);
    const maul = page.locator('button[data-slot][aria-label^="Maul"][aria-disabled="false"]');
    if ((await maul.count()) > 0) {
      await maul.first().click();
      if ((await page.locator('.enemy.targeting').count()) > 0) {
        await page.locator('.enemy[data-target-index]').first().click();
      }
      await waitIdle(page);
    } else {
      await endTurn(page);
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
  // UX-4 pace: pose animMs(1150) = 2300ms; impact beat at 66% ≈ 1518ms; the shockwave
  // lives a paced 1120ms beyond that. The UX-5 play span (pose 2300 + the signature
  // tail ≈ 2910ms) covers every beat, and the gate releases past it.
  await waitIdle(page);
  await sleep(300);

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
      s = await readState(page);
      if (s.phase !== 'combat' || !s.hand.some((c) => c.cardId === 'twin_strike')) return null;
    }
    await waitIdle(page); // the hand's deal gates the input; wait it out before the aim

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
    // UX-4 pace: the salvo's flight is animMs(900) = 1800ms and lands at ~1512ms —
    // inside the play's own input span (pose 2200 + signature tail ≈ 2840ms), so the
    // gate releases after the arc has been fully sampled.
    await waitIdle(page);
    await sleep(200);
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
    await sleep(500); // mid-flight; the ghost holds until ~1512ms now (UX-4), then shatters

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
    // The band routes the walk across REAL fights, and a signature play can KILL the
    // very foe it was demonstrating on — so the collection walks ON (reward skipped,
    // the next fight entered) instead of giving up when the first fight ends. Fights,
    // not hands, are the budget now.
    for (let fight = 0; fight < 8 && pending.size > 0; fight += 1) {
      const st = await readState(page);
      if (st.phase === 'ended') return null;
      if (st.phase === 'map') { await travelToFight(page); continue; }
      if (st.phase === 'reward') { await leaveReward(page); continue; }
      if (st.phase !== 'combat') { await sleep(400); continue; }
      for (const [key, face] of FACES) {
        if (!pending.has(key)) continue;
        if ((await readState(page)).phase !== 'combat') break; // the stroke ended the fight
        await waitIdle(page); // the previous play's span owns the input until it lands
        const btn = page.locator(`button[data-slot][aria-label^="${face}"][aria-disabled="false"]`);
        if ((await btn.count()) === 0) continue;
        const seen = await page.evaluate((k) => window.__fx[k], key);
        await btn.first().click();
        // Only the attack aims: with 2+ enemies the row enters targeting; with one it
        // plays straight through (see playCard).
        if ((await page.locator('.enemy.targeting').count()) > 0) {
          await page.locator('.enemy[data-target-index]').first().click();
        }
        // The play's own input span (pose + signature tail) covers the impact beat and
        // the effect's lifetime, so the gate releasing means the fx have fired AND been
        // sampled — and it keeps the next play from retiring this one's pending
        // signature timer (the animGen guard).
        await waitIdle(page);
        await sleep(200);
        if ((await page.evaluate((k) => window.__fx[k], key)) > seen) pending.delete(key);
      }
      if (pending.size === 0) break;
      if ((await readState(page)).phase === 'combat') await endTurn(page);
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

  // The removal service: pay, pick one card tile out of the deck gallery, land back.
  const rem = page.locator('button[data-action="x"]');
  assert.equal(await rem.count(), 1, 'the service is a button while the purse covers it');
  await rem.click();
  await page.waitForSelector('.remove-grid', { timeout: 3000 });
  const deckNow = await page.evaluate(() => window.__dlb.snapshot().deckCount);
  const choices = page.locator('.remove-grid .card');
  assert.equal(await choices.count(), deckNow, 'one card tile per deck instance');
  // The tile IS the pick: it carries the instance's action id and the removal sentence.
  const pickTile = choices.first();
  assert.ok(await pickTile.getAttribute('data-action'), 'a removal tile carries its action id');
  assert.match(await pickTile.getAttribute('aria-label'), /Remove /);
  await pickTile.click();
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

  // BOOT: the belt is a COMBAT surface now — off-combat (the boot map) it does not
  // render at all, and the kernel belt agrees it is empty.
  assert.equal(await page.locator('.belt').count(), 0, 'no belt rendered on the boot map');
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
  // The drop lands the instant the fight is won — off-combat (reward/map), where the
  // belt does not render at all. The chip itself is claimed in the next fight, below.
  assert.equal(await page.locator('.belt').count(), 0, 'no belt off-combat (potions are combat items)');

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
// 11. the S7 relics: the HUD paints NO relic chip (relics act through hooks, never
//     clicks — the held rows live in the kernel's snapshot and name themselves where
//     they matter: the reward heads, the summary); an ELITE victory always drops a
//     relic (the spoils chip on the reward head, the held count reaching 2 in the
//     snapshot); the BOSS victory offers three relic buttons instead of cards, taking
//     one ends the run in victory, and the summary names the relic count. Real clicks
//     only; the injected deck ends fights fast.
// ---------------------------------------------------------------------------
test('relics: no HUD chip, the held count climbs on an elite drop, and the warden offers three', { timeout: 300000 }, async (t) => {
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

  // Boot: exactly one held relic (the hero's starter), carried by the KERNEL's snapshot
  // — the HUD itself paints no relic chip any more (relics act through hooks, never
  // clicks, so the readout had nothing a click could do).
  await page.locator('button.boon').first().click();
  await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });
  assert.equal(await page.locator('.relics').count(), 0, 'no relic chip in the HUD');
  const bootHeld = await page.evaluate(() => window.__dlb.snapshot().relics);
  assert.equal(bootHeld.length, 1, 'one held relic at boot (the kernel snapshot carries it)');
  assert.match(bootHeld[0].name, /Kindled Heart|Cyan Lantern/, `the kernel names the starter: ${bootHeld[0].name}`);
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
  let eliteMeasured = false; // the elite-height probe fires once, at the first elite fight's opening
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
      // PROBE — the user's contract: élites más altos que el héroe. At the FIRST
      // coexistence of .fight, .enemy.e-elite and .fight .hero .fig (the elite alive:
      // this is the loop's first iteration of that fight, before any card has flown),
      // the same live fight is sampled at three viewports, then the walk resumes:
      //   1280x800 — the desktop contract: the elite's .fig TALLER than the hero's;
      //   1280x720 — the laptop cap band (fight capped at 348px): still taller, AND
      //     the elite card fits the fight — it clips from the top, so an oversized card
      //     eats the intent row, the fight's central reading;
      //   844x390 — the compact stage suspends the contract by design: elite and hero
      //     flatten to the same 64px figure.
      // The walk prefers elites on the map, so the first coexistence is the first
      // elite fight. Measured once; later fights pass the probe by.
      if (!eliteMeasured) {
        const sample = () => page.evaluate(() => {
          const eliteFig = document.querySelector('.enemy.e-elite .fig');
          const heroFig = document.querySelector('.fight .hero .fig');
          const eliteSpr = document.querySelector('.enemy.e-elite .spr');
          const heroSpr = document.querySelector('.fight .hero .fig .spr');
          const fight = document.querySelector('.fight');
          if (!fight || !eliteFig || !heroFig || !eliteSpr || !heroSpr) return null;
          const c = eliteFig.closest('.enemy').getBoundingClientRect();
          const f = fight.getBoundingClientRect();
          return {
            elite: eliteFig.getBoundingClientRect().height,
            hero: heroFig.getBoundingClientRect().height,
            eliteSpr: eliteSpr.getBoundingClientRect().height,
            heroSpr: heroSpr.getBoundingClientRect().height,
            cardTop: c.top, fightTop: f.top,
          };
        });
        const tall = await sample();
        if (tall) {
          eliteMeasured = true;
          assert.ok(tall.elite > tall.hero,
            `the elite must stand taller than the hero — .enemy.e-elite .fig = ${tall.elite}px vs .fight .hero .fig = ${tall.hero}px (1280x800)`);
          assert.ok(tall.eliteSpr > tall.heroSpr,
            `the elite's DRAWN sprite must stand taller than the hero's (the spr rect includes the scale) — .enemy.e-elite .spr = ${tall.eliteSpr}px vs .fight .hero .fig .spr = ${tall.heroSpr}px (1280x800)`);
          await page.setViewportSize({ width: 1280, height: 720 });
          await sleep(150);
          const capped = await sample();
          assert.ok(capped, 'the elite fight is still on stage at 1280x720');
          assert.ok(capped.elite > capped.hero,
            `the elite must stand taller than the hero in the laptop cap band — ${capped.elite}px vs ${capped.hero}px (1280x720)`);
          assert.ok(capped.eliteSpr > capped.heroSpr,
            `the elite's DRAWN sprite must stand taller than the hero's in the laptop cap band — ${capped.eliteSpr}px vs ${capped.heroSpr}px (1280x720)`);
          assert.ok(capped.cardTop >= capped.fightTop - 0.5,
            `the elite card must fit the capped fight at 1280x720 (the top clip eats the intent row) — card top ${capped.cardTop} vs fight top ${capped.fightTop}`);
          await page.setViewportSize({ width: 844, height: 390 });
          await sleep(150);
          const flat = await sample();
          assert.ok(flat, 'the elite fight is still on stage at 844x390');
          assert.ok(Math.abs(flat.elite - 64) < 0.5 && Math.abs(flat.hero - 64) < 0.5,
            `the compact stage flattens elite and hero alike to 64px — got ${flat.elite}px vs ${flat.hero}px at 844x390`);
          await page.setViewportSize({ width: 1280, height: 800 });
          await sleep(150);
        }
      }
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
        const heldNow = await page.evaluate(() => window.__dlb.snapshot().relics.length);
        assert.equal(heldNow, 2, 'the elite drop brought the held count to 2 (the kernel snapshot)');
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
    } else if (phase === 'shop') {
      // The weave can route the walk through the vendor (a feeder lane reaches the
      // placed slot): leave at once, the walk's claims are the relic screen's.
      await page.locator('button', { hasText: /leave/i }).first().click();
      await sleep(600);
    } else if (phase === 'event') {
      // A wayside sits on some seed-7 paths (the weave can even make it a one-edge
      // band's only step): take the free choice, then continue.
      // Affordable choices carry no `disabled` attribute (dimmed ones carry
      // disabled="disabled"), so :not([disabled]) is the enabled-selector form.
      // UX-6: the smith's TEMPER choice (now reachable on funneled lanes) opens the
      // committed modal instead of a result — pick an offer, then continue.
      await page.locator('.event-choices .boon:not([disabled])').first().click();
      const modal = page.locator('.temper-list .card[data-action]');
      if (await modal.count()) { await modal.first().click(); await sleep(500); }
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
    } else if (phase === 'shop') {
      // The weave can route the walk through the vendor (a feeder lane reaches the
      // placed slot): leave at once, the claims are the vault's.
      await page.locator('button', { hasText: /leave/i }).first().click();
      await sleep(600);
    } else if (phase === 'event') {
      // The weave can funnel the walk into a wayside whose first enabled choice is
      // the smith's TEMPER — that opens the committed modal instead of a result:
      // pick an offer, then continue.
      await page.locator('.event-choices .boon:not([disabled])').first().click();
      const modal = page.locator('.temper-list .card[data-action]');
      if (await modal.count()) { await modal.first().click(); await sleep(500); }
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

/* ---------------------------------------------------------------- I18N-1: language */

test('language: the toggle flips the combat UI and the card sentences to Spanish and back, persists across a reload, and never disturbs the run', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t);

  // P1 WIRING (live DOM): the kindling picker is the first screen, so the hero blurbs
  // are checkable in BOTH languages across this walk — the empty-blurb regression (a
  // key/id mismatch) failed exactly here, silently, in both languages.
  await page.waitForSelector('.hero-pick', { timeout: 5000 });
  const blurbsEn = await page.locator('.hero-pick .hp-blurb').allTextContents();
  assert.equal(blurbsEn.length, 2, 'both heroes render a blurb row');
  for (const b of blurbsEn) assert.ok(b.trim().length > 0, `no empty hero blurb (en): "${b}"`);

  await bootToMap(page);
  await travelToFight(page);
  await waitIdle(page);

  // DEFAULT: English chrome, English card sentences, <html lang="en">.
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  const endBtn = page.locator('.controls button', { hasText: 'End Turn' });
  assert.equal(await endBtn.count(), 1, 'the English End Turn button is present');
  assert.equal((await page.locator('.pile-draw .pile-name').textContent()).trim(), 'Draw');
  // The chips-first face prints effect chips, not the sentence row; the kernel's own
  // sentence still rides every tile's native title (cardTile), so that is where the
  // localized content is read.
  const enDesc = await page.locator('.card').first().getAttribute('title');
  assert.match(enDesc, /^(Deal|Gain|Draw|Discard|Restore|Exhaust|Retain|Lose|Apply|Double|Special)/,
    'an English kernel sentence shows before the switch');
  const enEnemyName = (await page.locator('.enemy .ename').first().textContent()).trim();
  const before = await readState(page);
  assert.equal(before.phase, 'combat');

  // THE SWITCH. The control is found by its bilingual aria-label, which reads the same
  // in both languages, so a Spanish-only screen reader still finds it.
  const toggle = page.locator('#hud button.lang-toggle');
  assert.equal(await toggle.getAttribute('aria-label'), 'Language / Idioma');
  await toggle.click();
  await waitIdle(page);

  // Spanish chrome: <html lang>, the toggle's own label, End Turn, the piles, the hint.
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'es', '<html lang> follows the switch');
  assert.equal((await page.locator('#hud button.lang-toggle').textContent()).trim(), 'ES');
  assert.equal((await page.locator('.controls button', { hasText: 'Terminar turno' }).count()), 1, 'End Turn renders Spanish');
  assert.equal((await page.locator('.pile-draw .pile-name').textContent()).trim(), 'Robo');
  assert.equal((await page.locator('.pile-discard .pile-name').textContent()).trim(), 'Descarte');
  assert.match(await page.locator('p.hint').last().textContent(), /Haz clic en una carta para jugarla/,
    'the combat hint renders Spanish');

  // I18N-2: the CONTENT localizes too — the enemy's display name is the enemies
  // table's own Spanish twin (the state's hashed stateName never moves, so the run
  // above is untouched; only the word changed).
  const esEnemyName = (await page.locator('.enemy .ename').first().textContent()).trim();
  assert.notEqual(esEnemyName, enEnemyName, `the enemy name localizes ("${enEnemyName}" -> "${esEnemyName}")`);
  assert.doesNotMatch(esEnemyName, /^(Cinder|Ash|Kiln|Slag|Gremlin|The) /, 'no English enemy name survives the switch');

  // Spanish card sentences, re-derived kernel-side from the same effect data (read off
  // the tile's native title — the chips-first face has no sentence row; see above).
  const esDesc = await page.locator('.card').first().getAttribute('title');
  assert.match(esDesc, /^(Infliges|Ganas|Robas|Descartas|Restauras|Agotas|Retienes|Pierdes|Aplicas|Duplicas|Gana)/,
    'a Spanish kernel sentence shows after the switch');
  assert.doesNotMatch(esDesc, /^(Deal|Gain|Draw|Discard|Restore|Exhaust|Retain|Apply) /,
    'the English sentence is gone from the tile');

  // THE RUN IS UNTOUCHED: same phase, same turn, same living enemies — only the words changed.
  const afterSwitch = await readState(page);
  assert.equal(afterSwitch.phase, 'combat');
  assert.equal(afterSwitch.turn, before.turn);
  assert.deepEqual(
    afterSwitch.enemies.map((e) => ({ index: e.index, hp: e.hp })),
    before.enemies.map((e) => ({ index: e.index, hp: e.hp })),
  );

  // PERSISTENCE: the choice lives in localStorage (dlb.lang), so a reload boots Spanish
  // (a fresh run — the browser surface never resumes a mid-run fight; that is the
  // pre-existing boot contract, not this slice's).
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#hud', { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'es', 'the reload boots Spanish');
  assert.equal((await page.locator('#hud button.lang-toggle').textContent()).trim(), 'ES');
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), 'es');

  // P1 WIRING, Spanish side: the fresh boot lands on kindling again, so the hero
  // blurbs must render non-empty in es too — and I18N-2 localizes the pick NAMES.
  await page.waitForSelector('.hero-pick', { timeout: 5000 });
  const blurbsEs = await page.locator('.hero-pick .hp-blurb').allTextContents();
  assert.equal(blurbsEs.length, 2, 'both heroes render a blurb row (es)');
  for (const b of blurbsEs) assert.ok(b.trim().length > 0, `no empty hero blurb (es): "${b}"`);
  const namesEs = await page.locator('.hero-pick .hp-name').allTextContents();
  assert.deepEqual(namesEs, ['Ashwright', 'Custodio del Fuelle'],
    'the pick names localize: the proper noun stays, the Keeper title translates');

  // BACK TO ENGLISH: one click restores the English chrome on the fresh run.
  await page.locator('#hud button.lang-toggle').click();
  await waitIdle(page);
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  assert.equal((await page.locator('#hud button.lang-toggle').textContent()).trim(), 'EN');
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), 'en');
});

// ---------------------------------------------------------------------------
// MELEE SWING REGRESSION (the user's symptom): a melee stroke — the starter
// Hammerfall — must END with its impact; the attack must never play again.
// heroFigure() (src/web/combat-view.js) compensates the pose keyframe on the
// .fig only; the frame layers (.spr-frame-windup / .spr-frame-strike of the
// hero markup, stage-art.js) are FRESH nodes on every paint, so the internal
// repaint after the swing — the past-the-end grace branch freezes only the
// .fig — re-arms the children's keyframes from 0% and the whole attack plays a
// second time. Measured in vivo at --pace=2 (the 560ms pose x2): the strike
// impact paints ~120ms after the stroke commits, everything rests by ~1320ms,
// then a repaint at ~1354ms replays the windup (~1.4s) and the strike
// (~2.0s), and the pose class sticks until the hold's expiry repaint (~2.2s).
// The pinned contract is the player's own sentence — the animation ends with
// the impact: the strike frame's visible window (>0.5 opacity) happens ONCE,
// and once it has ended, NEITHER frame may show again. The in-page 40ms
// collector (see header: transient animation round-trips Node polling) reads
// both frames' computed opacities; querySelector re-resolves every tick, so a
// repaint that re-creates the frames is sampled like any other tick.
// ---------------------------------------------------------------------------
test('la pose melee no se repite tras el impacto (Hammerfall)', { timeout: 60000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  // Seed 3's first travel lands DIRECTLY in a two-enemy fight (Twin Mites):
  // the shape where the card click enters targeting and the committed stroke
  // is the melee Hammerfall. Check .fight, never map nodes, past the travel.
  const page = await freshPage(t, 3);
  await bootToMap(page);
  await page.locator('button[aria-label^="Travel to"]').first().click();
  await page.waitForSelector('.fight', { timeout: 5000 });
  const opened = await readState(page);
  assert.equal(opened.phase, 'combat');
  assert.equal(opened.enemies.length, 2, 'seed 3 opens on the two-enemy fight');

  await waitIdle(page); // the arriving hand's deal gates the input
  await page.waitForSelector('.fight .hero .fig', { timeout: 5000 });

  // The collector, installed BEFORE the play: every 40ms, the computed
  // opacities of the hero's windup and strike frame imgs.
  await page.evaluate(() => {
    window.__hswing = [];
    const t0 = performance.now();
    const opacityOf = (sel) => {
      const n = document.querySelector(sel);
      return n ? Number(getComputedStyle(n).opacity) : 0;
    };
    window.__hswingTimer = setInterval(() => {
      window.__hswing.push({
        dt: Math.round(performance.now() - t0),
        windup: opacityOf('.fight .hero .fig .spr-frame-windup'),
        strike: opacityOf('.fight .hero .fig .spr-frame-strike'),
      });
    }, 40);
  });

  // The card face is Hammerfall (the kernel id is strike); with two enemies the
  // click enters targeting — commit the stroke on the first aim.
  const card = page.locator('button[data-slot][aria-label^="Hammerfall"][aria-disabled="false"]');
  assert.ok((await card.count()) > 0, 'Hammerfall must be playable in the opening hand');
  await card.first().click();
  await page.waitForSelector('.enemy.targeting', { timeout: 3000 });
  await page.locator('.enemy.targeting').first().click();

  // Sample through the swing AND past the ghost-pose window (~2.2s): the
  // replay lands its windup ~1.4s and its strike ~2.0s after the impact.
  await sleep(3000);
  const samples = await page.evaluate(() => { clearInterval(window.__hswingTimer); return window.__hswing; });

  // THE CONTRACT: the impact is ONE contiguous window of strike >0.5 samples,
  // and once it ended, no later sample may show windup >0.3 or strike >0.5 —
  // the pose's animation ends with the stroke.
  const impactIdx = samples.map((s, i) => (s.strike > 0.5 ? i : -1)).filter((i) => i >= 0);
  assert.ok(impactIdx.length >= 2,
    `the impact must be visible (strike >0.5 in ${impactIdx.length} of ${samples.length} samples)`);
  const first = impactIdx[0];
  const last = impactIdx[impactIdx.length - 1];
  assert.equal(last - first + 1, impactIdx.length,
    `the impact must be ONE contiguous window: ${JSON.stringify(samples.slice(first, last + 1).map((s) => [s.dt, s.strike]))}`);
  const ghosts = samples.slice(last + 1).filter((s) => s.windup > 0.3 || s.strike > 0.5);
  assert.deepEqual(ghosts, [],
    `nothing of the swing may replay after the impact: ${JSON.stringify(ghosts)}`);
});

// ---------------------------------------------------------------------------
// 12. the ONBOARDING-TOUR product tour (docs/specs/ONBOARDING-TOUR-spec.md):
//     six coach-marks over the REAL screens, anchored to elements the views
//     already paint, phase-gated (review round 2): a Next/Back exists only
//     where its destination step shares the phase on screen, and an action
//     step (kindling, map) carries a hint line instead. THE LANGUAGE PRE-STEP
//     (the language ask): a fresh-onboarding boot whose player never chose a
//     language opens on the bilingual language card BEFORE the heroes step —
//     choosing there (or any exit) writes dlb.lang and it never shows again;
//     a browser whose locale starts with 'es' boots Spanish WITHOUT dlb.lang
//     until the choice. The tour tests are the INVERSE of the mainline walks'
//     addInitScript contract: they seed NO flag by default (fresh onboarding),
//     and seed both explicitly only where the claim is about a veteran. Every
//     title carries 'tour' so the suite runs isolated with
//     --test-name-pattern=tour. Real clicks and real keys only; the tour's own
//     published truth (window.__dlb.tour) is what the walks wait on.
// ---------------------------------------------------------------------------
/** A fresh page with NO onboarding flags seeded (or exactly the ones the test
 *  names). Mirrors freshPage but does not seed dlb.helpSeen.v1 — seeding it
 *  would hide the very surface these tests claim. `locale` overrides the
 *  context's navigator.language (the browser-default language rule); `reduce:
 *  false` runs with motion NORMAL — the tour's geometry claims must hold while
 *  the card's entrance animation runs, not only under the reduce default. */
async function freshTourPage(t, { seed = 7, width = 1280, height = 800, flags = null, locale = null, reduce = true } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduce ? 'reduce' : 'no-preference',
    ...(locale ? { locale } : {}),
  });
  t.after(() => { void browser.close(); });
  const page = await ctx.newPage();
  if (flags) {
    await page.addInitScript((fs) => {
      for (const [k, v] of Object.entries(fs)) { try { localStorage.setItem(k, v); } catch {} }
    }, flags);
  }
  await page.goto(`${base}/src/web/index.html?seed=${seed}`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** The card and the anchor must not share a pixel (ONBOARDING-TOUR AC7). `sel` may be
 *  an array — the heroes step anchors the hero row AND the path row in one union hole,
 *  so the claim is measured on the union bounding box, the way tour.js draws it. */
const tourCardClearOfAnchor = (page, sel) => page.evaluate((anchorSel) => {
  const card = document.querySelector('.tour-card').getBoundingClientRect();
  const u = [].concat(anchorSel).map((s) => document.querySelector(s)).filter(Boolean)
    .map((e) => e.getBoundingClientRect())
    .reduce((a, r) => ({
      left: Math.min(a.left, r.left), top: Math.min(a.top, r.top),
      right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom),
    }));
  return card.right <= u.left || u.right <= card.left
    || card.bottom <= u.top || u.bottom <= card.top;
}, sel);

/** The ring covers the viewport EXCEPT the anchor's hole: the anchor's centre is
 *  not shaded, a far corner is. `sel` may be an array (the heroes union). */
const tourRing = (page, sel) => page.evaluate((anchorSel) => {
  const u = [].concat(anchorSel).map((s) => document.querySelector(s)).filter(Boolean)
    .map((e) => e.getBoundingClientRect())
    .reduce((a, r) => ({
      left: Math.min(a.left, r.left), top: Math.min(a.top, r.top),
      right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom),
    }));
  const at = (r) => {
    const hit = document.elementFromPoint(r.left + (r.right - r.left) / 2, r.top + (r.bottom - r.top) / 2);
    return hit ? hit.closest('.tour-shade') === null : false;
  };
  const corner = document.elementFromPoint(6, 6);
  return {
    anchorClear: at(u),
    cornerShaded: corner ? corner.classList.contains('tour-shade') : false,
  };
}, sel);

test('tour: a fresh boot opens on the language choice, then the guided tour on the kindling screen', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshTourPage(t);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // THE LANGUAGE PRE-STEP comes first (the language ask): a fresh-onboarding boot whose
  // player never chose reads the bilingual card — both languages at once, two native-
  // named buttons — with NO step counter and NO shade ring: the kindling screen below
  // must stay visible, because picking is supposed to flip it before the player's eyes.
  await page.waitForSelector('#tour-layer .tour-card', { timeout: 5000 });
  assert.equal(await page.locator('.tour-count').count(), 0, 'the pre-step carries no n-of-6 counter');
  assert.equal((await page.locator('.tour-head').first().textContent()).trim(), 'Idioma — Language', 'the title is bilingual');
  const bodies = await page.locator('.tour-body').allTextContents();
  assert.ok(bodies.some((b) => b.includes('Elige el idioma del juego')), 'the Spanish body is on the card');
  assert.ok(bodies.some((b) => b.includes('Pick the game’s language')), 'the English body is on the card');
  assert.equal(await page.getByRole('button', { name: 'Español' }).count(), 1, 'the native Spanish button');
  assert.equal(await page.getByRole('button', { name: 'English' }).count(), 1, 'the native English button');
  assert.equal(await page.locator('.tour-shade').count(), 0, 'no ring: the kindling screen stays visible');
  assert.deepEqual(await page.evaluate(() => window.__dlb.tour()), { open: true, step: -1 }, 'the pre-step is the published truth');
  assert.equal(await page.locator('.modal').count(), 0, 'no auto-opened Help sheet (still retired)');
  assert.equal(await page.getByRole('button', { name: 'Help' }).count(), 1, 'the HUD Help button still renders');

  // Choosing ENGLISH (the en-US default, confirmed explicitly) writes dlb.lang and lands
  // the heroes step with its full union ring — the review-round-2 claims, untouched.
  await page.getByRole('button', { name: 'English' }).click();
  await page.waitForFunction(() => window.__dlb.tour().step === 0, null, { timeout: 5000 });
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 1 of 6', 'the first REAL step is the heroes one');
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), 'en', 'the choice persisted');
  assert.equal(await page.locator('.tour-shade').count(), 4, 'the shade ring is up around the hero+path union');
  // Review round 2: the ring is the UNION of .hero-select and .biome-select — both
  // radio groups sit visible and clickable in the one hole.
  const ring = await tourRing(page, ['.hero-select', '.biome-select']);
  assert.ok(ring.anchorClear, 'the hero and path rows sit in the ring hole');
  assert.ok(ring.cornerShaded, 'everything outside the hole is dimmed by the shades');
  // Clickable, not just visible: a hero pick's own centre hits the pick, never a shade —
  // the player's complaint was exactly a subject dimmed behind its own coach-mark.
  const clickable = await page.evaluate(() => {
    const pick = document.querySelector('.hero-pick.on');
    const hit = document.elementFromPoint(
      pick.getBoundingClientRect().left + pick.getBoundingClientRect().width / 2,
      pick.getBoundingClientRect().top + pick.getBoundingClientRect().height / 2);
    return hit === pick || pick.contains(hit);
  });
  assert.ok(clickable, 'the checked hero pick sits in the hole, unshaded');

  // Review round 1 of the rework: the pickers' keydown stops propagation for the keys
  // they handle, so an arrow on a FOCUSED pick switches it and the tour stays put with
  // the caret on the pick — before the fix the same press ALSO ran the guard's tourNext
  // (measured: step 1, caret stolen to the card), so the copy's arrow claim was false.
  const startHero = await page.evaluate(() => window.__dlb.snapshot().character);
  await page.focus('.hero-pick.on');
  await page.keyboard.press('ArrowRight');
  await sleep(250);
  const arrow = await page.evaluate(() => ({
    step: window.__dlb.tour().step,
    hero: window.__dlb.snapshot().character,
    focus: document.activeElement.className,
  }));
  assert.notEqual(arrow.hero, startHero, 'ArrowRight switched the focused pick');
  assert.equal(arrow.step, 0, 'the arrow did not step the tour');
  assert.ok(arrow.focus.includes('hero-pick'), `the caret stayed on the pick (${arrow.focus})`);
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('tour: choosing Español flips the tour AND the kindling screen to Spanish at once and persists the choice', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshTourPage(t);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#tour-layer .tour-card', { timeout: 5000 });

  // The pick re-snapshots the CURRENT run with {lang} (switchLang's move) and repaints:
  // the coach card AND the kindling screen underneath read Spanish on the same beat.
  await page.getByRole('button', { name: 'Español' }).click();
  await page.waitForFunction(() => window.__dlb.tour().step === 0, null, { timeout: 5000 });
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Paso 1 de 6', 'the tour card is Spanish immediately');
  assert.ok((await page.locator('.tour-head').first().textContent()).includes('Tu héroe y tu camino'), 'the heroes step narrates in Spanish');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'es', '<html lang> followed the choice');
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), 'es', 'dlb.lang was written');
  assert.equal((await page.locator('.kindling-head').first().textContent()).trim(), 'La forja ofrece un rescoldo', 'the kindling screen underneath flipped too');
  assert.equal(await page.getByRole('button', { name: 'Ayuda' }).count(), 1, 'the HUD reads Spanish too');

  // PERSISTENCE: skip the tour (both flags), reload — Spanish stands, the tour is done.
  await page.locator('.tour-skip').click();
  await page.waitForFunction(() => window.__dlb.tour().open === false, null, { timeout: 5000 });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await sleep(300);
  assert.equal(await page.locator('.tour-card').count(), 0, 'the tour does not come back');
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), 'es', 'the choice survived the reload');
  assert.equal((await page.locator('.kindling-head').first().textContent()).trim(), 'La forja ofrece un rescoldo', 'the reload boots Spanish');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('tour: a Spanish browser boots in Spanish before any choice, and nothing is written until it chooses', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshTourPage(t, { locale: 'es-ES' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // The browser default (i18n readLang): navigator.language es-ES reads Spanish in
  // MEMORY — <html lang>, the kernel snapshot and the chrome are Spanish on the first
  // paint — while dlb.lang stays UNWRITTEN: the explicit choice is the only writer.
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'es', 'the boot is Spanish');
  assert.equal((await page.locator('.kindling-head').first().textContent()).trim(), 'La forja ofrece un rescoldo', 'the kernel narrates Spanish');
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), null, 'and the choice is NOT written yet');
  // The pre-step still asks: the default is the browser's guess, not the player's voice.
  await page.waitForSelector('#tour-layer .tour-card', { timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => window.__dlb.tour()), { open: true, step: -1 }, 'the language pre-step is up');
  assert.equal(await page.getByRole('button', { name: 'Español' }).count(), 1, 'and it offers the native Spanish button');
  assert.equal(await page.locator('.tour-lang[aria-pressed="true"]').textContent(), 'Español', 'the pressed default is the browser guess');

  // Confirming the default with Next persists it — and only now does the key exist.
  await page.locator('.tour-next').click();
  await page.waitForFunction(() => window.__dlb.tour().step === 0, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), 'es', 'the explicit confirmation wrote the key');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('tour: every exit from the language step persists — Next confirms the default, Escape writes it too', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const errors = [];

  // (a) NEXT with nothing picked confirms the browser default (en-US → English) and
  // advances: the key appears the moment the pre-step is left.
  let page = await freshTourPage(t);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#tour-layer .tour-card', { timeout: 5000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), null, 'nothing written while the pre-step stands');
  await page.locator('.tour-next').click();
  await page.waitForFunction(() => window.__dlb.tour().step === 0, null, { timeout: 5000 });
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 1 of 6', 'Next advanced to the heroes step');
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), 'en', 'Next persisted the en-US default');
  await page.close();

  // (b) ESCAPE on the pre-step dismisses the whole tour AND persists — no exit leaves
  // the choice unwritten, so the pre-step can never nag the same player twice.
  page = await freshTourPage(t);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#tour-layer .tour-card', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__dlb.tour().open === false, null, { timeout: 5000 });
  assert.equal(await page.locator('.tour-card').count(), 0, 'Escape closed the pre-step');
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), 'en', 'the Escape exit persisted the default too');
  const flags = await page.evaluate(() => [localStorage.getItem('dlb.tourSeen.v1'), localStorage.getItem('dlb.helpSeen.v1')]);
  assert.deepEqual(flags, ['1', '1'], 'and wrote both onboarding flags as any dismissal does');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('tour: the language card stays centred and every control click-reachable with motion normal', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const errors = [];
  // Motion NORMAL: the .tour-card entrance animation runs, and its `to { transform: none }`
  // keyframe (fill-mode 'both') overrides an inline transform for the card's whole life —
  // review round 1 measured the inline translateX(-50%) stomped, the bottom-centre card
  // hung 125px off the right edge at 390x844 (left 195 + width 320 = 515 > 390) and
  // 'English'/'Next' were unreachable by click. The centring is now a computed pixel
  // `left`, a property the keyframes never touch, so the resting geometry below must hold
  // in every band INCLUDING the desktop one (the reduce default here hides the bug).
  for (const [width, height] of [[1280, 800], [390, 844], [640, 460]]) {
    const page = await freshTourPage(t, { width, height, reduce: false });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForSelector('#tour-layer .tour-card', { timeout: 5000 });
    await sleep(400); // the 0.24s entrance is over; the RESTING geometry is what must hold
    const geo = await page.evaluate(() => {
      const r = document.querySelector('.tour-card').getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, vw: window.innerWidth, vh: window.innerHeight };
    });
    assert.ok(geo.left >= 0 && geo.right <= geo.vw, `${width}x${height}: the card is fully inside the viewport (${JSON.stringify(geo)})`);
    assert.ok(Math.abs(geo.left - (geo.vw - geo.width) / 2) < 1, `${width}x${height}: the card is centred (${JSON.stringify(geo)})`);
    // Click-reachable, not just visible: elementFromPoint at each control's centre
    // returns the control itself — the round-1 complaint was 'English' and 'Next' off
    // the viewport, leaving only keyboard paths on a phone.
    const hit = await page.evaluate(() => {
      const probe = (btn) => {
        const r = btn.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return at === btn || btn.contains(at);
      };
      const langs = [...document.querySelectorAll('.tour-lang')];
      const next = document.querySelector('.tour-next');
      const skip = document.querySelector('.tour-skip');
      return { langCount: langs.length, langs: langs.map(probe), next: next ? probe(next) : false, skip: skip ? probe(skip) : false };
    });
    assert.equal(hit.langCount, 2, `${width}x${height}: both native language buttons render`);
    assert.ok(hit.langs.every(Boolean), `${width}x${height}: 'Español' and 'English' are hit-testable at their centres`);
    assert.ok(hit.next, `${width}x${height}: Next is hit-testable at its centre`);
    assert.ok(hit.skip, `${width}x${height}: Skip is hit-testable at its centre`);
    await page.close();
  }
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('tour: taking a boon under the still-open language pre-step persists the default and follows the phase', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshTourPage(t);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#tour-layer .tour-card', { timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => window.__dlb.tour()), { open: true, step: -1 }, 'the pre-step is up');

  // The kindling screen under the pre-step dims NOTHING, so the player may act on it
  // without choosing a language first — §3.5: that act is another exit from the pre-step
  // (it persists the current default) and the tour FOLLOWS the phase, the same
  // player's-hands jump the six steps ride.
  await page.locator('button.boon').first().click();
  await page.waitForFunction(() => window.__dlb.tour().step === 2, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), 'en', 'the exit through an act persisted the en-US default');
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 3 of 6', 'the tour landed on the map step');
  assert.ok(await page.evaluate(() => !!document.querySelector('.map')), 'the map is on stage');
  assert.equal(await page.locator('.tour-shade').count(), 4, 'the ring re-anchored to the map');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('tour: the steps advance by click and keyboard, follow the phase, and a shade click writes both flags', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshTourPage(t);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#tour-layer .tour-card', { timeout: 5000 });

  // The language pre-step stands first (the language ask): Next confirms the en-US
  // default and lands the heroes step — from there the walk is the shipped six.
  await page.locator('.tour-next').click();
  await page.waitForFunction(() => window.__dlb.tour().step === 0, null, { timeout: 5000 });
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 1 of 6', 'the confirmed default lands the heroes step');

  // Heroes → kindling by Next: the destination step shares the kindling phase, so the
  // button exists and the phase gate lets it through.
  await page.locator('.tour-next').click();
  await page.waitForFunction(() => window.__dlb.tour().step === 1, null, { timeout: 5000 });
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 2 of 6', 'Next advanced inside the phase');

  // Review round 2 (1): the kindling step has NO Next — its way forward is the boon —
  // and carries the hint line instead. Back still exists (its destination, the heroes
  // step, shares the phase), and Enter is a no-op here: the phase gate holds for the
  // keyboard too.
  assert.equal(await page.locator('.tour-next').count(), 0, 'no Next on the kindling step: taking the boon is the way on');
  assert.equal((await page.locator('.tour-hint').first().textContent()).trim(), 'Take a boon to continue — the tour follows.', 'the kindling hint is on the card');
  assert.equal(await page.locator('.tour-back').count(), 1, 'Back exists: the heroes step shares the kindling phase');
  await page.keyboard.press('Enter');
  await sleep(250);
  assert.equal(await page.evaluate(() => window.__dlb.tour().step), 1, 'Enter is a no-op where the way forward is the action');

  // Keyboard parity inside the phase: ← back to the heroes step, → forward again.
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => window.__dlb.tour().step === 0, null, { timeout: 5000 });
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 1 of 6', 'ArrowLeft stepped back');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.__dlb.tour().step === 1, null, { timeout: 5000 });

  // Review round 1 of the rework: Enter on a focused card BUTTON activates THAT button
  // natively — the guard used to preventDefault it and run tourNext instead, so Enter
  // on Back stepped FORWARD. Here tourNext would be a phase-gate no-op anyway, so the
  // paths were indistinguishable until this assertion: Back must run, step 0 follows.
  await page.locator('.tour-back').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__dlb.tour().step === 0, null, { timeout: 5000 });
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 1 of 6', 'Enter on the focused Back ran Back, not tourNext');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.__dlb.tour().step === 1, null, { timeout: 5000 });

  // Kindling → map BY DOING: the anchored .boon-list is the clickable region, so a real
  // boon click through the hole both takes the gift and lands the tour on the map step.
  await page.locator('button.boon').first().click();
  await page.waitForFunction(() => window.__dlb.tour().step === 2, null, { timeout: 5000 });
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 3 of 6', 'the tour followed the phase to the map');
  assert.ok(await page.evaluate(() => !!document.querySelector('.map')), 'the map is on stage');
  assert.equal(await page.locator('.tour-shade').count(), 4, 'the ring re-anchored to the map');

  // Review round 2 (2): the map step has neither Next nor Back — both neighbours live
  // on other screens — only the hint and Skip.
  assert.equal(await page.locator('.tour-next').count(), 0, 'no Next on the map step: travelling is the way on');
  assert.equal(await page.locator('.tour-back').count(), 0, 'no Back on the map step: the kindling step is another screen');
  assert.equal((await page.locator('.tour-hint').first().textContent()).trim(), 'Travel to a glowing node to continue — the tour follows.', 'the map hint is on the card');

  // Mid-tour the keyboard is the tour's: d stacks no sheet, n discards no run.
  const before = await page.evaluate(() => {
    const s = window.__dlb.snapshot();
    return { seed: s.seed, step: s.stepIndex, phase: s.phase };
  });
  await page.keyboard.press('d');
  await sleep(300);
  assert.equal(await page.locator('.modal').count(), 0, 'd is swallowed mid-tour');
  await page.keyboard.press('n');
  await sleep(300);
  const afterKeys = await page.evaluate(() => {
    const s = window.__dlb.snapshot();
    return { seed: s.seed, step: s.stepIndex, phase: s.phase };
  });
  assert.deepEqual(afterKeys, before, 'n did not touch the run behind the shades');

  // A SHADE CLICK dismisses for good (the .modal-back click-through convention): both
  // onboarding flags, the layer empty, and the keyboard released (d opens the deck
  // sheet again). The click goes to the viewport's bottom-right corner — the bottom
  // shade's own ground, which no card placement reaches (desktop parks it left of
  // W-28, the small bands bottom at H-8) — because the card deliberately sits ON a
  // shade band and a shade element's centre can be under it. Escape's dismissal is
  // test 5's; Skip's is test 3's; Done's is test 4's.
  await page.mouse.click(1275, 795);
  await page.waitForFunction(() => window.__dlb.tour().open === false, null, { timeout: 5000 });
  assert.equal(await page.locator('.tour-card').count(), 0, 'the layer is empty after the shade click');
  const flags = await page.evaluate(() => [localStorage.getItem('dlb.tourSeen.v1'), localStorage.getItem('dlb.helpSeen.v1')]);
  assert.deepEqual(flags, ['1', '1'], 'dismissal wrote BOTH onboarding flags');
  await page.keyboard.press('d');
  await sleep(300);
  assert.equal(await page.locator('.modal.deck-modal').count(), 1, 'the released d opens the deck sheet');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('tour: a dismissed tour never auto-opens again, and the Help sheet carries the Replay entry', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshTourPage(t, { flags: { 'dlb.tourSeen.v1': '1', 'dlb.helpSeen.v1': '1' } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // A veteran boots twice: no tour card, and the retired auto-Help opens nothing. This
  // veteran has NO dlb.lang either — and still nothing asks (the language ask: replay
  // and veterans are past onboarding; only a fresh boot meets the language pre-step).
  assert.equal(await page.locator('.tour-card').count(), 0, 'no tour on a veteran boot');
  assert.equal(await page.locator('.modal').count(), 0, 'no auto Help either');
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), null, 'and no language was written for them');
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await sleep(300);
  assert.equal(await page.locator('.tour-card').count(), 0, 'still no tour on the second boot');
  assert.equal(await page.locator('.modal').count(), 0, 'and no auto Help on it');

  // The way back in: the Help sheet footer's Replay entry.
  await page.getByRole('button', { name: 'Help' }).click();
  await page.waitForSelector('.modal', { timeout: 3000 });
  const replay = page.getByRole('button', { name: 'Replay the guided tour' });
  assert.equal(await replay.count(), 1, 'the Replay button is in the Help footer');
  const before = await page.evaluate(() => {
    const s = window.__dlb.snapshot();
    return { seed: s.seed, step: s.stepIndex, phase: s.phase };
  });
  await replay.click();
  await page.waitForFunction(() => window.__dlb.tour().open === true, null, { timeout: 5000 });
  assert.equal(await page.locator('.modal').count(), 0, 'the sheet closed behind the tour');
  // findIndex takes the FIRST kindling match: the heroes step, the run's first decision —
  // NEVER the language pre-step (the language ask: a replay never re-asks).
  assert.deepEqual(await page.evaluate(() => window.__dlb.tour()), { open: true, step: 0 }, 'the tour opened at the heroes step for the kindling phase');
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 1 of 6', 'the card reads the first step');
  const afterReplay = await page.evaluate(() => {
    const s = window.__dlb.snapshot();
    return { seed: s.seed, step: s.stepIndex, phase: s.phase };
  });
  assert.deepEqual(afterReplay, before, 'replaying moved nothing in the run');

  // SKIP dismisses the replayed tour; the flags it rewrites keep their value.
  // (Escape's dismissal is test 5's; a shade click's is test 2's.)
  await page.locator('.tour-skip').click();
  await page.waitForFunction(() => window.__dlb.tour().open === false, null, { timeout: 5000 });
  const flags = await page.evaluate(() => [localStorage.getItem('dlb.tourSeen.v1'), localStorage.getItem('dlb.helpSeen.v1')]);
  assert.deepEqual(flags, ['1', '1'], 'the flags are unchanged');

  // The same Skip by KEYBOARD (review round 1 of the rework): Enter on the focused Skip
  // activates IT natively — the guard used to run tourNext there, which on the heroes
  // step moved the tour on (step 1) instead of ever dismissing.
  await page.getByRole('button', { name: 'Help' }).click();
  await page.waitForSelector('.modal', { timeout: 3000 });
  await page.getByRole('button', { name: 'Replay the guided tour' }).click();
  await page.waitForFunction(() => window.__dlb.tour().open === true, null, { timeout: 5000 });
  await page.locator('.tour-skip').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__dlb.tour().open === false, null, { timeout: 5000 });
  const flags2 = await page.evaluate(() => [localStorage.getItem('dlb.tourSeen.v1'), localStorage.getItem('dlb.helpSeen.v1')]);
  assert.deepEqual(flags2, ['1', '1'], 'the keyboard Skip rewrote the same flags');
  assert.equal(await page.evaluate(() => localStorage.getItem('dlb.lang')), null, 'and the replay wrote no language either');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('tour: the combat steps anchor the hand, the intent row and End Turn, and finishing releases the keyboard', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshTourPage(t);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#tour-layer .tour-card', { timeout: 5000 });

  // The language pre-step first (the language ask): Next confirms the en-US default —
  // the full six-step flow still works after the choice.
  await page.locator('.tour-next').click();
  await page.waitForFunction(() => window.__dlb.tour().step === 0, null, { timeout: 5000 });

  // Heroes → kindling by Next, then kindling → map BY DOING (the boon click through its
  // hole), then the map's own hole is the clickable region: travel to the first ordinary
  // fight through it.
  await page.locator('.tour-next').click();
  await page.waitForFunction(() => window.__dlb.tour().step === 1, null, { timeout: 5000 });
  await page.locator('button.boon').first().click();
  await page.waitForFunction(() => window.__dlb.tour().step === 2, null, { timeout: 5000 });
  await travelToFight(page);

  // The tour jumped to the combat's first step and rings the hand.
  await page.waitForFunction(() => window.__dlb.tour().step === 3, null, { timeout: 5000 });
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 4 of 6', 'the hand step is up');
  assert.equal(await page.locator('.tour-shade').count(), 4, 'the ring is up');
  // Review round 2 (3): no Back on the hand step — its previous step lives on the map
  // screen — while Next exists (the intent step shares the combat).
  assert.equal(await page.locator('.tour-back').count(), 0, 'no Back on the hand step: the map step is another screen away');
  let ring = await tourRing(page, '.hand');
  assert.ok(ring.anchorClear, 'the hand sits in the ring hole');
  assert.ok(ring.cornerShaded, 'everything outside the hole is dimmed by the shades');

  // Next chains the shared-combat steps: hand → intent → endTurn → Done.
  await page.locator('.tour-next').click();
  await page.waitForFunction(() => window.__dlb.tour().step === 4, null, { timeout: 5000 });
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 5 of 6', 'the intent step is up');
  assert.ok(await page.evaluate(() => !!document.querySelector('.e-intent')), 'the intent row is painted');
  ring = await tourRing(page, '.e-intent');
  assert.ok(ring.anchorClear, 'the intent row sits in the ring hole');
  await page.locator('.tour-next').click();
  await page.waitForFunction(() => window.__dlb.tour().step === 5, null, { timeout: 5000 });
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 6 of 6', 'the End Turn step is up');
  const endTurnBtn = page.locator('.controls button', { hasText: 'End Turn' });
  assert.equal(await endTurnBtn.count(), 1, 'End Turn is on stage');
  ring = await tourRing(page, '.controls');
  assert.ok(ring.anchorClear, 'the controls row sits in the ring hole');

  // Done dismisses; End Turn by its own muscle-memory key works immediately.
  await page.locator('.tour-next').click();
  await page.waitForFunction(() => window.__dlb.tour().open === false, null, { timeout: 5000 });
  const turnBefore = (await readState(page)).turn;
  await page.keyboard.press('e');
  await waitIdle(page);
  const turnAfter = (await readState(page)).turn;
  assert.equal(turnAfter, turnBefore + 1, 'End Turn passed the turn right after the tour closed');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('tour: the coach card parks and stays legible in the small bands', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const errors = [];
  for (const [width, height] of [[390, 844], [700, 440]]) {
    const page = await freshTourPage(t, { width, height });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForSelector('#tour-layer .tour-card', { timeout: 5000 });
    // The language pre-step parks bottom-centre, fully on screen, and dims NOTHING —
    // the kindling screen under it must stay readable in both bands.
    assert.equal(await page.locator('.tour-shade').count(), 0, `${width}x${height}: the pre-step ring is absent`);
    let parked = await page.evaluate(() => {
      const r = document.querySelector('.tour-card').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: window.innerHeight };
    });
    assert.ok(parked.top >= 0 && parked.bottom <= parked.vh, `${width}x${height}: the pre-step card is fully on screen`);
    // Choosing English lands the heroes step: the ring is up and the parked card never
    // covers its own anchor (AC7) — the boot step is the heroes one, so the anchor is
    // the hero+path union (measured this round: the bottom band clears it at 390x844
    // and 700x440 alike).
    await page.getByRole('button', { name: 'English' }).click();
    await page.waitForFunction(() => window.__dlb.tour().step === 0, null, { timeout: 5000 });
    assert.equal(await page.locator('.tour-shade').count(), 4, `${width}x${height}: the ring is up`);
    parked = await page.evaluate(() => {
      const r = document.querySelector('.tour-card').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: window.innerHeight };
    });
    assert.ok(parked.top >= 0 && parked.bottom <= parked.vh, `${width}x${height}: the card is fully on screen`);
    assert.ok(await tourCardClearOfAnchor(page, ['.hero-select', '.biome-select']), `${width}x${height}: the card never covers the union anchor`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__dlb.tour().open === false, null, { timeout: 5000 });
  }
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('tour: taking a boon under the open tour lands the map step anchored to the map', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshTourPage(t);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#tour-layer .tour-card', { timeout: 5000 });

  // The language pre-step first (the language ask): Next confirms the en-US default.
  await page.locator('.tour-next').click();
  await page.waitForFunction(() => window.__dlb.tour().step === 0, null, { timeout: 5000 });

  // The real player's bug, pinned (review round 2): an action step parks the tour on
  // the player's act, and the act's own repaint must land the tour on the NEXT screen's
  // first step — never a stale card over the old screen, never a ringless card.
  await page.locator('.tour-next').click();
  await page.waitForFunction(() => window.__dlb.tour().step === 1, null, { timeout: 5000 });
  await page.locator('button.boon').first().click();
  await page.waitForFunction(() => window.__dlb.tour().step === 2, null, { timeout: 5000 });
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 3 of 6', 'the map step is up');
  assert.ok(await page.evaluate(() => !!document.querySelector('.map')), 'the map screen is what the card sits over');
  const ring = await tourRing(page, '.map');
  assert.ok(ring.anchorClear, 'the map sits in the ring hole');
  assert.ok(ring.cornerShaded, 'the ring is real, not a parked card');
  assert.equal(await page.locator('.tour-next').count(), 0, 'the map step waits on the player again');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

test('tour: Replay from the map lands on the map step', { timeout: 120000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshTourPage(t, { flags: { 'dlb.tourSeen.v1': '1', 'dlb.helpSeen.v1': '1' } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // A veteran climbs to the map (nothing auto-opens for them), then replays from THERE:
  // startTour resolves the standing phase to its OWN first step — the map step, not a
  // kindling lecture.
  await page.locator('button.boon').first().click();
  await page.waitForSelector('button[aria-label^="Travel to"]', { timeout: 5000 });
  await page.getByRole('button', { name: 'Help' }).click();
  await page.waitForSelector('.modal', { timeout: 3000 });
  await page.getByRole('button', { name: 'Replay the guided tour' }).click();
  await page.waitForFunction(() => window.__dlb.tour().open === true, null, { timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => window.__dlb.tour()), { open: true, step: 2 }, 'the map phase resolves to its own first step');
  assert.equal((await page.locator('.tour-count').first().textContent()).trim(), 'Step 3 of 6', 'the card reads the map step');
  const ring = await tourRing(page, '.map');
  assert.ok(ring.anchorClear, 'the map sits in the ring hole');
  assert.equal(await page.locator('.modal').count(), 0, 'the sheet closed behind the tour');
  assert.equal(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
});

/* ------------------------------------------------------------ the defeat sequence --
 * A defeat that arrives on the enemy turn must be SEEN: the held fight, the killing
 * turn's beats, the hero's death, THEN the panel (the old shape painted the panel on
 * the very next frame). The walks below sample the live page with an in-page 40ms
 * collector — the whole sequence is transient and round-trip polling would miss it. */

/** End-turn loop until the run ends. `seed` 3 dies to pure end turns (verified walk:
 *  floor-1 Kiln Mites out-damage a hero who never plays a card); no exact turn is
 *  pinned — the loop reads the kernel's own phase, so a redraw cannot break it. */
async function endTurnUntilEnded(page, maxTurns = 60) {
  for (let guard = 0; guard < maxTurns; guard += 1) {
    const st = await readState(page);
    if (st.phase === 'ended') return st;
    if (st.phase !== 'combat') assert.fail(`unexpected phase ${st.phase} before the defeat`);
    await endTurn(page);
  }
  assert.fail('the walk never died within the turn budget');
}

/** The defeat-sequence collector: samples hold/death/panel/busy/named floats every
 *  40ms and records the first-seen time of each, so the ORDER (stage held, hero dies,
 *  panel last) is assertable from inside the page. `busyInHold` counts the UX-5 gate's
 *  own samples INSIDE the held window ([holdFirst, panelFirst)) — the walk's ordinary
 *  turns also leave busy>0 (deal clocks), so only the in-sequence count proves the gate
 *  covered the defeat itself. */
async function armDefeatCollector(page) {
  await page.evaluate(() => {
    window.__defeat = {
      hold: 0, holdFirst: 0, death: 0, deathFirst: 0, deathAnim: null,
      panel: 0, panelFirst: 0, floatInHold: 0, busy: 0, busyInHold: 0, t0: performance.now(),
    };
    window.__defeatTimer = setInterval(() => {
      const d = window.__defeat;
      const now = performance.now() - d.t0;
      const stage = document.getElementById('stage');
      const hold = Boolean(stage && stage.querySelector('.ended-hold') && stage.querySelector('.stage-combat .fight .hero'));
      if (hold) { d.hold += 1; if (!d.holdFirst) d.holdFirst = now; }
      const death = stage && stage.querySelector('.hero .fig.is-hero-death');
      if (death) {
        d.death += 1;
        if (!d.deathFirst) d.deathFirst = now;
        if (!d.deathAnim) { try { d.deathAnim = getComputedStyle(death).animationName; } catch { /* sampling only */ } }
      }
      const panel = Boolean(document.querySelector('.page-end .big-title.loss'));
      if (panel) { d.panel += 1; if (!d.panelFirst) d.panelFirst = now; }
      if (hold && document.querySelector('#fx-layer .efloat-named')) d.floatInHold += 1;
      if (window.__dlb.busy()) {
        d.busy += 1;
        // In-sequence only: the hold is up and the panel has not replaced it yet.
        if (hold && !panel) d.busyInHold += 1;
      }
    }, 40);
  });
}

async function readDefeatCollector(page) {
  return page.evaluate(() => { clearInterval(window.__defeatTimer); return window.__defeat; });
}

test('defeat: the killing turn plays on the held stage, the hero dies, then the panel', { timeout: 240000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t, 3);
  await bootToMap(page);
  await travelToFight(page);
  await armDefeatCollector(page);

  const st = await endTurnUntilEnded(page);
  assert.equal(st.player.hp, 0, 'the walk died to pure end turns');
  assert.equal(await page.evaluate(() => window.__dlb.snapshot().ended.outcome), 'loss', 'the run ended in defeat');

  await page.waitForSelector('.page-end .big-title.loss', { timeout: 15000 });
  // The selector resolves in the very frame the panel paints; one collector tick must
  // run after it, or the last sample predates the panel and d.panel stays 0.
  await sleep(120);
  const d = await readDefeatCollector(page);
  // The held stage: the fight exactly as it stood, painted across the whole sequence —
  // never an empty stage (AC-5.6), never the panel first.
  assert.ok(d.hold > 0, 'the held combat stage must be painted after the kernel flips to ended');
  // The killing turn PLAYED: named damage floats over the held hero (fx.js's
  // enemy-turn beats, placed by heroLane on the held stage).
  assert.ok(d.floatInHold > 0, 'the killing blow must play its named damage float over the held hero');
  // The hero's death beat: the figure carries its death class and the hero-death
  // animation (the collapse-and-dissolve; the hurt flinch rides the same figure).
  assert.ok(d.death > 0, 'the hero death figure must be visible during the hold');
  assert.ok(d.deathAnim && d.deathAnim.includes('hero-death'), `the death animation must be hero-death, got "${d.deathAnim}"`);
  // The panel arrives AFTER the sequence, and the UX-5 gate covered it.
  assert.ok(d.panel > 0, 'the defeat panel must arrive');
  assert.ok(d.panelFirst > d.holdFirst, `the panel must arrive after the held stage (panel ${d.panelFirst}ms vs hold ${d.holdFirst}ms)`);
  assert.ok(d.panelFirst > d.deathFirst, `the panel must arrive after the death beat (panel ${d.panelFirst}ms vs death ${d.deathFirst}ms)`);
  // In-sequence only: the collector also samples the walk's ordinary turns, where the
  // deal clocks alone would keep busy>0 — the held window's own samples are the proof.
  assert.ok(d.busyInHold > 0, `the UX-5 gate must be engaged across the held sequence (busyInHold=${d.busyInHold})`);
  // The input gate is RELEASED once the panel is up (busyReason fell with the plan).
  await waitIdle(page);
});

test('defeat: reduced motion goes straight to the panel, no hold, no death beat', { timeout: 240000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t, 3, true);
  await bootToMap(page);
  await travelToFight(page);
  await armDefeatCollector(page);

  const st = await endTurnUntilEnded(page);
  assert.equal(st.player.hp, 0, 'the walk died to pure end turns');
  await page.waitForSelector('.page-end .big-title.loss', { timeout: 15000 });
  await sleep(120); // everything is instant under reduce: let the collector tick once
  const d = await readDefeatCollector(page);
  assert.ok(d.panel > 0, 'the defeat panel arrives at once');
  assert.equal(d.hold, 0, 'reduced motion must never paint the defeat hold');
  assert.equal(d.death, 0, 'reduced motion must never paint the hero death beat');
});

test('defeat: the speed dock skip cuts the hold short like every other hold', { timeout: 240000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t, 3);
  await bootToMap(page);
  await travelToFight(page);
  await armDefeatCollector(page);

  // Walk by raw clicks (no waitIdle AFTER the click — the killing turn's gate holds
  // until the whole sequence is over, and » must land DURING it): after each click,
  // peek briefly for the hold; a normal turn simply times the peek out.
  for (let guard = 0; guard < 60; guard += 1) {
    const st = await readState(page);
    if (st.phase === 'ended') break;
    if (st.phase !== 'combat') assert.fail(`unexpected phase ${st.phase}`);
    await waitIdle(page);
    await page.locator('button', { hasText: 'End Turn' }).click();
    let killed = false;
    try {
      await page.waitForSelector('.stage-combat .ended-hold', { timeout: 900, state: 'attached' });
      killed = true;
    } catch { /* an ordinary turn — keep walking */ }
    if (killed) break;
  }
  // The hold is up (same paint as the phase flip); » retires the plan and repaints —
  // the panel replaces the held stage at once instead of after the turn-plus-death wait.
  await page.waitForSelector('.stage-combat .ended-hold', { timeout: 5000 });
  const skip = page.locator('.speed-btn', { hasText: '»' });
  assert.equal(await skip.count(), 1, 'the hold paints its own speed dock');
  await skip.click();
  await page.waitForSelector('.page-end .big-title.loss', { timeout: 3000 });
  await sleep(120); // the selector resolves in the paint frame; let one collector tick run
  const d = await readDefeatCollector(page);
  assert.ok(d.hold > 0, 'the hold existed (if only briefly) before the skip');
  assert.ok(d.panelFirst - d.holdFirst < 2500,
    `the skipped panel must arrive at once (hold→panel ${Math.round(d.panelFirst - d.holdFirst)}ms, under the ~4s unskipped wait)`);
});

test('defeat rework leaves the victory kill-hold intact', { timeout: 240000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  // Seed 1: a single 43-HP Jaw Worm — two Mauls kill it on turn 2 (the same shape the
  // older kill walk pins, replayed here as the defeat work's own regression guard).
  const page = await freshPage(t, 1);
  await bootToMap(page);
  await injectMaulDeck(page);
  await travelToFight(page);
  await armDefeatCollector(page);

  let s = await readState(page);
  if (!s.hand.some((c) => c.cardId === 'bludgeon')) {
    await endTurn(page);
    s = await readState(page);
    assert.ok(s.hand.some((c) => c.cardId === 'bludgeon'), 'no Maul dealt in two hands');
  }
  await playCard(page, 'Maul');
  await endTurn(page);
  await playCard(page, 'Maul');

  let reward = null;
  for (let i = 0; i < 40 && !reward; i += 1) {
    await sleep(350);
    const st = await readState(page);
    if (st.phase === 'reward') reward = st;
  }
  assert.ok(reward, 'the killing stroke resolves into the reward phase');
  await page.waitForSelector('button[data-action]', { timeout: 5000 });
  await sleep(120); // the selector resolves in the paint frame; let one collector tick run
  const d = await readDefeatCollector(page);
  assert.ok(d.hold > 0, 'the victory kill-hold must still paint the held stage');
  assert.ok(d.panel === 0 || d.panelFirst > d.holdFirst,
    'the spoils panel must not precede the held stage');
});
