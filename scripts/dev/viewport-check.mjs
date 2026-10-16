#!/usr/bin/env node
// scripts/dev/viewport-check.mjs — acceptance instrument for docs/specs/LAYOUT-ACCEPTANCE.md (frozen).
//
// Renders the combat screen at each release-bar size in real Chromium, evaluates the
// contract thresholds per viewport × seed row, and EXITS 1 if any row fails, 0 if all pass.
// A red run finally looks red.
//
// Seed pinning: this harness requests /src/web/index.html?seed=N directly. scripts/serve.mjs
// 301-redirects /src/web/?seed=N to /src/web/?seed=N/ (slash appended INSIDE the query), which makes
// src/web/app.js seedFromUrl() compute Number("11/") = NaN and fall back to a random seed. After
// load the harness reads the seed the app itself reports from the "New Run" button title
// ("New run (seed NNNNNN) — keyboard: n", see src/web/app.js) and fails the row when it does not
// equal the requested seed.
//
// Usage:
//   node scripts/dev/viewport-check.mjs                          # default matrix, seed 11
//   node scripts/dev/viewport-check.mjs --seeds 1-12             # seed range
//   node scripts/dev/viewport-check.mjs --seeds 3,7,11           # seed list (ranges may mix)
//   node scripts/dev/viewport-check.mjs --sizes 1366x768,915x412 # subset of SIZES
//   node scripts/dev/viewport-check.mjs --base 'http://localhost:5173/web/index.html?seed={seed}'
//   node scripts/dev/viewport-check.mjs --diag                   # + per-block height dump
// The old positional BASE argument still works:
//   node scripts/dev/viewport-check.mjs http://localhost:5173/web/index.html?seed=11
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- Acceptance thresholds (docs/specs/LAYOUT-ACCEPTANCE.md S1/S2/S3/S5). Adjust here, not below. ----
const END_TURN_CLEARANCE_PX = 8;  // End Turn bottom must be <= innerHeight - this (S1/S3)
const PAGE_SCROLL_ALLOW_PX = 0;   // document scrollHeight must be <= innerHeight + this (S1/S2)
const HAND_ROWS_MAX = 1;          // hand must render on at most this many rows (S2/S3)
const END_TURN_MUST_BE_ON_TOP = true; // End Turn must be the topmost element at its centre (S3)
const STAGE_CLIP_ALLOW_PX = 1;    // #stage scrollHeight <= clientHeight + this (S2/S3; #stage is overflow: hidden)
// S2/S3, the REAL stage-clip gate. `stageClipPx` above is a valid number but a DEAD check:
// the only child of #stage is `div.page.page-combat` and the chain makes it `flex: 1 1 auto;
// min-height: 0`, so a too-tall stage SQUEEZES that child instead of overflowing it and
// scrollHeight == clientHeight no matter how much content is clipped. Measured: 0 on all 20
// rows, and STILL 0 after forcing the worst case (capping #stage to 100px with
// `flex: 0 0 auto` while 132 measured descendants stuck out past its bottom edge by up to
// 492px). The metric below is the one that moves: descendant spill, i.e. how far the furthest
// descendant rect extends past #stage's clipped bottom edge.
// Threshold from measurement, not taste: the baseline spill is <= 0 at EVERY release-bar
// size, so a content-fits-the-stage layout reads negative (content stops inside the stage)
// and only real clipping reads positive. Measured baseline (seeds 1,3,7,11): -4px at 360x640,
// 390x844, 414x896; -6px at 915x412, 1200x450, 1280x800, 1366x768; -10px at 768x1024, 844x390.
// 2px therefore sits ~6px above the worst observed baseline, which absorbs the ~1-2px of
// border/rounding drift that the 44px button fix introduces (content grows downward INSIDE the
// stage; it does not spill), while still catching any real 1px+ of clipped content.
const STAGE_SPILL_ALLOW_PX = 2;   // max descendant spill past #stage's bottom <= this (S2/S3)
// -------------------------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, 'shots/viewport');
mkdirSync(OUT, { recursive: true });
const PORT = 9341, PROFILE = '/tmp/dlb-viewport';

