#!/usr/bin/env node
// tools/dev/probe-toggle.mjs — isolate WHICH new declaration changes the 1280x800 desktop doc.
// Toggles each piece of the height strategy off at runtime and reports document/block heights.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
const PORT = 9340 + (process.pid % 100), PROFILE = '/tmp/dlb-probe-toggle-' + process.pid;
const BASE = process.argv[2] || 'http://localhost:5173/web/?seed=11';
const SIZES = [[1280, 800, 'desktop-1280x800'], [1280, 1000, 'desktop-tall'], [412, 915, 'galaxy']];
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

const CASES = [
  ['as-shipped', ''],
  ['page-combat -> block', '.page-combat{display:block !important}'],
  ['nemies margin auto -> 0', '.enemies{margin-bottom:0 !important}'],
  ['stage-combat flex -> 0 1 auto', '.stage-combat{flex:0 1 auto !important}'],
  ['page-combat flex -> 0 1 auto', '.page-combat{flex:0 1 auto !important}'],
];

for (const [w, h, label] of SIZES) {
  const isPhone = w <= 500;
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
  await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
  await S('Page.navigate', { url: BASE }); await sleep(1300);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url: BASE }); await sleep(1200);
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`); await sleep(1300);
  console.log(`\n=== ${label} ${w}x${h} ===`);
  console.log('case                          docH  appH  stageH  combatH  hintBottom  controlsBottom  handBottom');
  for (const [name, css] of CASES) {
    const m = await ev(`(()=>{
      const old = document.getElementById('probe-toggle');
      if (old) old.remove();
      const css = ${JSON.stringify(css)};
      if (css) { const s = document.createElement('style'); s.id = 'probe-toggle'; s.textContent = css; document.head.append(s); }
      const r = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().bottom) : null; };
      const H = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().height) : null; };
      return { docH: document.documentElement.scrollHeight, appH: H('#app'), stageH: H('#stage'), combatH: H('.stage-combat'),
        hint: r('.hint'), controls: r('.controls'), hand: r('.hand'), docW: document.documentElement.scrollWidth, vw: innerWidth };
    })()`);
    console.log(name.padEnd(29) + String(m.docH).padEnd(6) + String(m.appH).padEnd(6) + String(m.stageH).padEnd(8) + String(m.combatH).padEnd(8) + String(m.hint).padEnd(12) + String(m.controls).padEnd(16) + m.hand + `  (docW ${m.docW} vw ${m.vw})`);
  }
  await ev(`(()=>{const s=document.getElementById('probe-toggle'); if(s) s.remove(); return 1})()`);
}
ws.close(); child.kill('SIGTERM'); process.exit(0);
