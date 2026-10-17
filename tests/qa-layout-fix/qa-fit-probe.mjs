#!/usr/bin/env node
// tests/qa-layout-fix/qa-fit-probe.mjs — QA-owned independent probe for the docs/specs/LAYOUT-ACCEPTANCE.md
// criteria that scripts/dev/viewport-check.mjs and scripts/dev/space-check.mjs COLLECT but do NOT
// ASSERT:
//   S1 criterion 3 : `.hint` bottom <= innerHeight
//   S2/S3 clip     : #stage scrollHeight === clientHeight (nothing clipped by overflow:hidden)
// It also re-derives, independently of both harnesses, the criteria they DO assert
// (End Turn bottom <= innerHeight - 8, page scrollHeight <= innerHeight, hand rows === 1,
// seed reported == seed requested), so a disagreement between instruments is visible.
//
// Read-only with respect to the product: it starts its own headless Chromium and only reads
// DOM geometry. It writes no file except its own stdout. Exit 1 if any assertion fails.
//
// Usage: node tests/qa-layout-fix/qa-fit-probe.mjs
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const PORT = 9345, PROFILE = '/tmp/qa-fit-probe';
const SIZES = [
  [360, 640, 'phone-small'], [390, 844, 'iphone-14'], [414, 896, 'phone-large'],
  [844, 390, 'phone-landscape'], [915, 412, 'galaxy-s25u-land'], [768, 1024, 'tablet'],
  [1280, 800, 'desktop'], [1366, 768, 'laptop'], [1200, 450, 'short-desktop-window'],
];
const SEEDS = [1, 3, 7, 11];
const BASE = 'http://localhost:5173/src/web/index.html?seed=';
const NOSCROLLBAR_ISH = true;

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
  await S('Page.navigate', { url }); await sleep(1300);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url }); await sleep(1200);
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`); await sleep(1300);
}

const out = [];
for (const [w, h, label] of SIZES) {
  const isPhone = w <= 500;
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
  await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
  for (const seed of SEEDS) {
    await cycle(BASE + seed);
    const m = await ev(`(() => {
      const vh = window.innerHeight, vw = window.innerWidth;
      const doc = document.documentElement;
      const stage = document.querySelector('#stage');
      const hint = document.querySelector('.hint');
      const combat = document.querySelector('.stage-combat');
      const endTurn = [...document.querySelectorAll('button')].find(b => /end turn/i.test(b.textContent||''));
      const newRun = [...document.querySelectorAll('button')].find(b => /New run \\((seed \\d+)\\)/.test(b.title||''));
      const sm = newRun ? /seed (\\d+)/.exec(newRun.title) : null;
      const rET = endTurn ? endTurn.getBoundingClientRect() : null;
      // elementFromPoint: is End Turn the topmost element at its own centre?
      let onTop = null;
      if (rET) {
        const cx = rET.left + rET.width/2, cy = rET.top + rET.height/2;
        onTop = (cx >= 0 && cy >= 0 && cx < vw && cy < vh)
          ? (() => { const el = document.elementFromPoint(cx, cy); return !!el && (el === endTurn || endTurn.contains(el)); })()
          : false;
      }
      const rows = new Set([...document.querySelectorAll('.card-wrap')].map(n => Math.round(n.getBoundingClientRect().top))).size;
      return {
        vh, vw,
        seedReported: sm ? Number(sm[1]) : null,
        docScrollH: doc.scrollHeight,
        etBottom: rET ? Math.round(rET.bottom) : null,
        etClearance: rET ? Math.round(vh - rET.bottom) : null,
        etOnTop: onTop,
        handRows: rows,
        hintFound: !!hint,
        hintBottom: hint ? Math.round(hint.getBoundingClientRect().bottom) : null,
        hintScrollH: hint ? hint.scrollHeight : null,
        hintClientH: hint ? hint.clientHeight : null,
        stageFound: !!stage,
        stageClientH: stage ? stage.clientHeight : null,
        stageScrollH: stage ? stage.scrollHeight : null,
        stageOverflowY: stage ? getComputedStyle(stage).overflowY : null,
        combatClientH: combat ? combat.clientHeight : null,
        combatScrollH: combat ? combat.scrollHeight : null,
      };
    })()`);
    const fails = [];
    if (m.seedReported !== seed) fails.push(`SEED: page reported ${m.seedReported}, requested ${seed}`);
    if (m.docScrollH > m.vh) fails.push(`PAGE SCROLL: scrollHeight ${m.docScrollH} > innerHeight ${m.vh}`);
    if (m.etBottom === null) fails.push('END TURN NOT FOUND');
    else if (m.etBottom > m.vh - 8) fails.push(`END TURN CLEARANCE: bottom ${m.etBottom} > ${m.vh - 8} (clearance ${m.etClearance}, needs >= 8)`);
    if (m.etOnTop !== true) fails.push(`END TURN NOT TOPMOST AT CENTRE (${m.etOnTop})`);
    if (m.handRows !== 1) fails.push(`HAND ROWS: ${m.handRows} (needs exactly 1)`);
    if (m.hintBottom === null) fails.push('HINT LINE NOT FOUND');
    else if (m.hintBottom > m.vh) fails.push(`HINT BELOW FOLD: hint bottom ${m.hintBottom} > innerHeight ${m.vh}`);
    if (m.stageScrollH === null) fails.push('#stage NOT FOUND');
    else if (m.stageScrollH !== m.stageClientH) fails.push(`#stage CLIPS: scrollHeight ${m.stageScrollH} != clientHeight ${m.stageClientH} (overflow-y ${m.stageOverflowY})`);
    out.push({ size: `${w}x${h}`, label, seed, m, fails });
  }
}

