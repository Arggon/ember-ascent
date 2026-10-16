#!/usr/bin/env node
// scripts/dev/card-closeup.mjs — capture a large, clear view of the cards for design work.
//
// "Cards are ugly" is a design judgement, and it needs to be made against a real, big image
// rather than a 412px phone screenshot. This renders the combat screen at high device pixel
// ratio and clips to the hand, so the card anatomy (cost gem, type line, name, effect text,
// footer chip) can be critiqued at detail. Also captures a single card in isolation and the
// reward screen, which uses the same tile.
//
// Usage: node scripts/dev/card-closeup.mjs [--base URL]
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, 'shots/design');
mkdirSync(OUT, { recursive: true });
const PORT = 9347, PROFILE = '/tmp/dlb-cardclose';
const args = process.argv.slice(2);
const bi = args.indexOf('--base');
const BASE = bi === -1 ? 'http://localhost:5173/web/?seed=11' : args[bi + 1];

let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (existsSync(PROFILE)) rmSync(PROFILE, { recursive: true, force: true });

const child = spawn('chromium', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--window-size=1280,900', 'about:blank',
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
  if (r.result?.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error(d.text + ' :: ' + (d.exception?.description || d.exception?.value || JSON.stringify(d)).slice(0, 300));
  }
  return r.result?.result?.value;
};

async function shot(name, clip) {
  const r = await S('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  await writeFile(resolve(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  console.log(`  wrote ${name}.png`);
}

// Wide desktop, DPR 2: five full-size cards at high detail.
await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
await S('Page.navigate', { url: BASE });
await sleep(1400);
// Dismiss the first-run help on this load, THEN reload so the game is the only thing on
// screen: the card lookup runs immediately and an overlay would make .card missing.
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
await sleep(500);
await S('Page.navigate', { url: BASE });
await sleep(1500);
// On the map there are no .card elements yet — the hand only exists in combat. Travel FIRST,
// then assert the cards are present.
await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`);
await sleep(1400);
const cardCount = await ev(`document.querySelectorAll('.card').length`);
if (!cardCount) throw new Error('no .card in combat after travel');

// 1. The hand, clipped tight, at 2x.
const handBox = await ev(`(() => {
  const h = document.querySelector('.hand');
  const r = h.getBoundingClientRect();
  return { x: Math.floor(r.x), y: Math.floor(r.y) - 10, width: Math.ceil(r.width), height: Math.ceil(r.height) + 24, scale: 1 };
})()`);
await shot('hand-2x', handBox);

// 2. One card, huge. DPR 4 on a single tile.
await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 4, mobile: false });
await sleep(600);
const oneBox = await ev(`(() => {
  const c = document.querySelector('.card');
  const r = c.getBoundingClientRect();
  return { x: Math.floor(r.x) - 12, y: Math.floor(r.y) - 16, width: Math.ceil(r.width) + 24, height: Math.ceil(r.height) + 32, scale: 1 };
})()`);
await shot('single-card-4x', oneBox);

// 3. Measured anatomy of a card, so the design critique has numbers.
const anatomy = await ev(`(() => {
  const card = document.querySelector('.card');
  const kids = [...card.children].map(el => {
    const r = el.getBoundingClientRect();
    return { cls: el.className, text: (el.textContent||'').trim().slice(0,34), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y - card.getBoundingClientRect().y) };
  });
  const cs = getComputedStyle(card);
  const r = card.getBoundingClientRect();
  return {
    card: { w: Math.round(r.width), h: Math.round(r.height), padding: cs.padding, gap: cs.gap, borderRadius: cs.borderRadius, minHeight: cs.minHeight },
    children: kids,
  };
})()`);
console.log('\ncard anatomy (desktop):');
console.log(JSON.stringify(anatomy, null, 2));
console.log('\nimages in shots/design/');
ws.close(); child.kill('SIGTERM'); process.exit(0);
