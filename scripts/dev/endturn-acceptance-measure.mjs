#!/usr/bin/env node
// scripts/dev/endturn-acceptance-measure.mjs — an INDEPENDENT measurement of one acceptance
// question at four viewports:
//
//   At load of the combat screen, is the End Turn control fully visible AND clickable,
//   is the hand a single row, is no viewport scrolling needed, and is nothing clipped?
//
// WHY THIS IS NOT A RERUN OF viewport-check.mjs / space-check.mjs
// ---------------------------------------------------------------
// 1. An ABSENT End Turn control is reported as `present: false` and fails, instead of being
//    folded into a single boolean that reads "false" for two very different faults (the
//    button exists but sits below the fold vs. the button does not exist in this state).
// 2. Clickability is a HIT TEST, not a geometry inference: `document.elementFromPoint` at
//    the control's own centre plus four 20%-inset corner probes, recording the descriptor of
//    whatever IS topmost. Geometry and hit test are reported side by side, so the case
//    "rect says inside the viewport but the hit test says something else" (i.e. clipped by an
//    `overflow: hidden` ancestor, or covered by an overlay) is visible rather than averaged
//    away. `elementFromPoint` is the browser's own hit test and it does skip
//    `pointer-events: none`; a non-topmost result means a real click would not land.
// 3. Clickability is FALSIFIED BY ACTUALLY CLICKING: a real CDP mouse press/release at the
//    centre, then a before/after comparison of the HUD step counter. Taken last, so it can
//    never contaminate the static numbers.
// 4. Hand rows are counted by vertical-overlap clustering of the REAL `.card-wrap` rects
//    (a band is a row), not by counting distinct rounded `top` values, which under-counts
//    rows whose tops differ by a sub-pixel and cannot see a wrapped row at all.
// 5. Document scrolling is measured by ACTUALLY SCROLLING (`window.scrollTo(0, 1e6)` and
//    reading back `scrollingElement.scrollTop`), not by comparing scrollHeight to
//    innerHeight — the comparison cannot tell a genuinely scrollable document from a
//    clipped one, and this criterion is about scrolling.
// 6. `#stage` clipping is measured as scrollHeight - clientHeight AND cross-checked against
//    every descendant's own rect against the stage's client rect, so "clipped" is attributed
//    to an element, not just to a difference in numbers.
// 7. Animations are driven to quiescence (`document.getAnimations()` running count == 0)
//    before any geometry is read, and every viewport is measured TWICE from two fresh
//    navigations; the run reports whether the two passes agreed, so a number here is not a
//    lucky frame.
// 8. The first-run help modal is suppressed by pre-seeding `dlb.helpSeen.v1` (the same end
//    state the other harnesses reach by dismissing it) so no modal sits over the control,
//    and how the fight is reached is an explicit real click on `.node.available`.
//
// READ-ONLY: writes nothing but its own report under shots/acceptance/.
//
// Usage: node scripts/dev/endturn-acceptance-measure.mjs [URL]
//        default URL http://localhost:5173/web/?seed=11   (dev server: node scripts/serve.mjs)
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, 'shots/acceptance');
mkdirSync(OUT, { recursive: true });
const PORT = 9300 + (process.pid % 600);
const PROFILE = `/tmp/dlb-acc-measure-${process.pid}`;
// `--passes N` reruns every viewport N times from fresh navigations; `--only LABEL` restricts
// to one viewport (used to characterise a viewport whose passes disagreed). A bare positional
// argument is the URL; flag values are excluded from that.
const argv = process.argv.slice(2);
const flagValue = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const PASSES = (() => { const v = flagValue('--passes'); return v === null ? 2 : Number(v); })();
const ONLY = flagValue('--only');
const FLAG_VALUES = new Set([flagValue('--passes'), ONLY].filter((v) => v !== null));
// NOTE ON THE URL FORM (and why this harness does NOT use the same URL string the other
// harnesses use). The dev server 301-redirects a directory request without a trailing slash
// to one WITH a trailing slash, and it appends that slash to the QUERY, not the path:
//
//   GET /src/web/?seed=11  ->  301  Location: /src/web/?seed=11/
//
// so the page's own `location.search` becomes `?seed=11/`, `Number("11/")` is NaN, and
// `seedFromUrl()` (src/web/app.js:86-91) falls through to `Math.floor(Math.random()*1000000)`.
// The page then runs a DIFFERENT RANDOM RUN on every navigation, and the seed in the URL
// silently does nothing. Measured directly: three navigations to /src/web/?seed=11 reported
// "New run (seed 348027)", "(seed 953098)", "(seed 317344)" — three different runs — while
// four navigations to /src/web/index.html?seed=11 all reported "New run (seed 11)" and the same
// encounter. Every pass below asserts the seed the page ITSELF reports, so a random run
// can never be mistaken for this viewport again.
const SEED_URL = argv.find((a) => !a.startsWith('--') && !FLAG_VALUES.has(a)) || 'http://localhost:5173/web/index.html?seed=11';
const REQUESTED_SEED = new URL(SEED_URL).searchParams.get('seed');

