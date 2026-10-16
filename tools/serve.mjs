#!/usr/bin/env node
// tools/serve.mjs — a zero-dependency static server for the browser surface.
//
// WHY THIS EXISTS: ES modules do not load over file:// in Chrome (the origin is
// opaque and module fetching is blocked), so `web/index.html` needs a real HTTP
// origin. One shim (--import src/surface/tokens.js) is not an option here.
//
// It is deliberately tiny and dependency-free — node:http and node:fs only — so it
// costs nothing and cannot become a supply-chain surface. It serves the PROJECT ROOT
// only; anything that resolves outside it is refused (path traversal).
//
// Usage:  node tools/serve.mjs [--port 5173]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const { values } = parseArgs({
  options: { port: { type: 'string', default: '5173' }, help: { type: 'boolean', default: false } },
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write('usage: node tools/serve.mjs [--port 5173]\n');
  process.exit(0);
}

const PORT = Number(values.port);
if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  process.stderr.write(`serve: --port must be an integer in 1..65535, got ${JSON.stringify(values.port)}\n`);
  process.exit(3);
}

/** Exact Content-Type table. `.js` MUST be text/javascript or the browser refuses the module. */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Map a URL path to an absolute file path INSIDE the project root, or null if the
 * request escapes the root. This is the only place traversal is decided.
 * @param {string} urlPath
 * @returns {string|null}
 */
function resolveInsideRoot(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  // normalize() collapses `..`; joining to ROOT then re-checking the prefix means a
  // crafted path cannot climb out even before the prefix test.
  const abs = resolve(ROOT, `.${normalize(decoded)}`);
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null;
  return abs;
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('method not allowed\n');
    return;
  }

  let file = resolveInsideRoot(req.url ?? '/');
  if (file === null) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('forbidden: path escapes the project root\n');
    return;
  }

  // A directory (or the bare root) serves its index.html; a request for the root is
  // redirected to /web/ so a human lands on the game, not a listing.
  let stat;
  try {
    stat = statSync(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`not found: ${req.url}\n`);
    return;
  }
  if (stat.isDirectory()) {
    if (!file.endsWith(sep) && !(req.url ?? '').endsWith('/')) {
      res.writeHead(301, { Location: `${req.url}/` });
      res.end();
      return;
    }
    const index = join(file, 'index.html');
    try {
      if (!statSync(index).isFile()) throw new Error('no index');
      file = index;
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`no index.html in ${req.url}\n`);
      return;
    }
  }

  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).on('error', () => {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('read error\n');
  }).pipe(res);
});

// If 5173 is taken, try the next few ports rather than dying with EADDRINUSE.
let port = PORT;
let attempts = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && values.port === '5173' && attempts < 10) {
    attempts += 1;
    port += 1;
    server.listen(port, '127.0.0.1');
    return;
  }
  process.stderr.write(`serve: ${e.message}\n`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const base = `http://localhost:${port}`;
  process.stdout.write(`serving ${ROOT}\n`);
  process.stdout.write(`\n  open ${base}/web/\n\n`);
  process.stdout.write(`  (game:      ${base}/web/   · seed via ?seed=N)\n`);
  process.stdout.write(`  (ctrl-c to stop)\n`);
});

// Ctrl-C stops cleanly: close the listener, then exit 0.
process.on('SIGINT', () => {
  process.stdout.write('\nstopping.\n');
  server.close(() => process.exit(0));
});
