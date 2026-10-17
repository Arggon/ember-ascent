// scripts/serve.mjs — the directory redirect must keep the query string intact.
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
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';

const SERVE = fileURLToPath(new URL('../../scripts/serve.mjs', import.meta.url));
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

/**
 * GET with the request target sent BYTE-FOR-BYTE. fetch() would normalize `//evil.com/../web`
 * and `\\` before sending, hiding exactly the inputs an attacker's link delivers.
 */
function rawGet(path) {
  const u = new URL(base);
  return new Promise((res, rej) => {
    const req = request({ host: u.hostname, port: u.port, path, method: 'GET' }, (r) => {
      r.resume();
      r.on('end', () => res({ status: r.statusCode, location: r.headers.location }));
    });
    req.on('error', rej);
    req.end();
  });
}

/** A Location that is a same-origin absolute path: one leading '/', no host, no '\\'. */
function assertSameOrigin(location, input) {
  assert.equal(typeof location, 'string', `${input}: expected a Location header`);
  assert.match(location, /^\/(?![\/\\])/, `${input}: Location must start with a single '/', got ${location}`);
  assert.ok(!location.includes('\\'), `${input}: Location must not contain a backslash, got ${location}`);
  assert.equal(new URL(location, base).host, new URL(base).host, `${input}: Location leaves the origin: ${location}`);
}

test('/src/web/?seed=11 is served directly: no redirect, so the seed survives', async () => {
  const r = await get('/src/web/?seed=11');
  assert.equal(r.status, 200, `expected 200, got ${r.status} -> ${r.headers.get('location')}`);
  assert.match(r.headers.get('content-type'), /text\/html/);
  await r.body?.cancel();
});

test('/src/web?seed=11 redirects to /src/web/?seed=11 (slash on the path, query kept as-is)', async () => {
  const r = await get('/src/web?seed=11');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/src/web/?seed=11');
  const seed = new URL(r.headers.get('location'), base).searchParams.get('seed');
  assert.equal(Number.isInteger(Number(seed)), true, `seed must still parse as an integer, got "${seed}"`);
});

test('a multi-parameter query is kept intact through the redirect', async () => {
  const r = await get('/src/web?seed=7&pool=full');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/src/web/?seed=7&pool=full');
});

test('a bare directory still gets its trailing slash, and files are untouched', async () => {
  const r = await get('/src/web');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/src/web/');
  const f = await get('/src/web/index.html?seed=11');
  assert.equal(f.status, 200);
  await f.body?.cancel();
});

// THE BUG THIS PINS (open redirect): the Location was the raw request path plus '/'.
// `//evil.com/../src/web` resolves to web/, so it took the redirect branch and answered
// `Location: //evil.com/../src/web/` — a protocol-relative URL that sends the browser to
// evil.com. Browsers treat `\` as `/`, so `/\evil.com/../src/web` was the same hole.
for (const input of ['//evil.com/../src/web', '///evil.com/../src/web', '/\\evil.com/../src/web']) {
  test(`${input} redirects to the same-origin /src/web/, never off-site`, async () => {
    const r = await rawGet(input);
    assert.equal(r.status, 301);
    assertSameOrigin(r.location, input);
    assert.equal(r.location, '/src/web/');
  });
}

test('the query survives the hardened redirect: //evil.com/../src/web?seed=11 -> /src/web/?seed=11', async () => {
  const r = await rawGet('//evil.com/../src/web?seed=11');
  assert.equal(r.status, 301);
  assertSameOrigin(r.location, '//evil.com/../src/web?seed=11');
  assert.equal(r.location, '/src/web/?seed=11');
});

test('a nested directory redirects to its normalized path', async () => {
  const r = await rawGet('/src/web/./assets/../assets');
  assert.equal(r.status, 301);
  assert.equal(r.location, '/src/web/assets/');
});

// THE BUG THIS PINS: a malformed %-escape made decodeURIComponent throw a URIError inside
// the request handler, uncaught, so one bad request (`GET /src/web%`) took the server down.
for (const input of ['/src/web%', '/%E0%A4%A', '/src/web/%zz']) {
  test(`${input} is a 400, and the server keeps serving`, async () => {
    const r = await rawGet(input);
    assert.equal(r.status, 400);
    const ok = await get('/src/web/?seed=11');
    assert.equal(ok.status, 200, 'the server is still up after the bad request');
    await ok.body?.cancel();
  });
}