// The four viewports under question, in the order the acceptance question lists them.
const ALL_SIZES = [
  [915, 412, 'galaxy-s25u-landscape'],
  [1200, 450, 'short-desktop-window'],
  [1366, 768, 'laptop'],
  [360, 640, 'phone-small'],
];
const SIZES = ONLY ? ALL_SIZES.filter((s) => s[2] === ONLY) : ALL_SIZES;
if (SIZES.length === 0) throw new Error(`--only ${ONLY} matched no viewport`);

let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =====================================================================================
 * PAGE-SIDE MEASUREMENT — a self-contained function, injected by source, so every regex
 * and escape is ordinary JavaScript in this file rather than a doubly-escaped string.
 * =================================================================================== */
function pageMeasure() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const de = document.documentElement;
  const se = document.scrollingElement || de;
  const body = document.body;

  const desc = (el) => {
    if (!el) return 'null';
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls.length ? '.' + cls.join('.') : '');
  };
  const r2 = (r) => ({
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    left: Math.round(r.left), right: Math.round(r.right),
    width: Math.round(r.width), height: Math.round(r.height),
  });
  const rectOf = (el) => (el ? r2(el.getBoundingClientRect()) : null);

  // --- CSS clipping chain -----------------------------------------------------------------
  // "Clipped" is measured against the CSS definition: an ancestor with overflow != visible
  // clips its descendants at its PADDING BOX (not the border box, and not the content box).
  // For each element of interest this walks the ancestor chain, finds every clipping box, and
  // reports the px by which the element's own rect escapes it — naming the ancestor. A
  // positive number here means the element is not drawn, which is a stronger and more exact
  // statement than "scrollHeight exceeded clientHeight somewhere in this subtree".
  const paddingBox = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const num = (v) => parseFloat(v) || 0;
    return {
      top: r.top + num(cs.borderTopWidth), left: r.left + num(cs.borderLeftWidth),
      right: r.right - num(cs.borderRightWidth), bottom: r.bottom - num(cs.borderBottomWidth),
      name: desc(el),
    };
  };
  const clipChain = (el) => {
    const r = el.getBoundingClientRect();
    const boxes = [];
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const pb = paddingBox(n);
      const over = {
        ancestor: pb.name,
        overTop: Math.round(Math.max(0, pb.top - r.top)),
        overBottom: Math.round(Math.max(0, r.bottom - pb.bottom)),
        overLeft: Math.round(Math.max(0, pb.left - r.left)),
        overRight: Math.round(Math.max(0, r.right - pb.right)),
        ancestorOverflow: cs.overflowX + '/' + cs.overflowY,
        isFixed: cs.position === 'fixed',
      };
      if (over.overTop || over.overBottom || over.overLeft || over.overRight) boxes.push(over);
    }
    const overViewport = {
      overTop: Math.round(Math.max(0, -r.top)), overBottom: Math.round(Math.max(0, r.bottom - vh)),
      overLeft: Math.round(Math.max(0, -r.left)), overRight: Math.round(Math.max(0, r.right - vw)),
    };
    const total = boxes.reduce((a, b) => a + b.overTop + b.overBottom + b.overLeft + b.overRight, 0)
      + overViewport.overTop + overViewport.overBottom + overViewport.overLeft + overViewport.overRight;
    return { clippedPx: total, byAncestors: boxes, byViewport: overViewport };
  };

  // --- document scrolling: MEASURED by scrolling, never inferred from scrollHeight ------
  const startY = se.scrollTop, startX = se.scrollLeft;
  window.scrollTo(0, 999999);
  const maxScrollY = Math.round(se.scrollTop);
  window.scrollTo(999999, 0);
  const maxScrollX = Math.round(se.scrollLeft);
  window.scrollTo(startX, startY);
  const restored = Math.round(se.scrollTop);

  // --- rows: cluster REAL rects by vertical overlap; a band is a row --------------------
  const bands = (els) => {
    const rs = els.map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .sort((a, b) => a.top - b.top);
    const out = [];
    for (const r of rs) {
      const hit = out.find((b) => r.top < b.bottom - 1 && r.bottom > b.top + 1);
      if (hit) {
        hit.top = Math.min(hit.top, r.top);
        hit.bottom = Math.max(hit.bottom, r.bottom);
        hit.n += 1;
      } else {
        out.push({ top: r.top, bottom: r.bottom, n: 1 });
      }
    }
    return out.map((b) => ({ top: Math.round(b.top), bottom: Math.round(b.bottom), members: b.n }));
  };

  // --- hit test ------------------------------------------------------------------------
  const probe = (target, x, y) => {
    const el = document.elementFromPoint(x, y);
    return { x: Math.round(x), y: Math.round(y), topmost: desc(el), isTarget: !!el && (el === target || target.contains(el)) };
  };

  const endTurn = [...document.querySelectorAll('button')]
    .find((b) => String(b.textContent || '').toLowerCase().includes('end turn')) || null;

  let endTurnRep;
  if (!endTurn) {
    endTurnRep = {
      present: false,
      failingBecause: 'no <button> whose text contains "end turn" exists in this state — the criterion cannot be met by an absent control',
    };
  } else {
    const r = endTurn.getBoundingClientRect();
    const cs = getComputedStyle(endTurn);
    const centre = probe(endTurn, r.left + r.width / 2, r.top + r.height / 2);
    const corners = [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]
      .map(([fx, fy]) => probe(endTurn, r.left + r.width * fx, r.top + r.height * fy));
    endTurnRep = {
      present: true,
      text: String(endTurn.textContent || '').trim(),
      selector: '.stage-combat .controls > button.btn (matched by visible text)',
      rect: r2(r),
      // geometric verdict
      withinViewportY: r.top >= -0.5 && r.bottom <= vh + 0.5,
      withinViewportX: r.left >= -0.5 && r.right <= vw + 0.5,
      pxBelowViewportBottom: Math.round(Math.max(0, r.bottom - vh)),
      pxAboveViewportTop: Math.round(Math.max(0, -r.top)),
      pxRightOfViewportRight: Math.round(Math.max(0, r.right - vw)),
      // interactive verdict
      disabled: !!endTurn.disabled,
      pointerEvents: cs.pointerEvents,
      visibility: cs.visibility,
      display: cs.display,
      opacity: cs.opacity,
      inViewportIntersectionPct: (() => {
        const vis = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
        return Math.round((vis / Math.max(1, r.width * r.height)) * 100);
      })(),
      centreProbe: centre,
      cornerProbes: corners,
      allProbesHitTarget: centre.isTarget && corners.every((c) => c.isTarget),
      // Is the control itself clipped (by #stage's overflow:hidden, or by the window)?
      clip: clipChain(endTurn),
      clearanceBelowPx: Math.round(vh - r.bottom),   // positive = spare room; negative = below the fold
      clearanceRightPx: Math.round(vw - r.right),
    };
  }

  // --- #stage clipping ------------------------------------------------------------------
  const stage = document.getElementById('stage');
  let stageRep = null;
  if (stage) {
    const sr = stage.getBoundingClientRect();
    const past = [];
    for (const el of stage.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const cc = clipChain(el);
      if (cc.clippedPx === 0) continue;
      past.push({ el: desc(el), clippedPx: cc.clippedPx, byAncestors: cc.byAncestors, byViewport: cc.byViewport });
    }
    past.sort((a, b) => b.clippedPx - a.clippedPx);
    const stageCs = getComputedStyle(stage);
    stageRep = {
      rect: r2(sr),
      paddingBox: (() => { const pb = paddingBox(stage); return { top: Math.round(pb.top), bottom: Math.round(pb.bottom), left: Math.round(pb.left), right: Math.round(pb.right) }; })(),
      clientHeight: stage.clientHeight,
      scrollHeight: stage.scrollHeight,
      clippedByY: stage.scrollHeight - stage.clientHeight,
      clientWidth: stage.clientWidth,
      scrollWidth: stage.scrollWidth,
      clippedByX: stage.scrollWidth - stage.clientWidth,
      overflowStyle: stageCs.overflowX + ' / ' + stageCs.overflowY,
      bottomPastViewportPx: Math.round(Math.max(0, sr.bottom - vh)),
      descendantsClippedByOverflow: past.length,
      worstDescendants: past.slice(0, 8),
    };
  }

  const hand = document.querySelector('.hand');
  const wraps = [...document.querySelectorAll('.card-wrap')];
  const controls = document.querySelector('.controls');
  const hint = document.querySelector('.hint');

  return {
    viewport: { innerWidth: vw, innerHeight: vh, outerWidth: window.outerWidth, outerHeight: window.outerHeight, dpr: window.devicePixelRatio },
    visualViewport: window.visualViewport
      ? { width: Math.round(window.visualViewport.width), height: Math.round(window.visualViewport.height), scale: window.visualViewport.scale }
      : null,
    document: {
      scrollingElement: desc(se),
      docClientHeight: de.clientHeight,
      docScrollHeight: de.scrollHeight,
      docClientWidth: de.clientWidth,
      docScrollWidth: de.scrollWidth,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      scrollHeightMinusInnerHeight: de.scrollHeight - vh,
      maxScrollY,
      maxScrollX,
      scrollRestoredTo: restored,
      scrollsVertically: maxScrollY > 0,
      scrollsHorizontally: maxScrollX > 0,
    },
    endTurn: endTurnRep,
    hand: {
      present: !!hand,
      rect: rectOf(hand),
      cardWrapCount: wraps.length,
      cardTexts: wraps.map((w) => String((w.querySelector('.card-name') || w).textContent || '').trim().slice(0, 24)),
      rowsByRectOverlap: bands(wraps).length,
      rowBands: bands(wraps),
      distinctRoundedTops: new Set(wraps.map((w) => Math.round(w.getBoundingClientRect().top))).size,
      wrapRects: wraps.map((w) => rectOf(w)),
      handScrollWidth: hand ? hand.scrollWidth : null,
      handClientWidth: hand ? hand.clientWidth : null,
      handClippedByX: hand ? hand.scrollWidth - hand.clientWidth : null,
      firstWrapLeft: wraps.length ? rectOf(wraps[0]).left : null,
      lastWrapRight: wraps.length ? rectOf(wraps[wraps.length - 1]).right : null,
      // Is any CARD actually clipped, by the hand's own box or by any clipping ancestor?
      wrapClip: wraps.map((w, i) => ({ i, clippedPx: clipChain(w).clippedPx, byAncestors: clipChain(w).byAncestors })),
      worstWrapClippedPx: wraps.length ? Math.max(...wraps.map((w) => clipChain(w).clippedPx)) : null,
      overflowStyle: hand ? getComputedStyle(hand).overflowX + '/' + getComputedStyle(hand).overflowY : null,
    },
    controls: { rect: rectOf(controls) },
    hint: { rect: rectOf(hint) },
    enemies: [...document.querySelectorAll('.enemy')].map((e) => ({
      text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), rect: rectOf(e),
    })),
    // The measured vertical stack, so a run-to-run difference can be localised to a block
    // instead of being reported as one unexplained number. Heights and tops only.
    stack: [['#hud', '#hud'], ['#stage', '#stage'], ['.page-combat', '.page-combat'], ['.enemies', '.enemies'],
      ['.hand', '.hand'], ['.controls', '.controls'], ['.hint', '.hint'], ['.e-art', '.e-art']].map(([name, sel]) => {
      const el = document.querySelector(sel);
      if (!el) return { name, absent: true };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        name, top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
        cssHeight: cs.height, minHeight: cs.minHeight, flex: cs.flex, display: cs.display,
      };
    }),
    appComputed: (() => {
      const el = document.getElementById('app');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { height: cs.height, minHeight: cs.minHeight, display: cs.display, flex: cs.flex, padding: cs.padding };
    })(),
    stage: stageRep,
    hud: { rect: rectOf(document.getElementById('hud')) },
    app: { rect: rectOf(document.getElementById('app')) },
    phase: (hudStepText(), String((document.querySelector('.hud-step') || {}).textContent || '')),
    hudStep: String((document.querySelector('.hud-step') || {}).textContent || ''),
    runningAnimations: document.getAnimations ? document.getAnimations().filter((a) => a.playState === 'running').length : -1,
  };

  function hudStepText() { return String((document.querySelector('.hud-step') || {}).textContent || ''); }
}

