#!/usr/bin/env node
// scripts/dev/probe-eleven.mjs — TEMPORARY diagnostic for the 915x412 / 844x390 rows.
// Read-only w.r.t. src/web/style.css: it only measures, and its A/B arm injects a throwaway
// <style> into the live document to test whether the bottom-padding band moves End Turn
// up or down. Deleted after use; not part of the deliverable.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const PORT = 9397, PROFILE = '/tmp/dlb-probe-eleven';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 1;

const SIZES = (process.argv[2] || '915x412,844x390').split(',').map((s) => s.split('x').map(Number));
const SEEDS = (process.argv[3] || '1,3,7,11').split(',').map(Number);

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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

async function cycle(url) {
  await S('Page.navigate', { url }); await sleep(1300);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/got it/i.test(x.textContent||''));if(b)b.click();try{localStorage.setItem('dlb.helpSeen.v1','1')}catch{};return 1})()`);
  await S('Page.navigate', { url }); await sleep(1200);
  await ev(`(()=>{const n=document.querySelector('.node.available');if(n)n.click();return 1})()`);
  await sleep(1300);
}

const MEASURE = `(() => {
  const g = (s) => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect();
    return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) }; };
  const cs = (s, p) => { const n = document.querySelector(s); return n ? getComputedStyle(n)[p] : null; };
  const et = [...document.querySelectorAll('button')].find(b => /end turn/i.test(b.textContent||''));
  const er = et ? et.getBoundingClientRect() : null;
  const sc = document.querySelector('.stage-combat');
  const cards = [...document.querySelectorAll('.card')];
  const tallest = cards.slice().sort((a,b)=>b.getBoundingClientRect().height-a.getBoundingClientRect().height)[0];
  const rows = tallest ? ['.ctype','.cname','.cdesc','.cfoot'].map(s => { const n = tallest.querySelector(s);
      if (!n) return s + '=none'; const r = n.getBoundingClientRect();
      return s + '=' + Math.round(r.height) + '/' + Math.round(r.width) + 'px@' + getComputedStyle(n).fontSize; }) : [];
  return {
    vh: window.innerHeight,
    docH: document.documentElement.scrollHeight,
    scroll: document.documentElement.scrollHeight - window.innerHeight,
    app: g('#app'), appPad: cs('#app','padding'),
    hud: g('#hud'),
    stage: g('#stage'), stagePad: cs('#stage','padding'),
    sc: g('.stage-combat'), scJustify: cs('.stage-combat','justifyContent'), scFlexGrow: cs('.stage-combat','flexGrow'), scGap: cs('.stage-combat','gap'),
    enemyPad: cs('.enemy','padding'), eArtDisp: cs('.e-art','display'), enemMaxW: cs('.enemies','maxWidth'),
    handGapC: cs('.hand','gap'), handAlignC: cs('.hand','alignItems'),
    ctypePad: cs('.ctype','padding'), ctypeMargin: cs('.ctype','margin'),
    kids: sc ? [...sc.children].map(n => (n.className||n.tagName).split(' ')[0] + '=' + Math.round(n.getBoundingClientRect().height)) : [],
    cardH: cards.map(c => Math.round(c.getBoundingClientRect().height)),
    tallestRows: rows.join('  '),
    cardPad: cs('.card','padding'), cardGap: cs('.card','gap'), cardMinH: cs('.card','minHeight'),
    cdescFs: cs('.cdesc','fontSize'), cnameFs: cs('.cname','fontSize'), ctypeFs: cs('.ctype','fontSize'),
    wrapMaxW: cs('.card-wrap','maxWidth'), wrapMinH: cs('.card-wrap','minHeight'),
    hand: g('.hand'), handPad: cs('.hand','padding'), handGap: cs('.hand','gap'), handAlign: cs('.hand','alignItems'),
    ctrl: g('.controls'), btnMinH: cs('#stage .btn','minHeight'),
    etTop: er ? Math.round(er.top) : null, etBot: er ? Math.round(er.bottom) : null,
    clear: er ? Math.round(window.innerHeight - er.bottom) : null,
  };
})()`;

function line(tag, m) {
  return `  ${tag.padEnd(8)} docH=${String(m.docH).padStart(4)} scroll=${String(m.scroll).padStart(3)} | app=${m.app.h}(pad ${m.appPad}) hud=${m.hud.h} stage=${m.stage.h}(pad ${m.stagePad}) sc=${m.sc.h} jc=${m.scJustify} grow=${m.scFlexGrow}\n` +
    `           kids: ${m.kids.join(' ')}\n` +
    `           cards: ${JSON.stringify(m.cardH)}  pad=${m.cardPad} gap=${m.cardGap} minH=${m.cardMinH} wrapMaxW=${m.wrapMaxW}\n` +
    `           fs ctype=${m.ctypeFs} cname=${m.cnameFs} cdesc=${m.cdescFs}\n` +
    `           tallest: ${m.tallestRows}\n` +
    `           gap sc=${m.scGap} hand=${m.handGapC} cards=${m.cardGap} | align=${m.handAlignC} | ctype pad=${m.ctypePad} margin=${m.ctypeMargin}\n` +
    `           enemy pad=${m.enemyPad} maxW=${m.enemMaxW} art=${m.eArtDisp}\n` +
    `           hand=${m.hand.h}(pad ${m.handPad}, gap ${m.handGap}) ctrl=${m.ctrl.h} btnMinH=${m.btnMinH} | EndTurn bot=${m.etBot} CLEAR=${m.clear}`;
}

const CAND = process.env.CAND || '';

for (const [w, h] of SIZES) {
  await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w <= 500 });
  for (const seed of SEEDS) {
    await cycle(`http://localhost:5173/src/web/index.html?seed=${seed}`);
    const asIs = await ev(MEASURE);
    // A/B: revert ONLY the max-height:500px band in the live document, and re-measure.
    const noBand = await ev(`(() => {
      const s = document.createElement('style'); s.id = 'probe-noband';
      s.textContent = '#app{padding-bottom:4px !important} #stage{padding-bottom:2px !important}';
      document.head.appendChild(s);
      const app = document.getElementById('app');
      void app.offsetHeight; return 1;
    })()`);
    await sleep(250);
    const ab = await ev(MEASURE);
    await ev(`(()=>{const s=document.getElementById('probe-noband');if(s)s.remove();return 1})()`);
    // CAND: inject the candidate override LAST so it wins the cascade like the real block would.
    let cand = null;
    if (CAND) {
      await ev(`(() => {
        const s = document.createElement('style'); s.id = 'probe-cand';
        s.textContent = ${JSON.stringify(CAND)};
        document.head.appendChild(s);
        void document.getElementById('app').offsetHeight; return 1;
      })()`);
      await sleep(250);
      cand = await ev(MEASURE);
      await ev(`(()=>{const s=document.getElementById('probe-cand');if(s)s.remove();return 1})()`);
    }
    console.log(`\n=== ${w}x${h} seed ${seed} ===`);
    console.log(line('AS-IS', asIs));
    console.log(line('NO-BAND', ab));
    console.log(`  >>> freeing 5px of bottom padding: EndTurn bottom ${ab.etBot - asIs.etBot}px, docH ${ab.docH - asIs.docH}px, clear ${ab.clear - asIs.clear}px`);
    if (cand) {
      console.log(line('CAND', cand));
      console.log(`  >>> CAND: docH ${cand.docH} scroll ${cand.scroll} EndTurn bot ${cand.etBot} CLEAR ${cand.clear} (need clear>=8, scroll<=0)`);
    }
  }
}
ws.close(); child.kill('SIGTERM'); process.exit(0);
