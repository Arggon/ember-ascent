#!/usr/bin/env node
// tools/dev/shoot.mjs — drive the real browser over CDP and capture real screenshots.
//
// WHY THIS EXISTS: the browser tool refuses localhost (`browser_private_target_denied`) and
// there is no display server, so every visual claim in this project had been checked only by
// static proxy — "no layout-affecting property is animated" instead of "it does not move".
// Chromium IS installed here, and it renders headlessly, so the visuals can finally be
// verified for real. This also produces the itch.io page's screenshots, which only a browser
// can make.
//
// ZERO dependencies: Chromium's DevTools Protocol is a WebSocket, and Node 24 ships a global
// WebSocket. No Playwright, no Puppeteer, no npm install.
//
// Usage: node tools/dev/shoot.mjs [--base URL] [--out DIR] [--only NAME]
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const BASE = arg('--base', 'http://localhost:5173/web/');
const OUT = resolve(ROOT, arg('--out', 'shots'));
const ONLY = arg('--only', null);
// `--size WxH` captures at a phone or tablet viewport instead of the desktop default.
const SIZE = (() => {
  const raw = arg('--size', null);
  if (!raw) return { w: 1280, h: 800, mobile: false, tag: '' };
  const [w, h] = raw.split('x').map(Number);
  return { w, h, mobile: w <= 500, tag: `-${w}x${h}` };
})();
const PORT = 9333;
const PROFILE = '/tmp/dlb-cdp-profile';

mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ CDP plumbing */

let nextId = 1;
function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const events = [];
    ws.addEventListener('open', () => res({
      send(method, params = {}, sessionId) {
        const id = nextId++;
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        return new Promise((resolve) => pending.set(id, resolve));
      },
      events,
      close: () => ws.close(),
    }));
    ws.addEventListener('error', rej);
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      else if (msg.method) events.push(msg);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chrome writes its WS endpoint to stderr; wait for it. */
async function launch() {
  if (existsSync(PROFILE)) rmSync(PROFILE, { recursive: true, force: true });
  const child = spawn('chromium', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=1280,800', 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let wsUrl = null;
  const wantUrl = new Promise((res, rej) => {
    const onData = (buf) => {
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(buf));
      if (m) { wsUrl = m[1]; res(wsUrl); }
    };
    child.stderr.on('data', onData);
    child.stdout.on('data', onData);
    child.on('exit', (code) => rej(new Error(`chromium exited early (${code})`)));
    setTimeout(() => rej(new Error('timed out waiting for the DevTools endpoint')), 25000);
  });
  await wantUrl;
  return { child, wsUrl };
}

/* ----------------------------------------------------------------- the moments */

/** Drive the game to a specific, real moment using only real user input. */
const MOMENTS = {
  async 'first-run-help'(pg) {
    // The default first paint: the onboarding panel. Nothing to do.
  },
  async map(pg) {
    await pg.dismissHelp();
  },
  async combat(pg) {
    await pg.dismissHelp();
    await pg.clickText('fight');       // travel into the first node
    await pg.settle();
  },
  async targeting(pg) {
    await pg.dismissHelp();
    // Need a multi-enemy fight; then click an attack card to actually enter targeting, and
    // CONFIRM the pending state rendered before claiming this shot.
    for (let i = 0; i < 120; i += 1) {
      const st = await pg.state();
      if (st.phase === 'combat' && st.enemies > 1) {
        await pg.clickCardNeedingTarget();
        await pg.settle();
        const pending = await pg.evaluate(`!!document.querySelector('.card.awaiting, .target-banner, .cancel-target')`);
        if (pending) return;
      }
      if (st.phase === 'ended') break;
      const moved = await pg.firstAction({ holdTargeting: true });
      if (!moved) break;
      await sleep(120);
    }
    throw new Error('could not enter a multi-enemy targeting state');
  },
  async reward(pg) {
    await pg.dismissHelp();
    // The arrival beats repaint on a timer, so the phase can move under us mid-walk. Settle
    // first, THEN decide, and retry the whole walk if we did not land where we aimed — a
    // mislabelled screenshot is worse than a missing one for a store page.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await pg.settle();
      if ((await pg.state()).phase === 'reward') return;
      for (let i = 0; i < 200; i += 1) {
        const st = await pg.state();
        if (st.phase === 'reward') { await pg.settle(); break; }
        if (st.phase === 'ended') break;
        const moved = await pg.firstAction();
        if (!moved) break;
        await sleep(120);
      }
      await pg.settle();
      if ((await pg.state()).phase === 'reward') return;
    }
    throw new Error('could not reach the reward screen');
  },
  async ended(pg) {
    await pg.dismissHelp();
    // A full run to the end screen, greedy on the first legal action the UI offers.
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      const st = await pg.state();
      if (st.phase === 'ended') { await pg.settle(); return; }
      const moved = await pg.firstAction();
      await sleep(moved ? 60 : 140);
    }
    throw new Error('run did not reach an end screen within the time budget');
  },
};

async function main() {
  const { child, wsUrl } = await launch();
  const cdp = await connect(wsUrl);
  const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).result;
  const S = (m, p) => cdp.send(m, p, sessionId);

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: SIZE.w, height: SIZE.h, deviceScaleFactor: 2, mobile: SIZE.mobile });
  await S('Emulation.setTouchEmulationEnabled', { enabled: SIZE.mobile, maxTouchPoints: SIZE.mobile ? 5 : 1 });

  const evalJs = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' :: ' + expr.slice(0, 80));
    return r.result?.result?.value;
  };

  let holdTargeting = false;

