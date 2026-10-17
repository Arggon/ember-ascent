#!/usr/bin/env node
// scripts/dev/space-check.mjs — measure UNUSED space on the pages players actually see.
//
// The owner reported "a lot of black space at the bottom" on a tall phone (Galaxy S25+,
// 412x915). The layout is content-height and top-aligned, so on a tall viewport everything
// piles up under the HUD and the rest of the screen is empty. This measures how much is
// wasted, and whether the hand uses the available width, so a fix can be aimed at numbers.
//
// Acceptance signal (unchanged): wastePx is the only overflow signal this harness emits.
// Negative wastePx means the content bottom sits BELOW the viewport bottom (content pushed
// past the fold / the page must scroll). This harness EXITS 1 when any row has negative
// wastePx, 0 otherwise. It does not invent any other threshold.
//
// Seed pinning: this harness requests /src/web/index.html?seed=N directly. scripts/serve.mjs
// 301-redirects /web/?seed=N to /web/?seed=N/ (slash appended INSIDE the query), which makes
// src/web/app.js seedFromUrl() compute Number("11/") = NaN and fall back to a random seed. After
// load the harness reads the seed the app itself reports from the "New Run" button title
// ("New run (seed NNNNNN) — keyboard: n", see src/web/app.js) and fails the row when it does not
// equal the requested seed.
//
// Usage:
//   node scripts/dev/space-check.mjs                          # default matrix, seed 11
//   node scripts/dev/space-check.mjs --seeds 1-12             # seed range
//   node scripts/dev/space-check.mjs --seeds 3,7,11           # seed list (ranges may mix)
//   node scripts/dev/space-check.mjs --sizes 1366x768,915x412 # subset of SIZES
//   node scripts/dev/space-check.mjs --sizes 360x640@130,412x915@130 # large-font rows (text-scale.mjs)
//   node scripts/dev/space-check.mjs --port 9400                # own DevTools port + profile
//   node scripts/dev/space-check.mjs --base 'http://localhost:5173/src/web/index.html?seed={seed}'
// The old --base override still works (a base containing seed= is re-seeded per seed).
import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LARGE_FONT_SIZES, sizeKey, beginTextScale, endTextScale, TEXT_SCALE_PROBE, textScaleFailure } from './text-scale.mjs';

// ---- Acceptance thresholds (LAYOUT-ACCEPTANCE.md). Adjust here, not below. ----
const WASTE_PX_FAIL_BELOW = 0;   // exit 1 when any row has wastePx < this (existing signal)
const SEED_MUST_MATCH = true;    // page-reported seed must equal the requested seed, else FAIL
// -------------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, 'shots/space');
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
let portArg = null, seedsArg = null, sizesArg = null, baseArg = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--seeds') seedsArg = argv[++i];
  else if (argv[i] === '--sizes') sizesArg = argv[++i];
  else if (argv[i] === '--base') baseArg = argv[++i];
  else if (argv[i] === '--port') portArg = Number(argv[++i]);
  else baseArg = baseArg || argv[i]; // tolerate a positional BASE too
}

// --port: the DevTools port, with a profile dir named after it, so two runs on one machine
// (several agents share it) never attach to each other's browser.
const PORT = portArg || 9343, PROFILE = portArg ? '/tmp/dlb-space-' + portArg : '/tmp/dlb-space';

function parseSeeds(s) {
  const out = [];
  for (const part of String(s).split(',')) {
    const m = /^(\d+)-(\d+)$/.exec(part.trim());
    if (m) { for (let n = Number(m[1]); n <= Number(m[2]); n++) out.push(n); }
    else if (part.trim() !== '') out.push(Number(part.trim()));
  }
  const seeds = out.filter((n) => Number.isInteger(n) && n > 0);
  if (!seeds.length) { console.error('no valid seeds in --seeds ' + s); process.exit(2); }
  return seeds;
}
const SEEDS = seedsArg ? parseSeeds(seedsArg) : [11];

// Real device CSS viewports. The phone cases are where the complaint came from.
const SIZES = [
  [412, 915, 'galaxy-s25plus'],
  [390, 844, 'iphone-14'],
  [360, 640, 'phone-small'],
  [414, 896, 'phone-large'],
  [768, 1024, 'tablet'],
  [1280, 800, 'desktop'],
  [1366, 768, 'laptop'],
  [1280, 1000, 'desktop-tall'],
  [915, 412, 'galaxy-s25plus-landscape'],
  [844, 390, 'iphone-14-landscape'],
  [1200, 450, 'short-window'],
];
// Every 100% row, then the large-font rows (scripts/dev/text-scale.mjs: Gonzalo's rule, every
// build at 360-412dp with 130% text). --sizes takes "360x640" for 100% and "360x640@130".
const MATRIX = [...SIZES.map(([w, h, label]) => [w, h, label, 1]), ...LARGE_FONT_SIZES];
const SIZES_SEL = sizesArg
  ? MATRIX.filter(([w, h, , scale]) => sizesArg.split(',').some((s) => s.trim() === sizeKey(w, h, scale)))
  : MATRIX;
