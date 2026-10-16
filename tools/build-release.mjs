#!/usr/bin/env node
// tools/build-release.mjs — regenerate the itch.io HTML5 release artifact.
//
// ZERO dependencies (node:fs, node:path, node:zlib only), Node 24, DETERMINISTIC:
// running it twice from the same checkout produces byte-identical output and the
// same file count / total size. It never writes inside web/ or src/.
//
// WHAT IT PRODUCES (default: ../release/, overridable with OUT=...):
//
//   release/                        <- the artifact directory
//     index.html                    <- web/index.html, FLATTENED to the artifact root
//     app.js                        <- web/app.js, one import path rewritten (see below)
//     style.css                     <- web/style.css, verbatim
//     tokens.js                     <- web/tokens.js, verbatim
//     src/...                       <- the rest of the import closure, verbatim
//     tools/serve.mjs               <- copy for the documented run-locally command
//     HOW-TO-RUN-LOCALLY.txt        <- generated
//   deckbuilder-demo.zip            <- the exact file the owner uploads to itch.io
//
// WHY THE FLATTEN: itch.io's HTML5 player serves the zip root as the game's web
// root, so the entry must be at the top level, not nested under web/.
//
// WHY app.js IS THE ONE REWRITTEN FILE: web/app.js imports '../src/surface/gui/
// controller.js'. From web/ that resolves to <repo>/src/...; once app.js sits at the
// artifact root the same text would resolve OUTSIDE the artifact and 404. The copy
// rewrites that one specifier to './src/surface/gui/controller.js'. The original
// under web/ is never touched.
//
// WHY src/surface/tokens.js IS SHIPPED EVEN THOUGH IT IS OPTIONAL: web/tokens.js
// does `await import('../src/surface/tokens.js')` inside a try/catch for the on-screen
// token badge. In a browser that module then fails on its own bare 'js-tiktoken'
// specifier, the catch swallows it, and the badge shows its no-encoder state. Shipping
// the file means the failure is the intended, tested "no encoder in this host" path
// instead of an unexpected 404, and it is what web/app.js unconditionally names. 3 KB.
//
// WHY src/surface/gui/renderer.js IS *NOT* SHIPPED: controller.js resolves it with
// `await import('./renderer.js')` inside a try/catch. The file does not exist anywhere
// in this repo — a 404 is the designed, documented "renderer unresolvable" state.
//
// WHY THE ZIP IS WRITTEN BY HAND: a hand-rolled deflate archive with fixed timestamps
// is byte-reproducible and needs no `zip` binary and no dependency, so the exact
// upload file can be regenerated and its hash checked on any machine with Node.
//
// Usage:
//   node tools/build-release.mjs                  # -> ./release + ./deckbuilder-demo.zip
//   OUT=/tmp/foo node tools/build-release.mjs     # -> /tmp/foo + /tmp/foo.zip
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = resolve(process.env.OUT ?? join(REPO, 'release'));
const ZIP = OUT.endsWith('.zip') ? OUT : `${OUT}.zip`;

// ---------------------------------------------------------------------------
// The import closure (Task 1). Derived by following every static and dynamic
// ES module specifier from web/index.html; the method and the raw scan output
// are recorded in RELEASE-STATUS.md. Sources are repo-relative, destinations
// artifact-relative.
// ---------------------------------------------------------------------------
const CLOSURE = Object.freeze([
  ['web/index.html', 'index.html'],
  ['web/app.js', 'app.js'],
  ['web/style.css', 'style.css'],
  ['web/tokens.js', 'tokens.js'],
  ['src/surface/gui/controller.js', 'src/surface/gui/controller.js'],
  ['src/surface/session.js', 'src/surface/session.js'],
  ['src/surface/tokens.js', 'src/surface/tokens.js'],
  ['src/kernel/index.js', 'src/kernel/index.js'],
  ['src/kernel/state.js', 'src/kernel/state.js'],
  ['src/kernel/sha256.js', 'src/kernel/sha256.js'],
  ['src/kernel/content.js', 'src/kernel/content.js'],
  ['src/kernel/observe.js', 'src/kernel/observe.js'],
  ['src/kernel/describe.js', 'src/kernel/describe.js'],
  ['src/kernel/actions.js', 'src/kernel/actions.js'],
  ['src/kernel/rng.js', 'src/kernel/rng.js'],
  ['src/kernel/content/cards.bundle.js', 'src/kernel/content/cards.bundle.js'],
  ['src/kernel/rules/act.js', 'src/kernel/rules/act.js'],
  ['src/kernel/rules/card-instance.js', 'src/kernel/rules/card-instance.js'],
  ['src/kernel/rules/encounters.js', 'src/kernel/rules/encounters.js'],
  ['src/kernel/rules/map.js', 'src/kernel/rules/map.js'],
  ['src/kernel/rules/powers.js', 'src/kernel/rules/powers.js'],
  ['src/kernel/rules/vocabulary.js', 'src/kernel/rules/vocabulary.js'],
  ['src/kernel/rules/effects/index.js', 'src/kernel/rules/effects/index.js'],
]);

// The only content rewrite in the whole build: one specifier, in one file.
const REWRITES = Object.freeze([
  { dest: 'app.js', from: "'../src/surface/gui/controller.js'", to: "'./src/surface/gui/controller.js'" },
]);

