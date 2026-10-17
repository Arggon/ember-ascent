#!/usr/bin/env node
// scripts/dev/probe-nesting.mjs — what is #stage's child chain, and did the bands apply?
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
const PORT = 9340 + (process.pid % 100), PROFILE = '/tmp/dlb-probe-nest-' + process.pid;
const BASE = process.argv[2] || 'http://localhost:5173/src/web/?seed=11';
const SIZES = [[412, 915, 'galaxy'],[360, 640, 'small'],[768, 1024, 'tablet'],[1280, 800, 'desktop']];
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
for (const [w, h, label] of SIZES) {
  const isPhone = w <= 500;
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
  await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
  await S('Page.navigate', { url: BASE }); await sleep(1300);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url: BASE }); await sleep(1200);
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`); await sleep(1300);
  const m = await ev(`(()=>{
    const chain = (sel) => { const out = []; let e = document.querySelector(sel); while (e && e.id !== 'app') { out.unshift(e.tagName.toLowerCase() + '.' + [...e.classList].join('.') + '#' + (e.id||'')); e = e.parentElement; } return out.join(' <- '); };
    const sc = document.querySelector('.stage-combat');
    const cs = getComputedStyle(sc);
    const en = document.querySelector('.enemies'); const enCs = getComputedStyle(en);
    const hd = document.querySelector('.hand'); const hdCs = getComputedStyle(hd);
    const stage = document.getElementById('stage');
    return {
      enemiesChain: chain('.enemies'),
      handChain: chain('.hand'),
      stageChildren: [...stage.children].map(c => c.tagName.toLowerCase() + '.' + [...c.classList].join('.')),
      scFlex: cs.flexGrow + '/' + cs.flexShrink + '/' + cs.flexBasis + ' h=' + Math.round(sc.getBoundingClientRect().height),
      scParent: sc.parentElement.tagName + '.' + [...sc.parentElement.classList].join('.') + (sc.parentElement.id ? '#'+sc.parentElement.id : ''),
      enemiesMb: enCs.marginBottom, handMb: hdCs.marginBottom,
      stageCB: Math.round(stage.clientHeight - parseFloat(getComputedStyle(stage).paddingTop) - parseFloat(getComputedStyle(stage).paddingBottom)),
      freeInStage: Math.round(stage.clientHeight - parseFloat(getComputedStyle(stage).paddingTop) - parseFloat(getComputedStyle(stage).paddingBottom) - sc.getBoundingClientRect().height),
      stageOverflow: getComputedStyle(stage).overflow, stageJustify: getComputedStyle(stage).justifyContent, stageAlignItems: getComputedStyle(stage).alignItems,
    };
  })()`);
  console.log(`\n=== ${label} ${w}x${h} ===`);
  console.log('  enemies chain : ' + m.enemiesChain);
  console.log('  hand chain    : ' + m.handChain);
  console.log('  #stage kids   : ' + JSON.stringify(m.stageChildren));
  console.log('  .stage-combat : flex ' + m.scFlex + '  parent ' + m.scParent);
  console.log('  margins       : .enemies mb=' + m.enemiesMb + '  .hand mb=' + m.handMb);
  console.log('  stage content ' + m.stageCB + '  free under .stage-combat ' + m.freeInStage + '  overflow ' + m.stageOverflow + ' justify ' + m.stageJustify + ' align ' + m.stageAlignItems);
}
ws.close(); child.kill('SIGTERM'); process.exit(0);
