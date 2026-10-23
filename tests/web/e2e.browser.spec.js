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

/** A fresh browser + page with the first-run help dismissed. Caller closes the browser. */
async function freshPage(t) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'no-preference',
  });
  t.after(() => { void browser.close(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {} });
  await page.goto(`${base}/src/web/index.html?seed=7`);
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

/** Take the Bellows Breath kindling (4 Energy/turn) and land on the map. */
async function bootToMap(page) {
  await page.getByRole('button', { name: /^Bellows Breath:/ }).click();
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
 *  fights never qualify, so walk them, skip rewards, and climb until one does. */
async function reachQualifyingFight(page) {
  for (let step = 0; step < 12; step += 1) {
    const s = await readState(page);
    if (s.phase === 'combat') {
      if (s.enemies.length > 1 && s.enemies.some((e) => e.hp > 32)) return s;
      await playOutTransitFight(page);
      continue;
    }
    if (s.phase === 'reward') { await leaveReward(page); continue; }
    if (s.phase === 'map') { await travelToFight(page); continue; }
    await sleep(600);
  }
  assert.fail('no qualifying fight within 12 steps');
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

test('kill: the stroke plays against the hold stage, then the reward arrives', { timeout: 240000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  const page = await freshPage(t);
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

  // Turn 1: Maul (32) leaves the 40-HP Jaw Worm at 8.
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
  // each), then verify the arc on that attempt.
  for (const seed of [7, 8, 9, 10, 11, 12]) {
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
    await twin.first().click(); // single enemy: one click plays it, no targeting
    await sleep(2600);
    return { arc: await page.evaluate(() => window.__arc) };
  } finally {
    await browser.close();
  }
}

test('a killing throw holds the victim in its slot until the hammer lands', { timeout: 300000 }, async (t) => {
  if (!chromium || !base) return t.skip('playwright/chromium unavailable');
  // Probe seeds for a two-enemy first fight where the salvo (5x2) kills the weaker foe.
  for (const seed of [7, 8, 9, 10, 11, 12]) {
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