const pg = {
    async goto(url) {
      await S('Page.navigate', { url });
      await sleep(1200);
    },
    async dismissHelp() {
      // The help panel has a "Got it" button; click it if present, else set the flag and reload.
      const clicked = await evalJs(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => /got it/i.test(x.textContent || ''));
        if (b) { b.click(); return true; }
        try { localStorage.setItem('dlb.helpSeen.v1','1'); } catch {}
        return false;
      })()`);
      if (!clicked) { await S('Page.reload'); await sleep(900); await evalJs(`try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{}`); await S('Page.reload'); await sleep(900); }
      await sleep(300);
    },
    async state() {
      return evalJs(`window.__dlbState || (() => {
        const t = document.querySelector('#stage') ? document.querySelector('#stage').innerText : '';
        const enemies = document.querySelectorAll('.enemy').length;
        const phase = /RUN OVER|VICTORY|DEFEAT/.test(t) ? 'ended'
          : /choose a card/i.test(t) ? 'reward'
          : /Rest Site/i.test(t) ? 'rest'
          : enemies > 0 ? 'combat' : 'map';
        return { phase, enemies };
      })()`);
    },
    async firstAction(opts = {}) {
      holdTargeting = !!opts.holdTargeting;
      // Do what a PLAYER does, in the order a player does it. Priority matters: a playable card
      // first, and END TURN when none is playable — omitting that fallback left the walk stuck
      // in combat forever, which looked exactly like a game bug.
      //
      // If a card click opens targeting, resolve it at the first enemy, or the walk stalls with
      // a pending card and nothing playable.
      const r = await evalJs(`(() => {
        if (${JSON.stringify(!holdTargeting)} && document.querySelector('.cancel-target, .target-banner')) {
          const e = document.querySelector('.enemy.targeting') || document.querySelector('.enemy');
          if (e) { e.click(); return 'targeted'; }
        }
        const card = document.querySelector('.card:not(.disabled)');
        if (card) { card.click(); return 'card'; }
        const end = [...document.querySelectorAll('button')].find(b => /end turn/i.test(b.textContent||''));
        if (end) { end.click(); return 'endturn'; }
        const node = document.querySelector('.node.available');
        if (node) { node.click(); return 'travel'; }
        const reward = document.querySelector('.card');
        if (reward) { reward.click(); return 'reward'; }
        const cont = [...document.querySelectorAll('button')].find(b => /continue|rest|move on|skip/i.test(b.textContent||''));
        if (cont) { cont.click(); return 'continue'; }
        return 'none';
      })()`);
      return r !== 'none';
    },
    async clickCardNeedingTarget() {
      return evalJs(`(() => {
        const cards = [...document.querySelectorAll('.card:not(.disabled)')];
        const atk = cards.find(c => /attack/i.test(c.textContent||'')) || cards[0];
        if (!atk) return false;
        atk.click();
        return true;
      })()`);
    },
    async clickText(txt) {
      return evalJs(`(() => {
        const el = [...document.querySelectorAll('.node, button')].find(x => new RegExp(${JSON.stringify(txt)}, 'i').test(x.textContent||''));
        if (!el) return false; el.click(); return true;
      })()`);
    },
    async evaluate(expr) { return evalJs(expr); },
    async settle() { await sleep(1400); },
    async shoot(name, w = SIZE.w, h = SIZE.h) {
      await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
      await sleep(500);
      const r = await S('Page.captureScreenshot', { format: 'png' });
      const data = r.result?.data;
      if (!data) throw new Error('captureScreenshot returned no data');
      await writeFile(resolve(OUT, `${name}${SIZE.tag}.png`), Buffer.from(data, 'base64'));
      return true;
    },
  };

  const VERIFY = !ONLY;
  const targets = ONLY ? [ONLY] : Object.keys(MOMENTS);
  const results = [];

  for (const name of targets) {
    const fn = MOMENTS[name];
    if (!fn) { results.push([name, 'SKIPPED', 'unknown moment']); continue; }
    await pg.goto(`${BASE}?seed=11`);
    try {
      await fn(pg);
      await pg.shoot(name);
      const st = await pg.state();
      results.push([name, 'OK', `${st.phase}, ${st.enemies} enemies`]);
    } catch (e) {
      results.push([name, 'FAIL', String(e.message).slice(0, 90)]);
    }
  }

  // A narrow-window check and the itch.io cover aspect, both from the combat moment.
  if (VERIFY && !SIZE.mobile) {
    await pg.goto(`${BASE}?seed=11`);
    try {
      await MOMENTS.combat(pg);
      await pg.shoot('narrow-820', 820, 900);
      await pg.shoot('cover-630x500', 630, 500);
      results.push(['narrow-820', 'OK', 'see file']);
      results.push(['cover-630x500', 'OK', 'see file']);
    } catch (e) {
      results.push(['narrow/cover', 'FAIL', String(e.message).slice(0, 90)]);
    }
  }

  console.log('\ncapture results:');
  for (const [n, s, d] of results) console.log(`  ${s.padEnd(7)} ${n.padEnd(18)} ${d}`);
  const bad = results.filter(([, s]) => s === 'FAIL').length;
  console.log(`\n${results.length - bad}/${results.length} captured into ${OUT}`);

  cdp.close();
  child.kill('SIGTERM');
  process.exit(bad > 0 ? 2 : 0);
}

main().catch((e) => { console.error('shoot.mjs:', e.message); process.exit(1); });
