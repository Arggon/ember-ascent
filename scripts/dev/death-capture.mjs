#!/usr/bin/env node
// tools/dev/death-capture.mjs — capture the END-OF-RUN moment with a FROZEN clock.
//
// WHY THIS EXISTS. The blank-climax bug (DEF-6) lived in a window between two paints, so
// every screenshot that did not land inside it reported the feature as fine, and every
// screenshot that needed to land inside it needed a sleep to be lucky. `shoot.mjs` sleeps
// against the wall clock (`sleep(60/120/140)`, `settle()` = 1400 ms), which makes it a
// coin-toss frame sampler: a 480 ms window sampled at ~60-140 ms intervals is easy to miss
// and impossible to re-observe. This tool removes the coin toss entirely.
//
// THE METHOD, and why it is not just "a shorter sleep":
//
//   1. The renderer's PRESENTATION clock is frozen rather than raced. A dev-only shim
//      (installed with `Page.addScriptToEvaluateOnNewDocument`, so it is in place before
//      app.js runs) wraps `setTimeout`: a LOW delay (< 150 ms) is a per-paint flag release
//      and stays native, so `laterPaint(fn, 0)` still consumes `dyingThisPaint` on the paint
//      after the action and `holdStartAt` is still sampled then; a HIGH delay is a hold or an
//      effect-lifetime timer, is tagged, and is ALSO left native. Nothing is deferred or
//      reordered: the shim only records the delay so the tool can tell the two kinds apart.
//   2. `Emulation.setVirtualTimePolicy { policy: 'pause' }` is armed BEFORE the terminal
//      action is dispatched. With virtual time paused, `Date.now`, `performance.now`,
//      `setTimeout` and `requestAnimationFrame` all stop advancing, so the timed release of
//      the hold cannot fire while we look at it — the renderer's own clock, not a sleep.
//   3. The frozen window is then stepped in fixed 50 ms quanta
//      (`policy: 'advance'` with a budget, waiting for `virtualTimeBudgetExpired`). Each
//      quantum is a real layout state, captured and probed.
//
// ASSERT ON COMPUTED STATE, NOT ON PIXELS. Each frame is probed in the page: the count of
// `.enemy.is-dying` ghosts and of living `.enemy` cards, whether the stage's ONLY child is
// the `.ended-hold` spacer, the stage's text length, the end panel's presence, and the
// computed `opacity` of the first ghost. A marker property is stamped on the ghost and the
// spacer node so that a REPAINT — which replaces every child of #stage — is detectable: the
// marker is gone after one. The PNGs are a by-product of the same frames, for a human.
//
// Usage:
//   node tools/dev/death-capture.mjs [--base URL] [--out DIR] [--tag after] [--seeds 13,1,2]
//                                    [--quantum 50] [--horizon 900] [--no-frames] [--port 9334]
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };

const BASE = arg('--base', 'http://localhost:5173/web/');
const OUT = resolve(ROOT, arg('--out', 'shots/pm-verify/death'));
const TAG = arg('--tag', 'after');
const QUANTUM = Number(arg('--quantum', '50'));
const HORIZON = Number(arg('--horizon', '900'));
const SEEDS = String(arg('--seeds', '13,1,2,3,4,5')).split(',').map((s) => Number(s.trim())).filter(Number.isInteger);
const FRAMES = !args.includes('--no-frames');
const PORT = Number(arg('--port', '9334'));
const PROFILE = '/tmp/dlb-death-capture-profile';

mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ CDP plumbing */

let nextId = 1;
function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const events = [];
    ws.addEventListener('open', () => res({
      send(method, params = {}, sessionId) {
        const id = nextId++;
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        return new Promise((resolve) => pending.set(id, resolve));
      },
      events,
      close: () => ws.close(),
    }));
    ws.addEventListener('error', rej);
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      else if (msg.method) events.push(msg);
    });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  if (existsSync(PROFILE)) rmSync(PROFILE, { recursive: true, force: true });
  const child = spawn('chromium', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=1280,800', 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const wantUrl = new Promise((res, rej) => {
    const onData = (buf) => {
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(buf));
      if (m) res(m[1]);
    };
    child.stderr.on('data', onData);
    child.stdout.on('data', onData);
    child.on('exit', (code) => rej(new Error(`chromium exited early (${code})`)));
    setTimeout(() => rej(new Error('timed out waiting for the DevTools endpoint')), 25000);
  });
  return { child, wsUrl: await wantUrl };
}

