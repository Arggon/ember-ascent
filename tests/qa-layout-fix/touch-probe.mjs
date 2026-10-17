#!/usr/bin/env node
// tests/qa-layout-fix/touch-probe.mjs — QA touch-target verification for the release gate.
//
// Proves change #1: `#stage .btn { min-height: 44px }` in the laptop tier
// (`@media (min-width: 901px) and (max-height: 830px)`) yields a 44px min tappable box at
// the five viewports the gate names: 1366x768, 1280x800, 915x412, 1200x450, 844x390.
//
// Read-only against the product: it loads the real page, measures, and prints. It never
// writes under src/web/ or scripts/. It exits 1 if any target viewport has a .btn min box < 44.
//
// Usage: node tests/qa-layout-fix/touch-probe.mjs [--seeds 1,3,7,11]
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const MIN_TARGET_PX = 44;                 // project-wide interactive floor this gate checks
const TARGETS = [
  [1366, 768, 'laptop'],
  [1280, 800, 'desktop'],
  [915, 412, 'galaxy-s25u-land'],
  [1200, 450, 'short-desktop-window'],
  [844, 390, 'phone-landscape'],
];
const argv = process.argv.slice(2);
let seeds = [11];
for (let i = 0; i < argv.length; i++) if (argv[i] === '--seeds') seeds = argv[++i].split(',').map(Number);

const BASE = 'http://localhost:5173/src/web/index.html?seed={seed}';
const OUT = 'tests/qa-layout-fix';
mkdirSync(OUT, { recursive: true });
const PORT = 9355, PROFILE = '/tmp/dlb-qa-touch5555';
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

async function cycle(url) {
  await S('Page.navigate', { url });
  await sleep(1300);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url });
  await sleep(1200);
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`);
  await sleep(1300);
}

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

log(`touch-target gate: .btn min(width,height) >= ${MIN_TARGET_PX}px at ${TARGETS.length} target viewports`);
log(`base: ${BASE}   seeds: ${seeds.join(',')}`);
log(`chromium: ${(await new Promise((r)=>{const c=spawn('chromium',['--version']);let o='';c.stdout.on('data',d=>o+=d);c.on('close',()=>r(o.trim()))}))}`);
log('');
log('=== RAW PER-VIEWPORT OUTPUT ===');

const failures = [];
for (const [w, h, label] of TARGETS) {
  const isPhone = w <= 500;
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
  await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
  for (const seed of seeds) {
    await cycle(BASE.replace('{seed}', String(seed)));
    const m = await ev(`(() => {
      const vh = window.innerHeight, vw = window.innerWidth;
      const btns = [...document.querySelectorAll('.btn')].filter(b => b.getClientRects().length);
      const detail = btns.map(b => {
        const r = b.getBoundingClientRect();
        return {
          text: (b.textContent || '').trim().slice(0, 22),
          inStage: !!b.closest('#stage'),
          inHud: !!b.closest('#hud'),
          w: Math.round(r.width), h: Math.round(r.height),
          minSide: Math.round(Math.min(r.width, r.height)),
          cssMinHeight: getComputedStyle(b).minHeight,
        };
      });
      const staged = detail.filter(d => d.inStage);
      const stageBtnMin = staged.length ? Math.min(...staged.map(d => d.minSide)) : null;
      const allMin = detail.length ? Math.min(...detail.map(d => d.minSide)) : null;
      const endTurn = btns.find(b => /end turn/i.test(b.textContent || ''));
      const rET = endTurn ? endTurn.getBoundingClientRect() : null;
      const NEWRUN = [...document.querySelectorAll('button')].find(b => /New run \\(seed \\d+\\)/.test(b.title||''));
      const sm = NEWRUN ? /seed (\\d+)/.exec(NEWRUN.title) : null;
      return {
        viewport: [vw, vh],
        seedReported: sm ? Number(sm[1]) : null,
        stageBtnCount: staged.length,
        stageBtnMin,
        stageBtnCssMinHeight: staged.length ? staged[0].cssMinHeight : null,
        allBtnMin: allMin,
        btnCount: detail.length,
        endTurnH: rET ? Math.round(rET.height) : null,
        endTurnW: rET ? Math.round(rET.width) : null,
        endTurnBottom: rET ? Math.round(rET.bottom) : null,
        endTurnClearance: rET ? Math.round(vh - rET.bottom) : null,
        detail,
      };
    })()`);
    const ok = m.stageBtnMin !== null && m.stageBtnMin >= MIN_TARGET_PX && m.allBtnMin >= MIN_TARGET_PX;
    if (!ok) failures.push(`${w}x${h} seed ${seed}: stageBtnMin=${m.stageBtnMin} allBtnMin=${m.allBtnMin}`);
    log('');
    log(`--- ${w}x${h} (${label}) seed ${seed} -> reported ${m.seedReported}   ${ok ? 'PASS' : 'FAIL'}`);
    log(`    .btn count=${m.btnCount}  min tappable box (all)=${m.allBtnMin}  in #stage=${m.stageBtnCount} min=${m.stageBtnMin}  css min-height=${m.stageBtnCssMinHeight}`);
    log(`    End Turn box ${m.endTurnW}x${m.endTurnH}  bottom=${m.endTurnBottom}/${m.viewport[1]}  clearance=${m.endTurnClearance}px`);
    for (const d of m.detail) log(`      btn ${String(d.minSide).padStart(3)}px  ${d.w}x${d.h}  min-height:${d.cssMinHeight.padStart(6)}  ${d.inStage ? 'STAGE' : '     '} ${d.inHud ? 'HUD  ' : '     '} "${d.text}"`);
  }
}

log('');
if (failures.length) {
  log(`FAIL: ${failures.length} viewport/seed row(s) below ${MIN_TARGET_PX}px:`);
  for (const f of failures) log('  ' + f);
} else {
  log(`PASS: .btn min tappable box >= ${MIN_TARGET_PX}px at all ${TARGETS.length} target viewports x ${seeds.length} seed(s) = ${TARGETS.length * seeds.length} rows`);
}

await writeFile(`${OUT}/30-touch-targets.txt`, lines.join('\n') + '\n');
ws.close(); child.kill('SIGTERM');
process.exit(failures.length ? 1 : 0);
