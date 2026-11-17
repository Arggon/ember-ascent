// The release copy of serve.mjs (release/tools/serve.mjs) serves the flattened artifact,
// where the game is at the root, not /src/web/. Its legacy /web redirect must point at the
// root there, query kept (#50); the repo server keeps /web -> /src/web/ (tests/tools/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
const rawGet = (port, path) => new Promise((res, rej) => {
  const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (r) => { r.resume(); r.on('end', () => res({ status: r.statusCode, location: r.headers.location })); });
  req.on('error', rej); req.end();
});

test('release server: /web redirects to the artifact root (query kept), and the target serves', async (t) => {
  const out = mkdtempSync(join(tmpdir(), 'ea-release-serve-'));
  t.after(() => { rmSync(out, { recursive: true, force: true }); rmSync(`${out}.zip`, { force: true }); });
  execFileSync(process.execPath, [join(REPO, 'scripts', 'build-release.mjs')], { env: { ...process.env, OUT: out }, stdio: 'pipe' });

  const port = await freePort();
  const child = spawn(process.execPath, [join(out, 'tools', 'serve.mjs'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  await new Promise((r, j) => {
    const to = setTimeout(() => j(new Error('release server did not start')), 10000);
    child.stdout.on('data', (b) => { if (/open http/.test(String(b))) { clearTimeout(to); r(); } });
  });

  for (const [input, want] of [
    ['/web', '/'],
    ['/web/', '/'],
    ['/web?seed=11', '/?seed=11'],
    ['/web/?seed=11', '/?seed=11'],
    ['/web/index.html?seed=11', '/index.html?seed=11'],
    ['//evil.com/../web?seed=3', '/?seed=3'],
  ]) {
    const r = await rawGet(port, input);
    assert.equal(r.status, 302, `${input}: status`);
    assert.equal(r.location, want, `${input}: Location`);
    const f = await rawGet(port, r.location);
    assert.equal(f.status, 200, `${input} -> ${r.location} must serve, got ${f.status}`);
  }
  assert.equal((await rawGet(port, '/web/%zz')).status, 400);
});