/* ------------------------------------------------------------- the in-page shim */

/**
 * Installed before app.js on every document. Two jobs, both dev-only:
 *
 *  * `localStorage` — mark the first-run help panel as already seen, so the stage under test
 *    holds the fight and not the onboarding modal.
 *  * `setTimeout` — record every delay handed to the code under test, with the delay's
 *    ORIGIN, so the tool can separate a per-paint flag release (0 ms: the ghost must be
 *    consumed on the very next paint, which is the one-paint contract) from a hold or an
 *    effect lifetime (hundreds of ms). It does NOT delay, reorder or fire anything itself:
 *    with virtual time paused, a native timer simple does not fire until the tool advances
 *    the page's clock.
 */
const SHIM = `(() => {
  try { localStorage.setItem('dlb.helpSeen.v1', '1'); } catch {}
  window.__dlbTimers = [];
  const native = globalThis.setTimeout;
  globalThis.setTimeout = function (fn, ms, ...rest) {
    const delay = Number(ms) || 0;
    let stack = '';
    try { stack = String(new Error().stack || '').split('\\n').slice(1, 4).join(' | '); } catch {}
    window.__dlbTimers.push({ delay, stack, at: Date.now() });
    return native.call(this, fn, delay, ...rest);
  };
})()`;

/** What a frame is judged by. Computed style, node counts and node identity only. */
const PROBE = `(() => {
  const stage = document.querySelector('#stage');
  if (!stage) return { error: 'no #stage' };
  const kids = [...stage.children];
  const ghosts = [...stage.querySelectorAll('.enemy.is-dying')];
  const living = [...stage.querySelectorAll('.enemy')].filter((n) => !n.classList.contains('is-dying'));
  const hold = [...stage.querySelectorAll('.ended-hold')];
  const first = ghosts[0] || null;
  const op = first ? getComputedStyle(first).opacity : null;
  const text = (stage.innerText || '').trim();
  const snap = window.__dlb ? window.__dlb.snapshot() : null;
  return {
    kids: kids.length,
    onlyHold: kids.length === 1 && kids[0].classList.contains('ended-hold'),
    ghosts: ghosts.length,
    living: living.length,
    holdNodes: hold.length,
    ghostOpacity: op === null ? null : Number(op),
    ghostText: first ? (first.textContent || '').trim() : null,
    ghostName: first && first.querySelector('.ename') ? first.querySelector('.ename').textContent : null,
    ghostIsBoss: first ? first.classList.contains('boss-down') : false,
    stageText: text.length,
    stageTextHead: text.slice(0, 60),
    endPanel: !!stage.querySelector('.big-title'),
    // The markers survive only while the node does: a repaint replaces every child of
    // #stage, so a surviving marker proves no render() ran between the two frames.
    ghostMarked: !!(first && first.__dlbGhostMarker),
    holdMarked: !!(hold[0] && hold[0].__dlbHoldMarker),
    phase: snap ? snap.phase : null,
    outcome: snap && snap.ended ? snap.ended.outcome : null,
    enemies: snap ? snap.enemies.length : null,
    playerHp: snap ? snap.player.hp : null,
  };
})()`;

/**
 * ONE trip through a whole run, in the page, as a player: real DOM clicks on the real
 * controls. Synchronous because `act()` re-renders synchronously, so no wall-clock waiting is
 * needed and none is used. Returns the full click log — which the tool replays, so a run that
 * is not reproducible aborts instead of producing a mislabelled screenshot.
 */
