#!/usr/bin/env node
// scripts/dev/probe-stage-space.mjs — is there free space INSIDE #stage, and who could use it?
// Answers, per viewport: stage box vs stage content vs .stage-combat, i.e. how much slack the
// stage already has, and how wide a card would be if five shared the hand row.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const PORT = 9340 + (process.pid % 100), PROFILE = '/tmp/dlb-probe-stage-' + process.pid;
const BASE = process.argv[2] || 'http://localhost:5173/web/?seed=11';
const SIZES = [
  [412, 915, 'galaxy-s25plus'], [390, 844, 'iphone-14'], [360, 640, 'phone-small'],
  [414, 896, 'phone-large'], [768, 1024, 'tablet'], [1280, 800, 'desktop'],
  [1280, 1000, 'desktop-tall'], [844, 390, 'phone-landscape'],
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

console.log('label            vw x vh    docH  scroll  appH  stageH  stageCB  combatH  slack  handW  cards  oneRow5  rowsWrap');
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
    const stage = document.getElementById('stage'), app = document.getElementById('app');
    const combat = document.querySelector('.stage-combat'), hand = document.querySelector('.hand');
    const cs = getComputedStyle(stage);
    const stageCB = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const wraps = [...document.querySelectorAll('.card-wrap')];
    const handCs = getComputedStyle(hand);
    const gap = parseFloat(handCs.columnGap) || 0;
    const tops = new Set(wraps.map(x => Math.round(x.getBoundingClientRect().top)));
    return {
      vw: innerWidth, vh: innerHeight,
      docH: document.documentElement.scrollHeight,
      appH: Math.round(app.getBoundingClientRect().height),
      stageH: Math.round(stage.getBoundingClientRect().height),
      stageCB: Math.round(stageCB),
      combatH: Math.round(combat.getBoundingClientRect().height),
      slack: Math.round(stageCB - combat.getBoundingClientRect().height),
      handW: Math.round(hand.clientWidth),
      nCards: wraps.length,
      oneRow5: Math.round((hand.clientWidth - 4 * gap) / 5),
      rows: tops.size,
      gap,
    };
  })()`);
  console.log(
    label.padEnd(17) + `${m.vw}x${m.vh}`.padEnd(11) +
    String(m.docH).padEnd(6) + String(m.docH - m.vh).padEnd(8) +
    String(m.appH).padEnd(6) + String(m.stageH).padEnd(8) + String(m.stageCB).padEnd(9) +
    String(m.combatH).padEnd(9) + String(m.slack).padEnd(7) +
    String(m.handW).padEnd(7) + String(m.nCards).padEnd(7) + String(m.oneRow5).padEnd(9) + m.rows + ` (gap ${m.gap})`,
  );
}
ws.close(); child.kill('SIGTERM'); process.exit(0);
