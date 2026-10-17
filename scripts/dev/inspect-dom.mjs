#!/usr/bin/env node
// scripts/dev/inspect-dom.mjs — ask the REAL browser for measured facts.
//
// The project's visual claims had been verified only by static proxy ("no layout-affecting
// property is animated") because no browser was reachable. Chromium renders headlessly here,
// so geometry and accessibility facts can be MEASURED instead of assumed. This uses the same
// zero-dependency CDP approach as scripts/dev/shoot.mjs (Node 24 ships WebSocket).
//
// Usage: node scripts/dev/inspect-dom.mjs [--base URL]
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const args = process.argv.slice(2);
const i = args.indexOf('--base');
const BASE = i === -1 ? 'http://localhost:5173/src/web/' : args[i + 1];
const PORT = 9334;
const PROFILE = '/tmp/dlb-inspect-profile';

let nextId = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (existsSync(PROFILE)) rmSync(PROFILE, { recursive: true, force: true });
  const child = spawn('chromium', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=1280,800', 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const wsUrl = await new Promise((res, rej) => {
    const on = (b) => { const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(b)); if (m) res(m[1]); };
    child.stderr.on('data', on); child.stdout.on('data', on);
    setTimeout(() => rej(new Error('no DevTools endpoint')), 25000);
  });

  const ws = new WebSocket(wsUrl);
  const pend = new Map();
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } });
  const send = (method, params = {}, sessionId) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((r) => pend.set(id, r));
  };

  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  const ev = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };

  await S('Page.navigate', { url: `${BASE}?seed=11` });
  await sleep(1500);
  // Dismiss onboarding so the stage is the game.
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{}return true})()`);
  await S('Page.navigate', { url: `${BASE}?seed=11` });
  await sleep(1400);
  // Travel into combat.
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return true})()`);
  await sleep(1400);

  const report = await ev(`(() => {
    const out = {};
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };

    // 1. The hand: are all cards fully on screen at 1280 wide?
    const hand = document.querySelector('.hand');
    const cards = [...document.querySelectorAll('.card')];
    out.hand = { count: cards.length, box: hand ? rect(hand) : null, scrollW: hand ? hand.scrollWidth : null, clientW: hand ? hand.clientWidth : null };
    out.cardRects = cards.map((c) => ({ name: (c.querySelector('.cname')||{}).textContent, ...rect(c) }));
    out.cardsClippedRight = cards.filter((c) => rect(c).right > (hand ? rect(hand).right + 1 : 1280)).map((c) => (c.querySelector('.cname')||{}).textContent);

    // 2. Does anything overflow the viewport horizontally?
    out.docScrollW = document.documentElement.scrollWidth;
    out.viewportW = window.innerWidth;
    out.horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;

    // 3. The token badge: what does it actually say, and why?
    const badge = document.querySelector('.token-badge');
    out.tokenBadge = badge ? badge.innerText.trim() : null;
    out.hasTiktokenImportMap = !!document.querySelector('script[type=importmap]');

    // 4. Accessibility spot-checks.
    out.buttonsWithoutLabel = [...document.querySelectorAll('button')].filter((b) => !(b.getAttribute('aria-label') || (b.textContent||'').trim())).length;
    out.enemies = [...document.querySelectorAll('.enemy')].map((e) => ({ label: e.getAttribute('aria-label'), rect: rect(e) }));

    // 5. Are focus outlines defined for the interactive elements? (computed style check)
    const card = document.querySelector('.card');
    out.cardCursor = card ? getComputedStyle(card).cursor : null;
    out.cardOutlineOnFocus = card ? getComputedStyle(card).outlineStyle : null;

    // 6. Fonts must be system-only.
    out.bodyFont = getComputedStyle(document.body).fontFamily;

    // 7. Any console errors captured as a page-level flag?
    out.hasFxLayer = !!document.getElementById('fx-layer');

    return out;
  })()`);

  console.log(JSON.stringify(report, null, 2));

  ws.close(); child.kill('SIGTERM');
  process.exit(0);
}
main().catch((e) => { console.error('inspect-dom:', e.message); process.exit(1); });
