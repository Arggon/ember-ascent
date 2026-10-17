#!/usr/bin/env node
// tools/dev/viewport-check.mjs — acceptance instrument for LAYOUT-ACCEPTANCE.md (frozen).
//
// Renders the combat screen at each release-bar size in real Chromium, evaluates the
// contract thresholds per viewport × seed row, and EXITS 1 if any row fails, 0 if all pass.
// A red run finally looks red.
//
// Seed pinning: this harness requests /web/index.html?seed=N directly. tools/serve.mjs
// 301-redirects /web/?seed=N to /web/?seed=N/ (slash appended INSIDE the query), which makes
// web/app.js seedFromUrl() compute Number("11/") = NaN and fall back to a random seed. After
// load the harness reads the seed the app itself reports from the "New Run" button title
// ("New run (seed NNNNNN) — keyboard: n", see web/app.js) and fails the row when it does not
// equal the requested seed.
//
// Usage:
//   node tools/dev/viewport-check.mjs                          # default matrix, seed 11
//   node tools/dev/viewport-check.mjs --seeds 1-12             # seed range
//   node tools/dev/viewport-check.mjs --seeds 3,7,11           # seed list (ranges may mix)
//   node tools/dev/viewport-check.mjs --sizes 1366x768,915x412 # subset of SIZES
//   node tools/dev/viewport-check.mjs --sizes 360x640@130,412x915@130 # large-font rows (text-scale.mjs)
//   node tools/dev/viewport-check.mjs --port 9400                # own DevTools port + profile
//   node tools/dev/viewport-check.mjs --base 'http://localhost:5173/web/index.html?seed={seed}'
//   node tools/dev/viewport-check.mjs --diag                   # + per-block height dump
// The old positional BASE argument still works:
//   node tools/dev/viewport-check.mjs http://localhost:5173/web/index.html?seed=11
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LARGE_FONT_SIZES, sizeKey, beginTextScale, endTextScale, TEXT_SCALE_PROBE, textScaleFailure } from './text-scale.mjs';

// ---- Acceptance thresholds (LAYOUT-ACCEPTANCE.md S1/S2/S3/S5). Adjust here, not below. ----
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
// Hand legibility (S2). Added after a 390x844 QA bug that every check above passed: card
// names broken mid-word, the fanned hand cut off at its left edge, rules text hidden under the
// next card, and the HUD hero name gone. Each is a hard fail; there is no tolerance to tune
// beyond the 1px rounding allowance in the measurement itself.
const NAME_MIDWORD_BREAKS_MAX = 0;  // no card-name word may lay out on more than one line
const CARDS_OUTSIDE_HAND_MAX = 0;   // every hand card inside the hand's visible box and viewport
const DESC_OCCLUDED_MAX = 0;        // both ends of every visible rules line must be on its card
const HERO_NAME_MIN_WIDTH = 381;    // from this width up the HUD shows the full hero name
const NAME_MIN_PX = 9;              // a hand card name is never set below 9px (QA floor)
// -------------------------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, 'shots/viewport');
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
let portArg = null, seedsArg = null, sizesArg = null, baseArg = null, diag = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--seeds') seedsArg = argv[++i];
  else if (argv[i] === '--sizes') sizesArg = argv[++i];
  else if (argv[i] === '--base') baseArg = argv[++i];
  else if (argv[i] === '--port') portArg = Number(argv[++i]);
  else if (argv[i] === '--diag') diag = true;
  else baseArg = baseArg || argv[i]; // old positional BASE still works
}

