#!/usr/bin/env node
// scripts/dev/design-capture.mjs — capture every screen at MOBILE size for the design pass.
//
// The owner wants the UX Designer to redesign the whole game around the new cards, with
// MOBILE as the primary target. Design critique needs to see the real screens at the real
// size, so this walks a full run at 390x844 (iPhone 14) and captures every screen, plus the
// help modal, at DPR 2 for detail.
//
// Usage: node scripts/dev/design-capture.mjs [--seed N] [--out DIR]
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const SEED = arg('--seed', '11');
const OUT = resolve(ROOT, arg('--out', 'shots/design/mobile'));
mkdirSync(OUT, { recursive: true });
const PORT = 9351, PROFILE = '/tmp/dlb-design';
const BASE = `http://localhost:5173/src/web/?seed=${SEED}`;

let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (existsSync(PROFILE)) rmSync(PROFILE, { recursive: true, force: true });

const child = spawn('chromium', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--window-size=390,844', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const wsUrl = await new Promise((res, rej) => {
  const on = (b) => { const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(b)); if (m) res(m[1]); };
  child.stderr.on('data', on); child.stdout.on('data', on);
  setTimeout(() => rej(new Error('no DevTools endpoint')), 25000);
});
const ws = new WebSocket(wsUrl); const pend = new Map();
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } });
const send = (m, p = {}, s) => { const i = id++; ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); return new Promise((r) => pend.set(i, r)); };
const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
const S = (m, p) => send(m, p, sessionId);
await S('Page.enable'); await S('Runtime.enable');
await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const ev = async (e) => {
  const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error(d.text + ' :: ' + (d.exception?.description || '').slice(0, 200));
  }
  return r.result?.result?.value;
};
const phase = () => ev(`(()=>{const t=document.querySelector('#stage')?.innerText||'';
  return /RUN OVER|VICTORY|DEFEAT/.test(t)?'ended':/choose a card/i.test(t)?'reward':/Rest Site/i.test(t)?'rest':document.querySelectorAll('.enemy').length?'combat':'map'})()`);
const shoot = async (name) => {
  const r = await S('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  console.log(`  captured ${name}`);
};
const settle = (ms = 900) => sleep(ms);

// ---- walk and capture ----
await S('Page.navigate', { url: BASE });
await settle(1500);
await shoot('01-first-run-help');
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
await settle(500);

let name = 2, lastPhase = null, guard = 0;
const shotPhases = new Set(['map', 'combat', 'reward', 'rest', 'ended']);
while (guard++ < 400) {
  const ph = await phase();
  if (ph !== lastPhase && shotPhases.has(ph)) {
    await settle(900);
    await shoot(`${String(name).padStart(2, '0')}-${ph}`);
    name += 1;
    lastPhase = ph;
  }
  if (ph === 'ended') break;
  // Player-like action: card if playable, else end turn / travel / reward / continue.
  const moved = await ev(`(()=>{
    if (document.querySelector('.cancel-target,.target-banner')) { const e=document.querySelector('.enemy'); if(e){e.click();return 'target'} }
    const card = document.querySelector('.card:not(.disabled)');
    if (card) { card.click(); return 'card'; }
    const end = [...document.querySelectorAll('button')].find(b=>/end turn/i.test(b.textContent||''));
    if (end) { end.click(); return 'endturn'; }
    const node = document.querySelector('.node.available');
    if (node) { node.click(); return 'travel'; }
    const r = document.querySelector('.card');
    if (r) { r.click(); return 'reward'; }
    const cont = [...document.querySelectorAll('button')].find(b=>/continue|rest|move on|skip/i.test(b.textContent||''));
    if (cont) { cont.click(); return 'continue'; }
    return 'none';
  })()`);
  await settle(moved === 'endturn' || moved === 'target' ? 1100 : 350);
}

// ---- the help modal at phone size (glossary) ----
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/help/i.test(x.textContent||''));if(b)b.click();return 1})()`);
await settle(700);
await shoot(`${String(name).padStart(2, '0')}-help-modal`);

console.log(`\ndone — design captures in ${OUT}`);
ws.close(); child.kill('SIGTERM'); process.exit(0);