const argv = process.argv.slice(2);
let seedsArg = null, sizesArg = null, baseArg = null, diag = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--seeds') seedsArg = argv[++i];
  else if (argv[i] === '--sizes') sizesArg = argv[++i];
  else if (argv[i] === '--base') baseArg = argv[++i];
  else if (argv[i] === '--diag') diag = true;
  else baseArg = baseArg || argv[i]; // old positional BASE still works
}

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

// The release bar sizes. 844x390 is the same phone in landscape: extremely short, so it
// is the case most likely to break. 1280x800 is the owner-approved desktop layout and must
// not regress.
const SIZES = [
  [360, 640, 'phone-small'],
  [390, 844, 'iphone-14'],
  [414, 896, 'phone-large'],
  [844, 390, 'phone-landscape'],
  [915, 412, 'galaxy-s25u-land'],
  [768, 1024, 'tablet'],
  [1280, 800, 'desktop'],
  [1366, 768, 'laptop'],
  [1200, 450, 'short-desktop-window'],
];
const SIZES_SEL = sizesArg
  ? SIZES.filter(([w, h]) => sizesArg.split(',').some((s) => s.trim() === `${w}x${h}`))
  : SIZES;
if (!SIZES_SEL.length) { console.error('no sizes matched --sizes ' + sizesArg); process.exit(2); }

const DEFAULT_BASE = 'http://localhost:5173/web/index.html?seed={seed}';
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

