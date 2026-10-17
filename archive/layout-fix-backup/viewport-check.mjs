#!/usr/bin/env node
// tools/dev/viewport-check.mjs — measure the game at real embed sizes and report what breaks.
//
// itch.io's embed form defaults to a 640x360 viewport. The game's hand is five 176px cards
// plus gaps, and the HUD plus enemy row is ~350px tall, so the default may be unusable.
// Rather than guess, render the combat screen at each candidate size in real Chromium and
// report measured overflow, plus write a screenshot per size to look at.
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, 'shots/viewport');
mkdirSync(OUT, { recursive: true });
const PORT = 9341, PROFILE = '/tmp/dlb-viewport';
const BASE = process.argv[2] || 'http://localhost:5173/web/?seed=11';

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

const rows = [];
for (const [w, h, label] of SIZES) {
  const isPhone = w <= 500;
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: isPhone });
  await S('Emulation.setTouchEmulationEnabled', { enabled: isPhone, maxTouchPoints: isPhone ? 5 : 1 });
  await S('Page.navigate', { url: BASE });
  await sleep(1300);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url: BASE });
  await sleep(1200);
  // Travel into the first fight: the densest screen.
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`);
  await sleep(1300);

  const m = await ev(`(() => {
    const doc = document.documentElement;
    const hand = document.querySelector('.hand');
    const cards = [...document.querySelectorAll('.card')];
    const stage = document.querySelector('#stage');
    const endTurn = [...document.querySelectorAll('button')].find(b => /end turn/i.test(b.textContent||''));
    const last = cards[cards.length - 1];
    return {
      viewport: [window.innerWidth, window.innerHeight],
      docScroll: [doc.scrollWidth, doc.scrollHeight],
      hOverflow: doc.scrollWidth > window.innerWidth + 1,
      vOverflow: doc.scrollHeight > window.innerHeight + 1,
      cards: cards.length,
      handScrollW: hand ? hand.scrollWidth : null,
      handClientW: hand ? hand.clientWidth : null,
      cardsClipped: cards.filter(c => c.getBoundingClientRect().right > (hand ? hand.getBoundingClientRect().right + 1 : window.innerWidth)).length,
      endTurnVisible: endTurn ? (endTurn.getBoundingClientRect().bottom <= window.innerHeight + 1) : false,
      lastCardBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null,
      stageBottom: stage ? Math.round(stage.getBoundingClientRect().bottom) : null,
      // --- release-bar extras: what the phone bar actually depends on ---
      hudH: Math.round((document.querySelector('#hud') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
      handRows: (() => {
        const tops = [...document.querySelectorAll('.card-wrap')].map(w => Math.round(w.getBoundingClientRect().top));
        return new Set(tops).size;
      })(),
      enemyRows: (() => {
        const tops = [...document.querySelectorAll('.enemy')].map(w => Math.round(w.getBoundingClientRect().top));
        return new Set(tops).size;
      })(),
      scrolls: (() => {
        const bx = [...document.querySelectorAll('.card')].filter(c => c.scrollHeight > c.clientHeight + 1).length;
        return bx;
      })(),
      // Smallest tappable box on screen. The cost gem is deliberately excluded: it is a pure
      // decoration inside the card button, so an undersized gem is not an undersized tap
      // target — the tappable element is the card (which fills the wrap).
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
      // The same measurement, reported per element kind so a failure names the culprit.
      touchByKind: (() => {
        const out = {};
        for (const [k, sel] of Object.entries({ cardWrap: '.card-wrap', card: '.card', enemy: '.enemy', node: '.node', btn: '.btn' })) {
          const nodes = [...document.querySelectorAll(sel)].filter(n => n.getClientRects().length);
          out[k] = nodes.length ? Math.min(...nodes.map(n => Math.round(Math.min(n.getBoundingClientRect().width, n.getBoundingClientRect().height)))) : null;
        }
        return out;
      })(),
      // Per-block heights, so a remaining overflow can be attributed to a real element
      // rather than guessed at. Built with string concatenation on purpose: this whole value
      // lives inside a template literal, so a nested backtick or interpolation would be
      // evaluated by the outer literal instead of by the page.
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
        // Computed values for the first card, so "which media block won" is a measurement
        // rather than a guess.
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
  const shot = await S('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(OUT, `${label}-${w}x${h}.png`), Buffer.from(shot.result.data, 'base64'));
  rows.push([`${w}x${h}`, label, m]);
}

console.log('size         label            hOvfl  vOvfl  clip  endTurn  hudH  handRows enemyRows scrollCards minTouch docScroll');
for (const [size, label, m] of rows) {
  console.log(
    size.padEnd(13) + label.padEnd(17) +
    String(m.hOverflow).padEnd(7) + String(m.vOverflow).padEnd(7) +
    String(m.cardsClipped).padEnd(6) + String(m.endTurnVisible).padEnd(9) +
    String(m.hudH).padEnd(6) + String(m.handRows).padEnd(9) +
    String(m.enemyRows).padEnd(10) + String(m.scrolls).padEnd(12) +
    String(m.minTouch).padEnd(9) + JSON.stringify(m.docScroll),
  );
}
// Per-kind minimum tappable box for the LAST size measured (the most demanding one), so a
// failure names the element rather than just a number.
console.log('\nper-kind min tappable box @ ' + rows[rows.length - 1][0] + ':', JSON.stringify(rows[rows.length - 1][2].touchByKind));
console.log('\nper-block heights (app / hud / stage / combat-wrap / enemies / hand / controls / hint):');
for (const [size, , m] of rows) {
  const b = m.blocks;
  console.log('  ' + size.padEnd(13) + pad(b.app) + ' ' + pad(b.hud) + ' ' + pad(b.stage) + ' ' + pad(b.combat) + '  ' + pad(b.enemies) + ' ' + pad(b.hand) + ' ' + pad(b.controls) + ' ' + pad(b.hint));
  console.log('      kids: ' + b.kids);
  console.log('      card=' + pad(b.card) + ' enemy=' + pad(b.enemy) + ' intent=' + pad(b.intent) + ' art=' + pad(b.art));
  console.log('      cardMinH=' + b.cardMinH + ' cardDescFs=' + b.cardDescFs + ' wrapMaxW=' + b.wrapMaxW + ' wrapMinH=' + b.wrapMinH);
}
function pad(v) { return String(v === null ? '-' : v).padStart(5); }
console.log('\nscreenshots in shots/viewport/');

ws.close(); child.kill('SIGTERM'); process.exit(0);
