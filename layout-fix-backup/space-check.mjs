#!/usr/bin/env node
// tools/dev/space-check.mjs — measure UNUSED space on the pages players actually see.
//
// The owner reported "a lot of black space at the bottom" on a tall phone (Galaxy S25+,
// 412x915). The layout is content-height and top-aligned, so on a tall viewport everything
// piles up under the HUD and the rest of the screen is empty. This measures how much is
// wasted, and whether the hand uses the available width, so a fix can be aimed at numbers.
//
// Usage: node tools/dev/space-check.mjs [--base URL]
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, 'shots/space');
mkdirSync(OUT, { recursive: true });
const PORT = 9343, PROFILE = '/tmp/dlb-space';
const args = process.argv.slice(2);
const bi = args.indexOf('--base');
const BASE = bi === -1 ? 'http://localhost:5173/web/?seed=11' : args[bi + 1];

// Real device CSS viewports. The phone cases are where the complaint came from.
const SIZES = [
  [412, 915, 'galaxy-s25plus'],
  [390, 844, 'iphone-14'],
  [360, 640, 'phone-small'],
  [414, 896, 'phone-large'],
  [768, 1024, 'tablet'],
  [1280, 800, 'desktop'],
  [1366, 768, 'laptop'],
  [1280, 1000, 'desktop-tall'],
];

let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (existsSync(PROFILE)) rmSync(PROFILE, { recursive: true, force: true });
const child = spawn('chromium', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--window-size=1280,800', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const wsUrl = await new Promise((res, rej) => {
  const on = (b) => { const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(b)); if (m) res(m[1]); };
  child.stderr.on('data', on); child.stdout.on('data', on);
  setTimeout(() => rej(new Error('no DevTools endpoint')), 25000);
});
const ws = new WebSocket(wsUrl); const pend = new Map();
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } });
const send = (method, params = {}, sessionId) => {
  const i = id++; ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((r) => pend.set(i, r));
};
const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
const S = (m, p) => send(m, p, sessionId);
await S('Page.enable'); await S('Runtime.enable');
const ev = async (e) => {
  const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

const rows = [];
for (const [w, h, label] of SIZES) {
  const isPhone = w <= 500;
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
  await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
  await S('Page.navigate', { url: BASE });
  await sleep(1300);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url: BASE });
  await sleep(1200);
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`);
  await sleep(1300);

  const m = await ev(`(() => {
    const vh = window.innerHeight, vw = window.innerWidth;
    const app = document.getElementById('app');
    const hand = document.querySelector('.hand');
    const controls = document.querySelector('.controls');
    const hint = document.querySelector('.stage-combat .hint') || document.querySelector('.hint');
    const cards = [...document.querySelectorAll('.card-wrap, .card')].filter(n => n.classList.contains('card-wrap') || n.classList.contains('card'));
    const rect = (e) => e ? e.getBoundingClientRect() : null;
    const rHint = rect(hint), rHand = rect(hand), rCtrl = rect(controls);
    const contentBottom = Math.max(rHint ? rHint.bottom : 0, rCtrl ? rCtrl.bottom : 0, rHand ? rHand.bottom : 0);
    // How much of the hand row's width is actually used by its cards?
    const wraps = [...document.querySelectorAll('.card-wrap')];
    const used = wraps.length ? (wraps[wraps.length-1].getBoundingClientRect().right - wraps[0].getBoundingClientRect().left) : 0;
    const rEnemies = rect(document.querySelector('.enemies'));
    const rHandTop = rect(document.querySelector('.hand'));
    const gap = (rEnemies && rHandTop) ? Math.round(rHandTop.top - rEnemies.bottom) : null;
    return {
      internalGap: gap,
      viewport: [vw, vh],
      appHeight: app ? Math.round(rect(app).height) : null,
      contentBottom: Math.round(contentBottom),
      wastePx: Math.round(vh - contentBottom),
      wastePct: Math.round((vh - contentBottom) / vh * 100),
      handWidth: rHand ? Math.round(rHand.width) : null,
      cardsUsedWidth: Math.round(used),
      handFillPct: rHand ? Math.round(used / rHand.width * 100) : null,
    };
  })()`);
  const shot = await S('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(OUT, `${label}-${w}x${h}.png`), Buffer.from(shot.result.data, 'base64'));
  rows.push([`${w}x${h}`, label, m]);
}

console.log('size         label            viewport      waste   waste%  gap    handW  cardsW  handFill%');
for (const [size, label, m] of rows) {
  console.log(
    size.padEnd(13) + label.padEnd(17) +
    JSON.stringify(m.viewport).padEnd(14) +
    String(m.wastePx + 'px').padEnd(8) +
    String(m.wastePct + '%').padEnd(8) +
    String(m.internalGap + 'px').padEnd(7) +
    String(m.handWidth).padEnd(7) + String(m.cardsUsedWidth).padEnd(8) +
    m.handFillPct + '%',
  );
}
console.log('\nscreenshots in shots/space/');
ws.close(); child.kill('SIGTERM'); process.exit(0);