/* =====================================================================================
 * CDP plumbing
 * =================================================================================== */
if (existsSync(PROFILE)) rmSync(PROFILE, { recursive: true, force: true });
const child = spawn('chromium', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
  '--disable-lcd-text', '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--window-size=1600,1000', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

const wsUrl = await new Promise((res, rej) => {
  const on = (b) => { const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(b)); if (m) res(m[1]); };
  child.stderr.on('data', on); child.stdout.on('data', on);
  setTimeout(() => rej(new Error('no DevTools endpoint within 25s')), 25000);
});

// A watchdog, so a wedged browser exits with a diagnostic instead of hanging the run.
const WATCHDOG_MS = 20 * 60 * 1000;
setTimeout(() => {
  console.error(`WATCHDOG: no result after ${WATCHDOG_MS / 1000}s — killing chromium and exiting 2`);
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  process.exit(2);
}, WATCHDOG_MS).unref();

const ws = new WebSocket(wsUrl);
const pend = new Map();
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
ws.addEventListener('message', (m) => {
  const x = JSON.parse(m.data);
  if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); }
});
const send = (method, params = {}, sessionId) => {
  const i = id++;
  ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  // Every CDP call is bounded: a wedged renderer surfaces as an error naming the method
  // rather than as a run that never returns.
  return Promise.race([
    new Promise((r) => pend.set(i, r)),
    new Promise((_, rej) => setTimeout(() => { pend.delete(i); rej(new Error(`CDP timeout 30s: ${method}`)); }, 30000)),
  ]);
};
const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
const S = (m, p) => send(m, p, sessionId);
await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
// Pre-seed the "help already seen" flag on every new document (registered ONCE), so the
// first-run modal is never over the board. Same end state the other harnesses reach by
// dismissing it; done this way so no click lands on a modal in a pass that races the boot.
await S('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{}`,
});
const browserVersion = (await send('Browser.getVersion')).result;