// Full navigate - dismiss - navigate - travel cycle, per viewport x seed.
async function cycle(url) {
  await S('Page.navigate', { url });
  await sleep(1300);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url });
  await sleep(1200);
  // Travel into the first fight: the densest screen.
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`);
  await sleep(1300);
}

const rows = [];
for (const [w, h, label] of SIZES_SEL) {
  const isPhone = w <= 500;
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
  await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
  for (const seed of SEEDS) {
    const url = urlFor(seed);
    await cycle(url);

    const m = await ev(`(() => {
      const doc = document.documentElement;
      const vh = window.innerHeight, vw = window.innerWidth;
      const hand = document.querySelector('.hand');
      const cards = [...document.querySelectorAll('.card')];
      const stage = document.querySelector('#stage');
      const endTurn = [...document.querySelectorAll('button')].find(b => /end turn/i.test(b.textContent||''));
      // The seed the app itself reports (src/web/app.js sets this title from snap.seed).
      const newRun = [...document.querySelectorAll('button')].find(b => /New run \\(seed \\d+\\)/.test(b.title||''));
      const seedMatch = newRun ? /seed (\\d+)/.exec(newRun.title) : null;
      const seedReported = seedMatch ? Number(seedMatch[1]) : null;
      const rET = endTurn ? endTurn.getBoundingClientRect() : null;
      // Topmost-at-centre check: elementFromPoint returns null outside the viewport, and a
      // covering element means the button is visible but dead.
      const endTurnOnTop = (() => {
        if (!endTurn) return false;
        const cx = rET.left + rET.width / 2, cy = rET.top + rET.height / 2;
        if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) return false;
        const el = document.elementFromPoint(cx, cy);
        return !!el && (el === endTurn || endTurn.contains(el));
      })();
      const last = cards[cards.length - 1];
      // --- S2/S3, the real stage-clip metric: DESCENDANT SPILL -------------------------
      // max over the .page-combat subtree of (descendant rect.bottom - #stage rect.bottom).
      // A positive value means content extends past the bottom edge #stage clips at.
      // Excluded: anything inside #fx-layer (a SIBLING of #stage per src/web/index.html, never
      // rebuilt by render()), and position: fixed elements (not clipped by an ancestor's
      // overflow). Elements with no box (display: none) contribute nothing.
      const spill = (() => {
        const roots = [...document.querySelectorAll('.page-combat')];
        if (!stage || !roots.length) return { px: null, worst: null };
        const sb = stage.getBoundingClientRect().bottom;
        let worst = null, worstEl = null;
        for (const root of roots) {
          for (const el of [root, ...root.querySelectorAll('*')]) {
            if (el.closest('#fx-layer')) continue;
            if (!el.getClientRects().length) continue;
            let fixed = false;
            for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
              if (getComputedStyle(n).position === 'fixed') { fixed = true; break; }
            }
            if (fixed) continue;
            const d = el.getBoundingClientRect().bottom - sb;
            if (worst === null || d > worst) { worst = d; worstEl = el; }
          }
        }
        const path = (el) => {
          if (!el) return null;
          const p = [];
          for (let n = el; n && n !== stage && p.length < 6; n = n.parentElement) {
            p.unshift((n.className && String(n.className).split(' ')[0]) || n.tagName.toLowerCase());
          }
          return p.join('>');
        };
        return { px: worst === null ? null : Math.round(worst), worst: path(worstEl) };
      })();
      return {
        viewport: [vw, vh],
        seedReported,
        docScroll: [doc.scrollWidth, doc.scrollHeight],
        hOverflow: doc.scrollWidth > vw + 1,
        pageScrollPx: doc.scrollHeight - vh,
        endTurnFound: !!endTurn,
        endTurnTop: rET ? Math.round(rET.top) : null,
        endTurnBottom: rET ? Math.round(rET.bottom) : null,
        endTurnClearance: rET ? Math.round(vh - rET.bottom) : null,
        endTurnOnTop,
        cards: cards.length,
        handScrollW: hand ? hand.scrollWidth : null,
        handClientW: hand ? hand.clientWidth : null,
        cardsClipped: cards.filter(c => c.getBoundingClientRect().right > (hand ? hand.getBoundingClientRect().right + 1 : vw)).length,
        lastCardBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null,
        stageBottom: stage ? Math.round(stage.getBoundingClientRect().bottom) : null,
        // S2/S3: #stage is overflow: hidden (src/web/style.css:210), so content taller than the
        // stage is clipped INVISIBLY -- the page can still fit while the stage swallows a card
        // row. Nothing else in this harness compares these two numbers.
        stageClipPx: stage ? stage.scrollHeight - stage.clientHeight : null,
        // The real metric (see STAGE_SPILL_ALLOW_PX): the gated one.
        spillPx: spill.px,
        spillWorst: spill.worst,
        handRows: (() => {
          const tops = [...document.querySelectorAll('.card-wrap')].map(w => Math.round(w.getBoundingClientRect().top));
          return new Set(tops).size;
        })(),
        enemyRows: (() => {
          const tops = [...document.querySelectorAll('.enemy')].map(w => Math.round(w.getBoundingClientRect().top));
          return new Set(tops).size;
        })(),
        scrolls: (() => {
          return [...document.querySelectorAll('.card')].filter(c => c.scrollHeight > c.clientHeight + 1).length;
        })(),
        minTouch: (() => {
          const sel = '.card-wrap, .enemy, .node, .btn, .card';
          const nodes = [...document.querySelectorAll(sel)].filter(n => n.getClientRects().length);
          let m = null;
          for (const n of nodes) {
            const r = n.getBoundingClientRect();
            const s = Math.min(r.width, r.height);
            if (m === null || s < m) m = Math.round(s);
          }
          return m;
        })(),
        touchByKind: (() => {
          const out = {};
          for (const [k, sel] of Object.entries({ cardWrap: '.card-wrap', card: '.card', enemy: '.enemy', node: '.node', btn: '.btn' })) {
            const nodes = [...document.querySelectorAll(sel)].filter(n => n.getClientRects().length);
            out[k] = nodes.length ? Math.min(...nodes.map(n => Math.round(Math.min(n.getBoundingClientRect().width, n.getBoundingClientRect().height)))) : null;
          }
          return out;
        })(),
        blocks: (() => {
          const out = {};
          const grab = (sel, name) => {
            const n = document.querySelector(sel);
            out[name] = n ? Math.round(n.getBoundingClientRect().height) : null;
          };
          grab('#app', 'app');
          grab('#hud', 'hud');
          grab('#stage', 'stage');
          grab('.stage-combat', 'combat');
          grab('.enemies', 'enemies');
          grab('.hand', 'hand');
          grab('.controls', 'controls');
          grab('.hint', 'hint');
          grab('.card', 'card');
          grab('.enemy', 'enemy');
          grab('.e-intent', 'intent');
          grab('.e-art', 'art');
          const c = document.querySelector('.card');
          const w = document.querySelector('.card-wrap');
          const cs = c ? getComputedStyle(c) : null;
          const ws = w ? getComputedStyle(w) : null;
          out.cardMinH = cs ? cs.minHeight : null;
          out.cardDescFs = cs ? getComputedStyle(c.querySelector('.cdesc')).fontSize : null;
          out.wrapMaxW = ws ? ws.maxWidth : null;
          out.wrapMinH = ws ? ws.minHeight : null;
          out.kids = [...document.querySelectorAll('.stage-combat > *')]
            .map(n => (n.className || n.tagName).split(' ')[0] + '=' + Math.round(n.getBoundingClientRect().height))
            .join(' ');
          return out;
        })(),
      };
    })()`);
    m.requestedSeed = SEED_IN_URL ? seed : null;
    m.label = label;
    const shot = await S('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(OUT, `${label}-${w}x${h}-s${seed}.png`), Buffer.from(shot.result.data, 'base64'));
    rows.push([`${w}x${h}`, label, m]);
  }
}

// ---- Evaluate the contract per row. -----------------------------------------------
function evaluateRow(m) {
  const fails = [];
  const vh = m.viewport[1];
  if (m.requestedSeed === null) {
    fails.push(`seed check n/a (base URL has no seed param): page reported seed ${m.seedReported}`);
  } else if (m.seedReported === null) {
    fails.push(`INVALID SEED: page reported no seed (New Run button not found), requested ${m.requestedSeed}`);
  } else if (m.seedReported !== m.requestedSeed) {
    fails.push(`INVALID SEED: page reported ${m.seedReported}, requested ${m.requestedSeed}`);
  }
  if (!m.endTurnFound) {
    fails.push('End Turn button NOT FOUND (separate from below-fold)');
  } else {
    if (m.endTurnBottom > vh) {
      fails.push(`End Turn below fold: bottom=${m.endTurnBottom} > innerHeight=${vh} (by ${m.endTurnBottom - vh}px)`);
    } else if (m.endTurnBottom > vh - END_TURN_CLEARANCE_PX) {
      fails.push(`End Turn clearance ${m.endTurnClearance}px < ${END_TURN_CLEARANCE_PX}px: bottom=${m.endTurnBottom} vs threshold bottom<=${vh - END_TURN_CLEARANCE_PX}`);
    }
    if (END_TURN_MUST_BE_ON_TOP && !m.endTurnOnTop) {
      fails.push(`End Turn NOT topmost at centre point (covered or centre off-viewport) at (${m.endTurnTop}->${m.endTurnBottom})`);
    }
  }
  if (m.pageScrollPx > PAGE_SCROLL_ALLOW_PX) {
    fails.push(`page scrolls: scrollHeight=${m.docScroll[1]} > innerHeight=${vh} (by ${m.pageScrollPx - PAGE_SCROLL_ALLOW_PX}px)`);
  }
  if (m.handRows > HAND_ROWS_MAX) {
    fails.push(`hand rows=${m.handRows} > ${HAND_ROWS_MAX}`);
  }
  if (m.stageClipPx === null) {
    fails.push('#stage NOT FOUND (cannot evaluate the stage-clip criterion)');
  } else if (m.stageClipPx > STAGE_CLIP_ALLOW_PX) {
    fails.push(`#stage clips content: scrollHeight-clientHeight=${m.stageClipPx}px > ${STAGE_CLIP_ALLOW_PX}px (overflow: hidden swallows it)`);
  }
  if (m.spillPx === null) {
    fails.push('#stage or .page-combat NOT FOUND (cannot evaluate the stage-spill criterion)');
  } else if (m.spillPx > STAGE_SPILL_ALLOW_PX) {
    fails.push(`stageSpillPx: #stage clips content: descendant spill=${m.spillPx}px > ${STAGE_SPILL_ALLOW_PX}px (deepest: ${m.spillWorst}; #stage is overflow: hidden and swallows it)`);
  }
  return fails;
}