// --port: the DevTools port, with a profile dir named after it, so two runs on one machine
// (several agents share it) never attach to each other's browser.
const PORT = portArg || 9341, PROFILE = portArg ? '/tmp/dlb-viewport-' + portArg : '/tmp/dlb-viewport';

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
// Max-hand rows: the kernel caps the hand at 10 (src/kernel/rules/act.js and friends:
// `hand.length < 10`). No seed deals 10 on turn 1, so the harness builds the worst case from
// the real hand markup (see HAND_FIXTURE): ten card tiles carrying the card names with the
// longest single words in the card list. Phone sizes only: wider layouts have the room.
const MAX_HAND = 10;
const HAND_SIZES = [
  [360, 640, 'phone-small-hand10', MAX_HAND],
  [390, 844, 'iphone-14-hand10', MAX_HAND],
  [414, 896, 'phone-large-hand10', MAX_HAND],
];
// Rows are [w, h, label, textScale, handN]: every 100% row, then the large-font rows
// (tools/dev/text-scale.mjs: Gonzalo's rule, every build at 360-412dp with 130% text), then
// the 10-card hand at every phone size, at 100% and at 130%. --sizes takes "360x640",
// "360x640@130", "360x640+hand10" and "360x640@130+hand10".
const MATRIX = [
  ...SIZES.map(([w, h, label]) => [w, h, label, 1, 0]),
  ...LARGE_FONT_SIZES.map(([w, h, label, scale]) => [w, h, label, scale, 0]),
  ...HAND_SIZES.map(([w, h, label, n]) => [w, h, label, 1, n]),
  ...LARGE_FONT_SIZES.map(([w, h, label, scale]) => [w, h, label + '-hand10', scale, MAX_HAND]),
];
const keyOf = (w, h, scale, hand) => sizeKey(w, h, scale) + (hand ? `+hand${hand}` : '');
const SIZES_SEL = sizesArg
  ? MATRIX.filter(([w, h, , scale, hand]) => sizesArg.split(',').some((s) => s.trim() === keyOf(w, h, scale, hand)))
  : MATRIX;
// Grows the rendered hand to `n` tiles by cloning the app's own .card-wrap markup (so every
// class and rule is the real one), re-indexes the fan (--i on each wrap, --n on the hand, as
// web/app.js sets them) and puts the longest-word card names on them, longest first.
const LONG_NAMES = ['Hammerfall', 'Untempered', 'Overtemper', 'Returning Brand', 'Forgeclap',
  'Climbing Heat', 'Unbroken', 'Twin Hammers', 'Ash Embrace', 'Ash Harvest'];