const ev = async (expr) => {
  const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('page exception: ' + (d.exception?.description || d.text || JSON.stringify(d)));
  }
  return r.result?.result?.value;
};
const measure = () => ev(`(${pageMeasure.toString()})()`);

// Real input, so "clickable" is falsifiable rather than asserted.
const realClick = async (x, y) => {
  const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, pointerType: 'mouse' };
  await S('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' });
  await S('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
  await S('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
};

const rectCentre = async (sel) => ev(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
})()`);

const waitAnimationsSettled = async (ms = 4000) => {
  const t0 = Date.now();
  let n = -1;
  while (Date.now() - t0 < ms) {
    n = await ev(`document.getAnimations ? document.getAnimations().filter(a => a.playState === 'running').length : 0`);
    if (n === 0) break;
    await sleep(100);
  }
  return n;
};

console.log(`# independent End Turn acceptance measurement`);
console.log(`# chromium : ${browserVersion.product} (${browserVersion.revision ? 'rev ' + browserVersion.revision.match(/\w{8}/) : 'n/a'})`);
console.log(`# url      : ${SEED_URL}`);
console.log(`# passes   : ${PASSES} fresh navigations per viewport${ONLY ? ` (--only ${ONLY})` : ''}\n`);

const report = {
  question: 'Is End Turn fully visible and clickable at load, is the hand one row, is no viewport scrolling needed, and is nothing clipped?',
  seedUrl: SEED_URL,
  requestedSeed: REQUESTED_SEED,
  browser: browserVersion,
  method: {
    clickability: 'document.elementFromPoint at the control centre + four 20%-inset corner probes, then a REAL CDP mouse press/release at the centre with a before/after HUD step comparison',
    scroll: 'window.scrollTo(0,1e6) / (1e6,0) then reading scrollingElement.scrollTop/scrollLeft back',
    handRows: 'vertical-overlap clustering of the real .card-wrap getBoundingClientRect() boxes',
    stageClipping: '#stage scrollHeight - clientHeight, plus, for every element of interest, a walk of its ancestor chain that finds each overflow != visible clipping box and measures in px how far the element rect escapes that box (CSS clips at the PADDING box), plus the same against the window rect',
    variance: 'each viewport is measured from N independent fresh navigations; the report lists every pass, not just a consensus, and states whether they agreed',
    settling: 'polled document.getAnimations() until the running count reached 0',
    caveat: 'chromium launched with --hide-scrollbars, so a classic scrollbar never consumes layout width; the page-scroll question is answered by measured scrollTop reach, which is independent of that flag',
  },
  viewports: [],
};

