#!/usr/bin/env python3
"""Colour-key cutout for the combat sprites (light, low-saturation, edge-connected background).
Usage: cutout.py in.jpg out.webp [maxH=512] [maxW=640]
1. bg = pixels with V>=140 and S<=0.14 that are connected to the image border;
2. grow bg into a looser halo band (V>=95, S<=0.20) so the grey fringe goes too;
3. alpha = soft edge (1px erode + 0.8px blur); colour is un-blended from the local bg grey;
4. crop to content, resize, WebP at the highest quality that stays <= 150 KB."""
import sys, io
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, dst = sys.argv[1], sys.argv[2]
maxH = int(sys.argv[3]) if len(sys.argv) > 3 else 512
maxW = int(sys.argv[4]) if len(sys.argv) > 4 else 640
rgb = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
mx, mn = rgb.max(2), rgb.min(2)
V = mx; S = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)

def edge_connected(mask):
    lab, _ = ndi.label(mask)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    return np.isin(lab, border[border > 0])

bg = edge_connected((V >= 140) & (S <= 0.14))
# enclosed gaps (between an arm and the body, inside a cloak): large, clearly-background blobs
# that the edge flood cannot reach. Small light details (highlights, eyes) stay.
B0 = np.median(rgb[bg], axis=0)
near = (V >= B0.max() - 18) & (S <= 0.08)
lab, n = ndi.label(near & ~bg)
if n:
    sizes = ndi.sum(near & ~bg, lab, range(1, n + 1))
    bg |= np.isin(lab, 1 + np.flatnonzero(sizes >= 250))
loose = (V >= 95) & (S <= 0.20)
for _ in range(4):  # grow into the halo band, only through loose pixels touching bg
    bg = bg | (ndi.binary_dilation(bg) & loose)
fg = ~bg
fg = ndi.binary_opening(fg, iterations=1)
lab, n = ndi.label(fg)  # drop specks
if n:
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    fg = np.isin(lab, 1 + np.flatnonzero(sizes >= max(200, sizes.max() * 0.01)))
fg = ndi.binary_erosion(fg, iterations=1)
alpha = ndi.gaussian_filter(fg.astype(np.float32), 0.8)
alpha[alpha < 0.04] = 0
# un-blend: edge pixel I = a*C + (1-a)*B with B the background grey; B from the median bg.
B = np.median(rgb[bg], axis=0) if bg.any() else np.array([215, 215, 215], np.float32)
a = np.clip(alpha, 1e-3, 1)[..., None]
col = np.clip((rgb - (1 - a) * B) / a, 0, 255)
col = np.where(alpha[..., None] > 0.98, rgb, np.minimum(col, rgb))
out = np.dstack([col, alpha * 255]).astype(np.uint8)
im = Image.fromarray(out, 'RGBA')
im = im.crop(im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
im.thumbnail((maxW, maxH), Image.LANCZOS)
for q in range(90, 30, -5):
    buf = io.BytesIO(); im.save(buf, 'WEBP', quality=q, method=6, alpha_quality=90)
    if buf.tell() <= 150_000: break
open(dst, 'wb').write(buf.getvalue())
print(f'{dst} {im.size} q={q} {buf.tell()//1024}KB')