if (!SIZES_SEL.length) { console.error('no sizes matched --sizes ' + sizesArg); process.exit(2); }

const DEFAULT_BASE = 'http://localhost:5173/src/web/index.html?seed={seed}';
const BASE_TEMPLATE = baseArg || DEFAULT_BASE;
const SEED_IN_URL = BASE_TEMPLATE.includes('{seed}') || /([?&])seed=/.test(BASE_TEMPLATE);
function urlFor(seed) {
  if (BASE_TEMPLATE.includes('{seed}')) return BASE_TEMPLATE.replaceAll('{seed}', String(seed));
  if (/([?&])seed=/.test(BASE_TEMPLATE)) return BASE_TEMPLATE.replace(/([?&])seed=[^&]*/, '$1seed=' + seed);
  return BASE_TEMPLATE; // no seed in URL: seed assertion is skipped and rows are marked n/a
}

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
// Every DevTools call is bounded: a reply that never comes used to hang the harness
// silently forever (#36). Now it throws and the row fails with the method name.
const CDP_TIMEOUT_MS = 20000;
const send = (method, params = {}, sessionId) => {
  const i = id++; ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((r, j) => {
    const t = setTimeout(() => { pend.delete(i); j(new Error(`DevTools ${method} got no reply in ${CDP_TIMEOUT_MS}ms`)); }, CDP_TIMEOUT_MS);
    pend.set(i, (x) => { clearTimeout(t); r(x); });
  });
};
// One tab per run, REPLACED after a failed row: a timed-out row's async work keeps running
// after Promise.race gives up on it, so it must not be able to touch the next row (#49
// review). Each row runs in its own AsyncLocalStorage context; once a row is cancelled
// (liveRow moves on), any DevTools call it still makes is rejected before it is sent, and
// its tab is closed, so pending calls on it fail too.
const rowCtx = new AsyncLocalStorage();
let liveRow = 0;
let targetId, sessionId;
async function openTab() {
  ({ targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result);
  ({ sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result);
  await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
}
const S = (m, p) => {
  const row = rowCtx.getStore();
  if (row !== undefined && row !== liveRow) return Promise.reject(new Error(`row ${row} cancelled`));
  return send(m, p, sessionId);
};
await openTab();
const ev = async (e) => {
  const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

// Full navigate - dismiss - navigate - travel cycle, per viewport x seed.
// Each step WAITS for the element it needs before the old settle time: with fixed sleeps alone a
// loaded machine produced "End Turn NOT FOUND" / "no seed" rows because the page had not
// rendered yet. The final 1300ms settle stays so the deal-in animation is over.
async function waitFor(expr, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await ev(expr)) return true; } catch { /* mid-navigation */ }
    await sleep(100);
  }
  return false;
}
const MAP_READY = `!!(document.querySelector('.node.available') || [...document.querySelectorAll('button')].some(x => /got it/i.test(x.textContent || '')))`;
const MAP_OR_KINDLING = `!!(document.querySelector('.node.available, .kindling .boon') || [...document.querySelectorAll('button')].some(x => /got it/i.test(x.textContent || '')))`;
const FIGHT_READY = `!!([...document.querySelectorAll('button')].some(b => /end turn/i.test(b.textContent || '')) && document.querySelector('.hand .card'))`;
async function must(expr, what) {
  if (!(await waitFor(expr))) throw new Error(`${what} not reached within 15s`);
}
async function cycle(url) {
  await S('Page.navigate', { url });
  await must(MAP_OR_KINDLING, 'first load (map, Kindling or help)');
  await sleep(300);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url });
  await must(MAP_OR_KINDLING, 'reload (map or Kindling)');
  await sleep(300);
  // Kindling (v2/2): runs open on the act-start boon choice. Take the first boon (taking
  // one is mandatory; every boon keeps the 5-card opening hand) to reach the map. Same
  // step as viewport-check.mjs; without it the map never appeared and the run hung (#36).
  await ev(`(()=>{const b=document.querySelector('.kindling .boon');if(b)b.click();return 1})()`);
  await must(MAP_READY, 'map after Kindling');
  await sleep(300);
  // Travel into the first fight: the densest screen.
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`);
  await must(FIGHT_READY, 'first fight (End Turn + hand)');
  await sleep(1300);
}

// Per-row and overall time limits, with progress on stderr, so a stuck row fails loudly
// instead of the whole run going quiet (#36).
const ROW_TIMEOUT_MS = Number(process.env.SPACE_ROW_TIMEOUT_MS) || 90000; // env override to exercise the cancel path
const TOTAL_TIMEOUT_MS = 20 * 60000;
const totalTimer = setTimeout(() => {
  console.error(`space-check: OVERALL TIMEOUT after ${TOTAL_TIMEOUT_MS / 60000} min, aborting`);
  try { child.kill('SIGKILL'); } catch {}
  process.exit(3);
}, TOTAL_TIMEOUT_MS);
totalTimer.unref();
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error(`${what} exceeded ${ms / 1000}s`)), ms).unref())]);
const T0 = Date.now();
let rowNo = 0;
const ROW_TOTAL = SIZES_SEL.length * SEEDS.length;

const rows = [];
for (const [w, h, label, scale] of SIZES_SEL) {
  const isPhone = w <= 500;
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
  await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
  for (const seed of SEEDS) {
    const url = urlFor(seed);
    rowNo++;
    const rowT0 = Date.now();
    process.stderr.write(`[${rowNo}/${ROW_TOTAL}] ${sizeKey(w, h, scale)} seed ${seed} ... `);
    let m;
    let textScaleId = null;
    liveRow = rowNo;
    try {
      m = await withTimeout(rowCtx.run(rowNo, async () => {
      textScaleId = await beginTextScale(S, scale);
      await cycle(url);

      const m = await ev(`(() => {
        const vh = window.innerHeight, vw = window.innerWidth;
        const app = document.getElementById('app');
        const hand = document.querySelector('.hand');
        const controls = document.querySelector('.controls');
        const hint = document.querySelector('.stage-combat .hint') || document.querySelector('.hint');
        const rect = (e) => e ? e.getBoundingClientRect() : null;
        const rHint = rect(hint), rHand = rect(hand), rCtrl = rect(controls);
        const contentBottom = Math.max(rHint ? rHint.bottom : 0, rCtrl ? rCtrl.bottom : 0, rHand ? rHand.bottom : 0);
        // How much of the hand row's width is actually used by its cards?
        const wraps = [...document.querySelectorAll('.card-wrap')];
        const used = wraps.length ? (wraps[wraps.length-1].getBoundingClientRect().right - wraps[0].getBoundingClientRect().left) : 0;
        const rEnemies = rect(document.querySelector('.enemies'));
        const rHandTop = rect(document.querySelector('.hand'));
        const gap = (rEnemies && rHandTop) ? Math.round(rHandTop.top - rEnemies.bottom) : null;
        // The seed the app itself reports (src/web/app.js sets this title from snap.seed).
        const newRun = [...document.querySelectorAll('button')].find(b => /New run \\(seed \\d+\\)/.test(b.title||''));
        const seedMatch = newRun ? /seed (\\d+)/.exec(newRun.title) : null;
        const seedReported = seedMatch ? Number(seedMatch[1]) : null;
        const doc = document.documentElement;
        return {
          internalGap: gap,
          viewport: [vw, vh],
          seedReported,
          docScrollHeight: doc.scrollHeight,
          appHeight: app ? Math.round(rect(app).height) : null,
          contentBottom: Math.round(contentBottom),
          wastePx: Math.round(vh - contentBottom),
          wastePct: Math.round((vh - contentBottom) / vh * 100),
          handWidth: rHand ? Math.round(rHand.width) : null,
          cardsUsedWidth: Math.round(used),
          handFillPct: rHand ? Math.round(used / rHand.width * 100) : null,
        };
      })()`);
      m.requestedSeed = SEED_IN_URL ? seed : null;
      m.requested = [w, h];
      const ts = await ev(TEXT_SCALE_PROBE);
      m.textScale = scale; m.textScaleApplied = ts.applied; m.rootFontPx = ts.rootPx;
      m.label = label;
      const shot = await S('Page.captureScreenshot', { format: 'png' });
      await writeFile(resolve(OUT, `${label}-${sizeKey(w, h, scale).replace('@', '-at')}-s${seed}.png`), Buffer.from(shot.result.data, 'base64'));
      await endTextScale(S, textScaleId);
      textScaleId = null;
      return m;
      }), ROW_TIMEOUT_MS, 'row');
      process.stderr.write(`ok ${((Date.now() - rowT0) / 1000).toFixed(1)}s (total ${((Date.now() - T0) / 1000).toFixed(0)}s)\n`);
    } catch (e) {
      process.stderr.write(`FAILED: ${e.message}\n`);
      m = { error: e.message, seedReported: null, wastePx: null, wastePct: null, docScrollHeight: null, handFillPct: null, label, requested: [w, h], requestedSeed: SEED_IN_URL ? seed : null, textScale: scale, viewport: [w, h] };
      liveRow = -rowNo; // cancel the row: its late calls are now rejected
      // Undo the text scale this row applied (best effort: the tab may be the stuck part).
      if (textScaleId !== null) { try { await withTimeout(endTextScale(S, textScaleId), 5000, 'endTextScale'); } catch {} }
      // Fresh tab for the next row, with this size's emulation re-applied.
      try { await withTimeout(send('Target.closeTarget', { targetId }), 5000, 'closeTarget'); } catch {}
      try {
        await openTab();
        await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
        await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
      } catch (e2) {
        console.error(`space-check: could not open a fresh tab after a failed row: ${e2.message}`);
        try { child.kill('SIGKILL'); } catch {}
        process.exit(3);
      }
    }
    rows.push([sizeKey(w, h, scale), label, m]);
  }
}

// ---- Evaluate per row: negative wastePx is the existing signal; seed mismatch is invalid. ----
function evaluateRow(m) {
  if (m.error) return [`ROW ERROR: ${m.error}`];
  const fails = [];
  const tsFail = textScaleFailure(m);
  if (tsFail) fails.push(tsFail);
  // A mobile page wider than the screen is zoomed out to fit, so innerWidth/innerHeight come
  // back LARGER than the device and every other number is measured on a shrunken page.
  if (m.viewport[0] !== m.requested[0] || m.viewport[1] !== m.requested[1]) {
    fails.push(`page wider than the screen: rendered viewport ${m.viewport.join('x')} != device ${m.requested.join('x')} (mobile zooms out to fit)`);
  }
  if (SEED_MUST_MATCH) {
    if (m.requestedSeed === null) {
      fails.push(`seed check n/a (base URL has no seed param): page reported seed ${m.seedReported}`);
    } else if (m.seedReported === null) {
      fails.push(`INVALID SEED: page reported no seed (New Run button not found), requested ${m.requestedSeed}`);
    } else if (m.seedReported !== m.requestedSeed) {
      fails.push(`INVALID SEED: page reported ${m.seedReported}, requested ${m.requestedSeed}`);
    }
  }
  if (m.wastePx < WASTE_PX_FAIL_BELOW) {
    fails.push(`negative wastePx: wastePx=${m.wastePx}px < ${WASTE_PX_FAIL_BELOW}px (contentBottom=${m.contentBottom} vs innerHeight=${m.viewport[1]}, scrollHeight=${m.docScrollHeight})`);
  }
  return fails;
}

const evaluated = rows.map(([size, label, m]) => [size, label, m, evaluateRow(m)]);
const failedRows = evaluated.filter(([, , , fails]) => fails.length > 0);

console.log('thresholds: wastePx >= ' + WASTE_PX_FAIL_BELOW + ' (negative = content below the fold) | seed pinned: ' + (SEED_IN_URL ? 'yes' : 'no'));
console.log('base: ' + BASE_TEMPLATE + '  seeds: ' + SEEDS.join(','));
console.log('');
console.log('size         label                   seed  reported  viewport      waste   waste%  scrollH  handFill%  result');
for (const [size, label, m, fails] of evaluated) {
  console.log(
    size.padEnd(13) + label.padEnd(24) +
    String(m.requestedSeed === null ? 'n/a' : m.requestedSeed).padEnd(6) +
    String(m.seedReported === null ? '-' : m.seedReported).padEnd(10) +
    JSON.stringify(m.viewport).padEnd(14) +
    String(m.wastePx == null ? '-' : m.wastePx + 'px').padEnd(8) +
    String(m.wastePct == null ? '-' : m.wastePct + '%').padEnd(8) +
    String(m.docScrollHeight ?? '-').padEnd(9) +
    String(m.handFillPct == null ? '-' : m.handFillPct + '%').padEnd(11) +
    (fails.length ? 'FAIL' : 'pass'),
  );
}
console.log('');
if (failedRows.length) {
  console.log('FAIL summary (' + failedRows.length + ' failing row(s)):');
  for (const [size, , m, fails] of failedRows) {
    for (const f of fails) console.log(`  FAIL ${size} seed ${m.requestedSeed === null ? 'n/a' : m.requestedSeed}: ${f}`);
  }
} else {
  console.log('ALL PASS (' + evaluated.length + ' rows)');
}
console.log('\nscreenshots in shots/space/');

ws.close(); child.kill('SIGTERM');
process.exit(failedRows.length ? 1 : 0);
