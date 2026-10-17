// The itch.io artifact must carry every file the page asks for (#47).
// Builds into a temp folder, serves it over real HTTP, then crawls from index.html:
// <script src>/<link href>, every static and dynamic ES import, CSS url(), and asset
// paths named in JS. Any 404 fails. Templated sprite paths (`assets/sprites/${key}.webp`)
// cannot be crawled, so every file under src/web/assets/ must also be served.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPTIONAL_MISSING } from '../../scripts/build-release.mjs';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}

function refsOf(path, text) {
  const out = new Set();
  const add = (s) => { if (s && !/^(data:|https?:|#|mailto:)/.test(s) && !s.includes('${')) out.add(s); };
  const ext = extname(path);
  if (ext === '.html') for (const m of text.matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/g)) add(m[1]);
  if (ext === '.css') for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(m[1]);
  if (ext === '.js' || ext === '.mjs') {
    for (const m of text.matchAll(/\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)) add(m[1]);
    for (const m of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) add(m[1]);
    for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1]);
    for (const m of text.matchAll(/['"`]((?:\.\/)?assets\/[\w./-]+\.(?:webp|png|jpe?g|svg|woff2))['"`]/g)) add(m[1]);
  }
  return [...out];
}

test('release build: every module and asset the page references is served (no 404s)', async (t) => {
  const out = mkdtempSync(join(tmpdir(), 'ea-release-'));
  t.after(() => { rmSync(out, { recursive: true, force: true }); rmSync(`${out}.zip`, { force: true }); });
  execFileSync(process.execPath, [join(REPO, 'scripts', 'build-release.mjs')], { env: { ...process.env, OUT: out }, stdio: 'pipe' });

  const server = createServer((req, res) => {
    const p = join(out, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(out) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end(readFileSync(p));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/`;

  const seen = new Set();
  const missing = [];
  const queue = [[new URL('index.html', base).href, '(entry)']];
  while (queue.length) {
    const [url, from] = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const res = await fetch(url);
    if (res.status !== 200 && OPTIONAL_MISSING.some((o) => new URL(url).pathname === `/${o}`)) continue; // designed 404
    if (res.status !== 200) { missing.push(`${new URL(url).pathname} (from ${from})`); continue; }
    const path = new URL(url).pathname;
    if (!/\.(html|css|js|mjs)$/.test(path)) { await res.arrayBuffer(); continue; }
    const text = await res.text();
    for (const ref of refsOf(path, text)) queue.push([new URL(ref, url).href, path]);
  }

  const assetsDir = join(REPO, 'src', 'web', 'assets');
  for (const f of walk(assetsDir)) {
    const rel = relative(join(REPO, 'src', 'web'), f).replace(/\\/g, '/');
    const res = await fetch(new URL(rel, base));
    await res.arrayBuffer();
    if (res.status !== 200) missing.push(`${rel} (src/web/assets/ file)`);
  }

  assert.deepEqual(missing, [], `release artifact is missing ${missing.length} file(s):\n  ${missing.join('\n  ')}`);
  assert.ok(seen.size > 20, `crawl reached only ${seen.size} files`);
});