const PILOT = `(() => {
  const log = [];
  const click = (node, label) => { node.click(); log.push(label); };
  const pick = () => {
    if (document.querySelector('.target-banner, .cancel-target')) {
      const t = document.querySelector('.enemy.targeting') || document.querySelector('.enemy');
      if (t) return { node: t, label: 'target:' + (t.getAttribute('data-target-index') || '?') };
      return null;
    }
    const card = document.querySelector('.card:not(.disabled):not([disabled])');
    if (card) return { node: card, label: 'card:' + (card.getAttribute('data-slot') || (card.getAttribute('data-action') || '?')) };
    const end = [...document.querySelectorAll('button')].find((b) => /end turn/i.test(b.textContent || ''));
    if (end) return { node: end, label: 'endturn' };
    const node = document.querySelector('.node.available');
    if (node) return { node, label: 'travel' };
    const cont = [...document.querySelectorAll('button')].find((b) => /continue|rest|move on|skip/i.test(b.textContent || ''));
    if (cont) return { node: cont, label: 'continue:' + (cont.textContent || '').trim().slice(0, 18) };
    return null;
  };
  const st = () => (window.__dlb ? window.__dlb.snapshot() : null);
  const seen = [];
  for (let i = 0; i < 900; i += 1) {
    const s = st();
    if (!s) return { done: 'no-controller', log };
    if (s.phase === 'ended') return { done: 'ended', log, outcome: s.ended ? s.ended.outcome : null, steps: i, seen };
    const at = s.phase === 'combat' ? ('combat ' + s.enemies.length + 'e ' + s.enemies.map((e) => e.name + ':' + e.hp).join(',')) : s.phase;
    seen.push(at);
    const p = pick();
    if (!p) return { done: 'stuck', log, phase: s.phase, seen };
    click(p.node, p.label);
  }
  return { done: 'budget', log, seen };
})()`;

/** Play a recorded click log one entry at a time, so the tool can stop before the last. */
const REPLAY = (log) => `(() => {
  const log = ${JSON.stringify(log)};
  const click = (node) => node.click();
  const pick = () => {
    if (document.querySelector('.target-banner, .cancel-target')) {
      const t = document.querySelector('.enemy.targeting') || document.querySelector('.enemy');
      return t ? { node: t, label: 'target:' + (t.getAttribute('data-target-index') || '?') } : null;
    }
    const card = document.querySelector('.card:not(.disabled):not([disabled])');
    if (card) return { node: card, label: 'card:' + (card.getAttribute('data-slot') || (card.getAttribute('data-action') || '?')) };
    const end = [...document.querySelectorAll('button')].find((b) => /end turn/i.test(b.textContent || ''));
    if (end) return { node: end, label: 'endturn' };
    const node = document.querySelector('.node.available');
    if (node) return { node, label: 'travel' };
    const cont = [...document.querySelectorAll('button')].find((b) => /continue|rest|move on|skip/i.test(b.textContent || ''));
    if (cont) return { node: cont, label: 'continue:' + (cont.textContent || '').trim().slice(0, 18) };
    return null;
  };
  const out = [];
  for (const want of log) {
    const p = pick();
    if (!p) return { ok: false, at: out.length, want, got: null, out };
    if (p.label !== want) return { ok: false, at: out.length, want, got: p.label, out };
    click(p.node);
    out.push(p.label);
  }
  return { ok: true, out };
})()`;

/** Stamp the collapsing nodes, so a repaint (which replaces them) becomes observable. */
const MARK = `(() => {
  const stage = document.querySelector('#stage');
  const g = stage.querySelector('.enemy.is-dying');
  const h = stage.querySelector('.ended-hold');
  if (g) g.__dlbGhostMarker = true;
  if (h) h.__dlbHoldMarker = true;
  return { ghost: !!g, hold: !!h };
})()`;

/* ------------------------------------------------------------------------- main */

