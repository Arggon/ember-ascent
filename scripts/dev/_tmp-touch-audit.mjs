#!/usr/bin/env node
// scripts/dev/_tmp-touch-audit.mjs — TEMPORARY diagnostic (deleted at the end of this run).
//
// Purpose: decide the exact shape of the FIX 1 CSS change, and independently reproduce the
// spill baseline + spill positive-control that FIX 2's new gate needs.
//
// It is READ-ONLY with respect to src/web/style.css. The two candidate edits are SIMULATED by
// injecting a throwaway <style> into the live document AFTER the app's final render, which is
// cascade-equivalent to editing the single declaration:
//   asis  -> nothing injected (the file exactly as it is now)
//   del44 -> `#stage .btn { min-height: auto }`: what "delete that one declaration" produces
//   set44 -> `#stage .btn { min-height: 44px }`: the project's shipped 44px minimum
//
// usage: node scripts/dev/_tmp-touch-audit.mjs [sizes] [seeds]
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const PORT = 9501, PROFILE = '/tmp/dlb-touch-audit';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 1;

const SIZES = (process.argv[2] || '1366x768,1280x800,915x412,1200x450,844x390')
  .split(',').map((s) => s.split('x').map(Number));
const SEEDS = (process.argv[3] || '1,3,7,11').split(',').map(Number);
const ARMS = { asis: '', del44: '#stage .btn{min-height:auto !important}', set44: '#stage .btn{min-height:44px !important}' };

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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};

async function cycle(seed) {
  const url = `http://localhost:5173/src/web/index.html?seed=${seed}`;
  await S('Page.navigate', { url }); await sleep(1250);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url }); await sleep(1150);
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`); await sleep(1250);
}

// --- The metric exactly as FIX 2 specifies it: max over .page-combat descendants of
// (rect.bottom - stage.rect.bottom), excluding #fx-layer subtrees and position: fixed.
const MEASURE = `(() => {
  const stage = document.querySelector('#stage');
  const sr = stage.getBoundingClientRect();
  const vh = window.innerHeight;
  const endTurn = [...document.querySelectorAll('button')].find(b => /end turn/i.test(b.textContent || ''));
  const rET = endTurn ? endTurn.getBoundingClientRect() : null;
  const box = (el) => Math.round(Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height));
  const minOf = (sel) => { const ns = [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length);
    return ns.length ? Math.min(...ns.map(box)) : null; };
  const inv = [...document.querySelectorAll('.btn')].map((n) => {
    const r = n.getBoundingClientRect(); const c = getComputedStyle(n);
    return { t: (n.textContent || '').trim().slice(0, 20), inStage: !!n.closest('#stage'),
             w: Math.round(r.width), h: Math.round(r.height), mh: c.minHeight, fs: c.fontSize, pad: c.padding };
  });
  let spill = -Infinity, worst = null, wb = null, cnt = 0;
  for (const root of document.querySelectorAll('.page-combat')) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.closest('#fx-layer')) continue;
      if (!el.getClientRects().length) continue;
      let fx = false;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        if (getComputedStyle(n).position === 'fixed') { fx = true; break; }
      }
      if (fx) continue;
      cnt++;
      const d = el.getBoundingClientRect().bottom - sr.bottom;
      if (d > spill) { spill = d; worst = el; wb = el.getBoundingClientRect().bottom; }
    }
  }
  const nm = (el) => { if (!el) return null; const p = []; let n = el;
    while (n && n !== stage && p.length < 6) { p.unshift((n.className && String(n.className).split(' ')[0]) || n.tagName.toLowerCase()); n = n.parentElement; }
    return p.join('>'); };
  return { vp: [window.innerWidth, vh], eTbot: rET ? Math.round(rET.bottom) : null,
    clear: rET ? Math.round(vh - rET.bottom) : null, eTtop: rET ? Math.round(rET.top) : null,
    pageScroll: document.documentElement.scrollHeight - vh,
    spillPx: cnt ? Math.round(spill) : null, spilledCnt: cnt, worst: nm(worst), wb: wb === null ? null : Math.round(wb),
    stageBottom: Math.round(sr.bottom), stageScroll: stage.scrollHeight, stageClient: stage.clientHeight,
    minTouchWhat: { minTouchAll: minOf('.card-wrap, .enemy, .node, .btn, .card'), btn: minOf('.btn'), stageBtn: minOf('#stage .btn'), hudBtn: minOf('#hud .btn') },
    inv };
})()`;

console.log('ARM SEMANTICS: asis = file as-is | del44 = L2201 deleted (min-height: auto) | set44 = L2201 = 44px\n');
const all = [];
for (const [w, h] of SIZES) {
  const isPhone = w <= 500;
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
  await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
  for (const seed of SEEDS) {
    for (const [arm, css] of Object.entries(ARMS)) {
      await cycle(seed);
      await ev(`(()=>{document.getElementById('sim-arm')?.remove();const css=${JSON.stringify(css)};if(css){const s=document.createElement('style');s.id='sim-arm';s.textContent=css;document.head.appendChild(s);}return 1})()`);
      await sleep(220);
      const m = await ev(MEASURE);
      all.push({ size: `${w}x${h}`, vp: m.vp, seed, arm, clear: m.clear, pageScroll: m.pageScroll, spillPx: m.spillPx, spilledCnt: m.spilledCnt, worst: m.worst, wb: m.wb, minTouchAll: m.minTouchWhat.minTouchAll, btn: m.minTouchWhat.btn, stageBtn: m.minTouchWhat.stageBtn, hudBtn: m.minTouchWhat.hudBtn, inv: m.inv });
      console.log(`${(w + 'x' + h).padEnd(10)} s${String(seed).padEnd(3)} ${arm.padEnd(6)} clear=${String(m.clear).padStart(4)} scroll=${String(m.pageScroll).padStart(3)} spill=${String(m.spillPx).padStart(3)} n=${String(m.spilledCnt).padStart(3)} spillBtn=${String(m.minTouchWhat.stageBtn).padStart(3)} hudBtn=${String(m.minTouchWhat.hudBtn).padStart(3)} allBtn=${String(m.minTouchWhat.btn).padStart(3)} minTouchAll=${String(m.minTouchWhat.minTouchAll).padStart(3)}`);
    }
  }
}
console.log('\n=== per-arm detail (last seed per size) ===');
for (const r of all.filter((r, i, a) => i === a.length - 1 || r.seed !== a[i + 1].seed || r.size !== a[i + 1].size)) {
  console.log(`\n${r.size} s${r.seed} ${r.arm}: spill=${r.spillPx} worst=${r.worst}@${r.wb} stageBottom=see-all`);
}
console.log('\n=== .btn inventory (asis arm, last seed measured) ===');
const seen = new Set();
for (const r of all.filter((r) => r.arm === 'asis')) {
  const key = r.size;
  if (seen.has(key)) continue; seen.add(key);
  console.log('  ' + key + ':');
  for (const b of r.inv) console.log(`     inStage=${b.inStage ? 'Y' : 'n'} ${String(b.h).padStart(3)}x${String(b.w).padStart(3)} minh=${b.mh.padEnd(6)} fs=${b.fs.padEnd(7)} pad=${b.pad.padEnd(16)} "${b.t}"`);
}
ws.close(); child.kill('SIGTERM');
process.exit(0);