const HAND_FIXTURE = (n) => `(() => {
  const hand = document.querySelector('.hand'); if (!hand) return 0;
  hand.classList.remove('deal-in');
  const src = [...hand.children];
  while (hand.children.length < ${n}) hand.append(src[hand.children.length % src.length].cloneNode(true));
  const names = ${JSON.stringify(LONG_NAMES)};
  [...hand.children].forEach((w, i) => {
    w.style.setProperty('--i', String(i));
    const nm = w.querySelector('.cname'); if (nm) nm.textContent = names[i % names.length];
  });
  hand.style.setProperty('--n', String(hand.children.length));
  hand.scrollLeft = 0;
  return hand.children.length;
})()`;
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
async function cycle(url) {
  await S('Page.navigate', { url });
  await waitFor(MAP_OR_KINDLING);
  await sleep(300);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url });
  await waitFor(MAP_OR_KINDLING);
  await sleep(300);
  // Kindling (v2/2): runs open on the act-start boon choice. Take the first boon (taking
  // one is mandatory; every boon keeps the 5-card opening hand) to reach the map.
  await ev(`(()=>{const b=document.querySelector('.kindling .boon');if(b)b.click();return 1})()`);
  await waitFor(MAP_READY);
  await sleep(300);
  // Travel into the first fight: the densest screen.
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`);
  await waitFor(FIGHT_READY);
  await sleep(1300);
}

const rows = [];
for (const [w, h, label, scale, handN] of SIZES_SEL) {
  const isPhone = w <= 500;
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
  await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
  for (const seed of SEEDS) {
    const url = urlFor(seed);
    const textScaleId = await beginTextScale(S, scale);
    await cycle(url);
    if (handN) { await ev(HAND_FIXTURE(handN)); await sleep(400); }

    const m = await ev(`(() => {
      const doc = document.documentElement;
      const vh = window.innerHeight, vw = window.innerWidth;
      const hand = document.querySelector('.hand');
      const cards = [...document.querySelectorAll('.card')];
      const stage = document.querySelector('#stage');
      const endTurn = [...document.querySelectorAll('button')].find(b => /end turn/i.test(b.textContent||''));
      // The seed the app itself reports (web/app.js sets this title from snap.seed).
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
      // Excluded: anything inside #fx-layer (a SIBLING of #stage per web/index.html, never
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
      // S2 legibility of the hand itself (added after the 390x844 QA bug: names broken
      // mid-word, the fan clipped at the hand's left edge, rules text hidden under the next
      // card, and the HUD hero name dropped -- while every metric above still passed).
      // handBox is what the hand actually shows: its own rect when it clips (overflow:
      // hidden), clamped to the viewport.
      const handBox = (() => {
        if (!hand) return [0, vw];
        const r = hand.getBoundingClientRect();
        const clips = getComputedStyle(hand).overflowX !== 'visible';
        return clips ? [Math.max(0, r.left), Math.min(vw, r.right)] : [0, vw];
      })();
      const handCards = hand ? [...hand.querySelectorAll('.card')] : [];
      // A hand that scrolls sideways (the max-hand layout) shows a window of its cards on
      // purpose: cards beyond the window are reached by scrolling, so they are not "cut off".
      // What must hold instead: at scroll 0 the FIRST card is whole, and the last card can be
      // scrolled fully into view (lastCardReach, measured after this snapshot).
      const handScrolls = !!hand && /auto|scroll/.test(getComputedStyle(hand).overflowX) && hand.scrollWidth > hand.clientWidth + 1;
      const inBox = (c) => { const r = c.getBoundingClientRect(); return r.left >= handBox[0] - 1 && r.right <= handBox[1] + 1; };
      const cardName = (c) => ((c.querySelector('.cname') || {}).textContent || '?').trim();
      const textNodes = (el) => {
        const out = []; const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let t;
        while ((t = tw.nextNode())) out.push(t);
        return out;
      };
      // A card outside the hand box is cut off on screen (rotation included: the bounding
      // rect of a transformed card covers its swung corners).
      const cardsOutside = handCards.map((c) => {
        const r = c.getBoundingClientRect();
        return cardName(c) + '[' + Math.round(r.left) + ',' + Math.round(r.right) + ']';
      }).filter((s, i) => (handScrolls ? i === 0 : true) && !inBox(handCards[i]));
      // A single word of a card name that lays out as more than one line fragment was broken
      // mid-word (overflow-wrap: anywhere / break-word kicks in only when the word cannot fit).
      const nameBreaks = [];
      for (const c of handCards) {
        const n = c.querySelector('.cname'); if (!n) continue;
        for (const t of textNodes(n)) {
          const re = /\\S+/g; let mm;
          while ((mm = re.exec(t.data))) {
            const rg = document.createRange();
            rg.setStart(t, mm.index); rg.setEnd(t, mm.index + mm[0].length);
            const frags = [...rg.getClientRects()].filter((x) => x.width > 0.5).length;
            if (frags > 1) nameBreaks.push(cardName(c) + ': "' + mm[0] + '" on ' + frags + ' lines');
          }
        }
        // A name too wide for the card does not break (overflow-wrap: normal): it pushes the card's
        // grid track wider and is clipped by the card ("HAMMERFAL" at 130% text). Its widest line
        // must fit the card's content box (clientWidth is untransformed; a fanned card's range
        // rects grow by well under 1px at these angles, inside the 1px allowance).
        const ccs = getComputedStyle(c);
        const contentW = c.clientWidth - parseFloat(ccs.paddingLeft) - parseFloat(ccs.paddingRight);
        const rgN = document.createRange(); rgN.selectNodeContents(n);
        const widest = Math.max(0, ...[...rgN.getClientRects()].map((x) => x.width));
        if (widest > contentW + 1) nameBreaks.push(cardName(c) + ': ' + Math.round(widest) + 'px wide in a ' + Math.round(contentW) + 'px card (clipped)');
      }
      // Rules text must be visible: for every rendered line inside the (line-clamped) rules
      // box, both ends of the line must hit this card (not a neighbour, not off-screen).
      const descOccluded = [];
      for (const c of handCards) {
        const d = c.querySelector('.cdesc'); if (!d) continue;
        if (handScrolls && !inBox(c)) continue; // scrolled out of the window, by design
        const wrap = c.closest('.card-wrap') || c;
        const box = d.getBoundingClientRect();
        let bad = 0;
        // Lines past the -webkit-line-clamp count are not painted (line N ends in an ellipsis)
        // but still have rects, so only the first N laid-out lines are checked.
        const dcs = getComputedStyle(d);
        const clampN = parseInt(dcs.webkitLineClamp, 10) || Infinity;
        const rects = [];
        for (const t of textNodes(d)) {
          if (!t.data.trim()) continue;
          const rg = document.createRange(); rg.selectNodeContents(t);
          for (const x of rg.getClientRects()) if (x.width >= 1) rects.push(x);
        }
        const lineTops = [];
        for (const x of [...rects].sort((a, b) => a.top - b.top)) {
          if (!lineTops.length || x.top - lineTops[lineTops.length - 1] > 2) lineTops.push(x.top);
        }
        const lastShownTop = lineTops[Math.min(clampN, lineTops.length) - 1];
        // The visible window is the rules box clipped by its card (the card has a max-height and
        // overflow: hidden too). A shown line whose glyph box crosses that window's edge is cut
        // off (Anvil Blow's 4th line "Apply 2" half-drawn at 360x640). Glyph boxes are taller than
        // line boxes when line-height < ~1.3, so the allowance is that difference plus 1px.
        const cbox = c.getBoundingClientRect();
        const winTop = Math.max(box.top, cbox.top), winBottom = Math.min(box.bottom, cbox.bottom);
        const lh = parseFloat(dcs.lineHeight) || parseFloat(dcs.fontSize) * 1.2;
        const cutLines = new Set();
        for (const x of rects) {
          if (lastShownTop === undefined || x.top > lastShownTop + 2) continue; // clamped away
          const y = (x.top + x.bottom) / 2;
          const slack = Math.max(0, (x.height - lh) / 2) + 1;
          if (x.bottom > winBottom + slack || x.top < winTop - slack) { cutLines.add(Math.round(x.top)); continue; }
          for (const px of [x.left + 1.5, x.right - 1.5]) {
            const hit = (px >= 0 && px <= vw && y >= 0 && y <= vh) ? document.elementFromPoint(px, y) : null;
            // A bare .card-wrap or the hand itself is transparent (a neighbour's unrotated hit
            // box); anything inside ANOTHER card, or outside the hand, hides the text.
            const other = hit && hit.closest('.card');
            const ok = hit && (wrap.contains(hit) || (!other && hit.closest('.hand')));
            if (!ok) bad++;
          }
        }
        if (cutLines.size) descOccluded.push(cardName(c) + ' (' + cutLines.size + ' of its first ' + (clampN === Infinity ? 'all' : clampN) + ' lines cut off by the card/rules box)');
        if (bad) descOccluded.push(cardName(c) + ' (' + bad + ' line end(s) hidden)');
      }
      // The HUD hero name: dropped by design only below 381px wide (no room at 360px).
      const heroEl = document.querySelector('.hud-char');
      const heroName = !heroEl ? 'missing'
        : !heroEl.getClientRects().length ? 'hidden'
        : heroEl.scrollWidth > heroEl.clientWidth + 1 ? 'truncated' : 'shown';
      const nameSmall = handCards.map((c) => { const n = c.querySelector('.cname'); return n ? cardName(c) + ' ' + parseFloat(getComputedStyle(n).fontSize).toFixed(1) + 'px' : null; })
        .filter((x, i) => x && parseFloat(getComputedStyle(handCards[i].querySelector('.cname')).fontSize) < ${NAME_MIN_PX} - 0.05);
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
        cardsOutside,
        nameBreaks,
        descOccluded,
        heroName,
        nameSmall,
        handCount: handCards.length,
        handScrolls,
        handBox: handBox.map(Math.round),
        cardsClipped: cards.filter(c => c.getBoundingClientRect().right > (hand ? hand.getBoundingClientRect().right + 1 : vw)).length,
        lastCardBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null,
        stageBottom: stage ? Math.round(stage.getBoundingClientRect().bottom) : null,
        // S2/S3: #stage is overflow: hidden (web/style.css:210), so content taller than the
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
    m.requested = [w, h];
    const ts = await ev(TEXT_SCALE_PROBE);
    m.textScale = scale; m.textScaleApplied = ts.applied; m.rootFontPx = ts.rootPx;
    m.label = label;
    const shot = await S('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(OUT, `${label}-${sizeKey(w, h, scale).replace('@', '-at')}-s${seed}.png`), Buffer.from(shot.result.data, 'base64'));
    m.handWanted = handN;
    // A hand that scrolls must reach its last card: scroll to the end, check that card sits
    // fully inside the hand's box, and scroll back.
    m.lastCardReach = await ev(`(() => {
      const hand = document.querySelector('.hand'); if (!hand || hand.scrollWidth <= hand.clientWidth + 1) return null;
      hand.scrollLeft = hand.scrollWidth;
      const hb = hand.getBoundingClientRect(), last = hand.lastElementChild.querySelector('.card').getBoundingClientRect();
      const ok = last.left >= Math.max(0, hb.left) - 1 && last.right <= Math.min(innerWidth, hb.right) + 1;
      const out = ok ? 'ok' : Math.round(last.left) + ',' + Math.round(last.right) + ' vs [' + Math.round(hb.left) + ',' + Math.round(hb.right) + ']';
      hand.scrollLeft = 0;
      return out;
    })()`);
    await endTextScale(S, textScaleId);
    rows.push([keyOf(w, h, scale, handN), label, m]);
  }
}

// ---- Evaluate the contract per row. -----------------------------------------------
function evaluateRow(m) {
  const fails = [];
  const tsFail = textScaleFailure(m);
  if (tsFail) fails.push(tsFail);
  // A mobile page wider than the screen is zoomed out to fit, so innerWidth/innerHeight come
  // back LARGER than the device and every other number is measured on a shrunken page.
  if (m.viewport[0] !== m.requested[0] || m.viewport[1] !== m.requested[1]) {
    fails.push(`page wider than the screen: rendered viewport ${m.viewport.join('x')} != device ${m.requested.join('x')} (mobile zooms out to fit)`);
  }
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
  if (m.nameBreaks.length > NAME_MIDWORD_BREAKS_MAX) {
    fails.push(`card name broken mid-word or clipped: ${m.nameBreaks.join('; ')}`);
  }
  if (m.cardsOutside.length > CARDS_OUTSIDE_HAND_MAX) {
    fails.push(`hand card(s) cut off outside the visible hand box [${m.handBox.join(',')}]: ${m.cardsOutside.join(' ')}`);
  }
  if (m.descOccluded.length > DESC_OCCLUDED_MAX) {
    fails.push(`rules text hidden (covered or off-screen): ${m.descOccluded.join('; ')}`);
  }
  if (m.handWanted && m.handCount !== m.handWanted) {
    fails.push(`max-hand fixture lost: wanted ${m.handWanted} cards, measured ${m.handCount} (the app re-rendered the hand)`);
  }
  if (m.nameSmall.length) {
    fails.push(`card name below ${NAME_MIN_PX}px: ${m.nameSmall.join('; ')}`);
  }
  if (m.lastCardReach !== null && m.lastCardReach !== 'ok') {
    fails.push(`scrolling hand cannot bring its last card fully into view: ${m.lastCardReach}`);
  }
  if (m.viewport[0] >= HERO_NAME_MIN_WIDTH && m.heroName !== 'shown') {
    fails.push(`HUD hero name ${m.heroName} at ${m.viewport[0]}px wide (must be shown in full from ${HERO_NAME_MIN_WIDTH}px)`);
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
  + ' | name mid-word breaks <= ' + NAME_MIDWORD_BREAKS_MAX
  + ' | cards outside hand <= ' + CARDS_OUTSIDE_HAND_MAX
  + ' | rules lines hidden <= ' + DESC_OCCLUDED_MAX
  + ' | hero name shown from ' + HERO_NAME_MIN_WIDTH + 'px'
  + ' | card names >= ' + NAME_MIN_PX + 'px'
  + ' | seed pinned: ' + (SEED_IN_URL ? 'yes' : 'no'));
console.log('base: ' + BASE_TEMPLATE + '  seeds: ' + SEEDS.join(','));
console.log('');
console.log('size                label                       seed  reported  eTbot/vh  clear  scrollPx  handRows  stageClip  spillPx  onTop  result');
for (const [size, label, m] of evaluated) {
  console.log(
    size.padEnd(20) + label.padEnd(28) +
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