// serve.mjs derives its doc root from `new URL('..')`, so it must sit one level
// down in the artifact. Its printed banner says "/web/"; once flattened it must say
// "/" or the note points at a 404. Source under tools/ is not modified.
const SERVE_DEST = 'tools/serve.mjs';
const SERVE_REWRITES = Object.freeze([
  ['${base}/web/', '${base}/'],
  ['/web/   ·', '/   ·'],
]);

const RUN_LOCALLY = `HOW TO RUN THIS GAME LOCALLY
============================

This is a static site with ES modules and no build step. It MUST be served over
http:// — opening index.html directly with file:// will NOT work, because browsers
block module fetching from an opaque origin. That is a browser rule, not a bug here.

The easy way (needs Node 24 or newer):

    node tools/serve.mjs

Then open the URL it prints, which is http://localhost:5173/ — and add ?seed=N to
play a specific run, e.g. http://localhost:5173/?seed=7

Uploading this folder to any static host works too, as long as it sets
Content-Type: text/javascript for .js files. If a host serves .js as text/plain the
browser refuses the module and you get a blank page.

NOTHING ELSE IS NEEDED. No install, no build, no node_modules, and no network
access at runtime: every asset the game uses is in this folder and is loaded from
this same origin. No analytics, no telemetry, no external font, no CDN.

Layout: index.html is the entry point; app.js, style.css and tokens.js are the
page; src/ is the game engine that app.js imports.
`;

// ---------------------------------------------------------------------------
// Minimal deterministic ZIP writer (store + deflate, CRC32, fixed timestamps).
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** @param {{name:string, data:Buffer}[]} files @returns {Buffer} */
function makeZip(files) {
  const DOS_TIME = 0;
  const DOS_DATE = 0x0021; // 1980-01-01 00:00:00 — fixed, so the zip is reproducible
  const locals = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const deflated = deflateRawSync(f.data, { level: 9 });
    const stored = deflated.length < f.data.length;
    const payload = stored ? deflated : f.data;
    const method = stored ? 8 : 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 name flag
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x031e, 4); // made by Unix, spec 3.0
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0x81a40000, 38); // 0644
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += lh.length + nameBuf.length + payload.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

// ---------------------------------------------------------------------------
// Nothing that is not a runtime asset may reach the upload: archives, logs and
// dotfiles are skipped, so a leftover file in the output directory can never be
// packaged into the zip the owner uploads.
const EXCLUDE = /(\.zip$|\.log$|(^|\/)\.[^/]+$)/;

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = full.slice(base.length + 1).replace(/\\/g, '/');
    if (EXCLUDE.test(rel)) continue;
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function main() {
  const written = [];
  const put = (destRel, body) => {
    const destAbs = join(OUT, destRel);
    mkdirSync(dirname(destAbs), { recursive: true });
    writeFileSync(destAbs, body);
    written.push([destRel, body.length]);
  };

  for (const [srcRel, destRel] of CLOSURE) {
    const srcAbs = join(REPO, srcRel);
    if (!existsSync(srcAbs)) {
      process.stderr.write(`build-release: MISSING SOURCE ${srcRel}\n`);
      process.exit(1);
    }
    let text = readFileSync(srcAbs, 'utf8');
    for (const r of REWRITES) {
      if (r.dest !== destRel) continue;
      if (!text.includes(r.from)) {
        // A rewrite that no longer applies is a broken layout assumption, not a
        // warning: fail loudly rather than shipping an artifact that 404s.
        process.stderr.write(`build-release: rewrite target not found in ${srcRel}: ${r.from}\n`);
        process.exit(1);
      }
      text = text.split(r.from).join(r.to);
    }
    put(destRel, Buffer.from(text, 'utf8'));
  }

  const serveSrc = readFileSync(join(REPO, 'tools', 'serve.mjs'), 'utf8');
  put(SERVE_DEST, Buffer.from(SERVE_REWRITES.reduce((s, [a, b]) => s.split(a).join(b), serveSrc), 'utf8'));

  put('HOW-TO-RUN-LOCALLY.txt', Buffer.from(RUN_LOCALLY, 'utf8'));

  // Inventory is read back off disk rather than trusting the list above.
  const names = walkFiles(OUT).sort();
  const entries = names.map((n) => ({ name: n.replace(/\\/g, '/'), data: readFileSync(join(OUT, n)) }));
  const total = entries.reduce((n, e) => n + e.data.length, 0);

  const zipBuf = makeZip(entries);
  writeFileSync(ZIP, zipBuf);

  process.stdout.write(`build-release: wrote ${OUT}\n`);
  for (const [rel, size] of [...written].sort((a, b) => a[0].localeCompare(b[0]))) {
    process.stdout.write(`  ${String(size).padStart(6)}  ${rel}\n`);
  }
  process.stdout.write(`\nfiles in artifact: ${names.length}\n`);
  process.stdout.write(`total size:        ${total} bytes (${(total / 1024).toFixed(1)} KiB)\n`);
  process.stdout.write(`zip:               ${ZIP}\n`);
  process.stdout.write(`zip size:          ${zipBuf.length} bytes (${(zipBuf.length / 1024).toFixed(1)} KiB)\n`);
  process.stdout.write(`zip entries:       ${entries.length}\n`);
  process.stdout.write(`zip sha256:        ${createHash('sha256').update(zipBuf).digest('hex')}\n`);
}

main();