for (const [w, h, label] of SIZES) {
  const passes = [];
  for (let pass = 1; pass <= PASSES; pass++) {
    const isPhone = w <= 500;
    await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
    await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
    // The help flag is seeded by the new-document script registered once before the loop.
    await S('Page.navigate', { url: SEED_URL });
    // Wait for the board to exist rather than guessing at a sleep.
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < 10000) {
      ready = await ev(`!!document.querySelector('.node.available') || !!document.querySelector('.stage-combat')`);
      if (ready) break;
      await sleep(100);
    }
    if (!ready) throw new Error(`at ${w}x${h}: page never rendered a map node or combat view within 10s`);

    const phaseBeforeTravel = await ev(`String((document.querySelector('.hud-step')||{}).textContent||'')`);
    const helpSeen = await ev(`!!document.querySelector('.modal-back')`);
    // THE CONTROL: the seed the page itself reports, read from the New Run button's title
    // (src/web/app.js:792). If this does not match the requested seed, the run is random and
    // nothing else measured in this pass is a measurement of the requested seed.
    const seedShown = await ev(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => /new run/i.test(x.textContent || ''));
      const m = b ? /seed (-?\\d+)/.exec(b.getAttribute('title') || '') : null;
      return { raw: b ? b.getAttribute('title') : null, seed: m ? Number(m[1]) : null, href: location.href, search: location.search };
    })()`);
    const seedHonoured = REQUESTED_SEED === null ? null : String(seedShown.seed) === String(REQUESTED_SEED);

    // Travel into the first fight with a REAL click on the map node.
    let travel = { attempted: false };
    const node = await rectCentre('.node.available');
    if (node) {
      // Which node this is, recorded verbatim: if two passes click different nodes, the
      // encounters differ and any geometry comparison between them would be meaningless.
      const nodeInfo = await ev(`(() => {
        const n = document.querySelector('.node.available');
        return n ? { text: String(n.textContent||'').replace(/\\s+/g,' ').trim(), title: n.getAttribute('title') } : null;
      })()`);
      const availCount = await ev(`document.querySelectorAll('.node.available').length`);
      const availList = await ev(`[...document.querySelectorAll('.node.available')].map(n => String(n.textContent||'').replace(/\\s+/g,' ').trim())`);
      await realClick(node.x, node.y);
      travel = {
        attempted: true, at: { x: Math.round(node.x), y: Math.round(node.y) }, nodeBox: { w: node.w, h: node.h },
        nodeInfo, availableNodeCount: availCount, availableNodes: availList,
      };
      const t1 = Date.now();
      while (Date.now() - t1 < 8000) {
        if (await ev(`!!document.querySelector('.stage-combat')`)) break;
        await sleep(100);
      }
    }
    travel.reachedCombat = await ev(`!!document.querySelector('.stage-combat')`);
    travel.stepBefore = phaseBeforeTravel;
    travel.stepAfter = await ev(`String((document.querySelector('.hud-step')||{}).textContent||'')`);
    travel.enemiesEntered = await ev(`[...document.querySelectorAll('.enemy')].map(e => String(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40))`);

    const runningAnimations = await waitAnimationsSettled();
    const before = await measure();
    const clickBefore = before.hudStep;

    // --- falsify clickability by actually clicking the centre ---
    let realClickResult = { performed: false };
    if (before.endTurn && before.endTurn.present) {
      const { left, top, width, height } = before.endTurn.rect;
      await realClick(left + width / 2, top + height / 2);
      await sleep(1200);
      const after = await ev(`String((document.querySelector('.hud-step')||{}).textContent||'')`);
      realClickResult = {
        performed: true,
        at: { x: Math.round(left + width / 2), y: Math.round(top + height / 2) },
        hudStepBefore: clickBefore,
        hudStepAfter: after,
        stateChanged: after !== clickBefore,
      };
    } else {
      realClickResult = { performed: false, reason: 'no End Turn control present, so there was nothing to click' };
    }

    const geometryAfterClick = await ev(`(() => {
      const e = [...document.querySelectorAll('button')].find(b => String(b.textContent||'').toLowerCase().includes('end turn'));
      if (!e) return { endTurnPresentAfterClick: false };
      const r = e.getBoundingClientRect();
      return { endTurnPresentAfterClick: true, rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) } };
    })()`);

    passes.push({ pass, helpSeen, seedShown, seedHonoured, travel, runningAnimations, measurement: before, realClickResult, geometryAfterClick });
  }

  // Agreement between the two passes on every number the deliverable asks for.
  const key = (m) => JSON.stringify({
    vp: [m.viewport.innerWidth, m.viewport.innerHeight],
    docScroll: m.document.maxScrollY,
    et: m.endTurn.present ? m.endTurn.rect : null,
    etHit: m.endTurn.present ? m.endTurn.allProbesHitTarget : null,
    rows: m.hand.rowsByRectOverlap,
    stage: m.stage ? [m.stage.scrollHeight, m.stage.clientHeight] : null,
  });
  const agreed = passes.every((p) => key(p.measurement) === key(passes[0].measurement));
  const seedsHonoured = passes.every((p) => p.seedHonoured !== false);
  const spread = (fn) => {
    const vs = passes.map(fn);
    return { values: vs, min: Math.min(...vs), max: Math.max(...vs), spread: Math.max(...vs) - Math.min(...vs) };
  };

  report.viewports.push({
    label, requested: { width: w, height: h }, passAgreement: agreed, seedsHonoured, passes,
    variance: {
      passAgreement: agreed,
      endTurnBottom: spread((p) => (p.measurement.endTurn.present ? p.measurement.endTurn.rect.bottom : -1)),
      docScrollHeight: spread((p) => p.measurement.document.docScrollHeight),
      maxScrollY: spread((p) => p.measurement.document.maxScrollY),
      stageHeight: spread((p) => p.measurement.stage.scrollHeight),
    },
  });
}

// ------------------------------------------------------------------ console table
report.everyPassHonouredTheSeed = report.viewports.every((v) => v.seedsHonoured);
const yesno = (b) => (b === null ? 'UNVERIFIED' : b ? 'yes' : 'NO');
console.log('==========================================================================');
for (const v of report.viewports) {
  const m = v.passes[0].measurement;
  const et = m.endTurn;
  console.log(`\n### ${v.label} — requested ${v.requested.width}x${v.requested.height}  (two passes agree: ${yesno(v.passAgreement)})`);
  console.log(`  seed control                  : requested ${REQUESTED_SEED}, page reported ${JSON.stringify(v.passes.map((p) => p.seedShown.seed))} → honoured every pass: ${yesno(v.seedsHonoured)}   (href ${v.passes[0].seedShown.href})`);
  console.log(`  innerWidth x innerHeight      : ${m.viewport.innerWidth} x ${m.viewport.innerHeight}   dpr ${m.viewport.dpr}   visualViewport ${m.visualViewport ? m.visualViewport.width + 'x' + m.visualViewport.height + ' @scale ' + m.visualViewport.scale : 'n/a'}`);
  console.log(`  document scrollHeight         : ${m.document.docScrollHeight}  (vs innerHeight ${m.viewport.innerHeight} → difference ${m.document.scrollHeightMinusInnerHeight}px)`);
  console.log(`  body scrollHeight             : ${m.document.bodyScrollHeight}`);
  console.log(`  MEASURED window scroll reach  : X ${m.document.maxScrollX}px, Y ${m.document.maxScrollY}px  → scrolls: ${yesno(m.document.scrollsVertically || m.document.scrollsHorizontally)}`);
  if (!et.present) {
    console.log(`  End Turn control              : ABSENT — ${et.failingBecause}`);
  } else {
    console.log(`  End Turn rect                 : top ${et.rect.top}, bottom ${et.rect.bottom}, left ${et.rect.left}, right ${et.rect.right} (${et.rect.width}x${et.rect.height})`);
    console.log(`    fully within [0, ${m.viewport.innerHeight}] vertically : ${yesno(et.withinViewportY)}${et.pxBelowViewportBottom ? '  (' + et.pxBelowViewportBottom + 'px below the viewport bottom)' : ''}`);
    console.log(`    fully within window horizontally      : ${yesno(et.withinViewportX)}`);
    console.log(`    clipped-away area                     : ${100 - et.inViewportIntersectionPct}%`);
    console.log(`    disabled / visibility / pointer-events: ${et.disabled} / ${et.visibility} / ${et.pointerEvents}`);
    console.log(`    topmost at own centre (elementFromPoint ${et.centreProbe.x},${et.centreProbe.y}) : ${et.centreProbe.isTarget ? 'YES' : 'NO'} → topmost is ${et.centreProbe.topmost}`);
    console.log(`    corner probes (20% inset) all hit it  : ${yesno(et.allProbesHitTarget)}  [${et.cornerProbes.map((c) => (c.isTarget ? 'hit' : 'MISS:' + c.topmost)).join(', ')}]`);
  }
  const rc = v.passes[0].realClickResult;
  console.log(`  real click at centre          : ${rc.performed ? `${rc.stateChanged ? 'CHANGED' : 'NO CHANGE'}  hud step "${rc.hudStepBefore}" → "${rc.hudStepAfter}"` : rc.reason}`);
  console.log(`  hand                          : ${m.hand.cardWrapCount} .card-wrap elements, ${m.hand.rowsByRectOverlap} row(s) by rect-overlap (distinct rounded tops: ${m.hand.distinctRoundedTops})`);
  console.log(`    row bands                   : ${JSON.stringify(m.hand.rowBands)}`);
  console.log(`    hand scrollWidth/clientWidth: ${m.hand.handScrollWidth}/${m.hand.handClientWidth} (clipped by ${m.hand.handClippedByX}px)`);
  console.log(`    wrap left→right span        : ${m.hand.firstWrapLeft} → ${m.hand.lastWrapRight}   worst card clipped by ${m.hand.worstWrapClippedPx}px (hand overflow ${m.hand.overflowStyle})`);
  console.log(`  #stage                        : scrollHeight ${m.stage.scrollHeight} vs clientHeight ${m.stage.clientHeight} → clipped by ${m.stage.clippedByY}px (overflow ${m.stage.overflowStyle}); horizontal ${m.stage.scrollWidth}/${m.stage.clientWidth}; stage rect bottom ${m.stage.rect.bottom} (${m.stage.bottomPastViewportPx}px past the viewport bottom)`);
  console.log(`    descendants whose own rect escapes a clipping box: ${m.stage.descendantsClippedByOverflow}${m.stage.worstDescendants.length ? ' — ' + m.stage.worstDescendants.map((d) => `${d.el} ${d.clippedPx}px [${d.byAncestors.map((a) => a.ancestor + ' ' + a.ancestorOverflow).join(',')}]`).join(' | ') : ''}`);
  console.log(`  End Turn clearance            : ${et.present ? `${et.clearanceBelowPx}px below, ${et.clearanceRightPx}px to the right` : 'n/a'}`);
  console.log(`  End Turn clipped by           : ${et.present ? `${et.clip.clippedPx}px [ancestors: ${et.clip.byAncestors.map((a) => a.ancestor + ' ' + a.ancestorOverflow).join(', ') || 'none'}] [viewport: ${JSON.stringify(et.clip.byViewport)}]` : 'n/a'}`);
  console.log(`  phase / hud step              : ${m.phase}`);
  console.log(`  encounter (as the page rendered it): ${v.passes[0].travel.enemiesEntered ? v.passes[0].travel.enemiesEntered.join(' | ') : 'n/a'}`);
  console.log(`  clicked node / available      : ${v.passes[0].travel.nodeInfo ? JSON.stringify(v.passes[0].travel.nodeInfo) : 'n/a'} · ${v.passes[0].travel.availableNodeCount} available: ${JSON.stringify(v.passes[0].travel.availableNodes || [])}`);
  console.log(`  running animations at capture  : ${v.passes[0].runningAnimations}`);
  console.log(`  measured vertical stack        : ${m.stack.map((s) => (s.absent ? s.name + '=absent' : `${s.name} ${s.top}→${s.bottom} h${s.height}`)).join(' | ')}`);
  console.log(`  #app computed                  : ${m.appComputed ? `height ${m.appComputed.height} minHeight ${m.appComputed.minHeight} display ${m.appComputed.display}` : 'n/a'}`);

  // Run-to-run spread. A viewport whose verdict flips between passes is reported as such,
  // because "sometimes below the fold" is a different finding from "always below the fold".
  const vr = v.variance;
  console.log(`  run-to-run spread              : agree=${vr.passAgreement} endTurnBottom ${JSON.stringify(vr.endTurnBottom.values)} (spread ${vr.endTurnBottom.spread}px) | docScrollHeight ${JSON.stringify(vr.docScrollHeight.values)} | maxScrollY ${JSON.stringify(vr.maxScrollY.values)} | stageHeight ${JSON.stringify(vr.stageHeight.values)}`);
  if (!vr.passAgreement) {
    for (const p of v.passes) {
      const mm = p.measurement;
      console.log(`    pass ${p.pass}: endTurn bottom ${mm.endTurn.present ? mm.endTurn.rect.bottom : 'ABSENT'} (withinY=${mm.endTurn.withinViewportY}) · doc scrollHeight ${mm.document.docScrollHeight} · maxScrollY ${mm.document.maxScrollY} · stage h ${mm.stage.scrollHeight} · app h ${mm.app ? mm.app.rect.height : 'n/a'} · hand band ${JSON.stringify(mm.hand.rowBands)} · enemies ${mm.enemies.length}`);
      console.log(`      pass ${p.pass} stack: ${mm.stack.map((s) => (s.absent ? s.name + '=absent' : `${s.name} h${s.height} ${s.top}→${s.bottom}`)).join(' | ')}`);
      console.log(`      pass ${p.pass} enemies: ${mm.enemies.map((e) => `h${e.rect.height} ${e.rect.top}→${e.rect.bottom} "${e.text}"`).join(' | ')}`);
      console.log(`      pass ${p.pass} node clicked: ${p.travel.nodeInfo ? JSON.stringify(p.travel.nodeInfo) : 'n/a'} · encounter: ${(p.travel.enemiesEntered || []).join(' | ')}`);
    }
  }
}

const cleanup = () => { try { ws.close(); } catch { /* already closed */ } try { child.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

await writeFile(resolve(OUT, 'endturn-independent.json'), JSON.stringify(report, null, 2));
console.log(`\nraw report: shots/acceptance/endturn-independent.json`);
cleanup();
process.exit(0);
