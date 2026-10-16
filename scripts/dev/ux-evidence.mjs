#!/usr/bin/env node
// scripts/dev/ux-evidence.mjs — capture every game surface for a design review.
//
// The card redesign succeeded by working from real 4x screenshots rather than descriptions.
// This captures EVERY surface at the two viewports that matter (mobile 412x915, desktop
// 1280x900), at high device pixel ratio, plus measured anatomy of the HUD and the enemy card
// so a designer can critique against numbers.
//
// Usage: node scripts/dev/ux-evidence.mjs [--base URL]
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, 'shots/ux');
mkdirSync(OUT, { recursive: true });
const PORT = 9351, PROFILE = '/tmp/dlb-ux';
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
    throw new Error(d.text + ' :: ' + (d.exception?.description || '').slice(0, 200));
  }
  return r.result?.result?.value;
};

async function configure(w, h, dpr, mobile) {
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile });
  if (mobile) await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
async function shot(name) {
  const r = await S('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  console.log(`  wrote ${name}.png`);
}
async function startRun() {
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await sleep(400);
  await S('Page.navigate', { url: BASE });
  await sleep(1400);
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`);
  await sleep(1500);
}

// ---------------------------------------------------------------- MOBILE (priority)
await configure(412, 915, 2, true);
await S('Page.navigate', { url: BASE });
await sleep(1500);
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
await sleep(400);
await S('Page.navigate', { url: BASE });
await sleep(1400);

// m1: HUD close-up, clipped, 2x — the owner's screenshot shows it as four rows.
await startRun();
const hudBox = await ev(`(() => { const r = document.getElementById('hud').getBoundingClientRect();
  return { x: 0, y: 0, width: 412, height: Math.ceil(r.height) + 8, scale: 1 }; })()`);
await shot('m1-hud-412', hudBox);

// m2: enemy card close-up.
const eBox = await ev(`(() => { const e = document.querySelector('.enemy'); const r = e.getBoundingClientRect();
  return { x: Math.max(0, Math.floor(r.x) - 6), y: Math.floor(r.y) - 6, width: Math.ceil(r.width) + 12, height: Math.ceil(r.height) + 12, scale: 1 }; })()`);
await shot('m2-enemy-412', eBox);

// m3: full combat screen.
await shot('m3-combat-412');

// m4: map.
await ev(`(()=>{const a=[...document.querySelectorAll('button')].find(b=>/end turn/i.test(b.textContent||''));if(a)a.click();return 1})()`);
await sleep(1500);
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/continue/i.test(b.textContent||''));if(b)b.click();return 1})()`);
await sleep(1500);
await shot('m4-map-412');

// m5: reward.
await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`);
await sleep(1300);
for (let i = 0; i < 40; i += 1) {
  const t = await ev(`document.querySelector('#stage').innerText`);
  if (/choose a card/i.test(t)) break;
  await ev(`(()=>{const c=document.querySelector('.card:not(.disabled)')||[...document.querySelectorAll('button')].find(b=>/end turn/i.test(b.textContent||''));if(c)c.click();return 1})()`);
  await sleep(160);
}
await sleep(800);
await shot('m5-reward-412');

// m6: help/glossary modal on the phone — long content in a small modal.
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^help$/i.test(x.textContent||''));if(b)b.click();return 1})()`);
await sleep(800);
await shot('m6-help-412');
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();return 1})()`);
await sleep(400);

// -------------------------------------------------------------- desktop (comparison)
await configure(1280, 900, 2, false);
await S('Page.navigate', { url: BASE });
await sleep(1500);
await startRun();
await shot('d1-combat-1280');
const dHud = await ev(`(() => { const r = document.getElementById('hud').getBoundingClientRect();
  return { x: 0, y: 0, width: 1280, height: Math.ceil(r.height) + 8, scale: 1 }; })()`);
await shot('d2-hud-1280', dHud);

// ------------------------------------------------------------ measured anatomy (facts)
await configure(412, 915, 1, true);
await S('Page.navigate', { url: BASE });
await sleep(1400);
await startRun();
const anatomy = await ev(`(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top) }; };
  const hud = document.getElementById('hud');
  const hudKids = [...hud.children].map(el => ({ cls: el.className, ...r(el) }));
  const enemy = document.querySelector('.enemy');
  const enemyKids = enemy ? [...enemy.children].map(el => ({ cls: el.className, ...r(el) })) : [];
  const stage = document.querySelector('#stage');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    hud: { ...r(hud), rows: hudKids.length, kids: hudKids },
    enemy: { ...r(enemy), kids: enemyKids },
    stage: r(stage),
    hudFontSizes: [...hud.querySelectorAll('.stat, .hud-char, .pill')].map(el => getComputedStyle(el).fontSize),
    enemyFonts: enemy ? ['.ename','.ehp','.e-intent .ilabel'].map(sel => ({ sel, px: getComputedStyle(enemy.querySelector(sel)).fontSize })) : [],
  };
})()`);
console.log('\nMOBILE ANATOMY (412x915):');
console.log(JSON.stringify(anatomy, null, 2));
console.log('\nimages in shots/ux/');
ws.close(); child.kill('SIGTERM'); process.exit(0);
