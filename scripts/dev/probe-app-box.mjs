#!/usr/bin/env node
// scripts/dev/probe-app-box.mjs — does #app actually fill the viewport on each device?
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
const PORT = 9340 + (process.pid % 100), PROFILE = '/tmp/dlb-probe-appbox-' + process.pid;
const BASE = process.argv[2] || 'http://localhost:5173/src/web/?seed=11';
const SIZES = [[412, 915, 'galaxy'],[390, 844, 'iphone14'],[360, 640, 'small'],[414, 896, 'large'],[768, 1024, 'tablet'],[1280, 800, 'desktop'],[1280, 1000, 'desktop-tall']];
let id = 1; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (existsSync(PROFILE)) rmSync(PROFILE, { recursive: true, force: true });
const child = spawn('chromium', ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--no-first-run',`--remote-debugging-port=${PORT}`,`--user-data-dir=${PROFILE}`,'--window-size=1280,800','about:blank'], { stdio: ['ignore','pipe','pipe'] });
const wsUrl = await new Promise((res, rej) => { const on = (b) => { const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(b)); if (m) res(m[1]); }; child.stderr.on('data', on); child.stdout.on('data', on); setTimeout(() => rej(new Error('no DevTools')), 25000); });
const ws = new WebSocket(wsUrl); const pend = new Map();
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } });
const send = (method, params = {}, sessionId) => { const i = id++; ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); return new Promise((r) => pend.set(i, r)); };
const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
const S = (m, p) => send(m, p, sessionId);
await S('Page.enable'); await S('Runtime.enable');
const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };
console.log('label       vh   innerH visualH htmlCH bodyH appH  appMinH  appPadB  docH  overflow');
for (const [w, h, label] of SIZES) {
  const isPhone = w <= 500;
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
  await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
  await S('Page.navigate', { url: BASE }); await sleep(1300);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url: BASE }); await sleep(1200);
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`); await sleep(1300);
  const m = await ev(`(()=>{const app=document.getElementById('app');const cs=getComputedStyle(app);
    return { innerH: innerHeight, visualH: Math.round(visualViewport?visualViewport.height:0), htmlCH: document.documentElement.clientHeight,
      bodyH: Math.round(document.body.getBoundingClientRect().height), appH: Math.round(app.getBoundingClientRect().height),
      minH: cs.minHeight, padB: cs.paddingBottom, docH: document.documentElement.scrollHeight,
      lastChildBottom: Math.round(Math.max(...[...app.children].map(c=>c.getBoundingClientRect().bottom))) };})()`);
  console.log(label.padEnd(12) + String(h).padEnd(5) + String(m.innerH).padEnd(5) + String(m.visualH).padEnd(8) + String(m.htmlCH).padEnd(7) + String(m.bodyH).padEnd(6) + String(m.appH).padEnd(6) + m.minH.padEnd(9) + m.padB.padEnd(9) + String(m.docH).padEnd(6) + String(m.docH - h));
}
ws.close(); child.kill('SIGTERM'); process.exit(0);
