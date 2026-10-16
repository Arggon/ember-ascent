#!/usr/bin/env node
// SCRATCH probe (temporary, deleted at end of run) — measures #hud computed box,
// #stage clip delta, and card font sizes, before/after the review fixes.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const PORT = 9340 + (process.pid % 100), PROFILE = '/tmp/dlb-scratch-' + process.pid;
const BASE = process.argv[2] || 'http://localhost:5173/web/index.html?seed=11';
const SIZES = [
  [1366, 768, 'laptop'],
  [1280, 800, 'desktop'],
  [915, 412, 'galaxy-s25u-land'],
  [1200, 450, 'short-desktop-window'],
  [844, 390, 'phone-landscape'],
];
const SEEDS = [1, 3, 7, 11];

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

async function cycle(url) {
  await S('Page.navigate', { url }); await sleep(1200);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url }); await sleep(1100);
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`);
  await sleep(1200);
}

for (const [w, h, label] of SIZES) {
  const isPhone = w <= 500;
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
  await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
  // --- Falsifiability check for the new stage-clip metric: force a clip and confirm the
  // same arithmetic the harness uses goes positive. Runs FIRST, then is reverted, so the
  // normal measurements below are unaffected.
  await cycle(BASE.replace(/seed=\d+/, 'seed=1'));
  const clipTest = await ev(`(() => {
    const s = document.querySelector('#stage');
    if (!s) return null;
    const before = s.scrollHeight - s.clientHeight;
    const out = { before };

    // Strategy A: append a child taller than the stage. NB this does NOT clip: #stage is
    // flex: 1 1 auto in a content-height #app, so it simply grows. Recorded as a finding.
    const d = document.createElement('div');
    d.style.height = (s.clientHeight + 200) + 'px'; d.style.flex = '0 0 auto';
    s.appendChild(d);
    out.afterGrowChild = s.scrollHeight - s.clientHeight;
    out.stageGrewTo = s.clientHeight;
    d.remove();

    // Strategy B: actually CAP the stage height below its content, which is the only way
    // overflow: hidden can swallow anything. This is what the metric must catch.
    const prevH = s.style.height, prevF = s.style.flex;
    s.style.flex = '0 0 auto';
    s.style.height = '100px';
    out.afterCap100 = s.scrollHeight - s.clientHeight;
    out.cappedClientH = s.clientHeight;
    out.cappedScrollH = s.scrollHeight;
    // Which descendants actually stick out of the stage's visible box, and by how much?
    const r = s.getBoundingClientRect();
    const over = [];
    for (const n of s.querySelectorAll('*')) {
      const b = n.getBoundingClientRect();
      const spill = Math.round(b.bottom - r.bottom);
      if (spill > 0) over.push({ sel: (n.className || n.tagName).toString().split(' ')[0], spill, h: Math.round(b.height) });
    }
    out.spilling = over.sort((a, b) => b.spill - a.spill).slice(0, 5);
    out.nSpilling = over.length;
    s.style.height = prevH; s.style.flex = prevF;
    out.reverted = s.scrollHeight - s.clientHeight;
    return out;
  })()`);
  const detects = clipTest.afterCap100 > 1;
  console.log(`FORCED-CLIP @ ${w}x${h}: baseline=${clipTest.before} | grow-child=${clipTest.afterGrowChild} (stage grew to ${clipTest.stageGrewTo}px) | capped-to-100px: delta=${clipTest.afterCap100} clientH=${clipTest.cappedClientH} scrollH=${clipTest.cappedScrollH} nSpilling=${clipTest.nSpilling} ${JSON.stringify(clipTest.spilling)} | reverted=${clipTest.reverted}  => ${detects ? 'DETECTS a real clip' : 'no clip registered'}`);

  for (const seed of SEEDS) {
    await cycle(BASE.replace(/seed=\d+/, 'seed=' + seed));
    const m = await ev(`(() => {
      const hud = document.querySelector('#hud');
      const hs = hud ? getComputedStyle(hud) : null;
      const stage = document.querySelector('#stage');
      const ss = stage ? getComputedStyle(stage) : null;
      const q = (s) => document.querySelector(s);
      const cs = (n, p) => n ? getComputedStyle(n)[p] : null;
      const rHint = (document.querySelector('.stage-combat .hint') || document.querySelector('.hint'));
      const rb = (e) => e ? e.getBoundingClientRect() : null;
      const rHand = rb(document.querySelector('.hand')), rCtrl = rb(document.querySelector('.controls')), rHint2 = rb(rHint);
      const contentBottom = Math.max(rHint2 ? rHint2.bottom : 0, rCtrl ? rCtrl.bottom : 0, rHand ? rHand.bottom : 0);
      return {
        wastePx: Math.round(window.innerHeight - contentBottom),
        contentBottom: Math.round(contentBottom),
        docScrollH: document.documentElement.scrollHeight,
        vh: window.innerHeight,
        hud: hs ? { columnGap: hs.columnGap, rowGap: hs.rowGap, gap: hs.gap, flexWrap: hs.flexWrap,
                    alignItems: hs.alignItems, padding: hs.padding, minHeight: hs.minHeight,
                    height: Math.round(hud.getBoundingClientRect().height) } : null,
        stage: stage ? { scrollH: stage.scrollHeight, clientH: stage.clientHeight,
                         delta: stage.scrollHeight - stage.clientHeight,
                         overflow: ss.overflow, height: Math.round(stage.getBoundingClientRect().height) } : null,
        // The metric that CAN detect clipping: how far the lowest descendant sticks out past
        // the stage's visible bottom. overflow: hidden clips anything beyond this point.
        spillPx: (() => {
          if (!stage) return null;
          const r = stage.getBoundingClientRect();
          let m = 0;
          for (const n of stage.querySelectorAll('*')) {
            const b = n.getBoundingClientRect();
            if (b.height === 0 && b.width === 0) continue;
            m = Math.max(m, b.bottom - r.bottom);
          }
          return Math.round(m);
        })(),
        fs: { ctype: cs(q('.card .ctype'), 'fontSize'), cname: cs(q('.card .cname'), 'fontSize'),
              cdesc: cs(q('.card .cdesc'), 'fontSize'), cdescLH: cs(q('.card .cdesc'), 'lineHeight') },
      };
    })()`);
    console.log(`${label.padEnd(20)} ${(w + 'x' + h).padEnd(10)} s${String(seed).padEnd(3)} waste=${String(m.wastePx).padStart(4)} cBot=${String(m.contentBottom).padStart(4)} docScroll=${String(m.docScrollH).padStart(4)} stageDelta=${String(m.stage.delta).padStart(3)} spill=${String(m.spillPx).padStart(4)}  fs cname=${m.fs.cname} cdesc=${m.fs.cdesc}  hudH=${m.hud.height}`);
  }
  const d = await ev(`(()=>{const hud=document.querySelector('#hud');const s=getComputedStyle(hud);return {columnGap:s.columnGap,rowGap:s.rowGap,gap:s.gap,flexWrap:s.flexWrap,alignItems:s.alignItems,padding:s.padding,minHeight:s.minHeight}})()`);
  console.log(`    #hud computed @ ${w}x${h}: ${JSON.stringify(d)}`);
}
ws.close(); child.kill('SIGTERM'); process.exit(0);