const evaluated = rows.map(([size, label, m]) => [size, label, m, evaluateRow(m)]);
const failedRows = evaluated.filter(([, , , fails]) => fails.length > 0);

console.log('thresholds: EndTurn bottom <= innerHeight - ' + END_TURN_CLEARANCE_PX
  + ' | pageScrollHeight <= innerHeight + ' + PAGE_SCROLL_ALLOW_PX
  + ' | handRows <= ' + HAND_ROWS_MAX
  + ' | stageClipPx <= ' + STAGE_CLIP_ALLOW_PX
  + ' | spillPx <= ' + STAGE_SPILL_ALLOW_PX
  + ' | EndTurn topmost at centre: ' + END_TURN_MUST_BE_ON_TOP
  + ' | seed pinned: ' + (SEED_IN_URL ? 'yes' : 'no'));
console.log('base: ' + BASE_TEMPLATE + '  seeds: ' + SEEDS.join(','));
console.log('');
console.log('size         label            seed  reported  eTbot/vh  clear  scrollPx  handRows  stageClip  spillPx  onTop  result');
for (const [size, label, m] of evaluated) {
  console.log(
    size.padEnd(13) + label.padEnd(17) +
    String(m.requestedSeed === null ? 'n/a' : m.requestedSeed).padEnd(6) +
    String(m.seedReported === null ? '-' : m.seedReported).padEnd(10) +
    (m.endTurnFound ? `${m.endTurnBottom}/${m.viewport[1]}` : 'NOT FOUND').padEnd(10) +
    String(m.endTurnFound ? m.endTurnClearance : '-').padEnd(7) +
    String(m.pageScrollPx).padEnd(10) +
    String(m.handRows).padEnd(10) +
    String(m.stageClipPx === null ? '-' : m.stageClipPx).padEnd(11) +
    String(m.spillPx === null ? '-' : m.spillPx).padEnd(9) +
    String(m.endTurnFound ? m.endTurnOnTop : '-').padEnd(7) +
    (evaluated.find(r => r[2] === m)[3].length ? 'FAIL' : 'pass'),
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

// Per-kind minimum tappable box for the LAST row measured, so a failure names the element.
const last = evaluated[evaluated.length - 1][2];
console.log('\nper-kind min tappable box @ ' + evaluated[evaluated.length - 1][0] + ':', JSON.stringify(last.touchByKind));
if (diag) {
  console.log('\nper-block heights (app / hud / stage / combat-wrap / enemies / hand / controls / hint):');
  for (const [size, , m] of evaluated) {
    const b = m.blocks;
    console.log('  ' + size.padEnd(13) + pad(b.app) + ' ' + pad(b.hud) + ' ' + pad(b.stage) + ' ' + pad(b.combat) + '  ' + pad(b.enemies) + ' ' + pad(b.hand) + ' ' + pad(b.controls) + ' ' + pad(b.hint));
    console.log('      kids: ' + b.kids);
    console.log('      card=' + pad(b.card) + ' enemy=' + pad(b.enemy) + ' intent=' + pad(b.intent) + ' art=' + pad(b.art));
    console.log('      cardMinH=' + b.cardMinH + ' cardDescFs=' + b.cardDescFs + ' wrapMaxW=' + b.wrapMaxW + ' wrapMinH=' + b.wrapMinH);
  }
}
function pad(v) { return String(v === null ? '-' : v).padStart(5); }
console.log('\nscreenshots in shots/viewport/');

ws.close(); child.kill('SIGTERM');
process.exit(failedRows.length ? 1 : 0);
