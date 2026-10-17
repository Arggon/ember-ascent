// tools/serve.mjs — the directory redirect must keep the query string intact.
//
// THE BUG THIS PINS: the trailing-slash redirect was decided on, and appended to, the whole
// request target, query included. `/web/?seed=11` (whose PATH already ends in `/`) was
// redirected to `/web/?seed=11/`; the page then read `Number("11/")` -> NaN and fell back to
// a random seed, so every "pinned" layout measurement ran a different fight
// (LAYOUT-ACCEPTANCE.md §1). This drives the real server over HTTP.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const SERVE = fileURLToPath(new URL('../../tools/serve.mjs', import.meta.url));
let child;
let base;

/** An unused local port (bind :0, read it back, release it). */
function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

before(async () => {
  const port = await freePort();
  child = spawn(process.execPath, [SERVE, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('serve.mjs did not start')), 10000);
    child.stdout.on('data', (b) => { if (String(b).includes('serving')) { clearTimeout(t); res(); } });
    child.once('exit', (code) => { clearTimeout(t); rej(new Error(`serve.mjs exited ${code}`)); });
  });
  base = `http://127.0.0.1:${port}`;
});

after(() => { child?.kill(); });

const get = (path) => fetch(base + path, { redirect: 'manual' });

test('/web/?seed=11 is served directly: no redirect, so the seed survives', async () => {
  const r = await get('/web/?seed=11');
  assert.equal(r.status, 200, `expected 200, got ${r.status} -> ${r.headers.get('location')}`);
  assert.match(r.headers.get('content-type'), /text\/html/);
  await r.body?.cancel();
});

test('/web?seed=11 redirects to /web/?seed=11 (slash on the path, query kept as-is)', async () => {
  const r = await get('/web?seed=11');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/web/?seed=11');
  const seed = new URL(r.headers.get('location'), base).searchParams.get('seed');
  assert.equal(Number.isInteger(Number(seed)), true, `seed must still parse as an integer, got "${seed}"`);
});

test('a multi-parameter query is kept intact through the redirect', async () => {
  const r = await get('/web?seed=7&pool=full');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/web/?seed=7&pool=full');
});

test('a bare directory still gets its trailing slash, and files are untouched', async () => {
  const r = await get('/web');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/web/');
  const f = await get('/web/index.html?seed=11');
  assert.equal(f.status, 200);
  await f.body?.cancel();
});