console.log('QA independent probe — thresholds: etBottom <= innerHeight-8 | scrollHeight <= innerHeight'
  + ' | hint.bottom <= innerHeight | handRows == 1 | #stage scrollHeight == clientHeight | et topmost | seed == requested');
console.log('base: ' + BASE + '{seed}  seeds: ' + SEEDS.join(',') + '  hide-scrollbars: ' + NOSCROLLBAR_ISH);
console.log('');
console.log('size      seed  rep   etBot/vh  clear  scrollH  handRows  etTopmost  hintBot/vh  stageClip(scroll==client)');
for (const r of out) {
  const m = r.m;
  console.log(
    r.size.padEnd(10) + String(r.seed).padEnd(6) + String(m.seedReported).padEnd(6) +
    `${m.etBottom}/${m.vh}`.padEnd(10) + String(m.etClearance).padEnd(7) +
    String(m.docScrollH).padEnd(9) + String(m.handRows).padEnd(10) +
    String(m.etOnTop).padEnd(11) +
    `${m.hintBottom}/${m.vh}`.padEnd(12) +
    (m.stageScrollH === m.stageClientH ? 'ok (' + m.stageScrollH + '==' + m.stageClientH + ')' : 'CLIP (' + m.stageScrollH + '!=' + m.stageClientH + ')'),
  );
}
const bad = out.filter((r) => r.fails.length);
console.log('');
if (bad.length) {
  console.log('FAIL summary (' + bad.length + ' failing row(s)):');
  for (const r of bad) for (const f of r.fails) console.log(`  FAIL ${r.size} seed ${r.seed}: ${f}`);
} else {
  console.log('ALL PASS (' + out.length + ' rows)');
}
console.log('');
console.log('--- stage/combat overflow detail (all rows) ---');
for (const r of out) {
  const m = r.m;
  console.log(`  ${r.size} s${r.seed}: stage ${m.stageScrollH}/${m.stageClientH} overflow-y=${m.stageOverflowY} | combat ${m.combatScrollH}/${m.combatClientH} | hint ${m.hintScrollH}/${m.hintClientH}`);
}
ws.close(); child.kill('SIGTERM');
process.exit(bad.length ? 1 : 0);
