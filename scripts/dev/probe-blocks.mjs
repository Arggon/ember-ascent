#!/usr/bin/env node
// scripts/dev/probe-blocks.mjs — where does the vertical space actually go?
// Prints the height of each combat-screen block at several viewports so the strategy
// for spending spare height is chosen from measurements, not from taste.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const PORT = 9340 + (process.pid % 100), PROFILE = '/tmp/dlb-probe-blocks-' + process.pid;
const BASE = process.argv[2] || 'http://localhost:5173/src/web/?seed=11';
const SIZES = [
  [412, 915, 'galaxy-s25plus'],
  [360, 640, 'phone-small'],
  [414, 896, 'phone-large'],
  [768, 1024, 'tablet'],
  [1280, 1000, 'desktop-tall'],
  [1280, 800, 'desktop'],
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

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
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
    const card = document.querySelector('.card');
    const cs = card ? getComputedStyle(card) : null;
    const desc = document.querySelector('.card .cdesc');
    const ds = desc ? getComputedStyle(desc) : null;
    const app = document.getElementById('app');
    return {
      vh: window.innerHeight, vw: window.innerWidth,
      app: r('#app'), hud: r('#hud'), stage: r('#stage'),
      combat: r('.stage-combat'),
      title1: r('.stage-combat > .section-title'),
      enemies: r('.enemies'), enemy1: r('.enemy'),
      art: r('.e-art'), intent: r('.e-intent'),
      handTitle: r('.stage-combat > .section-title:nth-of-type(2)'),
      hand: r('.hand'), wrap1: r('.card-wrap'), card1: r('.card'),
      controls: r('.controls'), hint: r('.hint'),
      enemiesGrow: (()=>{const e=document.querySelector('.enemies');return e?getComputedStyle(e).flexGrow:null})(),
      stageGrow: (()=>{const e=document.getElementById('stage');return e?getComputedStyle(e).flexGrow:null})(),
      cardW: card ? Math.round(card.getBoundingClientRect().width) : null,
      cdescFs: ds ? ds.fontSize : null,
      cnameFs: (()=>{const n=document.querySelector('.card .cname');return n?getComputedStyle(n).fontSize:null})(),
      scrollable: document.documentElement.scrollHeight - window.innerHeight,
    };
  })()`);
  console.log(`\n=== ${label} ${w}x${h} (vh ${m.vh}, overflow ${m.scrollable}px, stage grow ${m.stageGrow}) ===`);
  for (const k of ['app', 'hud', 'stage', 'combat', 'title1', 'enemies', 'enemy1', 'art', 'intent', 'hand', 'wrap1', 'card1', 'controls', 'hint']) {
    const v = m[k];
    console.log(`  ${k.padEnd(9)} ${v ? 'top ' + String(v.top).padStart(4) + '  h ' + String(v.h).padStart(4) + '  bottom ' + String(v.bottom).padStart(4) : '—'}`);
  }
  console.log(`  card width ${m.cardW}  cdesc ${m.cdescFs}  cname ${m.cnameFs}`);
}
ws.close(); child.kill('SIGTERM'); process.exit(0);