async function main() {
  const { child, wsUrl } = await launch();
  const cdp = await connect(wsUrl);
  const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).result;
  const S = (m, p) => cdp.send(m, p, sessionId);

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  await S('Page.addScriptToEvaluateOnNewDocument', { source: SHIM });

  const evalJs = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    const d = r.result || {};
    if (d.exceptionDetails) throw new Error(d.exceptionDetails.text + ' :: ' + (d.exceptionDetails.exception?.description || '').slice(0, 300));
    return d.result ? d.result.value : undefined;
  };

  /**
   * Wait for the page to be genuinely ready, rather than for a wall-clock sleep to elapse.
   *
   * Why this is not paranoia: `tools/serve.mjs` answers `/web/?seed=13` with a 301 to
   * `/web/?seed=13/` (it appends a slash to the path it is given, query string included),
   * and the extra navigation hop means the document can still be mid-parse when a fixed
   * sleep ends. Evaluating then reads an empty body and reports `no-controller` for a page
   * that is a moment away from working — which is exactly what it did.
   */
  async function waitReady(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await evalJs(`document.readyState === 'complete' && typeof window.__dlb === 'object'`);
      if (ok === true) return true;
      await sleep(100);
    }
    return false;
  }

  /** Play the run for one seed with the clock already frozen. */
  async function pilot(seed) {
    // `index.html` explicitly, so the request never takes serve.mjs's trailing-slash 301:
    // the redirect rewrites the seed (`?seed=13` -> `?seed=13/`), and a seed of `13/` is not
    // an integer, so the page silently starts a RANDOM run and the capture would be of the
    // wrong game. The URL is the one thing here that must be exact.
    await S('Page.navigate', { url: `${BASE}index.html?seed=${seed}` });
    const ready = await waitReady();
    if (!ready) {
      const diag = await evalJs(`({
        dlb: typeof window.__dlb, readyState: document.readyState, url: location.href,
        scripts: [...document.querySelectorAll('script')].map((s) => s.src),
        bodyLen: document.body ? document.body.innerHTML.length : -1,
        timers: (window.__dlbTimers || []).length,
      })`);
      console.log('DIAGNOSTIC (not ready):', JSON.stringify(diag));
      for (const m of cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown').slice(-3)) {
        const d = m.params.exceptionDetails;
        console.log('  page error:', d.text, '|', (d.exception?.description || '').split('\n').slice(0, 4).join(' \\n '));
      }
      throw new Error(`page never became ready at ${BASE}index.html?seed=${seed}`);
    }
    // Arm the freeze BEFORE the first click, so the sprint paints are frozen too.
    await S('Emulation.setVirtualTimePolicy', { policy: 'pause' });
    const pilotOut = await evalJs(PILOT);
    return pilotOut;
  }

  /** Advance virtual time by one quantum and wait for the page to consume the budget. */
  async function advance(ms) {
    const before = cdp.events.length;
    await S('Emulation.setVirtualTimePolicy', {
      policy: 'advance', budget: ms, maxVirtualTimeTaskStarvationCount: 10000,
    });
    for (let i = 0; i < 120; i += 1) {
      const hit = cdp.events.slice(before).find((e) => e.method === 'Emulation.virtualTimeBudgetExpired');
      if (hit) return true;
      await sleep(10);
    }
    return false;
  }

  const framePath = (name) => join(OUT, `${TAG}-${name}.png`);
  async function shoot(name) {
    if (!FRAMES) return null;
    const r = await S('Page.captureScreenshot', { format: 'png' });
    const data = r.result?.data;
    if (!data) return null;
    const p = framePath(name);
    await writeFile(p, Buffer.from(data, 'base64'));
    return p;
  }

  /**
   * Freeze the terminal paint of one run, then walk the frozen window in quanta.
   * `variant` is 'win' or 'defeat' and only names the output files.
   */
  async function captureTerminal(seed, variant) {
    const pilotOut = await pilot(seed);
    if (pilotOut.done !== 'ended') return { seed, variant, skipped: `pilot ${pilotOut.done}` };
    const expected = pilotOut.outcome;
    if (expected !== variant) return { seed, variant, skipped: `outcome ${expected}` };

    // Replay all but the last click, so the frame BEFORE the killing blow can be captured
    // from a state the run really passed through. A mismatch aborts rather than mislabels.
    const log = pilotOut.log;
    const pre = await evalJs(REPLAY(log.slice(0, -1)));
    if (!pre || !pre.ok) return { seed, variant, skipped: 'replay diverged: ' + JSON.stringify(pre).slice(0, 200) };
    const preFrame = await shoot(`${variant}-preturn`);
    const preProbe = await evalJs(PROBE);

    // The terminal click, taken with virtual time paused: the hold cannot time out under us.
    const last = await evalJs(REPLAY([log[log.length - 1]]));
    if (!last || !last.ok) return { seed, variant, skipped: 'final click diverged: ' + JSON.stringify(last).slice(0, 200) };
    const marked = await evalJs(MARK);

    const frames = [];
    const first = async (name, label) => {
      const p = await shoot(`${variant}-${name}`);
      frames.push({ label, t: null, probe: await evalJs(PROBE), file: p });
    };
    await first('t000', 'terminal paint');

    for (let t = QUANTUM; t <= HORIZON; t += QUANTUM) {
      const ok = await advance(QUANTUM);
      const probe = await evalJs(PROBE);
      const p = await shoot(`${variant}-t${String(t).padStart(3, '0')}`);
      frames.push({ label: `t+${t}ms`, t, probe, file: p, advanced: ok });
    }

    // Summarise against the vetted predicate: `blank` is the stage carrying NO enemy node,
    // NO text and no end panel — the state the bug left it in for a whole hold.
    const blankOf = (f) => (!f.probe || f.probe.error ? false
      : f.probe.kids === 0 || ((f.probe.ghosts + f.probe.living) === 0 && f.probe.stageText === 0 && !f.probe.endPanel));
    let runStart = null; let maxBlankMs = 0; let blankAt = null; let longest = null;
    const spans = [];
    for (const f of frames) {
      const blank = blankOf(f);
      if (blank && runStart === null) runStart = f.t === null ? 0 : f.t;
      if (blank) { maxBlankMs = (f.t === null ? 0 : f.t) - runStart; }
      if (!blank && runStart !== null) { spans.push([runStart, f.t]); longest = Math.max(longest ?? 0, maxBlankMs); runStart = null; }
      if (blank && blankAt === null) blankAt = f.t ?? 0;
    }
    if (runStart !== null) spans.push([runStart, HORIZON]);

    const visible = frames.filter((f) => f.probe && (f.probe.ghosts + f.probe.living) > 0 && !blankOf(f));
    const ghostVisible = frames.filter((f) => f.probe && f.probe.ghosts > 0 && f.probe.ghostOpacity > 0);
    const markedGhostFrames = frames.filter((f) => f.probe && f.probe.ghostMarked).length;
    const endPanelAt = (frames.find((f) => f.probe && f.probe.endPanel) || {}).t ?? null;

    const summary = {
      seed, variant, outcome: expected,
      clicks: log.length,
      preReturnProbe: preProbe,
      preReturnFrame: preFrame,
      markerStamp: marked,
      frames: frames.map((f) => ({ label: f.label, t: f.t, file: f.file, blank: blankOf(f), ...f.probe })),
      blank: {
        anyBlankFrame: frames.some(blankOf),
        blankSpans: spans,
        firstBlankAt: blankAt,
        maxBlankMs: longest ?? 0,
      },
      evidence: {
        framesWithEnemyNodeVisible: visible.map((f) => f.label),
        framesWithGhostAtOpacityAboveZero: ghostVisible.map((f) => ({ label: f.label, opacity: f.probe.ghostOpacity })),
        markerSurvivedFrames: markedGhostFrames,
        endPanelAt,
      },
    };
    return summary;
  }

  const results = [];
  let sawWin = false;
  let sawDefeat = false;
  for (const seed of SEEDS) {
    if (sawWin && sawDefeat) break;
    const want = sawWin ? 'defeat' : (sawDefeat ? 'win' : null);
    const pilotOut = await pilot(seed);
    if (pilotOut.done !== 'ended') { results.push({ seed, skipped: `pilot ${pilotOut.done}` }); continue; }
    const outcome = pilotOut.outcome;
    if ((outcome === 'win' && sawWin) || (outcome === 'defeat' && sawDefeat)) {
      results.push({ seed, skipped: `already have ${outcome}` }); continue;
    }
    if (want && outcome !== want) { results.push({ seed, skipped: `waiting for ${want}, saw ${outcome}` }); continue; }
    const cap = await captureTerminal(seed, outcome);
    if (outcome === 'win') sawWin = true; else sawDefeat = true;
    results.push(cap);
    // Back to real time so the next seed's load is not frozen mid-navigation.
    await S('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 1000 });
  }

  const report = { base: BASE, tag: TAG, quantumMs: QUANTUM, horizonMs: HORIZON, results };
  const jsonPath = join(OUT, `${TAG}-capture-report.json`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2));

  for (const r of results) {
    if (r.skipped) { console.log(`seed ${r.seed}: SKIPPED (${r.skipped})`); continue; }
    console.log(`seed ${r.seed} ${r.variant.toUpperCase()} — ${r.clicks} clicks`);
    console.log(`  blank window: anyBlankFrame=${r.blank.anyBlankFrame} spans=${JSON.stringify(r.blank.blankSpans)} maxBlankMs=${r.blank.maxBlankMs}`);
    console.log(`  enemy node visible in: ${r.evidence.framesWithEnemyNodeVisible.join(', ') || '(none)'}`);
    console.log(`  ghost above opacity 0 in: ${r.evidence.framesWithGhostAtOpacityAboveZero.map((f) => f.label + '=' + f.opacity).join(', ') || '(none)'}`);
    console.log(`  marker survived ${r.evidence.markerSurvivedFrames} frame(s); end panel first at t=${r.evidence.endPanelAt}`);
  }
  console.log(`report: ${jsonPath}`);

  cdp.close();
  child.kill();
}

main().catch((e) => { console.error('death-capture failed:', e.message); process.exit(1); });
