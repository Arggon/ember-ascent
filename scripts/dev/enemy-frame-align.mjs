// scripts/dev/enemy-frame-align.mjs — align an enemy pose frame onto its idle canvas.
// Usage: node scripts/dev/enemy-frame-align.mjs <raw.png> <idle.webp> <out.webp>
//    or: node scripts/dev/enemy-frame-align.mjs --fixture   (AC4 self-test, no arguments)
// 1. cutout: uv-run python3 sprite-cutout.py raw.png cut.webp (color-key → alpha, content-cropped)
// 2. align: scale the cut content to the idle's alpha-bbox height, anchor BOTTOM edges
//    (feet/base) and horizontal content centers, pad onto the idle's EXACT canvas W×H
// 3. save WebP ≤150KB (same quality search as sprite-cutout.py)
// Enemy idles each have their OWN canvas (cinder_maw 640x284, warden 446x512) — never
// assume 555x512: that is the hero's shared canvas only.
// Runs only in dev (uv + pillow + numpy + scipy); nothing here ships or gates. `magick`
// (present on this machine) could do steps 2-3 by hand, but the PIL route keeps the
// repo's own tool: same alpha threshold (pixel alpha > 8) and the same quality search
// as sprite-cutout.py.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UV = `${process.env.HOME}/.local/bin/uv`;
const HERE = dirname(fileURLToPath(import.meta.url));
const CUTOUT = join(HERE, 'sprite-cutout.py');

// Step 2+3 as one python program on stdin: measure alpha bboxes (threshold >8, the
// same criterion sprite-cutout.py crops with), rescale the cut's content to the idle's
// bbox height (aspect preserved), paste base-on-base and center-on-center onto the
// idle's exact canvas, then save WebP at the highest quality that stays ≤150KB.
const ALIGN_PY = `
import sys, io
import numpy as np
from PIL import Image

idle_path, cut_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
idle = Image.open(idle_path).convert('RGBA')
cut = Image.open(cut_path).convert('RGBA')

def bbox(im):
    a = im.getchannel('A').point(lambda v: 255 if v > 8 else 0)
    return a.getbbox()

bi, bc = bbox(idle), bbox(cut)
if not bi or not bc:
    sys.exit('empty alpha bbox: idle=%s cut=%s' % (bi, bc))
idle_h = bi[3] - bi[1]
cut_h = bc[3] - bc[1]
s = idle_h / max(1, cut_h)
w = max(1, round(cut.width * s))
h = max(1, round(cut.height * s))
scaled = cut.resize((w, h), Image.LANCZOS)
sb = bbox(scaled)

canvas = Image.new('RGBA', idle.size, (0, 0, 0, 0))
# base-on-base: the scaled content's bottom edge sits on the idle bbox's bottom edge;
# center-on-center: the scaled content's horizontal center sits on the idle bbox's.
x = bi[0] + (bi[2] - bi[0]) // 2 - (sb[0] + sb[2]) // 2
y = bi[3] - (sb[3] - sb[1])
canvas.paste(scaled, (x, y), scaled)

out_bbox = bbox(canvas)
for q in range(90, 30, -5):
    buf = io.BytesIO(); canvas.save(buf, 'WEBP', quality=q, method=6, alpha_quality=90)
    if buf.tell() <= 150_000: break
open(out_path, 'wb').write(buf.getvalue())
print('idle %s bbox=%s' % (idle.size, bi))
print('cut  %s bbox=%s scale=%.3f' % (cut.size, bc, s))
print('out  %s bbox=%s q=%d %dKB -> %s' % (canvas.size, out_bbox, q, buf.tell() // 1024, out_path))
`;

function uvPython(args, input) {
  const r = spawnSync(UV, ['run', '--no-project', '--with', 'pillow', '--with', 'numpy', '--with', 'scipy', 'python3', '-I', ...args], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || '');
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

function run(raw, idle, out) {
  for (const f of [raw, idle]) {
    if (!existsSync(f)) { console.error(`missing file: ${f}`); process.exit(1); }
  }
  const dir = mkdtempSync(join(tmpdir(), 'eframe-'));
  const cut = join(dir, 'cut.webp');
  try {
    const cutOut = uvPython([CUTOUT, raw, cut], '');
    process.stdout.write(cutOut);
    // `-` = read the align program from stdin; the rest are its sys.argv[1:].
    process.stdout.write(uvPython(['-', idle, cut, out], ALIGN_PY));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** AC4 fixture: derive a raw from the idle itself (white canvas, offset + scale — imitates
    the generator's output), run the full pipeline, assert size and feet alignment. */
function fixture(idlePath) {
  const dir = mkdtempSync(join(tmpdir(), 'eframe-fixture-'));
  const raw = join(dir, 'raw.png');
  const out = join(dir, 'aligned.webp');
  const idleBytes = readFileSync(idlePath);
  const prep = `
import sys
from PIL import Image
idle = Image.open(${JSON.stringify(idlePath)}).convert('RGBA')
W = idle.width + 120
H = idle.height + 80
raw = Image.new('RGB', (W, H), (255, 255, 255))
s = 0.9
small = idle.resize((round(idle.width * s), round(idle.height * s)), Image.LANCZOS)
raw.paste(small, (55, 30), small)
raw.save(${JSON.stringify(raw)})
print('raw %s (idle scaled %.2f at (55,30) on white)' % (raw.size, s))
`;
  try {
    process.stdout.write(uvPython(['-'], prep));
    run(raw, idlePath, out);
    const check = `
import sys
from PIL import Image
idle = Image.open(${JSON.stringify(idlePath)}).convert('RGBA')
out = Image.open(${JSON.stringify(out)}).convert('RGBA')
def bbox(im):
    return im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
bi, bo = bbox(idle), bbox(out)
ok = idle.size == out.size and bi[3] == bo[3]
print('assert idle size %s == out size %s -> %s' % (idle.size, out.size, idle.size == out.size))
print('assert idle bbox base %d == out bbox base %d -> %s' % (bi[3], bo[3], bi[3] == bo[3]))
print('AC4 FIXTURE: ' + ('PASS' if ok else 'FAIL'))
sys.exit(0 if ok else 1)
`;
    const stdout = uvPython(['-'], check);
    process.stdout.write(stdout);
    if (!stdout.includes('AC4 FIXTURE: PASS')) process.exitCode = 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const argv = process.argv.slice(2);
if (argv[0] === '--fixture') {
  fixture(argv[1] ?? 'src/web/assets/sprites/cinder_maw.webp');
} else if (argv.length === 3) {
  run(...argv);
} else {
  console.error('usage: enemy-frame-align.mjs <raw.png> <idle.webp> <out.webp> | --fixture [idle.webp]');
  process.exit(2);
}
